const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateRequest,writeJSON}=require('../desktop/core.cjs'),{Runtime}=require('../desktop/runtime.cjs'),{Cover}=require('../desktop/cover.cjs'),{VoicePresets}=require('../desktop/voice-presets.cjs');
const temp=()=>fs.mkdtempSync(path.join(__dirname,'../test-results/timbre-unit-'));
test('timbre-only conversion rejects changes to key, backing gain, performance and never accepts replacement lyrics',()=>{
 const input={kind:'voice',inputType:'source',sourceId:crypto.randomUUID(),referenceId:crypto.randomUUID(),start:0,end:30,referenceStart:0,referenceEnd:12,sourceHasMusic:true,referenceHasMusic:false,preserveSong:true,pitchMode:'vocal',semitones:0};
 const result=validateRequest({...input,lyrics:'rewritten',style:'different',abc:'new score'});assert.equal(result.preserveSong,true);for(const key of ['lyrics','style','abc'])assert.equal(key in result,false);
 for(const change of [{semitones:1},{pitchMode:'song'},{vocalGainDb:2},{accompanimentGainDb:-1},{preserveDynamics:false},{sourceHasMusic:false},{preserveSong:'yes'}])assert.throws(()=>validateRequest({...input,...change}));
 assert.equal(validateRequest({...input,preserveSong:false,semitones:2,pitchMode:'song'}).semitones,2);
});
test('bundled presets are hash checked and copied once without modifying an existing reference',()=>{
 const resources=temp(),root=temp(),sourceId=crypto.randomUUID(),bytes=Buffer.from('voice fixture'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 writeJSON(path.join(resources,'voice-presets/manifest.json'),{presets:[{id:'female',sourceId,seconds:12,sha256:hash}]});fs.writeFileSync(path.join(resources,'voice-presets/female.wav'),bytes);
 const r=new Runtime(resources,root),cover=new Cover(r),presets=new VoicePresets(r,cover);assert.equal(cover.list().length,0);assert.equal(presets.list().find(p=>p.id==='female').ready,true);
 const one=presets.source('female'),before=fs.statSync(cover.sourceAudio(one.id)).mtimeMs;assert.equal(one.id,sourceId);assert.deepEqual(presets.source('female'),one);assert.equal(fs.statSync(cover.sourceAudio(one.id)).mtimeMs,before);
 fs.writeFileSync(path.join(resources,'voice-presets/female.wav'),'corrupted');assert.throws(()=>presets.source('female'),/校验/);assert.ok(fs.readFileSync(cover.sourceAudio(one.id)).equals(bytes));assert.throws(()=>presets.source('../escape'));
});
test('AI voice design cancellation and active operations never publish a partial reference',async()=>{
 const r=new Runtime(temp(),temp()),cover=new Cover(r),presets=new VoicePresets(r,cover,async(_python,_args,{signal})=>{r.operation.controller.abort();assert.equal(signal.aborted,true);return {engine:'qwen3-voice-design',seconds:12};});presets.status=()=>({ready:true});
 r.ensureGpu=async()=>{};
 await assert.rejects(presets.create({instruct:'温暖女声'}),/取消/);assert.equal(r.operation,null);assert.equal(cover.list().length,0);
 r.operation={kind:'generate'};await assert.rejects(presets.create({instruct:'温暖女声'}),/等待/);assert.equal(r.operation.kind,'generate');
 await assert.rejects(presets.create({instruct:'x'.repeat(501)}),/500/);
});
