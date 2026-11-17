// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 815. The only table of short public readings. Reports retain their own wording.
const { validateReceipt, verifyReceiptHash, schemaDefines } = require('./receipt');
const { receiptVerdict, placeboReading } = require('./verdict');
const WORDS = Object.freeze({
  ABOVE_PLACEBO: { text: 'beat the fake on {n} of {m} tasks, worse on none', offer: 'keep' },
  NO_DIFFERENCE: { text: 'did not beat the fake on {m} tasks', offer: 'delete' },
  BELOW_PLACEBO: { text: 'worse than the fake on {n} of {m} tasks', offer: 'delete' },
  PASSED: { text: 'better than without it on {n} of {m} tasks, worse on none' },
  NO_EFFECT: { text: 'no different from without it on {m} tasks' },
  REGRESSED: { text: 'worse than without it on {n} of {m} tasks' },
  INCONCLUSIVE: { text: 'cannot tell', offer: 'cannot' },
  UNDERPOWERED: { text: 'cannot tell', offer: 'cannot' },
  NOT_MEASURED: { text: null, offer: 'cannot' },
});
function readingOf(receipt) {
  if (!verifyReceiptHash(receipt)) throw new Error('READING_HASH');
  if (!validateReceipt(receipt).valid) throw new Error('READING_SCHEMA');
  const refused = { reading: 'NOT_MEASURED', text: null, tasks: 0, above: 0, below: 0 };
  if (!schemaDefines(receipt.schema_version, 'run', 'answered_by') || require('./report-015-publication').routerLimit(receipt)) return refused;
  const fake = !!receipt.placebo || receipt.results.cases.some(c => c.mode === 'placebo');
  const v = fake ? placeboReading(receipt) : receiptVerdict(receipt);
  const reading = v.reading || v.verdict;
  const tasks = v.cases.length;
  const above = v.cases.filter(c => c.state === 'separated-up').length;
  const below = v.cases.filter(c => c.state === 'separated-down').length;
  const template = WORDS[reading].text;
  const n = ['BELOW_PLACEBO', 'REGRESSED'].includes(reading) ? below : above;
  return { reading, text: template === null ? null : template.replace('{n}', n).replace('{m}', tasks), tasks, above, below };
}
module.exports = { WORDS, readingOf };
