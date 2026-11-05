// SPDX-License-Identifier: Apache-2.0
// Issue 694: only the builder's fixed text leaves through the user's browser APIs.
export function mount(el) {
  const text = el.dataset.shareText;
  const title = el.dataset.shareTitle;
  const send = el.querySelector('[data-send]');
  const copy = el.querySelector('[data-copy]');
  const details = el.querySelector('details');
  const status = el.querySelector('[data-status]');
  const image = el.querySelector('[data-share-image]');
  let manual;
  const preview = () => { details.open = true; copy.focus(); };
  send.hidden = false;
  copy.hidden = false;
  send.addEventListener('click', async () => {
    if (typeof navigator.share !== 'function') { preview(); return; }
    try { await navigator.share({ title, text }); }
    catch (error) {
      preview();
      status.textContent = error.name === 'AbortError' ? 'Share cancelled. You can still copy the whole message.' : 'Sharing is unavailable. Copy the whole message below.';
    }
  });
  copy.addEventListener('click', async event => {
    // The site's generic data-copy handler must not overwrite this fixed payload.
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = 'Copied with the caveats and receipt link.';
      if (manual) manual.hidden = true;
    } catch {
      if (!manual) {
        manual = document.createElement('textarea');
        manual.readOnly = true;
        manual.setAttribute('aria-label', 'Complete message to copy');
        manual.value = text;
        status.before(manual);
      }
      manual.hidden = false;
      manual.focus(); manual.select();
      status.textContent = 'Select and copy this complete message using your browser.';
    }
  });
  el.addEventListener('keydown', event => {
    if (event.key === 'Escape' && details.open) { details.open = false; send.focus(); }
  });
  if (image && typeof navigator.share === 'function' && typeof navigator.canShare === 'function') {
    image.hidden = false;
    image.addEventListener('click', async () => {
      image.disabled = true;
      try {
        const url = new URL(el.dataset.shareCard);
        if (url.origin !== 'https://driftproofhq.com' || !url.pathname.startsWith('/cards/')) throw Error('card');
        const response = await fetch(url.pathname, { credentials: 'omit' });
        if (!response.ok) throw Error('card');
        const file = new File([await response.blob()], url.pathname.split('/').pop(), { type: 'image/png' });
        const payload = { title, text, files: [file] };
        if (!navigator.canShare(payload)) throw Error('unsupported');
        await navigator.share(payload);
      } catch (error) {
        status.textContent = error.name === 'AbortError' ? 'Share cancelled. The complete message is still here.' : 'Image sharing is unavailable. Copy the message and view the card image.';
      } finally { image.disabled = false; }
    });
  }
}
