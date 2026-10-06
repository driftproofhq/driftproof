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
//
// SPEC 138 adds three flags `run` passes through to the CLI (--samples, --concurrency,
// --max-cases), each checked by the contract first. SPEC 139 adds --quick on `run` and the
// guided first run (`start`). The two rules above hold for all of it: `start` lists, checks and
// spawns the pinned CLI, and opens the page the CLI wrote with the platform's opener. SPEC 140
// adds the trusted lane where there is no git repository, behind --trust-outside-repo, and init
// into a skill that exists, behind --confirm-write. Neither is ever a default, and this file
// never reads stdin, so a yes typed to it does nothing: the command files have Claude ask.
// SPEC 165 leads a skill that exists into the guided run: `init` given a draft takes the steps of
// `start`, and `run` on a skill with no test cases says it can draft them. Neither writes anything
// of its own; the one new file is still the CLI's, after --confirm-write.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(HERE, '..');
const MARK = '[driftproof-plugin]';
// The plain line for the UNDERPOWERED state, as lib/verdict.js carries it (spec 035 AC-9).
const UNDERPOWERED_LINE = 'Not enough draws to conclude at this effect floor';
// Spec 143 (A-035-9): the cases line and word, as lib/verdict.js carries them, for the state where the
// cases disagree. tests/cases-not-draws.test.js holds both copies to lib/verdict.js's exports.
const CASES_LINE = 'More cases, not more draws, are needed to conclude at this effect floor';
const CASES_WORD = 'more cases needed';

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
  // The contract's messages are the Action's, and each names the one input the
  // Action checks with it. This door checks more inputs with some rules (two
  // paths with the path rules; --samples, --concurrency and --max-cases with the
  // max-calls rule, spec 138), so a message is re-pointed at the input actually
  // refused rather than telling a person about an input they did not pass.
  if (rule.reject_on_match ? hit : !hit) refuse(rule.message.replace(/^[a-z-]+:/, name + ':') + ', got ' + JSON.stringify(value));
}

