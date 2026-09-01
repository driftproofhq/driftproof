// SPDX-License-Identifier: Apache-2.0
'use strict';

// Assertion scope — what a counting, matching or existence assertion is allowed
// to read, and the register of ways such an assertion has been narrower than the
// criterion it stood for.
//
// WHY THIS EXISTS. Four findings in four consecutive loops share one shape: the
// assertion passes for a reason adjacent to the property. A window instead of a
// file; stripped text instead of the document; a name instead of the thing; a
// call site's spelling instead of its behaviour. Each was caught by a person or
// a fork-context approval reading a run, never by the gate containing it, and
// the fourth reached the live site. DECISIONS (2026-08-29) recorded that a
// fourth crossing argues for changing how assertions are drafted rather than for
// a fourth patch.
//
// WHY IT IS DATA. `B-12` and DECISIONS #28 make the same argument from two
// directions: a rule that only a careful reader enforces is not a control, it is
// a note. The classes are enumerated here so a checker can read them, so a sixth
// class is an append, and so CONSTITUTION's quality bar can be held to naming
// nothing this register lacks.
//
// WHY IN tests/. `specs/` is excluded from the published tree and no workflow
// runs a spec gate, so a rule living only beside its spec is never executed by a
// build (finding F-010-H). The repo gate runs this one.
//
// Nothing here reads a network or a provider.

const fs = require('fs');
const path = require('path');

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

// ── the register ────────────────────────────────────────────────────────────

const NARROWING_CLASSES = [
  {
    id: 'window-vs-file',
    statement: 'The assertion reads a character window around a landmark rather than the whole artifact.',
    instances: ['F-012-B'],
    drafting: 'Count or match over the whole artifact. Use a window only to locate a landmark whose PRESENCE is the property, never to bound what the count may see.',
    mutation: 'Plant the violation as far from the landmark as the artifact allows.',
  },
  {
    id: 'visible-vs-attribute',
    statement: 'The assertion reads stripped visible text, so a claim carried in an attribute is invisible to it.',
    instances: ['F-012-D'],
    drafting: 'Read attribute values as well as visible text — `content`, `alt`, `title`, `aria-label`. A meta description is published prose: it is what a search result and a link preview show.',
    mutation: 'Plant the violation in a `content` attribute.',
  },
  {
    id: 'name-vs-thing',
    statement: 'The assertion matches the spelling of an identifier, or a naming convention adjacent to the property, rather than the thing named.',
    instances: ['F-008-A', 'F-011-M', 'F-009-K'],
    drafting: 'Anchor to the observable. Where a static check is unavoidable, pin the SET of sites and require each to carry a named behavioural probe, so a new site is red until someone writes one.',
    mutation: 'Add a decoy that carries the name and does nothing.',
  },
  {
    id: 'neighbourhood-vs-behaviour',
    statement: 'The assertion reads source text near the behaviour — a call site, a literal, an exit code any failure produces — rather than the behaviour.',
    instances: ['F-011-P', 'G-4', 'G-5', 'F-008-C'],
    drafting: 'Run the shipped thing and read what it did. A mutation must require the SPECIFIC refusal to disappear, never merely a different exit code; a green-before guard must probe behaviour, not grep the literal the mutation removes.',
    mutation: 'Break the subject for an unrelated reason and require the probe to stay red.',
  },
  {
    id: 'helper-vs-product-path',
    statement: 'The criterion is satisfied in a helper module that no bin/ or lib/ product path invokes, so the behaviour exists beside the product rather than inside it.',
    instances: ['spec 014 AC-6 — lib/reuse.js held the baseline-reproduction precondition, its probes exercised it, and nothing under bin/ or lib/ required the module; `driftproof diff` emitted verdicts with the precondition unchecked (approval round 1, 2026-08-30)'],
    drafting: 'Assert on the path that ships. Name the product entry the behaviour must be reached through — the CLI command, the exported function a bin/ file calls — and resolve the require graph from there rather than requiring the helper directly. A probe that requires the module under test proves the module works, which is a different claim from the product doing it.',
    mutation: 'Leave the helper correct and cut the edge: delete the require from the product path and require the probe to go red. A mutation that breaks the helper tests the helper, not the wiring.',
  },
  {
    id: 'fixture-vs-real-artifact',
    statement: 'The assertion exercises a fixture built to the schema the author had in mind, never an artifact the repository actually holds — so a reader that cannot read the archive passes every test there is.',
    instances: [
      'F-015-C — bandOf() read only the v0.5 `generation` block, so the cross-version precondition returned baseline_unmeasured on EVERY v0.4 pair; 487 repo assertions, 44 spec assertions and three approval rounds passed because none of them had handed it a receipt out of receipts/ (2026-08-30)',
      'F-015-B — the refusal renderer was only ever exercised on pairs whose refusal it had itself constructed',
    ],
    drafting: 'Select the subject FROM the repository, by what it records rather than by path or filename — a version, a level, a shape — and fail loudly when the archive holds no such artifact. A control that exists to meet an older artifact must be handed one.',
    mutation: 'Point the assertion at a hand-built fixture of the same shape and require it to go red; if it stays green the assertion was never reading the archive.',
  },
  {
    id: 'absence-vs-unreadable',
    statement: 'A search reports absence because it could not read the artifact, not because the thing is missing. Indistinguishable, from the outside, from the property holding.',
    instances: ['tests/essay-grounding.js — four literal NUL sentinels, 2026-08-29'],
    drafting: 'Do not ship the hazard: a source escape gives the same byte at runtime with no literal NUL in the file, and the whole class goes away. Searching with `grep -a` is ADVICE here, not a checked rule, and deliberately so — whether a plain search goes blind depends on the installed tool (ugrep 7.8.4 on this host reports no-match on NUL-bearing content; GNU grep reports a match), so it is not a property of the artifact and no assertion can hold it. A convention that cannot be verified from the artifact is a note, not a control.',
    mutation: 'Plant the hazard BEFORE the needle: a match preceding it is found either way and proves nothing.',
  },
];

