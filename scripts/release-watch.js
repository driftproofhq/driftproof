#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// release-watch.js — poll the Anthropic models endpoint, diff against the model
// registry, and on a NEW model id: append it to the registry (released =
// first-seen date, auto_added) and kick scripts/prepare-report.js to prepare a
// DRAFT drift report for the pair. NOTIFY, DON'T PUBLISH.
//
// Idempotency:
//   - a seen-models state file (state/seen-models.json) records every id ever
//     observed; only ids not yet seen can trigger. On first run it is seeded
//     from the registry, so existing models never trigger.
//   - a trigger-attempts file (state/trigger-attempts.json) records the last
//     attempt date per model; a FAILED prepare run is not retried more than once
//     per day (and a SUCCESS is recorded as seen, so it never retriggers).
//
// Endpoint source (Anthropic), in precedence order — KEYLESS BY DEFAULT, never fatal:
//   - mock: --models-file <path> (or DRIFTPROOF_MODELS_FILE) shaped like the
//     endpoint ({data:[{id}]}), used by the gate.
//   - live (upgrade): GET https://api.anthropic.com/v1/models with ANTHROPIC_API_KEY
//     (a plain list call — NOT a model inference call). Refreshes the models cache.
//   - keyless: no key → diff the local models cache (state/models-cache.json, the
//     "models_cache diff" surface, WRITTEN by scripts/refresh-models-cache.js from
//     a public no-auth enumeration surface); no cache → complete the cycle with an
//     empty served set (a clean no-op). An empty env is a keyless run, NOT an error.
//   OpenAI: polled with OPENAI_API_KEY (or a mock); keyless → diff openai ids from
//   the same models cache; no key AND no cache → skip-with-log. NEVER via codex.
//
// --seed-only baselines the current snapshot: every served id is marked seen and
// nothing triggers, so the next real poll only fires on ids new to a LATER snapshot.
//
// Run with --stub to stub prepare-report's runner (no model calls).

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const models = require('../lib/models');
const { prepareReport } = require('./prepare-report');

const DEFAULT_STATE_DIR = path.join(ROOT, 'state');
const LOG = path.join(ROOT, 'state', 'release-watch.log');

function todayUtc(nowIso) { return (nowIso || new Date().toISOString()).slice(0, 10); }

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_e) { return fallback; }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

function log(line, opts = {}) {
  const stamp = opts.now || new Date().toISOString();
  const msg = `[${stamp}] ${line}`;
  if (!opts.quiet) console.log(msg);
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, msg + '\n'); } catch (_e) { /* best effort */ }
}

// Read model ids from a mock endpoint file ({data:[{id}]} | {models:[…]} | [ids]).
function readModelsFile(modelsFile, label) {
  const raw = readJson(modelsFile, null);
  if (!raw) throw new Error(`could not read ${label} models file ${modelsFile}`);
  const list = Array.isArray(raw) ? raw : (raw.data || raw.models || []);
  return list.map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean);
}

// ── models cache (the keyless diff surface) ──────────────────────────────────
// A flat snapshot of currently-served NATIVE model ids for BOTH providers, shaped:
//   { fetched_at: <iso>, source: <string>, ids: ["claude-opus-5", "gpt-5.6-sol", …] }
// It is WRITTEN by scripts/refresh-models-cache.js (a separate daily timer that
// reads a public no-auth enumeration surface) and READ here. A keyless poll diffs
// against it; the anthropic poll filters it to claude-*, the openai poll to
// gpt-*/o<n>. It is never authoritative for "what launched today" the way a live
// keyed poll is (see RUNBOOK: aggregator lag is disclosed), but it lets an empty
// env still surface a genuinely-new id instead of being a permanent no-op.
function readModelsCache(cachePath) {
  if (!cachePath) return null;
  const raw = readJson(cachePath, null);
  if (!raw || !Array.isArray(raw.ids)) return null;
  return { ids: raw.ids.filter(Boolean), fetched_at: raw.fetched_at || null, source: raw.source || null };
}

