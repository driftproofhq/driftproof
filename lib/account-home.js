// SPDX-License-Identifier: Apache-2.0
'use strict';
// The running account's own home directory, as text a receipt or a diagnostic must not carry (issue
// 637). The usual readings find a home by its root (/home, /Users, /root). A service account's home
// has none of them: the runner account's is under /var/lib. This reads the home itself, from
// os.homedir() and HOME, wherever it sits.
const os = require('node:os');
const path = require('node:path');

// os.homedir() throws where HOME is unset and the uid has no passwd entry; HOME alone is read then.
const osHome = () => { try { return os.homedir(); } catch { return null; } };
function accountHomes() {
  const homes = [osHome(), process.env.HOME]
    .filter((h) => typeof h === 'string' && path.isAbsolute(h))
    .map((h) => h.replace(/[\\/]+$/, ''))
    .filter((h) => h.length > 1);
  return [...new Set(homes)].sort((a, b) => b.length - a.length);
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A home is read as a path: followed by a slash, a backslash, a quote, a space or the end.
const homePattern = (h) => new RegExp(`${escapeRe(h)}(?=[\\\\/"'\\s]|$)`);

// `text` is JSON (a receipt), so the home is matched as JSON writes it.
const namesAccountHome = (text) => accountHomes().some((h) => homePattern(JSON.stringify(h).slice(1, -1)).test(String(text)));

module.exports = { accountHomes, namesAccountHome };
