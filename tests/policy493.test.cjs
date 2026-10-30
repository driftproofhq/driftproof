// SPDX-License-Identifier: Apache-2.0
// Issue 493: Maverick's four policy cuts, with the retained review boundary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\s+/g, ' ');
const pipeline = import('../scripts/pipeline.mjs');
const file = filename => ({ filename, patch: '+Explain the published claim and receipt verdict.' });
const green = [{ name: 'gates', status: 'completed', conclusion: 'success' }];

test('493 public claims alone do not require final review; material changes and credentials do', () => {
  for (const name of ['CLAUDE.md', 'CONSTITUTION.md', 'RUNBOOK.md']) {
    const text = read(name);
    assert.match(text, /[Mm]aterial behavio[u]?r, security (?:or|and) contract changes/);
    assert.match(text, /credentials/);
    assert.doesNotMatch(text, /final review for public claims|Public claims and material|public content and report QA|needs independent public content review|independent QA record/);
  }
  assert.match(read('CONSTITUTION.md'), /Public claims alone do not require independent final review/);
  assert.match(read('CONSTITUTION.md'), /Correct an unsupported public claim promptly on every surface repeating it/);
});

test('493 internal measurement tooling takes a regression test and acceptance note', () => {
  const text = read('CONSTITUTION.md');
  assert.match(text, /Internal measurement tooling[\s\S]*only Driftproof runs/);
  assert.match(text, /not shipped in the npm package or behind a public claim/);
  assert.match(text, /regression test and a PR acceptance note, not a spec amendment or new acceptance criteria/);
  assert.match(text, /Specs stay for anything shipped in the npm package and anything behind a public claim/);
});

test('493 only public text pages skip review; nightly coverage remains', () => {
  // Issue 533: the exemption procedure has one current home in RUNBOOK.
  const policy = read('RUNBOOK.md');
  assert.match(policy, /Only README\.md, RELEASES\.md and docs\/ or reports\/ text pages/);
  assert.match(policy, /Every specs\/ change requires review/);
  assert.match(policy, /class:internal does not waive review/);
  const text = read('RUNBOOK.md');
  assert.match(text, /PR gates check alone/);
  assert.match(text, /no .approve. review and no box-only history gates/);
  assert.match(text, /The nightly still runs everything/);
});

test('493 public docs state features plainly and link to their specs', () => {
  const text = read('CONSTITUTION.md');
  assert.match(text, /Public docs \(README and site pages\) describe each feature in a few plain sentences and link to the spec for detail/);
  assert.match(text, /They do not document internals/);
  assert.match(text, /spec 031.s claims discipline and spec 035.s wording rules/);
});

test('493 docs and public claims merge on gates even with product labels or no linked issue', async () => {
  const { requiresReview, decideMerge } = await pipeline;
  for (const labels of [[], ['class:internal'], ['class:product']]) {
    for (const issueLabels of [null, [], ['class:product']]) {
      for (const filename of ['README.md', 'docs/index.html', 'docs/guide/index.md', 'reports/report-016.md']) {
        const required = requiresReview(labels, issueLabels, [file(filename)]);
        assert.equal(required, false, filename);
        assert.equal(decideMerge(['ready', ...labels], green, issueLabels, required).merge, true, filename);
      }
    }
  }
});

test('493 public prose needs no approval; a gate failure still blocks', async () => {
  const { requiresReview, decideMerge } = await pipeline;
  const labels = ['ready', 'class:internal'];
  const required = requiresReview(labels, null, [file('README.md')]);
  assert.equal(required, false);
  assert.equal(decideMerge(labels, green, null, required).merge, true);
  for (const checks of [[], [{ ...green[0], conclusion: 'failure' }], [{ ...green[0], status: 'in_progress' }]]) {
    assert.equal(decideMerge(labels, checks, null, required).merge, false);
  }
});

test('493 plants: labels and docs mixed with material code or credentials cannot waive review', async () => {
  const { requiresReview, decideMerge } = await pipeline;
  for (const filename of ['lib/receipt.js', 'bin/driftproof', 'spec/receipt.schema.json',
    'scripts/pipeline.mjs', '.github/workflows/review.yml', 'docs/islands/quiz.js',
    'credentials.md', 'docs/api-key.html']) {
    const required = requiresReview(['class:internal'], [], [file('README.md'), file(filename)]);
    assert.equal(required, true, filename);
    assert.equal(decideMerge(['ready', 'class:internal'], green, [], required).merge, false, filename);
    assert.equal(requiresReview(['class:internal'], [], [{ ...file('docs/guide.md'), previous_filename: filename }]), true, 'rename ' + filename);
  }
  assert.equal(requiresReview(['class:internal'], [], [{ filename: 'README.md', patch: '+publish a credential' }]), true);
  assert.equal(requiresReview([], [], null), true);
  assert.equal(requiresReview([], [], [{ filename: 'docs/index.html', patch: '' }]), true);
});

test('493 report instructions no longer require a QA record', () => {
  assert.doesNotMatch(read('scripts/prepare-report-005.js'), /write the QA record/);
  assert.match(read('RUNBOOK.md'), /Maverick approves publication/);
});

test('493 executable changes inside HTML retain review', async () => {
  const { requiresReview } = await pipeline;
  for (const patch of ['+<script>run()</script>', '+<div data-island="quiz">', '+<button onclick="run()">']) {
    assert.equal(requiresReview(['class:internal'], [], [{ filename: 'docs/index.html', patch }]), true);
  }
});

