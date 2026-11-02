// SPDX-License-Identifier: Apache-2.0
const IMPORT_TOOLS = ['agent-skills-eval', 'skillgrade'];

// Issue 13: fixed resource bounds apply to every imported format, including sidecars.
const IMPORT_METHOD = 'matched-measured-cases/1';
const IMPORT_MAX_BYTES = 16 * 1024 * 1024;
const importScoreValid = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
function importDiagnostic(text, max = 2048) {
  return String(text).replace(/[\x00-\x1f\x7f\u2028\u2029]/g, c => /[\x7f\u2028\u2029]/.test(c) ? '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0') : JSON.stringify(c).slice(1, -1)).slice(0, max);
}
function checkImportInput(data) {
  const stack = [[data, 0]]; let entries = 0;
  while (stack.length) {
    const [v, depth] = stack.pop();
    if (++entries > 200000 || depth > 32) throw new Error('import JSON entry or depth limit exceeded');
    if (typeof v === 'string' && v.length > 16384) throw new Error('import text limit exceeded');
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (keys.length > 10000) throw new Error('import array or object entry limit exceeded');
      for (const k of keys) {
        if (k.length > 16384) throw new Error('import text limit exceeded');
        stack.push([v[k], depth + 1]);
      }
    }
  }
}
function importCaseIdentity(value, seen, stringsOnly = false) {
  if (!((typeof value === 'string' && value.length && value.length <= 256 && JSON.stringify(value).length <= 512) || (!stringsOnly && Number.isSafeInteger(value)))) throw new Error('invalid or unsafe case identity');
  const id = String(value), type = typeof value;
  if (seen.has(id) && seen.get(id) !== type) throw new Error('ambiguous numeric and string case identity');
  seen.set(id, type); return id;
}
function importExclusionNotices(excluded) {
  return excluded.map(e => importDiagnostic('case ' + JSON.stringify(e.id) + ' (' + e.modes.join(', ') + '): ' + importDiagnostic(e.reason, 600), 1024));
}
function expectationIdentity(list, key) {
  if (!Array.isArray(list) || !list.length || !list.every(e => e && typeof e[key] === 'string')) return null;
  return JSON.stringify(list.map(e => e[key]).sort());
}


function textOf(bytes) { return new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes); }
function jsonOf(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('expected file bytes');
  if (bytes.byteLength > IMPORT_MAX_BYTES) throw new Error('import byte limit exceeded');
  let doc;
  try { doc = JSON.parse(textOf(bytes)); } catch (e) { throw new Error('not JSON: ' + e.message); }
  checkImportInput(doc);
  return doc;
}
export { IMPORT_TOOLS, IMPORT_METHOD, IMPORT_MAX_BYTES, importScoreValid, checkImportInput, importCaseIdentity, importDiagnostic, importExclusionNotices, expectationIdentity, textOf, jsonOf };
