// SPDX-License-Identifier: Apache-2.0
import { createPlaceboCore, assertInputLength, PLACEBO_REVISION, PLACEBO_CORPUS_HASHES } from '../import-core/placebo.mjs';

const encode = text => new TextEncoder().encode(text);
const digestBytes = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const refuse = (code, message) => Object.assign(new Error(message), { code });

export async function buildFake(bytes, mode, digest = digestBytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Choose UTF-8 file bytes.');
  if (!['context', 'skill'].includes(mode)) throw new Error('Choose a seed mode.');
  assertInputLength(bytes.byteLength);
  let original;
  try { original = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw refuse('SUBJECT_ENCODING', 'This file is not UTF-8, so its text cannot be sent as its bytes.'); }
  if (original.includes('\0')) throw refuse('SUBJECT_NUL', 'This file holds a NUL character, which no argument vector can carry.');
  if (mode === 'context' && !/(?!\p{Default_Ignorable_Code_Point})[\p{L}\p{N}]/u.test(original)) {
    throw refuse('SUBJECT_EMPTY', 'This file holds no letter or digit, so it would measure nothing.');
  }
  const fileHash = hex(await digest(bytes));
  // lib/canonical.js sha256Files, for exactly one SKILL.md entry.
  const seed = mode === 'skill' ? hex(await digest(encode('SKILL.md\0' + fileHash + '\n'))) : fileHash;
  const text = await createPlaceboCore(digest).buildPlaceboTextAsync(bytes.byteLength, seed);
  return { original, text, bytes: encode(text).byteLength, sha256: hex(await digest(encode(text))),
    seed, revision: PLACEBO_REVISION, corpusHash: PLACEBO_CORPUS_HASHES[PLACEBO_REVISION] };
}

const node = (tag, text) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; return el; };
const marked = (tag, key, text) => { const el = node(tag, text); el.setAttribute('data-placebo-' + key, ''); return el; };
const commands = {
  context: 'npx driftproof run <path> --suite tasks.json --placebo',
  skill: 'npx driftproof run <skill-directory> --placebo',
};

export function mount(el) {
  const modeLabel = node('label', 'What is your text?');
  const mode = marked('select', 'mode');
  for (const [value, text] of [['context', 'A CLAUDE.md, AGENTS.md or custom instructions'], ['skill', 'A skill (SKILL.md only)']]) {
    const option = node('option', text); option.value = value; mode.append(option);
  }
  modeLabel.append(mode);
  const pickLabel = node('label', 'Choose a Markdown file');
  const input = marked('input', 'input'); input.type = 'file'; input.accept = '.md,.markdown'; pickLabel.append(input);
  const drop = marked('div', 'drop', 'Drop your file here, or choose it above.'); drop.className = 'drop-results-zone';
  const textLabel = node('label', 'Or paste your file');
  const text = marked('textarea', 'text'); text.rows = 8; text.spellcheck = false; textLabel.append(text);
  const button = marked('button', 'build', 'See its fake'); button.type = 'button';
  const output = marked('section', 'output'); output.setAttribute('aria-live', 'polite');
  el.replaceChildren(modeLabel, pickLabel, drop, textLabel, button, output);
  let version = 0, fileBytes = null;
  function invalidate() { version++; output.replaceChildren(); }
  function show(result, selected) {
    const comparison = node('div'); comparison.className = 'placebo-comparison';
    for (const [title, key, value] of [['Your file', 'original', result.original], ['Its fake', 'fake', result.text]]) {
      const panel = node('section'); panel.append(node('h2', title), marked('pre', key, value)); comparison.append(panel);
    }
    const metadata = node('dl');
    for (const [label, key, value] of [['Bytes in each file', 'bytes', result.bytes], ['Placebo SHA-256', 'hash', result.sha256], ['Corpus hash', 'corpus', result.corpusHash], ['Seed', 'seed', result.seed]]) {
      metadata.append(node('dt', label), marked('dd', key, String(value)));
    }
    const command = node('pre'); command.append(marked('code', 'command', commands[selected]));
    output.replaceChildren(node('p', selected === 'skill' ? 'Read as: A skill (SKILL.md only).' : 'Read as: A CLAUDE.md, AGENTS.md or custom instructions.'), comparison, metadata,
      node('p', 'To measure it, replace the path below. Context files need your task suite; skills need their evals directory. A measurement run can call a model and incur costs.'), command);
  }
  async function build() {
    const own = ++version, selected = mode.value;
    output.replaceChildren(node('p', 'Building locally…'));
    try {
      const result = await buildFake(fileBytes || encode(text.value), selected);
      if (own === version) show(result, selected);
    } catch (error) { if (own === version) output.replaceChildren(node('p', error.message)); }
  }
  async function choose(files) {
    invalidate(); fileBytes = null; text.value = '';
    const own = version;
    try {
      if (files.length !== 1) throw new Error('Choose one Markdown file.');
      assertInputLength(files[0].size);
      const bytes = new Uint8Array(await files[0].arrayBuffer());
      if (own !== version) return;
      // The textarea normalizes CRLF. Preserve the original bytes until an input event.
      fileBytes = bytes;
      text.value = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
      await build();
    } catch (error) { if (own === version) output.replaceChildren(node('p', error.message)); }
  }
  text.addEventListener('input', () => { fileBytes = null; input.value = ''; invalidate(); });
  mode.addEventListener('change', invalidate);
  input.addEventListener('change', () => choose([...input.files]));
  button.addEventListener('click', build);
  drop.addEventListener('dragover', event => event.preventDefault());
  drop.addEventListener('drop', event => { event.preventDefault(); choose([...event.dataTransfer.files]); });
  el.addEventListener('dragover', event => event.preventDefault());
  el.addEventListener('drop', event => event.preventDefault());
}
