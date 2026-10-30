"""Room impulses, background audio and pre-computed negative features for openWakeWord."""
import io
import os
import pathlib
import subprocess
import urllib.request
import uuid

import numpy as np
from huggingface_hub import snapshot_download
import pyarrow.parquet
import scipy.io.wavfile
import soundfile

HF = "https://huggingface.co/datasets"


def wav16k(source, target_dir: pathlib.Path, stem: str) -> None:
    audio, rate = soundfile.read(source, dtype="float32", always_2d=True)
    audio = audio.mean(axis=1)
    if rate != 16000:
        from scipy.signal import resample_poly

        audio = resample_poly(audio, 16000, rate)
    scipy.io.wavfile.write(
        target_dir / (stem + ".wav"), 16000, (np.clip(audio, -1, 1) * 32767).astype(np.int16)
    )


rirs = pathlib.Path("mit_rirs")
rirs.mkdir(exist_ok=True)
source = snapshot_download("davidscripka/MIT_environmental_impulse_responses", repo_type="dataset")
for item in pathlib.Path(source).rglob("*.wav"):
    wav16k(item, rirs, item.stem)
print("rirs", len(list(rirs.iterdir())), flush=True)

background = pathlib.Path("background")
background.mkdir(exist_ok=True)
for part in ["03", "06", "09"]:
    parquet = f"{part}.parquet"
    urllib.request.urlretrieve(f"{HF}/agkphysics/AudioSet/resolve/main/data/bal_train/{parquet}", parquet)
    for batch in pyarrow.parquet.ParquetFile(parquet).iter_batches(batch_size=64, columns=["audio"]):
        for row in batch.column("audio").to_pylist():
            item = pathlib.Path(row["path"] or uuid.uuid4().hex)
            try:
                wav16k(io.BytesIO(row["bytes"]), background, item.stem)
            except Exception as cause:  # one bad clip in a public set is not a reason to stop
                print("skip", item.name, cause, flush=True)
    os.remove(parquet)
print("background", len(list(background.iterdir())), flush=True)

for name in ["openwakeword_features_ACAV100M_2000_hrs_16bit.npy", "validation_set_features.npy"]:
    subprocess.run(
        ["wget", "-q", "-O", name, f"{HF}/davidscripka/openwakeword_features/resolve/main/{name}"],
        check=True,
    )
print("features done", flush=True)
