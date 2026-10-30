"""Room impulses, background audio and pre-computed negative features for openWakeWord."""
import os
import pathlib
import subprocess
import tarfile
import urllib.request

import numpy as np
from huggingface_hub import hf_hub_download, snapshot_download
import scipy.io.wavfile
import soundfile

HF = "https://huggingface.co/datasets"


def wav16k(source: pathlib.Path, target_dir: pathlib.Path) -> None:
    audio, rate = soundfile.read(source, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate != 16000:
        from scipy.signal import resample_poly

        audio = resample_poly(audio, 16000, rate)
    scipy.io.wavfile.write(
        target_dir / (source.stem + ".wav"), 16000, (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    )


rirs = pathlib.Path("mit_rirs")
rirs.mkdir(exist_ok=True)
source = snapshot_download("davidscripka/MIT_environmental_impulse_responses", repo_type="dataset")
for item in pathlib.Path(source).rglob("*.wav"):
    wav16k(item, rirs)
print("rirs", len(list(rirs.iterdir())), flush=True)

background = pathlib.Path("background")
background.mkdir(exist_ok=True)
for part in ["bal_train09", "bal_train03", "bal_train06"]:
    tar_path = f"{part}.tar"
    urllib.request.urlretrieve(f"{HF}/agkphysics/AudioSet/resolve/main/data/{tar_path}", tar_path)
    with tarfile.open(tar_path) as tar:
        tar.extractall("audioset", filter="data")
    os.remove(tar_path)
    for item in pathlib.Path("audioset").rglob("*.flac"):
        try:
            wav16k(item, background)
        except Exception as cause:  # one bad clip in a public set is not a reason to stop
            print("skip", item.name, cause, flush=True)
        item.unlink()
print("background", len(list(background.iterdir())), flush=True)

for name in ["openwakeword_features_ACAV100M_2000_hrs_16bit.npy", "validation_set_features.npy"]:
    subprocess.run(
        ["wget", "-q", "-O", name, f"{HF}/davidscripka/openwakeword_features/resolve/main/{name}"],
        check=True,
    )
print("features done", flush=True)
