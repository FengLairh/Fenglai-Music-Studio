'use strict';
let timbreDraft={mode:'timbre',preset:'female',instruct:''},timbrePresets=[],timbreInitialized=false,timbreBusy=false,timbreTimer;
const coverModeBar=document.createElement('section');coverModeBar.className='cover-mode-switch';
coverModeBar.innerHTML='<strong>曲风 / 歌词改编</strong><span>保留旋律，重新演绎曲风与歌词</span>';
$('#page-cover .workbench-heading').after(coverModeBar);
const timbrePage=$('#page-voice'),modeBar=document.createElement('section');modeBar.className='voice-mode-switch';
modeBar.innerHTML='<div role="group" aria-label="音色 Cover 模式"><button data-voice-workflow="timbre">仅换人声</button><button data-voice-workflow="reference">上传参考声音</button></div><span id="timbre-mode-note"></span>';
timbrePage.querySelector('.voice-intro').after(modeBar);
const voiceReferenceCard=$('#voice-reference').closest('.cover-card');
const voiceSourceCard=$('#voice-source').closest('.cover-card');
voiceSourceCard.classList.add('voice-source-card');
const useCoverSource=document.createElement('button');useCoverSource.id='voice-use-cover-source';useCoverSource.className='text-button';useCoverSource.textContent='使用歌曲 Cover 原曲';
voiceSourceCard.querySelector('.section-top').append(useCoverSource);
const timbrePanel=document.createElement('section');timbrePanel.className='timbre-panel';timbrePanel.hidden=true;
timbrePanel.innerHTML='<div class="section-top"><div><strong>选择演唱音色</strong><p class="help">沿用原唱内容、原调和节奏，直接回混原伴奏。</p></div><span class="status-pill ready">歌词与伴奏已锁定</span></div><div id="timbre-presets" class="timbre-presets" role="radiogroup" aria-label="演唱声音预设"></div><div class="timbre-custom-row"><label for="timbre-custom">已生成的音色</label><select id="timbre-custom"><option value="">选择 AI 自定义音色…</option></select><button class="button secondary small" id="timbre-preview">试听当前音色</button><span id="timbre-selected" class="help"></span></div><audio id="timbre-audio" controls preload="metadata" hidden></audio><details class="timbre-design"><summary>AI 辅助生成音色</summary><p class="help">描述年龄感、明亮度、厚度或轻微沙哑等特征，生成一段音色参考。翻唱的音高、拖腔和节奏仍沿用原唱。</p><textarea id="timbre-instruct" rows="3" maxlength="500" placeholder="例如：温暖、成熟的女声，圆润清晰，有轻微沙哑…" aria-label="AI 音色描述"></textarea><div class="timbre-design-actions"><button id="timbre-design" class="button secondary">AI 生成新音色</button><button id="timbre-design-cancel" class="text-button" hidden>停止生成</button><button id="timbre-settings" class="text-button">音色模型设置</button></div><p id="timbre-design-status" class="help" role="status"></p></details><p class="help">音色试听是参考声音。实际翻唱效果取决于原唱音域与分离质量，可能有少量原唱残留。</p></section>';
timbrePage.querySelector('.voice-input-grid').after(timbrePanel);
// Keep readiness guidance visible when the strict preset workflow hides mixing controls.
const voiceGenerateStatus=document.createElement('p');voiceGenerateStatus.className='help voice-generate-status';
voiceGenerateStatus.append($('#voice-generate-hint'));modeBar.after(voiceGenerateStatus);
const designSettings=document.createElement('section');designSettings.className='settings-section';designSettings.innerHTML='<div class="section-top"><strong>AI 演唱音色设计</strong><span id="voice-design-ready" class="status-pill"></span></div><p class="help">千问 Qwen3-TTS VoiceDesign · 本地单显卡生成虚拟音色参考。五种内置预设可直接使用；自定义音色需准备独立模型和环境。</p><button id="install-voice-design" class="button secondary">准备 AI 音色设计</button><p id="voice-design-models" class="help"></p>';
$('#page-settings').append(designSettings);
function saveTimbreDraft(){if(!timbreInitialized)return;timbreDraft.instruct=$('#timbre-instruct').value;clearTimeout(timbreTimer);timbreTimer=setTimeout(safe(()=>api.saveTimbreDraft(timbreDraft)),300);}
function renderTimbre(){
 if(!state)return;
 const active=timbreDraft.mode==='timbre',selected=timbrePresets.find(p=>p.id===timbreDraft.preset),design=state.voiceDesign||{},operation=state.operation;
 timbrePage.classList.toggle('timbre-mode',active);timbrePanel.hidden=!active;
 voiceReferenceCard.hidden=active;timbrePage.querySelector('.voice-tuning').hidden=active;
 $('#voice-source-music').closest('label').hidden=active;
 $('#voice-source-music').closest('label').nextElementSibling.textContent=active?'每次处理 5–300 秒，自动分离人声并保留原伴奏。建议先试 20–30 秒。':'每次处理 5–300 秒，建议先试 20–30 秒。只有干声时取消勾选。';
 $$('[data-voice-workflow]').forEach(b=>{const on=b.dataset.voiceWorkflow===timbreDraft.mode;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on);});
 $('#timbre-mode-note').textContent=active?'预设 / AI 音色 · 保留原歌词、旋律和伴奏':'选择目标声音 · 可调整演唱与混音';
 useCoverSource.disabled=!coverSourceId||voiceBusy||timbreBusy;
 $$('#timbre-presets button').forEach((b,i)=>{const selected=b.dataset.preset===timbreDraft.preset;b.setAttribute('aria-checked',String(selected));b.tabIndex=selected||(!timbrePresets.find(p=>p.id===timbreDraft.preset)?.builtin&&i===0)?0:-1;});
 $('#timbre-selected').textContent=selected?'当前：'+selected.name:'';$('#timbre-custom').value=selected&&!selected.builtin?selected.id:'';
 $('#timbre-preview').disabled=timbreBusy||!selected?.ready;
 const designing=operation?.kind==='voice-design';$('#timbre-design').disabled=timbreBusy||!!operation||jobs.some(j=>j.status==='running')||!$('#timbre-instruct').value.trim();
 $('#timbre-design-cancel').hidden=!designing;$('#timbre-design-status').textContent=designing?operation.stage:!design.ready?'自定义音色需要先在设置中准备模型；内置预设可直接试听和翻唱。':'音色生成在本机完成，不上传歌曲。';
 statusBadge($('#voice-design-ready'),design.ready?'已就绪':'未准备',design.ready?'ready':'warning');$('#install-voice-design').disabled=!!operation||jobs.some(j=>j.status==='running');$('#voice-design-models').textContent=(design.models||[]).map(m=>`${m.name} · ${bytes(m.bytes)} · ${m.ready?'已校验':'待准备'}`).join('\n');
 if(active){
  $('#voice-generate').textContent='生成翻唱';$('#voice-generate').disabled=!state.voice?.ready||!$('#voice-source').value||!selected?.ready||!!operation||voiceBusy||timbreBusy;
  $('#voice-generate-hint').textContent=operation?'当前操作：'+operation.stage:!state.voice?.ready?'请在设置准备音色转换环境':!$('#voice-source').value?'先选择原曲和片段':!selected?.ready?'请选择可用的声音预设':'只换人声 · 原歌词与伴奏保留';
 }else{
  $('#voice-generate').textContent='开始替换音色';
  if(timbreBusy)$('#voice-generate').disabled=true;
 }
}
async function refreshTimbrePresets(){
 timbrePresets=await api.voicePresets();const box=$('#timbre-presets');box.replaceChildren();
 for(const p of timbrePresets.filter(p=>p.builtin)){
  const b=document.createElement('button');b.type='button';b.dataset.preset=p.id;b.setAttribute('role','radio');b.setAttribute('aria-checked',String(timbreDraft.preset===p.id));
  const title=document.createElement('strong'),detail=document.createElement('span');title.textContent=p.name;detail.textContent=p.detail;b.append(title,detail);
  b.onclick=()=>{timbreDraft.preset=p.id;$('#timbre-instruct').value=p.instruct;$('#timbre-audio').pause();$('#timbre-audio').hidden=true;saveTimbreDraft();renderTimbre();};
  b.onkeydown=e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;e.preventDefault();const cards=[...box.querySelectorAll('button')],i=cards.indexOf(b),next=e.key==='Home'?0:e.key==='End'?cards.length-1:(i+(e.key==='ArrowRight'?1:-1)+cards.length)%cards.length;cards[next].click();cards[next].focus();};box.append(b);
 }
 const menu=$('#timbre-custom');menu.replaceChildren(voiceOption('','选择 AI 自定义音色…'),...timbrePresets.filter(p=>!p.builtin).map(p=>voiceOption(p.id,p.name)));
 renderTimbre();
}
function chooseTimbreMode(mode){if(!['reference','timbre'].includes(mode))return;timbreDraft.mode=mode;$('#timbre-audio').pause();$('#voice-reference-audio').pause();renderVoiceStatus();saveTimbreDraft();}
function compareTimbre(job){compareVoice(job);}
const baseEditVoiceJob=editVoiceJob;
editVoiceJob=function(job){chooseTimbreMode('reference');baseEditVoiceJob(job);};
async function editTimbreJob(job){
 await refreshTimbrePresets();voiceSources=await api.listSources();
 baseEditVoiceJob(job);
 const preset=timbrePresets.find(p=>p.sourceId===job.request.referenceId);
 timbreDraft.preset=preset?.id||'';$('#timbre-instruct').value=preset?.instruct||'';
 chooseTimbreMode('timbre');
 if(!preset)toast('原音色已不可用，请重新选择演唱音色');
}
const baseVoiceStatus=renderVoiceStatus;renderVoiceStatus=function(){baseVoiceStatus();renderTimbre();};
const baseVoiceGenerate=$('#voice-generate').onclick;
$('#voice-generate').onclick=safe(async event=>{
 if(timbreBusy)return;
 if(timbreDraft.mode!=='timbre')return baseVoiceGenerate(event);
 timbreBusy=true;renderTimbre();
 try{
  const snapshot=voiceValues(),preset=timbreDraft.preset,reference=await api.voicePresetSource(preset);
  const current=voiceValues();
  if(timbreDraft.mode!=='timbre'||current.inputType!==snapshot.inputType||current.sourceId!==snapshot.sourceId||current.sourceJobId!==snapshot.sourceJobId||current.start!==snapshot.start||current.end!==snapshot.end||timbreDraft.preset!==preset)throw Error('选段或音色已变化，请重新生成');
  const name=timbrePresets.find(p=>p.id===preset)?.name||'自定义音色';
  await api.createJob({...snapshot,referenceId:reference.id,title:(snapshot.title+' · '+name+'翻唱').slice(0,100),referenceStart:0,referenceEnd:Math.min(reference.seconds,20),sourceHasMusic:true,referenceHasMusic:false,semitones:0,pitchMode:'vocal',preserveDynamics:true,preserveSong:true,vocalGainDb:0,accompanimentGainDb:0});
  await refreshJobs();window.taskDrawer?.open();toast('仅换人声翻唱已加入单显卡队列');
 }finally{timbreBusy=false;renderVoiceStatus();}
});
$$('[data-voice-workflow]').forEach(b=>b.onclick=()=>chooseTimbreMode(b.dataset.voiceWorkflow));
useCoverSource.onclick=safe(async()=>{
 const snapshot=coverValues();if(!snapshot.sourceId)return;
 voiceSources=await api.listSources();voiceMenus();chooseVoiceSource('source:'+snapshot.sourceId);
 if(!$('#voice-source').value)throw Error('原曲已不可用，请重新导入');
 $('#voice-start').value=snapshot.start;$('#voice-end').value=snapshot.end;saveVoiceDraft();
 for(const id of ['voice-start','voice-end'])$('#'+id).dispatchEvent(new Event('input',{bubbles:true}));
 toast('已载入歌曲 Cover 的原曲与选段');
});
$('#timbre-custom').onchange=()=>{const p=timbrePresets.find(p=>p.id===$('#timbre-custom').value);if(!p)return;timbreDraft.preset=p.id;$('#timbre-instruct').value=p.instruct||'';$('#timbre-audio').pause();$('#timbre-audio').hidden=true;saveTimbreDraft();renderTimbre();};
$('#timbre-instruct').oninput=()=>{saveTimbreDraft();renderTimbre();};
$('#timbre-preview').onclick=safe(async()=>{const id=timbreDraft.preset,reference=await api.voicePresetSource(id);if(id!==timbreDraft.preset)return;const audio=$('#timbre-audio');audio.src=`yue-audio://${reference.id}/original.wav`;audio.dataset.seconds=reference.seconds;audio.hidden=true;await window.studioPlayer.start(audio);});
$('#timbre-design').onclick=safe(async()=>{
 if(!state.voiceDesign?.ready){navigate('settings');toast('请先准备 AI 音色设计模型');return;}
 timbreBusy=true;renderTimbre();const prior=timbreDraft.preset,instruct=$('#timbre-instruct').value;
 try{const source=await api.voiceDesignCreate({instruct,name:'AI 音色 · '+instruct.slice(0,20),seed:Math.floor(Math.random()*2147483647)});await refreshTimbrePresets();
  if(prior===timbreDraft.preset&&instruct===$('#timbre-instruct').value){timbreDraft.preset=source.id;saveTimbreDraft();$('#timbre-audio').src=`yue-audio://${source.id}/original.wav`;$('#timbre-audio').hidden=true;}
  toast('新音色已保存，可先试听再生成翻唱');
 }finally{timbreBusy=false;renderVoiceStatus();}
});
$('#timbre-design-cancel').onclick=safe(()=>api.cancelInstall());$('#timbre-settings').onclick=()=>navigate('settings');$('#install-voice-design').onclick=()=>install('voice-design');
api.onChange(safe(async e=>{if(e.kind==='sources')await refreshTimbrePresets();renderTimbre();}));
document.addEventListener('DOMContentLoaded',safe(async()=>{const draft=await api.getTimbreDraft();if(draft&&['arrange','reference','timbre'].includes(draft.mode))timbreDraft={...timbreDraft,...draft,mode:draft.mode==='arrange'?'reference':draft.mode};await refreshTimbrePresets();if(!timbrePresets.some(p=>p.id===timbreDraft.preset))timbreDraft.preset='female';$('#timbre-instruct').value=timbreDraft.instruct||timbrePresets.find(p=>p.id===timbreDraft.preset)?.instruct||'';timbreInitialized=true;renderVoiceStatus();}),{once:true});
