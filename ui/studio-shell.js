'use strict';
const studioPlayer={
 active:null,score:null,volume:1,muted:false,loop:false,segments:new WeakMap(),
 time(v){return `${Math.floor((Number(v)||0)/60)}:${String(Math.floor((Number(v)||0)%60)).padStart(2,'0')}`;},
 duration(audio){if(Number.isFinite(audio.duration))return audio.duration;try{const url=new URL(audio.src),source=[...voiceSources,...coverSources].find(s=>s.id===url.hostname),job=jobs.find(j=>j.id===url.hostname);return source?.seconds||job?.result?.seconds||(job?job.request.end-job.request.start:0)||Number(audio.dataset.seconds)||0;}catch{return 0;}},
 description(audio){
  const labels={'voice-source-audio':'原曲','voice-reference-audio':'目标音色参考','cover-source-audio':'Cover 原曲','voice-original':'原唱对比','voice-output':'新音色混音','voice-vocal-preview':'转换后纯人声','cover-original':'原片段对比','cover-output':'Cover 成品','timbre-audio':'人声预设'};
  let title=labels[audio.id]||'本地音频',job=null;
  try{const url=new URL(audio.src);job=jobs.find(j=>j.id===url.hostname);const source=[...voiceSources,...coverSources].find(s=>s.id===url.hostname);title=job?.request.title||source?.name||title;}catch{}
  return {title,detail:labels[audio.id]||'生成作品 · 本地音频',job};
 },
 select(audio){
  if(this.score){this.score.stop();this.score=null;}
  for(const a of $$('audio'))if(a!==audio)a.pause();
  this.active=audio;audio.volume=this.volume;audio.muted=this.muted;this.update();window.generatedScore?.onAudioSelected(audio);
 },
 async clip(audio,start,end){
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>this.duration(audio)+.02)throw Error('请选择有效的音频片段');
  this.segments.set(audio,{start,end});audio.currentTime=start;await this.start(audio);
 },
 clearClip(audio){this.segments.delete(audio);if(audio.id==='cover-source-audio')clipStop=null;},
 async start(audio){try{await audio.play();}catch(e){if(e.name!=='AbortError')throw e;}},
 adoptScore(editor){window.generatedScore?.deactivate();this.active?.pause();this.active=null;this.score=editor;this.update();},
 bounds(){const a=this.active;return a?(this.segments.get(a)||{start:0,end:this.duration(a)}):{start:0,end:this.score?.doc?.seconds||0};},
 update(){
  const a=this.active,s=this.score,{start,end}=this.bounds(),ready=a?!!a.getAttribute('src')&&a.readyState>=1&&!a.error:!!s?.doc,playing=a?!a.paused:!!s?.playTimer;
  const meta=a?this.description(a):s?{title:s.title.value||'当前乐谱',detail:'乐谱试听 · 合成音色'}:{title:'选择一首作品，开始试听',detail:'音乐、原曲、参考声音与乐谱共用此播放器'};
  $('#global-title').textContent=meta.title;$('#global-detail').textContent=meta.detail+(start||a&&this.segments.has(a)?` · 选段 ${this.time(start)}–${this.time(end)}`:'');
  $('#global-play').disabled=!ready;$('#global-stop').disabled=!ready;$('#global-play').setAttribute('aria-label',playing?'暂停':'播放');
  if($('#global-play').dataset.playing!==String(playing)){$('#global-play').dataset.playing=String(playing);$('#global-play').innerHTML=`<i data-icon="${playing?'player-pause':'player-play'}"></i>`;drawIcons($('#global-play'));}
  const seek=$('#global-seek');seek.disabled=!ready||!end;seek.min=start;seek.max=Math.max(start+.01,end);if(!this.seeking)seek.value=Math.max(start,Math.min(end,a?a.currentTime:s?.elapsed||0));
  $('#global-current').textContent=this.time(this.seeking?Number(seek.value):a?a.currentTime:s?.elapsed);$('#global-duration').textContent=this.time(end);seek.style.setProperty('--played',`${end>start?(Number(seek.value)-start)/(end-start)*100:0}%`);
  const playlist=jobs.filter(j=>j.status==='completed'&&!['transcribe','lyrics','music-style'].includes(j.request.kind));
  $('#global-prev').disabled=$('#global-next').disabled=playlist.length===0;
  this.exportJob=meta.job&&a?.src.endsWith('/audio.flac')?meta.job:null;$('#global-export').disabled=!this.exportJob;
  document.querySelector('.record-art').classList.toggle('is-playing',playing);
 },
 async toggle(){if(this.score){if(this.score.playTimer)this.score.pause();else await this.score.play(this.score.elapsed||0);}
  else if(this.active){const a=this.active,{start,end}=this.bounds();if(a.paused){if(a.currentTime>=end-.04||a.currentTime<start)a.currentTime=start;await this.start(a);}else a.pause();}this.update();},
 stop(){if(this.score)this.score.stop();if(this.active){this.active.pause();this.active.currentTime=this.bounds().start;}this.update();},
 async seek(value){const {start,end}=this.bounds();if(!Number.isFinite(value))return;value=Math.max(start,Math.min(end,value));if(this.score){const s=this.score,playing=!!s.playTimer;s.pause();s.elapsed=value;if(playing)await s.play(value);else{s.revealPlaybackScore();s.updatePlaybackPosition(value);}}
  else if(this.active)this.active.currentTime=value;this.update();},
 async next(direction){const list=jobs.filter(j=>j.status==='completed'&&!['transcribe','lyrics','music-style'].includes(j.request.kind));if(!list.length)return;const id=this.active?this.description(this.active).job?.id:null,index=list.findIndex(j=>j.id===id);await play(list[index<0?0:(index+direction+list.length)%list.length]);},
 setVolume(){for(const audio of $$('audio')){audio.volume=this.volume;audio.muted=this.muted;}for(const editor of Object.values(workbenchEditors))if(editor.masterGain)editor.masterGain.gain.value=this.muted?0:this.volume;$('#global-mute').setAttribute('aria-pressed',String(this.muted));$('#global-mute').setAttribute('aria-label',this.muted?'取消静音':'静音');$('#global-mute').innerHTML=`<i data-icon="${this.muted?'volume-off':'volume'}"></i>`;drawIcons($('#global-mute'));},
 bind(audio){
  audio.controls=false;
  audio.addEventListener('play',()=>{this.select(audio);if(audio.id==='cover-source-audio'&&clipStop!==null&&this.segments.get(audio)?.end!==clipStop)this.segments.set(audio,{start:audio.currentTime,end:clipStop});this.update();});
  audio.addEventListener('timeupdate',()=>{const range=this.segments.get(audio);if(range&&audio.currentTime>=range.end-.015&&!audio.paused){audio.pause();audio.currentTime=range.end;if(audio.id==='cover-source-audio')clipStop=null;if(this.loop){audio.currentTime=range.start;this.start(audio).catch(e=>toast(e.message,true));}}if(this.active===audio)this.update();});
  audio.addEventListener('ended',()=>{if(this.loop&&this.active===audio){audio.currentTime=this.bounds().start;this.start(audio).catch(e=>toast(e.message,true));}this.update();});
  audio.addEventListener('emptied',()=>{this.clearClip(audio);if(this.active===audio){if(!audio.getAttribute('src')){this.active=null;window.generatedScore?.deactivate();window.generatedScore?.hide();}this.update();}});
  for(const event of ['loadedmetadata','durationchange','pause','error'])audio.addEventListener(event,()=>{if(event==='loadedmetadata'&&!this.active&&!this.score)this.select(audio);if(this.active===audio)this.update();});
 }
};
window.studioPlayer=studioPlayer;
for(const audio of $$('audio'))studioPlayer.bind(audio);
for(const button of $$('[data-listen]'))button.onclick=safe(async()=>{const a=$('#'+button.dataset.listen);studioPlayer.clearClip(a);if(!a.getAttribute('src'))throw Error('请先选择一份已完成的作品');if(studioPlayer.active===a&&!a.paused)a.pause();else await studioPlayer.start(a);});
$('#global-play').onclick=safe(()=>studioPlayer.toggle());$('#global-stop').onclick=()=>studioPlayer.stop();
$('#global-prev').onclick=safe(()=>studioPlayer.next(-1));$('#global-next').onclick=safe(()=>studioPlayer.next(1));
$('#global-loop').onclick=()=>{studioPlayer.loop=!studioPlayer.loop;$('#global-loop').setAttribute('aria-pressed',String(studioPlayer.loop));};
$('#global-volume').oninput=e=>{studioPlayer.volume=Number(e.target.value);studioPlayer.muted=false;studioPlayer.setVolume();};
$('#global-mute').onclick=()=>{studioPlayer.muted=!studioPlayer.muted;studioPlayer.setVolume();};
$('#global-seek').onpointerdown=()=>{studioPlayer.seeking=true;};
$('#global-seek').oninput=()=>{studioPlayer.seeking=true;studioPlayer.update();};
$('#global-seek').onchange=safe(async e=>{const value=Number(e.target.value);try{await studioPlayer.seek(value);}finally{studioPlayer.seeking=false;studioPlayer.update();}});
$('#global-seek').onblur=$('#global-seek').onpointercancel=()=>{studioPlayer.seeking=false;studioPlayer.update();};
$('#global-export').onclick=safe(async()=>{if(studioPlayer.exportJob&&await api.exportAudio(studioPlayer.exportJob.id,'wav'))toast('音频已导出');});
studioPlayer.update();

