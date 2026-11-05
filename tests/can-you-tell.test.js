// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { sha256 } = require('../lib/canonical');
const { validateReceipt, verifyReceiptHash } = require('../lib/receipt');
const { suiteIdentity } = require('../lib/skill');
const { placeboReading } = require('../lib/verdict');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const json = p => JSON.parse(read(p));
const words = { ABOVE_PLACEBO: 'beat the fake', BELOW_PLACEBO: 'below the fake', NO_DIFFERENCE: 'no difference', INCONCLUSIVE: 'inconclusive', UNDERPOWERED: 'too few answers to tell', NOT_MEASURED: 'not measured' };
function payload(html) {
  const m = /data-game-source="([A-Za-z0-9+/=]+)"/.exec(html);
  assert.ok(m, 'embedded data exists');
  return JSON.parse(require('node:zlib').gunzipSync(Buffer.from(m[1], 'base64')).toString('utf8'));
}
function oracle(data) {
  assert.equal(data.entries.length, 40);
  for (const e of data.entries) {
    const r = json(e.receipt), archive = json(e.answers), suite = suiteIdentity(json(e.suite));
    assert.ok(validateReceipt(r).valid && verifyReceiptHash(r));
    assert.equal(archive.receipt_hash, r.receipt_hash);
    assert.equal(suite.suiteHash, r.suite.suite_hash);
    assert.equal(e.skill, r.skill.name);
    assert.equal(e.reading, words[placeboReading(r).reading]);
    assert.ok(e.scope.includes('Beating the fake is not beating no skill.'));
    assert.ok(e.scope.includes('text tasks'));
    if (r.run.model_id === r.run.judge.model_id) assert.match(e.scope, /same model.*Self-grading may favor/);
    for (const [mode, arms] of [['skill', ['with_skill','placebo']], ['twist', ['placebo','baseline']]]) {
      const expected = [];
      for (const row of r.results.cases.filter(c => c.mode === arms[0])) {
        const other = r.results.cases.find(c => c.mode === arms[1] && c.id === row.id);
        for (const d of row.generation.draws) {
          const b = other?.generation.draws.find(x => x.draw_index === d.draw_index);
          if (d.status !== 'measured' || b?.status !== 'measured') continue;
          const aText = archive.answers[d.generation_hash], bText = archive.answers[b.generation_hash];
          if (typeof aText !== 'string' || typeof bText !== 'string' || sha256(aText) !== d.generation_hash || sha256(bText) !== b.generation_hash) continue;
          expected.push({id:row.id, draw:d.draw_index, prompt:suite.cases.find(c => c.id === row.id).prompt, target:aText, other:bText});
        }
      }
      assert.deepEqual(e.games[mode].pairs, expected);
      assert.equal(e.games[mode].count, expected.length);
      assert.equal(e.games[mode].tasks, new Set(expected.map(p => p.id)).size);
      assert.ok(e.games[mode].cues.includes('not proof'));
    }
  }
}
test('all report choices, verified pairs, readings and caveats agree with receipts', () => {
  oracle(payload(read('docs/can-you-tell/index.html')));
});
test('plants: wrong reading, missing caveat and hand-typed count read red', () => {
  const good = payload(read('docs/can-you-tell/index.html'));
  for (const mutate of [d => {d.entries[0].reading = 'invented result';}, d => {d.entries.find(e => e.report === '018').scope = 'text tasks. Beating the fake is not beating no skill.';}, d => {d.entries[0].games.skill.count = 999;}]) {
    const bad = structuredClone(good); mutate(bad); assert.throws(() => oracle(bad));
  }
});
test('builder refuses broken bindings and derives cues from either arm', () => {
  const b = require('../scripts/build-can-you-tell');
  const e = payload(read('docs/can-you-tell/index.html')).entries[0];
  const r = json(e.receipt), a = json(e.answers), s = json(e.suite);
  for (const mutate of [(r,a,s) => {r.skill.name += 'bad';}, (r,a,s) => {a.receipt_hash = 'bad';}, (r,a,s) => {s.cases[0].prompt += 'bad';}]) {
    const rr=structuredClone(r), aa=structuredClone(a), ss=structuredClone(s); mutate(rr,aa,ss);
    assert.throws(() => b.pairsFor(rr,aa,ss,'skill'));
  }
  const broken=structuredClone(a); for(const k of Object.keys(broken.answers)) broken.answers[k]+='bad';
  assert.throws(() => b.pairsFor(r,broken,s,'skill'));
  assert.match(b.cuesFor([{target:'Suggested skills: abc',other:'x'}], 'skill'), /skill.*Suggested skills/);
  assert.match(b.cuesFor([{target:'x',other:'Suggested skills: abc'}], 'skill'), /fake.*Suggested skills/);
  assert.match(b.cuesFor([{target:'I did not save the file.',other:'x'}], 'skill'), /did not save/);
  b.check();
});

