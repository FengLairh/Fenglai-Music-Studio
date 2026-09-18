const path=require('node:path');
const {spawn}=require('node:child_process');
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const root=path.resolve(__dirname,'..');
env.ELECTRON_CACHE=path.join(root,'.cache','electron');
const child=spawn(require('electron'),[root],{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('close',code=>process.exitCode=code||0);
