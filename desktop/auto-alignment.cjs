'use strict';
const fs=require('node:fs'),path=require('node:path');
// Only new songs (or interrupted automatic analyses) are scheduled. Existing
// completed works keep their saved corrections and caches until played.
class AutoAlignment {
 constructor(store,timing){this.store=store;this.timing=timing;this.pending=new Map();this.closed=false;this.listener=job=>{if(this.eligible(job)&&!job.alignment)this.schedule(job);};store.on('change',this.listener);for(const job of store.jobs)if(this.eligible(job)&&['queued','running'].includes(job.alignment?.status))this.schedule(job);}
 eligible(job){return job?.status==='completed'&&!['transcribe','lyrics','music-style','voice'].includes(job.request?.kind);}
 schedule(job){
  if(this.closed||this.pending.has(job.id))return;
  if(!fs.existsSync(path.join(this.store.directory(job.id),'artifacts','score.abc'))){this.store.update(job.id,{alignment:{status:'unavailable',message:'本次生成未附带乐谱'}});return;}
  const work=Promise.resolve().then(async()=>{
   if(this.closed)return;this.update(job.id,{status:'running',message:'正在自动对齐乐谱'});
   try{const value=await this.timing.get(job.id),a=value.analysis;this.update(job.id,{status:a?.accepted?'ready':'review',message:a?.accepted?'乐谱已自动对齐':value.error||'自动对齐完成，部分位置需试听核对',words:a?.events?.length||0,totalWords:a?.totalWords||0,key:value.key,finishedAt:new Date().toISOString()});}
   catch(error){this.update(job.id,{status:'review',message:'自动对齐未完成：'+error.message});}
  }).finally(()=>this.pending.delete(job.id));
  this.pending.set(job.id,work);this.store.update(job.id,{alignment:{status:'queued',message:'等待自动对齐乐谱'}});
 }
 update(id,alignment){if(this.closed)return;try{const job=this.store.get(id);if(job.status==='completed')this.store.update(id,{alignment});}catch{/* A deleted work must never be recreated by a late result. */}}
 dispose(){this.closed=true;this.store.off('change',this.listener);}
}
module.exports={AutoAlignment};
