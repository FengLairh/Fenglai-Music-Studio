const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {validateRequest,JobStore,writeJSON}=require('../desktop/core.cjs'),{validateInput,validateProposal}=require('../desktop/music-assistant.cjs'),{Cover}=require('../desktop/cover.cjs'),{Runtime}=require('../desktop/runtime.cjs'),S=require('../ui/score-model.js');
const abc=S.newScore(1).replace('z8 z8 z8 z8|','C8 D8 E8 G8|'),changed=abc.replace('C8 D8 E8 G8|','D8 E8 G8 A8|'),id=crypto.randomUUID();
const base={title:'原曲改词',transcriptionId:id,style:'synthwave NEW',lyrics:'[Verse]\n春风又来',abc,cot:'full',coverMode:'lyrics-only',coverReference:{style:'acoustic folk ORIGINAL',abc}};
test('lyric-only generation excludes new style, preserves score and remains stable on retry',()=>{
 const r=validateRequest(base);assert.equal(r.style,'acoustic folk ORIGINAL');assert.equal(r.abc,abc.trim());assert.deepEqual(validateRequest(r),r);assert.equal(base.style,'synthwave NEW');
 for(const input of [{...base,coverReference:null},{...base,coverReference:{...base.coverReference,style:''}},{...base,abc:changed},{...base,transcriptionId:null},{...base,coverMode:'unknown'}])assert.throws(()=>validateRequest(input));
 const rewrite=validateRequest({...base,coverMode:'rewrite',abc:changed});assert.equal(rewrite.abc,changed.trim());assert.equal(rewrite.style,base.style);assert.equal(rewrite.coverReference,undefined);
});
test('Cover categories select native conditioning without turning a rewritten chord score into melody mode',()=>{
 const root=fs.mkdtempSync(path.join(process.env.YUE_RELEASE_ROOT||path.resolve(__dirname,'../test-results'),'cover-category-unit-')),runtime=new Runtime(root,root),cover=new Cover(runtime),store=new JobStore(path.join(root,'songs')),sourceId=crypto.randomUUID();
 writeJSON(path.join(cover.sources,sourceId,'source.json'),{id:sourceId,seconds:30});fs.writeFileSync(path.join(cover.sources,sourceId,'source.wav'),'fixture');
 const t=store.add({kind:'transcribe',sourceId,start:0,end:20,melodyOnly:true});store.update(t.id,{status:'completed'});
 assert.equal(cover.attachCover(store,{...base,transcriptionId:t.id}).cot,'melody');assert.equal(cover.attachCover(store,{...base,transcriptionId:t.id,coverMode:'rewrite'}).cot,'full');
 assert.equal(cover.attachCover(store,{...base,transcriptionId:t.id,abc:abc.replace('C8 D8','"C"C8 D8')}).cot,'full');
});
test('AI score changes require the rewrite category and lyric-only cannot request score or style edits',()=>{
 const input={mode:'cover',task:'score',brief:'改编旋律',context:{title:'改编',style:'folk',lyrics:'[Verse]\n春风又来',abc,cot:'full'}},p={title:'改编',style:'folk',lyrics:'',abc:changed,cot:'full',summary:'改旋律',arrangement:'',notes:[]};
 assert.throws(()=>validateProposal(p,validateInput(input)),/旋律或节奏/);
 const i=validateInput({...input,context:{...input.context,coverMode:'rewrite'}});assert.equal(validateProposal(p,i).abc,changed.trim());
 for(const task of ['score','style','compose'])assert.throws(()=>validateInput({...input,task,context:{...input.context,coverMode:'lyrics-only'}}),/只改词/);
 for(const task of ['lyrics','review'])assert.equal(validateInput({...input,task,context:{...input.context,coverMode:'lyrics-only'}}).context.style,'folk');
 assert.throws(()=>validateInput({...input,context:{...input.context,coverMode:'invented'}}),/分类/);
});
