"""British English clips, written before the trainer tops up with its American LibriTTS voices.

The Director's accent is closer to British than American. The trainer's generator has one model,
en_US-libritts_r-medium, so these come from Piper's own en_GB voices. It counts what is already in
each folder and generates only the rest, so 60% of the positives here stay 60% of the set.

Held out of training for the hit-rate check: en_GB-alan-medium, en_GB-cori-medium, and the last ten
VCTK speakers.
"""
import multiprocessing
import os
import pathlib
import random
import sys
import urllib.request
import uuid
import wave

import numpy as np
from piper import PiperVoice
from scipy.signal import resample_poly

from make_config import WORDS

BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB"
VOICES = {
    "vctk": ("en_GB-vctk-medium", 99),
    "aru": ("en_GB-aru-medium", 12),
    "semaine": ("en_GB-semaine-medium", 4),
    "alba": ("en_GB-alba-medium", 1),
    "jenny_dioco": ("en_GB-jenny_dioco-medium", 1),
    "northern_english_male": ("en_GB-northern_english_male-medium", 1),
    "southern_english_female": ("en_GB-southern_english_female-low", 1),
}
LOADED = {}


def fetch(folder, name):
    quality = name.rsplit("-", 1)[1]
    for suffix in (".onnx", ".onnx.json"):
        target = pathlib.Path("piper-voices") / f"{name}{suffix}"
        if not target.exists():
            target.parent.mkdir(exist_ok=True)
            urllib.request.urlretrieve(f"{BASE}/{folder}/{quality}/{name}{suffix}", target)


def speak(job):
    text, name, speaker, length, out = job
    if name not in LOADED:
        LOADED[name] = PiperVoice.load(f"piper-voices/{name}.onnx", config_path=f"piper-voices/{name}.onnx.json")
    voice = LOADED[name]
    rate = voice.config.sample_rate
    pcm = b"".join(voice.synthesize_stream_raw(
        text, speaker_id=speaker if voice.config.num_speakers > 1 else None, length_scale=length, noise_scale=0.8, noise_w=0.9,
    ))
    audio = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    audio = resample_poly(audio, 16000, rate)
    with wave.open(os.path.join(out, f"{uuid.uuid4().hex}.wav"), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(16000)
        handle.writeframes(np.clip(audio, -32768, 32767).astype(np.int16).tobytes())


def jobs(texts, count, out):
    os.makedirs(out, exist_ok=True)
    speakers = [(name, s) for name, n in VOICES.values() for s in range(n)]
    # Each voice family gets a fair share, not one per speaker: VCTK would swamp the rest.
    weights = [1 / next(n for m, n in VOICES.values() if m == name) ** 0.5 for name, _ in speakers]
    picks = random.choices(speakers, weights=weights, k=count)
    return [(random.choice(texts), n, s, random.choice([0.85, 1.0, 1.2, 1.4]), out) for n, s in picks]


def main():
    word, n_samples = sys.argv[1], int(sys.argv[2])
    random.seed(45)
    for folder, (name, _) in VOICES.items():
        fetch(folder, name)
    n_val = max(500, n_samples // 10)
    root = f"model/{word}"
    os.makedirs("model", exist_ok=True)
    target, negative = WORDS[word]["target"], WORDS[word]["negative"]
    work = (
        jobs(target, int(n_samples * 0.6), f"{root}/positive_train")
        + jobs(target, int(n_val * 0.6), f"{root}/positive_test")
        + jobs(negative, int(n_samples * 0.2), f"{root}/negative_train")
        + jobs(negative, int(n_val * 0.2), f"{root}/negative_test")
    )
    with multiprocessing.Pool(os.cpu_count()) as pool:
        for done, _ in enumerate(pool.imap_unordered(speak, work, chunksize=32)):
            if done % 2000 == 0:
                print("british clips", done, "of", len(work), flush=True)
    print("british clips written", len(work), "from", ", ".join(v[0] for v in VOICES.values()), flush=True)


if __name__ == "__main__":
    main()
