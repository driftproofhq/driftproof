// SPDX-License-Identifier: Apache-2.0
'use strict';

const { judgeSamplesOrNull } = require('./counts');
const { bandVerdict, round, WITHIN_NOISE } = require('./stats');
const { EFFECT_FLOOR } = require('../config');
const { revisionHeadline } = require('./revision');
const { baselineReproduces, REFUSAL_REASONS, bandOf } = require('./reuse');
const { caseRule, armOf, drawsLine, UNDERPOWERED_LINE } = require('./verdict');

// Practical-significance gate applied ON TOP of band separation. bandVerdict()
// stays a pure geometry test (kept that way so its unit checks are unambiguous);
// this wrapper additionally requires |delta| >= EFFECT_FLOOR before a verdict is
// claimed. A separated but trivial move (below the judge's quantization floor)
// gets the verdict value WITHIN_NOISE_FLOOR, which the table labels "below effect
// floor".
const WITHIN_NOISE_FLOOR = 'within noise (below effect floor)';
function verdictWithFloor(before, after, delta) {
  const raw = bandVerdict(before.mean, before.stddev, after.mean, after.stddev);
  if ((raw === 'regression' || raw === 'improvement') && Math.abs(delta) < EFFECT_FLOOR) {
    return WITHIN_NOISE_FLOOR;
  }
  return raw;
}
function isWithinNoise(v) { return v === WITHIN_NOISE || v === WITHIN_NOISE_FLOOR; }

// Build a drift report (markdown) between two receipts.
//
// CREDIBILITY CORE, the anti-false-positive rule: a per-case regression (or
// improvement) is claimed ONLY when (1) the two bands, each the mean plus or
// minus one sample standard deviation, do NOT overlap AND (2) the mean moved by at
// least EFFECT_FLOOR (practical-significance floor, see config.js). When the
// bands overlap OR the move is below the floor, no separation is detected at the
// sample size used, and the case is NOT counted as a regression. A tool that cries
// wolf is worse than useless, so band separation PLUS a real-sized delta, not
// either alone, is what triggers a verdict.

// Map case-id → { mean, stddev } for a receipt's with_skill cases. Falls back to
// score/0 for v0.1 receipts that have no per-case band.
// NO RENDERING SWITCHES. An earlier revision carried two const-true flags so each
// half of F-015-B's fix could be removed in a probe — and the dead branch of one
// of them contained, verbatim, the false headline AC-4 exists to forbid. Nothing
// could fire it, and it was still a defect-restoring branch living in the tree
// that gets published. The mutation probes patch this source in a disposable copy.

function withSkillBands(receipt) {
  const out = {};
  for (const c of receipt.results.cases) {
    if (c.mode !== 'with_skill') continue;
  // ONE BAND DEFINITION (spec 016 AC-1). This built its own from the v0.4-shaped
  // fields, which worked — and that is the point: three copies existed, two
  // reading the legacy shape and one reading only v0.5, and the one that read
  // only v0.5 was the one a cross-version control depended on (F-015-C). Routing
  // every comparison path through `bandOf` means a future shape is added once.
    const b = bandOf(c);
    if (b) out[c.id] = { mean: b.mean, stddev: b.sd, source: b.source };
  }
  return out;
}

// Aggregate with_skill band for a receipt (mean_score ± stddev). v0.1 receipts
// have no aggregate stddev → 0 (bands collapse to points; every move looks real,
// which is exactly the v0.1 weakness v0.2 fixes).
function aggWithBand(receipt) {
  const a = receipt.results.aggregates.with_skill;
  // v0.6 (spec 026 AC-7): a null band is carried as null and rendered as what
  // it is; a legacy receipt with no aggregate band keeps its 0 (the archive's
  // rendering is unmoved, AC-16).
  return { mean: a.mean_score, stddev: a.stddev === null ? null : (a.stddev || 0), cases: a.case_count };
}

