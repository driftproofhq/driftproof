// SPDX-License-Identifier: Apache-2.0
'use strict';

// A smoke receipt, as every reader that renders one tells it apart (spec 139 R-3, R-4). No require:
// the plain words, the view and the badge's neighbours read this, and none of them may reach a
// module that can spawn a process or use the network (spec 131's closure of the local commands).
//
// A SMOKE RECEIPT SAYS SO, AND IS BELOW TESTED. It carries run.preset "quick" and
// verification_level UNVERIFIED. Every verdict reader already refuses a receipt below TESTED, so no
// reader's rule moves; the schema refuses a receipt that names a preset and reads TESTED. The preset
// is read for words and for refusals, never to grant a verdict.

const PRESET_QUICK = 'quick';

// THE PLAIN LINE for a smoke result. Every surface that renders one carries exactly this sentence,
// as spec 035 AC-9 binds UNDERPOWERED's.
const SMOKE_LINE = 'A smoke run cannot produce a verdict';

function isSmoke(receipt) {
  return !!(receipt && receipt.run && receipt.run.preset === PRESET_QUICK);
}

module.exports = { PRESET_QUICK, SMOKE_LINE, isSmoke };
