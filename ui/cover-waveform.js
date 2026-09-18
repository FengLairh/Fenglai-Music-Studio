'use strict';
// One audio element drives the transport, waveform playhead and lyric preview.
class CoverWaveform {
 constructor(host){
  this.host=host;this.duration=0;this.id=null;this.token=0;this.drag=null;this.peaks=null;this.frameId=null;
  this.audio=$('#cover-source-audio');this.start=$('#cover-start');this.end=$('#cover-end');
  const content=$('#cover-source-content'),strip=$('#page-cover .source-strip');
  strip.querySelector('.source-head').append($('#cover-source'));strip.querySelector('.source-content').before(content);
  this.panel=document.createElement('div');this.panel.className='source-wave-player';
  this.panel.innerHTML='<div class="wave-transport"><button id="cover-wave-play" class="wave-play" aria-label="播放原曲" title="播放 / 暂停原曲">▶</button><span id="cover-wave-time" class="wave-time">0:00 / 0:00</span><span class="wave-toolbar-spacer"></span><details id="cover-wave-precision" class="wave-precision"><summary title="输入精确的选段起止时间"><span id="cover-wave-range">选段时间</span><span class="wave-chevron">⌄</span></summary></details><div class="wave-volume"><button id="cover-wave-mute" class="text-button" aria-label="静音" title="静音 / 取消静音">音量</button><input id="cover-wave-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="原曲音量"></div></div><div class="source-waveform" id="cover-wave-track" tabindex="0" role="slider" aria-label="原曲播放位置" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0" aria-describedby="cover-wave-help"><canvas id="cover-waveform" height="72" aria-hidden="true"></canvas><div id="cover-wave-progress"></div><div id="cover-wave-selection" tabindex="0" role="group" aria-label="移动选段"><button type="button" class="wave-handle wave-handle-start" id="cover-wave-start" role="slider" aria-label="选段开始时间" aria-orientation="horizontal"><span></span></button><button type="button" class="wave-handle wave-handle-end" id="cover-wave-end" role="slider" aria-label="选段结束时间" aria-orientation="horizontal"><span></span></button></div><div id="cover-wave-playhead"><span></span></div><span id="cover-wave-message" role="status">选择原曲后显示波形</span></div><div class="wave-footer"><span id="cover-wave-help">点击跳转 · 拖两端裁剪 · 拖选区移动 · 空白处拖选</span><span id="cover-wave-length"></span><button id="cover-wave-retry" class="text-button" hidden>重载波形</button></div>';
  const fields=content.querySelector('.clip-fields'),clip=$('#cover-play-clip');
  this.panel.querySelector('.wave-precision').append(fields);this.panel.querySelector('.wave-volume').before(clip);
  content.replaceChildren(this.panel,this.audio,$('#cover-source-info'));
  this.audio.controls=false;this.audio.hidden=true;$('#cover-source-info').hidden=true;this.start.step=this.end.step='0.01';
  this.track=$('#cover-wave-track');this.canvas=$('#cover-waveform');this.selection=$('#cover-wave-selection');
  this.track.addEventListener('pointerdown',e=>this.begin(e));this.track.addEventListener('pointermove',e=>this.move(e));
  this.track.addEventListener('pointerup',e=>this.finish(e));
  this.track.addEventListener('pointercancel',()=>this.cancel());this.track.addEventListener('lostpointercapture',()=>this.cancel());
  this.track.addEventListener('keydown',safe(e=>this.key(e)));
  $('#cover-wave-play').onclick=safe(()=>this.toggle());$('#cover-wave-mute').onclick=()=>{this.audio.muted=!this.audio.muted;this.transport();};
  $('#cover-wave-volume').oninput=e=>{this.audio.volume=Number(e.target.value);this.audio.muted=false;};
  $('#cover-wave-retry').onclick=()=>{this.id=null;this.update();};
  for(const event of ['timeupdate','seeking','seeked','loadedmetadata','durationchange','volumechange','emptied','ended','pause','play','error'])this.audio.addEventListener(event,()=>{this.transport();if(event==='play')this.animate();});
  for(const input of [this.start,this.end])input.addEventListener('change',()=>this.precise(input));
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('#cover-wave-precision'))$('#cover-wave-precision').open=false;});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){$('#cover-wave-precision').open=false;this.cancel();}});
  this.observer=new ResizeObserver(()=>this.draw());this.observer.observe(this.track);this.transport();
 }
 time(value,decimal=false){value=Math.max(0,Number(value)||0);if(decimal)value=Math.round(value*100)/100;const seconds=decimal?(value%60).toFixed(2).padStart(5,'0'):String(Math.floor(value%60)).padStart(2,'0');return `${Math.floor(value/60)}:${seconds}`;}
 values(){return {start:Number(this.start.value),end:Number(this.end.value)};}
 set(start,end){this.start.value=(Math.round(start*100)/100).toFixed(2);this.end.value=(Math.round(end*100)/100).toFixed(2);this.renderRange();}
 commit(before){const now=this.values();if(now.start===before.start&&now.end===before.end)return;clipStop=null;window.studioPlayer?.clearClip(this.audio);this.start.dispatchEvent(new Event('input',{bubbles:true}));}
 at(e){const box=this.track.getBoundingClientRect();return Math.max(0,Math.min(this.duration,(e.clientX-box.left)/box.width*this.duration));}
 begin(e){
  if(!this.duration||e.button!==0||this.drag||this.audio.readyState<1)return;
  const at=this.at(e),v=this.values(),handle=e.target.closest('.wave-handle');
  const mode=handle?(handle.id==='cover-wave-start'?'start':'end'):!e.shiftKey&&at>=v.start&&at<=v.end?'move':'range';
  this.drag={...v,anchor:at,x:e.clientX,mode,pointerId:e.pointerId,moved:false};
  try{this.track.setPointerCapture(e.pointerId);}catch{}e.preventDefault();
  (handle||this.selection.contains(e.target)&&this.selection||this.track).focus({preventScroll:true});
 }
 move(e){
  const d=this.drag;if(!d||e.pointerId!==d.pointerId)return;if(!d.moved&&Math.abs(e.clientX-d.x)<3)return;d.moved=true;
  const at=this.at(e),min=Math.min(5,this.duration),max=Math.min(300,this.duration);let start=d.start,end=d.end;
  if(d.mode==='start')start=Math.max(0,end-max,Math.min(at,end-min));
  else if(d.mode==='end')end=Math.min(this.duration,start+max,Math.max(at,start+min));
  else if(d.mode==='move'){const width=Math.min(max,Math.max(min,d.end-d.start));start=Math.max(0,Math.min(this.duration-width,d.start+at-d.anchor));end=start+width;}
  else {const width=Math.max(min,Math.min(max,Math.abs(at-d.anchor)));start=at>=d.anchor?d.anchor:d.anchor-width;start=Math.max(0,Math.min(this.duration-width,start));end=start+width;}
  this.track.classList.add('is-dragging');this.set(start,end);
 }
 finish(e){
  const d=this.drag;if(!d||e.pointerId!==d.pointerId)return;this.drag=null;this.track.classList.remove('is-dragging');
  if(this.track.hasPointerCapture(e.pointerId))this.track.releasePointerCapture(e.pointerId);
  if(d.moved)this.commit(d);else if(d.mode==='move'||d.mode==='range')this.seek(this.at(e));
 }
 cancel(){const d=this.drag;if(!d)return;this.drag=null;this.track.classList.remove('is-dragging');this.set(d.start,d.end);if(this.track.hasPointerCapture(d.pointerId))this.track.releasePointerCapture(d.pointerId);}
 seek(at){if(!this.duration||this.audio.readyState<1)return;clipStop=null;window.studioPlayer?.clearClip(this.audio);window.studioPlayer?.select(this.audio);this.audio.currentTime=Math.max(0,Math.min(this.duration,at));this.transport();}
 async toggle(){if(!this.audio.paused){this.audio.pause();return;}clipStop=null;window.studioPlayer?.clearClip(this.audio);if(this.audio.ended)this.audio.currentTime=0;await window.studioPlayer.start(this.audio);}
 key(e){
  if(!this.duration)return;
  if(e.key===' '&&e.target===this.track){e.preventDefault();return this.toggle();}
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();
  const step=e.shiftKey?1:.1,delta=e.key==='ArrowLeft'?-step:step,before=this.values(),min=Math.min(5,this.duration),max=Math.min(300,this.duration);
  let {start,end}=before;
  if(e.target.id==='cover-wave-start'){const low=Math.max(0,end-max),high=end-min;start=Math.max(low,Math.min(high,e.key==='Home'?low:e.key==='End'?high:start+delta));}
  else if(e.target.id==='cover-wave-end'){const low=start+min,high=Math.min(this.duration,start+max);end=Math.max(low,Math.min(high,e.key==='Home'?low:e.key==='End'?high:end+delta));}
  else if(e.target===this.selection){const width=end-start;start=Math.max(0,Math.min(this.duration-width,e.key==='Home'?0:e.key==='End'?this.duration-width:start+delta));end=start+width;}
  else {this.seek(e.key==='Home'?0:e.key==='End'?this.duration:this.audio.currentTime+delta*10);return;}
  this.set(start,end);this.commit(before);
 }
 precise(input){
  if(!this.duration)return;const before=this.values(),min=Math.min(5,this.duration),max=Math.min(300,this.duration);let {start,end}=before;
  if(input===this.start){end=Math.max(min,Math.min(this.duration,Number.isFinite(end)?end:this.duration));start=Math.max(0,end-max,Math.min(Number.isFinite(start)?start:0,end-min));}
  else {start=Math.max(0,Math.min(this.duration-min,Number.isFinite(start)?start:0));end=Math.min(this.duration,start+max,Math.max(Number.isFinite(end)?end:start+min,start+min));}
  this.set(start,end);this.commit(before);
 }
 renderRange(){
  const v=this.values(),valid=this.duration&&Number.isFinite(v.start)&&Number.isFinite(v.end)&&v.end>v.start;
  this.selection.hidden=!valid;$('#cover-wave-range').textContent=valid?`${this.time(v.start,true)} – ${this.time(v.end,true)}`:'选段时间';
  $('#cover-wave-length').textContent=valid?`已选 ${(v.end-v.start).toFixed(2)} 秒`:'';
  if(!valid)return;const start=Math.max(0,Math.min(100,v.start/this.duration*100)),end=Math.max(start,Math.min(100,v.end/this.duration*100));
  this.selection.style.left=start+'%';this.selection.style.width=(end-start)+'%';
  this.selection.setAttribute('aria-label',`移动选段，${this.time(v.start,true)} 至 ${this.time(v.end,true)}`);
  for(const [id,value,low,high] of [['cover-wave-start',v.start,Math.max(0,v.end-300),v.end-Math.min(5,this.duration)],['cover-wave-end',v.end,v.start+Math.min(5,this.duration),Math.min(this.duration,v.start+300)]]){
   const el=$('#'+id);el.setAttribute('aria-valuemin',low);el.setAttribute('aria-valuemax',high);el.setAttribute('aria-valuenow',value);el.setAttribute('aria-valuetext',this.time(value,true));
  }
 }
 transport(){
  // Streaming WAV headers can expose Infinity; use the import's probed duration.
  const available=!!coverSourceId&&this.duration>0&&this.audio.readyState>=1&&!this.audio.error;
  $('#cover-wave-play').disabled=!available;$('#cover-play-clip').disabled=!available;
  $('#cover-wave-play').textContent=this.audio.paused?'▶':'Ⅱ';$('#cover-wave-play').setAttribute('aria-label',this.audio.paused?'播放原曲':'暂停原曲');
  $('#cover-wave-mute').textContent=this.audio.muted||this.audio.volume===0?'静音':'音量';$('#cover-wave-mute').setAttribute('aria-pressed',String(this.audio.muted));$('#cover-wave-mute').setAttribute('aria-label',this.audio.muted?'取消静音':'静音');
  $('#cover-wave-volume').value=this.audio.muted?0:this.audio.volume;
  const current=Number.isFinite(this.audio.currentTime)?this.audio.currentTime:0,total=this.duration||0;
  $('#cover-wave-time').textContent=`${this.time(current)} / ${this.time(Math.round(total))}`;
  const progress=Math.max(0,Math.min(100,total?current/total*100:0));$('#cover-wave-progress').style.width=progress+'%';$('#cover-wave-playhead').style.left=progress+'%';$('#cover-wave-playhead').hidden=!available;
  this.track.setAttribute('aria-valuemax',total);this.track.setAttribute('aria-valuenow',current.toFixed(2));this.track.setAttribute('aria-valuetext',this.time(current,true));
  if(this.audio.paused&&this.frameId){cancelAnimationFrame(this.frameId);this.frameId=null;}
  if(this.audio.error){$('#cover-wave-message').hidden=false;$('#cover-wave-message').textContent='原曲读取失败，请重新选择音乐文件';}
 }
 animate(){if(this.frameId)return;const tick=()=>{this.frameId=null;this.transport();if(!this.audio.paused)this.frameId=requestAnimationFrame(tick);};this.frameId=requestAnimationFrame(tick);}
 load(id){return api.sourceWaveform(id);}
 async update(){
  const id=coverSourceId;if(this.id===id){this.renderRange();return;}
  this.cancel();this.id=id;this.peaks=null;this.host.peaks=null;const token=++this.token;
  this.duration=coverSources.find(s=>s.id===id)?.seconds||0;this.host.waveDuration=this.duration;
  $('#cover-source').hidden=!id;this.draw();this.renderRange();this.transport();
  const message=$('#cover-wave-message');message.hidden=false;message.textContent=id?'正在读取波形…':'选择原曲后显示波形';$('#cover-wave-retry').hidden=true;
  if(!id)return;
  try {const result=await this.load(id);if(token!==this.token)return;this.peaks=result.peaks;this.host.peaks=this.peaks;message.hidden=true;this.draw();}
  catch(e){if(token!==this.token)return;message.textContent='波形暂不可用，仍可播放和选段';$('#cover-wave-retry').hidden=false;$('#cover-wave-retry').title=inlineError(e);}
 }
 draw(){
  const width=this.track.clientWidth,height=this.track.clientHeight;if(!width||!height)return;const ratio=window.devicePixelRatio||1;
  this.canvas.width=Math.round(width*ratio);this.canvas.height=Math.round(height*ratio);const c=this.canvas.getContext('2d');c.scale(ratio,ratio);c.clearRect(0,0,width,height);
  c.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--line');c.lineWidth=1;c.beginPath();c.moveTo(0,height/2);c.lineTo(width,height/2);c.stroke();
  if(!this.peaks?.length)return;c.strokeStyle=getComputedStyle(document.documentElement).getPropertyValue('--muted');c.beginPath();
  for(let x=0;x<width;x++){const from=Math.floor(x/width*this.peaks.length),to=Math.max(from+1,Math.ceil((x+1)/width*this.peaks.length));let peak=0;for(let j=from;j<to;j++)peak=Math.max(peak,this.peaks[j]||0);const y=Math.max(1,Math.min(1,peak)*height*.42);c.moveTo(x+.5,height/2-y);c.lineTo(x+.5,height/2+y);}c.stroke();
 }
}
