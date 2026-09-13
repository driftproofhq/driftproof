// SPDX-License-Identifier: Apache-2.0
//
// plugin/driftproof/lib/door.mjs - the door, and nothing behind it.
//
// WHAT THIS IS. Each command file under commands/ carries its instruction text
// for a reader and, at the end, a fenced `driftproof-steps` block: the ordered
// list of steps that command performs. This file executes that block. It holds
// no measurement, no receipt shape, no judge, no runner. Every step that does
// work does it by spawning the pinned CLI.
//
// WHY THE STEPS LIVE IN THE COMMAND FILE. So that the command file is the
// source of what the command does, and not a description of it that can drift.
// The gate drives these same files; an instruction added to a copy of one is an
// instruction that actually runs, which is what makes AC-2's mutation a planted
// subject rather than a claim.
//
// TWO RULES THIS FILE KEEPS, BOTH ASSERTED:
//   1. No shell, ever. Every spawn is an argv ARRAY handed to spawnSync with
//      shell:false. No string is composed from a user value and executed. There
//      is no template interpolation anywhere in this file, for the same reason.
//   2. Nothing is written except by the pinned CLI. This file creates no file,
//      edits nothing, and proposes nothing about the contents of a skill.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const MARK = '[driftproof-plugin]';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const MANIFEST = readJson(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'));
// The pinned runner IS the plugin's own version. One number, so a plugin and
// the runner it wraps cannot disagree about which runner it wraps.
const PINNED = MANIFEST.version;
const CONTRACT = readJson(path.join(PLUGIN_ROOT, 'input-contract.json'));
const GUARD = readJson(path.join(PLUGIN_ROOT, 'version-guard.json'));

function say(line) { process.stdout.write(MARK + ' ' + line + '\n'); }
function refuse(line) {
  process.stderr.write(MARK + ' REFUSED: ' + line + '\n');
  process.exit(2);
}

// ── the input contract, at the door ──────────────────────────────────────────
// A copy of action/lib.sh's rules, shipped as data because specs/ is not in the
// published tree. NFR-4 holds this file, the spec's fixture and action/lib.sh
// identical in both directions, so the copy cannot drift in silence.
//
// It runs HERE, before anything is spawned. The runner has had its own contract
// since spec 026 and it is the same contract, but it runs inside the runner:
// by the time it refuses, a process has already started. AC-4 asks for the
// refusal to come first.
function checkRule(name, value, ruleKey) {
  const rule = CONTRACT.rules[ruleKey];
  if (!rule) refuse('the shipped contract has no rule ' + ruleKey);
  const hit = new RegExp(rule.re.replace('[[:cntrl:]]', '[\\x00-\\x1f\\x7f]')).test(value);
  // The contract's messages are the Action's, and the Action names skill-dir
  // because that is the only path it validates. This door validates two, so a
  // message written for one is re-pointed at the input actually refused rather
  // than telling a person about an input they did not pass.
  if (rule.reject_on_match ? hit : !hit) refuse(rule.message.replace(/^skill-dir:/, name + ':') + ', got ' + JSON.stringify(value));
}

