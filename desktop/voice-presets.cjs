'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJSON,writeJSON,validId}=require('./core.cjs'),{run}=require('./runtime.cjs');
const BUILTINS=[
 {id:'female',name:'女声',detail:'清亮 · 自然',instruct:'成年女性，二十五岁左右，清亮自然，温暖圆润，有胸腔共鸣，吐字清晰，气息稳定，不要尖细。'},
 {id:'male',name:'男声',detail:'温暖 · 醇厚',instruct:'成年男性，三十岁左右，温暖醇厚的中低音，胸腔共鸣自然，吐字清晰，气息稳定。'},
 {id:'boy',name:'男童',detail:'稚嫩 · 清澈',instruct:'九岁左右的男童声音，稚嫩清澈，轻盈自然，明亮纯净，吐字清楚，不尖叫，不夸张。'},
 {id:'girl',name:'女童',detail:'明亮 · 轻盈',instruct:'九岁左右的女童声音，明亮轻盈，稚嫩纯净，自然柔和，吐字清楚，不尖叫，不夸张。'},
 {id:'elder',name:'老人',detail:'沉稳 · 沧桑',instruct:'七十岁左右的老年男性声音，沉稳慈祥，温暖低沉，带轻微自然沙哑，吐字清晰，不虚弱，不夸张。'}
];
class VoicePresets{
 constructor(runtime,cover,runner=run){this.runtime=runtime;this.cover=cover;this.run=runner;this.lockFile=path.join(runtime.resources,'voice-design-models.lock.json');this.lock=readJSON(this.lockFile,{models:[]});this.bundled=readJSON(path.join(runtime.resources,'voice-presets/manifest.json'),{presets:[]});}
 python(){return path.join(this.runtime.root,'voice-design-runtime/python/cpython-3.12.9-windows-x86_64-none/python.exe');}
 installed(){const p=readJSON(path.join(this.runtime.root,'voice-design-runtime/installed.json'),null)?.probe;return fs.existsSync(this.python())&&p?.engine==='qwen3-voice-design'&&p.transformers==='4.57.3';}
 status(){const models=this.runtime.modelStatus(this.lock);return {installed:this.installed(),ready:this.installed()&&models.length===1&&models[0].name==='Qwen3-TTS-VoiceDesign'&&models.every(m=>m.ready),models};}
 list(){return [...BUILTINS.map(p=>({...p,sourceId:this.bundled.presets.find(b=>b.id===p.id)?.sourceId,ready:this.bundled.presets.some(b=>b.id===p.id&&fs.existsSync(path.join(this.runtime.resources,'voice-presets',p.id+'.wav'))),builtin:true})),...this.cover.list().filter(s=>s.voiceDesign?.custom).map(s=>({id:s.id,name:s.name,detail:'AI 生成',instruct:s.voiceDesign.instruct,sourceId:s.id,ready:true,builtin:false}))];}
 source(id){
  const preset=BUILTINS.find(p=>p.id===id);
  if(!preset){const source=this.cover.source(validId(id));if(!source.voiceDesign?.custom)throw Error('请选择有效的 AI 音色');return source;}
  const entry=this.bundled.presets.find(p=>p.id===id);if(!entry)throw Error('预设音色文件缺失，请补全更新包');
  const file=path.join(this.runtime.resources,'voice-presets',id+'.wav'),bytes=fs.readFileSync(file);
  if(crypto.createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('预设音色校验失败');
  const sourceId=validId(entry.sourceId),target=path.join(this.cover.sources,sourceId);
  try{const existing=this.cover.source(sourceId);if(existing.voiceDesign?.preset!==id||crypto.createHash('sha256').update(fs.readFileSync(this.cover.sourceAudio(sourceId))).digest('hex')!==entry.sha256)throw Error('预设音色数据冲突');return existing;}catch(error){if(fs.existsSync(path.join(target,'source.json')))throw error;}
  fs.mkdirSync(target,{recursive:true});const audio=path.join(target,'source.wav');
  if(fs.existsSync(audio)){if(crypto.createHash('sha256').update(fs.readFileSync(audio)).digest('hex')!==entry.sha256)throw Error('预设音色文件冲突');}else fs.writeFileSync(audio,bytes,{flag:'wx'});
  const source={id:sourceId,name:preset.name+' · AI 音色预设',seconds:entry.seconds,sampleRate:48000,channels:2,createdAt:new Date().toISOString(),voiceDesign:{preset:id,custom:false,synthetic:true,instruct:preset.instruct,modelIdentity:entry.modelIdentity||{}}};
  writeJSON(path.join(target,'source.json'),source);return source;
 }
 async create(input){
  if(!input||typeof input.instruct!=='string'||!input.instruct.trim()||input.instruct.length>500)throw Error('请用 1–500 字描述目标音色');
  const seed=input.seed??42;if(!Number.isSafeInteger(seed)||seed<0||seed>2147483647)throw Error('无效的音色种子');
  if(!this.status().ready)throw Error('请先在设置中准备 AI 音色设计模型');
  const r=this.runtime;if(r.operation||this.cover.importing)throw Error('请等待当前操作结束');
  const controller=new AbortController();r.operation={kind:'voice-design',controller,stage:'准备 AI 音色试听'};r.emit('change');
  const id=crypto.randomUUID(),dir=path.join(r.root,'cache/voice-design',id),request=path.join(dir,'input.json');
  writeJSON(request,{instruct:input.instruct.trim(),seed});
  try{
   await r.ensureGpu();if(controller.signal.aborted)throw Error('音色设计已取消');
   const result=await this.run(this.python(),['-u',path.join(r.resources,'backend/voice_design.py'),'generate','--root',r.root,'--lock',this.lockFile,'--request',request,'--output',dir],{cwd:r.root,env:r.env,signal:controller.signal,onLine:(line,event)=>{r.log(line);if(event?.type==='stage'){r.operation.stage=event.stage;r.emit('change');}}});
   if(controller.signal.aborted)throw Error('音色设计已取消');
   if(result?.engine!=='qwen3-voice-design'||!Number.isFinite(result.seconds)||result.seconds<5||result.seconds>25)throw Error('未产生可用的音色试听');
   const target=path.join(this.cover.sources,id);fs.mkdirSync(target);fs.copyFileSync(path.join(dir,'source.wav'),path.join(target,'source.wav'),fs.constants.COPYFILE_EXCL);
   const name=(typeof input.name==='string'?input.name:'AI 自定义音色').trim().slice(0,60)||'AI 自定义音色';
   const source={id,name,seconds:result.seconds,sampleRate:48000,channels:2,createdAt:new Date().toISOString(),voiceDesign:{custom:true,synthetic:true,instruct:input.instruct.trim(),seed,modelIdentity:result.modelIdentity}};
   writeJSON(path.join(target,'source.json'),source);return source;
  }finally{r.operation=null;r.emit('change');}
 }
 async install(){
  const r=this.runtime;if(r.operation||this.cover.importing)throw Error('请等待当前准备操作结束');
  const controller=new AbortController();r.operation={kind:'voice-design',controller,stage:'准备 AI 音色设计'};
  const stage=text=>{r.operation.stage=text;r.log(text);r.emit('change');};r.emit('change');
  const options={cwd:r.root,env:{...r.env,UV_HTTP_TIMEOUT:'30'},signal:controller.signal,onLine:line=>r.log(line)};
  try{
   if(!this.installed()){
    if((await r.hardware()).freeGiB<16)throw Error('AI 音色设计环境和模型至少需要 16GB 可用空间');
    stage('1 / 4 · 准备独立音色设计环境');await this.run(r.uv,['python','install','3.12.9','--install-dir',path.join(r.root,'voice-design-runtime/python'),'--no-bin','--no-registry'],options);
    const cf=path.join(r.resources,'backend/voice-design-constraints.txt'),constraints=fs.existsSync(cf)?['--constraint',cf]:[];
    stage('2 / 4 · 准备单显卡运行库');await this.run(r.uv,['pip','install','--python',this.python(),'--break-system-packages','--no-deps','torch==2.10.0','torchaudio==2.10.0',...constraints,'--index-url','https://download.pytorch.org/whl/cu128'],options);
    stage('3 / 4 · 准备千问音色设计依赖');await this.run(r.uv,['pip','install','--python',this.python(),'--break-system-packages','torch==2.10.0','-r',path.join(r.resources,'backend/voice-design-requirements.txt'),...constraints,'--index-url',r.downloadSource==='mirror'?'https://pypi.tuna.tsinghua.edu.cn/simple':'https://pypi.org/simple'],options);
    const probe=await this.run(this.python(),['-u',path.join(r.resources,'backend/voice_design.py'),'probe','--root',r.root],options);if(probe?.engine!=='qwen3-voice-design'||probe.transformers!=='4.57.3')throw Error('AI 音色环境检查失败');writeJSON(path.join(r.root,'voice-design-runtime/installed.json'),{installedAt:new Date().toISOString(),probe});
   }
   stage('4 / 4 · 下载并校验千问音色设计模型');const env={...r.env,HF_ENDPOINT:r.downloadSource==='mirror'?'https://hf-mirror.com':'https://huggingface.co'};delete env.HF_TOKEN;delete env.HUGGING_FACE_HUB_TOKEN;
   await this.run(this.python(),['-u',path.join(r.resources,'backend/model_files.py'),r.root,this.lockFile],{...options,env,onLine:(line,event)=>{r.log(line);if(event?.type==='stage')stage(event.stage);}});stage('AI 音色设计已就绪');
  }finally{r.operation=null;r.emit('change');}
 }
}
module.exports={VoicePresets,BUILTINS};
