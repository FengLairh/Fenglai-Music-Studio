'use strict';
(()=>{
 const page=$('#page-cover'),bar=page.querySelector('.cover-mode-switch'),editor=workbenchEditors.cover;
 bar.replaceChildren();const group=document.createElement('div');group.setAttribute('role','group');group.setAttribute('aria-label','歌曲 Cover 分类');
 for(const [mode,label] of [['arrange','曲风 / 歌词改编'],['lyrics-only','只改词，不改谱'],['rewrite','改词改谱']]){const b=document.createElement('button');b.dataset.coverCategory=mode;b.textContent=label;b.onclick=()=>workflow.select(mode);group.append(b);}
 const note=document.createElement('span');note.id='cover-category-note';bar.append(group,note);
 const stylePane=page.querySelector('[data-score-style]'),original=document.createElement('section');original.className='cover-original-style';original.hidden=true;
 original.innerHTML='<label class="field-label" for="cover-original-style">原曲风格</label><p class="help">只改词模式使用这里的风格；“新的音乐风格”已停用，原有填写内容仍保留。可直接分析上传的原曲音频，也可手动描述或读取本机作品保存的风格。</p><select id="cover-original-style-job" aria-label="从原作品读取音乐风格"><option value="">从原作品读取风格…</option></select><textarea id="cover-original-style" rows="5" maxlength="2000" placeholder="描述原曲的曲风、人声和配器，例如：Mandarin acoustic folk, warm male vocal, acoustic guitar"></textarea><p class="help">保留乐谱与风格会重新生成音频，不等于保留原伴奏波形或同一演唱者。</p>';
 stylePane.append(original);const style=$('#cover-original-style'),menu=$('#cover-original-style-job');
 const workflow={mode:'arrange',originalStyle:'',referenceAbc:'',sourceId:null,loadingReference:false,
  locked(){return this.mode==='lyrics-only'&&!this.loadingReference;},
  data(){return {coverMode:this.mode,originalStyle:style.value,referenceAbc:this.referenceAbc,styleAnalysis:window.musicStyleUI?.data()};},
  effectiveStyle(){return this.mode==='lyrics-only'?style.value:$('#cover-style').value;},
  description(){return this.mode==='lyrics-only'?'只改歌词 · 当前乐谱锁定 · 使用原曲风格':this.mode==='rewrite'?'允许改词、旋律与和弦 · 使用新的音乐风格':'保留旋律 · 按新歌词与曲风生成';},
  request(value){if(this.mode==='lyrics-only'){if(!style.value.trim()){editor.setTab('style');style.focus();throw Error('请先填写或读取原曲风格；不会使用新的音乐风格');}if(!this.referenceAbc||value.abc.trim()!==this.referenceAbc.trim())throw Error('原谱已变化，请重新确认乐谱后选择只改词模式');return {coverMode:this.mode,style:style.value,coverReference:{abc:this.referenceAbc,style:style.value}};}return {coverMode:this.mode,...(this.mode==='rewrite'?{cot:'full'}:{})};},
  select(mode){if(!['arrange','lyrics-only','rewrite'].includes(mode)||mode===this.mode)return;this.mode=mode;if(mode==='lyrics-only')this.referenceAbc=editor.source.value;editor.cancelNoteDrag();this.sync();saveCoverDraft();renderCoverStatus();if(!inlineAssistants.cover.busy)inlineAssistants.cover.panel.hidden=true;inlineAssistants.cover.describeContext();editor.resize();},
  clearScore(){this.referenceAbc='';},
  scoreLoaded(abc){if(this.mode==='lyrics-only')this.referenceAbc=abc;this.sync();},
  source(source){if(this.sourceId!==source.id){window.musicStyleUI?.sourceChanged();this.sourceId=source.id;style.value=typeof source.originalStyle==='string'?source.originalStyle:'';this.referenceAbc='';}},
  restore(draft){window.musicStyleUI?.restore(draft?.styleAnalysis);this.mode=['arrange','lyrics-only','rewrite'].includes(draft?.coverMode)?draft.coverMode:'arrange';style.value=draft?.sourceId===coverSourceId?(draft.originalStyle||style.value):style.value;this.referenceAbc=draft?.sourceId===coverSourceId?(draft.referenceAbc||editor.source.value):'';this.sync();},
  useGenerated(job,abc,fn){this.loadingReference=true;try{fn();if(this.mode==='lyrics-only')this.referenceAbc=abc;style.value=job.request.style||'';}finally{this.loadingReference=false;this.sync();}},
  sync(){const locked=this.mode==='lyrics-only';page.dataset.coverPolicy=this.mode;for(const b of group.children){const active=b.dataset.coverCategory===this.mode;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}note.textContent=this.description();note.title=note.textContent;
   page.querySelector('[data-score-tab="style"]').textContent=locked?'原曲风格':'新的音乐风格';for(const n of [...stylePane.children])n.hidden=n===original?!locked:locked;
   editor.source.readOnly=locked;page.querySelector('[data-ai-open="score"]').disabled=locked;page.querySelector('[data-ai-open="style"]').disabled=locked;
   for(const n of page.querySelectorAll('[data-score-action="new"],[data-score-action="import"],[data-score-action="split"],[data-score-action="tie"],[data-score-action="rest"],[data-score-action="delete"],[data-score-action="note"],[data-score-action="add-bar"],[data-score-tempo]'))n.disabled=locked||(!['new','import'].includes(n.dataset.scoreAction)&&!editor.doc);
   if(locked)for(const n of page.querySelectorAll('[data-note-pitch],[data-note-duration],[data-note-chord]'))n.disabled=true;
   const choices=jobs.filter(j=>j.status==='completed'&&j.request.style&&!['voice','transcribe','lyrics','music-style'].includes(j.request.kind)),stamp=JSON.stringify(choices.map(j=>[j.id,j.request.title]));if(stamp!==menu.dataset.choices){const selected=menu.value;menu.replaceChildren(new Option('从原作品读取风格…',''),...choices.map(j=>new Option(j.request.title,j.id)));menu.value=selected;menu.dataset.choices=stamp;}
  }
 };
 window.coverWorkflow=workflow;style.addEventListener('input',()=>{saveCoverDraft();inlineAssistants.cover.describeContext();});menu.onchange=()=>{const job=jobs.find(j=>j.id===menu.value);if(job){style.value=job.request.style;window.musicStyleUI?.readFromJob(job);saveCoverDraft();inlineAssistants.cover.describeContext();}};
 $('#cover-mode').setAttribute('aria-label','原曲转谱内容');$('#cover-mode').options[0].textContent='提取旋律';$('#cover-mode').options[1].textContent='提取旋律与和弦';
 page.addEventListener('score-context-changed',()=>workflow.sync());workflow.sync();
})();
