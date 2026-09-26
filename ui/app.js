'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const api = window.yue;
const icons = {
  spark: '<path d="m12 3 2.3 6.7L21 12l-6.7 2.3L12 21l-2.3-6.7L3 12l6.7-2.3Z"/><path d="m20 2 .7 2.3L23 5l-2.3.7L20 8l-.7-2.3L17 5l2.3-.7Z"/>',
  library:'<path d="M4 4v16M8 4v16M13 4v16M17 4l4 15"/>',
  box:'<path d="m12 3 9 5v9l-9 5-9-5V8Z"/><path d="m3 8 9 5 9-5M12 13v9M7 5.8l9 5"/>',
  folder:'<path d="M3 7V5h6l2 2h10v13H3Z"/>',
  'arrow-up-right':'<path d="M6 18 18 6M6 6h12v12"/>',
  edit:'<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download:'<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  music:'<path d="M9 17V5l12-2v12M9 9l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  sliders:'<path d="M4 7h6m4 0h6M4 17h10m4 0h2"/><circle cx="12" cy="7" r="2"/><circle cx="16" cy="17" r="2"/>',
  queue:'<path d="M4 5h16M4 11h10M4 17h8m5-4 5 4-5 4Z"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/>'
};
function drawIcons(root = document) {const names={spark:'sparkles',library:'playlist',box:'folder',sliders:'adjustments',queue:'playlist',info:'file-music',edit:'pencil',undo:'arrow-back-up',redo:'arrow-forward-up',left:'chevron-left',right:'chevron-right',play:'player-play',stop:'player-stop','arrow-up-right':'upload'};root.querySelectorAll('[data-icon]').forEach(i => {const name=names[i.dataset.icon]||i.dataset.icon;i.replaceChildren();const img=document.createElement('img'),url=`icons/${/^[a-z-]+$/.test(name)?name:'music'}.svg`;img.src=url;i.style.setProperty('--icon-url',`url("${url}")`);img.alt='';img.setAttribute('aria-hidden','true');i.setAttribute('aria-hidden','true');i.append(img);});}
drawIcons();
$('#song-lyrics').placeholder = '[Verse]\n把今天没有说完的话\n写成一首歌\n\n[Chorus]\n让旋律替你说出口……';
let state = null, jobs = [], cot = 'full', currentPage = 'create', playingId = null, draftTimer, toastTimer, refreshing = false, hasDraft = false;
const statusText = {queued:'等待中',running:'生成中',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
const hints = {full:'先谱写旋律与和弦，再生成人声和伴奏。',melody:'先生成旋律，伴奏自由发挥；也适合导入旋律谱进行翻唱。',off:'跳过乐谱规划，直接从歌词与风格生成音乐。'};
function toast(text, error = false) {clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').classList.toggle('error', error); $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, error ? 12000 : 4000);}
function safe(action) {return async (...args) => {try {return await action(...args);} catch(e) {toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);}};}
function navigate(page) {
  if(page==='models'||page==='assistant')page='settings';
  if(page==='library')window.generatedScore?.hide();
  currentPage = page; $$('.page').forEach(el => el.hidden = el.id !== `page-${page}`);
  $$('[data-page]').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  $('#page-label').textContent = {create:'音乐创作',cover:'歌曲 Cover',voice:'音色 Cover',library:'我的作品',settings:'设置'}[page];
  window.scrollTo(0, 0); if (page === 'settings') refresh();
  if(page==='voice'&&typeof renderVoiceStatus==='function')renderVoiceStatus();
  if(typeof workbenchEditors!=='undefined')workbenchEditors[page]?.render();
}
$$('[data-page]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.page)));
$('.brand').addEventListener('click', e => {e.preventDefault(); navigate('create');});
$('#goto-setup').onclick = () => navigate('models');
function values() {return {...window.instrumentalUI?.data('create'),title:$('#song-title').value,theme:$('#song-theme').value,style:$('#song-style').value,lyrics:$('#song-lyrics').value,abc:$('#song-abc').value,cot,seed:Number($('#seed').value),profile:$('#profile').value,maxTokens:Number($('#max-tokens').value),workbench:typeof workbenchData==='function'?workbenchData('create'):undefined};}
function updateCounts() {$('#lyrics-count').textContent = `${$('#song-lyrics').value.length.toLocaleString()} 字符`;}
function saveDraft() {if(typeof workbenchEditors!=='undefined')workbenchEditors.create?.pull();updateCounts(); $('#draft-status').textContent = '正在保存…'; clearTimeout(draftTimer); draftTimer = setTimeout(safe(async () => {await api.saveDraft(values()); $('#draft-status').textContent = '草稿已保存在本机';}), 500);}
function setCot(value) {cot = ['full','melody','off'].includes(value) ? value : 'full'; $$('[data-cot]').forEach(el => el.classList.toggle('selected', el.dataset.cot === cot)); $('#mode-hint').textContent = hints[cot];}
function fillDraft(draft) {
  window.instrumentalUI?.restore('create',draft);
  $('#song-title').value = draft.title || ''; $('#song-theme').value = draft.theme || ''; $('#song-style').value = draft.style || ''; $('#song-lyrics').value = draft.lyrics || ''; $('#song-abc').value = draft.abc || '';
  $('#seed').value = draft.seed ?? 42; $('#profile').value = draft.profile || 'low-memory'; $('#max-tokens').value = String(draft.maxTokens || 3000); setCot(draft.cot); updateCounts();
  if (draft.abc) $('#score-details').open = true;
  if(typeof workbenchRestore==='function')workbenchRestore('create',draft.workbench||{pronunciation:draft.pronunciation});
}
$$('#song-title,#song-theme,#song-style,#song-lyrics,#song-abc,.settings-card input,.settings-card select').forEach(el => el.addEventListener('input', saveDraft));
$$('[data-cot]').forEach(el => el.onclick = () => {setCot(el.dataset.cot); saveDraft();});
$$('[data-style]').forEach(el => el.onclick = () => {$('#song-style').value = el.dataset.style; saveDraft();});
$('#random-seed').onclick = () => {const array = new Uint32Array(1); crypto.getRandomValues(array); $('#seed').value = array[0]; saveDraft();};
$('#sample-lyrics').onclick = async () => {
  if ($('#song-lyrics').value.trim() && !await studioConfirm('用原创示例替换当前歌词？')) return;
  $('#song-title').value ||= '夜航';
  $('#song-style').value ||= 'Mandarin indie pop, warm female vocal, soft piano, dreamy synths, slow tempo';
  $('#song-lyrics').value = '[Verse]\n路灯把影子拉得很长\n晚风翻过最后一扇窗\n口袋里装着没说完的话\n和一张去远方的车票\n\n[Chorus]\n让我们沿着星光夜航\n把昨天留在身后的海港\n就算世界还没有回答\n你听 心跳正唱得响亮';
  saveDraft(); toast('已载入原创示例《夜航》，可自由修改');
};
$('#add-section').onclick = () => {const el = $('#song-lyrics'); const insert = '\n\n[Chorus]\n'; el.setRangeText(insert, el.selectionStart, el.selectionEnd, 'end'); el.focus(); saveDraft();};
$('#import-lyrics').onclick = safe(async () => {const text = await api.importText('lyrics'); if (text !== null) {if (text.length > 12000) throw new Error('歌词超过 12000 字符限制'); $('#song-lyrics').value = text; saveDraft();}});
$('#import-score').onclick = safe(async () => {const text = await api.importText('abc'); if (text !== null) {if (text.length > 40000) throw new Error('乐谱超过 40000 字符限制'); $('#song-abc').value = text; if (cot === 'off') setCot('melody'); saveDraft();}});
const generate = safe(async () => {const data = values(); if ((!data.instrumental&&!data.lyrics.trim()) || !data.style.trim()) throw new Error('请先填写歌词和音乐风格'); if(data.abc.trim())ScoreModel.assertValid(data.abc);if(!data.instrumental&&!await workbenchEditors.create.checkLyricsBeforeGenerate())return;const job=await api.createJob({...data,pronunciation:data.workbench?.pronunciation});workbenchTrack('create',job,data);toast('已加入本地生成队列'); await refreshJobs();});
$('#generate').onclick = generate;
document.addEventListener('keydown', e => {if (!e.isComposing && !confirmDialog.open && (e.ctrlKey || e.metaKey) && e.key === 'Enter' && currentPage === 'create' && !$('#generate').disabled) {e.preventDefault(); generate();}});

const bytes = size => `${(size / 2**30).toFixed(2)} GB`;
function statusBadge(el, text, kind = '') {el.textContent = text; el.className = `status-pill ${kind}`;}
function showProbe(probe) {$('#diagnostics').textContent = probe ? `Python ${probe.python}\nPyTorch ${probe.torch}\nCUDA: ${probe.cuda ? '可用' : '不可用'} · BF16: ${probe.bf16 ? '支持' : '不支持'}\n显卡内核测试: ${probe.kernelTest ? '通过' : '未通过'}${probe.gpu ? `\n${probe.gpu} · ${probe.vramGiB} GiB` : ''}` : '尚未运行诊断';}
async function refresh() {
  if (refreshing) return; refreshing = true;
  try {
    state = await api.status();
    const h = state.hardware; $('#gpu-name').textContent = h.gpu || '未检测到 NVIDIA 显卡';
    $('#gpu-memory').textContent = `${h.vramGiB || '—'} GB`; $('#ram-memory').textContent = `${h.memoryGiB} GB`; $('#disk-space').textContent = `${h.freeGiB ?? '—'} GB`;
    statusBadge($('#hardware-badge'), h.gpu ? 'Windows 实验适配' : '需要 NVIDIA GPU', 'warning');
    if(typeof renderGpuSettings==='function')renderGpuSettings();
    $('#data-path').textContent = state.root;
    $('#download-source').value = state.downloadSource;
    $('#download-source').disabled = !!state.operation;
    statusBadge($('#runtime-badge'), state.runtimeInstalled ? (state.probe?.kernelTest ? '诊断通过' : '已安装 · 待诊断') : '未安装', state.probe?.kernelTest ? 'ready' : '');
    statusBadge($('#models-badge'), state.modelsReady ? '已完整下载' : '未就绪', state.modelsReady ? 'ready' : '');
    $('#model-cards').replaceChildren();
    for (const model of state.models) {
      const card = document.createElement('div'); card.className = 'model-item';
      card.innerHTML = '<i data-icon="box"></i><div><strong></strong><p></p></div><span class="status-pill"></span>';
      card.querySelector('strong').textContent = model.name; card.querySelector('p').textContent = `${model.name.includes('3B') ? '旋律规划与音乐生成' : '48kHz 立体声音频解码'} · ${bytes(model.bytes)}`;
      statusBadge(card.querySelector('.status-pill'), model.ready ? '已校验' : '待下载', model.ready ? 'ready' : ''); $('#model-cards').append(card);
    }
    drawIcons($('#model-cards')); showProbe(state.probe);
    const ready = state.runtimeInstalled && state.modelsReady;
    $('#generate').disabled = !ready || !!state.operation || !h.gpu;
    $('#generate-hint').textContent = state.operation ? '环境准备中，完成后可生成' : ready ? '本地生成 · Ctrl + Enter 加入队列' : '先完成模型与环境准备';
    $('#setup-banner').hidden = ready;
    $('#setup-message').textContent = state.operation ? state.operation.stage : state.runtimeInstalled ? '运行环境已安装，下载完整模型后即可开始。' : '首次使用需要安装独立运行环境并下载模型。';
    $('#operation-stage').textContent = state.operation?.stage || '运行日志';
    $('#cancel-install').hidden = !state.operation;
    for (const id of ['install-runtime','download-models','install-all','diagnose']) $(`#${id}`).disabled = !!state.operation || jobs.some(j => j.status === 'running');
    if (!state.runtimeInstalled) {$('#download-models').disabled = true; $('#diagnose').disabled = true;}
    $('#install-all').textContent = state.operation ? '准备中…' : '准备音乐生成';
    if (state.logs.length) $('#logs').textContent = state.logs.join('\n');
    if (typeof renderCoverStatus === 'function') renderCoverStatus();
    if (typeof renderVoiceStatus === 'function') renderVoiceStatus();
  } finally {window.environmentSummary?.render();refreshing = false;}
}
async function install(kind) {
  try {const promise = api.install(kind); setTimeout(() => refresh().catch(() => {}), 150); await promise; toast('准备完成');}
  catch(e) {toast(e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), true);}
  finally {await refresh();}
}
$('#install-all').onclick = () => install('all'); $('#install-runtime').onclick = () => install('runtime'); $('#download-models').onclick = () => install('models');
$('#download-source').onchange = safe(async () => {await api.setDownloadSource($('#download-source').value); toast('模型下载源已保存');});
$('#cancel-install').onclick = safe(async () => {await api.cancelInstall(); toast('正在停止当前操作…');});
$('#diagnose').onclick = safe(async () => {$('#diagnostics').textContent = '正在检查运行环境与实际 CUDA 内核…'; $('#diagnose').disabled = true; try {showProbe(await api.diagnose()); toast('运行环境诊断完成');} finally {$('#diagnose').disabled = false;}});
for (const id of ['open-data','models-open-data']) $(`#${id}`).onclick = safe(() => api.openFolder());
$('#repo-link').onclick = safe(() => api.external('repo')); $('#license-link').onclick = safe(() => api.external('license'));

function action(label, callback, primary = false) {const b = document.createElement('button'); b.className = primary ? 'button secondary' : 'text-button'; b.textContent = label; b.onclick = safe(callback); return b;}
const deletingJobs = new Set();
let jobsLoaded = false;
function deleteJobButton(job) {
  const b = action('删除', async () => {
    if (deletingJobs.has(job.id)) return;
    deletingJobs.add(job.id);
    $$('[data-delete-job]').filter(el => el.dataset.deleteJob === job.id).forEach(el => el.disabled = true);
    // Release only this record's file handles before the Windows recycle operation.
    const media = $$('audio').filter(el => {try {return new URL(el.src).hostname === job.id;} catch {return false;}})
      .map(el => ({el, src: el.src, time: el.currentTime}));
    media.forEach(({el}) => {el.pause(); el.removeAttribute('src'); el.load();});
    let removed = false;
    try {
      removed = await api.deleteJob(job.id);
      if (!removed) return;
      if (playingId === job.id) {playingId = null; $('#player').hidden = true;}
      if (media.some(({el}) => el.id === 'cover-output' || el.id === 'cover-original')) $('#cover-comparison').hidden = true;
      if (typeof voiceCompareId !== 'undefined' && voiceCompareId === job.id) {voiceCompareId = null; $('#voice-comparison').hidden = true;}
      await refreshJobs(); toast('已移到 Windows 回收站；恢复后重启应用即可重新显示');
    } finally {
      deletingJobs.delete(job.id);
      if (!removed) media.forEach(({el, src, time}) => {el.src = src; el.addEventListener('loadedmetadata', () => {el.currentTime = time;}, {once: true});});
      $$('[data-delete-job]').filter(el => el.dataset.deleteJob === job.id).forEach(el => el.disabled = false);
    }
  });
  b.classList.add('delete-history'); b.dataset.deleteJob = job.id;
  b.setAttribute('aria-label', '删除记录：' + job.request.title);
  b.disabled = ['queued', 'running'].includes(job.status) || deletingJobs.has(job.id);
  b.title = b.disabled ? '请先取消任务，等待停止后删除' : '删除记录和生成文件，移到 Windows 回收站';
  return b;
}
function jobRow(job) {
  if (job.request.kind === 'music-style') return musicStyleRow(job);
  if (job.request.kind === 'lyrics') return recognitionRow(job);
  if (job.request.kind === 'transcribe') return transcriptionRow(job);
  if (job.request.kind === 'voice') return voiceRow(job);
  const row = document.createElement('article'); row.className = 'job-row'; row.dataset.jobId = job.id;
  row.innerHTML = '<div class="job-icon" aria-hidden="true">♫</div><div class="job-text"><strong></strong><p class="job-meta"></p><p class="job-error" hidden></p></div><span class="status-pill"></span><div class="job-actions"></div>';
  row.querySelector('strong').textContent = job.request.title;
  const duration = job.result?.seconds ? `${Math.floor(job.result.seconds / 60)}:${String(Math.floor(job.result.seconds % 60)).padStart(2,'0')} · ` : '';
  const clipped = job.result?.truncated && Object.values(job.result.truncated).some(Boolean);
  row.querySelector('.job-meta').textContent = `${duration}${job.stage}${job.tokens ? ` · ${job.tokens} tokens` : ''} · ${new Date(job.createdAt).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}${clipped ? ' · 达到生成上限，音频可能截断' : ''}`;
  if(job.alignment)row.querySelector('.job-meta').textContent+=' · '+job.alignment.message;
  statusBadge(row.querySelector('.status-pill'), statusText[job.status] || job.status, job.status === 'completed' ? 'ready' : ['failed','interrupted'].includes(job.status) ? 'error' : job.status === 'running' ? 'warning' : '');
  if (job.error) {row.querySelector('.job-error').hidden = false; row.querySelector('.job-error').textContent = job.error;}
  const actions = row.querySelector('.job-actions');
  if (['running','queued'].includes(job.status)) actions.append(action('取消', () => api.cancelJob(job.id)));
  if (job.status === 'completed') {
    actions.append(action('▶ 试听', () => play(job), true), action('导出', async () => {if (await api.exportAudio(job.id, 'wav')) toast('WAV 已导出');}), action('编辑乐谱', async () => {
      const score = await api.score(job.id); if (!score) throw new Error('这首作品没有 ABC 乐谱');
      if (($('#song-lyrics').value.trim() || $('#song-style').value.trim()) && !await studioConfirm('将此作品的歌词、风格和乐谱载入创作台？当前草稿会被替换。')) return;
      fillDraft({...job.request, abc:score, title:`${job.request.title} · 改编`}); $('#score-details').open = true; navigate('create'); saveDraft();
    }));
    if (job.request.transcriptionId) actions.append(action('原曲对比', () => compareCover(job)));
    actions.append(action('替换音色', () => useVoiceJob(job)));
  }
  if (!['running','queued'].includes(job.status)) actions.append(action('重新生成', async () => {await api.retryJob(job.id); toast('已创建新任务，原作品保留'); await refreshJobs();}));
  actions.append(action('文件夹 ↗', () => api.openFolder(job.id)));
  actions.append(deleteJobButton(job));
  return row;
}
function renderLibrary() {
  const query = $('#search-songs').value.toLowerCase(); const filter = $('#filter-songs').value;
  const visible = jobs.filter(j => !['transcribe','lyrics','music-style'].includes(j.request.kind) && `${j.request.title} ${j.request.style}`.toLowerCase().includes(query) && (filter === 'all' || (filter === 'failed' ? ['failed','interrupted'].includes(j.status) : j.status === filter)));
  $('#library-list').replaceChildren(...visible.map(jobRow));
  if (!visible.length) {
    const empty = document.createElement('div'); empty.className = 'empty-library';
    empty.innerHTML = '<i data-icon="music"></i><h2></h2><p></p>';
    empty.querySelector('h2').textContent = jobs.length ? '没有找到匹配作品' : '第一首歌，还在等你落笔';
    empty.querySelector('p').textContent = jobs.length ? '试试其他关键词或筛选条件。' : '完成一次本地生成后，作品会出现在这里。';
    empty.append(action('开始创作 ↗', () => navigate('create'), true)); $('#library-list').append(empty); drawIcons(empty);
  }
}
async function refreshJobs() {
  jobs = await api.listJobs(); jobsLoaded = true; const active = jobs.filter(j => ['queued','running'].includes(j.status));
  $('#queue-count').textContent = active.length; $('#library-count').textContent = jobs.filter(j => j.status === 'completed' && !['transcribe','lyrics','music-style'].includes(j.request.kind)).length;
  const recent = [...active, ...jobs.filter(j => !active.includes(j)).slice(0,3)];
  $('#queue-list').replaceChildren(...recent.map(jobRow));
  if (!recent.length) {const empty = document.createElement('div'); empty.className = 'empty-queue'; empty.innerHTML = '<i data-icon="queue"></i>队列还是空的，把你的第一段灵感交给音乐。'; $('#queue-list').append(empty); drawIcons(empty);}
  renderLibrary();
  if (typeof refreshCoverJobs === 'function') await refreshCoverJobs();
  if (typeof refreshVoiceJobs === 'function') refreshVoiceJobs();
  if(typeof workbenchJobs==='function')await workbenchJobs(jobs);
  if(typeof recognitionJobs==='function')await recognitionJobs();
  window.musicStyleUI?.jobsChanged();
  window.taskDrawer?.refresh();window.studioPlayer?.update();
  if(typeof renderGpuSettings==='function')renderGpuSettings();
}
$('#search-songs').oninput = renderLibrary; $('#filter-songs').onchange = renderLibrary;
async function play(job) {playingId = job.id; $('#player-title').textContent = job.request.title; $('#player').hidden = false; $('#audio').src = `yue-audio://${job.id}/audio.flac`; await window.studioPlayer.start($('#audio'));}
$('#player-close').onclick = () => {$('#audio').pause(); $('#audio').removeAttribute('src'); $('#audio').load(); $('#player').hidden = true; playingId = null;};
$('#player-export').onclick = safe(async () => {if (playingId && await api.exportAudio(playingId, 'wav')) toast('WAV 已导出');});
$('#audio').onerror = () => toast('音频加载失败，请检查作品文件是否完整。',true);
api.onChange(safe(async value => {if (value.kind === 'jobs') await refreshJobs(); else await refresh();}));
api.onLog(text => {const log = $('#logs'); log.textContent = `${log.textContent}\n${text}`.split('\n').slice(-100).join('\n'); log.scrollTop = log.scrollHeight;});
document.addEventListener('DOMContentLoaded', safe(async () => {const draft = await api.getDraft(); hasDraft = !!draft; if (draft) fillDraft(draft); await refreshJobs(); await refresh(); if (!hasDraft && state.hardware.vramGiB >= 23) $('#profile').value = 'balanced';}), {once:true});
setInterval(() => {if (state?.operation) refresh().catch(() => {});}, 7000);
