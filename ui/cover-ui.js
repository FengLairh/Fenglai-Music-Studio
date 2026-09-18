'use strict';
let coverSources = [], coverSourceId = null, transcriptionId = null, pendingTranscription = null;
let coverTimer, coverInitialized = false, coverBusy = false, loadingCoverScore = false, clipStop = null;

function coverValues() {
  return {...window.coverWorkflow?.data(),sourceId: coverSourceId, transcriptionId, pendingTranscription,
    start: Number($('#cover-start').value), end: Number($('#cover-end').value), melodyOnly: $('#cover-mode').value === 'melody',
    title: $('#cover-title').value, theme: $('#cover-theme').value, style: $('#cover-style').value, lyrics: $('#cover-lyrics').value, abc: $('#cover-abc').value,
    profile: $('#cover-profile').value, maxTokens: Number($('#cover-tokens').value), seed: Number($('#cover-seed').value),workbench:typeof workbenchData==='function'?workbenchData('cover'):undefined,lyricRecognition:typeof recognitionData==='function'?recognitionData():undefined};
}
function saveCoverDraft() {
  if (!coverInitialized) return;
  if(typeof workbenchEditors!=='undefined')workbenchEditors.cover?.pull();
  $('#cover-draft-status').textContent = '正在保存…';
  clearTimeout(coverTimer);
  coverTimer = setTimeout(safe(async () => {await api.saveCoverDraft(coverValues()); $('#cover-draft-status').textContent = '草稿已保存在本机';}), 400);
  renderCoverStatus();
}
function sourceMenu() {
  $('#cover-source').replaceChildren(...coverSources.map(source => {const o = document.createElement('option'); o.value = source.id; o.textContent = source.name; return o;}));
  $('#cover-source-empty').hidden = coverSources.length > 0;
  $('#cover-source-content').hidden = !coverSources.length;
  if (coverSourceId) $('#cover-source').value = coverSourceId;
}
function clearCoverScore() {
  window.coverWorkflow?.clearScore();
  transcriptionId = null; pendingTranscription = null; $('#cover-abc').value = '';
  $('#cover-warnings').hidden = true; $('#cover-task-status').hidden = true;
  $('#cover-score-status').textContent = coverSourceId ? '准备提取乐谱' : '等待导入原曲';
}
function selectCoverSource(id, reset = true) {
  const source = coverSources.find(s => s.id === id); if (!source) return;
  coverSourceId = id; $('#cover-source').value = id;
  window.coverWorkflow?.source(source);
  $('#cover-source-info').textContent = `${source.seconds.toFixed(1)} 秒 · 已保存本地副本`;
  $('#cover-source-audio').src = `yue-audio://${id}/original.wav`;
  $('#cover-start').max = source.seconds; $('#cover-end').max = source.seconds; clipStop = null;
  if (reset) {
    $('#cover-start').value = 0; $('#cover-end').value = (Math.floor(Math.min(30, source.seconds) * 10) / 10).toFixed(1);
    $('#cover-title').value = `${source.name.replace(/\.[^.]+$/, '')} · Cover`.slice(0, 100); clearCoverScore();
  }
  saveCoverDraft();
}
function matchingSegment(job) {
  const value = coverValues(); const r = job?.request;
  return r && r.sourceId === value.sourceId && r.start === value.start && r.end === value.end && r.melodyOnly === value.melodyOnly;
}
function renderCoverStatus() {
  if (!state) return;
  if (!transcriptionId && !pendingTranscription) $('#cover-score-status').textContent = coverSourceId ? '准备提取乐谱' : '等待导入原曲';
  if(typeof renderRecognitionStatus==='function')renderRecognitionStatus();
  window.musicStyleUI?.render();
  const c = state.cover; const operation = !!state.operation; const running = jobs.some(j => j.status === 'running');
  statusBadge($('#cover-ready'), c?.ready ? 'Cover 已就绪' : '需要准备环境', c?.ready ? 'ready' : 'warning');
  statusBadge($('#cover-model-badge'), c?.ready ? '已就绪' : '未准备', c?.ready ? 'ready' : '');
  $('#cover-setup').hidden = !!c?.ready;
  for (const id of ['cover-install', 'models-install-cover']) $(`#${id}`).disabled = operation || running || coverBusy;
  $('#cover-import').disabled = !c?.installed || operation || coverBusy;
  const pending = jobs.find(j => j.id === pendingTranscription);
  const transcribing = pending && ['running', 'queued'].includes(pending.status);
  $('#cover-transcribe').disabled = !c?.ready || !coverSourceId || operation || coverBusy || !!transcribing;
  $('#cover-transcribe').textContent = transcribing ? '正在提取，进度见下方…' : transcriptionId ? '重新提取乐谱' : '自动提取乐谱';
  const scoreReady = !!transcriptionId && !!$('#cover-abc').value.trim();
  const ready = scoreReady && state.runtimeInstalled && state.modelsReady && !!state.hardware.gpu;
  $('#cover-generate').disabled = !ready || operation || coverBusy;
  $('#cover-generate-hint').textContent = operation ? '环境准备中…' : !scoreReady ? '先导入音频并提取乐谱' : !ready ? '请在设置页准备音乐生成模型' : window.coverWorkflow?.description()||'保留旋律走向 · 按新歌词与曲风生成';
  $('#cover-export-abc').disabled = !transcriptionId; $('#cover-export-midi').disabled = !transcriptionId;
  $('#cover-model-cards').replaceChildren(...(c?.models || []).map(model => {
    const card = document.createElement('div'); card.className = 'model-item';
    card.innerHTML = '<i data-icon="music"></i><div><strong></strong><p></p></div><span class="status-pill"></span>';
    card.querySelector('strong').textContent = model.name;
    card.querySelector('p').textContent = `${model.name === 'SheetSage2' ? '旋律、节拍与和弦转谱' : '全曲音频特征编码'} · ${bytes(model.bytes)}`;
    statusBadge(card.querySelector('.status-pill'), model.ready ? '已校验' : '待下载', model.ready ? 'ready' : ''); return card;
  })); drawIcons($('#cover-model-cards'));
  window.coverWorkflow?.sync();
}
async function loadCoverScore(job, replace = true) {
  if (loadingCoverScore || job.status !== 'completed') return;
  loadingCoverScore = true;
  try {
    const abc = await api.score(job.id); if (!abc) throw new Error('此任务没有可用乐谱');
    if (replace) {
      selectCoverSource(job.request.sourceId, false);
      $('#cover-start').value = job.request.start; $('#cover-end').value = job.request.end;
      $('#cover-mode').value = job.request.melodyOnly ? 'melody' : 'full';
    } else if (!matchingSegment(job)) return;
    transcriptionId = job.id; pendingTranscription = null; $('#cover-abc').value = abc;
    window.coverWorkflow?.scoreLoaded(abc);
    $('#cover-score-status').textContent = `乐谱已就绪 · ${abc.length.toLocaleString()} 字符`;
    const warnings = [...(job.result?.warnings || [])];
    $('#cover-warnings').hidden = !warnings.length; $('#cover-warnings').textContent = warnings.length ? '转谱提示：\n' + warnings.join('\n') : '';
    $('#cover-task-status').hidden = false; $('#cover-task-status').classList.remove('error'); $('#cover-task-status').textContent = '旋律已提取。填写本片段歌词和新曲风后，即可生成 Cover。';
    saveCoverDraft(); renderCoverStatus();
  } finally {loadingCoverScore = false;}
}
function transcriptionRow(job) {
  const row = document.createElement('article'); row.className = 'job-row'; row.dataset.jobId = job.id;
  row.innerHTML = '<div class="job-icon">♬</div><div class="job-text"><strong></strong><p class="job-meta"></p><p class="job-error" hidden></p></div><span class="status-pill"></span><div class="job-actions"></div>';
  row.querySelector('strong').textContent = job.request.title;
  row.querySelector('.job-meta').textContent = `${job.request.start.toFixed(1)}–${job.request.end.toFixed(1)} 秒 · ${job.stage}`;
  statusBadge(row.querySelector('.status-pill'), job.status === 'running' ? '转谱中' : statusText[job.status], job.status === 'completed' ? 'ready' : job.status === 'failed' ? 'error' : '');
  if (job.error) {row.querySelector('.job-error').hidden = false; row.querySelector('.job-error').textContent = job.error;}
  const actions = row.querySelector('.job-actions');
  if (['running', 'queued'].includes(job.status)) actions.append(action('取消', () => api.cancelJob(job.id)));
  else if (job.status === 'completed') actions.append(action('使用乐谱', async () => {
    if ($('#cover-abc').value.trim() && transcriptionId !== job.id && !await studioConfirm('用此转谱结果替换当前 Cover 乐谱？')) return;
    await loadCoverScore(job); navigate('cover');
  }, true), action('导出 MIDI', async () => {if (await api.exportScore(job.id, 'mid')) toast('MIDI 已导出');}));
  else actions.append(action('重试转谱', async () => {const next = await api.retryJob(job.id); if (matchingSegment(next)) pendingTranscription = next.id; saveCoverDraft(); await refreshJobs();}));
  actions.append(action('文件夹 ↗', () => api.openFolder(job.id)), deleteJobButton(job)); return row;
}
async function refreshCoverJobs() {
  if (!coverInitialized) return;
  if (jobsLoaded && ((transcriptionId && !jobs.some(j => j.id === transcriptionId)) || (pendingTranscription && !jobs.some(j => j.id === pendingTranscription)))) {
    if (transcriptionId && !jobs.some(j => j.id === transcriptionId)) transcriptionId = null;
    if (pendingTranscription && !jobs.some(j => j.id === pendingTranscription)) pendingTranscription = null;
    $('#cover-score-status').textContent = '转谱记录已移除 · 编辑内容已保留';
    $('#cover-task-status').hidden = true; $('#cover-warnings').hidden = true;
    saveCoverDraft();
  }
  const history = jobs.filter(j => ['transcribe','lyrics','music-style'].includes(j.request.kind) || j.request.transcriptionId);
  $('#cover-history').replaceChildren(...history.slice(0, 20).map(jobRow));
  if (!history.length) {const p = document.createElement('p'); p.className = 'empty-queue'; p.textContent = '导入原曲，开始第一次 Cover。'; $('#cover-history').append(p);}
  const pending = jobs.find(j => j.id === pendingTranscription);
  if (pending && matchingSegment(pending)) {
    if (pending.status === 'completed') await loadCoverScore(pending, false);
    else {
      const box = $('#cover-task-status'); box.hidden = false; box.classList.toggle('error', ['failed', 'interrupted'].includes(pending.status));
      box.textContent = `${pending.stage}${pending.error ? '\n' + pending.error : ''}`;
      if (['queued', 'running'].includes(pending.status)) box.append(action('取消转谱', () => api.cancelJob(pending.id)));
    }
  }
  renderCoverStatus();
}
function compareCover(job) {
  navigate('cover');
  $('#cover-comparison').hidden = false; $('#cover-comparison-title').textContent = job.request.title;
  $('#cover-original').src = `yue-audio://${job.request.transcriptionId}/source.wav`;
  $('#cover-output').src = `yue-audio://${job.id}/audio.flac`;
  $('#cover-comparison').scrollIntoView({behavior: 'smooth', block: 'center'});
}
for (const id of ['cover-install', 'models-install-cover']) $(`#${id}`).onclick = () => {navigate('models'); install('cover');};
$('#cover-import').onclick = safe(async () => {
  coverBusy = true; renderCoverStatus(); $('#cover-import').textContent = '正在导入…';
  try {const source = await api.importAudio(); if (source) {coverSources = (await api.listSources()).filter(s=>!s.voiceDesign); sourceMenu(); selectCoverSource(source.id); toast('原曲已导入，选择片段后可自动转谱');}}
  finally {coverBusy = false; $('#cover-import').textContent = '选择音乐文件'; renderCoverStatus();}
});
$('#cover-source').onchange = () => selectCoverSource($('#cover-source').value);
for (const id of ['cover-start', 'cover-end', 'cover-mode']) $(`#${id}`).addEventListener('input', () => {clearCoverScore(); saveCoverDraft();});
for (const id of ['cover-title', 'cover-theme', 'cover-style', 'cover-lyrics', 'cover-abc', 'cover-profile', 'cover-tokens', 'cover-seed']) $(`#${id}`).addEventListener('input', saveCoverDraft);
$$('[data-cover-style]').forEach(el => el.onclick = () => {$('#cover-style').value = el.dataset.coverStyle; saveCoverDraft();});
$('#cover-import-lyrics').onclick = safe(async () => {const lyrics = await api.importText('lyrics'); if (lyrics !== null) {if (lyrics.length > 12000) throw new Error('歌词超过 12000 字符'); $('#cover-lyrics').value = lyrics; saveCoverDraft();}});
$('#cover-play-clip').onclick = safe(async () => {
  const {start, end} = coverValues(); const audio = $('#cover-source-audio');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > audio.duration + 0.02) throw new Error('请选择原曲内的有效时间段');
  clipStop = end; await window.studioPlayer.clip(audio,start,end);
});
$('#cover-transcribe').onclick = safe(async () => {
  coverBusy = true; renderCoverStatus();
  try {
    const value = coverValues();
    const job = await api.createJob({kind: 'transcribe', sourceId: value.sourceId, start: value.start, end: value.end, melodyOnly: value.melodyOnly});
    clearCoverScore(); pendingTranscription = job.id; saveCoverDraft(); await refreshJobs(); toast('转谱已加入本地队列');
  } finally {coverBusy = false; renderCoverStatus();}
});
$('#cover-generate').onclick = safe(async () => {
  coverBusy = true; renderCoverStatus();
  try {
    const value = coverValues(),policy=window.coverWorkflow?.request(value)||{}; if (!(policy.style??value.style).trim() || !value.lyrics.trim()) throw new Error('请填写所用音乐风格和本片段的演唱歌词');
    ScoreModel.assertValid(value.abc);
    if(!await workbenchEditors.cover.checkLyricsBeforeGenerate())return;
    const job=await api.createJob({title: value.title, style: value.style, lyrics: value.lyrics, abc: value.abc, transcriptionId, cot: value.melodyOnly ? 'melody' : 'full', profile: value.profile, maxTokens: value.maxTokens, seed: value.seed,pronunciation:value.workbench?.pronunciation,...policy});
    workbenchTrack('cover',job,value);toast('Cover 已加入生成队列'); await refreshJobs();
  } finally {coverBusy = false; renderCoverStatus();}
});
for (const format of ['abc', 'midi']) $(`#cover-export-${format}`).onclick = safe(async () => {if (transcriptionId && await api.exportScore(transcriptionId, format === 'midi' ? 'mid' : 'abc')) toast('乐谱已导出');});
// Avoid overlapping playback when comparing original and generated music.
$$('audio').forEach(audio => audio.addEventListener('play', () => $$('audio').forEach(other => {if (other !== audio) other.pause();})));
document.addEventListener('DOMContentLoaded', safe(async () => {
  coverSources = (await api.listSources()).filter(s=>!s.voiceDesign); const draft = await api.getCoverDraft(); sourceMenu();
  if (draft) $('#cover-theme').value = draft.theme || '';
  if (draft && coverSources.some(s => s.id === draft.sourceId)) {
    selectCoverSource(draft.sourceId, false);
    for (const [id, key] of [['start','start'],['end','end'],['title','title'],['style','style'],['lyrics','lyrics'],['abc','abc'],['profile','profile'],['tokens','maxTokens'],['seed','seed']]) if (draft[key] !== undefined) $(`#cover-${id}`).value = draft[key];
    $('#cover-mode').value = draft.melodyOnly === false ? 'full' : 'melody';
    transcriptionId = draft.transcriptionId || null; pendingTranscription = draft.pendingTranscription || null;
    if (transcriptionId) $('#cover-score-status').textContent = '已恢复上次编辑的乐谱';
  } else if (coverSources.length) selectCoverSource(coverSources[0].id);
  window.coverWorkflow?.restore(draft);coverInitialized = true;if(typeof restoreRecognition==='function')restoreRecognition(draft?.lyricRecognition);if(typeof workbenchRestore==='function')workbenchRestore('cover',draft?.workbench);await refreshCoverJobs();if(typeof recognitionJobs==='function')await recognitionJobs();window.musicStyleUI?.jobsChanged();renderCoverStatus();
}), {once:true});
