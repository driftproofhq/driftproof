// SPDX-License-Identifier: Apache-2.0
//
// The copy button. One behaviour, no dependency, and nothing to mount: any
// element carrying data-copy copies that attribute's text.
//
// The command is IN THE MARKUP, not in this file, so a reader with JavaScript
// off still sees the exact string they need to type.
document.addEventListener('click', (ev) => {
  const btn = ev.target.closest('[data-copy]');
  if (!btn) return;
  const text = btn.dataset.copy;
  const done = () => {
    const was = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = was; }, 1400);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => {});
  }
});
