// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 229 (PR 227 review F-1 to F-3) and issue 264's release.yml item. Each published statement is
// read against the thing it describes:
//   F-1  scripts/refresh-upstream.mjs resolves a release tag through git/ref/tags only, peeling an
//        annotated tag, so a branch named like the tag cannot supply the resolved commit.
//   F-2  the maintainer page's "all pull requests" link runs a query of every state, with the same
//        exclusions as the census.
//   F-3  the what-is page and its Markdown and llms copies state the merged count the census holds.
//   264  release.yml's header no longer says a person approves each publish.
// Nothing here calls the network or writes inside the tree.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DATA = JSON.parse(read('docs/data/upstream.json'));

// ── F-1 ────────────────────────────────────────────────────────────────────────────────────
const API = 'https://api.github.com';
const REPO = API + '/repos/example/tool';
const sha = (n) => n.toString(16).padStart(40, '0');
const QUERY = 'author:mavericksea-ai is:pr is:merged is:public -org:driftproofhq -user:mavericksea-ai';
const search = (q) => API + '/search/issues?q=' + encodeURIComponent(q) + '&per_page=100&page=1';
const ok = (url, body) => ({ url, status: 200, headers: {}, body });
// One merged PR, one release v1 after it. A branch also named v1 points at sha(99); the tag v1 is
// annotated (object sha(70)) and peels to sha(50). Both commits contain the merge, so only the
// resolution path decides which one is recorded.
function recording({ ref } = {}) {
  const pr = { number: 7, title: 'Fix 7', html_url: 'https://github.com/example/tool/pull/7', user: { login: 'mavericksea-ai' }, state: 'closed', merged: true, merged_at: '2026-06-01T12:00:00Z', merge_commit_sha: sha(7), base: { repo: { full_name: 'example/tool', private: false, html_url: 'https://github.com/example/tool' } } };
  const item = { number: 7, title: 'Fix 7', html_url: pr.html_url, user: pr.user, state: 'closed', repository_url: REPO, pull_request: { url: REPO + '/pulls/7', merged_at: pr.merged_at } };
  const compare = (head) => ok(REPO + '/compare/' + sha(7) + '...' + sha(head), { status: 'ahead', ahead_by: 1, behind_by: 0, head_commit: { sha: sha(head) }, base_commit: { sha: sha(7) }, merge_base_commit: { sha: sha(7) } });
  return [
    ok(search(QUERY), { total_count: 1, incomplete_results: false, items: [item] }),
    ok(search(QUERY.replace('is:merged', 'is:open')), { total_count: 0, incomplete_results: false, items: [] }),
    ok(REPO + '/pulls/7', pr),
    ok(REPO + '/releases?per_page=100&page=1', [{ id: 1, tag_name: 'v1', html_url: 'https://github.com/example/tool/releases/tag/v1', published_at: '2026-06-02T00:00:00Z', created_at: '2026-06-02T00:00:00Z', body: 'Fix #7', draft: false, prerelease: false }]),
    ok(REPO + '/commits/v1', { sha: sha(99) }),
    ok(REPO + '/git/ref/tags/v1', ref || { ref: 'refs/tags/v1', object: { type: 'tag', sha: sha(70) } }),
    ok(REPO + '/git/tags/' + sha(70), { sha: sha(70), object: { type: 'commit', sha: sha(50) } }),
    compare(99), compare(50),
  ];
}
const refresher = () => import(path.join(ROOT, 'scripts', 'refresh-upstream.mjs'));

test('F-1 a tag and a branch share a name: the resolved commit is the peeled tag\'s, never the branch\'s', async () => {
  const { deriveUpstream } = await refresher();
  const [row] = deriveUpstream(recording());
  assert.strictEqual(row.release.tag, 'v1');
  assert.strictEqual(row.release.resolved_commit, sha(50), 'the annotated tag v1 peels to sha(50); sha(99) is the branch v1');
});