const taskDrawer={
 pinned:false,filter:'active',signature:'',seen:null,timer:null,
 open(){clearTimeout(this.timer);$('#task-drawer').hidden=false;for(const id of ['task-handle','global-queue'])$('#'+id).setAttribute('aria-expanded','true');},
 close(force=false){clearTimeout(this.timer);if(this.pinned&&!force)return;$('#task-drawer').hidden=true;for(const id of ['task-handle','global-queue'])$('#'+id).setAttribute('aria-expanded','false');},
 later(){clearTimeout(this.timer);this.timer=setTimeout(()=>{if(!document.querySelector('.task-shelf').matches(':hover,:focus-within'))this.close();},650);},
 refresh(){
  const active=jobs.filter(j=>['running','queued'].includes(j.status));$('#task-count').textContent=$('#global-task-count').textContent=active.length;
  $('#task-summary').textContent=active.length?`${active.filter(j=>j.status==='running').length} 项执行中 · ${active.filter(j=>j.status==='queued').length} 项等待`:'当前没有进行中的任务';
  const stages=new Map(jobs.map(j=>[j.id,j.status]));if(this.seen&&jobs.some(j=>!this.seen.has(j.id)&&['running','queued'].includes(j.status))){this.filter='active';this.open();this.timer=setTimeout(()=>this.later(),4000);}this.seen=stages;
  const list=this.filter==='active'?active:jobs;
  const signature=JSON.stringify([this.filter,list]);if(signature===this.signature)return;this.signature=signature;
  for(const b of $$('[data-task-filter]'))b.setAttribute('aria-pressed',String(b.dataset.taskFilter===this.filter));
  // Keep focus on the same action when progress updates rebuild a row.
  const focused=document.activeElement,focusId=focused?.closest('[data-job-id]')?.dataset.jobId,focusLabel=focused?.textContent;
  $('#task-items').replaceChildren(...list.map(jobRow));if(!list.length){const p=document.createElement('div');p.className='task-empty';p.innerHTML='<i data-icon="playlist"></i><strong>'+(this.filter==='active'?'队列已空，可以继续创作':'还没有任务记录')+'</strong><p>生成、转谱、歌词识别和音色转换会显示在这里。</p>';$('#task-items').append(p);}
  drawIcons($('#task-items'));if(focusId){const row=[...$('#task-items').children].find(n=>n.dataset.jobId===focusId),button=row&&[...row.querySelectorAll('button')].find(b=>b.textContent===focusLabel);button?.focus({preventScroll:true});}
 }
};
window.taskDrawer=taskDrawer;
const shelf=document.querySelector('.task-shelf');shelf.onmouseenter=()=>taskDrawer.open();shelf.onmouseleave=()=>taskDrawer.later();shelf.addEventListener('focusin',()=>taskDrawer.open());shelf.addEventListener('focusout',()=>taskDrawer.later());
for(const id of ['task-handle','global-queue'])$('#'+id).onclick=()=>{$('#task-drawer').hidden?taskDrawer.open():taskDrawer.close(true);};
$('#task-close').onclick=()=>{taskDrawer.pinned=false;$('#task-pin').setAttribute('aria-pressed','false');$('#global-queue').focus();taskDrawer.close(true);};
$('#task-pin').onclick=()=>{taskDrawer.pinned=!taskDrawer.pinned;$('#task-pin').setAttribute('aria-pressed',String(taskDrawer.pinned));};
for(const button of $$('[data-task-filter]'))button.onclick=()=>{taskDrawer.filter=button.dataset.taskFilter;taskDrawer.refresh();};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.isComposing&&!confirmDialog.open&&!$('#task-drawer').hidden){$('#global-queue').focus();taskDrawer.close(true);}});