// ── scope readers ───────────────────────────────────────────────────────────

const ATTRS_CARRYING_PROSE = ['content', 'alt', 'title', 'aria-label'];

function attributeText(src) {
  const out = [];
  for (const a of ATTRS_CARRYING_PROSE) {
    const re = new RegExp(`\\b${a}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'gi');
    for (const m of src.matchAll(re)) out.push(m[2] !== undefined ? m[2] : m[3]);
  }
  return out;
}

function visibleText(src) {
  return src
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');
}

// The document as an assertion is allowed to see it: what a reader reads, plus
// what a search engine, a link preview and a screen reader read. F-012-D shipped
// because the second half was not part of "the document".
function documentText(src) {
  return [visibleText(src)].concat(attributeText(src)).join(' · ').replace(/\s+/g, ' ');
}

// Every occurrence, over the whole text. Returns a list of violations; empty is
// the pass. One optional adjective is allowed between the number and the noun
// ("six published reports"), which a bare adjacency test refused (F-010-J).
function countClaims(text, noun, n) {
  const low = text.toLowerCase();
  const re = new RegExp(`\\b(${WORDS.join('|')})\\s+(?:[a-z-]+\\s+)?${noun.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  const bad = [];
  for (const m of low.matchAll(re)) {
    if (m[1] !== WORDS[n]) bad.push(`says "${m[0]}" where the repository has ${n}`);
  }
  return [...new Set(bad)];
}


// ── published invocations of the runner (spec 018 AC-4) ─────────────────────
//
// A published invocation is anything a reader copies that ends up running the
// suite. It comes in TWO shapes and the first draft of AC-4 read only one:
//   1. a command string   — `npx driftproof run <dir> [--max-usd N] [--max-calls N]`
//   2. an Action input block — `uses: driftproofhq/driftproof@vX` + `with:` keys
// Reading only shape 1 left README's canonical CI recipe carrying `max-usd: '2'`
// through the very loop that recalibrated that literal (`window-vs-file`).
//
// Returns [{ where, shape, capUsd, capCalls }] with caps RESOLVED — the explicit
// value when the invocation sets one, else the shipped default passed in.
function publishedInvocations(files, defaults) {
  const out = [];
  for (const { rel, text } of files) {
    for (const m of text.matchAll(/^.*?(?:npx )?driftproof run [^\n`<]*$/gm)) {
      const line = m[0].trim();
      if (/\$\{PROJECT_NAME\}\s+run </.test(line)) continue;
      if (!/<skill-dir>|my-skill|skills\/|\$\{rel\(/.test(line)) continue;
      out.push({
        where: rel, shape: 'command', line,
        capUsd: Number((line.match(/--max-usd\s+([\d.]+)/) || [])[1] || defaults.usd),
        capCalls: Number((line.match(/--max-calls\s+(\d+)/) || [])[1] || defaults.calls),
      });
    }
    for (const m of text.matchAll(/uses:\s*driftproofhq\/driftproof@[^\n]*\n([\s\S]*?)(?=\n\s*(?:-\s|```|$))/g)) {
      const block = m[1];
      // A commented-out input is documentation, not an override.
      const val = (k) => {
        const r = new RegExp(`^\\s*${k}:\\s*'?([\\d.]+)'?`, 'm');
        const line = block.split('\n').find((l) => r.test(l) && !/^\s*#/.test(l));
        return line ? (line.match(r) || [])[1] : undefined;
      };
      const u = val('max-usd'); const c = val('max-calls');
      out.push({
        where: rel, shape: 'action-inputs', line: `uses: driftproofhq/driftproof (max-usd=${u || 'default'}, max-calls=${c || 'default'})`,
        capUsd: Number(u == null ? defaults.usd : u),
        capCalls: Number(c == null ? defaults.calls : c),
      });
    }
  }
  return out;
}

// ── a release entry's required facts (spec 018 AC-6) ────────────────────────
//
// ONE DEFINITION. The first draft of spec 018 carried this predicate twice — in
// its own gate and in the repo gate — and the two disagreed inside a single loop
// (one accepted "never published to npm", the other required "not published to
// npm"). The rule lives here and both vantages call it, for the reason
// `signedReceiptClaims` below lives here.
//
// Returns the list of facts the entry does NOT carry; empty is the pass.
const RELEASE_ENTRY_FACTS = [
  { id: 'stale-since', re: /5e08ba2/, says: 'the commit the caps went stale at (5e08ba2)' },
  { id: 'not-published', re: /(not|never) published to npm/i, says: 'that 0.7.0 was tagged and not published to npm' },
  { id: 'guard-worked', re: /guard (worked|did its job|was right)/i, says: 'that the guard worked' },
  { id: 'aborted', re: /abort/i, says: 'that the Action and CLI aborted at defaults' },
];

function releaseEntryFacts(releasesText, version) {
  const seg = String(releasesText).split(/^## /m).find((s) => s.startsWith(version));
  if (!seg) return [`RELEASES.md carries no ${version} entry`];
  return RELEASE_ENTRY_FACTS.filter((f) => !f.re.test(seg)).map((f) => f.says);
}

// ── the published-tree scope ────────────────────────────────────────────────
//
// DERIVED FROM THE SHIPPING RULE, never hand-listed. Spec 013's AC-11 scanned
// `README.md package.json docs/*.html docs/**/*.html`, which is a plausible list
// and not the scope its own criterion named — so `spec/RECEIPT.md` kept claiming
// receipts are "signed" while shipping to the public repo AND to npm, and the
// assertion written to close the window-vs-file class was itself an instance of
// it. The file set now comes from `EXCLUDE_RE` in the publish script, so it
// cannot drift from what actually ships.
function publishedFiles(root) {
  const { execFileSync } = require('child_process');
  const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const src = fs.readFileSync(path.join(root, 'scripts', 'build-public.sh'), 'utf8');
  const m = src.match(/EXCLUDE_RE='([^']+)'/) || src.match(/EXCLUDE_RE="([^"]+)"/);
  if (!m) throw new Error('cannot read EXCLUDE_RE out of scripts/build-public.sh');
  const exclude = new RegExp(m[1]);
  return tracked.filter((f) => !exclude.test(f));
}

// A FROZEN receipt schema is the record of what that version said. Correcting it
// would delete the evidence rather than the error, so it is exempt BY RULE —
// matched on the version-pinned name — and never by being left off a list.
const FROZEN_SCHEMA = /^spec\/receipt\.v\d+(\.\d+)*\.schema\.json$/;

// Sentences claiming a receipt is signed, over the whole published tree. Roadmap
// sections are where signing may appear, and a sentence that disclaims it in
// place ("not authenticity", "a promissory note") is the honest form.
function signedReceiptClaims(root) {
  const out = [];
  for (const rel of publishedFiles(root)) {
    if (FROZEN_SCHEMA.test(rel)) continue;
    if (!/\.(md|html|json|js|yml|yaml)$/.test(rel)) continue;
    let raw;
    try { raw = fs.readFileSync(path.join(root, rel), 'utf8'); } catch { continue; }
    if (!/sign(ed|ing|ature)/i.test(raw)) continue;
    // THE SCANNER AND ITS CALLERS ARE SKIPPED BY RULE, not by a list: any file
    // that names this function is talking ABOUT the check. A scanner that
    // matches its own source reports a defect it introduced itself — the
    // self-matching grep of B-12, which this gate already committed once in
    // NFR-1 and would commit again here.
    if (raw.includes('signedReceiptClaims')) continue;
    const sections = /\.html$/.test(rel)
      ? raw.split(/<h[12][^>]*>/i).map((sec) => ({ head: sec.split(/<\/h[12]>/i)[0], body: sec }))
      : raw.split(/^#+ /m).map((sec) => ({ head: sec.split('\n')[0], body: sec }));
    for (const sec of sections) {
      if (/roadmap|not in this release|open question/i.test(sec.head)) continue;
      for (const mm of documentText(sec.body).matchAll(/[^.]*\bsign(ed|ing|ature)\b[^.]*\./gi)) {
        const sentence = mm[0];
        // A sentence that DENIES the property is the honest form, not a claim of
        // it: the correction itself has to be sayable in the shipped tree.
        if (/roadmap|planned|not yet|future|will be|signed up|promissory|not\s+authenticity|does not sign/i.test(sentence)) continue;
        if (/not\s+signed|hash-verified|rather than signed|not a signature|weaker property/i.test(sentence)) continue;
        if (/receipt/i.test(sentence)) out.push(`${rel}: ${sentence.trim().slice(0, 100)}`);
      }
    }
  }
  return out;
}

// ── the product-path reader (helper-vs-product-path) ────────────────────────
//
// Resolves the require graph and answers TWO different questions, because the
// 014 defect lived in the gap between them.
//
//   PRODUCT reach   — from `bin/`, what a user running the CLI actually causes
//                     to load. This is what the class's sentence means by "a
//                     bin/ or lib/ product path".
//   HARNESS reach   — from `scripts/` and `tests/`, this repository's own
//                     executables and the gate that runs at publish time.
//
// `lib/reuse.js` was HARNESS-reached and PRODUCT-unreached: its probes loaded
// it, `tests/gate.js` loaded it, and `driftproof diff` never did. A reader that
// asked only "does anything require this?" would have said yes and been useless.
//
// STATIC, and it says so. It reads literal relative `require()` calls, which is
// what this repository uses; a computed require would be invisible to it. That
// is a stated limit, not a silent one — the class's drafting rule asks for a
// behavioural assertion on the product path, and this is the standing check that
// no module has quietly left it.
const PRODUCT_ENTRY_DIRS = ['bin'];
const HARNESS_ENTRY_DIRS = ['scripts', 'tests'];

// A lib module may be harness-only, but it must be DECLARED so, with a reason.
// Pinning the SET is the name-vs-thing drafting rule applied here: a module that
// leaves the product path is red until somebody writes down why, which is the
// sentence nobody wrote for `lib/reuse.js`.
const HARNESS_ONLY_LIB = {
  'lib/hygiene.js': 'the confidentiality scanner. Runs in the merge check and in the publish gate; the CLI never scans, so it is correctly outside the product path.',
  'lib/runner.js': 'the gate engine itself (`Gate`), used by tests/gate.js. It is harness by definition and shipping it is an accident of `files: ["lib/"]`, not a product path.',
};

function requiredPaths(file) {
  let src;
  try { src = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const m of src.matchAll(/require\(\s*['"`](\.[^'"`]+)['"`]\s*\)/g)) {
    let p = path.resolve(path.dirname(file), m[1]);
    if (!fs.existsSync(p) && fs.existsSync(`${p}.js`)) p = `${p}.js`;
    else if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.js');
    if (fs.existsSync(p)) out.push(p);
  }
  return out;
}

function reachFrom(root, dirs) {
  const seen = new Set();
  const queue = [];
  for (const dir of dirs) {
    const d = path.join(root, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isFile()) queue.push(p);
    }
  }
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    for (const r of requiredPaths(f)) queue.push(r);
  }
  return seen;
}

const libModules = (root) => {
  const d = path.join(root, 'lib');
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((f) => f.endsWith('.js')).map((f) => `lib/${f}`).sort();
};

// Does a PRODUCT path — `bin/`, transitively — reach `rel`?
function productPathReaches(root, rel) {
  return reachFrom(root, PRODUCT_ENTRY_DIRS).has(path.join(root, rel));
}

// Modules nothing reaches at all: not the product, not the harness. Dead weight
// in a shipped directory.
function orphanModules(root) {
  const reached = new Set([...reachFrom(root, PRODUCT_ENTRY_DIRS), ...reachFrom(root, HARNESS_ENTRY_DIRS)]);
  return libModules(root).filter((rel) => !reached.has(path.join(root, rel)));
}

// THE ONE THAT CATCHES THE 014 DEFECT: modules the harness reaches and the
// product does not, minus the ones declared above with a reason.
function undeclaredHarnessOnly(root) {
  const product = reachFrom(root, PRODUCT_ENTRY_DIRS);
  const harness = reachFrom(root, HARNESS_ENTRY_DIRS);
  return libModules(root).filter((rel) => {
    const abs = path.join(root, rel);
    return harness.has(abs) && !product.has(abs) && !(rel in HARNESS_ONLY_LIB);
  });
}

// ── documented judge sampling (spec 015 AC-5) ───────────────────────────────
//
// ONE DEFINITION, called from both the spec gate and the repo gate. Two copies
// of a detector are two definitions of the criterion, and they drift.
//
// THE CRITERION IS "AT LEAST 2", NOT "NOT 1". The first draft matched the
// literal `--samples 1`, so `--samples 0` and `--samples=0` both passed a check
// written to require a judge spread — name-vs-thing, matching the spelling of
// the value instead of reading it. The count is parsed and compared.
//
// The command capture also stopped at the first quote or backtick, so
// `driftproof run ./s --models "claude-sonnet-5" --samples 0` was read only as
// far as the opening quote and its sample count was never seen. It now runs to
// end of line: an invocation is a command line, and a line is where it ends.
function judgeSampleViolations(files, { min = 2 } = {}) {
  const bad = [];
  let total = 0;
  for (const [rel, text] of files) {
    if (rel.startsWith('specs/')) continue;
    // A FILE THAT NAMES THIS FUNCTION IS TALKING ABOUT IT, and is skipped by
    // rule rather than by a list — the same rule `signedReceiptClaims` applies
    // above, and for the same reason: widening the capture to end-of-line made
    // this scanner match the example invocation in its own comment and report a
    // violation it had introduced itself (B-12).
    if (text.includes('judgeSampleViolations')) continue;
    for (const m of text.matchAll(/driftproof\s+run\b[^\n]*/g)) {
      const cmd = m[0];
      total++;
      const k = cmd.match(/--samples\s*=?\s*(\d+)/);
      if (k && Number(k[1]) < min) bad.push(`${rel}: ${cmd.trim().slice(0, 90)}`);
    }
  }
  return { total, bad };
}


// ── the archive, as a subject (fixture-vs-real-artifact) ────────────────────
//
// SELECTS BY WHAT A RECEIPT RECORDS, never by path or filename. F-009-K's lesson
// applied to the archive: a name is not the thing. A relocated or renamed receipt
// still resolves, and a fixture cannot stand in for one because the walk is
// rooted at `receipts/` and nothing else.
function archiveReceipts(root, { schemaVersion = null, verificationLevel = null } = {}) {
  const dir = path.join(root, 'receipts');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith('.json')) continue;
      let r;
      try { r = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
      if (!r || typeof r.schema_version !== 'string' || !r.results || !Array.isArray(r.results.cases)) continue;
      if (schemaVersion && r.schema_version !== schemaVersion) continue;
      if (verificationLevel && r.verification_level !== verificationLevel) continue;
      out.push({ file: path.relative(root, p), receipt: r });
    }
  };
  walk(dir);
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

// ── per-case band construction sites (spec 016 AC-1) ────────────────────────
//
// Three copies of the band reader existed — `lib/diff.js`, `lib/revision.js` and
// `lib/reuse.js` — and the one a cross-version control depended on was the only
// one that could not read the archive. The set is PINNED here with a reason per
// non-comparison site, so a NEW construction is unclassified and therefore red
// until somebody says which kind it is. That is the name-vs-thing drafting rule:
// where a static check is unavoidable, pin the set.
const BAND_SITE_KIND = {
  'lib/reuse.js': 'definition — this IS the shared definition',
  'lib/diff.js': 'comparison',
  'lib/revision.js': 'comparison',
  'lib/importers.js': 'emission — builds a receipt from an imported result; compares nothing',
  'lib/receipt.js': 'emission — assembles a receipt aggregate',
  'lib/run.js': 'emission — writes the draw set a receipt records',
  'lib/stats.js': 'aggregation helper — takes bands, does not read a case',
  // SURFACED BY WIDENING THE ANCHOR (spec 016, round 5). Anchoring on any brace
  // rather than on `{ mean:` brought case-RESULT constructions into view. They
  // build a case, they compare nothing, and they are classified rather than
  // filtered so that the set stays pinned: a new one is unclassified, and
  // therefore red, until somebody says which kind it is.
  'lib/judge.js': 'emission — assembles a judge result from its own samples',
  'scripts/prepare-report.js': 'emission — stub case results for report staging',
  'scripts/prepare-report-002.js': 'emission — stub case results for report staging',
  'scripts/prepare-report-003.js': 'emission — stub case results for report staging',
  'scripts/prepare-report-004.js': 'emission — stub case results for report staging',
  'scripts/prepare-report-005.js': 'emission — stub case results for report staging',
};

// WHAT THE ENUMERATOR READS — stated exactly, because three approval rounds have
// now found this note claiming more than the code does.
//
// IT READS: an object literal, in a file directly under `lib/`, `scripts/` or
// `bin/`, whose `mean` key and whose `stddev`/`sd` key both fall within a
// four-line forward window from an opening brace, outside a comment, and which
// does not mention `mean_score` (that is the receipt-level aggregate, a different
// subject).
//
// IT CLASSIFIES PER FILE, NOT PER CONSTRUCTION, and that distinction is load-
// bearing rather than pedantic. `BAND_SITE_KIND` is keyed by path, so EVERY
// literal in a file marked `emission` is absorbed by that file's reason.
// Measured: the same unrouted per-case band appended to `lib/judge.js` yields
// `unclassified: []`, while in `lib/diff.js` it is surfaced as `routed: false`.
// Six files joined the absorbing set in the commit that first wrote this note, so
// the claim widened in the same change as the set. What the reader therefore
// protects is that a band appears in a file NOBODY HAS CLASSIFIED, and that every
// file classified `comparison` routes — not that no unrouted band exists anywhere.
// A finer key is a design change to this layer and is filed, not taken here.
//
// IT DOES NOT READ, and these are not oversights but the boundary of a static
// heuristic:
//   · a literal whose two keys are more than four lines apart;
//   · a band assembled by a helper and returned as a bare object, which does not
//     look like a literal at any call site;
//   · a second construction in a file already classified as anything but
//     `comparison` — see the per-file note above;
//   · anything below the first level of those directories.
//
// The history is worth keeping because it is the argument for stopping. The first
// version required both keys on ONE line and walked `lib/` only; widening it to a
// window across three directories closed the case that had been found and left
// two more, of which the key-order one is closed above. Brace-matching the whole
// literal was tried next and REJECTED, measured: it flags the across-draw
// aggregate in `lib/sampling.js` and a dozen emission sites under `scripts/`,
// turning a tripwire into a classification chore for objects that compare
// nothing. There is always an N+1 for a static reader, and the useful move is to
// bound it honestly rather than to keep widening.
//
// SO THIS IS A TRIPWIRE, NOT A PROOF. It catches the shapes a person actually
// writes and says so. AC-1's weight is carried by the behavioural half, which
// asserts the two comparison paths produce identical bands — number for number,
// on a real receipt — and by the mutation that cuts the product-path edge.
const BAND_SITE_DIRS = ['lib', 'scripts', 'bin'];
const BAND_WINDOW = 4;

function bandSites(root) {
  const comparison = [];
  const unclassified = [];
  const files = [];
  for (const d of BAND_SITE_DIRS) {
    const dir = path.join(root, d);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (!fs.statSync(p).isFile()) continue;
      if (d === 'lib' && !f.endsWith('.js')) continue;
      files.push([`${d}/${f}`, p]);
    }
  }
  const lastHit = {};
  for (const [rel, abs] of files) {
    const src = fs.readFileSync(abs, 'utf8');
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
      // A PER-CASE band: an object literal carrying a mean and a dispersion —
      // read over a forward window, because the two keys are routinely on
      // separate lines and a one-line test made a multi-line construction
      // invisible.
      if (!/\{/.test(line)) continue;
      const window = lines.slice(i, i + BAND_WINDOW)
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join(' ');
      // KEY ORDER DOES NOT MATTER. The anchor used to be `{ mean:`, so a literal
      // whose first key was the dispersion escaped entirely — reproduced. The
      // anchor is now any opening brace and both keys are required in the window.
      if (!/(^|[{,\s])mean\s*:/.test(window)) continue;
      if (!/(^|[{,\s])(stddev|sd)\s*:/.test(window)) continue;
      // `mean_score` is the RECEIPT-LEVEL aggregate field. An object built from
      // it is a suite band, not a case band, and belongs to a different subject —
      // `lib/diff.js`'s aggWithBand and `lib/export.js`'s summary both build one.
      // Discriminated by the field the value comes FROM rather than by file, so a
      // new aggregate reader is not silently swept into a criterion about cases.
      if (/mean_score/.test(window)) continue;
      const kind = BAND_SITE_KIND[rel];
      // Routing is looked for across the enclosing statement, not the single
      // line: `const b = bandOf(c);` sits above the object it feeds, and a
      // one-line test would have called a correctly routed site unrouted.
      // ONE CONSTRUCTION, ONE SITE. A forward window means the same literal is
      // matched from each opening brace inside it, so a single `return { … }`
      // reported three times. Hits whose windows overlap are collapsed to the
      // first.
      if (lastHit[rel] != null && (i + 1) - lastHit[rel] < BAND_WINDOW) continue;
      lastHit[rel] = i + 1;
      const near = lines.slice(Math.max(0, i - 3), i + BAND_WINDOW).join('\n');
      const site = { file: rel, line: i + 1, text: window.trim().slice(0, 120), routed: /bandOf\s*\(/.test(near) };
      if (!kind) { unclassified.push(site); continue; }
      if (kind === 'comparison') comparison.push(site);
      else if (kind.startsWith('definition')) comparison.push({ ...site, routed: true });
    }
  }
  return { comparison, unclassified };
}

// ── window-scoped criteria (spec 016 rider) ────────────────────────────────
//
// Some assertions are true of a PHASE rather than of the artifact. Spec 015's
// NFR-3 — "dev and main are unmoved, no remote carries this branch" — was a
// statement about the unattended window that loop ran in. It was correct, it was
// load-bearing while the window was open, and the moment the branch merged it
// became false BY DESIGN. Read as an ordinary assertion it looks like a
// regression, which invites someone to delete it; deleting it would throw away
// the only record that the window was guarded.
//
// So the kind is declared. A gate that understands `window:` reports a closed
// window as RETIRED rather than FAIL, and the criterion stays legible as
// known-and-accepted. This changes nothing about the repo gate's counting: it is
// a spec-gate vocabulary, and the repo gate has no window-scoped assertions.
const WINDOW_SCOPES = {
  'unattended-window': {
    statement: 'True while the loop is running unattended on its own spec branch: refs unmoved, nothing pushed, nothing tagged.',
    closes: 'when the spec branch is merged, which is the event the assertion existed to guard against happening early.',
    retires_as: 'known-and-accepted, recorded in the DECISIONS entry for the merge — never deleted, because the deletion would remove the evidence that the window was guarded.',
  },
};

// ── the timeout-literal detector (spec 017 AC-2) ────────────────────────────
//
// ONE DEFINITION, called from three vantages: specs/017's assertion, that
// assertion's plant-literal mutation, and the repo gate — which runs in the
// published tree, where `specs/` does not exist. It lives here for the same
// reason `bandSites` and `judgeSampleViolations` do (F-010-H): a detector that
// only lives beside its spec is never executed by a build.
//
// Before this, the repo gate carried an UNMUTATED SECOND COPY of the scan.
// approval-20260901T032810Z non-blocking finding 5: the copy that survives the
// publish boundary had never had a planted violation seen to fail it, so
// narrowing it would have gone unnoticed in exactly the tree that ships.
//
// A literal reaching a timeout parameter outranks the per-surface policy
// `lib/provider.js` declares, which is the defect W-1 named. The policy module
// itself DECLARES the numbers, so its own lines are separated out as `allowed`
// rather than matched away — the caller decides, and the count of what was
// seen is returned so a scan that silently stopped reading is visible.
function scanTimeoutLiterals(root, dirs) {
  const bad = [];
  let sites = 0;
  for (const d of dirs) {
    const dirPath = path.join(root, d);
    if (!fs.existsSync(dirPath)) continue;
    for (const f of fs.readdirSync(dirPath)) {
      const rel = `${d}/${f}`;
      const p = path.join(dirPath, f);
      if (!fs.statSync(p).isFile()) continue;
      const raw = fs.readFileSync(p, 'utf8');
      // comment-stripped: prose about a timeout is not a call site
      const src = raw.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
      for (const m of src.matchAll(/timeoutMs\s*[:=]\s*(\d{4,})/g)) {
        sites++;
        bad.push(`${rel}: timeoutMs literal ${m[1]}`);
      }
      for (const m of src.matchAll(/opts\.timeoutMs\s*\|\|\s*(\d{4,})/g)) {
        sites++;
        bad.push(`${rel}: defaults to literal ${m[1]}, shadowing the declared policy`);
      }
    }
  }
  const allowed = bad.filter((x) => x.startsWith('lib/provider.js:'));
  const offending = bad.filter((x) => !x.startsWith('lib/provider.js:'));
  return { allowed, offending, sites };
}

// ── published statements of a cap default (spec 018 AC-7) ───────────────────
//
// ONE DEFINITION, called from specs/018's assertion, that assertion's mutation,
// and the repo gate — which runs in the published tree, where `specs/` does not
// exist (F-010-H).
//
// WHY IT EXISTS. Spec 018 recalibrated two cap literals that had gone stale
// against the arithmetic beside them. Approval finding F-018-B: the same
// literals are also RESTATED IN PROSE, and no criterion read prose. README's
// § Cost guard still published "`--max-calls` (default 200)" and "12 calls per
// case" after the recalibration, in the file npm renders as the package front
// page — and the round-1 fix, while closing a finding about "a hard $2 budget",
// planted two FRESH literals ("$20 budget", "2000-call cap") four lines away.
// AC-2 governs the defaults themselves; AC-4 governs invocations. A sentence
// ABOUT a default was inside the property and outside every window.
//
// THE RULE. A block of published prose that mentions a cap subject and carries
// a cap-shaped number must NAME the constant that number comes from. Not "must
// carry no number": a derivation with its constant beside it is exactly what
// the config comment does, and it is the readable form. What is refused is the
// bare literal — a number a reader cannot trace and a maintainer cannot find
// when the constant moves.
//
// THE SCOPE IS THE PUBLISHED TREE, derived from the publish script's own
// EXCLUDE_RE via `publishedFiles`, never hand-listed — the correction spec 013's
// AC-11 already made once here after a hand-list missed `spec/RECEIPT.md`.
//
// TWO EXEMPTIONS, BY RULE AND NEVER BY LIST:
//
//   1. FROZEN RECORDS. `receipts/`, `reports/`, `docs/reports/`,
//      `docs/writing/`, `RELEASE-NOTES-*.md`, and every `RELEASES.md` entry
//      below the version in package.json. A record dated to a shipped version
//      describes that version and cannot go stale; rewriting it would delete
//      the evidence rather than the error. `FROZEN_SCHEMA` above is the same
//      rule applied to a version-pinned file name.
//   2. RECORDED OUTPUT. A fenced block reproducing what a run printed. It is a
//      quotation; naming a constant inside it would falsify the quote. Matched
//      on the runner's own projection/abort lines, so an ordinary code sample
//      cannot claim the exemption.
const FROZEN_PROSE = /^(receipts|reports|docs\/reports|docs\/writing)\//;
const FROZEN_PROSE_FILE = /^RELEASE-NOTES-[\d.]+\.md$/;
// THE SUBJECT VOCABULARY IS DERIVED FROM THE SOURCE, never hand-written.
//
// F-018-D: it used to be a phrase list — `--max-calls`, `--max-usd`, `call cap`,
// `calls per case`, `budget`, `per-model cap` — built out of the `DEV_MAX_*`
// vocabulary this loop happened to touch. `capConstantNames` was derived, so the
// criterion's claim that a new cap is covered the day it is declared held for the
// NUMBERS and not for the SUBJECTS: `TRIGGER_MAX_USD` and `REPORT_MAX_USD` had no
// phrase in the list, so all prose about them was invisible and `RUNBOOK.md:24`
// published "under the $25 trigger cap" with the assertion green. That is
// name-vs-thing applied to the subject vocabulary — the same shape as the file
// hand-list spec 013's AC-11 already corrected one layer up.
//
// Every exported `config.js` constant matching /_MAX_(CALLS|USD)$/ now supplies
// its own subjects: the CONSTANT NAME, the operator FLAG the unit half implies
// (`--max-calls`, `--max-usd`), and the PROSE FORMS a reader actually writes —
// each word of the prefix beside a cap noun ("the trigger cap", "a cap on the
// report run") and the unit beside one ("call cap", "cap of 2000 calls"). A
// dollar cap is a budget in English, so a USD constant also contributes the bare
// noun. A cap constant declared tomorrow is a subject tomorrow.
const CAP_NOUN = '(?:caps?|budgets?|limits?|ceilings?)';
const CAP_NEAR = '[^.\\n]{0,24}?';

function capSubjects(root) {
  const cfg = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  const exported = (cfg.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';
  const names = [...new Set(exported.match(/\b[A-Z][A-Z0-9_]*\b/g) || [])].filter((n) => /_MAX_(CALLS|USD)$/.test(n));
  if (!names.length) throw new Error('no cap constants (_MAX_CALLS / _MAX_USD) are exported from config.js');
  const parts = new Set();
  for (const name of names) {
    const m = name.match(/^(.+)_MAX_(CALLS|USD)$/);
    const unit = m[2];
    parts.add(`\\b${name}\\b`);
    parts.add(`--?max[-_]${unit.toLowerCase()}`);
    const words = m[1].toLowerCase().split('_').concat(unit === 'CALLS' ? ['calls?'] : ['dollars?', 'usd']);
    for (const w of words) {
      parts.add(`\\b${w}\\b${CAP_NEAR}${CAP_NOUN}`);
      parts.add(`${CAP_NOUN}${CAP_NEAR}\\b${w}\\b`);
    }
    if (unit === 'USD') parts.add('\\bbudgets?\\b');
  }
  return new RegExp([...parts].join('|'), 'i');
}
const RECORDED_OUTPUT = /^\s*(projected (calls|cost):|✗ ABORT \(cost guard\))/m;

// The constants a cap number may be traced to, READ OUT OF THE SOURCE rather
// than listed: every exported config name carrying MAX, plus the sampling
// policy keys the projection is scaled by. A new cap constant is covered the
// day it is declared.
function capConstantNames(root) {
  const cfg = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  const names = new Set();
  for (const m of cfg.matchAll(/^const ([A-Z][A-Z0-9_]*)\s*=/gm)) {
    if (/MAX|SAMPLES|FLOOR/.test(m[1])) names.add(m[1]);
  }
  const sampling = fs.readFileSync(path.join(root, 'lib', 'sampling.js'), 'utf8');
  const block = (sampling.match(/const SAMPLING = \{([\s\S]*?)\n\};/) || [])[1] || '';
  for (const m of block.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\s*:/gm)) names.add(`SAMPLING.${m[1]}`);
  if (names.size < 3) throw new Error('cap constants could not be read out of config.js / lib/sampling.js');
  return [...names];
}

// Blocks a reader reads as one statement: a fenced block whole, otherwise a
// paragraph. HTML is split at its block-level closing tags first, so a page is
// not one giant block in which any constant anywhere excuses any number.
function proseBlocks(rel, text) {
  if (/\.html$/.test(rel)) {
    return text.split(/<\/(?:p|li|td|th|h[1-6]|pre|blockquote|figcaption)>/i).map((c) => visibleText(c));
  }
  const out = [];
  const lines = text.split('\n');
  let buf = [];
  let fence = null;
  const flush = () => { if (buf.length) out.push(buf.join('\n')); buf = []; };
  for (const l of lines) {
    const f = (l.match(/^\s*(```|~~~)/) || [])[1];
    if (f && !fence) { flush(); fence = f; buf.push(l); continue; }
    if (fence) { buf.push(l); if (f && l.trim().startsWith(fence)) { flush(); fence = null; } continue; }
    if (l.trim() === '') flush(); else buf.push(l);
  }
  flush();
  return out;
}

// Cap-SHAPED numbers. Versions, dates and hashes are removed first — they are
// not caps, and matching them would make the check noise a maintainer learns to
// ignore — a report NUMBER (`#004`) is a reference, not a quantity, and belongs
// with them.
//
// F-018-E: the window used to be a dollar amount or a bare integer of three
// digits or more, which is the shape of the DECLARED mutation and not the shape
// of the property. "a 2000-call cap" — the most natural English for
// `DEV_MAX_CALLS`, and one of the two literals AC-7's own rationale names as
// having been planted four lines from the finding it was closing — has its digits
// followed by a hyphen, which the trailing exclusion swallowed. "default 20" is
// `DEV_MAX_USD` itself, stated without a currency symbol and one digit under the
// floor. Both went through.
//
// A cap number is now recognised BY ITS POSITION beside a cap word rather than
// by how many digits it has: `$N` anywhere, and two digits or more within a short
// span of `default`, `cap`, `budget`, `limit`, `ceiling` or `call(s)` on either
// side — which is what "N-call", "N calls", "default N", "cap of N" and "budget
// N" all are. The bare three-digit form is kept as well: a large number beside a
// cap subject is worth naming a constant for even when no cap word touches it.
const CAP_NUMBER_WORD = '(?:defaults?|caps?|budgets?|limits?|ceilings?|calls?)';

function capLiterals(block) {
  const t = block
    .replace(/\b[0-9a-f]{7,40}\b/g, ' ')
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/v?\d+\.\d+\.\d+/g, ' ')
    .replace(/#\d+/g, ' ');
  const found = [];
  for (const m of t.matchAll(/\$\s?\d+(?:\.\d+)?/g)) found.push(m[0].replace(/\s/g, ''));
  for (const m of t.matchAll(/(?<![\w.$-])\d{3,}(?![\w.-])/g)) found.push(m[0]);
  const near = new RegExp(`${CAP_NUMBER_WORD}[^\\n\\d]{0,14}(\\d{2,})|(\\d{2,})[\\s-]?${CAP_NUMBER_WORD}`, 'gi');
  for (const m of t.matchAll(near)) found.push(m[1] || m[2]);
  return [...new Set(found)];
}

// THE MUTATION SET. One entry per SHAPE a cap statement takes in the wild, not
// per file: three are the approver's F-018-E probes verbatim, and the fourth is
// the live violation F-018-D found — `RUNBOOK.md:24`'s "$25 trigger cap", the
// `TRIGGER_MAX_USD` sentence the hand-written subject list could not see. Each
// must take the scan red when planted and leave it green when removed, so the
// window is exercised at every shape the property covers rather than at the one
// shape the first draft happened to match.
const CAP_MUTATIONS = [
  { id: 'default-200', rel: 'README.md', anchor: '### Cost guard\n',
    says: 'the round-1 finding\'s own sentence, a bare $-less three-digit default',
    replace: '### Cost guard\n\nDriftproof refuses before spending anything if the run would exceed `--max-calls` (default 200).\n' },
  { id: 'call-compound', rel: 'README.md', anchor: '### Cost guard\n',
    says: 'the compound form — the digits are followed by a hyphen',
    replace: '### Cost guard\n\nThe shipped default is a 2000-call cap on --max-calls.\n' },
  { id: 'two-digit-budget', rel: 'README.md', anchor: '### Cost guard\n',
    says: 'DEV_MAX_USD itself: two digits, no currency symbol',
    replace: '### Cost guard\n\nDriftproof refuses if the run exceeds the dollar budget, default 20.\n' },
  { id: 'trigger-cap', rel: 'RUNBOOK.md', anchor: 'under `TRIGGER_MAX_USD` from [`config.js`](config.js)',
    says: 'F-018-D\'s live violation: a cap constant with no phrase in the old hand list',
    replace: 'under the $25 trigger cap' },
];

function plantCapMutation(root, m) {
  const text = fs.readFileSync(path.join(root, m.rel), 'utf8');
  const planted = text.replace(m.anchor, m.replace);
  if (planted === text) throw new Error(`cap mutation "${m.id}" planted nothing — the ${m.rel} anchor moved`);
  return planted;
}

// `text` may be supplied per-file to scan a MUTATED copy without writing it to
// disk; anything not supplied is read from the tree.
function capLiteralClaims(root, overrides = {}) {
  const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
  const constants = capConstantNames(root);
  const subject = capSubjects(root);
  const namesConstant = new RegExp(`(${constants.map((c) => c.replace('.', '\\.')).join('|')})`);
  const out = [];
  const scanned = [];
  for (const rel of publishedFiles(root)) {
    if (!/\.(md|html)$/.test(rel)) continue;
    if (FROZEN_PROSE.test(rel) || FROZEN_PROSE_FILE.test(rel)) continue;
    let text = overrides[rel] != null ? overrides[rel] : fs.readFileSync(path.join(root, rel), 'utf8');
    // Only the CURRENT version's release entry is live prose; the ones below it
    // are dated records of versions already shipped.
    if (path.basename(rel) === 'RELEASES.md') {
      const seg = text.split(/^## /m).find((s) => s.startsWith(`v${version}`));
      text = seg ? `## ${seg}` : '';
    }
    scanned.push(rel);
    for (const block of proseBlocks(rel, text)) {
      if (!subject.test(block)) continue;
      if (RECORDED_OUTPUT.test(block)) continue;
      const lits = capLiterals(block);
      if (!lits.length) continue;
      if (namesConstant.test(block)) continue;
      const where = block.split('\n').find((l) => subject.test(l)) || block.slice(0, 80);
      out.push(`${rel}: ${lits.join(', ')} stated beside a cap with no constant named — ${where.trim().slice(0, 100)}`);
    }
  }
  if (!scanned.length) throw new Error('capLiteralClaims scanned no published prose at all');
  return { claims: out, scanned };
}

module.exports = {
  releaseEntryFacts, RELEASE_ENTRY_FACTS, publishedInvocations, WORDS, NARROWING_CLASSES, archiveReceipts, bandSites, WINDOW_SCOPES, productPathReaches, orphanModules, undeclaredHarnessOnly, HARNESS_ONLY_LIB, judgeSampleViolations, ATTRS_CARRYING_PROSE, attributeText, visibleText, documentText, countClaims, publishedFiles, signedReceiptClaims, FROZEN_SCHEMA, scanTimeoutLiterals,
  capLiteralClaims, capConstantNames, proseBlocks, capLiterals, capSubjects, CAP_MUTATIONS, plantCapMutation, FROZEN_PROSE, RECORDED_OUTPUT };
