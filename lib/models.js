// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('fs');
const path = require('path');
const { resolveModel } = require('./provider');

// The model registry (config/models.json) is the single source of truth for
// which models Driftproof knows about, their per-MTok prices, tier, and whether
// they are eligible to serve as the judge. The cost guard reads prices here; the
// runner marks each receipt registered/unregistered against it; the release
// trigger appends auto-discovered ids to it.

// The registry ships inside the package (config/models.json), so it resolves
// correctly from a global/npx install — path is relative to this module, not the
// caller's CWD. A user can point at their own registry with DRIFTPROOF_REGISTRY.
const REGISTRY_PATH = process.env.DRIFTPROOF_REGISTRY
  ? path.resolve(process.env.DRIFTPROOF_REGISTRY)
  : path.join(__dirname, '..', 'config', 'models.json');

// Conservative default price for an UNREGISTERED model, per MTok. A budget guard
// must never UNDER-estimate, so an unknown id is costed as if it were the most
// expensive model we know about (Fable-tier). This is deliberately pessimistic:
// an unregistered id should over-project and, if anything, abort early rather
// than quietly overspend. Documented in config/models.json.default_price_note.
const DEFAULT_PRICE = { input: 10.0, output: 50.0 };

let _cache = null;
function loadRegistry(force) {
  if (_cache && !force) return _cache;
  const raw = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  const models = Array.isArray(raw.models) ? raw.models : [];
  const byId = Object.create(null);
  for (const m of models) byId[m.id] = m;
  _cache = { ...raw, models, byId };
  return _cache;
}

// Infer the model family from an id. Used to find a same-family predecessor when
// the release trigger discovers a new model.
function familyOf(id) {
  const m = String(id).match(/claude-(fable|mythos|opus|sonnet|haiku)/i);
  return m ? m[1].toLowerCase() : 'unknown';
}

// Resolve a (possibly aliased) model id against the registry.
//   returns { id: <canonical>, entry: <registry row|null>, registered: bool }
function resolveRegistry(modelId) {
  const reg = loadRegistry();
  const canonical = resolveModel(modelId);
  const entry = reg.byId[canonical] || reg.byId[modelId] || null;
  return { id: canonical, entry, registered: !!entry };
}

// The value stamped into receipt.run.registry.
function registryStatus(modelId) {
  return resolveRegistry(modelId).registered ? 'registered' : 'unregistered';
}

// Price per MTok for a model: the registry price when registered, else the
// conservative default. Returns { input, output, registered }.
function priceForModel(modelId) {
  const { entry } = resolveRegistry(modelId);
  if (entry) return { input: entry.input_price, output: entry.output_price, registered: true };
  return { input: DEFAULT_PRICE.input, output: DEFAULT_PRICE.output, registered: false };
}

// Whether a model is allowed to be the judge (fixed-judge policy — only the
// cheap Haiku judge is judge_eligible; see docs/judge-policy.html).
function isJudgeEligible(modelId) {
  const { entry } = resolveRegistry(modelId);
  return !!(entry && entry.judge_eligible);
}

// The servable same-family predecessor of a model: the registered model in the
// same family with the most recent `released` date strictly before this one
// (falling back to any other same-family model). Null when the family has no
// other member — the trigger then falls back to a cross-family "capability gap"
// pairing. `modelId` need not itself be in the registry.
function familyPredecessor(modelId) {
  const reg = loadRegistry();
  const canonical = resolveModel(modelId);
  const fam = familyOf(canonical);
  const self = reg.byId[canonical] || null;
  const selfDate = self && self.released ? self.released : null;
  let pool = reg.models.filter((m) => familyOf(m.id) === fam && m.id !== canonical);
  if (!pool.length) return null;
  // Prefer members released strictly before the new model when we know its date.
  if (selfDate) {
    const before = pool.filter((m) => m.released && m.released < selfDate);
    if (before.length) pool = before;
  }
  const dated = pool.filter((m) => m.released);
  const chooseFrom = dated.length ? dated : pool;
  chooseFrom.sort((a, b) => String(b.released || '').localeCompare(String(a.released || '')));
  return chooseFrom[0].id;
}

// Append a newly-discovered model id to the registry file (release trigger).
// `firstSeen` is the first-seen date recorded as `released`. Idempotent: a no-op
// if the id already exists. Returns the added entry (or null if already present).
function addDiscoveredModel(id, { firstSeen = null, registryPath = REGISTRY_PATH } = {}) {
  const raw = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  if (raw.models.some((m) => m.id === id)) return null;
  const family = familyOf(id);
  // Best-effort tier from family; unknown families default to frontier pricing.
  const tier = family === 'haiku' ? 'cheap' : family === 'sonnet' ? 'standard' : 'frontier';
  const price = family === 'haiku' ? { input: 1.0, output: 5.0 }
    : family === 'sonnet' ? { input: 3.0, output: 15.0 }
      : { input: 5.0, output: 25.0 };
  const entry = {
    id, family, provider: 'anthropic', released: firstSeen,
    input_price: price.input, output_price: price.output, tier,
    judge_eligible: false, auto_added: true,
  };
  raw.models.push(entry);
  fs.writeFileSync(registryPath, JSON.stringify(raw, null, 2) + '\n');
  _cache = null; // invalidate cache so subsequent lookups see the new entry
  return entry;
}

module.exports = {
  loadRegistry, resolveRegistry, registryStatus, priceForModel, isJudgeEligible,
  familyOf, familyPredecessor, addDiscoveredModel, DEFAULT_PRICE, REGISTRY_PATH,
};