test('phone and desktop: keyboard play, twist, reveal, reset, no pick traffic', async () => {
  const http = require('node:http');
  const { chromium } = require('playwright');
  const server = http.createServer((req,res) => {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const file = path.join(root,'docs',pathname.endsWith('/') ? pathname+'index.html' : pathname);
    if (!file.startsWith(path.join(root,'docs') + path.sep)) {res.writeHead(403).end(); return;}
    try {res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(fs.readFileSync(file));} catch {res.writeHead(404).end();}
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await chromium.launch({headless:true,args:['--no-sandbox']});
  try {
    for (const width of [1280,390]) {
      const context = await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      await context.route('https://**/*', route => route.abort());
      const page = await context.newPage(), errors=[];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('http://127.0.0.1:'+server.address().port+'/can-you-tell/');
      await page.waitForSelector('[data-pick="A"]');
      assert.equal(await page.locator('#game-skill option').count(),20);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      // A-693-2: exercise the same renderer with deliberately hostile Markdown.
      const formatted = await page.evaluate(async () => {
        const { renderAnswer } = await import('/islands/can-you-tell.js');
        const source = '# Heading\n\nA **bold** and *italic* paragraph with \u0060inline <tag>\u0060.\n\n- First\n- Second\n\n1. Ordered\n2. Again\n\n\u0060\u0060\u0060html\n<img src=x onerror=alert(1)> **literal**\n\u0060\u0060\u0060\n\n    indented <code>\n\n<img src=x onerror=alert(1)> <script>alert(1)</script> &lt;svg onload=alert(1)&gt; [go](javascript:alert(1)) ![image](https://example.invalid/pixel) https://example.invalid/';
        const box = document.createElement('div');box.innerHTML=renderAnswer(source);box.className='tell-answer';document.querySelector('.tell-card').appendChild(box);
        const codeFont=getComputedStyle(box.querySelector('pre code')).fontFamily;box.remove();
        return {codeFont,html:box.innerHTML,text:box.textContent,tags:[...box.querySelectorAll('*')].map(n=>n.tagName),attributes:[...box.querySelectorAll('*')].flatMap(n=>[...n.attributes].map(a=>a.name)),code:[...box.querySelectorAll('pre code')].map(n=>n.textContent)};
      });
      for (const tag of ['H4','STRONG','EM','UL','OL','LI','P','PRE','CODE']) assert.ok(formatted.tags.includes(tag), tag+' is formatted');
      assert.ok(formatted.tags.every(t => ['H4','H5','H6','STRONG','EM','UL','OL','LI','P','PRE','CODE'].includes(t)));
      assert.deepEqual(formatted.attributes, []);
      assert.match(formatted.codeFont,/Courier Prime/);
      assert.ok(formatted.text.includes('<img src=x onerror=alert(1)>'));
      assert.ok(formatted.text.includes('&lt;svg onload=alert(1)&gt;'));
      assert.equal(formatted.code[0], '<img src=x onerror=alert(1)> **literal**');
      assert.equal(formatted.code[1], 'indented <code>');
      const pair=payload(read('docs/can-you-tell/index.html')).entries.find(e=>e.skill==='handoff'&&e.report==='017').games.skill.pairs[0];
      const presentation=await page.evaluate(async pair=>{
        const {renderAnswer}=await import('/islands/can-you-tell.js');
        const panes=[...document.querySelectorAll('[data-answer]')];
        const normalized=text=>{const box=document.createElement('div');box.innerHTML=renderAnswer(text);return box.innerHTML;};
        return {expected:[normalized(pair.target),normalized(pair.other)].sort(),actual:panes.map(p=>p.innerHTML).sort(),fonts:panes.map(p=>getComputedStyle(p).fontFamily)};
      },pair);
      assert.deepEqual(presentation.actual,presentation.expected,'both arms use the same formatting');
      assert.equal(presentation.fonts[0],presentation.fonts[1]);
      assert.equal(require('../scripts/build-head-tags').render(read('docs/can-you-tell/index.html'),'can-you-tell/index.html'),read('docs/can-you-tell/index.html'));
      assert.equal(await page.locator('.page-toc').count(),0);
      const full=q => q.evaluateAll(nodes=>nodes.every(n=>n.scrollHeight<=n.clientHeight+1));
      const answers=page.locator('[data-answer]');
      await page.locator('[data-expand]').focus();await page.keyboard.press('Space');
      assert.equal(await page.locator('[data-expand]').getAttribute('aria-expanded'),'true');
      assert.equal(await full(answers),true);
      const font=await answers.first().evaluate(n=>getComputedStyle(n).fontFamily);
      assert.match(font,/Alegreya Sans/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
      await page.locator('[data-next]').click();
      assert.equal(await page.locator('[data-expand]').getAttribute('aria-expanded'),'false');
      await page.locator('[data-prev]').click();await page.locator('[data-expand]').click();
      const requests=[];page.on('request',r => requests.push(r.url()));
      await page.locator('[data-pick="A"]').focus(); await page.keyboard.press('Space');
      assert.equal(await page.locator('[data-expand]').getAttribute('aria-expanded'),'true');
      await page.locator('[data-reveal]').click();
      assert.equal(await full(answers),true);
      assert.match(await page.locator('[data-result]').innerText(), /1 pick/);
      assert.equal(await page.locator('[data-pick="A"]').isDisabled(),true);
      await page.locator('#game-model').selectOption('018');
      assert.match(await page.locator('[data-scope]').innerText(), /same model/);
      await page.locator('#game-mode').selectOption('twist');
      assert.match(await page.locator('[data-question]').innerText(), /fake/);
      assert.equal(await page.locator('[data-result]').isVisible(),false);
      await page.locator('[data-reveal]').click();
      assert.match(await page.locator('[data-result]').innerText(), /0 picks/);
      await page.locator('[data-again]').click();
      assert.equal(await page.locator('[data-pick="A"]').isDisabled(),false);
      await page.locator('[data-surprise]').click();
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length),0);
      assert.equal(requests.length,0);
      assert.deepEqual(errors,[]);
      await page.locator('#game-skill').selectOption('handoff');
      await page.locator('#game-mode').selectOption('skill');
      await context.close();
    }
  } finally {await browser.close(); await new Promise(resolve => server.close(resolve));}
});
