const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{audioResponse}=require('../desktop/audio-response.cjs');
test('local audio serves seekable byte ranges, suffixes, metadata and exact bytes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'yue-audio-range-')),file=path.join(dir,'audio.flac'),data=Buffer.from(Array.from({length:4096},(_,i)=>i%251));fs.writeFileSync(file,data);t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.join(os.tmpdir(),'yue-audio-range-')));fs.rmSync(dir,{recursive:true,force:true});});
 const request=(range,method='GET')=>new Request('https://local/audio.flac',{method,headers:range?{Range:range}:{}});
 for(const [range,start,end,status] of [[null,0,4095,200],['bytes=1000-1999',1000,1999,206],['bytes=3000-',3000,4095,206],['bytes=-20',4076,4095,206],['bytes=4000-9999',4000,4095,206]]){
  const r=audioResponse(file,request(range));assert.equal(r.status,status);assert.equal(r.headers.get('accept-ranges'),'bytes');assert.equal(r.headers.get('content-length'),String(end-start+1));if(range)assert.equal(r.headers.get('content-range'),`bytes ${start}-${end}/4096`);assert.deepEqual(Buffer.from(await r.arrayBuffer()),data.subarray(start,end+1));
 }
 const head=audioResponse(file,request(null,'HEAD'));assert.equal(head.headers.get('content-length'),'4096');assert.equal((await head.arrayBuffer()).byteLength,0);
 for(const range of ['bytes=4096-','bytes=20-10','bytes=-0','bytes=-','bytes=1-2,5-6','bytes=999999999999999999999-']){const r=audioResponse(file,request(range));assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */4096');assert.equal((await r.arrayBuffer()).byteLength,0);}
 assert.equal(audioResponse(file,request(null,'POST')).status,405);
 const controller=new AbortController();controller.abort();assert.throws(()=>audioResponse(file,new Request('https://local/audio.flac',{signal:controller.signal})),{name:'AbortError'});
});
