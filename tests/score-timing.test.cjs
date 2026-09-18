const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const T=require('../ui/score-timing.js'),S=require('../ui/score-model.js'),{ScoreTiming}=require('../desktop/score-timing.cjs');
test('audio score mapping and inverse preserve nonlinear timing, offsets and unfinished endings',()=>{
 const r={accepted:true,points:[[0,0],[10,12],[20,25],[40,44],[60,68]]},m=T.map(r);
 assert.equal(m.toScore(15),18.5);assert.equal(m.toAudio(18.5),15);assert.equal(m.toScore(60),68);
 const anchors=[[10,13],[40,50]],corrected=T.map(r,anchors);for(let t=0;t<60;t+=.3)assert.ok(Math.abs(corrected.toAudio(corrected.toScore(t))-t)<1e-8);
 assert.equal(corrected.toScore(10),13);assert.equal(corrected.toScore(40),50);assert.equal(T.map(r).toScore(40),44);
 assert.equal(T.map({accepted:false,points:r.points}).toScore(15),15);
 assert.throws(()=>T.insert(anchors,30,51),/顺序/);assert.throws(()=>T.map(r,[[1,2],[3,1]]));
 assert.equal(T.validate([[0,1],[NaN,5]]),false);assert.equal(T.validate([[0,1],[3,1]]),false);
});

test('word highlights wait through breaths, stop at boundaries and do not race across missing lyrics',()=>{
 const result={method:'qwen3-forced-aligner',accepted:true,audioSeconds:120,events:[
  {text:'春',start:14,end:15,scoreStart:12,scoreEnd:13,tokens:[3]},
  {text:'来',start:70,end:71,scoreStart:54,scoreEnd:55,tokens:[100]},
  {text:'春',start:112,end:113,scoreStart:92,scoreEnd:93,tokens:[170]}
 ]};
 assert.ok(T.validEvents(result,200));assert.equal(T.wordAt(result,13.9),null);
 assert.equal(T.wordAt(result,14.2).tokens[0],3);assert.equal(T.wordAt(result,60),null);
 assert.equal(T.wordAt(result,70.8).text,'来');assert.equal(T.wordAt(result,71),null);
 assert.equal(T.wordAt(result,112.2).tokens[0],170);assert.equal(T.wordAt(result,119.9),null);
 const invalid=structuredClone(result);invalid.events[2].end=121;assert.equal(T.validEvents(invalid),false);
 invalid.events[2].end=112;assert.equal(T.validEvents(invalid),false);
});

test('lyrics and model revisions invalidate old melody caches, but preserve explicit user anchors',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yue-word-timing-')),dir=path.join(root,'song','artifacts');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'score.abc'),S.newScore());fs.writeFileSync(path.join(dir,'audio.flac'),'audio');
 t.after(()=>{assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'yue-word-timing-')));fs.rmSync(root,{recursive:true,force:true});});
 const request={lyrics:'[Verse]\n春天来了'},service=new ScoreTiming({store:{get:()=>({status:'completed',request}),directory:()=>path.join(root,'song')},root,resources:root,cover:{}});
 const old=service.context('song');fs.mkdirSync(path.dirname(old.previousCache),{recursive:true});fs.writeFileSync(old.previousCache,JSON.stringify({anchors:[[1,2]],analysis:{accepted:true,points:[[0,3],[6,9]]}}));assert.deepEqual(service.anchors(old),[[1,2]]);assert.equal(service.cached(old),null);
 request.lyrics='[Verse]\n秋天来了';const next=service.context('song');assert.notEqual(old.key,next.key);
 service.lock.models=[{revision:'new-model'}];assert.notEqual(service.context('song').key,next.key);
});

