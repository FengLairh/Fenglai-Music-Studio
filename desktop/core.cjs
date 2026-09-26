'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

function writeJSON(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temp, file);
}
function readJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT' || e instanceof SyntaxError) return fallback; throw e; }
}
function validId(id) {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) throw new Error('无效的作品编号');
  return id;
}
function validateRequest(input) {
  if (!input || typeof input !== 'object') throw new Error('请输入创作内容');
  if (input.kind === 'voice') {
    if (!['source', 'job'].includes(input.inputType)) throw new Error('请选择音色替换的歌曲');
    const result = {kind: 'voice', inputType: input.inputType, referenceId: validId(input.referenceId),
      title: String(input.title || '音色 Cover').trim().slice(0, 100) || '音色 Cover'};
    result[input.inputType === 'source' ? 'sourceId' : 'sourceJobId'] = validId(input[input.inputType === 'source' ? 'sourceId' : 'sourceJobId']);
    for (const key of ['start', 'end', 'referenceStart', 'referenceEnd']) {
      if (!Number.isFinite(input[key])) throw new Error('音频片段时间必须是有效数字');
      result[key] = input[key];
    }
    if (result.start < 0 || result.end > 600 || result.end - result.start < 5 || result.end - result.start > 300)
      throw new Error('请选择 5–300 秒的歌曲片段');
    if (result.referenceStart < 0 || result.referenceEnd > 600 || result.referenceEnd - result.referenceStart < 5 || result.referenceEnd - result.referenceStart > 25)
      throw new Error('请选择 5–25 秒的目标声音片段');
    for (const key of ['sourceHasMusic', 'referenceHasMusic']) {
      if (typeof input[key] !== 'boolean') throw new Error('请选择有效的人声与伴奏选项');
      result[key] = input[key];
    }
    result.pitchMode = input.pitchMode ?? 'vocal'; // Existing saved jobs retain their original pitch behavior.
    if (!['song', 'vocal'].includes(result.pitchMode)) throw new Error('无效的变调方式');
    result.preserveDynamics = input.preserveDynamics ?? true;
    if (typeof result.preserveDynamics !== 'boolean') throw new Error('无效的演唱强弱选项');
    for (const [key, fallback, min, max] of [['semitones', 0, -12, 12], ['steps', 50, 4, 50], ['vocalGainDb', 0, -12, 12], ['accompanimentGainDb', 0, -12, 12], ['seed', 42, 0, 2147483647]]) {
      const value = input[key] ?? fallback;
      if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`无效的音色转换参数：${key}`);
      result[key] = value;
    }
    if(input.preserveSong!==undefined){
      if(typeof input.preserveSong!=='boolean')throw Error('无效的仅换人声模式');
      result.preserveSong=input.preserveSong;
      if(result.preserveSong){
        if(result.semitones!==0||result.pitchMode!=='vocal'||!result.preserveDynamics||result.vocalGainDb!==0||result.accompanimentGainDb!==0||!result.sourceHasMusic)throw Error('仅换人声模式须保留原调、演唱强弱和原伴奏音量');
      }
    }
    return result;
  }
  if (input.kind === 'music-style') {
    const sourceId=validId(input.sourceId),{start,end}=input;
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>600||end-start<5||end-start>300)throw Error('请选择原曲内 5–300 秒的风格识别片段');
    return {kind:'music-style',sourceId,start,end,title:String(input.title||'原曲风格识别').slice(0,100)};
  }
  if (input.kind === 'lyrics') {
    const sourceId=validId(input.sourceId),{start,end}=input,language=input.language||'zh';
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>600||end-start<5||end-start>300)throw Error('请选择原曲内 5–300 秒的歌词识别片段');
    if(!['auto','zh','en','ja','ko'].includes(language))throw Error('无效的歌词语言');
    if(typeof input.separateVocals!=='boolean')throw Error('无效的人声分离选项');
    return {kind:'lyrics',sourceId,start,end,language,separateVocals:input.separateVocals,title:String(input.title||'歌词识别').slice(0,100)};
  }
  if (input.kind === 'transcribe') {
    const sourceId = validId(input.sourceId);
    const {start, end} = input;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 600 || end - start < 5 || end - start > 300) throw new Error('请选择 5–300 秒的有效音频片段');
    if (typeof input.melodyOnly !== 'boolean') throw new Error('无效的转谱模式');
    return {kind: 'transcribe', sourceId, start, end, melodyOnly: input.melodyOnly, title: String(input.title || '音频转谱').slice(0, 100)};
  }
  if (input.kind && input.kind !== 'generate') throw new Error('无效任务类型');
  const instrumental=input.instrumental??false;if(typeof instrumental!=='boolean')throw Error('无效的纯音乐模式');
  if(instrumental&&input.coverMode==='lyrics-only')throw Error('纯音乐不能使用只改词模式');
  const coverMode=input.coverMode||'arrange';
  if(!['arrange','lyrics-only','rewrite'].includes(coverMode))throw Error('无效的 Cover 分类');
  if(coverMode!=='arrange'&&!input.transcriptionId)throw Error('Cover 分类需要原曲转谱记录');
  let reference;
  if(coverMode==='lyrics-only'){
    const r=input.coverReference;
    if(!r||typeof r.style!=='string'||!r.style.trim()||r.style.length>2000)throw Error('只改词模式需要填写原曲风格，新的音乐风格不会使用');
    if(typeof r.abc!=='string'||!r.abc.trim()||r.abc.length>40000||r.abc.trim()!==input.abc?.trim())throw Error('只改词模式的乐谱已变化，请重新确认原谱或切换改词改谱');
    reference={style:r.style.trim(),abc:r.abc.trim()};
    require('../ui/score-model.js').assertValid(reference.abc);
    input={...input,style:reference.style};
  }
  const result = {};
  for (const [key, limit] of [['title', 100], ['style', 2000], ['lyrics', 12000], ['abc', 40000]]) {
    if (input[key] !== undefined && typeof input[key] !== 'string') throw new Error(`${key} 必须是文字`);
    const value = (input[key] || '').trim();
    if (value.length > limit) throw new Error(`${key} 超过 ${limit} 字符限制`);
    result[key] = value;
  }
  if (!result.style || (!instrumental&&!result.lyrics)) throw new Error('请填写音乐风格和歌词');
  if(instrumental){result.instrumental=true;result.lyrics='';result.keepHarmony=input.keepHarmony??false;if(typeof result.keepHarmony!=='boolean')throw Error('无效的和声选项');}
  if(!instrumental&&input.pronunciation!==undefined){
    const P=require('../ui/pronunciation.js'),raw=input.lyrics||'',marks=P.validate(input.pronunciation,raw);
    result.pronunciation=P.rebase(raw,result.lyrics,marks);
  }
  result.title ||= '未命名作品';
  result.cot = instrumental ? (input.keepHarmony?'full':'melody') : input.cot || 'full';
  if (!['full', 'melody', 'off'].includes(result.cot)) throw new Error('无效的作曲模式');
  if (result.abc && result.cot === 'off') throw new Error('使用 ABC 乐谱时请选择完整作曲或旋律模式');
  result.seed = input.seed ?? 42;
  if (!Number.isSafeInteger(result.seed) || result.seed < 0) throw new Error('随机种子必须是非负安全整数');
  result.profile = input.profile || 'balanced';
  if (!['balanced', 'low-memory'].includes(result.profile)) throw new Error('无效的运行预设');
  result.maxTokens = input.maxTokens ?? 3000;
  if (!Number.isInteger(result.maxTokens) || result.maxTokens < 200 || result.maxTokens > 9000) throw new Error('音频 token 上限须为 200–9000');
  if (input.transcriptionId) {
    result.transcriptionId = validId(input.transcriptionId);
    if (!result.abc) throw new Error('Cover 需要提取并确认旋律谱');
    result.coverMode=coverMode;if(reference)result.coverReference=reference;
  }
  return result;
}

