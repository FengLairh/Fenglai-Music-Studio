'use strict';
let recognitionState={pendingId:null,previewId:null,previewSource:null,previewText:'',language:'zh',separateVocals:null,open:false};
let recognizingClick=false,recognitionInitialized=false;
const recognitionBox=document.createElement('section');recognitionBox.className='lyrics-recognition';
recognitionBox.innerHTML='<div class="recognition-toolbar"><button id="recognize-lyrics" class="button secondary small">识别原曲歌词</button><select id="recognition-language" aria-label="原曲演唱语言"><option value="zh">中文</option><option value="auto">自动判断语言</option><option value="en">英语</option><option value="ja">日语</option><option value="ko">韩语</option></select></div><label class="recognition-separate"><input id="recognition-separate" type="checkbox">先分离人声，减少伴奏干扰</label><p id="recognition-status" class="help" role="status">千问识别所选原曲片段，先校对再填入。</p><div id="recognition-preview" hidden><div class="label-row"><strong>原曲歌词 · 待校对</strong><button id="recognition-close" class="text-button">收起</button></div><textarea id="recognition-text" rows="6" maxlength="12000" aria-label="识别歌词校对"></textarea><details><summary>按识别片段回听原曲</summary><div id="recognition-segments"></div></details><div class="recognition-actions"><button id="recognition-apply" class="button secondary small">填入 Cover 歌词</button><button id="recognition-export" class="text-button">导出识别原文</button></div><p class="help">识别可能漏字、错字或误识别间奏，请试听校对。回听范围对应识别片段，并非逐字对齐；填入后可用 AI 辅助整理段落，谱上填词仍需核对。</p></div>';
$('#page-cover .lyric-field').before(recognitionBox);
const recognitionSettings=document.createElement('section');recognitionSettings.className='settings-section';
recognitionSettings.innerHTML='<div class="section-top"><strong>原曲歌词识别</strong><span id="lyrics-ready" class="status-pill"></span></div><p class="help">千问 Qwen3-ASR 1.7B · 约 4.1 GB · 本地单显卡，不上传音频。使用独立识别环境；人声分离后再加载千问。</p><button id="install-lyrics" class="button secondary">准备歌词识别</button><p id="lyrics-model-status" class="help"></p>';
$('#page-settings').append(recognitionSettings);
const timingSettings=document.createElement('section');timingSettings.className='settings-section';
timingSettings.innerHTML='<div class="section-top"><strong>歌词时间对齐</strong><span id="score-timing-ready" class="status-pill"></span></div><p class="help">千问 Qwen3-ForcedAligner 0.6B · 约 1.85 GB · 用于成品试听逐字跟谱。首次分析使用 CPU，结果保存在本机。自动估计仍可能有偏差，漏唱与不确定位置不高亮；支持同步校正。目前支持 5 分钟以内的歌曲。</p><button id="install-score-timing" class="button secondary">准备歌词时间对齐</button><p id="score-timing-model-status" class="help"></p>';
$('#page-settings').append(timingSettings);$('#install-score-timing').onclick=()=>install('score-sync');
function recognitionData(){return {...recognitionState,previewText:$('#recognition-text').value,language:$('#recognition-language').value,separateVocals:$('#recognition-separate').checked};}
function restoreRecognition(saved){
 if(saved&&typeof saved==='object')recognitionState={...recognitionState,...saved};
 $('#recognition-language').value=['zh','en','ja','ko','auto'].includes(recognitionState.language)?recognitionState.language:'zh';
 $('#recognition-text').value=typeof recognitionState.previewText==='string'?recognitionState.previewText.slice(0,12000):'';
 $('#recognition-separate').checked=recognitionState.separateVocals===true;recognitionInitialized=true;renderRecognitionStatus();
}
function recognitionMatches(job){const r=job?.request,v=coverValues();return r?.sourceId===v.sourceId&&r.start===v.start&&r.end===v.end;}
function recognitionTarget(){return jobs.find(j=>j.id===recognitionState.previewId)||(recognitionState.previewSource?{request:recognitionState.previewSource,status:'completed'}:null);}
function renderRecognitionStatus(){
 if(!state)return;const available=state.lyrics||{},pending=jobs.find(j=>j.id===recognitionState.pendingId),busy=!!pending&&['queued','running'].includes(pending.status);
 if(recognitionState.separateVocals===null&&recognitionInitialized){recognitionState.separateVocals=!!available.separationReady;$('#recognition-separate').checked=recognitionState.separateVocals;}
 $('#recognition-separate').disabled=!available.separationReady;$('#recognition-separate').title=available.separationReady?'先分离原唱，再识别歌词':'可在设置中准备音色环境后启用人声分离';
 $('#recognize-lyrics').disabled=recognizingClick||busy||!!state.operation||coverBusy||!coverSourceId;
 $('#recognize-lyrics').textContent=busy?'正在识别…':'识别原曲歌词';
 const status=$('#recognition-status');status.replaceChildren();
 if(busy){status.textContent=pending.stage+' ';status.append(action('取消识别',()=>api.cancelJob(pending.id)));}
 else if(!available.ready){status.textContent='首次使用请在设置中准备歌词识别。 ';status.append(action('前往设置',()=>navigate('settings')));}
 else status.textContent='使用千问识别当前选段，先校对再填入。';
 const job=recognitionTarget();
 $('#recognition-preview').hidden=!recognitionState.open||!job||job.status!=='completed';
 $('#recognition-apply').disabled=!job||!recognitionMatches(job)||!$('#recognition-text').value.trim();
 $('#recognition-export').disabled=!recognitionState.previewId;
 if(job&&recognitionState.open&&!recognitionMatches(job))status.textContent='这份识别结果对应另一段原曲，请选回对应原曲和时间范围后填入。';
 statusBadge($('#lyrics-ready'),available.ready?'已就绪':'未准备',available.ready?'ready':'warning');
 $('#install-lyrics').disabled=!!state.operation||jobs.some(j=>j.status==='running');
 $('#install-lyrics').textContent=available.ready?'检查 / 补全识别模型':'准备歌词识别';
 $('#lyrics-model-status').textContent=(available.models||[]).map(m=>`${m.name} · ${bytes(m.bytes)} · ${m.ready?'已校验':'待准备'}`).join('\n');
 const timing=state.scoreTiming||{};statusBadge($('#score-timing-ready'),timing.ready?'已就绪':'未准备',timing.ready?'ready':'warning');$('#install-score-timing').disabled=!!state.operation||jobs.some(j=>j.status==='running');$('#install-score-timing').textContent=timing.ready?'检查 / 补全对齐模型':'准备歌词时间对齐';$('#score-timing-model-status').textContent=(timing.models||[]).map(m=>`${m.name} · ${bytes(m.bytes)} · ${m.ready?'已校验':'待准备'}`).join('\n');
}
function renderRecognitionSegments(job){
 const box=$('#recognition-segments');box.replaceChildren();
 for(const segment of job.result.segments){
  const time=segment.sourceStart,b=action((Number.isFinite(time)?`${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')} · `:'时间不确定 · ')+segment.text,async()=>{
   if(!recognitionMatches(job))throw Error('请先选回这份结果对应的原曲和片段');
   const audio=$('#cover-source-audio');clipStop=Number.isFinite(segment.sourceEnd)?Math.min(job.request.end,segment.sourceEnd+.5):Math.min(job.request.end,time+10);await window.studioPlayer.clip(audio,time,clipStop);
  });b.disabled=!Number.isFinite(time);box.append(b);
 }
}
async function showRecognition(job,mode='user'){
 const previous=jobs.find(j=>j.id===recognitionState.previewId),edited=$('#recognition-text').value;
 const keepEdits=recognitionState.previewId===job.id;
 if(!keepEdits&&edited.trim()&&edited!==(previous?.result?.text||'')){
  if(mode==='completed'){toast('新识别结果已保存到下方任务历史；当前校对稿保留。');return false;}
  if(!await studioConfirm('打开这份识别原文会替换当前尚未应用的校对稿，是否继续？'))return false;
 }
 recognitionState.previewId=job.id;recognitionState.previewSource={...job.request};recognitionState.open=true;
 if(!keepEdits){recognitionState.previewText=job.result.text;$('#recognition-text').value=job.result.text;}
 renderRecognitionSegments(job);renderRecognitionStatus();saveCoverDraft();return true;
}
async function recognitionJobs(){
 if(!recognitionInitialized)return;
 const pending=jobs.find(j=>j.id===recognitionState.pendingId);
 if(pending?.status==='completed'){recognitionState.pendingId=null;if(await showRecognition(pending,'completed'))toast('原曲歌词已识别，请校对预览后填入');else saveCoverDraft();}
 else if(pending&&['failed','cancelled','interrupted'].includes(pending.status)){recognitionState.pendingId=null;saveCoverDraft();if(pending.status==='failed')toast(pending.error||'歌词识别失败',true);}
 else if(recognitionState.pendingId&&!pending){recognitionState.pendingId=null;saveCoverDraft();}
 const preview=jobs.find(j=>j.id===recognitionState.previewId);
 if(preview&&preview.status==='completed')renderRecognitionSegments(preview);
 else if(recognitionState.previewId){recognitionState.previewId=null;$('#recognition-segments').replaceChildren();saveCoverDraft();}
 renderRecognitionStatus();
}
function recognitionRow(job){
 const row=document.createElement('article');row.className='job-row';row.dataset.jobId=job.id;
 row.innerHTML='<div class="job-icon">词</div><div class="job-text"><strong></strong><p class="job-meta"></p><p class="job-error" hidden></p></div><span class="status-pill"></span><div class="job-actions"></div>';
 row.querySelector('strong').textContent=job.request.title;row.querySelector('.job-meta').textContent=`${job.request.start.toFixed(1)}–${job.request.end.toFixed(1)} 秒 · ${job.stage}${job.status==='completed'?' · 待校对':''}`;
 statusBadge(row.querySelector('.status-pill'),job.status==='running'?'识别中':statusText[job.status],job.status==='completed'?'ready':job.status==='failed'?'error':'');
 if(job.error){row.querySelector('.job-error').hidden=false;row.querySelector('.job-error').textContent=job.error;}
 const box=row.querySelector('.job-actions');
 if(['running','queued'].includes(job.status))box.append(action('取消',()=>api.cancelJob(job.id)));
  else {if(job.status==='completed')box.append(action('校对歌词',async()=>{if(!await showRecognition(job))return;navigate('cover');workbenchEditors.cover.setTab('lyrics');recognitionBox.scrollIntoView({block:'center'});},true),action('导出原文',async()=>{if(await api.exportLyrics(job.id))toast('识别原文已导出');}));
  box.append(action('重新识别',async()=>{const next=await api.retryJob(job.id);recognitionState.pendingId=next.id;saveCoverDraft();await refreshJobs();}));}
 box.append(action('文件夹 ↗',()=>api.openFolder(job.id)),deleteJobButton(job));return row;
}
$('#recognize-lyrics').onclick=safe(async()=>{
 if(!state?.lyrics?.ready){navigate('settings');toast('请先准备歌词识别模型');return;}
 recognizingClick=true;renderRecognitionStatus();
 try{const v=coverValues(),job=await api.createJob({kind:'lyrics',sourceId:v.sourceId,start:v.start,end:v.end,language:$('#recognition-language').value,separateVocals:$('#recognition-separate').checked});recognitionState.pendingId=job.id;saveCoverDraft();await refreshJobs();toast('已加入单显卡队列，识别完成后会显示预览');}
 finally{recognizingClick=false;renderRecognitionStatus();}
});
$('#recognition-apply').onclick=safe(async()=>{
 const job=recognitionTarget();if(!job||!recognitionMatches(job))throw Error('原曲或选段已变化，请先选回对应片段');
 const text=$('#recognition-text').value.trim();if(!text||text.length>12000)throw Error('请输入有效的校对歌词');
 if($('#cover-lyrics').value.trim()&&!await studioConfirm('用校对后的识别歌词替换当前 Cover 歌词？请确认已保留需要的原有编辑。'))return;
 $('#cover-lyrics').value=text;saveCoverDraft();toast('已填入 Cover 歌词，可继续整理段落并在谱上校对');
});
$('#recognition-text').oninput=()=>{recognitionState.previewText=$('#recognition-text').value;saveCoverDraft();renderRecognitionStatus();};
$('#recognition-close').onclick=()=>{recognitionState.open=false;saveCoverDraft();renderRecognitionStatus();};
$('#recognition-export').onclick=safe(async()=>{if(recognitionState.previewId&&await api.exportLyrics(recognitionState.previewId))toast('识别原文已导出');});
for(const id of ['recognition-language','recognition-separate'])$('#'+id).onchange=()=>{recognitionState.language=$('#recognition-language').value;recognitionState.separateVocals=$('#recognition-separate').checked;saveCoverDraft();};
$('#install-lyrics').onclick=()=>install('lyrics');
