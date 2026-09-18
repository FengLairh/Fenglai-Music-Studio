"""Offline audio import and SheetSage2 transcription in its own Python runtime."""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time
import traceback
import wave


def emit(kind, **data):
    print(json.dumps({'type': kind, **data}, ensure_ascii=False), flush=True)


def ffmpeg(args):
    import imageio_ffmpeg
    result = subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error',
                             '-nostdin', '-y', *args], capture_output=True, timeout=180,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    if result.returncode:
        raise ValueError('无法读取此音频，请确认文件格式和内容完整。\n' + result.stderr.decode('utf-8', errors='replace')[-1200:])


def import_audio(source, output):
    output.mkdir(parents=True, exist_ok=True)
    preview = output / 'source.wav'
    emit('stage', stage='读取并准备原曲试听')
    # Limit decoding to local file protocols and ten minutes; never follow network URLs in a media container.
    ffmpeg(['-protocol_whitelist', 'file,pipe', '-i', str(source.resolve()), '-map', '0:a:0',
            '-vn', '-t', '601', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', str(preview)])
    with wave.open(str(preview), 'rb') as audio:
        seconds = audio.getnframes() / audio.getframerate()
    if seconds < 5 or seconds > 600:
        preview.unlink(missing_ok=True)
        raise ValueError('请导入 5 秒至 10 分钟的音频，再选择需要改编的片段。')
    with source.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    emit('result', result={'seconds': seconds, 'sampleRate': 48000, 'channels': 2, 'sha256': digest})


def validate_segment(start, end, duration):
    if any(not isinstance(x, (int, float)) or not math.isfinite(x) for x in (start, end, duration)):
        raise ValueError('片段时间必须为有效数字')
    if start < 0 or end > duration + 0.02 or end - start < 5 or end - start > 300:
        raise ValueError('请选择原曲内 5–300 秒的片段')


def probe():
    import torch
    import torchaudio
    import transformers
    import imageio_ffmpeg
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise RuntimeError('Cover 转谱需要支持 BF16 的 NVIDIA CUDA 显卡')
    x = torch.ones((32, 32), device='cuda', dtype=torch.bfloat16)
    float((x @ x).sum()); torch.cuda.synchronize()
    emit('result', result={'python': sys.version.split()[0], 'torch': torch.__version__,
                          'gpu': torch.cuda.get_device_name(0), 'vramGiB': round(torch.cuda.get_device_properties(0).total_memory / 2**30, 2),
                          'visibleGpuCount': torch.cuda.device_count(),
                          'torchaudio': torchaudio.__version__, 'transformers': transformers.__version__,
                          'ffmpeg': imageio_ffmpeg.get_ffmpeg_version(), 'kernelTest': True})


def transcribe(root, source, request_path, output, lock):
    import numpy as np
    import torch
    from transformers import AutoModel
    from model_files import verify_files
    request = json.loads(request_path.read_text(encoding='utf-8'))
    with wave.open(str(source), 'rb') as audio:
        validate_segment(request['start'], request['end'], audio.getnframes() / audio.getframerate())
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise RuntimeError('Cover 转谱需要支持 BF16 的 NVIDIA CUDA 显卡')
    # Hash the pinned Python code and weights before executing local custom model code.
    emit('stage', stage='校验 Cover 模型与转谱代码')
    identities = {}
    for entry in json.loads(lock.read_text(encoding='utf-8'))['models']:
        verify_files(root / 'models' / entry['name'], entry)
        identities[entry['name']] = entry['revision']
    output.mkdir(parents=True, exist_ok=True)
    clip = output / 'source.wav'
    ffmpeg(['-protocol_whitelist', 'file,pipe', '-ss', str(request['start']), '-i', str(source.resolve()),
            '-t', str(request['end'] - request['start']), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', str(clip)])
    mono = output / 'transcription-input.wav'
    ffmpeg(['-protocol_whitelist', 'file,pipe', '-i', str(clip), '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', str(mono)])
    with wave.open(str(mono), 'rb') as audio:
        waveform = np.frombuffer(audio.readframes(audio.getnframes()), dtype='<i2').astype(np.float32) / 32768
    if np.max(np.abs(waveform)) < 0.0001:
        raise ValueError('所选片段接近静音，请选择包含清晰旋律的部分')
    emit('stage', stage='加载 SheetSage2 与 MERT，准备提取旋律')
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    model = AutoModel.from_pretrained(str(root / 'models' / 'SheetSage2'), trust_remote_code=True,
                    base_model_path=str(root / 'models' / 'MERT-v2-FullSong'),
                    local_files_only=True).eval().to('cuda')
    emit('stage', stage='提取旋律、节拍与歌曲结构')
    last = [0.0]
    def progress(event):
        phase = event.get('stage')
        if phase == 'decoding' and time.monotonic() - last[0] < 1:
            return
        last[0] = time.monotonic()
        labels = {'audio': '读取片段', 'encoding': '分析音频特征', 'decoding': '提取旋律与节拍',
                  'window_complete': '片段识别完成', 'notation': '整理 ABC 乐谱与 MIDI', 'complete': '转谱完成'}
        text = labels.get(phase, phase)
        if event.get('window'): text += f" · {event['window']} / {event['windows']}"
        if event.get('tokens'): text += f" · {event['tokens']} tokens"
        emit('stage', stage=text)
    result = model.transcribe(waveform, sampling_rate=24000, output_dir=output,
                              melody_only=request['melodyOnly'], dtype='bf16', progress=progress)
    score = output / 'score.abc'
    if result.get('abc_error') or not score.is_file() or not score.read_text(encoding='utf-8').strip():
        raise ValueError('转谱未生成可用的 ABC 乐谱。' + str(result.get('abc_error') or '请尝试更清晰的片段。'))
    abc = score.read_text(encoding='utf-8')
    if len(abc) > 40000:
        raise ValueError('乐谱过长，请缩短片段后重新转谱（本版上限 40000 字符）')
    emit('result', result={'seconds': len(waveform) / 24000, 'sampleRate': 48000, 'identity': identities,
                          'warnings': result.get('warnings', []) + result.get('diagnostics', []), 'melodyOnly': request['melodyOnly'],
                          'elapsedSeconds': result.get('elapsed_seconds'), 'peakGpuMiB': result.get('peak_gpu_mib'),
                          'start': request['start'], 'end': request['end'], 'abcCharacters': len(abc)})


def waveform(source):
    import numpy as np
    # Completed works are FLAC. Decode a bounded, temporary preview with the
    # same bundled local-only decoder used for imports; never modify the song.
    if source.suffix.lower() != '.wav':
        import tempfile
        with tempfile.TemporaryDirectory(prefix='yue-waveform-') as folder:
            preview = Path(folder) / 'preview.wav'
            ffmpeg(['-protocol_whitelist', 'file,pipe', '-i', str(source.resolve()),
                    '-map', '0:a:0', '-vn', '-t', '601', '-ac', '1', '-ar', '24000',
                    '-c:a', 'pcm_s16le', str(preview)])
            return waveform(preview)
    peaks = []
    with wave.open(str(source), 'rb') as audio:
        if audio.getsampwidth() != 2:
            raise ValueError('波形预览需要已导入的 PCM16 音频')
        frames = audio.getnframes()
        step = max(1, int(np.ceil(frames / 1000)))
        for _ in range(0, frames, step):
            block = np.frombuffer(audio.readframes(step), dtype='<i2').astype(np.float32)
            peaks.append(float(np.max(np.abs(block)) / 32768) if len(block) else 0.0)
        emit('result', result={'peaks': peaks, 'seconds': frames / audio.getframerate()})


def main():
    p = argparse.ArgumentParser()
    p.add_argument('command', choices=['probe', 'import', 'transcribe', 'download', 'waveform'])
    for name in ['root', 'source', 'request', 'output', 'lock']:
        p.add_argument('--' + name, type=Path, required=name == 'root')
    args = p.parse_args()
    os.environ['HF_HOME'] = str(args.root / 'cache' / 'cover-hf')
    os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
    if args.command != 'download':
        os.environ['HF_HUB_OFFLINE'] = '1'
        os.environ['TRANSFORMERS_OFFLINE'] = '1'
    try:
        if args.command == 'probe': probe()
        elif args.command == 'import': import_audio(args.source, args.output)
        elif args.command == 'waveform': waveform(args.source)
        elif args.command == 'download':
            from model_files import download_models
            download_models(args.root, args.lock, emit)
        else: transcribe(args.root, args.source, args.request, args.output, args.lock)
    except Exception as e:
        message = str(e)
        if 'out of memory' in message.lower(): message = '转谱显存不足，请关闭其他 GPU 应用后重试。\n' + message
        emit('error', message=message)
        traceback.print_exc(file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
