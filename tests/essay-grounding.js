// SPDX-License-Identifier: Apache-2.0
'use strict';

// Essay grounding — the published essay's figures, bound to the published pages
// they cite.
//
// WHY THIS LIVES IN tests/ AND NOT IN specs/010/ (finding F-010-H).
// `specs/` is excluded from the published tree, `build-public.sh` runs only the
// repo gate, and no workflow runs a spec gate — so an assertion that lives only
// beside its spec is never executed by a build. The essay states, on the page,
// that a check fails the build when a figure disagrees with the report it cites.
// That sentence is a published claim, so the check has to run where a publish
// runs: here, in the repo gate, in the same tree that ships. specs/010's gate
// delegates to this module rather than restating it, so there is one definition
// and the two vantages cannot drift.
//
// Every check reads files. No provider, no network, no spend.

const fs = require('fs');
const path = require('path');
const scope = require('./assertion-scope.js');

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const ESSAY_REL = path.join('docs', 'writing', 'three-releases', 'index.html');
const PUBLISHED_ON = '2026-08-11'; // the essay's publication date, as printed on it

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z]+;/g, ' ')
    .replace(/\s+/g, ' ');
}

function numbersIn(text) {
  const out = new Set();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) out.add(m[0].replace(/[.,]$/, ''));
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const VARIANTS = {
  regressed: ['regressed', 'regresses', 'regression', 'regressions'],
  regresses: ['regressed', 'regresses', 'regression', 'regressions'],
  improved: ['improved', 'improvement', 'improvements'],
  mixed: ['mixed'],
  'within noise': ['within noise', 'within-noise'],
  durable: ['durable'],
  'tier-dependent': ['tier-dependent', 'tier dependent'],
  'substrate-dependent': ['substrate-dependent', 'substrate dependent'],
  'no effect': ['no effect', 'no-effect'],
  // The refusal shape's labels (a report that published no verdict at all).
  cells: ['cells', 'cell'],
  measured: ['measured'],
  refused: ['refused', 'refusals'],
};

const pair = (count, label) => ({ count: String(count), label, variants: VARIANTS[label] || [label] });

// ── the oracle: each report's tally, derived from its own published page ─────

function tallyLinePairs(text) {
  const seg = text.match(/(\d+ [a-z][a-z -]*?)(?: · \d+ [a-z][a-z -]*?)+(?= —|\.| over| across|$)/i);
  if (!seg) return null;
  const pairs = [];
  for (const p of seg[0].split(' · ')) {
    const m = p.trim().match(/^(\d+) (.+?)$/);
    if (!m) return null;
    pairs.push(pair(m[1], m[2].trim().toLowerCase()));
  }
  return pairs.length >= 3 ? pairs : null;
}

function verdictCellPairs(html) {
  const counts = new Map();
  for (const m of html.matchAll(/<span class="v v-[a-z]*">([^<]*)<\/span>/g)) {
    let label = m[1].replace(/&amp;/g, '&').trim().toLowerCase();
    if (label.startsWith('regresses')) label = 'regressed';
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  if (!counts.size) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([label, n]) => pair(n, label));
}

// ── the fourth shape: a report whose published result is a REFUSAL ──────────
//
// #006 returned no verdicts — three cells, every one refused by its own baseline
// control — so the three oracles above yield nothing and derive() threw. A
// refusal is a result and it has a tally: 3 cells, 0 measured, 3 refused. Those
// are numbers the essay must match, on the same terms a verdict tally is matched.
//
// IT IS READ OFF THE TABLE, NEVER OUT OF THE PROSE. The refusal marker appears
// ten times on that page and seven of them are the sentences explaining the rule,
// so a page-wide count of the marker would be an assertion anchored beside the
// property rather than to it — the class `B-12` records. The per-cell table is
// the page's own structured record of its cells, rendered from the receipts.
//
// It returns null unless a table has a verdict column AND at least one row in it
// is refused, so every report that publishes verdicts reaches this and is
// unaffected by it.
const REFUSAL_MARK = /⃠\s*NOT\s+MEASURED/;