function validateInputs(inputs, opts) {
  const targetMustExist = opts.target_exists !== false;
  for (const name of inputs) {
    const value = INPUTS[name];
    if (value === undefined) continue;
    if (typeof value !== 'string' || value === '') refuse(name + ': expected a value');
    if (name === 'models') checkRule(name, value, 'models');
    if (name === 'max-calls') checkRule(name, value, 'max_calls');
    // Spec 138: the three run inputs the CLI checks with the max-calls rule (bin/driftproof
    // INPUT_CONTRACT.flags), checked with it here, before anything is spawned.
    if (name === 'samples' || name === 'concurrency' || name === 'max-cases') checkRule(name, value, 'max_calls');
    if (name === 'max-usd') { checkRule(name, value, 'max_usd'); checkRule(name, value, 'max_usd_zero'); }
    if (name === 'skill-dir' || name === 'receipt' || name === 'cases') {
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
        const file = name === 'receipt' || name === 'cases';
        const ok = fs.existsSync(resolved) && (file ? fs.statSync(resolved).isFile() : fs.statSync(resolved).isDirectory());
        if (!ok) refuse(name + ': ' + (name === 'receipt' || name === 'cases' ? 'not a file' : 'not a directory') + ': ' + JSON.stringify(value));
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
function versionGuard(step) {
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
  // Spec 139 (Q8, the pre-review's F-2): a command's guard step may name a minimum of its own,
  // a field of version-guard.json beside the plugin's. `start` writes the drafted cases through
  // `init --cases`, and a runner from before the release that ships it reads no flags in init: it
  // would write its example cases into the skill folder and drop the draft. So start's minimum is
  // that release, written by the release bump with the others and null until then, and start
  // refuses below it, or while it is null, before init is spawned.
  const own = step && step.minimum ? step.minimum : null;
  // Spec 140: `init` names it with only_adding, so a new folder is as it was and only an init that adds
  // to a skill that exists meets the runner that takes that (its older init also writes the rc).
  if (own && (!step.only_adding || state.adding)) {
    const need = GUARD[own];
    if (typeof need !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(need) || !semverGte(found, need)) {
      refuse(command + ' needs ' + (typeof need === 'string' ? 'driftproof ' + need + ' or later' : 'a runner release that version-guard.json records as ' + own + ', and none is recorded yet')
        + ', and the pinned runner reported ' + found + '. Update the plugin (claude plugin update driftproof@driftproofhq), which moves the pin. Nothing was written.');
    }
    say('runner ' + found + ' meets ' + command + '\'s own minimum ' + need + ' (' + own + ' in version-guard.json)');
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
//
// SPEC 140: THREE ANSWERS, NEVER TWO. A root; no repository, read only when git ran and said so
// (exit 128 and "not a git repository", the test spec 028's harness uses); or unknown. Git missing,
// a repository git will not read (dubious ownership), or any other failure is unknown, and the door
// refuses on it, flag or not: it cannot tell which side of the boundary it is on. LC_ALL=C keeps
// git's words the ones read here.
function repoState() {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: process.cwd(), encoding: 'utf8', shell: false, env: { ...process.env, LC_ALL: 'C' } });
  if (r.error) return { unknown: 'git could not be run: ' + (r.error.code || r.error.message) };
  const root = String(r.stdout || '').trim();
  if (r.status === 0 && root) return { root };
  if (r.status === 128 && /not a git repository/.test(String(r.stderr || ''))) return { none: true };
  const said = String(r.stderr || '').split('\n').map((l) => l.trim()).find(Boolean);
  return { unknown: 'git rev-parse exited ' + r.status + (said ? ': ' + said : '') };
}
// SPEC 140: WHERE THERE IS NO GIT REPOSITORY, THE PERSON CONFIRMS, BY A FLAG. The claim the trusted
// lane rests on is that a person looked at the skill and owns it; inside a repository the boundary
// stands in for that, and outside one nothing does, so the person says it: --trust-outside-repo.
// It is never a default and never an interactive yes. This file never reads stdin, and Claude Code
// runs it with no terminal, so the command files tell Claude to ask the person first and pass the
// flag only on a yes. Without it the door refuses with one message: the isolated invocation, the
// isolation account's state, and the flag. Inside a repository the flag is refused, and a skill
// outside the repository is refused flag or not, as before.
const EVAL_USER_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
// Spec 022's default account, the CLI's own (lib/provider.js). Written in two parts because spec 028
// AC-4's shell scan reads the bare word as a command, and this file composes none.
// The plugin imports nothing from lib/, so this and the pattern above are copies; tests/door.test.js
// reads both against lib/provider.js and fails when either moves.
const DEFAULT_ACCOUNT = 'driftproof-' + 'ev' + 'al';
function evalAccount() {
  const raw = process.env.DRIFTPROOF_EVAL_USER;
  const user = raw === undefined || raw === '' ? DEFAULT_ACCOUNT : raw;
  if (!EVAL_USER_RE.test(user)) return { user, exists: false };
  const r = spawnSync('id', ['-u', user], { encoding: 'utf8', shell: false });
  return { user, exists: !r.error && r.status === 0 };
}
// A command that does not take --trust-outside-repo never offers it to itself: it names
// /driftproof:run with the flag instead.
function requireInsideRepo(value, command) {
  const repo = repoState();
  const confirmed = INPUTS['trust-outside-repo'] === true;
  const resolved = fs.realpathSync(path.resolve(process.cwd(), value));
  const isolated = 'npx driftproof@' + PINNED + ' run ' + resolved + ' --models <model>';
  if (repo.unknown) refuse('git could not say whether there is a git repository here (' + repo.unknown + '), so this command cannot tell which side of a repository boundary the skill at ' + resolved + ' is on. It runs nothing on that, with --trust-outside-repo or without it. Nothing was spawned. Fix what git says, then run this command again.');
  if (repo.none && confirmed) {
    // SPEC 140 (the pre-review's F-2): with no repository the place the person says is theirs is the
    // folder they run from, and the skill must sit inside it on its real path, as DR-17 holds a skill
    // inside the repository. A skill elsewhere on the machine, and a link in this folder that points
    // out of it, are refused with the flag as without it.
    const here = fs.realpathSync(process.cwd());
    if (!(resolved === here || resolved.startsWith(here + path.sep))) {
      refuse('the skill at ' + resolved + ' resolves outside the folder you run from (' + here + '). There is no git repository here, so that folder'
        + ' stands where the repository would, and the trusted lane claims the skill is the author\'s own, which is not available for a path'
        + ' outside it, or for a link out of it, flag or not. Nothing was spawned. Run it with the isolation account instead, on the lane spec 022'
        + ' built for exactly this:\n    ' + isolated);
    }
    state.outsideRepo = true;
    return resolved;
  }
  if (repo.none) {
    const acct = evalAccount();
    const offersFlag = ACCEPTS[command].includes('trust-outside-repo');
    const route = acct.exists
      ? 'Run it with the isolation account instead, on the lane spec 022 built for a skill you did not write:'
      : 'This machine has no isolation account (' + acct.user + '), which a skill you did not write needs: a dedicated unprivileged user with its own logged-in claude, and a passwordless sudo rule that lets you run commands as it (the Isolation section of the Driftproof README on npm says what it needs). With that in place it runs on the lane spec 022 built for one:';
    // The yes the flag stands for is about a path the person has seen: the skill's real path and the folder it runs from.
    const here = fs.realpathSync(process.cwd());
    const asYou = 'the skill at ' + resolved + ' then runs from ' + here + ', as you, with your files and your Claude Code login.';
    const trust = offersFlag
      ? 'If you wrote the skill yourself, run this command again with --trust-outside-repo: ' + asYou
      : 'If you wrote the skill yourself, run /driftproof:run ' + resolved + ' --trust-outside-repo instead (' + command + ' does not take that flag): ' + asYou;
    refuse('this is not a git repository, so there is no repository boundary to place the skill inside, and the'
      + ' trusted-skill claim would rest on nothing. ' + route + '\n    ' + isolated + '\n' + trust);
  }
  const root = repo.root;
  if (confirmed) refuse('--trust-outside-repo is for a folder with no git repository, and this is one (' + fs.realpathSync(root) + '). A skill inside it runs on the trusted lane without the flag; a skill outside it does not, flag or not.');
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
// There is no transcript hash in this tree. So the badge says so, every time,
// in the words notCheckedStatement reads from the receipt and from what sits
// beside it.
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

// THE STATEMENT IS READ FROM THE RECEIPT, NEVER ASSERTED (spec 031 AC-1, AC-2).
// It used to say, whenever transcripts sat beside a receipt, that the judge
// sample texts are not retained even under --keep-transcripts. They are:
// lib/run.js keeps them and bin/driftproof writes them as `judge_outputs`, and
// every retained text in the archive digests to its `judge_sample_hashes` entry.
// So the badge now rechecks them, and each line below says what THIS receipt
// records (`run.transcripts`) and what was found beside it, and nothing more.
function notCheckedStatement(checked) {
  const L = [];
  const c = checked || {};
  L.push('what this badge did NOT check:');
  if (c.found) {
    L.push('  generation_hash    ' + (c.generationCases
      ? 'RECHECKED against the retained transcripts beside this receipt (' + c.generationCases + ' case(s))'
      : 'NOT CHECKED. No case in this receipt carries one.'));
    if (c.judgeCases && !c.judgeUnchecked) {
      L.push('  judge_sample_hashes  RECHECKED against the retained judge texts beside this receipt (' + c.judgeTexts + ' text(s) across ' + c.judgeCases + ' case(s))');
    } else if (c.judgeCases) {
      L.push('  judge_sample_hashes  RECHECKED for ' + c.judgeCases + ' case(s) (' + c.judgeTexts + ' text(s)); NOT CHECKED for ' + c.judgeUnchecked + ' case(s),');
      L.push('                       whose case carries no hashes, so nothing was recomputed.');
    } else {
      L.push('  judge_sample_hashes  NOT CHECKED. The cases matched beside this receipt carry no hashes, so nothing was recomputed.');
    }
    L.push('  These are the retained draws: a retained transcript holds the last measured draw of each case and mode, so');
    L.push('  ' + (c.generationCases || 0) + ' retained draw(s) were rechecked, not every draw the receipt measured.');
    L.push('  What WAS checked: receipt_hash, by the pinned CLI, and each digest marked RECHECKED above, against the');
    L.push('  transcripts beside the receipt. The transcripts sit outside receipt_hash and this tree keeps no transcript');
    L.push('  hash, so a receipt and its transcripts edited together and then re-sealed would still verify.');
    return L.join('\n');
  }
  L.push('  generation_hash    NOT CHECKED. It digests the generation text, which the receipt does not carry.');
  L.push('  judge_sample_hashes  NOT CHECKED. They digest the judge sample texts, which the receipt does not carry.');
  if (c.recorded === 'hashes-only') {
    L.push('  This receipt records run.transcripts "hashes-only": its run kept the digests and not the texts behind them.');
  } else if (c.recorded === 'retained-local') {
    L.push('  This receipt records run.transcripts "retained-local": its run kept the texts in transcripts/<receipt_hash>/');
    L.push('  where it ran. Put that directory beside the receipt and both digests are rechecked.');
  } else {
    L.push('  This receipt does not record run.transcripts, so it does not say whether its run kept the texts.');
  }
  L.push('  No transcripts are retained beside this receipt, and this tree keeps no transcript hash, so a receipt');
  L.push('  handed over on its own cannot be bound to the evidence it summarises.');
  L.push('  What WAS checked: receipt_hash, by the pinned CLI. That is integrity since sealing, and nothing more:');
  L.push('  the same edit followed by a re-seal would verify.' + (c.recorded === 'retained-local' ? '' : ' Run with --keep-transcripts if you need the stronger claim.'));
  return L.join('\n');
}

function sha256Hex(text) { return crypto.createHash('sha256').update(text).digest('hex'); }
function refuseDigest(digest, t, why) {
  process.stderr.write(MARK + ' REFUSED: ' + digest + (/ and /.test(digest) ? ' do' : ' does') + ' not verify for case ' + t.id + ' (' + t.mode + '): ' + why + ' Nothing rendered.\n');
  process.exit(4);
}

// AN INDEX ENTRY NAMES A TRANSCRIPT INSIDE THE DIRECTORY, AND NOTHING ELSE (spec
// 032 AC-2, F-7 of specs/031-artefact-claims/evidence/approval-20260915T044957Z.md).
// This used to be path.join(useDir, entry), so `../../x.json` read a file beside
// the receipt, and a symbolic link inside the directory read whatever it pointed
// at, and the statement below still said RECHECKED "against the retained
// transcripts beside this receipt". An entry that is not a relative path, leaves
// the directory by name, names no file, or leaves it by its real path is refused
// before it is read, and what is read is the real path that was checked.
function refuseEntry(entry, why) {
  process.stderr.write(MARK + ' REFUSED: index.json entry ' + JSON.stringify(entry) + ' ' + why + '. Only transcripts inside the transcripts directory beside this receipt are read. Nothing rendered.\n');
  process.exit(4);
}
function confinedEntry(dir, realDir, entry) {
  if (typeof entry !== 'string' || entry === '' || path.isAbsolute(entry)) refuseEntry(entry, 'is not a relative path');
  const inside = (p, base) => p.startsWith(base + path.sep);
  const named = path.resolve(dir, entry);
  if (!inside(named, path.resolve(dir))) refuseEntry(entry, 'resolves outside the transcripts directory');
  let real;
  try { real = fs.realpathSync(named); } catch (e) { refuseEntry(entry, 'names no file in the transcripts directory'); }
  if (!inside(real, realDir)) refuseEntry(entry, 'resolves through a link to a file outside the transcripts directory');
  return real;
}

// AND SO DOES INDEX.JSON ITSELF (spec 032 A-032-2, F-3 of
// specs/032-judge-score-and-badge-confinement/evidence/approval-20260915T142902Z.md).
// Its entries were confined while it was still read by path.join, so a symbolic
// link named index.json read an index from anywhere, and commands/badge.md step 4
// says only files inside transcripts/<receipt_hash>/ are read. Its name is fixed,
// so only its real path can leave the directory; that is checked before it is
// read, and the real path checked is the one read.
function refuseIndex(why) {
  process.stderr.write(MARK + ' REFUSED: index.json ' + why + '. Only files inside the transcripts directory beside this receipt are read. Nothing rendered.\n');
  process.exit(4);
}
function confinedIndex(dir, realDir) {
  let real;
  try { real = fs.realpathSync(path.join(dir, 'index.json')); } catch (e) { refuseIndex('names no file in the transcripts directory'); }
  if (!real.startsWith(realDir + path.sep)) refuseIndex('resolves through a link to a file outside the transcripts directory');
  return real;
}

const tilde = (p) => (process.env.HOME && p.startsWith(process.env.HOME + path.sep) ? '~' + p.slice(process.env.HOME.length) : p);
function listTree(root) {
  const out = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else out.push(path.relative(root, p));
    }
  })(root);
  return out;
}
// Null when at most one candidate exists or both hold the same files with the same
// bytes; otherwise the first difference, in words.
function differingCandidates(a, b) {
  if (!fs.existsSync(a) || !fs.existsSync(b)) return null;
  const la = listTree(a); const lb = listTree(b);
  const onlyA = la.filter((f) => !lb.includes(f)); const onlyB = lb.filter((f) => !la.includes(f));
  if (onlyA.length || onlyB.length) return 'a file present in one and not the other: ' + (onlyA[0] || onlyB[0]);
  for (const f of la) {
    if (!fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f)))) return 'bytes differ in ' + f;
  }
  return null;
}

