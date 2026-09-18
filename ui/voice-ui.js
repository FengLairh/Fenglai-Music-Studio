'use strict';
let voiceSources = [], voiceInitialized = false, voiceBusy = false, voiceDraftTimer, voiceCompareId = null;
const voiceFields = {title:'voice-title', start:'voice-start', end:'voice-end', referenceStart:'voice-reference-start', referenceEnd:'voice-reference-end',
  semitones:'voice-pitch', steps:'voice-steps', vocalGainDb:'voice-vocal-gain', accompanimentGainDb:'voice-instrumental-gain', seed:'voice-seed'};
function voiceValues() {
  const [inputType, inputId] = $('#voice-source').value.split(':');
  const value = {kind:'voice', inputType, [inputType === 'job' ? 'sourceJobId' : 'sourceId']: inputId,
    referenceId:$('#voice-reference').value, sourceHasMusic:$('#voice-source-music').checked, referenceHasMusic:$('#voice-reference-music').checked,
    pitchMode:$('#voice-pitch-mode').value, preserveDynamics:$('#voice-dynamics').checked};
  for (const [key, id] of Object.entries(voiceFields)) value[key] = key === 'title' ? $(`#${id}`).value : Number($(`#${id}`).value);
  return value;
}
function saveVoiceDraft() {
  if (!voiceInitialized) return;
  $('#voice-draft-status').textContent = '正在保存…'; clearTimeout(voiceDraftTimer);
  voiceDraftTimer = setTimeout(safe(async () => {await api.saveVoiceDraft(voiceValues()); $('#voice-draft-status').textContent = '草稿已保存在本机';}), 400);
  renderVoiceStatus();
}
function voiceOption(value, label) {const el = document.createElement('option'); el.value = value; el.textContent = label; return el;}
function voiceMenus() {
  const selected = $('#voice-source').value, reference = $('#voice-reference').value;
  $('#voice-source').replaceChildren(voiceOption('', '请选择歌曲'), ...voiceSources.map(s => voiceOption(`source:${s.id}`, `导入 · ${s.name}`)),
    ...jobs.filter(j => j.status === 'completed' && !['transcribe','lyrics','music-style'].includes(j.request.kind)).map(j => voiceOption(`job:${j.id}`, `作品 · ${j.request.title}`)));
  $('#voice-reference').replaceChildren(voiceOption('', '请选择目标声音'), ...voiceSources.map(s => voiceOption(s.id, s.name)));
  $('#voice-source').value = selected; $('#voice-reference').value = reference;
  if (selected && !$('#voice-source').value) {chooseVoiceSource('', false); $('#voice-source-info').textContent = '源作品已移除，请重新选择歌曲';}
}
function chooseVoiceSource(value, reset = true) {
  const [kind, id] = value.split(':');
  const source = kind === 'job' ? jobs.find(j => j.id === id) : voiceSources.find(s => s.id === id);
  $('#voice-source').value = value;
  const audio = $('#voice-source-audio');
  if (!source) {audio.removeAttribute('src'); audio.load(); saveVoiceDraft(); return;}
  const seconds = kind === 'job' ? source.result.seconds : source.seconds;
  audio.src = `yue-audio://${id}/${kind === 'job' ? 'audio.flac' : 'original.wav'}`;
  $('#voice-source-info').textContent = `${seconds.toFixed(1)} 秒 · 选择需要替换音色的片段`;
  for (const part of ['start', 'end']) $(`#voice-${part}`).max = seconds;
  if (reset) {$('#voice-start').value = 0; $('#voice-end').value = Math.floor(Math.min(seconds, 300)*10)/10;
    $('#voice-title').value = `${kind === 'job' ? source.request.title : source.name.replace(/\.[^.]+$/, '')} · 音色 Cover`.slice(0,100);}
  saveVoiceDraft();
}
function chooseVoiceReference(id, reset = true) {
  $('#voice-reference').value = id;
  const source = voiceSources.find(s => s.id === id), audio = $('#voice-reference-audio');
  if (!source) {audio.removeAttribute('src'); audio.load(); saveVoiceDraft(); return;}
  audio.src = `yue-audio://${id}/original.wav`;
  for (const part of ['start', 'end']) $(`#voice-reference-${part}`).max = source.seconds;
  $('#voice-reference-info').textContent = `${source.seconds.toFixed(1)} 秒 · 从中选择清晰的单人声音，建议 10–15 秒`;
  if (reset) {$('#voice-reference-start').value = 0; $('#voice-reference-end').value = Math.floor(Math.min(12,source.seconds)*10)/10;}
  saveVoiceDraft();
}
function useVoiceJob(job) {voiceMenus(); chooseVoiceSource(`job:${job.id}`); navigate('voice');}
function editVoiceJob(job) {
  const r=job.request; voiceMenus(); chooseVoiceSource(`${r.inputType}:${r.sourceId || r.sourceJobId}`, false);
  chooseVoiceReference(r.referenceId, false);
  for(const [key,id] of Object.entries(voiceFields)) if(r[key]!==undefined) $(`#${id}`).value=r[key];
  $('#voice-source-music').checked=r.sourceHasMusic; $('#voice-reference-music').checked=r.referenceHasMusic;
  $('#voice-pitch-mode').value=r.pitchMode || 'vocal'; $('#voice-dynamics').checked=r.preserveDynamics !== false;
  navigate('voice'); saveVoiceDraft(); $('#voice-source').scrollIntoView({behavior:'smooth',block:'center'});
}
function renderVoiceStatus() {
  if (!state) return;
  const ready = !!state.voice?.ready, busy = voiceBusy || !!state.operation;
  statusBadge($('#voice-ready'), ready ? '音色替换已就绪' : '需要准备环境', ready ? 'ready' : 'warning');
  statusBadge($('#voice-model-badge'), ready ? '已就绪' : '未准备', ready ? 'ready' : '');
  $('#voice-setup').hidden = ready;
  for (const id of ['voice-install', 'models-install-voice']) $(`#${id}`).disabled = busy || jobs.some(j => j.status === 'running');
  for (const id of ['voice-import-source', 'voice-import-reference']) $(`#${id}`).disabled = busy || !state.cover?.installed;
  const selected = !!$('#voice-source').value && !!$('#voice-reference').value;
  $('#voice-generate').disabled = !ready || !selected || busy;
  $('#voice-generate-hint').textContent = busy ? '正在准备…' : !state.cover?.installed ? '先在模型页准备 Cover 音频导入环境' : !ready ? '先准备音色替换环境' : !selected ? '请选择歌曲和目标声音' : '保留歌词与旋律 · 单显卡本地转换';
  const labels = {'Seed-VC-Singing':'歌声音色转换', 'Demucs-HT':'精细人声分离 · FT 人声模型', 'BigVGAN-44k':'歌声音频合成', 'Whisper-Small':'演唱内容编码', CAMPPlus:'目标音色编码', RMVPE:'音高提取'};
  $('#voice-model-cards').replaceChildren(...(state.voice?.models || []).map(model => {
    const card = document.createElement('div'); card.className = 'model-item';
    card.innerHTML = '<i data-icon="music"></i><div><strong></strong><p></p></div><span class="status-pill"></span>';
    card.querySelector('strong').textContent = model.name; card.querySelector('p').textContent = `${labels[model.name] || ''} · ${bytes(model.bytes)}`;
    statusBadge(card.querySelector('.status-pill'), model.ready ? '已校验' : '待下载', model.ready ? 'ready' : ''); return card;
  })); drawIcons($('#voice-model-cards'));
}
function voiceRow(job) {
  const row = document.createElement('article'); row.className = 'job-row'; row.dataset.jobId = job.id;
  row.innerHTML = '<div class="job-icon">♫</div><div class="job-text"><strong></strong><p class="job-meta"></p><p class="job-error" hidden></p></div><span class="status-pill"></span><div class="job-actions"></div>';
  row.querySelector('strong').textContent = job.request.title;
  row.querySelector('.job-meta').textContent = `${(job.request.end-job.request.start).toFixed(1)} 秒 · ${job.request.steps} 步 · ${job.request.semitones === 0 ? '保留原调' : `${job.request.semitones > 0 ? '+' : ''}${job.request.semitones} 半音`} · ${job.stage}`;
  statusBadge(row.querySelector('.status-pill'), job.status === 'running' ? '转换中' : statusText[job.status], job.status === 'completed' ? 'ready' : ['failed','interrupted'].includes(job.status) ? 'error' : '');
  if (job.error) {row.querySelector('.job-error').hidden = false; row.querySelector('.job-error').textContent = job.error;}
  const actions = row.querySelector('.job-actions');
  if (['running','queued'].includes(job.status)) actions.append(action('取消', () => api.cancelJob(job.id)));
  else {
    if (job.status === 'completed') actions.append(action('对比试听', () => job.request.preserveSong?compareTimbre(job):compareVoice(job), true), action('导出 WAV', async () => {if (await api.exportAudio(job.id,'wav')) toast('混音已导出');}));
    actions.append(action(job.request.preserveSong?'选择其他音色':'调整参数', () => job.request.preserveSong?editTimbreJob(job):editVoiceJob(job)), action('重新转换', async () => {await api.retryJob(job.id); await refreshJobs(); toast('已加入转换队列');}), action('文件夹 ↗', () => api.openFolder(job.id)));
  }
  actions.append(deleteJobButton(job)); return row;
}
function refreshVoiceJobs() {
  voiceMenus();
  const list = jobs.filter(j => j.request.kind === 'voice');
  $('#voice-history').replaceChildren(...list.map(voiceRow));
  if (!list.length) {const empty = document.createElement('p'); empty.className = 'empty-queue'; empty.textContent = '选择一首歌和一段目标声音，开始第一次音色 Cover。'; $('#voice-history').append(empty);}
  renderVoiceStatus();
}
function compareVoice(job) {
  voiceCompareId = job.id; navigate('voice'); $('#voice-comparison').hidden = false;
  $('#voice-comparison-title').textContent = job.request.title;
  $('#voice-original').src = `yue-audio://${job.id}/source.wav`; $('#voice-output').src = `yue-audio://${job.id}/audio.flac`;
  $('#voice-vocal-preview').src = `yue-audio://${job.id}/converted-vocals.wav`;
  $('#voice-comparison').scrollIntoView({behavior:'smooth', block:'center'});
}
for (const [suffix, purpose] of [['source','source'],['reference','reference']]) $(`#voice-import-${suffix}`).onclick = safe(async () => {
  voiceBusy = true; renderVoiceStatus();
  try {const source = await api.importAudio(purpose); if (source) {voiceSources = await api.listSources(); voiceMenus();
    if (suffix === 'reference') chooseVoiceReference(source.id); else chooseVoiceSource(`source:${source.id}`);
    toast(suffix === 'reference' ? '目标声音已导入，请选取清晰片段' : '歌曲已导入');}}
  finally {voiceBusy = false; renderVoiceStatus();}
});
$('#voice-source').onchange = () => chooseVoiceSource($('#voice-source').value);
$('#voice-reference').onchange = () => chooseVoiceReference($('#voice-reference').value);
for (const id of [...Object.values(voiceFields), 'voice-source-music', 'voice-reference-music', 'voice-pitch-mode', 'voice-dynamics']) $(`#${id}`).addEventListener('input', saveVoiceDraft);
for (const prefix of ['source','reference']) {
  const audio = $(`#voice-${prefix}-audio`);
  $(`#voice-play-${prefix}`).onclick = safe(async () => {
    const start = Number($(`#voice-${prefix === 'source' ? '' : 'reference-'}start`).value), end = Number($(`#voice-${prefix === 'source' ? '' : 'reference-'}end`).value);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > audio.duration+0.02) throw new Error('请选择有效的音频片段');
    await window.studioPlayer.clip(audio,start,end);
  });
}
for (const id of ['voice-install','models-install-voice']) $(`#${id}`).onclick = () => {navigate('models'); install('voice');};
$('#voice-generate').onclick = safe(async () => {
  voiceBusy = true; renderVoiceStatus();
  try {await api.createJob(voiceValues()); toast('音色替换已加入本地队列'); await refreshJobs(); window.taskDrawer?.open();}
  finally {voiceBusy = false; renderVoiceStatus();}
});
$('#voice-export-mix').onclick = safe(async () => {if (voiceCompareId && await api.exportAudio(voiceCompareId,'wav')) toast('混音已导出');});
for (const [suffix, stem] of [['vocal','converted-vocals'],['instrumental','instrumental']]) $(`#voice-export-${suffix}`).onclick = safe(async () => {if (voiceCompareId && await api.exportVoiceStem(voiceCompareId,stem)) toast('音轨已导出');});
api.onChange(safe(async event => {if (event.kind === 'sources') {voiceSources = await api.listSources(); voiceMenus(); renderVoiceStatus();}}));
document.addEventListener('DOMContentLoaded', safe(async () => {
  voiceSources = await api.listSources(); await refreshJobs(); voiceMenus(); const draft = await api.getVoiceDraft();
  if (draft) {
    chooseVoiceSource(`${draft.inputType}:${draft.sourceId || draft.sourceJobId}`, false); chooseVoiceReference(draft.referenceId || '', false);
    for (const [key,id] of Object.entries(voiceFields)) if (draft[key] !== undefined) $(`#${id}`).value = draft[key];
    $('#voice-source-music').checked = draft.sourceHasMusic !== false; $('#voice-reference-music').checked = draft.referenceHasMusic !== false;
    $('#voice-pitch-mode').value = draft.pitchMode || 'vocal'; $('#voice-dynamics').checked = draft.preserveDynamics !== false;
  }
  voiceInitialized = true; refreshVoiceJobs();
}), {once:true});
