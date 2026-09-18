(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./score-model.js'),require('./vendor/pinyin-pro-3.29.4.js'));else root.Pronunciation=factory(root.ScoreModel,root.pinyinPro);})(typeof globalThis!=='undefined'?globalThis:this,(S,P)=>{
'use strict';
const han=s=>typeof s==='string'&&/^\p{Script=Han}$/u.test(s),cache=new Map();
function readings(char){if(!han(char))return [];if(!cache.has(char)){const num=P.polyphonic(char,{toneType:'num',type:'array'})[0]||[],symbol=P.polyphonic(char,{type:'array'})[0]||[];cache.set(char,num.filter(p=>/^[a-zü]+[0-4]$/u.test(p)).map((id,i)=>({id,label:symbol[i]||id})));}return cache.get(char);}
function empty(lyrics){return {version:1,lyricsStamp:S.stamp(lyrics),entries:[]};}
function validate(value,lyrics){
 if(value===undefined||value===null)return empty(lyrics);
 if(value.version!==1||value.lyricsStamp!==S.stamp(lyrics)||!Array.isArray(value.entries)||value.entries.length>2000)throw Error('读音标注与当前歌词不匹配，请重新确认');
 const seen=new Set(),units=new Set(S.lyricUnits(lyrics).map(u=>u.start)),entries=value.entries.map(e=>{
  if(!e||!Number.isSafeInteger(e.start)||!Number.isSafeInteger(e.end)||e.start<0||!han(e.text)||e.end!==e.start+e.text.length||lyrics.slice(e.start,e.end)!==e.text||!units.has(e.start)||seen.has(e.start)||!readings(e.text).some(p=>p.id===e.pinyin)||typeof e.guide!=='boolean')throw Error('无效的歌词读音标注');
  seen.add(e.start);const replacement=e.replacement||'';
  if(typeof replacement!=='string'||(replacement&&(!han(replacement)||replacement===e.text||readings(replacement).length!==1||readings(replacement)[0].id!==e.pinyin)))throw Error('引导字须是同声调、单一读音的汉字');
  if(e.guide&&!replacement)throw Error('启用发音引导前，请确认一个同音引导字');
  return {start:e.start,end:e.end,text:e.text,pinyin:e.pinyin,replacement,guide:e.guide};
 }).sort((a,b)=>a.start-b.start);
 return {...empty(lyrics),entries};
}
function rebase(previous,next,value){
 let old;try{old=validate(value,previous);}catch{return empty(next);}if(previous===next)return old;
 if(previous.trim()===next.trim()){
  const delta=(next.length-next.trimStart().length)-(previous.length-previous.trimStart().length);
  return validate({...empty(next),entries:old.entries.map(e=>({...e,start:e.start+delta,end:e.end+delta}))},next);
 }
 let prefix=0,suffix=0;while(prefix<Math.min(previous.length,next.length)&&previous[prefix]===next[prefix])prefix++;
 while(suffix<previous.length-prefix&&suffix<next.length-prefix&&previous[previous.length-1-suffix]===next[next.length-1-suffix])suffix++;
 const delta=next.length-previous.length,entries=old.entries.flatMap(e=>e.end<=prefix?[e]:e.start>=previous.length-suffix?[{...e,start:e.start+delta,end:e.end+delta}]:[]);
 try{return validate({...empty(next),entries},next);}catch{return empty(next);}
}
function set(value,lyrics,entry){const old=validate(value,lyrics);return validate({...old,entries:[...old.entries.filter(e=>e.start!==entry.start),entry]},lyrics);}
function remove(value,lyrics,start){const old=validate(value,lyrics);return {...old,entries:old.entries.filter(e=>e.start!==start)};}
function generationLyrics(lyrics,value){const clean=validate(value,lyrics);let text=lyrics;for(const e of clean.entries.toReversed())if(e.guide)text=text.slice(0,e.start)+e.replacement+text.slice(e.end);return text;}
function labels(binding,value){const entries=value?.entries||[];return (binding?.slots||[]).map(s=>s[0]&&s[0]!=='_'?entries.filter(e=>e.start>=s[1]&&e.end<=s[2]).map(e=>readings(e.text).find(p=>p.id===e.pinyin)?.label||'').filter(Boolean).join(' '):'');}
const preferred='叻涝掌常月悦型航崇众孩环丹善禅百博报缝奉数树属撒厦厦藏臧朝赵曾增都豆得德地帝为维未藏脏脏乐落老师使诗试节结接洁借教交觉脚角较贾假价咽燕颜厌要摇药乐勒凉量亮良绿路录露六流留溜奇棋其骑技济计挤及继强墙抢降江将疆匠疆解写邪谢协鞋学穴雪血好豪号浩薄宝保抱饱暴仇求球秋臭休宿素苏速缩座坐做作着召招沼找卓拙浊祢泥拟逆尼宁凝拧令零凌灵了聊疗辽料镣句居拘据聚拘给己即计绮衣宜以义壹亿音银引印应迎影硬恩儿而耳二于宇雨遇玉语羽与王往忘望王亡乐留溜耕更梗庚平评屏瓶行醒幸兴杏亨衡恒哼'.split('');
function suggest(char,pinyin){return preferred.find(c=>c!==char&&readings(c).length===1&&readings(c)[0].id===pinyin)||'';}
return {empty,validate,rebase,set,remove,readings,generationLyrics,labels,suggest};
});
