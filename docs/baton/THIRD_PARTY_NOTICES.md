# Third-party notices

Code in Baton adapted from other projects, with their licences. Each entry names the files that
carry the adapted code.

## farzaa/clicky (MIT)

Commit `a80fa80721a8`. Adapted: the companion prompt and the `[POINT:x,y:label:screenN]` tag, its
parser, the screenshot-pixel to display coordinate maths, the 1280 px capture size, and the
pointer's triangle and quadratic-bezier flight. In `packages/baton-shared/src/screenCompanion.ts` and
`apps/desktop/src/baton/screen/pointerOverlay.ts`.

```text
MIT License

Copyright (c) 2026 Farza

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bitshank-2338/clicky-windows (MIT)

Commit `6c6216b7f80a`. Adapted: Drive's plan shape, `validate_plan`, the stop-on-mouse-movement
and stale-screen rules, and the "next"/"stop" phrases. In
`packages/baton-shared/src/screenCompanion.ts`. Its PyQt6 interface (GPL-3.0) is not used.

```text
MIT License

Copyright (c) 2026 Shashank Singh

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## cjpais/Handy and handy-computer crates (MIT)

Handy commit `7bfb2e2c934b`. Adapted: the Windows reliable paste (`src-tauri/src/paste_tx/`) in
`native/baton-dictation/src/paste_windows.rs`, the paste chords in `keys.rs`, and the pinned Parakeet
revision and hash in `apps/desktop/src/baton/voice/voiceModels.ts`. Used as dependencies:
`transcribe-cpp` 0.4.1, `handy-recorder` 0.1.0, `handy-keys` 0.3.4 (each MIT; transcribe.cpp vendors
ggml, Silero VAD and miniz, all MIT). The Handy name and brand assets are not used.

```text
MIT License

Copyright (c) 2025 CJ Pais

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Speech and wake models

- Parakeet TDT 0.6B v3 (NVIDIA, CC BY 4.0), GGUF conversion `handy-computer/parakeet-tdt-0.6b-v3-gguf`,
  downloaded on first use.
- Pocket TTS (Kyutai, MIT) binary, and its weights and VCTK-derived voices (CC-BY-4.0), downloaded on
  first use from `kyutai/pocket-tts-without-voice-cloning`.
- `melspectrogram.onnx`, `embedding_model.onnx` from openWakeWord v0.5.1, `silero_vad.onnx` from
  Silero VAD v6.2.3 (MIT), shipped in `native/baton-dictation/models`. See
  `docs/baton/research/voice-stack-2026-10-26.md` for their licence notes.
- `sebastian.onnx`, `alfred.onnx`, `freya.onnx`, `onyx.onnx`: trained here (D98) on Piper's LibriTTS
  and en_GB voices (VCTK, aru, semaine, alba, jenny_dioco, northern_english_male,
  southern_english_female) with openWakeWord's published negative features. Those sets carry their own
  terms, some non-commercial. Check them before any packaged or commercial release.
