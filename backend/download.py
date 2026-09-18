"""Bounded, resumable public-file downloader with verified HTTP byte ranges."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import os
import threading
import time
import urllib.request


def download_file(url, destination, size, report=lambda n, total: None, chunk_size=8*1024*1024, workers=6):
    destination=Path(destination)
    destination.parent.mkdir(parents=True,exist_ok=True)
    if destination.is_file() and destination.stat().st_size==size:
        report(size,size); return
    parts=destination.parent/'.parts'/destination.name
    parts.mkdir(parents=True,exist_ok=True)
    completed=[0]; lock=threading.Lock()

    def part(index):
        start=index*chunk_size; end=min(start+chunk_size,size)-1; length=end-start+1
        file=parts/f'{index:06d}.part'
        if not file.is_file() or file.stat().st_size!=length:
            for attempt in range(4):
                try:
                    request=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}','User-Agent':'YuE-Studio/0.1','Accept-Encoding':'identity'})
                    with urllib.request.urlopen(request,timeout=30) as response:
                        if response.status==206:
                            expected=f'bytes {start}-{end}/{size}'
                            if response.headers.get('Content-Range')!=expected: raise ValueError('下载服务器返回错误的文件区间')
                        elif not (response.status==200 and start==0 and end==size-1):
                            raise ValueError('下载服务器不支持分段请求')
                        remaining=length
                        with file.open('wb') as output:
                            while remaining:
                                block=response.read(min(1024*1024,remaining))
                                if not block: raise IOError('下载连接提前结束')
                                output.write(block); remaining-=len(block)
                    break
                except Exception:
                    if attempt==3: raise
                    time.sleep(min(2**attempt,4))
        with lock:
            completed[0]+=length; report(completed[0],size)
        return file

    count=(size+chunk_size-1)//chunk_size
    with ThreadPoolExecutor(max_workers=min(workers,count)) as pool:
        futures=[pool.submit(part,i) for i in range(count)]
        for future in as_completed(futures): future.result()
    temp=destination.with_name(destination.name+'.assembling')
    with temp.open('wb') as output:
        for i in range(count):
            with (parts/f'{i:06d}.part').open('rb') as source:
                while block:=source.read(8*1024*1024): output.write(block)
    if temp.stat().st_size!=size: raise ValueError('合并后的下载文件大小不正确')
    os.replace(temp,destination)
    for i in range(count): (parts/f'{i:06d}.part').unlink()
    parts.rmdir()
