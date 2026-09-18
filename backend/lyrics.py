# SPDX-License-Identifier: GPL-3.0-or-later
"""Offline Qwen3-ASR lyrics. Separation and recognition run in separate processes."""
from __future__ import annotations
import argparse
import gc
import json
import math
import os
from pathlib import Path
import sys
import time
import wave

from cover import emit, ffmpeg, validate_segment
from model_files import verify_files


def normalize_segments(chunks, seconds, offset):
    segments = []
    for chunk in chunks:
        text = str(chunk.get('text', '')).strip()
        if not text:
            continue
        times = chunk.get('timestamp') or [None, None]
        start, end = (times + [None, None])[:2] if isinstance(times, list) else times
        def bounded(value):
            return min(seconds, max(0., float(value))) if isinstance(value, (float, int)) and math.isfinite(value) else None
        start, end = bounded(start), bounded(end)
        if start is not None and end is not None and end < start:
            end = None
        segments.append({'text': text, 'start': start, 'end': end,
                         'sourceStart': offset + start if start is not None else None,
                         'sourceEnd': offset + end if end is not None else None})
    return segments


def recognition_regions(audio, rate=16000):
    """Skip near-silence and cut long passages at low-energy boundaries, below 30s."""
    import numpy as np
    if not len(audio): return []
    hop = max(1, round(rate*.02))
    padded = np.pad(audio, (0, (-len(audio)) % hop))
    rms = np.sqrt(np.mean(padded.reshape(-1, hop)**2, axis=1))
    threshold = max(.0015, float(np.percentile(rms, 90))*.03)
    active = np.flatnonzero(rms > threshold)
    if not len(active): return []
    starts = [int(active[0])]; ends = []
    for left, right in zip(active, active[1:]):
        if right-left > 50: ends.append(int(left)+1); starts.append(int(right))
    ends.append(int(active[-1])+1)
    regions = []
    for start, end in zip(starts, ends):
        start, end = max(0, start*hop-round(rate*.3)), min(len(audio), end*hop+round(rate*.3))
        if end-start < rate*.5: continue
        while end-start > rate*28:
            lo, hi = math.ceil((start+rate*18)/hop), min(len(rms), math.floor((start+rate*26)/hop))
            boundary = (lo+int(np.argmin(rms[lo:hi])))*hop
            regions.append((start, boundary)); start = boundary
        regions.append((start, end))
    return regions


def extract_vocals(root, clip, output, lock_path):
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio
    from demucs.states import load_model
    from demucs.apply import apply_model
    entry = next(e for e in json.loads(lock_path.read_text(encoding='utf-8'))['models'] if e['name'] == 'Demucs-HT')
    emit('stage', stage='校验人声分离模型')
    verify_files(root / 'models/Demucs-HT', entry)
    emit('stage', stage='分离原曲人声，减少伴奏干扰')
    package = torch.load(root / 'models/Demucs-HT/04573f0d-f3cf25b2.th', map_location='cpu', weights_only=False)
    model = load_model(package).eval().to('cuda:0')
    del package
    samples, sr = sf.read(str(clip), dtype='float32', always_2d=True)
    audio = torchaudio.functional.resample(torch.from_numpy(samples.T.copy()), sr, model.samplerate)
    reference = audio.mean(0); mean, std = reference.mean(), reference.std().clamp(min=1e-6)
    with torch.inference_mode():
        stems = apply_model(model, ((audio-mean)/std)[None], device='cuda:0', shifts=2,
                            split=True, overlap=0.5, segment=7., progress=True, num_workers=0)[0].cpu()*std+mean
    vocals = stems[model.sources.index('vocals')]
    mono = torchaudio.functional.resample(vocals.mean(0), model.samplerate, 16000).numpy()
    sf.write(str(output / 'vocals.wav'), mono, 16000, subtype='PCM_16')
    del model, stems, vocals, audio
    gc.collect(); torch.cuda.empty_cache()
    return mono.astype(np.float32), entry['revision']


