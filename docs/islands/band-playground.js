// SPDX-License-Identifier: Apache-2.0
//
// The band playground. Two controls over ONE REAL RECEIPT: the bundled
// commit-message-conventions receipt behind docs/badges/, whose per-case scores
// arrive in data-cases. Nothing here is simulated and nothing is fetched.
//
// WHY NOT A SAMPLES-PER-DRAW TOGGLE, which the brief asked for. That receipt is
// schema v0.1: each case carries ONE score and no per-draw samples, so a
// samples control would have nothing real to vary and would be drawing invented
// numbers on the front page of an instrument whose first invariant is that every
// published number carries a receipt. The second control switches between the two
// band definitions this receipt genuinely admits instead, which flips the verdict
// between separated and overlapping from real data and teaches the same lesson.
// Recorded in the spec at AC-33.
//
// EVERY COLOUR IS READ FROM THE TOKENS AT RUNTIME (spec 025 AC-3, A-025-9).
// This file used to carry eleven hex literals hand-synced to docs/tokens.css, a
// second copy of the palette that had to be edited by hand when the palette
// moved - the defect AC-3's rationale names. Each colour is now read out of the
// page's own custom properties when the plot is drawn, so the page and the
// picture cannot disagree; the gate mutates a token and measures the paint follow.
const tok = (name) => (getComputedStyle(document.documentElement).getPropertyValue(name).trim() || `var(${name})`);
const STAMP = { separated: 'is-passed', overlapping: 'is-no-effect', 'below floor': 'is-below-floor' };
// THE WORDS ON THE STAMP (spec 031 A-031-20). The states above are the geometry;
// what the reader is told is a separation detected under the rule, or none detected
// at this sample size, never that the skill moved or that nothing did.
const SAYS = { separated: 'separation detected', overlapping: 'no separation detected', 'below floor': 'below effect floor' };

// The plot geometry, held equal to scripts/band-plot.mjs by assertion rather
// than by import: this file may not import anything, and the gate reads the
// three numbers out of both and compares them (spec 020 AC-41).
const PAD = 32, SPAN = 576, DOT = 6;

const mean = (xs) => xs.reduce((s, v) => s + v, 0) / xs.length;
const dispersion = (xs) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
};

// The two band definitions this receipt admits.
//   point      - what v0.1 recorded: one score per case, so the band has no width
//   dispersion - the cell band Report 007 defines: spread of the per-case means
function bandsFor(cases, definition) {
  return cases.map((arm) => {
    const m = mean(arm);
    const sd = definition === 'dispersion' ? dispersion(arm) : 0;
    return { mean: m, sd, lo: m - sd, hi: m + sd };
  });
}

function verdictFor([baseline, skill], floor) {
  const delta = skill.mean - baseline.mean;
  if (Math.abs(delta) < floor) return { state: 'below floor', delta };
  const overlap = baseline.lo <= skill.hi && skill.lo <= baseline.hi;
  return { state: overlap ? 'overlapping' : 'separated', delta };
}

const X = (v) => PAD + Math.max(0, Math.min(1, v)) * SPAN;

