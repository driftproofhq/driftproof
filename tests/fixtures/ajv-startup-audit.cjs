// SPDX-License-Identifier: Apache-2.0
'use strict';

// A child-only environment plant. No dependency or input is changed.
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const Module = require('node:module');
const append = fs.appendFileSync.bind(fs);
const record = (event) => append(process.env.SPEC235_AUDIT, JSON.stringify(event) + '\n');
const roots = JSON.parse(process.env.SPEC235_WATCH);
function watched(file) {
  if (file instanceof URL) file = fileURLToPath(file);
  if (Buffer.isBuffer(file)) file = file.toString();
  if (typeof file !== 'string') return false;
  const abs = path.resolve(file);
  return roots.some((root) => abs === root || abs.startsWith(root + path.sep));
}
for (const api of [fs, fs.promises]) {
  for (const name of ['readFileSync', 'existsSync', 'statSync', 'lstatSync', 'readdirSync', 'mkdirSync', 'writeFileSync', 'openSync', 'readFile', 'stat', 'lstat', 'readdir', 'mkdir', 'writeFile', 'open', 'createReadStream']) {
    if (typeof api[name] !== 'function') continue;
    const original = api[name];
    api[name] = function(file, ...args) {
      if (watched(file)) {
        record({ kind: 'work', api: api === fs ? 'fs' : 'promises', name });
        if (process.env.SPEC235_GUARD === '1') throw new Error('planted input access stopped before reading');
      }
      return original.call(this, file, ...args);
    };
  }
}
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) {
  if (request === 'ajv' || request.startsWith('ajv/')) {
    record({ kind: 'ajv', request, parent: parent && parent.filename, paths: args[1] && args[1].paths });
    const exact = request === 'ajv/dist/2020' &&
      parent && parent.filename === path.join(process.env.SPEC235_RUNTIME, 'lib', 'receipt.js') &&
      !(args[1] && args[1].paths);
    const mode = process.env.SPEC235_MODE;
    if (mode === 'missing' || (mode === 'entry-missing' && exact) || (mode === 'bare-missing' && request === 'ajv')) {
      throw Object.assign(new Error('planted missing ajv entry'), { code: 'MODULE_NOT_FOUND' });
    }
  }
  return resolve.call(this, request, parent, ...args);
};
const load = Module._load;
const seen = new WeakSet();
Module._load = function(request, ...args) {
  if (request === 'ajv/dist/2020' && process.env.SPEC235_MODE === 'transitive-missing') {
    record({ kind: 'load-failed' });
    throw Object.assign(new Error('planted missing transitive dependency'), { code: 'MODULE_NOT_FOUND' });
  }
  const value = load.call(this, request, ...args);
  if (/[/\\]provider(?:\.js)?$/.test(request) && value && typeof value.complete === 'function' && !seen.has(value)) {
    seen.add(value);
    const original = value.complete;
    value.complete = function(...params) { record({ kind: 'model' }); return original.apply(this, params); };
  }
  return value;
};
if (process.env.SPEC235_FIXED === '1') {
  const RealDate = Date;
  const instant = RealDate.parse('2026-10-12T00:00:00.000Z');
  global.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [instant])); }
    static now() { return instant; }
  };
}