function validateInputs(inputs, opts) {
  const targetMustExist = opts.target_exists !== false;
  for (const name of inputs) {
    const value = INPUTS[name];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value === '') refuse(name + ': expected a value');
    if (name === 'models') checkRule(name, value, 'models');
    if (name === 'max-calls') checkRule(name, value, 'max_calls');
    if (name === 'max-usd') { checkRule(name, value, 'max_usd'); checkRule(name, value, 'max_usd_zero'); }
    if (name === 'skill-dir' || name === 'receipt') {
      checkRule(name, value, 'skill_dir_control');
      checkRule(name, value, 'skill_dir_shell_metachar');
      // action/lib.sh's validate_skill_dir is three parts: non-empty, no control
      // character, and it must already be there. This door adds a fourth before
      // the third — a quote, a semicolon, a backtick or a $( ) refuses here.
      //
      // The comment this replaces claimed the THIRD part did that work: "a path
      // carrying a quote, a semicolon, a command substitution or a backtick is
      // refused right here by the third part". It is not, and never was. The
      // third part refuses a path that DOES NOT EXIST, which is a different
      // sentence that happens to be true of the same inputs when the test plants
      // paths it never creates. Spec 028's AC-4 planted exactly those, so five
      // of its six payload classes were answered by "not a directory" and the
      // character property was never tested. Create the directory and the old
      // door resolved it, printed the trusted-lane statement, and spawned.
      //
      // No shell ever saw it either way — every spawn here is an argv array with
      // shell:false. The refusal is not there to stop an injection; it is there
      // because a person on the trusted lane, in their own checkout, should be
      // told about a path shaped like a command substitution rather than have it
      // quietly work.
      if (targetMustExist) {
        const resolved = path.resolve(process.cwd(), value);
        const ok = fs.existsSync(resolved) && (name === 'receipt' ? fs.statSync(resolved).isFile() : fs.statSync(resolved).isDirectory());
        if (!ok) refuse(name + ': ' + (name === 'receipt' ? 'not a file' : 'not a directory') + ': ' + JSON.stringify(value));
      }
    }
  }
}

// ── spawning the pinned CLI ──────────────────────────────────────────────────
// argv is an ARRAY. There is no shell, no string, and no interpolation.
function runCli(args, opts) {
  const argv = ['driftproof@' + PINNED].concat(args);
  const r = spawnSync('npx', argv, {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    shell: false,
    stdio: opts && opts.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
  });
  return { code: r.status == null ? 70 : r.status, out: r.stdout || '', err: r.stderr || '' };
}

// ── the version guard ────────────────────────────────────────────────────────
// Read-only, and it runs before anything that writes or spends. Its threshold
// resolved when RUNNER_VERSION first moved through a merge; version-guard.json
// records the version and the merge that set it.
function semverGte(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0; const y = pb[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return true;
}
function versionGuard() {
  const min = GUARD.minimum;
  const probe = runCli(['--version'], { capture: true });
  const found = String(probe.out || '').trim().split('\n').pop().trim();
  if (probe.code !== 0 || !/^[0-9]+\.[0-9]+\.[0-9]+/.test(found)) {
    refuse('could not read the runner version from the pinned CLI (exit ' + probe.code + '); refusing rather than running an unknown runner');
  }
  if (min && !semverGte(found, min)) {
    refuse('this plugin requires driftproof ' + min + ' or later and the pinned runner reported ' + found
      + '. Update the plugin (claude plugin update driftproof@driftproofhq), which moves the pin.');
  }
  say('runner ' + found + ' meets the minimum ' + String(min) + ' recorded in version-guard.json');
  return found;
}

// ── the trusted lane ─────────────────────────────────────────────────────────
// Spec 022 put the untrusted lane behind a separate unix account. This plugin does
// not reach that lane: it passes --trusted-skill, which is a claim that a person
// looked at the skill and owns it, and that claim is only available for a skill
// inside the repository the operator is sitting in. Outside it, the command
// refuses and prints the isolated invocation instead of quietly weakening it.
function repoRoot() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8', shell: false });
  if (r.status !== 0) return null;
  return String(r.stdout || '').trim() || null;
}
function requireInsideRepo(value) {
  const root = repoRoot();
  const resolved = fs.realpathSync(path.resolve(process.cwd(), value));
  const isolated = 'npx driftproof@' + PINNED + ' run ' + resolved + ' --models <model>';
  if (!root) {
    refuse('this is not a git repository, so there is no repository boundary to place the skill inside, and the'
      + ' trusted-skill claim would rest on nothing. Run it with the isolation account instead, on the lane spec 022'
      + ' built for a skill you did not write:\n    ' + isolated);
  }
  const realRoot = fs.realpathSync(root);
  const inside = resolved === realRoot || resolved.startsWith(realRoot + path.sep);
  if (!inside) {
    refuse('the skill at ' + resolved + ' resolves outside this repository (' + realRoot + ').'
      + ' The trusted lane claims the skill is the author\'s own, and that claim is not available for a path you do'
      + ' not own here. Run it with the isolation account instead, on the lane spec 022 built for exactly this:\n    ' + isolated);
  }
  return resolved;
}

