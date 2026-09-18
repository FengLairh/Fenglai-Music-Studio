'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readJSON,writeJSON,validateRequest}=require('./core.cjs');
const {run}=require('./runtime.cjs');
class Lyrics {
 constructor(runtime,cover,voice,runner=run){Object.assign(this,{runtime,cover,voice,run:runner});this.lockFile=path.join(runtime.resources,'lyrics-models.lock.json');this.lock=readJSON(this.lockFile,{models:[]});}
 python(){return path.join(this.runtime.root,'lyrics-runtime/python/cpython-3.12.9-windows-x86_64-none/python.exe');}
 installed(){const marker=readJSON(path.join(this.runtime.root,'lyrics-runtime/installed.json'),null);return fs.existsSync(this.python())&&marker?.probe?.engine==='qwen3-asr'&&marker.probe.transformers==='5.13.0';}
 status(){const models=this.runtime.modelStatus(this.lock),installed=this.installed();
  const separator=this.runtime.modelStatus(this.voice.lock).find(m=>m.name==='Demucs-HT');
  return {engine:'qwen3-asr',installed,models,ready:installed&&models.length===1&&models[0].name==='Qwen3-ASR-1.7B'&&models.every(m=>m.ready),separationReady:this.voice.installed()&&!!separator?.ready};}
 validate(input){const request=validateRequest(input),source=this.cover.source(request.sourceId),status=this.status();
  if(request.kind!=='lyrics')throw Error('无效的歌词识别任务');
  if(request.end>source.seconds+0.02)throw Error('歌词识别片段超出原曲时长');
  if(!status.ready)throw Error('请先在设置页准备歌词识别模型');
  if(request.separateVocals&&!status.separationReady)throw Error('请在设置页准备音色环境的人声分离模型，或取消“先分离人声”');
  return {...request,title:`${source.name} · 歌词识别`.slice(0,100)};}
 async install(){
  const r=this.runtime;if(r.operation||this.cover.importing)throw Error('请等待当前环境准备完成');
  const controller=new AbortController();r.operation={kind:'lyrics',controller,stage:'准备千问歌词识别'};
  const stage=text=>{r.operation.stage=text;r.log(text);r.emit('change');};r.emit('change');
  try{const options={cwd:r.root,env:{...r.env,UV_HTTP_TIMEOUT:'30'},signal:controller.signal,onLine:line=>r.log(line)};
   if(!this.installed()){
    if((await r.hardware()).freeGiB<16)throw Error('准备千问识别环境和模型至少需要 16GB 可用空间');
    stage('1 / 4 · 准备千问独立 Python 3.12.9');
    await this.run(r.uv,['python','install','3.12.9','--install-dir',path.join(r.root,'lyrics-runtime/python'),'--no-bin','--no-registry'],options);
    const constraint=path.join(r.resources,'backend/lyrics-constraints.txt'),constraints=fs.existsSync(constraint)?['--constraint',constraint]:[];
    stage('2 / 4 · 准备单显卡 CUDA 运行库');
    await this.run(r.uv,['pip','install','--python',this.python(),'--break-system-packages','--no-deps','torch==2.10.0',...constraints,'--index-url','https://download.pytorch.org/whl/cu128'],options);
    stage('3 / 4 · 安装千问 ASR 依赖');
    await this.run(r.uv,['pip','install','--python',this.python(),'--break-system-packages','torch==2.10.0','-r',path.join(r.resources,'backend/lyrics-requirements.txt'),...constraints,'--index-url',r.downloadSource==='mirror'?'https://pypi.tuna.tsinghua.edu.cn/simple':'https://pypi.org/simple'],options);
    const probe=await this.run(this.python(),['-u',path.join(r.resources,'backend/lyrics.py'),'--phase','probe','--root',r.root],options);
    if(probe?.engine!=='qwen3-asr'||probe.transformers!=='5.13.0')throw Error('千问识别环境检查未通过');
    writeJSON(path.join(r.root,'lyrics-runtime/installed.json'),{installedAt:new Date().toISOString(),probe});
   }
   stage('4 / 4 · 下载并校验 Qwen3-ASR 1.7B');
   const env={...r.env,HF_ENDPOINT:r.downloadSource==='mirror'?'https://hf-mirror.com':'https://huggingface.co'};delete env.HF_TOKEN;delete env.HUGGING_FACE_HUB_TOKEN;
   await this.run(this.python(),['-u',path.join(r.resources,'backend/model_files.py'),r.root,this.lockFile],{...options,env,onLine:(line,event)=>{r.log(line);if(event?.type==='stage')stage(event.stage);}});
   stage('千问歌词识别已就绪');
  }finally{r.operation=null;r.emit('change');}
 }
 async recognize(store,job,signal){
  if(this.runtime.operation)throw Error('请等待环境准备完成');this.validate(job.request);
  const dir=store.directory(job.id);writeJSON(path.join(dir,'input.json'),job.request);
  const args=['-u',path.join(this.runtime.resources,'backend/lyrics.py'),'--root',this.runtime.root,'--source',this.cover.sourceAudio(job.request.sourceId),'--request',path.join(dir,'input.json'),'--output',path.join(dir,'artifacts'),'--lock',this.lockFile,'--voice-lock',this.voice.lockFile];
  const options={
   cwd:this.runtime.root,env:this.runtime.env,signal,onLine:(line,event)=>{this.runtime.log(line);if(event?.type==='stage')store.update(job.id,{stage:event.stage});fs.appendFileSync(path.join(dir,'lyrics.log'),this.runtime.logs.at(-1)+'\n');}
  };
  await this.run(job.request.separateVocals?this.voice.python:this.python(),[...args,'--phase','prepare'],options);
  if(signal.aborted)throw Error('任务已取消');
  const result=await this.run(this.python(),[...args,'--phase','recognize'],options);
  if(result?.engine!=='qwen3-asr'||typeof result?.text!=='string'||!result.text.trim()||result.text.length>12000||!Array.isArray(result.segments))throw Error('未产生有效的千问歌词识别结果');
  return result;
 }
}
module.exports={Lyrics};
