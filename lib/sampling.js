// SPDX-License-Identifier: Apache-2.0
'use strict';

// Generation sampling policy — receipt spec v0.5.
//
// WHY THIS EXISTS. Until v0.5 a verdict rested on ONE generation draw per arm,
// and the band a receipt carried was the judge re-scoring that single response.
// Report #006 measured the other axis directly and found it larger: across-draw
// sd 0.186 and 0.183, against judge-level noise several times smaller. Every
// figure this instrument published was error-barred on the smaller of the two
// noise sources. This module samples the larger one.
//
// PURE. No I/O, no provider, no clock. Two functions over a draw list, so the
// policy is testable from fixtures with no model call and the runner cannot
// smuggle a different rule past the gate.

const {
  GENERATION_SAMPLES_MIN, GENERATION_SAMPLES_MAX,
  GENERATION_SD_THRESHOLD, GENERATION_STABILITY_EPS,
} = require('../config');
const { mean, stddev, round, varianceRatio } = require('./stats');

const SAMPLING = {
  min: GENERATION_SAMPLES_MIN,
  max: GENERATION_SAMPLES_MAX,
  sdThreshold: GENERATION_SD_THRESHOLD,
  stabilityEps: GENERATION_STABILITY_EPS,
};

// A draw is `measured` or `unmeasured`. An UNMEASURED draw carries no score and
// is excluded from every statistic — never scored zero (F-009-L). A zero is a
// measurement claim; a timeout is the absence of one, and filling it with zero
// invents a regression nobody observed.
const isMeasured = (d) => d && d.status === 'measured' && typeof d.mean === 'number';

// WHICH null the ratio is (F-014-C). The ratio is generation-sd over mean
// judge-sd, and at k=1 the per-draw judge spread is 0 by construction — so the
// number v0.5 exists to produce could not exist at the sampling every pre-v0.5
// example used, and the receipt recorded a null that read identically to "the
// judge agreed with itself perfectly". Those are different measurements.
//
// EVERY REASON NAMES WHAT WAS OBSERVED AND NONE NAMES A CAUSE (spec 014 AC-7).
// `judge_samples_unknown` exists for exactly that reason: with no sample list on
// the draws, the count cannot be established, and picking between the other two
// would be asserting something this function cannot see.
function unavailableReason(measured, ratio) {
  if (ratio !== null) return null;
  if (!measured.length) return 'no_measured_draws';
  const counts = measured.map((d) => (Array.isArray(d.samples) ? d.samples.length : null));
  if (counts.some((c) => c === null)) return 'judge_samples_unknown';
  if (counts.every((c) => c <= 1)) return 'single_judge_sample';
  return 'judge_sd_zero';
}

function acrossDraws(draws) {
  const all = Array.isArray(draws) ? draws : [];
  const measured = all.filter(isMeasured);
  const means = measured.map((d) => d.mean);
  const judgeSds = measured.map((d) => (typeof d.stddev === 'number' ? d.stddev : 0));
  const sd = means.length ? stddev(means) : 0;
  const judgeSdMean = judgeSds.length ? mean(judgeSds) : 0;
  const ratio = varianceRatio(sd, judgeSdMean);
  return {
    n_drawn: all.length,
    n_measured: measured.length,
    n_unmeasured: all.length - measured.length,
    mean: means.length ? round(mean(means)) : null,
    sd: round(sd),
    judge_sd_mean: round(judgeSdMean),
    variance_ratio: ratio,
    variance_ratio_unavailable: unavailableReason(measured, ratio),
  };
}

// Should the runner draw again? Returns the STOPPING REASON as well as the
// decision: an adaptive rule that does not record why it stopped is unauditable,
// and #006's own probe stopped at 20 draws because a person decided to.
function nextAction(draws) {
  const a = acrossDraws(draws);
  const drawn = a.n_drawn;

  // Every draw failed. More draws are not obviously wrong, but continuing to
  // burn calls on a surface that is not answering is, and the receipt should say
  // that is what happened rather than report an empty mean.
  if (drawn >= SAMPLING.min && a.n_measured === 0) return { stop: true, reason: 'unmeasured_exhausted' };

  // THE CAP IS CHECKED BEFORE THE MINIMUM. Reversed, a run whose draws mostly
  // failed reported `below_min` while what actually stopped it was the ceiling —
  // the receipt named a reason that was not the reason. Approval finding, AC-4.
  if (drawn >= SAMPLING.max) return { stop: true, reason: 'max_reached' };

  if (a.n_measured < SAMPLING.min) return { stop: false, reason: 'below_min' };

  // Tight enough at the minimum: the extra draws would buy nothing.
  if (a.sd <= SAMPLING.sdThreshold) return { stop: true, reason: 'min_reached' };

  // (the bounded-escalation ceiling is enforced above, before the minimum)

  // …unless the estimate has stopped moving: two successive prefixes agreeing to
  // within eps means further draws are not changing what we would report.
  if (a.n_measured > SAMPLING.min) {
    const prev = acrossDraws(draws.slice(0, -1));
    if (prev.n_measured >= SAMPLING.min && Math.abs(a.sd - prev.sd) < SAMPLING.stabilityEps) {
      return { stop: true, reason: 'stabilised' };
    }
  }
  return { stop: false, reason: 'escalating' };
}

module.exports = { SAMPLING, acrossDraws, nextAction, isMeasured, unavailableReason };
