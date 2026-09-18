'use strict';
let assistantState=null,inlineBusy=null;
const inlineAssistants={};
function inlineContext(mode){const value=mode==='cover'?coverValues():values(),editor=workbenchEditors[mode];return {title:value.title.trim(),theme:value.theme.trim(),style:(mode==='cover'&&window.coverWorkflow?window.coverWorkflow.effectiveStyle():value.style).trim(),...(mode==='cover'?{coverMode:value.coverMode||'arrange'}:{}),lyrics:value.lyrics,abc:value.abc.trim(),cot:mode==='cover'?(value.coverMode==='rewrite'?'full':value.melodyOnly?'melody':'full'):value.cot,binding:editor.doc?LyricPlan.cleanBinding(editor.binding,editor.doc,value.lyrics):null};}
function inlineError(error){return error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'');}
async function refreshAssistantSettings(){
 assistantState=await api.assistantStatus();$('#assistant-model').replaceChildren(...assistantState.models.map(id=>new Option(id==='deepseek-flash'?'DeepSeek Flash · 日常创作':'DeepSeek V4 Pro · 复杂改编',id)));$('#assistant-model').value=assistantState.model;$('#assistant-thinking').checked=assistantState.thinking;
 $('#assistant-key-status').textContent=assistantState.credential.message||(assistantState.credential.configured?(assistantState.credential.source==='environment'?'正在使用环境变量密钥':'密钥已在本机加密保存'):'尚未配置 API Key');$('#assistant-key').placeholder=assistantState.credential.configured?'留空保留已有密钥':'填写 DeepSeek 官方 API Key';
 statusBadge($('#assistant-ready'),assistantState.credential.configured?'AI 已配置':'请配置密钥',assistantState.credential.configured?'ready':'warning');$('#assistant-skill-status').textContent=`官方 yue2-music · ${assistantState.skill.revision.slice(0,12)} · 已校验`;
 for(const helper of Object.values(inlineAssistants))helper.controls();
}
const inlineStamp=c=>JSON.stringify([...['title','theme','style','lyrics','abc','cot','coverMode'].map(k=>c?.[k]||''),c?.binding?.slots||null]);
class InlineFieldAI{
 constructor(mode){
  this.mode=mode;this.panel=$('[data-inline-ai="'+mode+'"]');this.task='lyrics';this.record=null;this.snapshot=null;this.busy=false;this.undoState=null;this.applied=false;
  this.get=s=>this.panel.querySelector(s);
  this.get('[data-ai-preview]').remove();this.get('[data-ai-result]>.field-label').remove();
  this.get('[data-ai-settings]').onclick=()=>navigate('settings');this.get('[data-ai-run]').onclick=()=>this.run();this.get('[data-ai-cancel]').onclick=safe(()=>api.assistantCancel());this.get('[data-ai-apply]').onclick=safe(()=>this.apply());
  const row=this.get('.ai-request-row'),review=document.createElement('button');review.className='text-button';review.textContent='仅检查';review.dataset.aiReview='';review.onclick=()=>this.run(true);row.append(review);
  const undo=document.createElement('button');undo.className='text-button ai-undo';undo.dataset.aiUndo='';undo.textContent='撤销本次 AI 填入';undo.hidden=true;undo.onclick=safe(()=>this.undo());row.append(undo);
  const close=this.get('[data-ai-close]');close.textContent='收起';close.className='text-button';close.onclick=()=>{if(!this.busy){this.panel.hidden=true;this.resize();}};row.append(close);
  $('#page-'+mode).addEventListener('input',()=>{if(!this.panel.hidden)this.describeContext();});
  $('#page-'+mode).addEventListener('score-context-changed',()=>{if(!this.panel.hidden)this.describeContext();});
 }
 describeContext(){
  const c=inlineContext(this.mode),target=({style:'风格输入框',lyrics:'歌词输入框',score:'乐谱并显示五线谱'})[this.task];
  if(this.task!=='lyrics'){this.get('[data-ai-context]').textContent=`结合主题与当前${c.abc?'乐谱':'作品'}，生成后直接填入${target}，可撤销。`;return;}
  let reference='尚未载入乐谱；写词将依据主题、风格与现有歌词，不能按旋律约束句长。';
  if(c.abc){try{const doc=ScoreModel.assertValid(c.abc),sections=doc.sections.filter((s,i)=>doc.vocal.some(n=>n.onset>=s.time&&n.onset<(doc.sections[i+1]?.time??doc.voices.Vocal.time)));
   reference=doc.vocal.length?`正在参考当前乐谱「${c.title||'未命名作品'}」 · ${doc.bpm} BPM · ${doc.voices.Vocal.bars.length} 小节 · ${doc.vocal.length} 次人声起音。`+(sections.length?'演唱段落：'+sections.map(s=>s.name).join(' → ')+'。':'乐谱尚未标记段落。')+`按旋律分成 ${LyricPlan.create(doc,c.lyrics,c.binding).phrases.length} 句，逐句校验填词与拖腔，通过后映射到音符；实际演唱仍需试听校对。`:'当前乐谱只有休止符，尚无人声旋律；请先完成旋律，再按谱填词。';
  }catch{reference='当前乐谱格式有误，暂时无法作为可靠的填词依据；请先检查 ABC 源码。';}}
  this.get('[data-ai-context]').textContent=reference+`\n结合${c.theme?'已填写的主题':'当前作品'}，生成后直接填入${target}，可撤销。`;
 }
 resize(){workbenchEditors[this.mode].resize();}
 controls(){
  for(const key of ['run','review'])this.get('[data-ai-'+key+']').disabled=!!inlineBusy;
  this.get('[data-ai-cancel]').hidden=!this.busy;this.get('[data-ai-close]').disabled=this.busy;
  this.get('[data-ai-apply]').disabled=!!inlineBusy||!this.record||this.record.request.task==='review';this.get('[data-ai-apply]').hidden=this.applied||this.record?.request.task==='review';
  this.get('[data-ai-undo]').hidden=!this.undoState;this.get('[data-ai-undo]').disabled=!!inlineBusy;
 }
 message(text,error=false){this.get('[data-ai-status]').textContent=text;this.get('[data-ai-status]').classList.toggle('error',error);this.resize();}
 open(task){
  if(this.mode==='cover'&&window.coverWorkflow?.locked()&&task!=='lyrics'){toast('只改词模式不修改乐谱或曲风，请先切换分类',true);return;}
  if(this.busy){this.panel.hidden=false;return;}
  this.task=task;this.record=null;this.applied=false;this.undoState=null;this.snapshot=inlineContext(this.mode);this.panel.hidden=false;this.get('[data-ai-result]').hidden=true;
  $('#page-'+this.mode+' [data-ai-slot="'+task+'"]').append(this.panel);
  workbenchEditors[this.mode].setTab(task==='score'?'staff':task);
  this.get('[data-ai-title]').textContent='AI · '+({style:'音乐风格',lyrics:'歌词',score:'乐谱'})[task];
  this.describeContext();
  const briefs={style:this.mode==='cover'?'保留原词与旋律，根据改编主题设计音乐风格与配器。':'根据创作主题与当前歌词，设计适合演唱的音乐风格与配器。',lyrics:this.mode==='cover'?'结合改编主题、原意与当前旋律改写歌词，保留段落，注意重音、长音和换气。':'围绕创作主题写歌词，主歌自然叙事，副歌有记忆点，适合演唱。',score:this.mode==='cover'?'保留两个声部全部音高、时值、速度和调号，结合改编主题调整和弦。':this.snapshot.abc?'结合创作主题改善当前乐谱，保留未要求改变的声部和段落，说明改动。':'根据主题、当前歌词和风格，起草 4–8 小节可演唱旋律，遵守 YuE 原生双声部格式。'};
  if(task==='score'&&this.mode==='cover'&&this.snapshot.coverMode==='rewrite')briefs.score='按改编主题重新设计旋律、节奏和和弦，结合当前歌词安排乐句与换气。保留未要求修改的内容，并说明改动；完成后可按新谱改词。';
  if(task==='lyrics'&&this.snapshot.abc)briefs.lyrics='围绕'+(this.mode==='cover'?'改编':'创作')+'主题，为当前乐谱填词。保留现有旋律、节奏、演唱段落及重复次数，结合人声起音、长音、停顿和换气安排句长，不新增乐谱没有的演唱段落；说明需要人工校对的地方。';
  this.get('[data-ai-brief]').value=briefs[task];this.get('[data-ai-run]').textContent='生成并填入';this.message(assistantState?.credential.configured?'可以补充这一次的修改要求。':'请先到设置页填写 DeepSeek API Key。');this.controls();this.history();
 }
 async run(review=false){
  if(inlineBusy)return;const snapshot=inlineContext(this.mode);this.describeContext();const input={mode:this.mode,task:review?'review':this.task,brief:this.get('[data-ai-brief]').value,context:snapshot};this.snapshot=snapshot;
  try{
   if(!assistantState?.credential.configured)throw Error('请在设置中填写 DeepSeek API Key，再生成建议');if($('#assistant-key').value.trim())throw Error('请先在设置中保存刚填写的 API Key');
   inlineBusy=this;this.busy=true;this.awaitingResponse=true;Object.values(inlineAssistants).forEach(h=>h.controls());this.message('正在连接 DeepSeek…');
   await api.assistantConfigure({model:$('#assistant-model').value,thinking:$('#assistant-thinking').checked});const record=await api.assistantCompose(input);this.awaitingResponse=false;this.show(record);
   if(review)this.message('检查完成，当前内容未修改。');else this.apply();await refreshInlineHistory();
  }catch(e){this.awaitingResponse=false;this.message(inlineError(e),true);}finally{this.busy=false;inlineBusy=null;Object.values(inlineAssistants).forEach(h=>h.controls());this.resize();}
 }
 show(record){this.record=record;this.applied=false;this.undoState=null;this.get('[data-ai-result]').hidden=false;this.get('[data-ai-notes]').textContent=[record.proposal.summary,...record.proposal.notes].filter(Boolean).join('\n');this.get('[data-ai-apply]').textContent='填入'+({style:'音乐风格',lyrics:'歌词',score:'乐谱'})[this.task];this.controls();}
 apply(){
  if(!this.record||this.record.request.task==='review')return;
  if(inlineStamp(inlineContext(this.mode))!==inlineStamp(this.snapshot))throw Error('当前作品已被另外修改，请重新生成建议，避免覆盖新内容');
  const value=this.record.proposal[this.task==='score'?'abc':this.task],editor=workbenchEditors[this.mode],prefix=this.mode==='cover'?'cover':'song',old=editor.snapshot(),oldCot=this.snapshot.cot,field=$('#'+prefix+'-'+(this.task==='score'?'abc':this.task)),oldValue=field.value;
  if(typeof value!=='string'||!value.trim())throw Error('AI 未返回当前字段的有效内容，原稿已保留');
  if(this.task==='score'){
   const doc=ScoreModel.assertValid(value);if(this.mode==='cover'&&this.snapshot.abc&&this.snapshot.coverMode!=='rewrite'){const previous=ScoreModel.assertValid(this.snapshot.abc);if(ScoreModel.melodySignature(previous)!==ScoreModel.melodySignature(doc))throw Error('Cover 的 AI 乐谱建议需要保留原旋律和节奏');}editor.commit(value);
  }else if(this.task==='lyrics'&&this.snapshot.abc){
   if(!this.record.proposal.lyricPhrases)throw Error('这份旧建议没有逐句词谱映射，请按当前乐谱重新生成');
   const fitted=LyricPlan.apply(ScoreModel.assertValid(this.snapshot.abc),this.snapshot.lyrics,this.snapshot.binding,this.record.proposal.lyricPhrases);
   if(fitted.lyrics!==value)throw Error('歌词与音符映射不一致，原稿已保留');
   editor.commit(editor.source.value,fitted.lyrics,fitted.binding);
  }else{if(value.length>(this.task==='style'?2000:12000))throw Error('内容超过字段长度限制');field.value=value;if(this.mode==='create')saveDraft();else saveCoverDraft();}
  this.snapshot=inlineContext(this.mode);this.undoState={after:inlineStamp(this.snapshot),old,oldCot,oldValue,task:this.task};this.applied=true;field.classList.add('ai-field-filled');
  const fit=this.task==='lyrics'&&this.record.proposal.lyricFit;
  this.message(fit?`已按 ${fit.phrases} 句映射到乐谱 · ${fit.units} 个字/词 · ${fit.holds} 个拖腔位置。旋律保持，实际演唱仍需试听校对。`:'已填入'+({style:'音乐风格',lyrics:'歌词',score:'乐谱'})[this.task]+'，可在原位置继续编辑。');this.controls();
 }
 undo(){
  const change=this.undoState;if(!change)return;
  if(inlineStamp(inlineContext(this.mode))!==change.after)throw Error('AI 填入后已有新的编辑，为保留新内容，不能直接撤销本次填入；歌词与乐谱可用工具栏撤销。');
  const editor=workbenchEditors[this.mode],prefix=this.mode==='cover'?'cover':'song';
  if(this.mode==='create'&&change.task==='score')setCot(change.oldCot);
  if(change.task==='style'){$('#'+prefix+'-style').value=change.oldValue;if(this.mode==='create')saveDraft();else saveCoverDraft();}
  else if(change.old.abc)editor.commit(change.old.abc,change.old.lyrics,change.old.binding,change.old.selected);
  else{editor.remember();editor.source.value='';editor.lyrics.value=change.old.lyrics;editor.binding=change.old.binding;editor.pull();editor.save();}
  this.undoState=null;this.applied=false;this.snapshot=inlineContext(this.mode);this.message('已恢复本次 AI 填入前的内容。');this.controls();
 }
 async history(){
  const task=this.task,records=(await api.assistantHistory()).filter(r=>r.request.mode===this.mode&&(r.request.task===task||r.request.task==='compose')).slice(0,5);if(task!==this.task)return;
  this.get('[data-ai-history]').replaceChildren();for(const record of records){const b=document.createElement('button');b.textContent=(record.proposal.title||'创作建议')+' · '+new Date(record.createdAt).toLocaleDateString();b.onclick=()=>{if(inlineBusy)return;this.snapshot=record.request.context;this.show(record);this.message('历史建议已打开，填入前会核对当前内容。');};this.get('[data-ai-history]').append(assistantHistoryRow(record,b));}
 }
}
for(const mode of ['create','cover'])inlineAssistants[mode]=new InlineFieldAI(mode);
for(const button of $$('[data-ai-open]'))button.onclick=()=>inlineAssistants[button.dataset.mode].open(button.dataset.aiOpen);
function assistantHistoryRow(record, open) {
 const row=document.createElement('div');row.className='assistant-history-row';
 const remove=action('删除',async()=>{
  remove.disabled=true;
  try{if(!await api.assistantDeleteRecord(record.id))return;
   for(const helper of Object.values(inlineAssistants))if(helper.record?.id===record.id){helper.record=null;helper.get('[data-ai-result]').hidden=true;helper.controls();helper.message('建议记录已删除，已应用到作品的内容保留。');}
   await refreshInlineHistory();toast('AI 建议已移到 Windows 回收站');
  }finally{remove.disabled=false;}
 });
 remove.classList.add('delete-history');remove.dataset.deleteAssistant=record.id;remove.setAttribute('aria-label','删除 AI 建议：'+(record.proposal.title||'创作建议'));
 row.append(open,remove);return row;
}
async function refreshInlineHistory(){const records=await api.assistantHistory(),box=$('#assistant-history');box.replaceChildren();for(const record of records){const b=action((record.proposal.title||'未命名建议')+' · '+new Date(record.createdAt).toLocaleString(),()=>{if(inlineBusy)return;const helper=inlineAssistants[record.request.mode];helper.open(['style','lyrics','score'].includes(record.request.task)?record.request.task:'lyrics');helper.snapshot=record.request.context;helper.show(record);navigate(record.request.mode);});box.append(assistantHistoryRow(record,b));}for(const helper of Object.values(inlineAssistants))await helper.history();}
$('#assistant-save-settings').onclick=safe(async()=>{try{await api.assistantConfigure({model:$('#assistant-model').value,thinking:$('#assistant-thinking').checked,...($('#assistant-key').value.trim()?{apiKey:$('#assistant-key').value.trim()}:{})});await refreshAssistantSettings();$('#assistant-progress').textContent='设置已保存。';}finally{$('#assistant-key').value='';}});
$('#assistant-remove-key').onclick=safe(async()=>{await api.assistantRemoveKey();$('#assistant-key').value='';await refreshAssistantSettings();$('#assistant-progress').textContent='保存的密钥已移除。';});
$('#assistant-test').onclick=safe(async()=>{$('#assistant-test').disabled=true;$('#assistant-progress').textContent='正在检查连接…';try{const r=await api.assistantTest();$('#assistant-progress').textContent='连接成功 · '+r.models.join(' / ');}catch(e){$('#assistant-progress').textContent=inlineError(e);}finally{$('#assistant-test').disabled=false;}});
$('#assistant-key-link').onclick=safe(()=>api.external('deepseek'));$('#assistant-doc-link').onclick=safe(()=>api.external('deepseekDocs'));$('#assistant-skill-read').onclick=safe(async()=>{$('#assistant-skill-text').textContent=await api.assistantSkill();$('#assistant-skill-details').open=true;});
api.onAssistantProgress(event=>{if(inlineBusy?.awaitingResponse)inlineBusy.message(event.stage);});
document.addEventListener('DOMContentLoaded',safe(async()=>{await refreshAssistantSettings();await refreshInlineHistory();}),{once:true});
