"""Offline word-conditioned playback timing; never retime or rewrite the song."""
import argparse
import json
import math
import os
from pathlib import Path
import tempfile
import wave


def assemble(words, cues, duration, score_seconds):
    """Drop repaired, collapsed and out-of-audio predictions instead of inventing cues."""
    events, points = [], [[0., 0.]]
    rejected = 0
    for word, cue in zip(words, cues):
        start, end = word['start_time'], word['end_time']
        score_start, score_end = cue['scoreStart'], cue['scoreEnd']
        good = (not word.get('repaired') and all(math.isfinite(t) for t in [start, end])
                and 0 <= start < end <= duration and .04 <= end-start <= 8
                and score_start is not None and score_end is not None and cue['tokens']
                and ((start > points[-1][0] and score_start > points[-1][1])
                     or (not events and start == score_start == 0))
                and (not events or start >= events[-1]['end']-.001))
        if not good:
            rejected += 1
            continue
        events.append(dict(start=start, end=end, scoreStart=score_start,
                           scoreEnd=score_end, text=cue['text'], tokens=cue['tokens']))
        if [start, score_start] != points[-1]:
            points.append([start, score_start])
    # Endpoint only describes the last audible word, never the unfinished score tail.
    if events:
        last = events[-1]
        if last['end'] > points[-1][0] and last['scoreEnd'] > points[-1][1]:
            points.append([last['end'], last['scoreEnd']])
    accepted = len(events) >= min(8, max(2, len(cues))) and len(events) >= len(cues)*.25
    return dict(method='qwen3-forced-aligner', version=1, accepted=accepted,
                audioSeconds=duration, scoreSeconds=score_seconds, points=points,
                events=events, totalWords=len(cues), rejectedWords=rejected,
                device='cpu', estimated=True)


def main():
    parser = argparse.ArgumentParser()
    for name in ['audio', 'score', 'root', 'lock']:
        parser.add_argument('--'+name, required=True)
    args = parser.parse_args()
    # Alignment is background CPU work; music generation keeps the single GPU.
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', CUDA_VISIBLE_DEVICES='')
    import numpy as np
    import torch
    from transformers import AutoProcessor, Qwen3ASRForTokenClassification
    from cover import ffmpeg, emit
    from model_files import verify_files
    score = json.loads(Path(args.score).read_text(encoding='utf-8'))
    cues = score['cues']
    if not cues or len(cues) > 3000:
        raise ValueError('当前歌词不适合自动时间对齐，请使用同步校正')
    entry = json.loads(Path(args.lock).read_text(encoding='utf-8'))['models'][0]
    model_path = Path(args.root) / 'models' / entry['name']
    verify_files(model_path, entry)
    with tempfile.TemporaryDirectory(prefix='yue-lyric-timing-') as folder:
        wav = Path(folder) / 'audio.wav'
        ffmpeg(['-protocol_whitelist', 'file,pipe', '-i', args.audio,
                '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(wav)])
        with wave.open(str(wav), 'rb') as stream:
            audio = np.frombuffer(stream.readframes(stream.getnframes()), dtype='<i2').astype(np.float32)/32768
    duration = len(audio)/16000
    if duration > 300:
        raise ValueError('超过 5 分钟的歌曲暂需手动同步校正')
    torch.set_num_threads(min(6, os.cpu_count() or 2))
    model = Qwen3ASRForTokenClassification.from_pretrained(str(model_path), dtype=torch.bfloat16,
                    local_files_only=True, attn_implementation='sdpa').eval()
    processor = AutoProcessor.from_pretrained(str(model_path), local_files_only=True)
    # Spaces keep frontend lyric units and model words in a one-to-one sequence,
    # including repeated verses and mixed Chinese/English lyrics.
    transcript = ' '.join(c['text'] for c in cues)
    inputs, word_lists = processor.prepare_forced_aligner_inputs(audio=audio, transcript=transcript)
    if word_lists[0] != [c['text'] for c in cues]:
        raise ValueError('歌词分词不一致，请使用同步校正')
    inputs = inputs.to('cpu', model.dtype)
    with torch.inference_mode():
        outputs = model(**inputs)
    stamps = processor.decode_forced_alignment(logits=outputs.logits, input_ids=inputs['input_ids'],
        word_lists=word_lists, timestamp_token_id=model.config.timestamp_token_id)[0]
    raw = outputs.logits.argmax(dim=-1)[0][inputs['input_ids'][0] == model.config.timestamp_token_id]
    raw = (raw.float()*processor.timestamp_segment_time/1000).tolist()
    for i, stamp in enumerate(stamps):
        # The official decoder interpolates out-of-order values. Those are not
        # measured word boundaries, so do not present them as vocal highlights.
        stamp['repaired'] = any(abs(stamp[key]-raw[i*2+j]) > .004
                                for j, key in enumerate(['start_time', 'end_time']))
    emit('result', result=assemble(stamps, cues, duration, score['seconds']))


if __name__ == '__main__':
    main()
