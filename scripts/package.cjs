const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const crypto=require('node:crypto');
const {Runtime}=require('../desktop/runtime.cjs');
const {Cover}=require('../desktop/cover.cjs');
const {Voice}=require('../desktop/voice.cjs');
const {copyTree}=require('./copy-tree.cjs');
const root=path.resolve(__dirname,'..');
const version=require('../package.json').version;
const build=path.join(root,'release',version,'win-unpacked');
const offline=process.argv.includes('--offline');
const stageOnly=process.argv.includes('--stage-only');
const archiveOnly=process.argv.includes('--archive-only');
if((stageOnly||archiveOnly)&&!offline) throw new Error('Staging options require --offline');
const revision=process.argv.find(a=>a.startsWith('--revision='))?.slice(11)||'';
if(revision&&!/^[a-zA-Z0-9-]{1,24}$/.test(revision)) throw new Error('Invalid build revision');
const output=path.join(root,'release',`YuE-Studio-${version}-win-x64${offline?'-offline':''}${revision?'-'+revision:''}.zip`);
async function main(){
  if(!fs.existsSync(path.join(build,'YuE Studio.exe'))) throw new Error('先运行 npm run dist');
  if(fs.existsSync(output)) throw new Error(`保留已有版本，请先将旧包改名再打包：${output}`);
  if(offline){
    const runtime=new Runtime(root,archiveOnly?path.join(build,'data'):path.join(root,'data'));
    const cover=new Cover(runtime);
    const voice=new Voice(runtime,cover);
    if(!runtime.installed() || runtime.modelStatus().some(m=>!m.ready)) throw new Error('环境或模型尚未完整准备，无法制作离线包');
    if(!cover.status().ready) throw new Error('Cover 环境或模型未准备，无法制作完整离线包');
    if(!voice.status().ready) throw new Error('音色替换环境或模型未准备，无法制作完整离线包');
    const probe=await runtime.probe(); if(!probe.kernelTest) throw new Error('CUDA 诊断未通过');
    const coverProbe=await cover.bridge('probe'); if(!coverProbe.kernelTest) throw new Error('Cover CUDA 诊断未通过');
    const voiceProbe=await voice.bridge('probe'); if(!voiceProbe.kernelTest || voiceProbe.visibleGpuCount!==1) throw new Error('音色转换单卡诊断未通过');
    for(const lock of ['models.lock.json','cover-models.lock.json','voice-models.lock.json']) {
      const check=spawnSync(runtime.python,['-c','import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from model_files import verify_files;root=Path(sys.argv[2]);lock=json.loads(Path(sys.argv[3]).read_text(encoding="utf-8"));[verify_files(root/"models"/m["name"],m) for m in lock["models"]]',path.join(root,'backend'),runtime.root,path.join(root,lock)],{stdio:'inherit',windowsHide:true});
      if(check.status!==0) throw new Error('模型哈希校验失败');
    }
    // uv's version-alias junctions point at the absolute development path. The app uses the full pinned Python directory.
    if(!archiveOnly) for(const name of ['runtime','cover-runtime','voice-runtime']) copyTree(path.join(runtime.root,name),path.join(build,'data',name),source=>!source.split(path.sep).includes('.cache')&&!source.endsWith('.pyc')&&!source.endsWith('__pycache__'),{skipLinks:true});
    if(!archiveOnly) for(const model of [...runtime.lock.models,...cover.lock.models,...voice.lock.models]) for(const file of [...model.files,'.ready.json']) {
      const target=path.join(build,'data','models',model.name,file);fs.mkdirSync(path.dirname(target),{recursive:true});
      fs.copyFileSync(path.join(runtime.root,'models',model.name,file),target);
    }
  }else if(fs.existsSync(path.join(build,'data'))) throw new Error('构建目录含有运行数据，请使用新的构建目录制作联网版，避免包含用户数据');
  fs.copyFileSync(path.join(root,'README.md'),path.join(build,'使用说明.md'));
  fs.writeFileSync(path.join(build,'启动 YuE Studio.cmd'),'@echo off\r\ncd /d "%~dp0"\r\nset "ELECTRON_RUN_AS_NODE="\r\nstart "" "%~dp0YuE Studio.exe"\r\n','utf8');
  if(stageOnly){console.log(`离线目录已准备：${build}`);return;}
  const seven=require('7zip-bin').path7za;
  const child=spawnSync(seven,['a','-tzip','-mx=1',output,'.','-xr!__pycache__','-xr!*.pyc',
    '-x!data/assistant/*','-x!data/cache/*','-x!data/desktop/*','-x!data/songs/*','-x!data/sources/*',
    '-x!data/draft.json','-x!data/cover-draft.json','-x!data/voice-draft.json','-x!data/settings.json','-x!data/runtime.log'],{cwd:build,stdio:'inherit',windowsHide:true});
  if(child.status!==0) throw new Error('压缩失败');
  const verify=spawnSync(seven,['t',output],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});
  if(verify.status!==0) throw new Error('ZIP 完整性校验失败');
  console.log(verify.stdout);
  const listing=spawnSync(seven,['l','-slt',output],{encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024});
  if(listing.status!==0) throw new Error('无法校验 ZIP 文件清单');
  const entries=[...listing.stdout.matchAll(/^Path = (.+)$/gm)].map(match=>match[1].trim().replaceAll('\\','/'));
  if(entries.some(entry=>/^data\/(songs|sources|cache|desktop|assistant)\/.+/.test(entry)||/^data\/(draft\.json|cover-draft\.json|voice-draft\.json|settings\.json|runtime\.log)$/.test(entry))) throw new Error('ZIP 含有用户音频、草稿或缓存，拒绝交付');
  const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(output)) hash.update(chunk);
  const sha256=hash.digest('hex');
  fs.writeFileSync(`${output}.sha256`,`${sha256}  ${path.basename(output)}\n`);
  const manifest={version,artifact:path.basename(output),bytes:fs.statSync(output).size,sha256,
    archiveIntegrity:'7-Zip test passed; user audio, reference recordings, drafts and caches excluded',
    files:Number(verify.stdout.match(/^Files: (\d+)/m)?.[1]),unpackedBytes:Number(verify.stdout.match(/^Size: +(\d+)/m)?.[1]),
    contains:offline?['desktop app','three standalone Python and CUDA runtimes','FFmpeg',...['models.lock.json','cover-models.lock.json','voice-models.lock.json'].flatMap(file=>JSON.parse(fs.readFileSync(path.join(root,file),'utf8')).models.map(model=>model.name)),'licenses']:['desktop app','installers','licenses'],
    gpuPolicy:{visibleDevices:1,stages:'serial, same GPU'},source:'../README.md',localStart:'../启动 YuE Studio.cmd',published:false};
  const current=path.join(root,'release/RELEASE.json');
  if(fs.existsSync(current)){const previous=JSON.parse(fs.readFileSync(current,'utf8'));if(/^\d+\.\d+\.\d+$/.test(previous.version)&&previous.version!==version){const saved=path.join(root,'release',`RELEASE-${previous.version}.json`);if(!fs.existsSync(saved))fs.copyFileSync(current,saved);}}
  fs.writeFileSync(path.join(root,'release',`RELEASE-${version}.json`),JSON.stringify(manifest,null,2)+'\n');
  fs.writeFileSync(current,JSON.stringify(manifest,null,2)+'\n');
  console.log(output);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
