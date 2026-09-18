'use strict';
const {app, BrowserWindow, ipcMain, dialog, shell, protocol, net, safeStorage, nativeImage, nativeTheme} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {JobStore, JobQueue, readJSON, writeJSON, validId} = require('./core.cjs');
const {Runtime} = require('./runtime.cjs');
const {Cover} = require('./cover.cjs');
const {Voice} = require('./voice.cjs');
const {MusicAssistant, CredentialVault} = require('./music-assistant.cjs');
const {HistoryDeletion} = require('./history-deletion.cjs');
const {Lyrics} = require('./lyrics.cjs');
const {MusicStyle}=require('./music-style.cjs');
const {VoicePresets} = require('./voice-presets.cjs');
const {Appearance}=require('./appearance.cjs');
const ScoreModel=require('../ui/score-model.js');
const {audioResponse}=require('./audio-response.cjs');
const {ScoreTiming}=require('./score-timing.cjs');
const {AutoAlignment}=require('./auto-alignment.cjs');

// Reserve GPU memory for music inference; the editor itself does not need GPU compositing.
app.disableHardwareAcceleration();
app.setName('Fenglai音乐工作台');
app.setAppUserModelId('studio.yue.desktop');

protocol.registerSchemesAsPrivileged([{scheme: 'yue-audio', privileges: {standard: true, secure: true, supportFetchAPI: true, stream: true}}]);
const resources = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '..');
const base = app.isPackaged ? path.dirname(process.execPath) : resources;
const root = path.resolve(process.env.YUE_DATA_DIR || path.join(base, 'data'));
// Keep Chromium cache on the same drive as the portable application.
app.setPath('userData', path.join(root, 'desktop'));
app.setPath('sessionData', path.join(root, 'desktop'));
let window, runtime, store, queue, cover, voice, assistant, lyrics, voicePresets, scoreTiming, musicStyle,autoAlignment;
const page = pathToFileURL(path.join(resources, app.isPackaged ? 'app.asar/ui/index.html' : 'ui/index.html')).href;
const notify = value => {if (window && !window.isDestroyed()) window.webContents.send('changed', value);};

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {if (window) {if (window.isMinimized()) window.restore(); window.show(); window.focus();}});
  app.whenReady().then(() => {
    fs.mkdirSync(root, {recursive: true});
    runtime = new Runtime(resources, root); store = new JobStore(path.join(root, 'songs'));
    cover = new Cover(runtime);
    voice = new Voice(runtime, cover);
    voicePresets = new VoicePresets(runtime, cover);
    lyrics = new Lyrics(runtime, cover, voice);
    musicStyle=new MusicStyle(runtime,cover,lyrics);
    scoreTiming=new ScoreTiming({store,cover,lyrics,root,resources});
    autoAlignment=new AutoAlignment(store,scoreTiming);
    assistant = new MusicAssistant(resources, root,
      new CredentialVault(path.join(app.getPath('appData'), 'YuE Studio', 'credentials', crypto.createHash('sha256').update(root.toLowerCase()).digest('hex'), 'deepseek-key.bin'), safeStorage),
      {progress: event => {if(window&&!window.isDestroyed())window.webContents.send('assistant-progress',event);}});
    queue = new JobQueue(store, async (job, signal) => {await runtime.ensureGpu();if(signal.aborted)throw Error('任务已取消');return job.request.kind === 'music-style' ? musicStyle.analyze(store,job,signal) : job.request.kind === 'lyrics' ? lyrics.recognize(store, job, signal) : job.request.kind === 'voice' ? voice.convert(store, job, signal) : job.request.kind === 'transcribe' ? cover.transcribe(store, job, signal) : runtime.generate(store, job, signal);});
    runtime.isGpuBusy=()=>!!queue.active||store.jobs.some(j=>['running','queued'].includes(j.status))||cover.importing;
    store.on('change', () => notify({kind: 'jobs'}));
    runtime.on('change', () => notify({kind: 'runtime'}));
    runtime.on('log', text => {if (window && !window.isDestroyed()) window.webContents.send('log', text);});
    protocol.handle('yue-audio', request => {
      try {
        const url = new URL(request.url); const id = validId(url.hostname);
        let file;
        if (url.pathname === '/original.wav') {cover.source(id); file = cover.sourceAudio(id);}
        else {
          const job = store.get(id);
          if (job.status !== 'completed') return new Response('Not found', {status: 404});
          if (url.pathname === '/source.wav' && ['transcribe', 'voice', 'lyrics'].includes(job.request.kind)) file = path.join(store.directory(id), 'artifacts', 'source.wav');
          else if (job.request.kind === 'voice' && ['/converted-vocals.wav', '/instrumental.wav', '/reference-vocals.wav'].includes(url.pathname)) file = path.join(store.directory(id), 'artifacts', url.pathname.slice(1));
          else if (url.pathname === '/audio.flac' && !['transcribe','lyrics','music-style'].includes(job.request.kind)) file = path.join(store.directory(id), 'artifacts', 'audio.flac');
          else return new Response('Not found', {status: 404});
        }
        return audioResponse(file,request);
      } catch {return new Response('Not found', {status: 404});}
    });
    const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame?.url !== page) throw new Error('不受信任的请求来源');
      return fn(...args);
    });
    handle('status', async () => ({...await runtime.status(), cover: cover.status(), voice: voice.status(), lyrics: lyrics.status(), musicStyle:musicStyle.status(), voiceDesign: voicePresets.status(),scoreTiming:scoreTiming.status()}));
    const appearance=new Appearance(root,nativeImage);
    const syncNativeTheme=value=>{nativeTheme.themeSource=value.theme==='light'?'light':'dark';window?.setBackgroundColor({light:'#f4f5f7',dark:'#111b2a',classic:'#141619'}[value.theme]);return value;};
    syncNativeTheme(appearance.read());
    handle('appearance-get',()=>appearance.status());
    handle('appearance-save',input=>syncNativeTheme(appearance.save(input)));
    handle('appearance-remove',()=>appearance.remove());
    handle('appearance-import',async()=>{const pick=await dialog.showOpenDialog(window,{title:'选择界面背景图',properties:['openFile'],filters:[{name:'背景图片',extensions:['png','jpg','jpeg','webp']}]});return pick.canceled?null:appearance.importFile(pick.filePaths[0]);});
    handle('audio-waveform',async input=>{
      if(!input||!['source','job'].includes(input.kind))throw Error('无效的音频来源');const id=validId(input.id);let file;
      if(input.kind==='source'){cover.source(id);file=cover.sourceAudio(id);}
      else {const job=store.get(id);if(job.status!=='completed'||['transcribe','lyrics','music-style'].includes(job.request.kind))throw Error('该任务没有可播放的音频');file=path.join(store.directory(id),'artifacts','audio.flac');}
      return cover.bridge('waveform',['--source',file]);
    });
    handle('voice-presets', () => voicePresets.list());
    handle('voice-preset-source', id => {const source=voicePresets.source(id);notify({kind:'sources'});return source;});
    handle('voice-design-create', async input => {if(queue.active||cover.importing||runtime.operation||runtime.probing)throw Error('请等待当前音频任务完成后设计音色');const source=await voicePresets.create(input);notify({kind:'sources'});return source;});
    handle('get-timbre-draft', () => readJSON(path.join(root,'timbre-draft.json'),null));
    handle('save-timbre-draft', input => {
      if(!input||!['arrange','reference','timbre'].includes(input.mode)||typeof input.preset!=='string'||input.preset.length>40||typeof input.instruct!=='string'||input.instruct.length>500)throw Error('无效的翻唱草稿');
      writeJSON(path.join(root,'timbre-draft.json'),{mode:input.mode,preset:input.preset,instruct:input.instruct});
    });
    handle('assistant-status', () => assistant.status());
    handle('assistant-configure', input => assistant.configure(input));
    handle('assistant-remove-key', () => assistant.removeKey());
    handle('assistant-test', () => assistant.test());
    handle('assistant-compose', input => assistant.compose(input));
    handle('assistant-cancel', () => assistant.cancel());
    const deletion = new HistoryDeletion({store, assistant, trash: file => shell.trashItem(file),
      confirm: async options => (await dialog.showMessageBox(window, {...options, type: 'question', buttons: ['取消', '移到回收站'], defaultId: 0, cancelId: 0, noLink: true})).response === 1});
    handle('delete-job', id => deletion.job(id));
    handle('assistant-delete-record', id => deletion.suggestion(id));
    handle('assistant-history', () => assistant.history());
    handle('assistant-skill', () => assistant.skill.read('SKILL.md'));
    handle('source-waveform', id => {cover.source(id);return cover.bridge('waveform',['--source',cover.sourceAudio(id)]);});
    handle('score-import-edited', async () => {
      const {canceled,filePaths}=await dialog.showOpenDialog(window,{properties:['openFile'],filters:[{name:'YuE ABC 乐谱',extensions:['abc','txt']}]});
      if(canceled)return null;
      const file=filePaths[0];if(fs.statSync(file).size>160000)throw Error('乐谱文件超过 160KB');
      const abc=fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''),doc=ScoreModel.assertValid(abc),result={abc:doc.source},sidecar=file+'.lyrics.json';
      if(fs.existsSync(sidecar))try{
        if(fs.statSync(sidecar).size>256000)throw Error('填词文件过大');
        const saved=JSON.parse(fs.readFileSync(sidecar,'utf8'));
        if(typeof saved.lyrics!=='string'||saved.lyrics.length>12000||!ScoreModel.validBinding(saved.binding,doc,saved.lyrics))throw Error('填词数据与乐谱不匹配');
        result.lyrics=saved.lyrics;result.binding=saved.binding;
        if(saved.pronunciation)result.pronunciation=require('../ui/pronunciation.js').validate(saved.pronunciation,saved.lyrics);
        if(typeof saved.title==='string')result.title=saved.title.slice(0,100);
      }catch{result.warning='乐谱已导入，但配套填词文件不匹配；保留当前歌词重新试排。';}
      return result;
    });
    handle('score-export-edited', async input => {
      if(!input||!['abc','midi','svg','pdf'].includes(input.format)||typeof input.lyrics!=='string'||input.lyrics.length>12000)throw Error('无效的乐谱导出请求');
      const doc=ScoreModel.assertValid(input.abc),title=String(input.title||'乐谱').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80),ext=input.format==='midi'?'mid':input.format;
      if(input.format==='svg'&&(typeof input.svg!=='string'||input.svg.length>6000000||!input.svg.trim().startsWith('<svg')||/<(?:script|foreignObject|image|use)\b|\bon\w+\s*=|(?:href|src)\s*=/i.test(input.svg)))throw Error('乐谱 SVG 内容无效');
      const {canceled,filePath}=await dialog.showSaveDialog(window,{defaultPath:path.join(app.getPath('downloads'),title+'.'+ext),filters:[{name:ext.toUpperCase(),extensions:[ext]}]});if(canceled)return false;
      if(input.format==='abc'){const pronunciation=require('../ui/pronunciation.js').validate(input.pronunciation,input.lyrics);fs.writeFileSync(filePath,doc.source,'utf8');if(ScoreModel.validBinding(input.binding,doc,input.lyrics))writeJSON(filePath+'.lyrics.json',{title:input.title,lyrics:input.lyrics,binding:input.binding,pronunciation});}
      else if(input.format==='midi')fs.writeFileSync(filePath,ScoreModel.midi(doc));
      else if(input.format==='svg')fs.writeFileSync(filePath,input.svg,'utf8');
      else fs.writeFileSync(filePath,await window.webContents.printToPDF({printBackground:false,preferCSSPageSize:true}));
      return true;
    });
    handle('diagnose', () => {if (runtime.operation || queue.active) throw new Error('请等待当前操作结束再诊断'); return runtime.probe();});
    handle('install', kind => {if (queue.active || cover.importing||runtime.probing) throw new Error('请等待任务、导入或诊断完成'); return kind === 'music-style' ? musicStyle.install() : kind === 'score-sync' ? scoreTiming.install() : kind === 'voice-design' ? voicePresets.install() : kind === 'lyrics' ? lyrics.install() : kind === 'voice' ? voice.install() : kind === 'cover' ? cover.install() : runtime.install(kind);});
    handle('cancel-install', () => runtime.cancel());
    handle('download-source', source => runtime.setDownloadSource(source));
    handle('select-gpu', device => runtime.selectGpu(device));
    handle('jobs', () => store.list());
    const enqueue = input => {
      if (runtime.operation||runtime.probing) throw new Error('请等待环境准备、显卡切换或诊断完成');
      if(input?.kind==='music-style') input=musicStyle.validate(input);
      else if (input?.kind === 'lyrics') input = lyrics.validate(input);
      else if (input?.kind === 'voice') input = voice.validate(store, input);
      else if (input?.kind === 'transcribe') input = cover.validateTranscription(input);
      else {
        if (!runtime.installed()) throw new Error('请先安装运行环境');
        if (runtime.modelStatus().some(m => !m.ready)) throw new Error('请先下载完整模型');
        input = cover.attachCover(store, input);
      }
      if (store.jobs.filter(j => ['queued', 'running'].includes(j.status)).length >= 10) throw new Error('队列最多保留 10 个待处理任务');
      return queue.enqueue(input);
    };
    handle('create-job', enqueue);
    handle('cancel-job', id => queue.cancel(id));
    handle('retry-job', id => {
      if (runtime.operation) throw new Error('请等待安装完成');
      if (store.jobs.filter(j => ['queued', 'running'].includes(j.status)).length >= 10) throw new Error('队列最多 10 个任务');
      return enqueue(store.get(id).request);
    });
    handle('cover-sources', () => cover.list());
    handle('export-lyrics', async id => {
      const job=store.get(id);if(job.request.kind!=='lyrics'||job.status!=='completed')throw Error('歌词识别尚未完成');
      const title=job.request.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80);
      const {canceled,filePath}=await dialog.showSaveDialog(window,{defaultPath:path.join(app.getPath('downloads'),title+'.txt'),filters:[{name:'歌词文字',extensions:['txt']}]});
      if(canceled)return false;fs.writeFileSync(filePath,job.result.text+'\n','utf8');return true;
    });
    handle('import-audio', async purpose => {
      if (!cover.installed()) throw new Error('请先一键准备 Cover 环境');
      const {canceled, filePaths} = await dialog.showOpenDialog(window, {title: purpose === 'reference' ? '选择目标人物的参考声音' : '选择要改编的歌曲', properties: ['openFile'], filters: [{name: '音乐文件', extensions: ['wav', 'flac', 'mp3', 'm4a', 'ogg', 'aac']}]});
      if (canceled) return null;
      const source = await cover.importFile(filePaths[0]);
      const selected=path.resolve(filePaths[0]).toLowerCase(),original=store.list().find(j=>j.status==='completed'&&j.request.style&&['wav','flac'].some(ext=>path.resolve(store.directory(j.id),'artifacts','audio.'+ext).toLowerCase()===selected));
      if(original){source.originalStyle=original.request.style;source.originJobId=original.id;writeJSON(path.join(cover.sources,source.id,'source.json'),source);}
      notify({kind: 'sources'}); return source;
    });
    handle('get-cover-draft', () => readJSON(path.join(root, 'cover-draft.json'), null));
    handle('save-cover-draft', draft => {
      if (!draft || typeof draft !== 'object' || JSON.stringify(draft).length > 256000) throw new Error('Cover 草稿过大');
      writeJSON(path.join(root, 'cover-draft.json'), draft);
    });
    handle('get-voice-draft', () => readJSON(path.join(root, 'voice-draft.json'), null));
    handle('save-voice-draft', draft => {
      if (!draft || typeof draft !== 'object' || JSON.stringify(draft).length > 16000) throw new Error('音色草稿过大');
      writeJSON(path.join(root, 'voice-draft.json'), draft);
    });
    handle('export-voice-stem', async (id, stem) => {
      const job = store.get(id);
      if (job.request.kind !== 'voice' || job.status !== 'completed') throw new Error('音色转换尚未完成');
      if (!['converted-vocals', 'instrumental'].includes(stem)) throw new Error('无效音轨');
      const file = path.join(store.directory(id), 'artifacts', `${stem}.wav`);
      if (!fs.existsSync(file)) throw new Error('音轨文件不存在');
      const title = job.request.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
      const {canceled, filePath} = await dialog.showSaveDialog(window, {defaultPath: path.join(app.getPath('downloads'), `${title}-${stem}.wav`), filters: [{name: 'WAV', extensions: ['wav']}]});
      if (canceled) return false;
      fs.copyFileSync(file, filePath); return true;
    });
    handle('export-score', async (id, format) => {
      if (!['abc', 'mid'].includes(format)) throw new Error('仅支持 ABC / MIDI');
      const job = store.get(id); if (job.status !== 'completed') throw new Error('转谱尚未完成');
      const file = path.join(store.directory(id), 'artifacts', format === 'abc' ? 'score.abc' : 'transcription.mid');
      if (!fs.existsSync(file)) throw new Error('此任务没有对应的乐谱文件');
      const title = job.request.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
      const {canceled, filePath} = await dialog.showSaveDialog(window, {defaultPath: path.join(app.getPath('downloads'), `${title}.${format}`), filters: [{name: format.toUpperCase(), extensions: [format]}]});
      if (canceled) return false;
      fs.copyFileSync(file, filePath); return true;
    });
    handle('get-draft', () => readJSON(path.join(root, 'draft.json'), null));
    handle('save-draft', draft => {if (!draft || typeof draft !== 'object' || JSON.stringify(draft).length > 256000) throw new Error('草稿过大'); writeJSON(path.join(root, 'draft.json'), draft);});
    handle('import-text', async kind => {
      if (!['lyrics', 'abc'].includes(kind)) throw new Error('无效类型');
      const {canceled, filePaths} = await dialog.showOpenDialog(window, {properties: ['openFile'], filters: [{name: '文本 / ABC 乐谱', extensions: kind === 'abc' ? ['abc', 'txt'] : ['txt', 'md']} ]});
      if (canceled) return null;
      if (fs.statSync(filePaths[0]).size > 160000) throw new Error('文件太大，请导入小于 160KB 的 UTF-8 文本');
      return fs.readFileSync(filePaths[0], 'utf8').replace(/^\uFEFF/, '');
    });
    handle('open-folder', async id => {const target = id ? store.directory(store.get(id).id) : root; const error = await shell.openPath(target); if (error) throw new Error(error);});
    handle('score', id => {store.get(id); const file = path.join(store.directory(id), 'artifacts', 'score.abc'); return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;});
    handle('score-timing',id=>scoreTiming.get(id));
    handle('save-score-timing',(id,key,anchors)=>scoreTiming.save(id,key,anchors));
    handle('export-audio', async (id, format) => {
      if (!['wav', 'flac'].includes(format)) throw new Error('仅支持 WAV / FLAC');
      const job = store.get(id); if (job.status !== 'completed' || ['transcribe','lyrics','music-style'].includes(job.request.kind)) throw new Error('作品尚未完成');
      const title = job.request.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
      const {canceled, filePath} = await dialog.showSaveDialog(window, {defaultPath: path.join(app.getPath('downloads'), `${title}.${format}`), filters: [{name: format.toUpperCase(), extensions: [format]}]});
      if (canceled) return false;
      fs.copyFileSync(path.join(store.directory(id), 'artifacts', `audio.${format}`), filePath); return true;
    });
    handle('external', key => {const urls = {repo: 'https://github.com/multimodal-art-projection/YuE', license: 'https://github.com/multimodal-art-projection/YuE/blob/main/MODEL_LICENSE', deepseek:'https://platform.deepseek.com/api_keys', deepseekDocs:'https://api-docs.deepseek.com/', yueSkill:'https://github.com/multimodal-art-projection/YuE/tree/main/skills/yue2-music'}; if (!urls[key]) throw new Error('无效链接'); return shell.openExternal(urls[key]);});
    window = new BrowserWindow({width: 1440, height: 960, minWidth: 1060, minHeight: 720, title: 'Fenglai音乐工作台', icon:path.join(__dirname,'../ui/assets/fenglai-icon.png'), backgroundColor: '#101113', autoHideMenuBar: true,
      webPreferences: {preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true}});
    syncNativeTheme(appearance.read());
    window.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    window.loadURL(page);
    window.on('close', event => {
      if (!queue.active && !runtime.operation && !cover.importing && !assistant.active && !autoAlignment.pending.size) return;
      const choice = dialog.showMessageBoxSync(window, {type: 'question', title: '退出 Fenglai音乐工作台', message: '正在创作、处理音频或准备环境。退出会停止当前操作。', buttons: ['继续工作', '停止并退出'], defaultId: 0, cancelId: 0});
      if (choice === 0) event.preventDefault(); else {queue.stop(); runtime.cancel(); cover.cancelImport(); assistant.cancel();}
    });
  }).catch(error => {dialog.showErrorBox('Fenglai音乐工作台 启动失败', `${error.message}\n请将整合包放在可写目录，避免 Program Files。`); app.quit();});
  app.on('will-quit', () => {autoAlignment?.dispose();queue?.stop(); runtime?.cancel(); cover?.cancelImport(); assistant?.cancel();scoreTiming?.dispose();});
  app.on('window-all-closed', () => app.quit());
}
