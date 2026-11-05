// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { HtmlValidate } = require('html-validate');
const B = require('../scripts/build-tasks');
const S = require('../scripts/sugar-pill-page');
const { STATE_WORDS } = require('../scripts/how-it-works');
const ROOT = path.join(__dirname, '..');
const skills = S.skillsOf();
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const suiteOf = m => JSON.parse(read('docs/skills/receipts/issue-408/suites/' + m.row.attempt.protocol.evals_sha256 + '.json'));
const planOf = m => JSON.parse(read('receipts/report-' + (m.report === '017' ? '017c' : '018') + '/plan.json'));
const decode = h => h.replace(/<[^>]*>/g, '').replace(/&(amp|lt|gt|quot|#39);/g, (_, k) => ({amp:'&',lt:'<',gt:'>',quot:'"','#39':"'"})[k]);
function expectedLine(m, task, kind) {
  const row = require('../scripts/prepare-report-' + m.report).rowHTML(m.row);
  const list = new RegExp('<ul class="' + kind + '-tasks">([\\s\\S]*?)</ul>').exec(row);
  if (!list) return null;
  const line = [...list[1].matchAll(/<li data-task="([^"]+)">([\s\S]*?)<\/li>/g)].find(x => x[1] === task);
  assert.ok(line);
  const text = decode(line[2]);
  return text.replace(/^([^\n]*?) \(([^)]+)\):/, (_, id, state) => {
    assert.ok(STATE_WORDS[state], state);
    return id + ' (' + STATE_WORDS[state] + '):';
  });
}
function expected(s) {
  const suite = suiteOf(s.measurements[0]);
  return {suite, measurements:s.measurements.map(m => ({
    report:m.report, samples:planOf(m).samples,
    caveats:JSON.parse(read('docs/data/report-summaries.json')).reports[m.report].points.filter(p=>p.lead !== 'What we found.').map(p=>p.lead+' '+p.text),
    router:m.router, handoff:m.row.handoffNote || null,
    qualification:planOf(m).routers.qualification,
    lines:suite.cases.map(t=>({id:t.id,fake:expectedLine(m,t.id,'placebo'),none:expectedLine(m,t.id,'verdict')}))
  }))};
}
async function oracle(page, s) {
  const e=expected(s);
  const got=await page.evaluate(()=>[...document.querySelectorAll('.task')].map(t=>({
    id:t.id, prompt:t.querySelector('[data-copy-source="prompt"]').textContent,
    rubric:t.querySelector('[data-copy-source="rubric"]').textContent,
    scope:t.querySelector('.task-scope').textContent,origin:t.querySelector('.task-origin').textContent,
    pass:t.querySelector('[data-pass]').textContent,
    reports:[...t.querySelectorAll('[data-report]')].map(r=>({
      report:r.dataset.report, fake:r.querySelector('.task-fake').textContent,
      none:r.querySelector('.task-none')?.textContent || null,
      caveats:[...r.querySelectorAll('.task-caveats li')].map(x=>x.textContent),
      samples:r.querySelector('[data-samples]').textContent,
      router:r.querySelector('.router-qualification')?.textContent || null,
      handoff:r.querySelector('.handoff-note')?.textContent || null
    }))
  })));
  assert.equal(got.length,e.suite.cases.length);
  got.forEach((t,i)=>{
    const c=e.suite.cases[i];
    assert.equal(t.id,c.id);assert.equal(t.prompt,c.prompt);assert.equal(t.rubric,c.rubric);
    assert.equal(t.scope,e.suite.scope);assert.equal(t.origin,c.origin);assert.equal(t.pass,String(c.pass_threshold));
    assert.equal(t.reports.length,e.measurements.length);
    t.reports.forEach((r,j)=>{
      const m=e.measurements[j];assert.equal(r.report,m.report);
      assert.equal(r.fake,m.lines[i].fake);assert.equal(r.none,m.lines[i].none);
      assert.deepEqual(r.caveats,m.caveats);assert.equal(r.samples,String(m.samples));
      assert.equal(r.handoff,m.handoff);
      if(m.router) assert.ok(r.router && r.router.includes("router"));
    });
  });
  // Every unquoted numeral must be from a reader, a bound figure, a model name or a report name.
  const own=await page.evaluate(()=>{
    const m=document.querySelector('main').cloneNode(true);
    m.querySelectorAll('[data-source-text], data, .task-fake, .task-none, .task-caveats, .task-description, .task-model, .task-repo').forEach(x=>x.remove());
    return m.textContent;
  });
  assert.doesNotMatch(own.replace(/Report 0(?:17|18)/g,''),/\d/,'unbound number');
}

test('suite byte and semantic bindings refuse one-byte substitutions and a different receipt suite',()=>{
  const m=skills[0].measurements[0];
  const bytes=Buffer.from(read('docs/skills/receipts/issue-408/suites/'+m.row.attempt.protocol.evals_sha256+'.json'));
  assert.ok(B.bindSuite(bytes,m));
  for(const key of ['prompt','rubric']) {
    const raw=JSON.parse(bytes);raw.cases[0][key]+='x';
    assert.throws(()=>B.bindSuite(Buffer.from(JSON.stringify(raw)),m),/SUITE_BINDING/);
  }
  const altered=structuredClone(m);altered.receipt.suite.suite_hash='0'.repeat(64);
  assert.throws(()=>B.bindSuite(bytes,altered),/SUITE_BINDING/);
});

test('all states emitted by the readers have imported plain words',()=>{
  const src=read('lib/verdict.js');
  const emitted=new Set([...src.matchAll(/(?:state:\s*|unheld\()'([^']+)'/g)].map(m=>m[1]));
  for(const m of src.matchAll(/state:\s*[^\n]+\? '([^']+)' : '([^']+)'/g)){emitted.add(m[1]);emitted.add(m[2]);}
  for(const state of emitted) assert.ok(STATE_WORDS[state],state);
  for(const [state,words] of Object.entries(STATE_WORDS)) assert.equal(B.translateLine('task ('+state+'): unchanged.'),'task ('+words+'): unchanged.');
  assert.throws(()=>B.translateLine('task (new-state): unchanged.'),/STATE_WORDS/);
});

test('all pages, independent source oracle, plants, HTML, copy and responsive browser',async()=>{
  const browser=await chromium.launch({headless:true});
  const server=http.createServer((req,res)=>{
    const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.includes('..')){res.writeHead(400).end();return;}
    const file=path.join(ROOT,'docs',pathname,pathname.endsWith('/')?'index.html':'');
    if(!fs.existsSync(file)){res.writeHead(404).end();return;}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  await context.route('https://**/*',r=>r.abort());
  const page=await context.newPage();
  const validate=new HtmlValidate(JSON.parse(read('.htmlvalidate.json')));
  try {
    for(const s of skills){
      const rel='tasks/'+s.repository+'/'+s.name+'/index.html';
      const html=read('docs/'+rel);
      const report=await validate.validateString(html);
      assert.ok(report.valid,rel+': '+JSON.stringify(report.results.flatMap(r=>r.messages)));
      await page.goto(origin+'/'+rel);
      await oracle(page,s);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow '+s.name);
      for(const a of await page.locator('main a[href^="/"]').evaluateAll(as=>as.map(a=>a.getAttribute('href')))){
        const dest=a.split('#')[0];assert.ok(fs.existsSync(path.join(ROOT,'docs',dest,dest.endsWith('/')?'index.html':'')),a);
      }
    }
    const s=skills.find(s=>s.name==='tdd');
    await page.goto(origin+'/tasks/'+s.repository+'/'+s.name+'/');
    const clean=await page.locator('main').innerHTML();
    for(const plant of ['prompt','rubric','line','scope','origin','caveat','number','raw-state']){
      await page.locator('main').evaluate((m,html)=>{m.innerHTML=html;},clean);
      await page.evaluate(p=>{
        const q=s=>document.querySelector(s);
        if(p==='prompt'||p==='rubric')q('[data-copy-source="'+p+'"]').append('x');
        if(p==='line')q('.task-fake').append('x');
        if(p==='scope')q('.task-scope').textContent='';
        if(p==='origin')q('.task-origin').textContent='';
        if(p==='caveat')[...document.querySelectorAll('[data-report="018"] .task-caveats li')].find(li=>li.textContent.startsWith("The judge is the target's model.")).remove();
        if(p==='number')q('main').append(' 93');
        if(p==='raw-state')q('.task-fake').textContent=q('.task-fake').textContent.replace(/\([^)]+\)/,'(separated-up)');
      },plant);
      await assert.rejects(()=>oracle(page,s),undefined,plant+' must read red');
    }
    await page.goto(origin+'/tasks/'+s.repository+'/'+s.name+'/');
    await page.evaluate(()=>{window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async t=>{window.copied.push(t);}},configurable:true});});
    for(const c of suiteOf(s.measurements[0]).cases){
      for(const kind of ['prompt','rubric']){
        const button=page.locator('#'+c.id+' [data-copy="'+kind+'"]');await button.focus();await page.keyboard.press('Enter');
        await page.waitForFunction(()=>document.querySelector('[role="status"]').textContent.includes('Copied'));
        assert.equal(await page.evaluate(()=>window.copied.at(-1)),c[kind]);
      }
    }
    await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{value:{writeText:async()=>{throw new Error('denied');}},configurable:true});});
    await page.locator('[data-copy="prompt"]').first().click();
    await page.waitForFunction(()=>document.querySelector('[role="status"]').textContent.includes('select'));
    await page.goto(origin+'/tasks/');
    assert.deepEqual(await page.locator('.task-index-card h2').allTextContents(),skills.map(s=>s.name));
    const indexValidation=await validate.validateString(read('docs/tasks/index.html'));assert.ok(indexValidation.valid,JSON.stringify(indexValidation.results));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.setViewportSize({width:1280,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    const nojs=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
    const fallback=await nojs.newPage();await fallback.goto(origin+'/tasks/'+s.repository+'/'+s.name+'/');
    assert.equal(await fallback.locator('.task').count(),suiteOf(s.measurements[0]).cases.length);
    assert.equal(await fallback.locator('[data-copy]:visible').count(),0);
    await nojs.close();
  } finally {await context.close();await browser.close();await new Promise(r=>server.close(r));}
});
