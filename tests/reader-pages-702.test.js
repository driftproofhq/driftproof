// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
const routes=['/sugar-pill/','/spot-the-fake/','/noticed/','/can-you-tell/'];
function doors(html) {
  const hero=html.slice(html.indexOf('id="hero"'),html.indexOf('</section>',html.indexOf('id="hero"')));
  for(const route of routes) assert.ok(hero.includes('href="'+route+'"'),route+' is in a home door');
  assert.match(hero,/latest reports/i);
}
test('home doors and qualified opening, with missing link plant',()=>{
  const html=read('docs/index.html');doors(html);
  assert.throws(()=>doors(html.replace('href="/sugar-pill/"','href="/missing/"')));
  assert.throws(()=>doors(html.replace(/latest reports/i,'every test')));
});
test('the whole trailing finding sentence survives',async()=>{
  const D=await import('../scripts/site-data.mjs');
  const n=JSON.parse(read('docs/data/stats.json')).latest_report_number.value;
  const html=read('docs/reports/'+n+'/index.html');
  const points=D.latestCaveats(n,html).map(p=>p.text).join(' ');
  const sentence='A skill that did not beat the fake is not shown to do no better than it.';
  assert.ok(points.includes(sentence));
  const home=read('docs/index.html');assert.ok(home.includes(sentence));
});
test('builder discovery includes every reader and the notes data builder',()=>{
  const B=require('../scripts/reader-pages');
  const found=B.pages().map(p=>p.href);for(const route of routes)assert.ok(found.includes(route));
  assert.equal(new Set(found).size,found.length,'no duplicate page identity');
  assert.ok(B.builders().some(b=>b.file==='build-judge-notes.js'));
  const scratch=fs.mkdtempSync('/var/tmp/reader-builder-702-');
  fs.writeFileSync(path.join(scratch,'new-page.js'),'// Site builder: '+JSON.stringify({href:'/new/',label:'New page'})+'\n');
  assert.equal(B.pages(scratch)[0].href,'/new/');
});
test('all discovery surfaces link every reader page',()=>{
  for(const file of ['docs/llms.txt','docs/llms-full.txt','docs/sitemap-pages.xml','docs/data/page-dates.json','docs/maintainer/index.html','docs/what-is-driftproof/index.html','README.md']) {
    const text=read(file);for(const route of routes) assert.ok(text.includes(file.endsWith('page-dates.json')?route.slice(1)+'index.html':route),file+' misses '+route);
  }
});
test('picker words respond to counts and refuse mixed task sets',()=>{
  const B=require('../scripts/sugar-pill-page');
  const skills=Array.from({length:7},()=>({measurements:[{tasks:[{},{}]}]}));
  const words=B.introOf(skills);assert.match(words.lede,/Seven popular skills/);assert.match(words.how,/two text tasks/);
  skills[0].measurements[0].tasks.push({});assert.throws(()=>B.introOf(skills),/TASK_COUNTS/);
});

test('discovered builder checks fail on stale and missing output and regeneration repairs it',()=>{
  const B=require('../scripts/reader-pages');
  const scratch=fs.mkdtempSync('/var/tmp/reader-stale-702-');
  fs.writeFileSync(path.join(scratch,'fixture.js'),'// Site builder: {}\nconst fs=require("node:fs"),p=require("node:path").join(__dirname,"page.html");if(process.argv.includes("--check")){if(!fs.existsSync(p)||fs.readFileSync(p,"utf8")!=="current")process.exitCode=1;}else fs.writeFileSync(p,"current");\n');
  assert.throws(()=>B.run(true,scratch));B.run(false,scratch);B.run(true,scratch);
  fs.writeFileSync(path.join(scratch,'page.html'),'stale');assert.throws(()=>B.run(true,scratch));
  assert.equal(fs.readFileSync(path.join(scratch,'page.html'),'utf8'),'stale','check never repairs its own subject');
  B.run(false,scratch);B.run(true,scratch);
});