test('F-1 a lightweight tag resolves to its own commit', async () => {
  const { deriveUpstream } = await refresher();
  const [row] = deriveUpstream(recording({ ref: { ref: 'refs/tags/v1', object: { type: 'commit', sha: sha(50) } } }));
  assert.strictEqual(row.release.resolved_commit, sha(50));
});

for (const [label, ref] of [
  ['a branch ref', { ref: 'refs/heads/v1', object: { type: 'commit', sha: sha(99) } }],
  ['a prefix-matched list of refs', [{ ref: 'refs/tags/v1-rc', object: { type: 'commit', sha: sha(99) } }]],
  ['a tag of another name', { ref: 'refs/tags/v10', object: { type: 'commit', sha: sha(99) } }],
  ['a tree object', { ref: 'refs/tags/v1', object: { type: 'tree', sha: sha(99) } }],
]) {
  test(`F-1 the tag lookup answers ${label}: the refresh refuses`, async () => {
    const { deriveUpstream } = await refresher();
    assert.throws(() => deriveUpstream(recording({ ref })), /tag resolution/);
  });
}

// ── F-2 ────────────────────────────────────────────────────────────────────────────────────
test('F-2 the maintainer page\'s "all pull requests" link runs every state with the census\'s exclusions', () => {
  const html = read('docs/maintainer/index.html');
  const links = [...html.matchAll(/<a href="https:\/\/github\.com\/pulls\?q=([^"]+)">([^<]*)<\/a>/g)];
  const all = links.filter((m) => /\ball\b/i.test(m[2]));
  assert.strictEqual(all.length, 1, 'one link whose label says all pull requests');
  const q = decodeURIComponent(all[0][1].replace(/&amp;/g, '&')).split(' ');
  for (const state of ['is:open', 'is:merged', 'is:closed']) assert.ok(!q.includes(state), `the "all" query is limited by ${state}`);
  const census = DATA.query.split(' ').filter((t) => t !== 'is:merged');
  assert.deepStrictEqual(q, census, 'the "all" query is the merged census query without its state');
  for (const t of q.filter((x) => x.startsWith('-'))) {
    const name = t.split(':')[1];
    assert.ok(all[0][2].includes('other projects') || all[0][2].includes(name), `the label says what ${t} leaves out`);
  }
});

// ── F-3 ────────────────────────────────────────────────────────────────────────────────────
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
for (const rel of ['docs/what-is-driftproof/index.html', 'docs/what-is-driftproof/index.md', 'docs/llms-full.txt']) {
  test(`F-3 ${rel} states the merged count the census holds`, () => {
    // The section's own sentence. The paper's abstract, carried whole in llms-full.txt, has a dated
    // "five are merged" of 30 September 2026; that is a historical record, not this census.
    const said = [...read(rel).matchAll(/sends fixes upstream\. (\w+) are merged\b/gi)].map((m) => m[1].toLowerCase());
    assert.ok(said.length >= 1, 'the page states a merged count');
    const n = DATA.pulls.length;
    for (const w of said) assert.strictEqual(w, WORDS[n] || String(n), `"${w} are merged" against ${n} merged rows in docs/data/upstream.json`);
  });
}

// ── issue 264 ──────────────────────────────────────────────────────────────────────────────
test('264 release.yml\'s header names the green sweep as the gate and claims no required reviewer', () => {
  const text = read('.github/workflows/release.yml');
  const lines = text.split('\n');
  const header = lines.slice(0, lines.findIndex((l) => !l.startsWith('#'))).map((l) => l.replace(/^#\s?/, '')).join(' ').replace(/\s+/g, ' ');
  assert.ok(!/required reviewer/i.test(header.replace(/no required reviewer/gi, '')), 'the header says the environment holds a required reviewer');
  assert.ok(!/person approves/i.test(header), 'the header says a person approves each publish');
  assert.match(header, /green release sweep/i, 'the header names the green release sweep');
  assert.match(text, /^ {4}environment: release$/m, 'the job stays in the release environment');
});
