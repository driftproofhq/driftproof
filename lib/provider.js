// SPDX-License-Identifier: Apache-2.0
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
// Called through the module object (cp.spawn), never destructured: the gate
// records spawns by replacing that property, so nothing real runs offline.
const cp = require('child_process');
const { withRetry, withTimeout } = require('./json');
const { stubComplete, stubEnabled } = require('./stub');
const {
  parseClaudeCliJson, parseCodexJsonl, parseAnthropicApiUsage, parseOpenaiApiUsage, normalizeUsage,
} = require('./usage');

// Provider abstraction: one `complete()` call over a TWO-AXIS lane model —
// provider (anthropic | openai) × surface (api | cli). Four concrete lanes:
//
//   anthropic/api   → Anthropic Messages API (ANTHROPIC_API_KEY)   label "api"
//   anthropic/cli   → spawn `claude -p` on the subscription        label "claude-cli"
//   openai/api      → Chat Completions-compatible API (OPENAI_API_KEY, base_url
//                     configurable — generic so a future provider is just a
//                     registry entry with a base_url)               label "openai-api"
//   openai/cli      → spawn `codex exec` on the ChatGPT subscription label "openai-cli"
//
// The provider of a call is inferred from the MODEL id (so a run can generate on
// an OpenAI model while the fixed Haiku judge still runs on Anthropic). The
// surface for each provider is chosen from the environment:
//
//   anthropic:  CLAUDE_PROVIDER = api | cli      (default cli — subscription)
//   openai:     OPENAI_SURFACE  = api | cli      (default: api iff OPENAI_API_KEY
//                                                 is present, else cli/codex)
//
// The surface actually used is returned so the runner can stamp it into the
// receipt (run.surface), together with run.provider.

// Short model aliases → canonical ids. Kept tiny and explicit; unknown values
// are passed through verbatim so a full model id always works.
const MODEL_ALIASES = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-5',          // current Sonnet
  'sonnet-5': 'claude-sonnet-5',
  'sonnet-4-6': 'claude-sonnet-4-6',  // previous Sonnet point release
  opus: 'claude-opus-4-8',
  // OpenAI convenience aliases (full ids always work too).
  gpt: 'gpt-5.6-sol',
  'gpt-flagship': 'gpt-5.6-sol',
};

function resolveModel(m) {
  return MODEL_ALIASES[m] || m;
}

// Infer the provider from a (resolved) model id. Pure and self-contained (no
// registry require) so provider.js has no cycle with lib/models.js; the registry
// `provider` field is authoritative where a model is registered (see
// lib/models.providerForModel), and registered OpenAI ids match this prefix too.
function inferProvider(modelId) {
  const id = String(resolveModel(modelId) || '').toLowerCase();
  if (/^(gpt-|o[1-9]|chatgpt|codex|text-|davinci|omni)/.test(id)) return 'openai';
  return 'anthropic';
}

// ── surface selection per provider ───────────────────────────────────────────
function anthropicSurface() {
  return (process.env.CLAUDE_PROVIDER || 'cli').toLowerCase() === 'api' ? 'api' : 'claude-cli';
}

function openaiSurface() {
  const pref = (process.env.OPENAI_SURFACE || '').toLowerCase();
  if (pref === 'api') return 'openai-api';
  if (pref === 'cli' || pref === 'codex') return 'openai-cli';
  // Auto: prefer the metered API when a key is present (published-run default),
  // else fall back to the Codex subscription surface.
  return process.env.OPENAI_API_KEY ? 'openai-api' : 'openai-cli';
}

function surfaceForModel(modelId) {
  return inferProvider(modelId) === 'openai' ? openaiSurface() : anthropicSurface();
}

function providerForSurface(surface) {
  return (surface === 'openai-api' || surface === 'openai-cli') ? 'openai' : 'anthropic';
}

// Backward-compatible default surface label (the Anthropic axis). Kept so callers
// that stamp a surface without a model (legacy) keep their prior meaning.
function surfaceLabel() { return anthropicSurface(); }

