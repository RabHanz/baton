"""Score the finished ONNX on the trainer's held-out features, at several thresholds."""
import sys

import numpy as np
import onnxruntime as ort

word = sys.argv[1]
session = ort.InferenceSession(f"model/{word}.onnx", providers=["CPUExecutionProvider"])
name = session.get_inputs()[0].name


def score(features: np.ndarray) -> np.ndarray:
    out = [session.run(None, {name: features[i:i + 512].astype(np.float32)})[0]
           for i in range(0, len(features), 512)]
    return np.concatenate(out).ravel()


positive = np.load(f"model/{word}/positive_features_test.npy")
adversarial = np.load(f"model/{word}/negative_features_test.npy")
background = np.load("validation_set_features.npy")
frames = positive.shape[1]
windows = np.lib.stride_tricks.sliding_window_view(background, frames, axis=0).transpose(0, 2, 1)
windows = windows.astype(np.float32)
hours = len(background) * 0.08 / 3600
p, a, b = score(positive), score(adversarial), score(windows)
print(f"{word}: synthetic data only, not his voice or his mics")
print(f"positives {len(p)}, adversarial {len(a)}, background {hours:.1f} h")
for threshold in (0.3, 0.5, 0.7, 0.85, 0.95):
    hits = b >= threshold
    events = int(hits[0]) + int(np.sum(hits[1:] & ~hits[:-1]))
    print(f"t={threshold}: miss {np.mean(p < threshold):.3f}  "
          f"adversarial fp {np.mean(a >= threshold):.3f}  background fa/h {events / hours:.2f}")
