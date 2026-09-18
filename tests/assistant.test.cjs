const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {MusicAssistant,CredentialVault,OfficialSkill,validateInput,validateProposal}=require('../desktop/music-assistant.cjs');
const project=path.resolve(__dirname,'..');const secret='sk-unit-test-credential-not-real';
const input={mode:'create',task:'compose',brief:'写一首关于重逢的中文民谣',context:{title:'原稿',style:'folk',lyrics:'[Verse]\n旧的歌词',abc:'',cot:'full'}};
const proposal={title:'重逢',style:'Mandarin folk, warm male vocal',lyrics:'[Verse]\n晚风送你归来\n[Chorus]\n灯火依然等待',cot:'full',summary:'温暖的重逢',arrangement:'吉他和轻鼓',notes:['检查副歌换气。']};
function sse(p=proposal,finish='stop'){
 const text=JSON.stringify(p);let raw=': keepalive\r\n\r\n';
 raw+='data: '+JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE_REASONING'}}]})+'\n\n';
 for(let i=0;i<text.length;i+=9)raw+='data: '+JSON.stringify({choices:[{delta:{content:text.slice(i,i+9)}}]})+'\r\n\r\n';
 raw+='data: '+JSON.stringify({choices:[{delta:{},finish_reason:finish}],usage:{prompt_tokens:20,completion_tokens:30,total_tokens:50}})+'\n\ndata: [DONE]\n\n';
 const bytes=new TextEncoder().encode(raw);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{status:200});
}
function fixture(fetchImpl=async()=>sse(),timeoutMs=3000){
 const root=fs.mkdtempSync(path.join(project,'test-results/assistant-unit-'));const vault={key:()=>secret,status:()=>({configured:true,source:'environment'})};
 return {root,assistant:new MusicAssistant(project,root,vault,{fetchImpl,timeoutMs})};
}
test('official skill is pinned, verified, and supplies task-specific guidance',()=>{
 const skill=new OfficialSkill(project);assert.equal(skill.status().revision,'0edaf2f4053ef4731334b8329834b107977f9637');
 assert.match(skill.context('cover'),/syllable|syllables/);assert.match(skill.context('create'),/reference_audio/);
 assert.throws(()=>skill.read('../desktop/main.cjs'));
 const old=skill.manifest.files.find(f=>f.path==='SKILL.md');old.sha256='bad';assert.throws(()=>skill.read('SKILL.md'),/校验/);
});
test('requests bound text and strip arbitrary fields; Cover cannot silently alter score conditions',()=>{
 const clean=validateInput({...input,apiKey:secret,context:{...input.context,filePath:'C:/secret',reference_audio:'private.wav'}});
 assert.equal(clean.apiKey,undefined);assert.equal(clean.context.filePath,undefined);
 assert.throws(()=>validateInput({...input,brief:'x'.repeat(6001)}));
 assert.throws(()=>validateInput({...input,context:{...input.context,abc:'X:1',cot:'off'}}));
 const cover=validateInput({...input,mode:'cover',task:'style',context:{...input.context,cot:'melody',abc:'X:1\nK:C\nCDEF|'}});
 const result=validateProposal({...proposal,cot:'off',abc:'MALICIOUS NEW SCORE'},cover);
 assert.equal(result.cot,'melody');assert.equal(result.lyrics,cover.context.lyrics);assert.equal(result.abc,undefined);
});

test('creative themes are bounded, preserved in requests and available to every field task',async()=>{
 for(const task of ['style','lyrics','score']){
  const abc=require('../ui/score-model.js').newScore();let sent;
  const {assistant}=fixture(async(_url,options)=>{sent=JSON.parse(options.body);return sse({...proposal,abc});});
  const record=await assistant.compose({...input,task,context:{...input.context,theme:'毕业后的重逢，温暖而克制'}});
  assert.equal(JSON.parse(sent.messages[1].content).context.theme,'毕业后的重逢，温暖而克制');
  assert.equal(record.request.context.theme,'毕业后的重逢，温暖而克制');assert.match(sent.messages[0].content,/context.theme/);
 }
 assert.equal(validateInput(input).context.theme,'');
 assert.throws(()=>validateInput({...input,context:{...input.context,theme:'x'.repeat(2001)}}),/theme/);
});

test('both models and thinking modes use the official 384K ceiling for every field task',async()=>{
 const S=require('../ui/score-model.js');
 for(const model of ['deepseek-flash','deepseek-v4-pro'])for(const thinking of [true,false])for(const task of ['lyrics','style','score','review']){
  let body;const {assistant}=fixture(async(_url,options)=>{body=JSON.parse(options.body);return sse({...proposal,abc:S.newScore()});});
  assistant.configure({model,thinking});await assistant.compose({...input,task});
  assert.equal(body.max_tokens,393216);assert.equal(body.thinking.type,thinking?'enabled':'disabled');assert.equal(body.model,model);
  assert.equal(assistant.status().maxOutputTokens,393216);
 }
});

