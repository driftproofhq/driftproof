// SPDX-License-Identifier: Apache-2.0
import { createBasicCore } from '../import-core/basic.mjs';
import { createAnthropicCore } from '../import-core/anthropic.mjs';
import { IMPORT_MAX_BYTES, importDiagnostic, jsonOf } from '../import-core/input.mjs';

const FORMATS = ['agent-skills-eval', 'skillgrade', 'claude-plugin-eval', 'skill-creator', 'harbor', 'nvidia-cards'];
const basic = createBasicCore();
const anthropic = createAnthropicCore();
const LIMIT = 'Each file must be at most sixteen MiB.';
// Same visible code-point notation as the CLI's names.invisibleShown: this is that line, and tests/door.test.js holds the two equal.
const HIDDEN = /(\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}|[0-9#*]\u{FE0F}\u{20E3}|\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}\p{Emoji_Modifier}]?(?:\u{200D}\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}\p{Emoji_Modifier}]?)*)|\p{Cc}|\p{Zl}|\p{Zp}|\p{Default_Ignorable_Code_Point}/gu;
const safe = value => String(value).replace(HIDDEN, (m, emoji) => emoji === undefined ? '\\u{' + m.codePointAt(0).toString(16) + '}' : m);

// Analysis contains source declarations and calculated figures, never a seal or fabricated hashes.
export function analyzeFiles(files, from) {
  if (from === 'harbor') throw new Error('Harbor needs a job directory. Use driftproof import --from harbor on your machine.');
  if (from === 'nvidia-cards') throw new Error('NVIDIA cards need a git checkout. Use driftproof import --from nvidia-cards on your machine.');
  if (!FORMATS.includes(from)) throw new Error('Choose a supported format.');
  if (!files.length || files.length > (from === 'skill-creator' ? 2 : 1)) throw new Error('Choose one results file, with optional result.json for skill-creator.');
  for (const f of files) if (!(f.bytes instanceof Uint8Array) || f.bytes.byteLength > IMPORT_MAX_BYTES) throw new Error(LIMIT);
  const companions = from === 'skill-creator' ? files.filter(f => f.name === 'result.json') : [];
  const main = files.filter(f => !companions.includes(f));
  if (main.length !== 1 || companions.length > 1) throw new Error('Choose one benchmark file and at most one result.json companion.');
  // Check the source's identifying shape before the legacy permissive reader.
  const doc = jsonOf(main[0].bytes);
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('Expected a results object.');
  if (from === 'skill-creator' && (!doc.metadata || typeof doc.metadata !== 'object')) throw new Error('Expected benchmark.json metadata.');
  const r = ['agent-skills-eval', 'skillgrade'].includes(from)
    ? basic.analyze(main[0].bytes, { from, importedAt: null })
    : anthropic.analyze(main[0].bytes, { from, importedAt: null, resultBytes: companions[0]?.bytes ?? null });
  const analysis = { skill: r.skill.name, model: r.run.model_id, results: r.results, comparison: r.comparison, economics: r.economics ?? null, counts: r.run.counts ?? null, arms: r.run.arms ?? null, notices: r.run.import.notices || [] };
  const lines = [
    'verification_level: DECLARED (source ' + safe(r.run.source) + ') — the source tool\'s declaration, converted faithfully;',
    'no generation hashes (never fabricated); excluded from drift verdicts unless re-run TESTED. See docs/interop.md.',
    ...analysis.notices.map(n => 'notice: ' + safe(n)),
  ];
  return { analysis, lines, command: 'driftproof import results.json --from ' + from };
}

const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
const number = value => value === null || value === undefined ? 'unavailable' : String(value);

export function mount(el) {
  const formatLabel = node('label', 'Results format');
  const select = node('select'); select.dataset.dropFormat = '';
  for (const name of FORMATS) { const option = node('option', name); option.value = name; select.append(option); }
  formatLabel.append(select);
  const pickLabel = node('label', 'Choose a results file');
  const input = node('input'); input.type = 'file'; input.multiple = true; input.accept = '.json,.md'; input.dataset.dropInput = '';
  pickLabel.append(input);
  const drop = node('div', 'Drop a results file here, or choose one above.'); drop.dataset.dropZone = ''; drop.className = 'drop-results-zone';
  const help = node('p', 'For skill-creator, you can select benchmark.json and its result.json together. Other formats take one file. ' + LIMIT);
  const output = node('section'); output.dataset.dropOutput = ''; output.setAttribute('aria-live', 'polite');
  el.replaceChildren(formatLabel, pickLabel, drop, help, output);
  let revision = 0;
  async function show(files) {
    const own = ++revision;
    const from = select.value;
    output.replaceChildren(node('p', 'Reading locally…'));
    try {
      if (!files.length || files.length > (from === 'skill-creator' ? 2 : 1)) throw new Error('Choose one results file, with optional result.json for skill-creator.');
      if (files.some(f => f.size > IMPORT_MAX_BYTES)) throw new Error(LIMIT);
      const bytes = await Promise.all(files.map(async f => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
      if (own !== revision) return;
      const { analysis: a, lines, command } = analyzeFiles(bytes, from);
      const title = node('h2', 'File analysis');
      const mark = node('p', 'This is an analysis, not a sealed receipt.');
      const identity = node('p', 'Skill: ' + safe(a.skill) + '. Model: ' + safe(a.model) + '.');
      const figures = node('dl');
      for (const [label, value] of [
        ['With-skill score', a.comparison.with_skill_score], ['Baseline score', a.comparison.baseline_score],
        ['Difference', a.comparison.delta], ['Comparison band', a.comparison.delta_uncertainty],
      ]) figures.append(node('dt', label), node('dd', number(value)));
      const summary = node('pre', lines.join('\n'));
      const details = node('details'); details.append(node('summary', 'Cases, counts and economics'), node('pre', JSON.stringify(a, (_key, value) => typeof value === 'string' ? safe(value) : value, 2)));
      const cli = node('p', 'To write a sealed receipt, run this on your machine. Replace results.json with your file path. Keep any result.json companion beside it.');
      const cmd = node('pre'); cmd.append(node('code', command));
      output.replaceChildren(title, mark, identity, figures, summary, details, cli, cmd);
    } catch (e) {
      if (own === revision) output.replaceChildren(node('p', 'Cannot read this file: ' + safe(importDiagnostic(e.message))));
    }
  }
  input.addEventListener('change', () => show([...input.files]));
  select.addEventListener('change', () => { revision++; input.value = ''; output.replaceChildren(); });
  drop.addEventListener('dragover', e => e.preventDefault());
  drop.addEventListener('drop', e => { e.preventDefault(); show([...e.dataTransfer.files]); });
  // Prevent a file dropped elsewhere from navigating away from the page.
  el.addEventListener('dragover', e => e.preventDefault());
  el.addEventListener('drop', e => e.preventDefault());
}
