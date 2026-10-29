// SPDX-License-Identifier: Apache-2.0
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
function fixture() {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'bootstrap-476-')); made.push(dir);
  const root = path.join(dir, 'checkout'), source = path.join(dir, 'archive');
  const put = (base, rel, text) => { const f = path.join(base, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); return f; };
  const script = put(root, 'scripts/bootstrap.sh', fs.readFileSync(path.join(ROOT, 'scripts/bootstrap.sh')));
  put(root, 'package-lock.json', '{}\n');
  const inventory = sha('original') + '  bundle/data.txt\n';
  put(root, 'records/SHA256SUMS', inventory);
  put(source, 'private/bundle/data.txt', 'original');
  const manifest = { version: 1, inputs: [
    { id: 'lock', kind: 'lock', source: 'https://registry.npmjs.org', version: 'fixture', path: 'package-lock.json', sha256: sha('{}\n') },
    { id: 'bundle', kind: 'files', source: 'Operator retained test archive', version: 'fixture', base: 'private', inventory: 'records/SHA256SUMS', sha256: sha(inventory), directories: ['bundle'] },
    { id: 'ajv-fixture', kind: 'npm', source: 'https://registry.npmjs.org/ajv/-/ajv-8.17.1.tgz', version: '8.17.1', sha256: sha('tarball'), integrity: 'sha512-' + crypto.createHash('sha512').update('tarball').digest('base64') },
  ] };
  const manifestFile = put(root, 'bootstrap-inputs.json', JSON.stringify(manifest));
  const calls = path.join(dir, 'npm-calls.jsonl');
  const npm = put(dir, 'bin/npm', `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2);
fs.appendFileSync(process.env.BOOTSTRAP_TEST_CALLS, JSON.stringify({args:a,cache:process.env.npm_config_cache})+'\\n');
if(a[0]==='pack'){const d=a[a.indexOf('--pack-destination')+1];fs.writeFileSync(path.join(d,'ajv-8.17.1.tgz'),process.env.BOOTSTRAP_TEST_BAD_TARBALL?'changed':'tarball');}
`);
  fs.chmodSync(npm, 0o755);
  const run = (...args) => spawnSync('bash', [script, ...args], { cwd: dir, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, PATH: path.dirname(npm) + path.delimiter + process.env.PATH,
      DRIFTPROOF_BOOTSTRAP_INPUTS: source, BOOTSTRAP_TEST_CALLS: calls,
      npm_config_cache: path.join(dir, 'operator-cache') } });
  return { root, source, put, manifest, save: () => fs.writeFileSync(manifestFile, JSON.stringify(manifest)), calls, run };
}
test('AC-1/2/4: fresh checkout restores sealed files, installs the lock and primes only a private offline cache', () => {
  const f = fixture(), r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readFileSync(path.join(f.root, 'private/bundle/data.txt'), 'utf8'), 'original');
  const calls = fs.readFileSync(f.calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls[0].args[0], 'ci');
  assert.ok(calls.some(({args:a}) => a[0] === 'cache' && a[1] === 'add' && a.includes('ajv@8.17.1')));
  assert.ok(calls.some(({args:a}) => a[0] === 'pack' && a.includes('--offline')));
  for (const call of calls) assert.equal(call.cache, path.join(f.root, 'state/bootstrap/npm'));
  assert.equal(fs.existsSync(path.join(f.root, '.npmrc')), false);
  const exportLine = r.stdout.split('\n').find(line => line.startsWith('export npm_config_cache='));
  assert.ok(exportLine, 'bootstrap prints the optional shell export');
  const exported = spawnSync('bash', ['-c', exportLine + '\nnode -p process.env.npm_config_cache'], { encoding: 'utf8', timeout: 120000 });
  assert.equal(exported.status, 0, exported.stderr);
  assert.equal(exported.stdout.trim(), path.join(f.root, 'state/bootstrap/npm'));
  assert.equal(fs.existsSync(path.join(f.root, 'specs/003-spec-loop-driver')), false);
  const check = f.run('--check'); assert.equal(check.status, 0, check.stderr);
  assert.equal(fs.readFileSync(f.calls, 'utf8').trim().split('\n').length, calls.length, '--check runs no npm command');
});
test('AC-2/3: missing, changed, unlisted and unsafe private inputs fail closed', () => {
  for (const plant of ['missing', 'changed', 'inventory', 'extra', 'escape', 'symlink']) {
    const f = fixture();
    if (plant === 'missing') fs.rmSync(path.join(f.source, 'private/bundle/data.txt'));
    if (plant === 'changed') f.put(f.source, 'private/bundle/data.txt', 'changed');
    if (plant === 'inventory') f.put(f.root, 'records/SHA256SUMS', sha('changed') + '  bundle/data.txt\n');
    if (plant === 'extra') { f.put(f.root, 'private/bundle/data.txt', 'original'); f.put(f.root, 'private/bundle/extra.txt', 'extra'); }
    if (plant === 'escape') { const text = sha('original') + '  ../escape.txt\n'; f.put(f.root, 'records/SHA256SUMS', text); f.manifest.inputs[1].sha256 = sha(text); f.save(); }
    if (plant === 'symlink') { fs.mkdirSync(path.join(f.root, 'private'), { recursive: true }); fs.symlinkSync(path.join(f.source, 'private/bundle'), path.join(f.root, 'private/bundle')); }
    const r = f.run(); assert.notEqual(r.status, 0, plant);
    assert.match(r.stderr, /bootstrap:.*(bundle|inventory|unsafe)/, plant);
    assert.equal(fs.existsSync(f.calls), false, plant + ': private preflight precedes npm');
  }
});
test('AC-2: checksum verification rejects a changed tarball', () => {
  const f = fixture(); process.env.BOOTSTRAP_TEST_BAD_TARBALL = '1';
  try { const r = f.run(); assert.notEqual(r.status, 0); assert.match(r.stderr, /sha256.*ajv|ajv.*sha256/); }
  finally { delete process.env.BOOTSTRAP_TEST_BAD_TARBALL; }
});
test('AC-2/3: check mode refuses missing local evidence even when an archive is available', () => {
  const f = fixture(), r = f.run('--check'); assert.notEqual(r.status, 0); assert.match(r.stderr, /bundle/);
  assert.equal(fs.existsSync(path.join(f.root, 'private')), false);
  assert.equal(fs.existsSync(f.calls), false);
});
test('AC-2/3: pinned response records, checksum copies and relative symlinks restore and verify', () => {
  const f = fixture();
  const record = JSON.stringify({ responses: { 'response.json': sha('{}') } });
  f.put(f.root, 'records/responses.json', record);
  f.put(f.source, 'snapshots/response.json', '{}');
  f.manifest.inputs.push({ id: 'responses', kind: 'files', source: 'Retained snapshot', version: 'fixture',
    base: 'snapshots', inventory: 'records/responses.json', format: 'responses', sha256: sha(record) });
  const links = 'bundle/alias -> data.txt\n';
  f.put(f.root, 'records/links', links);
  f.manifest.inputs[1].symlinks = { path: 'records/links', sha256: sha(links) };
  f.manifest.inputs[1].inventoryCopy = 'SHA256SUMS';
  f.save();
  const r = f.run(); assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readlinkSync(path.join(f.root, 'private/bundle/alias')), 'data.txt');
  assert.equal(fs.readFileSync(path.join(f.root, 'private/SHA256SUMS'), 'utf8'), fs.readFileSync(path.join(f.root, 'records/SHA256SUMS'), 'utf8'));
  assert.equal(fs.readFileSync(path.join(f.root, 'snapshots/response.json'), 'utf8'), '{}');
  assert.equal(f.run('--check').status, 0);
  fs.unlinkSync(path.join(f.root, 'private/bundle/alias'));
  fs.symlinkSync('elsewhere', path.join(f.root, 'private/bundle/alias'));
  assert.match(f.run('--check').stderr, /bundle: link differs/);
});
test('AC-4: the real 046 reader passes a private cache even with an ambient operator cache', () => {
  const f = fixture(), scratch = path.join(f.root, 'scratch'); fs.mkdirSync(scratch);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'specs/046-ajv-floor/probes/ajv.mjs'), 'receipts'], {
    encoding: 'utf8', timeout: 120000,
    env: { ...process.env, PATH: path.join(path.dirname(f.root), 'bin') + path.delimiter + process.env.PATH,
      SPEC046_TMP: scratch, BOOTSTRAP_TEST_CALLS: f.calls, npm_config_cache: path.join(scratch, 'empty-operator-cache') },
  });
  assert.equal(r.status, 0, r.stderr);
  const [call] = fs.readFileSync(f.calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(call.cache, path.join(ROOT, 'state/bootstrap/npm'));
  assert.ok(call.args.includes('--offline'));
  assert.match(r.stdout, /UNREADABLE.*recorded integrity/, 'the fixture tarball is still rejected by the unchanged sha512 check');
});
test('AC-2: the real manifest follows the lock, ajv floor, and committed inventories', () => {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'bootstrap-inputs.json')));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json')));
  assert.equal(m.inputs.find(i => i.kind === 'lock').sha256, sha(fs.readFileSync(path.join(ROOT, 'package-lock.json'))));
  assert.deepEqual(m.inputs.filter(i => i.kind === 'npm').map(i => i.version).sort(),
    [...new Set(['8.17.1', pkg.dependencies.ajv.slice(1), lock.packages['node_modules/ajv'].version])].sort());
  for (const i of m.inputs.filter(i => i.inventory)) {
    assert.equal(i.sha256, sha(fs.readFileSync(path.join(ROOT, i.inventory))), i.id);
    if (i.symlinks) assert.equal(i.symlinks.sha256, sha(fs.readFileSync(path.join(ROOT, i.symlinks.path))), i.id);
  }
});
test('AC-4: 046 excludes answer sidecars and still selects malformed receipts', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || '/var/tmp', 'bootstrap-selector-476-')); made.push(dir);
  const published = 'receipts/skill-measurements/published';
  const sidecar = fs.readdirSync(path.join(ROOT, published)).find(f => f.endsWith('-answers.json'));
  assert.ok(sidecar);
  const receipt = sidecar.replace(/-answers\.json$/, '.json');
  assert.ok(fs.existsSync(path.join(ROOT, published, receipt)));
  const git = path.join(dir, 'git');
  fs.writeFileSync(git, '#!/usr/bin/env node\nprocess.stdout.write(process.env.BOOTSTRAP_TEST_RECEIPTS);\n');
  fs.chmodSync(git, 0o755);
  const bad = path.join(dir, 'malformed-receipt.json'); fs.writeFileSync(bad, '{}\n');
  const run = (extra = []) => {
    const scratch = fs.mkdtempSync(path.join(dir, 'probe-'));
    const files = [`${published}/${receipt}`, `${published}/${sidecar}`, 'receipts/_index.json', 'receipts/baseline.control.json', `${published}/campaign.json`, `${published}/inputs/popularity.json`, `${published}/suites/fixture.json`, ...extra];
    const r = spawnSync(process.execPath, [path.join(ROOT, 'specs/046-ajv-floor/probes/ajv.mjs'), 'receipts'], {
      encoding: 'utf8', timeout: 120000, env: { ...process.env, SPEC046_TMP: scratch,
        PATH: dir + path.delimiter + process.env.PATH, BOOTSTRAP_TEST_RECEIPTS: files.join('\n') + '\n' },
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.replace(/^RESULT AC-3 \w+ /, ''));
  };
  const clean = run(); assert.equal(clean.state, 'GREEN'); assert.equal(clean.receipts, 1);
  assert.deepEqual(Object.values(clean.valid), [1, 1, 1]);
  const invalid = run([path.relative(ROOT, bad)]);
  assert.equal(invalid.state, 'RED'); assert.equal(invalid.receipts, 2);
  assert.ok(invalid.hits.some(h => h.includes('malformed-receipt.json') && h.includes('invalid')));
});
