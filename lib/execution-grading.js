// SPDX-License-Identifier: Apache-2.0
'use strict';
const {canonicalize,sha256}=require('./canonical'),{mean,stddev,round}=require('./stats');
const CONTRACT='execution-primary-v1';
const LIMITATIONS=['The secondary judge has shown Unicode misreadings despite character annotations.','A secondary control received a false positive for contradictory tests.','Secondary grades assess test quality, not verified implementation correctness.'];
const fail=message=>Object.assign(Error(message),{code:'EXECUTION_CONTRACT'});
function validateExecutionSuite(bundle,skill){
 if(!bundle||bundle.version!==1||!Array.isArray(bundle.cases)||bundle.cases.length!==20)throw fail('Execution suite must contain the complete 20-case freeze.');
 const {freeze_hash,...body}=bundle;if(sha256(canonicalize(body))!==freeze_hash)throw fail('Execution freeze hash differs.');
 const active=bundle.cases.filter(c=>!c.judge_only),h=x=>sha256(canonicalize(x));
 const components={prompts:h(bundle.cases.map(c=>({id:c.id,prompt:c.prompt}))),rubrics:h(bundle.cases.map(c=>({id:c.id,rubric:c.rubric}))),hidden_tests:h(active.map(c=>({id:c.id,sha256:c.hidden.sha256,test_names:c.test_names}))),references:h(active.map(c=>({id:c.id,sha256:c.reference.sha256}))),broken_versions:h(active.map(c=>({id:c.id,versions:c.broken.map(b=>({id:b.id,sha256:b.file.sha256}))})))};
 if(canonicalize(components)!==canonicalize(bundle.component_hashes))throw fail('Execution component hash differs.');
 if(new Set(bundle.cases.map(c=>c.id)).size!==20||active.length!==19||bundle.cases.find(c=>c.judge_only)?.id!=='result-type-typescript')throw fail('Execution case roles differ.');
 for(const c of active){require('./hidden-execution').validateHiddenCase(c);for(const a of [c.reference,...c.broken.map(b=>b.file)]){const bytes=Buffer.from(a.base64,'base64');if(bytes.length!==a.bytes||sha256(bytes)!==a.sha256||bytes.toString('base64')!==a.base64)throw fail('Frozen reference or broken-source bytes differ.');}}
 const fields=c=>({id:c.id,prompt:c.prompt,rubric:c.rubric,pass_threshold:c.pass_threshold});
 if(skill&&(skill.suite.suiteHash!==require('./skill').suiteIdentity({cases:bundle.cases}).suiteHash||skill.suite.caseCount!==20))throw fail('Execution suite hash or count differs.');
 if(skill&&canonicalize(skill.suite.cases.map(fields))!==canonicalize(bundle.cases.map(fields)))throw fail('Execution case prompts or rubrics differ from the frozen suite.');
 return bundle;
}
function assertExecutionRun(skill,opts){
 if(skill.suite.executionFreeze&&!opts.executionSuite)throw fail('An execution bundle is required for this active suite.');
 if(skill.suite.executionFreeze&&skill.suite.executionFreeze!==opts.executionSuite?.freeze_hash)throw fail('Active execution freeze differs from the bundle.');
 if(!opts.executionSuite)return null;
 if(opts.capture!=='repository'||(!opts.checkpointDir&&!opts.resume)||(opts.concurrency??1)!==1||require('./provider').resolveModel(opts.judgeModel)!=='claude-sonnet-5-5')throw fail('Execution grading requires repository capture, a checkpoint, serial calls and the Sonnet judge.');
 return validateExecutionSuite(opts.executionSuite,skill);
}
function scoringDescriptor(bundle){return {contract:CONTRACT,freeze_hash:bundle.freeze_hash,component_hashes:bundle.component_hashes,primary_case_ids:bundle.cases.filter(c=>!c.judge_only).map(c=>c.id),judge_only_case_ids:bundle.cases.filter(c=>c.judge_only).map(c=>c.id),secondary_role:'test-quality',limitations:LIMITATIONS};}
function secondaryGrade(jr){return jr.unmeasured?{status:'unmeasured',reason:jr.reason,samples:[],mean:null,stddev:null,judge_sample_hashes:jr.sampleHashes||[]}:{status:'measured',samples:jr.caseResult.samples,mean:jr.caseResult.mean,stddev:jr.caseResult.stddev,judge_sample_hashes:jr.caseResult.judge_sample_hashes,reason:jr.caseResult.reason};}
function primaryJudgeResult(jr,execution,c,mode,answerHash,judgeModel){
 const score=execution.pass_rate;
 return {...jr,unmeasured:false,caseResult:{id:c.id,mode,mean:score,score,stddev:0,samples:[score],generation_hash:answerHash,
 ...((jr.caseResult?.judge_sample_hashes||jr.sampleHashes||[]).length?{judge_sample_hashes:jr.caseResult?.judge_sample_hashes||jr.sampleHashes}:{}),threshold:c.pass_threshold,
 outcome:score>=c.pass_threshold?'pass':'fail',reason:'Frozen hidden-test pass rate.',judge:jr.caseResult?.judge||{model_id:judgeModel,rubric_hash:require('./judge').caseRubricHash(c)},...((jr.caseResult?.judge_usage||jr.judge_usage)?{judge_usage:jr.caseResult?.judge_usage||jr.judge_usage}:{})}};
}
function secondaryAcrossDraws(draws){const rows=draws.filter(d=>d.secondary?.status==='measured');return {n_measured:rows.length,n_unmeasured:draws.length-rows.length,mean:rows.length?round(mean(rows.map(d=>d.secondary.mean))):null,sd:rows.length?round(stddev(rows.map(d=>d.secondary.mean))):null};}
function executionReceiptProblem(receipt){
 const rows=receipt?.results?.cases||[],s=receipt?.run?.scoring,marked=rows.some(c=>c.score_basis||c.generation?.draws?.some(d=>d.execution||d.primary!==undefined||d.secondary));
 if(!s)return marked?'Execution evidence requires the scoring contract.':null;
 const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x),eq=(a,b)=>canonicalize(a)===canonicalize(b);
 try{
 if(s.contract!==CONTRACT||receipt.run.capture.mode!=='repository'||receipt.run.judge.model_id!=='claude-sonnet-5-5'||!hash(s.freeze_hash)||!eq(s.limitations,LIMITATIONS)||s.secondary_role!=='test-quality')return 'Execution scoring identity differs.';
 if(!s.component_hashes||['prompts','rubrics','hidden_tests','references','broken_versions'].some(k=>!hash(s.component_hashes[k])))return 'Execution component binding absent.';
 if(s.primary_case_ids.length!==19||!eq(s.judge_only_case_ids,['result-type-typescript'])||new Set([...s.primary_case_ids,...s.judge_only_case_ids]).size!==20)return 'Execution case roles differ.';
 if(!Array.isArray(receipt.run.local_execution?.attempts))return 'Local execution attempts absent.';
 for(const c of rows){const primary=s.primary_case_ids.includes(c.id);if(!primary&&!s.judge_only_case_ids.includes(c.id)||c.score_basis!==(primary?'hidden-tests':'judge-only'))return 'Case scoring role differs.';
  for(const d of c.generation.draws){
   if(d.status!=='measured'){if(d.execution?.status==='measured')return 'Measured execution was discarded.';continue;}
   if(!hash(d.snapshot_hash)||!d.secondary||!['measured','unmeasured'].includes(d.secondary.status))return 'Snapshot or secondary evidence absent.';
   const local=receipt.run.local_execution.attempts.filter(a=>a.state==='completed'&&a.key[2]===c.id&&a.key[3]===c.mode&&a.key[4]===d.draw_index);
   const snapshots=local.filter(a=>a.phase==='snapshot');if(snapshots.length!==1||snapshots[0].request_hash!==sha256(canonicalize({snapshot_hash:d.snapshot_hash,runtime_image_digest:receipt.run.capture.runtime_image_digest})))return 'Snapshot phase binding differs.';
   const q=d.secondary;if(!eq(q.judge_sample_hashes,d.judge_sample_hashes||[]))return 'Secondary output hashes differ.';
   if(q.status==='measured'&&(!q.samples.length||q.samples.length!==q.judge_sample_hashes.length||q.samples.length!==receipt.run.judge.samples||q.samples.some(x=>!Number.isFinite(x)||x<0||x>1)||Math.abs(mean(q.samples)-q.mean)>1e-9||Math.abs(stddev(q.samples)-q.stddev)>1e-9))return 'Secondary arithmetic differs.';
   if(q.status==='unmeasured'&&(q.mean!==null||q.stddev!==null||q.samples.length))return 'Unmeasured secondary has a score.';
   if(!primary){if(d.primary!==null||d.execution)return 'Judge-only draw entered execution.';continue;}
   const e=d.execution;if(!e||e.status!=='measured'||!e.tests.length||e.total!==e.tests.length||e.passed!==e.tests.filter(t=>t.outcome==='pass').length||e.tests.some(t=>!['pass','fail'].includes(t.outcome))||new Set(e.tests.map(t=>t.name)).size!==e.total||e.pass_rate!==e.passed/e.total)return 'Execution test arithmetic differs.';
   const executions=local.filter(a=>a.phase==='hidden-execution');if(executions.length!==1||executions[0].result_hash!==sha256(canonicalize(e)))return 'Execution has no matching completed local attempt.';
   if((receipt.run.surface==='stub')!==(e.evidence_kind==='simulated'))return 'Execution evidence kind differs.';
   const {execution_hash,...body}=e;if(sha256(canonicalize(body))!==execution_hash||e.freeze_hash!==s.freeze_hash||e.snapshot_hash!==d.snapshot_hash||!hash(e.hidden_test_hash)||sha256(canonicalize(e.tests.map(t=>t.name)))!==e.test_names_hash||e.runtime_image_digest!==receipt.run.capture.runtime_image_digest||e.effective_environment_hash!==receipt.run.capture.effective_environment_hash)return 'Execution artifact binding differs.';
   if(d.mean!==e.pass_rate||d.primary!==e.pass_rate||d.stddev!==0||!eq(d.samples,[e.pass_rate]))return 'Primary score differs from execution.';
  }
  const agg=require('./sampling').acrossDraws(c.generation.draws);
  if(c.generation.mean!==agg.mean||c.generation.sd!==agg.sd||c.generation.n_measured!==agg.n_measured||c.generation.n_unmeasured!==agg.n_unmeasured)return 'Primary generation statistics differ.';
  if(agg.n_measured&&(c.mean!==agg.mean||c.score!==agg.mean||c.primary!==(primary?agg.mean:null)))return 'Case score differs from its draws.';
  if(!eq(c.secondary,secondaryAcrossDraws(c.generation.draws)))return 'Secondary aggregate differs.';
 }
 const complete=rows.every(c=>c.generation.draws.every(d=>d.secondary?.status==='measured'));
 if(receipt.run.secondary_complete!==complete)return 'Secondary completeness differs.';
 const calc=require('./receipt').comparisonOf(rows,{comparative:receipt.run.scope?.kind!=='diagnostic'});
 if(receipt.run.scope?.kind==='diagnostic')calc.comparison=require('./receipt').comparisonOf([]).comparison;
 if(!eq(receipt.comparison,calc.comparison)||!eq(receipt.results.aggregates.with_skill,calc.aggregates.with_skill)||!eq(receipt.results.aggregates.baseline,calc.aggregates.baseline))return 'Execution comparison differs.';
 }catch{return 'Execution evidence is incomplete.';}
 return null;
}
function executionSummaryLines(receipt){if(!receipt.run.scoring)return [];const missing=receipt.results.cases.reduce((n,c)=>n+(c.secondary?.n_unmeasured||0),0);return ['Primary: hidden-test pass rate on executable tasks. TypeScript is judge-only and excluded from that aggregate.','Secondary: Sonnet test-quality assessment; '+missing+' unmeasured draw assessment(s).',...LIMITATIONS];}
function executionReportReading(receipt){const problem=executionReceiptProblem(receipt);if(problem)throw fail(problem);return {primary:'hidden-test-pass-rate',freeze_hash:receipt.run.scoring.freeze_hash,comparison:receipt.comparison,secondary_complete:receipt.run.secondary_complete,secondary:receipt.results.cases.map(c=>({id:c.id,mode:c.mode,score_basis:c.score_basis,primary:c.primary,secondary:c.secondary})),limitations:[...LIMITATIONS,...(receipt.run.judge.relationship?.limitation?[receipt.run.judge.relationship.limitation]:[])]};}
module.exports={CONTRACT,validateExecutionSuite,assertExecutionRun,scoringDescriptor,secondaryGrade,primaryJudgeResult,secondaryAcrossDraws,executionReceiptProblem,executionSummaryLines,executionReportReading};
