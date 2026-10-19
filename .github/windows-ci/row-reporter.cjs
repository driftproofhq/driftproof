// SPDX-License-Identifier: Apache-2.0
'use strict';
// Node's event stream supplies names and nesting, not a parsed console log.
module.exports = async function* reporter(events) {
  const ancestors = [], paths = new Map();
  const key = (d) => JSON.stringify([d.file, d.line, d.column, d.nesting, d.name, d.testNumber]);
  for await (const event of events) {
    const d = event.data;
    if (event.type === 'test:start') {
      const identity = [...ancestors.slice(0, d.nesting), d.name];
      ancestors[d.nesting] = d.name; ancestors.length = d.nesting + 1;
      paths.set(key(d), identity);
    } else if (event.type === 'test:pass' || event.type === 'test:fail') {
      yield JSON.stringify({ type: 'row', identity: paths.get(key(d)) || [...ancestors.slice(0, d.nesting), d.name],
        status: event.type === 'test:pass' ? 'pass' : 'fail', skip: Boolean(d.skip), todo: Boolean(d.todo), ...(d.details?.error ? { error: d.details.error.message } : {}) }) + '\n';
    } else if (event.type === 'test:diagnostic' && d.nesting === 0) {
      const field = /^(tests|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(d.message);
      if (field) yield JSON.stringify({ type: 'summary', field: field[1], value: Number(field[2]) }) + '\n';
    }
  }
};
