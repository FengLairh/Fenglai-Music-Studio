'use strict';
const fs=require('node:fs'),path=require('node:path');
const {readJSON,writeJSON,validateRequest}=require('./core.cjs');
const {run}=require('./runtime.cjs');
class MusicStyle {
 constructor(runtime,cover,lyrics,runner=run){Object.assign(this,{runtime,cover,lyrics,run:runner});this.lockFile=path.join(runtime.resources,'music-style-models.lock.json');this.lock=readJSON(this.lockFile,{models:[]});}
 status(){const models=this.runtime.modelStatus(this.lock),p=readJSON(path.join(this.runtime.root,'music-style-runtime/installed.json'),null)?.probe,installed=this.lyrics.installed()&&p?.engine==='qwen2.5-omni'&&p.pillow==='12.1.1'&&p.torchvision==='0.25.0+cu128'&&p.transformers==='5.13.0';return {installed,models,ready:installed&&models.length===1&&models[0].name==='Qwen2.5-Omni-3B'&&models.every(m=>m.ready)};}
 validate(input){const request=validateRequest(input);if(request.kind!=='music-style')throw Error('无效的风格识别任务');const source=this.cover.source(request.sourceId);if(request.end>source.seconds+.02)throw Error('风格识别片段超出原曲时长');if(!this.status().ready)throw Error('请先在设置页准备原曲风格识别模型');return {...request,title:`${source.name} · 原曲风格`.slice(0,100)};}
 async install(){
  const r=this.runtime;if(r.operation||this.cover.importing)throw Error('请等待当前环境准备完成');
  // The pinned ASR runtime already supports Omni; never upgrade its working dependencies.
  if(!this.lyrics.installed())await this.lyrics.install();
  const controller=new AbortController();r.operation={kind:'music-style',controller,stage:'准备原曲风格模型'};r.emit('change');
  try{const options={cwd:r.root,env:r.env,signal:controller.signal,onLine:line=>r.log(line)};
   if(!this.status().installed){
    await this.run(r.uv,['pip','install','--python',this.lyrics.python(),'--break-system-packages','--no-deps','torchvision==0.25.0','--index-url','https://download.pytorch.org/whl/cu128'],options);
    await this.run(r.uv,['pip','install','--python',this.lyrics.python(),'--break-system-packages','--no-deps','Pillow==12.1.1','--index-url',r.downloadSource==='mirror'?'https://pypi.tuna.tsinghua.edu.cn/simple':'https://pypi.org/simple'],options);
    const probe=await this.run(this.lyrics.python(),['-u',path.join(r.resources,'backend/music_style.py'),'--probe'],options);
    if(probe?.engine!=='qwen2.5-omni'||probe.pillow!=='12.1.1'||probe.torchvision!=='0.25.0+cu128'||probe.transformers!=='5.13.0')throw Error('原曲风格环境检查未通过');
    writeJSON(path.join(r.root,'music-style-runtime/installed.json'),{installedAt:new Date().toISOString(),probe});
   }
   const env={...r.env,HF_ENDPOINT:r.downloadSource==='mirror'?'https://hf-mirror.com':'https://huggingface.co'};delete env.HF_TOKEN;delete env.HUGGING_FACE_HUB_TOKEN;
   await this.run(this.lyrics.python(),['-u',path.join(r.resources,'backend/model_files.py'),r.root,this.lockFile],{cwd:r.root,env,signal:controller.signal,onLine:(line,event)=>{r.log(line);if(event?.type==='stage'){r.operation.stage=event.stage;r.emit('change');}}});
  }finally{r.operation=null;r.emit('change');}
 }
 async analyze(store,job,signal){
  if(this.runtime.operation)throw Error('请等待环境准备完成');this.validate(job.request);
  const dir=store.directory(job.id);writeJSON(path.join(dir,'input.json'),job.request);
  const result=await this.run(this.lyrics.python(),['-u',path.join(this.runtime.resources,'backend/music_style.py'),'--root',this.runtime.root,'--source',this.cover.sourceAudio(job.request.sourceId),'--request',path.join(dir,'input.json'),'--output',path.join(dir,'artifacts'),'--lock',this.lockFile],{
   cwd:this.runtime.root,env:{...this.runtime.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'},signal,onLine:(line,event)=>{this.runtime.log(line);if(event?.type==='stage')store.update(job.id,{stage:event.stage});fs.appendFileSync(path.join(dir,'music-style.log'),this.runtime.logs.at(-1)+'\n');}
  });
  if(signal.aborted)throw Error('任务已取消');
  if(result?.engine!=='qwen2.5-omni'||typeof result.style!=='string'||!result.style.trim()||result.style.length>2000||!Array.isArray(result.samples)||!result.samples.length||result.samples.some(s=>!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<job.request.start||s.end>job.request.end+.02||s.end<=s.start))throw Error('未产生完整的原曲风格识别结果');
  return result;
 }
}
module.exports={MusicStyle};
