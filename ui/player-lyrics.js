/* Shared transport: full-width seek rail and an independent lyric listening view. */
(()=>{
 'use strict';
 const rail=document.querySelector('.global-timeline'),seek=$('#global-seek'),trigger=document.querySelector('.now-playing');
 const tip=document.createElement('output');tip.id='seek-tooltip';rail.append(tip);
 let hover=null;
 function tooltip(){const {start,end}=studioPlayer.bounds(),value=hover===null?Number(seek.value):start+hover*(end-start);tip.textContent=studioPlayer.time(value)+' / '+studioPlayer.time(end);rail.style.setProperty('--hover-position',(hover===null?(end>start?(value-start)/(end-start):0):hover)*100+'%');}
 rail.addEventListener('pointermove',e=>{const rect=rail.getBoundingClientRect();hover=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width));tooltip();});rail.addEventListener('pointerleave',()=>{hover=null;tooltip();});seek.addEventListener('input',tooltip);
 const panel=document.createElement('section');panel.className='lyrics-stage';panel.id='lyrics-stage';panel.hidden=true;panel.setAttribute('aria-label','正在播放的歌词');
 panel.innerHTML='<button class="button secondary small lyrics-close" aria-label="收起歌词">⌄ 收起歌词</button><div class="lyrics-identity"><div class="lyrics-disc"><img src="assets/fenglai-icon.png" alt=""></div><h2></h2><p></p></div><div class="lyrics-body"><p class="lyrics-status" role="status"></p><div class="lyrics-scroll"><div class="lyrics-lines"></div></div></div>';
 document.body.append(panel);trigger.tabIndex=0;trigger.setAttribute('role','button');trigger.setAttribute('aria-label','展开歌词');trigger.setAttribute('aria-controls',panel.id);trigger.setAttribute('aria-expanded','false');
 const scroller=panel.querySelector('.lyrics-scroll'),lines=panel.querySelector('.lyrics-lines');let signature='',rows=[],current=-2,holdUntil=0;
 function close(){panel.hidden=true;trigger.setAttribute('aria-expanded','false');trigger.focus({preventScroll:true});}
 function open(){panel.hidden=false;trigger.setAttribute('aria-expanded','true');signature='';current=-2;holdUntil=0;update();panel.querySelector('button').focus({preventScroll:true});}
 trigger.onclick=()=>panel.hidden?open():close();trigger.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();trigger.click();}};
 panel.querySelector('.lyrics-close').onclick=close;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){e.preventDefault();close();}});
 scroller.addEventListener('wheel',()=>holdUntil=Date.now()+3500,{passive:true});scroller.addEventListener('touchstart',()=>holdUntil=Date.now()+3500,{passive:true});
 function update(){
  tooltip();if(panel.hidden)return;
  const a=studioPlayer.active,editor=studioPlayer.score,meta=a?studioPlayer.description(a):{title:editor?.title.value||'尚未选择作品',detail:'乐谱试听'},g=window.generatedScore;
  const synced=a&&g?.audio===a?g:null,lyrics=editor?.lyrics.value||meta.job?.request.lyrics||'',doc=editor?.doc||synced?.doc,binding=editor?.binding||synced?.binding,timing=synced?.timing,analysis=timing?.analysis;
  const ready=!!editor?.doc||!!(synced&&!synced.syncPending&&(analysis?.accepted||timing?.anchors?.length));
  panel.querySelector('h2').textContent=meta.title;panel.querySelector('.lyrics-identity p').textContent=meta.detail||'';panel.querySelector('.lyrics-disc').classList.toggle('is-playing',a?!a.paused:!!editor?.playTimer);
  panel.querySelector('.lyrics-status').textContent=!lyrics?'这份音频暂无歌词':ready?'歌词随播放滚动 · 点击已定位歌词跳转':synced?.syncPending?'正在对齐歌词，完成后自动跟随':'暂无可靠时间定位，可手动滚动查看歌词';
  const key=JSON.stringify([a?.src,editor?.mode,lyrics,binding?.slots,ready,analysis?.events,timing?.anchors]);
  if(key!==signature){signature=key;rows=[];let offset=0;for(const text of lyrics.split('\n')){if(text.trim()&&!/^\s*\[.*\]\s*$/.test(text))rows.push({text,start:offset,end:offset+text.length,time:null});offset+=text.length+1;}
   const tokenRows=new Map();for(let i=0;i<(binding?.slots.length||0);i++){const slot=binding.slots[i],row=rows.find(r=>slot[0]&&slot[0]!=='_'&&slot[1]>=r.start&&slot[1]<r.end);if(!row)continue;const note=doc?.vocal[i];for(const t of note?.tokens||[])tokenRows.set(t.index,row);if(ready&&(editor||timing?.anchors?.length||analysis?.method!=='qwen3-forced-aligner')){const t=note.onset*60/doc.bpm,value=editor?t:synced.mapping.toAudio(t);row.time=row.time===null?value:Math.min(row.time,value);}}
   if(ready&&!editor&&!timing?.anchors?.length&&analysis?.method==='qwen3-forced-aligner')for(const event of analysis.events){const row=event.tokens.map(t=>tokenRows.get(t)).find(Boolean);if(row)row.time=row.time===null?event.start:Math.min(row.time,event.start);}
   lines.replaceChildren(...rows.map(row=>{const b=document.createElement('button');b.className='lyrics-line';b.textContent=row.text;b.disabled=row.time===null;b.onclick=()=>{holdUntil=0;studioPlayer.seek(row.time).catch(e=>toast(e.message,true));};row.node=b;return b;}));if(!rows.length){const p=document.createElement('p');p.className='lyrics-line';p.textContent='暂无歌词';lines.append(p);}current=-2;
  }
  const seconds=a?.currentTime??editor?.elapsed??0;let next=-1;for(let i=0;i<rows.length;i++)if(rows[i].time!==null&&rows[i].time<=seconds)next=i;
  if(next!==current){for(let i=0;i<rows.length;i++)rows[i].node.classList.toggle('is-current',i===next);current=next;}
  if(next>=0&&Date.now()>=holdUntil){const node=rows[next].node,target=node.offsetTop-lines.offsetTop-scroller.clientHeight/2+node.offsetHeight/2;if(Math.abs(scroller.scrollTop-target)>3)scroller.scrollTo({top:target,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
 }
 setInterval(update,180);window.lyricPlayer={open,close,update};
})();