// ── the default model, READ and never written into a command file ────────────
// The cheapest registered model in the registry, resolved at run time. A
// literal here would go stale the day the registry moves.
//
// WHERE THE REGISTRY IS, and why it is HERE. This used to look two levels above
// the plugin root and then under the caller's working directory — the two places
// a checkout of the Driftproof repository has a `config/models.json`, and
// neither of them a place an INSTALLED plugin has one. `claude plugin install`
// copies this directory into
// <CLAUDE_CONFIG_DIR>/plugins/cache/<owner>/<plugin>/<version>/ and puts nothing
// beside it. Both candidates missed on every real installation, this function
// returned null, and the vector went out with a bare `--models`.
//
// So the plugin SHIPS the registry, at config/models.json beside this file.
// The copy is not free-floating: the plugin's version IS the runner version it
// pins (see PINNED above), and the npm package of that version ships this same
// file, so the two are one release by construction. Spec 028 NFR-6 holds the
// shipped copy and the repository's to the same answer for the one question
// asked of it here, which is the only question this file asks of a registry.
//
// DRIFTPROOF_REGISTRY still wins, and must: the runner reads it too, and a door
// resolving from a different registry than the runner validates against would
// choose a model the runner then refuses.
//
// There is no third outcome. If neither path yields a registry carrying a
// priced Anthropic model, this REFUSES and names every path it looked at.
// Returning null was the state that made the defect above possible.
function registryCandidates() {
  const out = [];
  if (process.env.DRIFTPROOF_REGISTRY) out.push({ path: process.env.DRIFTPROOF_REGISTRY, why: 'DRIFTPROOF_REGISTRY' });
  out.push({ path: path.join(PLUGIN_ROOT, 'config', 'models.json'), why: 'the registry shipped with this plugin' });
  return out;
}
function cheapestRegisteredModel() {
  const tried = [];
  for (const c of registryCandidates()) {
    if (!fs.existsSync(c.path)) { tried.push(c.path + ' (' + c.why + '): not there'); continue; }
    let reg;
    try { reg = readJson(c.path); } catch (e) { tried.push(c.path + ' (' + c.why + '): does not parse as JSON'); continue; }
    const cost = (m) => Number(m.input_price) + Number(m.output_price);
    const eligible = (reg.models || []).filter((m) => m.provider === 'anthropic' && Number.isFinite(cost(m)));
    if (!eligible.length) { tried.push(c.path + ' (' + c.why + '): carries no priced anthropic model'); continue; }
    eligible.sort((a, b) => cost(a) - cost(b) || (a.id < b.id ? -1 : 1));
    return { id: eligible[0].id, from: c.path, why: c.why };
  }
  refuse('no model registry resolved, so there is no default model to run with, and this command will not guess one.'
    + ' Looked at:\n    ' + tried.join('\n    ')
    + '\n  Pass --models <model> to name one, or point DRIFTPROOF_REGISTRY at a registry that carries one.');
  return null; // unreachable: refuse() exits
}

