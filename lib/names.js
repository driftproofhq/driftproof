// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 438 (AC-16): a file name or a path a reader is given, escaped for where it is shown. A context
// file's name is its base name, kept as it is in the receipt, so it can hold anything a file name can:
// a line break, a backtick, an escape sequence, a right-to-left override, a shell command. None of it
// may reach a summary, a terminal or a command as anything but the name.

// The characters made visible first, as \u{hex}: the controls, the line and paragraph separators, and
// (A-438-17) every Default_Ignorable_Code_Point, such as bidirectional marks, tag characters and
// zero-width characters. Written as properties and escapes, so the source holds none of them.
// A-438-18: an emoji a person can see stays whole. The first group is one: the flags of England, Scotland
// and Wales, a keycap, or pictographs with a selector or skin tone, joined by U+200D. Only those keep one of
// these characters. plugin/driftproof/lib/door.mjs and docs/islands/drop-results.js hold this same line.
const HIDDEN = /(\u{1F3F4}\u{E0067}\u{E0062}(?:\u{E0065}\u{E006E}\u{E0067}|\u{E0073}\u{E0063}\u{E0074}|\u{E0077}\u{E006C}\u{E0073})\u{E007F}|[0-9#*]\u{FE0F}\u{20E3}|\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}\p{Emoji_Modifier}]?(?:\u{200D}\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}\p{Emoji_Modifier}]?)*)|\p{Cc}|\p{Zl}|\p{Zp}|\p{Default_Ignorable_Code_Point}/gu;
const eachHidden = (s, change) => s.replace(HIDDEN, (m, emoji) => (emoji === undefined ? change(m) : m));
const invisibleShown = (s) => eachHidden(String(s), (c) => `\\u{${c.codePointAt(0).toString(16)}}`);

// A terminal: the backslash and the double quote escaped, so the name reads back between quotes, then
// the invisible made visible.
const termText = (s) => invisibleShown(String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'));

// Markdown: spec 144's escape (lib/decision.js markdownText) over the visible form. Required here, not at
// the top, as lib/decision.js requires lib/run.js through lib/verdict.js.
const mdText = (s) => require('./decision').markdownText(invisibleShown(s));

// A command a reader is told to run, one argument: bare when it holds only characters a shell takes as
// themselves, in single quotes when it holds no invisible character, else in bash's $'...' form with
// each byte of an invisible character written as \xHH, so the line holds none of them and bash gives
// back the path's exact bytes.
const BARE = /^[A-Za-z0-9_/.,:@%+=-]+$/;
function shellArg(s) {
  const str = String(s);
  if (BARE.test(str)) return str;
  if (eachHidden(str, () => '') === str) return `'${str.replace(/'/g, "'\\''")}'`;
  const bytes = (c) => [...Buffer.from(c, 'utf8')].map((b) => `\\x${b.toString(16).padStart(2, '0')}`).join('');
  return `$'${eachHidden(str.replace(/[\\']/g, '\\$&'), bytes)}'`;
}

module.exports = { invisibleShown, termText, mdText, shellArg };
