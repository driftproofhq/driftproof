// SPDX-License-Identifier: Apache-2.0
'use strict';
// Spec 790 A-790-1 (the operator's ruling of 12 Nov 2026): a retained answer that names the eval
// account's home directory is committed with that directory written ~/, and the answers file records
// where. The reader restores the original bytes from the account name lib/provider.js already
// publishes and checks them against the hash the receipt seals, so no binding is loosened. Nothing
// else in an answer is touched, and a file with no record is read as it is.
const { EVAL_USER_DEFAULT } = require('../lib/provider');
const { sha256 } = require('../lib/canonical');

const RULE = 'spec 790 A-790-1: the eval account home directory is written ~/';
const WRITTEN = '~/';
const ACCOUNT = 'lib/provider.js EVAL_USER_DEFAULT';
const home = () => '/home/' + EVAL_USER_DEFAULT + '/';
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

// The redacted answers file and its record. Offsets are in the redacted text, ascending.
function redact(file) {
  const out = structuredClone(file), list = [];
  for (const [hash, text] of Object.entries(out.answers || {})) {
    if (typeof text !== 'string' || !text.includes(home())) continue;
    const parts = text.split(home()), offsets = [];
    let s = '';
    parts.forEach((p, i) => { s += p; if (i < parts.length - 1) { offsets.push(s.length); s += WRITTEN; } });
    out.answers[hash] = s; list.push({ generation_hash: hash, offsets });
  }
  if (list.length) out.redactions = { rule: RULE, account: ACCOUNT, written: WRITTEN, answers: list };
  return out;
}

// The answers file as it was sealed. Every recorded answer must restore to its own sealed hash
// (REDACTION_BINDING); the reader's own checks then run on the restored bytes unchanged.
function restore(file) {
  if (!file || !Object.hasOwn(file, 'redactions')) return file;
  const r = file.redactions;
  if (!(r && r.rule === RULE && r.account === ACCOUNT && r.written === WRITTEN && Array.isArray(r.answers) && r.answers.length)) fail('REDACTION_BINDING');
  const out = structuredClone(file), seen = new Set();
  delete out.redactions;
  for (const e of r.answers) {
    const h = e && e.generation_hash;
    if (!/^[0-9a-f]{64}$/.test(h || '') || seen.has(h) || typeof out.answers[h] !== 'string' || !Array.isArray(e.offsets) || !e.offsets.length) fail('REDACTION_BINDING');
    seen.add(h);
    let t = out.answers[h], prev = -WRITTEN.length;
    for (const o of e.offsets) if (!Number.isInteger(o) || o < prev + WRITTEN.length || t.slice(o, o + WRITTEN.length) !== WRITTEN) fail('REDACTION_BINDING'); else prev = o;
    for (const o of [...e.offsets].reverse()) t = t.slice(0, o) + home() + t.slice(o + WRITTEN.length);
    if (sha256(t) !== h) fail('REDACTION_BINDING');
    out.answers[h] = t;
  }
  return out;
}
const redacted = (file) => !!(file && file.redactions);
const count = (file) => redacted(file) ? file.redactions.answers.length : 0;

module.exports = { RULE, WRITTEN, ACCOUNT, redact, restore, redacted, count };
