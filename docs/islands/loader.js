// SPDX-License-Identifier: Apache-2.0
//
// The island loader. Under 40 lines by rule, and it does one thing: mount a
// vanilla ES module for every element carrying data-island.
//
// WHY A LOADER AND NOT A BUNDLER. Every page on this site is static HTML served
// from a CDN, and the whole runtime dependency set of this project is one JSON
// schema validator. A bundler would be the largest thing in the repository and
// would exist to solve a problem this site does not have.
//
// EVERY ISLAND HAS A STATIC FALLBACK, and this loader is why that rule is
// affordable: the page is complete before this file runs, so a failed import, a
// blocked script or JavaScript turned off leaves a page that still reads.
const pending = new Map();

for (const el of document.querySelectorAll('[data-island]')) {
  const name = el.dataset.island;
  // A name is a filename. Anything that is not a plain slug is ignored rather
  // than interpolated into an import path.
  if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
  if (!pending.has(name)) pending.set(name, import(`/islands/${name}.js`));
  pending.get(name)
    .then((mod) => { if (typeof mod.mount === 'function') mod.mount(el); })
    .catch(() => { /* the static fallback is already on the page */ });
}
