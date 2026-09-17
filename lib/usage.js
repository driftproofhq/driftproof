// SPDX-License-Identifier: Apache-2.0
'use strict';

// Usage capture — normalizing what each surface reports about a single call.
//
// Every lane reports token usage in its own shape, and two of them (the CLI
// lanes) were previously discarding it entirely: the `claude -p` default text
// output carries no usage block at all, and `codex exec --json` streams usage on
// stdout that we were routing to /dev/null. Spec v0.4 captures it.
//
// ONE normalized shape, so three substrates are comparable:
//
//   { input_tokens, output_tokens, cached_tokens, wall_ms }
//
//   input_tokens   TOTAL input presented to the model for this call, INCLUDING
//                  any portion served from cache. This is the field that most
//                  needs normalizing: the surfaces disagree about it (below).
//   cached_tokens  the portion of input_tokens served from cache (null when the
//                  surface does not surface it — never guessed, never 0-filled).
//   output_tokens  tokens generated, INCLUDING reasoning/thinking tokens where
//                  the surface bundles them (both CLI lanes do; the split is
//                  reported by the surface but deliberately not modelled here —
//                  see the disclosure in REPORT-STYLE.md).
//   wall_ms        measured BY US around the call (see lib/provider), not taken
//                  from the surface. It is the only field whose definition is
//                  identical across lanes, which is exactly why latency is
//                  reported as an observed, surface-disclosed number.
//
// THE INPUT-TOKEN DISAGREEMENT (verified against real output, 2026-08-18):
//   - `claude -p --output-format json` reports input_tokens EXCLUDING cache:
//     total input = input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
//     (Observed: 10 + 6,974 + 18,134 = 25,118 for a two-word prompt.)
//   - `codex exec --json` reports input_tokens INCLUDING cache, with
//     cached_input_tokens as a SUBSET of it. (Observed: 10,807 of which 4,480 cached.)
//   Normalizing to "total including cache" makes the two comparable; the raw
//   fixtures both parsers are tested against are checked in under tests/fixtures/.
//
// Both CLI surfaces prepend a large fixed harness preamble that we do not
// control (~25k tokens on claude-cli, ~11k on codex). It is IDENTICAL in the
// with-skill and baseline arms, so it cancels in the incremental (Δ) figures —
// which is why Δcost is the honest axis and absolute per-call cost is not.

function n(x) { return Number.isFinite(Number(x)) ? Number(x) : 0; }

// ── what answered (spec 026, AC-2 and AC-8) ──────────────────────────────────
// Every lane also reports, when it can, WHICH model served the call and WHY the
// reply stopped. Both are read here, never guessed: a surface that says nothing
// yields null for both, and the receipt records that it said nothing.
//
//   reportedModels  the ids the surface named, VERBATIM (the real claude CLI
//                   keys the call's usage under the undated form and puts a
//                   dated side entry beside it; an api response names one
//                   model). Null when the surface names no model. The runner
//                   compares on canonical ids (canonicalModelId: a trailing
//                   -YYYYMMDD is not part of the identity), never the reader.
//   stopReason      the surface's own word for why the reply ended (end_turn,
//                   max_tokens, stop, length ...). Null when it gives none.
function canonicalModelId(id) { return String(id || '').replace(/-\d{8}$/, ''); }
function reportedModelsOf(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const ids = [...new Set(Object.keys(map).filter((k) => k))].sort();
  return ids.length ? ids : null;
}
function stopReasonOf(v) { return typeof v === 'string' && v ? v : null; }

// The empty/unknown usage record. Deliberately null (not zeros) so "the surface
// did not tell us" never reads as "the call cost nothing".
function emptyUsage() {
  return { input_tokens: null, output_tokens: null, cached_tokens: null, wall_ms: null };
}

function hasUsage(u) {
  return !!(u && (u.input_tokens != null || u.output_tokens != null));
}

// ── anthropic/cli — `claude -p --output-format json` ──────────────────────────
// The whole call is one JSON object; `result` carries the final text and `usage`
// the token counts. input_tokens EXCLUDES cache, so both cache fields are added
// back to reach the total actually presented to the model.
function parseClaudeCliJson(stdout) {
  let j;
  try { j = JSON.parse(String(stdout || '')); } catch (_e) { return null; }
  if (!j || typeof j !== 'object') return null;
  const u = j.usage || {};
  const cacheRead = n(u.cache_read_input_tokens);
  const cacheCreate = n(u.cache_creation_input_tokens);
  const usage = {
    input_tokens: n(u.input_tokens) + cacheRead + cacheCreate,
    output_tokens: n(u.output_tokens),
    // Cache READ is the portion genuinely served from cache. Cache CREATION was
    // processed fresh this call (and billed at a premium), so it is not cached.
    cached_tokens: cacheRead,
    wall_ms: null,
  };
  return {
    text: typeof j.result === 'string' ? j.result : '',
    usage,
    isError: j.is_error === true,
    // v0.6: the CLI's own stop reason and the models it says served the call.
    stopReason: stopReasonOf(j.stop_reason),
    reportedModels: reportedModelsOf(j.modelUsage),
    // The CLI reports its own dollar figure. Recorded here for completeness but
    // NOT used: costs are computed uniformly from the frozen pricing snapshot so
    // three substrates are on one basis (see lib/value.js).
    surfaceReportedCostUsd: Number.isFinite(Number(j.total_cost_usd)) ? Number(j.total_cost_usd) : null,
  };
}

