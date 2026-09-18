'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {readJSON,writeJSON}=require('./core.cjs'),{run}=require('./runtime.cjs'),S=require('../ui/score-model.js'),T=require('../ui/score-timing.js');
class ScoreTiming {
 constructor({store,cover,lyrics,root,resources,execute=run}){Object.assign(this,{store,cover,lyrics,root,resources,execute});this.pending=new Map();this.tail=Promise.resolve();this.controllers=new Set();this.closed=false;this.lockFile=path.join(resources,'score-sync-models.lock.json');this.lock=readJSON(this.lockFile,{models:[]});}
 status(){const models=this.cover.runtime.modelStatus?.(this.lock)||[];return {ready:!!this.lyrics?.installed()&&models.length===1&&models.every(m=>m.ready),models};}
 async install(){
  if(!this.lyrics.installed())await this.lyrics.install();
  const r=this.cover.runtime;if(r.operation)throw Error('请等待环境准备完成');
  const controller=new AbortController();r.operation={kind:'score-sync',controller,stage:'准备歌词时间对齐模型'};r.emit('change');
  const env={...r.env,HF_ENDPOINT:r.downloadSource==='mirror'?'https://hf-mirror.com':'https://huggingface.co'};delete env.HF_TOKEN;delete env.HUGGING_FACE_HUB_TOKEN;
  try{await this.execute(this.lyrics.python(),['-u',path.join(this.resources,'backend/model_files.py'),this.root,this.lockFile],{cwd:this.root,env,signal:controller.signal,onLine:(line,event)=>{r.log(line);if(event?.type==='stage'){r.operation.stage=event.stage;r.emit('change');}}});}
  finally{r.operation=null;r.emit('change');}
 }
 dispose(){this.closed=true;for(const c of this.controllers)c.abort();}
 context(id){const job=this.store.get(id);if(job.status!=='completed'||['transcribe','lyrics','music-style'].includes(job.request.kind))throw Error('请选择已完成的歌曲');
  const dir=path.join(this.store.directory(id),'artifacts'),audio=path.join(dir,'audio.flac'),abc=fs.readFileSync(path.join(dir,'score.abc'),'utf8'),doc=S.assertValid(abc),stat=fs.statSync(audio);
  const lyrics=job.request.lyrics||'',spokenLyrics=require('../ui/pronunciation.js').generationLyrics(lyrics,job.request.pronunciation),revision=this.lock.models[0]?.revision||'',key=crypto.createHash('sha256').update(JSON.stringify([3,revision,lyrics,abc,stat.size,stat.mtimeMs,...(spokenLyrics!==lyrics?[spokenLyrics]:[])])).digest('hex'),cache=path.join(this.root,'playback-sync',id+'-'+key+'.json');
  const previousKey=crypto.createHash('sha256').update(JSON.stringify([2,abc,stat.size,stat.mtimeMs])).digest('hex');
  return {id,audio,doc,lyrics,spokenLyrics,key,cache,previousCache:path.join(this.root,'playback-sync',id+'-'+previousKey+'.json')};
 }
 cached(c){const v=readJSON(c.cache,null);return v?.key===c.key&&T.validate(v.anchors,100)&&(!v.analysis||T.validate(v.analysis.points)&&T.validEvents(v.analysis,c.doc.tokens.length))?v:null;}
 anchors(c){const saved=this.cached(c);if(saved)return saved.anchors;const old=readJSON(c.previousCache,null);return old&&T.validate(old.anchors,100)?old.anchors:[];}
 async get(id){const c=this.context(id),saved=this.cached(c);if(saved?.analysis)return saved;
  if(this.pending.has(c.cache))return this.pending.get(c.cache);
  const work=this.tail.catch(()=>{}).then(()=>this.analyze(c)).catch(e=>({key:c.key,anchors:this.anchors(c),analysis:null,error:'自动同步暂不可用，可手动校正：'+e.message}));this.tail=work;this.pending.set(c.cache,work);
  try{return await work;}finally{this.pending.delete(c.cache);}
 }
 async analyze(c){
  if(this.closed)throw Error('应用已退出');
  const units=S.lyricUnits(c.lyrics),spokenUnits=S.lyricUnits(c.spokenLyrics||c.lyrics),wordMode=units.length>0;
  if(wordMode&&!this.status().ready)throw Error('请在设置中准备「歌词时间对齐」');
  const python=wordMode?this.lyrics.python():this.cover.python;
  if(!fs.existsSync(python))throw Error('尚未准备音频分析环境');
  const input=path.join(this.root,'cache','score-sync',c.key+'.json');
  const binding=S.align(c.doc,c.lyrics),byOffset=new Map(binding.slots.map((s,i)=>[s[1],s[0]?c.doc.vocal[i]:null]).filter(([,n])=>n)),scale=60/c.doc.bpm;
  writeJSON(input,{seconds:c.doc.seconds,cues:units.map((u,i)=>{const n=byOffset.get(u.start);return {text:spokenUnits[i]?.text||u.text,scoreStart:n?n.onset*scale:null,scoreEnd:n?(n.onset+n.duration)*scale:null,tokens:n?n.tokens.map(t=>t.index):[]};}),voices:Object.fromEntries(['Vocal','Ins'].map(v=>[v,c.doc.voices[v].events.map(n=>[n.onset*scale,n.duration*scale,n.midi])]))});
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),600000);this.controllers.add(controller);
  try{
   const analysis=await this.execute(python,['-u',path.join(this.resources,'backend',wordMode?'lyric_timing.py':'score_sync.py'),'--audio',c.audio,'--score',input,...(wordMode?['--root',this.root,'--lock',this.lockFile]:[])],{cwd:this.root,env:{...this.cover.runtime.env,OPENBLAS_NUM_THREADS:'2',OMP_NUM_THREADS:'6'},signal:controller.signal});
   if(!analysis||!T.validate(analysis.points)||analysis.points.length<2||!T.validEvents(analysis,c.doc.tokens.length))throw Error('音频同步分析没有返回有效时间点');
   // Never overwrite a correction saved while the CPU analysis was running.
   if(this.context(c.id).key!==c.key)throw Error('作品已变更，请重新打开试听');
   const result={key:c.key,anchors:this.anchors(c),analysis};writeJSON(c.cache,result);return result;
  }finally{clearTimeout(timer);this.controllers.delete(controller);if(fs.existsSync(input))fs.unlinkSync(input);}
 }
 save(id,key,anchors){const c=this.context(id);if(c.key!==key)throw Error('作品已变更，请重新打开试听');if(!T.validate(anchors,100)||anchors.some(p=>p[1]>c.doc.seconds))throw Error('同步校正点无效');
  const saved=this.cached(c)||{key:c.key,analysis:null},duration=saved.analysis?.audioSeconds;if(duration&&anchors.some(p=>p[0]>duration))throw Error('校正点超出音频时长');
  const result={...saved,anchors};writeJSON(c.cache,result);return result;
 }
}
module.exports={ScoreTiming};
