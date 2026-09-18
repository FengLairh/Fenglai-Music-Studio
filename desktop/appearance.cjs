'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {readJSON,writeJSON}=require('./core.cjs');
const DEFAULTS=Object.freeze({theme:'classic',accent:'#d4edaa',overlay:72,blur:4,background:null});
function normalize(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('无效的主题设置');
 const {theme,accent,overlay,blur}=input;
 if(!['classic','dark','light'].includes(theme)||!/^#[\da-f]{6}$/i.test(accent))throw Error('请选择有效的主题和颜色');
 if(typeof overlay!=='number'||!Number.isFinite(overlay)||overlay<35||overlay>95||typeof blur!=='number'||!Number.isFinite(blur)||blur<0||blur>24)throw Error('背景参数超出范围');
 return {theme,accent:accent.toLowerCase(),overlay,blur};
}
class Appearance{
 constructor(root,nativeImage){this.root=root;this.nativeImage=nativeImage;this.file=path.join(root,'appearance.json');}
 read(){const raw=readJSON(this.file,DEFAULTS);try{return {...normalize(raw),background:/^[a-f0-9]{64}\.jpg$/.test(raw.background||'')?raw.background:null};}catch{return {...DEFAULTS};}}
 status(){const value=this.read();let image=null;if(value.background)try{const data=fs.readFileSync(path.join(this.root,'appearance',value.background));if(data.length<=20*1024*1024)image='data:image/jpeg;base64,'+data.toString('base64');}catch{}return {...value,hasBackground:!!image,image};}
 save(input){writeJSON(this.file,{...normalize(input),background:this.read().background});return this.status();}
 importFile(file){
  if(!/\.(png|jpe?g|webp)$/i.test(file)||fs.statSync(file).size>20*1024*1024)throw Error('请选择 20MB 以内的 PNG、JPG 或 WebP 图片');
  const buffer=fs.readFileSync(file),png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=buffer[0]===255&&buffer[1]===216&&buffer[2]===255,webp=buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';
  if(!png&&!jpg&&!webp)throw Error('文件不是支持的图片格式');
  let image=this.nativeImage.createFromBuffer(buffer);const size=image.getSize();if(image.isEmpty()||!size.width||!size.height||size.width*size.height>60000000)throw Error('图片无法读取或尺寸过大');
  if(Math.max(size.width,size.height)>2560)image=image.resize(size.width>=size.height?{width:2560}:{height:2560});
  const data=image.toJPEG(90),name=crypto.createHash('sha256').update(data).digest('hex')+'.jpg',dir=path.join(this.root,'appearance');
  fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,name),data);writeJSON(this.file,{...this.read(),background:name});return this.status();
 }
 remove(){writeJSON(this.file,{...this.read(),background:null});return this.status();}
}
module.exports={Appearance,normalize,DEFAULTS};
