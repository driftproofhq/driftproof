// SPDX-License-Identifier: Apache-2.0
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'release-body.mjs');

const SAMPLE = `# Releases

---

## v0.2.0 - 2026-01-02

### What's new

- A thing.

### Upgrade

Run it.

### Engineering log

Internal words stay here.

### Published

Also internal.

---

## v0.1.0 - 2026-01-01

### What changed

No user section in this one.

---
`;

async function load() { return import(SCRIPT); }

test('extracts from What\'s new to the engineering log', async () => {
  const { userSection } = await load();
  const b = userSection(SAMPLE, 'v0.2.0');
  assert.match(b, /^### What's new\n\n- A thing\.\n\n### Upgrade\n\nRun it\.\n$/);
  assert.ok(!b.includes('Internal'));
  assert.ok(!b.includes('Engineering log'));
});

test('a missing section, a missing user section and a bad tag are refused', async () => {
  const { userSection } = await load();
  assert.throws(() => userSection(SAMPLE, 'v9.9.9'), /no section headed/);
  assert.throws(() => userSection(SAMPLE, 'v0.1.0'), /no user section/);
  assert.throws(() => userSection(SAMPLE, '0.2.0'), /not vMAJOR/);
  assert.throws(() => userSection(SAMPLE, 'v0.2'), /not vMAJOR/);
  assert.throws(() => userSection(`## v1.0.0\n\n### What's new\n\n### Engineering log\n`, 'v1.0.0'), /empty/);
  assert.throws(() => userSection(`${SAMPLE}\n## v0.2.0 - again\n`, 'v0.2.0'), /exactly one/);
});

test('v0.2.0 does not match v0.2.0-rc or v0.2.01', async () => {
  const { userSection } = await load();
  assert.throws(() => userSection(`## v0.2.01 - x\n\n### What's new\n\n- x\n`, 'v0.2.0'), /no section headed/);
});

test('without an engineering log the body runs to the section end', async () => {
  const { userSection } = await load();
  assert.strictEqual(userSection(`## v1.0.0 - d\n\n### What's new\n\n- x\n\n---\n\n## v0.9.0 - d\n`, 'v1.0.0'), "### What's new\n\n- x\n");
});

test('the command line prints the body and exits 2 on a refusal', () => {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'relbody-'));
  try {
    const f = path.join(dir, 'RELEASES.md');
    fs.writeFileSync(f, SAMPLE);
    const ok = spawnSync('node', [SCRIPT, 'v0.2.0', '--file', f], { encoding: 'utf8' });
    assert.strictEqual(ok.status, 0);
    assert.match(ok.stdout, /^### What's new/);
    const bad = spawnSync('node', [SCRIPT, 'v0.3.0', '--file', f], { encoding: 'utf8' });
    assert.strictEqual(bad.status, 2);
    assert.match(bad.stderr, /no section headed/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the repository RELEASES.md newest entry has a user section', async () => {
  const { userSection } = await load();
  const text = fs.readFileSync(path.join(__dirname, '..', 'RELEASES.md'), 'utf8');
  const tag = text.match(/^## (v\d+\.\d+\.\d+) /m)[1];
  const b = userSection(text, tag);
  assert.match(b, /^### What's new/);
  assert.ok(!/Engineering log/.test(b));
});