function providerName() {
  return (process.env.CLAUDE_PROVIDER || 'cli').toLowerCase();
}

// A surface whose spend is metered (real dollars) vs a subscription surface
// (metered spend $0; the $ figure is the estimated-equivalent API cost).
function isMeteredSurface(surface) { return surface === 'api' || surface === 'openai-api'; }
function isSubscriptionSurface(surface) { return !isMeteredSurface(surface); }

// Per-surface retry/timeout policy. A cli/subscription surface spawns a first-party
// CLI subprocess (cold-start-dominated, occasionally hangs), so it gets a longer
// per-call timeout (300s) and a longer exponential backoff (baseDelay 30s → 30/60/
// 120s across the 4 retries); api surfaces keep the tighter 120s / 3s defaults.
function retryPolicyForSurface(surface) {
  const cli = isSubscriptionSurface(surface);
  return { timeoutMs: cli ? 300000 : 120000, baseDelayMs: cli ? 30000 : 3000, tries: 4 };
}

// The fixed harness preamble Codex prepends to every `codex exec` call. Recorded
// into openai/cli receipts as run.surface_overhead_note so a reader knows the
// per-call input-token count is dominated by a constant we do not control.
const CODEX_OVERHEAD_NOTE =
  'openai/cli surface (codex exec): every call carries a fixed Codex base-instruction '
  + 'preamble of ~12,000–15,000 input tokens that the harness prepends and we do not '
  + 'control; the model id is set by us via -m (it is not echoed in the JSONL stream). '
  + 'Approval prompting is off by default on `codex exec` (no -a flag is passed).';

// Send a single-turn prompt and return { text, usage, wall_ms, surface, provider }.
//
// usage is the normalized v0.4 record { input_tokens, output_tokens, cached_tokens,
// wall_ms } on EVERY lane — including the two CLI lanes, which report it in their
// structured output (`claude -p --output-format json`; the `codex exec --json`
// JSONL stream). See lib/usage.js for the per-surface shapes and the input-token
// normalization. Fields the surface does not report stay null, never 0.
//
// wall_ms is measured HERE, around the successful attempt, so it means the same
// thing on all four lanes (retries are excluded — a retried call's latency would
// describe our backoff, not the model).
//
// `temperature` is honoured ONLY on api surfaces; cli surfaces control sampling
// themselves, so temperature is ignored there and the receipt records that fact.
// `trusted` (spec 022) selects the SAME-USER legacy spawn on the two CLI lanes.
// It is false unless a caller says otherwise; bin/driftproof exposes it as
// --trusted-skill, for skills the operator authored. Api lanes ignore it.
async function complete({ system, prompt, model, maxTokens = 1024, timeoutMs = null, temperature = undefined, trusted = false }) {
  const surface = surfaceForModel(model);
  const provider = providerForSurface(surface);
  // Offline stub surface: canned completion, zero model calls. The receipt still
  // records the real surface/provider so a stub run is not mistaken for a genuine
  // one at read time — only the generation/judge TEXT is canned.
  if (stubEnabled()) {
    const s = stubComplete({ system, prompt });
    return { ...s, usage: normalizeUsage(s.usage), wall_ms: (s.usage && s.usage.wall_ms) || 0, surface, provider, attempts: 1 };
  }

  // Per-surface tolerance (see retryPolicyForSurface): a cli/subscription surface
  // spawns a first-party CLI subprocess whose cold-start is slow and occasionally
  // hangs, so it gets a longer per-call timeout (300s) and a longer exponential
  // backoff between the 4 retries (30s / 60s / 120s); api surfaces keep the tighter
  // defaults. An explicit caller timeoutMs still wins.
  const policy = retryPolicyForSurface(surface);
  const effTimeout = timeoutMs != null ? timeoutMs : policy.timeoutMs;
  const baseDelayMs = policy.baseDelayMs;

  const laneRunner = () => {
    switch (surface) {
      case 'api': return completeAnthropicApi({ system, prompt, model, maxTokens, temperature });
      case 'claude-cli': return completeClaudeCli({ system, prompt, model, timeoutMs: effTimeout, trusted });
      case 'openai-api': return completeOpenaiApi({ system, prompt, model, maxTokens, temperature, timeoutMs: effTimeout });
      case 'openai-cli': return completeCodexCli({ system, prompt, model, timeoutMs: effTimeout, trusted });
      default: throw new Error(`unknown surface: ${surface}`);
    }
  };
  // A published run makes ~1000s of calls; be patient with transient
  // throttling/cold-starts so one blip doesn't abort a multi-hour grind. `attempts`
  // counts every try (retries included) so the budget can charge for them.
  let attempts = 0;
  // Wall-clock of the attempt that SUCCEEDED (each attempt overwrites, so a
  // retried call reports the latency of the call that actually produced the text,
  // not the accumulated backoff).
  let wallMs = null;
  const runner = () => {
    attempts += 1;
    const t0 = Date.now();
    return withTimeout(laneRunner, effTimeout, `provider(${surface})`)
      .then((r) => { wallMs = Date.now() - t0; return r; });
  };
  try {
    const out = await withRetry(runner, { tries: policy.tries, baseDelayMs });
    const usage = normalizeUsage({ ...(out.usage || {}), wall_ms: wallMs });
    return { ...out, usage, wall_ms: wallMs, surface, provider, attempts };
  } catch (e) {
    // Surface the attempt count so a persistently-failing call can be charged for
    // (and, for a timeout, marked failed_timeout by the runner instead of fatal).
    if (e && typeof e === 'object') e.attempts = attempts;
    throw e;
  }
}

