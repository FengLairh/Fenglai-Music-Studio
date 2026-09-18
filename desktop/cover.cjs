'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {readJSON, writeJSON, validId} = require('./core.cjs');
const {run} = require('./runtime.cjs');

class Cover {
  constructor(runtime) {
    this.runtime = runtime; this.root = runtime.root; this.resources = runtime.resources;
    this.python = path.join(this.root, 'cover-runtime', 'python', 'cpython-3.11.11-windows-x86_64-none', 'python.exe');
    this.lockFile = path.join(this.resources, 'cover-models.lock.json');
    this.lock = readJSON(this.lockFile, {models: []});
    this.sources = path.join(this.root, 'sources');
    this.importing = false;
    fs.mkdirSync(this.sources, {recursive: true});
  }
  source(id) {
    validId(id);
    const meta = readJSON(path.join(this.sources, id, 'source.json'), null);
    if (!meta || meta.id !== id || !fs.existsSync(this.sourceAudio(id))) throw new Error('原曲文件不存在，请重新导入');
    return meta;
  }
  sourceAudio(id) {return path.join(this.sources, validId(id), 'source.wav');}
  list() {
    return fs.readdirSync(this.sources).filter(id => /^[0-9a-f-]{36}$/.test(id)).flatMap(id => {
      try {return [this.source(id)];} catch {return [];}
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  installed() {return fs.existsSync(this.python) && fs.existsSync(path.join(this.root, 'cover-runtime', 'installed.json'));}
  status() {
    const models = this.runtime.modelStatus(this.lock);
    return {installed: this.installed(), models, ready: this.installed() && models.length === 2 && models.every(m => m.ready), importing: this.importing};
  }
  bridge(command, args = [], options = {}) {
    return run(this.python, ['-u', path.join(this.resources, 'backend', 'cover.py'), command, '--root', this.root, ...args],
      {cwd: this.root, env: this.runtime.env, ...options, onLine: (line, event) => {this.runtime.log(line); options.onLine?.(line, event);}});
  }
  async install() {
    const r = this.runtime;
    if (r.operation || this.importing) throw new Error('请等待当前准备操作结束');
    const controller = new AbortController(); r.operation = {kind: 'cover', controller, stage: '准备 Cover 环境'};
    const stage = text => {r.operation.stage = text; r.log(text); r.emit('change');};
    const installDir = path.join(this.root, 'cover-runtime', 'python');
    const options = {cwd: this.root, env: {...r.env, UV_PYTHON_INSTALL_DIR: installDir}, signal: controller.signal, onLine: line => r.log(line)};
    r.emit('change');
    try {
      let needsEnvironment = !this.installed();
      if (!needsEnvironment) {
        try {await this.bridge('probe', [], {signal: controller.signal});}
        catch (error) {if (controller.signal.aborted) throw error; needsEnvironment = true;}
      }
      if (needsEnvironment) {
        if ((await r.hardware()).freeGiB < 20) throw new Error('安装 Cover 环境和模型至少需要 20GB 可用空间');
        stage('1 / 4 · 安装独立 Cover Python 3.11.11');
        await run(r.uv, ['python', 'install', '3.11.11', '--install-dir', installDir, '--no-bin', '--no-registry'], options);
        stage('2 / 4 · 安装 Cover CUDA 12.8 运行库');
        await run(r.uv, ['pip', 'install', '--python', this.python, '--break-system-packages', 'torch==2.8.0', 'torchaudio==2.8.0', '--constraint', path.join(this.resources, 'backend', 'cover-constraints.txt'), '--index-url', 'https://download.pytorch.org/whl/cu128'], options);
        stage('3 / 4 · 安装转谱与音频导入依赖');
        await run(r.uv, ['pip', 'install', '--python', this.python, '--break-system-packages', '-r', path.join(this.resources, 'backend', 'cover-requirements.txt'), '--constraint', path.join(this.resources, 'backend', 'cover-constraints.txt'), '--index-url', 'https://pypi.org/simple'], options);
        const probe = await this.bridge('probe', [], {signal: controller.signal});
        writeJSON(path.join(this.root, 'cover-runtime', 'installed.json'), {installedAt: new Date().toISOString(), probe});
      }
      stage('4 / 4 · 下载并校验 Cover 模型（约 2.6GB）');
      const env = {...r.env, HF_ENDPOINT: r.downloadSource === 'mirror' ? 'https://hf-mirror.com' : 'https://huggingface.co'};
      delete env.HF_TOKEN; delete env.HUGGING_FACE_HUB_TOKEN;
      await this.bridge('download', ['--lock', this.lockFile], {env, signal: controller.signal, onLine: (_line, event) => {if (event?.type === 'stage') stage(event.stage);}});
      stage('Cover 环境已就绪');
    } finally {r.operation = null; r.emit('change');}
  }
  async importFile(file) {
    if (!this.installed()) throw new Error('请先一键准备 Cover 环境');
    if (this.importing || this.runtime.operation) throw new Error('请等待当前准备操作结束');
    const stat = await fs.promises.stat(file);
    const ext = path.extname(file).toLowerCase();
    if (!['.wav', '.flac', '.mp3', '.m4a', '.ogg', '.aac'].includes(ext) || !stat.isFile() || stat.size > 500 * 2**20) throw new Error('请选择小于 500MB 的 WAV / FLAC / MP3 / M4A / OGG / AAC 音频');
    const id = crypto.randomUUID(); const dir = path.join(this.sources, id);
    this.importing = true;
    this.importController = new AbortController();
    const original = path.join(dir, `original${ext}`);
    try {
      await fs.promises.mkdir(dir, {recursive: true});
      await fs.promises.copyFile(file, original);
      const result = await this.bridge('import', ['--source', original, '--output', dir], {signal: this.importController.signal});
      if (!result?.seconds) throw new Error('无法读取音频时长');
      const meta = {id, name: path.basename(file), createdAt: new Date().toISOString(), bytes: stat.size, ...result};
      writeJSON(path.join(dir, 'source.json'), meta); return meta;
    } catch (e) {
      // Only remove named temporary files belonging to this failed import.
      for (const file of [original, path.join(dir, 'source.wav')]) await fs.promises.rm(file, {force: true});
      throw e;
    } finally {this.importing = false; this.importController = null;}
  }
  cancelImport() {this.importController?.abort();}
  validateTranscription(input) {
    const source = this.source(input.sourceId);
    if (input.end > source.seconds + 0.02) throw new Error('所选片段超出原曲时长');
    if (!this.status().ready) throw new Error('请先准备完整 Cover 环境和模型');
    return {...input, title: `${source.name} · 转谱`};
  }
  attachCover(store, input) {
    if (!input.transcriptionId) return input;
    const transcription = store.get(input.transcriptionId);
    if (transcription.status !== 'completed' || transcription.request.kind !== 'transcribe') throw new Error('请先完成音频转谱');
    this.source(transcription.request.sourceId);
    const fullScore=input.coverMode==='rewrite'||input.coverMode==='lyrics-only'&&require('../ui/score-model.js').assertValid(input.abc).voices.Vocal.bars.some(b=>b.tokens.some(t=>t.kind==='chord'));
    return {...input, cot: fullScore?'full':transcription.request.melodyOnly ? 'melody' : 'full'};
  }
  async transcribe(store, job, signal) {
    if (this.runtime.operation) throw new Error('请等待环境准备完成');
    this.validateTranscription(job.request);
    const dir = store.directory(job.id);
    writeJSON(path.join(dir, 'input.json'), job.request);
    const result = await this.bridge('transcribe', ['--source', this.sourceAudio(job.request.sourceId), '--request', path.join(dir, 'input.json'), '--output', path.join(dir, 'artifacts'), '--lock', this.lockFile], {signal, onLine: (line, event) => {
      if (event?.type === 'stage') store.update(job.id, {stage: event.stage});
      fs.appendFileSync(path.join(dir, 'transcription.log'), `${this.runtime.logs.at(-1)}\n`);
    }});
    if (!result?.abcCharacters || !fs.existsSync(path.join(dir, 'artifacts', 'score.abc'))) throw new Error('未生成有效乐谱，请查看转谱日志');
    return result;
  }
}
module.exports = {Cover};