test('continuous keepalives allow long thinking beyond four minutes; a silent connection still times out',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let stream;
 const root=fs.mkdtempSync(path.join(project,'test-results/assistant-long-thinking-'));
 const assistant=new MusicAssistant(project,root,{key:()=>secret,status:()=>({configured:true})},{fetchImpl:async()=>new Response(new ReadableStream({start(c){stream=c;}}))});
 const pending=assistant.compose(input);const settle=new Promise(resolve=>pending.then(value=>resolve({value}),error=>resolve({error})));await new Promise(setImmediate);
 for(let i=0;i<20;i++){t.mock.timers.tick(60000);stream.enqueue(Buffer.from(': keepalive\n\n'));await new Promise(setImmediate);assert.ok(assistant.active&&!assistant.active.controller.signal.aborted);}
 stream.enqueue(Buffer.from('data: '+JSON.stringify({choices:[{delta:{content:JSON.stringify(proposal)},finish_reason:'stop'}]})+'\n\ndata: [DONE]\n\n'));stream.close();
 const result=await settle;assert.ifError(result.error);assert.equal(result.value.proposal.lyrics,proposal.lyrics);
 const hanging=assistant.compose(input);const rejected=assert.rejects(hanging,/连接等待超时/);await new Promise(setImmediate);t.mock.timers.tick(300001);await rejected;assert.equal(assistant.active,null);
});
test('SSE handles Unicode boundaries and usage; saves a validated proposal without credentials or reasoning',async()=>{
 let sent;const {root,assistant}=fixture(async(url,options)=>{sent={url,options};return sse({...proposal,notes:[secret]});});
 const record=await assistant.compose(input);assert.equal(sent.url,'https://api.deepseek.com/chat/completions');assert.equal(sent.options.redirect,'error');
 assert.equal(sent.options.headers.Authorization,'Bearer '+secret);const body=JSON.parse(sent.options.body);
 assert.equal(body.model,'deepseek-flash');assert.equal(body.thinking.type,'disabled');assert.equal(body.response_format.type,'json_object');
 assert.match(body.messages[0].content,/Official YuE skill: SKILL.md/);assert.equal(record.proposal.lyrics,proposal.lyrics);
 assert.equal(record.usage.total_tokens,50);assert.equal(record.proposal.notes[0],'[REDACTED]');
 const saved=fs.readFileSync(path.join(root,'assistant/history',record.id+'.json'),'utf8');assert.ok(!saved.includes(secret));assert.ok(!saved.includes('PRIVATE_REASONING'));
 assert.equal(assistant.history().length,1);assert.equal(assistant.active,null);
});
test('truncated or malformed responses never become completed proposals',async()=>{
 for(const response of [()=>sse(proposal,'length'),()=>sse({unexpected:'value'})]){
  const {assistant}=fixture(async()=>response());await assert.rejects(assistant.compose(input));assert.equal(assistant.history().length,0);assert.equal(assistant.active,null);
 }
});

test('AI lyric requests include measured score structure and hash the exact final system prompt',async()=>{
 let body;const {assistant}=fixture(async(_url,options)=>{body=JSON.parse(options.body);return sse({...proposal,lyricPhrases:[{id:'p1',syllables:['春','风','_','来']}]});});
 const abc=require('../ui/score-model.js').newScore().replace('z8 z8 z8 z8|','C8 D8 E8 G8|');
 const record=await assistant.compose({...input,task:'lyrics',context:{...input.context,abc,lyrics:'[Verse 1]\n春风吹来\n[Verse 2]\n新增歌词'}});
 assert.match(body.messages[0].content,/scoreSections/);assert.match(body.messages[0].content,/Verse 2.*挤字/);
 assert.equal(record.promptHash,crypto.createHash('sha256').update(body.messages[0].content).digest('hex'));
 assert.equal(record.request.context.abc,abc);
 assert.equal(record.proposal.lyricBinding.slots[2][0],'_');assert.equal(record.proposal.lyricFit.holds,1);
});

test('both lyric modes repair invalid phrase counts once, reject repeated failure, and never save a partial draft',async()=>{
 const S=require('../ui/score-model.js'),abc=S.newScore(1).replace('z8 z8 z8 z8|','C8 D8 z8 G8|');
 const correct={...proposal,lyrics:'',lyricPhrases:[{id:'p1',syllables:['晚','风']},{id:'p2',syllables:['来']}]};
 for(const mode of ['create','cover']){
  let calls=0;const bodies=[],stages=[];const {assistant}=fixture(async(_url,options)=>{bodies.push(JSON.parse(options.body));return sse(++calls===1?{...correct,lyricPhrases:[{id:'p1',syllables:['晚','风','来']},{id:'p2',syllables:[]}]}:correct);});assistant.progress=e=>stages.push(e.stage);
  const record=await assistant.compose({...input,mode,task:'lyrics',context:{...input.context,abc}});
  assert.equal(calls,2);assert.equal(record.proposal.lyrics,'[verse]\n晚风\n来');assert.equal(record.usage.completion_tokens,60);assert.equal(record.attemptUsage.length,2);assert.equal(assistant.history().length,1);assert.match(stages.join(' '),/自动修正/);assert.match(bodies[1].messages.at(-1).content,/p1.*需要 2 个音符槽/);assert.equal(bodies[1].max_tokens,393216);
 }
 let calls=0;const {assistant}=fixture(async()=>{calls++;return sse(proposal);});await assert.rejects(assistant.compose({...input,task:'lyrics',context:{...input.context,abc}}),/不能漏句/);assert.equal(calls,2);assert.equal(assistant.history().length,0);
});

