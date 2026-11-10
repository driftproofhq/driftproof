// SPDX-License-Identifier: Apache-2.0
'use strict';

// Display only: cmdRun supplies its resolved inputs and projections. This module
// does not resolve rc defaults, load a subject, call a model or write a file.
const path = require('node:path');
const { sha256 } = require('./canonical');
const { estimateTokens } = require('./skillCost');
const { termText } = require('./names');
const { surfaceForModel, providerForSurface, isMeteredSurface, previewDestination } = require('./provider');
const { promptTemplateHash, criteriaTemplateHash } = require('./judge');
const { receiptBaseName } = require('./receipt');
const { PRESET_QUICK } = require('./firstrun');
const { CLAUDE_TEXT_TOOLS, codexSandbox } = require('./capture');

const LIMITS = Object.freeze([
  'This preview does not know what the claude or codex CLI itself connects to or logs.',
  'This preview does not know a model provider’s own retention of prompts or answers.',
  'A future flag, rc file or environment change may change the surface or destination.',
]);
const TRUSTED_TOOLS = "The model's tools run as you, with your files and network.";
// Issue 756 (A-728-6): what each surface gives the model under text capture, the only capture a
// preview describes, from what the run passes. Codex gets a sandbox, not a list of tools.
function toolsFor(surface) {
  if (surface === 'claude-cli') return { tools: [...CLAUDE_TEXT_TOOLS], sandbox: null };
  if (surface === 'openai-cli') return { tools: null, sandbox: codexSandbox('text') };
  return { tools: [], sandbox: null };
}
const OVER_USD = 'The estimate exceeds --max-usd.';
// Two decimals where that loses nothing; a smaller limit is shown as given.
const usdLimit = (usd) => (Number(usd.toFixed(2)) === usd ? usd.toFixed(2) : String(usd));