function recheckTranscripts(receiptPath) {
  const receipt = readJson(receiptPath);
  const recorded = receipt.run && typeof receipt.run.transcripts === 'string' ? receipt.run.transcripts : null;
  const dir = path.join(path.dirname(path.dirname(path.resolve(receiptPath))), 'transcripts', String(receipt.receipt_hash));
  const alt = path.join(path.dirname(path.resolve(receiptPath)), 'transcripts', String(receipt.receipt_hash));
  // ONE LOCATION, DETERMINISTIC, AND NO SILENT CHOICE BETWEEN TWO (spec 035 AC-8). The
  // transcripts for a receipt live under transcripts/<receipt_hash>/ beside the
  // receipts directory, else beside the receipt. When both exist and hold different
  // files or bytes, which one this read would have been a fact about directory order,
  // so the badge refuses and names both.
  const differing = differingCandidates(dir, alt);
  if (differing) {
    process.stderr.write(MARK + ' REFUSED: two transcript directories exist for this receipt and their contents differ (' + differing + '): '
      + tilde(dir) + ' and ' + tilde(alt) + '. Remove the one that is not this run\'s. Nothing rendered.\n');
    process.exit(4);
  }
  const useDir = fs.existsSync(dir) ? dir : (fs.existsSync(alt) ? alt : null);
  if (!useDir) return { found: false, recorded };
  const realDir = fs.realpathSync(useDir);
  const index = readJson(confinedIndex(useDir, realDir));
  const out = { found: true, recorded, generationCases: 0, judgeCases: 0, judgeTexts: 0, judgeUnchecked: 0 };
  const cases = (receipt.results && receipt.results.cases) || [];
  const matched = new Set();
  for (const entry of index.entries || []) {
    const t = readJson(confinedEntry(useDir, realDir, entry));
    const c = cases.find((x) => x.id === t.id && x.mode === t.mode);
    if (!c) continue;
    matched.add(c);
    // The retained generation is the generation TEXT, stored as a string
    // (lib/run.js writes String(gen.text)). generation_hash is sha256 over
    // exactly that string, so this is the same read, not a parallel one.
    if (c.generation_hash != null) {
      const text = typeof t.generation === 'string' ? t.generation : String((t.generation && t.generation.text) || '');
      if (c.generation_hash !== sha256Hex(text)) refuseDigest('generation_hash', t, 'the retained transcript beside this receipt is not the text the receipt digests.');
      out.generationCases += 1;
    }
    // The judge texts are the same writer's, beside the same receipt:
    // `judge_outputs[i]` is the raw sample text lib/judge.js digests into
    // `judge_sample_hashes[i]`, in the same order. A case with no hashes has
    // nothing to recheck: it is counted as not checked, and the statement says
    // so. Every other retained transcript is held to the receipt's count. A list
    // that is shorter, longer or EMPTY is a transcript that is not the one the
    // receipt digests, and is refused like a text that differs: emptying the list
    // must not turn a refusal into NOT CHECKED (F-4 of
    // specs/031-artefact-claims/evidence/approval-20260914T142509Z.md). Nor must
    // deleting the field: lib/judge.js derives the hashes from the same texts
    // lib/run.js keeps as `judge_outputs`, so a transcript this writer kept for a
    // case whose hashes are not empty always carries the field, and one without
    // it is refused the same way (F-2 of
    // specs/031-artefact-claims/evidence/approval-20260914T152257Z.md).
    const hashes = Array.isArray(c.judge_sample_hashes) ? c.judge_sample_hashes : null;
    if (!hashes) { out.judgeUnchecked += 1; continue; }
    const hasField = Object.prototype.hasOwnProperty.call(t, 'judge_outputs');
    if (!hasField && hashes.length) {
      refuseDigest('judge_sample_hashes', t, 'the retained transcript beside this receipt carries no judge_outputs field and the receipt digests ' + hashes.length + ' judge text(s).');
    }
    const texts = hasField && Array.isArray(t.judge_outputs) ? t.judge_outputs : [];
    if (texts.length !== hashes.length) {
      refuseDigest('judge_sample_hashes', t, 'the retained transcript beside this receipt carries ' + texts.length + ' judge text(s) and the receipt digests ' + hashes.length + '.');
    }
    if (!hashes.length) { out.judgeUnchecked += 1; continue; }
    texts.forEach((x, i) => {
      if (hashes[i] !== sha256Hex(String(x))) refuseDigest('judge_sample_hashes', t, 'retained judge text ' + (i + 1) + ' of ' + texts.length + ' beside this receipt is not the text the receipt digests.');
    });
    out.judgeCases += 1;
    out.judgeTexts += texts.length;
  }
  // EVERY CASE THAT CARRIES A DIGEST HAS A TRANSCRIPT (F-3 of
  // specs/031-artefact-claims/evidence/approval-20260915T032341Z.md). The loop
  // above reads the transcripts the index lists and skips one whose case the
  // receipt lacks, so taking an entry out of index.json, or changing its id,
  // left that receipt case unread, and the statement still said RECHECKED over
  // the cases that were. This writer keeps one transcript for every case it
  // measured, and only a measured case carries generation_hash or
  // judge_sample_hashes (lib/run.js), so beside retained transcripts such a case
  // with none matched to it is refused like a text that does not digest.
  for (const c of cases) {
    if (matched.has(c)) continue;
    const carries = [c.generation_hash != null ? 'generation_hash' : null, Array.isArray(c.judge_sample_hashes) ? 'judge_sample_hashes' : null].filter(Boolean);
    if (carries.length) refuseDigest(carries.join(' and '), c, 'the receipt carries ' + (carries.length > 1 ? 'these digests' : 'this digest') + ' for the case and no retained transcript beside this receipt is listed for it.');
  }
  return out;
}

