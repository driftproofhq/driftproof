// SPDX-License-Identifier: Apache-2.0
'use strict';

// Small statistics helpers for sampled scores and their bands. A band is a
// descriptive spread, the mean plus or minus one sample standard deviation; it
// carries no coverage probability. Kept dependency-free and deterministic.

function round(n, dp = 6) { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

function mean(xs) {
  if (!xs.length) return 0;
  return round(xs.reduce((a, b) => a + b, 0) / xs.length);
}

// Sample standard deviation (Bessel's n-1). Returns 0 for n < 2 (a single
// sample has no measurable spread). This is the RAW spread of a set of judge
// scores — used for the per-case ± band (borderline rule + per-case drift).
function stddev(xs) {
  const n = xs.length;
  if (n < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / n;
  const varr = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (n - 1);
  return round(Math.sqrt(varr));
}

// Standard error of a mean: stddev / sqrt(n). This is the uncertainty OF THE
// MEAN (shrinks as you take more samples) and is the right band for aggregates,
// which is what run-to-run reproducibility of a headline number actually is.
function stderr(xs) {
  const n = xs.length;
  if (n < 2) return 0;
  return round(stddev(xs) / Math.sqrt(n));
}

// Combine independent uncertainties in quadrature: sqrt(a^2 + b^2). Null when
// either band is null: a combination of a band that could not form cannot form
// either (spec 026 AC-7), and the receipt says why beside it.
function combineUncertainty(a, b) {
  if (a == null || b == null) return null;
  return round(Math.sqrt(a * a + b * b));
}

// Aggregate a set of per-case measurements, each {mean, stddev, n}, into an
// overall mean and a band that is the DISPERSION of the per-case means across
// the suite (sample stddev of the case means) — NOT the standard error of the
// mean. Rationale: the standard error shrinks with sampling/case-count and makes
// the headline hypersensitive (a trivial move reads as a real change), which is
// exactly the cry-wolf failure this project exists to prevent. Suite dispersion
// is a conventional, honest "mean ± stddev across the suite". The drift HEADLINE
// verdict is driven by the per-case band-overlap verdicts (see lib/diff.js), not
// by this aggregate band; this value is a reported summary statistic.
//
// A BAND THE FORMULA CANNOT FORM IS NULL, NEVER 0 (spec 026 AC-7, F3). The
// sample standard deviation of one value is undefined, and the mean of no
// values is not a number; printing 0.000 for either asserted a precision that
// was never measured (the one-case run's `± 0.000`). The rule the receipt
// states (results.aggregates.band_rule) is this function.
function aggregateBands(cases) {
  if (!cases.length) return { mean: null, stddev: null };
  const means = cases.map((c) => c.mean);
  return { mean: mean(means), stddev: means.length < 2 ? null : stddev(means) };
}

// THE NOT-SEPARATED VERDICT VALUE, which is a value and not a label (spec 031
// A-031-20). Callers compare against it, and every display label is mapped from
// it where it is rendered: lib/diff.js prints "no separation detected". The value
// itself is unchanged pending the verdict-rule spec.
const WITHIN_NOISE = 'within noise';

// Do two bands (mean ± half-width, the half-width one sample standard deviation)
// fail to overlap, and in which direction? Returns 'regression' (b below a),
// 'improvement' (b above a), or WITHIN_NOISE (the bands touch or overlap). This
// is the anti-false-positive rule: a separation is detected only when the bands
// are fully apart, and overlap is the absence of a detected separation at the
// sample size used, not evidence that nothing changed.
//   regression   : meanB + hwB < meanA - hwA
//   improvement  : meanB - hwB > meanA + hwA
function bandVerdict(meanA, hwA, meanB, hwB) {
  if (meanB + hwB < meanA - hwA) return 'regression';
  if (meanB - hwB > meanA + hwA) return 'improvement';
  return WITHIN_NOISE;
}

// The variance ratio: how much larger the GENERATION-level spread is than the
// JUDGE-level spread this instrument has always sampled. The number Report #006
// wanted and could not produce.
//
// A ZERO DENOMINATOR YIELDS null, NEVER A DIVISION RESULT. Infinity (or NaN) is
// a fabricated finding: it reads as "infinitely noisier" when what actually
// happened is that the judge agreed with itself perfectly and the ratio is
// undefined. A null says the ratio could not be formed, which is true.
function varianceRatio(generationSd, judgeSdMean) {
  const g = Number(generationSd), j = Number(judgeSdMean);
  if (!Number.isFinite(g) || !Number.isFinite(j)) return null;
  if (j === 0) return null;
  return round(g / j);
}

module.exports = { mean, stddev, stderr, combineUncertainty, aggregateBands, bandVerdict, round, varianceRatio, WITHIN_NOISE };