test('lyric cancellation during automatic correction leaves no record and invalid reference fails before API use',async()=>{
 const S=require('../ui/score-model.js'),abc=S.newScore(1).replace('z8 z8 z8 z8|','C8 D8 E8 G8|');let calls=0,repair;const entered=new Promise(r=>repair=r);
 const {assistant}=fixture(async(_url,o)=>{if(++calls===1)return sse(proposal);repair();return new Promise((_r,j)=>o.signal.addEventListener('abort',()=>j(Error('aborted')),{once:true}));});
 const pending=assistant.compose({...input,task:'lyrics',context:{...input.context,abc}});await entered;assistant.cancel();await assert.rejects(pending,/取消/);assert.equal(assistant.history().length,0);assert.equal(assistant.active,null);
 await assert.rejects(assistant.compose({...input,task:'lyrics',context:{...input.context,abc:S.newScore()}}),/只有休止符/);assert.equal(calls,2);
 assert.throws(()=>validateInput({...input,context:{...input.context,abc,binding:{slots:[]}}}),/依据已变化/);
});

test('partial phrase repair retains correct lines and does not silently add or drop syllables',async()=>{
 const S=require('../ui/score-model.js'),abc=S.newScore(2).replace('z8 z8 z8 z8|z8 z8 z8 z8|','C8 D8 z8 G8|A8 B8 z8 C8|');let calls=0;
 const {assistant}=fixture(async()=>sse({...proposal,lyricPhrases:++calls===1?[{id:'p1',syllables:['春']},{id:'p2',syllables:['星','光','亮']},{id:'p3',syllables:['来']}]:[{id:'p1',syllables:['晚','风']}]}));
 const result=await assistant.compose({...input,task:'lyrics',context:{...input.context,abc}});assert.equal(result.proposal.lyrics,'[verse]\n晚风\n星光亮\n来');assert.equal(calls,2);
});
test('provider errors do not echo authentication or response-body secrets',async()=>{
 const {assistant}=fixture(async()=>new Response(secret,{status:401}));await assert.rejects(assistant.compose(input),e=>/401/.test(e.message)&&!e.message.includes(secret));
 assert.equal(assistant.history().length,0);
});
test('cancellation and timeout stop transport, release request lock and keep history clean',async()=>{
 let entered;const enteredPromise=new Promise(r=>entered=r);
 const {assistant}=fixture((_u,o)=>new Promise((_resolve,reject)=>{entered();o.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});}));
 const request=assistant.compose(input);await enteredPromise;await assert.rejects(assistant.compose(input),/已有/);assistant.cancel();await assert.rejects(request,/取消/);
 assert.equal(assistant.active,null);assert.equal(assistant.history().length,0);
 const slow=fixture((_u,o)=>new Promise((_r,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted')))),20).assistant;
 await assert.rejects(slow.compose(input),/超时/);assert.equal(slow.active,null);
});
test('credential vault encrypts on disk, does not return secret in status, supports environment fallback',()=>{
 const root=fs.mkdtempSync(path.join(project,'test-results/assistant-key-'));const file=path.join(root,'key.bin'),key=crypto.randomBytes(32);
 const encryption={isEncryptionAvailable:()=>true,encryptString:s=>{const iv=crypto.randomBytes(16);return Buffer.concat([iv,crypto.createCipheriv('aes-256-ctr',key,iv).update(s)]);},decryptString:b=>crypto.createDecipheriv('aes-256-ctr',key,b.subarray(0,16)).update(b.subarray(16)).toString()};
 const vault=new CredentialVault(file,encryption,{DEEPSEEK_API_KEY:'environment-key'});vault.save(secret);assert.equal(vault.key(),secret);assert.ok(!fs.readFileSync(file).includes(Buffer.from(secret)));
 assert.ok(!JSON.stringify(vault.status()).includes(secret));vault.remove();assert.equal(vault.key(),'environment-key');
 const disabled=new CredentialVault(file,{isEncryptionAvailable:()=>false},{});assert.throws(()=>disabled.save(secret),/未保存/);assert.ok(!fs.existsSync(file));
});
