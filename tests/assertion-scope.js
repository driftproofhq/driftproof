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

// ── the published-tree scope ────────────────────────────────────────────────
//
// DERIVED FROM THE SHIPPING RULE, never hand-listed. AC-11's first draft scanned
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

module.exports = { WORDS, NARROWING_CLASSES, archiveReceipts, bandSites, WINDOW_SCOPES, productPathReaches, orphanModules, undeclaredHarnessOnly, HARNESS_ONLY_LIB, judgeSampleViolations, ATTRS_CARRYING_PROSE, attributeText, visibleText, documentText, countClaims, publishedFiles, signedReceiptClaims, FROZEN_SCHEMA, scanTimeoutLiterals };
