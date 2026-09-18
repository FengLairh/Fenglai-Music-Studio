const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateRequest,JobStore,JobQueue,writeJSON}=require('../desktop/core.cjs');
const {Runtime}=require('../desktop/runtime.cjs'),{Cover}=require('../desktop/cover.cjs'),{Voice}=require('../desktop/voice.cjs'),{Lyrics}=require('../desktop/lyrics.cjs');
const temp=()=>fs.mkdtempSync(path.join(__dirname,'../test-results/lyrics-unit-'));
const input={kind:'lyrics',sourceId:crypto.randomUUID(),start:8,end:38,language:'zh',separateVocals:true};
test('lyric recognition accepts a bounded audio segment and never passes invented text or arbitrary paths',()=>{
 assert.deepEqual(validateRequest({...input,model:'untrusted',lyrics:'invented',sourcePath:'outside'}),{...input,title:'歌词识别'});
 for(const update of [{sourceId:'../sources'},{start:-1},{start:NaN},{start:'0'},{end:601},{end:309},{end:9},{language:'shell'},{separateVocals:'true'}])assert.throws(()=>validateRequest({...input,...update}));
});
test('recognition checks source bounds, model readiness and optional separation before queueing',()=>{
 const root=temp(),runtime=new Runtime(temp(),root),cover=new Cover(runtime),voice=new Voice(runtime,cover),lyrics=new Lyrics(runtime,cover,voice);
 writeJSON(path.join(root,'sources',input.sourceId,'source.json'),{id:input.sourceId,seconds:60,name:'原曲.wav'});fs.writeFileSync(cover.sourceAudio(input.sourceId),'source');
 lyrics.status=()=>({ready:false,separationReady:false});assert.throws(()=>lyrics.validate(input),/设置页/);
 lyrics.status=()=>({ready:true,separationReady:false});assert.throws(()=>lyrics.validate(input),/分离模型/);
 assert.equal(lyrics.validate({...input,separateVocals:false}).title,'原曲.wav · 歌词识别');
 lyrics.status=()=>({ready:true,separationReady:true});assert.throws(()=>lyrics.validate({...input,end:61}),/超出/);
 assert.throws(()=>lyrics.validate({...input,sourceId:crypto.randomUUID()}),/不存在/);
});
test('lyrics, score transcription, music and voice tasks share a serial queue and cancelled recognition releases it',async()=>{
 const store=new JobStore(temp()),calls=[];let concurrent=0,max=0;
 const queue=new JobQueue(store,async(job,signal)=>{concurrent++;max=Math.max(max,concurrent);calls.push(job.request.kind||'generate');try{await new Promise((r,j)=>{const timer=setTimeout(r,25);signal.addEventListener('abort',()=>{clearTimeout(timer);j(Error('cancelled'));},{once:true});});return {text:'歌词',segments:[],seconds:30};}finally{concurrent--;}});
 const one=queue.enqueue(input),two=queue.enqueue({kind:'transcribe',sourceId:input.sourceId,start:0,end:30,melodyOnly:true});
 queue.enqueue({style:'folk',lyrics:'夜风'});
 const last=queue.enqueue({kind:'voice',inputType:'source',sourceId:input.sourceId,referenceId:crypto.randomUUID(),start:0,end:30,referenceStart:0,referenceEnd:10,sourceHasMusic:true,referenceHasMusic:false});queue.cancel(one.id);
 const until=Date.now()+5000;while(last.status!=='completed'){if(Date.now()>until)throw Error('Queue timeout');await new Promise(r=>setTimeout(r,10));}
 assert.equal(one.status,'cancelled');assert.equal(two.status,'completed');assert.equal(max,1);assert.deepEqual(calls,['lyrics','transcribe','generate','voice']);
});
test('Whisper installation markers cannot enable Qwen recognition; ASR uses its own Python',()=>{
 const root=temp(),resources=temp();writeJSON(path.join(resources,'lyrics-models.lock.json'),{models:[{name:'Qwen3-ASR-1.7B',revision:'locked-qwen',repo:'Qwen/Qwen3-ASR-1.7B-hf',sizes:[{name:'config.json',bytes:1}]}]});
 const runtime=new Runtime(resources,root),cover=new Cover(runtime),voice=new Voice(runtime,cover),lyrics=new Lyrics(runtime,cover,voice);
 fs.mkdirSync(path.dirname(lyrics.python()),{recursive:true});fs.writeFileSync(lyrics.python(),'fixture');
 writeJSON(path.join(root,'lyrics-runtime/installed.json'),{probe:{engine:'whisper',transformers:'5.13.0'}});assert.equal(lyrics.installed(),false);
 writeJSON(path.join(root,'lyrics-runtime/installed.json'),{probe:{engine:'qwen3-asr',transformers:'5.13.0'}});assert.equal(lyrics.installed(),true);assert.notEqual(lyrics.python(),voice.python);assert.equal(lyrics.status().ready,false);
 writeJSON(path.join(root,'models/Qwen3-ASR-1.7B/.ready.json'),{revision:'locked-qwen'});fs.writeFileSync(path.join(root,'models/Qwen3-ASR-1.7B/config.json'),'q');assert.equal(lyrics.status().ready,true);
});
test('ASR waits for separation exit, cancellation prevents loading Qwen, and no Whisper result is accepted',async()=>{
 const root=temp(),runtime=new Runtime(temp(),root),cover=new Cover(runtime),voice=new Voice(runtime,cover),calls=[],controller=new AbortController();
 writeJSON(path.join(root,'sources',input.sourceId,'source.json'),{id:input.sourceId,seconds:60,name:'原曲.wav'});fs.writeFileSync(cover.sourceAudio(input.sourceId),'source');
 let cancel=false,engine='qwen3-asr';const lyrics=new Lyrics(runtime,cover,voice,async(python,args)=>{const phase=args.at(-1);calls.push({python,phase});if(phase==='prepare'){if(cancel)controller.abort();return {prepared:true};}return {engine,text:'夜风',segments:[]};});lyrics.status=()=>({ready:true,separationReady:true});
 const store=new JobStore(path.join(root,'songs')),job=store.add(input);
 await lyrics.recognize(store,job,controller.signal);assert.deepEqual(calls.map(x=>x.phase),['prepare','recognize']);assert.equal(calls[0].python,voice.python);assert.equal(calls[1].python,lyrics.python());
 engine='whisper';await assert.rejects(lyrics.recognize(store,job,controller.signal),/千问/);
 calls.length=0;cancel=true;await assert.rejects(lyrics.recognize(store,job,controller.signal),/取消/);assert.deepEqual(calls.map(x=>x.phase),['prepare']);
});
