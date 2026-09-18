const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const P=require('../ui/pronunciation.js'),S=require('../ui/score-model.js'),{validateRequest,JobStore}=require('../desktop/core.cjs'),{Runtime}=require('../desktop/runtime.cjs');
const lyrics='[Verse]\n慢慢长大\n长长的路',mark=(text,offset,reading,replacement,guide=true)=>({start:offset,end:offset+text.length,text,pinyin:reading,replacement,guide});
function annotated(){return P.set(P.set(P.empty(lyrics),lyrics,mark('长',lyrics.indexOf('长'),'zhang3','掌')),lyrics,mark('长',lyrics.lastIndexOf('长'),'chang2','常'));}
test('pronunciation annotations target occurrences, preserve original text and never enter native ABC',()=>{
 const p=annotated();assert.equal(P.generationLyrics(lyrics,p),'[Verse]\n慢慢掌大\n长常的路');assert.equal(lyrics,'[Verse]\n慢慢长大\n长长的路');
 const raw=S.newScore(2).replaceAll('z8 z8 z8 z8|','C8 D8 E8 G8|'),doc=S.assertValid(raw),binding=S.align(doc,lyrics),render=S.renderSource(doc,binding,'','Vocal',P.labels(binding,p));
 assert.doesNotMatch(render.text,/zhǎng|cháng/);assert.equal(render.text,S.renderSource(doc,binding,'','Vocal').text);assert.equal(doc.source,raw);assert.doesNotMatch(raw,/zhǎng|w:/);for(const [offset,token] of render.renderOffsets)assert.ok(doc.tokens.includes(token)&&offset>=0);
});
test('invalid pronunciations, tone mismatches, ambiguous substitute and header annotations are rejected',()=>{
 const first=lyrics.indexOf('长');for(const entry of [mark('长',first,'chang2','掌'),mark('长',first,'invalid','掌'),mark('长',first,'zhang3','长'),mark('长',first,'zhang3',''),mark('长',first,'zhang3','两个')])assert.throws(()=>P.set(P.empty(lyrics),lyrics,entry));
 const p=P.set(P.empty(lyrics),lyrics,mark('长',first,'zhang3','',false));assert.equal(P.generationLyrics(lyrics,p),lyrics);assert.throws(()=>P.validate(p,lyrics+'字'),/不匹配/);
 const header='[长]\n长';assert.throws(()=>P.set(P.empty(header),header,mark('长',1,'zhang3','掌')));assert.ok(P.suggest('长','zhang3')==='掌');
});
test('edits move untouched annotation offsets and remove replaced words; whitespace trimming remains safe',()=>{
 const p=annotated(),inserted='夜风\n'+lyrics,rebased=P.rebase(lyrics,inserted,p);assert.equal(rebased.entries.length,2);assert.equal(P.generationLyrics(inserted,rebased),'夜风\n[Verse]\n慢慢掌大\n长常的路');
 const changed=lyrics.replace('长大','成长'),next=P.rebase(lyrics,changed,p);assert.equal(next.entries.length,1);assert.equal(next.entries[0].start,changed.lastIndexOf('长'));
 const padded='\n '+lyrics+' \n',r=validateRequest({style:'folk',lyrics:padded,pronunciation:P.rebase(lyrics,padded,p),generationLyrics:'injected'});assert.equal(r.lyrics,lyrics);assert.deepEqual(r.pronunciation,p);assert.equal(r.generationLyrics,undefined);
 const retry=validateRequest(r);assert.deepEqual(retry.pronunciation,p);assert.equal(P.generationLyrics(retry.lyrics,retry.pronunciation),'[Verse]\n慢慢掌大\n长常的路');
});
test('actual synthesis bridge receives guided lyrics while job, retry and audit retain originals',async()=>{
 const root=fs.mkdtempSync(path.join(process.env.YUE_RELEASE_ROOT||path.join(__dirname,'../test-results'),'pronunciation-unit-')),r=new Runtime(path.resolve(__dirname,'..'),root),store=new JobStore(path.join(root,'songs')),job=store.add({style:'folk',lyrics,pronunciation:annotated()});
 r.installed=()=>true;r.modelStatus=()=>[{ready:true},{ready:true}];let input;
 r.bridge=async(command,args)=>{assert.equal(command,'generate');input=JSON.parse(fs.readFileSync(args[args.indexOf('--request')+1],'utf8'));const dir=args[args.indexOf('--output')+1];fs.mkdirSync(dir,{recursive:true});for(const f of ['audio.flac','audio.wav'])fs.writeFileSync(path.join(dir,f),'fixture');return {seconds:10};};
 await r.generate(store,job,new AbortController().signal);assert.equal(input.lyrics,'[Verse]\n慢慢掌大\n长常的路');assert.equal(input.pronunciation,undefined);assert.equal(job.request.lyrics,lyrics);
 const audit=JSON.parse(fs.readFileSync(path.join(store.directory(job.id),'pronunciation.json')));assert.equal(audit.originalLyrics,lyrics);assert.equal(audit.generationLyrics,input.lyrics);assert.equal(audit.forcedPhonemes,false);
});
