// SPDX-License-Identifier: Apache-2.0
'use strict';

// JSON salvage + retry/timeout helpers.
//
// PORTED (then genericized) from a private codebase's aiHelpers.js:
//   - safeParseJSON  (trailing-comma + unescaped-newline repair)
//   - extractJsonArray  (streaming brace-matcher that salvages a truncated
//                        array of objects — LLMs routinely overrun max_tokens)
// The private origin carried no business logic in these functions; they are pure
// string/JSON utilities. Scanned clean against the confidentiality deny-list.

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Parse JSON with basic repair for common LLM output quirks. Throws if the text
// is unsalvageable so callers can fall back rather than silently accept garbage.
function safeParseJSON(str) {
  try { return JSON.parse(str); } catch (_e) { /* fall through to repairs */ }
  // Strip a ```json ... ``` fence if present.
  const fence = String(str).match(/```(?:json)?\s*([\s\S]*?)```/i);
  let s = fence ? fence[1] : String(str);
  // Repair trailing commas before ] or }.
  let fixed = s.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(fixed); } catch (_e) { /* keep trying */ }
  // Repair unescaped newlines inside string values.
  fixed = fixed.replace(/(?<=": ")([\s\S]*?)(?="[,}])/g, (m) => m.replace(/\n/g, '\\n'));
  try { return JSON.parse(fixed); } catch (_e) { /* give up */ }
  throw new Error('Invalid JSON (unsalvageable)');
}

// Extract as many complete objects as possible from a JSON array in `text`,
// even when the array is truncated mid-stream. Returns { items, truncated }.
// A well-formed array parses on the happy path; otherwise a brace-matcher walks
// the string and keeps every object that closed cleanly.
function extractJsonArray(text) {
  if (!text || typeof text !== 'string') return { items: [], truncated: false };
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  try {
    const whole = JSON.parse(s);
    if (Array.isArray(whole)) return { items: whole, truncated: false };
  } catch (_e) { /* salvage below */ }
  const start = s.indexOf('[');
  if (start === -1) return { items: [], truncated: false };
  const items = [];
  let depth = 0, inStr = false, esc = false, objStart = -1, closed = false;
  for (let i = start + 1; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) objStart = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        try { items.push(JSON.parse(s.slice(objStart, i + 1))); } catch (_e) { /* skip broken object */ }
        objStart = -1;
      }
    } else if (c === ']' && depth === 0) { closed = true; break; }
  }
  return { items, truncated: !closed };
}

// Extract a single JSON object (the first balanced {...}) from free text, with
// salvage. Returns the parsed object or throws.
function extractJsonObject(text) {
  if (!text || typeof text !== 'string') throw new Error('no text to parse');
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf('{');
  if (start === -1) throw new Error('no JSON object found');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return safeParseJSON(s.slice(start, i + 1));
    }
  }
  // Unterminated object — hand the tail to the repairer.
  return safeParseJSON(s.slice(start));
}

// Run an async thunk with a wall-clock timeout. Rejects with a TIMEOUT error if
// it does not settle in time.
function withTimeout(promiseFactory, ms, label = 'operation') {
  return new Promise((resolve, reject) => {
    let done = false;
    const t = setTimeout(() => {
      if (done) return;
      done = true;
      const e = new Error(`${label} timed out after ${ms}ms`);
      e.code = 'TIMEOUT';
      reject(e);
    }, ms);
    Promise.resolve()
      .then(promiseFactory)
      .then((v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } })
      .catch((err) => { if (!done) { done = true; clearTimeout(t); reject(err); } });
  });
}

// Retry an async thunk with exponential backoff. Retries only when shouldRetry
// returns true for the caught error (default: 429 / rate-limit / timeout).
async function withRetry(fn, { tries = 3, baseDelayMs = 1000, shouldRetry } = {}) {
  const retryable = shouldRetry || ((err) => {
    const msg = String((err && err.message) || err || '');
    return (err && err.status === 429) || /429|rate.?limit|timeout|ETIMEDOUT|ECONNRESET/i.test(msg);
  });
  let lastErr;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt === tries - 1 || !retryable(err)) throw err;
      await sleep(baseDelayMs * Math.pow(2, attempt));
    }
  }
  throw lastErr;
}

module.exports = {
  sleep, safeParseJSON, extractJsonArray, extractJsonObject, withTimeout, withRetry,
};
