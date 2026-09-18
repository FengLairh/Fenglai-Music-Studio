"""CPU-only, local score/audio timing. No model, network or audio modification."""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import tempfile
import wave
import numpy as np
from scipy import signal, ndimage

STEP = 0.12


def normalize(x):
    return x / np.maximum(np.linalg.norm(x, axis=1, keepdims=True), 1e-8)


def audio_features(samples, sr):
    hop = round(sr * STEP)
    _, times, spectrum = signal.stft(samples, sr, nperseg=4096, noverlap=4096-hop,
                                     boundary='zeros', padded=True)
    magnitude = np.abs(spectrum).T
    # Local spectral whitening limits drums and broad-band energy in the mix.
    magnitude = np.maximum(magnitude - ndimage.median_filter(magnitude, size=(1, 17)), 0)
    frequencies = np.fft.rfftfreq(4096, 1/sr)
    usable = (frequencies >= 80) & (frequencies < 4000)
    midi = np.rint(69 + 12*np.log2(np.maximum(frequencies, 1)/440)).astype(int)
    chroma = np.stack([np.sum(magnitude[:, usable & (midi % 12 == pc)], axis=1)
                       for pc in range(12)], axis=1)
    chroma = np.sqrt(chroma)
    # Remove the persistent backing harmony shared by adjacent notes.
    chroma = np.maximum(chroma - .55*ndimage.median_filter(chroma, size=(41, 1)), 0)
    return times, normalize(chroma)


def score_features(score):
    seconds = float(score['seconds'])
    if not math.isfinite(seconds) or not 0 < seconds <= 1200:
        raise ValueError('乐谱时长无法进行音频同步分析')
    times = np.arange(0, seconds + STEP, STEP)
    chroma = np.zeros((len(times), 12), dtype=np.float32)
    for voice in ('Vocal', 'Ins'):
        for onset, duration, midi in score['voices'].get(voice, []):
            if not all(math.isfinite(x) for x in (onset, duration, midi)):
                raise ValueError('音符时间无效')
            active = (times >= onset) & (times < onset + duration)
            # Both voices are useful during introductions/instrumental breaks.
            weight = 1.0 if voice == 'Vocal' else .8
            for partial, gain in ((0, 1), (7, .2), (4, .07)):
                chroma[active, (round(midi)+partial) % 12] += weight*gain
    return times, normalize(chroma)


def match(audio, score):
    """Slope-bounded, open-ended DTW; never force a cut-off song to the score end."""
    n, m = len(audio), len(score)
    cost = np.maximum(0, 1 - audio @ score.T).astype(np.float32)
    silent = np.linalg.norm(score, axis=1) < .1
    cost[:, silent] = .65
    # Each transition advances time in both domains. No arbitrary frozen notes.
    older = np.full(m, np.inf, dtype=np.float32)
    previous = older.copy()
    back = np.zeros((n, m), dtype=np.uint8)
    for i in range(n):
        a = np.r_[np.inf, previous[:-1]]
        b = np.r_[np.inf, np.inf, previous[:-2]] + .09
        c = np.r_[np.inf, older[:-1]] + .09
        choices = np.stack((a, b, c))
        direction = np.argmin(choices, axis=0)
        row = choices[direction, np.arange(m)] + cost[i]
        # Small pickup/silence offsets are allowed; not a skip to a later chorus.
        if i <= round(8/STEP):
            row[0] = cost[i, 0] + i*.13
        if i == 0:
            limit = min(m, round(3/STEP))
            row[:limit] = cost[0, :limit] + np.arange(limit)*.13
        back[i] = direction
        older, previous = previous, row
    # Path length changes with tempo; compare average rather than raw cost.
    ends = np.arange(m)
    length = (n + ends + 1)/2
    valid = (ends >= n*.48) & (ends <= n*2.05)
    rank = np.where(valid, previous/length, np.inf)
    j = int(np.argmin(rank)); i = n-1
    pairs = []
    while i >= 0 and j >= 0:
        pairs.append((i, j))
        if not i or not j:
            break
        direction = back[i, j]
        i -= 2 if direction == 2 else 1
        j -= 2 if direction == 1 else 1
    pairs.reverse()
    return np.asarray(pairs), cost


def align(samples, sr, score):
    seconds = len(samples)/sr
    if seconds < 2 or seconds > 601 or np.max(np.abs(samples)) < .0001:
        raise ValueError('音频过短、过长或接近静音，无法分析同步位置')
    at, af = audio_features(samples, sr)
    st, sf = score_features(score)
    pairs, cost = match(af, sf)
    ai, si = pairs[:, 0], pairs[:, 1]
    usable = np.linalg.norm(sf[si], axis=1) > .1
    similarity = float(np.mean(1-cost[ai[usable], si[usable]])) if np.any(usable) else 0
    # Compare against a wrong chroma rotation to avoid calling flat/noisy audio matched.
    wrong = np.max(np.stack([np.sum(af[ai]*np.roll(sf[si], shift, axis=1), axis=1)
                            for shift in (3, 5, 6)]), axis=0)
    margin = float(np.mean((1-cost[ai, si]-wrong)[usable])) if np.any(usable) else 0
    accepted = similarity >= .48 and margin >= .04 and np.count_nonzero(usable) >= 20
    points = [[round(float(at[a]), 4), round(float(st[s]), 4)] for a, s in pairs if at[a] <= seconds]
    return {'version': 1, 'method': 'audio-chroma-dtw', 'accepted': bool(accepted),
            'confidence': round(similarity, 4), 'margin': round(margin, 4),
            'audioSeconds': seconds, 'scoreSeconds': score['seconds'], 'points': points,
            'matchedScoreEnd': points[-1][1] if points else 0}


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--audio', type=Path, required=True)
    p.add_argument('--score', type=Path, required=True)
    args = p.parse_args()
    from cover import ffmpeg
    with tempfile.TemporaryDirectory(prefix='yue-score-sync-') as folder:
        wav = Path(folder)/'audio.wav'
        ffmpeg(['-protocol_whitelist', 'file,pipe', '-i', str(args.audio.resolve()),
                '-map', '0:a:0', '-vn', '-t', '601', '-ac', '1', '-ar', '16000',
                '-c:a', 'pcm_s16le', str(wav)])
        with wave.open(str(wav), 'rb') as f:
            samples = np.frombuffer(f.readframes(f.getnframes()), dtype='<i2').astype(np.float32)/32768
            result = align(samples, f.getframerate(), json.loads(args.score.read_text(encoding='utf-8')))
    print(json.dumps({'type': 'result', 'result': result}), flush=True)


if __name__ == '__main__':
    main()
