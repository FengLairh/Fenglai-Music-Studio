# Cover 第三方组件

- SheetSage2 / MERT-v2-FullSong：m-a-p 官方 Hugging Face 仓库。模型与源码版本、逐文件哈希见 `cover-models.lock.json`。许可证及第三方声明保存在本目录对应文件中。
- imageio-ffmpeg 0.6.0：BSD 2-Clause Python 包装器，来自官方 PyPI wheel，许可证 `imageio-ffmpeg-LICENSE`。
- FFmpeg 7.1 essentials Windows build：由 imageio-ffmpeg 0.6.0 win_amd64 wheel 捆绑；使用该 wheel 原始二进制，没有修改。FFmpeg SHA-256：`2ce797a0f88d7f067180338fb227f7b1928ea727bd9a4d7a1d022f7c52af71a3`。二进制的 GPLv3 许可证见 `FFmpeg-GPLv3.txt`。构建提供者 https://www.gyan.dev/ffmpeg/builds/；FFmpeg 7.1 源码 https://ffmpeg.org/releases/ffmpeg-7.1.tar.xz；构建配置随二进制的 `-buildconf` 可查看。imageio 构建脚本 https://github.com/imageio/imageio-ffmpeg/tree/v0.6.0。
- Python、PyTorch、torchaudio、transformers 等运行依赖保留各自 site-packages / dist-info 下的 LICENSE 文件；全部版本见 `docs/cover-runtime-freeze.txt`。

模型权重为 CC BY-NC 4.0。桌面项目代码使用 Apache-2.0，不改变上游组件的许可证。