// ── openai/cli — `codex exec --json` JSONL event stream ───────────────────────
// One JSON object per line. Usage rides the terminal `turn.completed` event;
// input_tokens already INCLUDES cached_input_tokens. Unparseable lines are
// skipped (the stream also carries progress events we do not model). The
// stream names neither the model that served the turn nor a stop reason, so
// both read null here and the receipt says the surface did not report them.
function parseCodexJsonl(stdout) {
  const lines = String(stdout || '').split('\n').map((l) => l.trim()).filter(Boolean);
  let usage = null;
  let text = '';
  for (const line of lines) {
    let ev;
    try { ev = JSON.parse(line); } catch (_e) { continue; }
    if (!ev || typeof ev !== 'object') continue;
    if (ev.type === 'turn.completed' && ev.usage) {
      const u = ev.usage;
      usage = {
        input_tokens: n(u.input_tokens),          // already total (cache included)
        output_tokens: n(u.output_tokens),        // includes reasoning_output_tokens
        cached_tokens: u.cached_input_tokens == null ? null : n(u.cached_input_tokens),
        wall_ms: null,
      };
    }
    // The final message IS the stream: the last `item.completed` /
    // `agent_message` event carries it. Nothing is read from a file after the
    // call, on either spawn mode (spec 022 AC-9; the earlier comment here
    // described an output file the lane no longer reads, F-022-3).
    if (ev.type === 'item.completed' && ev.item && ev.item.type === 'agent_message' && typeof ev.item.text === 'string') {
      text = ev.item.text;
    }
  }
  return { usage, text, stopReason: null, reportedModels: null };
}

// ── anthropic/api ─────────────────────────────────────────────────────────────
// The Messages API reports input_tokens EXCLUDING cache, same as the CLI.
// The response object also names the model that served it (`model`) and why
// it stopped (`stop_reason`); read here from the object, null when absent.
// Exercised against tests/fixtures/response-anthropic-api.json, which is
// SYNTHESISED from the API reference, not captured from a call.
function readAnthropicApiResponse(resp) {
  const r = resp && typeof resp === 'object' ? resp : {};
  return {
    stopReason: stopReasonOf(r.stop_reason),
    reportedModels: typeof r.model === 'string' && r.model ? [r.model] : null,
  };
}
function parseAnthropicApiUsage(u) {
  if (!u) return emptyUsage();
  const cacheRead = n(u.cache_read_input_tokens);
  const cacheCreate = n(u.cache_creation_input_tokens);
  return {
    input_tokens: n(u.input_tokens) + cacheRead + cacheCreate,
    output_tokens: n(u.output_tokens),
    cached_tokens: u.cache_read_input_tokens == null ? null : cacheRead,
    wall_ms: null,
  };
}

// ── openai/api (Chat Completions-compatible) ──────────────────────────────────
// prompt_tokens is the total; the cached portion, when present, is nested under
// prompt_tokens_details.cached_tokens. The response also names the serving
// model (`model`) and the first choice's `finish_reason`; read here, null
// when absent. Exercised against tests/fixtures/response-openai-api.json,
// SYNTHESISED from the API reference, not captured from a call.
function readOpenaiApiResponse(resp) {
  const r = resp && typeof resp === 'object' ? resp : {};
  const choice = Array.isArray(r.choices) && r.choices[0] && typeof r.choices[0] === 'object' ? r.choices[0] : {};
  return {
    stopReason: stopReasonOf(choice.finish_reason),
    reportedModels: typeof r.model === 'string' && r.model ? [r.model] : null,
  };
}
function parseOpenaiApiUsage(u) {
  if (!u) return emptyUsage();
  const details = u.prompt_tokens_details || {};
  return {
    input_tokens: n(u.prompt_tokens),
    output_tokens: n(u.completion_tokens),
    cached_tokens: details.cached_tokens == null ? null : n(details.cached_tokens),
    wall_ms: null,
  };
}

// Sum a list of usage records into one (used for the N judge samples of a case).
// Null-safe: unknown fields stay null unless at least one record reported them.
function sumUsage(list) {
  const records = (list || []).filter(Boolean);
  if (!records.length) return emptyUsage();
  const out = { input_tokens: null, output_tokens: null, cached_tokens: null, wall_ms: null };
  for (const key of ['input_tokens', 'output_tokens', 'cached_tokens', 'wall_ms']) {
    const present = records.filter((r) => r[key] != null);
    if (present.length) out[key] = present.reduce((a, r) => a + n(r[key]), 0);
  }
  return out;
}

// Round a usage record's fields to integers (tokens and ms are whole units).
function normalizeUsage(u) {
  if (!u) return emptyUsage();
  const out = emptyUsage();
  for (const key of ['input_tokens', 'output_tokens', 'cached_tokens', 'wall_ms']) {
    if (u[key] != null && Number.isFinite(Number(u[key]))) out[key] = Math.round(Number(u[key]));
  }
  return out;
}

module.exports = {
  emptyUsage, hasUsage, sumUsage, normalizeUsage,
  parseClaudeCliJson, parseCodexJsonl, parseAnthropicApiUsage, parseOpenaiApiUsage,
  readAnthropicApiResponse, readOpenaiApiResponse, canonicalModelId, reportedModelsOf,
};
