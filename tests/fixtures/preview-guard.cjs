// SPDX-License-Identifier: Apache-2.0
'use strict';
const path = require('node:path');
const fs = require('node:fs');
const cp = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const deny = (what) => () => { throw new Error('PREVIEW_FORBIDDEN_' + what); };
let lookups = 0;
for (const key of ['spawn', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) cp[key] = deny('SPAWN');
cp.spawnSync = (bin, args) => {
  if (bin !== 'id' || args.length !== 2 || args[0] !== '-u' || ++lookups > 1) return deny('SPAWN')();
  return { status: process.env.PREVIEW_ACCOUNT === 'missing' ? 1 : 0, stdout: '12345\n', stderr: '' };
};
for (const mod of ['node:http', 'node:https']) {
  const m = require(mod);
  m.request = deny('NETWORK'); m.get = deny('NETWORK');
}
require('node:net').connect = deny('NETWORK');
require('node:net').Socket.prototype.connect = deny('NETWORK');
global.fetch = deny('NETWORK');
for (const key of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'mkdtempSync', 'createWriteStream',
  'writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'renameSync', 'unlinkSync', 'rmSync', 'writeSync']) fs[key] = deny('WRITE');
const open = fs.openSync;
fs.openSync = (file, flags, ...rest) => {
  if (typeof flags === 'number' ? flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT) : /[wa+]/.test(flags)) return deny('WRITE')();
  return open(file, flags, ...rest);
};
for (const key of ['writeFile', 'appendFile', 'mkdir', 'mkdtemp', 'open', 'rename', 'unlink', 'rm']) fs.promises[key] = deny('WRITE');
const config = require(path.join(root, 'config'));
if (process.env.PREVIEW_DEFAULT) config.DEFAULT_JUDGE_SAMPLES = Number(process.env.PREVIEW_DEFAULT);
const provider = require(path.join(root, 'lib/provider'));
provider.complete = deny('MODEL');
const run = require(path.join(root, 'lib/run'));
run.runSkillOnModel = ({ skill, model, opts }) => {
  if (process.argv.includes('--preview')) return deny('MODEL')();
  // Capture ordinary cmdRun's handoff, with no model or disk activity.
  process.stdout.write('\nRUN_INPUT ' + JSON.stringify({
    model: provider.resolveModel(model), judge: provider.resolveModel(opts.judgeModel || model),
    samples: opts.samples, maxCases: opts.maxCases, maxCalls: opts.maxCalls,
    draws: opts.draws || require(path.join(root, 'lib/sampling')).SAMPLING.max,
    concurrency: opts.concurrency, keepTranscripts: opts.keepTranscripts,
    trusted: opts.trusted, capture: opts.capture, placebo: !!opts.placebo,
    cases: (opts.caseIds ? run.selectCases(skill.suite.cases, opts.caseIds) :
      skill.suite.cases.slice(0, opts.maxCases || skill.suite.cases.length)).map(c => c.id),
  }) + '\n');
  process.exit(0);
};
const plant = process.env.PREVIEW_PLANT;
if (plant === 'capture') process.argv[process.argv.indexOf('--capture') + 1] = 'text';
if (plant) {
  const preview = require(path.join(root, 'lib/preview'));
  const build = preview.buildPreview;
  // Issue 756: failures whose own text holds a path and an address. The home path is joined at run time.
  const leaky = 'cannot read ' + ['', 'home', 'someone', 'private'].join('/') + ' at https://example.invalid/private';
  const render = preview.renderPreview;
  preview.renderPreview = (p) => { if (plant === 'render-crash') throw new Error(leaky); return render(p); };
  preview.buildPreview = (args) => {
    if (plant === 'crash') throw new Error(leaky);
    if (plant === 'crash-code') throw Object.assign(new Error(leaky), { code: 'ENOENT' });
    if (plant === 'spawn') cp.spawnSync('claude', ['--version']);
    if (plant === 'second-id') { cp.spawnSync('id', ['-u', 'driftproof-eval']); cp.spawnSync('id', ['-u', 'driftproof-eval']); }
    if (plant === 'network') global.fetch('https://example.invalid');
    if (plant === 'write') fs.mkdirSync('planted-output');
    if (plant === 'model') provider.complete({});
    const p = build(args);
    if (plant === 'escaping') p.what_is_sent.system.first_line = args.skill.skillMd.split('\n')[0];
    if (plant === 'samples') p.how_often.judge_samples = 999;
    if (plant === 'system-hash') p.what_is_sent.system.sha256 = '0'.repeat(64);
    if (plant === 'task') p.what_is_sent.tasks.pop();
    if (plant === 'template') p.what_is_sent.tasks[0].prompt_template_hash = '0'.repeat(64);
    if (plant === 'surface') p.where[0].surface = 'wrong';
    if (plant === 'tools') p.where[0].tools = [...(p.where[0].tools || []), 'Bash'];
    if (plant === 'tools-note') p.where[0].tools_note = "The model's tools run as you, with your files and network.";
    if (plant === 'credential') p.where[0].credential = process.env.OPENAI_API_KEY;
    if (plant === 'url') p.where[0].api_host = process.env.ANTHROPIC_BASE_URL;
    if (plant === 'calls') p.how_often.total_calls -= 1;
    if (plant === 'label') p.how_often.cost_label = 'actual cost';
    if (plant === 'retention') p.what_is_written_and_kept.transcripts = 'retained-local';
    if (plant === 'limits') p.what_this_preview_does_not_know = [];
    return p;
  };
}
process.on('exit', () => process.stderr.write('PREVIEW_LOOKUPS ' + lookups + '\n'));