// ── the guided first run (spec 139) ──────────────────────────────────────────
// `start` with no folder lists the skills under the working directory, each with
// whether it has test cases, and spawns nothing. Four levels down, past
// node_modules and dot folders, and at most fifty, so a large tree is not walked
// whole. Read only.
const LIST_DEPTH = 4;
const LIST_MAX = 50;
function listSkills() {
  const root = process.cwd();
  const found = [];
  let here = false;
  (function walk(d, depth) {
    if (found.length >= LIST_MAX) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
      // The working directory itself is not listed: start refuses to run from inside a skill
      // folder (outsideSkill), so the person is told to move up instead.
      if (depth === 0) here = true; else found.push(d);
    }
    if (depth >= LIST_DEPTH) return;
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!e.isDirectory() || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(path.join(d, e.name), depth + 1);
    }
  })(root, 0);
  if (here) say('this folder holds a SKILL.md, so it is a skill folder: run start from the folder above it, so the receipts and the page are not written into the skill.');
  if (!found.length) {
    say('no SKILL.md found under ' + root + ' (looked ' + LIST_DEPTH + ' folders down, past node_modules and dot folders).');
    return;
  }
  say('skills under ' + root + ':');
  for (const d of found) {
    const rel = path.relative(root, d) || '.';
    const has = fs.existsSync(path.join(d, 'evals', 'evals.json'));
    process.stdout.write('  ' + rel + '  (' + (has ? 'has test cases' : 'no test cases yet') + ')\n');
  }
}

