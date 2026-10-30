#!/usr/bin/env bash
# Train one openWakeWord model on a CPU GitHub runner. Free compute, no key, no GPU.
#   WORD=sebastian N_SAMPLES=20000 STEPS=50000 bash scripts/baton/wake-train/train.sh
# Output: $WORK/out/<word>.onnx and <word>.metrics.txt
set -euo pipefail

: "${WORD:?}" "${N_SAMPLES:?}" "${STEPS:?}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK:-$PWD/wake-work}"
mkdir -p "$WORK/out"
cd "$WORK"

# upstream's trainer imports generate_samples from the repo root, which only v2/v3 layouts have
git clone -q https://github.com/dscripka/openWakeWord.git
git -C openWakeWord checkout -q 368c037
git clone -q --branch v2.0.0 --depth 1 https://github.com/rhasspy/piper-sample-generator.git
wget -q -O piper-sample-generator/models/en_US-libritts_r-medium.pt \
  https://github.com/rhasspy/piper-sample-generator/releases/download/v2.0.0/en_US-libritts_r-medium.pt

pip install -q --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.1.2 torchaudio==2.1.2
pip install -q --no-cache-dir "numpy<2" "scipy<1.12" piper-phonemize==1.1.0 webrtcvad \
  mutagen==1.47.0 torchinfo==1.8.0 torchmetrics==1.2.0 speechbrain==0.5.14 \
  audiomentations==0.33.0 torch-audiomentations==0.11.0 acoustics==0.2.6 pronouncing==0.2.0 \
  deep-phonemizer==0.0.19 onnx==1.15.0 onnxscript==0.1.0.dev20240101 pyyaml tqdm huggingface_hub soundfile pyarrow \
  onnxruntime==1.17.3 scikit-learn requests
pip install -q --no-cache-dir --no-deps -e ./openWakeWord

mkdir -p openWakeWord/openwakeword/resources/models
for f in embedding_model melspectrogram; do
  wget -q -O "openWakeWord/openwakeword/resources/models/$f.onnx" \
    "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/$f.onnx"
  wget -q -O "openWakeWord/openwakeword/resources/models/$f.tflite" \
    "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/$f.tflite"
done

python "$here/fetch_data.py"
python "$here/make_config.py" "$WORD" "$N_SAMPLES" "$STEPS" > "$WORD.yaml"
df -h . | tail -1

common=(--training_config "$WORD.yaml")
python -m openwakeword.train "${common[@]}" --generate_clips
python -m openwakeword.train "${common[@]}" --augment_clips
python -m openwakeword.train "${common[@]}" --train_model 2>&1 | tee "out/$WORD.train.log"

cp "model/$WORD.onnx" "out/$WORD.onnx"
python "$here/report.py" "$WORD" > "out/$WORD.metrics.txt"
cat "out/$WORD.metrics.txt"