let appearanceState=null,appearanceWrites=Promise.resolve();
function applyAppearance(value){
 appearanceState=value;const root=document.documentElement;root.dataset.theme=value.theme;root.style.setProperty('--accent',value.accent);root.style.setProperty('--wallpaper-overlay',value.overlay/100);root.style.setProperty('--wallpaper-blur',value.blur+'px');
 root.style.removeProperty('--muted');
 const css=getComputedStyle(root),surfaces=['--bg','--surface','--surface-raised','--input','--sidebar-bg'].map(name=>css.getPropertyValue(name).trim()),palette=ThemePalette.palette(value.accent,surfaces,css.getPropertyValue('--muted').trim());
 for(const [name,color] of Object.entries({'accent-text':palette.text,'accent-line':palette.line,'accent-control':palette.control,'on-accent':palette.onAccent,'on-control':palette.onControl,'score-accent':palette.score,muted:palette.muted}))root.style.setProperty('--'+name,color);
 $('#studio-wallpaper').hidden=!value.image;if(value.image)$('#studio-wallpaper').src=value.image;else $('#studio-wallpaper').removeAttribute('src');root.classList.toggle('has-wallpaper',!!value.image);
 for(const b of $$('button[data-theme]'))b.setAttribute('aria-pressed',String(b.dataset.theme===value.theme));
 $('#appearance-accent').value=value.accent;$('#appearance-overlay').value=value.overlay;$('#appearance-blur').value=value.blur;$('#appearance-overlay-value').value=value.overlay+'%';$('#appearance-blur-value').value=value.blur+'px';$('#appearance-remove').disabled=!value.image;
 for(const region of window.voiceRegions||[])region.draw();
 workbenchEditors.cover.wave?.draw();
}
function saveAppearance(){
 const snapshot={theme:appearanceState.theme,accent:$('#appearance-accent').value,overlay:Number($('#appearance-overlay').value),blur:Number($('#appearance-blur').value)};applyAppearance({...appearanceState,...snapshot});$('#appearance-status').textContent='正在保存…';
 appearanceWrites=appearanceWrites.catch(()=>{}).then(()=>api.saveAppearance(snapshot)).then(()=>{$('#appearance-status').textContent='外观已保存';}).catch(e=>{$('#appearance-status').textContent='保存失败';toast(e.message,true);});return appearanceWrites;
}
for(const button of $$('[data-theme]'))button.onclick=()=>{if(!appearanceState)return;appearanceState.theme=button.dataset.theme;$('#appearance-accent').value={classic:'#d4edaa',dark:'#38bdf8',light:'#da304e'}[appearanceState.theme];saveAppearance();};
for(const id of ['accent','overlay','blur'])$('#appearance-'+id).oninput=()=>{if(appearanceState)saveAppearance();};
for(const [id,method] of [['import','importBackground'],['remove','removeBackground']])$('#appearance-'+id).onclick=safe(async()=>{await appearanceWrites;const value=await api[method]();if(value){applyAppearance(value);$('#appearance-status').textContent='外观已保存';}});
document.addEventListener('DOMContentLoaded',safe(async()=>{applyAppearance(await api.getAppearance());taskDrawer.refresh();drawIcons(document.querySelector('.studio-player'));drawIcons(shelf);}),{once:true});
