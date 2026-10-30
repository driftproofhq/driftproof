// SPDX-License-Identifier: Apache-2.0
'use strict';

// Offline CLI double for issue 538. Synthetic endings, not recorded R-2 evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');

const calls = [];
let generate = () => 'ok';
let leave = () => [];
const JUDGE = /Return ONLY this JSON object/;
// Issue 220: judge replies name the requested model; generations keep their original shape.
const cliJson = (result, model) => JSON.stringify({ type: 'result', result, ...(model ? { model, modelUsage: { [model]: { inputTokens: 10, outputTokens: 5 } } } : {}), stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });
const b64 = (s) => Buffer.from(s).toString('base64');
cp.spawn = (file, args, options) => {
  const call = { file, args: [...args], cwd: (options && options.cwd) || null, input: '' };
  calls.push(call);
  const c = new EventEmitter();
  c.stdout = new PassThrough(); c.stderr = new PassThrough(); c.kill = () => true;
  c.stdin = {
    write(d) { call.input += d; },
    on() {},
    end() {
      setImmediate(() => {
        const judge = JUDGE.test(call.input);
        call.judge = judge;
        const isCodex = call.args.includes('codex');
        let out = judge ? cliJson(JSON.stringify({ score: 0.8, pass: true, reason: 'double' }), call.args[call.args.lastIndexOf('--model') + 1])
          : isCodex ? `${JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: generate(call) } })}\n${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } })}\n`
            : cliJson(generate(call));
        const files = judge ? [] : leave(call);
        const wrapper = call.args.find((a) => / WORKSPACE/.test(a));
        if (wrapper) {
          const n = /WORKSPACE\\n' ([0-9a-f]{32})/.exec(wrapper)[1];
          out += `\n${n} WORKSPACE\n${files.map(([p, t]) => `${n} FILE ${b64(p)} ${Buffer.byteLength(t)}\n${b64(t)}\n`).join('')}${n} END\n`;
        } else if (call.cwd) {
          for (const [p, t] of files) { fs.mkdirSync(path.dirname(path.join(call.cwd, p)), { recursive: true }); fs.writeFileSync(path.join(call.cwd, p), t); }
        }
        c.stdout.end(out); c.stderr.end();
        setImmediate(() => c.emit('close', 0, null));
      });
    },
  };
  return c;
};
// What `claude --version` and `codex --version` printed on the prep box (1 Oct 2026); a test that
// needs a second version sets its own.
const VERSION_DEFAULT = { claude: '2.1.285 (Claude Code)\n', codex: 'codex-cli 0.146.0\n' };
const versionOut = { ...VERSION_DEFAULT };
let versionFails = false;
const versionCalls = [];
cp.spawnSync = (file, args) => {
  const all = [file, ...args];
  const bin = all[all.lastIndexOf('--version') - 1];
  versionCalls.push({ file, args: [...args], bin });
  if (versionFails) return { status: 1, stdout: '', stderr: 'no version today\n' };
  return { status: 0, stdout: versionOut[bin] || '', stderr: '' };
};

delete process.env.DRIFTPROOF_STUB;
delete process.env.DRIFTPROOF_EVAL_USER;
process.env.CLAUDE_PROVIDER = 'cli';
process.env.OPENAI_SURFACE = 'cli';
const provider = require('../lib/provider');
const { runSkillOnModel } = require('../lib/run');
const { regradeReceipt } = require('../lib/regrade');
const { validateReceipt, verifyReceiptHash, sealReceipt } = require('../lib/receipt');
const { receiptVerdict } = require('../lib/verdict');
const { staleReport } = require('../lib/stale');

const SYS = '---\nname: fx\n---\nWrite the ADR.';
const reset = () => {
  calls.length = 0; generate = () => 'ok'; leave = () => [];
  versionCalls.length = 0; Object.assign(versionOut, VERSION_DEFAULT); versionFails = false;
};
const afterLabel = (c) => c.args.slice(c.args.indexOf(provider.HOP_LABEL) + 1);

