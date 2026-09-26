# Fenglai Music Studio

<p align="center"><img src="ui/assets/fenglai-icon.png" width="104" alt="Fenglai icon"></p>
<p align="center"><strong>From an idea, lyrics and a score to local music generation and covers.</strong></p>
<p align="center"><a href="README.md">简体中文</a> · English · <a href="docs/SHOWCASE.en.md">Showcase</a></p>

A Windows desktop music workstation built around YuE2, combining composition, song adaptation, voice conversion, editable notation and playback. This is an independent integration, not an official YuE desktop release. The application UI is currently primarily Chinese.

![Composition workspace](docs/showcase/create.png)

## Features

### 0.11.0: instrumental generation and covers

Composition and cover workspaces now offer Song / Instrumental output. Instrumental mode keeps lyric drafts but excludes them from singing. Official tools transfer reference melodies into the instrumental voice; without a score, YuE2 plans one first. Harmony preservation is optional. The existing Windows single-GPU engine and model weights are reused. The official music skill is pinned to **1.2.0 / 72272f9**. A real reference-score GPU run produced 49.76 seconds of 48 kHz audio without reported truncation; score-transfer invariants passed. Model-planning integration was tested with a stub, not a new end-to-end GPU planning run. Audio quality and absence of vocals have not been human-reviewed. Duration may differ from score duration.

| Workspace | Capabilities |
| --- | --- |
| Compose | Theme, style, lyrics and ABC score inputs with optional inline DeepSeek assistance |
| Score editor | Pitch, duration, rests, ties and bars; direct lyric editing, undo/redo and Chinese pronunciation hints |
| Song covers | Draggable waveform selection, score extraction, style/lyric adaptation, lyrics-only and lyrics-and-score modes |
| Voice covers | Uploaded voice references, five voice presets and optional AI voice design |
| Lyrics and timing | Qwen ASR transcription, automatic post-generation alignment and score-following playback |
| Player and library | Shared player, full-width hover seek bar, scrolling lyrics, history, export and task drawer |
| Settings | Single-GPU selection, environment status, missing-component installation, themes and backgrounds |

See the [English showcase](docs/SHOWCASE.en.md) or [中文展示](docs/SHOWCASE.zh-CN.md). Screenshots use demonstration drafts, not private songs or account data.

## Run from source

This repository includes source code and frontend assets. **Model weights, Python runtimes and a complete offline distribution are not included.**

Requirements: Windows 10/11 x64, Node.js 24, npm and Git.

```powershell
git clone https://github.com/FengLairh/Fenglai-Music-Studio.git
cd Fenglai-Music-Studio
npm ci
node scripts/bootstrap-tools.cjs
npm start
```

Open Settings, select a GPU and install missing environments and models. Initial setup needs network access and sufficient disk space. Then create a composition or import audio into a cover workspace.

Audio models run locally on the selected single NVIDIA GPU; VRAM is not pooled across GPUs. Requirements vary with model, duration and configuration. The UI can open independently, but generation requires a compatible NVIDIA CUDA environment. Installation alone does not validate every generation workload.

DeepSeek is an optional cloud assistant requiring your own official API key. Requests send relevant text, scores and creative instructions, not raw audio. Dependency installation, model downloads and cloud assistance require network access.

## Expectations and limitations

- Lyrics-only covers lock the score and use the original style, ignoring the new-style field. Audio is still regenerated; this does not preserve the original accompaniment waveform or guarantee the original singer.
- Voice covers use a separate conversion model and remix separated accompaniment. Quality depends on separation and reference recordings; noise or source-voice remnants can occur.
- Audio/score alignment is an estimate. Unreliable positions are not forcibly highlighted; manual correction is available.
- Chinese polyphonic-character controls guide synthesis with confirmed homophones, rather than enforcing phonemes. Listen to verify pronunciation.

## Development

```powershell
npm test
npm run dist
```

Default tests need no model weights and do not evaluate real-GPU generation or singing quality. Bootstrap tools before packaging. Desktop/audio integration tests require additional local fixtures and environments and are not part of the clean-clone default command.

| Directory | Contents |
| --- | --- |
| ui/ | Desktop interface and score editor |
| desktop/ | Electron services and task management |
| backend/ | Python audio adapters |
| vendor/ | Pinned upstream code and official music skill snapshot |
| licenses/ | Third-party notices |
| *.lock.json | Model revisions and file verification |

Runtime data defaults to adjacent `data/`; set `YUE_DATA_DIR` to override it. Never commit songs, drafts, source audio, weights, runtimes or credentials. A complete offline package needs separately prepared models and environments; this repository does not claim to provide a downloadable offline release.

## Upstream and licenses

- Pinned YuE source: `88da114a67df892af0329472073b96a5ef700b93`. Official skill provenance: `vendor/yue2-music-skill/skill.lock.json`.
- Desktop integration: [Apache-2.0](LICENSE). Third-party code and models retain their own terms.
- The pinned YuE2 / SheetSage2 / MERT weights carry noncommercial terms; see the bundled [model license](licenses/YuE2-MODEL_LICENSE) and model manifests. Source licensing does not grant commercial rights to weights.
- Seed-VC and `backend/voice.py` use GPL-3.0-family terms; see [voice component notices](licenses/VOICE-THIRD-PARTY.md).
- Lyric transcription uses Qwen ASR. Seed-VC separately uses a Whisper content encoder, not for lyric transcription.

Thanks to [YuE](https://github.com/multimodal-art-projection/YuE), Seed-VC, Qwen, DeepSeek, ABCJS, Electron and their contributors. Full notices remain in [licenses/](licenses/) and upstream snapshots.