class JobStore extends EventEmitter {
  constructor(root) {
    super(); this.root = root; this.jobs = []; this.deleting = new Set();
    fs.mkdirSync(root, { recursive: true });
    for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dir.isDirectory() || !/^[0-9a-f-]{36}$/.test(dir.name)) continue;
      const job = readJSON(path.join(root, dir.name, 'job.json'), null);
      if (!job || job.id !== dir.name || !job.request) continue;
      if (['running', 'queued'].includes(job.status)) {
        job.status = 'interrupted'; job.error = '上次退出时任务尚未完成，可重新生成。';
        writeJSON(path.join(root, dir.name, 'job.json'), job);
      }
      this.jobs.push(job);
    }
  }
  directory(id) { return path.join(this.root, validId(id)); }
  list() { return [...this.jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
  get(id) { validId(id); if (this.deleting.has(id)) throw new Error('作品正在删除，请稍候'); const job = this.jobs.find(j => j.id === id); if (!job) throw new Error('作品不存在'); return job; }
  assertDeletable(id) {
    const job = this.get(id);
    if (['queued', 'running'].includes(job.status)) throw Error('请先取消任务，等待任务停止后再删除');
    const children = this.jobs.filter(j => j.id !== id && (j.request.transcriptionId === id || j.request.sourceJobId === id));
    if (children.length) throw Error(`这条记录仍被 ${children.length} 个 Cover 任务使用（${children.slice(0, 2).map(j => j.request.title).join('、')}）。请先删除这些后续任务，再删除源记录。`);
    return job;
  }
  async remove(id, trash) {
    this.assertDeletable(id); this.deleting.add(id);
    try {
      await trash(this.directory(id));
      this.jobs = this.jobs.filter(j => j.id !== id); this.emit('change', {id, deleted: true});
    } finally { this.deleting.delete(id); }
  }
  add(input) {
    const request = validateRequest(input);
    for (const id of [request.transcriptionId, request.sourceJobId].filter(Boolean)) this.get(id);
    const job = { id: crypto.randomUUID(), request, createdAt: new Date().toISOString(), status: 'queued', stage: '等待生成', error: null, result: null };
    this.jobs.push(job); this.save(job); return job;
  }
  save(job) { writeJSON(path.join(this.directory(job.id), 'job.json'), job); this.emit('change', job); }
  update(id, changes) { const job = this.get(id); Object.assign(job, changes); this.save(job); return job; }
}

class JobQueue {
  constructor(store, runner) { this.store = store; this.runner = runner; this.active = null; this.stopping = false; }
  enqueue(input) { const job = this.store.add(input); this.pump(); return job; }
  async pump() {
    if (this.active || this.stopping) return;
    const job = this.store.jobs.find(j => j.status === 'queued'); if (!job) return;
    const controller = new AbortController(); this.active = { job, controller };
    this.store.update(job.id, {status: 'running', stage: '准备加载模型', startedAt: new Date().toISOString()});
    try {
      const result = await this.runner(job, controller.signal);
      if (controller.signal.aborted) throw new Error('任务已取消');
      this.store.update(job.id, {status: 'completed', stage: '已完成', result, finishedAt: new Date().toISOString()});
    } catch (error) {
      this.store.update(job.id, {status: controller.signal.aborted ? 'cancelled' : 'failed', stage: controller.signal.aborted ? '已取消' : job.request.kind === 'music-style' ? '风格识别失败' : job.request.kind === 'lyrics' ? '歌词识别失败' : job.request.kind === 'transcribe' ? '转谱失败' : job.request.kind === 'voice' ? '音色替换失败' : '生成失败', error: error.message, finishedAt: new Date().toISOString()});
    } finally { this.active = null; this.pump(); }
  }
  cancel(id) {
    const job = this.store.get(id);
    if (job.status === 'queued') this.store.update(id, {status: 'cancelled', stage: '已取消'});
    else if (this.active?.job.id === id) this.active.controller.abort();
  }
  stop() { this.stopping = true; for (const j of this.store.jobs) if (j.status === 'queued') this.cancel(j.id); this.active?.controller.abort(); }
}
module.exports = {writeJSON, readJSON, validId, validateRequest, JobStore, JobQueue};
