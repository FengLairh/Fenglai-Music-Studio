const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {JobStore,writeJSON,readJSON}=require('../desktop/core.cjs');
const {HistoryDeletion,trashWithin}=require('../desktop/history-deletion.cjs');
function fixture(){
 const root=fs.mkdtempSync(path.join(__dirname,'../test-results/history-unit-')),store=new JobStore(path.join(root,'songs'));
 const assistant={root:path.join(root,'assistant'),record:id=>readJSON(path.join(root,'assistant/history',id+'.json'),null)};
 const kept={source:'sources/original.wav',model:'models/weights',draft:'draft.json',settings:'assistant/settings.json',key:'credentials/key.bin'};
 for(const file of Object.values(kept)){fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.writeFileSync(path.join(root,file),'keep');}
 const calls=[],trash=async file=>{calls.push(file);const to=path.join(root,'recycled',path.basename(file));fs.mkdirSync(path.dirname(to),{recursive:true});fs.renameSync(file,to);};
 const deletion=new HistoryDeletion({store,assistant,confirm:async()=>true,trash});
 function song(status='completed'){const job=store.add({style:'folk',lyrics:'[Verse]\n夜风',title:'测试歌曲'});store.update(job.id,{status});fs.mkdirSync(path.join(store.directory(job.id),'artifacts'),{recursive:true});fs.writeFileSync(path.join(store.directory(job.id),'artifacts/audio.flac'),'audio');return job;}
 return {root,store,assistant,kept,calls,trash,deletion,song};
}
test('deleting a song recycles only its directory and stays deleted after restart',async()=>{
 const f=fixture(),job=f.song();let changed=0;f.store.on('change',()=>changed++);
 assert.equal(await f.deletion.job(job.id),true);assert.deepEqual(f.calls,[f.store.directory(job.id)]);assert.equal(changed,1);
 assert.throws(()=>f.store.get(job.id),/不存在/);assert.equal(new JobStore(f.store.root).list().length,0);
 assert.equal(fs.readFileSync(path.join(f.root,'recycled',job.id,'artifacts/audio.flac'),'utf8'),'audio');
 for(const file of Object.values(f.kept))assert.equal(fs.readFileSync(path.join(f.root,file),'utf8'),'keep');
 // Simulate a Windows recycle-bin restore; the original ID is rediscovered.
 fs.renameSync(path.join(f.root,'recycled',job.id),f.store.directory(job.id));assert.equal(new JobStore(f.store.root).get(job.id).request.title,'测试歌曲');
});
test('cancel, active jobs and dependent Cover records never invoke trash',async()=>{
 const f=fixture(),job=f.song();f.deletion.confirm=async()=>false;assert.equal(await f.deletion.job(job.id),false);
 f.deletion.confirm=async()=>true;
 for(const status of ['queued','running']){f.store.update(job.id,{status});await assert.rejects(f.deletion.job(job.id),/等待任务停止/);}
 f.store.update(job.id,{status:'completed'});
 const child=f.store.add({title:'后续 Cover',style:'jazz',lyrics:'夜风',abc:'score',transcriptionId:job.id});
 await assert.rejects(f.deletion.job(job.id),/后续 Cover/);f.store.update(child.id,{status:'cancelled'});
 child.request={...child.request,transcriptionId:undefined,sourceJobId:job.id};f.store.save(child);
 await assert.rejects(f.deletion.job(job.id),/后续 Cover/);assert.deepEqual(f.calls,[]);
 await f.deletion.job(child.id);await f.deletion.job(job.id);assert.equal(f.store.list().length,0);
});
test('recycle failure preserves files and history, allowing retry',async()=>{
 const f=fixture(),job=f.song();f.deletion.trash=async()=>{throw Error('file in use');};
 await assert.rejects(f.deletion.job(job.id),/记录已保留/);assert.equal(f.store.get(job.id).status,'completed');assert.ok(fs.existsSync(f.store.directory(job.id)));
 f.deletion.trash=f.trash;assert.equal(await f.deletion.job(job.id),true);
});
test('a transient playback file lock retries recycling and completes once',async()=>{
 const f=fixture(),job=f.song();let attempts=0;
 f.deletion.trash=async file=>{if(++attempts===1)throw Error('file handle releasing');await f.trash(file);};
 assert.equal(await f.deletion.job(job.id),true);assert.equal(attempts,2);assert.equal(f.calls.length,1);assert.equal(f.store.list().length,0);
});
test('new dependencies during confirmation prevent deletion; pending recycle blocks new users',async()=>{
 const f=fixture(),job=f.song();
 f.deletion.confirm=async()=>{f.store.add({style:'jazz',lyrics:'夜风',abc:'score',transcriptionId:job.id});return true;};
 await assert.rejects(f.deletion.job(job.id),/Cover 任务使用/);assert.deepEqual(f.calls,[]);
 const other=f.song();let finish,started;const begun=new Promise(r=>started=r);
 f.deletion.confirm=async()=>true;f.deletion.trash=async file=>{started();await new Promise(r=>finish=r);await f.trash(file);};
 const removing=f.deletion.job(other.id);await begun;
 await assert.rejects(f.deletion.job(other.id),/正在处理/);
 assert.throws(()=>f.store.add({style:'jazz',lyrics:'夜风',abc:'score',transcriptionId:other.id}),/正在删除/);
 finish();await removing;
});
test('invalid IDs, linked job contents and linked history roots are refused',async()=>{
 const f=fixture(),job=f.song();await assert.rejects(trashWithin(f.store.root,'../models',f.trash),/无效/);
 assert.throws(()=>f.deletion.job('../models'),/无效/);
 fs.symlinkSync(path.join(f.root,'models'),path.join(f.store.directory(job.id),'models-link'),'junction');
 await assert.rejects(f.deletion.job(job.id),/文件链接/);assert.deepEqual(f.calls,[]);
 const linked=path.join(f.root,'linked-history');fs.symlinkSync(f.store.root,linked,'junction');
 await assert.rejects(trashWithin(linked,job.id,f.trash),/目录含链接/);
 assert.equal(fs.readFileSync(path.join(f.root,'models/weights'),'utf8'),'keep');
});
test('AI suggestion deletion affects only that record, cancellation and duplicate dialogs are safe',async()=>{
 const f=fixture(),id=crypto.randomUUID(),file=path.join(f.assistant.root,'history',id+'.json');
 writeJSON(file,{id,status:'completed',proposal:{title:'歌词建议'}});
 let finish,started;const begun=new Promise(r=>started=r);
 f.deletion.confirm=async()=>{started();return await new Promise(r=>finish=r);};
 const pending=f.deletion.suggestion(id);await begun;await assert.rejects(f.deletion.suggestion(id),/正在处理/);finish(false);
 assert.equal(await pending,false);assert.ok(fs.existsSync(file));
 f.deletion.confirm=async()=>true;assert.equal(await f.deletion.suggestion(id),true);assert.deepEqual(f.calls,[file]);
 assert.ok(fs.existsSync(path.join(f.root,'recycled',id+'.json')));
 for(const name of Object.values(f.kept))assert.equal(fs.readFileSync(path.join(f.root,name),'utf8'),'keep');
 await assert.rejects(f.deletion.suggestion(id),/不存在/);
});
