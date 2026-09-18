(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./score-model.js'));else root.LyricPlan=factory(root.ScoreModel);})(typeof globalThis!=='undefined'?globalThis:this,S=>{
'use strict';
function fail(message){const e=Error('模型填词未通过词谱校验：'+message);e.code='LYRIC_FIT';throw e;}
const round=x=>Math.round(x*1000)/1000;
function cleanBinding(binding,doc,lyrics){
 if(!S.validBinding(binding,doc,lyrics))return null;
 return {version:1,abcStamp:binding.abcStamp,lyricsStamp:binding.lyricsStamp,slots:binding.slots.map(s=>s.slice(0,3)),reviewed:binding.reviewed===true,strategy:['manual','ai-phrases'].includes(binding.strategy)?binding.strategy:'reference'};
}
function create(doc,lyrics='',binding=null){
 if(doc.errors.length)throw Error('模型填词需要有效乐谱，请先修正小节拍数');
 if(!doc.vocal.length)throw Error('模型填词需要人声旋律；当前乐谱只有休止符，请先完成旋律');
 const old=cleanBinding(binding,doc,lyrics),locked=old&&(old.reviewed||['manual','ai-phrases'].includes(old.strategy));
 const sections=doc.sections.length?doc.sections.map((s,i)=>({...s,index:i,end:doc.sections[i+1]?.time??doc.voices.Vocal.time})):[{name:'Verse',time:0,end:doc.voices.Vocal.time,index:0}];
 // Unlabelled pickup before the first section still belongs to a real singing slot.
 if(sections[0].time>0)sections.unshift({name:'Intro',time:0,end:sections[0].time,index:-1});
 const phrases=[];let previous=null,phrase=null;
 for(const [slot,n] of doc.vocal.entries()){
  const section=sections.find(s=>n.onset>=s.time&&n.onset<s.end)||sections.at(-1),gap=previous?n.onset-previous.onset-previous.duration:Infinity;
  const oldSlot=old?.slots[slot],priorSlot=old?.slots[slot-1];
  const lineBreak=locked&&oldSlot?.[0]&&oldSlot[0]!=='_'&&priorSlot?.[0]&&lyrics.slice(priorSlot[2],oldSlot[1]).includes('\n');
  // Rests are phrase boundaries. Continuous passages get a line break on a barline,
  // never an artificial extra note or a cut in the middle of a tied attack.
  if(!phrase||phrase.sectionIndex!==section.index||gap>=.5||lineBreak||(phrase.notes.length>=12&&n.bar-phrase.firstBar>=2)){
   phrase={id:'p'+(phrases.length+1),section:section.name,sectionIndex:section.index,firstBar:n.bar,notes:[]};phrases.push(phrase);
  }
  const bar=doc.voices.Vocal.bars[n.bar],item={position:phrase.notes.length+1,slot,bar:n.bar+1,beat:round(n.onset-bar.time+1),beats:round(n.duration),pitch:n.midi,start:round(n.onset*60/doc.bpm),end:round((n.onset+n.duration)*60/doc.bpm)};
  if(locked){if(oldSlot[0]==='_')item.fixed='hold';else if(!oldSlot[0])item.fixed='empty';else item.units=Math.max(1,S.lyricUnits(oldSlot[0]).length);}
  phrase.notes.push(item);previous=n;
 }
 for(const p of phrases){delete p.firstBar;p.slotCount=p.notes.length;p.wordCapacity=p.notes.reduce((sum,n)=>sum+(n.fixed?0:n.units||1),0);p.original=old?p.notes.map(n=>old.slots[n.slot][0]).filter(x=>x&&x!=='_').join(''):'';p.pauseAfter=round(Math.max(0,(doc.vocal[p.notes.at(-1).slot+1]?.onset??doc.voices.Vocal.time)-doc.vocal[p.notes.at(-1).slot].onset-doc.vocal[p.notes.at(-1).slot].duration));}
 return {version:1,scoreStamp:S.stamp(doc.source),bpm:doc.bpm,policy:locked?'preserve-existing-slots':'phrase-notes',phrases};
}
function apply(doc,lyrics,binding,returned){
 const plan=create(doc,lyrics,binding);
 returned=normalize(plan,returned);
 const problems=diagnose(doc,lyrics,binding,returned);
 if(problems.length)fail(problems.map(p=>p.message).join('；'));
 if(!Array.isArray(returned)||returned.length!==plan.phrases.length)fail(`需返回 ${plan.phrases.length} 句 lyricPhrases，收到 ${Array.isArray(returned)?returned.length:0} 句；不能漏句或添加段落`);
 let text='',lastSection=null,lastWord=false,previousSlot=-1;const slots=doc.vocal.map(()=>null),clean=[];
 for(const [i,p] of plan.phrases.entries()){
  const value=returned[i];if(value?.id!==p.id)fail(`第 ${i+1} 句必须是 ${p.id}，不能打乱顺序`);
  if(!Array.isArray(value.syllables)||value.syllables.length!==p.notes.length)fail(`${p.id}（${p.section}，第 ${p.notes[0].bar} 小节）需要 ${p.notes.length} 个音符槽，收到 ${Array.isArray(value.syllables)?value.syllables.length:0} 个`);
  if(lastSection!==p.sectionIndex){if(text)text+='\n';text+='['+p.section.replace(/[\[\]\r\n]/g,' ').trim()+']\n';lastSection=p.sectionIndex;}
  const words=[];let previousText='';
  for(const [j,n] of p.notes.entries()){
   const raw=value.syllables[j];if(typeof raw!=='string'||raw.length>40||/[\r\n\[\]]/.test(raw))fail(`${p.id} 第 ${j+1} 槽不是有效的单字或词`);
   const word=raw.trim(),event=doc.vocal[n.slot],prior=doc.vocal[previousSlot];
   if(word!=='_'&&/[_*~|\\]/.test(word))fail(`${p.id} 第 ${j+1} 槽包含记谱控制字符`);
   if(n.fixed==='hold'&&word!=='_')fail(`${p.id} 第 ${j+1} 槽应保留拖腔 _`);
   if(n.fixed==='empty'&&word!=='')fail(`${p.id} 第 ${j+1} 槽应保留空白`);
   if(n.units&&S.lyricUnits(word).length!==n.units)fail(`${p.id} 第 ${j+1} 槽应保留 ${n.units} 个歌词单位`);
   if(word==='_'){
    if(!lastWord||!prior||event.onset-prior.onset-prior.duration>=.5)fail(`${p.id} 第 ${j+1} 槽的 _ 前没有可延续的字；休止后的起音需要新字`);
    slots[n.slot]=['_',text.length,text.length];
   }else if(word===''){
    if(n.fixed!=='empty')fail(`${p.id} 第 ${j+1} 槽不能为空；拖腔用 _`);
    slots[n.slot]=['',text.length,text.length];lastWord=false;
   }else{
    const units=S.lyricUnits(word);if(units.length!==(n.units||1))fail(`${p.id} 第 ${j+1} 槽需 ${n.units||1} 个字/词，收到 ${units.length} 个；多音符拖腔使用 _`);
    if(/^[\p{L}\p{N}]/u.test(word)&&! /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(word)&&/[\p{Script=Latin}\p{N}]['’.,!?;:]*$/u.test(previousText))text+=' ';
    const start=text.length;text+=word;slots[n.slot]=[word,start,text.length];lastWord=true;previousText=word;
   }
   previousSlot=n.slot;words.push(word);
  }
  text+='\n';clean.push({id:p.id,syllables:words});
 }
 // Keep offsets stable: remove only the newline we appended after the final line.
 text=text.slice(0,-1);for(const s of slots){s[1]=Math.min(s[1],text.length);s[2]=Math.min(s[2],text.length);}
 if(text.length>12000)fail('生成歌词超过歌词字段容量');
 const result={version:1,abcStamp:S.stamp(doc.source),lyricsStamp:S.stamp(text),slots,reviewed:false,strategy:'ai-phrases'};
 if(!S.validBinding(result,doc,text))fail('音符与歌词位置校验失败');
 return {lyrics:text,binding:result,phrases:clean,summary:{phrases:plan.phrases.length,notes:slots.length,units:S.lyricUnits(text).length,holds:slots.filter(s=>s[0]==='_').length}};
}
function diagnose(doc,lyrics,binding,returned){
 const plan=create(doc,lyrics,binding),problems=[];let lastWord=false,previousSlot=-1;
 returned=normalize(plan,returned);
 const add=(p,message)=>problems.push({id:p.id,message:p.id+'（'+p.section+'，第 '+p.notes[0].bar+' 小节）'+message});
 if(!Array.isArray(returned))return plan.phrases.map(p=>({id:p.id,message:p.id+' 未返回；不能漏句或添加段落'}));
 for(const [i,p] of plan.phrases.entries()){
  const value=returned[i];if(value?.id!==p.id){add(p,'必须是 '+p.id+'，不能打乱顺序或漏句');lastWord=false;continue;}
  if(value.textError){add(p,value.textError);lastWord=false;continue;}
  if(!Array.isArray(value.syllables)||value.syllables.length!==p.notes.length){const size=value.syllables&&typeof value.syllables==='object'?Object.keys(value.syllables).length:0;add(p,`需要 ${p.notes.length} 个音符槽，收到 ${size} 个${!Array.isArray(value.syllables)?'，编号必须从 1 连续对应 notes.position':''}`);lastWord=false;continue;}
  for(const [j,n] of p.notes.entries()){
   const raw=value.syllables[j];if(typeof raw!=='string'||raw.length>40||/[\r\n\[\]]/.test(raw)){add(p,`第 ${j+1} 槽需有效单字/词`);lastWord=false;previousSlot=n.slot;continue;}
   const word=raw.trim(),count=S.lyricUnits(word).length,event=doc.vocal[n.slot],prior=doc.vocal[previousSlot];
   if(n.fixed==='hold'&&word!=='_')add(p,`第 ${j+1} 槽应保留拖腔 _`);
   else if(n.fixed==='empty'&&word!=='')add(p,`第 ${j+1} 槽应保留空白`);
   else if(n.units&&count!==n.units)add(p,`第 ${j+1} 槽应保留 ${n.units} 个歌词单位`);
   else if(word==='_'){if(!lastWord||!prior||event.onset-prior.onset-prior.duration>=.5)add(p,`第 ${j+1} 槽休止后需新字，不能以 _ 开始`);}
   else if(!word&&n.fixed!=='empty')add(p,`第 ${j+1} 槽不能为空，拖腔用 _`);
   else if(word&&(count!==(n.units||1)||/[_*~|\\]/.test(word)))add(p,`第 ${j+1} 槽需 ${n.units||1} 个字/词，不得包含记谱控制字符`);
   if(word!=='_')lastWord=!!word;previousSlot=n.slot;
  }
 }
 if(returned.length>plan.phrases.length)problems.push({id:null,message:'不能添加乐谱外的句子或段落'});
 return problems;
}
function normalize(plan,returned){
 if(!Array.isArray(returned))return returned;
 return returned.map((p,i)=>{
  const phrase=plan.phrases[i];
  if(typeof p?.text==='string'&&phrase){
   const text=p.text,holds=p.holds??[],positions=phrase.notes.map(n=>n.position);
   if(text.length>12000||/[\r\n\[\]_*~|\\]/.test(text))return {...p,textError:'正文只放本句演唱文字，不放换行、段落标签或拖腔符号'};
   if(!Array.isArray(holds)||new Set(holds).size!==holds.length||holds.some(n=>!Number.isInteger(n)||!positions.includes(n)))return {...p,textError:'holds 必须是不重复的本句音符位置编号'};
   if(phrase.notes.some(n=>holds.includes(n.position)&&(n.fixed==='empty'||n.units)))return {...p,textError:'不能将已确定的字位或空白改成拖腔'};
   const held=n=>n.fixed==='hold'||holds.includes(n.position),units=S.lyricUnits(text),expected=phrase.notes.reduce((sum,n)=>sum+(held(n)||n.fixed==='empty'?0:n.units||1),0);
   if(units.length!==expected)return {...p,textError:`正文需 ${expected} 个字/词（${phrase.notes.length} 个音符槽，拖腔占 ${phrase.notes.filter(held).length} 槽），收到 ${units.length} 个；请修改正文或合法拖腔位置`};
   let cursor=0;const syllables=phrase.notes.map(n=>{if(held(n))return '_';if(n.fixed==='empty')return '';const first=units[cursor];cursor+=n.units||1;return text.slice(first.start,units[cursor]?.start??text.length).trim();});
   return {id:p.id,syllables};
  }
  const value=p?.syllables,count=plan.phrases[i]?.notes.length;if(!value||typeof value!=='object'||!count)return p;
  const array=Array.isArray(value),keys=Object.keys(value);
  // Some models pad a finished phrase with redundant continuation marks. Only
  // discard trailing holds beyond the last score note; never truncate words,
  // fill missing notes, remove an interior slot or alter the score duration.
  if(!array&&(!keys.every(k=>/^[1-9]\d*$/.test(k)&&Number(k)<=keys.length)||keys.length<count))return p;
  const list=array?value:Array.from({length:keys.length},(_,j)=>value[String(j+1)]);
  if(list.length>count&&!list.slice(count).every(x=>typeof x==='string'&&x.trim()==='_'))return p;
  return {...p,syllables:list.slice(0,count)};
 });
}
return {create,apply,diagnose,cleanBinding};
});
