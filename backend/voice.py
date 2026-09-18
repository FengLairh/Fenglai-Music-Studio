# SPDX-License-Identifier: GPL-3.0-or-later
"""Offline single-GPU singing voice conversion: Demucs -> Seed-VC -> stereo mix."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import traceback

from cover import emit, ffmpeg, validate_segment
from model_files import download_models, verify_files
from voice_audio import prepare_reference, restore_performance, conversion_regions


def gpu():
    import torch
    if not torch.cuda.is_available() or torch.cuda.device_count() != 1:
        raise RuntimeError('音色替换需要单张可用的 NVIDIA CUDA 显卡')
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    return {'gpu': torch.cuda.get_device_name(0), 'visibleGpuCount': torch.cuda.device_count(),
            'vramGiB': round(torch.cuda.get_device_properties(0).total_memory / 2**30, 2)}


def probe():
    import torch
    import torchaudio
    import transformers
    import librosa
    import soundfile
    import demucs
    import dac
    import munch
    import imageio_ffmpeg
    info = gpu()
    value = torch.ones((32, 32), device='cuda', dtype=torch.float16)
    float((value @ value).sum()); torch.cuda.synchronize()
    emit('result', result={**info, 'python': sys.version.split()[0], 'torch': torch.__version__,
        'torchaudio': torchaudio.__version__, 'transformers': transformers.__version__,
        'ffmpeg': imageio_ffmpeg.get_ffmpeg_version(), 'kernelTest': True})


def locked(root, lock, names):
    result = {}
    for entry in json.loads(lock.read_text(encoding='utf-8'))['models']:
        if entry['name'] not in names: continue
        emit('stage', stage=f"校验音色模型 · {entry['name']}")
        verify_files(root / 'models' / entry['name'], entry)
        result[entry['name']] = entry['revision']
    if len(result) != len(names): raise ValueError('音色模型锁定文件不完整')
    return result


def check_signal(audio, label):
    import numpy as np
    if not np.isfinite(audio).all() or float(np.sqrt(np.mean(audio.astype('float64') ** 2))) < 0.0001:
        raise ValueError(f'{label}接近静音或包含无效数据，请选择清晰的人声片段')


def separate(root, source, reference, request, output, lock):
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio
    info = gpu(); started = time.monotonic()
    import random
    random.seed(request['seed']); torch.manual_seed(request['seed'])
    output.mkdir(parents=True, exist_ok=True)
    validate_segment(request['start'], request['end'], sf.info(str(source)).duration)
    validate_segment(request['referenceStart'], request['referenceEnd'], sf.info(str(reference)).duration)
    if request['referenceEnd'] - request['referenceStart'] > 25: raise ValueError('目标声音片段最长 25 秒')
    for incoming, target, start, end in [(source, 'source.wav', request['start'], request['end']),
                                      (reference, 'reference.wav', request['referenceStart'], request['referenceEnd'])]:
        ffmpeg(['-protocol_whitelist', 'file,pipe', '-ss', str(start), '-i', str(incoming.resolve()),
                '-t', str(end-start), '-ac', '2', '-ar', '48000', '-c:a', 'pcm_f32le', str(output / target)])
    need_model = request['sourceHasMusic'] or request['referenceHasMusic']
    identities = locked(root, lock, ['Demucs-HT']) if need_model else {}
    model = None
    if need_model:
        from demucs.states import load_model
        from demucs.apply import apply_model
        emit('stage', stage='加载精细人声分离模型 · 单显卡')
        # Only deserialize this bundled official checkpoint after its full pinned SHA-256 was checked.
        package = torch.load(root / 'models/Demucs-HT/04573f0d-f3cf25b2.th', map_location='cpu', weights_only=False)
        model = load_model(package).eval().to('cuda')
        if model.sources != ['drums', 'bass', 'other', 'vocals']: raise ValueError('人声分离模型音轨顺序异常')
        del package
    for name, has_music in [('source', request['sourceHasMusic']), ('reference', request['referenceHasMusic'])]:
        wave, sr = sf.read(str(output / f'{name}.wav'), dtype='float32', always_2d=True)
        check_signal(wave, '原歌曲' if name == 'source' else '目标声音')
        if has_music:
            emit('stage', stage='分离歌曲人声与伴奏' if name == 'source' else '清理目标声音中的伴奏')
            audio = torchaudio.functional.resample(torch.from_numpy(wave.T.copy()), sr, model.samplerate)
            ref = audio.mean(0); mean, std = ref.mean(), ref.std().clamp(min=1e-6)
            audio = (audio - mean) / std
            with torch.inference_mode():
                stems = apply_model(model, audio[None], device='cuda', shifts=2, split=True, overlap=0.5,
                                    segment=7.0, progress=True, num_workers=0)[0].cpu() * std + mean
            vocals = stems[model.sources.index('vocals')]
            vocals = torchaudio.functional.resample(vocals, model.samplerate, sr).T.numpy()
            vocals = match_length(vocals, len(wave))
            del stems, audio
        else: vocals = wave
        check_signal(vocals, '分离的人声' if name == 'source' else '目标声音')
        sf.write(str(output / ('vocals.wav' if name == 'source' else 'reference-vocals.wav')), vocals, sr, subtype='FLOAT')
        if name == 'source': sf.write(str(output / 'instrumental.wav'), wave - vocals if has_music else np.zeros_like(wave), sr, subtype='FLOAT')
    info.update({'modelIdentity': identities, 'elapsedSeconds': time.monotonic()-started,
                 'peakGpuMiB': torch.cuda.max_memory_allocated()/2**20})
    (output / 'separation.json').write_text(json.dumps(info, indent=2), encoding='utf-8')
    emit('result', result=info)


def match_length(wave, frames):
    import numpy as np
    if len(wave) >= frames: return wave[:frames]
    return np.pad(wave, [(0, frames-len(wave)), *[(0, 0)] * (wave.ndim-1)])


def mix_audio(vocals, instrumental, vocal_gain_db, accompaniment_gain_db):
    import numpy as np
    vocals = match_length(vocals, len(instrumental))
    mixed = vocals[:, None] * 10**(vocal_gain_db/20) + instrumental * 10**(accompaniment_gain_db/20)
    check_signal(mixed, '转换结果')
    peak = float(np.max(np.abs(mixed)))
    gain = min(1., 0.98/max(peak, 1e-9))
    return mixed * gain, gain


def mix_preserving_backing(vocals, instrumental):
    """Keep the backing at unity gain; reserve headroom by reducing only the new vocal."""
    import numpy as np
    vocals = match_length(vocals, len(instrumental))
    if np.max(np.abs(instrumental)) >= .99999:
        raise ValueError('原伴奏峰值过高，无法在保持伴奏音量时安全混音，请改用已有的音色 Cover 调整混音')
    upper = 1.
    for channel in range(instrumental.shape[1]):
        positive, negative = vocals > 1e-8, vocals < -1e-8
        if positive.any(): upper = min(upper, float(np.min((.99999-instrumental[positive, channel])/vocals[positive])))
        if negative.any(): upper = min(upper, float(np.min((-.99999-instrumental[negative, channel])/vocals[negative])))
    gain = max(0., min(1., upper * .999 if upper < 1 else 1.))
    vocals = vocals * gain
    mixed = instrumental + vocals[:, None]
    check_signal(mixed, '翻唱结果')
    return vocals, mixed, gain


def convert(root, request, output, lock):
    import numpy as np
    import soundfile as sf
    import torch
    import torchaudio
    import yaml
    from types import SimpleNamespace
    import random
    info = gpu(); started = time.monotonic()
    random.seed(request['seed']); np.random.seed(request['seed']); torch.manual_seed(request['seed'])
    names = ['Seed-VC-Singing', 'BigVGAN-44k', 'Whisper-Small', 'CAMPPlus', 'RMVPE']
    identities = locked(root, lock, names)
    vendor = Path(__file__).resolve().parents[1] / 'vendor/Seed-VC'
    sys.path.insert(0, str(vendor))
    import inference
    models = root / 'models'
    local_assets = {('lj1995/VoiceConversionWebUI', 'rmvpe.pt'): models / 'RMVPE/rmvpe.pt',
                    ('funasr/campplus', 'campplus_cn_common.bin'): models / 'CAMPPlus/campplus_cn_common.bin'}
    def local_model(repo_id, model_filename='pytorch_model.bin', config_filename=None):
        if (repo_id, model_filename) not in local_assets or config_filename is not None:
            raise ValueError('请求了未锁定的在线模型')
        return str(local_assets[(repo_id, model_filename)])
    inference.load_custom_model_from_hf = local_model
    config = yaml.safe_load((models / 'Seed-VC-Singing/config_dit_mel_seed_uvit_whisper_base_f0_44k.yml').read_text(encoding='utf-8'))
    config['model_params']['vocoder']['name'] = str(models / 'BigVGAN-44k')
    config['model_params']['speech_tokenizer']['name'] = str(models / 'Whisper-Small')
    config_file = output / 'voice-config.yml'
    config_file.write_text(yaml.safe_dump(config, allow_unicode=False), encoding='utf-8')
    reference, ref_sr = sf.read(str(output / 'reference-vocals.wav'), dtype='float32', always_2d=True)
    prepared, reference_info = prepare_reference(reference, ref_sr)
    sf.write(str(output / 'reference-prepared.wav'), prepared, ref_sr, subtype='FLOAT')
    args = SimpleNamespace(checkpoint=str(models / 'Seed-VC-Singing/DiT_seed_v2_uvit_whisper_base_f0_44k_bigvgan_pruned_ft_ema_v2.pth'),
        config=str(config_file), f0_condition=True, auto_f0_adjust=False, fp16=True,
        semi_tone_shift=request['semitones'], diffusion_steps=request['steps'], length_adjust=1.0,
        inference_cfg_rate=0.7, source='', target=str(output / 'reference-prepared.wav'), output=str(output))
    emit('stage', stage='加载歌声音色转换模型 · 保留旋律与节奏')
    loaded = inference.load_models(args)
    inference.load_models = lambda _: loaded
    audio, sr = sf.read(str(output / 'vocals.wav'), dtype='float32', always_2d=True)
    audio = audio.mean(axis=1); check_signal(audio, '歌曲人声')
    # Avoid one-second blends of separately generated vowels. Prefer quiet boundaries,
    # provide half-second context, discard its unstable edges, and blend just 80 ms.
    regions = conversion_regions(audio, sr)
    overlap = round(sr*.08)
    combined = np.zeros(len(audio), dtype='float32'); weight = np.zeros(len(audio), dtype='float32')
    captured = []
    original_save = torchaudio.save
    def capture(_path, wave, sample_rate, **_kwargs): captured.append((wave.cpu().numpy().reshape(-1), sample_rate))
    torchaudio.save = capture
    try:
        for number, (start, end) in enumerate(regions):
            emit('stage', stage=f'替换演唱音色 · {number+1} / {len(regions)} 段')
            context_start = max(0, start-round(sr*.5)); context_end = min(len(audio), end+round(sr*.5))
            chunk = output / 'voice-chunk.wav'
            sf.write(str(chunk), audio[context_start:context_end], sr, subtype='FLOAT'); args.source = str(chunk)
            captured.clear()
            inference.main(args)
            if len(captured) != 1: raise ValueError('音色模型没有产生音频')
            converted, converted_sr = captured[0]
            converted = torchaudio.functional.resample(torch.from_numpy(converted), converted_sr, sr).numpy()
            if abs(len(converted) - (context_end-context_start)) > sr * 0.15: raise ValueError('转换音频时长异常，已停止混音以避免错位')
            converted = match_length(converted, context_end-context_start)[start-context_start:end-context_start]
            if not np.isfinite(converted).all(): raise ValueError('转换人声包含无效数据')
            fade = np.ones(end-start, dtype='float32')
            if number: fade[:overlap] = np.linspace(0, 1, min(overlap, len(fade)))
            if end < len(audio): fade[-overlap:] = np.linspace(1, 0, min(overlap, len(fade)))
            combined[start:end] += converted * fade; weight[start:end] += fade
    finally: torchaudio.save = original_save
    if np.any(weight < 1e-6): raise ValueError('转换片段没有完整覆盖歌曲')
    combined /= weight
    sf.write(str(output / 'raw-converted-vocals.wav'), combined, sr, subtype='FLOAT')
    emit('stage', stage='保留演唱强弱与停顿 · 抑制空隙杂音')
    performance = {'envelopeMatch': False}
    if request.get('preserveDynamics', True): combined, performance = restore_performance(combined, audio, sr)
    # Floating WAV may contain samples above full scale; its preview/export must not clip.
    vocal_peak_gain = min(1., .98/max(float(np.max(np.abs(combined))), 1e-9))
    combined *= vocal_peak_gain
    performance['peakGain'] = vocal_peak_gain
    emit('stage', stage='与原伴奏混合并导出音频')
    original_backing = output / 'original-instrumental.wav'
    backing_input = original_backing if original_backing.exists() else output / 'instrumental.wav'
    instrumental, _ = sf.read(str(backing_input), dtype='float32', always_2d=True)
    if request['semitones'] and request.get('pitchMode', 'vocal') == 'song' and request['sourceHasMusic']:
        emit('stage', stage='伴奏同步变调 · 保持原速度')
        shifted = output / 'instrumental-shifted.wav'
        ffmpeg(['-protocol_whitelist', 'file,pipe', '-i', str(backing_input),
                '-af', f"rubberband=pitch={2**(request['semitones']/12):.12f}:pitchq=quality", '-c:a', 'pcm_f32le', str(shifted)])
        instrumental, _ = sf.read(str(shifted), dtype='float32', always_2d=True)
        instrumental = match_length(instrumental, len(audio))
        # The exported backing is the backing used by this mix; keep the original too.
        if not original_backing.exists(): (output/'instrumental.wav').replace(original_backing)
        shifted.unlink()
    backing_preserved = None
    if request.get('preserveSong'):
        if backing_input != output/'instrumental.wav': raise ValueError('仅换人声不能使用已变调的伴奏')
        with backing_input.open('rb') as stream: backing_preserved = hashlib.file_digest(stream, 'sha256').hexdigest()
        combined, mixed, headroom = mix_preserving_backing(combined, instrumental)
        performance['vocalHeadroomGain'] = headroom
        gain = 1.
    else:
        sf.write(str(output/'instrumental.wav'), instrumental, sr, subtype='FLOAT')
        mixed, gain = mix_audio(combined, instrumental, request['vocalGainDb'], request['accompanimentGainDb'])
    sf.write(str(output / 'converted-vocals.wav'), combined, sr, subtype='FLOAT')
    sf.write(str(output / 'audio.wav'), mixed, sr, subtype='PCM_24')
    sf.write(str(output / 'audio.flac'), mixed, sr, subtype='PCM_24')
    (output / 'voice-chunk.wav').unlink(missing_ok=True)
    # Absolute local model paths are only needed while running and would be stale after a portable move.
    config_file.unlink(missing_ok=True)
    result = {**info, 'seconds': len(mixed)/sr, 'sampleRate': sr, 'channels': 2, 'modelIdentity': identities,
        'elapsedSeconds': time.monotonic()-started, 'peakGpuMiB': torch.cuda.max_memory_allocated()/2**20,
        'mixGain': gain, 'allFinite': bool(np.isfinite(mixed).all()), 'rms': float(np.sqrt(np.mean(mixed**2))),
        'chunks': len(regions), 'pipelineVersion': '0.3.1', 'referencePreparation': reference_info,
        'performance': performance, 'pitchMode': request.get('pitchMode', 'vocal'), 'semitones': request['semitones'],
        'preserveSong': request.get('preserveSong', False), 'preservedBackingSha256': backing_preserved,
        'separation': json.loads((output/'separation.json').read_text(encoding='utf-8'))}
    with (output/'audio.wav').open('rb') as stream: result['wavSha256'] = hashlib.file_digest(stream, 'sha256').hexdigest()
    (output/'voice-result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    emit('result', result=result)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['probe', 'download', 'separate', 'convert'])
    for key in ['root', 'lock', 'source', 'reference', 'request', 'output']: parser.add_argument('--'+key, type=Path)
    args = parser.parse_args()
    if args.command == 'download': return download_models(args.root, args.lock, emit)
    os.environ['HF_HUB_OFFLINE'] = '1'; os.environ['TRANSFORMERS_OFFLINE'] = '1'
    if args.command == 'probe': return probe()
    request = json.loads(args.request.read_text(encoding='utf-8'))
    if request.get('preserveSong') and (request.get('semitones') != 0 or request.get('pitchMode') != 'vocal' or
            request.get('vocalGainDb') != 0 or request.get('accompanimentGainDb') != 0 or not request.get('preserveDynamics') or not request.get('sourceHasMusic')):
        raise ValueError('仅换人声模式禁止变调、更改伴奏音量或演唱强弱')
    if args.command == 'separate': return separate(args.root, args.source, args.reference, request, args.output, args.lock)
    return convert(args.root, request, args.output, args.lock)


if __name__ == '__main__':
    try: main()
    except Exception as error:
        traceback.print_exc()
        message = str(error)
        if 'out of memory' in message.lower(): message = '音色转换显存不足，请关闭其他 GPU 应用并先试短片段。\n' + message
        emit('error', message=message); sys.exit(1)
