// SPDX-License-Identifier: Apache-2.0
'use strict';
// Node boundary. The synchronous counterparts are generated for Node 22.0 too.
const config = require('../config');
const { sealReceipt } = require('./receipt');
const { inferProvider } = require('./provider');
const { registryStatus } = require('./models');
const sha256 = bytes => require('node:crypto').createHash('sha256').update(bytes).digest('hex');
const input = require('./import-core/input.cjs');
const { IMPORT_MAX_BYTES } = input;
function readImportBytes(file) {
  const fs = require('node:fs');
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > IMPORT_MAX_BYTES) throw new Error('import byte limit exceeded or input is not a regular file');
    const buf = Buffer.alloc(IMPORT_MAX_BYTES + 1);
    let n = 0, got;
    while (n < buf.length && (got = fs.readSync(fd, buf, n, buf.length - n, null)) > 0) n += got;
    if (n > IMPORT_MAX_BYTES) throw new Error('import byte limit exceeded');
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}
const core = require('./import-core/basic.cjs').createBasicCore({ ...config, inferProvider, registryStatus, sha256 });

const importResults = (data, opts) => sealReceipt(core.importResults(data, opts));
const importAgentSkillsEval = (data, opts) => sealReceipt(core.importAgentSkillsEval(data, opts));
const importSkillgrade = (data, opts) => sealReceipt(core.importSkillgrade(data, opts));
module.exports = { ...input, readImportBytes, importResults, importAgentSkillsEval, importSkillgrade };
