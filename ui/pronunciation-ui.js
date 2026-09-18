'use strict';
class ScorePronunciationEditor {
 constructor(editor){
  this.editor=editor;this.button=document.createElement('button');this.button.dataset.pronunciationOpen='';this.button.textContent='读音';this.button.title='为歌词中的具体汉字标注读音';editor.pane.querySelector('.score-toolbar .tool-spacer').before(this.button);
  this.panel=document.createElement('section');this.panel.className='pronunciation-panel';this.panel.hidden=true;this.panel.setAttribute('aria-label','歌词读音标注');
  this.panel.innerHTML='<div class="pane-title"><strong>歌词读音</strong><button class="text-button" data-pron-close>关闭</button></div><p class="help" data-pron-context></p><div class="pronunciation-fields"><label>当前字<select data-pron-char aria-label="要标注的歌词字"></select></label><label>演唱读音<select data-pron-reading aria-label="演唱读音"></select></label><label>同音引导字<input data-pron-replacement aria-label="生成用的同音引导字" maxlength="2" placeholder="选填"></label></div><label class="pronunciation-guide"><input type="checkbox" data-pron-guide>生成时使用同音字引导</label><p class="help" data-pron-preview></p><div class="recognition-toolbar"><button class="button secondary small" data-pron-save>保存读音</button><button class="text-button" data-pron-remove>清除本字标注</button></div><p class="help">原歌词和谱面保留原字。引导字只用于重新生成，YuE2 不保证发音正确；已有音频不会改变。未找到合适同音字时可仅保存读音。谱面不添加拼音行。</p>';
  editor.pane.append(this.panel);const q=s=>this.panel.querySelector(s);this.q=q;
  this.button.onclick=()=>{this.panel.hidden=!this.panel.hidden;this.sync(true);if(!this.panel.hidden)q('[data-pron-char]').focus({preventScroll:true});};q('[data-pron-close]').onclick=()=>{this.panel.hidden=true;};this.panel.onkeydown=e=>{if(e.key==='Escape'){this.panel.hidden=true;this.button.focus({preventScroll:true});}};
  q('[data-pron-char]').onchange=()=>this.load();q('[data-pron-reading]').onchange=()=>{const u=this.unit();q('[data-pron-replacement]').value=u?Pronunciation.suggest(u.text,q('[data-pron-reading]').value):'';q('[data-pron-guide]').checked=!!q('[data-pron-replacement]').value;this.preview();};
  q('[data-pron-replacement]').oninput=()=>this.preview();q('[data-pron-guide]').onchange=()=>this.preview();
  q('[data-pron-save]').onclick=safe(()=>{const u=this.unit();if(!u)throw Error('请先选中已填词的人声音符');const p=Pronunciation.set(editor.pronunciation,editor.lyrics.value,{start:u.start,end:u.end,text:u.text,pinyin:q('[data-pron-reading]').value,replacement:q('[data-pron-replacement]').value.trim(),guide:q('[data-pron-guide]').checked});editor.remember();editor.pronunciation=p;editor.save();this.refresh();editor.inspect();toast('读音已保存；已确认的字用绿色实线标记');});
  q('[data-pron-remove]').onclick=safe(()=>{const u=this.unit();if(!u)return;editor.remember();editor.pronunciation=Pronunciation.remove(editor.pronunciation,editor.lyrics.value,u.start);editor.save();this.refresh();editor.inspect();this.load();});
  editor.paper.addEventListener('click',e=>{if(e.target.closest('[data-pron-offset]')){e.preventDefault();e.stopImmediatePropagation();}},true);
  editor.paper.addEventListener('dblclick',e=>{if(e.target.closest('[data-pron-offset]')){e.preventDefault();e.stopImmediatePropagation();}},true);
 }
 openCharacter(target){const e=this.editor,index=Number(target.closest('[data-token-index]').dataset.tokenIndex);let offset=Number(target.dataset.pronOffset);e.cancelNoteDrag();if(!e.float.hidden){const slot=e.binding.slots[e.vocalIndex()],word=e.float.value.trim();if(slot&&word!==slot[0]){if(offset>=slot[2])offset+=(word==='_'?0:word.length)-(slot[2]-slot[1]);else if(offset>=slot[1])return;e.changeLyric(word);}}e.float.hidden=true;e.select(index);this.panel.hidden=false;this.sync(true);this.q('[data-pron-char]').value=String(offset);this.load();this.q('[data-pron-reading]').focus({preventScroll:true});}
 decorate(){
  const e=this.editor;if(!e.doc)return;const allUnits=ScoreModel.lyricUnits(e.lyrics.value);
  for(let i=0;i<e.doc.vocal.length;i++){
   const note=e.doc.vocal[i],slot=e.binding?.slots[i],node=e.tokenElements.get(note.tokens[0].index);if(!node||!slot||!slot[0]||slot[0]==='_')continue;
   const units=allUnits.filter(u=>u.start>=slot[1]&&u.end<=slot[2]&&/^\p{Script=Han}$/u.test(u.text));let at=0;
   for(const lyric of node.querySelectorAll('.abcjs-lyric')){
    const walker=document.createTreeWalker(lyric,NodeFilter.SHOW_TEXT),texts=[];while(walker.nextNode())texts.push(walker.currentNode);
    for(const text of texts){const fragment=document.createDocumentFragment();for(const char of text.textContent){const u=/^\p{Script=Han}$/u.test(char)?units[at++]:null;
     if(u&&u.text===char&&(Pronunciation.readings(char).length>1||e.pronunciation.entries.some(m=>m.start===u.start))){const span=document.createElementNS('http://www.w3.org/2000/svg','tspan');span.textContent=char;span.dataset.pronOffset=u.start;span.setAttribute('role','button');span.setAttribute('tabindex','0');span.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopImmediatePropagation();this.openCharacter(span);}});fragment.append(span);}else fragment.append(document.createTextNode(char));
    }text.replaceWith(fragment);}
   }
  }this.refresh();
 }
 refresh(){for(const span of this.editor.paper.querySelectorAll('[data-pron-offset]')){const mark=this.editor.pronunciation.entries.find(m=>m.start===Number(span.dataset.pronOffset));if(!mark&&Pronunciation.readings(span.textContent).length<=1){span.classList.remove('pronunciation-word','pronunciation-confirmed');for(const attr of ['data-pron-offset','role','tabindex','aria-label'])span.removeAttribute(attr);continue;}span.classList.add('pronunciation-word');span.classList.toggle('pronunciation-confirmed',!!mark);span.setAttribute('aria-label',mark?`${span.textContent}，已确认 ${Pronunciation.readings(mark.text).find(r=>r.id===mark.pinyin)?.label}，点击修改`:`${span.textContent}，多音字待确认，点击选择读音`);}}
 units(){const e=this.editor,s=e.binding?.slots[e.vocalIndex()];return s&&s[0]&&s[0]!=='_'?ScoreModel.lyricUnits(e.lyrics.value).filter(u=>u.start>=s[1]&&u.end<=s[2]&&Pronunciation.readings(u.text).length):[];}
 unit(){return this.units().find(u=>u.start===Number(this.q('[data-pron-char]').value));}
 sync(force=false){
  const e=this.editor,units=this.units(),stamp=JSON.stringify([e.selected,units,e.pronunciation]);this.button.disabled=!e.doc;this.button.textContent='读音'+(e.pronunciation.entries.length?' · '+e.pronunciation.entries.length:'');
  if(this.panel.hidden)return;
  this.q('[data-pron-context]').textContent=units.length?'橙色虚线为待确认多音字，绿色实线为已确认；可直接点击谱面上的字。':'先点选谱上已有中文歌词的人声音符。延音符请选回起唱音符。';
  if(force||stamp!==this.stamp){const select=this.q('[data-pron-char]'),chosen=select.value;select.replaceChildren(...units.map(u=>new Option(u.text,String(u.start))));select.value=units.some(u=>String(u.start)===chosen)?chosen:String(units[0]?.start??'');this.stamp=stamp;this.load();}
 }
 load(){const q=this.q,u=this.unit(),old=this.editor.pronunciation.entries.find(e=>e.start===u?.start),options=u?Pronunciation.readings(u.text):[];q('[data-pron-reading]').replaceChildren(new Option('请选择读音',''),...options.map(r=>new Option(r.label,r.id)));q('[data-pron-reading]').value=old?.pinyin||'';q('[data-pron-replacement]').value=old?.replacement||'';q('[data-pron-guide]').checked=old?.guide||false;for(const s of ['[data-pron-char]','[data-pron-reading]','[data-pron-replacement]','[data-pron-guide]','[data-pron-save]'])q(s).disabled=!u;q('[data-pron-remove]').disabled=!old;this.preview();}
 preview(){const q=this.q,u=this.unit(),r=q('[data-pron-replacement]').value.trim(),label=q('[data-pron-reading]').selectedOptions[0]?.textContent||'';q('[data-pron-preview]').textContent=!u?'':q('[data-pron-guide]').checked?`谱面保留「${u.text}」，已选 ${label}；生成歌词替换为「${r||'待确认'}」。`:`为「${u.text}」保存读音设置，生成歌词保持原字；谱面不添加拼音。`;}
}
