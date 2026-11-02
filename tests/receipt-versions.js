// SPDX-License-Identifier: Apache-2.0
'use strict';

// Issue 549: the one place a test or a spec's reader learns the receipt versions.
//
// Each test used to keep its own version list, or took a fresh receipt back to an older version by
// deleting a list of new fields it typed by hand. Every schema bump broke them, and none of those reds
// was a product bug. Here the versions are lib/receipt.js SCHEMA_FILES, oldest first, the current one
// last, and the fields each version adds are read from the schema files themselves. A schema bump moves
// every fixture built here with no test edit.
//
// It reads the tree it sits in: ../lib/receipt.js and ../spec/. A gate that runs a test in a copy
// copies this file beside the test. A gate's Base older than the table's export holds no table to
// read; its receipts carry no field newer than its own version, so nothing is removed there.

const fs = require('fs');
const path = require('path');
const { RECEIPT_SCHEMA_VERSION } = require('../config');
const SCHEMA_FILES = require('../lib/receipt').SCHEMA_FILES || {};

const SPEC_DIR = path.join(__dirname, '..', 'spec');
// The versions in the table's order, oldest first, as lib/receipt.js derives its own.
const VERSIONS = Object.keys(SCHEMA_FILES);
const CURRENT = VERSIONS.length ? VERSIONS[VERSIONS.length - 1] : RECEIPT_SCHEMA_VERSION;

function known(version) {
  if (typeof version !== 'string' || !Object.hasOwn(SCHEMA_FILES, version)) throw new Error(`receipt version ${JSON.stringify(version)} is not a row of lib/receipt.js SCHEMA_FILES`);
  return version;
}

// Every property path a schema defines, as dotted names: `[]` after an array's name, `*` for a map's
// keys. $ref, allOf, anyOf, oneOf and if/then/else are followed; `not` names no field.
function schemaPaths(schema) {
  const out = new Set();
  const walk = (node, pre, seen) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.$ref === 'string' && node.$ref.startsWith('#/$defs/')) {
      const name = node.$ref.slice('#/$defs/'.length);
      if (!seen.has(name)) walk((schema.$defs || {})[name], pre, new Set([...seen, name]));
    }
    for (const kw of ['allOf', 'anyOf', 'oneOf']) for (const s of node[kw] || []) walk(s, pre, seen);
    for (const kw of ['if', 'then', 'else']) walk(node[kw], pre, seen);
    for (const [k, v] of Object.entries(node.properties || {})) {
      const p = pre ? `${pre}.${k}` : k;
      out.add(p);
      walk(v, p, seen);
    }
    if (node.items) walk(node.items, `${pre}[]`, seen);
    if (node.additionalProperties && typeof node.additionalProperties === 'object') walk(node.additionalProperties, `${pre}.*`, seen);
    for (const v of Object.values(node.patternProperties || {})) walk(v, `${pre}.*`, seen);
  };
  walk(schema, '', new Set());
  return out;
}

const _paths = new Map();
function pathsOf(version) {
  known(version);
  if (!_paths.has(version)) _paths.set(version, schemaPaths(JSON.parse(fs.readFileSync(path.join(SPEC_DIR, SCHEMA_FILES[version]), 'utf8'))));
  return _paths.get(version);
}

// The fields a version adds: the paths its schema defines that the version before it does not.
function fieldsAddedBy(version) {
  const i = VERSIONS.indexOf(known(version));
  const before = i > 0 ? pathsOf(VERSIONS[i - 1]) : new Set();
  return [...pathsOf(version)].filter((p) => !before.has(p));
}
// The fields every version after `version` adds, each once; none where there is no table.
function fieldsAddedAfter(version) {
  if (!VERSIONS.length) return [];
  const out = new Set();
  for (const v of VERSIONS.slice(VERSIONS.indexOf(known(version)) + 1)) for (const p of fieldsAddedBy(v)) out.add(p);
  return [...out];
}
// Whether the schema a version names defines the field at `field` (a dotted path as above).
function versionDefines(version, field) {
  return typeof version === 'string' && Object.hasOwn(SCHEMA_FILES, version) && pathsOf(version).has(field);
}

function removePath(node, segs) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return;
  const [head, ...rest] = segs;
  const list = head.endsWith('[]');
  const key = list ? head.slice(0, -2) : head;
  for (const k of key === '*' ? Object.keys(node) : [key]) {
    if (!Object.hasOwn(node, k)) continue;
    if (!rest.length) { delete node[k]; continue; }
    if (list) { if (Array.isArray(node[k])) for (const el of node[k]) removePath(el, rest); } else removePath(node[k], rest);
  }
}

// A copy of a receipt as the given version records it: every field a later version adds is removed,
// and the copy is stamped with that version. Nothing else changes; the caller seals it.
function atVersion(receipt, version) {
  const out = structuredClone(receipt);
  for (const p of fieldsAddedAfter(version).sort((a, b) => a.length - b.length)) removePath(out, p.split('.'));
  out.schema_version = version;
  return out;
}

// The count a writer derives from a receipt's rows, by the rule lib/receipt.js buildReceipt applies:
// results.fake_tool_calls on a sampled text-capture receipt, counted by lib/text-capture.js. A fixture
// that edits the rows, the sampling or the capture mode recounts here before it seals, so it never
// keeps a stale count. A receipt whose own schema has no such field carries none.
function recount(receipt) {
  const counted = versionDefines(receipt.schema_version, 'results.fake_tool_calls')
    && receipt.run && receipt.run.capture && receipt.run.capture.mode === 'text' && receipt.generation_sampled;
  if (counted) receipt.results.fake_tool_calls = require('../lib/text-capture').fakeToolCallCounts(receipt);
  else delete receipt.results.fake_tool_calls;
  return receipt;
}

module.exports = { VERSIONS, CURRENT, SCHEMA_FILES, schemaPaths, fieldsAddedBy, fieldsAddedAfter, versionDefines, atVersion, recount };
