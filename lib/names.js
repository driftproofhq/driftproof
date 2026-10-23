// SPDX-License-Identifier: Apache-2.0
'use strict';

// Spec 438 (AC-16): a file name or a path a reader is given, escaped for where it is shown. A context
// file's name is its base name, kept as it is in the receipt, so it can hold anything a file name can:
// a line break, a backtick, an escape sequence, a right-to-left override, a shell command. None of it
// may reach a summary, a terminal or a command as anything but the name.

// The characters made visible first, as \u{hex}: the C0 and C1 controls and DEL, the line and
// paragraph separators, and the bidirectional controls. Held as code point ranges, not a pattern, so
// the source holds none of them.
const INVISIBLE = [[0x00, 0x1f], [0x7f, 0x9f], [0x200e, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069]];
const invisible = (cp) => INVISIBLE.some(([a, b]) => cp >= a && cp <= b);
function invisibleShown(s) {
  let out = '';
  for (const c of String(s)) { const cp = c.codePointAt(0); out += invisible(cp) ? `\\u{${cp.toString(16)}}` : c; }
  return out;
}

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
  if (![...str].some((c) => invisible(c.codePointAt(0)))) return `'${str.replace(/'/g, "'\\''")}'`;
  let out = '';
  for (const c of str) {
    if (c === '\\' || c === "'") out += `\\${c}`;
    else if (invisible(c.codePointAt(0))) for (const b of Buffer.from(c, 'utf8')) out += `\\x${b.toString(16).padStart(2, '0')}`;
    else out += c;
  }
  return `$'${out}'`;
}

module.exports = { invisibleShown, termText, mdText, shellArg };
