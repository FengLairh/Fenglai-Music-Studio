'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {readJSON, writeJSON, validateRequest} = require('./core.cjs');
const {run} = require('./runtime.cjs');

class Voice {
  constructor(runtime, cover) {
    this.runtime = runtime; this.cover = cover; this.root = runtime.root;
    this.python = path.join(this.root, 'voice-runtime/python/cpython-3.11.11-windows-x86_64-none/python.exe');
    this.lockFile = path.join(runtime.resources, 'voice-models.lock.json');
    this.lock = readJSON(this.lockFile, {models: []});
  }
  installed() {return fs.existsSync(this.python) && fs.existsSync(path.join(this.root, 'voice-runtime/installed.json'));}
  status() {
    const models = this.runtime.modelStatus(this.lock);
    return {installed: this.installed(), models, ready: this.installed() && models.length === 6 && models.every(m => m.ready)};
  }
  bridge(command, args = [], options = {}) {
    return run(this.python, ['-u', path.join(this.runtime.resources, 'backend/voice.py'), command, '--root', this.root, '--lock', this.lockFile, ...args],
      {cwd: this.root, env: this.runtime.env, ...options, onLine: (line, event) => {this.runtime.log(line); options.onLine?.(line, event);}});
  }
  async install() {
    const r = this.runtime;
    if (r.operation || this.cover.importing) throw new Error('请等待当前准备操作结束');
    const controller = new AbortController(); r.operation = {kind: 'voice', controller, stage: '准备音色替换环境'};
    const stage = text => {r.operation.stage = text; r.log(text); r.emit('change');};
    const installDir = path.join(this.root, 'voice-runtime/python');
    const options = {cwd: this.root, env: {...r.env, UV_PYTHON_INSTALL_DIR: installDir}, signal: controller.signal, onLine: line => r.log(line)};
    const constraint = path.join(r.resources, 'backend/voice-constraints.txt');
    const constraints = fs.existsSync(constraint) ? ['--constraint', constraint] : [];
    r.emit('change');
    try {
      let needsEnvironment = !this.installed();
      if (!needsEnvironment) {
        try {await this.bridge('probe', [], {signal: controller.signal});}
        catch (error) {if (controller.signal.aborted) throw error; needsEnvironment = true;}
      }
      if (needsEnvironment) {
        if ((await r.hardware()).freeGiB < 20) throw new Error('安装音色替换环境和模型至少需要 20GB 可用空间');
        stage('1 / 4 · 安装独立音色转换 Python 3.11.11');
        await run(r.uv, ['python', 'install', '3.11.11', '--install-dir', installDir, '--no-bin', '--no-registry'], options);
        stage('2 / 4 · 安装单显卡 CUDA 12.8 运行库');
        await run(r.uv, ['pip', 'install', '--python', this.python, '--break-system-packages', 'torch==2.8.0', 'torchaudio==2.8.0', ...constraints, '--index-url', 'https://download.pytorch.org/whl/cu128'], options);
        stage('3 / 4 · 安装歌声音色转换与伴奏分离依赖');
        await run(r.uv, ['pip', 'install', '--python', this.python, '--break-system-packages', '-r', path.join(r.resources, 'backend/voice-requirements.txt'), ...constraints, '--index-url', 'https://pypi.org/simple'], options);
        const probe = await this.bridge('probe', [], {signal: controller.signal});
        writeJSON(path.join(this.root, 'voice-runtime/installed.json'), {installedAt: new Date().toISOString(), probe});
      }
      stage('4 / 4 · 下载并校验音色转换模型');
      const env = {...r.env, HF_ENDPOINT: r.downloadSource === 'mirror' ? 'https://hf-mirror.com' : 'https://huggingface.co'};
      delete env.HF_TOKEN; delete env.HUGGING_FACE_HUB_TOKEN;
      await this.bridge('download', [], {env, signal: controller.signal, onLine: (_line, event) => {if (event?.type === 'stage') stage(event.stage);}});
      stage('音色替换已就绪');
    } finally {r.operation = null; r.emit('change');}
  }
  input(store, request) {
    if (request.inputType === 'source') {
      const source = this.cover.source(request.sourceId);
      return {seconds: source.seconds, file: this.cover.sourceAudio(source.id)};
    }
    const source = store.get(request.sourceJobId);
    if (source.status !== 'completed' || ['transcribe','lyrics','music-style'].includes(source.request.kind) || !Number.isFinite(source.result?.seconds)) throw new Error('请选择已完成的音乐作品');
    const file = path.join(store.directory(source.id), 'artifacts/audio.wav');
    if (!fs.existsSync(file)) throw new Error('作品音频文件缺失');
    return {seconds: source.result.seconds, file};
  }
  validate(store, input) {
    const request = validateRequest(input);
    if (request.kind !== 'voice') throw new Error('无效音色转换任务');
    const source = this.input(store, request), reference = this.cover.source(request.referenceId);
    if (request.end > source.seconds + 0.02) throw new Error('歌曲片段超出音频时长');
    if (request.referenceEnd > reference.seconds + 0.02) throw new Error('目标声音片段超出音频时长');
    if (!this.status().ready) throw new Error('请先准备完整音色替换环境和模型');
    return request;
  }
  async convert(store, job, signal) {
    if (this.runtime.operation) throw new Error('请等待环境准备完成');
    const request = this.validate(store, job.request), source = this.input(store, request);
    const dir = store.directory(job.id), output = path.join(dir, 'artifacts');
    const requestFile = path.join(dir, 'input.json'); writeJSON(requestFile, request);
    const options = {signal, onLine: (line, event) => {
      if (event?.type === 'stage') store.update(job.id, {stage: event.stage});
      fs.appendFileSync(path.join(dir, 'voice.log'), `${this.runtime.logs.at(-1)}\n`);
    }};
    const args = ['--request', requestFile, '--output', output];
    // Await process exit before starting the next GPU stage, so no models overlap in VRAM.
    await this.bridge('separate', [...args, '--source', source.file, '--reference', this.cover.sourceAudio(request.referenceId)], options);
    if (signal.aborted) throw new Error('任务已取消');
    const result = await this.bridge('convert', args, options);
    if (!result?.seconds || !fs.existsSync(path.join(output, 'audio.wav')) || !fs.existsSync(path.join(output, 'audio.flac'))) throw new Error('音色转换没有产生完整音频');
    return result;
  }
}
module.exports = {Voice};
