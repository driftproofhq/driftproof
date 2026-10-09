// SPDX-License-Identifier: Apache-2.0
//
// docs/benchmark-gap/gap.js - the benchmark gap calculator (spec 167).
//
// Identical to the frozen protocol of the leaderboard-noise analysis (R-9's METHOD.md): Wilson 95%
// score interval per arm, the Newcombe hybrid difference interval with no continuity correction, and
// the minimum-gap rule (smallest integer k questions out of N that the rule calls separated, at the
// midpoint-centred pair B = floor((N-k)/2), A = B+k). z is the frozen constant, never recomputed.
//
// PLAIN FUNCTIONS, NO MODULE SYSTEM, so this one file runs unchanged as a page script (loaded by a
// plain <script src>, no build step) and as the file tests/benchmark-gap.test.js requires directly.
'use strict';

const Z = 1.959963984540054;

function wilsonInterval(p, N) {
  const z2 = Z * Z;
  const D = 1 + z2 / N;
  const C = (p + z2 / (2 * N)) / D;
  const H = (Z * Math.sqrt(p * (1 - p) / N + z2 / (4 * N * N))) / D;
  return [C - H, C + H];
}

// Newcombe hybrid Wilson difference, no continuity correction. Both arms share one N in this
// calculator's own use (two scores on the same benchmark), but the two Wilson intervals are taken
// per arm, so a caller giving two different Ns still gets the general formula.
function newcombeDiff(pA, NA, pB, NB) {
  const [LA, UA] = wilsonInterval(pA, NA);
  const [LB, UB] = wilsonInterval(pB, NB);
  const d = pA - pB;
  const lower = d - Math.sqrt((pA - LA) ** 2 + (UB - pB) ** 2);
  const upper = d + Math.sqrt((UA - pA) ** 2 + (pB - LB) ** 2);
  return [lower, upper];
}

const SEPARATED = 'separated';
const NO_SEPARATION = 'no separation detected at this sample size';

function verdictOf(lower, upper) {
  return (lower > 0 || upper < 0) ? SEPARATED : NO_SEPARATION;
}

// The frozen minimum-gap rule: the smallest integer k, 1 <= k <= N, with B = floor((N-k)/2) and
// A = B + k, whose Newcombe interval for A/N vs B/N excludes zero. Every case tested here calls back
// in at most minimumGapQuestions(N) steps, never N, so this stays fast at every preset's N.
function minimumGapQuestions(N, from = 1) {
  for (let k = from; k <= N; k++) {
    const B = Math.floor((N - k) / 2);
    const A = B + k;
    const [lower, upper] = newcombeDiff(A / N, N, B / N, N);
    if (verdictOf(lower, upper) === SEPARATED) return k;
  }
  return null;
}

// The inverse question: holding the observed gap's size (as a fraction of questions, not a count)
// fixed, the smallest N at which that same fraction would just meet the frozen rule's minimum gap.
// Bounded, for a page that must stay responsive: past this many questions the search gives up and
// the page says so, rather than spinning on a gap so small no realistic benchmark would show it.
// The minimum gap never falls as N grows (checked for every N up to the limit), so each N resumes
// from the previous N's k: the same answer as a search from 1 at every N, in milliseconds rather than
// the second and more a search from 1 took on every keystroke for a small gap.
const REQUIRED_N_SEARCH_LIMIT = 100000;
function requiredQuestionsForGap(gapFraction) {
  if (!(gapFraction > 0)) return null;
  let from = 1;
  for (let n = 2; n <= REQUIRED_N_SEARCH_LIMIT; n++) {
    const k = minimumGapQuestions(n, from);
    if (k === null) { from = 1; continue; }
    if (k / n <= gapFraction) return n;
    from = k;
  }
  return null;
}