// ── what a badge cannot say ──────────────────────────────────────────────────
// receipt_hash proves the receipt has not moved since it was sealed. It proves
// nothing about whether the generations behind it are the ones that were
// measured: generation_hash and judge_sample_hashes digest bytes the receipt
// does not carry, and without --keep-transcripts those bytes were never kept.
// There is no transcript hash in this tree. So the badge says so, every time.
// ── the README snippet, DERIVED from the shields JSON the runner returned ────
//
// spec 028 A-028-19. The plugin is a door: `badgeEndpoint`'s JSON is composed by
// the runner and printed byte-for-byte, and this is PRESENTATION of that JSON —
// it measures nothing, digests nothing and decides nothing. The derivation is
// stated in the spec and in commands/badge.md, the gate computes it there rather
// than reading this function, and its one variable input is the runner's own
// `label`, so a runner that labelled a badge differently would move the snippet
// with it.
//
// A-028-18 put this in the CLI instead, as `badge --readme-snippet`, and left
// the plugin's pin at a published version that has no such flag: the runner then
// ignored the flag and printed the badge JSON a second time, exit 0, with no
// snippet and no diagnostic. Reversed for that reason.
//
// It is applied to THE BYTES THE CLI RETURNED. With nothing captured there is
// nothing to present, and this refuses rather than printing a constant that
// would look exactly like a derivation that had run.
const SNIPPET_HOST = 'https://YOUR-HOST/badge.json';
function readmeSnippetFrom(json) {
  if (!json) refuse('no shields JSON was captured, and the README snippet is derived from it; refusing rather than printing a snippet nothing produced');
  let badge;
  try { badge = JSON.parse(json); } catch (e) {
    refuse('the pinned CLI\'s badge output did not parse as JSON, and the README snippet is derived from it: ' + e.message);
  }
  const label = badge && badge.label;
  if (typeof label !== 'string' || !label) refuse('the shields JSON the pinned CLI returned carries no label, and the README snippet is derived from it');
  return 'README snippet (shields.io endpoint, pointed at the badge JSON you commit):\n'
    + '  ![' + label + '](https://img.shields.io/endpoint?url=' + SNIPPET_HOST + ')\n';
}

function notCheckedStatement(checked) {
  const L = [];
  L.push('what this badge did NOT check:');
  if (checked && checked.count) {
    L.push('  generation_hash    RECHECKED against the retained transcripts beside this receipt (' + checked.count + ' case(s))');
    L.push('  judge_sample_hashes  NOT CHECKED. The judge sample texts are not retained even under --keep-transcripts,');
    L.push('                       so there is nothing to recompute them from.');
  } else {
    L.push('  generation_hash    NOT CHECKED. It digests the generation text, which the receipt does not carry.');
    L.push('  judge_sample_hashes  NOT CHECKED. They digest the judge sample texts, which the receipt does not carry.');
    L.push('  No transcripts were retained beside this receipt, and this tree keeps no transcript hash, so a receipt');
    L.push('  handed over on its own cannot be bound to the evidence it summarises.');
  }
  L.push('  What WAS checked: receipt_hash, by the pinned CLI. That is integrity since sealing, and nothing more:');
  L.push('  the same edit followed by a re-seal would verify. Run with --keep-transcripts if you need the stronger claim.');
  return L.join('\n');
}

function recheckTranscripts(receiptPath) {
  const receipt = readJson(receiptPath);
  const dir = path.join(path.dirname(path.dirname(path.resolve(receiptPath))), 'transcripts', String(receipt.receipt_hash));
  const alt = path.join(path.dirname(path.resolve(receiptPath)), 'transcripts', String(receipt.receipt_hash));
  const useDir = fs.existsSync(dir) ? dir : (fs.existsSync(alt) ? alt : null);
  if (!useDir) return { count: 0 };
  const index = readJson(path.join(useDir, 'index.json'));
  let count = 0;
  for (const entry of index.entries || []) {
    const t = readJson(path.join(useDir, entry));
    // The retained generation is the generation TEXT, stored as a string
    // (lib/run.js writes String(gen.text)). generation_hash is sha256 over
    // exactly that string, so this is the same read, not a parallel one.
    const text = typeof t.generation === 'string' ? t.generation : String((t.generation && t.generation.text) || '');
    const got = crypto.createHash('sha256').update(text).digest('hex');
    const c = ((receipt.results && receipt.results.cases) || []).find((x) => x.id === t.id && x.mode === t.mode);
    if (!c || c.generation_hash == null) continue;
    if (c.generation_hash !== got) {
      process.stderr.write(MARK + ' REFUSED: generation_hash does not verify for case ' + t.id + ' (' + t.mode + '):'
        + ' the retained transcript beside this receipt is not the text the receipt digests. Nothing rendered.\n');
      process.exit(4);
    }
    count += 1;
  }
  return { count: count };
}

