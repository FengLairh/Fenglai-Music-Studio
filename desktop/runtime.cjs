'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {EventEmitter} = require('node:events');
const {writeJSON, readJSON} = require('./core.cjs');
const exec = promisify(execFile);
const GPU_UUID=/^GPU-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseGpus(csv){
  const number=s=>/^\d+(?:\.\d+)?$/.test(s)?Number(s):null;
  return String(csv).trim().split(/\r?\n/).flatMap(line=>{
    const v=line.split(',').map(s=>s.trim());if(v.length!==7||!/^\d+$/.test(v[0])||!GPU_UUID.test(v[1]))return [];
    return [{index:Number(v[0]),uuid:v[1],name:v[2],memoryMiB:number(v[3]),usedMiB:number(v[4]),freeMiB:number(v[5]),driver:v[6]}];
  }).sort((a,b)=>a.index-b.index);
}

function run(file, args, {cwd, env, signal, onLine = () => {}} = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('操作已取消')); return; }
    const child = spawn(file, args, {cwd, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe']});
    let errorMessage = '', result = null, tail = '', settled = false;
    const finish = (error) => { if (settled) return; settled = true; signal?.removeEventListener('abort', abort); error ? reject(error) : resolve(result); };
    const abort = () => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {windowsHide: true, timeout: 5000}, error => {if (error && child.exitCode === null) child.kill();});
        // TerminateProcess is available even when process enumeration for taskkill is restricted.
        const fallback = setTimeout(() => {if (child.exitCode === null) child.kill();}, 1500);
        fallback.unref();
      } else child.kill('SIGTERM');
    };
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort();
    for (const stream of [child.stdout, child.stderr]) {
      let buffered = ''; stream.setEncoding('utf8');
      const line = (text) => {
        text = text.replace(/\x1b\[[0-9;]*m/g, '').trim(); if (!text) return;
        tail = `${tail}\n${text}`.slice(-5000);
        let event;
        try { event = JSON.parse(text); } catch {}
        if (event?.type === 'result') result = event.result;
        if (event?.type === 'error') errorMessage = event.message;
        onLine(text, event);
      };
      stream.on('data', chunk => {buffered += chunk; const lines = buffered.split(/[\r\n]+/); buffered = lines.pop(); for (const text of lines) line(text); if (buffered.length > 100000) { line(buffered); buffered = ''; }});
      stream.on('end', () => {if (buffered) line(buffered);});
    }
    child.on('error', finish);
    child.on('close', code => finish(signal?.aborted ? new Error('操作已取消') : code !== 0 ? new Error(errorMessage || `进程退出 (${code})\n${tail}`) : null));
  });
}

