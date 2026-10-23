// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { spawnSync } = require('node:child_process');
const ROOT = path.join(__dirname, '..');
const OUTPUTS = ['data/page-dates.json', 'sitemap.xml', 'sitemap-pages.xml',
  'sitemap-receipts.xml', 'feed.xml', 'robots.txt', 'llms.txt'];

// Write a small Git object graph directly. Only this test's temporary repository is changed;
// no Git mutation command or checkout of the source repository is needed.
function repository(root) {
  const put = (rel, body) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  };
  put('.git/HEAD', 'ref: refs/heads/dev\n');
  fs.mkdirSync(path.join(root, '.git/objects'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git/refs/heads'), { recursive: true });
  function object(type, body) {
    body = Buffer.from(body);
    const raw = Buffer.concat([Buffer.from(type + ' ' + body.length + '\0'), body]);
    const sha = crypto.createHash('sha1').update(raw).digest('hex');
    put('.git/objects/' + sha.slice(0, 2) + '/' + sha.slice(2), zlib.deflateSync(raw));
    return sha;
  }
  function tree(files) {
    const groups = new Map();
    for (const [rel, body] of Object.entries(files)) {
      const [name, ...rest] = rel.split('/');
      if (rest.length) {
        if (!groups.has(name)) groups.set(name, {});
        groups.get(name)[rest.join('/')] = body;
      } else groups.set(name, body);
    }
    const rows = [...groups].map(([name, value]) => typeof value === 'string'
      ? { name, mode: '100644', sha: object('blob', value), sort: name }
      : { name, mode: '40000', sha: tree(value), sort: name + '/' });
    rows.sort((a, b) => a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0);
    return object('tree', Buffer.concat(rows.map(r => Buffer.concat([
      Buffer.from(r.mode + ' ' + r.name + '\0'), Buffer.from(r.sha, 'hex'),
    ]))));
  }
  function commit(files, parents, day, branch = 'dev') {
    const stamp = Date.parse(day + 'T12:00:00Z') / 1000;
    const identity = 'Fixture <> ' + stamp + ' +0000';
    const sha = object('commit', 'tree ' + tree(files) + '\n'
      + parents.map(p => 'parent ' + p + '\n').join('')
      + 'author ' + identity + '\ncommitter ' + identity + '\n\nFixture\n');
    put('.git/refs/heads/' + branch, sha + '\n');
    put('.git/HEAD', 'ref: refs/heads/' + branch + '\n');
    for (const [rel, body] of Object.entries(files)) put(rel, body);
    return sha;
  }
  return { put, commit };
}

function cli(root, check = false) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/build-sitemap.js'),
    ...(check ? ['--check'] : [])], { cwd: root, encoding: 'utf8', timeout: 1800000 });
}
function generated(root) {
  return Object.fromEntries(OUTPUTS.map(p => [p, fs.readFileSync(path.join(root, 'docs', p), 'utf8')]));
}

for (const inherited of [false, true]) test('issue 455: a rederived branch stays current after a merge, inherited words=' + inherited, () => {
  const root = fs.mkdtempSync('/var/tmp/sitemap-455-');
  try {
    const { put, commit } = repository(root);
    for (const name of ['build-sitemap.js', 'site-chrome.js', 'html-text.js']) {
      put('scripts/' + name, fs.readFileSync(path.join(ROOT, 'scripts', name), 'utf8'));
    }
    // The fixture isolates date history; llms rendering has no page-date input.
    put('scripts/build-llms.js', "exports.renderLlms = () => 'Fixture index\\n';\n");
    put('scripts/build-public.sh', "EXCLUDE_RE='^never/'\n");
    put('docs/data/reports.json', '{"reports":[]}\n');
    const page = words => '<html><head><title>Fixture</title></head><body><main><p>'
      + words + '</p></main></body></html>\n';
    const baseFiles = { 'docs/index.html': page('Original words.'),
      'docs/other/index.html': page('Other page.') };
    const initial = commit(baseFiles, [], '2026-01-01');
    let result = cli(root);
    assert.equal(result.status, 0, result.stderr);
    Object.assign(baseFiles, Object.fromEntries(Object.entries(generated(root))
      .map(([p, body]) => ['docs/' + p, body])));
    const base = commit(baseFiles, [initial], '2026-01-01');
    // Dev diverges on the same date, so its derived dates stay current. The topic keeps
    // the shared words with new layout. Neither side starts with stale generated files.
    const diverged = inherited ? commit({ ...baseFiles, 'docs/index.html': page('Dev words.') },
      [base], '2026-01-01') : base;
    const branchFiles = { ...baseFiles, 'docs/index.html': inherited
      ? page('Original words.').replace('<main>', '<main class="topic">') : page('Changed words.') };
    const words = commit(branchFiles, [base], '2026-02-01', 'topic');
    result = cli(root);
    assert.equal(result.status, 0, result.stderr);
    const atTip = generated(root);
    assert.deepEqual(JSON.parse(atTip['data/page-dates.json']).dates,
      { 'index.html': inherited ? '2026-01-01' : '2026-02-01', 'other/index.html': '2026-01-01' });
    const derivedFiles = Object.fromEntries(Object.entries(atTip).map(([p, body]) => ['docs/' + p, body]));
    const tip = commit({ ...branchFiles, ...derivedFiles }, [words], '2026-02-02', 'topic');
    result = cli(root, true);
    assert.equal(result.status, 0, 'branch tip: ' + result.stderr);
    const devFiles = { ...baseFiles, ...(inherited ? { 'docs/index.html': page('Dev words.') } : {}),
      'docs/data/unrelated.json': '{}\n' };
    const dev = commit(devFiles, [diverged], '2026-02-03');
    result = cli(root, true);
    assert.equal(result.status, 0, 'dev before merging: ' + result.stderr);
    commit({ ...devFiles, ...branchFiles, ...derivedFiles }, [dev, tip], '2026-02-04');
    result = cli(root, true);
    assert.equal(result.status, 0, 'merge with unchanged page content: ' + result.stderr);
    result = cli(root);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(generated(root), atTip, 'all generated bytes stay the branch tip bytes');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
