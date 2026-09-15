#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
//
// scripts/render-check.mjs — the site, measured in a browser.
//
// WHY THIS EXISTS. Every visual criterion spec 025 carried before this was
// asserted from SOURCE: a rule exists in a stylesheet, a class is on an element,
// a token resolves to a hex. All of that was green while `main`'s
// `main { max-width: 720px }` clamped every section on the site to 672 pixels,
// because a rule that exists and a rule that WINS are different facts and only a
// layout engine knows which is which. That is `name-vs-thing` on a stylesheet:
// the gate read the name of the property and not the thing on the screen.
//
// So the measurements below come out of Chromium. The pages are served from the
// built `docs/` tree over loopback, opened at two viewports, and every number
// this emits is a client rectangle, a computed style or a resource request that
// actually happened. specs/025-design-pass/gate.mjs asserts over the JSON.
//
// IT ALSO WRITES SCREENSHOTS, one per page per viewport, into
// specs/025-design-pass/evidence/screens/. They are evidence rather than an
// assertion about what the site looks like: a reader who wants to know what it
// looked like at the pinned commit can open them.
//
// THE SCREENSHOTS ARE CAPTURED ON THE `reduce` PASS, and that is a determinism
// requirement rather than an accessibility one. The site's one animation is the
// hero band plot, 600ms; a capture taken while it is running lands on whatever
// frame the timing happened to reach, so home-desktop.png changed on every run
// and was re-encoded into git history each time - a diff that says nothing and
// that nobody can review. Under `prefers-reduced-motion: reduce` the animation
// does not exist at all: the whole rule lives inside a no-preference media
// block, so the bands render in their settled geometry and the byte stream is
// the same every run. It is now an assertion, not a hope - AC-25 captures the
// full set a second time and requires byte-identity.
//
// The `no-preference` pass still runs, over every page and both viewports, and
// it is what AC-7 measures: whether a reader who asked for less motion gets it
// is a question about two browser states, and both are opened.
//
//   node scripts/render-check.mjs --json OUT.json [--screens DIR] [--pages N]
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = path.join(ROOT, 'docs');

export const VIEWPORTS = { desktop: { width: 1470, height: 900 }, mobile: { width: 390, height: 844 } };

// BOTH VIEWPORTS GET BOTH PASSES. The `reduce` pass used to run on desktop only,
// which was enough for AC-7 when nothing depended on it; now the screenshots are
// written on that pass, so a mobile capture needs one too. Twenty extra renders,
// about six seconds, and AC-7's reduced-motion coverage doubles as a side effect.
export const MOTION_PASSES = ['no-preference', 'reduce'];
// The pass the screenshots are written on. Named once, here, because gate.mjs
// re-runs the harness with only this pass to prove the captures are stable.
export const SCREENSHOT_PASS = 'reduce';

// ── the page set, from the sitemap ──────────────────────────────────────────
// The same set spec 020 AC-22 holds equal to the published non-stub pages, so a
// page that ships is a page this measures, without a second list to maintain.
export function sitemapPaths(root = ROOT) {
  const xml = fs.readFileSync(path.join(root, 'docs', 'sitemap.xml'), 'utf8');
  return [...xml.matchAll(/<loc>https:\/\/driftproofhq\.com([^<]*)<\/loc>/g)].map((m) => m[1] || '/');
}
export const slugOf = (p) => (p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').replace(/[^a-z0-9]+/gi, '-'));

// ── the server ──────────────────────────────────────────────────────────────
// Node's own http, because a static file server is thirty lines and a dependency
// that only the gate uses is still a dependency somebody has to trust.
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json',
  '.woff2': 'font/woff2', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};
