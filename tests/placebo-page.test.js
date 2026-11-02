// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { createHash, webcrypto } = require('node:crypto');
const P = require('../lib/placebo');
const { sha256Files } = require('../lib/canonical');
const ROOT = path.resolve(__dirname, '..');
// Screenshots go to a fresh directory, never a fixed path another account may own.
const shots = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'placebo-page-shots-'));
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = async bytes => new Uint8Array(await webcrypto.subtle.digest('SHA-256', bytes));
const encode = text => new TextEncoder().encode(text);
const vectors = [{"length":92904,"seed":"3d816ae758f0eb09e4002d6107fad41e05bb2bbe2a6f598b719659f5f6ce8c39","sha256":"0639f410c32f9571361c6502de78fc7454b5e65238a042d3a58cbe78c2a5e773"},{"length":188145,"seed":"dd4adef0313cc67a7be55f923f3a417b93bfdfdf006179b64a19ffca085d3c53","sha256":"b9d1b42b6fc5d8336bd433d550d4ac8a3d5a1c561d8e4d096213c85944b464ae"},{"length":24795,"seed":"e61460dafa1a9016827ce94b55e4eb7ac336687609771138fd34181712601507","sha256":"63d8cf7a0b8ce081316dcc47e7108bb823885b869ff6ad7239895a36b7844b48"},{"length":180298,"seed":"a6f2c0491d2bde6657350ba3e1e53a11b72127ff9cb8b9a63d4de160a8e1913c","sha256":"a2101a97f49263b8d2a97cdb6ca19ab24278428103897f44b02216beea77512e"},{"length":28130,"seed":"09886de14cebe4e03694a9a074f276deee5d18b29b3f29fe80bc9616664545d0","sha256":"f87d4743ba30792fd4b95fdd18cb1f554128bc09e78949f2c409d1adcf636294"},{"length":196306,"seed":"fccafed1c7b16e43d907bccc1e7972f008fcdfeb78221b0e47210c4b0a5699d5","sha256":"ecde153f22c0e09237d6fa0234fc3a287aab2585722cc2725510970b0189ac33"},{"length":34425,"seed":"f89c8678a28ef2f79bf8e6c97c0b9833b298e3bebbfe363bf8d3857fd1b15695","sha256":"031aa003c5b2577cce8a4351c07d48a5a5fd737aa9f49cafa5d75567ddb62313"},{"length":255885,"seed":"fd03e78c779db1d6e3cdffa80af007a9ea2dbe0b83b5df20b349a24e123db4e8","sha256":"4768706cb9c98a87d05e246e8627732d007ff935ee54e7e92654b9674494322e"},{"length":247543,"seed":"5933c6f6c39ed45b2e574f7cd11fb39a1fbbb4427c5208906145d3c9bb5b78db","sha256":"873e989f4bc2617c260335ad2052247c4bf1b325c2ad10819836c440b6d9347e"},{"length":118920,"seed":"ad85d08763b175fa3e69b99a4799cc798dcb0be5e028b9b192a0ec04c55aaa78","sha256":"ccf04b975b191ab8105ba7b903ab81f1d9c255f577fe45c879a4da2751bf3dc7"},{"length":168421,"seed":"1a5291e4cfb70338351a0bec6e0e44db505a32b25486eef1964009df9c28d884","sha256":"cd78fb7593159112256f6929381ab53bc56075a4c0a5cff09c949562d635461f"},{"length":101757,"seed":"1bb98d7c24fb762dd4a354c18ceecce8990af1456d5bfabad5b469c8d97b9fd0","sha256":"77f6d74af5670d9c200fe3e249f50be15b27f1141ee18c7fbc5d6f5f916a644a"},{"length":934,"seed":"104c03a5bb7dcc7d93ac0130a1121694a3194380c91e0015d196edd14b8c41a2","sha256":"02bf3ac9039493e4a0aa1d8adc7c9368ee979c0d4b5896d23c8c5fe2b918a7ac"},{"length":130651,"seed":"0d0dfe5a33066f33068bb6846f71731737a3f19672deace601db4f2731316f67","sha256":"121299455ed98d2afb593310fc84d8a7331b0e6868b4e98354ff1eb8ce88171a"},{"length":177796,"seed":"2dd2b68357d225085a5b6965dea513ebe6443511be81a31360ffcd8808f1ab24","sha256":"13aaf1b48d30485e153d502779c49d9eacc0e482ec32377b71a78b884fbb613a"},{"length":142487,"seed":"06a62c96ebcc1a0212a9326a80085f0c88b44de39e73f2126274ce02d0a66bee","sha256":"6e10365c5144cef99e113d2b21423b2270e6f40190191f7d001e422c32d40bff"},{"length":16154,"seed":"1f983f19a8a88d20909077aeba79e2f347896cef0df8837a53e30e080b1ec3bb","sha256":"af5dfd585a72f1c0ff113b9a15283ed9e9c94ef76a020500257906a29b28dc05"},{"length":117515,"seed":"2a89cb0a47517f0f392cb165a0ee6772843b740d3a5564e931bf99a2e63be637","sha256":"9b0d3dfed238bd380ebad0a26e10361d9e06629c47f13cc951a97ba1c43bac1a"},{"length":253926,"seed":"1d17dfe5ed2bd628a3fd67654eefc2142bce4a90ccb098b1f6efd951fc458a1f","sha256":"84e3e4160d2337aec854fbdbe95c6a91706064558db34aa5d9187db60defca2b"},{"length":101603,"seed":"bd498ce29853576c49789825cf0bbd0b1c386b23e25dd94a9ad8701d58a03f8c","sha256":"3c8e48b6c835c49df70662225e751ff06b36ffa4ed4eafdd00803be3f4fd6805"},{"length":141262,"seed":"b38627cd99f5e4bf76f5ba4955434e40353d3cfca754afbd9ae72884811d20e6","sha256":"a8f7d0abdc2155432c01636c73d45682d0674a3cc63f50e1e157f128003148aa"},{"length":77566,"seed":"6ffd2efd678926043ace178caaa22e88d56b1aa6c4b105081ef5be9f909ce5b4","sha256":"ed5e0ca2a25cf668eeb96d9ecfd6b69d3e2d9296055e46aae6e9d4d4a297d7f4"},{"length":75792,"seed":"5901280fa5c992ee08cdb846afef69b4207547bf5d6710b6c48a91049f0dcee4","sha256":"603097389a8fdc081bc1c0602bd8c95bf75d893a04a28892cb372ae14a78f6b8"},{"length":193990,"seed":"18aaf5c5b5a65e8dc22d7073f06a51d0cab4998dabc40197881a6de593ae5a01","sha256":"187fe6c75ad5561bad2a77a025a88befa23479435afd49d254740f110c102d48"},{"length":151207,"seed":"40ea4ea6d8c504a863df1877db08f3054e4854cabf732a9ef9f5bb3e12b3c082","sha256":"f84c87968b4e97e008829e272f0a1947b0873fba2b6c75ce2f6fd7d7079d95f0"},{"length":150415,"seed":"82624b8ef118d86818308df9f3a8bd837151e7a16bd9a904353ffb430d85ba01","sha256":"4009ea81417707064960191e729ae7a746b616082658a9eff492e80910e547a8"},{"length":151096,"seed":"cb324e3758fce828c18a2454a66024831d93e3d541840385b860023b4f3388ad","sha256":"ecff26f983c7a986b0f99dc58e8de7875aa4648875e9819ed1a716fab516a125"},{"length":231294,"seed":"0853877df23af4fcf717b091923f9608d9cc63efba3e8bf74bb78d851c7685b2","sha256":"2cd1d72540892266d5735080e2c48d30761618929573dd9004c3232552e8a603"},{"length":234818,"seed":"cb23954198a644644c52fd1cd59144cabeb132215daa626ef223fe85ef0553ab","sha256":"d3c38a2a3f5e25205547083424637bc3f00008dd01ddf2fe9808433e3567254c"},{"length":222582,"seed":"f1736575738ed12b2085fdbc6e77b22080fdedb5da3b89931596428f4ec2de61","sha256":"2ca45711b5220782a0a28c417faa836670079c41e67db2739342a4b46b8ba069"},{"length":196590,"seed":"23aaffedb2cccc571c61fa7288b6a22f2d49b1bfb75a8d0031d2c882ca648a83","sha256":"6716a8e7212c0ad555aa96ca89784738272278fb0dca2e47151aaadc03a32046"},{"length":62798,"seed":"9bc0f54d344783459f268a887e8eacec5609dd5d46425788c079a39fcc83be5b","sha256":"8412f7ef2e407c52c0be763cf31f7281b0d2e540baa435ce14af26a9046fabfc"},{"length":210221,"seed":"68b7352c09f9b39f3b6c5fe575223665c241dbe870ac385e60b3dfe09fd7fd9f","sha256":"8aebb3b4bd10e5cecc4ee6f9329ffa7e27eaec602e18abbbf49c94429ca16f03"},{"length":48115,"seed":"842cbbf2f9bf8c14d0c7c98a3c73803b9fcf082a8c6f98001ed6a6213002aed0","sha256":"12b24d2444fbe6d07a87afe2e325e2b02de13a39f3eb4423f81edfa4206edc03"},{"length":70437,"seed":"b5b913246335a6ee88a53a77c23471bd57563ad9002b9d60fcf31262857c839c","sha256":"976b61da92a334a2cd8bd315f14e3809172f9211ac68e962776910d1ac817126"},{"length":244491,"seed":"ed2bbb0ac0363d92edc2ce9fcced6b8a244792f659fbb3a1305d76fe338131a3","sha256":"ec1954132fdf897976510e6fdc79a769bd4d201e09279b42c9af51aadb106e44"},{"length":240184,"seed":"891faa37975683544aabc9967aaa970adc44b9f78336a545105e3f93014abb7a","sha256":"857e1ab3828a600da74cdf2f6ad4a9e27e26c8375a35268f90dcfdc96005e73d"},{"length":85992,"seed":"b1054fe7cb571ae7cfe43e3d75dd50817452461b8d2dbe15cb13f66f63a70fcd","sha256":"05f66d5ca0e084278641c1c89186a540515ae85b8be8856240e6e7ca2b1fbd77"},{"length":185833,"seed":"01aad5e8a9a3ea7545103ac6ca01a2be7c410e136ea4f01f2c147ce86bbe4aa4","sha256":"44a9911fbea23cb361fe965ddc1281406be079ed02b3b0b4cca46baab866943f"},{"length":189120,"seed":"a386e2bf02744e872977ebbc93bd38893effd9b7d9e74350b5559f8a2d1fdb5a","sha256":"6fcf12273b702b688ec1300fb7f77a3c1ab6245366d49936e25b0fa321cb9e09"},{"length":141542,"seed":"c48a28e59a81bb68cfc57577e0d162529eaed1e1eda3f26b8a51c7792c0a41a1","sha256":"834a0bb80255def7ba2ae2c6d0a3c44df04e65773a1646b8dc1f266160c04163"},{"length":255231,"seed":"e28fe4fe55deaead6344333a56521f1d37f09025fe18c1b094ecf8b12eba0972","sha256":"3a8f6eec14b7fcbaa74334ba62c10915318595cce2354909b499d89c413ae538"},{"length":117014,"seed":"c9edc9153bb66025a262afac6b53226b99718ad400a072c2de43c4e56742074f","sha256":"5c30692cad6733cf477fba4393af771021a95f72bd2981860816aaeb16f07a8a"},{"length":183976,"seed":"14aacea7666dc6dcbc188873ed35095e80b86eb74b67cc4a0d6d76a9f355fd15","sha256":"bac41989918b6004611cc48b8a40cb139d70ab06594d972f99b17613addcf544"},{"length":162289,"seed":"33ee79f0346e005d5349bd5409021c47dc3aff4bf4346158a005e4b1c07e7959","sha256":"26727b680590205863da0c7483728462b93e37daf8a63f65c0e88321baf913f0"},{"length":224858,"seed":"fa476e591771fe9bc4103e19fe414fcc35080692c7c2a2cecbbdcee99e78ff6c","sha256":"725466c79347e5afa1e69e05a479772ca9ce5ca5147c77a888b66c892468875b"},{"length":94204,"seed":"254d6ffb13f50ce39c4f657eeec932106f35f6051c6c1c93083d430462e93fbe","sha256":"48f313b2fcc2dcb3cdea92f1dc82acb12ba943c197cc34a5b7af0cba732be588"},{"length":88990,"seed":"19295b9d8685103491adfe1492e9560f12c22251dd8b3b28bf881f120119a808","sha256":"21792e848e0ef9a1beb1ddfb31f139a116285cc1ed2d108b345dfb3a6baf4fa5"},{"length":20110,"seed":"249c4e8dc248f08e903e218ed68bd7afa238a1970c106cd2aa29710f43eb5992","sha256":"a0ed7d1019934e8ff1694b0d95f692bbee1d159264337f6a4fea38dfc27c9f3f"},{"length":150402,"seed":"54ca4b815dbc12fddd73a51b5e0ee658be03ecd907118532002f45034abc7e81","sha256":"cd88576dd9957833c7efa3d42311f08549f1043da7d1001dfb78bb9d5312c795"}];
let modulePromise;
function island() {
  return modulePromise ||= import('data:text/javascript;base64,' + Buffer.from(read('docs/islands/placebo.js')
    .replace("'../import-core/placebo.mjs'", JSON.stringify(pathToFileURL(path.join(ROOT, 'docs/import-core/placebo.mjs')).href))).toString('base64'));
}
const receipt = JSON.parse(read('receipts/report-016/receipt-15f01115639f.json'));
const subject = fs.readdirSync(path.join(ROOT, 'receipts/report-016/subjects')).map(name => fs.readFileSync(path.join(ROOT, 'receipts/report-016/subjects', name))).find(bytes => hash(bytes) === receipt.placebo.seed);
const fake = 'The morning light settled slowly over the hills beyond the old market town. The ferry crosses the sound twice a day when the weather is calm enough. On clear nights the stars over the moor are bright enough to cast faint shadows. The museum displays a loom that weavers in the district used for linen and wool.\n\nFishing boats leave before dawn and retu';