class Runtime extends EventEmitter {
  constructor(resources, root, {hardwareExec=exec}={}) {
    super(); this.resources = resources; this.root = root;
    this.python = path.join(root, 'runtime', 'python', 'cpython-3.12.9-windows-x86_64-none', 'python.exe');
    this.uv = path.join(resources, 'tools', 'uv.exe');
    this.lock = readJSON(path.join(resources, 'models.lock.json'), {models: []});
    this.operation = null; this.logs = []; this.lastProbe = null;
    this.hardwareExec=hardwareExec;this.isGpuBusy=()=>false;this.probing=false;
    const settings=readJSON(path.join(root,'settings.json'),{});
    this.downloadSource = settings.downloadSource || 'official';
    this.gpuDevice=GPU_UUID.test(settings.gpuDevice)?settings.gpuDevice:'auto';
    fs.mkdirSync(root, {recursive: true});
    this.env = {...process.env, PYTHONUTF8: '1', PYTHONUNBUFFERED: '1', UV_NO_CONFIG: '1', UV_PYTHON_INSTALL_DIR: path.join(root, 'runtime', 'python'), UV_CACHE_DIR: path.join(root, 'cache', 'uv'), UV_LINK_MODE: 'copy', HF_HOME: path.join(root, 'cache', 'huggingface'), HF_HUB_DISABLE_TELEMETRY: '1', HF_HUB_DISABLE_XET: '1'};
    // Match nvidia-smi / the device shown by the editor on machines with multiple GPUs.
    this.env.CUDA_DEVICE_ORDER = 'PCI_BUS_ID';
    this.env.CUDA_VISIBLE_DEVICES = this.gpuDevice==='auto'?'0':this.gpuDevice; // Exactly one physical GPU, identified persistently by UUID.
    // Avoid inheriting global Python paths and index configuration into the isolated runtime.
    for (const k of ['PYTHONPATH', 'PYTHONHOME', 'VIRTUAL_ENV', 'UV_PROJECT_ENVIRONMENT', 'UV_PYTHON', 'UV_INDEX_URL', 'UV_DEFAULT_INDEX', 'UV_EXTRA_INDEX_URL', 'PIP_INDEX_URL', 'PIP_EXTRA_INDEX_URL', 'DEEPSEEK_API_KEY']) delete this.env[k];
  }
  log(text) {
    // Redact common credential formats before persisting diagnostics.
    text = text.replace(/(Bearer\s+)[\w.\-]+/gi, '$1[redacted]').replace(/hf_[A-Za-z0-9]{12,}/g, '[redacted]').replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, '$1[redacted]@').replace(/([?&](?:token|signature|x-amz-signature|key)=)[^&\s]+/gi, '$1[redacted]');
    this.logs.push(text); if (this.logs.length > 400) this.logs.shift();
    this.emit('log', text);
    fs.appendFileSync(path.join(this.root, 'runtime.log'), `${new Date().toISOString()} ${text}\n`);
  }
  async hardware() {
    const result = {platform: os.platform(), memoryGiB: Math.round(os.totalmem() / 2**30), gpu: null, vramGiB: 0, driver: null,gpus:[],gpuDevice:this.gpuDevice,detectedAt:new Date().toISOString()};
    try {
      const {stdout} = await this.hardwareExec('nvidia-smi.exe', ['--query-gpu=index,uuid,name,memory.total,memory.used,memory.free,driver_version', '--format=csv,noheader,nounits'], {windowsHide: true, timeout: 10000});
      result.gpus=parseGpus(stdout);
      const selected=this.gpuDevice==='auto'?result.gpus[0]:result.gpus.find(g=>g.uuid===this.gpuDevice);
      if(selected)Object.assign(result,{gpu:selected.name,vramGiB:selected.memoryMiB?Math.round(selected.memoryMiB/1024*10)/10:0,driver:selected.driver,selectedUuid:selected.uuid});
      else result.gpuError=this.gpuDevice==='auto'?'未检测到可用的 NVIDIA 显卡':'已保存的显卡未连接，请重新选择运行显卡';
    } catch (e) { result.gpuError = '未检测到 NVIDIA 驱动或显卡'; }
    try { const space = fs.statfsSync(this.root); result.freeGiB = Math.round(space.bavail * space.bsize / 2**30); } catch {}
    return result;
  }
  saveSettings(changes){writeJSON(path.join(this.root,'settings.json'),{...readJSON(path.join(this.root,'settings.json'),{}),...changes});}
  async selectGpu(device){
    if(typeof device!=='string'||device!=='auto'&&!GPU_UUID.test(device))throw Error('请选择一张有效的 NVIDIA 显卡');
    if(this.operation||this.probing||this.isGpuBusy())throw Error('请等待运行及排队任务、诊断或环境准备结束后再切换显卡');
    const controller=new AbortController();this.operation={kind:'gpu-select',controller,stage:'检测运行显卡'};this.emit('change');
    try{
      const hardware=await this.hardware(),gpu=device==='auto'?hardware.gpus[0]:hardware.gpus.find(g=>g.uuid===device);
      if(!gpu)throw Error('所选显卡不可用，请重新检测');if(controller.signal.aborted)throw Error('操作已取消');
      this.saveSettings({gpuDevice:device});this.gpuDevice=device;this.env.CUDA_VISIBLE_DEVICES=gpu.uuid;this.lastProbe=null;
      return {...hardware,gpu:gpu.name,vramGiB:Math.round((gpu.memoryMiB||0)/1024*10)/10,driver:gpu.driver,gpuDevice:device,selectedUuid:gpu.uuid,gpuError:null};
    }finally{this.operation=null;this.emit('change');}
  }
  async ensureGpu(){const h=await this.hardware();if(!h.selectedUuid)throw Error(h.gpuError||'请在设置中选择运行显卡');this.env.CUDA_VISIBLE_DEVICES=h.selectedUuid;return h;}
  modelStatus(lock = this.lock) {
    return lock.models.map(model => {
      const dir = path.join(this.root, 'models', model.name);
      const marker = readJSON(path.join(dir, '.ready.json'), null);
      let downloaded = 0;
      const complete = model.sizes.every(item => {
        try { const size = fs.statSync(path.join(dir, item.name)).size; downloaded += size; return size === item.bytes; } catch { return false; }
      });
      return {name: model.name, repo: model.repo, bytes: model.sizes.reduce((a, b) => a + b.bytes, 0), downloaded, ready: Boolean(complete && marker?.revision === model.revision)};
    });
  }
  async status() {
    const models = this.modelStatus();
    return {root: this.root, hardware: await this.hardware(), runtimeInstalled: this.installed(), probe: this.lastProbe, downloadSource: this.downloadSource,gpuSwitchBlocked:!!this.operation||this.probing||this.isGpuBusy(),
      models, modelsReady: models.length === 2 && models.every(m => m.ready), operation: this.operation ? {kind: this.operation.kind, stage: this.operation.stage} : null, logs: this.logs.slice(-80)};
  }
  installed() {return fs.existsSync(this.python) && fs.existsSync(path.join(this.root, 'runtime', 'installed.json'));}
  setDownloadSource(source) {
    if (!['official', 'mirror'].includes(source)) throw new Error('无效下载源');
    if (this.operation) throw new Error('请先停止当前下载再切换下载源');
    this.saveSettings({downloadSource:source});this.downloadSource = source;
  }
  async bridge(command, args = [], options = {}) {
    return run(this.python, ['-u', path.join(this.resources, 'backend', 'bridge.py'), command, '--root', this.root, ...args],
      {cwd: this.root, env: this.env, ...options, onLine: (line, event) => { this.log(line); options.onLine?.(line, event); }});
  }
  async probe() {
    if (!fs.existsSync(this.python)) throw new Error('请先在模型与环境页安装运行环境');
    if(this.operation||this.probing||this.isGpuBusy())throw Error('请等待当前操作结束再诊断');
    this.probing=true;this.emit('change');
    try{await this.ensureGpu();this.lastProbe = await this.bridge('probe');return this.lastProbe;}
    finally{this.probing=false;this.emit('change');}
  }
  async install(kind) {
    if (this.operation) throw new Error('已有安装或下载正在进行');
    if (!['runtime', 'models', 'all'].includes(kind)) throw new Error('无效安装操作');
    const controller = new AbortController(); this.operation = {kind, controller, stage: '准备安装'};
    const stage = text => {this.operation.stage = text; this.log(text); this.emit('change');};
    const options = {cwd: this.root, env: this.env, signal: controller.signal, onLine: line => this.log(line)};
    this.emit('change');
    try {
      if (kind !== 'models') {
        const hardware = await this.hardware();
        if (hardware.freeGiB < 20) throw new Error('数据目录所在磁盘至少需要 20GB 可用空间安装环境');
        stage('1 / 4 · 安装独立 Python 3.12.9');
        await run(this.uv, ['python', 'install', '3.12.9', '--install-dir', this.env.UV_PYTHON_INSTALL_DIR, '--no-bin', '--no-registry'], options);
        stage('2 / 4 · 安装 PyTorch 2.10 / CUDA 12.8（约数 GB）');
        await run(this.uv, ['pip', 'install', '--python', this.python, '--break-system-packages', 'torch==2.10.0', '--constraint', path.join(this.resources, 'backend', 'constraints.txt'), '--index-url', 'https://download.pytorch.org/whl/cu128'], options);
        stage('3 / 4 · 安装 YuE2 及锁定依赖');
        await run(this.uv, ['pip', 'install', '--python', this.python, '--break-system-packages', path.join(this.resources, 'vendor', 'YuE'), '--constraint', path.join(this.resources, 'backend', 'constraints.txt'), '--index-url', 'https://pypi.org/simple'], options);
        stage('4 / 4 · 检查 CUDA 与模型接口');
        this.lastProbe = await this.bridge('probe', [], {signal: controller.signal});
        writeJSON(path.join(this.root, 'runtime', 'installed.json'), {installedAt: new Date().toISOString(), probe: this.lastProbe});
      }
      if (kind !== 'runtime') {
        if (!this.installed()) throw new Error('请先安装运行环境');
        stage('下载并校验模型文件（可取消，重新下载会复用已有文件）');
        const downloadEnv = {...this.env};
        if (this.downloadSource === 'mirror') {
          downloadEnv.HF_ENDPOINT = 'https://hf-mirror.com';
          downloadEnv.HF_HUB_DISABLE_IMPLICIT_TOKEN = '1';
          delete downloadEnv.HF_TOKEN; delete downloadEnv.HUGGING_FACE_HUB_TOKEN;
          stage('通过 hf-mirror.com 下载固定版本的公开模型');
        } else downloadEnv.HF_ENDPOINT = 'https://huggingface.co';
        await this.bridge('download', ['--lock', path.join(this.resources, 'models.lock.json')], {env: downloadEnv, signal: controller.signal, onLine: (_line, event) => {if (event?.type === 'stage') stage(event.stage);}});
      }
      stage('安装完成');
    } catch (e) {this.log(e.message); throw e;}
    finally {this.operation = null; this.emit('change');}
  }
  cancel() {this.operation?.controller.abort();}
  async generate(store, job, signal) {
    if (this.operation) throw new Error('请等待环境安装或模型下载完成');
    const models = this.modelStatus();
    if (models.length !== 2 || models.some(m => !m.ready)) throw new Error('模型未完整下载，请在模型与环境页一键准备');
    const dir = store.directory(job.id);
    const P=require('../ui/pronunciation.js'),pronunciation=P.validate(job.request.pronunciation,job.request.lyrics);
    const synthesis={...job.request,lyrics:P.generationLyrics(job.request.lyrics,pronunciation)};delete synthesis.pronunciation;
    writeJSON(path.join(dir, 'input.json'), synthesis);
    if(pronunciation.entries.length)writeJSON(path.join(dir,'pronunciation.json'),{method:'homophone-text-guidance',forcedPhonemes:false,originalLyrics:job.request.lyrics,generationLyrics:synthesis.lyrics,pronunciation});
    let loggedStage = '';
    return this.bridge('generate', ['--request', path.join(dir, 'input.json'), '--output', path.join(dir, 'artifacts')], {signal, onLine: (line, event) => {
      let stage = event?.type === 'stage' ? event.stage : null;
      if (!stage) for (const [key, label] of [['Synthesizing audio', '合成人声与伴奏'], ['Loading audio decoder', '加载音频解码器'], ['Decoding audio', '解码立体声音频']]) if (line.includes(key)) stage = label;
      if (stage && (stage !== loggedStage || event?.tokens)) {loggedStage = stage; store.update(job.id, {stage, tokens: event?.tokens || null});}
      fs.appendFileSync(path.join(dir, 'generation.log'), `${this.logs.at(-1)}\n`);
    }}).then(result => {
      if (!result || !Number.isFinite(result.seconds) || result.seconds <= 0 || !fs.existsSync(path.join(dir, 'artifacts', 'audio.flac')) || !fs.existsSync(path.join(dir, 'artifacts', 'audio.wav'))) throw new Error('推理进程未产生完整音频，请查看生成日志');
      return result;
    });
  }
}
module.exports = {run, Runtime,parseGpus};
