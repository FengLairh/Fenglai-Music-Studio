const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validateRequest, JobStore, JobQueue, writeJSON} = require('../desktop/core.cjs');
const {Runtime} = require('../desktop/runtime.cjs');
const {Cover} = require('../desktop/cover.cjs');
const {Voice} = require('../desktop/voice.cjs');
const temp = () => fs.mkdtempSync(path.resolve(__dirname, '../test-results/voice-unit-'));
const sourceId = crypto.randomUUID(), referenceId = crypto.randomUUID();
const request = {kind:'voice', inputType:'source', sourceId, referenceId, start:0, end:30, referenceStart:0, referenceEnd:12,
  sourceHasMusic:true, referenceHasMusic:false, semitones:0, steps:30};
function fixture() {
  const r = new Runtime(temp(), temp()), cover = new Cover(r), store = new JobStore(path.join(r.root, 'songs')), voice = new Voice(r, cover);
  voice.status = () => ({ready:true});
  for (const id of [sourceId, referenceId]) {const dir = path.join(cover.sources, id); writeJSON(path.join(dir,'source.json'), {id,seconds:40}); fs.writeFileSync(path.join(dir,'source.wav'),'fixture');}
  return {r, voice, store};
}
test('voice requests bound audio, reference, pitch, quality and mixing at the queue boundary', () => {
  assert.equal(validateRequest(request).seed,42);
  assert.equal(validateRequest(request).pitchMode,'vocal');
  assert.equal(validateRequest({...request,pitchMode:'song'}).pitchMode,'song');
  assert.equal(validateRequest(request).preserveDynamics,true);
  assert.throws(()=>validateRequest({...request,pitchMode:'automatic'}));
  assert.throws(()=>validateRequest({...request,preserveDynamics:'yes'}));
  for (const changes of [{inputType:'path'}, {sourceId:'../outside'}, {referenceId:null}, {start:NaN}, {end:301}, {end:4},
    {referenceStart:-1}, {referenceEnd:26}, {referenceEnd:4}, {steps:51}, {steps:'30'}, {semitones:13}, {vocalGainDb:Infinity},
    {accompanimentGainDb:-13}, {referenceHasMusic:'false'}, {sourceHasMusic:null}]) assert.throws(() => validateRequest({...request,...changes}));
});
test('voice source provenance rejects incomplete jobs, missing audio and out-of-bounds references', () => {
  const {voice,store} = fixture();
  assert.equal(voice.validate(store,request).kind,'voice');
  assert.throws(() => voice.validate(store,{...request,end:41}),/超出/);
  assert.throws(() => voice.validate(store,{...request,referenceStart:30,referenceEnd:42}),/超出/);
  const generated = store.add({style:'folk',lyrics:'lyrics'});
  const input = {...request,inputType:'job',sourceJobId:generated.id};
  assert.throws(() => voice.validate(store,input),/已完成/);
  store.update(generated.id,{status:'completed',result:{seconds:30}});
  assert.throws(() => voice.validate(store,input),/缺失/);
  fs.mkdirSync(path.join(store.directory(generated.id),'artifacts'));
  fs.writeFileSync(path.join(store.directory(generated.id),'artifacts/audio.wav'),'fixture');
  assert.equal(voice.validate(store,input).sourceJobId,generated.id);
});
test('cancel between separation and conversion never loads the next model; other jobs continue serially', async () => {
  const {voice,store,r} = fixture(); const stages=[];
  let active=0, maximum=0;
  voice.bridge = async (stage, _args, {signal}) => {
    stages.push(stage); active++; maximum=Math.max(maximum,active);
    try {await new Promise((resolve,reject) => {const timer=setTimeout(resolve,100); signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('cancelled'));},{once:true});}); return {};}
    finally {active--;}
  };
  const queue = new JobQueue(store, (job,signal) => job.request.kind==='voice' ? voice.convert(store,job,signal) : Promise.resolve({seconds:10}));
  const one=queue.enqueue(request), two=queue.enqueue({style:'folk',lyrics:'words'});
  queue.cancel(one.id);
  const deadline=Date.now()+3000;
  while(two.status!=='completed') {if(Date.now()>deadline)throw new Error('queue timeout');await new Promise(resolve=>setTimeout(resolve,10));}
  assert.equal(one.status,'cancelled');assert.deepEqual(stages,['separate']);assert.equal(maximum,1);
  assert.equal(r.env.CUDA_DEVICE_ORDER,'PCI_BUS_ID');assert.equal(r.env.CUDA_VISIBLE_DEVICES,'0');
});