function refusalTablePairs(html) {
  for (const t of html.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)) {
    const table = t[1];
    const head = (table.match(/<thead>[\s\S]*?<\/thead>/) || [''])[0];
    const heads = [...head.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]).trim().toLowerCase());
    const col = heads.findIndex((h) => /verdict/.test(h));
    if (col < 0) continue;
    const body = (table.match(/<tbody>([\s\S]*?)<\/tbody>/) || [null, ''])[1];
    const rows = body.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
    if (!rows.length) continue;
    let refused = 0;
    for (const row of rows) {
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (cells.length <= col) continue;
      if (REFUSAL_MARK.test(cells[col])) refused += 1;
    }
    if (!refused) continue;
    return [pair(rows.length, 'cells'), pair(rows.length - refused, 'measured'), pair(refused, 'refused')];
  }
  return null;
}

function valuePairs(text) {
  const a = text.match(/In (\d+) of (\d+) skill × substrate pairs/);
  const b = text.match(/(\d+) cleared the floor on aggregate: (\d+) carry a price and (\d+) report a saving/);
  if (!a || !b) return null;
  return [pair(a[1], 'of ' + a[2]), pair(b[1], 'cleared the floor'), pair(b[2], 'carry a price'), pair(b[3], 'report a saving')];
}

function publishedReportIds(root) {
  const dir = path.join(root, 'docs', 'reports');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((d) => /^\d{3}$/.test(d) && fs.existsSync(path.join(dir, d, 'index.html')))
    .sort();
}

function derive(root) {
  const out = {};
  for (const id of publishedReportIds(root)) {
    const html = fs.readFileSync(path.join(root, 'docs', 'reports', id, 'index.html'), 'utf8');
    const text = stripTags(html);
    const pairs = valuePairs(text) || tallyLinePairs(text) || verdictCellPairs(html) || refusalTablePairs(html);
    if (!pairs) throw new Error(`no tally derivable from report ${id}`);
    // A count derived from the page (#002's verdict cells) is a figure the page
    // supports though it never spells it out, so it joins the page's numbers.
    const numbers = numbersIn(text);
    for (const p of pairs) numbers.add(p.count);
    out[id] = { numbers, pairs };
  }
  return out;
}

// ── the essay ───────────────────────────────────────────────────────────────

const essayPath = (root) => path.join(root, ESSAY_REL);
const readEssay = (root) => fs.readFileSync(essayPath(root), 'utf8');

