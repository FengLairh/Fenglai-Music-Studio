const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JobStore, JobQueue, validateRequest, writeJSON} = require('../desktop/core.cjs');
const {Runtime, run} = require('../desktop/runtime.cjs');
const root = path.resolve(__dirname, '..', 'test-results'); fs.mkdirSync(root, {recursive:true});
const temp = () => fs.mkdtempSync(path.join(root, 'unit-'));
const input = {title:'测试作品',style:'Mandarin piano pop',lyrics:'[Verse]\n测试歌词',seed:42,profile:'low-memory',maxTokens:750};
const eventually = async fn => {const end = Date.now() + 8000; while(!fn()) {if (Date.now()>end) throw new Error('Timed out'); await new Promise(r=>setTimeout(r,20));}};

test('validate untrusted requests, including incompatible score mode and unsafe numbers', () => {
  assert.equal(validateRequest(input).cot,'full');
  for (const changes of [{style:''},{lyrics:4},{seed:NaN},{seed:-1},{seed:2**54},{maxTokens:199},{maxTokens:9001},{cot:'off',abc:'X:1'},{profile:'arbitrary-shell'},{title:'x'.repeat(101)}]) assert.throws(()=>validateRequest({...input,...changes}));
});
test('persist jobs, reject traversal, recover interrupted processes after restart', () => {
  const dir = temp(), store = new JobStore(dir), job = store.add(input);
  assert.throws(()=>store.directory('../secrets')); assert.throws(()=>store.get('00000000-0000-0000-0000-000000000000'));
  store.update(job.id,{status:'running'}); const recovered = new JobStore(dir).get(job.id);
  assert.equal(recovered.status,'interrupted'); assert.equal(recovered.request.lyrics,input.lyrics);
});
test('queue serializes inference and continues after a failed job', async () => {
  const store = new JobStore(temp()); let running=0, maximum=0, calls=0;
  const queue = new JobQueue(store,async()=>{running++; maximum=Math.max(maximum,running); calls++; await new Promise(r=>setTimeout(r,30)); running--; if(calls===1) throw new Error('CUDA failure'); return {seconds:2};});
  const one=queue.enqueue(input), two=queue.enqueue(input); await eventually(()=>two.status==='completed');
  assert.equal(one.status,'failed'); assert.equal(maximum,1); assert.equal(two.result.seconds,2);
});
test('cancel active and queued jobs without creating a completed result', async () => {
  const store = new JobStore(temp());
  const queue = new JobQueue(store,async(_j,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true})));
  const one=queue.enqueue(input),two=queue.enqueue(input); queue.cancel(two.id); queue.cancel(one.id);
  await eventually(()=>one.status==='cancelled'); assert.equal(two.status,'cancelled'); assert.equal(one.result,null);
});
test('stdout protocol handles split UTF-8 JSON and propagates process failure', async () => {
  const lines=[]; const result=await run(process.execPath,['-e','process.stdout.write("{\\\"type\\\":\\\"result\\\", "); setTimeout(()=>console.log("\\\"result\\\":{\\\"text\\\":\\\"中文\\\"}}"),20)'],{onLine:x=>lines.push(x)});
  assert.equal(result.text,'中文'); assert.equal(lines.length,1);
  await assert.rejects(run(process.execPath,['-e','console.log(JSON.stringify({type:"error",message:"broken weights"}));process.exit(2)']),/broken weights/);
});
test('model readiness requires all locked files, matching sizes and revision', () => {
  const dir=temp(), resources=temp(); const revision='a'.repeat(40);
  writeJSON(path.join(resources,'models.lock.json'),{models:[{name:'model',repo:'test/model',revision,sizes:[{name:'weights.bin',bytes:4}],files:['weights.bin']}]});
  const runtime=new Runtime(resources,dir); assert.equal(runtime.modelStatus()[0].ready,false);
  const model=path.join(dir,'models','model'); writeJSON(path.join(model,'.ready.json'),{revision}); fs.writeFileSync(path.join(model,'weights.bin'),'abc');
  assert.equal(runtime.modelStatus()[0].ready,false); fs.writeFileSync(path.join(model,'weights.bin'),'abcd'); assert.equal(runtime.modelStatus()[0].ready,true);
  writeJSON(path.join(model,'.ready.json'),{revision:'bad'}); assert.equal(runtime.modelStatus()[0].ready,false);
});
test('logs redact credentials and source selection uses an allowlist', () => {
  const runtime=new Runtime(temp(),temp()); runtime.log('Bearer secret.token hf_abcdefghijklmn https://user:password@example.com/');
  assert.doesNotMatch(runtime.logs[0],/secret.token|abcdefghijklmn|password/); assert.throws(()=>runtime.setDownloadSource('https://untrusted.invalid')); runtime.setDownloadSource('mirror'); assert.equal(runtime.downloadSource,'mirror');
});
test('abort terminates a spawned process', async () => {
  const controller=new AbortController(); const pending=run(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});
  setTimeout(()=>controller.abort(),150); await assert.rejects(pending,/取消/);
});
