'use strict';
// A saved work is previewed without replacing either editable draft.
const generatedScore={job:null,audio:null,doc:null,loadVersion:0,nodes:new Map(),timer:null,
 init(){
  this.page=$('#page-library');this.panel=document.createElement('section');this.panel.id='generated-score-view';this.panel.className='generated-score-view';this.panel.hidden=true;
  this.panel.innerHTML='<div class="generated-score-heading"><button id="generated-score-back" class="button secondary small">返回作品</button><div><h2 id="generated-score-title"></h2><p>作品试听 · 播放已生成音频</p></div></div><div class="generated-score-toolbar"><span id="generated-score-position">正在载入乐谱…</span><p class="help">点击音符可定位 · 按乐谱节拍跟随，实际演唱可能有偏移</p><select id="generated-score-voice" aria-label="作品乐谱声部"><option value="Vocal">人声谱</option><option value="all">完整总谱</option><option value="Ins">器乐谱</option></select></div><p class="generated-score-message" id="generated-score-message" role="status"></p><div class="score-scroll" id="generated-score-scroll"><div class="score-paper" id="generated-score-paper"></div></div>';
  this.page.append(this.panel);this.paper=$('#generated-score-paper');this.staff=$('#generated-score-scroll');
  this.panel.querySelector('.generated-score-toolbar .help').outerHTML='<span id="generated-sync-status" class="help" role="status">正在分析音频同步…</span><button id="generated-sync-toggle" class="button secondary small" aria-expanded="false">同步校正</button>';
  const controls=document.createElement('div');controls.className='generated-sync-controls';controls.id='generated-sync-controls';controls.hidden=true;
  controls.innerHTML='<p>暂停在听到的字或音符上，再点谱面对应音符，按「对齐到当前声音」。在后面再标一点可校正速度差；不会修改歌曲和乐谱。</p><div><span id="generated-sync-selection">先选择对应音符</span><button id="generated-sync-add" class="button secondary small" disabled>对齐到当前声音</button><button id="generated-sync-undo" class="text-button">移除末尾校正点</button><button id="generated-sync-reset" class="text-button">恢复自动同步</button></div><p id="generated-sync-feedback" role="status"></p>';
  this.panel.querySelector('.generated-score-toolbar').after(controls);
  $('#generated-sync-toggle').onclick=()=>{controls.hidden=!controls.hidden;$('#generated-sync-toggle').setAttribute('aria-expanded',String(!controls.hidden));this.calibrating=!controls.hidden;this.selected=null;this.lastFollowIndex=null;this.updateCalibration();};
  $('#generated-sync-add').onclick=()=>this.saveAnchor().catch(e=>{$('#generated-sync-feedback').textContent=e.message;});
  $('#generated-sync-undo').onclick=()=>this.saveAnchors((this.timing?.anchors||[]).slice(0,-1)).catch(e=>{$('#generated-sync-feedback').textContent=e.message;});
  $('#generated-sync-reset').onclick=()=>this.saveAnchors([]).catch(e=>{$('#generated-sync-feedback').textContent=e.message;});
  $('#generated-score-back').onclick=()=>this.hide();$('#generated-score-voice').onchange=()=>this.render();
  const link=document.createElement('button');link.id='global-score';link.className='text-button generated-score-link';link.textContent='乐谱';link.hidden=true;link.onclick=()=>this.reveal();$('#global-export').before(link);
  window.addEventListener('resize',()=>{clearTimeout(this.resizeTimer);this.resizeTimer=setTimeout(()=>{if(!this.page.hidden&&!this.panel.hidden)this.render();},180);});
 },
 hide(){this.page.classList.remove('library-preview');this.panel.hidden=true;},
 reveal(){if(!this.job)return;navigate('library');this.page.classList.add('library-preview');this.panel.hidden=false;this.render();},
 deactivate(){this.loadVersion++;clearInterval(this.timer);this.timer=null;this.audio=null;$('#global-score').hidden=true;for(const node of this.nodes.values())node.classList.remove('playing-note');},
 onAudioSelected(audio){
  const {job}=studioPlayer.description(audio);let path='';try{path=new URL(audio.src).pathname;}catch{}
  if(audio.id!=='audio'||!job||path!=='/audio.flac'){this.deactivate();this.hide();return;}
  this.open(job,audio).catch(e=>toast(e.message,true));
 },
 async open(job,audio){
  const version=++this.loadVersion,same=this.job?.id===job.id;this.job=job;this.audio=audio;$('#global-score').hidden=false;$('#generated-score-title').textContent=job.request.title;
  clearInterval(this.timer);this.timer=setInterval(()=>this.sync(),80);
  if(!same){this.doc=null;this.abc=null;this.timing=null;this.mapping=ScoreTiming.map(null);this.selected=null;this.message='正在载入作品乐谱…';this.nodes.clear();this.paper.replaceChildren();$('#generated-sync-feedback').textContent='';}
  this.reveal();if(same&&this.loaded){if(this.doc&&!this.timing)this.loadTiming(job,version);this.sync();return;}
  this.loaded=false;
  try{
   const abc=await api.score(job.id);if(version!==this.loadVersion||studioPlayer.active!==audio)return;
   this.abc=abc;this.doc=abc?ScoreModel.assertValid(abc):null;this.binding=this.doc?ScoreModel.align(this.doc,job.request.lyrics||''):null;
   this.message=abc?'':'这份作品没有附带乐谱，可继续试听音频。';
  }catch{if(version!==this.loadVersion)return;this.doc=null;this.message='这份作品的乐谱暂时无法显示，可继续试听音频。';}
  if(version!==this.loadVersion)return;this.loaded=true;this.render();if(this.doc)this.loadTiming(job,version);
 },
 async loadTiming(job,version){
  this.syncPending=true;$('#generated-sync-status').textContent='正在分析歌词时间 · 首次约需 1–3 分钟，可继续听歌';this.updateCalibration();
  try{const value=await api.scoreTiming(job.id);if(version!==this.loadVersion)return;this.timing=value;this.mapping=ScoreTiming.map(value.analysis,value.anchors);}
  catch(e){if(version!==this.loadVersion)return;this.timing={error:e.message,anchors:[],analysis:null};this.mapping=ScoreTiming.map(null);}
  if(version!==this.loadVersion)return;this.syncPending=false;this.timingStatus();this.updateCalibration();this.sync();
 },
 timingStatus(){const count=this.timing?.anchors?.length||0,a=this.timing?.analysis;$('#generated-sync-status').textContent=count?'已手动校正 '+count+' 个位置':a?.accepted?(a.method==='qwen3-forced-aligner'?'歌词时间对齐 · 自动估计 · '+a.events.length+'/'+a.totalWords+' 字已定位，未定位处不高亮':'旋律匹配 · 估计位置，可手动校正'):this.timing?.error||'未能可靠定位 · 暂停自动高亮，可手动校正';},
 updateCalibration(){
  $('#generated-sync-selection').textContent=this.selected?'已选第 '+(this.selected.bar+1)+' 小节 · 谱面 '+(this.selected.onset*60/this.doc.bpm).toFixed(2)+' 秒':'先选择对应音符';
  $('#generated-sync-add').disabled=!this.selected||!this.timing?.key||this.syncPending||this.saving;
  $('#generated-sync-undo').disabled=$('#generated-sync-reset').disabled=!this.timing?.anchors?.length||this.syncPending||this.saving;
  for(const [i,node]of this.nodes)node.classList.toggle('selected-note',this.calibrating&&this.selected?.index===i);
 },
 async saveAnchor(){if(!this.selected||!this.audio)return;this.audio.pause();const audioTime=this.audio.currentTime,scoreTime=this.selected.onset*60/this.doc.bpm;await this.saveAnchors(ScoreTiming.insert(this.timing?.anchors||[],audioTime,scoreTime));},
 async saveAnchors(anchors){
  if(!this.timing?.key||this.saving)return;const id=this.job.id;this.saving=true;this.updateCalibration();
  try{const timing=await api.saveScoreTiming(id,this.timing.key,anchors);if(this.job.id!==id)return;this.timing=timing;this.mapping=ScoreTiming.map(timing.analysis,timing.anchors);this.timingStatus();$('#generated-sync-feedback').textContent=anchors.length?'同步校正已保存，仅用于当前作品试听':'已恢复自动同步';this.sync();}
  finally{this.saving=false;this.updateCalibration();}
 },
 clickNote(token){
  if(!token||studioPlayer.active!==this.audio)return;
  if(this.calibrating){this.audio.pause();this.selected=token;this.updateCalibration();return;}
  const analysis=this.timing?.analysis,wordMode=analysis?.accepted&&analysis.method==='qwen3-forced-aligner'&&!this.timing.anchors?.length;
  const cue=wordMode?analysis.events.find(e=>e.tokens.includes(token.index)):null;
  if(wordMode&&token.voice==='Vocal'&&token.kind==='note'&&!cue){toast('这个字的实际演唱时间尚未可靠定位，可用同步校正',true);return;}
  const seconds=cue?cue.start:this.mapping.toAudio(token.onset*60/this.doc.bpm);
  if(seconds>studioPlayer.duration(this.audio)+.1){toast('这段音频没有生成到此处，无法跳转',true);return;}
  studioPlayer.seek(seconds).catch(e=>toast(e.message,true));
 },
 render(){
  if(this.page.hidden||this.panel.hidden)return;
  $('#generated-score-message').textContent=this.message||'';$('#generated-score-message').hidden=!!this.doc;this.staff.hidden=!this.doc;
  $('#generated-score-voice').disabled=$('#generated-sync-toggle').disabled=!this.doc;this.nodes.clear();
  if(!this.doc){$('#generated-sync-status').textContent='';$('#generated-sync-controls').hidden=true;this.calibrating=false;$('#generated-sync-toggle').setAttribute('aria-expanded','false');}
  if(!this.doc){this.paper.replaceChildren();$('#generated-score-position').textContent='作品乐谱';return;}
  const rendered=ScoreModel.renderSource(this.doc,this.binding,this.job.request.title,$('#generated-score-voice').value,Pronunciation.labels(this.binding,this.job.request.pronunciation)),offsets=rendered.renderOffsets;
  const find=(start,end)=>offsets.get(start)||[...offsets].find(([pos])=>pos>=start&&pos<end)?.[1];
  const tune=ABCJS.renderAbc(this.paper,rendered.text,{add_classes:true,foregroundColor:'#20282e',responsive:'resize',staffwidth:Math.max(490,this.staff.clientWidth-46),oneSvgPerLine:true,paddingtop:12,paddingleft:12,paddingright:12,paddingbottom:25,format:{barnumbers:1,vocalfont:'Microsoft YaHei 15',titlefont:'Microsoft YaHei 18',staffsep:55},selectTypes:['note'],clickListener:element=>this.clickNote(find(element.startChar,element.endChar))})[0];
  for(const item of tune?.engraver?.selectables||[]){const e=item.absEl?.abcelem;if(e?.el_type!=='note')continue;const t=find(e.startChar,e.endChar);if(t){item.svgEl.dataset.tokenIndex=t.index;this.nodes.set(t.index,item.svgEl);}}
  this.lastFollowIndex=null;this.updateCalibration();this.sync();
 },
 sync(){
  if(!this.doc||!this.audio||studioPlayer.active!==this.audio||this.page.hidden||this.panel.hidden)return;
  studioPlayer.update();
  const seconds=this.audio.currentTime,scoreSeconds=this.mapping.toScore(seconds),beat=scoreSeconds*this.doc.bpm/60;let current=null,token=null;
  const analysis=this.timing?.analysis,manual=!!this.timing?.anchors?.length,ready=!this.syncPending&&(manual||analysis?.accepted),wordMode=!manual&&analysis?.method==='qwen3-forced-aligner',cue=wordMode?ScoreTiming.wordAt(analysis,seconds):null;
  for(const [index,node] of this.nodes){const t=this.doc.tokens[index],active=ready&&(wordMode&&t.voice==='Vocal'?!!cue?.tokens.includes(index):beat>=t.onset&&beat<t.onset+t.duration);node.classList.toggle('playing-note',active);if(active&&(!current||t.voice==='Vocal')){current=node;token=t;}}
  // Seeking into a breath/interlude still reveals the last located lyric;
  // it must not light up the missing words between reliable intervals.
  if(ready&&wordMode&&!current){const previous=analysis.events.findLast(e=>e.start<=seconds),index=previous?.tokens[0]??this.nodes.keys().next().value;current=this.nodes.get(index);token=current?this.doc.tokens[index]:null;}
  $('#generated-score-position').textContent=(token?'第 '+(token.bar+1)+' 小节 · ':'')+studioPlayer.time(seconds)+(ready&&wordMode&&!cue?' · 暂无可靠字音':'');
  const follow=this.lastFollowIndex!==token?.index||Math.abs(seconds-(this.lastFollowTime??seconds))>.4;
  this.lastFollowIndex=token?.index;this.lastFollowTime=seconds;
  if(current&&!this.calibrating&&follow){const view=this.staff.getBoundingClientRect(),system=current.ownerSVGElement.getBoundingClientRect(),note=current.getBoundingClientRect(),r=system.height<this.staff.clientHeight-32?system:note;if(r.top<view.top+16||r.bottom>view.top+this.staff.clientHeight-16)this.staff.scrollTop+=r.top-view.top-16;if(note.left<view.left+16||note.right>view.left+this.staff.clientWidth-16)this.staff.scrollLeft+=note.left-view.left-16;}
 }
};
window.generatedScore=generatedScore;generatedScore.init();
