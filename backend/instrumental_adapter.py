"""Windows single-GPU adapter for the pinned official instrumental conversion tools."""
import json
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent / 'vendor' / 'yue2-music-skill' / 'instrumental' / 'scripts'

def prepare_instrumental(pipe, request, output, emit):
    sys.path.insert(0, str(TOOLS))
    from instrumentalize import convert_score
    from instrumental import validate_score, lyric_tags
    output.mkdir(parents=True, exist_ok=True)
    style = 'Instrumental, no vocals, no singing, no choir, ' + request['style']
    abc = request.get('abc')
    if not abc:
        emit('stage', stage='YuE2 正在谱写纯音乐旋律')
        plan = pipe.plan(style=style, lyrics='[Intro]\n\n[Verse]\n\n[Chorus]\n\n[Outro]\n', cot='full', seed=request['seed'])
        plan.save(output / 'planning')
        if plan.truncated or not plan.abc:
            raise ValueError('纯音乐规划未完成，已保留原始规划，请重试')
        abc = plan.abc
    emit('stage', stage='将参考旋律转为器乐声部并校验')
    converted, report = convert_score(abc, keep_chords=request.get('keepHarmony', False), overlap='vocal')
    validate_score(converted)
    if len(pipe.tokenizer.encode(converted)) > 4096:
        raise ValueError('转轨后的乐谱超过 4096 token，请精简谱面后重试')
    (output / 'original.abc').write_text(abc, encoding='utf-8')
    (output / 'instrumental-transfer.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return {**request, 'style':style, 'abc':converted, 'lyrics':lyric_tags(converted), 'cot':'full' if request.get('keepHarmony') else 'melody'}