// ── AC-1 and AC-2: the lanes' argv and what each mode returns ─────────────────────────────────────

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
// Issue 196 (A-137-n in spec 137): the suite hash is the one a run computes for these cases, which a
// regrade now holds a skill's cases to (spec 184 A-184-15).
function skillOf() {
  const { cases, suiteHash } = require(path.join(__dirname, '..', 'lib', 'skill.js')).suiteIdentity([{ id: 'adr-1', prompt: 'Write an ADR choosing a database.', rubric: 'A complete ADR with context, decision and consequences.', pass_threshold: 0.7 }]);
  return { name: 'fx-adr', version: '1.0.0', contentHash: sha(SYS), skillMd: SYS, suite: { format: 'agentskills.io/evals', suiteHash, caseCount: cases.length, cases } };
}
const armOf = (receipt, mode) => receipt.results.cases.find((c) => c.mode === mode);
const withSkill = (call) => call.args.includes('--append-system-prompt');


const { textFakeToolCall, fakeToolCallCounts, fakeToolCallWarning } = require('../lib/text-capture');
const { summarizeReceipt } = require('../lib/run');
const { plainOf } = require('../lib/plain');
const endings = [
  'Let me inspect the project.\n<invoke name="Bash"><parameter name="command">ls</parameter></invoke>',
  '<function_calls>\n<invoke name="Read"><parameter name="file_path">./README.md</parameter></invoke>\n</function_calls>',
  '<function_calls>\n<invoke name="Bash">',
];
const real = 'Use PostgreSQL for transactional consistency. Keep migrations in version control.';
test('AC-1 synthetic terminal markup and negative controls', () => {
  for (const s of endings) {
    assert.equal(textFakeToolCall(s, 'text')?.kind, 'fake_tool_call', s);
    for (const mode of ['files', 'repository', undefined]) assert.equal(textFakeToolCall(s, mode), null);
    assert.equal(textFakeToolCall(s + '\n' + real, 'text'), null);
    assert.equal(textFakeToolCall('~~~xml\n' + s + '\n~~~', 'text'), null);
  }
  for (const s of ['Use <invoke name="Bash">ls</invoke> as an example.',
    '{"name":"Bash","command":"ls"}', '<div>hello</div>',
    String.fromCharCode(96)+'<invoke name="Bash">ls</invoke>'+String.fromCharCode(96)]) {
    assert.equal(textFakeToolCall(s, 'text'), null, s);
  }
});
test('AC-2 run skips fake calls, keeps their hashes and usage, averages survivors', async () => {
  reset(); let n=0;
  generate = c => withSkill(c) && n++ === 0 ? endings[0] : real;
  const {receipt}=await runSkillOnModel({skill:skillOf(),model:'haiku',opts:{samples:2,trusted:true}});
  const w=armOf(receipt,'with_skill').generation;
  assert.equal(w.draws[0].status,'unmeasured'); assert.equal(w.draws[0].capture_outcome,'fake_tool_call');
  assert.equal(w.draws[0].generation_hash,sha(endings[0]));
  assert.equal(w.draws[0].mean,null); assert.deepEqual(w.draws[0].samples,[]);
  assert.ok(w.draws[0].usage); assert.equal(w.draws[0].stop_reason,'end_turn');
  assert.equal(w.mean,0.8); assert.equal(w.n_unmeasured,1);
  assert.equal(calls.filter(c=>c.judge&&c.input.includes('<invoke')).length,0);
  assert.deepEqual(receipt.results.fake_tool_calls,{with_skill:{count:1,draws:w.n_drawn},baseline:{count:0,draws:armOf(receipt,'baseline').generation.n_drawn}});
  assert.ok(validateReceipt(receipt).valid,JSON.stringify(validateReceipt(receipt).errors)); assert.ok(verifyReceiptHash(receipt));
  assert.match(summarizeReceipt(receipt),/Comparison unreliable: at least 5%/);
  assert.match(plainOf(receipt).sentence,/Comparison unreliable/);
});
test('AC-2 all fake replies yield no mean and no judge calls',async()=>{
  reset();generate=()=>endings[1];
  const {receipt}=await runSkillOnModel({skill:skillOf(),model:'haiku',opts:{samples:2,trusted:true}});
  for(const c of receipt.results.cases){assert.equal(c.case_status,'failed_unmeasured');assert.equal(c.generation.mean,null);}
  assert.equal(calls.filter(c=>c.judge).length,0);
  assert.equal(receipt.run.judge.parse_retries,0);
  assert.equal(receipt.run.judge.parse_recoveries,0);
  for(const c of receipt.results.cases)for(const d of c.generation.draws)assert.equal(d.judge_parse_retries,undefined);
  assert.match(plainOf(receipt).sentence,/Comparison unreliable/);
  assert.ok(validateReceipt(receipt).valid,JSON.stringify(validateReceipt(receipt).errors));
});
test('AC-3 resealed count, denominator, score and mode plants refuse',async()=>{
  reset();generate=c=>withSkill(c)?endings[0]:real;
  const {receipt}=await runSkillOnModel({skill:skillOf(),model:'haiku',opts:{samples:2,trusted:true}});
  for(const change of [
    r=>r.results.fake_tool_calls.with_skill.count++,
    r=>r.results.fake_tool_calls.with_skill.draws++,
    r=>delete r.results.fake_tool_calls,
    r=>r.results.cases[0].generation.draws[0].mean=0,
    r=>r.results.cases[0].generation.draws[0].status='measured',
    r=>r.results.cases[0].generation.draws[0].judge_sample_hashes=[sha('invented')],
    r=>r.run.capture.mode='files',
  ]){const r=structuredClone(receipt);change(r);assert.equal(verifyReceiptHash(r),false);assert.equal(validateReceipt(sealReceipt(r)).valid,false);}
});
test('AC-4 threshold is per arm, all attempted draws, without rounding',()=>{
  const draw=f=>({status:f?'unmeasured':'measured',...(f?{capture_outcome:'fake_tool_call'}:{}),mean:f?null:0.8});
  for(const mode of ['with_skill','baseline','placebo'])for(const n of [19,20,21]){
    const r={run:{capture:{mode:'text'}},results:{cases:[{id:'a',mode,case_status:'failed_unmeasured',generation:{draws:[draw(true)]}},{id:'b',mode,generation:{draws:Array.from({length:n-1},()=>draw(false))}}]}};
    assert.deepEqual(fakeToolCallCounts(r),{[mode]:{count:1,draws:n}});
    assert.equal(!!fakeToolCallWarning(r),n<=20);
  }
  assert.equal(fakeToolCallWarning({run:{capture:{mode:'text'}},results:{cases:[]}}),null);
});
test('AC-5 old schema verifies; regrade planning and two regrades never judge fake calls',async()=>{
  reset();generate=()=>real;
  const skill=skillOf();let {receipt}=await runSkillOnModel({skill,model:'haiku',opts:{samples:2,trusted:true}});
  receipt.schema_version='0.15';delete receipt.results.fake_tool_calls;
  const d=receipt.results.cases[0].generation.draws[0];d.generation_hash=sha(endings[0]);receipt=sealReceipt(receipt);
  assert.ok(validateReceipt(receipt).valid);assert.ok(verifyReceiptHash(receipt));
  const answers={[sha(real)]:real,[sha(endings[0])]:endings[0]};
  const {drawsToJudge}=require('../lib/regrade');
  const all=receipt.results.cases.flatMap(c=>c.generation.draws).length;
  assert.equal(drawsToJudge(receipt,answers).length,all-1);
  for(let i=0;i<2;i++){
    reset();({receipt}=await regradeReceipt({receipt,skill,answers,judgeModel:'haiku',samples:2,opts:{trusted:true}}));
    assert.equal(calls.filter(c=>c.judge).length,(all-1)*2);
    assert.equal(calls.filter(c=>c.judge&&c.input.includes('<invoke')).length,0);
    assert.equal(receipt.results.fake_tool_calls.with_skill.count,1);
    assert.equal(receipt.run.judge.parse_retries,0);
    for(const c of receipt.results.cases)for(const d of c.generation.draws)assert.equal(d.judge_parse_retries,undefined);
    assert.ok(validateReceipt(receipt).valid,JSON.stringify(validateReceipt(receipt).errors));assert.ok(verifyReceiptHash(receipt));
  }
});
test('AC-6 files capture still judges markup; text summary names tools',async()=>{
  reset();generate=()=>endings[0];
  const {receipt}=await runSkillOnModel({skill:skillOf(),model:'haiku',opts:{samples:2,trusted:true,capture:'files'}});
  assert.ok(calls.some(c=>c.judge));assert.equal(receipt.results.fake_tool_calls,undefined);
  assert.equal(fakeToolCallWarning(receipt),null);
  assert.match(require('../lib/capture').captureLine({mode:'text'},'claude-cli'),/Read, WebFetch and WebSearch/);
});

