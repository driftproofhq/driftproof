// SPDX-License-Identifier: Apache-2.0
'use strict';

// The staleness-check Action's evergreen properties (spec 057 AC-7), read by tests/gate.js on every
// branch, because specs/ is not in the published tree. The spec's own gate drives the action's script;
// this reads the files only:
//   - no ${{ }} expression inside a run: script of stale/action.yml or the example workflow;
//   - every input reaches its step as an env: INPUT_<NAME> entry, and no input expression is
//     anywhere else;
//   - every third-party action is pinned to a full commit SHA;
//   - the example grants exactly contents: read and issues: write;
//   - every driftproofhq/driftproof/stale@ reference in the README and the example names the
//     package version, as the deciding Action's references are held to it.
//
// staleActionChecks(root) returns [{ name, ok, detail }] and never throws on a missing file: a missing
// file is a failed check.

const fs = require('fs');
const path = require('path');

const ACTION = path.join('stale', 'action.yml');
const EXAMPLE = path.join('examples', 'workflows', 'driftproof-stale.yml');

function runBodies(yaml) {
  const lines = yaml.split('\n');
  const out = [];
  lines.forEach((l, i) => {
    const m = l.match(/^(\s*)(?:-\s+)?run:\s*(.*)$/);
    if (!m) return;
    if (!/^[|>][-+]?\s*$/.test(m[2])) { out.push({ line: i + 1, text: m[2] }); return; }
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() !== '' && lines[j].match(/^(\s*)/)[1].length <= m[1].length) break;
      body.push(lines[j]);
    }
    out.push({ line: i + 1, text: body.join('\n') });
  });
  return out;
}

function staleActionChecks(root) {
  const read = (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch (_e) { return null; } };
  const a = read(ACTION);
  const w = read(EXAMPLE);
  const readme = read('README.md');
  let version = null;
  try { version = JSON.parse(read('package.json')).version; } catch (_e) { /* unread */ }
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });

  check('stale/action.yml and the example workflow are present, and the action is composite', a && w && /^\s+using:\s*'?composite'?\s*$/m.test(a), { action: !!a, example: !!w });
  if (!a || !w) return checks;

  const inRun = [];
  for (const [n, t] of [[ACTION, a], [EXAMPLE, w]]) for (const b of runBodies(t)) if (b.text.includes('${{')) inRun.push(`${n}:${b.line}`);
  check('no ${{ expression inside a run: script of stale/action.yml or the example', runBodies(a).length > 0 && inRun.length === 0, { inRun });

  const inputBlock = (a.match(/^inputs:\n([\s\S]*?)^\S/m) || [])[1] || '';
  const names = [...inputBlock.matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gm)].map((m) => m[1]);
  const envLine = (k) => new RegExp(`^\\s+INPUT_${k.toUpperCase().replace(/-/g, '_')}: \\$\\{\\{ inputs\\.${k} \\}\\}$`, 'm');
  const noEnv = names.filter((k) => !envLine(k).test(a));
  const elsewhere = a.split('\n').filter((l) => /\$\{\{\s*inputs\./.test(l) && !/^\s+INPUT_[A-Z_]+: \$\{\{ inputs\.[a-z-]+ \}\}$/.test(l));
  check('every stale/action.yml input is an env: INPUT_<NAME> entry, and no input expression appears elsewhere', names.length > 0 && noEnv.length === 0 && elsewhere.length === 0, { names, noEnv, elsewhere });

  const uses = [];
  for (const [n, t] of [[ACTION, a], [EXAMPLE, w]]) {
    t.split('\n').forEach((l, i) => {
      const m = l.match(/^\s*(?:-\s+)?uses:\s*(\S+)/);
      if (!m) return;
      const own = n === EXAMPLE && /^driftproofhq\/driftproof\/stale@v\d+\.\d+\.\d+$/.test(m[1]);
      uses.push({ at: `${n}:${i + 1}`, uses: m[1], pinned: own || /^[\w.-]+\/[\w.-]+(\/[^@\s]+)?@[0-9a-f]{40}$/.test(m[1]) });
    });
  }
  check('every third-party action in stale/action.yml and the example is pinned to a full commit SHA', uses.length > 0 && uses.every((u) => u.pinned), { unpinned: uses.filter((u) => !u.pinned) });

  const permLines = w.split('\n').filter((l) => /^\s*permissions:/.test(l));
  const top = ((w.match(/^permissions:[ \t]*\n((?:[ \t]+\S[^\n]*\n)+)/m) || [])[1] || '').split('\n').map((l) => l.trim()).filter(Boolean).sort();
  check('the example workflow grants exactly contents: read and issues: write', permLines.length === 1 && top.join(',') === 'contents: read,issues: write', { permLines, top });

  const bad = [];
  for (const [n, t] of [['README.md', readme], [EXAMPLE, w]]) {
    const refs = t ? [...t.matchAll(/driftproofhq\/driftproof\/stale@(v[0-9.]+)/g)].map((m) => m[1]) : [];
    if (!refs.length) bad.push(`${n}: no reference`);
    for (const v of refs) if (v !== `v${version}`) bad.push(`${n}: ${v} != v${version}`);
  }
  check('every driftproofhq/driftproof/stale@ reference in the README and the example names the package version', version && bad.length === 0, { version, bad });
  return checks;
}

module.exports = { staleActionChecks };
