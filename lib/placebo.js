// SPDX-License-Identifier: Apache-2.0
'use strict';

// The placebo arm's text (spec 440). A run with --placebo answers every case a third time with this
// text in the skill's place: exactly the skill text's length in UTF-8 bytes, drawn from a fixed corpus
// of sentences about landscape and village life, chosen without reference to any task. A case can
// still ask about something the corpus mentions; nothing here says the text carries no information
// about a task. The text depends only on the length, the seed (the skill's content hash) and the
// corpus of its revision, so a reader rebuilds it from the receipt alone.
//
// A REVISION'S CORPUS NEVER CHANGES. A new corpus is a new revision, with its own pinned hash. The
// receipt carries the corpus it was built from, and a reader checks it against the pin, so a receipt
// cannot bring a corpus of its own.
//
// Every bound is checked before anything is built (spec 440 AC-16): a receipt is public input, and a
// length of 10^12 must be refused, not attempted. The builder keeps a running length, so its work is
// linear in the length it builds. Callers reach the builder through this module's exports, so the
// spec's tests can watch it.

const crypto = require('crypto');
const { RECEIPT_SCHEMA_VERSION } = require('../config');

const { PLACEBO_REVISION, PLACEBO_MAX_BYTES, PLACEBO_CORPORA, PLACEBO_CORPUS_HASHES, PLACEBO_OPENING,
  assertInputLength, createPlaceboCore } = require('./import-core/placebo.cjs');
const PLACEBO_SCHEMA_VERSION = RECEIPT_SCHEMA_VERSION;
const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const corpusHashOf = (corpus) => sha256Hex(JSON.stringify(corpus));
const refuse = (code, message, Kind = Error) => Object.assign(new Kind(message), { code });
const { buildPlaceboText } = createPlaceboCore(bytes => crypto.createHash('sha256').update(bytes).digest());

// The placebo for a skill text. Refused, before anything is built, when the skill text is empty or
// longer than the most a placebo may be.
function placeboFor({ skillText, seed, revision = PLACEBO_REVISION }) {
  const bytes = Buffer.byteLength(String(skillText), 'utf8');
  assertInputLength(bytes);
  const corpus = PLACEBO_CORPORA[revision];
  const text = module.exports.buildPlaceboText(bytes, seed, corpus, revision);
  return { text, bytes: Buffer.byteLength(text, 'utf8'), sha256: sha256Hex(text), revision, corpusHash: PLACEBO_CORPUS_HASHES[revision], seed };
}

// The run's length guard (spec 440 AC-1): the placebo is the skill text's length in bytes, or the run
// stops before its first call.
function assertPlaceboLength(skillText, placebo) {
  const want = Buffer.byteLength(String(skillText), 'utf8');
  const got = Buffer.byteLength(String(placebo && placebo.text), 'utf8');
  if (got !== want) throw refuse('PLACEBO_LENGTH', `placebo: the placebo is ${got} bytes and the skill text ${want}; nothing run, no receipt written`);
}

// The first run of `n` words two texts share, or null (lowercased, words matched by [a-z0-9']+).
function sharedRun(a, b, n = 6) {
  const runs = (t) => {
    const w = String(t).toLowerCase().match(/[a-z0-9']+/g) || [];
    const s = new Set();
    for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' '));
    return s;
  };
  const ra = runs(a);
  for (const r of runs(b)) if (ra.has(r)) return r;
  return null;
}

// The block's bounds (spec 440 AC-16), read before anything is built. -> [problem]
function placeboBoundProblems(p) {
  const out = [];
  const count = (x) => Number.isSafeInteger(x) && x >= 1 && x <= PLACEBO_MAX_BYTES;
  if (!count(p.bytes)) out.push('bytes is not an integer from 1 to the most a placebo may be');
  if (!count(p.skill_bytes)) out.push('skill_bytes is not an integer from 1 to the most a placebo may be');
  if (!Object.hasOwn(PLACEBO_CORPUS_HASHES, String(p.revision)) || !Number.isSafeInteger(p.revision)) out.push('revision is not a known revision');
  if (typeof p.seed !== 'string' || p.seed.length < 1 || p.seed.length > 128) out.push('seed is not a string of 1 to 128 characters');
  if (!Array.isArray(p.corpus) || p.corpus.length < 1 || p.corpus.length > 64) out.push('corpus is not 1 to 64 sentences');
  else if (!p.corpus.every((s) => typeof s === 'string' && s.length >= 1 && s.length <= 160 && /^[\x20-\x7e]+$/.test(s))) out.push('a corpus sentence is out of bounds');
  for (const k of ['sha256', 'corpus_hash']) if (typeof p[k] !== 'string' || !/^[0-9a-f]{64}$/.test(p[k])) out.push(`${k} is not 64 hex characters`);
  return out;
}

// What the block says the placebo was, checked from the receipt alone, bounds first and the build
// last. The figures beside it are checked by lib/verdict.js, which reads the cases. -> [problem]
function placeboIdentityProblems(receipt) {
  const p = receipt.placebo;
  const out = placeboBoundProblems(p);
  if (out.length) return out;
  if (p.length_measure !== 'utf8_bytes') out.push('length_measure is not utf8_bytes');
  if (p.skill_bytes !== p.bytes) out.push('skill_bytes and bytes differ');
  if (p.seed !== (receipt.skill || {}).content_hash) out.push('the seed is not skill.content_hash');
  if (p.corpus_hash !== PLACEBO_CORPUS_HASHES[p.revision]) out.push('corpus_hash is not the pinned hash of its revision');
  if (corpusHashOf(p.corpus) !== p.corpus_hash) out.push('the carried corpus does not hash to corpus_hash');
  if (out.length) return out;
  if (sha256Hex(module.exports.buildPlaceboText(p.bytes, p.seed, p.corpus, p.revision)) !== p.sha256) out.push('sha256 is not the placebo rebuilt from the receipt');
  return out;
}

module.exports = {
  PLACEBO_REVISION, PLACEBO_SCHEMA_VERSION, PLACEBO_MAX_BYTES, PLACEBO_CORPORA, PLACEBO_CORPUS_HASHES, PLACEBO_OPENING,
  buildPlaceboText, placeboFor, assertPlaceboLength, sharedRun, placeboBoundProblems, placeboIdentityProblems, corpusHashOf, sha256Hex,
};
