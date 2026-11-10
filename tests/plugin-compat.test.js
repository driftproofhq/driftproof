// SPDX-License-Identifier: Apache-2.0
'use strict';
// Model-free compatibility checks available in both source and public trees.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
test('plugin registries and manifest agree on the runner version',()=>{
  const manifest=JSON.parse(read('plugin/driftproof/.claude-plugin/plugin.json'));
  const market=JSON.parse(read('.claude-plugin/marketplace.json'));
  assert.equal(manifest.name,'driftproof');
  assert.equal(manifest.version,JSON.parse(read('package.json')).version);
  assert.ok(market.plugins.some(p=>p.name===manifest.name));
});
test('every plugin command has a description and an executable steps block',()=>{
  const dir=path.join(root,'plugin/driftproof/commands');
  const files=fs.readdirSync(dir).filter(f=>f.endsWith('.md'));
  for(const required of ['init.md','run.md','badge.md','start.md','blind.md','compare.md','inspect.md','recheck.md']) assert.ok(files.includes(required));
  for(const file of files) {
    const text=fs.readFileSync(path.join(dir,file),'utf8');
    assert.match(text,/^---\n[\s\S]*?^description: *\S[\s\S]*?^---/m);
    assert.match(text,/```driftproof-steps\n[\s\S]*?\n```/);
  }
});
// Spec 727 AC-6: the plugin imports nothing from lib/, so its copies of the leak classes, the email rule,
// the bounds, the criterion id pattern and the failure label are held here to their one definition each.
test('727 AC-6: draft-contract.json agrees with lib/hygiene.js, config.js, lib/skill.js and lib/init.js',()=>{
  const contract=JSON.parse(read('plugin/driftproof/draft-contract.json'));
  const hygiene=require('../lib/hygiene');
  assert.deepEqual(contract.leak_classes,hygiene.PATTERNS.map(p=>({name:p.name,re:p.re.source,flags:p.re.flags})));
  assert.ok(contract.leak_classes.length>=5,'the classes are the repository\'s, not a short list');
  const src=read('lib/hygiene.js');
  const email=/text\.match\(\/(.*?)\/g\)/.exec(src);
  assert.ok(email,'the email rule is found in lib/hygiene.js');
  assert.equal(contract.email.re,email[1]);
  assert.deepEqual(contract.email.allow,[...hygiene.EMAIL_ALLOW].sort());
  assert.equal(contract.email.allow_suffix,'.example');
  assert.match(src,/endsWith\('\.example'\)/);
  const config=require('../config');
  const skill=require('../lib/skill');
  const skillSrc=read('lib/skill.js');
  const criteriaMax=/^const CRITERIA_MAX = (\d+);$/m.exec(skillSrc);
  assert.ok(criteriaMax,'CRITERIA_MAX is found in lib/skill.js');
  assert.deepEqual(contract.bounds,{CASE_MAX_CHARS:config.CASE_MAX_CHARS,SUITE_MAX_CASES:config.SUITE_MAX_CASES,SUITE_MAX_BYTES:skill.SUITE_MAX_BYTES,CRITERIA_MAX:Number(criteriaMax[1])});
  const idRe=/^const CRITERION_ID = \/(.*)\/;$/m.exec(skillSrc);
  assert.ok(idRe,'CRITERION_ID is found in lib/skill.js');
  assert.equal(contract.criterion_id,idRe[1]);
  assert.equal(contract.origin_label,require('../lib/init').FAILURE_LABEL);
  // The behaviour, not only the text: what the copy reads as a hit on a sample, the repository's scanner
  // reads as the same hit. The samples are built here, so no file carries them.
  const classes=contract.leak_classes.map(c=>({name:c.name,re:new RegExp(c.re,c.flags)}));
  const emailRe=new RegExp(contract.email.re,'g');
  const doorKinds=(text)=>{
    const out=classes.filter(c=>c.re.test(text)).map(c=>c.name);
    for(const e of text.match(emailRe)||[]){const dom=e.split('@')[1].toLowerCase();if(!contract.email.allow.includes(dom)&&!dom.endsWith(contract.email.allow_suffix))out.push('email');}
    return out.sort();
  };
  const samples=['jane@'+'example.net','ops@'+'example.com','a@b.example',['','home','jane','notes.md'].join('/'),'sk-ant-'+'a'.repeat(12),'ghp_'+'A'.repeat(24),'plain words about a commit'];
  for(const s of samples){
    const repo=hygiene.scanContent('draft.json',JSON.stringify({cases:[{prompt:s}]})).map(h=>h.kind).sort();
    assert.deepEqual(doorKinds(s),repo,JSON.stringify(s));
  }
});
test('plugin input contract agrees with every Action input rule',()=>{
  const lib=read('action/lib.sh');
  const rules=JSON.parse(read('plugin/driftproof/input-contract.json')).rules;
  const declared=[...lib.matchAll(/^(RE_[A-Z_]+)=/gm)].map(m=>m[1]).filter(n=>!['RE_VERDICT','RE_DELTA'].includes(n));
  const compared=[];
  for(const [name,rule] of Object.entries(rules)) if(rule.bash_name) {
    const match=new RegExp('^'+rule.bash_name+"='(.*)'$",'m').exec(lib);
    assert.ok(match,name); assert.equal(match[1],rule.re,name); compared.push(rule.bash_name);
  }
  assert.deepEqual(compared.sort(),declared.sort());
});
