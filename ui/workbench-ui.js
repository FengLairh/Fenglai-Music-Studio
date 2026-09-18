'use strict';
const workbenchEditors={};
const scoreTime=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const contentStamp=value=>ScoreModel.stamp(JSON.stringify([value.title,value.style,value.lyrics,value.abc,value.cot??value.melodyOnly,value.sourceId,value.start,value.end,value.coverMode,value.originalStyle,value.referenceAbc,value.workbench?.pronunciation]));
class ScoreWorkbench{
 constructor(mode){
  this.mode=mode;this.prefix=mode==='cover'?'cover':'song';this.page=$('#page-'+mode);this.pane=this.page.querySelector('[data-score-pane]');this.inspector=this.page.querySelector('[data-inspector]');this.source=$('#'+this.prefix+'-abc');this.lyrics=$('#'+this.prefix+'-lyrics');this.title=$('#'+this.prefix+'-title');this.paper=this.pane.querySelector('[data-score-paper]');this.staff=this.pane.querySelector('[data-score-staff]');this.float=this.pane.querySelector('[data-score-float]');this.selected=-1;this.undoStack=[];this.redoStack=[];this.binding=null;this.pending=null;this.last={abc:'',lyrics:'',binding:null};this.pronunciation=Pronunciation.empty(this.lyrics.value);this.lyricMode=true;this.tokenElements=new Map();this.boundary='';this.elapsed=0;
  const pitches=this.inspector.querySelector('[data-note-pitch]');for(let n=0;n<=127;n++){const option=document.createElement('option');option.value=n;option.textContent=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][n%12]+(Math.floor(n/12)-1);pitches.append(option);}
  const pitchGrid=document.createElement('div');pitchGrid.className='note-pitch-grid';this.inspector.querySelector('[data-note-position]').after(pitchGrid);for(const selector of ['[data-note-pitch]','[data-note-duration]']){const field=this.inspector.querySelector(selector),wrap=document.createElement('div');wrap.append(field.previousElementSibling,field);pitchGrid.append(wrap);}
  const chordField=this.inspector.querySelector('[data-note-chord]'),chordDetails=document.createElement('details');chordDetails.className='chord-details';chordDetails.innerHTML='<summary>和弦编辑</summary>';chordField.previousElementSibling.before(chordDetails);chordDetails.append(chordField.previousElementSibling,chordField);
  for(const button of this.pane.querySelectorAll('[data-score-action]'))button.onclick=safe(()=>this.action(button.dataset.scoreAction));
  for(const tab of this.pane.querySelectorAll('[data-score-tab]'))tab.onclick=()=>this.setTab(tab.dataset.scoreTab);
  const noteToggle=this.pane.querySelector('[data-note-toggle]');noteToggle.onclick=()=>{this.inspector.hidden=!this.inspector.hidden;noteToggle.classList.toggle('active',!this.inspector.hidden);noteToggle.setAttribute('aria-expanded',String(!this.inspector.hidden));};
  pitches.onchange=safe(()=>{try{this.edit(this.doc.tokens[this.selected].kind==='rest'?ScoreModel.writeNote(this.doc,this.selected,+pitches.value):ScoreModel.changePitch(this.doc,this.selected,+pitches.value));}finally{this.inspect();}});
  this.inspector.querySelector('[data-note-duration]').onchange=safe(e=>{try{this.edit(ScoreModel.resizeDuration(this.doc,this.selected,+e.target.value));}finally{this.inspect();}});
  this.inspector.querySelector('[data-note-chord]').onchange=safe(e=>this.edit(ScoreModel.setChord(this.doc,this.selected,e.target.value.trim())));
  this.inspector.querySelector('[data-note-lyric]').onchange=safe(e=>this.changeLyric(e.target.value));
  this.inspector.querySelector('[data-note-prev]').onclick=()=>this.selectAdjacent(-1);this.inspector.querySelector('[data-note-next]').onclick=()=>this.selectAdjacent(1);
  this.inspector.querySelector('[data-score-align]').onclick=safe(()=>{if(!this.doc)throw Error('请先导入或生成乐谱');this.remember();this.binding=ScoreModel.align(this.doc,this.lyrics.value);this.save();this.render();toast('歌词已按人声音符试排，请试听后校对');});
  this.pane.querySelector('[data-score-tempo]').onchange=safe(e=>{if(!this.doc)throw Error('请先新建或导入乐谱');const bpm=Number(e.target.value);if(!Number.isInteger(bpm)||bpm<20||bpm>400)throw Error('速度范围为 20–400 BPM');this.commit(this.doc.source.replace(/^Q:1\/4=\d+$/m,'Q:1/4='+bpm));});
  this.pane.querySelector('[data-score-zoom]').onchange=()=>this.render();
  const display=document.createElement('select');display.dataset.scoreDisplay='';display.setAttribute('aria-label','显示的乐谱声部');display.innerHTML='<option value="Vocal">人声谱</option><option value="all">完整总谱</option><option value="Ins">器乐谱</option>';this.pane.querySelector('.score-toolbar').append(display);this.display=display;display.onchange=()=>{this.selected=-1;this.render();};
  this.float.addEventListener('keydown',safe(e=>{if(e.key==='Escape'){this.float.hidden=true;return;}if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();this.changeLyric(this.float.value);this.selectAdjacent(e.shiftKey?-1:1);this.openFloat();}}));
  this.float.addEventListener('change',safe(()=>{if(!this.float.hidden)this.changeLyric(this.float.value);}));
  this.paper.addEventListener('dblclick',()=>this.openFloat());
  this.bindNoteEditing();this.pronunciationUI=new ScorePronunciationEditor(this);
  this.addGeneratedMenu();if(mode==='cover')this.bindWave();this.pull();
 }
 setTab(name){
  if(!['staff','lyrics','style','abc'].includes(name))return;
  if(!this.staff.hidden)this.tabPosition=this.captureScorePosition();
  this.pane.dataset.activeTab=name;this.float.hidden=true;
  for(const tab of this.pane.querySelectorAll('[data-score-tab]')){const active=tab.dataset.scoreTab===name;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));}
  this.staff.hidden=name!=='staff';this.pane.querySelector('[data-score-source]').hidden=name!=='abc';this.pane.querySelector('[data-score-lyrics]').hidden=name!=='lyrics';
  this.pane.querySelector('[data-score-style]').hidden=name!=='style';this.pane.querySelector('[data-ai-slot="score"]').hidden=!['staff','abc'].includes(name);
  if(name==='staff'){this.render();this.restoreScorePosition(this.tabPosition);}
 }
 snapshot(){return {abc:this.source.value,lyrics:this.lyrics.value,binding:this.binding?structuredClone(this.binding):null,selected:this.selected,pronunciation:structuredClone(this.pronunciation)};}
 remember(snapshot=this.snapshot()){this.undoStack.push(snapshot);if(this.undoStack.length>40)this.undoStack.shift();this.redoStack=[];}
 save(){this.last=this.snapshot();if(this.mode==='create')saveDraft();else saveCoverDraft();}
 pull(){
  const raw=this.source.value,lyrics=this.lyrics.value,title=this.title.value;
  if(this.pronunciation.lyricsStamp!==ScoreModel.stamp(lyrics))this.pronunciation=Pronunciation.rebase(this.last.lyrics,lyrics,this.pronunciation);
  if(raw===this.last.abc&&lyrics===this.last.lyrics&&title===this.lastTitle&&JSON.stringify(this.pronunciation)===JSON.stringify(this.last.pronunciation)){if(this.mode==='cover')this.updateWave();return;}
  if(this.doc&&(raw!==this.last.abc||lyrics!==this.last.lyrics)&&!this.committing)this.remember(structuredClone(this.last));
  this.lastTitle=title;this.error='';
  try{this.doc=raw.trim()?ScoreModel.parse(raw):null;if(this.doc&&!ScoreModel.validBinding(this.binding,this.doc,lyrics))this.binding=ScoreModel.align(this.doc,lyrics);}
  catch(e){this.doc=null;this.error=e.message;this.binding=null;}
  if(this.selected>= (this.doc?.tokens.length||0))this.selected=-1;
  this.last=this.snapshot();this.render();this.lyricSections();if(this.mode==='cover')this.updateWave();this.page.dispatchEvent(new Event('score-context-changed'));
 }
 restore(data){try{this.pronunciation=Pronunciation.validate(data?.pronunciation,this.lyrics.value);}catch{this.pronunciation=Pronunciation.empty(this.lyrics.value);}this.binding=data?.binding||null;this.pending=data?.pending||null;this.last={abc:'__restore__',lyrics:'',binding:null};this.undoStack=[];this.redoStack=[];this.committing=true;this.pull();this.committing=false;}
 commit(abc,lyrics=this.lyrics.value,binding,selection=this.selected){
  if(this.mode==='cover'&&window.coverWorkflow?.locked()&&abc.trim()!==this.source.value.trim())throw Error('只改词模式已锁定乐谱；修改音符请切换改词改谱');
  ScoreModel.parse(abc);this.remember();const previous=this.doc,oldBinding=this.binding;this.stop();this.committing=true;this.source.value=abc;this.lyrics.value=lyrics;this.selected=selection;
  const next=ScoreModel.parse(abc);this.binding=binding??(oldBinding&&previous?.vocal.length===next.vocal.length&&oldBinding.lyricsStamp===ScoreModel.stamp(lyrics)?{...oldBinding,abcStamp:ScoreModel.stamp(next.source),reviewed:false}:ScoreModel.align(next,lyrics));
  if(this.mode==='create'&&cot==='off')setCot('full');this.pull();this.committing=false;this.save();
 }
 edit(abc){
  if(abc===this.source.value)return;
  const next=ScoreModel.parse(abc),chosen=this.doc?.tokens[this.selected],selection=chosen?next.tokens.find(t=>t.voice===chosen.voice&&t.onset===chosen.onset)?.index??-1:-1;
  this.commit(abc,this.lyrics.value,ScoreModel.rebind(this.doc,next,this.binding,this.lyrics.value),selection);
 }
 noteHitArea(node,token){
  node.dataset.scoreVoice=token.voice;node.dataset.scoreBeat=token.onset;
  node.setAttribute('aria-label',`${token.voice==='Vocal'?'人声':'器乐'} 第${token.bar+1}小节 ${token.kind==='rest'?'休止符':'音符'}，可编辑`);
  const shape=node.querySelector('.abcjs-notehead')||node.querySelector('path');if(!shape)return;const b=shape.getBBox(),rect=document.createElementNS('http://www.w3.org/2000/svg','rect');
  rect.setAttribute('x',b.x-5);rect.setAttribute('y',b.y-5);rect.setAttribute('width',Math.max(18,b.width+10));rect.setAttribute('height',Math.max(18,b.height+10));rect.setAttribute('class','score-note-hit');node.prepend(rect);
 }
 bindNoteEditing(){
  this.lyricMode=false;this.pane.querySelector('[data-score-action="lyric-mode"]').classList.remove('active');
  const remove=document.createElement('button');remove.dataset.scoreAction='delete';remove.textContent='删除';remove.title='删除音符，保留对应休止（Delete）';remove.onclick=safe(()=>this.action('delete'));this.pane.querySelector('[data-score-action="rest"]').after(remove);
  const help=document.createElement('p');help.className='score-edit-help';help.textContent='点选音符 · 上下拖动改音高 · ↑↓ 半音 / Shift 八度 · Delete 删除 · 双击填词';this.pane.querySelector('.score-toolbar').after(help);
  this.pane.tabIndex=0;
  this.pane.addEventListener('keydown',safe(async e=>{
   if(e.target.closest('[data-pron-offset]'))return;
   if(e.target.matches('input,textarea,select')||e.target.isContentEditable)return;
   const modifier=e.ctrlKey||e.metaKey,key=e.key.toLowerCase(),command=modifier?(key==='z'?(e.shiftKey?'redo':'undo'):key==='y'?'redo':null):({ArrowLeft:'prev',ArrowRight:'next',ArrowUp:'up',ArrowDown:'down',Delete:'delete',Backspace:'delete',Escape:'escape',Enter:'lyrics'}[e.key]);
   if(!command)return;if(e.target.closest('button')&&!modifier)return;e.preventDefault();e.stopImmediatePropagation();
   if(command==='escape'){this.cancelNoteDrag();this.float.hidden=true;return;}
   if(command==='prev'||command==='next'){this.selectAdjacent(command==='prev'?-1:1);return;}
   if(command==='lyrics'){this.openFloat();return;}
   if(command==='up'||command==='down'){const t=this.doc?.tokens[this.selected];if(t?.kind!=='note')return;this.edit(ScoreModel.changePitch(this.doc,t.index,t.midi+(command==='up'?1:-1)*(e.shiftKey?12:1)));}
   else await this.action(command);
   this.pane.focus({preventScroll:true});
  }),true);
  this.pane.addEventListener('keyup',e=>{if(!e.target.matches('input,textarea,select')&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'].includes(e.key))e.stopImmediatePropagation();},true);
  this.paper.addEventListener('pointerdown',safe(e=>{
   const pronunciation=e.target.closest('[data-pron-offset]');if(e.button===0&&pronunciation){e.preventDefault();e.stopImmediatePropagation();this.pronunciationUI.openCharacter(pronunciation);return;}
   const target=e.target.closest('[data-token-index]');if(e.button!==0||!target||this.noteDrag)return;
   const index=Number(target.dataset.tokenIndex),lyric=!!e.target.closest('.abcjs-lyric');
   e.preventDefault();e.stopImmediatePropagation();if(!this.float.hidden)this.changeLyric(this.float.value);this.float.hidden=true;
   this.select(index);this.pane.focus({preventScroll:true});this.stop();const node=this.tokenElements.get(index),token=this.doc.tokens[index];
   const matrix=node.ownerSVGElement.getScreenCTM();if(!matrix)return;const inverse=matrix.inverse(),point=new DOMPoint(e.clientX,e.clientY).matrixTransform(inverse);
   this.noteDrag={id:e.pointerId,index,node,token,inverse,y:point.y,step:0,lyric:lyric||(this.mode==='cover'&&window.coverWorkflow?.locked()),source:this.source.value,transform:node.getAttribute('transform')};this.paper.setPointerCapture(e.pointerId);
  }),true);
  this.paper.addEventListener('pointermove',e=>{
   const d=this.noteDrag;if(!d||d.id!==e.pointerId||d.lyric||d.token.kind!=='note')return;
   const y=new DOMPoint(e.clientX,e.clientY).matrixTransform(d.inverse).y,step=Math.round((d.y-y)/3.875);
   const midi=ScoreModel.stepPitch(d.token,step);if(midi<0||midi>127)return;d.step=step;
   d.node.setAttribute('transform',(d.transform||'')+` translate(0,${-step*3.875})`);this.paper.classList.toggle('note-dragging',!!step);
  },true);
  this.paper.addEventListener('pointerup',safe(e=>{
   const d=this.noteDrag;if(!d||d.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();this.cancelNoteDrag();
   if(d.source!==this.source.value)return;
   if(d.step){this.edit(ScoreModel.changePitch(this.doc,d.index,ScoreModel.stepPitch(d.token,d.step)));this.pane.focus({preventScroll:true});this.lastNoteClick=null;}
   else {const double=this.lastNoteClick?.index===d.index&&Date.now()-this.lastNoteClick.at<400;this.lastNoteClick={index:d.index,at:Date.now()};if(this.lyricMode||d.lyric||double)this.openFloat();}
  }),true);
  this.paper.addEventListener('pointercancel',()=>this.cancelNoteDrag());this.paper.addEventListener('lostpointercapture',()=>this.cancelNoteDrag());
 }
 cancelNoteDrag(){const d=this.noteDrag;if(!d)return;this.noteDrag=null;if(d.transform===null)d.node.removeAttribute('transform');else d.node.setAttribute('transform',d.transform);this.paper.classList.remove('note-dragging');if(this.paper.hasPointerCapture(d.id))this.paper.releasePointerCapture(d.id);}
 captureScorePosition(){
  if(this.page.hidden||this.staff.hidden||!this.staff.clientHeight||!this.paper.children.length)return null;
  const frame=this.staff.getBoundingClientRect(),visible=node=>{if(!node)return false;const r=node.getBoundingClientRect();return r.bottom>frame.top&&r.top<frame.bottom;};
  let node=this.tokenElements.get(this.selected);if(!visible(node))node=[...this.tokenElements.values()].find(visible);
  const containers=[];for(let parent=this.staff.parentElement;parent;parent=parent.parentElement)containers.push({node:parent,top:parent.scrollTop,left:parent.scrollLeft});
  return {top:this.staff.scrollTop,left:this.staff.scrollLeft,height:this.paper.getBoundingClientRect().height,minHeight:this.paper.style.minHeight,containers,
   anchor:node?{voice:node.dataset.scoreVoice,onset:Number(node.dataset.scoreBeat),top:node.ownerSVGElement.getBoundingClientRect().top-frame.top}:null};
 }
 restoreScorePosition(position){
  if(!position)return;
  this.paper.style.minHeight=position.minHeight;
  // Restore outer scrolling before measuring the new staff, then anchor the
  // same musical location. Changes to note stems must not scroll the whole row.
  for(const item of [...position.containers].reverse()){item.node.scrollTop=item.top;item.node.scrollLeft=item.left;}
  this.staff.scrollTop=position.top;this.staff.scrollLeft=position.left;
  const a=position.anchor,token=a&&this.doc?.tokens.find(t=>t.voice===a.voice&&t.onset===a.onset),node=token&&this.tokenElements.get(token.index);
  if(node){const delta=node.ownerSVGElement.getBoundingClientRect().top-this.staff.getBoundingClientRect().top-a.top;this.staff.scrollTop+=delta;}
 }
 render(preserveEditing=false){
  this.cancelNoteDrag();
  const position=this.captureScorePosition();
  // abcjs clears the live SVG before measuring its replacement. Reserve the
  // existing height so synchronous layout cannot clamp the scroller to zero.
  if(position)this.paper.style.minHeight=position.height+'px';
  const editing=preserveEditing&&!this.float.hidden?{value:this.float.value,start:this.float.selectionStart,end:this.float.selectionEnd}:null;
  this.resize();
  const error=this.pane.querySelector('[data-score-error]');error.textContent=this.error||(this.doc?.errors.slice(0,4).join('；')||'');error.hidden=!error.textContent;
  this.pane.querySelector('.score-empty').hidden=!!this.doc;this.paper.hidden=!this.doc;this.float.hidden=true;this.tokenElements.clear();
  if(this.doc){
   const rendered=ScoreModel.renderSource(this.doc,this.binding,this.title.value||'未命名作品',this.display.value,Pronunciation.labels(this.binding,this.pronunciation));this.renderOffsets=rendered.renderOffsets;
   const zoom=+this.pane.querySelector('[data-score-zoom]').value||1;
   try{
    const tune=ABCJS.renderAbc(this.paper,rendered.text,{add_classes:true,foregroundColor:'#20282e',selectionColor:'#759343',responsive:'resize',staffwidth:Math.max(490,(this.staff.clientWidth||680)-46)/zoom,paddingtop:this.mode==='cover'?8:20,paddingleft:12,paddingright:12,paddingbottom:25,oneSvgPerLine:true,format:{barnumbers:1,vocalfont:'Microsoft YaHei 15',titlefont:this.mode==='cover'?'Microsoft YaHei 16':'Microsoft YaHei 23',subtitlefont:'Microsoft YaHei 14',gchordfont:'Segoe UI 12',staffsep:55,sysstaffsep:45},dragging:false,selectTypes:['note'],clickListener:(element,_n,_c,_analysis,drag)=>{
      const found=this.findToken(element.startChar,element.endChar);if(!found)return;
      if(drag?.step&&found.kind==='note'){
       const letters='CDEFGAB',natural=[0,2,4,5,7,9,11],oldStep=(Math.floor(found.written/12)-5)*7+letters.indexOf(found.note.toUpperCase()),newStep=oldStep-drag.step,pitch=60+12*Math.floor(newStep/7)+natural[((newStep%7)+7)%7]+(found.midi-found.written);
       setTimeout(safe(()=>{this.selected=found.index;this.edit(ScoreModel.changePitch(this.doc,found.index,pitch));}),0);
      }else{this.select(found.index);if(this.lyricMode)setTimeout(()=>this.openFloat(),0);}
    }})[0];this.tune=tune;
    for(const item of tune?.engraver?.selectables||[]){const e=item.absEl?.abcelem;if(e?.el_type!=='note')continue;const token=this.findToken(e.startChar,e.endChar);if(token){item.svgEl.dataset.tokenIndex=token.index;this.tokenElements.set(token.index,item.svgEl);this.noteHitArea(item.svgEl,token);}}
   }catch(e){error.textContent='五线谱排版失败：'+e.message;error.hidden=false;}
   this.pane.querySelector('[data-score-tempo]').value=this.doc.bpm;this.pane.querySelector('[data-score-time]').textContent='0:00 / '+scoreTime(this.doc.seconds);
  }else this.paper.replaceChildren();
  for(const button of this.pane.querySelectorAll('[data-score-action]'))if(!['new','import','lyric-mode'].includes(button.dataset.scoreAction))button.disabled=!this.doc;
  this.pane.querySelector('[data-score-action="undo"]').disabled=!this.undoStack.length;this.pane.querySelector('[data-score-action="redo"]').disabled=!this.redoStack.length;
  this.pronunciationUI?.decorate();this.structure();this.inspect();
  this.restoreScorePosition(position);
  if(this.playTimer)this.updatePlaybackPosition(this.elapsed);
  if(editing&&this.vocalIndex()>=0){this.openFloat();this.float.value=editing.value;this.float.setSelectionRange(editing.start,editing.end);}
 }
 resize(){if(this.page.hidden)return;if(this.mode==='cover'&&window.coverLayout){window.coverLayout.resize();return;}const top=this.page.querySelector('.workbench-grid').getBoundingClientRect().top;this.page.style.setProperty('--workbench-height',Math.max(260,innerHeight-top-16-(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--player-height'))||0))+'px');}
 findToken(start,end){return this.renderOffsets.get(start)||[...this.renderOffsets.entries()].find(([pos])=>pos>=start&&pos<end)?.[1];}
 select(index){this.selected=index;this.inspect();}
 selectAdjacent(direction){if(!this.doc)return;const visible=this.doc.tokens.filter(t=>this.display.value==='all'||t.voice===this.display.value),at=visible.findIndex(t=>t.index===this.selected),token=visible[Math.max(0,Math.min(visible.length-1,at<0?0:at+direction))];if(!token)return;this.select(token.index);this.tokenElements.get(token.index)?.scrollIntoView({block:'nearest',inline:'nearest'});}
 vocalIndex(){const t=this.doc?.tokens[this.selected];return t?.voice==='Vocal'&&t.kind==='note'?this.doc.vocal.findIndex(n=>n.index===t.attack):-1;}
 inspect(){
  const t=this.doc?.tokens[this.selected],pitch=this.inspector.querySelector('[data-note-pitch]'),duration=this.inspector.querySelector('[data-note-duration]'),lyric=this.inspector.querySelector('[data-note-lyric]'),chord=this.inspector.querySelector('[data-note-chord]');
  this.inspector.querySelector('[data-note-position]').textContent=t?`${t.voice==='Vocal'?'人声':'器乐'} · 第 ${t.bar+1} 小节 · ${t.kind==='rest'?'休止符':'音符 '+(t.index+1)}`:'点选五线谱上的音符开始编辑';
  pitch.disabled=!t;duration.disabled=!t;lyric.disabled=this.vocalIndex()<0||!!t?.continuation;chord.disabled=!t||t.voice!=='Vocal'||!!t.compressed;
  for(const option of duration.options)option.disabled=!!this.doc&&!ScoreModel.DUR.includes(+option.value/(this.doc.unit*4));
  if(t?.midi!==null&&t?.midi!==undefined)pitch.value=t.midi;else pitch.value=60;if(t&&!t.compressed)duration.value=t.duration;else duration.value=t?this.doc.voices[t.voice].bars[t.bar].length:1;
  lyric.value=this.binding?.slots[this.vocalIndex()]?.[0]||'';chord.value=t?this.doc.voices[t.voice].bars[t.bar]?.tokens.find(n=>n.kind==='chord'&&n.onset===t.onset)?.name||'':'';
  for(const [i,node] of this.tokenElements)node.classList.toggle('selected-note',i===this.selected);
  const total=this.doc?.vocal.length||0,units=ScoreModel.lyricUnits(this.lyrics.value),ranges=(this.binding?.slots||[]).filter(s=>s[0]&&s[0]!=='_').map(s=>[s[1],s[2]]).sort((a,b)=>a[0]-b[0]);
  let assigned=0,at=0;for(const u of units){while(at<ranges.length&&ranges[at][1]<=u.start)at++;if(ranges[at]?.[0]<=u.start&&ranges[at]?.[1]>=u.end)assigned++;}
  this.inspector.querySelector('[data-alignment-status]').textContent=this.doc?`${total} 次人声起音 · 已试排 ${assigned}/${units.length} 个歌词单位${units.length>assigned?' · 有未安排歌词':''} · 谱面位置不等于实际演唱时间`:'等待乐谱与歌词';
  this.renderLyricFit();this.pronunciationUI?.sync();
  if(this.mode==='cover')window.coverWorkflow?.sync();
 }
 renderLyricFit(){
  let box=this.page.querySelector('[data-lyric-fit]');if(!box){box=document.createElement('details');box.dataset.lyricFit='';box.className='lyric-fit';this.page.querySelector('.lyrics-pane').append(box);}
  const fit=this.doc?ScoreModel.lyricFit(this.doc,this.lyrics.value):null;box.hidden=!fit;
  if(!fit)return;const stamp=ScoreModel.stamp(JSON.stringify([this.source.value,this.lyrics.value]));if(box.dataset.stamp===stamp)return;box.dataset.stamp=stamp;
  box.replaceChildren();const summary=document.createElement('summary');summary.textContent=fit.warnings.length?`词谱有 ${fit.warnings.length} 处需核对`:'词谱结构检查';box.append(summary);box.open=fit.warnings.length>0;box.classList.toggle('has-conflict',fit.warnings.length>0);
  for(const message of fit.warnings){const p=document.createElement('p');p.textContent=message;box.append(p);}
  const note=document.createElement('p');note.className='help';note.textContent=fit.warnings.length?'保留歌词可重新谱曲；保留旋律则按现有段落改词。试排不会强制模型逐字演唱。':'段落检查仅供参考，仍需试听核对漏字、重复和咬字。';box.append(note);
 }
 async checkLyricsBeforeGenerate(){
  if(!this.doc)return true;const fit=ScoreModel.lyricFit(this.doc,this.lyrics.value);if(!fit.warnings.length)return true;
  this.renderLyricFit();this.page.querySelector('[data-lyric-fit]').open=true;
  return studioConfirm('当前歌词与乐谱有冲突：\n\n'+fit.warnings.slice(0,5).join('\n')+'\n\n建议先调整歌词或重新谱曲，继续可能漏唱或串段。仍按当前词谱生成？');
 }
 openFloat(){
  if(this.vocalIndex()<0||this.doc.tokens[this.selected].continuation)return;
  const node=this.tokenElements.get(this.selected);if(!node)return;const r=node.getBoundingClientRect(),parent=this.staff.getBoundingClientRect();
  this.float.style.left=Math.max(this.staff.scrollLeft+4,Math.min(this.staff.scrollLeft+this.staff.clientWidth-118,r.left-parent.left+this.staff.scrollLeft-36))+'px';this.float.style.top=Math.max(this.staff.scrollTop+4,Math.min(this.staff.scrollTop+this.staff.clientHeight-44,r.bottom-parent.top+this.staff.scrollTop+5))+'px';this.float.value=this.binding.slots[this.vocalIndex()]?.[0]||'';this.float.hidden=false;this.float.focus({preventScroll:true});this.float.select();
 }
 changeLyric(text){if(this.vocalIndex()<0||text.trim()===(this.binding?.slots[this.vocalIndex()]?.[0]||''))return;const result=ScoreModel.editLyric(this.doc,this.lyrics.value,this.binding,this.vocalIndex(),text.trim());this.commit(this.doc.source,result.lyrics,result.binding);}
 lyricSections(){const nav=this.page.querySelector('.lyrics-section-nav');nav.replaceChildren();const re=/^\s*\[([^\]]+)\]/gm;let m;while((m=re.exec(this.lyrics.value))){const b=document.createElement('button');b.textContent=({verse:'主歌',chorus:'副歌',bridge:'桥段',intro:'前奏',outro:'尾奏'})[m[1].toLowerCase()]||m[1];const position=m.index;b.onclick=()=>{this.lyrics.focus();this.lyrics.setSelectionRange(position,position);this.lyrics.scrollTop=this.lyrics.value.slice(0,position).split('\n').length*30;};nav.append(b);}}
 structure(){const box=this.pane.querySelector('[data-score-structure]');box.replaceChildren();for(const section of this.doc?.sections||[]){const b=document.createElement('button');b.textContent=({verse:'主歌',chorus:'副歌',bridge:'桥段',interlude:'间奏',intro:'前奏',outro:'尾奏'})[section.name.toLowerCase()]||section.name;const bar=this.doc.voices.Vocal.bars.find(b=>b.time>=section.time);if(bar)b.textContent+=' · '+(bar.index+1);b.onclick=()=>{const token=this.doc.tokens.find(t=>t.voice==='Vocal'&&t.onset>=section.time);if(token){this.select(token.index);this.tokenElements.get(token.index)?.scrollIntoView({block:'center'});}};box.append(b);}}
 async action(name){
  if(this.mode==='cover'&&window.coverWorkflow?.locked()&&['new','import','split','tie','rest','delete','note','add-bar'].includes(name))throw Error('只改词模式已锁定乐谱；修改音符请切换改词改谱');
  if(name==='new'){if(this.source.value.trim()&&!await studioConfirm('用新的四小节乐谱替换当前编辑稿？可通过撤销恢复。'))return;this.commit(ScoreModel.newScore());return;}
  if(name==='import'){const imported=await api.importEditedScore();if(imported){if(this.source.value.trim()&&!await studioConfirm('导入新乐谱替换当前编辑稿？可通过撤销恢复。'))return;this.commit(imported.abc,imported.lyrics??this.lyrics.value,imported.binding);if(imported.pronunciation){this.pronunciation=Pronunciation.validate(imported.pronunciation,this.lyrics.value);this.render();this.save();}if(imported.title){this.title.value=imported.title;this.pull();this.save();}if(imported.warning)toast(imported.warning,true);}return;}
  if(name==='lyric-mode'){this.lyricMode=!this.lyricMode;this.pane.querySelector('[data-score-action="lyric-mode"]').classList.toggle('active',this.lyricMode);this.float.hidden=true;return;}
  if(name==='undo'||name==='redo'){const from=name==='undo'?this.undoStack:this.redoStack,to=name==='undo'?this.redoStack:this.undoStack;if(!from.length)return;if(this.mode==='cover'&&window.coverWorkflow?.locked()&&from.at(-1).abc.trim()!==this.source.value.trim())throw Error('这一步会改变乐谱，请切换改词改谱后撤销');const prev=from.pop();to.push(this.snapshot());this.stop();this.committing=true;this.source.value=prev.abc;this.lyrics.value=prev.lyrics;this.binding=prev.binding;this.pronunciation=prev.pronunciation||Pronunciation.empty(prev.lyrics);this.selected=prev.selected??-1;this.pull();this.committing=false;this.save();return;}
  if(!this.doc)throw Error('请先新建、导入或生成乐谱');
  if(name==='play'){await this.play();return;}if(name==='stop'){this.stop();return;}
  if(name.startsWith('export-')||name==='print'){ScoreModel.assertValid(this.source.value);const format=name==='print'?'pdf':name.slice(7);const svgs=[...this.paper.querySelectorAll('svg')];let y=0;const pieces=svgs.map(s=>{const height=s.viewBox.baseVal.height||+s.getAttribute('height');const part=`<g transform="translate(0 ${y})">${s.innerHTML}</g>`;y+=height;return part;});const width=svgs[0]?.viewBox.baseVal.width||800;const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${y}" viewBox="0 0 ${width} ${y}">${pieces.join('')}</svg>`;
   document.body.dataset.printMode=this.mode;try{if(await api.exportEditedScore({format,title:this.title.value,abc:this.source.value,lyrics:this.lyrics.value,binding:this.binding,pronunciation:this.pronunciation,svg}))toast('已导出编辑后的乐谱'+(format==='abc'?'与填词数据':''));}finally{delete document.body.dataset.printMode;}return;}
  if(name==='add-bar'){this.edit(ScoreModel.addBar(this.doc));return;}
  if(this.selected<0)throw Error('请先点选五线谱中的音符或休止符');
  if(name==='split')this.edit(this.doc.tokens[this.selected].compressed?ScoreModel.expandRest(this.doc,this.selected):ScoreModel.split(this.doc,this.selected));
  if(name==='tie')this.edit(ScoreModel.toggleTie(this.doc,this.selected));
  if(name==='rest'||name==='delete')this.edit(ScoreModel.eraseNote(this.doc,this.selected));
  if(name==='note')this.edit(ScoreModel.writeNote(this.doc,this.selected,Number(this.inspector.querySelector('[data-note-pitch]').value)));
 }
 revealPlaybackScore(){
  if(this.page.hidden)navigate(this.mode);
  const voice=this.pane.querySelector('select[data-score-voice]').value;
  if(voice!=='all'&&this.display.value!==voice){this.display.value=voice;this.setTab('staff');}
  else if(this.staff.hidden)this.setTab('staff');
  this.float.hidden=true;
 }
 updatePlaybackPosition(seconds,{follow=true,highlight=true}={}){
  if(!this.doc)return;
  this.elapsed=Math.max(0,Math.min(Number(seconds)||0,this.doc.seconds));
  this.pane.querySelector('[data-score-time]').textContent=scoreTime(this.elapsed)+' / '+scoreTime(this.doc.seconds);
  const beat=this.elapsed*this.doc.bpm/60,voice=this.playTimer?this.playbackVoice:this.pane.querySelector('select[data-score-voice]').value;
  let current=null;
  for(const [index,node] of this.tokenElements){
   const t=this.doc.tokens[index],active=beat>=t.onset&&beat<t.onset+t.duration&&(voice==='all'||t.voice===voice);
   node.classList.toggle('playing-note',highlight&&active);
   if(active&&(!current||t.voice==='Vocal'))current=node;
  }
  if(follow&&current&&!this.page.hidden&&!this.staff.hidden){
   const viewport=this.staff.getBoundingClientRect(),system=current.ownerSVGElement.getBoundingClientRect(),note=current.getBoundingClientRect(),padding=16;
   // Scroll only the score surface. Follow a complete system when it fits,
   // otherwise keep the current note visible in a short editing viewport.
   const row=system.height<=this.staff.clientHeight-padding*2?system:note;
   if(row.top<viewport.top+padding||row.bottom>viewport.top+this.staff.clientHeight-padding)this.staff.scrollTop+=row.top-viewport.top-padding;
   if(note.left<viewport.left+padding||note.right>viewport.left+this.staff.clientWidth-padding)this.staff.scrollLeft+=note.left-viewport.left-padding;
  }
  window.studioPlayer?.update();
 }
 async play(offset=0,{reveal=true}={}){
  ScoreModel.assertValid(this.source.value);for(const editor of Object.values(workbenchEditors))editor.stop();for(const audio of $$('audio'))audio.pause();const list=ScoreModel.events(this.doc,this.pane.querySelector('select[data-score-voice]').value);if(!list.length)throw Error('当前声部只有休止符');
  if(reveal)this.revealPlaybackScore();
  this.playbackVoice=this.pane.querySelector('select[data-score-voice]').value;
  const revision=this.playRevision;this.context??=new AudioContext();await this.context.resume();if(revision!==this.playRevision)return;offset=Math.max(0,Math.min(Number(offset)||0,this.doc.seconds));if(offset>=this.doc.seconds)offset=0;const start=this.context.currentTime+.06;this.oscillators=[];
  this.masterGain??=this.context.createGain();this.masterGain.disconnect();this.masterGain.connect(this.context.destination);this.masterGain.gain.value=window.studioPlayer?.muted?0:(window.studioPlayer?.volume??1);
  for(const event of list){if(event.onset+event.duration<=offset)continue;const oscillator=this.context.createOscillator(),gain=this.context.createGain();oscillator.type='triangle';oscillator.frequency.value=440*2**((event.midi-69)/12);const at=start+Math.max(0,event.onset-offset),end=Math.max(at+.03,start+event.onset+event.duration-offset);gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(.11,at+.01);gain.gain.exponentialRampToValueAtTime(.025,Math.max(at+.02,end-.03));gain.gain.linearRampToValueAtTime(0,end+.02);oscillator.connect(gain);gain.connect(this.masterGain);oscillator.start(at);oscillator.stop(end+.04);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};this.oscillators.push(oscillator);}
  this.elapsed=offset;this.playTimer=setInterval(()=>{const elapsed=offset+Math.max(0,this.context.currentTime-start);this.updatePlaybackPosition(elapsed);if(elapsed>this.doc.seconds+.1){this.stop();if(window.studioPlayer?.loop&&window.studioPlayer.score===this)this.play(0,{reveal:false}).catch(e=>toast(e.message,true));}},70);
  window.studioPlayer?.adoptScore(this);
  this.updatePlaybackPosition(offset);
 }
 pause(){this.playRevision=(this.playRevision||0)+1;clearInterval(this.playTimer);this.playTimer=null;for(const oscillator of this.oscillators||[])try{oscillator.stop();}catch{}this.oscillators=[];for(const node of this.tokenElements.values())node.classList.remove('playing-note');window.studioPlayer?.update();}
 stop(){this.pause();this.elapsed=0;if(this.doc)this.pane.querySelector('[data-score-time]').textContent='0:00 / '+scoreTime(this.doc.seconds);window.studioPlayer?.update();}
 addGeneratedMenu(){const select=document.createElement('select');select.className='generated-score-menu';select.setAttribute('aria-label','载入生成作品的乐谱');select.innerHTML='<option value="">载入作品乐谱…</option>';this.page.querySelector('.score-file-actions').prepend(select);this.resultMenu=select;select.onchange=safe(async()=>{const job=jobs.find(j=>j.id===select.value);if(job){if(this.source.value.trim()&&!await studioConfirm('载入这次生成的乐谱与歌词？当前编辑稿可撤销恢复。'))return;await this.loadGenerated(job,true);}});}
 async loadGenerated(job,replaceLyrics=false){const abc=await api.score(job.id);if(!abc){this.pending=null;this.save();toast('这次生成没有输出乐谱；直接生成模式可先转谱再编辑。',true);return;}ScoreModel.assertValid(abc);const commit=()=>this.commit(abc,replaceLyrics?job.request.lyrics:this.lyrics.value);if(this.mode==='cover'&&replaceLyrics&&window.coverWorkflow)window.coverWorkflow.useGenerated(job,abc,commit);else commit();if(replaceLyrics){this.pronunciation=Pronunciation.validate(job.request.pronunciation,this.lyrics.value);this.render();this.title.value=job.request.title;$('#'+this.prefix+'-style').value=job.request.style;}this.pending=null;this.pull();this.save();toast('生成乐谱已载入，歌词已试排到音符下方');}
 bindWave(){
  this.wave=new CoverWaveform(this);
 }
 async updateWave(){
  if(this.mode==='cover')return this.wave.update();
 }
}
function workbenchData(mode){const e=workbenchEditors[mode];return e?{binding:e.binding,pending:e.pending,pronunciation:e.pronunciation}:undefined;}
function workbenchRestore(mode,data){workbenchEditors[mode]?.restore(data);}
function workbenchTrack(mode,job,value){const editor=workbenchEditors[mode];editor.pending={id:job.id,stamp:contentStamp(value)};editor.save();}
let syncingWorkbenchJobs=false;
async function workbenchJobs(list){
 if(syncingWorkbenchJobs)return;syncingWorkbenchJobs=true;
 try{for(const [mode,editor] of Object.entries(workbenchEditors)){
  const eligible=list.filter(j=>j.status==='completed'&&!['voice','transcribe','lyrics','music-style'].includes(j.request.kind)&&(mode==='create'||j.request.transcriptionId===transcriptionId));const chosen=editor.resultMenu.value;editor.resultMenu.replaceChildren(new Option('载入作品乐谱…',''),...eligible.map(j=>new Option(j.request.title,j.id)));editor.resultMenu.value=chosen;
  const pending=editor.pending,job=list.find(j=>j.id===pending?.id);if(job?.status==='completed'){
   const value=mode==='create'?values():coverValues();if(contentStamp(value)===pending.stamp)await editor.loadGenerated(job);else{editor.pending=null;editor.save();toast('新作品已完成。编辑稿有变化，可从“载入作品乐谱”选择结果。');}
  }else if((pending&&!job)||(job&&['failed','cancelled','interrupted'].includes(job.status))){editor.pending=null;editor.save();}
 }}finally{syncingWorkbenchJobs=false;}
}
for(const mode of ['create','cover'])workbenchEditors[mode]=new ScoreWorkbench(mode);
for(const audio of $$('audio'))audio.addEventListener('play',()=>Object.values(workbenchEditors).forEach(e=>e.stop()));
document.addEventListener('DOMContentLoaded',()=>{Object.values(workbenchEditors).forEach(e=>e.pull());},{once:true});
window.addEventListener('resize',()=>{clearTimeout(window.workbenchResize);window.workbenchResize=setTimeout(()=>Object.values(workbenchEditors).forEach(e=>{if(!e.page.hidden)e.render(true);}),160);});