// JSON strings carry the same terminal-safe form as the text display. Never
// interpolate a file name or source line directly into either output format.
function terminalSafe(value) {
  if (typeof value === 'string') return termText(value);
  if (Array.isArray(value)) return value.map(terminalSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, terminalSafe(v)]));
  return value;
}
function environmentFor(surface) {
  const names = surface.startsWith('openai')
    ? ['OPENAI_SURFACE', 'OPENAI_API_KEY', 'OPENAI_BASE_URL']
    : ['CLAUDE_PROVIDER', 'ANTHROPIC_BASE_URL'];
  // Presence metadata only. The provider's existing nonempty key check chooses
  // the surface; no credential value is copied into this display object.
  return names.map(name => ({ name, set: Object.hasOwn(process.env, name) }));
}
function buildPreview({ skill, runCases, targets, judges, samples, drawsMax, arms,
  perModelCalls, totalProjected, cost, maxCalls, maxUsd, concurrency, timeoutMs,
  keepTranscripts, quick, trusted, stubRun, outDir, isolation }) {
  const where = targets.flatMap((model, i) => [
    { role: 'answers', model }, { role: 'judge', model: judges[i] },
  ]).map(({ role, model }) => {
    const surface = surfaceForModel(model);
    const metered = isMeteredSurface(surface);
    return {
      role, model, surface, provider: providerForSurface(surface),
      ...previewDestination(model), spend: metered ? 'metered' : 'subscription',
      active: !stubRun,
      isolation: stubRun ? { lane: 'none (stub)', account: null, exists: null }
        : metered ? { lane: 'none (API)', account: null, exists: null }
        : trusted ? { lane: 'trusted', account: null, exists: null }
        : { lane: 'eval-user', account: isolation.user, exists: isolation.exists },
      ...toolsFor(surface), tools_note: !stubRun && !metered && trusted ? TRUSTED_TOOLS : null,
      environment: environmentFor(surface),
    };
  });
  const blockers = [];
  if (isolation.refusal) blockers.push(isolation.refusal);
  if (perModelCalls > maxCalls) blockers.push('The projected calls exceed the per-model --max-calls limit.');
  if (cost.totalUSD > maxUsd) blockers.push(OVER_USD);
  const system = {
    bytes: Buffer.byteLength(skill.skillMd, 'utf8'),
    estimated_tokens: estimateTokens(skill.skillMd),
    token_estimate_note: 'Estimated from text length, not measured with a model tokenizer.',
    sha256: sha256(skill.skillMd),
    first_line: skill.skillMd.split(/\r?\n/, 1)[0],
  };
  let placebo = null;
  if (arms === 3) {
    const builder = require('./placebo');
    const p = builder.placeboFor({ skillText: skill.skillMd, seed: skill.contentHash });
    builder.assertPlaceboLength(skill.skillMd, p);
    const shared = builder.sharedRun(skill.skillMd, p.text);
    if (shared) throw Object.assign(new Error(`placebo: the placebo shares the words "${shared}" with the skill text, so it would repeat the skill's own wording; nothing run, no receipt written`), { code: 'PLACEBO_OVERLAP' });
    placebo = { bytes: p.bytes, sha256: p.sha256, first_line: p.text.split(/\r?\n/, 1)[0] };
  }
  const relativeOut = path.relative(process.cwd(), outDir) || '.';
  const receiptPatterns = targets.map(model => path.join(relativeOut, receiptBaseName({
    skill: skill.name, model, date: '<date>', hash: '<hash12>', ...(quick ? { tag: PRESET_QUICK } : {}),
  }) + '.json'));
  return terminalSafe({
    what_is_sent: {
      subject: skill.unit === 'context_file' ? path.basename(skill.file) : skill.name,
      system,
      bundled_files: skill.unit === 'context_file' ? null : {
        sent: ['SKILL.md'],
        not_sent: (skill.files || []).map(f => f.path).filter(p => p !== 'SKILL.md').sort(),
        note: 'Only SKILL.md is added as system text. Other bundled files enter the content hash but are not sent. The selected task prompts and guides come from evals/evals.json.',
      },
      baseline: 'No subject system text is added to the baseline.',
      placebo,
      tasks: runCases.map(c => ({
        id: c.id, prompt_bytes: Buffer.byteLength(c.prompt, 'utf8'),
        rubric: c.rubric, ...(c.criteria ? { criteria: c.criteria } : {}),
        pass_threshold: c.pass_threshold,
        prompt_template_hash: c.criteria ? criteriaTemplateHash() : promptTemplateHash(),
      })),
      judge: 'The judge is sent the task, the answer and the guide, with its grading instructions.',
    },
    where,
    how_often: {
      cases: runCases.length, arms: arms === 3 ? ['with_skill', 'baseline', 'placebo'] : ['with_skill', 'baseline'],
      draws: drawsMax, judge_samples: samples, target_models: targets.length,
      calls_per_model: perModelCalls, total_calls: totalProjected,
      formula: 'cases × arms × draws × (1 + judge samples), per target model',
      note: 'Projected calls at the draw cap, not observed calls. Adaptive sampling can stop earlier; failed answers may not reach the judge. Retries can add attempts.',
      cost_label: 'metered-equivalent estimate', estimated_usd: stubRun ? null : cost.totalUSD,
      cost_note: stubRun ? 'No projected cost: no model will be called.' : 'Registry prices and rough token assumptions, not an invoice or measured usage.',
      synthetic: stubRun, concurrency, timeout_ms: timeoutMs ?? null,
      max_calls_per_model: maxCalls, max_usd: maxUsd, run_blockers: blockers,
    },
    what_is_written_and_kept: {
      receipt_patterns: receiptPatterns,
      summary_patterns: receiptPatterns.map(p => p.replace(/\.json$/, '.summary.md')),
      transcripts: keepTranscripts ? 'retained-local' : 'hashes-only',
      meaning: keepTranscripts
        ? 'Answers, judge outputs and the suite are kept locally with the receipt.'
        : 'The receipt keeps hashes and scores; raw answers and judge outputs are not saved by Driftproof.',
      transcript_pattern: keepTranscripts ? 'transcripts/<receipt_hash>/' : null,
      answers: 'Answers are kept only with --keep-transcripts, which --quick enables too.',
      upload: 'Driftproof makes no separate upload of receipts or transcripts; the model calls described above send their inputs.',
      preview: 'This preview creates no receipt, transcript or directory.',
    },
    what_this_preview_does_not_know: [...LIMITS],
  });
}
function renderPreview(p) {
  const s = p.what_is_sent, h = p.how_often, w = p.what_is_written_and_kept;
  const lines = ['What is sent', '  Subject: ' + s.subject,
    '  With-skill system text: ' + s.system.bytes + ' bytes; about ' + s.system.estimated_tokens + ' estimated tokens',
    '  ' + s.system.token_estimate_note, '  sha256: ' + s.system.sha256,
    '  First line: "' + s.system.first_line + '"', '  ' + s.baseline];
  if (s.bundled_files) {
    lines.push('  Bundled files sent: ' + s.bundled_files.sent.join(', '),
      '  Bundled files not sent: ' + (s.bundled_files.not_sent.join(', ') || '(none)'),
      '  ' + s.bundled_files.note);
  }
  if (s.placebo) lines.push('  Placebo system text: ' + s.placebo.bytes + ' bytes; sha256: ' + s.placebo.sha256, '  First line: "' + s.placebo.first_line + '"');
  for (const t of s.tasks) {
    lines.push('  Task "' + t.id + '": ' + t.prompt_bytes + ' prompt bytes',
      '    Judge prompt template sha256: ' + t.prompt_template_hash,
      '    Pass threshold: ' + t.pass_threshold);
    if (t.criteria && t.rubric) lines.push('    Context for the criteria: ' + t.rubric);
    if (t.criteria) for (const c of t.criteria) lines.push('    Criterion ' + c.id + ' (weight ' + c.weight + '): ' + c.description);
    else lines.push('    Guide: ' + t.rubric);
  }
  lines.push('  ' + s.judge, '', 'Where');
  for (const r of p.where) {
    lines.push('  ' + r.role + ': ' + r.model + '; ' + r.provider + '; ' + r.surface + '; ' + r.spend,
      '    ' + (r.cli_binary ? 'CLI binary: ' + r.cli_binary : 'API host: ' + r.api_host),
      '    Lane: ' + r.isolation.lane + (r.isolation.account ? '; account: ' + r.isolation.account + '; exists: ' + (r.isolation.exists === null ? 'unknown' : r.isolation.exists) : ''),
      '    Tools: ' + (r.sandbox ? 'none named; codex runs in its ' + r.sandbox + ' sandbox' : r.tools.join(', ') || 'none'));
    if (r.tools_note) lines.push('    ' + r.tools_note);
    lines.push('    Environment: ' + r.environment.map(e => e.name + ' ' + (e.set ? 'set' : 'not set')).join(', '));
    if (!r.active) lines.push('    Inactive: the stub is enabled; no model would be called.');
  }
  lines.push('', 'How often', '  ' + h.formula,
    '  ' + h.cases + ' × ' + h.arms.length + ' × ' + h.draws + ' × (1 + ' + h.judge_samples + ') = ' + h.calls_per_model + ' per model; ' + h.total_calls + ' total',
    '  Arms: ' + h.arms.join(', '), '  ' + h.note,
    h.synthetic ? '  Synthetic stub plan; no model cost.' : '  ' + h.cost_label + ': $' + h.estimated_usd.toFixed(4),
    '  ' + h.cost_note, '  Concurrency: ' + h.concurrency,
    '  Per-model call limit: ' + h.max_calls_per_model,
    '  Timeout: ' + (h.timeout_ms === null ? 'the surface default' : h.timeout_ms + ' ms'));
  // A stub plan has no cost line, unless a refusal below refers to its limit.
  if (!h.synthetic || h.run_blockers.includes(OVER_USD)) lines.push('  Estimated cost limit: $' + usdLimit(h.max_usd));
  for (const b of h.run_blockers) lines.push('  Run would refuse: ' + b);
  lines.push('', 'What is written and kept');
  for (const r of w.receipt_patterns) lines.push('  Receipt path pattern: ' + r);
  for (const r of w.summary_patterns) lines.push('  Summary path pattern: ' + r);
  lines.push('  transcripts: ' + w.transcripts, '  ' + w.meaning);
  if (w.transcript_pattern) lines.push('  Transcript path pattern: ' + w.transcript_pattern);
  lines.push('  ' + w.answers, '  ' + w.upload, '  ' + w.preview, '', 'What this preview does not know',
    ...p.what_this_preview_does_not_know.map(s => '  ' + s));
  return lines.join('\n') + '\n';
}
module.exports = { buildPreview, renderPreview };
