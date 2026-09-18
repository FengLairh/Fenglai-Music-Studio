const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateRequest,JobStore,JobQueue,writeJSON}=require('../desktop/core.cjs');
const {Runtime}=require('../desktop/runtime.cjs'),{Cover}=require('../desktop/cover.cjs'),{MusicStyle}=require('../desktop/music-style.cjs');
const temp=()=>fs.mkdtempSync(path.join(process.env.YUE_RELEASE_ROOT||path.join(__dirname,'../test-results'),'music-style-unit-'));
const request={kind:'music-style',sourceId:crypto.randomUUID(),start:9,end:139};
test('audio style accepts only a bounded local source and ignores supplied descriptions and paths',()=>{
 assert.deepEqual(validateRequest({...request,style:'invented',file:'outside',genre:'fake'}),{...request,title:'原曲风格识别'});
 for(const invalid of [{sourceId:'../file'},{start:NaN},{start:'0'},{end:601},{end:400},{end:10},{start:-1}])assert.throws(()=>validateRequest({...request,...invalid}));
});
test('audio style readiness, source bounds and offline single-GPU subprocess are enforced',async()=>{
 const root=temp(),r=new Runtime(path.resolve(__dirname,'..'),root),cover=new Cover(r),python='pinned-asr-python',calls=[];
 writeJSON(path.join(root,'sources',request.sourceId,'source.json'),{id:request.sourceId,seconds:150,name:'原曲.flac'});fs.writeFileSync(cover.sourceAudio(request.sourceId),'fixture');
 const result={engine:'qwen2.5-omni',style:'acoustic folk, warm vocals',samples:[{start:9,end:29}]};
 const m=new MusicStyle(r,cover,{installed:()=>true,python:()=>python},async(file,args,options)=>{calls.push({file,args,options});return result;});
 assert.equal(m.status().ready,false);assert.throws(()=>m.validate(request),/设置页/);m.status=()=>({ready:true});assert.throws(()=>m.validate({...request,end:151}),/超出/);
 const store=new JobStore(path.join(root,'songs')),job=store.add(m.validate(request)),signal=new AbortController().signal;
 assert.equal(await m.analyze(store,job,signal),result);const call=calls[0];assert.equal(call.file,python);assert.equal(call.options.signal,signal);assert.equal(call.options.env.HF_HUB_OFFLINE,'1');assert.equal(call.options.env.CUDA_VISIBLE_DEVICES,r.env.CUDA_VISIBLE_DEVICES);assert.ok(call.args.includes(cover.sourceAudio(request.sourceId)));
 result.samples=[{start:0,end:150}];await assert.rejects(m.analyze(store,job,signal),/完整/);
 result.samples=[{start:9,end:29}];result.engine='text-only-guess';await assert.rejects(m.analyze(store,job,signal),/完整/);
});
test('audio style cancellation releases the shared serial queue before music generation',async()=>{
 const store=new JobStore(temp());let active=0,peak=0;const seen=[];
 const queue=new JobQueue(store,async(job,signal)=>{active++;peak=Math.max(peak,active);seen.push(job.request.kind||'generate');try{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,30);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('cancel'));},{once:true});});return {};}finally{active--;}});
 const first=queue.enqueue(request),second=queue.enqueue({style:'folk',lyrics:'春风吹'});queue.cancel(first.id);
 for(let i=0;i<100&&second.status!=='completed';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(first.status,'cancelled');assert.equal(second.status,'completed');assert.equal(peak,1);assert.deepEqual(seen,['music-style','generate']);
});
