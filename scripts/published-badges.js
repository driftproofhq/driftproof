// SPDX-License-Identifier: Apache-2.0
'use strict';
// Issue 815: deterministic site output from the published receipts. No model or network calls.
const fs = require('node:fs');
const path = require('node:path');
const { readingOf } = require('../lib/reading-words');
const { shortModelName } = require('./model-names');
const { applyHeadTags } = require('./build-head-tags');
const chrome = require('./site-chrome');
const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://driftproofhq.com';
const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Names are stable functions of published names. Collisions are refused, never numbered.
function segment(value) {
  const name = String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!name) throw new Error('BADGE_NAME_EMPTY');
  return name;
}
function subjectName(x, root) {
  const r = x.receipt;
  let name = r.skill.name;
  if (r.skill.unit === 'context_file') {
    const file = path.join(root,'receipts/report-016/manifest.json');
    const picks = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file,'utf8')).picks : [];
    const matches = picks.filter(p => p.sha256 === r.skill.content_hash && path.posix.basename(p.path) === r.skill.name);
    if (matches.length !== 1) throw new Error('BADGE_CONTEXT_PROVENANCE');
    const pick = matches[0];
    name = 'report-016-' + pick.repository.split('/').pop() + '-' + path.posix.basename(pick.path);
  }
  if (identity(x).includes(':section-removed:')) name += '-section-removed';
  return segment(name);
}
function assertNames(rows) {
  const subjects = new Map(), names = new Map(), models = new Map();
  for (const row of rows) {
    const slug = row.badge_slug;
    if (typeof slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('BADGE_NAME_INVALID');
    if ((subjects.has(slug) && subjects.get(slug) !== row.skill_key) || (names.has(row.skill_key) && names.get(row.skill_key) !== slug)) throw new Error('BADGE_NAME_COLLISION: '+slug);
    subjects.set(slug,row.skill_key); names.set(row.skill_key,slug);
    const model = segment(row.model), key = slug+'/'+model;
    if (model === 'latest' || (models.has(key) && models.get(key) !== row.model)) throw new Error('BADGE_NAME_MODEL_COLLISION: '+key);
    models.set(key,row.model);
  }
}

// The public skill list owns membership and display names. Receipt hashes, not names,
// associate its subjects with badge identities. The skill builder supplies the same inputs
// directly before writing its pages, so it never reads its own previous output.
const decode = s => s.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function publicSubjects(root = ROOT) {
  const file = path.join(root, 'docs/skills/index.html');
  const index = fs.readFileSync(file, 'utf8');
  const pages = [...new Set([...index.matchAll(/<a class="skill-name" href="\/skills\/([^\"]+)\/">/g)].map(m => decode(m[1])))];
  if (!pages.length) throw new Error('BADGE_SUBJECT_INDEX_EMPTY');
  return pages.map(page => {
    if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(page)) throw new Error('BADGE_SUBJECT_PATH');
    const html = fs.readFileSync(path.join(root, 'docs/skills', page, 'index.html'), 'utf8');
    const name = /<h1\b[^>]*>([^<]+)<\/h1>/.exec(html)?.[1];
    if (!name) throw new Error('BADGE_SUBJECT_NAME');
    const main = /<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)?.[1] || '';
    const results = main.replace(/<section class="skill-badges">[\s\S]*?<\/section>/g, '');
    const hashes = new Set([...results.matchAll(/href="(?:https:\/\/driftproofhq\.com)?\/r\/([a-f0-9]{64})\/"/g)].map(m => m[1]));
    for (const m of results.matchAll(/data-receipt="((?:receipts|index-receipts)\/[^\"]+\.json)"/g)) {
      if (m[1].split('/').includes('..')) throw new Error('BADGE_RECEIPT_PATH');
      const r = JSON.parse(fs.readFileSync(path.join(root, m[1]), 'utf8'));
      hashes.add(r.receipt_hash);
    }
    return {page, name:decode(name), hashes:[...hashes]};
  });
}
function subjectsFor(subjects, rows) {
  const hashes = new Map(rows.map(row => [row.receipt_hash, row]));
  const slugs = new Map(), keys = new Map();
  return subjects.map(subject => {
    const matched = subject.hashes.map(hash => hashes.get(hash)).filter(Boolean);
    const identities = [...new Set(matched.map(row => row.skill_key))];
    if (identities.length > 1) throw new Error('BADGE_SUBJECT_MIXED: ' + subject.page);
    // A public listing alone cannot create a badge hub. Select from the whole
    // identity history so an older eligible receipt cannot bypass a refused run.
    const history = rows.filter(row => identities.includes(row.skill_key));
    if (!select(history).models.some(row => row.source === 'driftproof' && row.text)) return null;
    const slug = matched[0].badge_slug;
    if (slugs.has(slug) && slugs.get(slug) !== subject.page) throw new Error('BADGE_NAME_COLLISION: ' + slug);
    slugs.set(slug, subject.page);
    for (const key of identities) {
      if (keys.has(key) && keys.get(key) !== subject.page) throw new Error('BADGE_SUBJECT_COLLISION: ' + key);
      keys.set(key, subject.page);
    }
    return {...subject, badge_slug:slug, keys:identities};
  }).filter(Boolean).sort((a,b) => cmp(a.badge_slug,b.badge_slug));
}