function fmt(n) { return n == null ? 'n/a' : (n >= 0 ? '+' : '') + n.toFixed(3); }
function pct(n) { return n == null ? 'n/a' : n.toFixed(3); }
// THE BAND SAYS WHICH BAND IT IS (spec 017 AC-7).
//
// `bandOf` computes `source: 'legacy' | 'generation'` and carries it onto every
// band; nothing rendered it, so a reader comparing an archived receipt with a
// v0.5 one was comparing a JUDGE-SAMPLE spread against an ACROSS-DRAW spread
// with nothing on the page saying so. They are different statistics over
// different things, and the comparison is still the only one v0.4 admits — which
// is exactly why the page has to name them rather than leave them to look alike.
//
// THE MARKER IS THE RECEIPT'S OWN WORD — `legacy` or `generation`, exactly as
// `bandOf` records it — rather than a prettier synonym. A reader who greps the
// page for what a receipt says should find the same token; a rendering that
// renames the thing it is disclosing has disclosed a different thing. Omitted
// when a band carries no source (an aggregate band is computed from case means,
// not from one case's draws).

function bandStr(x) {
  if (x && x.mean == null) return 'n/a (0 cases)';
  if (x && x.stddev == null) return `${x.mean.toFixed(3)} ± n/a (${x.cases === 1 ? '1 case' : 'no band'})`;
  const label = x && x.source;
  return `${x.mean.toFixed(3)} ± ${x.stddev.toFixed(3)}${label ? ` (${label})` : ''}`;
}
function short(h) { return h ? String(h).slice(0, 12) : 'n/a'; }

