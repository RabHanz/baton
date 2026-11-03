"""Training data for an MIT-clean wake word: only sets whose own licence allows redistribution of what is built on them.

  room impulses   MIT environmental impulse responses (davidscripka, MIT licence)
  background      MUSAN noise and music (CC BY 4.0, openslr.org/17)
  negatives       LibriSpeech train-clean-100 speech (CC BY 4.0, openslr.org/12), turned into openWakeWord
                  features here (clean_negative_features.npy)
  validation      LibriSpeech dev-clean, test-clean and held-out MUSAN noise (clean_validation_features.npy)

Replaces fetch_data.py, which pulls AudioSet clips (YouTube, per-clip terms) and openWakeWord's precomputed
ACAV100M features (YouTube audio, licence unclear). Credits go in docs/baton/THIRD_PARTY_NOTICES.md.
"""
import os
import pathlib
import random
import subprocess

import numpy as np
import scipy.io.wavfile
import soundfile
from huggingface_hub import snapshot_download
from scipy.signal import resample_poly

from openwakeword.utils import AudioFeatures

SPEECH_HOURS = float(os.environ.get("SPEECH_HOURS", "30"))
NOISE_HOURS = float(os.environ.get("NOISE_HOURS", "12"))
CLIP = 32000  # 2 s at 16 kHz
random.seed(7)


def wav16k(source, target_dir, stem):
    audio, rate = soundfile.read(source, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate != 16000:
        audio = resample_poly(audio, 16000, rate)
    scipy.io.wavfile.write(target_dir / (stem + ".wav"), 16000, (np.clip(audio, -1, 1) * 32767).astype(np.int16))


def stream_tar(url, members, dest):
    dest.mkdir(exist_ok=True)
    cmd = f"wget -q -O - '{url}' | tar -xz -C '{dest}' {' '.join(members)}"
    subprocess.run(["bash", "-c", cmd], check=True)


rirs = pathlib.Path("mit_rirs")
rirs.mkdir(exist_ok=True)
source = snapshot_download("davidscripka/MIT_environmental_impulse_responses", repo_type="dataset")
for item in pathlib.Path(source).rglob("*.wav"):
    wav16k(item, rirs, item.stem)
print("rirs", len(list(rirs.iterdir())), flush=True)

# MUSAN noise and music, background for augmentation; a held-out slice goes to validation.
musan = pathlib.Path("musan_raw")
stream_tar("https://www.openslr.org/resources/17/musan.tar.gz", ["--wildcards", "musan/noise/*", "musan/music/*"], musan)
background, held_noise = pathlib.Path("background"), pathlib.Path("held_noise")
background.mkdir(exist_ok=True)
held_noise.mkdir(exist_ok=True)
files = sorted(musan.rglob("*.wav"))
random.shuffle(files)
seconds = 0.0
for i, f in enumerate(files):
    if seconds > NOISE_HOURS * 3600:
        break
    try:
        info = soundfile.info(f)
        wav16k(f, held_noise if i % 10 == 0 else background, f"{f.parent.name}_{f.stem}")
        seconds += info.duration
    except Exception as cause:  # one bad file is not a reason to stop
        print("skip", f.name, cause, flush=True)
print("background", len(list(background.iterdir())), "held noise", len(list(held_noise.iterdir())), flush=True)


def clips_from(paths, hours):
    total, out = 0.0, []
    for f in paths:
        if total > hours * 3600:
            break
        audio, rate = soundfile.read(f, dtype="int16", always_2d=True)
        audio = audio.mean(axis=1).astype(np.int16)
        if rate != 16000:
            audio = resample_poly(audio, 16000, rate).astype(np.int16)
        for start in range(0, max(1, len(audio) - CLIP), CLIP):
            piece = audio[start : start + CLIP]
            if len(piece) == CLIP:
                out.append(piece)
        total += len(audio) / 16000
    return np.stack(out)


def to_features(clips, batch=64, stream=False):
    feats = AudioFeatures(inference_framework="onnx", device="cpu")
    rows = []
    for i in range(0, len(clips), batch):
        e = feats.embed_clips(clips[i : i + batch], batch_size=batch)  # (n, frames, 96)
        for item in e:
            if stream:
                rows.append(item)
                continue
            for s in range(0, item.shape[0] - 15, 8):
                rows.append(item[s : s + 16])
    # the trainer slides its own windows over a (frames, 96) validation stream and needs float32
    return np.concatenate(rows).astype(np.float32) if stream else np.stack(rows).astype(np.float16)


def libri(part, name):
    root = pathlib.Path("libri")
    stream_tar(f"https://www.openslr.org/resources/12/{part}.tar.gz", [], root)
    return sorted((root / "LibriSpeech" / name).rglob("*.flac"))


train = libri("train-clean-100", "train-clean-100")
random.shuffle(train)
np.save("clean_negative_features.npy", np.concatenate([
    to_features(clips_from(train, SPEECH_HOURS)),
    to_features(clips_from(sorted(background.glob("*.wav")), NOISE_HOURS / 2)),
]))
print("negative features done", flush=True)
dev = libri("dev-clean", "dev-clean") + libri("test-clean", "test-clean")
random.shuffle(dev)
np.save("clean_validation_features.npy", np.concatenate([
    to_features(clips_from(dev, 4), stream=True),
    to_features(clips_from(sorted(held_noise.glob("*.wav")), 2), stream=True),
]))
print("validation features done", flush=True)
