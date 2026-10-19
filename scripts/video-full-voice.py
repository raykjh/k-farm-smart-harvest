"""Render non-cloned English narration locally; no paid inference or upload."""
from pathlib import Path
import json
import re
import sys
import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

root = Path(__file__).resolve().parents[1]
revision = next((v.split('=', 1)[1] for v in sys.argv[1:] if v.startswith('--revision=')), '')
voice = next((v.split('=', 1)[1] for v in sys.argv[1:] if v.startswith('--voice=')), 'af_heart')
assert voice in ('af_heart', 'am_adam', 'am_michael'), 'Use a stock, non-cloned voice'
sample = '--sample' in sys.argv[1:]
assert not revision or re.fullmatch(r'v[2-9][0-9]*', revision)
folder = root / '.data/video-capture-20261018/full-take-01' / (('voice-' + revision if revision else 'voice') + ('-sample' if sample else ''))
folder.mkdir(exist_ok=False)
text = (root / 'docs/demo-video-narration-en.txt').read_text(encoding='utf-8')
chapters = [s.strip() for s in re.split(r'\n\s*\n', text) if s.strip()]
assert len(chapters) == 6
if sample:
    chapters = chapters[:1]
options = ort.SessionOptions()
options.intra_op_num_threads = 3
options.inter_op_num_threads = 1
model = root / '.data/video-tools/models/kokoro-v1.0.onnx'
voices = model.parent / 'voices-v1.0.bin'
tts = Kokoro.from_session(ort.InferenceSession(str(model), options, providers=['CPUExecutionProvider']), str(voices))
result = {'model': 'Kokoro-82M v1.0', 'voice': voice, 'voiceClone': False, 'paidCalls': 0, 'chapters': []}
for i, paragraph in enumerate(chapters):
    parts, timings, cursor = [], [], 0.0
    for sentence in re.split(r'(?<=[.!?])\s+', paragraph):
        samples, rate = tts.create(sentence, voice=voice, speed=0.95, lang='en-us')
        end = cursor + len(samples) / rate
        timings.append({'start': cursor, 'end': end, 'text': sentence})
        parts.extend([samples, np.zeros(round(rate * 0.18), dtype=np.float32)])
        cursor = end + 0.18
    audio = np.concatenate(parts)
    sf.write(folder / f'chapter-{i+1}.wav', audio, rate, subtype='PCM_16')
    result['chapters'].append({'index': i+1, 'seconds': len(audio)/rate, 'text': paragraph, 'segments': timings})
    print(json.dumps({'chapter': i+1, 'seconds': len(audio)/rate}), flush=True)
(folder / 'voice.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
