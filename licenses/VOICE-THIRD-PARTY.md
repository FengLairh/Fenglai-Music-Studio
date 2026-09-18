# Voice conversion component notices

The desktop invokes the voice conversion adapter in a separate local Python process. All model loading uses pinned local assets; the model and configuration hashes are recorded in `voice-models.lock.json`.

- Seed-VC: https://github.com/Plachtaa/seed-vc, commit `51383efd921027683c89e5348211d93ff12ac2a8`. Source license: GPL-3.0, reproduced in `SEED-VC-GPL-3.0.txt` and the vendored source. The unmodified upstream inference implementation is included with the application. `backend/voice.py` is provided as GPL-3.0-or-later source; it redirects model loading to pinned local files, bounds audio chunks, and mixes the output with separated accompaniment.
- Seed singing checkpoint and configuration: https://huggingface.co/Plachta/Seed-VC, revision `257283f9f41585055e8f858fba4fd044e5caed6e`. The upstream repository distributes pretrained weights separately from its code.
- NVIDIA BigVGAN: https://huggingface.co/nvidia/bigvgan_v2_44khz_128band_512x, revision `95a9d1dcb12906c03edd938d77b9333d6ded7dfb`. Its MIT LICENSE and model card are included in the model directory. Seed-VC includes its compatible BigVGAN implementation.
- Whisper-small: https://huggingface.co/openai/whisper-small. Its model card declares Apache-2.0 and is included in the model directory. This application uses the content encoder, not lyric transcription.
- CAMPPlus: https://huggingface.co/funasr/campplus, revision `e4b6ede7ce16997aff4ae69fbca1f0175e2afede`. Its included model card declares Apache-2.0.
- RMVPE: `rmvpe.pt` from https://huggingface.co/lj1995/VoiceConversionWebUI at revision `e6d0c1a17da07c33557852f9dfa2bd44cc75737d`, the source referenced by Seed-VC. No separate weight license is asserted by this package.
- Demucs 4.0.1: https://github.com/facebookresearch/demucs. Source license: MIT, reproduced in `DEMUCS-LICENSE.txt`. Official HTDemucs FT vocal-specialist checkpoint (fourth entry of the official htdemucs_ft ensemble): https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/04573f0d-f3cf25b2.th, SHA-256 `f3cf25b222c4eed7cd49dd8b2c9597d50c18bd154090f7b919cfa5f93cf22c49`.
- FFmpeg is supplied by the pinned imageio-ffmpeg wheel; see the existing FFmpeg and imageio notices. Other Python distributions retain their LICENSE / metadata under `voice-runtime/python/.../Lib/site-packages`.

The full editable adapter sources and upstream sources are included alongside the executable resources. User reference recordings and converted songs are not distributed. The existing YuE2 model restrictions continue to apply to the music generation component.