// ── the step interpreter ─────────────────────────────────────────────────────
function stepsFor(command) {
  const md = fs.readFileSync(path.join(PLUGIN_ROOT, 'commands', command + '.md'), 'utf8');
  const m = /```driftproof-steps\n([\s\S]*?)\n```/.exec(md);
  if (!m) { process.stderr.write(MARK + ' commands/' + command + '.md carries no driftproof-steps block\n'); process.exit(2); }
  return JSON.parse(m[1]);
}

const INPUTS = {};
// Which flags each command takes. A flag that is not here is REFUSED, never
// ignored: silently dropping --samples would mean a person who asked for one
// judge sample got five and a receipt that recorded five, with nothing anywhere
// saying their argument had been discarded.
const ACCEPTS = { init: [], run: ['models', 'max-calls', 'max-usd'], badge: [] };
function parseArgv(argv) {
  const command = argv[0];
  if (!Object.prototype.hasOwnProperty.call(ACCEPTS, command)) {
    process.stderr.write(MARK + ' unknown command ' + JSON.stringify(command) + '\n');
    process.exit(2);
  }
  const rest = argv.slice(1);
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (!ACCEPTS[command].includes(name)) {
        refuse(command + ' does not take ' + a + '. It takes: '
          + (ACCEPTS[command].length ? ACCEPTS[command].map((f) => '--' + f).join(', ') : 'no flags')
          + '. Pass anything else to the CLI directly, so that what you asked for is what runs.');
      }
      // A-028-27, approval finding N-3. A flag's value is the next token, and
      // at the end of argv there is no next token: `rest[i + 1]` is `undefined`,
      // `validateInputs` skips an undefined value and `buildVector`'s `when`
      // guard reads the group as absent — which is the correct reading for a cap
      // the user did not give, and the wrong one for a cap the user asked for
      // and did not finish typing. `run <dir> --max-calls` used to run with no
      // cap and print nothing about it. That is the same sentence as the refusal
      // above ("a flag that is not here is REFUSED, never ignored") one argument
      // short, and the same rule as emitGroup's below, read on the way IN.
      //
      // Only the TRAILING case is undefined. `--max-calls --max-usd 3` stores
      // the literal "--max-usd" and is refused by the max_calls contract rule,
      // as intended; nothing here changes that path.
      if (i + 1 >= rest.length) {
        refuse(a + ' was given with no value. ' + command + ' takes ' + a + ' <value>.'
          + ' A flag with nothing behind it is refused rather than dropped, because dropping it'
          + ' would run without the ' + name + ' you asked for and say nothing about it.'
          + ' Nothing was spawned.');
      }
      INPUTS[name] = rest[i + 1];
      i += 1;
    } else positional.push(a);
  }
  if (command === 'badge') INPUTS['receipt'] = positional[0];
  else INPUTS['skill-dir'] = positional[0];
  return command;
}

function resolveArg(token, state) {
  if (typeof token !== 'string' || token[0] !== '@') return token;
  const key = token.slice(1);
  if (key === 'skill-dir' && state.resolvedTarget) return state.resolvedTarget;
  if (key === 'receipt' && state.resolvedTarget) return state.resolvedTarget;
  if (key === 'models' && !INPUTS['models']) return state.defaultModel;
  return INPUTS[key];
}