def check_gpu():
    import torch
    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError('歌词识别需要一张可用的 NVIDIA CUDA 显卡')
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    torch.manual_seed(42)


def read_request(source, request_path):
    request = json.loads(request_path.read_text(encoding='utf-8'))
    with wave.open(str(source), 'rb') as stream:
        validate_segment(request['start'], request['end'], stream.getnframes()/stream.getframerate())
    if request.get('language') not in ['auto', 'zh', 'en', 'ja', 'ko'] or type(request.get('separateVocals')) is not bool:
        raise ValueError('无效的歌词识别选项')
    return request


def prepare(root, source, request_path, output, voice_lock):
    import numpy as np
    request = read_request(source, request_path)
    check_gpu()
    started = time.monotonic(); output.mkdir(parents=True, exist_ok=True)
    seconds = request['end']-request['start']
    clip = output / 'source.wav'
    ffmpeg(['-protocol_whitelist', 'file,pipe', '-ss', str(request['start']), '-i', str(source.resolve()),
            '-t', str(seconds), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', str(clip)])
    separation_revision = None
    if request['separateVocals']:
        mono, separation_revision = extract_vocals(root, clip, output, voice_lock)
    else:
        input_file = output / 'recognition-input.wav'
        ffmpeg(['-protocol_whitelist', 'file,pipe', '-i', str(clip), '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(input_file)])
        with wave.open(str(input_file), 'rb') as stream:
            mono = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float32)/32768
    if not np.isfinite(mono).all() or float(np.sqrt(np.mean(mono**2))) < 0.0001:
        raise ValueError('所选片段没有足够清晰的人声，请换一段再识别')
    metadata = {'request': request, 'separationRevision': separation_revision,
                'elapsedSeconds': time.monotonic()-started,
                'input': 'vocals.wav' if request['separateVocals'] else 'recognition-input.wav'}
    (output / 'prepared.json').write_text(json.dumps(metadata, ensure_ascii=False), encoding='utf-8')
    emit('result', result={'prepared': True})


def recognize(root, source, request_path, output, lock_path):
    import numpy as np
    import torch
    from transformers import AutoProcessor, Qwen3ASRForConditionalGeneration
    request = read_request(source, request_path)
    check_gpu()
    started = time.monotonic()
    entry = json.loads(lock_path.read_text(encoding='utf-8'))['models'][0]
    if entry['name'] != 'Qwen3-ASR-1.7B' or entry['repo'] != 'Qwen/Qwen3-ASR-1.7B-hf':
        raise ValueError('请准备千问 ASR 模型，旧版歌词模型不能用于本次识别')
    emit('stage', stage='校验本地千问 ASR 模型')
    model_path = root / 'models' / entry['name']
    verify_files(model_path, entry)
    prepared = json.loads((output / 'prepared.json').read_text(encoding='utf-8'))
    if prepared['request'] != request:
        raise ValueError('音频预处理结果与本次请求不一致，请重新识别')
    input_name = 'vocals.wav' if request['separateVocals'] else 'recognition-input.wav'
    with wave.open(str(output / input_name), 'rb') as stream:
        if stream.getnchannels()!=1 or stream.getsampwidth()!=2 or stream.getframerate()!=16000:
            raise ValueError('预处理音频格式无效')
        mono = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float32)/32768
    seconds = request['end']-request['start']
    emit('stage', stage='加载千问 Qwen3-ASR 1.7B，准备识别歌词')
    model = Qwen3ASRForConditionalGeneration.from_pretrained(str(model_path), dtype=torch.bfloat16,
                local_files_only=True, attn_implementation='sdpa').to('cuda:0').eval()
    processor = AutoProcessor.from_pretrained(str(model_path), local_files_only=True)
    regions = recognition_regions(mono)
    if not regions: raise ValueError('没有检测到足够清晰的人声，请换一段再识别')
    segments = []
    languages = []
    with torch.inference_mode():
        for index, (left, right) in enumerate(regions):
            emit('stage', stage=f'千问识别歌词 · {index+1} / {len(regions)} 段')
            options = {} if request['language']=='auto' else {'language': request['language']}
            inputs = processor.apply_transcription_request(audio=mono[left:right], **options).to(model.device, model.dtype)
            output_ids = model.generate(**inputs, max_new_tokens=1024, do_sample=False)
            generated = output_ids[:, inputs['input_ids'].shape[1]:]
            if generated.shape[1]>=1024:
                raise ValueError('千问识别输出未正常结束，请缩短片段后重试')
            parsed = processor.decode(generated, return_format='parsed')[0]
            text = str(parsed.get('transcription') or '').strip()
            languages.append(parsed.get('language') or request['language'])
            # Qwen ASR alone has no word timestamps. Keep honest clip boundaries.
            chunks = [{'text': text, 'timestamp': [0., (right-left)/16000]}]
            for segment in normalize_segments(chunks, (right-left)/16000, request['start']+left/16000):
                for key in ['start', 'end']:
                    if segment[key] is not None: segment[key] += left/16000
                segment['timing'] = 'audio-region'
                segments.append(segment)
            del inputs, output_ids, generated
    text = '\n'.join(s['text'] for s in segments)
    if not text: raise ValueError('没有识别到可用歌词，请选择包含清晰演唱的片段')
    if len(text) > 12000 or len(segments) > 2000: raise ValueError('识别文字过长，请缩短片段后再试')
    report = {'text': text, 'segments': segments, 'seconds': seconds, 'start': request['start'], 'end': request['end'],
              'sourceId': request['sourceId'], 'language': request['language'], 'separateVocals': request['separateVocals'],
              'engine': 'qwen3-asr', 'recognizedLanguages': languages,
              'modelIdentity': {entry['repo']: entry['revision']}, 'separationRevision': prepared['separationRevision'],
              'elapsedSeconds': time.monotonic()-started+prepared['elapsedSeconds'], 'gpu': torch.cuda.get_device_name(0), 'visibleGpuCount': 1,
              'peakGpuMiB': torch.cuda.max_memory_allocated()/2**20,
              'recognitionRegions': [{'start': left/16000, 'end': right/16000} for left, right in regions],
              'timestampMode': 'audio-region',
              'warnings': ['歌声识别仍可能有错字、漏字或重复，请回听校对。回听时间对应识别片段，不代表逐字对齐。'],
              'humanVerified': False}
    (output / 'lyrics.txt').write_text(text+'\n', encoding='utf-8')
    (output / 'transcript.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    emit('result', result=report)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--phase', choices=['prepare', 'recognize', 'probe'], default='recognize')
    for name in ['root', 'source', 'request', 'output', 'lock', 'voice-lock']:
        parser.add_argument('--'+name, type=Path, required=name=='root')
    args = parser.parse_args()
    os.environ.setdefault('CUDA_VISIBLE_DEVICES', '0')
    os.environ.update(CUDA_DEVICE_ORDER='PCI_BUS_ID', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                      HF_HUB_DISABLE_TELEMETRY='1', HF_HOME=str(args.root / 'cache/lyrics-hf'))
    try:
        if args.phase == 'probe':
            import torch
            import transformers
            from transformers import AutoProcessor, Qwen3ASRForConditionalGeneration
            check_gpu()
            emit('result', result={'engine': 'qwen3-asr', 'python': sys.version.split()[0],
                 'transformers': transformers.__version__, 'torch': torch.__version__,
                 'gpu': torch.cuda.get_device_name(0), 'visibleGpuCount': torch.cuda.device_count()})
        elif args.phase == 'prepare':
            prepare(args.root, args.source, args.request, args.output, args.voice_lock)
        else:
            recognize(args.root, args.source, args.request, args.output, args.lock)
    except Exception as error: emit('error', message=str(error)); sys.exit(1)


if __name__ == '__main__': main()
