"""Bounded, zero-phase preparation and singing-envelope restoration."""
import numpy as np
from scipy.ndimage import uniform_filter1d, maximum_filter1d
from scipy.signal import butter, sosfiltfilt


def frame_envelope(wave, sr):
    hop = max(1, round(sr * .01))
    padded = np.pad(np.asarray(wave, dtype=np.float64), (0, (-len(wave)) % hop))
    energy = np.mean(padded.reshape(-1, hop)**2, axis=1)
    return np.sqrt(uniform_filter1d(energy, size=7, mode='nearest') + 1e-12), hop


def highpass(wave, sr):
    # 45 Hz leaves low male fundamentals intact; zero phase adds no timing offset.
    return sosfiltfilt(butter(2, 45, 'highpass', fs=sr, output='sos'), wave, axis=0).astype('float32')


def prepare_reference(wave, sr):
    mono = highpass(wave.mean(axis=1) if wave.ndim > 1 else wave, sr)
    env, hop = frame_envelope(mono, sr)
    threshold = max(1e-4, float(np.quantile(env, .9)) * .04)
    active = np.flatnonzero(env > threshold)
    if not len(active) or len(active)*.01 < 1.:
        raise ValueError('目标声音中有效声音不足 1 秒，请选择连续、清晰的说话或清唱片段')
    start = max(0, int(active[0]*hop-sr*.15))
    end = min(len(mono), int((active[-1]+1)*hop+sr*.15))
    rms = float(np.sqrt(np.mean(env[active]**2)))
    gain = min(float(np.clip(.1/max(rms, 1e-6), .25, 4.)), .95/max(float(np.abs(mono).max()),1e-6))
    return mono[start:end]*gain, {'activeSeconds': float(len(active)*.01), 'gainDb': float(20*np.log10(gain)),
                                  'trimStartSeconds': start/sr, 'trimEndSeconds': (len(mono)-end)/sr}


def restore_performance(converted, source, sr):
    """Restore sung dynamics without mixing the original singer into the result."""
    if len(converted) != len(source): raise ValueError('人声强弱匹配需要相同的音轨时长')
    converted = highpass(converted, sr)
    original = highpass(source, sr)
    src, hop = frame_envelope(original, sr)
    dst, _ = frame_envelope(converted, sr)
    threshold = max(1e-5, float(np.quantile(src, .95)) * .012)
    # Keep consonants and breath tails around active singing; suppress only clear gaps.
    activity = np.clip((src-threshold*.25)/(threshold*.75), 0., 1.)
    activity = uniform_filter1d(maximum_filter1d(activity, size=21, mode='nearest'), size=9, mode='nearest')
    ratio = np.clip((src / np.maximum(dst, threshold*.1))**.85, .125, 1.5)
    ratio = uniform_filter1d(ratio, size=9, mode='nearest') * activity
    centers = np.arange(len(ratio))*hop + hop*.5
    gain = np.interp(np.arange(len(source)), centers, ratio).astype('float32')
    restored = converted * gain
    quiet = src < threshold*.25
    return restored, {'envelopeMatch': True, 'quietSeconds': float(np.count_nonzero(quiet)*.01),
                      'meanGainDb': float(20*np.log10(max(float(np.sqrt(np.mean(gain**2))),1e-9))),
                      'maximumGainDb': float(20*np.log10(max(float(gain.max()),1e-9)))}


def conversion_regions(wave, sr):
    """Prefer quiet phrase boundaries; supply surrounding context during inference."""
    env, hop = frame_envelope(wave, sr)
    cuts=[0]; total=len(wave)
    while total-cuts[-1] > sr*20:
        left = cuts[-1]+sr*16; right=cuts[-1]+sr*19
        a=round(left/hop); b=min(len(env),round(right/hop))
        cuts.append(int((a+np.argmin(env[a:b]))*hop))
    cuts.append(total)
    # Only 80 ms is blended; half-second context protects syllable edges.
    return [(max(0,a-round(sr*.04)) if i else a,
             min(total,b+round(sr*.04)) if i<len(cuts)-2 else b)
            for i,(a,b) in enumerate(zip(cuts[:-1],cuts[1:]))]
