const {contextBridge, ipcRenderer} = require('electron');
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('yue', {
  scoreTiming:invoke('score-timing'),saveScoreTiming:invoke('save-score-timing'),
  getAppearance:invoke('appearance-get'),saveAppearance:invoke('appearance-save'),importBackground:invoke('appearance-import'),removeBackground:invoke('appearance-remove'),audioWaveform:invoke('audio-waveform'),
  status: invoke('status'), diagnose: invoke('diagnose'), install: invoke('install'), cancelInstall: invoke('cancel-install'), setDownloadSource: invoke('download-source'),selectGpu:invoke('select-gpu'),
  listJobs: invoke('jobs'), createJob: invoke('create-job'), cancelJob: invoke('cancel-job'), retryJob: invoke('retry-job'), deleteJob: invoke('delete-job'),
  saveDraft: invoke('save-draft'), getDraft: invoke('get-draft'), importText: invoke('import-text'),
  openFolder: invoke('open-folder'), exportAudio: invoke('export-audio'), score: invoke('score'), external: invoke('external'),
  listSources: invoke('cover-sources'), importAudio: invoke('import-audio'), exportScore: invoke('export-score'), exportLyrics: invoke('export-lyrics'),
  sourceWaveform:invoke('source-waveform'),exportEditedScore:invoke('score-export-edited'),importEditedScore:invoke('score-import-edited'),
  getCoverDraft: invoke('get-cover-draft'), saveCoverDraft: invoke('save-cover-draft'),
  getVoiceDraft: invoke('get-voice-draft'), saveVoiceDraft: invoke('save-voice-draft'), exportVoiceStem: invoke('export-voice-stem'),
  voicePresets:invoke('voice-presets'),voicePresetSource:invoke('voice-preset-source'),voiceDesignCreate:invoke('voice-design-create'),getTimbreDraft:invoke('get-timbre-draft'),saveTimbreDraft:invoke('save-timbre-draft'),
  assistantStatus:invoke('assistant-status'), assistantConfigure:invoke('assistant-configure'), assistantRemoveKey:invoke('assistant-remove-key'),
  assistantTest:invoke('assistant-test'), assistantCompose:invoke('assistant-compose'), assistantCancel:invoke('assistant-cancel'), assistantHistory:invoke('assistant-history'), assistantDeleteRecord:invoke('assistant-delete-record'), assistantSkill:invoke('assistant-skill'),
  onAssistantProgress(callback){const listener=(_event,value)=>callback(value);ipcRenderer.on('assistant-progress',listener);return ()=>ipcRenderer.removeListener('assistant-progress',listener);},
  onChange(callback) {const listener = (_event, value) => callback(value); ipcRenderer.on('changed', listener); return () => ipcRenderer.removeListener('changed', listener);},
  onLog(callback) {const listener = (_event, value) => callback(value); ipcRenderer.on('log', listener); return () => ipcRenderer.removeListener('log', listener);}
});
