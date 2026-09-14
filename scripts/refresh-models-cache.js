#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';

// refresh-models-cache.js — populate state/models-cache.json from a PUBLIC,
// no-auth model-enumeration surface so the keyless release-watch has something to
// diff. This box runs keyless by design (no ANTHROPIC/OPENAI API key), so the
// vendors' own live models-LIST endpoints are unavailable; instead we read
// OpenRouter's public models endpoint (GET https://openrouter.ai/api/v1/models,
// NO key), keep the anthropic/* and openai/* entries, and map each to its NATIVE
// provider id (the id the registry + release-watch speak).
//
// Cache shape (flat, both providers):
//   { fetched_at: <iso>, source: <string>, ids: ["claude-opus-5", "gpt-5.6-sol", …] }
//
// NEVER FATAL: on any fetch/parse failure — or a response that yields zero ids —
// we KEEP the existing cache untouched and exit 0, so a transient OpenRouter blip
// can neither wipe the diff surface nor block the release-watch that reads it an
// hour later.
//
// DISCLOSURE: OpenRouter is a third-party aggregator; its catalog can lag a vendor
// announcement by hours. That detection latency is disclosed + accepted (RUNBOOK.md).

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_CACHE = path.join(ROOT, 'state', 'models-cache.json');
const DEFAULT_URL = 'https://openrouter.ai/api/v1/models';
const SOURCE = 'openrouter:/api/v1/models';
const LOG = path.join(ROOT, 'state', 'refresh-models-cache.log');

function log(line, opts = {}) {
  const stamp = opts.now || new Date().toISOString();
  const msg = `[${stamp}] ${line}`;
  if (!opts.quiet) console.log(msg);
  try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, msg + '\n'); } catch (_e) { /* best effort */ }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

// Explicit overrides for the rare case where an OpenRouter slug differs from the
// native id by more than syntax (keyed by "<provider>/<prefix-stripped-slug>").
// Empty today — the general rule below covers every current anthropic/openai id.
// We NEVER invent a form we cannot see (e.g. we do not graft a dated suffix onto
// an undated slug to force a registry match); an unmapped id is kept as-is.
const NATIVE_OVERRIDES = {};

// Map one OpenRouter id (e.g. "anthropic/claude-opus-4.8:batch") to a native id.
//   - strip the "<provider>/" prefix
//   - drop the billing-variant suffix after ":" (":batch", ":free")
//   - anthropic: version DOTS become DASHES ("claude-opus-4.8" -> "claude-opus-4-8"),
//     because native Anthropic ids spell versions with dashes. OpenAI native ids
//     keep their dots ("gpt-5.6-sol"), so openai is passed through unchanged.
function nativeId(provider, orId) {
  const stripped = String(orId).replace(/^(anthropic|openai)\//, '').replace(/:.*$/, '');
  const overridden = NATIVE_OVERRIDES[`${provider}/${stripped}`];
  if (overridden) return overridden;
  return provider === 'anthropic' ? stripped.replace(/\./g, '-') : stripped;
}

// Pure: build the cache object from an OpenRouter `data` array. Keeps only
// anthropic/* and openai/* entries, maps to native ids, dedups + sorts.
function buildCache(models, { now, source } = {}) {
  const ids = new Set();
  for (const m of (models || [])) {
    const id = m && m.id;
    if (!id) continue;
    const mt = /^(anthropic|openai)\//.exec(id);
    if (!mt) continue;
    ids.add(nativeId(mt[1], id));
  }
  return { fetched_at: now || new Date().toISOString(), source: source || SOURCE, ids: Array.from(ids).sort() };
}

async function fetchModels(url) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`models endpoint ${res.status}`);
  const body = await res.json();
  if (!body || !Array.isArray(body.data)) throw new Error('unexpected response shape (no data[])');
  return body.data;
}

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
  const out = f.out || DEFAULT_CACHE;
  const now = f.now || new Date().toISOString();

  // Read the source: a canned file (--from-file, used by the gate) or a live fetch.
  let models;
  try {
    if (f['from-file']) {
      const body = JSON.parse(fs.readFileSync(f['from-file'], 'utf8'));
      if (!Array.isArray(body.data)) throw new Error('from-file has no data[]');
      models = body.data;
    } else {
      models = await fetchModels(f.url || DEFAULT_URL);
    }
  } catch (e) {
    // Never fatal: keep whatever cache is already on disk, exit 0.
    log(`refresh FAILED: ${e.message} — keeping existing cache (${fs.existsSync(out) ? 'present, untouched' : 'absent'})`, { now });
    process.exit(0);
  }

  const cache = buildCache(models, { now, source: f['from-file'] ? `${SOURCE} (from-file)` : SOURCE });
  // Defensive: never overwrite a good cache with an empty one (shape drift upstream).
  if (!cache.ids.length) {
    log(`refresh produced 0 anthropic/openai ids — keeping existing cache untouched (not overwriting with empty)`, { now });
    process.exit(0);
  }

  writeJson(out, cache);
  const anth = cache.ids.filter((id) => /^claude-/.test(id)).length;
  const oai = cache.ids.filter((id) => /^(gpt-|o[1-9])/i.test(id)).length;
  log(`refreshed models cache: ${cache.ids.length} ids (${anth} anthropic / ${oai} openai) from ${cache.source} -> ${out}`, { now });
  process.exit(0);
}

if (require.main === module) {
  main().catch((e) => { log(`FATAL ${e && (e.stack || e.message)}`); process.exit(0); }); // still never fatal
}

module.exports = { buildCache, nativeId, NATIVE_OVERRIDES };
