const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {validateRequest, JobStore, JobQueue, writeJSON} = require('../desktop/core.cjs');
const {Runtime} = require('../desktop/runtime.cjs');
const {Cover} = require('../desktop/cover.cjs');
const dir = path.resolve(__dirname, '..', 'test-results'); fs.mkdirSync(dir, {recursive: true});
const temp = () => fs.mkdtempSync(path.join(dir, 'cover-unit-'));
const sourceId = crypto.randomUUID();
const request = {kind: 'transcribe', sourceId, start: 0, end: 30, melodyOnly: true};
test('reject malformed, oversized and out-of-range audio segments at the queue boundary', () => {
  assert.equal(validateRequest(request).kind, 'transcribe');
  for (const change of [{sourceId: '../secret'}, {start: -1}, {end: Infinity}, {end: 601}, {end: 301}, {end: 4}, {start: '0'}, {melodyOnly: 'true'}]) assert.throws(() => validateRequest({...request, ...change}));
});
test('Cover provenance must refer to a completed transcription and selects the matching score mode', () => {
  const runtime = new Runtime(temp(), temp()), cover = new Cover(runtime), store = new JobStore(path.join(runtime.root, 'songs'));
  const source = path.join(cover.sources, sourceId); writeJSON(path.join(source, 'source.json'), {id: sourceId, seconds: 30}); fs.writeFileSync(path.join(source, 'source.wav'), 'fixture');
  const transcription = store.add(request);
  const input = {title: 'Cover', style: 'folk', lyrics: '[Verse]\n歌词', abc: 'X:1\nK:C\nCDEF|', transcriptionId: transcription.id};
  assert.throws(() => cover.attachCover(store, input), /转谱/);
  store.update(transcription.id, {status: 'completed'});
  assert.equal(cover.attachCover(store, input).cot, 'melody');
  assert.throws(() => cover.validateTranscription({...request, end: 31}), /超出/);
  assert.throws(() => validateRequest({...input, abc: ''}), /Cover/);
  assert.throws(() => cover.source('../secret'));
});
test('transcription and generation share one cancellable GPU queue', async () => {
  const store = new JobStore(temp()); const calls = []; let active = 0, maximum = 0;
  const queue = new JobQueue(store, async (job, signal) => {
    active++; maximum = Math.max(maximum, active); calls.push(job.request.kind || 'generate');
    try {await new Promise((resolve, reject) => {const timer = setTimeout(resolve, 30); signal.addEventListener('abort', () => {clearTimeout(timer); reject(new Error('取消'));}, {once: true});}); return {seconds: 2};}
    finally {active--;}
  });
  const one = queue.enqueue(request); const two = queue.enqueue({style: 'folk', lyrics: '歌词'});
  queue.cancel(one.id);
  const timeout = Date.now() + 5000;
  while (two.status !== 'completed') {if (Date.now() > timeout) throw new Error('timeout'); await new Promise(r => setTimeout(r, 20));}
  assert.equal(one.status, 'cancelled'); assert.equal(maximum, 1); assert.deepEqual(calls, ['transcribe', 'generate']);
});
