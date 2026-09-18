(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ScoreModel=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
'use strict';
const NAT={C:0,D:2,E:4,F:5,G:7,A:9,B:11},DUR=[1,2,3,4,6,8,12,16,24,32,48];
const KEYS={};['Cb','Gb','Db','Ab','Eb','Bb','F','C','G','D','A','E','B','F#','C#'].forEach((x,i)=>KEYS[x]=i-7);['Abm','Ebm','Bbm','Fm','Cm','Gm','Dm','Am','Em','Bm','F#m','C#m','G#m','D#m','A#m'].forEach((x,i)=>KEYS[x]=i-7);
const CHORD=/^[A-G](?:bb|##|b|#)?(?:m\(maj7\)|7sus4|m7b5|maj7|dim7|sus4|sus2|dim|aug|m7|m6|m|7|6)?(?:\/[A-G](?:bb|##|b|#)?)?$/;
const fail=(test,text)=>{if(test)throw Error(text);};
function keyMap(key){fail(!Object.hasOwn(KEYS,key),'不支持的调号：'+key);const map={C:0,D:0,E:0,F:0,G:0,A:0,B:0},n=KEYS[key];for(const x of (n>0?'FCGDAEB':'BEADGCF').slice(0,Math.abs(n)))map[x]=Math.sign(n);return map;}
function meter(text){const m=/^([1-9]\d*)\/([1-9]\d*)$/.exec(text);fail(!m||+m[2]>1024||(+m[2]&(+m[2]-1)),'拍号需要明确分数，如 4/4、6/8');return +m[1]*4/+m[2];}
function stamp(text){let a=2166136261,b=5381;for(let i=0;i<text.length;i++){a=Math.imul(a^text.charCodeAt(i),16777619);b=Math.imul(b,33)^text.charCodeAt(i);}return `${text.length}:${a>>>0}:${b>>>0}`;}
function parse(text){
 fail(typeof text!=='string'||text.length>40000,'乐谱上限为 40000 字符');
 const source=text.replace(/\r\n/g,'\n').trimEnd(),lines=source.split('\n'),offsets=[];let offset=0;for(const line of lines){offsets.push(offset);offset+=line.length+1;}
 fail(lines[0]!=='X:1'||lines[1]!=='T:','当前为通用 ABC。可查看源码；可视化编辑需要 YuE 的 X:1 / T: 空标题格式。');
 fail(!/^M:/.test(lines[2])||!/^L:1\/(\d+)$/.test(lines[3])||!/^Q:1\/4=\d+$/.test(lines[4]),'YuE 乐谱头需要 M、L 和 Q 字段');
 const unit=1/+lines[3].slice(4),den=1/unit,bpm=+lines[4].slice(6),initialMeter=lines[2].slice(2),initialKey=lines[7]?.slice(2);meter(initialMeter);keyMap(initialKey);
 fail(den<1||den>1024||(den&(den-1))||bpm<1||bpm>1000,'乐谱的单位时值或速度无效');
 fail(lines[5]!=='V: Vocal clef=treble name="Vocal Melody" snm="Vocal"'||lines[6]!=='V: Ins clef=treble name="Ins Melody" snm="Inst."'||!lines[7]?.startsWith('K:'),'请保留 YuE 的 Vocal / Ins 声部定义');
 const doc={source,unit,bpm,meter:initialMeter,key:initialKey,lines,offsets,tokens:[],attacks:[],musicLines:[],groups:[],sections:[],errors:[],voices:{}};
 for(const name of ['Vocal','Ins'])doc.voices[name]={name,time:0,bars:[],events:[],key:initialKey,meter:initialMeter,pending:null,keys:[[0,initialKey]]};
 let cursor=8,section='verse';
 while(cursor<lines.length){
  while(cursor<lines.length&&lines[cursor].startsWith('% ')){section=lines[cursor].slice(2).trim();doc.sections.push({name:section,time:doc.voices.Vocal.time});cursor++;}
  fail(cursor>=lines.length,'段落标记后缺少乐谱');const group={section,parts:[]};
  for(const name of ['Vocal','Ins']){
   const voice=doc.voices[name];fail(lines[cursor]!==`V: ${name}`,`第 ${cursor+1} 行需要 V: ${name}`);cursor++;
   while(lines[cursor]?.startsWith('M:')||lines[cursor]?.startsWith('K:')){const field=lines[cursor].slice(0,1),value=lines[cursor].slice(2);if(field==='M'){meter(value);voice.meter=value;}else{keyMap(value);voice.key=value;voice.keys.push([voice.time,value]);}cursor++;}
   const line=lines[cursor];fail(!line||!line.endsWith('|'),`第 ${cursor+1} 行需要以小节线 | 结尾`);
   const lineInfo={line:cursor,voice:name,section,tokens:[],bars:[]};doc.musicLines.push(lineInfo);group.parts.push(lineInfo);
   let localStart=0;
   for(const rawBar of line.slice(0,-1).split('|')){
    const trim=rawBar.trim(),leading=rawBar.length-rawBar.trimStart().length,barStart=offsets[cursor]+localStart;fail(!trim,'不支持空小节或反复小节线，请先在 ABC 中展开');
    const compressed=/^Z([2-4])?$/.exec(trim),count=compressed?+(compressed[1]||1):1,length=meter(voice.meter);
    if(compressed){
     if(voice.pending)doc.errors.push(`${name}：延音进入了整小节休止`);
     const token={kind:'rest',compressed:true,start:barStart+leading,end:barStart+leading+trim.length,raw:trim,voice:name,index:doc.tokens.length,bar:voice.bars.length,onset:voice.time,duration:length*count,midi:null,section,line:cursor};doc.tokens.push(token);lineInfo.tokens.push(token);
     for(let j=0;j<count;j++){const bar={index:voice.bars.length,start:barStart,end:barStart+rawBar.length,time:voice.time,length,meter:voice.meter,key:voice.key,actual:length,tokens:[token]};voice.bars.push(bar);lineInfo.bars.push(bar);voice.time+=length;}
    }else{
     const bar={index:voice.bars.length,start:barStart,end:barStart+rawBar.length,time:voice.time,length,meter:voice.meter,key:voice.key,tokens:[]};let pos=0,elapsed=0,local={};
     while(pos<rawBar.length){
      if(/\s/.test(rawBar[pos])){pos++;continue;}
      const tail=rawBar.slice(pos);let m;
      if((m=/^"([^"\n]*)"/.exec(tail))){fail(!CHORD.test(m[1])||name!=='Vocal','和弦需使用 YuE 支持的和弦符号，并放在 Vocal 声部');const token={kind:'chord',name:m[1],start:barStart+pos,end:barStart+pos+m[0].length,voice:name,onset:voice.time+elapsed,bar:bar.index};bar.tokens.push(token);pos+=m[0].length;continue;}
      if((m=/^\[K:([^\]]+)\]/.exec(tail))){keyMap(m[1]);voice.key=m[1];voice.keys.push([voice.time+elapsed,m[1]]);local={};pos+=m[0].length;continue;}
      m=/^(\^\^|__|\^|_|=)?([A-Ga-gz])([,']*)(\d*)(-?)/.exec(tail);fail(!m,`第 ${cursor+1} 行存在暂不支持的记谱：${tail.slice(0,16)}`);
      const [raw,acc='',note,oct,unitsText,tie]=m,units=+(unitsText||1),duration=units*unit*4;fail(!DUR.includes(units),'不支持的时值 '+units+'，请使用延音拆分');fail(oct.includes(',')&&oct.includes("'"),'八度标记不能混合');
      const token={kind:note==='z'?'rest':'note',start:barStart+pos,end:barStart+pos+raw.length,raw,acc,note,oct,units,duration,tie:!!tie,voice:name,bar:bar.index,onset:voice.time+elapsed,section,line:cursor,index:doc.tokens.length,key:voice.key,midi:null,continuation:!!voice.pending};
      if(note==='z'){fail(acc||oct||tie,'休止符不能带变音、八度或延音');if(voice.pending)doc.errors.push(`${name} 第 ${bar.index+1} 小节：延音不能连接休止符`);voice.pending=null;}
      else{
       const letter=note.toUpperCase(),written=60+NAT[letter]+(note===note.toLowerCase()?12:0)+12*([...oct].filter(x=>x==="'").length-[...oct].filter(x=>x===',').length);let alter=local[letter]??keyMap(voice.key)[letter];
       if(acc){alter={'=':0,'_':-1,'__':-2,'^':1,'^^':2}[acc];local[letter]=alter;}
       let midi=written+alter;if(voice.pending){if(!acc&&written===voice.pending.written)midi=voice.pending.midi;if(midi!==voice.pending.midi)doc.errors.push(`${name} 第 ${bar.index+1} 小节：延音两端音高不同`);}
       fail(midi<0||midi>127,'音高超出 MIDI 范围');Object.assign(token,{written,midi,attack:voice.pending?.attack??doc.attacks.length});
       if(voice.pending){const event=voice.events.at(-1);event.duration+=duration;event.tokens.push(token);}
       else{const event={voice:name,onset:token.onset,midi,duration,tokens:[token],index:doc.attacks.length,section,bar:bar.index};voice.events.push(event);doc.attacks.push(event);}
       voice.pending=tie?{written,midi,attack:token.attack}:null;
      }
      bar.tokens.push(token);doc.tokens.push(token);lineInfo.tokens.push(token);elapsed+=duration;pos+=raw.length;
     }
     bar.actual=elapsed;if(elapsed!==length)doc.errors.push(`${name} 第 ${bar.index+1} 小节：${elapsed} 拍 / 应为 ${length} 拍`);voice.bars.push(bar);lineInfo.bars.push(bar);voice.time+=length;
    }
    localStart+=rawBar.length+1;
   }
   fail(lineInfo.bars.length>4,'每个声部块最多 4 小节，请按 YuE 分组');cursor++;
  }
  if(group.parts[0].bars.length!==group.parts[1].bars.length)doc.errors.push('同一分组的 Vocal / Ins 小节数不一致');doc.groups.push(group);
 }
 for(const voice of Object.values(doc.voices))if(voice.pending)doc.errors.push(voice.name+' 结尾的延音没有后续音符');
 if(JSON.stringify(doc.voices.Vocal.bars.map(b=>[b.time,b.meter]))!==JSON.stringify(doc.voices.Ins.bars.map(b=>[b.time,b.meter])))doc.errors.push('两个声部的拍号或时间网格不一致');
 if(JSON.stringify(doc.voices.Vocal.keys)!==JSON.stringify(doc.voices.Ins.keys))doc.errors.push('两个声部的调号变化时间不一致');
 doc.vocal=doc.voices.Vocal.events;doc.seconds=doc.voices.Vocal.time*60/bpm;return doc;
}
function assertValid(text){const doc=parse(text);fail(doc.errors.length,doc.errors.slice(0,4).join('；'));return doc;}
function patches(text,changes){for(const p of [...changes].sort((a,b)=>b.start-a.start))text=text.slice(0,p.start)+p.text+text.slice(p.end);fail(text.length>40000,'编辑后乐谱超过 40000 字符');return text;}
function pitchText(midi){fail(!Number.isInteger(midi)||midi<0||midi>127,'请选择 MIDI 0–127 范围内的音高');const names=['C','^C','D','^D','E','F','^F','G','^G','A','^A','B'],octave=Math.floor(midi/12)-1;let p=names[midi%12];if(!p.startsWith('^'))p='='+p;if(octave>=5)p=p.toLowerCase()+"'".repeat(octave-5);else if(octave<4)p+=','.repeat(4-octave);return p;}
function explicit(token){if(token.kind!=='note')return token.raw;const a=token.midi-token.written;return ({'-2':'__','-1':'_','0':'=','1':'^','2':'^^'}[a]??'')+token.note+token.oct+(token.units===1?'':token.units)+(token.tie?'-':'');}
function changePitch(doc,index,midi){const chosen=doc.tokens[index];fail(chosen?.kind!=='note','请选择一个音符');return patches(doc.source,doc.tokens.filter(t=>t.kind==='note').map(t=>({start:t.start,end:t.end,text:t.attack===chosen.attack?pitchText(midi)+(t.units===1?'':t.units)+(t.tie?'-':''):explicit(t)})));}
function changeDuration(doc,index,quarters){const t=doc.tokens[index],units=quarters/(doc.unit*4);fail(!t||t.compressed||!DUR.includes(units),'此时值需要拆分或不适用于整小节休止');const prefix=t.kind==='rest'?'z':(t.acc+t.note+t.oct);return patches(doc.source,[{start:t.start,end:t.end,text:prefix+(units===1?'':units)+(t.tie?'-':'')}]);}
function restText(units){fail(!Number.isInteger(units)||units<0,'休止时值无法用当前最小时值表示');const parts=[];for(const n of [...DUR].reverse())while(units>=n){parts.push('z'+(n===1?'':n));units-=n;}return parts.join(' ');}
function editableRest(doc,index){const t=doc.tokens[index];if(!t?.compressed)return {doc,index};const next=parse(expandRest(doc,index));return {doc:next,index:next.tokens.find(n=>n.voice===t.voice&&n.bar===t.bar).index};}
// Preserve the measure and every later onset: shortening leaves rests; lengthening
// consumes only adjacent rests. Never silently delete the following melody.
function resizeDuration(doc,index,quarters){
 ({doc,index}=editableRest(doc,index));const t=doc.tokens[index],units=quarters/(doc.unit*4);
 fail(!t||!DUR.includes(units),'此时值无法用当前乐谱的最小时值表示');
 if(units===t.units)return doc.source;
 fail(t.tie||t.continuation,'请先解除相连的延音，再修改单个音符时值');
 const bar=doc.voices[t.voice].bars[t.bar];fail(bar.actual!==bar.length,'请先在 ABC 源码中修正当前小节拍数');
 const text=(t.kind==='rest'?'z':explicit(t).replace(/\d+$/,''))+(units===1?'':units),changes=[{start:t.start,end:t.end,text}];
 if(units<t.units)changes[0].text+=' '+restText(t.units-units);
 else {let remaining=units-t.units,last=t.end;for(const next of bar.tokens.filter(n=>n.start>t.start)){
   if(!remaining)break;if(next.kind!=='rest'||doc.source.slice(last,next.start).trim())break;
   const used=Math.min(remaining,next.units);changes.push({start:next.start,end:next.end,text:restText(next.units-used)});remaining-=used;last=next.end;
  }fail(remaining>0,'后方休止空间不足：先缩短或删除后面的音符，或用延音连接同音高音符');}
 return preserveNotes(doc,changes);
}
function eraseNote(doc,index){const t=doc.tokens[index];fail(!t,'请先选择音符');if(t.kind==='rest')return doc.source;
 const changes=[{start:t.start,end:t.end,text:restText(t.units)}],previous=doc.tokens.filter(n=>n.voice===t.voice&&n.index<t.index).at(-1);
 if(previous?.tie)changes.push({start:previous.start,end:previous.end,text:explicit(previous).replace(/-$/,'')});return preserveNotes(doc,changes);
}
function writeNote(doc,index,midi=60){({doc,index}=editableRest(doc,index));return restToNote(doc,index,midi);}
function stepPitch(token,steps){fail(token?.kind!=='note','请选择一个音符');const letters='CDEFGAB',natural=[0,2,4,5,7,9,11],step=(Math.floor(token.written/12)-5)*7+letters.indexOf(token.note.toUpperCase())+steps;return 60+12*Math.floor(step/7)+natural[((step%7)+7)%7]+(token.midi-token.written);}
function rebind(previous,next,binding,lyrics){
 if(!validBinding(binding,previous,lyrics))return align(next,lyrics);
 const slots=next.vocal.map(()=>['',lyrics.length,lyrics.length]),byOnset=new Map(previous.vocal.map((n,i)=>[n.onset,i]));
 for(const [i,n] of next.vocal.entries()){const old=byOnset.get(n.onset);if(old!==undefined)slots[i]=[...binding.slots[old]];}
 let anchor=lyrics.length;for(let i=slots.length-1;i>=0;i--){if(slots[i][0])anchor=slots[i][1];else slots[i]=['',anchor,anchor];}
 return {...binding,abcStamp:stamp(next.source),slots,reviewed:false};
}
function preserveNotes(doc,changes){const replaced=new Set(changes.map(c=>c.start));return patches(doc.source,[...doc.tokens.filter(t=>t.kind==='note'&&!replaced.has(t.start)).map(t=>({start:t.start,end:t.end,text:explicit(t)})),...changes]);}
function toRest(doc,index){const t=doc.tokens[index];fail(!t||t.compressed||t.tie||t.continuation,'请先展开休止或解除延音，再改为休止');return preserveNotes(doc,[{start:t.start,end:t.end,text:'z'+(t.units===1?'':t.units)}]);}
function restToNote(doc,index,midi=60){const t=doc.tokens[index];fail(!t||t.kind!=='rest'||t.compressed,'先展开整小节休止，再写入音符');return preserveNotes(doc,[{start:t.start,end:t.end,text:pitchText(midi)+(t.units===1?'':t.units)}]);}
function split(doc,index){const t=doc.tokens[index];fail(!t||t.compressed||t.tie||t.continuation||!DUR.includes(t.units/2),'该音符暂不能再拆分；延音请先解除');const body=t.kind==='rest'?'z':(t.acc+t.note+t.oct);const half=t.units/2;return patches(doc.source,[{start:t.start,end:t.end,text:(body+(half===1?'':half)+' ').repeat(2).trim()}]);}
function toggleTie(doc,index){const t=doc.tokens[index];fail(t?.kind!=='note','请选择需要连接的音符');if(t.tie)return preserveNotes(doc,[{start:t.start,end:t.end,text:explicit(t).replace(/-$/,'')}]);const next=doc.tokens.find(n=>n.voice===t.voice&&n.index>t.index);fail(!next||next.kind!=='note'||next.midi!==t.midi||next.onset!==t.onset+t.duration,'延音只能连接紧邻的同音高音符');return preserveNotes(doc,[{start:t.start,end:t.end,text:explicit(t)+'-'}]);}
function melodySignature(doc){return JSON.stringify({bpm:doc.bpm,voices:['Vocal','Ins'].map(v=>({notes:doc.voices[v].events.map(n=>[n.onset,n.midi,n.duration]),bars:doc.voices[v].bars.map(b=>[b.time,b.meter]),keys:doc.voices[v].keys}))});}
function expandRest(doc,index){const t=doc.tokens[index];fail(!t?.compressed,'请选择整小节休止');const bar=doc.voices[t.voice].bars[t.bar],units=bar.length/(doc.unit*4);fail(!DUR.includes(units),'请在 ABC 中展开该复合时值');return patches(doc.source,[{start:t.start,end:t.end,text:Array(t.duration/bar.length).fill('z'+units).join('|')}]);}
function setChord(doc,index,name){fail(name&&!CHORD.test(name),'和弦格式不受 YuE 支持，如 C、Am7、D7/F#');const t=doc.tokens[index];fail(!t||t.voice!=='Vocal','和弦只能写在人声声部');const bar=doc.voices.Vocal.bars[t.bar],old=bar.tokens.find(x=>x.kind==='chord'&&x.onset===t.onset);return patches(doc.source,[{start:old?.start??t.start,end:old?.end??t.start,text:name?'"'+name+'"':''}]);}
function newScore(bars=4){return 'X:1\nT:\nM:4/4\nL:1/32\nQ:1/4=80\nV: Vocal clef=treble name="Vocal Melody" snm="Vocal"\nV: Ins clef=treble name="Ins Melody" snm="Inst."\nK:C\n% verse\nV: Vocal\n'+Array(bars).fill('z8 z8 z8 z8|').join('')+'\nV: Ins\nZ'+(bars===1?'':bars)+'|';}
function addBar(doc){const v=doc.voices.Vocal,i=doc.voices.Ins;fail(v.key!==i.key||v.meter!==i.meter,'两个声部结尾的调号与拍号需一致');const units=meter(v.meter)/(doc.unit*4);fail(!DUR.includes(units),'请在 ABC 中增加该拍号的小节');return doc.source+'\nV: Vocal\nz'+units+'|\nV: Ins\nZ|';}
function lyricUnits(lyrics){const units=[];let offset=0,line=0,section='verse';for(const raw of lyrics.split('\n')){const tag=/^\s*\[([^\]]+)\]\s*$/.exec(raw);if(tag)section=tag[1];else{const re=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu;let m;while((m=re.exec(raw)))units.push({text:m[0],start:offset+m.index,end:offset+m.index+m[0].length,line,section});}offset+=raw.length+1;line++;}return units;}
function sectionKey(name){const key=String(name).trim().toLowerCase().replace(/\s*\d+\s*$/,'').replace(/[\s_-]/g,'');return ({主歌:'verse',副歌:'chorus',桥段:'bridge',前奏:'intro',尾奏:'outro',间奏:'interlude',refrain:'chorus'})[key]||key;}
function lyricSections(lyrics){
 const units=lyricUnits(lyrics),tags=[...lyrics.matchAll(/^\s*\[([^\]\r\n]+)\][ \t]*$/gm)];
 if(!tags.length)return [{name:'未标记段落',key:null,units}];
 const sections=[];if(units.some(u=>u.start<tags[0].index))sections.push({name:'未标记段落',key:null,units:units.filter(u=>u.start<tags[0].index)});
 for(let i=0;i<tags.length;i++){const start=tags[i].index+tags[i][0].length,end=tags[i+1]?.index??lyrics.length;sections.push({name:tags[i][1].trim(),key:sectionKey(tags[i][1]),start,end,units:units.filter(u=>u.start>=start&&u.start<end)});}
 return sections;
}
function lyricFit(doc,lyrics){
 let sections=lyricSections(lyrics);const named=doc.sections.length>0&&sections.some(s=>s.key),warnings=[];
 const score=doc.sections.map((s,i)=>{const end=doc.sections[i+1]?.time??doc.voices.Vocal.time;return {name:s.name,key:sectionKey(s.name),start:s.time*60/doc.bpm,end:end*60/doc.bpm,noteIndices:doc.vocal.flatMap((n,j)=>n.onset>=s.time&&n.onset<end?[j]:[])};});
 // Native plans can use one unnumbered section for consecutive lyric verses/repeats.
 // Treat that as one span; do not invent a missing section merely from tag counts.
 if(named){const grouped=[];for(const s of sections){const matches=score.filter(v=>v.key===s.key),previous=grouped.at(-1);if(previous?.key===s.key&&matches.length===1&&!/\d+\s*$/.test(matches[0].name)){previous.name+=' / '+s.name;previous.units.push(...s.units);previous.end=s.end;}else grouped.push({...s,units:[...s.units]});}sections=grouped;}
 const used=new Set();let last=-1;
 const matches=sections.map(s=>{
  const index=named?score.findIndex((v,i)=>i>last&&!used.has(i)&&v.key===s.key&&(!/\d+\s*$/.test(v.name)||!/\d+\s*$/.test(s.name)||v.name.match(/\d+\s*$/)[0].trim()===s.name.match(/\d+\s*$/)[0].trim())):-1;
  if(index>=0){used.add(index);last=index;}
  const noteIndices=named?(score[index]?.noteIndices||[]):doc.vocal.map((_n,i)=>i);
  if(named&&s.units.length&&index<0)warnings.push(`${s.name} 有 ${s.units.length} 个歌词单位，但乐谱没有对应的演唱段落`);
  else if(named&&s.units.length&&!noteIndices.length)warnings.push(`${s.name} 有歌词，但对应乐谱没有新的演唱音符`);
  else if(named&&s.units.length>noteIndices.length)warnings.push(`${s.name}：${s.units.length} 个歌词单位 / ${noteIndices.length} 次起音，需检查挤字和分句`);
  return {name:s.name,key:s.key,start:s.start??0,end:s.end??lyrics.length,units:s.units,scoreIndex:index,noteIndices};
 });
 if(named){for(const [i,s] of score.entries())if(!used.has(i)&&s.noteIndices.length){if(['intro','interlude'].includes(s.key))warnings.push(`${s.name} 段有 ${s.noteIndices.length} 次未安排的人声起音，可能包含弱起，需手动核对填词位置`);else warnings.push(`乐谱的 ${s.name} 段有演唱音符，但没有对应歌词`);}}
 return {named,sections:matches,score,warnings,scope:'按段落估计；歌词单位和起音不要求一一相等，不能证明实际演唱逐字对齐'};
}
function align(doc,lyrics){
 const units=lyricUnits(lyrics),fit=lyricFit(doc,lyrics),slots=doc.vocal.map(()=>['',lyrics.length,lyrics.length]);
 if(!fit.named)for(let i=0;i<Math.min(units.length,slots.length);i++)slots[i]=[units[i].text,units[i].start,units[i].end];
 else{
  for(const s of fit.sections){const anchor=s.units.at(-1)?.end??s.start;for(const index of s.noteIndices)slots[index]=['',anchor,anchor];for(let i=0;i<Math.min(s.units.length,s.noteIndices.length);i++){const u=s.units[i];slots[s.noteIndices[i]]=[u.text,u.start,u.end];}}
  // Unmatched leading notes use the following lyric boundary, never a stale EOF anchor.
  let anchor=lyrics.length;for(let i=slots.length-1;i>=0;i--){if(slots[i][0])anchor=slots[i][1];else if(slots[i][1]===lyrics.length)slots[i]=['',anchor,anchor];}
 }
 return {version:1,abcStamp:stamp(doc.source),lyricsStamp:stamp(lyrics),slots,reviewed:false,strategy:fit.named?'section':'sequence'};
}
function validBinding(binding,doc,lyrics){return binding?.version===1&&binding.abcStamp===stamp(doc.source)&&binding.lyricsStamp===stamp(lyrics)&&Array.isArray(binding.slots)&&binding.slots.length===doc.vocal.length&&binding.slots.every(s=>Array.isArray(s)&&typeof s[0]==='string'&&s[0].length<=40&&Number.isInteger(s[1])&&Number.isInteger(s[2])&&s[1]>=0&&s[2]>=s[1]&&s[2]<=lyrics.length&&(s[0]==='_'||lyrics.slice(s[1],s[2])===s[0]));}
function editLyric(doc,lyrics,binding,index,text){fail(!validBinding(binding,doc,lyrics),'歌词或乐谱已变化，请先重新试排');fail(typeof text!=='string'||text.length>40||/[\r\n\[\]]/.test(text),'单个音符填词最多 40 字符且不能含换行或段落标签');const next=JSON.parse(JSON.stringify(binding)),slot=next.slots[index];fail(!slot,'没有选中的人声音符');const start=slot[1],end=slot[2],word=text==='_'?'':text,delta=word.length-(end-start);lyrics=lyrics.slice(0,start)+word+lyrics.slice(end);fail(lyrics.length>12000,'歌词超过长度限制');for(let i=0;i<next.slots.length;i++){const s=next.slots[i];if(i===index)next.slots[i]=[text,start,start+word.length];else if(s[1]>end||(s[1]===end&&(end>start||s[2]>s[1]||i>index))){s[1]+=delta;s[2]+=delta;}}next.lyricsStamp=stamp(lyrics);next.reviewed=false;next.strategy='manual';return {lyrics,binding:next};}
function renderSource(doc,binding,title='',voiceFilter='all',pronunciations=[]){
 const edits=[],renderOffsets=new Map(),vocalIndex=new Map(doc.vocal.map((n,i)=>[n.index,i]));
 const omitted=[];
 if(voiceFilter!=='all'){
  const excluded=voiceFilter==='Vocal'?'Ins':'Vocal';const header=excluded==='Ins'?6:5;omitted.push([doc.offsets[header],doc.offsets[header+1]]);
  for(const line of doc.musicLines.filter(l=>l.voice===excluded)){let begin=line.line-1;while(begin>7&&!doc.lines[begin].startsWith('V:'))begin--;omitted.push([doc.offsets[begin],doc.offsets[line.line]+doc.lines[line.line].length+1]);}
  for(const [start,end] of omitted)edits.push({start,end:Math.min(end,doc.source.length),text:''});
 }
 edits.push({start:doc.offsets[1],end:doc.offsets[1]+2,text:'T:'+title.replace(/[\r\n]/g,' ').slice(0,100)+'\n%%barnumbers 1'});
 const displayState={};
 for(const t of doc.tokens){if(omitted.some(([start,end])=>t.start>=start&&t.start<end))continue;if(t.kind==='note'){
  let state=displayState[t.voice];if(!state||state.bar!==t.bar||state.key!==t.key)state=displayState[t.voice]={bar:t.bar,key:t.key,acc:{}};
  const natural=keyMap(t.key)[t.note.toUpperCase()],expected=state.acc[t.written]??natural,actual=t.midi-t.written;
  const accidental=expected===actual?'':({'-2':'__','-1':'_','0':'=','1':'^','2':'^^'}[actual]||'');if(accidental)state.acc[t.written]=actual;
  edits.push({start:t.start,end:t.end,text:accidental+t.note+t.oct+(t.units===1?'':t.units)+(t.tie?'-':''),token:t});
 }else edits.push({start:t.start,end:t.end,text:t.raw,token:t});}
 for(const [line,voice] of [[5,'Vocal'],[6,'Ins']])if(voiceFilter==='all'||voiceFilter===voice)edits.push({start:doc.offsets[line],end:doc.offsets[line]+doc.lines[line].length,text:`V: ${voice} clef=treble`+(voiceFilter==='all'?` name="${voice==='Vocal'?'人声':'器乐'}"`:'')});
 for(const line of doc.musicLines){if(line.voice==='Vocal'&&binding&&voiceFilter!=='Ins'){const notes=line.tokens.filter(t=>t.kind==='note'),words=notes.map(t=>t.continuation?'*':binding.slots[vocalIndex.get(t.attack)]?.[0]||'*');const escape=w=>w==='_'||w==='*'?w:w.replace(/[-~_*|\\]/g,'').replace(/\s/g,'~');edits.push({start:doc.offsets[line.line]+doc.lines[line.line].length,end:doc.offsets[line.line]+doc.lines[line.line].length,text:'\nw:'+words.map(escape).join(' ')});}}
 let text='',at=0;for(const edit of edits.sort((a,b)=>a.start-b.start)){text+=doc.source.slice(at,edit.start);if(edit.token)renderOffsets.set(text.length,edit.token);text+=edit.text;at=edit.end;}text+=doc.source.slice(at);
 return {text,renderOffsets};
}
function events(doc,voice='all'){return (voice==='all'?doc.attacks:doc.voices[voice].events).map(n=>({midi:n.midi,onset:n.onset*60/doc.bpm,duration:n.duration*60/doc.bpm,voice:n.voice,index:n.index})).sort((a,b)=>a.onset-b.onset);}
function midi(doc){fail(doc.errors.length,'请先修正小节拍数再导出 MIDI');const ppq=1024,bytes=[],ascii=s=>[...s].map(x=>x.charCodeAt(0)),u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255],vlq=n=>{let b=[n&127];while(n>>=7)b.unshift((n&127)|128);return b;};
 const tempo=Math.round(60000000/doc.bpm),tracks=[];
 for(const [channel,name] of ['Vocal','Ins'].entries()){const seq=[{tick:0,order:0,data:[0xc0+channel,0]}];if(channel===0)seq.push({tick:0,order:0,data:[255,81,3,...u32(tempo).slice(1)]});for(const n of doc.voices[name].events){seq.push({tick:Math.round(n.onset*ppq),order:2,data:[0x90+channel,n.midi,88]},{tick:Math.round((n.onset+n.duration)*ppq),order:1,data:[0x80+channel,n.midi,0]});}seq.sort((a,b)=>a.tick-b.tick||a.order-b.order);let tick=0,data=[];for(const e of seq){data.push(...vlq(e.tick-tick),...e.data);tick=e.tick;}data.push(0,255,47,0);tracks.push([...ascii('MTrk'),...u32(data.length),...data]);}
 bytes.push(...ascii('MThd'),0,0,0,6,0,1,0,2,4,0);for(const track of tracks)bytes.push(...track);return Uint8Array.from(bytes);
}
return {parse,assertValid,stamp,patches,pitchText,changePitch,changeDuration,resizeDuration,eraseNote,writeNote,stepPitch,rebind,toRest,restToNote,split,toggleTie,melodySignature,expandRest,setChord,newScore,addBar,lyricUnits,lyricSections,lyricFit,align,validBinding,editLyric,renderSource,events,midi,KEYS,DUR};
});
