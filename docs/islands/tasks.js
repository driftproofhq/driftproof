// SPDX-License-Identifier: Apache-2.0
// Clipboard only. No network, storage, analytics events or copy counters.
export function mount(root) {
  const status = root.querySelector('[role="status"]');
  for (const button of root.querySelectorAll('[data-copy]')) {
    button.hidden = false;
    button.addEventListener('click', async (event) => {
      // The site's document listener copies data-copy literally. This island
      // owns these buttons and copies the source element's exact text instead.
      event.stopPropagation();
      const text = button.closest('.task').querySelector('[data-copy-source="' + button.dataset.copy + '"]').textContent;
      try {
        await navigator.clipboard.writeText(text);
        status.textContent = button.dataset.copy === 'prompt' ? 'Copied the exact prompt.' : 'Copied the exact scoring guide.';
      } catch {
        status.textContent = 'Copy is unavailable. You can select the text above and copy it yourself.';
      }
    });
  }
}