// ── anthropic/api ─────────────────────────────────────────────────────────────
async function completeAnthropicApi({ system, prompt, model, maxTokens, temperature }) {
  let Anthropic;
  try { Anthropic = require('@anthropic-ai/sdk'); }
  catch (_e) { throw new Error('the anthropic/api surface requires the @anthropic-ai/sdk package (npm i @anthropic-ai/sdk)'); }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('the anthropic/api surface requires ANTHROPIC_API_KEY');
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
  return { text, usage: parseAnthropicApiUsage(resp.usage) };
}

// ── isolation: the eval-user hop (spec 022) ───────────────────────────────────
//
// Every local-CLI spawn runs as a DEDICATED UNPRIVILEGED UNIX USER by default.
// The third-party SKILL.md a run evaluates is instructions to an agent with
// tools, and until spec 022 that agent ran as the operator: same uid, whole
// environment block, operator's cwd, operator's CLI configuration. The
// 2026-09-03 security audit (findings A2, N5) confirmed a live API token in the
// inherited environment and this host's SSH keys and CLI session tokens
// readable by the same uid; this was then reproduced by execution.
//
// The boundary is a uid change reached through sudo from an EMPTY environment:
//
//   /usr/bin/sudo -n -u <eval-user> /usr/bin/env -i HOME=/home/<eval-user>
//     PATH=/home/<eval-user>/.local/bin:/usr/bin:/bin bash -lc '<wrapper>'
//     driftproof-eval-hop <cli> <cli-args...>
//
// Operator prerequisite, NOT created here (RUNBOOK.md): the user exists with a
// mode-700 home and no extra groups, has its own logged-in `claude` and `codex`
// under ~/.local/bin, and a sudoers rule grants the operator NOPASSWD as that
// user. The runner refuses loudly when any of that is missing; it never creates
// a user, edits sudoers, or logs a CLI in.
//
// The same-user (legacy) spawn survives ONLY behind `trusted: true`, exposed by
// bin/driftproof as --trusted-skill, for skills the operator authored.
const SUDO_BIN = '/usr/bin/sudo';
const ENV_BIN = '/usr/bin/env';
const EVAL_USER_DEFAULT = 'driftproof-eval';
// A user name that can safely follow `sudo -u`: no leading dash, no shell
// metacharacter, no path separator. Anything else is refused before any spawn.
const EVAL_USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
// The ONLY names the child environment carries, each CONSTRUCTED from the eval
// user's name in isolatedEnv() and never copied from process.env. Verified
// 2026-09-03: both CLIs run through the hop with these two alone; the login
// shell supplies LANG and TERM itself. Data, frozen, asserted by the gate.
const ISOLATED_ENV_ALLOWLIST = Object.freeze(['HOME', 'PATH']);
// $0 of the wrapper, so `ps` shows what the bash process is.
const HOP_LABEL = 'driftproof-eval-hop';
// The wrapper runs INSIDE the hop, as the eval user. It takes the CLI as
// positional parameters ("$@"), so no SKILL.md text is ever shell-interpreted.
//   - the cwd is a fresh per-call directory under the system tmp, created by
//     the eval user (one the parent creates is mode 700 to it);
//   - the CLI runs under setsid in its own process group, stdin preserved
//     (`<&0` defeats the /dev/null a non-interactive bash gives a background job);
//   - TERM/INT/HUP, which sudo relays from the parent on timeout, kill that
//     whole group, remove the directory and exit 143;
//   - a normal exit removes the directory and returns the CLI's status.
const ISOLATED_WRAPPER = [
  'd=$(mktemp -d -t driftproof-eval.XXXXXXXX) || exit 97',
  'cd "$d" || exit 97',
  'setsid -w "$@" <&0 & pid=$!',
  'trap \'kill -TERM -- "-$pid" 2>/dev/null; sleep 1; kill -KILL -- "-$pid" 2>/dev/null; cd /; rm -rf "$d"; exit 143\' TERM INT HUP',
  'wait "$pid"; r=$?',
  'cd /; rm -rf "$d"; exit $r',
].join('; ');