function withBadgeFields(rows, subjects) {
  assertNames(rows);
  const allowed = new Set(subjects.flatMap(s => s.keys));
  const selections = new Map(groups(rows).map(rs => [rs[0].skill_key,{...select(rs),page:allowed.has(rs[0].skill_key)}]));
  return rows.map(row => {
    const chosen = selections.get(row.skill_key), model = chosen.models.find(r=>r.model===row.model);
    return {...row,badge_page_url:chosen.page ? ORIGIN+basePath(row) : null,
      badge_latest_url:chosen.page && chosen.latest.text ? ORIGIN+latestPath(row) : null,
      badge_model_url:chosen.page && model.text ? ORIGIN+modelPath(row) : null};
  });
}
function identity({ rel, receipt: r }) {
  const variant = /\/which-section\/[^/]+\/compare-B-/.test(rel) ? ':section-removed:' + r.skill.content_hash : '';
  return (r.skill.unit === 'context_file' ? 'context:' + r.skill.content_hash : 'skill:' + r.skill.name) + variant;
}
function rowOf(x, { root = ROOT } = {}) {
  const r = x.receipt;
  const reading = readingOf(r);
  const imported = x.rel.startsWith('index-receipts/skill-placebo/');
  if (imported && (r.verification_level !== 'DECLARED' || r.run.source !== 'imported/harbor')) throw new Error('PUBLISHED_RECEIPT_SOURCE');
  return {
    source: imported ? 'skill-placebo' : 'driftproof',
    skill: r.skill.name, skill_key: identity(x), badge_slug: subjectName(x,root), model: r.run.model_id, date: r.run.date_utc,
    ...reading, receipt_hash: r.receipt_hash,
    receipt_url: imported ? x.receipt_url || ORIGIN + '/skills/' : ORIGIN + '/r/' + r.receipt_hash + '/',
    file: x.rel,
  };
}
function importsAt(root) {
  const file = path.join(root, 'index-receipts/sources.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).receipts.filter(e => e.source === 'skill-placebo').map(e => ({rel:e.file,receipt:JSON.parse(fs.readFileSync(path.join(root,e.file),'utf8')),receipt_url:ORIGIN+'/skills/'+e.identity.owner+'/'+e.identity.repo+'/'+e.name+'/'}));
}
function catalogue({ root = ROOT, entries, imports, subjects } = {}) {
  if (!entries) entries = require('./build-receipt-pages').receipts(root);
  if (!imports) imports = importsAt(root);
  const seen = new Map(), rows = [];
  for (const x of [...entries, ...imports].sort((a,b) => cmp(a.rel,b.rel))) {
    if ((!x.rel.startsWith('receipts/') && !x.rel.startsWith('index-receipts/skill-placebo/')) || x.rel.split('/').some(p => p.endsWith('-draft'))) continue;
    if (x.rel.startsWith('receipts/') && (x.receipt.run?.source?.startsWith('imported/') || x.receipt.run?.import)) continue;
    const row = rowOf(x,{root}); // validate every copy, including duplicates, before selecting anything
    const old = seen.get(row.receipt_hash);
    if (old) {
      if (JSON.stringify(old) !== JSON.stringify(x.receipt)) throw new Error('RECEIPT_COPY_MISMATCH');
      continue;
    }
    seen.set(row.receipt_hash,x.receipt);
    rows.push(row);
  }
  rows.sort((a,b) => cmp(a.skill_key,b.skill_key) || cmp(a.model,b.model) || Date.parse(b.date)-Date.parse(a.date) || cmp(a.receipt_hash,b.receipt_hash));
  assertNames(rows);
  if (subjects === false) return rows;
  return withBadgeFields(rows, subjectsFor(subjects || publicSubjects(root), rows));
}
function select(rows) {
  const ordered = [...rows].sort((a,b) => Date.parse(b.date)-Date.parse(a.date) || cmp(a.receipt_hash,b.receipt_hash));
  const models = new Map();
  for (const row of ordered) if (!models.has(row.model)) models.set(row.model,row);
  return { latest: ordered[0] || null, models: [...models.values()].sort((a,b) => cmp(a.model,b.model)) };
}
const basePath = row => '/badges/' + row.badge_slug + '/';
const latestPath = row => '/badges/' + row.badge_slug + '.svg';
const modelPath = row => basePath(row) + segment(row.model) + '.svg';
function modelName(row) { try { return shortModelName(row.model); } catch { return row.model; } }
function dateName(row) {
  return new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(row.date));
}
const title = row => 'driftproof | ' + row.text + ' | ' + modelName(row) + ' · ' + dateName(row);
function svg(row) {
  if (!row.text) return null;
  const texts = ['driftproof',row.text,modelName(row)+' · '+dateName(row)];
  const fills = ['#24292f','#374151','#4b5563'];
  const widths = texts.map(t => Math.ceil(t.length*6.6)+14);
  const width = widths.reduce((a,b)=>a+b,0);
  let x = 0;
  const parts = texts.map((t,i) => {
    const out = '<rect x="'+x+'" width="'+widths[i]+'" height="20" fill="'+fills[i]+'"/>'
      + '<text x="'+(x+7)+'" y="14" fill="#ffffff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" textLength="'+(widths[i]-14)+'" lengthAdjust="spacingAndGlyphs">'+esc(t)+'</text>';
    x += widths[i]; return out;
  });
  return '<svg xmlns="http://www.w3.org/2000/svg" width="'+width+'" height="20" viewBox="0 0 '+width+' 20" role="img" aria-label="'+esc(title(row))+'" data-receipt-hash="'+esc(row.receipt_hash)+'" data-reading="'+esc(row.reading)+'"><title>'+esc(title(row))+'</title><a href="'+esc(row.receipt_url)+'">'+parts.join('')+'</a></svg>\n';
}
function snippets(rows) {
  assertNames(rows);
  const chosen = select(rows);
  if (!chosen.latest) return '';
  const choices = [{row:chosen.latest,label:'Latest',url:latestPath(chosen.latest),target:basePath(chosen.latest)+'latest/'},...chosen.models.map(row=>({row,label:modelName(row),url:modelPath(row)}))];
  const sections = choices.map(({row,label,url,target:link}) => {
    if (!row.text) return '<p>'+esc(label)+': no badge is available for this receipt.</p>';
    // Markdown alt text uses entities for syntax delimiters; its rendered words equal the SVG.
    const alt = title(row).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\[/g,'&#91;').replace(/\]/g,'&#93;').replace(/\\/g,'&#92;');
    const target = ORIGIN + (link || url.replace(/\.svg$/, '/'));
    const snippet = '[!['+alt+']('+ORIGIN+url+')]('+target+')';
    return '<div class="skill-badge"><h3>'+esc(label)+'</h3><p>'+esc(row.text)+'. '+esc(modelName(row))+' · '+esc(dateName(row))+'</p><p><a href="'+esc(row.receipt_url)+'"><img src="'+url+'" alt="'+esc(title(row))+'"></a></p><p><code>'+esc(snippet)+'</code></p></div>';
  });
  if (!choices.some(x=>x.row.text)) return '';
  return '<section class="skill-badges"><h2>Share a badge</h2><p>Copy a line into your README. Each link opens the receipt behind that reading. Latest follows the newest run; each model badge follows that model. These readings describe these tasks, not every use of the skill.</p>'+sections.join('\n')+'</section>';
}
function groups(rows) {
  const out = new Map();
  for (const row of rows) { if (!out.has(row.skill_key)) out.set(row.skill_key,[]); out.get(row.skill_key).push(row); }
  return [...out.values()];
}
function page(name, main, rel, target = null, noindex = false) {
  const html = [
    '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    ...(noindex ? ['<meta name="robots" content="noindex,follow">'] : []),
    ...(target ? ['<meta http-equiv="refresh" content="0; url='+esc(target)+'">'] : []),
    '<title>'+esc(name+' | Driftproof')+'</title>', '<link rel="stylesheet" href="/style.css">',
    '</head>', '<body>', chrome.NAV, '<main class="receipt-page">', main, '</main>',
    chrome.FOOTER, '</body>', '</html>', '',
  ].join('\n');
  return applyHeadTags(html,rel);
}
function redirect(row, rel) {
  return page('Open the receipt', '<h1>Open the receipt</h1><p>This badge follows the selected run. Your browser should take you to its receipt. If it does not, <a href="'+esc(row.receipt_url)+'">open the receipt behind this badge</a>.</p>', rel, new URL(row.receipt_url).pathname);
}
function outputs(rows = catalogue(), {root = ROOT, subjects} = {}) {
  assertNames(rows);
  subjects = subjectsFor(subjects || publicSubjects(root), rows);
  rows = withBadgeFields(rows, subjects);
  const out = new Map([['data/published-receipts.json',JSON.stringify({version:1,receipts:rows},null,2)+'\n']]);
  const links = [];
  for (const subject of subjects) {
    const rs = rows.filter(row => subject.keys.includes(row.skill_key));
    const chosen = select(rs), markup = snippets(rs), base = 'badges/' + subject.badge_slug + '/';
    const choices = chosen.latest ? [{row:chosen.latest, model:'latest'}, ...chosen.models.map(row => ({row,model:segment(row.model)}))] : [];
    for (const {row, model} of choices) {
      // Imported evidence has no /r/ page. A hub cannot promote it into a badge.
      if (row.source !== 'driftproof') continue;
      const redirectRel = base + model + '/index.html';
      out.set(redirectRel, redirect(row, redirectRel));
      if (row.text) out.set((model === 'latest' ? latestPath(row) : modelPath(row)).slice(1), svg(row));
    }
    const name = subject.name;
    const intro = '<h1>'+esc(name)+' badges</h1><p>Badge options for '+esc(name)+'. Each available badge names its reading, model and date and links to its receipt.</p>';
    out.set(base+'index.html', page(name+' badges', intro+'<p><a href="/skills/'+esc(subject.page)+'/">Read this skill\'s results</a></p>'+markup, base+'index.html'));
    links.push('<li><a href="/'+base+'">'+esc(name)+'</a></li>');
  }
  out.set('badges/index.html',page('Skill badges','<h1>Skill badges</h1><p>Browse badge options for the subjects in our skill index. Available badges name their reading, model and date and link to their receipt.</p><p><a href="/data/published-receipts.json">Download the published receipt list</a></p><ul>'+links.join('\n')+'</ul>','badges/index.html'));
  return out;
}
function build({root = ROOT,check = false,rows,subjects} = {}) {
  const want = outputs(rows || catalogue({root,subjects}), {root,subjects});
  const docs = path.join(root,'docs');
  const stale = [];
  for (const [rel,body] of want) {
    const file = path.join(docs,rel);
    if (check) { if (!fs.existsSync(file) || fs.readFileSync(file,'utf8') !== body) stale.push(rel); }
    else { fs.mkdirSync(path.dirname(file),{recursive:true}); if (!fs.existsSync(file) || fs.readFileSync(file,'utf8') !== body) fs.writeFileSync(file,body); }
  }
  function extras(dir) {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir,{withFileTypes:true})) {
      const file = path.join(dir,e.name);
      if (e.isDirectory()) { extras(file); continue; }
      const rel = path.relative(docs,file).split(path.sep).join('/');
      // The existing CLI badge data is owned by its own builder. All other badge output is ours.
      if (rel !== 'badges/commit-message-conventions.json' && !want.has(rel)) { if(check) stale.push(rel); else fs.unlinkSync(file); }
    }
  }
  extras(path.join(docs,'badges'));
  // Issue 840 (spec 840 A-840-2): the plugin's copy of the published readings is written and checked from
  // the same published rows, in this same call, so every builder that moves the list moves the copy.
  const readings = require('./build-plugin-readings').sync({root,check,rows:JSON.parse(want.get('data/published-receipts.json')).receipts,subjects});
  if (check && readings.stale) stale.push(path.relative(root,readings.file).split(path.sep).join('/'));
  if (stale.length) throw new Error('PUBLISHED_BADGES_STALE: '+stale.join(', '));
  return want.size;
}
module.exports = { publicSubjects, subjectsFor, catalogue, rowOf, select, title, svg, snippets, modelPath, latestPath, basePath, outputs, build };
