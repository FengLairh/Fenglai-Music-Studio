(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.ScoreTiming=factory();})(typeof globalThis!=='undefined'?globalThis:this,()=>{
 'use strict';
 function validate(points,limit=10000){return Array.isArray(points)&&points.length<=limit&&points.every((p,i)=>Array.isArray(p)&&p.length===2&&p.every(n=>Number.isFinite(n)&&n>=0&&n<=1200)&&(!i||p[0]>points[i-1][0]&&p[1]>points[i-1][1]));}
 function validEvents(result,tokenCount=100000){
  if(result?.method!=='qwen3-forced-aligner')return true;
  return Number.isFinite(result.audioSeconds)&&Array.isArray(result.events)&&result.events.length<=3000&&result.events.every((e,i)=>
   [e.start,e.end,e.scoreStart,e.scoreEnd].every(t=>Number.isFinite(t)&&t>=0&&t<=1200)&&e.end>e.start&&e.end<=result.audioSeconds&&e.scoreEnd>e.scoreStart&&
   Array.isArray(e.tokens)&&e.tokens.length>0&&e.tokens.every(t=>Number.isInteger(t)&&t>=0&&t<tokenCount)&&typeof e.text==='string'&&e.text.length<=80&&
   (!i||e.start>=result.events[i-1].end-.001&&e.scoreStart>result.events[i-1].scoreStart));
 }
 function wordAt(result,seconds){
  if(!result?.accepted||result.method!=='qwen3-forced-aligner')return null;
  const events=result.events;let lo=0,hi=events.length;
  while(lo<hi){const mid=(lo+hi)>>1;if(events[mid].start<=seconds)lo=mid+1;else hi=mid;}
  const event=events[lo-1];return event&&seconds<event.end?event:null;
 }
 function interpolate(points,value,axis=0){
  if(!points.length)return value;const other=1-axis;
  if(value<=points[0][axis])return points[0][other]+value-points[0][axis];
  const end=points.at(-1);if(value>=end[axis])return end[other]+value-end[axis];
  let lo=0,hi=points.length-1;while(hi-lo>1){const mid=(lo+hi)>>1;if(points[mid][axis]<=value)lo=mid;else hi=mid;}
  const a=points[lo],b=points[hi];return a[other]+(value-a[axis])*(b[other]-a[other])/(b[axis]-a[axis]);
 }
 function map(result,anchors=[]){
  const base=result?.accepted&&validate(result.points)&&result.points.length>1?result.points:[];
  if(!validate(anchors,100))throw Error('校正点必须按播放时间和乐谱顺序向前排列');
  if(!anchors.length)return {points:base,toScore:t=>Math.max(0,interpolate(base,t)),toAudio:t=>Math.max(0,interpolate(base,t,1))};
  const corrections=anchors.map(([a,s])=>[interpolate(base,a),s]);
  const toScore=t=>Math.max(0,interpolate(corrections,interpolate(base,t)));
  const toAudio=t=>Math.max(0,interpolate(base,interpolate(corrections,t,1),1));
  return {points:base,toScore,toAudio};
 }
 function insert(anchors,audio,score){const next=anchors.filter(p=>Math.abs(p[0]-audio)>.12);next.push([audio,score]);next.sort((a,b)=>a[0]-b[0]);if(!validate(next,100))throw Error('校正点顺序冲突，请先移除后面的校正点');return next;}
 return {validate,validEvents,wordAt,interpolate,map,insert};
});