// DRIFTPROOF_EVAL_USER selects WHICH user isolates, never WHETHER isolation
// happens (that is the trusted flag, an argv decision). Empty means default.
function evalUser() {
  const raw = process.env.DRIFTPROOF_EVAL_USER;
  const u = raw === undefined || raw === '' ? EVAL_USER_DEFAULT : raw;
  if (!EVAL_USER_RE.test(u)) throw new Error(`DRIFTPROOF_EVAL_USER is not a plausible unix user name: ${JSON.stringify(u)}`);
  return u;
}

// The child environment: constructed, not copied. Keys are exactly the allowlist.
function isolatedEnv(user) {
  const home = `/home/${user}`;
  return { HOME: home, PATH: `${home}/.local/bin:/usr/bin:/bin` };
}

// The spawn plan for one CLI call: { mode, user, file, args, env }. Pure, so the
// gate can inspect what WOULD be spawned. Untrusted → the hop; trusted → the
// legacy same-user spawn exactly as it was (env inherited; the claude lane still
// strips ANTHROPIC_API_KEY so the CLI uses the subscription, not the metered key).
function buildSpawnPlan({ bin, args, trusted = false }) {
  if (trusted) {
    const env = { ...process.env };
    if (bin === 'claude') delete env.ANTHROPIC_API_KEY;
    return { mode: 'same-user', user: null, file: bin, args: [...args], env };
  }
  const user = evalUser();
  const childEnv = isolatedEnv(user);
  return {
    mode: 'isolated',
    user,
    file: SUDO_BIN,
    args: ['-n', '-u', user, ENV_BIN, '-i', ...ISOLATED_ENV_ALLOWLIST.map((k) => `${k}=${childEnv[k]}`), 'bash', '-lc', ISOLATED_WRAPPER, HOP_LABEL, bin, ...args],
    // The sudo front process gets NOTHING from this process. sudo resolves
    // /usr/bin/env itself; env -i then starts the child from empty.
    env: {},
  };
}

