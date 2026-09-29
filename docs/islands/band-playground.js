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
// THE PLOT IS THE ONE scripts/band-plot.mjs DRAWS (spec 038 A-038-3): a graticule at each quarter,
// twenty-pixel bands in the ribbon's two passes, each arm's mean printed on its band in receipt
// stock, or beside a band too narrow to hold it. The geometry is held equal to that module by
// assertion rather than by import - this file may not import anything (spec 020 AC-41).
const TICKS = [0, 0.25, 0.5, 0.75, 1];
const BAND = 20, AXIS = 150, TICK_Y = 168, GRAT_TOP = 44;
// The width a figure needs, estimated as the generator estimates it: 0.62em a character at 12px,
// plus a margin. Wider than the face the page sets it in, so a figure this calls inside is inside.
const fits = (chars) => chars * 0.62 * 12 + 10;

function plot([baseline, skill], state, floor) {
  const c = { paper: tok('--paper'), stock: tok('--paper-2'), ink: tok('--arm-baseline'), skill: tok('--arm-skill'), rule: tok('--rule'), muted: tok('--ink-muted'), text: tok('--ink') };
  // A value sits on its band when the band can hold it, and beside it when it cannot. A band's
  // centre IS its mean, so the figure set there marks the mean and no separate marker is drawn.
  const value = (b, y, arm) => {
    const s = b.mean.toFixed(3);
    const cy = (y + BAND / 2 + 4).toFixed(1);
    const lo = X(b.lo), hi = X(b.hi), at = X(b.mean);
    if (b.hi - b.lo > 0 && hi - lo >= fits(s.length)) {
      return `<text class="value value-${arm} on-band" x="${at.toFixed(1)}" y="${cy}" text-anchor="middle" font-size="12" font-weight="500" fill="${c.stock}">${s}</text>`;
    }
    const right = Math.max(hi, at + DOT) + 5;
    const left = Math.min(lo, at - DOT) - 5;
    return right + fits(s.length) - 10 <= X(1) + PAD - 2
      ? `<text class="value value-${arm} beside" x="${right.toFixed(1)}" y="${cy}" text-anchor="start" font-size="12" font-weight="500" fill="${c.text}">${s}</text>`
      : `<text class="value value-${arm} beside" x="${left.toFixed(1)}" y="${cy}" text-anchor="end" font-size="12" font-weight="500" fill="${c.text}">${s}</text>`;
  };
  // The point band is the one the bundled receipt records under the point definition, so the
  // playground has to draw it: a filled dot with an outline, not a bar padded up to a visible
  // minimum that would show a range the receipt does not have (spec 020 AC-41). The outline is the
  // baseline arm, so a band paints only arm tokens.
  const bar = (b, y, cls, fill, arm) => {
    if (!(b.hi - b.lo > 0)) {
      return `<circle class="band ${cls} point" cx="${X(b.mean).toFixed(1)}" cy="${(y + BAND / 2).toFixed(1)}" r="${DOT}" fill="${fill}" stroke="${c.ink}" stroke-width="1.5"/>` + value(b, y, arm);
    }
    const lo = X(b.lo);
    const w = Math.max(3, X(b.hi) - lo);
    return `<rect class="band ${cls}" x="${lo.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${BAND}" rx="1.5" fill="${fill}"/>` + value(b, y, arm);
  };
  const at = (t, anchor) => `<text class="tick" x="${X(t).toFixed(1)}" y="${TICK_Y}" font-size="12" fill="${c.muted}"${anchor ? ` text-anchor="${anchor}"` : ''}>${t}</text>`;
  const floorAt = Math.max(0, Math.min(1, baseline.mean + floor));
  return `<svg viewBox="0 0 640 200" role="img" width="100%" class="bandplot is-play">`
    + `<title>Without the skill ${baseline.mean.toFixed(3)} plus or minus ${baseline.sd.toFixed(3)}; `
    + `with the skill ${skill.mean.toFixed(3)} plus or minus ${skill.sd.toFixed(3)}. Result: ${state}.</title>`
    + TICKS.map((t) => `<line class="grat" x1="${X(t).toFixed(1)}" y1="${GRAT_TOP}" x2="${X(t).toFixed(1)}" y2="${AXIS}" stroke="${c.rule}" stroke-width="1"/>`).join('')
    + `<line class="axis" x1="${X(0)}" y1="${AXIS}" x2="${X(1)}" y2="${AXIS}" stroke="${c.text}" stroke-width="1"/>`
    + TICKS.map((t, i) => at(t, i === 0 ? null : i === TICKS.length - 1 ? 'end' : 'middle')).join('')
    + `<line class="floor" x1="${X(floorAt).toFixed(1)}" y1="${GRAT_TOP}" x2="${X(floorAt).toFixed(1)}" y2="${AXIS}" stroke="${c.muted}" stroke-width="1" stroke-dasharray="3 3"/>`
    + `<text class="arm-label" x="${X(0)}" y="52" font-size="12" font-style="italic" fill="${c.muted}">without the skill</text>`
    + bar(baseline, 58, 'band-baseline', c.ink, 'baseline')
    + `<text class="arm-label" x="${X(0)}" y="98" font-size="12" font-style="italic" fill="${c.muted}">with the skill</text>`
    + bar(skill, 104, 'band-skill', c.skill, 'skill')
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
    plotBox.innerHTML = plot(bands, state, floor);
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
