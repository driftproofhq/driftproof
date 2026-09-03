// SPDX-License-Identifier: Apache-2.0
'use strict';

// Small statistics helpers for sampled judging and confidence bands. Kept
// dependency-free and deterministic.

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

// Combine independent uncertainties in quadrature: sqrt(a^2 + b^2).
function combineUncertainty(a, b) {
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
function aggregateBands(cases) {
  if (!cases.length) return { mean: 0, stddev: 0 };
  const means = cases.map((c) => c.mean);
  return { mean: mean(means), stddev: stddev(means) };
}

// Do two confidence bands (mean ± half-width) fail to overlap, and in which
// direction? Returns 'regression' (b below a), 'improvement' (b above a), or
// 'within noise' (bands touch/overlap). This is the anti-false-positive rule:
// a change is only claimed when the bands are fully separated.
//   regression   : meanB + hwB < meanA - hwA
//   improvement  : meanB - hwB > meanA + hwA
function bandVerdict(meanA, hwA, meanB, hwB) {
  if (meanB + hwB < meanA - hwA) return 'regression';
  if (meanB - hwB > meanA + hwA) return 'improvement';
  return 'within noise';
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

module.exports = { mean, stddev, stderr, combineUncertainty, aggregateBands, bandVerdict, round, varianceRatio };