function serve(dir) {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let f = path.join(dir, url);
    if (!path.resolve(f).startsWith(path.resolve(dir))) { res.writeHead(403).end(); return; }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

// ── what the browser measures ───────────────────────────────────────────────
//
// One function, evaluated in the page. Everything it returns is a rectangle, a
// computed style or a count; nothing here reads a stylesheet's source text,
// because reading the source is what the gate already did.
const MEASURE = () => {
  const px = (v) => Number.parseFloat(v) || 0;
  const cs = (el) => getComputedStyle(el);
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  const vis = (el) => {
    const s = cs(el); const r = el.getBoundingClientRect();
    return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
  };
  // LINE BOXES, COUNTED, not a height divided by a line-height. The division is
  // wrong on anything with padding, a border or a transform: the verdict stamp
  // has all three and reported two lines while setting on one. A Range over the
  // element's own contents yields one client rect per line box, which is the
  // thing the question is about.
  // LINE BOXES, COUNTED BY THEIR TOPS, not a height divided by a line-height and
  // not a count of rectangles. The division is wrong on anything with padding, a
  // border or a transform: the verdict stamp has all three and reported two
  // lines while setting on one. And a raw rectangle count is wrong on a value
  // that wraps a <code> chip, because the chip and its text are two rectangles
  // on one line. Distinct tops is the question actually being asked.
  // LINE BOXES OF THE TEXT, counted by their distinct tops.
  //
  // Three wrong answers were tried before this one, and each is worth a line
  // because each looked right. A rendered height over a computed line-height is
  // wrong on anything with padding, a border or a transform: the verdict stamp
  // has all three and reported two lines while setting on one. A count of a
  // Range's rectangles is wrong on a value that wraps a <code> chip, because the
  // chip's border box and its text are two rectangles. And the distinct tops of
  // THOSE rectangles is wrong for the same reason, since the chip's box starts a
  // border and a padding above its own text.
  //
  // The text nodes are the thing. One Range each, and a line is a top.
  const lines = (el) => {
    const tops = new Set();
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const rc of rg.getClientRects()) if (rc.height > 0) tops.add(Math.round(rc.top));
    }
    if (tops.size > 0) return tops.size;
    const lh = px(cs(el).lineHeight) || px(cs(el).fontSize) * 1.2;
    return lh > 0 ? Math.round(el.getBoundingClientRect().height / lh) : 0;
  };
  const all = (sel) => [...document.querySelectorAll(sel)];
  const one = (sel) => document.querySelector(sel);

  // THE BACKGROUND A READER ACTUALLY SEES, composited. Taking the first ancestor
  // with a non-transparent background is wrong the moment one of them is
  // translucent: Report 001's version note is `rgba(98,199,239,.08)`, an eight
  // per cent cyan over paper, and reading it as solid #62C7EF reported a link on
  // it at 2.8:1 against a pair that actually measures well over the bound. The
  // layers are collected front to back until one is opaque, then composited back
  // to front over white.
  const bgOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const m = cs(n).backgroundColor.match(/^rgba?\(([^)]+)\)$/);
      if (!m) continue;
      const q = m[1].split(',').map((x) => Number.parseFloat(x));
      const a = q.length < 4 ? 1 : q[3];
      if (a <= 0) continue;
      layers.push({ r: q[0], g: q[1], b: q[2], a });
      if (a >= 1) break;
    }
    let out = { r: 255, g: 255, b: 255 };
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      out = {
        r: L.r * L.a + out.r * (1 - L.a),
        g: L.g * L.a + out.g * (1 - L.a),
        b: L.b * L.a + out.b * (1 - L.a),
      };
    }
    return `rgb(${Math.round(out.r)}, ${Math.round(out.g)}, ${Math.round(out.b)})`;
  };

  // Every element with its OWN text, deduped by the triple that decides
  // contrast. The sample keeps one selector per triple so a failure names
  // something a reader can find.
  const textPairs = () => {
    const seen = new Map();
    for (const el of all('body *')) {
      if (el.closest('svg') || el.closest('script') || el.closest('style')) continue;
      if (!vis(el)) continue;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!own) continue;
      const s = cs(el);
      const key = `${s.color}|${bgOf(el)}|${Math.round(px(s.fontSize))}|${s.fontWeight}`;
      if (seen.has(key)) continue;
      seen.set(key, {
        color: s.color, bg: bgOf(el), size: Math.round(px(s.fontSize) * 100) / 100, weight: s.fontWeight,
        sample: `${el.tagName.toLowerCase()}${el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/).join('.')}` : ''}`,
        text: (el.textContent || '').trim().slice(0, 40),
      });
    }
    return [...seen.values()];
  };

  const motion = () => {
    const running = [];
    for (const el of all('body *, body')) {
      const s = cs(el);
      if (s.animationName && s.animationName !== 'none' && px(s.animationDuration) > 0) {
        running.push({ sel: el.tagName.toLowerCase() + (el.getAttribute('class') ? `.${el.getAttribute('class').trim().split(/\s+/).join('.')}` : ''), name: s.animationName, duration: s.animationDuration });
      }
      if (px(s.transitionDuration) > 0) {
        running.push({ sel: el.tagName.toLowerCase(), name: `transition:${s.transitionProperty}`, duration: s.transitionDuration });
      }
    }
    return running;
  };

  const receipt = () => {
    const card = one('.receipt');
    if (!card) return null;
    const rows = all('.receipt .receipt-row');
    const values = rows.map((r) => {
      const k = r.querySelector('.receipt-key');
      const v = r.querySelector(':scope > span:last-child');
      // TWO POSITIONS, because they answer different questions. `left` is the
      // painted rectangle; `cellLeft` is the layout position of the grid cell,
      // which is what "the value column's left edge is the same on every row"
      // means. The verdict stamp is rotated two degrees, so its painted rect
      // starts a pixel to the left of its cell while sitting exactly in it.
      return v ? {
        row: r.className,
        left: Math.round(v.getBoundingClientRect().x * 100) / 100,
        cellLeft: v.offsetLeft,
        // The label's position too, because "the value drops below the label"
        // under 720px is a statement about the two of them and not about one.
        keyLeft: k ? k.offsetLeft : null,
        keyTop: k ? Math.round(k.getBoundingClientRect().top) : null,
        valueTop: Math.round(v.getBoundingClientRect().top),
        lines: lines(v), font: cs(v).fontFamily, whiteSpace: cs(v).whiteSpace,
        overflowWrap: cs(v).overflowWrap, wordBreak: cs(v).wordBreak,
        text: (v.textContent || '').trim().slice(0, 24),
      } : null;
    }).filter(Boolean);
    const stamp = one('.receipt .receipt-stamp');
    const plot = one('.receipt .receipt-plot') || one('.receipt svg') || one('.receipt img');
    return {
      box: box(card), bg: cs(card).backgroundColor,
      inner: card.clientWidth - px(cs(card).paddingLeft) - px(cs(card).paddingRight),
      values,
      stamp: stamp ? { h: Math.round(stamp.getBoundingClientRect().height * 100) / 100, lineHeight: px(cs(stamp).lineHeight) || px(cs(stamp).fontSize) * 1.2, whiteSpace: cs(stamp).whiteSpace, lines: lines(stamp) } : null,
      plot: plot ? box(plot) : null,
    };
  };

  const tldr = () => {
    const card = one('.receipt.is-tldr');
    if (!card) return null;
    return all('.receipt.is-tldr .receipt-row').map((r) => {
      const v = r.querySelector(':scope > span:last-child');
      return { key: (r.querySelector('.receipt-key') || {}).textContent || '', valueClass: v ? v.className : '', font: v ? cs(v).fontFamily : '', left: v ? Math.round(v.getBoundingClientRect().x * 100) / 100 : null };
    });
  };

  // A TOKEN, RESOLVED BY THE BROWSER. `getComputedStyle(root).getPropertyValue`
  // returns the declared string (`#2B3036`, or `var(--accent)`), which is a
  // name and not a colour. Painting a probe element with the token and reading
  // its computed colour back is the resolution the page itself performs, so a
  // chip or a band asserted against this is asserted against what was painted.
  const tokenColor = (name) => {
    const s = document.createElement('span');
    s.style.color = `var(${name})`;
    document.body.appendChild(s);
    const c = cs(s).color;
    s.remove();
    return c;
  };
  const TOKENS = ['--paper', '--ink', '--ink-muted', '--rule', '--arm-baseline', '--arm-skill', '--refused',
    '--state-separated', '--state-overlapping', '--state-refused'];

  return {
    tokens: Object.fromEntries(TOKENS.map((n) => [n, tokenColor(n)])),
    // The report cards, by the chip each carries (spec 025 AC-9, A-025-7): the
    // class that names the state, and the colour the browser painted it.
    cards: all('.report-card').map((el) => {
      const chip = el.querySelector('.card-type');
      return {
        report: el.getAttribute('data-report'),
        chipClass: chip ? chip.getAttribute('class') : null,
        chipText: chip ? (chip.textContent || '').trim() : null,
        chipColor: chip ? cs(chip).color : null,
      };
    }),
    // The playground's paint, once the island has mounted (spec 025 AC-3,
    // A-025-9): what the browser painted each element class, so a band can be
    // asserted against the token it should have been read from.
    playground: (() => {
      const pg = one('.playground .pg-plot svg');
      if (!pg) return null;
      const paint = (sel, prop) => [...pg.querySelectorAll(sel)].map((el) => cs(el)[prop]);
      const img = one('.playground img');
      return {
        baseline: paint('.band-baseline', 'fill'), skill: paint('.band-skill', 'fill'),
        pointStroke: paint('.point', 'stroke'), mean: paint('.mean', 'fill'),
        axis: paint('.axis', 'stroke'), labels: paint('.tick, .arm-label', 'fill'),
        fallbackHidden: !!img && !vis(img),
      };
    })(),
    doc: {
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      bodyScrollWidth: document.body.scrollWidth,
    },
    sections: all('section.screen, .screen').map((el) => ({
      id: el.id || null,
      cls: el.getAttribute('class') || '',
      box: box(el),
      inner: (() => { const i = el.querySelector(':scope > .bleed-inner'); return i ? box(i) : null; })(),
    })),
    h1: (() => { const el = one('h1'); return el ? { box: box(el), lines: lines(el), font: cs(el).fontFamily, size: px(cs(el).fontSize) } : null; })(),
    heroCols: (() => {
      const hero = one('#hero'); if (!hero) return null;
      return { grid: cs(hero).gridTemplateColumns, children: [...hero.children].filter(vis).map(box) };
    })(),
    receipt: receipt(),
    tldr: tldr(),
    panels: all('#how-it-works .panel').map((el) => {
      const img = el.querySelector('img, svg');
      return { top: Math.round(box(el).y), w: Math.round(box(el).w), plot: img ? { w: Math.round(img.getBoundingClientRect().width) } : null };
    }),
    strip: all('.strip .strip-item').map((el) => {
      const label = el.querySelector('.strip-label');
      return {
        top: Math.round(box(el).y), w: Math.round(box(el).w),
        labelLines: label ? lines(label) : 0,
      };
    }),
    nav: (() => {
      const brand = one('header.site .brand');
      const menu = one('header.site details.nav-menu');
      const navEl = one('header.site nav.site-nav');
      return {
        brandVisible: !!brand && vis(brand),
        menuVisible: !!menu && vis(menu),
        menuSummary: menu ? (menu.querySelector('summary') || {}).textContent || '' : '',
        navVisible: !!navEl && vis(navEl),
        navLinks: navEl ? navEl.querySelectorAll('a').length : 0,
      };
    })(),
    pres: all('pre').map((el) => ({
      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, overflowX: cs(el).overflowX,
    })),
    tables: all('table').map((el) => ({
      scrollWidth: el.scrollWidth, clientWidth: el.clientWidth,
      wrapOverflowX: el.closest('.table-wrap') ? cs(el.closest('.table-wrap')).overflowX : null,
    })),
    fonts: {
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight}`),
      status: document.fonts.status,
    },
    textPairs: textPairs(),
    motion: motion(),
  };
};

// ── the run ─────────────────────────────────────────────────────────────────
// `docs` serves a tree other than this repository's docs/ - the gate's token
// mutation copies docs/ to a scratch directory, moves one token, and measures
// the copy. `pages` names the paths to open instead of the sitemap's, and
// `viewports` names a subset; both exist so a mutation run opens one page once.
export async function run({ out, screens, limit, passes, docs, pages, viewports } = {}) {
  const motionPasses = passes && passes.length ? passes : MOTION_PASSES;
  const { chromium } = await import('playwright');
  const served = docs || DOCS;
  const { server, port } = await serve(served);
  const base = `http://127.0.0.1:${port}`;
  const paths = (pages && pages.length ? pages : sitemapPaths(path.join(served, '..'))).slice(0, limit || undefined);
  const vps = Object.entries(VIEWPORTS).filter(([n]) => !viewports || viewports.includes(n));
  const browser = await chromium.launch();
  const record = { generated_at: new Date().toISOString(), base, viewports: VIEWPORTS, pages: [] };
  if (screens) fs.mkdirSync(screens, { recursive: true });

  try {
    for (const [name, viewport] of vps) {
      for (const motionPref of motionPasses) {
        const ctx = await browser.newContext({ viewport, reducedMotion: motionPref === 'reduce' ? 'reduce' : 'no-preference' });
        // NOTHING LEAVES THIS MACHINE. Every request to an origin other than the
        // one being served is ABORTED, and recorded as attempted. Two reasons,
        // and both matter more than the convenience of letting them through.
        //
        // The gate says it reaches no network (NFR-3), and a browser opening a
        // page that loads an analytics beacon and a shields.io badge reaches one
        // on the page's behalf. And a measurement that depends on a third party
        // being up is a measurement that goes red for a reason that has nothing
        // to do with the site.
        //
        // The log still records what the page TRIED to load, which is exactly
        // what a criterion about where fonts come from needs: an aborted request
        // to another origin is still a request to another origin.
        await ctx.route('**', (route) => {
          const u = route.request().url();
          if (u.startsWith(base) || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
          return route.abort();
        });
        for (const p of paths) {
          const page = await ctx.newPage();
          // EVERY REQUEST THE PAGE MAKES, recorded rather than inferred. A font
          // served from another origin is a request, and only the network log
          // knows whether one happened.
          const requests = [];
          page.on('request', (r) => requests.push({
            url: r.url(), type: r.resourceType(), offOrigin: !r.url().startsWith(base) && !/^(data|blob):/.test(r.url()),
          }));
          await page.goto(base + p, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          // AN ISLAND MOUNTS AFTER LOAD, from a dynamic import. A page that
          // carries one is measured once the island has drawn, or after five
          // seconds without it - in which case the record says so (playground:
          // null) and the assertion that reads it goes red rather than absent.
          if (await page.$('[data-island="band-playground"]')) {
            await page.waitForSelector('.playground .pg-plot svg', { timeout: 5000 }).catch(() => null);
          }
          const m = await page.evaluate(MEASURE);
          record.pages.push({ page: p, viewport: name, motion_pref: motionPref, requests, ...m });
          if (screens && motionPref === SCREENSHOT_PASS) {
            // CLIPPED AT 4000 PIXELS on a page taller than that. A published
            // report is twenty thousand pixels of tables, and a full-page capture
            // of eight of them is thirty megabytes per run, re-encoded into git
            // history every time the gate is run with --final. What this pass
            // changed is the chrome, the card and the first screens; the cap is
            // recorded in the packet so nobody mistakes a clip for a short page.
            const CAP = 4000;
            const full = await page.evaluate(() => document.documentElement.scrollHeight);
            // `clip` WITHOUT `fullPage` CLIPS TO THE VIEWPORT, not to the page:
            // a tall page is captured at 900 or 844 pixels, not at 4000 (the
            // approval fix pass read every capture's own header). Capturing the
            // full 4000 was tried and reverted in that pass: the larger files
            // tripped the hygiene scan scripts/merge-check.js runs (lib/hygiene.js,
            // which reads every tracked file as text), on an email-shaped byte run inside a PNG -
            // the same coincidence class spec 027 taught tests/gate.js to
            // classify away, and a merge control this lane does not change. So
            // a tall page's capture IS its first viewport, the spec and packet
            // say so, and the 4000 clip is carried to the scanner loop.
            await page.screenshot({
              path: path.join(screens, `${slugOf(p)}-${name}.png`),
              ...(full > CAP
                ? { clip: { x: 0, y: 0, width: viewport.width, height: CAP } }
                : { fullPage: true }),
            });
          }
          await page.close();
        }
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  if (out) fs.writeFileSync(out, `${JSON.stringify(record, null, 1)}\n`);
  return record;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (n) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : null; };
  const only = arg('--passes');
  const r = await run({ out: arg('--json'), screens: arg('--screens'), limit: Number(arg('--pages')) || 0, passes: only ? only.split(',') : null });
  console.log(`measured ${r.pages.length} page renders across ${Object.keys(VIEWPORTS).length} viewports`);
}
