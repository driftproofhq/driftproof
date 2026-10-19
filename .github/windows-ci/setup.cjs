// SPDX-License-Identifier: Apache-2.0
'use strict';
const c = require('./common.cjs');
function setup() {
  c.prepare();
  c.success(c.npm('ci', ['--omit=dev']), 'install dependencies with lifecycle scripts off');
  console.log('Windows setup: dependencies installed with --ignore-scripts; provider endpoint plant refused');
}
if (require.main === module) c.main(setup);
module.exports = { setup };
