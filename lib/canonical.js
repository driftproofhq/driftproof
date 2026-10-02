// SPDX-License-Identifier: Apache-2.0
'use strict';

const crypto = require('crypto');

// Deterministic JSON serialization: object keys sorted lexicographically at
// every level, arrays kept in order, no insignificant whitespace. Two
// structurally-equal values always produce the same string, which is what makes
// content/suite/receipt hashes stable and comparable across machines.
function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// sha256 over the canonical form of a JSON-able value.
function sha256Canonical(value) {
  return sha256(canonicalize(value));
}

// Hash an ordered list of { path, bytes } file entries. The list is sorted by
// path so ordering on disk never changes the digest. Each entry contributes its
// path and a hash of its bytes, giving a single content hash over a file set.
function sha256Files(files) {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const h = crypto.createHash('sha256');
  for (const f of sorted) {
    h.update(f.path, 'utf8');
    h.update('\0');
    h.update(sha256(f.bytes));
    h.update('\n');
  }
  return h.digest('hex');
}

module.exports = { canonicalize, sha256, sha256Canonical, sha256Files };