test('AC-1 Report 016 sealed identity and fixed text', async () => {
  assert.ok(subject);
  const result = await (await island()).buildFake(subject, 'context', digest);
  assert.equal(result.text, fake);
  assert.equal(result.bytes, 352);
  assert.equal(hash(result.text), receipt.placebo.sha256);
  assert.equal(result.sha256, receipt.placebo.sha256);
  assert.equal(result.corpusHash, receipt.placebo.corpus_hash);
  assert.equal(result.seed, receipt.skill.content_hash);
  assert.notEqual(hash(result.text + 'x'), receipt.placebo.sha256, 'altered text fails the identity oracle');
});

test('AC-1 fifty random lengths and seeds equal pre-refactor vectors and Node placeboFor', async () => {
  const { createPlaceboCore, PLACEBO_CORPORA, PLACEBO_CORPUS_HASHES } = await import('../lib/import-core/placebo.mjs');
  const core = createPlaceboCore(digest);
  assert.deepEqual(PLACEBO_CORPORA, P.PLACEBO_CORPORA);
  assert.equal(hash(JSON.stringify(PLACEBO_CORPORA[1])), PLACEBO_CORPUS_HASHES[1]);
  for (const v of vectors) {
    const text = await core.buildPlaceboTextAsync(v.length, v.seed);
    assert.equal(text, P.placeboFor({skillText: 'x'.repeat(v.length), seed: v.seed}).text);
    assert.equal(hash(text), v.sha256);
    assert.equal(Buffer.byteLength(text), v.length);
  }
});