// A FLAG AND ITS VALUE ARE ONE EMISSION UNIT, or neither is emitted.
//
// This function used to build a flat list and end with
// `.filter((x) => x !== undefined && x !== null)`. That filter removed the
// VALUE and left the FLAG standing, so the next element became its argument:
// with no registry to resolve a default model from, the vector went out as
// ["run", <dir>, "--models", "--trusted-skill"] and the runner was asked for a
// model called "true". It is not a fact about models. Any flag whose value
// failed to resolve would do the same thing to whatever followed it, which is
// why the rule is structural and lives here rather than at the one call site.
//
// A group is `{emit: [...]}`, optionally guarded. There are three outcomes and
// no fourth:
//   - the guard is false: the group is not emitted, which is ordinary (the caps
//     are absent when the user gave none, so the CLI's own defaults apply);
//   - the guard passes and every element resolves: the group is emitted whole;
//   - the guard passes and an element does not resolve: REFUSED, naming it.
// The third is the one this file used to get wrong, and refusing is the door's
// own rule about not dropping anything quietly, applied to itself.
function emitGroup(elements, state, out, where) {
  const vals = elements.map((e) => resolveArg(e, state));
  const i = vals.findIndex((v) => v === undefined || v === null);
  if (i !== -1) {
    refuse('the ' + where + ' step asks for ' + JSON.stringify(elements[i]) + ' and nothing resolves it, so '
      + JSON.stringify(elements.join(' ')) + ' is not emitted at all. A flag and its value go together or neither goes:'
      + ' emitting the flag alone would hand the next argument to it. Nothing was spawned.');
  }
  for (const v of vals) out.push(v);
}
function buildVector(args, state) {
  const out = [];
  for (const a of args) {
    if (typeof a === 'string') { emitGroup([a], state, out, 'cli'); continue; }
    if (a && a.when) { if (INPUTS[a.when] !== undefined) emitGroup(a.emit, state, out, 'cli'); continue; }
    if (a && a.unless_default) { if (state.defaultModel || INPUTS[a.unless_default] !== undefined) emitGroup(a.emit, state, out, 'cli'); continue; }
    if (a && a.emit) { emitGroup(a.emit, state, out, 'cli'); continue; }
  }
  return out;
}

const command = parseArgv(process.argv.slice(2));
const steps = stepsFor(command);
const state = { resolvedTarget: null, defaultModel: null, rendered: null };

for (const step of steps) {
  if (step.op === 'validate') { validateInputs(step.inputs, step); continue; }
  if (step.op === 'resolve-target') {
    const given = INPUTS[step.input];
    if (given === undefined) refuse(step.input + ': expected a value');
    state.resolvedTarget = step.inside_repo ? requireInsideRepo(given) : path.resolve(process.cwd(), given);
    say('resolved ' + step.input + '=' + state.resolvedTarget);
    continue;
  }
  if (step.op === 'state-trusted') {
    say('treating this skill as the author\'s own, because it resolves inside this repository.'
      + ' That is why the run passes --trusted-skill: it runs as you, in your checkout, with no isolation hop.');
    continue;
  }
  if (step.op === 'version-guard') { versionGuard(); continue; }
  if (step.op === 'resolve-model') {
    if (!INPUTS['models']) {
      // cheapestRegisteredModel() either returns a model or refuses. It cannot
      // return null, which is what it used to do in silence: the `say` below
      // fired only when a default HAD been resolved, so the one case worth
      // hearing about was the one case that printed nothing.
      const d = cheapestRegisteredModel();
      state.defaultModel = d.id;
      say('no --models given; defaulting to the cheapest registered model, ' + d.id + ', read from ' + d.why);
    }
    continue;
  }
  if (step.op === 'cli') {
    const vector = buildVector(step.args, state);
    const r = runCli(vector, { capture: !!step.capture });
    if (step.capture) {
      if (r.code !== 0) {
        process.stderr.write(MARK + ' REFUSED: ' + step.on_fail + '\n' + (r.err || r.out).trim() + '\n');
        process.exit(4);
      }
      if (step.render) {
        state.rendered = r.out;
        process.stdout.write(MARK + ' begin-render\n');
        process.stdout.write(r.out);
        process.stdout.write(MARK + ' end-render\n');
      } else if (r.out) process.stdout.write(r.out);
    } else if (r.code !== 0) process.exit(r.code);
    continue;
  }
  if (step.op === 'recheck-transcripts') { state.checked = recheckTranscripts(state.resolvedTarget); continue; }
  if (step.op === 'readme-snippet') { process.stdout.write(readmeSnippetFrom(state.rendered)); continue; }
  if (step.op === 'not-checked') { process.stdout.write(notCheckedStatement(state.checked) + '\n'); continue; }
  if (step.op === 'say') { say(step.text); continue; }
  process.stderr.write(MARK + ' unknown step op ' + JSON.stringify(step.op) + '\n');
  process.exit(2);
}
