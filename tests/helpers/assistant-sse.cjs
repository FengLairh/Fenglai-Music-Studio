const frame=value=>'data: '+JSON.stringify(value)+'\r\n\r\n';
// Realistic per-token envelopes: a small answer can travel in many MB of SSE.
function longResponse(proposal,{thinking=true,singleChunk=false,finish='stop',tail=''}={}){
 const text=JSON.stringify(proposal),frames=[': keepalive\r\n\r\n'];
 const envelope={id:'chatcmpl-'+ 'a'.repeat(48),object:'chat.completion.chunk',created:1789434000,model:'deepseek-flash',system_fingerprint:'fp_'+ 'b'.repeat(32),usage:null};
 if(thinking)for(let i=0;i<10000;i++)frames.push(frame({...envelope,choices:[{index:0,delta:{reasoning_content:'PRIVATE_REASONING 音乐创作分析'},finish_reason:null}]}));
 for(const char of text)frames.push(frame({...envelope,choices:[{index:0,delta:{content:char},finish_reason:null}]}));
 frames.push(frame({...envelope,choices:[{index:0,delta:{},finish_reason:finish}],usage:{prompt_tokens:100,completion_tokens:11000,total_tokens:11100}}),'data: [DONE]\r\n\r\n',tail);
 const bytes=Buffer.from(frames.join(''));let offset=0,cancelled=false;
 const response=new Response(new ReadableStream({pull(c){if(offset>=bytes.length){c.close();return;}const end=singleChunk?bytes.length:Math.min(offset+4093,bytes.length);c.enqueue(bytes.subarray(offset,end));offset=end;},cancel(){cancelled=true;}}));
 return {response,wireBytes:bytes.length,answerBytes:Buffer.byteLength(text),cancelled:()=>cancelled};
}
module.exports={longResponse,frame};