// Where start writes its own outputs (spec 139, the pre-review's F-3). The run writes receipts/
// and the page into the working directory, and the draft is saved where the person works. From
// inside the skill folder all of them would land in it, become bundled skill content and move the
// skill's content hash for the next run. So start refuses when the working directory is the skill
// folder or inside it, and when the draft is inside it, before anything is spawned.
function outsideSkill() {
  const dir = state.resolvedTarget;
  const inside = (p) => p === dir || p.startsWith(dir + path.sep);
  if (inside(fs.realpathSync(process.cwd()))) {
    refuse('this folder is ' + (fs.realpathSync(process.cwd()) === dir ? 'the skill folder ' : 'inside the skill folder ') + dir + '. Run ' + command + ' from the folder above the skill,'
      + ' so the receipts and the page are not written into it. Nothing was spawned.');
  }
  if (INPUTS['cases'] === undefined) return;
  let draft = path.resolve(process.cwd(), INPUTS['cases']);
  try { draft = fs.realpathSync(draft); } catch (e) { /* validate has refused a draft that is not there */ }
  if (inside(draft)) {
    refuse('the draft ' + draft + ' is inside the skill folder ' + dir + ', and ' + command + ' adds no file there but the test cases.'
      + ' Move the draft to the folder you run ' + command + ' from and give that path. Nothing was spawned.');
  }
}

