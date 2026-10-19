"""Local, non-cloned English narration for the recording readiness sample."""
from pathlib import Path
import hashlib
import json
import numpy as np
import onnxruntime as ort
import soundfile as sf
from kokoro_onnx import Kokoro

root = Path(__file__).resolve().parents[1]
folder = root / '.data' / 'video-capture-20261018'
model = root / '.data' / 'video-tools' / 'models' / 'kokoro-v1.0.onnx'
voices = model.parent / 'voices-v1.0.bin'
assert folder.joinpath('preparation.json').exists(), 'Prepare and verify recording DB first'
assert not folder.joinpath('voice-raw.wav').exists(), 'Do not overwrite an earlier voice sample'
options = ort.SessionOptions()
options.intra_op_num_threads = 4
options.inter_op_num_threads = 1
session = ort.InferenceSession(str(model), options, providers=['CPUExecutionProvider'])
tts = Kokoro.from_session(session, str(voices))
segments = [
    'K-Farm connects small farms through local centers.',
    'NVIDIA Nemotron, through Nebius Token Factory, helps plan crops, equipment, and labor.',
    'Staff review the plan and confirm it.',
    'This is a recording test using fictional applicants and resources.'
]
parts, timings, cursor = [], [], 0.0
rate = 24000
for text in segments:
    samples, rate = tts.create(text, voice='af_heart', speed=0.95, lang='en-us')
    start = cursor
    cursor += len(samples) / rate
    timings.append({'start': round(start, 4), 'end': round(cursor, 4), 'text': text})
    parts.extend([samples, np.zeros(round(rate * 0.18), dtype=np.float32)])
    cursor += 0.18
audio = np.concatenate(parts)
sf.write(folder / 'voice-raw.wav', audio, rate, subtype='PCM_16')
info = {
    'model': 'Kokoro-82M v1.0', 'voice': 'af_heart', 'language': 'en-US',
    'modelLicense': 'Apache-2.0', 'runtimeLicense': 'MIT',
    'modelSource': 'https://huggingface.co/hexgrad/Kokoro-82M',
    'runtimeSource': 'https://github.com/thewh1teagle/kokoro-onnx',
    'modelSha256': hashlib.sha256(model.read_bytes()).hexdigest(),
    'voicesSha256': hashlib.sha256(voices.read_bytes()).hexdigest(),
    'voiceClone': False, 'paidCalls': 0, 'audioRate': rate,
    'rawSeconds': len(audio)/rate, 'peak': float(np.max(np.abs(audio))),
    'segments': timings,
    'disclosure': 'Synthetic narration. Real application footage. Recording test only.'
}
folder.joinpath('voice.json').write_text(json.dumps(info, indent=2), encoding='utf-8')
print(json.dumps({k:info[k] for k in ['model','voice','rawSeconds','peak','paidCalls']}))
