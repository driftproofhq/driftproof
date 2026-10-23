// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 435: a publication scope limit for these exact sealed records. No new verdict state.
const {verifyReceiptHash}=require('./receipt');
const LABEL='No verdict: delegated skill not tested';
const REASON="These text tasks test the router's written response, not the delegated skill.";
const AMENDMENT='/reports/015/#amendment-1';
const COMPATIBILITY_CARDS={
  "e2403573b7370d33e8b7d18f8287d7a90abe1ed18feb1cab482baa909f0b7b67": "receipt-e2403573b7370d33.bb23fc11.png",
  "f4bce7c9f27d9cfc6add44c9eb1bd239d2d6c55d8131ff95a432eaa8458c47c6": "receipt-f4bce7c9f27d9cfc.e8be61fc.png",
  "0aba83f8316912473981b79d945c81c443f47de415bdac61098b5dac642afdde": "receipt-0aba83f831691247.8e240653.png",
  "ff6bb0a23b2b250c71181de274ba684ac5706558cd3214e08acc637823290029": "receipt-ff6bb0a23b2b250c.1b6d93b7.png",
  "ae40fa3f5a12a6d72d93f6ebfc0a456757297886a88224e942022166aee945b4": "receipt-ae40fa3f5a12a6d7.07945350.png",
  "5d537a57fb3d2f578c43ba3c97554ce3f9dd3c875b3749cedfd1a3faa0314af8": "receipt-5d537a57fb3d2f57.7e738b04.png",
  "8c6c0dae462e3c4f66ead0569945188d38bc210e5a942b5d25f25fe219048de2": "receipt-8c6c0dae462e3c4f.85c2eee8.png",
  "32028d8d47628e683aebec2f14ebe378154d595e983a50e11c08962ce41184f8": "receipt-32028d8d47628e68.e236c848.png"
};
const RECORDS=[
  {
    "hash": "e2403573b7370d33e8b7d18f8287d7a90abe1ed18feb1cab482baa909f0b7b67",
    "attempt": "55e499f055d657d74ea5c5bf0887eda697a500ec1f817fc69aa82d5fd7d27b6d",
    "evals_sha256": "22c3d0542a281984de554c1a5598b697130c9e6a5050f84db78d825d87a0af0c",
    "skill": "find-skills",
    "model": "claude-sonnet-5-5"
  },
  {
    "hash": "f4bce7c9f27d9cfc6add44c9eb1bd239d2d6c55d8131ff95a432eaa8458c47c6",
    "attempt": "c8c56c2de130627fd5d6503bfa5a20fc5d843efeec93a1ad58c6ff2ed6941d33",
    "evals_sha256": "67fd279287270a6514b61cf9f4173f3b69f81d25afb204010bac6793207ba92e",
    "skill": "agent-browser",
    "model": "claude-sonnet-5-5"
  },
  {
    "hash": "0aba83f8316912473981b79d945c81c443f47de415bdac61098b5dac642afdde",
    "attempt": "4b26323ffc4e79d0f411769a3ae524e747e386ff4fabdd339099c202c03c82cf",
    "evals_sha256": "3f020121b43f6b02ea2cbe68d1f4f5d3abc64ec00e9d6dc8db0086059f1f3112",
    "skill": "hyperframes",
    "model": "claude-sonnet-5-5"
  },
  {
    "hash": "ff6bb0a23b2b250c71181de274ba684ac5706558cd3214e08acc637823290029",
    "attempt": "a57716bebf216652ad631dc7d8b984e6eb6b21e03aeb7a8961fa6871c7303c43",
    "evals_sha256": "62b50cdb4d333b0c0aeda4300b9406be5504f8549c9bef9eec122f1b8efffab8",
    "skill": "hyperframes-registry",
    "model": "claude-sonnet-5-5"
  },
  {
    "hash": "ae40fa3f5a12a6d72d93f6ebfc0a456757297886a88224e942022166aee945b4",
    "attempt": "187239fa2ebd8c19086d7df704d4a4da2c6d433ca974f9143ae7ac12a1ebe481",
    "evals_sha256": "22c3d0542a281984de554c1a5598b697130c9e6a5050f84db78d825d87a0af0c",
    "skill": "find-skills",
    "model": "claude-opus-5-5"
  },
  {
    "hash": "5d537a57fb3d2f578c43ba3c97554ce3f9dd3c875b3749cedfd1a3faa0314af8",
    "attempt": "96b271c97721d0b6609b7885e748533dd164840de83538b88a1ee796ee1f80e5",
    "evals_sha256": "67fd279287270a6514b61cf9f4173f3b69f81d25afb204010bac6793207ba92e",
    "skill": "agent-browser",
    "model": "claude-opus-5-5"
  },
  {
    "hash": "8c6c0dae462e3c4f66ead0569945188d38bc210e5a942b5d25f25fe219048de2",
    "attempt": "69be076a5223146e507dce6a99c23634ad440486efe0239c324e3ff0563ecc69",
    "evals_sha256": "3f020121b43f6b02ea2cbe68d1f4f5d3abc64ec00e9d6dc8db0086059f1f3112",
    "skill": "hyperframes",
    "model": "claude-opus-5-5"
  },
  {
    "hash": "32028d8d47628e683aebec2f14ebe378154d595e983a50e11c08962ce41184f8",
    "attempt": "075aadf10079f38c704b46df04fb5e34803608ffe765d995f9fb7fe57ec92df8",
    "evals_sha256": "62b50cdb4d333b0c0aeda4300b9406be5504f8549c9bef9eec122f1b8efffab8",
    "skill": "hyperframes-registry",
    "model": "claude-opus-5-5"
  }
];
function routerLimit(receipt){const record=RECORDS.find(x=>x.hash===receipt.receipt_hash);if(!record)return null;if(!verifyReceiptHash(receipt)||receipt.skill.name!==record.skill||receipt.run.model_id!==record.model)throw Object.assign(Error('ROUTER_RECEIPT_BINDING'),{code:'ROUTER_RECEIPT_BINDING'});return {...record,compatibilityCard:COMPATIBILITY_CARDS[record.hash],label:LABEL,reason:REASON,amendment:AMENDMENT};}
const eligibleResults=items=>items.filter(x=>!routerLimit(x.receipt));
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');
function qualificationHTML(){return '<p class="router-qualification">'+esc(REASON)+' <a href="'+AMENDMENT+'">Report 015 Amendment 1</a>.</p>';}
function routerBadge(receipt,{href}={}){if(!routerLimit(receipt))throw Error('ROUTER_RECEIPT_BINDING');const identity=receipt.run.model_id+' · '+receipt.run.date_utc.slice(0,10);const title=LABEL+' on '+identity+'. '+REASON;return '<svg xmlns="http://www.w3.org/2000/svg" width="760" height="84" viewBox="0 0 760 84" role="img" aria-label="'+esc(title)+'" data-receipt-hash="'+receipt.receipt_hash+'"><title>'+esc(title)+'</title><a href="'+esc('https://driftproofhq.com'+AMENDMENT)+'"><rect width="760" height="84" rx="4" fill="#ECE5D5"/><text x="12" y="25" font-family="sans-serif" font-size="16" fill="#1F1D1A">'+esc(LABEL)+'</text><text x="12" y="46" font-family="sans-serif" font-size="13" fill="#1F1D1A">'+esc(identity)+'</text><text x="12" y="68" font-family="sans-serif" font-size="13" fill="#1F1D1A">'+esc(REASON)+'</text></a></svg>\n';}
module.exports={LABEL,REASON,AMENDMENT,routerLimit,eligibleResults,qualificationHTML,routerBadge};