// Live Anthropic models-LIST call (a plain list call — NOT a model inference call).
function fetchAnthropicApi(key) {
  return new Promise((resolve, reject) => {
    const req = https.request('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`models endpoint ${res.statusCode}: ${body.slice(0, 300)}`));
        try {
          const parsed = JSON.parse(body);
          resolve((parsed.data || []).map((m) => m.id).filter(Boolean));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Resolve the Anthropic-served model ids. Returns { ids, source } where source is
// 'mock' | 'api' | 'cache' | 'none'. KEYLESS BY DEFAULT: without ANTHROPIC_API_KEY
// the poll is NEVER fatal. A key, when present, is an automatic UPGRADE to the live
// API poll. Without a key it diffs the models cache (filtered to claude-*) that the
// refresher wrote; with no cache it completes the cycle with an empty served set.
async function fetchModelIds({ modelsFile, cache, now }) {
  if (modelsFile) return { ids: readModelsFile(modelsFile, 'anthropic'), source: 'mock' };
  const key = process.env.ANTHROPIC_API_KEY;
  if (key) return { ids: await fetchAnthropicApi(key), source: 'api' };
  if (cache) {
    const ids = cache.ids.filter((id) => /^claude-/.test(id));
    log(`keyless mode: no ANTHROPIC_API_KEY — diffing ${ids.length} anthropic id(s) from the models cache (${cache.source || '?'}, fetched ${cache.fetched_at || 'unknown'})`, { now });
    return { ids, source: 'cache' };
  }
  log('keyless mode: no ANTHROPIC_API_KEY and no models cache — completing the poll cycle with an empty served set (no new models discoverable until a key is present or the cache is refreshed)', { now });
  return { ids: [], source: 'none' };
}

// Fetch the OpenAI-served model ids. Returns an array, or null to signal "no poll"
// (no OPENAI_API_KEY and no mock). NEVER uses codex — this is a plain models-LIST
// call over the OpenAI-compatible API, gated on the API key exactly like the
// Anthropic poll is. The base_url comes from the registry provider config.
async function fetchOpenaiModelIds({ modelsFile }) {
  if (modelsFile) return readModelsFile(modelsFile, 'openai');
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null; // caller logs the skip; do NOT fall back to codex
  const cfg = models.providerConfig('openai') || {};
  const base = (process.env.OPENAI_BASE_URL || cfg.base_url || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const res = await fetch(`${base}/models`, { headers: { authorization: `Bearer ${key}` } });
  const body = await res.text();
  if (!res.ok) throw new Error(`openai models endpoint ${res.status}: ${body.slice(0, 300)}`);
  const parsed = JSON.parse(body);
  return (parsed.data || []).map((m) => m.id).filter(Boolean);
}

// Pick a cross-family baseline for the "capability gap" case: the registered
// model with the most recent release date (excluding the new id).
function crossFamilyBaseline(registryPath, newId) {
  const reg = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const others = reg.models.filter((m) => m.id !== newId);
  if (!others.length) return null;
  const dated = others.filter((m) => m.released);
  const pool = dated.length ? dated : others;
  pool.sort((a, b) => String(b.released || '').localeCompare(String(a.released || '')));
  return pool[0].id;
}

// Modality gate. A models-LIST endpoint serves every model a provider hosts —
// including ones that cannot run a skill's TEXT eval suite (transcription, TTS,
// embeddings, image, moderation, realtime/audio). Those must never trigger a
// durability report. Data-driven denylist, matched case-insensitively against
// the id; a generative text/reasoning model matches none of these tokens.
const NON_GENERATIVE_RE = /(transcribe|whisper|text-to-speech|\btts\b|speech|\baudio\b|realtime|embed(?:ding)?|moderation|\bimage\b|dall-?e|\bclip\b|rerank|guard)/i;
function isGenerativeModel(id) {
  return !NON_GENERATIVE_RE.test(String(id));
}

// Main watch pass. Returns a structured result (no process.exit) for the gate.
//   opts: { modelsFile, now, stub, dryRun, notify, maxUsd, stateDir, registryPath, outRoot, homeDir }
async function runWatch(opts = {}) {
  const now = opts.now || new Date().toISOString();
  const stateDir = opts.stateDir || DEFAULT_STATE_DIR;
  const registryPath = opts.registryPath || models.REGISTRY_PATH;
  const seenPath = path.join(stateDir, 'seen-models.json');
  const attemptsPath = path.join(stateDir, 'trigger-attempts.json');
  const cachePath = opts.cachePath || path.join(stateDir, 'models-cache.json');
  const day = todayUtc(now);

  // Read the keyless diff surface once; both provider polls share it.
  const cache = readModelsCache(cachePath);

  const anthropic = await fetchModelIds({ modelsFile: opts.modelsFile, cache, now });
  const endpointIds = anthropic.ids;

  // OpenAI poll (Part 5): a mock file (gate) OR OPENAI_API_KEY drives a live poll;
  // otherwise, keyless, diff the openai ids (gpt-*/o<n>) from the models cache. With
  // neither key nor cache, skip and log — NEVER poll via codex. Same registry diff,
  // same idempotency, same trigger flow, same $25 cap as the Anthropic poll.
  let openaiIds = [];
  let openaiSource = 'skipped';
  if (opts.openaiModelsFile) {
    openaiIds = await fetchOpenaiModelIds({ modelsFile: opts.openaiModelsFile });
    openaiSource = 'mock';
  } else if (process.env.OPENAI_API_KEY) {
    openaiIds = (await fetchOpenaiModelIds({})) || [];
    openaiSource = 'api';
  } else if (cache) {
    openaiIds = cache.ids.filter((id) => /^(gpt-|o[1-9])/i.test(id));
    openaiSource = 'cache';
    log(`keyless mode: no OPENAI_API_KEY — diffing ${openaiIds.length} openai id(s) from the models cache (release-watch never polls via codex)`, { now });
  } else {
    log('openai poll skipped: no OPENAI_API_KEY and no models cache (release-watch never polls via codex)', { now });
  }

  // Seed `seen` from the registry the first time (so existing models don't fire).
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  const registryIds = registry.models.map((m) => m.id);
  const seenState = readJson(seenPath, null);
  const seen = new Set(seenState ? seenState.seen : registryIds);

  const attempts = readJson(attemptsPath, {});

  // Seed-only (baseline) mode: record EVERY currently-served id as seen and trigger
  // nothing. Used to baseline a newly-adopted enumeration surface (e.g. the first
  // time the cache is broader than the curated registry) so the daily poll only
  // ever fires on ids that appear in a LATER snapshot — genuinely-new releases —
  // instead of drafting a report for every historical/variant id the surface lists.
  if (opts.seedOnly) {
    const before = seen.size;
    for (const id of [...endpointIds, ...openaiIds]) seen.add(id);
    writeJson(seenPath, { seen: Array.from(seen).sort(), updated: now });
    log(`seed-only: baselined ${seen.size - before} newly-seen served id(s) (${seen.size} total) into ${seenPath} — no reports triggered`, { now });
    return { now, endpointCount: endpointIds.length, openaiCount: openaiIds.length, anthropicSource: anthropic.source, openaiSource, keyless: anthropic.source === 'cache' || anthropic.source === 'none', seeded: seen.size - before, newModels: [], nonGenerative: [], triggered: [], skipped: [], dryRun: !!opts.dryRun };
  }

  // A new id = served but not yet seen and a real provider model id. Anthropic
  // (claude-*) and OpenAI (gpt-*/o<n>) ids are triggered by the SAME loop below —
  // append-to-registry + family-predecessor pairing + prepare a DRAFT report — with
  // provider inferred from the id (lib/models.addDiscoveredModel / familyOf).
  const anthropicNew = endpointIds.filter((id) => !seen.has(id) && /^claude-/.test(id));
  const openaiNew = openaiIds.filter((id) => !seen.has(id) && /^(gpt-|o[1-9])/i.test(id));
  const candidateNew = [...anthropicNew, ...openaiNew];

  // Split candidates by modality: only generative text/reasoning models can run a
  // skill eval suite. A non-generative served id (transcription, TTS, embeddings,
  // image, …) is NOT actionable — record it, mark it seen so it is ignored
  // permanently (never re-flagged every poll), and never let it reach the trigger.
  const newIds = [];
  const nonGenerative = [];
  for (const id of candidateNew) {
    if (isGenerativeModel(id)) newIds.push(id);
    else { nonGenerative.push(id); seen.add(id); }
  }

  const result = { now, endpointCount: endpointIds.length, openaiCount: openaiIds.length, anthropicSource: anthropic.source, openaiSource, keyless: anthropic.source === 'cache' || anthropic.source === 'none', cacheFetchedAt: cache ? cache.fetched_at : null, cacheSource: cache ? cache.source : null, newModels: newIds, nonGenerative, triggered: [], skipped: [], dryRun: !!opts.dryRun };

  for (const id of nonGenerative) {
    log(`skip ${id}: non-generative model (not skill-gradable) — marked seen, no report`, { now });
    result.skipped.push({ id, reason: 'non-generative' });
  }

  for (const id of newIds) {
    // Once-per-day retry limit: skip if we already attempted this id today.
    if (attempts[id] && attempts[id].date === day) {
      log(`skip ${id}: already attempted today (${attempts[id].status})`, { now });
      result.skipped.push({ id, reason: `attempted-today:${attempts[id].status}` });
      continue;
    }
    if (opts.dryRun) {
      log(`dry-run: would trigger prepare-report for new model ${id}`, { now });
      result.triggered.push({ id, dryRun: true });
      continue;
    }

    // Append to the registry FIRST (released = first-seen date, auto_added).
    const added = models.addDiscoveredModel(id, { firstSeen: day, registryPath });
    log(`registry ${added ? 'appended' : 'already had'} ${id} (first-seen ${day})`, { now });

    // Choose the pair: same-family predecessor, else cross-family capability gap.
    const predecessor = models.familyPredecessor(id);
    const crossFamily = !predecessor;
    const oldModel = predecessor || crossFamilyBaseline(registryPath, id);

    let status = 'ok';
    let entry = null;
    try {
      if (!oldModel) throw new Error(`no comparison model available for ${id}`);
      const res = await prepareReport({
        newModel: id, oldModel, stub: !!opts.stub, crossFamily, now,
        maxUsd: opts.maxUsd, notify: opts.notify !== false,
        outRoot: opts.outRoot, homeDir: opts.homeDir,
      });
      entry = { id, oldModel, crossFamily, reportNumber: res.reportNumber, draftDir: res.draftDir, tally: res.tally, trimmed: res.trimmed, publicTreeTouched: res.publicTreeTouched };
      seen.add(id); // success → mark seen so it never retriggers
      log(`prepared DRAFT report #${res.reportNumber} for ${id} vs ${oldModel}${crossFamily ? ' (capability gap)' : ''} — ${res.summary}`, { now });
    } catch (e) {
      status = 'failed';
      log(`prepare-report FAILED for ${id}: ${e.message} (will retry no more than once per day)`, { now });
      result.skipped.push({ id, reason: `failed:${e.message}` });
    }
    attempts[id] = { date: day, status };
    if (status === 'ok') result.triggered.push(entry);
  }

  if (!opts.dryRun) {
    // Persist state: seen ids (union) + attempts. A failed id is NOT added to
    // seen, so it remains eligible for tomorrow's retry.
    writeJson(seenPath, { seen: Array.from(new Set([...seen, ...endpointIds, ...openaiIds].filter((id) => seen.has(id)))).sort(), updated: now });
    writeJson(attemptsPath, attempts);
  }

  if (!newIds.length) log('no new models', { now });
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2); const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) flags[k] = true; else { flags[k] = n; i++; }
    }
  }
  return flags;
}

async function main() {
  const f = parseArgs(process.argv.slice(2));
  const res = await runWatch({
    modelsFile: f['models-file'] || process.env.DRIFTPROOF_MODELS_FILE || null,
    openaiModelsFile: f['openai-models-file'] || process.env.DRIFTPROOF_OPENAI_MODELS_FILE || null,
    stub: !!f.stub,
    dryRun: !!f['dry-run'],
    seedOnly: !!f['seed-only'],
    now: f.now || process.env.DRIFTPROOF_NOW || null,
    maxUsd: f['max-usd'] ? parseFloat(f['max-usd']) : undefined,
    // Path overrides — used by the gate to run the trigger against a temp tree
    // (never the real repo). Absent for a normal run.
    stateDir: f['state-dir'] || undefined,
    cachePath: f['models-cache'] || process.env.DRIFTPROOF_MODELS_CACHE || undefined,
    registryPath: f['registry'] || undefined,
    outRoot: f['out-root'] || undefined,
    homeDir: f['home-dir'] || undefined,
    notify: f['no-notify'] ? false : undefined,
  });
  // Optional: write the structured result to a file (gate reads it synchronously).
  if (f['result-file']) fs.writeFileSync(f['result-file'], JSON.stringify(res, null, 2));
  if (res.triggered.length && !res.dryRun) {
    console.log(`\n${res.triggered.length} draft report(s) prepared and queued in reports/pending-publish.md — review before publishing (see RUNBOOK.md).`);
  }
  process.exit(0);
}

if (require.main === module) main().catch((e) => { log(`FATAL ${e && (e.stack || e.message)}`); process.exit(1); });

module.exports = { runWatch, fetchModelIds, fetchOpenaiModelIds };
