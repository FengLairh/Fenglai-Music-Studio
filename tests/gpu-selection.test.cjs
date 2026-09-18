const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {Runtime,parseGpus}=require('../desktop/runtime.cjs'),{writeJSON,readJSON}=require('../desktop/core.cjs');
const a='GPU-11111111-2222-3333-4444-555555555555',b='GPU-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const csv=`0, ${a}, First GPU, 16384, 1024, 15360, 591.86\n1, ${b}, Second GPU, 24576, [N/A], 24000, 591.86`;
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'yue-gpu-'));t.after(()=>{assert.ok(path.resolve(root).startsWith(path.join(os.tmpdir(),'yue-gpu-')));fs.rmSync(root,{recursive:true,force:true});});return root;}
test('GPU detection retains all adapters, missing counters and stable UUIDs',()=>{const g=parseGpus(csv);assert.equal(g.length,2);assert.equal(g[1].usedMiB,null);assert.equal(g[1].memoryMiB,24576);assert.deepEqual(parseGpus('invalid,,error'),[]);assert.deepEqual(parseGpus('0, 0, invalid, 1, 1, 1, x'),[]);});
test('selecting one GPU persists independently of download source and survives adapter reordering',async t=>{
 const root=fixture(t);writeJSON(path.join(root,'settings.json'),{downloadSource:'mirror',extra:'keep'});let value=csv;
 const options={hardwareExec:async()=>({stdout:value})},r=new Runtime(root,root,options);r.lastProbe={gpu:'stale GPU'};
 assert.equal((await r.hardware()).gpu,'First GPU');await r.selectGpu(b);assert.equal(r.env.CUDA_VISIBLE_DEVICES,b);assert.equal(r.lastProbe,null);
 r.setDownloadSource('official');assert.deepEqual(readJSON(path.join(root,'settings.json')),{downloadSource:'official',extra:'keep',gpuDevice:b});
 value=csv.replace(`0, ${a}`,`2, ${a}`).replace(`1, ${b}`,`0, ${b}`);const next=new Runtime(root,root,options);
 assert.equal((await next.hardware()).selectedUuid,b);assert.equal(next.env.CUDA_VISIBLE_DEVICES,b);await next.ensureGpu();assert.equal(next.env.CUDA_VISIBLE_DEVICES,b);
 await next.selectGpu('auto');assert.equal(next.env.CUDA_VISIBLE_DEVICES,b);
});
test('busy selection is atomic, rejects multi-card input and never falls back if the saved card disappears',async t=>{
 const root=fixture(t);let value=csv,release;const r=new Runtime(root,root,{hardwareExec:async()=>({stdout:value})});
 await assert.rejects(r.selectGpu('0,1'),/一张/);await assert.rejects(r.selectGpu(`${a},${b}`),/一张/);await r.selectGpu(b);
 r.isGpuBusy=()=>true;await assert.rejects(r.selectGpu(a),/等待/);r.isGpuBusy=()=>false;
 r.hardwareExec=()=>new Promise(done=>release=done);const pending=r.selectGpu(a);await assert.rejects(r.selectGpu(b),/等待/);assert.equal(r.env.CUDA_VISIBLE_DEVICES,b);release({stdout:csv});await pending;
 r.hardwareExec=async()=>({stdout:csv.split('\n')[1]});await assert.rejects(r.ensureGpu(),/未连接/);assert.equal(r.env.CUDA_VISIBLE_DEVICES,a);await assert.rejects(r.selectGpu(a),/不可用/);assert.equal(readJSON(path.join(root,'settings.json')).gpuDevice,a);
 r.hardwareExec=async()=>{throw Error('driver down');};assert.match((await r.hardware()).gpuError,/驱动/);assert.equal((await r.hardware()).gpu,null);
});