test('AC-1 both seed modes preserve BOM, CRLF and Unicode bytes', async () => {
  const { buildFake } = await island();
  for (const text of ['x', '\ufeff# File\r\né字😀\r\n', 'x'.repeat(262144)]) {
    const bytes = encode(text);
    for (const mode of ['context', 'skill']) {
      const seed = mode === 'context' ? hash(bytes) : sha256Files([{path:'SKILL.md', bytes}]);
      const got = await buildFake(bytes, mode, digest);
      assert.deepEqual({text:got.text,bytes:got.bytes,sha256:got.sha256,revision:got.revision,corpusHash:got.corpusHash,seed:got.seed}, P.placeboFor({skillText:text,seed}));
      assert.equal(got.original, text);
    }
  }
  const context = await buildFake(subject, 'context', digest);
  const skill = await buildFake(subject, 'skill', digest);
  assert.notEqual(context.seed, skill.seed);
  assert.notEqual(context.sha256, skill.sha256);
});

test('AC-2 bounds refuse before hashing, using runner words and codes', async () => {
  const { buildFake } = await island();
  for (const length of [0,262145]) {
    let error; try { P.placeboFor({skillText:'x'.repeat(length),seed:'seed'}); } catch (e) { error = e; }
    let calls = 0;
    for (const mode of ['context','skill']) await assert.rejects(buildFake(encode('x'.repeat(length)), mode, () => { calls++; throw Error('must not hash'); }), e => e.code === error.code && e.message === error.message);
    assert.equal(calls, 0);
  }
  for (const [bytes,pattern] of [[new Uint8Array([255]), /UTF-8/], [encode('a\0b'), /NUL/], [encode(' \n\u200b'), /no letter or digit/]]) await assert.rejects(buildFake(bytes,'context',digest),pattern);
  await assert.rejects(buildFake(encode('x'),'unknown',digest),/mode/i);
});