// The suite a start runs on, or the cases it will be written from: one of the
// two, never both, and never neither. Read before anything is spawned. When cases
// are to be written the folder must take them as one new file and nothing else
// (the operator's ruling on the guided run's write, spec 139 R-13): a skill that
// exists, with no suite of any kind (a link included), and an `evals` that is
// absent or a plain folder, so init adds evals/evals.json and touches no other file.
function requireSuite() {
  const dir = state.resolvedTarget;
  const suite = path.join(dir, 'evals', 'evals.json');
  let there = false;
  try { fs.lstatSync(suite); there = true; } catch (e) { there = false; }
  if (!there && INPUTS['cases'] === undefined) {
    refuse(dir + ' has no evals/evals.json yet, so there is nothing to run. Draft test cases with the person first,'
      + ' save them to a file outside the skill folder, and run ' + command + ' again with --cases <file>. Nothing was spawned.');
  }
  if (there && INPUTS['cases'] !== undefined) {
    refuse(dir + ' already has evals/evals.json, and init never writes over a suite, so --cases would be dropped.'
      + ' ' + (command === 'init' ? 'Run /driftproof:start ' + dir + ' to run the suite it has.' : 'Run ' + command + ' without --cases to run the suite it has.') + ' Nothing was spawned.');
  }
  if (INPUTS['cases'] === undefined) return;
  let evals = null;
  try { evals = fs.lstatSync(path.join(dir, 'evals')); } catch (e) { evals = null; }
  if (evals && !evals.isDirectory()) {
    refuse(dir + '/evals is not a plain folder (it is a link or a file), so ' + command + ' will not add test cases there. Nothing was spawned.');
  }
  let md = null;
  try { md = fs.lstatSync(path.join(dir, 'SKILL.md')); } catch (e) { md = null; }
  if (!md || !md.isFile()) {
    refuse(dir + ' has no SKILL.md that is a regular file, so there is no skill here to add test cases to, and ' + command + ' never creates one. Nothing was spawned.');
  }
}

// The person's yes (spec 139 R-13). start adds one new file to a skill folder only
// after the person has said yes in the run: the command's steps have the model show
// the path and the cases and ask, and give --confirm-write once they agree. No
// default, no other command takes it, and a script that gives no flag is refused.
function confirmWrite() {
  const cases = INPUTS['cases'] !== undefined;
  const yes = INPUTS['confirm-write'] === true;
  if (yes && !cases) {
    refuse('--confirm-write confirms writing a draft, and was given with no --cases, so there is nothing to confirm. Nothing was spawned.');
  }
  if (!cases) return;
  if (!yes) {
    refuse(command + ' would add evals/evals.json to ' + state.resolvedTarget + ' from ' + INPUTS['cases'] + ', as the one new file ' + path.join(state.resolvedTarget, 'evals', 'evals.json') + ', and adds a file to a skill folder only with the person\'s yes.'
      + ' Show the person the skill\'s folder, the file\'s path and the cases, and when they say yes run ' + command + ' again with --confirm-write. Nothing was written and nothing was spawned.');
  }
  say('adding one new file, ' + path.join(state.resolvedTarget, 'evals', 'evals.json') + ', from ' + path.resolve(process.cwd(), INPUTS['cases'])
    + ' (confirmed with --confirm-write). No other file in the folder is written.');
}

// The person's yes for init into a skill that exists (spec 140 R-1, the operator's three conditions
// on adding a file to a skill folder). init on a folder that holds a SKILL.md adds one new file,
// evals/evals.json, and only after the person has said yes: init.md has Claude show the path and
// ask, and give --confirm-write once they agree. No default, and a script that gives no flag is
// refused. A folder with no SKILL.md is a scaffold of a new skill, as it was, and has nothing to
// confirm: the flag there is refused, so it never reads as a yes to something else.
function confirmAdd() {
  const dir = state.resolvedTarget;
  const yes = INPUTS['confirm-write'] === true;
  let md = null;
  try { md = fs.lstatSync(path.join(dir, 'SKILL.md')); } catch (e) { md = null; }
  if (!md) {
    if (yes) refuse('--confirm-write confirms adding test cases to a skill that exists, and ' + dir + ' holds no SKILL.md, so there is nothing to confirm. Nothing was spawned.');
    return;
  }
  if (!yes) refuse('init would put evals/evals.json into the skill at ' + dir + ', as the one new file ' + path.join(dir, 'evals', 'evals.json') + ', and adds a file to a skill folder only with the person\'s yes.'
    + ' Show the person the skill\'s folder, the file\'s path and the cases it will hold, and when they say yes run init again with --confirm-write. Nothing was written and nothing was spawned.');
  state.adding = true;
  let there = false;
  try { fs.lstatSync(path.join(dir, 'evals', 'evals.json')); there = true; } catch (e) { there = false; }
  state.hadSuite = there;
  // Said before the CLI runs, so it is the intent and nothing more: reportAdd says what happened.
  if (there) say(dir + ' already has evals/evals.json; init will add nothing and leave it, SKILL.md and every other file as they are.');
  else say('will add one new file, ' + path.join(dir, 'evals', 'evals.json') + ', if none is there, only because you said yes (--confirm-write). SKILL.md and every other file in the folder are left as they are.');
}
// What the CLI did, read from the folder after it ran: one new file, or nothing (the file was there, or
// something stands in its way, as a link where the evals folder would be, which the CLI will not write
// through). Said by lstat and not assumed, so the door never reports an addition that did not happen.
function reportAdd() {
  if (!state.adding) return;
  const file = path.join(state.resolvedTarget, 'evals', 'evals.json');
  let now = false;
  try { fs.lstatSync(file); now = true; } catch (e) { now = false; }
  if (now && !state.hadSuite) say('added one new file, ' + file + ', because you said yes (--confirm-write). SKILL.md and every other file are as they were.');
  else say('nothing was added: ' + (state.hadSuite ? file + ' was already there' : 'the CLI found nothing it could create at ' + file + ' (something stands in its way, such as a link where the evals folder would be)') + '. SKILL.md and every other file are as they were.');
}

