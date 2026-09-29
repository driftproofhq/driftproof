// SPDX-License-Identifier: Apache-2.0
'use strict';

// Every JSON file the CLI writes leaves a receipt directory readable (spec 107 AC-2).
//
// A directory reader returns every `.json` object that carries `receipt_hash` or `results`, unless
// it is a sidecar by name and shape (lib/receipt.js, specs 069 and 107), and the caller refuses a
// returned object whose hash does not verify. Several formats carry `receipt_hash` as a reference,
// so every writer is run here into one receipt directory, each by its own naming rule, and the
// directory must read by `badge <dir>` and `decide` as the receipts alone do. The writer list is
// typed, as spec 107's census in its plan.md is: a spec that adds a JSON writer adds it here.
//
// `root` is the package to run (bin/driftproof and what it loads), so a spec's gate can run this
// over its Base or a planted copy; the importer fixture is this directory's own. Every run is a
// stub run (DRIFTPROOF_STUB=1) with no credential in its environment, under `tmp`, which the
// caller makes and removes. Returns { ok, setup, problems, writers, readers, receipts, spawns }.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const IMPORT_FIXTURE = { file: path.join(__dirname, 'fixtures', 'interop-agent-skills-eval.json'), from: 'agent-skills-eval' };

function stubEnv() {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/API_KEY|TOKEN|SECRET|^CLAUDE_PROVIDER$|^DRIFTPROOF_|^GITHUB_|^RUNNER_|^INPUT_/.test(k)) continue;
    env[k] = v;
  }
  return { ...env, DRIFTPROOF_STUB: '1' };
}

function checkReceiptDirWriters({ root, tmp }) {
  root = path.resolve(root);
  const env = stubEnv();
  const spawns = [];
  const cli = (args, cwd) => {
    const r = spawnSync(process.execPath, [path.join(root, 'bin', 'driftproof'), ...args], { cwd, env, encoding: 'utf8', timeout: 180000, maxBuffer: 64 << 20 });
    spawns.push({ cmd: args[0], stub: env.DRIFTPROOF_STUB, credentials: Object.keys(env).filter((k) => /API_KEY|TOKEN|SECRET/.test(k)) });
    return { exit: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
  };
  const lastLine = (t) => String(t).trim().split('\n').filter(Boolean).slice(-1)[0] || '';
  const dir = path.join(tmp, 'receipts');
  const ctl = path.join(tmp, 'receipts-alone');
  const skill = path.join(tmp, 'skill');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(ctl, { recursive: true });
  const problems = [];
  const writers = [];
  const readers = [];
  const done = (setup) => ({ ok: setup && problems.length === 0, setup, problems, writers, readers, receipts: receiptNames(), spawns });

  // The top-level `.json` objects carrying `results`, read by content: the receipts.
  function receiptNames() {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).filter((f) => {
      try { const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return !!(d && typeof d === 'object' && Object.hasOwn(d, 'results')); } catch { return false; }
    }).sort();
  }
  const listing = () => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) for (const f of fs.readdirSync(path.join(dir, e.name))) out.push(`${e.name}/${f}`);
      else out.push(e.name);
    }
    return out.sort();
  };
  function write(name, args, cwd = tmp) {
    const before = new Set(listing());
    const r = cli(args, cwd);
    const wrote = listing().filter((f) => !before.has(f));
    writers.push({ name, exit: r.exit, wrote, stderr: wrote.length ? '' : lastLine(r.stderr) });
    if (!wrote.length) problems.push(`${name}: exit ${r.exit}, wrote no file`);
    return r;
  }

  const init = cli(['init', skill], tmp);
  if (init.exit !== 0) { problems.push(`init: exit ${init.exit}: ${lastLine(init.stderr)}`); return done(false); }

  // run, from the directory, keeping transcripts there
  write('run --keep-transcripts --out <dir>', ['run', skill, '--out', dir, '--keep-transcripts', '--trusted-skill'], dir);
  const runReceipt = receiptNames()[0];
  if (!runReceipt) { problems.push('run: no receipt in the directory'); return done(false); }
  const receiptDoc = JSON.parse(fs.readFileSync(path.join(dir, runReceipt), 'utf8'));

  // regrade, with the answers the kept transcripts hold, by a judge the registry names
  const answers = {};
  const tdir = path.join(dir, 'transcripts');
  for (const h of fs.existsSync(tdir) ? fs.readdirSync(tdir) : []) {
    for (const f of fs.readdirSync(path.join(tdir, h))) {
      const t = JSON.parse(fs.readFileSync(path.join(tdir, h, f), 'utf8'));
      if (typeof t.generation === 'string') answers[crypto.createHash('sha256').update(t.generation).digest('hex')] = t.generation;
    }
  }
  const answersFile = path.join(tmp, 'answers.json');
  fs.writeFileSync(answersFile, JSON.stringify({ answers }));
  const judges = JSON.parse(fs.readFileSync(path.join(root, 'config', 'models.json'), 'utf8')).models.filter((m) => m.judge_eligible).map((m) => m.id);
  const judge = judges.find((j) => j !== receiptDoc.run.judge.model_id) || judges[0];
  write('regrade --out <dir>', ['regrade', path.join(dir, runReceipt), '--skill', skill, '--answers', answersFile, '--judge-model', judge, '--trusted-skill', '--out', dir]);

  write(`import --from ${IMPORT_FIXTURE.from} --out <dir>`, ['import', IMPORT_FIXTURE.file, '--from', IMPORT_FIXTURE.from, '--out', dir]);

  const receipts = receiptNames();
  for (const f of receipts) fs.copyFileSync(path.join(dir, f), path.join(ctl, f));
  const models = [...new Set(receipts.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).run.model_id))].sort().join(',');

  for (const f of receipts) write(`export --to summary-json --out <dir> (${f})`, ['export', path.join(dir, f), '--to', 'summary-json', '--out', dir]);
  write('badge <receipt> --out <file>', ['badge', path.join(dir, runReceipt), '--out', path.join(dir, 'badge-receipt.json')]);
  write('badge <dir> --out <file>', ['badge', dir, '--out', path.join(dir, 'badge-dir.json')]);
  write('decide --badge <file>', ['decide', dir, '--models', models, '--badge', path.join(dir, 'decide-badge.json')]);
  write('stale --json <file>', ['stale', path.join(dir, runReceipt), '--json', path.join(dir, 'stale.json')]);

  // the readers: over every writer's files, and over the receipts alone
  for (const [name, args] of [['badge <dir>', []], ['badge <dir> --models <m>', ['--models', models]], ['decide <dir> --models <m>', ['--models', models]]]) {
    const cmd = name.split(' ')[0];
    const read = (d) => { const r = cli([cmd, d, ...args], tmp); return { exit: r.exit, stdout: r.stdout.split(d).join('<dir>'), stderr: lastLine(r.stderr.split(d).join('<dir>')) }; };
    const subject = read(dir);
    const control = read(ctl);
    const same = subject.exit === control.exit && subject.stdout === control.stdout;
    readers.push({ name, same, subject, control });
    if (!same) problems.push(`${name}: exit ${subject.exit} over every writer's files, ${control.exit} over the receipts alone; ${subject.stderr || 'stdout differs'}`);
  }
  return done(true);
}

module.exports = { checkReceiptDirWriters };
