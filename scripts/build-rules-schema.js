// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 814. The frozen 0.16 schema is copied byte for byte before this builder runs.
const fs = require('node:fs');
const path = require('node:path');
const { RULES_FILE_KINDS, RULES_LIMITATION } = require('../lib/rules-files');
const root = path.join(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(path.join(root, 'spec/receipt.v0.16.schema.json'), 'utf8'));
schema.properties.schema_version.const = '0.17';
schema.description = 'Receipt spec v0.17: a context file seals skill.rules_file, its kind, the sent text and the always-on limitation. skill.content_hash remains the hash of the original file bytes, including editor metadata. Every run writes v0.17, a placebo run included. v0.16 is frozen as receipt.v0.16.schema.json. Older receipts use their own frozen schemas. ' + schema.description.replace('Every run writes v0.16, a placebo run included. ', '');
const skill = schema.properties.skill;
skill.properties.rules_file = {
  type: 'object', additionalProperties: false,
  required: ['kind', 'text', 'mode', 'limitation'],
  properties: {
    kind: { enum: [...new Set(RULES_FILE_KINDS.map(x => x.kind))] },
    text: { type: 'string', minLength: 1 },
    mode: { const: 'always_on' },
    limitation: { const: RULES_LIMITATION },
  },
};
skill.allOf = [...(skill.allOf || []), {
  if: { properties: { unit: { const: 'context_file' } }, required: ['unit'] },
  then: { required: ['rules_file', 'tokens'], properties: { content_hash: { type: 'string' } } },
  else: { not: { required: ['rules_file'] } },
}];
const outputs = new Map([
  ['spec/receipt.schema.json', JSON.stringify(schema, null, 2) + '\n'],
  ['docs/spec/receipt.schema.json', JSON.stringify(schema, null, 2) + '\n'],
  ['docs/spec/receipt.v0.16.schema.json', fs.readFileSync(path.join(root, 'spec/receipt.v0.16.schema.json'), 'utf8')],
]);
for (const [file, text] of outputs) {
  const target = path.join(root, file);
  if (process.argv.includes('--check')) {
    if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) throw Error(file + ': differs from builder');
  } else fs.writeFileSync(target, text);
}
console.log('rules receipt schema: ' + outputs.size + ' files ' + (process.argv.includes('--check') ? 'as built' : 'written'));
