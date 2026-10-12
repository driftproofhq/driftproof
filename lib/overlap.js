// SPDX-License-Identifier: Apache-2.0
'use strict';

const { loadSkill, pastBound } = require('./skill');
const OVERLAP_MAX_BUNDLE_WORDS = 250000;
const OVERLAP_MAX_PROMPT_WORDS = 1000000;

// Track original source lines before normalizing each maximal Unicode word.
// Buffer UTF-8 decoding uses replacement; a BOM is outside the word alphabet.
function words(text, limit, bound, offset = 0) {
  const out = []; let line = 1, cursor = 0;
  for (const m of text.matchAll(/[\p{L}\p{M}\p{Nd}]+/gu)) {
    for (let i = cursor; i < m.index; i++) {
      if (text[i] === '\r') { line++; if (text[i + 1] === '\n') i++; }
      else if (text[i] === '\n') line++;
    }
    if (out.length >= limit) throw pastBound(bound, limit + offset, out.length + 1 + offset, 'comparison words');
    out.push({ word: m[0].normalize('NFC').toLowerCase(), line });
    cursor = m.index + m[0].length;
  }
  return out;
}

// A suffix automaton over the byte-sorted file sequence. Unique separator
// symbols prevent matches crossing files. Each state records the earliest end
// position of all its occurrences, so equal matches choose the first file and
// first word. Suffix-link propagation uses counting order, not a quadratic scan.
function suffixIndex(tokens) {
  const states = [{ len: 0, link: -1, next: new Map(), end: Infinity }];
  let last = 0;
  for (let at = 0; at < tokens.length; at++) {
    const word = tokens[at].word;
    const cur = states.length;
    states.push({ len: states[last].len + 1, link: 0, next: new Map(), end: at });
    let p = last;
    while (p >= 0 && !states[p].next.has(word)) { states[p].next.set(word, cur); p = states[p].link; }
    if (p >= 0) {
      const q = states[p].next.get(word);
      if (states[p].len + 1 === states[q].len) states[cur].link = q;
      else {
        const clone = states.length;
        states.push({ len: states[p].len + 1, link: states[q].link, next: new Map(states[q].next), end: Infinity });
        while (p >= 0 && states[p].next.get(word) === q) { states[p].next.set(word, clone); p = states[p].link; }
        states[q].link = states[cur].link = clone;
      }
    }
    last = cur;
  }
  const count = new Uint32Array(tokens.length + 1);
  for (const s of states) count[s.len]++;
  for (let i = 1; i < count.length; i++) count[i] += count[i - 1];
  const order = new Uint32Array(states.length);
  for (let i = 0; i < states.length; i++) order[--count[states[i].len]] = i;
  for (let i = order.length - 1; i > 0; i--) {
    const s = states[order[i]], parent = states[s.link];
    parent.end = Math.min(parent.end, s.end);
  }
  return states;
}

function compare(prompt, tokens, states, id) {
  let state = 0, length = 0, best = 0, bestAt = Infinity, bestPrompt = Infinity;
  for (let i = 0; i < prompt.length; i++) {
    const word = prompt[i].word;
    while (state && !states[state].next.has(word)) { state = states[state].link; length = states[state].len; }
    const next = states[state].next.get(word);
    if (next === undefined) { state = 0; length = 0; continue; }
    state = next; length++;
    const at = states[state].end - length + 1, start = i - length + 1;
    if (length > best || (length === best && (at < bestAt || (at === bestAt && start < bestPrompt)))) {
      best = length; bestAt = at; bestPrompt = start;
    }
  }
  return {
    id, prompt_words: prompt.length, longest_words: best,
    match: best ? { file: tokens[bestAt].file, line: tokens[bestAt].line, prompt_start: bestPrompt, words: prompt.slice(bestPrompt, bestPrompt + best).map(t => t.word) } : null,
  };
}

function overlapSkill(skillDir) {
  const skill = loadSkill(skillDir, { includeFiles: true });
  const files = skill.files.map(f => ({ ...f, path: f.path.split(require('node:path').sep).join('/') }))
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const tokens = []; let bundleWords = 0;
  for (const f of files) {
    const list = words(f.bytes.toString('utf8'), OVERLAP_MAX_BUNDLE_WORDS - bundleWords, 'OVERLAP_MAX_BUNDLE_WORDS', bundleWords);
    bundleWords += list.length;
    for (const t of list) tokens.push({ ...t, file: f.path });
    tokens.push({ word: Symbol(f.path) });
  }
  let promptWords = 0;
  // Count first, so neither door can start matching an over-bound suite.
  // Tokenize one prompt at a time after that check, retaining no suite-sized token array.
  for (const c of skill.suite.cases) {
    for (const _word of c.prompt.matchAll(/[\p{L}\p{M}\p{Nd}]+/gu)) {
      if (++promptWords > OVERLAP_MAX_PROMPT_WORDS) throw pastBound('OVERLAP_MAX_PROMPT_WORDS', OVERLAP_MAX_PROMPT_WORDS, promptWords, 'comparison words');
    }
  }
  const states = suffixIndex(tokens);
  return { skill: skill.name, cases: skill.suite.cases.map(c => compare(words(c.prompt, OVERLAP_MAX_PROMPT_WORDS, 'OVERLAP_MAX_PROMPT_WORDS'), tokens, states, c.id)) };
}

module.exports = { overlapSkill };
