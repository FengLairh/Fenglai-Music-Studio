"""Local JSON-lines bridge. stdout = events; stderr = upstream diagnostics."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import sys
import time
import traceback


def emit(kind, **data):
    print(json.dumps({"type": kind, **data}, ensure_ascii=False), flush=True)


def probe():
    import torch
    import yue2
    import transformers
    result = {"python": sys.version.split()[0], "torch": torch.__version__, "transformers": transformers.__version__,
              "cuda": torch.cuda.is_available(), "platform": sys.platform, "bf16": False, "gpu": None, "visibleGpuCount": torch.cuda.device_count()}
    if result["cuda"]:
        props = torch.cuda.get_device_properties(0)
        result.update(gpu=props.name, vramGiB=round(props.total_memory / 2**30, 2), bf16=torch.cuda.is_bf16_supported())
        # Exercise an actual kernel; cuda.is_available alone misses incompatible wheels.
        x = torch.ones((32, 32), device="cuda", dtype=torch.bfloat16)
        float((x @ x).sum())
        torch.cuda.synchronize()
        result["kernelTest"] = True
    emit("result", result=result)


def download(root, lock_path):
    from model_files import download_models
    download_models(root, lock_path, emit)


def generate(root, request_file, output):
    import torch
    from yue2 import YuE2Pipeline
    from yue2.protocol import GenerationConfig
    if not torch.cuda.is_available() or not torch.cuda.is_bf16_supported():
        raise RuntimeError("需要支持 BF16 的 NVIDIA 显卡和可用的 CUDA 运行环境")
    request = json.loads(request_file.read_text(encoding="utf-8"))
    low = request["profile"] == "low-memory"
    total = torch.cuda.get_device_properties(0).total_memory / 2**30
    if total < 20 and not low:
        raise RuntimeError("当前显存不足标准预设要求，请在创作页选择「16GB 实验模式」。")
    emit("stage", stage="校验并加载模型")
    config = GenerationConfig.from_dict({"semantic": {"max_tokens": request["maxTokens"]}})
    last = [0.0]
    counts = {"abc": 0, "semantic": 0}

    def on_token(phase, token):
        counts[phase] = counts.get(phase, 0) + 1
        if time.monotonic() - last[0] > 1:
            last[0] = time.monotonic()
            emit("stage", stage="谱写旋律与和弦" if phase == "abc" else "生成音乐语义", tokens=counts[phase])

    # Pure torch eager avoids optional Linux-only vLLM/Triton dependencies on Windows.
    with YuE2Pipeline.from_pretrained(str(root / "models" / "YuE2-3B"),
            vae=str(root / "models" / "YuE2-Vae"), device="cuda", backend="torch-eager",
            memory_budget_gib=min(16 if low else 24, total), offload_ar=low,
            vae_core_frames=256 if low else 1024, generation_config=config,
            local_files_only=True, progress=True) as pipe:
        song = pipe(style=request["style"], lyrics=request["lyrics"], cot=request["cot"],
                    seed=request["seed"], abc=request.get("abc") or None, on_token=on_token)
        emit("stage", stage="保存音频与乐谱")
        result = song.save_artifacts(output)
        song.save(output / "audio.wav")
        emit("result", result={"seconds": result["audio_seconds"], "sampleRate": result["sample_rate"],
                               "truncated": result["truncated"], "identity": result["identity"]})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["probe", "download", "generate"])
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--lock", type=Path)
    parser.add_argument("--request", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    os.environ["HF_HOME"] = str(args.root / "cache" / "huggingface")
    os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    if args.command == "generate":
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    try:
        if args.command == "probe": probe()
        elif args.command == "download": download(args.root, args.lock)
        else: generate(args.root, args.request, args.output)
    except Exception as error:
        message = str(error)
        if "out of memory" in message.lower():
            message = "显存不足。请关闭其他 GPU 应用、选择 16GB 实验模式并降低 token 上限。16GB 不保证能完成生成。\n" + message
        emit("error", message=message)
        traceback.print_exc(file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