// THE BANDS ARE THE ARMS, ALWAYS, the same rule scripts/band-plot.mjs states:
// graphite without the skill, green with it. The VERDICT is the stamp on the
// result line, not the colour of a bar. Painting the with-skill band by verdict
// made the picture argue its own conclusion, and made JS-on and JS-off show
// different colours for the same arm.
function plot([baseline, skill], state) {
  const c = { paper: tok('--paper'), ink: tok('--arm-baseline'), skill: tok('--arm-skill'), rule: tok('--rule'), muted: tok('--ink-muted') };
  // The point band is the one the bundled receipt actually records, so the
  // playground has to draw it: a filled dot with an outline, not a bar padded up
  // to a visible minimum that would show a range the receipt does not have. The
  // outline is the baseline arm's graphite, so a band paints only arm tokens.
  const bar = (b, y, cls, fill) => {
    if (!(b.hi - b.lo > 0)) {
      return `<circle class="band ${cls} point" cx="${X(b.mean).toFixed(1)}" cy="${y + 5}" r="${DOT}" fill="${fill}" stroke="${c.ink}" stroke-width="1.5"/>`;
    }
    const lo = X(b.lo);
    const w = Math.max(3, X(b.hi) - lo);
    return `<rect class="band ${cls}" x="${lo.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="10" rx="5" fill="${fill}"/>`
      + `<circle class="mean" cx="${X(b.mean).toFixed(1)}" cy="${y + 5}" r="2.5" fill="${c.paper}"/>`;
  };
  return `<svg viewBox="0 0 640 200" role="img" width="100%" class="bandplot is-play">`
    + `<title>Without the skill ${baseline.mean.toFixed(3)} plus or minus ${baseline.sd.toFixed(3)}; `
    + `with the skill ${skill.mean.toFixed(3)} plus or minus ${skill.sd.toFixed(3)}. Result: ${state}.</title>`
    + `<line class="axis" x1="${X(0)}" y1="150" x2="${X(1)}" y2="150" stroke="${c.rule}" stroke-width="1"/>`
    + `<text class="tick" x="${X(0)}" y="168" font-size="12" fill="${c.muted}">0</text>`
    + `<text class="tick" x="${X(1)}" y="168" font-size="12" fill="${c.muted}" text-anchor="end">1</text>`
    + `<text class="arm-label" x="${X(0)}" y="52" font-size="12" fill="${c.muted}">without the skill</text>`
    + bar(baseline, 58, 'band-baseline', c.ink)
    + `<text class="arm-label" x="${X(0)}" y="98" font-size="12" fill="${c.muted}">with the skill</text>`
    + bar(skill, 104, 'band-skill', c.skill)
    + `</svg>`;
}

export function mount(el) {
  let cases;
  try { cases = JSON.parse(el.dataset.cases); } catch (_e) { return; }
  if (!Array.isArray(cases) || cases.length !== 2 || !cases[0].length || !cases[1].length) return;

  const startFloor = Number(el.dataset.floor) || 0.05;
  const fallback = el.querySelector('img');
  if (fallback) fallback.hidden = true;

  // A SEGMENTED CONTROL, NOT A SELECT. Two options is the one case where a menu
  // costs a click to show a reader something they could already have read, and
  // the browser default select is the last control on this site that renders as
  // somebody else's design.
  const ui = document.createElement('div');
  ui.innerHTML = `
<div class="pg-plot"></div>
<label for="pg-range">Effect floor: <output class="pg-floor"></output></label>
<input id="pg-range" class="pg-range" type="range" min="0" max="0.3" step="0.005" value="${startFloor}">
<span class="pg-seg-label">Band definition</span>
<div class="pg-seg" role="radiogroup" aria-label="band-definition">
<button type="button" class="pg-seg-option" role="radio" aria-checked="true" data-def="dispersion">spread across the suite's cases</button>
<button type="button" class="pg-seg-option" role="radio" aria-checked="false" data-def="point">one score per case, no spread</button>
</div>
<p>Result: <output class="pg-verdict"></output></p>`;
  el.appendChild(ui);

  const plotBox = ui.querySelector('.pg-plot');
  const range = ui.querySelector('.pg-range');
  const opts = [...ui.querySelectorAll('.pg-seg-option')];
  const floorOut = ui.querySelector('.pg-floor');
  const verdictOut = ui.querySelector('.pg-verdict');
  const defOf = () => (opts.find((o) => o.getAttribute('aria-checked') === 'true') || opts[0]).dataset.def;

  const draw = () => {
    const floor = Number(range.value);
    const bands = bandsFor(cases, defOf());
    const { state, delta } = verdictFor(bands, floor);
    floorOut.textContent = floor.toFixed(3);
    // THE RESULT LINE IS THE RECEIPT'S STAMP, the same object the hero card puts
    // a verdict in. A playground that draws its answer in a different shape from
    // the site's own receipts is teaching the wrong thing twice.
    verdictOut.innerHTML = `<span class="receipt-stamp ${STAMP[state]}">${SAYS[state]}</span> lift ${delta >= 0 ? '+' : ''}${delta.toFixed(3)}`;
    plotBox.innerHTML = plot(bands, state);
  };

  range.addEventListener('input', draw);
  for (const o of opts) {
    o.addEventListener('click', () => {
      for (const x of opts) x.setAttribute('aria-checked', String(x === o));
      draw();
    });
  }
  draw();
}
