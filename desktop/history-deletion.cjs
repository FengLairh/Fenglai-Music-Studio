'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {validId} = require('./core.cjs');

// The caller supplies only a record ID, never a renderer-provided filesystem path.
async function trashWithin(root, name, trash) {
  if (!/^[a-f0-9-]{36}(?:\.json)?$/.test(name)) throw Error('无效的历史记录编号');
  const base = path.resolve(root), target = path.resolve(base, name);
  if (path.dirname(target) !== base) throw Error('删除路径超出历史记录目录');
  const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!samePath(fs.realpathSync(base), base)) throw Error('历史目录含链接，请先检查存储位置');
  function check(file) {
    const info = fs.lstatSync(file);
    if (info.isSymbolicLink()) throw Error('记录中含文件链接，不能自动删除');
    if (info.isDirectory()) for (const entry of fs.readdirSync(file)) check(path.join(file, entry));
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    check(target);
    try { await trash(target); return; }
    catch {
      // Chromium may still be releasing a just-stopped audio stream on Windows.
      // Retry the recycle operation only; never fall back to permanent deletion.
      if (attempt < 2 && fs.existsSync(target)) await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      else throw Error('无法移到 Windows 回收站，记录已保留。请停止相关播放或关闭占用文件的程序后重试。');
    }
  }
}

class HistoryDeletion {
  constructor({store, assistant, confirm, trash}) {
    Object.assign(this, {store, assistant, confirm, trash}); this.pending = new Set();
  }
  async run(key, operation) {
    if (this.pending.has(key)) throw Error('这条记录正在处理，请稍候');
    this.pending.add(key);
    try { return await operation(); } finally { this.pending.delete(key); }
  }
  job(id) {
    validId(id);
    return this.run('job:' + id, async () => {
      const job = this.store.assertDeletable(id);
      if (!await this.confirm({title: '删除生成记录', message: `删除“${job.request.title}”？`,
        detail: '该记录及其生成的音频、乐谱和日志将移到 Windows 回收站，可从回收站恢复。导入的原曲、参考声音、模型、已导出的文件和草稿内容会保留。'})) return false;
      // Recheck dependencies after the dialog; a new Cover may have been queued.
      await this.store.remove(id, target => trashWithin(this.store.root, path.basename(target), this.trash));
      return true;
    });
  }
  suggestion(id) {
    validId(id);
    return this.run('assistant:' + id, async () => {
      const record = this.assistant.record(id);
      if (!record || record.id !== id || record.status !== 'completed') throw Error('创作建议不存在');
      if (!await this.confirm({title: '删除 AI 建议', message: `删除“${record.proposal.title || '创作建议'}”？`,
        detail: '仅将这条 AI 建议移到 Windows 回收站。已应用到作品的歌词、曲风和乐谱，以及 DeepSeek 设置会保留。'})) return false;
      await trashWithin(path.join(this.assistant.root, 'history'), id + '.json', this.trash);
      return true;
    });
  }
}
module.exports = {HistoryDeletion, trashWithin};