test('browser: safe shared answers, focused deck keys and both viewport captures',{timeout:300000},async()=>{
  const http=require('node:http'),{chromium}=require('playwright');
  const shots=fs.mkdtempSync('/var/tmp/reader-shots-702-');
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');let file=path.join(root,'docs',decodeURIComponent(url.pathname));
    if(!file.startsWith(path.join(root,'docs')+path.sep)){res.writeHead(403).end();return;}
    try {if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));}catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try {
    browser=await chromium.launch({headless:true,args:['--no-sandbox']});
    for(const width of [1280,390]) {
      const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'});
      await context.route('https://**/*',r=>r.abort());const page=await context.newPage(),errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      for(const [route,name] of [['/','home'],['/sugar-pill/','sugar-pill'],['/noticed/','noticed'],['/reports/018/','judge-notes']]) {
        await page.goto('http://127.0.0.1:'+server.address().port+route);await page.evaluate(()=>document.fonts.ready);
        if(name==='noticed') {
          await page.waitForSelector('.is-deck');
          const count=()=>page.locator('[data-deck-count]').first().textContent();
          const first=await count();await page.locator('h1').evaluate(e=>{e.tabIndex=-1;e.focus();});await page.keyboard.press('ArrowRight');assert.equal(await count(),first);
          const card=page.locator('article[data-card]:not([hidden])');await card.focus();await page.keyboard.press('ArrowRight');assert.notEqual(await count(),first);
          const second=await count();for(const sel of ['a','summary']){const target=page.locator('article[data-card]:not([hidden])').locator(sel).first();if(await target.count()){await target.focus();await page.keyboard.press('ArrowLeft');assert.equal(await count(),second);}}
          await page.locator('article[data-card]:not([hidden])').focus();await page.keyboard.press('ArrowLeft');assert.equal(await count(),first);
          await page.locator('[data-deck-nav]').first().scrollIntoViewIfNeeded();
        }
        if(name==='judge-notes') {
          const row=page.locator('section.placebo-result').filter({has:page.locator('.judge-notes')}).first();
          await row.locator(':scope > details.placebo-row > summary').click();
          assert.equal(await row.locator('details.send-preview[open]').count(),0,'the result disclosure opens independently of sharing');
          await row.locator('.judge-notes button.judge-open').first().click();await page.waitForSelector('.judge-panel');
          await page.locator('.judge-arms').evaluate(e => window.scrollTo(0,e.getBoundingClientRect().top+window.scrollY-16));
          const formats=await page.evaluate(async()=>{
            const shared=await import('/islands/judge-notes.js'),game=await import('/islands/can-you-tell.js');
            const source='# Heading\n\nA **whole** sentence.\n\n- First\n- Last\n\n<img src=x onerror=alert(1)> [go](javascript:alert(1)) &lt;script&gt;';
            const box=document.createElement('div');box.innerHTML=shared.renderAnswer(source);
            return {same:game.renderAnswer===shared.renderAnswer,tags:[...box.querySelectorAll('*')].map(e=>e.tagName),text:box.textContent,html:box.innerHTML};
          });
          assert.equal(formats.same,true);assert.deepEqual(formats.tags,['H4','P','STRONG','UL','LI','LI','P']);
          for(const text of ['Heading','A whole sentence.','First','Last','<img src=x onerror=alert(1)>','[go](javascript:alert(1))','&lt;script&gt;'])assert.ok(formats.text.includes(text),text);
          assert.equal(await page.locator('.judge-answer a,.judge-answer img,.judge-answer script').count(),0);
          const fonts=await page.locator('.judge-answer').first().evaluate(e=>getComputedStyle(e).fontFamily);assert.doesNotMatch(fonts,/Courier|monospace/i);
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,name+' fits '+width);
        if(name==='home') await page.locator('#hero').screenshot({path:path.join(shots,name+'-'+width+'.png')});
        else await page.screenshot({path:path.join(shots,name+'-'+width+'.png'),fullPage:false});
      }
      assert.deepEqual(errors,[]);await context.close();
    }
  } finally {if(browser)await browser.close();await new Promise(r=>server.close(r));}
  console.log('Reader screenshots: '+shots);
});
