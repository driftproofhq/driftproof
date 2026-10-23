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

const PLACEBO_REVISION = 1;
// Spec 440 wrote 0.14; issue 438 writes the current version, 0.15, on every receipt, a placebo
// receipt included (A-440-5). 0.14 is frozen and still read.
const PLACEBO_SCHEMA_VERSION = RECEIPT_SCHEMA_VERSION;
const PLACEBO_MAX_BYTES = 262144;
const PLACEBO_CORPORA = Object.freeze({
  1: Object.freeze([
    'The morning light settled slowly over the hills beyond the old market town.',
    'A narrow river runs past the mill, where the water turns a wooden wheel all day.',
    'In late autumn the beech trees along the lane turn copper and then pale brown.',
    'The harbour wall was built from grey stone carried down from the quarry by cart.',
    'Swifts arrive each spring and spend most of their lives on the wing above the roofs.',
    'The library on the square keeps a collection of maps drawn by hand two centuries ago.',
    'A light rain fell through the afternoon, and the streets shone under the lamps.',
    'Bakers in the valley still use a starter that has been kept alive for many years.',
    'The lighthouse keeper once climbed the spiral stair every evening at dusk.',
    'Wild thyme grows between the rocks on the southern slope of the ridge.',
    'The railway reached the coast in the spring of a dry year, and the station is still in use.',
    'Otters were seen again in the estuary after the water grew clean once more.',
    'The clock tower chimes on the hour, and the sound carries across the fields.',
    'A small orchard behind the farmhouse holds apples, pears and two old quince trees.',
    'Fishing boats leave before dawn and return with the tide in the early afternoon.',
    'The museum displays a loom that weavers in the district used for linen and wool.',
    'Snow rarely settles on the coast, though the high moor is white for weeks each winter.',
    'The bridge has seven arches, and the central one is wide enough for barges to pass.',
    'Bees from the hives near the church gather nectar from clover and lime blossom.',
    'On clear nights the stars over the moor are bright enough to cast faint shadows.',
    'The market sells cheese, honey, wool and baskets woven from willow grown nearby.',
    'Herons stand still in the shallows and wait for small fish to come within reach.',
    'An old canal links the two towns, and its towpath is now a path for walkers.',
    'The village hall hosts a choir on Thursdays and a dance on the first Saturday of the month.',
    'Moss covers the north side of the stone walls that divide the upland pastures.',
    'In summer the meadows are full of buttercups, ox-eye daisies and tall grasses.',
    'The ferry crosses the sound twice a day when the weather is calm enough.',
    'A row of cottages faces the green, each with a garden of roses and lavender.',
    'The forest to the east was planted with oak and ash after the great storm.',
    'Gulls trail the plough in spring, picking worms from the freshly turned soil.',
    'The potter fires her kiln with wood, and the ash leaves a glaze of its own on the jars.',
    'Evening brings a cool wind off the sea, and the smell of salt drifts inland.',
  ]),
});
// Pinned in specs/440-placebo-arm/spec.md § The corpus, revision 1, beside the list it is the hash of.
const PLACEBO_CORPUS_HASHES = Object.freeze({ 1: '817668a2a4fdd95353cbcc95927d177bd8764ac4d8473bf30dd72630074fa72e' });
const PLACEBO_OPENING = PLACEBO_CORPORA[PLACEBO_REVISION][0];

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const corpusHashOf = (corpus) => sha256Hex(JSON.stringify(corpus));
const refuse = (code, message, Kind = Error) => Object.assign(new Kind(message), { code });

// The word stream: 32-bit big-endian words read off a sha256 chain seeded by the revision and seed.
function wordStream(seed, revision) {
  let h = crypto.createHash('sha256').update(`placebo/${revision}/${seed}`).digest();
  let i = 0;
  return () => {
    if (i === 8) { h = crypto.createHash('sha256').update(h).digest(); i = 0; }
    const w = h.readUInt32BE(4 * i);
    i += 1;
    return w;
  };
}
function shuffled(list, next) {
  const a = [...list];
  for (let j = a.length - 1; j >= 1; j--) {
    const k = next() % (j + 1);
    [a[j], a[k]] = [a[k], a[j]];
  }
  return a;
}

// The placebo text of `length` bytes. The opening first, then the other sentences shuffled, a blank
// line after every fourth sentence and a space otherwise, reshuffled each time the list is used up,
// cut to `length`. The corpus is ASCII, so a byte is a character and the cut is a whole one.
function buildPlaceboText(length, seed, corpus = PLACEBO_CORPORA[PLACEBO_REVISION], revision = PLACEBO_REVISION) {
  if (!Number.isSafeInteger(length) || length < 1 || length > PLACEBO_MAX_BYTES) throw refuse('PLACEBO_LENGTH', `placebo length ${String(length).slice(0, 40)} is outside 1 to ${PLACEBO_MAX_BYTES} bytes`, RangeError);
  const next = wordStream(seed, revision);
  const rest = corpus.slice(1);
  const parts = [corpus[0]];
  let n = corpus[0].length;
  let count = 1;
  while (n < length) {
    for (const s of shuffled(rest, next)) {
      const join = count % 4 === 0 ? '\n\n' : ' ';
      parts.push(join, s);
      n += join.length + s.length;
      count += 1;
      if (n >= length) break;
    }
  }
  return parts.join('').slice(0, length);
}

// The placebo for a skill text. Refused, before anything is built, when the skill text is empty or
// longer than the most a placebo may be.
function placeboFor({ skillText, seed, revision = PLACEBO_REVISION }) {
  const bytes = Buffer.byteLength(String(skillText), 'utf8');
  if (bytes < 1) throw refuse('PLACEBO_EMPTY', 'placebo: the skill text is empty, so there is no length to match; nothing run, no receipt written', RangeError);
  if (bytes > PLACEBO_MAX_BYTES) throw refuse('PLACEBO_TOO_LONG', `placebo: the skill text is ${bytes} bytes, more than the ${PLACEBO_MAX_BYTES} a placebo may be; nothing run, no receipt written`, RangeError);
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