// Run a plan: `input` to stdin, stdout/stderr collected, settled on close.
// The timeout signal differs by mode. The legacy child gets SIGKILL as it
// always did. The hop gets SIGTERM: it is the signal the operator's uid can
// deliver to a root-owned sudo, and the one sudo relays to the wrapper's trap.
// SIGKILL would neither be permitted nor relayed, and a wrapper without the
// trap left the CLI orphaned with the stdout pipe open, so close never fired.
function runPlan(plan, { input = null, timeoutMs = 300000, graceMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = cp.spawn(plan.file, plan.args, { env: plan.env, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return reject(e); }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const killer = setTimeout(() => {
      timedOut = true;
      child.kill(plan.mode === 'isolated' ? 'SIGTERM' : 'SIGKILL');
    }, timeoutMs + graceMs);
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (e) => { clearTimeout(killer); reject(e); });
    child.on('close', (code, signal) => { clearTimeout(killer); resolve({ code, signal, stdout, stderr, timedOut }); });
    child.stdin.on('error', () => { /* EPIPE if the CLI exits before reading all of stdin */ });
    if (input != null) child.stdin.write(input);
    child.stdin.end();
  });
}

// The hop with an arbitrary command in place of the CLI, for the gate: the same
// plan builder and the same runner, never trusted. No provider is reached.
function runIsolated(cmdArgv, opts = {}) {
  const [bin, ...args] = cmdArgv;
  return runPlan(buildSpawnPlan({ bin, args, trusted: false }), { graceMs: 0, ...opts });
}

// A hop failure, said in terms of what to fix. Returns null when the failure is
// the CLI's own (exit status from inside the hop), which the lane reports as before.
function hopFailure(bin, r) {
  const err = String(r.stderr || '').trim();
  if (r.code === 127) {
    return `the \`${bin}\` CLI is not on the eval user's PATH inside the isolated hop (${err.slice(0, 200)}). `
      + 'Install and log it in as that user (RUNBOOK.md), or pass --trusted-skill for a skill you authored.';
  }
  const sudoLine = err.split('\n').find((l) => /^sudo:/.test(l));
  if (sudoLine) {
    return `the isolated eval-user hop failed before reaching \`${bin}\`: ${sudoLine}. The eval user and its NOPASSWD sudoers `
      + 'rule are an operator prerequisite (RUNBOOK.md); pass --trusted-skill only for a skill you authored.';
  }
  return null;
}

// ── anthropic/cli (claude -p) ──────────────────────────────────────────────────
async function completeClaudeCli({ system, prompt, model, timeoutMs, trusted = false }) {
  // v0.4: `--output-format json` returns ONE JSON object carrying both the
  // final text (`result`) and the token usage (`usage`) — the default text
  // output carries no usage at all, which is why usage was previously null on
  // this lane. The text is read from the parsed object; if the CLI ever emits
  // something unparseable we fall back to the raw stdout so a run degrades to
  // the old behaviour (text, no usage) rather than failing.
  const args = ['-p', '--output-format', 'json', '--model', resolveModel(model)];
  if (system) args.push('--append-system-prompt', system);
  const plan = buildSpawnPlan({ bin: 'claude', args, trusted });
  let r;
  try {
    r = await runPlan(plan, { input: prompt, timeoutMs });
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(plan.mode === 'isolated'
        ? `the isolated hop requires ${SUDO_BIN}`
        : "the anthropic/cli surface requires the `claude` CLI on PATH. Install it or set CLAUDE_PROVIDER=api.");
    }
    throw e;
  }
  if (r.code !== 0) {
    const hop = plan.mode === 'isolated' ? hopFailure('claude', r) : null;
    throw new Error(hop || `claude CLI exited ${r.code}: ${r.stderr.slice(0, 400)}`);
  }
  const parsed = parseClaudeCliJson(r.stdout);
  if (!parsed) return { text: r.stdout.trim(), usage: null };
  if (parsed.isError) throw new Error(`claude CLI reported is_error: ${String(parsed.text || '').slice(0, 300)}`);
  return { text: String(parsed.text || '').trim(), usage: parsed.usage };
}

