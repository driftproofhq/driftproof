// SPDX-License-Identifier: Apache-2.0
'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {scanContent}=require(process.cwd()+'/lib/hygiene');
const emailHits=(file,text)=>scanContent(file,text).filter(h=>h.kind==='email');
test('JSON newline escapes do not turn Python decorators into emails',()=>{
 const code='\n'+'@pytest'+'.fixture\ndef connection():\n    pass\n';
 assert.equal(emailHits('receipt.json',JSON.stringify({tool:{content:code}})).length,0);
 assert.equal(emailHits('receipt.json',JSON.stringify({tool:{content:'\n'+'@unittest'+'.skipUnless(flag)'}})).length,0);
});
test('JSON strings and keys retain detection of real and Unicode-escaped emails',()=>{
 const address='reader'+'@'+'private.test';
 for(const value of [address,{contact:address},[null,{nested:[address]}],{[address]:'key'}])assert.ok(emailHits('receipt.json',JSON.stringify(value)).length>0);
 const escaped='{"contact":"'+[...address].map(c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')).join('')+'"}';
 assert.equal(emailHits('receipt.json',escaped).length,1);
 // A real single-letter address remains an address even on a decorator-like domain.
 assert.equal(emailHits('receipt.json',JSON.stringify('n'+'@pytest'+'.fixture')).length,1);
});
test('malformed JSON and ordinary text keep the raw email scan',()=>{
 const address='reader'+'@'+'private.test';
 assert.equal(emailHits('receipt.json','{"contact":'+address).length,1);
 assert.equal(emailHits('notes.txt',address).length,1);
});