// SPEC 165: init on a skill that exists leads into the guided first run. The folder holds a SKILL.md and
// the call carries a draft (--cases): it is the run `start` makes, so the rest of init's steps are
// replaced with start's (its listing left out, since the folder is named). A call with no draft is
// not taken, whether or not the skill has a suite: with no --confirm-write it is refused (DR-62, as at
// the Base, a skill that has a suite included). The placeholder route is --confirm-write alone, and a
// folder with no SKILL.md is a scaffold; neither takes a draft or a model, and they are refused here
// when given one, never dropped. This writes nothing: the one new file is the CLI's, after --confirm-write.
function guidedExisting(steps, at) {
  const given = INPUTS['skill-dir'];
  if (given === undefined) return;
  const dir = path.resolve(process.cwd(), given);
  const lacks = (rel) => { try { fs.lstatSync(path.join(dir, rel)); return false; } catch (e) { return true; } };
  const isSkill = !lacks('SKILL.md');
  const drafted = INPUTS['cases'] !== undefined;
  const guided = isSkill && drafted;
  if (!guided && (drafted || INPUTS['models'] !== undefined)) {
    refuse('--cases and --models are for the guided first run, which takes a skill that exists: ' + dir
      + (isSkill ? ' holds a SKILL.md, but --confirm-write alone is the placeholder route, which takes neither.' : ' holds no SKILL.md, so ' + command + ' scaffolds a new skill there and takes neither.')
      + ' Give --cases and --confirm-write only for a folder that holds a SKILL.md, or leave both out. Nothing was spawned.');
  }
  if (!guided) return;
  const lead = stepsFor('start').filter((x) => x.op !== 'list-skills');
  steps.splice(at + 1, steps.length, ...lead);
  say(command + ' on a skill that exists leads into the guided first run: it takes the steps of start (the approved draft, then the quick run and the results page).');
}

// SPEC 165: run on a skill that holds a SKILL.md and no suite says it can draft one, before the runner
// is spawned, and then goes on: the runner ends with its own message, as it did, and the folder is as
// it was. This line is all it writes. The draft is the guided run's, taken only after the person's yes.
function offerDraft() {
  const dir = state.resolvedTarget;
  let md = null;
  try { md = fs.lstatSync(path.join(dir, 'SKILL.md')); } catch (e) { md = null; }
  if (!md) return;
  let suite = false;
  try { fs.lstatSync(path.join(dir, 'evals', 'evals.json')); suite = true; } catch (e) { suite = false; }
  if (suite) return;
  say(dir + ' has no test cases yet (no evals/evals.json), so the runner has nothing to measure. Offer the person a draft:'
    + ' /driftproof:start ' + dir + ' drafts test cases from the skill with them, adds evals/evals.json only after their yes, and runs a quick check.'
    + ' Nothing is written by run. If they decline, the runner ends with its own message below.');
}