// ── openai/api (Chat Completions-compatible) ───────────────────────────────────
// Generic OpenAI-compatible client using global fetch (Node ≥ 18). The base_url
// is configurable — env OPENAI_BASE_URL wins, else the registry's provider
// base_url (lib/models.providerConfig), else api.openai.com/v1. Building it
// base_url-first is deliberate: a future provider is a registry entry with a
// base_url + api-key env, not a new code path.
async function completeOpenaiApi({ system, prompt, model, maxTokens, temperature, timeoutMs }) {
  const cfg = openaiProviderConfig();
  const apiKey = process.env[cfg.apiKeyEnv] || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error(`the openai/api surface requires ${cfg.apiKeyEnv} (or run the codex CLI surface). Set OPENAI_SURFACE=cli to use the subscription instead.`);
  const baseUrl = (process.env.OPENAI_BASE_URL || cfg.baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const body = { model: resolveModel(model), messages };
  // Newer OpenAI models use `max_completion_tokens`; classic Chat Completions use
  // `max_tokens`. Send the modern field; harmless on classic-compatible servers
  // that ignore unknown fields, and correct for current OpenAI models.
  if (maxTokens) body.max_completion_tokens = maxTokens;
  if (temperature !== undefined) body.temperature = temperature;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally { clearTimeout(t); }
  const raw = await resp.text();
  if (!resp.ok) throw new Error(`openai/api ${resp.status}: ${raw.slice(0, 300)}`);
  let parsed;
  try { parsed = JSON.parse(raw); } catch (_e) { throw new Error(`openai/api: unparseable response: ${raw.slice(0, 200)}`); }
  const text = ((parsed.choices && parsed.choices[0] && parsed.choices[0].message && parsed.choices[0].message.content) || '');
  return { text: String(text).trim(), usage: parseOpenaiApiUsage(parsed.usage) };
}

// Read the OpenAI provider config (base_url + api-key env) from the registry,
// lazily (require inside the fn) so provider.js keeps no load-time cycle with
// lib/models.js. Falls back to the public defaults if the registry omits it.
function openaiProviderConfig() {
  try {
    const cfg = require('./models').providerConfig('openai');
    if (cfg) return { baseUrl: cfg.base_url, apiKeyEnv: cfg.api_key_env || 'OPENAI_API_KEY' };
  } catch (_e) { /* fall through to defaults */ }
  return { baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY' };
}

// ── openai/cli (codex exec — ChatGPT subscription) ─────────────────────────────
// Invocation template (from the verified recon, reference_codex_cli):
//   codex exec --json -s read-only --skip-git-repo-check --ephemeral [-m <model>] -
// Honoured facts:
//   - `-a/--ask-for-approval` is INVALID on `codex exec` — it is NEVER passed;
//     exec already defaults to approval_policy "never".
//   - the model id is NOT echoed in the JSONL stream; we set -m so the receipt
//     records what WE requested (run.model_id).
//   - auth lives at ~/.codex/auth.json; we do a PRESENCE check only and NEVER
//     read or print its contents.
//   - `codex exec` has no system-prompt flag, so a system prompt (the SKILL.md in
//     with_skill mode) is folded into the prompt text.
//   - stderr emits a harmless "Reading additional input from stdin…" notice.
//   - `-o/--output-last-message` is NEVER passed (spec 022 AC-9, approval F-1).
//     The final message is taken from the `--json` stream on the stdout pipe
//     this process owns. A `-o` path is a file the child writes and the parent
//     reads back; isolated, the child is the eval user running third-party
//     instructions, and a symlink planted at that path would have made this
//     process read an operator-owned file into the generation.
const CODEX_EXEC_ARGS = ['exec', '--json', '-s', 'read-only', '--skip-git-repo-check', '--ephemeral'];

function codexAuthPresent(homeDir) {
  const home = homeDir || process.env.CODEX_HOME_DIR || os.homedir();
  // CODEX_HOME overrides the auth location if the user set it (codex convention).
  const base = process.env.CODEX_HOME || path.join(home, '.codex');
  return fs.existsSync(path.join(base, 'auth.json'));
}

// Build the exact argv for a codex exec call. Exposed for the gate to assert the
// template (that `-a` never appears, and neither does `-o`).
function buildCodexArgs({ model } = {}) {
  const args = [...CODEX_EXEC_ARGS];
  if (model) args.push('-m', resolveModel(model));
  return args;
}

// The FULL argv for a codex call: the template plus a single `-` positional that
// means "read the prompt from stdin". The prompt is NEVER a positional argv —
// real SKILL.md files start with `---` (YAML frontmatter) and codex rejects a
// positional beginning with `--`. Exposed so the gate can lock this in.
function codexFinalArgs({ model } = {}) {
  return [...buildCodexArgs({ model }), '-'];
}

async function completeCodexCli({ system, prompt, model, timeoutMs, trusted = false }) {
  // The auth presence check is a PARENT-side read of ~/.codex/auth.json, which
  // only means something on the same-user path; the eval user's home is not
  // readable from here, and a missing login there surfaces as codex's own error.
  if (trusted && !codexAuthPresent()) {
    throw new Error('the openai/cli surface requires codex auth (~/.codex/auth.json). Run `codex login` (or `codex login --device-auth` on a headless box).');
  }
  // codex exec has no system-prompt flag → fold the system prompt into the
  // prompt text (this is how the SKILL.md reaches the model in with_skill mode).
  const fullPrompt = system ? `${system}\n\n---\n\n${prompt}` : prompt;
  // The prompt is delivered on STDIN, not as a positional argv: real SKILL.md
  // files begin with `---` (YAML frontmatter), and a positional argument that
  // starts with `--` is rejected by codex's arg parser ("unexpected argument
  // '---'"). `-` as the positional tells `codex exec` to read instructions from
  // stdin (per its --help), which is content-agnostic.
  const plan = buildSpawnPlan({ bin: 'codex', args: codexFinalArgs({ model }), trusted });
  // stdout is CAPTURED. `--json` streams JSONL events there: the last
  // `item.completed`/`agent_message` carries the final text and the terminal
  // `turn.completed` event carries this call's token usage — the only place
  // codex reports it. Nothing is read from the filesystem after the call, on
  // either mode: the stdout pipe is the one channel only the child we spawned
  // can write to, and the eval user cannot make this process read a file
  // through it (spec 022 AC-9).
  let r;
  try {
    r = await runPlan(plan, { input: fullPrompt, timeoutMs });
  } catch (e) {
    if (e.code === 'ENOENT') {
      throw new Error(plan.mode === 'isolated'
        ? `the isolated hop requires ${SUDO_BIN}`
        : 'the openai/cli surface requires the `codex` CLI on PATH (npm i -g @openai/codex).');
    }
    throw e;
  }
  if (r.code !== 0) {
    const hop = plan.mode === 'isolated' ? hopFailure('codex', r) : null;
    throw new Error(hop || `codex exec exited ${r.code}: ${String(r.stderr).slice(0, 400)}`);
  }
  const ev = parseCodexJsonl(r.stdout);
  return { text: String(ev.text || '').trim(), usage: ev.usage };
}

module.exports = {
  complete, resolveModel, surfaceLabel, providerName, MODEL_ALIASES,
  inferProvider, surfaceForModel, providerForSurface,
  isMeteredSurface, isSubscriptionSurface, retryPolicyForSurface,
  CODEX_OVERHEAD_NOTE, CODEX_EXEC_ARGS, buildCodexArgs, codexFinalArgs, codexAuthPresent,
  // spec 022 — the eval-user hop
  SUDO_BIN, EVAL_USER_DEFAULT, ISOLATED_ENV_ALLOWLIST, ISOLATED_WRAPPER, HOP_LABEL,
  evalUser, isolatedEnv, buildSpawnPlan, runIsolated,
};
