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
  for(const required of ['init.md','run.md','badge.md','start.md']) assert.ok(files.includes(required));
  for(const file of files) {
    const text=fs.readFileSync(path.join(dir,file),'utf8');
    assert.match(text,/^---\n[\s\S]*?^description: *\S[\s\S]*?^---/m);
    assert.match(text,/```driftproof-steps\n[\s\S]*?\n```/);
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
