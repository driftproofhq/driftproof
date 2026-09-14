// SPDX-License-Identifier: Apache-2.0
'use strict';

// Suite canary — receipt spec v0.5.
//
// Terminal-Bench 4.0 records a canary string so that a benchmark appearing in
// training data is detectable. Adopted, translated: our unit of publication is
// the SUITE, so the canary is per suite, derived from the suite's identity and
// its case ids rather than randomly assigned, so the same suite yields the same
// canary on every machine and no registry has to be kept.
//
// It is a detection aid, not a control: a canary tells you a suite leaked, it
// does not stop the leak, and it cannot prove the absence of one.

const crypto = require('crypto');

const NAMESPACE = 'driftproof/suite-canary/v1';

function suiteCanary(suite) {
  const id = String((suite && (suite.id || suite.name)) || '');
  const caseIds = ((suite && suite.cases) || []).map((c) => String((c && c.id) || '')).sort();
  const h = crypto.createHash('sha256').update(`${NAMESPACE}\n${id}\n${caseIds.join('\n')}`).digest('hex');
  // Formatted as a GUID so it is recognisable as one in a corpus scan.
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-');
}

module.exports = { suiteCanary, NAMESPACE };