// ── THE JUDGE IS PART OF THE INSTRUMENT (spec 026 AC-12, A4) ─────────────────
// Two receipts graded by different judges are two measurements with different
// instruments, and a verdict across them says nothing about the skill.
// lib/reuse.js's triage already says a changed judge means regrade; the
// differ did not ask. It asks here: run.judge.model_id (on canonical ids, so
// an alias and its dated form are one judge), run.judge.prompt_template_hash,
// run.judge.temperature, and every shared case's judge.rubric_hash. A field
// that differs names itself in the caveats and suppresses every per-case
// verdict. A pre-v0.6 receipt carries no template hash: the report says the
// template is unrecorded on that side and still compares the rest.
const canonicalJudgeId = (id) => String(id == null ? '' : id).replace(/-\d{8}$/, '');
function judgeDiffers(a, b, ids, aB, bB) {
  const ja = (a.run && a.run.judge) || {}; const jb = (b.run && b.run.judge) || {};
  const problems = [];
  const idA = ja.model_id || (a.results.cases.find((c) => c.judge && c.judge.model_id) || { judge: {} }).judge.model_id;
  const idB = jb.model_id || (b.results.cases.find((c) => c.judge && c.judge.model_id) || { judge: {} }).judge.model_id;
  if (idA && idB && canonicalJudgeId(idA) !== canonicalJudgeId(idB)) problems.push(`run.judge.model_id differs (${idA} vs ${idB})`);
  const unrecorded = [];
  if (!ja.prompt_template_hash) unrecorded.push('A'); if (!jb.prompt_template_hash) unrecorded.push('B');
  if (ja.prompt_template_hash && jb.prompt_template_hash && ja.prompt_template_hash !== jb.prompt_template_hash) problems.push(`run.judge.prompt_template_hash differs (${short(ja.prompt_template_hash)} vs ${short(jb.prompt_template_hash)}): the grading template is a different judge`);
  if (ja.temperature !== undefined && jb.temperature !== undefined && ja.temperature !== jb.temperature) problems.push(`run.judge.temperature differs (${ja.temperature} vs ${jb.temperature})`);
  const rubricA = Object.fromEntries(a.results.cases.filter((c) => c.mode === 'with_skill' && c.judge).map((c) => [c.id, c.judge.rubric_hash]));
  const rubricB = Object.fromEntries(b.results.cases.filter((c) => c.mode === 'with_skill' && c.judge).map((c) => [c.id, c.judge.rubric_hash]));
  const moved = ids.filter((id) => rubricA[id] && rubricB[id] && rubricA[id] !== rubricB[id]);
  if (moved.length) problems.push(`judge.rubric_hash differs on ${moved.length} shared case(s) (${moved.slice(0, 3).map((x) => `\`${x}\``).join(', ')}${moved.length > 3 ? ', …' : ''})`);
  return { problems, unrecorded };
}

// The headline is a SUMMARY of the per-case band-overlap verdicts — the credibility
// core lives per case (judge-sample bands), and the headline just aggregates it.
// It deliberately does NOT run a separate band test on the aggregate mean: the
// aggregate band is suite dispersion, and a separate test there would either cry
// wolf (if too tight) or mask real per-case drift (if too wide).
//
// THE WORDING (spec 031 A-031-20). A band is a descriptive spread, the mean plus or
// minus one sample standard deviation. A separation is stated as detected under
// the rule, never as proof that the skill moved; no separation is stated as none
// detected at this sample size, never as evidence that nothing changed. The
// leading word is the label; the verdict values it summarises are unchanged.
function headlineVerdict(perCase) {
  const reg = perCase.filter((r) => r.verdict === 'regression').length;
  const imp = perCase.filter((r) => r.verdict === 'improvement').length;
  const s = (n) => (n === 1 ? '' : 's');
  const rule = 'bands do not overlap and the move clears the effect floor';
  if (reg && imp) return `MIXED: separation detected under the rule on ${reg} case${s(reg)} downward and ${imp} case${s(imp)} upward (${rule}).`;
  if (reg) return `DRIFT: separation detected under the rule on ${reg} case${s(reg)}, downward (${rule}); none upward.`;
  if (imp) return `IMPROVED: separation detected under the rule on ${imp} case${s(imp)}, upward (${rule}); none downward.`;
  return 'NO SEPARATION DETECTED: no case separated under the rule at this sample size (band = mean \u00b1 1 sd); this is not evidence that nothing changed.';
}

// A revision pair is a pair in which the SKILL TEXT is the only thing that
// moved. `diff` was built for release drift, where the model varies and the text
// is fixed; this inverts it, so the fields that release drift merely warns about
// become the preconditions of the comparison. Returns the offending field name,
// or null when the pair is a valid revision pair.
function revisionPairProblem(a, b) {
  if ((a.run.model_id || '') !== (b.run.model_id || '')) return 'run.model_id';
  if ((a.run.provider || 'anthropic') !== (b.run.provider || 'anthropic')) return 'run.provider';
  if ((a.run.surface || '') !== (b.run.surface || '')) return 'run.surface';
  if ((a.suite.suite_hash || '') !== (b.suite.suite_hash || '')) return 'suite.suite_hash';
  if ((a.skill.content_hash || '') === (b.skill.content_hash || '')) return 'skill.content_hash';
  return null;
}

// The run's judge-sample count as a reader shows it: the number, or 'unknown'.
function judgeN(r) {
  const n = judgeSamplesOrNull(r);
  return n === null ? 'unknown' : n;
}

function buildDriftReport(a, b, { labelA = 'A', labelB = 'B', mode = 'release' } = {}) {
  const revision = mode === 'revision';

  // AC-6 (spec 014) — THE PRECONDITION, IN THE PATH THAT EMITS THE VERDICT.
  //
  // A comparison across schema versions assumes the two runs measured the same
  // thing. The assumption is checkable: the no-skill arm contains no skill text,
  // so nothing about a skill or a spec revision can move it. If it fails to
  // reproduce, the comparison has no ground, and Report #006 is what that looks
  // like when it is checked — 3 cells, 0 measured, 3 refused.
  //
  // SCOPED TO CROSS-VERSION PAIRS, which is what AC-6 names. Revision-mode pairs
  // already carry their own register through revisionPairProblem(); widening
  // this to every same-version comparison is a live question, recorded in
  // tasks.md as OPEN-QUESTION-3 rather than decided here.
  const crossVersion = String(a.schema_version || '') !== String(b.schema_version || '');
  let refusal = null;
  if (crossVersion) {
    const pre = baselineReproduces(a, b);
    if (!pre.ok) refusal = { key: pre.key, reason: REFUSAL_REASONS[pre.key](pre) };
  }
  const aB = withSkillBands(a);
  const bB = withSkillBands(b);
  const ids = [...new Set([...Object.keys(aB), ...Object.keys(bB)])];

  // Interop (Phase 7): drift verdicts require TESTED receipts on BOTH sides.
  // An imported (DECLARED) receipt is a faithful record of another tool's
  // declaration — its numbers are shown, but band-verified regression/
  // improvement verdicts are never computed from evidence we did not run.
  const levelOf = (r) => r.verification_level || 'TESTED';
  const belowTested = [[labelA, a], [labelB, b]].filter(([, r]) => levelOf(r) !== 'TESTED');
  // Spec 026 AC-4: an INCOMPLETE receipt on either side computes no per-case
  // verdict. RECEIPT.md has said so since v0.3.1; the differ did not ask.
  const incompleteSides = [[labelA, a], [labelB, b]].filter(([, r]) => r.run && r.run.status === 'incomplete');
  // Spec 026 AC-12: a different judge on either side suppresses the verdict.
  const judge = judgeDiffers(a, b, ids, aB, bB);
  const judgeProblem = judge.problems.length ? judge.problems.join('; ') : null;
  // A REFUSAL IS A RESULT, and it suppresses the verdict exactly as an
  // untested input does: no delta is asserted, and the reason travels with it.
  const measured = belowTested.length === 0 && !refusal && incompleteSides.length === 0 && !judgeProblem;

  // THE UNDERPOWERED STATE RIDES BESIDE THE VERDICT VALUE (spec 035 R-6). The value
  // is unchanged, because Reports 006 to 008 and spec 009's gate compare against it
  // and a published record quotes the lines it produced. `power` says, for a case
  // the rule did not separate, whether the two with_skill arms' own spreads and
  // draws could have resolved a shift of the effect floor, by the rule lib/verdict.js
  // applies to a single receipt.
  const rawWith = (r) => new Map(r.results.cases.filter((c) => c.mode === 'with_skill').map((c) => [c.id, c]));
  const aRaw = rawWith(a);
  const bRaw = rawWith(b);
  const perCase = ids.map((id) => {
    const before = aB[id] || null;
    const after = bB[id] || null;
    const delta = (before && after) ? round(after.mean - before.mean) : null;
    const verdict = refusal ? 'refused'
      : !measured ? 'not measured'
      : (before && after) ? verdictWithFloor(before, after, delta) : 'n/a';
    let power = null;
    if (measured && before && after && (verdict === WITHIN_NOISE || verdict === WITHIN_NOISE_FLOOR)) {
      const ra = armOf(aRaw.get(id)); const rb = armOf(bRaw.get(id));
      const rule = ra && rb ? caseRule(ra, rb) : null;
      if (rule && rule.state === 'underpowered') power = { state: 'underpowered', drawsNeeded: rule.drawsNeeded, reason: rule.reason, ...(rule.spread !== undefined ? { spread: rule.spread } : {}) };
    }
    return { id, before, after, delta, verdict, power };
  });
  // Sort worst-first: regressions, then by delta.
  const order = { regression: 0, [WITHIN_NOISE]: 1, [WITHIN_NOISE_FLOOR]: 1, improvement: 2, 'n/a': 3, 'not measured': 3, refused: 3 };
  perCase.sort((x, y) => (order[x.verdict] - order[y.verdict]) || ((x.delta || 0) - (y.delta || 0)));

  const aAgg = aggWithBand(a);
  const bAgg = aggWithBand(b);
  const headlineDelta = round(bAgg.mean - aAgg.mean);
  const regressions = perCase.filter((r) => r.verdict === 'regression');

  const L = [];
  if (revision) {
    // The axis leads. In a release-drift report the model is what moved and it
    // belongs at the top; here the model is the control and the skill's own text
    // is the finding, so content_hash is the first row a reader meets.
    L.push(`# Revision drift report`);
    L.push('');
    L.push(`**Skill:** ${a.skill.name} \`${a.skill.version}\``);
    L.push('');
    L.push(`**Report type:** revision drift — the skill's own text is the variable under test; the substrate is held fixed.`);
    L.push('');
    L.push(`Left column is the **pinned** revision; right column is the **current** upstream revision.`);
    L.push('');
    L.push(`| | ${labelA} | ${labelB} |`);
    L.push(`|---|---|---|`);
    L.push(`| skill content_hash | \`${short(a.skill.content_hash)}\` | \`${short(b.skill.content_hash)}\` |`);
    L.push(`| model (held) | \`${a.run.model_id}\` | \`${b.run.model_id}\` |`);
    L.push(`| provider (held) | ${a.run.provider || 'anthropic'} | ${b.run.provider || 'anthropic'} |`);
    L.push(`| surface (held) | ${a.run.surface} | ${b.run.surface} |`);
    L.push(`| suite_hash (held) | \`${short(a.suite.suite_hash)}\` | \`${short(b.suite.suite_hash)}\` |`);
    L.push(`| run date (UTC) | ${a.run.date_utc} | ${b.run.date_utc} |`);
    L.push(`| judge samples/case | ${judgeN(a)} | ${judgeN(b)} |`);
    L.push(`| with_skill (mean ± band) | ${bandStr(aAgg)} | ${bandStr(bAgg)} |`);
    L.push(`| baseline score | ${pct(a.comparison.baseline_score)} | ${pct(b.comparison.baseline_score)} |`);
    L.push(`| skill lift (Δ) | ${fmt(a.comparison.delta)} | ${fmt(b.comparison.delta)} |`);
    L.push('');
  } else {
  L.push(`# Drift report`);
  L.push('');
  L.push(`**Skill:** ${a.skill.name} \`${a.skill.version}\``);
  L.push('');
  L.push(`| | ${labelA} | ${labelB} |`);
  L.push(`|---|---|---|`);
  L.push(`| model | \`${a.run.model_id}\` | \`${b.run.model_id}\` |`);
  L.push(`| run date (UTC) | ${a.run.date_utc} | ${b.run.date_utc} |`);
  L.push(`| surface | ${a.run.surface} | ${b.run.surface} |`);
  L.push(`| judge samples/case | ${judgeN(a)} | ${judgeN(b)} |`);
  L.push(`| skill content_hash | \`${short(a.skill.content_hash)}\` | \`${short(b.skill.content_hash)}\` |`);
  L.push(`| suite_hash | \`${short(a.suite.suite_hash)}\` | \`${short(b.suite.suite_hash)}\` |`);
  L.push(`| with_skill (mean ± band) | ${bandStr(aAgg)} | ${bandStr(bAgg)} |`);
  L.push(`| baseline score | ${pct(a.comparison.baseline_score)} | ${pct(b.comparison.baseline_score)} |`);
  L.push(`| skill lift (Δ) | ${fmt(a.comparison.delta)} | ${fmt(b.comparison.delta)} |`);
  L.push('');
  }

  const warnings = [];
  // In revision mode the changed skill text is the INDEPENDENT VARIABLE, not
  // contamination, and the held-constant substrate is what makes the comparison
  // valid. The release-drift caveat below says the opposite of both, so it is
  // replaced rather than suppressed: a reader is told what is held, and why a
  // separated band is attributable to the revision.
  if (revision) {
    warnings.push(`model \`${a.run.model_id}\`, provider ${a.run.provider || 'anthropic'}, surface ${a.run.surface} and suite_hash \`${short(a.suite.suite_hash)}\` are held constant across both receipts — the skill text is the only variable under test, so a band-separated move above the ${EFFECT_FLOOR} floor is attributable to the revision.`);
  }
  if (!revision && a.skill.content_hash !== b.skill.content_hash) warnings.push('skill content_hash differs — the skill itself changed between receipts, so drift mixes skill edits with model drift.');
  if (!revision && a.suite.suite_hash !== b.suite.suite_hash) warnings.push('suite_hash differs — the eval suite changed; per-case comparison may be misleading.');
  if (a.skill.name !== b.skill.name) warnings.push(`different skills (${a.skill.name} vs ${b.skill.name}) — comparison is not meaningful.`);
  // v0.8 (spec 043 AC-1): an absent judge count is unknown, said as such, never read as 1.
  if (judgeN(a) === 'unknown' || judgeN(b) === 'unknown') warnings.push('the judge-sample count is unknown on one or both receipts: the receipt does not establish it, so whether the bands are sampled cannot be read from it.');
  if (judgeN(a) === 1 || judgeN(b) === 1) warnings.push('one or both receipts are single-sample (no bands): non-overlap can only be trusted when both sides are sampled.');
  // WHAT SUPPRESSED THE VERDICT IS SAID, AND IT IS SAID CORRECTLY (spec 016 AC-3
  // and AC-4, closing F-015-B).
  //
  // TWO DIFFERENT THINGS can suppress a verdict, and this line used to describe
  // only one of them. A REFUSAL — the baseline-reproduction precondition — set
  // `measured` false and then the caveat rendered `belowTested`, which on a
  // refused pair is EMPTY: the page read `verdicts NOT computed — .` under a
  // headline claiming `0 receipt(s) below TESTED`, on a pair where both receipts
  // were TESTED. An empty reason and a false statement, in the artifact a report's
  // verdicts come from. The refusal's own cause-honest reason was computed into
  // `refusal.reason` and thrown away by the renderer, so nothing a reader could
  // see said why the comparison had stopped.
  //
  // Each half is proved load-bearing by a mutation that patches THIS source in a
  // disposable copy. An earlier revision guarded them with const-true flags and
  // this sentence described those; the flags were removed because a
  // defect-restoring branch resident in the published tree is a hazard, and the
  // sentence outlived them by one commit.
  if (refusal) {
    warnings.push(`verdicts NOT computed — the comparison was REFUSED before any verdict was formed: ${refusal.reason}`);
  }
  if (belowTested.length) {
    warnings.push(`verdicts NOT computed — ${belowTested.map(([l, r]) => `${l} is ${levelOf(r)}${r.run && r.run.source ? ` (${r.run.source})` : ''}`).join('; ')}. Drift verdicts require TESTED receipts on both sides; declared numbers are shown as context only (see /interop.html).`);
  }
  if (incompleteSides.length) {
    warnings.push(`verdicts NOT computed — ${incompleteSides.map(([l, r]) => `${l} is incomplete (run.status incomplete; it excluded ${r.run.failed_case_count || 0} case(s) whose arm could not be measured)`).join('; ')}. A receipt with an unmeasured arm is not evidence for a per-case verdict; its aggregates are shown as context only.`);
  }
  if (judgeProblem) {
    warnings.push(`verdicts NOT computed — the two receipts were graded by different judges: ${judgeProblem}. A verdict across two instruments says nothing about the skill; regrade one side with the other's judge (lib/reuse.js triage: regrade).`);
  }
  if (judge.unrecorded.length) {
    warnings.push(`judge template unrecorded on ${judge.unrecorded.map((x) => (x === 'A' ? labelA : labelB)).join(' and ')} (a pre-v0.6 receipt carries no run.judge.prompt_template_hash); the judge model id and the rubric hashes are compared, the template is not.`);
  }
  // Cross-provider / cross-surface disclosure (Phase 6). A comparison across
  // providers is a skill-DURABILITY comparison across substrates, not model drift
  // over time; across surfaces, sampling control differs. Both are flagged so a
  // reader never mistakes one for the other (see docs/neutrality.html).
  if (!revision && (a.run.provider || 'anthropic') !== (b.run.provider || 'anthropic')) warnings.push(`different providers (${a.run.provider || 'anthropic'} vs ${b.run.provider || 'anthropic'}) — this is a cross-substrate durability comparison, not model drift over time; read the delta, not absolute scores (see the neutrality policy).`);
  if (!revision && a.run.surface !== b.run.surface) warnings.push(`different surfaces (${a.run.surface} vs ${b.run.surface}) — sampling control differs between surfaces; compare with care.`);
  // The legend for the band markers, printed whenever either side carries one.
  // A two-letter marker a reader cannot decode is worse than no marker.
  // GATED ON WHETHER A LABEL IS ACTUALLY RENDERED, not on whether the data
  // carries a source. A legend explains markers on the page; if `bandStr` emits
  // none, the legend is describing something the reader cannot see. Asked of
  // `bandStr` itself rather than recomputed, so the two cannot disagree.
  //
  // THE LEGEND DESCRIBES ONLY THE SOURCES ON THE PAGE, AND THE PAIR IS CALLED
  // NOT LIKE FOR LIKE ONLY WHEN IT IS NOT (spec 031 AC-6). This used to print one
  // sentence whenever any label rendered, naming both sources and saying the
  // comparison was the only one an older receipt admits and was not like for
  // like. Every v0.4 and v0.5 band carries a label, so two v0.5 receipts with
  // `generation` bands on both sides were told they were not like for like, and
  // shown a `(legacy)` source neither carried. The sources are read per receipt,
  // from the markers each side renders; the difference is stated only when the
  // two sides' sets differ, naming which side carries which.
  const renderedSources = (bands) => [...new Set(Object.values(bands)
    .map((x) => (x && (/\(([a-z]+)\)\s*$/.exec(bandStr(x)) || [])[1]) || null).filter(Boolean))].sort();
  const sourcesA = renderedSources(aB);
  const sourcesB = renderedSources(bB);
  const sourcesOnPage = [...new Set([...sourcesA, ...sourcesB])].sort();
  const sourcesDiffer = sourcesA.join() !== sourcesB.join();
  if (sourcesOnPage.length) {
    const LEGEND = {
      generation: '`(generation)` is an ACROSS-DRAW spread: the standard deviation of the case\'s score across n generation draws per arm.',
      legacy: '`(legacy)` is a JUDGE-SAMPLE spread over a single generation: the standard deviation across the judge\'s samples of that one text.',
    };
    const legend = sourcesOnPage.map((s) => LEGEND[s] || `\`(${s})\` is a band source this differ does not describe.`);
    if (sourcesDiffer) {
      const side = (label, s) => `${label} carries ${s.length ? s.map((x) => `\`(${x})\``).join(' and ') : 'no labelled'} bands`;
      legend.push(`The two receipts' bands come from different sources: ${side(labelA, sourcesA)}, ${side(labelB, sourcesB)}. They are different statistics, so a per-case comparison across them is not like for like.`);
    }
    warnings.push(`band provenance: ${legend.join(' ')}`);
  }
  if (warnings.length) {
    L.push('> **⚠ Caveats**');
    for (const w of warnings) L.push(`> - ${w}`);
    L.push('');
  }

  const nWithin = perCase.filter((r) => isWithinNoise(r.verdict)).length;
  const nFloor = perCase.filter((r) => r.verdict === WITHIN_NOISE_FLOOR).length;
  L.push(`## Headline`);
  L.push('');
  if (!measured) {
    // THE HEADLINE NAMES THE CAUSE THAT ACTUALLY APPLIES. `belowTested.length`
    // was printed unconditionally, so a refused pair got "0 receipt(s) below
    // TESTED" — a statement measurably false of the receipts it was given.
    if (incompleteSides.length) {
      // An incomplete side is a fact about that receipt alone (spec 026 AC-4)
      // and leads whatever else is wrong with the pair.
      L.push(`**NOT MEASURED — ${incompleteSides.map(([l]) => l).join(' and ')} incomplete: a case's arm could not be measured, so no per-case verdict is computed.**`);
    } else if (refusal) {
      // The reason is a complete sentence and already ends by saying no verdict
      // is asserted; prefixing that again produced "REFUSED — no verdict is
      // asserted. the baseline arm did not reproduce…" — a duplicated clause and
      // a lower-case sentence start, in the artifact a published report quotes.
      L.push(`**REFUSED — ${refusal.reason}**`);
    } else if (belowTested.length) {
      L.push(`**NOT MEASURED — ${belowTested.length} receipt(s) below TESTED. Drift verdicts require TESTED receipts on both sides; the declared numbers above are context, not band-verified evidence.**`);
    } else if (judgeProblem) {
      L.push(`**NOT MEASURED — different judges: ${judgeProblem}. No verdict crosses two instruments.**`);
    } else {
      L.push('**NOT MEASURED — no verdict is asserted.**');
    }
    L.push('');
  } else {
    L.push(`**${revision ? revisionHeadline(perCase) : headlineVerdict(perCase)}**`);
    L.push('');
    // ONE LABEL PER CASE, THE TABLE'S (F-5 of
    // specs/031-artefact-claims/evidence/approval-20260915T032341Z.md). A case whose
    // bands do not overlap but whose move is below the floor is labelled below
    // effect floor in the per-case table. This line counted it among the cases with
    // no separation detected and then called the same cases band-separated; it now
    // counts the two apart, as the table labels them. Neither is a separation under
    // the rule, which is what the headline above says.
    L.push(`with_skill mean moved ${fmt(headlineDelta)} (${bandStr(aAgg)} → ${bandStr(bAgg)}; band = suite dispersion). Per-case band-overlap verdicts: ${regressions.length} regression(s), ${perCase.filter((r) => r.verdict === 'improvement').length} improvement(s), ${nWithin - nFloor} with no separation detected${nFloor ? `, ${nFloor} below the ${EFFECT_FLOOR} effect floor` : ''}.`);
    L.push('');
    const underpowered = perCase.filter((r) => r.power);
    if (underpowered.length) {
      // One count, one sentence, one draws line: the worst case's (spec 035 AC-5).
      const spread = underpowered.find((r) => r.power.reason === 'spread');
      const most = underpowered.filter((r) => r.power.reason === 'draws').sort((x, y) => y.power.drawsNeeded - x.power.drawsNeeded)[0];
      const worst = spread ? { value: null, reason: 'spread', case: spread.id, spread: spread.power.spread }
        : most ? { value: most.power.drawsNeeded, reason: 'draws', case: most.id }
          : { value: 2, reason: 'single_draw', case: underpowered[0].id };
      const powerLine = `Underpowered: ${underpowered.length} of the cases with no separation under the rule. ${UNDERPOWERED_LINE}. ${drawsLine(worst)}`;
      L.push(powerLine);
      L.push('');
    }
  }

  L.push(`## Per-case with_skill (band overlap → verdict)`);
  L.push('');
  L.push(`| case | ${labelA} (mean ± sd) | ${labelB} (mean ± sd) | Δ | verdict |`);
  L.push(`|---|---|---|---|---|`);
  for (const r of perCase) {
    const flag = r.verdict === 'regression' ? '🔻 regression' : r.verdict === 'improvement' ? '🔼 improvement' : r.verdict === WITHIN_NOISE_FLOOR ? 'below effect floor' : r.verdict === WITHIN_NOISE ? 'no separation detected' : r.verdict === 'not measured' ? 'not measured' : 'n/a';
    const label = r.power ? `${flag}; ${UNDERPOWERED_LINE}` : flag;
    L.push(`| \`${r.id}\` | ${r.before ? bandStr(r.before) : 'n/a'} | ${r.after ? bandStr(r.after) : 'n/a'} | ${fmt(r.delta)} | ${label} |`);
  }
  L.push('');

  if (regressions.length) {
    L.push(`## Regressions (${regressions.length}) — bands do not overlap`);
    L.push('');
    for (const r of regressions) {
      L.push(`- \`${r.id}\`: ${bandStr(r.before)} → ${bandStr(r.after)} (${fmt(r.delta)})`);
    }
    L.push('');
  }

  return {
    markdown: L.join('\n'), perCase, headlineDelta, regressions,
    refused: !!refusal,
    refusal_reason: refusal ? refusal.reason : null,
    refusal_key: refusal ? refusal.key : null,
  };
}

module.exports = { buildDriftReport, withSkillBands, revisionPairProblem, judgeDiffers };