test('AC-3 grader identity binds the fake-call detector bytes',()=>{
  assert.ok(require('../lib/judge').JUDGE_CODE_FILES.includes('lib/text-capture.js'));
  const dir=fs.mkdtempSync(path.join('/var/tmp','issue538-revision-'));
  try {
    for(const f of require('../lib/judge').JUDGE_CODE_FILES){
      fs.mkdirSync(path.dirname(path.join(dir,f)),{recursive:true});
      fs.copyFileSync(path.join(__dirname,'..',f),path.join(dir,f));
    }
    const before=require('../lib/judge').judgeCodeRevision(dir);
    fs.appendFileSync(path.join(dir,'lib/text-capture.js'),'\n// planted byte\n');
    assert.notEqual(require('../lib/judge').judgeCodeRevision(dir),before);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('AC-4 CLI prints the warning and tool limit beside the emitted receipt',()=>{
  const dir=fs.mkdtempSync(path.join('/var/tmp','issue538-cli-'));
  try {
    const bin=path.join(dir,'bin'),subject=path.join(dir,'subject'),out=path.join(dir,'out');
    fs.mkdirSync(bin);fs.mkdirSync(subject);fs.mkdirSync(path.join(subject,'evals'));
    fs.writeFileSync(path.join(subject,'SKILL.md'),SYS);
    fs.writeFileSync(path.join(subject,'evals','evals.json'),JSON.stringify({cases:[{id:'adr-1',prompt:'Choose a database.',rubric:'A useful decision.',pass_threshold:0.7}]}));
    // A local executable double. A judge request exits immediately as a failure.
    const fake=[
      '#!/usr/bin/env node',
      'if(process.argv.includes("--version")){console.log("2.1.287");process.exit(0);}',
      'let input="";process.stdin.setEncoding("utf8");process.stdin.on("data",x=>input+=x);',
      'process.stdin.on("end",()=>{',
      'if(/Return ONLY this JSON object/.test(input)){process.exit(97);}',
      'const model=process.argv[process.argv.indexOf("--model")+1];',
      'console.log(JSON.stringify({type:"result",result:'+JSON.stringify(endings[1])+',stop_reason:"end_turn",model,modelUsage:{[model]:{inputTokens:10,outputTokens:5}},usage:{input_tokens:10,output_tokens:5}}));',
      '});'
    ].join('\n');
    fs.writeFileSync(path.join(bin,'claude'),fake,{mode:0o755});
    const env={...process.env,PATH:bin+path.delimiter+process.env.PATH,CLAUDE_PROVIDER:'cli',DRIFTPROOF_EVAL_USER:''};
    delete env.DRIFTPROOF_STUB;
    const stdout=cp.execFileSync(process.execPath,[path.join(__dirname,'../bin/driftproof'),'run',subject,'--models','haiku','--samples','1','--trusted-skill','--out',out],{env,encoding:'utf8',timeout:1800000});
    assert.match(stdout,/Comparison unreliable: at least 5% of an arm's replies ended in fake tool calls\./);
    assert.match(stdout,/Read, WebFetch and WebSearch only/);
    const captureLines=stdout.split('\n').filter(line=>line.includes('answer capture: text'));
    assert.equal(captureLines.length,2);
    for(const line of captureLines)assert.match(line,/Claude Code tools: Read, WebFetch and WebSearch only/);
    const receipt=JSON.parse(fs.readFileSync(path.join(out,fs.readdirSync(out).find(f=>f.endsWith('.json'))),'utf8'));
    assert.ok(validateReceipt(receipt).valid);assert.ok(verifyReceiptHash(receipt));
    for(const c of Object.values(receipt.results.fake_tool_calls))assert.equal(c.count,c.draws);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

// Issue 542: summaries describe the generating surface without changing the receipt.
test('AC-6 text summaries name Claude Code tools only on claude-cli',async()=>{
  reset();generate=()=>real;
  const {receipt}=await runSkillOnModel({skill:skillOf(),model:'haiku',opts:{samples:2,trusted:true}});
  const {captureLine}=require('../lib/capture');
  for(const surface of ['claude-cli','openai-cli','api','openai-api','stub','unknown',undefined]){
    const r=structuredClone(receipt);r.run.surface=surface;
    const sealed=sealReceipt(r),before=JSON.stringify(sealed);
    const line=captureLine(sealed.run.capture,surface);
    assert.match(line,/the reply is the answer/);
    assert.ok(summarizeReceipt(sealed).includes(line));
    if(surface==='claude-cli')assert.match(line,/Claude Code tools: Read, WebFetch and WebSearch only/);
    else assert.equal(line,'answer capture: text (the reply is the answer)');
    assert.equal(JSON.stringify(sealed),before);
    assert.ok(verifyReceiptHash(sealed));
    for(const mode of ['files','repository'])assert.equal(captureLine({mode},surface),captureLine({mode}));
  }
});
test('issue 542 current and served schema descriptions name v0.16 and its evidence',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../spec/receipt.schema.json'),'utf8');
  assert.equal(fs.readFileSync(path.join(__dirname,'../docs/spec/receipt.schema.json'),'utf8'),source);
  const schema=JSON.parse(source),description=schema.description;
  assert.match(description,/Receipt spec v0\.16:/);
  assert.match(description,/Every run writes v0\.16, a placebo run included/);
  assert.doesNotMatch(description,/Every run writes v0\.15/);
  for(const term of ['results.fake_tool_calls','count','draws','unmeasured','5%'])assert.ok(description.includes(term),term);
  assert.equal(schema.properties.schema_version.const,'0.16');
});
test('issue 542 interop derives its frozen range from the current schema version',()=>{
  const {PATCHES}=require('../scripts/build-site-pages');
  const html=fs.readFileSync(path.join(__dirname,'../docs/interop/index.html'),'utf8');
  const dir=fs.mkdtempSync(path.join('/var/tmp','issue542-interop-'));
  try{
    fs.mkdirSync(path.join(dir,'spec'));
    for(const [current,prior]of [['0.15','0.14'],['0.16','0.15']]){
      fs.writeFileSync(path.join(dir,'spec/receipt.schema.json'),JSON.stringify({properties:{schema_version:{const:current}}}));
      const out=PATCHES['interop/index.html'](html,dir);
      assert.ok(out.includes('receipt spec v'+current+';'));
      assert.ok(out.includes('Prior schema versions (v0.1 to v'+prior+','));
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
