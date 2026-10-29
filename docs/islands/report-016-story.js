// SPDX-License-Identifier: Apache-2.0
export function mount(el) {
  const preference = matchMedia('(prefers-reduced-motion: no-preference)');
  const fig = el.querySelector('.morph');
  const file = fig.querySelector('.m-file').textContent;
  const fake = fig.querySelector('.m-placebo').textContent;
  if (file.length !== fake.length || /[^\x00-\x7f]/.test(file + fake)) return;
  const live = fig.querySelector('.morph-live'), out = live.querySelector('.m-live');
  const range = live.querySelector('input'), count = live.querySelector('.m-count');
  let raf = 0, timer = 0, touched = false;
  const draw = k => {
    out.replaceChildren();
    for (const [text, name] of [[fake.slice(0,k),'p'],[file.slice(k),'f']]) {
      const span = document.createElement('span'); span.className = name;
      span.textContent = text; out.append(span);
    }
    range.value = k; count.textContent = k+' bytes swapped. Still '+file.length+' bytes.';
  };
  const stop = () => { clearTimeout(timer); cancelAnimationFrame(raf); };
  range.addEventListener('input', () => { touched = true; stop(); draw(+range.value); });
  live.hidden = false; draw(0); el.classList.add('js');
  if (preference.matches) timer = setTimeout(() => {
    if (touched || !preference.matches) return;
    const start = performance.now();
    const frame = now => {
      if (!preference.matches) return;
      const p = Math.min(1,(now-start)/4200);
      draw(Math.round(p*file.length));
      if (p < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  },1400);
  const targets = el.querySelectorAll('.tok-chart, .wall, .pairs');
  if ('IntersectionObserver' in window && preference.matches) {
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
    }),{threshold:0.1});
    targets.forEach(t => io.observe(t));
    preference.addEventListener('change', () => { stop(); io.disconnect(); targets.forEach(t=>t.classList.add('is-in')); });
  } else targets.forEach(t=>t.classList.add('is-in'));
}
