'use strict';
(()=>{
 const settings=$('#page-settings'),summary=document.createElement('section');summary.id='environment-summary';summary.className='settings-section environment-summary';summary.innerHTML='<div class="section-top"><strong>本地环境状态</strong><span id="environment-total" class="status-pill">检查中</span></div><div id="environment-rows"></div><p id="environment-operation" class="help" role="status" hidden></p>';
 const legacy=document.createElement('div');legacy.hidden=true;legacy.id='environment-legacy';
 const old=[...settings.querySelectorAll('.environment-grid,.cover-model-panel,.setup-action')];
 for(const id of ['install-lyrics','install-score-timing','install-voice-design','install-music-style'])old.push($('#'+id).closest('section'));
 const rows=[
  ['music','音乐生成','YuE2', 'install-all',s=>s.runtimeInstalled&&s.modelsReady],
  ['cover','歌曲转谱','SheetSage2','models-install-cover',s=>s.cover?.ready],
  ['voice','音色替换','Seed-VC','models-install-voice',s=>s.voice?.ready],
  ['lyrics','歌词识别','Qwen3-ASR','install-lyrics',s=>s.lyrics?.ready],
  ['timing','乐谱自动对齐','Qwen3-ForcedAligner','install-score-timing',s=>s.scoreTiming?.ready],
  ['design','AI 音色设计','Qwen3-TTS','install-voice-design',s=>s.voiceDesign?.ready],
  ['style','原曲风格识别','Qwen2.5-Omni','install-music-style',s=>s.musicStyle?.ready]
 ];
 for(const [key,title,model,id]of rows){const row=document.createElement('div');row.className='environment-row';row.dataset.environment=key;row.innerHTML='<div><strong></strong><small></small></div><span class="status-pill" role="status"></span>';row.querySelector('strong').textContent=title;row.querySelector('small').textContent=model;row.append($('#'+id));summary.querySelector('#environment-rows').append(row);}
 summary.append($('#cancel-install'));for(const node of old)if(node&&!legacy.contains(node))legacy.append(node);
 for(const id of ['setup-banner','cover-setup','voice-setup']){const node=$('#'+id);if(node)legacy.append(node);}
 const hardware=settings.querySelector('.hardware-card');hardware.before(summary);summary.before(hardware);settings.append(legacy);
 const diagnostics=document.createElement('details');diagnostics.className='settings-section environment-diagnostics';diagnostics.innerHTML='<summary>运行诊断与日志</summary>';diagnostics.append($('#diagnose'),$('#diagnostics'));const logs=settings.querySelector('.log-panel');if(logs)diagnostics.append(logs);summary.after(diagnostics);
 window.environmentSummary={render(s=state){if(!s)return;let ready=0;const busy=!!s.operation||jobs.some(j=>j.status==='running');for(const [key,, ,id,check]of rows){const ok=!!check(s),row=summary.querySelector('[data-environment="'+key+'"]'),button=$('#'+id);if(ok)ready++;statusBadge(row.querySelector('.status-pill'),ok?'已就绪':'未准备',ok?'ready':'warning');button.hidden=ok;button.disabled=busy;button.textContent=s.operation?'准备中…':'一键安装';}statusBadge($('#environment-total'),ready+'/'+rows.length+' 已就绪',ready===rows.length?'ready':'warning');$('#environment-operation').hidden=!s.operation;$('#environment-operation').textContent=s.operation?.stage||'';$('#cancel-install').hidden=!s.operation;}};
 // If only the model is missing, reuse the installed Python/CUDA environment.
 $('#install-all').onclick=()=>install(state?.runtimeInstalled?'models':'all');
 $('#music-style-settings').onclick=()=>{navigate('settings');summary.querySelector('[data-environment="style"]').scrollIntoView({block:'center'});};
 window.environmentSummary.render();
})();
