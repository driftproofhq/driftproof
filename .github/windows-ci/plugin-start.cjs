// SPDX-License-Identifier: Apache-2.0
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const c = require('./common.cjs');
function assertSample(observation) {
  const { result, metadata: m, pageExists, pageBytes, before, after } = observation;
  c.success(result, 'AC-15 sample');
  assert.ok(result.stdout.includes('no SKILL.md found under '), 'AC-15 empty directory');
  const sentence = 'a sample results page, made by this runner from the receipts it ships, with no model call and nothing written in your folders: report ' + m.report + ' holds ' + m.runs + ' runs of ' + m.skill + ' on ' + m.model + ', run ' + m.dates.join(', ') + ', and the page shows every one.';
  assert.ok(result.stdout.includes(sentence), 'AC-15 independent sample metadata');
  assert.ok(result.stdout.includes("It is a sample of report " + m.report + "'s runs, not a result for a skill of yours."), 'AC-15 sample disclaimer');
  assert.ok(result.stdout.includes('the results page is ' + m.page + ' (file://' + m.page + ')'), 'AC-15 sample page path');
  assert.ok(path.basename(m.page) === 'driftproof-view.html', 'AC-15 sample page name');
  assert.equal(pageExists, true, 'AC-15 sample page exists'); assert.ok(pageBytes > 0, 'AC-15 nonempty sample page');
  assert.deepEqual(after, before, 'AC-15 sample wrote files');
}
function assertListing(observation) {
  const { result, expected, before, after } = observation;
  c.success(result, 'AC-15 listing');
  assert.ok(result.stdout.includes('skills under '), 'AC-15 listing heading');
  assert.doesNotMatch(result.stdout, /sample results page|the results page is/, 'AC-15 no sample for a listing');
  const actual = {};
  for (const line of result.stdout.replace(/\r\n/g, '\n').split('\n')) {
    const match = /^  (.+?)  \((has test cases|no test cases yet)\)$/.exec(line);
    if (!match) continue;
    const name = match[1].replace(/\\/g, '/');
    assert.ok(!Object.hasOwn(actual, name), 'AC-15 unique listed skill');
    actual[name] = match[2] === 'has test cases';
  }
  assert.deepEqual(actual, expected, 'AC-15 complete listing and case status');
  assert.deepEqual(after, before, 'AC-15 listing wrote files');
}
// Spec 777 AC-11: the npx form, as the directory serves it: the command file's own line, run in Git Bash, from the
// person's folder, on a tarball of this checkout. On Windows, $OLDPWD is /c/... and the runner converts it.
function gitBash() {
  const known = 'C:\\Program Files\\Git\\bin\\bash.exe';
  return process.platform === 'win32' && fs.existsSync(known) ? known : 'bash';
}
function npxForm(version, command) {
  return '(cd "${CLAUDE_PLUGIN_ROOT}" && npx --prefix "${CLAUDE_PLUGIN_ROOT}" driftproof@' + version + ' door --pin ' + version + ' --from "$OLDPWD" ' + command;
}
function npxStart(plugin, tgz, cwd, env) {
  const version = JSON.parse(fs.readFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), 'utf8')).version;
  const form = npxForm(version, 'start');
  assert.ok(fs.readFileSync(path.join(plugin, 'commands', 'start.md'), 'utf8').split(/\r?\n/).some((l) => l.trim() === form + ')'), 'AC-11 start.md carries the npx line');
  const line = (form + ')').split('${CLAUDE_PLUGIN_ROOT}').join(plugin.split(path.sep).join('/')).replace('driftproof@' + version, JSON.stringify('file:' + tgz.split(path.sep).join('/')));
  return c.runLine(gitBash(), line, { cwd, env });
}
function runPlugin() {
  c.prepare(); const plant = c.plantArg(['sample', 'listing']);
  // Spec 777 AC-12: the runner reads the folders above where npm started it, so on a system with owners and
  // modes the copy sits in the account's own home, or the job's temp folder, and not under a shared temp.
  const base = process.platform === 'win32' ? os.tmpdir() : process.env.RUNNER_TEMP || os.homedir();
  const dir = fs.mkdtempSync(path.join(base, 'windows plugin '));
  // A copy, in a folder with no package.json or node_modules above it, as an install under ~/.claude is.
  const plugin = path.join(dir, 'installed plugin'); fs.cpSync(path.join(c.ROOT, 'plugin/driftproof'), plugin, { recursive: true });
  const beforePlugin = c.snapshot(plugin);
  try {
    const empty = path.join(dir, 'empty'), listing = path.join(dir, 'listing');
    fs.mkdirSync(empty); fs.mkdirSync(listing);
    const sample = path.join(c.ROOT, 'lib/door/sample'), reports = fs.readdirSync(sample).filter((f) => /^report-\d+$/.test(f));
    assert.equal(reports.length, 1, 'AC-15 one bundled report');
    const receipts = [];
    function walk(at) {
      for (const e of fs.readdirSync(at, { withFileTypes: true })) {
        const full = path.join(at, e.name);
        if (e.isDirectory()) walk(full); else if (e.name.endsWith('.json')) receipts.push(JSON.parse(fs.readFileSync(full, 'utf8')));
      }
    }
    walk(path.join(sample, reports[0])); assert.ok(receipts.length, 'AC-15 bundled receipts');
    assert.equal(new Set(receipts.map((r) => r.skill.name)).size, 1); assert.equal(new Set(receipts.map((r) => r.run.model_id)).size, 1);
    const packed = c.npm('pack', ['--silent', '--pack-destination', dir], { cwd: c.ROOT });
    c.success(packed, 'AC-11 pack');
    const tgz = path.join(dir, packed.stdout.trim().split(/\r?\n/).pop());
    const env = { ...c.cleanEnv(), GIT_CEILING_DIRECTORIES: dir };
    const before = c.snapshot(empty);
    const result = npxStart(plugin, tgz, empty, env);
    if (plant === 'sample') result.status = 1;
    const named = /the results page is (.+?) \(file:/.exec(result.stdout);
    const page = named ? named[1] : path.join(dir, 'no page named');
    const metadata = { report: reports[0].slice('report-'.length), runs: receipts.length,
      skill: receipts[0].skill.name, model: receipts[0].run.model_id,
      dates: [...new Set(receipts.map((r) => r.run.date_utc.slice(0, 10)))].sort(), page };
    assertSample({ result, metadata, pageExists: fs.existsSync(page) && fs.statSync(page).isFile(), pageBytes: fs.existsSync(page) ? fs.statSync(page).size : 0, before, after: c.snapshot(empty) });
    const expected = { ready: true, draft: false, '.claude/skills/hidden': true };
    for (const [relative, cases] of Object.entries(expected)) {
      const at = path.join(listing, relative); fs.mkdirSync(at, { recursive: true });
      fs.writeFileSync(path.join(at, 'SKILL.md'), '---\nname: ' + path.basename(at) + '\n---\n\nBe brief.\n');
      if (cases) { fs.mkdirSync(path.join(at, 'evals')); fs.writeFileSync(path.join(at, 'evals/evals.json'), JSON.stringify({ cases: [{ id: 'one', prompt: 'Q', rubric: 'R' }] })); }
    }
    const beforeList = c.snapshot(listing);
    const listed = npxStart(plugin, tgz, listing, env);
    if (plant === 'listing') listed.stdout = 'skills under fixture:\n';
    assertListing({ result: listed, expected, before: beforeList, after: c.snapshot(listing) });
    c.assertUnchanged(beforePlugin, c.snapshot(plugin));
    console.log('Windows plugin start: the npx form, the sample page and all three listed skills passed; no bytes written in the person\'s folders');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  if (!plant) {
    for (const name of ['sample', 'listing']) c.ownMutation(__filename, name, 'AC-15');
    console.log('Windows plugin start: sample and listing executable-boundary mutations rejected');
  }
}
if (require.main === module) c.main(runPlugin);
module.exports = { assertSample, assertListing, runPlugin };
