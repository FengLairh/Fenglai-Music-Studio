"""Download only locked public model assets; validate size and repository hashes."""
import hashlib
import json
from pathlib import Path
import time


def verify_files(target, entry):
    identities = {}
    for item in entry['sizes']:
        file = target / item['name']
        if not file.is_file() or file.stat().st_size != item['bytes']:
            raise ValueError(f"下载文件不完整: {item['name']}")
        digest = hashlib.sha256()
        blob = hashlib.sha1(f"blob {item['bytes']}\0".encode())
        with file.open('rb') as stream:
            for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
                digest.update(block); blob.update(block)
        if item.get('sha256') and digest.hexdigest() != item['sha256']:
            raise ValueError(f"模型 SHA-256 不匹配: {item['name']}")
        if not item.get('sha256') and item.get('gitBlob') and blob.hexdigest() != item['gitBlob']:
            raise ValueError(f"配置文件 Git blob 不匹配: {item['name']}")
        identities[item['name']] = {'sha256': digest.hexdigest(), 'bytes': item['bytes']}
    return identities


def download_models(root, lock_path, emit):
    import os
    from download import download_file
    lock = json.loads(lock_path.read_text(encoding='utf-8'))
    for entry in lock['models']:
        emit('stage', stage=f"下载 {entry['name']}")
        target = root / 'models' / entry['name']
        endpoint=os.environ.get('HF_ENDPOINT','https://huggingface.co')
        if endpoint not in {'https://huggingface.co','https://hf-mirror.com'}:
            raise ValueError('下载源不在允许列表中')
        for item in entry['sizes']:
            file=target/item['name']
            # A corrupt file of the correct size must not trap all subsequent retries.
            if file.is_file() and file.stat().st_size==item['bytes']:
                try: verify_files(target,{'sizes':[item]})
                except ValueError: file.replace(file.with_name(file.name+'.corrupt'))
            url=item.get('url') or f"{endpoint}/{entry['repo']}/resolve/{entry['revision']}/{item['name']}?download=true"
            if item.get('url') and not url.startswith('https://dl.fbaipublicfiles.com/demucs/'):
                raise ValueError('外部模型下载源不在允许列表中')
            last=[0.0]
            def report(done,total):
                if time.monotonic()-last[0]>1 or done==total:
                    last[0]=time.monotonic()
                    emit('stage',stage=f"{entry['name']} · {item['name']} · {done/2**20:.0f} / {total/2**20:.0f} MiB",downloaded=done,total=total)
            download_file(url,file,item['bytes'],report)
        emit('stage', stage=f"校验 {entry['name']}")
        identity = verify_files(target, entry)
        marker = {'revision': entry['revision'], 'identity': identity, 'verifiedAt': time.time()}
        temp = target / '.ready.tmp'
        temp.write_text(json.dumps(marker), encoding='utf-8')
        temp.replace(target / '.ready.json')
    emit('result', result={'downloaded': True})


if __name__ == '__main__':
    import sys
    def emit(kind, **data): print(json.dumps({'type': kind, **data}, ensure_ascii=False), flush=True)
    download_models(Path(sys.argv[1]), Path(sys.argv[2]), emit)