// Tab 2: Driftproof's own band rule, mean plus or minus one SD, ddof=1.
function mean(xs) { return xs.reduce((s, v) => s + v, 0) / xs.length; }
function sampleSd(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

const NOT_ENOUGH_DRAWS = 'not enough draws to tell';

// { mean, sd, runs } per arm (runs is the run count actually used, not the raw list length, so a
// caller passing a scores list and one passing a precomputed mean/sd/n read the same way).
function runsVerdict(armA, armB) {
  if (armA.runs < 2 || armB.runs < 2) return NOT_ENOUGH_DRAWS;
  const loA = armA.mean - armA.sd, hiA = armA.mean + armA.sd;
  const loB = armB.mean - armB.sd, hiB = armB.mean + armB.sd;
  const overlap = loA <= hiB && loB <= hiA;
  return overlap ? NO_SEPARATION : SEPARATED;
}

const CALC = {
  Z,
  wilsonInterval,
  newcombeDiff,
  verdictOf,
  minimumGapQuestions,
  requiredQuestionsForGap,
  mean,
  sampleSd,
  runsVerdict,
  SEPARATED,
  NO_SEPARATION,
  NOT_ENOUGH_DRAWS,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = CALC;
}

// ── the page's own wiring is the island docs/islands/benchmark-gap.js (spec 170, issue 50) ───────
// Below the frozen core, two things the page needs and the numeric test never reads. First, the
// result's markup, as pure functions of the typed values: the build writes the page's opening
// example with this code, and the island renders every later result with it, so the first paint is
// the final one. An empty field is missing, never 0: no verdict and no chart until every field a tab
// needs is typed, and a field typed out of range gets a short message in place of the result. The
// result is one paper receipt card: the stamp and one sentence, three band rows (A, B, and A minus B
// against a zero line) on an axis zoomed to the scores, then the interval numbers. Second, the
// hand-off: the island imports this file as a module, where module.exports does not exist.
// Since spec 174 (issue 63) each tab renders twice: the plain result above the fold (items, runs), in
// words for a reader who has never met an interval, and the receipt card behind "Show the statistics"
// (itemsStats, runsStats), the stamp, the plot and the numbers as they were.
(function renderers() {
  // A typed field: null when it is empty (missing, not zero), NaN when it is not a number.
  function fieldValue(raw) {
    const v = String(raw == null ? '' : raw).trim();
    if (v === '') return null;
    return Number(v);
  }
  const isScore = (x) => Number.isFinite(x) && x >= 0 && x <= 100;
  const isCount = (x) => Number.isInteger(x) && x >= 1;
  const pct = (x) => (x * 100).toFixed(1);

  // An axis zoomed to the range around the values it carries, with round ticks.
  function axisFor(lo, hi, floor, ceil) {
    const pad = Math.max((hi - lo) * 0.15, 0.5);
    let a = Math.max(floor, lo - pad), b = Math.min(ceil, hi + pad);
    if (b - a < 2) { const m = (a + b) / 2; a = Math.max(floor, m - 1); b = Math.min(ceil, m + 1); }
    const step = [0.5, 1, 2, 2.5, 5, 10, 20, 25].find((s) => (b - a) / s <= 5) || 25;
    a = Math.floor(a / step) * step; b = Math.ceil(b / step) * step;
    const ticks = [];
    for (let t = a; t <= b + step / 1000; t += step) ticks.push(Number(t.toFixed(4)));
    return { lo: a, hi: b, ticks };
  }

  // The plot paints by the site's own tokens, written as var() so the same markup serves the build
  // and the page; its faces and sizes are the stylesheet's (`.gap-plot` in docs/tokens.css).
  const W = 520, L = 112, R = 16, BAND = 18;
  function bandPlot({ a, b, d = null, labelA = 'A', labelB = 'B', labelD = 'A minus B' }) {
    const span = W - L - R;
    const top = axisFor(Math.min(a.lo, b.lo) * 100, Math.max(a.hi, b.hi) * 100, 0, 100);
    const X = (v, ax) => L + ((v - ax.lo) / (ax.hi - ax.lo)) * span;
    const row = (band, y, fill, label, ax, scale, grey) => {
      const lo = X(band.lo * scale, ax), hiX = X(band.hi * scale, ax), at = X(band.point * scale, ax);
      return `<text class="arm-label" x="0" y="${y + BAND / 2 + 5}">${label}</text>`
        + `<rect class="band" x="${lo.toFixed(1)}" y="${y}" width="${Math.max(3, hiX - lo).toFixed(1)}" height="${BAND}" rx="1.5" fill="var(${fill})"${grey ? ' stroke="var(--ink)" stroke-width="1"' : ''}/>`
        + `<line class="point" x1="${at.toFixed(1)}" y1="${y - 3}" x2="${at.toFixed(1)}" y2="${y + BAND + 3}" stroke="var(${grey ? '--ink' : '--accent-ink'})" stroke-width="2"/>`;
    };
    const grid = (ax, y1, y2, ty, unit) => ax.ticks.map((t) => `<line class="grat" x1="${X(t, ax).toFixed(1)}" y1="${y1}" x2="${X(t, ax).toFixed(1)}" y2="${y2}" stroke="var(--rule)" stroke-width="1"/>`).join('')
      + `<line class="axis" x1="${L}" y1="${y2}" x2="${W - R}" y2="${y2}" stroke="var(--ink)" stroke-width="1"/>`
      + ax.ticks.map((t) => `<text class="tick" x="${X(t, ax).toFixed(1)}" y="${ty}" text-anchor="middle">${t}${unit}</text>`).join('');
    let body = grid(top, 6, 96, 114, '%') + row(a, 18, '--arm-skill', labelA, top, 100) + row(b, 58, '--arm-baseline', labelB, top, 100);
    let H = 124;
    if (d) {
      const diff = axisFor(Math.min(d.lo, 0) * 100, Math.max(d.hi, 0) * 100, -100, 100);
      body += grid(diff, 140, 190, 208, '')
        + `<line class="zero" x1="${X(0, diff).toFixed(1)}" y1="136" x2="${X(0, diff).toFixed(1)}" y2="190" stroke="var(--ink)" stroke-width="1.5" stroke-dasharray="4 3"/>`
        + row(d, 154, '--grey-band', labelD, diff, 100, true);
      H = 218;
    }
    // `gap-plot`, not `bandplot`: a bandplot is a generated plot file's bytes (spec 038 AC-6), and this
    // drawing is computed from the typed values, never a file.
    return `<svg viewBox="0 0 ${W} ${H}" role="img" width="100%" class="gap-plot">`
      + `<title>${labelA} ${(a.point * 100).toFixed(1)}%, interval ${(a.lo * 100).toFixed(1)} to ${(a.hi * 100).toFixed(1)}; `
      + `${labelB} ${(b.point * 100).toFixed(1)}%, interval ${(b.lo * 100).toFixed(1)} to ${(b.hi * 100).toFixed(1)}. Result: ${a.verdict}.</title>`
      + body
      + `</svg>`;
  }

  function stampHtml(word) {
    const cls = word === CALC.SEPARATED ? 'is-passed' : word === CALC.NOT_ENOUGH_DRAWS ? 'is-below-floor' : 'is-no-effect';
    return `<span class="receipt-stamp ${cls}">${word}</span>`;
  }
  const message = (lines) => `<div class="gap-message" role="status">${lines.map((l) => `<p>${l}</p>`).join('')}</div>`;
  const numbers = (rows) => `<dl class="gap-numbers">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd><code>${v}</code></dd></div>`).join('')}</dl>`;

  // THE PLAIN RESULT (spec 174): one verdict for each case the frozen rule tells apart, no new
  // threshold. The gap clears the noise (the rule's separated), it does not, and too few questions to
  // tell (no gap on this many questions, however large, would clear it; fewer than two runs on the
  // runs tab). The stamp behind the expander keeps the rule's own words.
  const PLAIN = { ahead: (who) => `${who}'s lead clears the noise`, close: 'Too close to call a winner', few: 'Not enough questions to tell', fewRuns: 'Not enough runs to tell' };
  const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  const bare = (x) => String(Number((x * 100).toFixed(1)));
  const plain = (lines) => `<article class="gap-result gap-plain" aria-label="Result">
${lines.filter(Boolean).map(([cls, text]) => `<p class="${cls}">${text}</p>`).join('\n')}
</article>`;

  // Tab 1's fields, read once for both renderings: a message, nothing yet, or the figures.
  function itemsRead(rawA, rawB, rawN) {
    const pA = fieldValue(rawA), pB = fieldValue(rawB), n = fieldValue(rawN);
    const wrong = [];
    if (pA !== null && !isScore(pA)) wrong.push('Score A is a percentage from 0 to 100.');
    if (pB !== null && !isScore(pB)) wrong.push('Score B is a percentage from 0 to 100.');
    if (n !== null && !isCount(n)) wrong.push('The number of benchmark questions is a whole number, at least 1.');
    if (wrong.length) return { wrong };
    if (pA === null || pB === null || n === null) return null;
    const fA = pA / 100, fB = pB / 100;
    const [dLo, dHi] = CALC.newcombeDiff(fA, n, fB, n);
    return { fA, fB, n, dLo, dHi, verdict: CALC.verdictOf(dLo, dHi), lead: Math.round(Math.abs(fA - fB) * n), minGapQ: CALC.minimumGapQuestions(n) };
  }

  // Tab 1, above the fold: the plain verdict, the lead, the difference the rule needs at this N, and
  // one sentence built from the same figures. Each argument is a field's raw text.
  function items(rawA, rawB, rawN) {
    const r = itemsRead(rawA, rawB, rawN);
    if (!r) return '';
    if (r.wrong) return message(r.wrong);
    const { fA, fB, n, verdict, lead, minGapQ } = r;
    const who = fA >= fB ? 'A' : 'B';
    const [hi, lo] = fA >= fB ? [fA, fB] : [fB, fA];
    const word = minGapQ === null ? PLAIN.few : verdict === CALC.SEPARATED ? PLAIN.ahead(who) : PLAIN.close;
    const needed = minGapQ === null
      ? `Difference needed for stronger evidence: more than ${plural(n, 'question', 'questions')} can show.`
      : `Difference needed for stronger evidence: about ${((minGapQ / n) * 100).toFixed(1)} points.`;
    const beat = `${bare(hi)}% beat ${bare(lo)}% by ${plural(lead, 'question', 'questions')}`;
    const why = lead === 0 ? `${bare(fA)}% and ${bare(fB)}% are level on ${plural(n, 'question', 'questions')}, so neither score is ahead.`
      : minGapQ === null ? `${beat}, but with only ${plural(n, 'question', 'questions')} no gap, however large, stands out from sampling noise.`
        : verdict === CALC.SEPARATED ? `${beat}, and with ${n} questions sampling noise alone can span ${plural(minGapQ - 1, 'question', 'questions')}, so a gap this large stands out from it.`
          : `${beat}, but with only ${n} questions a gap this small can happen from sampling noise.`;
    return plain([
      ['gap-verdict', word],
      ['gap-lead', lead === 0 ? 'The two scores are level.' : `${who} is ahead by ${plural(lead, 'question', 'questions')}.`],
      ['gap-needed', needed],
      ['gap-why', why],
    ]);
  }

  // Tab 1, behind the expander: the receipt card, the stamp, the plot and the interval numbers.
  function itemsStats(rawA, rawB, rawN) {
    const r = itemsRead(rawA, rawB, rawN);
    if (!r || r.wrong) return '';
    const { fA, fB, n, dLo, dHi, verdict, lead, minGapQ } = r;
    const [loA, hiA] = CALC.wilsonInterval(fA, n);
    const [loB, hiB] = CALC.wilsonInterval(fB, n);
    const span = minGapQ === null ? `all ${n} question${n === 1 ? '' : 's'}` : `${minGapQ - 1} question${minGapQ - 1 === 1 ? '' : 's'}`;
    return `<article class="gap-result" aria-label="The statistics">
<div class="gap-head"><p class="gap-stamp">${stampHtml(verdict)}</p>
<p class="gap-sentence">${pct(fA)}% vs ${pct(fB)}% on ${n} questions is a lead of ${lead} question${lead === 1 ? '' : 's'}; at this size, noise alone can span ${span}.</p></div>
${bandPlot({ a: { point: fA, lo: loA, hi: hiA, verdict }, b: { point: fB, lo: loB, hi: hiB, verdict }, d: { point: fA - fB, lo: dLo, hi: dHi }, labelA: 'Score A', labelB: 'Score B' })}
${numbers([['Score A, Wilson 95%', `${pct(loA)} to ${pct(hiA)}`], ['Score B, Wilson 95%', `${pct(loB)} to ${pct(hiB)}`], ['A minus B, Newcombe', `${pct(dLo)} to ${pct(dHi)} points`]])}
</article>`;
  }

  // Tab 2: repeated runs, Driftproof's band rule. Means and SDs are typed in percent, as tab 1's
  // scores are, and read as fractions for the plot; the overlap test gives the same verdict either way.
  function runsRead(f) {
    const v = Object.fromEntries(Object.entries(f).map(([k, raw]) => [k, fieldValue(raw)]));
    const wrong = [];
    for (const [k, arm] of [['a', 'A'], ['b', 'B']]) {
      if (v[`${k}Mean`] !== null && !isScore(v[`${k}Mean`])) wrong.push(`${arm}'s average score is a percentage from 0 to 100.`);
      if (v[`${k}Sd`] !== null && !(Number.isFinite(v[`${k}Sd`]) && v[`${k}Sd`] >= 0)) wrong.push(`${arm}'s spread between runs is a number of points, 0 or more.`);
      if (v[`${k}N`] !== null && !isCount(v[`${k}N`])) wrong.push(`${arm}'s number of runs is a whole number, at least 1.`);
    }
    if (wrong.length) return { wrong };
    if (Object.values(v).some((x) => x === null)) return null;
    const aMean = v.aMean / 100, aSd = v.aSd / 100, bMean = v.bMean / 100, bSd = v.bSd / 100;
    return { aMean, aSd, bMean, bSd, verdict: CALC.runsVerdict({ mean: aMean, sd: aSd, runs: v.aN }, { mean: bMean, sd: bSd, runs: v.bN }) };
  }

  // Tab 2, above the fold. The spread is one standard deviation; the band rule calls a gap wider than
  // the two spreads together separated, and the difference needed says so in points.
  function runs(f) {
    const r = runsRead(f);
    if (!r) return '';
    if (r.wrong) return message(r.wrong);
    const { aMean, aSd, bMean, bSd, verdict } = r;
    const who = aMean >= bMean ? 'A' : 'B';
    const gap = Math.abs(aMean - bMean) * 100;
    const word = verdict === CALC.NOT_ENOUGH_DRAWS ? PLAIN.fewRuns : verdict === CALC.SEPARATED ? PLAIN.ahead(who) : PLAIN.close;
    const averaged = `A averaged ${bare(aMean)}% and B ${bare(bMean)}%`;
    const why = verdict === CALC.NOT_ENOUGH_DRAWS ? `${averaged}, but with fewer than two runs on a side there is no spread between runs to compare.`
      : verdict === CALC.SEPARATED ? `${averaged}, and with each side's usual spread between runs, the two ranges do not overlap.`
        : `${averaged}, but with each side's usual spread between runs, the two ranges overlap, so a gap this small can happen from run-to-run noise.`;
    return plain([
      ['gap-verdict', word],
      ['gap-lead', gap.toFixed(1) === '0.0' ? 'The two averages are level.' : `${who} is ahead by ${gap.toFixed(1)} points on average.`],
      verdict === CALC.NOT_ENOUGH_DRAWS ? null : ['gap-needed', `Difference needed for stronger evidence: more than ${((aSd + bSd) * 100).toFixed(1)} points.`],
      ['gap-why', why],
    ]);
  }

  // Tab 2, behind the expander.
  function runsStats(f) {
    const r = runsRead(f);
    if (!r || r.wrong) return '';
    const { aMean, aSd, bMean, bSd, verdict } = r;
    return `<article class="gap-result" aria-label="The statistics">
<div class="gap-head"><p class="gap-stamp">${stampHtml(verdict)}</p>
<p>This is the band rule the published reports use: mean plus or minus one standard deviation, bands overlapping or not. See the <a href="/methodology/">methodology page</a>.</p></div>
${bandPlot({ a: { point: aMean, lo: aMean - aSd, hi: aMean + aSd, verdict }, b: { point: bMean, lo: bMean - bSd, hi: bMean + bSd, verdict }, labelA: 'Arm A', labelB: 'Arm B' })}
${numbers([['Arm A, mean plus or minus one SD', `${pct(aMean - aSd)} to ${pct(aMean + aSd)}`], ['Arm B, mean plus or minus one SD', `${pct(bMean - bSd)} to ${pct(bMean + bSd)}`]])}
</article>`;
  }

  CALC.render = { items, itemsStats, runs, runsStats };
})();

if (typeof document !== 'undefined' && typeof globalThis !== 'undefined') globalThis.driftproofGap = CALC;
