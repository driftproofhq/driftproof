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

// ── the page's own wiring, browser only ─────────────────────────────────────────────────────────
if (typeof document !== 'undefined') {
  (function benchmarkGapPage() {
    const Q = (sel, root) => (root || document).querySelector(sel);
    const QA = (sel, root) => [...(root || document).querySelectorAll(sel)];
    const tok = (name) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || `var(${name})`);

    const PAD = 32, SPAN = 576, BAND = 20, AXIS = 150, TICK_Y = 168, GRAT_TOP = 44, TICKS_PCT = [0, 25, 50, 75, 100];
    const X = (v) => PAD + Math.max(0, Math.min(1, v)) * SPAN;

    function bandPlot({ a, b, labelA = 'A', labelB = 'B' }) {
      const c = { ink: tok('--arm-baseline'), skill: tok('--arm-skill'), rule: tok('--rule'), muted: tok('--ink-muted'), text: tok('--ink'), stock: tok('--paper-2') };
      const bar = (band, y, fill, label) => {
        const lo = X(band.lo), hiX = X(band.hi), at = X(band.point);
        const w = Math.max(3, hiX - lo);
        const cy = y + BAND / 2 + 4;
        return `<text class="arm-label" x="${X(0)}" y="${y - 6}" font-size="12" font-style="italic" fill="${c.muted}">${label}</text>`
          + `<rect class="band" x="${lo.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${BAND}" rx="1.5" fill="${fill}"/>`
          + `<circle cx="${at.toFixed(1)}" cy="${(y + BAND / 2).toFixed(1)}" r="3" fill="${c.text}"/>`
          + `<text x="${(hiX + 6).toFixed(1)}" y="${cy.toFixed(1)}" font-size="12" font-weight="500" fill="${c.text}">${(band.point * 100).toFixed(1)}%</text>`;
      };
      const at = (t, i) => `<text class="tick" x="${X(t / 100).toFixed(1)}" y="${TICK_Y}" font-size="12" fill="${c.muted}"${i === 0 ? '' : i === TICKS_PCT.length - 1 ? ' text-anchor="end"' : ' text-anchor="middle"'}>${t}%</text>`;
      return `<svg viewBox="0 0 640 200" role="img" width="100%" class="bandplot">`
        + `<title>${labelA} ${(a.point * 100).toFixed(1)}%, interval ${(a.lo * 100).toFixed(1)} to ${(a.hi * 100).toFixed(1)}; `
        + `${labelB} ${(b.point * 100).toFixed(1)}%, interval ${(b.lo * 100).toFixed(1)} to ${(b.hi * 100).toFixed(1)}. Result: ${a.verdict}.</title>`
        + TICKS_PCT.map((t) => `<line x1="${X(t / 100).toFixed(1)}" y1="${GRAT_TOP}" x2="${X(t / 100).toFixed(1)}" y2="${AXIS}" stroke="${c.rule}" stroke-width="1"/>`).join('')
        + `<line x1="${X(0)}" y1="${AXIS}" x2="${X(1)}" y2="${AXIS}" stroke="${c.text}" stroke-width="1"/>`
        + TICKS_PCT.map(at).join('')
        + bar(a, 58, c.ink, labelA)
        + bar(b, 104, c.skill, labelB)
        + `</svg>`;
    }

    function stampHtml(word) {
      const cls = word === CALC.SEPARATED ? 'is-passed' : word === CALC.NOT_ENOUGH_DRAWS ? 'is-below-floor' : 'is-no-effect';
      return `<span class="receipt-stamp ${cls}">${word}</span>`;
    }

    function pct(x) { return (x * 100).toFixed(1); }

    // ── URL state ──────────────────────────────────────────────────────────────────────────────
    function readState() {
      const p = new URLSearchParams(location.search);
      return { mode: p.get('mode') === 'runs' ? 'runs' : 'items', a: p.get('a') || '', b: p.get('b') || '', n: p.get('n') || '' };
    }
    function writeState(s) {
      const p = new URLSearchParams();
      if (s.mode === 'runs') p.set('mode', 'runs');
      if (s.a !== '') p.set('a', s.a);
      if (s.b !== '') p.set('b', s.b);
      if (s.n !== '') p.set('n', s.n);
      const url = `${location.pathname}${p.toString() ? `?${p}` : ''}`;
      history.replaceState(null, '', url);
      return url;
    }

    // ── tab 1: two scores, item noise ─────────────────────────────────────────────────────────
    function wireItemsTab(root) {
      const scoreA = Q('#gap-score-a', root), scoreB = Q('#gap-score-b', root), nInput = Q('#gap-n', root);
      const preset = Q('#gap-preset', root);
      const out = Q('#gap-items-out', root);

      preset.addEventListener('change', () => {
        if (preset.value) nInput.value = preset.value;
        render();
      });

      function render() {
        const pA = Number(scoreA.value), pB = Number(scoreB.value), n = Number(nInput.value);
        if (!(pA >= 0 && pA <= 100 && pB >= 0 && pB <= 100 && n > 0)) { out.innerHTML = ''; return; }
        const fA = pA / 100, fB = pB / 100;
        const [loA, hiA] = CALC.wilsonInterval(fA, n);
        const [loB, hiB] = CALC.wilsonInterval(fB, n);
        const [dLo, dHi] = CALC.newcombeDiff(fA, n, fB, n);
        const verdict = CALC.verdictOf(dLo, dHi);
        const gapFrac = Math.abs(fA - fB);
        const gapQuestions = Math.round(gapFrac * n);
        const minGapQ = CALC.minimumGapQuestions(n);
        const neededN = CALC.requiredQuestionsForGap(gapFrac);
        out.innerHTML = `
${bandPlot({ a: { point: fA, lo: loA, hi: hiA, verdict }, b: { point: fB, lo: loB, hi: hiB, verdict }, labelA: 'Score A', labelB: 'Score B' })}
<p>${stampHtml(verdict)}</p>
<p>${pct(fA)}% and ${pct(fB)}% on ${n} questions are ${gapQuestions} question${gapQuestions === 1 ? '' : 's'} apart (${pct(gapFrac)} points); this benchmark needs about ${minGapQ === null ? 'more than ' + n : minGapQ} question${minGapQ === 1 ? '' : 's'}, ${minGapQ === null ? '' : pct(minGapQ / n) + ' points, '}to tell two models apart at this N.</p>
<p>At this gap size, ${neededN === null ? 'no benchmark size this page searched' : `a benchmark of about ${neededN} questions`} would be the smallest where that gap just clears noise.</p>
<p>Newcombe difference interval: [${pct(dLo)}, ${pct(dHi)}] points. Wilson 95% intervals: A [${pct(loA)}, ${pct(hiA)}], B [${pct(loB)}, ${pct(hiB)}].</p>`;
      }
      [scoreA, scoreB, nInput].forEach((el) => el.addEventListener('input', () => { render(); sync(); }));
      return render;
    }

    // ── tab 2: repeated runs, Driftproof's band rule ──────────────────────────────────────────
    function wireRunsTab(root) {
      const out = Q('#gap-runs-out', root);
      const fields = {
        aMean: Q('#gap-runs-a-mean', root), aSd: Q('#gap-runs-a-sd', root), aN: Q('#gap-runs-a-n', root),
        bMean: Q('#gap-runs-b-mean', root), bSd: Q('#gap-runs-b-sd', root), bN: Q('#gap-runs-b-n', root),
      };
      // Means and SDs are typed in percent, as tab 1's scores are, and read here as fractions for the
      // plot; the band rule's overlap test gives the same verdict at either scale.
      function render() {
        const aMean = Number(fields.aMean.value) / 100, aSd = (Number(fields.aSd.value) || 0) / 100, aN = Number(fields.aN.value) || 0;
        const bMean = Number(fields.bMean.value) / 100, bSd = (Number(fields.bSd.value) || 0) / 100, bN = Number(fields.bN.value) || 0;
        if (!(aN > 0 && bN > 0) || Number.isNaN(aMean) || Number.isNaN(bMean)) { out.innerHTML = ''; return; }
        const verdict = CALC.runsVerdict({ mean: aMean, sd: aSd, runs: aN }, { mean: bMean, sd: bSd, runs: bN });
        out.innerHTML = `
${bandPlot({ a: { point: aMean, lo: aMean - aSd, hi: aMean + aSd, verdict }, b: { point: bMean, lo: bMean - bSd, hi: bMean + bSd, verdict }, labelA: 'Arm A', labelB: 'Arm B' })}
<p>${stampHtml(verdict)}</p>
<p>This is the band rule the published reports use: mean plus or minus one standard deviation, bands overlapping or not. See the <a href="/methodology/">methodology page</a>.</p>`;
      }
      Object.values(fields).forEach((el) => el.addEventListener('input', render));
      return render;
    }

    function sync() {
      const mode = Q('.gap-tab[aria-selected="true"]').dataset.tab;
      writeState({ mode, a: Q('#gap-score-a').value, b: Q('#gap-score-b').value, n: Q('#gap-n').value });
    }

    function init() {
      const root = document;
      const renderItems = wireItemsTab(root);
      wireRunsTab(root);

      const tabs = QA('.gap-tab');
      const panels = { items: Q('#gap-panel-items'), runs: Q('#gap-panel-runs') };
      function selectTab(name) {
        tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
        Object.entries(panels).forEach(([k, el]) => { el.hidden = k !== name; });
      }
      tabs.forEach((t) => t.addEventListener('click', () => { selectTab(t.dataset.tab); sync(); }));

      const state = readState();
      selectTab(state.mode === 'runs' ? 'runs' : 'items');
      if (state.a) Q('#gap-score-a').value = state.a;
      if (state.b) Q('#gap-score-b').value = state.b;
      if (state.n) Q('#gap-n').value = state.n;
      renderItems();

      const copyBtn = Q('#gap-copy-link');
      if (copyBtn) {
        copyBtn.addEventListener('click', () => {
          const mode = Q('.gap-tab[aria-selected="true"]').dataset.tab;
          const url = writeState({ mode, a: Q('#gap-score-a').value, b: Q('#gap-score-b').value, n: Q('#gap-n').value });
          navigator.clipboard?.writeText(location.origin + url);
        });
      }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  })();
}