// The page the CLI wrote, opened from disk with the platform's opener, given its
// absolute path and nothing else. The page loads nothing (spec 128). With no
// opener, or one that fails, the path is printed to open by hand.
function openView(file) {
  const abs = path.resolve(process.cwd(), file);
  say('the results page is ' + abs + ' (file://' + abs + '); it opens from disk and loads nothing.');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? null : 'xdg-open';
  if (!opener) { say('open that file in a browser.'); return; }
  const r = spawnSync(opener, [abs], { stdio: 'ignore', shell: false, timeout: 15000 });
  if (r.error || r.status !== 0) say('could not open it with ' + opener + '; open that file in a browser.');
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
//
// Spec 138: run passes --samples, --concurrency and --max-cases through, each checked
// by the contract. Spec 139: run takes --quick, and start takes a model and the drafted
// cases. Spec 140: run takes --trust-outside-repo and init takes --confirm-write. Spec 165: init takes
// the draft and a model too, for the guided run it leads a skill that exists into, and refuses them elsewhere. A flag in
// NO_VALUE is set by its name alone, as the CLI's are.
const ACCEPTS = {
  init: ['confirm-write', 'cases', 'models'],
  run: ['models', 'max-calls', 'max-usd', 'samples', 'concurrency', 'max-cases', 'quick', 'trust-outside-repo'],
  badge: [],
  start: ['models', 'cases', 'confirm-write'],
};
const NO_VALUE = new Set(['quick', 'confirm-write', 'trust-outside-repo']);
const QUICK_SETS = ['samples', 'concurrency', 'max-cases'];
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
      if (NO_VALUE.has(name)) { INPUTS[name] = true; continue; }
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
  // Spec 138: one folder (or receipt), never two. A second positional used to be
  // dropped: the door read the first and ran on it, saying nothing of the rest.
  if (positional.length > 1) {
    refuse(command + ' takes one ' + (command === 'badge' ? 'receipt' : 'folder') + ' and was given ' + positional.length + ': '
      + positional.map((p) => JSON.stringify(p)).join(', ') + '.'
      + (ACCEPTS[command].some((f) => NO_VALUE.has(f)) ? ' A flag that takes no value is given alone.' : '') + ' Nothing was spawned.');
  }
  // Spec 139 (R-2): --quick sets the three itself, as the CLI does; refused here first.
  const clash = INPUTS['quick'] === true ? QUICK_SETS.filter((k) => INPUTS[k] !== undefined) : [];
  if (clash.length) {
    refuse('--quick sets ' + clash.map((k) => '--' + k).join(', ') + ' itself, and was given ' + (clash.length === 1 ? 'it' : 'them')
      + ' too. Give --quick alone, or leave it out and set them. Nothing was spawned.');
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
  if (key === 'cases' && typeof INPUTS['cases'] === 'string') return path.resolve(process.cwd(), INPUTS['cases']);
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
const state = { resolvedTarget: null, defaultModel: null, rendered: null, outsideRepo: false, adding: false, hadSuite: false };

for (let at = 0; at < steps.length; at++) {
  const step = steps[at];
  // Spec 139: `start` with no folder lists the skills and stops there. Given a flag and no folder,
  // it refuses, naming the flag: a flag is refused, never dropped (DR-41's rule for a word).
  if (step.op === 'list-skills') {
    if (INPUTS['skill-dir'] !== undefined) continue;
    const given = Object.keys(INPUTS).filter((k) => INPUTS[k] !== undefined);
    if (given.length) refuse(command + ' was given ' + given.map((k) => '--' + k).join(', ') + ' and no skill folder, and lists the skills only when given nothing. Name the folder first (' + command + ' <dir> ...), or give ' + command + ' alone to list the skills. Nothing was spawned.');
    listSkills();
    process.exit(0);
  }
  if (step.op === 'guided-existing') { guidedExisting(steps, at); continue; }
  if (step.op === 'offer-draft') { offerDraft(); continue; }
  if (step.op === 'outside-skill') { outsideSkill(); continue; }
  if (step.op === 'require-suite') { requireSuite(); continue; }
  if (step.op === 'confirm-write') { confirmWrite(); continue; }
  if (step.op === 'confirm-add') { confirmAdd(); continue; }
  if (step.op === 'report-add') { reportAdd(); continue; }
  if (step.op === 'open-view') { openView(step.file); continue; }
  if (step.op === 'validate') { validateInputs(step.inputs, step); continue; }
  if (step.op === 'resolve-target') {
    const given = INPUTS[step.input];
    if (given === undefined) refuse(step.input + ': expected a value');
    state.resolvedTarget = step.inside_repo ? requireInsideRepo(given, command) : path.resolve(process.cwd(), given);
    say('resolved ' + step.input + '=' + state.resolvedTarget);
    continue;
  }
  if (step.op === 'state-trusted') {
    if (state.outsideRepo) {
      say('treating this skill as the author\'s own, because you confirmed it with --trust-outside-repo where there is no git repository.'
        + ' That is why the run passes --trusted-skill: it runs as you, in ' + process.cwd() + ', with your files and your Claude Code login, and no isolation hop.');
    } else {
      say('treating this skill as the author\'s own, because it resolves inside this repository.'
        + ' That is why the run passes --trusted-skill: it runs as you, in your checkout, with no isolation hop.');
    }
    continue;
  }
  if (step.op === 'version-guard') { versionGuard(step); continue; }
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
    // Spec 139: a step guarded by an input runs only when that input was given.
    if (step.when && INPUTS[step.when] === undefined) continue;
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
        // Spec 035 AC-9: the UNDERPOWERED state in words, when the runner's badge carries it; the cases
        // line where its word is the cases word (A-035-9).
        if (/"message":\s*"not enough draws on /.test(r.out)) say(UNDERPOWERED_LINE + '.');
        else if (new RegExp('"message":\\s*"' + CASES_WORD + ' on ').test(r.out)) say(CASES_LINE + '.');
      } else if (r.out) process.stdout.write(r.out);
    } else if (r.code !== 0) process.exit(r.code);
    continue;
  }
  if (step.op === 'recheck-transcripts') { state.checked = recheckTranscripts(state.resolvedTarget); continue; }
  if (step.op === 'readme-snippet') { process.stdout.write(readmeSnippetFrom(state.rendered)); continue; }
  if (step.op === 'not-checked') { process.stdout.write(notCheckedStatement(state.checked) + '\n'); continue; }
  if (step.op === 'say') { if (!(step.only_new && state.adding)) say(step.text); continue; }
  process.stderr.write(MARK + ' unknown step op ' + JSON.stringify(step.op) + '\n');
  process.exit(2);
}
