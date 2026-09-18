"""Generate a fictional target timbre locally; never synthesizes the target song."""
import argparse
import json
import os
import sys
import time
from pathlib import Path
from cover import emit, ffmpeg
from model_files import verify_files

TEXT = '今天的阳光照在窗前，微风轻轻吹过树梢。我们沿着小路慢慢向前，看见远处的山和清澈的河流。请听我的声音，平静自然，每一个字都清楚明亮。'

def load_runtime():
    import torch
    import transformers
    from qwen_tts import Qwen3TTSModel
    if not torch.cuda.is_available() or torch.cuda.device_count()!=1: raise ValueError('AI 音色设计需要单张 NVIDIA 显卡')
    torch.set_num_threads(min(8, os.cpu_count() or 4))
    return torch, transformers, Qwen3TTSModel

def main():
    p=argparse.ArgumentParser();p.add_argument('command',choices=['probe','generate'])
    for key in ['root','lock','request','output']:p.add_argument('--'+key,type=Path,required=key=='root')
    args=p.parse_args()
    os.environ.setdefault('CUDA_VISIBLE_DEVICES','0')
    os.environ.update(CUDA_DEVICE_ORDER='PCI_BUS_ID',HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1',HF_HUB_DISABLE_TELEMETRY='1')
    torch,transformers,Qwen3TTSModel=load_runtime()
    info={'engine':'qwen3-voice-design','python':sys.version.split()[0],'torch':torch.__version__,'transformers':transformers.__version__,'gpu':torch.cuda.get_device_name(0),'visibleGpuCount':1}
    if args.command=='probe':return emit('result',result=info)
    import numpy as np
    import soundfile as sf
    request=json.loads(args.request.read_text(encoding='utf-8'))
    instruct=request.get('instruct');seed=request.get('seed',42)
    if not isinstance(instruct,str) or not 1<=len(instruct.strip())<=500:raise ValueError('请用 1–500 字描述目标音色')
    if type(seed)!=int or not 0<=seed<=2147483647:raise ValueError('无效的音色种子')
    entry=json.loads(args.lock.read_text(encoding='utf-8'))['models'][0]
    if entry['repo']!='Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign':raise ValueError('需要千问官方 VoiceDesign 模型')
    model_path=args.root/'models'/entry['name'];emit('stage',stage='校验 AI 音色设计模型');verify_files(model_path,entry)
    args.output.mkdir(parents=True,exist_ok=True);torch.manual_seed(seed);np.random.seed(seed);started=time.monotonic()
    emit('stage',stage='加载千问音色设计 · 单显卡')
    model=Qwen3TTSModel.from_pretrained(str(model_path),device_map='cuda:0',dtype=torch.bfloat16,attn_implementation='sdpa',local_files_only=True)
    emit('stage',stage='根据描述生成目标音色试听')
    with torch.inference_mode():
        wavs,sr=model.generate_voice_design(text=TEXT,language='Chinese',instruct=instruct.strip()+'。单人、清晰干声，自然音量，平静表达，没有背景音乐或环境噪声。',max_new_tokens=420,do_sample=True,temperature=.8)
    audio=np.asarray(wavs[0],dtype='float32').reshape(-1)
    audio=audio[:int(sr*22)]
    if len(audio)<sr*5 or not np.isfinite(audio).all() or np.sqrt(np.mean(audio**2))<.0001:raise ValueError('没有产生有效音色试听，请调整描述后重试')
    audio*=min(1.,.92/max(float(np.max(np.abs(audio))),1e-9))
    raw=args.output/'designed.wav';sf.write(str(raw),audio,sr,subtype='PCM_24')
    ffmpeg(['-protocol_whitelist','file,pipe','-i',str(raw),'-ar','48000','-ac','2','-c:a','pcm_s16le',str(args.output/'source.wav')])
    result={**info,'seconds':len(audio)/sr,'sampleRate':48000,'channels':2,'instruct':instruct.strip(),'seed':seed,'modelIdentity':{entry['repo']:entry['revision']},'elapsedSeconds':time.monotonic()-started,'peakGpuMiB':torch.cuda.max_memory_allocated()/2**20,'synthetic':True}
    (args.output/'design.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');emit('result',result=result)

if __name__=='__main__':
    try:main()
    except Exception as error:emit('error',message=str(error));sys.exit(1)
