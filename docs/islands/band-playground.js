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
const PAPER = '#FBFAF7';
const INK = '#1F2933';
const OUTLINE = '#14181D';
const STATE = { separated: '#2E7A0B', overlapping: '#5A646E', 'below floor': '#806300' };

// The plot geometry, held equal to scripts/band-plot.mjs by assertion rather
// than by import: this file may not import anything, and the gate reads the
// three numbers out of both and compares them (spec 020 AC-41).
const PAD = 22, SPAN = 276, DOT = 5;

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

function plot([baseline, skill], state) {
  // The point band is the one the bundled receipt actually records, so the
  // playground has to draw it: a filled dot with an outline, not a bar padded up
  // to a visible minimum that would show a range the receipt does not have.
  const bar = (b, y, fill) => {
    if (!(b.hi - b.lo > 0)) {
      return `<circle cx="${X(b.mean).toFixed(1)}" cy="${y + 5}" r="${DOT}" fill="${fill}" stroke="${OUTLINE}" stroke-width="1.5"/>`;
    }
    const lo = X(b.lo);
    const w = Math.max(3, X(b.hi) - lo);
    return `<rect x="${lo.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="10" rx="5" fill="${fill}"/>`
      + `<circle cx="${X(b.mean).toFixed(1)}" cy="${y + 5}" r="2.5" fill="${PAPER}"/>`;
  };
  return `<svg viewBox="0 0 320 96" role="img" width="320" height="96">`
    + `<title>Without the skill ${baseline.mean.toFixed(3)} plus or minus ${baseline.sd.toFixed(3)}; `
    + `with the skill ${skill.mean.toFixed(3)} plus or minus ${skill.sd.toFixed(3)}. Result: ${state}.</title>`
    + `<line x1="${X(0)}" y1="74" x2="${X(1)}" y2="74" stroke="#E2E0D8" stroke-width="1"/>`
    + `<text x="${X(0)}" y="88" font-size="9" fill="#5A646E">0</text>`
    + `<text x="${X(1)}" y="88" font-size="9" fill="#5A646E" text-anchor="end">1</text>`
    + `<text x="${X(0)}" y="14" font-size="9" fill="#5A646E">without the skill</text>`
    + bar(baseline, 18, INK)
    + `<text x="${X(0)}" y="44" font-size="9" fill="#5A646E">with the skill</text>`
    + bar(skill, 48, STATE[state])
    + `</svg>`;
}

export function mount(el) {
  let cases;
  try { cases = JSON.parse(el.dataset.cases); } catch (_e) { return; }
  if (!Array.isArray(cases) || cases.length !== 2 || !cases[0].length || !cases[1].length) return;

  const startFloor = Number(el.dataset.floor) || 0.05;
  const fallback = el.querySelector('img');
  if (fallback) fallback.hidden = true;

  const ui = document.createElement('div');
  ui.innerHTML = `
<div class="pg-plot"></div>
<label>Effect floor: <output class="pg-floor"></output>
<input class="pg-range" type="range" min="0" max="0.3" step="0.005" value="${startFloor}"></label>
<label>Band definition:
<select class="pg-def" name="band-definition">
<option value="dispersion">spread across the suite's cases</option>
<option value="point">one score per case, no spread</option>
</select></label>
<p>Result: <output class="pg-verdict"></output></p>`;
  el.appendChild(ui);

  const plotBox = ui.querySelector('.pg-plot');
  const range = ui.querySelector('.pg-range');
  const def = ui.querySelector('.pg-def');
  const floorOut = ui.querySelector('.pg-floor');
  const verdictOut = ui.querySelector('.pg-verdict');

  const draw = () => {
    const floor = Number(range.value);
    const bands = bandsFor(cases, def.value);
    const { state, delta } = verdictFor(bands, floor);
    floorOut.textContent = floor.toFixed(3);
    verdictOut.textContent = `${state} (lift ${delta >= 0 ? '+' : ''}${delta.toFixed(3)})`;
    verdictOut.style.color = STATE[state];
    plotBox.innerHTML = plot(bands, state);
  };

  range.addEventListener('input', draw);
  def.addEventListener('change', draw);
  draw();
}
