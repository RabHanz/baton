"""Training data for an MIT-clean wake word: only sets whose own licence allows redistribution of what is built on them.

  room impulses   MIT environmental impulse responses (davidscripka, MIT licence)
  background      DEMAND room noise (CC BY 4.0, zenodo.org/records/1227121)
  negatives       LibriSpeech train-clean-100 speech (CC BY 4.0), turned into openWakeWord features here
                  (clean_negative_features.npy)
  validation      LibriSpeech dev-clean, test-clean and held-out DEMAND noise (clean_validation_features.npy)

LibriSpeech comes as Hugging Face parquet shards (about 460 MB each, the first few only), and the noise
from zenodo: openslr's 10 GB MUSAN tar and 6 GB train-clean-100 tar took hours on a runner and made this
run miss its time limit.

Replaces fetch_data.py, which pulls AudioSet clips (YouTube, per-clip terms) and openWakeWord's precomputed
ACAV100M features (YouTube audio, licence unclear). Credits go in docs/baton/THIRD_PARTY_NOTICES.md.
"""
import io
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

SPEECH_HOURS = float(os.environ.get("SPEECH_HOURS", "14"))
NOISE_HOURS = float(os.environ.get("NOISE_HOURS", "6"))
TRAIN_SHARDS = int(os.environ.get("TRAIN_SHARDS", "2"))
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

# DEMAND room noise, background for augmentation; a held-out slice goes to validation.
musan = pathlib.Path("demand_raw")
musan.mkdir(exist_ok=True)
for room in ["DKITCHEN", "DLIVING", "DWASHING", "TCAR", "STRAFFIC", "NFIELD", "OOFFICE", "PCAFETER"]:
    subprocess.run(["bash", "-c", f"wget -q -O {room}.zip https://zenodo.org/records/1227121/files/{room}_16k.zip && unzip -q -o {room}.zip -d demand_raw && rm {room}.zip"], check=True)
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


def parquet_audio(parts):
    """LibriSpeech utterances from Hugging Face parquet shards, as file-like flac bytes."""
    import pyarrow.parquet as pq
    from huggingface_hub import hf_hub_download

    for part in parts:
        path = hf_hub_download("openslr/librispeech_asr", part, repo_type="dataset", revision="refs/convert/parquet")
        table = pq.read_table(path, columns=["audio"])
        for row in table.column("audio").to_pylist():
            yield io.BytesIO(row["bytes"])


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


def to_features(clips, batch=64):
    feats = AudioFeatures(inference_framework="onnx", device="cpu")
    rows = []
    for i in range(0, len(clips), batch):
        e = feats.embed_clips(clips[i : i + batch], batch_size=batch)  # (n, frames, 96)
        for item in e:
            for s in range(0, item.shape[0] - 15, 8):
                rows.append(item[s : s + 16])
    return np.stack(rows).astype(np.float16)


train = parquet_audio([f"clean/train.100/{i:04d}.parquet" for i in range(TRAIN_SHARDS)])
np.save("clean_negative_features.npy", np.concatenate([
    to_features(clips_from(train, SPEECH_HOURS)),
    to_features(clips_from(sorted(background.glob("*.wav")), NOISE_HOURS / 2)),
]))
print("negative features done", flush=True)
dev = parquet_audio(["clean/validation/0000.parquet", "clean/test/0000.parquet"])
# The trainer wants the validation set as one run of 96-dimensional frames, (frames, 96) in float32, and
# cuts its own windows: it is not the (windows, 16, 96) the negatives are.
def to_frames(clips, batch=64):
    feats = AudioFeatures(inference_framework="onnx", device="cpu")
    out = []
    for i in range(0, len(clips), batch):
        for item in feats.embed_clips(clips[i : i + batch], batch_size=batch):
            out.append(item)
    return np.concatenate(out).astype(np.float32)


np.save("clean_validation_features.npy", np.concatenate([
    to_frames(clips_from(dev, 4)),
    to_frames(clips_from(sorted(held_noise.glob("*.wav")), 2)),
]))
print("validation features done", flush=True)