// PR 502: these plants supply filenames and patch text, never file contents.
for (const filename of ['CONSTITUTION.md', 'CLAUDE.md', 'RUNBOOK.md', 'DECISIONS.md', 'DESIGN.md', 'AUTHORING.md']) {
  test('493 F-1 governance refuses a gates-only merge: ' + filename, async () => {
    const { requiresReview, decideMerge } = await pipeline;
    assert.equal(requiresReview(['class:internal'], [], [file(filename)]), true);
    for (const labels of [[], ['class:internal'], ['class:product']]) {
      for (const issueLabels of [null, [], ['class:product']]) {
        const required = requiresReview(labels, issueLabels, [file(filename)]);
        assert.equal(required, true);
        assert.equal(decideMerge(['ready', ...labels], green, issueLabels, required).merge, false);
        assert.equal(requiresReview(labels, issueLabels, [file('README.md'), file(filename)]), true);
        assert.equal(requiresReview(labels, issueLabels, [{ ...file('docs/guide.md'), previous_filename: filename }]), true);
      }
    }
  });
}

for (const filename of ['tests/gate.js', 'specs/123-example/check.test.cjs',
  'specs/123-example/probes/check.test.mjs', 'specs/123-example/check.test.js', 'package.json', 'package-lock.json']) {
  test('493 F-2 checks and dependency identity retain review: ' + filename, async () => {
    const { requiresReview, decideMerge } = await pipeline;
    const required = requiresReview(['class:internal'], [], [file(filename)]);
    assert.equal(required, true);
    assert.equal(decideMerge(['ready', 'class:internal'], green, [], required).merge, false);
    assert.equal(requiresReview(['class:internal'], null, [{ ...file('docs/guide.md'), previous_filename: filename }]), true);
  });
}

for (const patch of ['+<iframe src="/frame">', '+<object data="/object">', '+<embed src="/embed">',
  '+<meta http-equiv="refresh" content="0;url=/next">', '+<meta content="default-src self" HTTP-EQUIV="Content-Security-Policy">',
  '+<base href="/base/">', '+<form method="post" action="/submit">',
  '-<form\n-  action="/submit">', '+<link rel="stylesheet" href="/style.css">',
  '-<LINK\n- HREF="/preload">', '+<button formaction="/submit">', '+<input FORMACTION="/submit">',
  '+<svg>', '+<use href="/image.svg#icon">', '+<use xlink:href="/image.svg#icon">']) {
  test('493 F-3 active page content retains review: ' + patch, async () => {
    const { requiresReview, decideMerge } = await pipeline;
    const required = requiresReview(['class:internal'], [], [{ filename: 'docs/index.html', patch }]);
    assert.equal(required, true);
    assert.equal(decideMerge(['ready', 'class:internal'], green, [], required).merge, false);
  });
}

test('493 review repair keeps public prose eligible for gates-only admission', async () => {
  const { requiresReview } = await pipeline;
  for (const filename of ['README.md', 'RELEASES.md', 'docs/guide/index.html', 'reports/report-016.md']) {
    assert.equal(requiresReview(['class:product'], ['class:product'], [file(filename)]), false);
  }
  assert.equal(requiresReview(['class:internal'], [], [{ filename: 'docs/index.html', patch: '+<meta name="description" content="A plain description">' }]), false);
});

// PR 502, second review: no unlisted path may inherit the prose exemption.
for (const filename of ['tests/receipt-dir-writers.js', 'tests/public-exclusion.js', 'tests/policy493.test.cjs',
  '.github/prompts/approve.md', '.github/actions/windows-setup/action.yml', '.github/windows-ci/check.cjs',
  'future-tools/check.js', 'specs/123-example/r2-driver.mjs', 'specs/123-example/notes/prose.md',
  'docs/robots.txt', 'docs/.well-known/security.txt', 'docs/.well-known/nested/page.md']) {
  test('493 deny by default, including rename sources: ' + filename, async () => {
    const { requiresReview, decideMerge } = await pipeline;
    for (const labels of [[], ['class:internal'], ['class:product']]) {
      for (const issueLabels of [null, [], ['class:product']]) {
        for (const files of [[file(filename)], [file('README.md'), file(filename)],
          [{ ...file('docs/guide.md'), previous_filename: filename }]]) {
          const required = requiresReview(labels, issueLabels, files);
          assert.equal(required, true);
          assert.equal(decideMerge(['ready', ...labels], green, issueLabels, required).merge, false);
        }
      }
    }
  });
}

test('493 spec Markdown always requires review, including baselines, criteria and rename sources', async () => {
  const { requiresReview, decideMerge } = await pipeline;
  for (const labels of [[], ['class:internal'], ['class:product']]) {
    for (const issueLabels of [null, [], ['class:product']]) {
      for (const patch of ['+Plain spec prose.', '+**Base:** abc1234', '+AC-1: change the contract.']) {
        const spec = { filename: 'specs/123-example/spec.md', patch };
        for (const files of [[spec], [file('README.md'), spec],
          [{ ...spec, filename: 'docs/guide.md', previous_filename: spec.filename }]]) {
          const required = requiresReview(labels, issueLabels, files);
          assert.equal(required, true);
          assert.equal(decideMerge(['ready', ...labels], green, issueLabels, required).merge, false);
        }
      }
    }
  }
});

test('493 absent file evidence cannot establish the prose exemption', async () => {
  const { requiresReview } = await pipeline;
  for (const files of [null, [], [{ patch: '+A change with no filename' }]]) {
    assert.equal(requiresReview(['class:internal'], [], files), true);
  }
});