function paragraphs(html) {
  return [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
}

function citingParagraphs(html) {
  const by = {};
  for (const p of paragraphs(html)) {
    for (const m of p.matchAll(/reports\/(\d{3})\//g)) (by[m[1]] = by[m[1]] || []).push(stripTags(p));
  }
  return by;
}

function publishedTypeLabels(root) {
  const labels = new Map();
  for (const id of publishedReportIds(root)) {
    const html = fs.readFileSync(path.join(root, 'docs', 'reports', id, 'index.html'), 'utf8');
    const m = html.match(/class="report-type"[^>]*>([^<—]*)/);
    if (!m) throw new Error(`report ${id} carries no report-type eyebrow`);
    labels.set(m[1].trim().toLowerCase().replace(/\s+report$/, ''), id);
  }
  return labels;
}

// Every type REPORT-STYLE.md declares, published or not. The unpublished ones
// are what AC-7 forbids the essay from naming, derived rather than listed
// (finding F-010-L).
function declaredTypeLabels(root) {
  const src = path.join(root, 'REPORT-STYLE.md');
  if (!fs.existsSync(src)) return new Set();
  const md = fs.readFileSync(src, 'utf8');
  const out = new Set();
  for (const m of md.matchAll(/^\| ([A-Z][A-Za-z -]+?) \| `([^`]+)`/gm)) {
    out.add(m[2].trim().toLowerCase().replace(/\s+report$/, ''));
  }
  return out;
}

// ── the AC-3 rule, in one place ─────────────────────────────────────────────

// A count must sit immediately in front of its own label (F-010-A), and no OTHER
// count may be stated against that label in the same paragraph (F-010-I): a
// right tally beside a wrong one is still a wrong tally on the page.
function tallyViolations(by, oracle) {
  const bad = [];
  for (const [id, o] of Object.entries(oracle)) {
    const paras = by[id] || [];
    if (!paras.length) { bad.push(`#${id}: no paragraph cites it`); continue; }
    const low = paras.join(' ').toLowerCase();
    for (const p of o.pairs) {
      const alt = p.variants.map(esc).join('|');
      if (!new RegExp(`(?<![\\d.,])${p.count}\\s+(?:${alt})\\b`).test(low)) {
        bad.push(`#${id}: the essay does not state "${p.count} ${p.label}" with the count on its own label`);
      }
      const stated = [...low.matchAll(new RegExp(`(?<![\\d.,])(\\d[\\d,]*)\\s+(?:${alt})\\b`, 'g'))].map((m) => m[1]);
      for (const said of new Set(stated)) {
        if (said !== p.count) bad.push(`#${id}: the essay also states "${said} ${p.label}" where the page says ${p.count}`);
      }
    }
  }
  return bad;
}

// A delimiter that cannot collide with document text. Written as a SOURCE
// ESCAPE, not as a literal byte: four literal NULs here made the whole file
// binary to line-oriented tools, and a search over it can report absence for
// content that is present — the `absence-vs-unreadable` class, which is
// indistinguishable from the property holding. Same byte at runtime.
const SENTINEL = '\u0000';

// Permute a report's counts around its labels — every number stays on the page.
function rotateCounts(paras, pairs) {
  let text = paras.join(' ');
  pairs.forEach((p, i) => {
    const alt = p.variants.map(esc).join('|');
    text = text.replace(new RegExp(`(?<![\\d.,])${p.count}(\\s+(?:${alt})\\b)`, 'i'), `${SENTINEL}${i}${SENTINEL}$1`);
  });
  pairs.forEach((p, i) => { text = text.split(`${SENTINEL}${i}${SENTINEL}`).join(pairs[(i + 1) % pairs.length].count); });
  return [text];
}

// ── the checks ──────────────────────────────────────────────────────────────
// Each returns null on pass, or a message on failure.

const CHECKS = {
  'ac1-links'(root) {
    // SPEC 020 put every internal link on a clean path. Both forms are read, so
    // this assertion holds across the move rather than going quiet after it.
    const linked = new Set([...readEssay(root).matchAll(/href="[^"]*reports\/(\d{3})\/(?:index\.html)?"/g)].map((m) => m[1]));
    const missing = publishedReportIds(root).filter((id) => !linked.has(id));
    return missing.length ? `published but not linked from the essay: ${missing.join(', ')}` : null;
  },

  'ac1-no-phantom'(root) {
    const published = new Set(publishedReportIds(root));
    const seen = [...readEssay(root).matchAll(/reports\/(\d{3})\//g)].map((m) => m[1]).filter((id) => !published.has(id));
    return seen.length ? `the essay links a report that is not published: ${[...new Set(seen)].join(', ')}` : null;
  },

  'ac2-numbers'(root) {
    const oracle = derive(root);
    const bad = [];
    for (const [id, paras] of Object.entries(citingParagraphs(readEssay(root)))) {
      const known = oracle[id] ? oracle[id].numbers : new Set();
      for (const text of paras) {
        for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
          const tok = m[0].replace(/[.,]$/, '');
          if (!known.has(tok)) bad.push(`#${id}: "${tok}" is not on the cited page`);
        }
      }
    }
    return bad.length ? bad.join('\n') : null;
  },

  'ac3-tallies'(root) {
    const bad = tallyViolations(citingParagraphs(readEssay(root)), derive(root));
    return bad.length ? bad.join('\n') : null;
  },

  // Non-vacuity, and it is part of the criterion rather than a note about it.
  'ac3-binds'(root) {
    const oracle = derive(root);
    const by = citingParagraphs(readEssay(root));
    const survived = [];
    for (const [id, o] of Object.entries(oracle)) {
      // F-010-O: a report the oracle cannot permute is reported, never skipped.
      if (o.pairs.length < 2) { survived.push(`#${id}: the oracle yields ${o.pairs.length} pair(s) — nothing to permute`); continue; }
      const mutant = Object.assign({}, by);
      mutant[id] = rotateCounts(by[id] || [], o.pairs);
      if (!mutant[id].length || !mutant[id][0]) { survived.push(`#${id}: nothing to permute`); continue; }
      if (!tallyViolations(mutant, oracle).some((m) => m.startsWith(`#${id}:`))) {
        survived.push(`#${id}: a permuted tally still passes AC-3`);
      }
    }
    return survived.length ? survived.join('\n') : null;
  },

  // Reads documentText, not stripTags: a count in a `content` attribute is a
  // published claim (F-012-D shipped one to the live site), and counts over the
  // WHOLE artifact, never a window (F-012-B).
  'ac4-counts'(root) {
    const text = scope.documentText(readEssay(root)).toLowerCase();
    const published = publishedTypeLabels(root);
    const declared = declaredTypeLabels(root);
    const bad = [];
    for (const [label, id] of published) {
      if (declared.size && !declared.has(label)) bad.push(`report ${id} declares type "${label}", which REPORT-STYLE.md does not`);
    }
    const want = { reports: publishedReportIds(root).length, 'report types': published.size };
    for (const [noun, n] of Object.entries(want)) {
      // one optional adjective is allowed between the number and the noun
      // ("five published reports"), which a bare adjacency test refused (F-010-J)
      const re = new RegExp(`\\b(${WORDS.join('|')})\\s+(?:[a-z-]+\\s+)?${esc(noun)}\\b`, 'g');
      const said = [...text.matchAll(re)].map((m) => m[1]);
      if (!said.length) bad.push(`the essay never counts ${noun} (the repository publishes ${n})`);
      for (const w of new Set(said)) if (w !== WORDS[n]) bad.push(`the essay says "${w} ${noun}" where the repository publishes ${n}`);
    }
    return bad.length ? [...new Set(bad)].join('\n') : null;
  },

  'ac5-constants'(root) {
    const { EFFECT_FLOOR, DEFAULT_JUDGE_SAMPLES } = require(path.join(root, 'config.js'));
    const text = stripTags(readEssay(root)).toLowerCase();
    const bad = [];
    const floorClaim = `at least ${EFFECT_FLOOR}`;
    if (!text.includes(floorClaim)) bad.push(`the essay does not state the verdict rule as "${floorClaim}" (config.js EFFECT_FLOOR = ${EFFECT_FLOOR})`);
    const otherFloor = [...text.matchAll(/at least (\d+\.\d+)/g)].map((m) => m[1]).filter((v) => v !== String(EFFECT_FLOOR));
    if (otherFloor.length) bad.push(`the essay states a different floor as the rule: ${[...new Set(otherFloor)].join(', ')}`);
    const samplesClaim = `judged ${WORDS[DEFAULT_JUDGE_SAMPLES]} times`;
    if (!text.includes(samplesClaim)) bad.push(`the essay does not say "${samplesClaim}" (config.js DEFAULT_JUDGE_SAMPLES = ${DEFAULT_JUDGE_SAMPLES})`);
    const otherSamples = [...text.matchAll(new RegExp(`judged (${WORDS.join('|')}) times`, 'g'))].map((m) => m[1]).filter((w) => w !== WORDS[DEFAULT_JUDGE_SAMPLES]);
    if (otherSamples.length) bad.push(`the essay also says the judge samples ${[...new Set(otherSamples)].join(', ')} times`);
    return bad.length ? bad.join('\n') : null;
  },

  'ac6-revision-line'(root) {
    const text = stripTags(readEssay(root));
    const byline = text.match(/By the Driftproof maintainer[^<]*?(?=Sonnet|$)/);
    if (!byline) return 'the byline block is gone';
    if (!byline[0].includes(PUBLISHED_ON)) return `the byline no longer names the original publication date ${PUBLISHED_ON}`;
    if (!/revised|updated/i.test(byline[0])) return 'the byline does not mark the page as revised';
    const rev = byline[0].match(/(?:revised|updated)[^0-9]*(\d{4}-\d{2}-\d{2})/i);
    if (!rev) return 'the byline marks a revision without dating it';
    if (rev[1] <= PUBLISHED_ON) return `the revision date ${rev[1]} is not after publication`;
    return null;
  },

  // Derived, not listed (F-010-L): a report id the tree does not publish, or a
  // report type REPORT-STYLE.md declares but nothing publishes, may not be named.
  'ac7-unpublished'(root) {
    const text = stripTags(readEssay(root));
    const low = text.toLowerCase();
    const published = new Set(publishedReportIds(root));
    const bad = [];
    for (const m of text.matchAll(/report\s*#?\s*(\d{3})|#(\d{3})/gi)) {
      const id = m[1] || m[2];
      if (!published.has(id)) bad.push(`the essay names report ${id}, which is not published`);
    }
    const unpublishedTypes = [...declaredTypeLabels(root)].filter((t) => !publishedTypeLabels(root).has(t));
    for (const t of unpublishedTypes) if (low.includes(t)) bad.push(`the essay names the "${t}" report type, which has no published report`);
    return bad.length ? [...new Set(bad)].join('\n') : null;
  },

  // F-012-B. The window locates the POINTER, whose presence is the property it
  // can carry; the COUNT is checked over the whole file, and over the document
  // rather than the stripped document. The old form tested only
  // slice(at - 200, at + 500), which is how F-012-A survived a 17/17 spec gate
  // and a 463/463 repo gate and reached the published tree.
  'ac8-pointers'(root) {
    const n = publishedReportIds(root).length;
    const word = WORDS[n];
    const bad = [];
    for (const rel of ['README.md', path.join('docs', 'index.html')]) {
      const p = path.join(root, rel);
      if (!fs.existsSync(p)) { bad.push(`${rel} is missing`); continue; }
      const src = fs.readFileSync(p, 'utf8');
      const doc = scope.documentText(src);
      const low = doc.toLowerCase();
      if (/(first )?three reports/.test(low)) bad.push(`${rel} still describes the essay as reading three reports`);
      // The POINTER lives in an href, which is a link and not prose, so it is
      // located in the raw source; the CLAIM is prose and is read out of the
      // document. Two scopes, because they are two different properties.
      const raw = src.toLowerCase().replace(/\s+/g, ' ');
      const at = raw.indexOf('three-releases');
      if (at < 0) { bad.push(`${rel} no longer points at the essay`); continue; }
      // presence of the pointer's own claim, near the pointer
      const around = raw.slice(Math.max(0, at - 200), at + 500);
      if (!new RegExp(`\\b${word}\\s+(?:[a-z-]+\\s+)?reports\\b`).test(around)) bad.push(`${rel}'s essay pointer does not say "${word} reports"`);
      // and no count anywhere else in the file disagrees with the repository
      for (const v of scope.countClaims(doc, 'reports', n)) bad.push(`${rel} ${v}`);
    }
    return bad.length ? bad.join('\n') : null;
  },

  'nfr2-one-page'(root) {
    const dir = path.join(root, 'docs', 'writing');
    const found = [];
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const abs = path.join(d, e.name);
        if (e.isDirectory()) walk(abs, path.join(rel, e.name));
        else found.push(path.join(rel, e.name));
      }
    };
    if (!fs.existsSync(dir)) return 'docs/writing is missing';
    walk(dir, path.join('docs', 'writing'));
    const want = ESSAY_REL;
    return found.length === 1 && found[0] === want ? null : `docs/writing must hold exactly the one published page; found:\n  ${found.join('\n  ')}`;
  },
};

const DESCRIPTIONS = {
  'ac1-links': 'every published report is linked from the essay',
  'ac1-no-phantom': 'the essay links no report that is not published',
  'ac2-numbers': 'every number in a report paragraph is on the cited page',
  'ac3-tallies': "every tally matches the cited page's own tally, count bound to label",
  'ac3-binds': 'MUTATION: a permuted tally is caught (the tally rule is not vacuous)',
  'ac4-counts': "the essay's counts of reports and report types are the repository's",
  'ac5-constants': 'the effect floor and judge samples are stated as config.js has them',
  'ac6-revision-line': 'the byline dates both publication and revision',
  'ac7-unpublished': 'no unpublished report or report type is named',
  'ac8-pointers': 'README and the site index describe the same essay',
  'nfr2-one-page': 'docs/writing holds exactly one published page',
};

// The checks that can run in ANY tree that ships — the dev checkout and the
// published tree alike. AC-6's byte-identity comparison is deliberately not
// here: it reads the branch point out of git history, which the published tree
// (a fresh single commit) does not have. It stays in specs/010's gate.
function run(root) {
  return Object.entries(CHECKS).map(([id, fn]) => {
    let message = null;
    try { message = fn(root); } catch (e) { message = `threw: ${e.message}`; }
    return { id, ok: message === null, message };
  });
}

module.exports = { CHECKS, DESCRIPTIONS, run, derive, refusalTablePairs, stripTags, numbersIn, tallyViolations, rotateCounts, citingParagraphs, publishedReportIds, publishedTypeLabels, declaredTypeLabels, paragraphs, WORDS, ESSAY_REL };
