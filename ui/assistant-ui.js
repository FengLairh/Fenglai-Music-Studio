'use strict';
let assistantState=null,assistantBusy=false,assistantMode='create',assistantSnapshot=null,assistantRecord=null,assistantRecords=[];
function assistantContext(mode=assistantMode){
 const c=mode==='cover'?coverValues():values();
 return {title:c.title.trim(),style:c.style.trim(),lyrics:c.lyrics.trim(),abc:c.abc.trim(),cot:mode==='cover'?(c.melodyOnly?'melody':'full'):c.cot};
}
function assistantSnapshotMatches(){return assistantSnapshot&&JSON.stringify(assistantSnapshot)===JSON.stringify(assistantContext());}
function assistantMessage(text,error=false){$('#assistant-progress').textContent=text;$('#assistant-progress').classList.toggle('error',error);}
function assistantControls(){
 for(const id of ['assistant-generate','assistant-save-settings','assistant-test','assistant-remove-key','assistant-read-context','assistant-continue','assistant-mode','assistant-task'])$('#'+id).disabled=assistantBusy;
 $('#assistant-generate').disabled=assistantBusy||!assistantState?.credential.configured;
 $('#assistant-cancel').hidden=!assistantBusy;
 $('#assistant-apply').disabled=assistantBusy||!assistantRecord||!assistantSnapshotMatches()||assistantRecord.request.task==='review';
 $('#assistant-conflict').hidden=!assistantRecord||assistantSnapshotMatches();
 for(const el of $$('[data-assistant-open]'))el.disabled=assistantBusy;
}
async function refreshAssistant(){
 assistantState=await api.assistantStatus();
 $('#assistant-model').replaceChildren(...assistantState.models.map(id=>{const o=document.createElement('option');o.value=id;o.textContent=id==='deepseek-flash'?'DeepSeek Flash · 日常创作':'DeepSeek V4 Pro · 复杂改编';return o;}));
 $('#assistant-model').value=assistantState.model;$('#assistant-thinking').checked=assistantState.thinking;
 const credential=assistantState.credential;
 $('#assistant-key-status').textContent=credential.message||(credential.configured?(credential.source==='environment'?'正在使用 DEEPSEEK_API_KEY 环境变量':'密钥已在本机加密保存'):'尚未配置 API Key');
 $('#assistant-key').placeholder=credential.configured?'留空保留现有密钥':'填写 DeepSeek 官方 API Key';
 statusBadge($('#assistant-ready'),credential.configured?'DeepSeek 已配置':'请配置 DeepSeek',credential.configured?'ready':'warning');
 $('#assistant-skill-status').textContent=`官方 yue2-music · ${assistantState.skill.revision.slice(0,12)} · Apache 2.0 · 已校验`;
 assistantControls();
}
function readAssistantContext(){
 assistantSnapshot=assistantContext();assistantRecord=null;
 $('#assistant-context').textContent=`将用于${assistantMode==='cover'?'歌曲 Cover':'音乐创作'}\n标题：${assistantSnapshot.title||'未命名'}\n歌词：${assistantSnapshot.lyrics.length} 字符 · 风格：${assistantSnapshot.style.length} 字符\n乐谱：${assistantSnapshot.abc?assistantSnapshot.abc.length+' 字符':'未提供'} · 作曲模式：${assistantSnapshot.cot}`;
 $('#assistant-result').hidden=true;$('#assistant-empty').hidden=false;assistantMessage('已读取当前表单，填写创作要求后生成方案。');assistantControls();
}
function openMusicAssistant(mode){if(assistantBusy){navigate('assistant');return;}assistantMode=mode;$('#assistant-mode').value=mode;readAssistantContext();navigate('assistant');}
function assistantProposal(){return {title:$('#assistant-title').value,style:$('#assistant-style').value,lyrics:$('#assistant-lyrics').value,cot:assistantRecord.proposal.cot};}
function showAssistantRecord(record){
 assistantRecord=record;$('#assistant-empty').hidden=true;$('#assistant-result').hidden=false;
 for(const field of ['title','style','lyrics'])$('#assistant-'+field).value=record.proposal[field];
 $('#assistant-notes').textContent=[record.proposal.summary,record.proposal.arrangement,...record.proposal.notes.map(x=>'• '+x)].filter(Boolean).join('\n\n');
 $('#assistant-result-info').textContent=`${record.model} · ${record.usage.total_tokens??'—'} tokens · 官方 Skill ${record.skill.revision.slice(0,8)}`;
 assistantControls();
}
async function assistantHistory(){
 assistantRecords=await api.assistantHistory();$('#assistant-history').replaceChildren();
 if(!assistantRecords.length){$('#assistant-history').textContent='成功生成的方案会保存在本机，方便回看与继续修改。';return;}
 for(const record of assistantRecords){const row=document.createElement('div');row.className='assistant-history-row';
  const text=document.createElement('div'),title=document.createElement('strong'),meta=document.createElement('small');
  title.textContent=record.proposal.title||'未命名方案';meta.textContent=`${record.request.mode==='cover'?'Cover':'创作'} · ${new Date(record.createdAt).toLocaleString()} · ${record.model}`;
  text.append(title,meta);const button=action('查看方案',()=>{if(assistantBusy)return;assistantMode=record.request.mode;$('#assistant-mode').value=assistantMode;
   assistantSnapshot=record.request.context;$('#assistant-task').value=record.request.task;$('#assistant-brief').value=record.request.brief;
   $('#assistant-context').textContent='已打开历史方案。应用前会核对当前表单与此方案的原始内容是否一致。';showAssistantRecord(record);navigate('assistant');});row.append(text,button);$('#assistant-history').append(row);
 }
}
for(const button of $$('[data-assistant-open]'))button.onclick=()=>openMusicAssistant(button.dataset.assistantOpen);
$('#assistant-mode').onchange=()=>{assistantMode=$('#assistant-mode').value;readAssistantContext();};
$('#assistant-read-context').onclick=readAssistantContext;
for(const button of $$('[data-assistant-brief]'))button.onclick=()=>{$('#assistant-brief').value=button.dataset.assistantBrief;};
async function runAssistant(continueProposal=false){
 if(!assistantSnapshot)readAssistantContext();
 const input={mode:assistantMode,task:$('#assistant-task').value,brief:$('#assistant-brief').value,
  context:continueProposal&&assistantRecord?{...assistantSnapshot,...assistantProposal()}:assistantSnapshot};
 assistantBusy=true;assistantControls();assistantMessage('正在连接 DeepSeek 官方服务…');
 try{
  if($('#assistant-key').value.trim())throw Error('请先保存刚填写的 API Key');
  await api.assistantConfigure({model:$('#assistant-model').value,thinking:$('#assistant-thinking').checked});
  const record=await api.assistantCompose(input);showAssistantRecord(record);assistantMessage('方案已保存。检查并编辑后，可应用到创作表单。');await assistantHistory();}
 catch(e){assistantMessage(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''),true);}
 finally{assistantBusy=false;assistantControls();}
}
$('#assistant-generate').onclick=()=>runAssistant(false);$('#assistant-continue').onclick=()=>runAssistant(true);
$('#assistant-cancel').onclick=safe(()=>api.assistantCancel());
$('#assistant-apply').onclick=safe(async()=>{
 if(!assistantRecord||!assistantSnapshotMatches())throw Error('当前表单已变化，请重新读取内容后生成方案');
 const proposal=assistantProposal();const prefix=assistantMode==='cover'?'cover':'song';
 for(const field of ['title','style','lyrics'])if($('#assistant-use-'+field).checked){$('#'+prefix+'-'+field).value=proposal[field];}
 if(assistantMode==='cover'){clearTimeout(coverTimer);await api.saveCoverDraft(coverValues());$('#cover-draft-status').textContent='草稿已保存在本机';renderCoverStatus();}
 else{if(!assistantSnapshot.abc)setCot(proposal.cot);clearTimeout(draftTimer);updateCounts();await api.saveDraft(values());$('#draft-status').textContent='草稿已保存在本机';}
 assistantSnapshot=assistantContext();navigate(assistantMode);toast('方案已应用，可检查后生成音乐');
});
$('#assistant-save-settings').onclick=safe(async()=>{
 const apiKey=$('#assistant-key').value.trim();
 try{await api.assistantConfigure({model:$('#assistant-model').value,thinking:$('#assistant-thinking').checked,...(apiKey?{apiKey}:{})});await refreshAssistant();assistantMessage('DeepSeek 设置已保存。');}
 finally{$('#assistant-key').value='';}
});
$('#assistant-remove-key').onclick=safe(async()=>{await api.assistantRemoveKey();$('#assistant-key').value='';await refreshAssistant();assistantMessage('本机保存的密钥已移除。');});
$('#assistant-test').onclick=async()=>{
 assistantBusy=true;assistantControls();assistantMessage('正在验证官方 API 连接…');
 try{const r=await api.assistantTest();assistantMessage('连接成功 · '+r.models.join(' / '));}
 catch(e){assistantMessage(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''),true);}
 finally{assistantBusy=false;assistantControls();}
};
$('#assistant-key-link').onclick=safe(()=>api.external('deepseek'));$('#assistant-doc-link').onclick=safe(()=>api.external('deepseekDocs'));
$('#assistant-skill-read').onclick=safe(async()=>{$('#assistant-skill-text').textContent=await api.assistantSkill();$('#assistant-skill-details').open=true;});
api.onAssistantProgress(event=>{if(assistantBusy)assistantMessage(event.stage);});
document.addEventListener('DOMContentLoaded',safe(async()=>{await refreshAssistant();await assistantHistory();}),{once:true});