test('AC-4 closed browser import graph has no network, persistence or HTML sinks', () => {
  const seen = new Set();
  function scan(file) {
    if (seen.has(file)) return; seen.add(file);
    const code = read(file).replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
    assert.doesNotMatch(code,/\b(?:require|process|Buffer|fetch|XMLHttpRequest|WebSocket|EventSource|Worker|sendBeacon|localStorage|sessionStorage|indexedDB)\b|eval\s*\(|import\s*\(|innerHTML|outerHTML|insertAdjacentHTML|document\.write|\.cookie\s*=/,file);
    for (const match of code.matchAll(/^import\s+\{[^}]+\}\s+from\s+['"]([^'"]+)['"];$/gm)) {
      assert.match(match[1],/^\.\.\/import-core\//);
      scan(path.posix.normalize(path.posix.join(path.posix.dirname(file),match[1])));
    }
  }
  scan('docs/islands/placebo.js'); assert.equal(seen.size,2);
  assert.doesNotMatch(read('docs/placebo/index.html'),/<form\b[^>]*\baction\s*=/i);
});

test('AC-5 fallback and discoverable links', () => {
  const html = read('docs/placebo/index.html');
  assert.match(html,/data-island="placebo"/);
  assert.match(html,/npx driftproof run/);
  assert.match(html,/spec\/RECEIPT\.md#the-placebo-arm/);
  assert.match(read('README.md'),/https:\/\/driftproofhq\.com\/placebo\//);
  assert.match(read('docs/reports/016/index.html'),/href="\/placebo\/"/);
});

test('AC-3/4/5 Chromium paste, file, drop, races, privacy and no-JavaScript', {timeout:1800000}, async () => {
  const { chromium } = require('playwright');
  const server = http.createServer((req,res) => {
    let file = path.resolve(ROOT,'docs','.' + new URL(req.url,'http://localhost').pathname);
    if (!file.startsWith(path.join(ROOT,'docs') + path.sep)) return res.writeHead(403).end();
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file,'index.html');
      res.setHeader('Content-Type',({'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml','.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
      res.end(fs.readFileSync(file));
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,args:['--no-sandbox']});
    const context = await browser.newContext({viewport:{width:1280,height:900}});
    const requests = [];
    await context.route('**/*', async route => {
      requests.push(route.request().url());
      if (new URL(route.request().url()).hostname === '127.0.0.1') await route.continue(); else await route.abort();
    });
    const page = await context.newPage();
    const url = 'http://127.0.0.1:' + server.address().port + '/placebo/';
    await page.goto(url,{waitUntil:'networkidle'});
    await page.waitForSelector('[data-placebo-input]');
    const state = () => page.evaluate(() => ({url:location.href,cookie:document.cookie,local:Object.entries(localStorage),session:Object.entries(sessionStorage)}));
    const before = await state(), loaded = requests.length;
    const waitHash = wanted => page.waitForFunction(hash => document.querySelector('[data-placebo-hash]')?.textContent === hash,wanted);
    await page.selectOption('[data-placebo-mode]','context');
    await page.locator('[data-placebo-input]').setInputFiles({name:'CLAUDE.md',mimeType:'text/markdown',buffer:subject});
    await waitHash(receipt.placebo.sha256);
    assert.equal(await page.locator('[data-placebo-fake]').textContent(),fake);
    assert.equal(await page.locator('[data-placebo-original]').textContent(),subject.toString());
    assert.match(await page.locator('[data-placebo-command]').textContent(),/--suite tasks.json --placebo/);
    const marker = 'private614<img src="/leak">字😀';
    await page.locator('[data-placebo-text]').fill(marker);
    assert.equal(await page.locator('[data-placebo-hash]').count(),0,'editing clears old output');
    await page.locator('[data-placebo-build]').click();
    const expected = await (await island()).buildFake(encode(marker),'context',digest);
    await waitHash(expected.sha256);
    assert.equal(await page.locator('[data-placebo-original]').textContent(),marker);
    assert.equal(await page.locator('[data-placebo-output] img').count(),0);
    await page.screenshot({path:path.join(shots,'placebo-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:path.join(shots,'placebo-mobile.png'),fullPage:true});
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const dropped = '\ufeff# File\r\n字😀\r\n';
    await page.evaluate(text => {
      const transfer = new DataTransfer(); transfer.items.add(new File([text],'AGENTS.md'));
      document.querySelector('[data-placebo-drop]').dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));
    },dropped);
    await waitHash((await (await island()).buildFake(encode(dropped),'context',digest)).sha256);
    await page.selectOption('[data-placebo-mode]','skill');
    await page.locator('[data-placebo-build]').click();
    await waitHash((await (await island()).buildFake(encode(dropped),'skill',digest)).sha256);
    assert.match(await page.locator('[data-placebo-command]').textContent(),/run <skill-directory> --placebo/);
    await page.evaluate(() => { const original = File.prototype.arrayBuffer; File.prototype.arrayBuffer = function() { return this.name === 'slow.md' ? new Promise(resolve => setTimeout(() => resolve(original.call(this)),250)) : original.call(this); }; });
    await page.locator('[data-placebo-input]').setInputFiles({name:'slow.md',mimeType:'text/markdown',buffer:Buffer.from('stale text')});
    await page.locator('[data-placebo-text]').fill('fresh');
    await page.locator('[data-placebo-build]').click();
    const fresh = await (await island()).buildFake(encode('fresh'),'skill',digest);
    await waitHash(fresh.sha256);
    await page.waitForTimeout(350);
    assert.equal(await page.locator('[data-placebo-original]').textContent(),'fresh');
    await page.locator('[data-placebo-input]').setInputFiles({name:'large.md',mimeType:'text/markdown',buffer:Buffer.alloc(262145,120)});
    await page.waitForFunction(() => document.querySelector('[data-placebo-output]').textContent.includes('more than'));
    assert.equal(await page.locator('[data-placebo-hash]').count(),0);
    await page.locator('[data-placebo-text]').fill(''); await page.locator('[data-placebo-build]').click();
    await page.waitForFunction(() => document.querySelector('[data-placebo-output]').textContent.includes('empty'));
    assert.equal(requests.length,loaded,'processing makes no requests');
    assert.deepEqual(await state(),before,'processing does not persist');
    await page.evaluate(() => fetch('/privacy-plant').catch(() => {}));
    assert.ok(requests.length > loaded,'request observer detects planted request');
    await page.evaluate(() => localStorage.setItem('privacy-plant','detected'));
    assert.notDeepEqual(await state(),before,'state observer detects planted write');
    const nojs = await browser.newContext({javaScriptEnabled:false});
    const fallback = await nojs.newPage(); await fallback.goto(url);
    assert.match(await fallback.locator('main').innerText(),/npx driftproof run/);
    assert.equal(await fallback.locator('main a[href$="#the-placebo-arm"]').count(),1);
    await nojs.close(); await context.close();
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
