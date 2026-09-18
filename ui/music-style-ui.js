'use strict';
(()=>{
 const style=$('#cover-original-style'),section=style.closest('section'),box=document.createElement('div');box.className='music-style-analysis';
 box.innerHTML='<div class="recognition-toolbar"><button id="analyze-music-style" class="button secondary small">分析原曲音频</button><button id="cancel-music-style" class="text-button" hidden>取消识别</button><button id="music-style-settings" class="text-button">前往设置</button></div><p id="music-style-status" class="help" role="status">本地识别所选音频的曲风、配器和人声特征；长片段采样分析，结果可编辑。</p><div id="music-style-result" hidden><details><summary>查看识别特征与采样范围</summary><p id="music-style-provenance" class="help"></p><dl id="music-style-details"></dl></details><button id="apply-music-style" class="button secondary small">填入原曲风格</button></div>';
 section.insertBefore(box,$('#cover-original-style-job'));
 const settings=document.createElement('section');settings.className='settings-section';settings.innerHTML='<div class="section-top"><strong>原曲风格识别</strong><span id="music-style-ready" class="status-pill"></span></div><p class="help">Qwen2.5-Omni 3B · 约 12 GB 模型文件 · 本地音频理解，不上传音频。复用千问运行环境，仅加载文字输出模块；和生成任务共用单显卡队列。模型识别结果需要试听核对。</p><button id="install-music-style" class="button secondary">准备原曲风格识别</button><p id="music-style-model-status" class="help"></p>';
 $('#page-settings').append(settings);
 let saved={pending:null,previewId:null,origin:''},clicking=false,initialized=false;
 const matches=job=>job?.request.sourceId===coverSourceId&&job.request.start===Number($('#cover-start').value)&&job.request.end===Number($('#cover-end').value);
 const preview=()=>jobs.find(j=>j.id===saved.previewId&&j.request.kind==='music-style'&&j.status==='completed');
 const dirty=()=>{if(saved.pending)saved.pending.dirty=true;};
 const ui={
  data(){return saved;},
  sourceChanged(){dirty();saved.origin='';},
  restore(value){if(value&&typeof value==='object')saved={pending:value.pending||null,previewId:value.previewId||null,origin:typeof value.origin==='string'?value.origin:''};initialized=true;},
  readFromJob(job){dirty();saved.previewId=null;saved.origin=`已读取本机作品「${job.request.title}」保存的风格；这是该作品的生成风格，请确认它对应原曲。`;this.render();toast('风格已填入，可检查后继续生成');},
  render(){
   if(!state)return;const available=state.musicStyle||{},pending=jobs.find(j=>j.id===saved.pending?.jobId),busy=!!pending&&['queued','running'].includes(pending.status),job=preview();
   $('#analyze-music-style').disabled=clicking||busy||!!state.operation||coverBusy||!coverSourceId;
   $('#analyze-music-style').textContent=busy?'正在分析…':'分析原曲音频';$('#cancel-music-style').hidden=!busy;
   $('#music-style-settings').hidden=!!available.ready;
   const status=$('#music-style-status');status.textContent=busy?pending.stage:!available.ready?'首次使用请到设置中准备原曲风格识别模型。':saved.origin||'分析当前所选原曲；超过 60 秒时采样开头、中间和结尾，每段 20 秒。结果可编辑。';
   $('#music-style-result').hidden=!job;
   if(job){
    const r=job.result;$('#music-style-provenance').textContent=`Qwen2.5-Omni · ${coverSources.find(s=>s.id===job.request.sourceId)?.name||job.request.title} · 采样 ${r.samples.map(s=>`${s.start.toFixed(1)}–${s.end.toFixed(1)} 秒`).join('、')}。${matches(job)?'请试听核对，乐器和音色可能误判。':'结果对应其他原曲或选段，请选回对应片段后填入。'}`;
    const details=$('#music-style-details'),stamp=job.id;if(details.dataset.job!==stamp){details.replaceChildren();for(const [key,label] of [['genre','曲风'],['instruments','配器'],['vocals','人声'],['mood','情绪'],['tempo','速度与律动'],['uncertainty','不确定之处']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=r[key];details.append(dt,dd);}details.dataset.job=stamp;}
   }
   $('#apply-music-style').disabled=!job||!matches(job);
   statusBadge($('#music-style-ready'),available.ready?'已就绪':'未准备',available.ready?'ready':'warning');
   $('#install-music-style').disabled=!!state.operation||jobs.some(j=>['running','queued'].includes(j.status));$('#install-music-style').textContent=available.ready?'检查 / 补全风格模型':'准备原曲风格识别';
   $('#music-style-model-status').textContent=(available.models||[]).map(m=>`${m.name} · ${bytes(m.bytes)} · ${m.ready?'已校验':'待准备'}`).join('\n');
  },
  jobsChanged(){
   if(!initialized)return;const pending=saved.pending,job=jobs.find(j=>j.id===pending?.jobId);
   if(pending&&(!job||!['queued','running'].includes(job.status))){saved.pending=null;
    if(job?.status==='completed'){saved.previewId=job.id;const auto=matches(job)&&!pending.dirty&&pending.before===style.value&&coverWorkflow.mode==='lyrics-only';
     if(auto){style.value=job.result.style;saved.origin='已根据原曲音频填入风格，请试听核对后继续生成。';inlineAssistants.cover.describeContext();}
     else saved.origin='分析已完成；当前编辑保留，可查看结果后点击“填入原曲风格”。';
     toast(saved.origin);
    }else saved.origin=job?.error||'原曲风格识别已取消或中断，可重新分析。';
    saveCoverDraft();
   }
   this.render();
  },
  show(job){saved.previewId=job.id;saved.origin='已打开历史风格分析；请确认原曲与选段后填入。';navigate('cover');coverWorkflow.select('lyrics-only');workbenchEditors.cover.setTab('style');this.render();saveCoverDraft();},
  async start(retryJob){
   if(!state?.musicStyle?.ready){navigate('settings');settings.scrollIntoView({block:'center'});toast('请先准备原曲风格识别模型');return;}
   clicking=true;this.render();try{const request=retryJob?.request||{kind:'music-style',sourceId:coverSourceId,start:Number($('#cover-start').value),end:Number($('#cover-end').value)},before=style.value;
    const job=await api.createJob(request);saved.pending={jobId:job.id,before,dirty:style.value!==before};saved.origin='已加入单显卡队列';saveCoverDraft();await refreshJobs();
   }finally{clicking=false;this.render();}
  }
 };
 window.musicStyleUI=ui;
 $('#analyze-music-style').onclick=safe(()=>ui.start());$('#cancel-music-style').onclick=safe(async()=>{if(saved.pending)await api.cancelJob(saved.pending.jobId);});
 $('#music-style-settings').onclick=()=>{navigate('settings');settings.scrollIntoView({block:'center'});};$('#install-music-style').onclick=()=>install('music-style');
 $('#apply-music-style').onclick=safe(async()=>{const job=preview();if(!job||!matches(job))throw Error('请先选回对应原曲和选段');if(style.value.trim()&&style.value!==job.result.style&&!await studioConfirm('用此音频识别结果替换当前原曲风格？'))return;
  if(!matches(job))throw Error('原曲或选段已变化');dirty();style.value=job.result.style;saved.origin='已填入音频识别的原曲风格，可继续编辑。';inlineAssistants.cover.describeContext();saveCoverDraft();});
 style.addEventListener('input',()=>{dirty();saved.origin='原曲风格已手动编辑。';saveCoverDraft();});
})();

function musicStyleRow(job){
 const row=document.createElement('article');row.className='job-row';row.dataset.jobId=job.id;row.innerHTML='<div class="job-icon">风</div><div class="job-text"><strong></strong><p class="job-meta"></p><p class="job-error" hidden></p></div><span class="status-pill"></span><div class="job-actions"></div>';
 row.querySelector('strong').textContent=job.request.title;row.querySelector('.job-meta').textContent=`${job.request.start.toFixed(1)}–${job.request.end.toFixed(1)} 秒 · ${job.stage}`;
 statusBadge(row.querySelector('.status-pill'),statusText[job.status],job.status==='completed'?'ready':job.status==='failed'?'error':'');if(job.error){row.querySelector('.job-error').hidden=false;row.querySelector('.job-error').textContent=job.error;}
 const box=row.querySelector('.job-actions');if(['running','queued'].includes(job.status))box.append(action('取消',()=>api.cancelJob(job.id)));else{if(job.status==='completed')box.append(action('查看风格',()=>musicStyleUI.show(job),true));box.append(action('重新分析',()=>musicStyleUI.start(job)));}box.append(action('文件夹 ↗',()=>api.openFolder(job.id)),deleteJobButton(job));return row;
}
