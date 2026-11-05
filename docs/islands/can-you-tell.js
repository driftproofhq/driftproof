// SPDX-License-Identifier: Apache-2.0
// Issue 693. All game state lives in this mount. No persistence or network calls.

// Escape the entire source before recognizing Markdown. Only fixed markup from
// this subset is added. Links, images and raw HTML have no parser rule.
export function renderAnswer(source) {
  const escaped=String(source).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  function inline(text, depth=0) {
    if(depth>=8)return text;
    const tokens=/(\x60+)([^\n]*?)\1|\*\*(.+?)\*\*|__(.+?)__|(?<!\w)\*([^*\n]+)\*(?!\w)|(?<!\w)_([^_\n]+)_(?!\w)/g;
    return text.replace(tokens,(whole,ticks,code,strong,underStrong,italic,underItalic)=>{
      if(ticks)return '<code>'+code+'</code>';
      if(strong!==undefined||underStrong!==undefined)return '<strong>'+inline(strong??underStrong,depth+1)+'</strong>';
      return '<em>'+inline(italic??underItalic,depth+1)+'</em>';
    });
  }
  const list=line=>/^( *)([-+*]|\d+[.)])\s+(.+)$/.exec(line);
  const fence=line=>/^ {0,3}(\x60{3,}|~{3,})(.*)$/.exec(line);
  const heading=line=>/^ {0,3}(#{1,6})[ \t]+(.+?)\s*$/.exec(line);
  function blocks(lines,depth=0) {
    if(depth>=12)return '<p>'+inline(lines.join('\n'))+'</p>';
    const out=[];
    for(let i=0;i<lines.length;) {
      const line=lines[i];if(!line.trim()){i++;continue;}
      const f=fence(line);
      if(f) {
        const code=[];i++;
        while(i<lines.length) {
          const end=fence(lines[i]);
          if(end&&end[1][0]===f[1][0]&&end[1].length>=f[1].length&&!end[2].trim()){i++;break;}
          code.push(lines[i++]);
        }
        out.push('<pre><code>'+code.join('\n')+'</code></pre>');continue;
      }
      const h=heading(line);
      if(h){const level=Math.min(6,h[1].length+3);out.push('<h'+level+'>'+inline(h[2].replace(/\s+#+\s*$/,''))+'</h'+level+'>');i++;continue;}
      const first=list(line);
      if(first) {
        const indent=first[1].length,ordered=/^\d/.test(first[2]),tag=ordered?'ol':'ul';
        const start=ordered?Number.parseInt(first[2],10):1;
        out.push('<'+tag+(ordered&&start!==1?' start="'+start+'"':'')+'>');
        while(i<lines.length) {
          const item=list(lines[i]);
          if(!item||item[1].length!==indent||/^\d/.test(item[2])!==ordered)break;
          i++;const continuation=[];
          while(i<lines.length && (!lines[i].trim() || lines[i].search(/\S/)>indent)) {
            continuation.push(lines[i].slice(Math.min(indent+2,lines[i].search(/\S/)===-1?lines[i].length:lines[i].search(/\S/))));i++;
          }
          out.push('<li>'+inline(item[3])+(continuation.some(t=>t.trim())?blocks(continuation,depth+1):'')+'</li>');
        }
        out.push('</'+tag+'>');continue;
      }
      if(/^ {4}/.test(line)) {
        const code=[];while(i<lines.length&&(/^ {4}/.test(lines[i])||!lines[i].trim()))code.push(lines[i++].slice(4));
        while(code.length&&!code[code.length-1])code.pop();
        out.push('<pre><code>'+code.join('\n')+'</code></pre>');continue;
      }
      const paragraph=[line];i++;
      while(i<lines.length&&lines[i].trim()&&!heading(lines[i])&&!fence(lines[i])&&!list(lines[i])&&!/^ {4}/.test(lines[i]))paragraph.push(lines[i++]);
      out.push('<p>'+inline(paragraph.join('\n'))+'</p>');
    }
    return out.join('');
  }
  return blocks(escaped.replace(/\r\n?/g,'\n').replace(/\t/g,'    ').split('\n'));
}

export async function mount(el) {
  const bytes=Uint8Array.from(atob(el.getAttribute('data-game-source')),c=>c.charCodeAt(0));
  const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  const data=await new Response(stream).json();el.removeAttribute('data-game-source');
  const q=s=>el.querySelector(s), all=s=>[...el.querySelectorAll(s)];
  const skill=q('#game-skill'), model=q('#game-model'), mode=q('#game-mode');
  let entry, game, rows, current=0, revealed=false, expanded=false;
  const random=n=>{const b=new Uint32Array(1), limit=Math.floor(4294967296/n)*n;do {crypto.getRandomValues(b);} while(b[0]>=limit);return b[0]%n;};
  const say=(selector,value)=>{q(selector).textContent=value;};
  function sourceLink(text,href,parent) {const a=document.createElement('a');a.textContent=text;a.href=href;parent.appendChild(a);}
  function expansion() {
    q('.tell-answers').classList.toggle('is-expanded',expanded);
    q('[data-expand]').setAttribute('aria-expanded',String(expanded));
    say('[data-expand]',expanded?'Show answer previews':'Show both answers in full');
    say('[data-preview-note]',expanded?'Both complete answers are shown below.':'Answer previews. Expand both to read every word.');
  }
  function draw() {
    const pair=game.pairs[current], row=rows[current];
    const target=mode.value==='skill'?'the skill':'the fake';
    say('[data-progress]','Pair '+(current+1)+' of '+rows.length);
    say('[data-question]',mode.value==='skill'?'Which answer had the skill?':'Which answer had the fake?');
    say('[data-prompt]',pair.prompt);
    for (const letter of ['A','B']) {
      const isTarget=(letter==='A')===row.first;
      q('[data-answer="'+letter+'"]').innerHTML=renderAnswer(isTarget?pair.target:pair.other);
      const button=q('[data-pick="'+letter+'"]');button.disabled=revealed;button.setAttribute('aria-pressed',String(row.pick===letter));
      const identity=q('[data-identity="'+letter+'"]');identity.hidden=!revealed;
      identity.textContent=isTarget?'This one had '+target+'.':mode.value==='skill'?'This one had the fake.':'This one had no skill.';
      q('[data-answer="'+letter+'"]').scrollTop=0;
    }
    expansion();
    q('[data-prev]').disabled=current===0;q('[data-next]').disabled=current===rows.length-1;
    q('[data-reveal]').disabled=revealed;
    const picked=rows.filter(r=>r.pick).length;
    say('[data-status]',revealed?'Revealed. Browse the pairs to see which was which.':picked+' of '+rows.length+' picked. You can reveal whenever you like.');
  }
  function start() {
    entry=data.entries.find(e=>e.skill===skill.value && e.report===model.value);
    game=entry.games[mode.value];current=0;revealed=false;expanded=false;
    rows=game.pairs.map(()=>({first:!!random(2),pick:null}));
    q('[data-result]').hidden=true;q('[data-result]').replaceChildren();
    say('[data-mode-note]',mode.value==='skill'?'One answer had the skill. The other had unrelated text with the same length as the skill instructions.':'One answer had the same-length fake. The other had no skill instructions at all. Can you even tell?');
    say('[data-cues]',game.cues);q('.tell-cues').open=false;
    say('[data-scope]',entry.scope);say('[data-router]',entry.routerNote);q('[data-router]').hidden=!entry.router;
    say('[data-reading]',mode.value==='skill'?'Report '+entry.report+' on '+entry.skill+' against the fake: '+entry.reading+'.':'This twist shows the fake against no skill. It adds no report reading or verdict.');
    say('[data-counts]',game.count+' verified pairs across '+game.tasks+' text tasks. '+game.dropped+' pairs left out because a matching measured answer was missing.');
    const sources=q('[data-sources]');sources.replaceChildren();
    sourceLink('Read Report '+entry.report,'/reports/'+entry.report+'/',sources);
    for(const [label,file] of [['Receipt',entry.receipt],['Kept answers',entry.answers],['Tasks',entry.suite]]) {sources.appendChild(document.createTextNode(' · '));sourceLink(label,'https://github.com/driftproofhq/driftproof/blob/main/'+file,sources);}
    q('[data-play]').hidden=false;draw();
  }
  for (const control of [skill,model,mode]) control.addEventListener('change',start);
  all('[data-pick]').forEach(button=>button.addEventListener('click',()=>{if(revealed)return;rows[current].pick=button.dataset.pick;draw();}));
  q('[data-prev]').addEventListener('click',()=>{if(current>0){current--;expanded=false;draw();}});
  q('[data-next]').addEventListener('click',()=>{if(current<rows.length-1){current++;expanded=false;draw();}});
  q('[data-expand]').addEventListener('click',()=>{expanded=!expanded;expansion();});
  q('[data-again]').addEventListener('click',start);
  q('[data-surprise]').addEventListener('click',()=>{const choices=[...skill.options].filter(o=>o.value!==skill.value);skill.value=choices[random(choices.length)].value;start();});
  q('[data-reveal]').addEventListener('click',()=>{
    if(revealed)return;revealed=true;draw();
    const picks=rows.filter(r=>r.pick), right=picks.filter(r=>(r.pick==='A')===r.first).length;
    const result=q('[data-result]');result.replaceChildren();
    const h=document.createElement('h2');h.textContent=picks.length?'Your hunches, revealed':'Just looking? That counts too.';result.appendChild(h);
    const p=document.createElement('p');p.textContent=right+' right from '+picks.length+' '+(picks.length===1?'pick':'picks')+'. '+(rows.length-picks.length)+' skipped.';result.appendChild(p);
    const honesty=document.createElement('p');honesty.textContent=data.honesty;result.appendChild(honesty);
    result.hidden=false;result.focus({preventScroll:true});
  });
  start();
}