test('pronunciation guidance aligns the spoken alias while keeping original score positions and old cache keys',async t=>{
 const P=require('../ui/pronunciation.js'),root=fs.mkdtempSync(path.join(os.tmpdir(),'yue-pronunciation-timing-')),dir=path.join(root,'song','artifacts');fs.mkdirSync(dir,{recursive:true});
 fs.writeFileSync(path.join(dir,'score.abc'),S.newScore(1).replace('z8 z8 z8 z8|','C8 D8 E8 G8|'));fs.writeFileSync(path.join(dir,'audio.flac'),'audio');const python=path.join(root,'python.exe');fs.writeFileSync(python,'fixture');
 t.after(()=>{assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'yue-pronunciation-timing-')));fs.rmSync(root,{recursive:true,force:true});});
 const request={lyrics:'[Verse]\n长大长长'},service=new ScoreTiming({store:{get:()=>({status:'completed',request}),directory:()=>path.join(root,'song')},root,resources:root,cover:{runtime:{env:{}}},lyrics:{python:()=>python}});service.status=()=>({ready:true});
 const original=service.context('song'),start=request.lyrics.indexOf('长');request.pronunciation=P.set(null,request.lyrics,{start,end:start+1,text:'长',pinyin:'zhang3',replacement:'掌',guide:false});
 assert.equal(service.context('song').key,original.key,'annotation alone must reuse old audio timing');request.pronunciation.entries[0].guide=true;
 const guided=service.context('song');assert.notEqual(guided.key,original.key);assert.equal(guided.lyrics,request.lyrics);assert.equal(guided.spokenLyrics,'[Verse]\n掌大长长');
 let captured;service.execute=async(_python,args)=>{captured=JSON.parse(fs.readFileSync(args[args.indexOf('--score')+1],'utf8'));return {accepted:false,points:[[0,0],[4,4]]};};await service.analyze(guided);
 assert.deepEqual(captured.cues.map(c=>c.text),['掌','大','长','长']);const doc=S.assertValid(fs.readFileSync(path.join(dir,'score.abc'),'utf8'));assert.deepEqual(captured.cues[0].tokens,doc.vocal[0].tokens.map(t=>t.index));assert.equal(captured.cues[0].scoreStart,0);
 assert.equal(request.lyrics,'[Verse]\n长大长长');
});
test('timing cache coalesces analysis, preserves manual corrections, invalidates changed audio and rejects stale saves',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'yue-timing-')),dir=path.join(root,'song','artifacts');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'score.abc'),S.newScore());fs.writeFileSync(path.join(dir,'audio.flac'),'audio');const python=path.join(root,'python.exe');fs.writeFileSync(python,'fixture');
 t.after(()=>{assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'yue-timing-')));fs.rmSync(root,{recursive:true,force:true});});
 let runs=0,finish;const service=new ScoreTiming({store:{get:id=>{assert.equal(id,'song');return {status:'completed',request:{}};},directory:()=>path.join(root,'song')},root,resources:root,cover:{python,runtime:{env:{}}},execute:async()=>{runs++;return new Promise(r=>finish=r);}});
 const a=service.get('song'),b=service.get('song');await new Promise(r=>setImmediate(r));assert.equal(runs,1);const key=service.context('song').key;service.save('song',key,[[2,3]]);finish({accepted:true,points:[[0,0],[9,10]],audioSeconds:9});
 assert.deepEqual((await a).anchors,[[2,3]]);assert.deepEqual(await a,await b);assert.equal((await service.get('song')).analysis.accepted,true);assert.equal(runs,1);
 assert.throws(()=>service.save('song',key,[[10,11]]));fs.appendFileSync(path.join(dir,'audio.flac'),'changed');assert.notEqual(service.context('song').key,key);assert.throws(()=>service.save('song',key,[]),/变更/);
 service.execute=async()=>{throw Error('decoder failed');};const failed=await Promise.all([service.get('song'),service.get('song')]);assert.deepEqual(failed[0],failed[1]);assert.match(failed[0].error,/手动校正/);assert.equal(service.save('song',failed[1].key,[[1,2]]).anchors.length,1);
});
