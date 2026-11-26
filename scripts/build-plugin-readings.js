#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 840 (spec 840 AC-7): the published readings the plugin's skill-check skill may show, copied
// from what the site already publishes. The rows are docs/data/published-receipts.json and the
// subjects are the public skill index, both read through the badge builder's own functions, so a
// skill has a line here exactly when the site shows it a model badge. The words are the badge's.
// No model call and no network read.
//
// A-840-2: scripts/published-badges.js build(), which writes docs/data/published-receipts.json for
// scripts/build-receipt-pages.js and scripts/build-badges.js, writes and checks this file from the same
// rows in the same call, so the copy moves whenever the list does. This command does it on its own.
//
//   node scripts/build-plugin-readings.js [--check] [--plugin <plugin-dir>]
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';
const REL = path.join('skills', 'skill-check', 'readings.md');
const PLUGIN_REL = path.join('plugin', 'driftproof');

const modelName = (row) => { try { return require('./model-names').shortModelName(row.model); } catch { return row.model; } };
const dateName = (iso) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));

// rows: the published list's rows (read from docs/data/published-receipts.json when not given).
// subjects: the public skill index's subjects, before or after subjectsFor (read from the index when not given).
function readings({ root = ROOT, rows, subjects } = {}) {
  const { select, publicSubjects, subjectsFor } = require('./published-badges');
  if (!rows) rows = JSON.parse(fs.readFileSync(path.join(root, 'docs', 'data', 'published-receipts.json'), 'utf8')).receipts;
  const sections = [];
  let newest = null;
  for (const subject of subjectsFor(subjects || publicSubjects(root), rows)) {
    const chosen = select(rows.filter((r) => subject.keys.includes(r.skill_key)));
    const lines = chosen.models.filter((r) => r.source === 'driftproof' && r.text && r.badge_model_url).map((r) => {
      if (!newest || r.date > newest) newest = r.date;
      return '- ' + modelName(r) + ' · ' + dateName(r.date) + ': ' + r.text + '. Receipt: ' + ORIGIN + '/r/' + r.receipt_hash + '/';
    });
    if (!lines.length) continue;
    const [owner, repo] = subject.page.split('/');
    sections.push(['## ' + subject.name + ' (' + owner + '/' + repo + ')', '', 'Skill page: ' + ORIGIN + '/skills/' + subject.page + '/', '', ...lines].join('\n'));
  }
  const head = ['# Published readings', ''];
  if (!newest) return [...head, 'No published readings. The site may hold newer ones.', ''].join('\n');
  return [
    ...head,
    // A-840-2: the date is the newest receipt's run date, and the sentence says so.
    'As of ' + dateName(newest) + ', the run date of the newest receipt below. These are the readings in driftproofhq.com\'s published receipt list when this copy was made. The site may hold newer ones.',
    '',
    'Each line is the newest reading of one skill on one model, in the words its badge shows. It is for the version of the skill Driftproof measured on that date, from the repository named, and may not match the person\'s copy. The receipt shows what was measured.',
    '',
    sections.join('\n\n'),
    '',
  ].join('\n');
}

// Write the file, or with check, return whether it is stale. -> { file, stale }
function sync({ root = ROOT, plugin = path.join(root, PLUGIN_REL), check = false, rows, subjects } = {}) {
  const file = path.join(plugin, REL);
  const want = readings({ root, rows, subjects });
  const have = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (!check && have !== want) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, want); }
  return { file, stale: have !== want };
}

function main(argv) {
  const check = argv.includes('--check');
  let plugin;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--check') continue;
    if (argv[i] === '--plugin') {
      const v = argv[i + 1];
      // A-840-2: a missing value never falls back to the working directory.
      if (!v || v.startsWith('--')) { console.error('plugin readings: --plugin needs a folder'); return 2; }
      plugin = path.resolve(v); i += 1; continue;
    }
    console.error('plugin readings: unknown argument ' + JSON.stringify(argv[i]) + '\nusage: node scripts/build-plugin-readings.js [--check] [--plugin <plugin-dir>]');
    return 2;
  }
  const { stale } = sync({ plugin, check });
  if (check) {
    if (stale) { console.error('plugin readings: ' + REL + ' is stale; run node scripts/build-plugin-readings.js'); return 1; }
    console.log('plugin readings: ' + REL + ' is current');
    return 0;
  }
  console.log('plugin readings: ' + REL + ' written');
  return 0;
}

module.exports = { readings, sync, REL, PLUGIN_REL };
if (require.main === module) process.exitCode = main(process.argv.slice(2));
