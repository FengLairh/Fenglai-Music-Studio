const {test}=require('node:test'),assert=require('node:assert/strict');
const {readResponse}=require('../desktop/music-assistant.cjs');
const {longResponse,frame}=require('./helpers/assistant-sse.cjs');
const proposal={title:'晚风',style:'folk',lyrics:'[Verse]\n晚风轻轻吹来🎵\n灯火等你归来',notes:[]};

test('long thinking SSE keeps a small complete answer despite more than 2 MiB on the wire',async()=>{
 const fixture=longResponse(proposal);assert.ok(fixture.wireBytes>2*1024*1024);assert.ok(fixture.answerBytes<1024);
 const result=await readResponse(fixture.response,()=>{});assert.deepEqual(result.proposal,proposal);assert.equal(result.usage.total_tokens,11100);assert.ok(fixture.cancelled());
});

test('long lyrics and ABC survive per-character SSE overhead without thinking',async()=>{
 const large={...proposal,lyrics:'晚风吹过小巷\n'.repeat(1000),abc:'C8 D8 E8 G8|'.repeat(1800)};
 const fixture=longResponse(large,{thinking:false});assert.ok(fixture.wireBytes>2*1024*1024);
 assert.deepEqual((await readResponse(fixture.response,()=>{})).proposal,large);
});

test('one large transport chunk is processed incrementally and stops at DONE',async()=>{
 const fixture=longResponse(proposal,{singleChunk:true,tail:frame({error:{message:'must not read past DONE'}})});
 assert.deepEqual((await readResponse(fixture.response,()=>{})).proposal,proposal);assert.ok(fixture.cancelled());
});

test('answers and individual reasoning events above 1 MiB are read without a local byte ceiling',async()=>{
 const large={...proposal,notes:['创作说明'.repeat(100000)]};
 const raw=frame({choices:[{delta:{reasoning_content:'think '.repeat(200000)}}]})+frame({choices:[{delta:{content:JSON.stringify(large)},finish_reason:'stop'}]})+'data: [DONE]\n\n';
 let offset=0;const bytes=Buffer.from(raw),response=new Response(new ReadableStream({pull(c){if(offset===bytes.length){c.close();return;}const end=Math.min(offset+8191,bytes.length);c.enqueue(bytes.subarray(offset,end));offset=end;}}));
 assert.deepEqual((await readResponse(response)).proposal,large);
 const padded=' '.repeat(1200000)+JSON.stringify(proposal);
 assert.deepEqual((await readResponse(new Response(frame({choices:[{delta:{content:padded},finish_reason:'stop'}]})))).proposal,proposal);
});

test('unfinished or malformed streams remain rejected after a long thinking response',async()=>{
 await assert.rejects(readResponse(longResponse(proposal,{finish:'length'}).response,()=>{}),/输出上限/);
 for(const raw of [frame({choices:[{delta:{content:'{"title":"unfinished'}}]}),frame({choices:[{delta:{content:'not json'},finish_reason:'stop'}]}),'data: broken\n\n']){
  await assert.rejects(readResponse(new Response(raw),()=>{}),/未返回完整|JSON 不完整|格式异常/);
 }
});

test('official truncation identifies provider limit and safe usage instead of asking users to shorten songs',async()=>{
 const raw=frame({choices:[{delta:{content:'{"title":"partial'},finish_reason:'length'}],usage:{prompt_tokens:5000,completion_tokens:393216,total_tokens:398216,completion_tokens_details:{reasoning_tokens:390000}}});
 await assert.rejects(readResponse(new Response(raw)),e=>/官方.*输出上限/.test(e.message)&&/393216/.test(e.message)&&/390000/.test(e.message)&&!/缩小|16K/.test(e.message));
});

test('abort cancels an already-open stream even while no further bytes arrive',async()=>{
 const controller=new AbortController();let cancelled=false,started;
 const ready=new Promise(resolve=>started=resolve);
 const response=new Response(new ReadableStream({start(c){c.enqueue(Buffer.from(frame({choices:[{delta:{reasoning_content:'thinking'}}]})));},cancel(){cancelled=true;}}));
 const pending=readResponse(response,()=>started(),controller.signal);await ready;controller.abort();
 await assert.rejects(pending,{name:'AbortError'});assert.ok(cancelled);assert.equal(response.body.locked,false);
});
