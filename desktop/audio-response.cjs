'use strict';
const fs=require('node:fs'),{Readable}=require('node:stream');
// Chromium needs explicit byte ranges on custom protocols to seek local media.
function audioResponse(file,request){
 const stat=fs.statSync(file);if(!stat.isFile())return new Response(null,{status:404});
 const method=request.method||'GET';if(!['GET','HEAD'].includes(method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
 const size=stat.size,headers={'Content-Type':file.toLowerCase().endsWith('.flac')?'audio/flac':'audio/wav','Accept-Ranges':'bytes','Content-Length':String(size)};
 let start=0,end=size-1,status=200;const range=request.headers.get('range');
 if(range&&method==='GET'){
  const m=/^bytes=(\d*)-(\d*)$/.exec(range.trim());
  const invalid=()=>new Response(null,{status:416,headers:{'Content-Range':`bytes */${size}`,'Accept-Ranges':'bytes','Content-Length':'0'}});
  if(!m||(!m[1]&&!m[2])||!size)return invalid();
  if(!m[1]){const count=Number(m[2]);if(!Number.isSafeInteger(count)||count<=0)return invalid();start=Math.max(0,size-count);}
  else{start=Number(m[1]);end=m[2]?Number(m[2]):end;if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>=size||end<start)return invalid();end=Math.min(end,size-1);}
  status=206;headers['Content-Range']=`bytes ${start}-${end}/${size}`;headers['Content-Length']=String(end-start+1);
 }
 if(method==='HEAD'||!size)return new Response(null,{status,headers});
 request.signal?.throwIfAborted();const stream=fs.createReadStream(file,{start,end}),body=Readable.toWeb(stream);
 const abort=()=>stream.destroy();request.signal?.addEventListener('abort',abort,{once:true});stream.once('close',()=>request.signal?.removeEventListener('abort',abort));
 return new Response(body,{status,headers});
}
module.exports={audioResponse};
