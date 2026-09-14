// SPDX-License-Identifier: Apache-2.0
'use strict';

const { priceForModel } = require('./models');

// Dollar cost estimation and live budget tracking for a run.
//
// Week 3 added a HARD USD budget on top of the Week-2 call-count cap. Week 4
// moves prices into the model registry (config/models.json, via lib/models.js)
// and makes the budget guard apply on EVERY entry point and BOTH surfaces:
//   - the projection is printed and, if it exceeds --max-usd, the run is refused
//     BEFORE any model call (on cli too — subscription attention is not free);
//   - a BudgetTracker accumulates the estimated spend AS THE RUN PROCEEDS and
//     hard-stops at 1.25× the cap.
//
// IMPORTANT (honesty): the numbers below are a DELIBERATELY ROUGH upper bound.
// Token counts per call are estimated from a small fixed table (not measured
// with count_tokens), and prices are the standard first-party per-MTok rates
// from the registry. The estimate keeps a run bounded and states the order of
// magnitude — it is not an invoice. On the `claude-cli` surface the ACTUAL
// metered spend is $0 (subscription); the dollar figure is the hypothetical
// "if this had run on the metered API" cost, and it is counted against the caps
// identically so subscription usage is never treated as free.

// Rough per-call token estimates. Chosen to over- rather than under-estimate.
//   - a generation call with the skill prepended carries the SKILL.md as a
//     system prompt (our skills run ~0.4k–8k tokens; 3000 is a generous mean),
//   - a baseline generation carries only the short case prompt,
//   - a judge call carries task + response + rubric + judge system, and emits a
//     short JSON grade.
const TOKENS = {
  gen_with_skill: { input: 3000, output: 900 },
  gen_baseline: { input: 250, output: 900 },
  judge: { input: 1300, output: 200 },
};

// Price per MTok for a model, from the registry (conservative default for an
// unregistered id — see lib/models.js).
function priceFor(modelId) {
  const p = priceForModel(modelId);
  return { input: p.input, output: p.output };
}

function callCostUSD(price, tokens) {
  return (tokens.input / 1e6) * price.input + (tokens.output / 1e6) * price.output;
}

// Estimated USD cost of ONE call of a given kind on a given model. Used by the
// live BudgetTracker so the running spend estimate is built from the same
// per-call pieces as the up-front projection.
function perCallCostUSD(modelId, kind) {
  const tokens = TOKENS[kind];
  if (!tokens) throw new Error(`unknown call kind: ${kind}`);
  return callCostUSD(priceFor(modelId), tokens);
}

// Estimate the metered USD cost of a full run: `caseCount` cases × 2 modes,
// generated on each target model, judged `samples` times each on `judgeModel`.
//
//   returns { totalUSD, perModel: [{ model, usd }], judgeUSD, genUSD, assumptions }
// THE DRAW FACTOR IS REQUIRED AND HAS NO DEFAULT (spec 016 AC-7).
//
// v0.5 draws the generation up to `SAMPLING.max` times per arm, so a run costs
// its one-draw estimate times the number of draws. `projectCalls` learned this in
// spec 014 with a `draws` argument DEFAULTING TO 1 "so every existing caller
// projects exactly what it projected before" — and every existing caller then
// went on projecting a tenth of the run, silently, for two more loops. Spec 015
// corrected the CALL projection in three report scripts and left the DOLLAR
// projection at one draw everywhere, which is the figure a human actually reads
// before authorising a paid run.
//
// A default is what made that invisible, so there is none. Omitting the factor
// throws, which turns a silent understatement into a loud stop — and every call
// site has to say what it means, including the ones that legitimately mean 1.
function estimateRunCostUSD({ caseCount, samples, models, judgeModel, draws }) {
  if (!Number.isFinite(draws) || draws < 1) {
    throw new Error('estimateRunCostUSD: `draws` is required and must be >= 1 — pass SAMPLING.max to project a v0.5 run, or 1 to price a single draw deliberately. It is not defaulted, because a default is how the dollar projection stayed at one draw through two loops.');
  }
  caseCount = caseCount * draws;
  const judgePrice = priceFor(judgeModel);
  const perModel = [];
  let judgeUSD = 0;
  let genUSD = 0;

  for (const model of models) {
    const price = priceFor(model);
    // Two generations per case (with_skill + baseline).
    const gen = caseCount * (callCostUSD(price, TOKENS.gen_with_skill) + callCostUSD(price, TOKENS.gen_baseline));
    // Judge every generation `samples` times → caseCount × 2 modes × samples.
    const judge = caseCount * 2 * samples * callCostUSD(judgePrice, TOKENS.judge);
    perModel.push({ model, usd: round4(gen + judge) });
    genUSD += gen;
    judgeUSD += judge;
  }

  return {
    totalUSD: round4(genUSD + judgeUSD),
    perModel,
    judgeUSD: round4(judgeUSD),
    genUSD: round4(genUSD),
    assumptions: { tokens: TOKENS, judgeModel, draws, note: 'rough upper-bound estimate; registry per-MTok pricing; not measured with count_tokens' },
  };
}

// Live budget tracker. The runner adds the estimated cost of each call as it is
// made; if the accumulated estimate crosses 1.25× the cap the tracker throws a
// BUDGET_HARDSTOP, aborting the run mid-flight. The 1.25× headroom exists because
// the up-front projection already guards the cap; the hard-stop is a backstop
// against a projection that turned out low (e.g. an unregistered model, longer
// outputs). On both surfaces the estimate is counted identically.
class BudgetTracker {
  constructor(capUsd) {
    this.capUsd = capUsd;
    this.hardCap = round4(capUsd * 1.25);
    this.spent = 0;
  }

  // Add estimated USD; throws BUDGET_HARDSTOP if the running total crosses 1.25×.
  add(usd) {
    this.spent = round4(this.spent + usd);
    if (this.spent > this.hardCap) {
      const e = new Error(
        `budget hard-stop: estimated spend $${this.spent.toFixed(4)} exceeded 1.25× cap `
        + `($${this.hardCap.toFixed(4)}; --max-usd $${this.capUsd.toFixed(2)})`);
      e.code = 'BUDGET_HARDSTOP';
      throw e;
    }
    return this.spent;
  }

  remaining() { return round4(this.hardCap - this.spent); }
}

function round4(n) { return Math.round(n * 1e4) / 1e4; }

module.exports = { estimateRunCostUSD, perCallCostUSD, priceFor, BudgetTracker, TOKENS };
