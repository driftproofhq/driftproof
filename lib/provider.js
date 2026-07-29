// SPDX-License-Identifier: Apache-2.0
'use strict';

const { spawn } = require('child_process');
const { withRetry, withTimeout } = require('./json');
const { stubComplete, stubEnabled } = require('./stub');

// Provider abstraction: one `complete()` call, two surfaces.
//
//   CLAUDE_PROVIDER=api   → Anthropic Messages API (needs ANTHROPIC_API_KEY).
//   CLAUDE_PROVIDER=cli   → spawn `claude -p` with ANTHROPIC_API_KEY STRIPPED
//                           from the child env, so dev runs draw on the local
//                           subscription session credit rather than metered API
//                           billing. This is the DEFAULT for dev.
//
// The surface actually used is returned so the runner can stamp it into the
// receipt (run.surface = "api" | "claude-cli").

// Short model aliases → canonical ids. Kept tiny and explicit; unknown values
// are passed through verbatim so a full model id always works.
const MODEL_ALIASES = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',          // current Sonnet
  'sonnet-5': 'claude-sonnet-5',
  'sonnet-4-6': 'claude-sonnet-4-6',  // previous Sonnet point release
  opus: 'claude-opus-4-8',
};

function resolveModel(m) {
  return MODEL_ALIASES[m] || m;
}

function providerName() {
  return (process.env.CLAUDE_PROVIDER || 'cli').toLowerCase();
}

// The receipt-facing label for the surface in use.
function surfaceLabel() {
  return providerName() === 'api' ? 'api' : 'claude-cli';
}

// Send a single-turn prompt and return { text, usage, surface }.
// usage is { input_tokens, output_tokens } when the surface reports it (api),
// else null (cli does not expose token counts to us).
// `temperature` is honoured ONLY on the api surface (the Messages API exposes
// it). On the cli surface sampling params are surface-controlled — we cannot set
// them, so temperature is ignored there and the receipt records that fact.
async function complete({ system, prompt, model, maxTokens = 1024, timeoutMs = 120000, temperature = undefined }) {
  const surface = surfaceLabel();
  // Offline stub surface: return a canned completion with zero model calls. The
  // receipt still records the real surface label so a stub run is not mistaken
  // for a genuine one at read time — only run.judge/generation TEXT is canned.
  if (stubEnabled()) return { ...stubComplete({ system, prompt }), surface };
  const runner = () => (surface === 'api'
    ? completeApi({ system, prompt, model, maxTokens, temperature })
    : completeCli({ system, prompt, model, timeoutMs }));
  // A published run makes ~1000s of calls; be patient with transient
  // throttling/cold-starts so one blip doesn't abort a multi-hour grind.
  const out = await withRetry(() => withTimeout(runner, timeoutMs, `provider(${surface})`), { tries: 4, baseDelayMs: 3000 });
  return { ...out, surface };
}

async function completeApi({ system, prompt, model, maxTokens, temperature }) {
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); }
  catch (_e) { throw new Error('CLAUDE_PROVIDER=api requires the @anthropic-ai/sdk package (npm i @anthropic-ai/sdk)'); }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('CLAUDE_PROVIDER=api requires ANTHROPIC_API_KEY');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const params = {
    model: resolveModel(model),
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
  };
  if (system) params.system = system;
  if (temperature !== undefined) params.temperature = temperature;
  const resp = await client.messages.create(params);
  const text = (resp.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return {
    text,
    usage: {
      input_tokens: (resp.usage && resp.usage.input_tokens) || 0,
      output_tokens: (resp.usage && resp.usage.output_tokens) || 0,
    },
  };
}

function completeCli({ system, prompt, model, timeoutMs }) {
  return new Promise((resolve, reject) => {
    // Strip ANTHROPIC_API_KEY so the CLI uses the subscription session, not the
    // metered API key. Everything else in the env is preserved.
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;

    const args = ['-p', '--model', resolveModel(model)];
    if (system) args.push('--append-system-prompt', system);

    const child = spawn('claude', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const killer = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs + 5000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => {
      clearTimeout(killer);
      if (e.code === 'ENOENT') reject(new Error("CLAUDE_PROVIDER=cli requires the `claude` CLI on PATH. Install it or set CLAUDE_PROVIDER=api."));
      else reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(killer);
      if (code !== 0) return reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 400)}`));
      resolve({ text: out.trim(), usage: null });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

module.exports = { complete, resolveModel, surfaceLabel, providerName, MODEL_ALIASES };
