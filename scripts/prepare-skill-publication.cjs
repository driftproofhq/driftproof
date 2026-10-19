#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const C=require('../specs/408-skill-measurements/campaign.cjs'),P=require('../specs/408-skill-measurements/publication.cjs'),{readLedger}=require('../specs/408-skill-measurements/ledger.cjs'),{sha256}=require('../lib/canonical');
function collect({root=C.ROOT,manifests,buildDate,implementation}){
 P.validateDate(buildDate);P.implementation(root,implementation);
 const ctx=C.readPlan(root),ledger=readLedger(ctx,manifests),files=new Map();C.need(ledger.receipts.size===40,'ATTEMPT_COVERAGE');
 for(const a of ctx.plan.execution.attempts){const o=ledger.receipts.get(a.attempt_id);for(const suffix of ['.json','-answers.json'])files.set(a.attempt_id+suffix,C.regular(path.join(path.dirname(o.file),a.attempt_id+suffix)));files.set('suites/'+a.protocol.evals_sha256+'.json',C.binding(ctx,a).bytes);}
 const needed=new Set(ledger.manifests.map(m=>m.manifest.plan_sha256)),plans=[];
 const revisions=cp.execFileSync('git',['log','--format=%H','--',C.SPEC+'/plan.json'],{cwd:root,encoding:'utf8'}).trim().split('\n');
 for(const rev of revisions){const bytes=cp.execFileSync('git',['show',rev+':'+C.SPEC+'/plan.json'],{cwd:root});const h=sha256(bytes);if(needed.delete(h))plans.push({sha256:h,bytes:bytes.toString()});if(!needed.size)break;}
 C.need(!needed.size,'PLAN_BINDING');
 for(const name of ['sources.json','popularity.json','pricing.json','prior-spend.json'])files.set('inputs/'+name,C.regular(path.join(root,C.SPEC,name)));
 const record={format:'driftproof-skill-publication/1',build_date:buildDate,implementation,roster:ctx.plan.execution.attempts,manifests:ledger.manifests.map(m=>({sha256:m.sha256,bytes:C.regular(m.file).toString()})),plans,spend_usd:ledger.spent,failures:ledger.failures,final_states:ctx.plan.execution.attempts.map(a=>{const o=ledger.receipts.get(a.attempt_id);return {attempt_id:a.attempt_id,status:'receipt',receipt_hash:o.outcome.receipt_hash,manifest_sha256:o.manifest_sha256};}),artifacts:Object.fromEntries([...files].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([f,b])=>[f,sha256(b)]))};
 // Complete validation, including the last receipt, precedes the first write.
 P.verifyBundle(root,record,f=>files.get(f));
 files.set('campaign.json',Buffer.from(JSON.stringify(record,null,2)+'\n'));return {record,files};
}
function writeBundle(bundle,{root=C.ROOT,out=path.join(root,P.DIR)}={}){
 P.verifyBundle(root,bundle.record,f=>bundle.files.get(f));
 for(const [f,b]of bundle.files){const p=path.join(out,f);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,b);}
 const lock={campaign_sha256:sha256(bundle.files.get('campaign.json'))};fs.writeFileSync(path.join(root,C.SPEC,'publication-lock.json'),JSON.stringify(lock,null,2)+'\n');
}
module.exports={collect,writeBundle};
if(require.main===module){
 const args=process.argv.slice(2);if(args.length===1&&args[0]==='--check'){const p=P.readPublished();console.log('publication: '+p.items.length+'/40 verified receipts, '+p.record.manifests.length+' manifests, '+p.record.failures.length+' retained failures');}
 else{let buildDate,impl;const manifests=[];for(let i=0;i<args.length;i++){if(args[i]==='--manifest')manifests.push(args[++i]);else if(args[i]==='--build-date')buildDate=args[++i];else if(args[i]==='--implementation')impl=args[++i];else C.fail('ARGUMENT');}const b=collect({manifests,buildDate,implementation:C.read(impl)});writeBundle(b);console.log('publication: '+b.files.size+' verified evidence files prepared');}
}
