// SPDX-License-Identifier: Apache-2.0
'use strict';
// A builder declares itself once. Regeneration and discovery read the same set.
const fs = require('node:fs');
const path = require('node:path');
function builders(dir = __dirname) {
  return fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().flatMap(file => {
    const marker = /^\/\/ Site builder: (.+)$/m.exec(fs.readFileSync(path.join(dir,file),'utf8'));
    if (!marker) return [];
    const info = JSON.parse(marker[1]);
    if (info.href && (!/^\/[a-z0-9-]+\/$/.test(info.href) || typeof info.label !== 'string')) throw new Error('Invalid reader page: '+file);
    return [{file,...info}];
  });
}
const pages = dir => builders(dir).filter(b => b.href);
const escape = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const links = () => pages().map(p => '<a href="'+p.href+'">'+escape(p.label)+'</a>').join(' · ');
const section = () => '<section class="reader-pages"><h2 id="explore-the-results">Explore the results</h2><p>'+links()+'</p></section>';
function run(check, dir = __dirname) {
  const {execFileSync}=require('node:child_process');
  for (const b of builders(dir)) execFileSync(process.execPath,[path.join(dir,b.file),...(check?['--check']:[])],{stdio:'inherit',timeout:1800000});
}
module.exports={builders,pages,links,section,run};
