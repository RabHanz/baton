# Platforms: what works where (2026-11-02)

Tessaya is Windows first. This page says what was observed on each platform, how, and what stands between it and the same
features. "Observed" means a CI run read the logs of a released build (`baton-v0.1.34` for the first table; a build of this repository's `main` for the voice rows, since the sidecar is packaged from `main` on); nothing here was tried by a person on
a Mac or a Linux desktop.

How to read it again: dispatch `baton-voice-proof.yml` with a release `tag`. The `prove` job is Windows (including the
stranger-install proof), `smoke linux` runs the AppImage under xvfb, `smoke macos` runs the arm64 dmg's app.
`scripts/baton/platform-smoke.sh` and `scripts/baton/stranger-proof.ps1` are the checks.

## What was observed

| | Windows (windows-2022) | Linux (ubuntu-latest, xvfb) | macOS (macos-latest, arm64) |
| --- | --- | --- | --- |
| Installs / unpacks | silent NSIS install, uninstall removes the app and keeps user data | AppImage runs with `--appimage-extract-and-run --no-sandbox` | dmg mounts, the .app runs after `xattr -cr` (unsigned) |
| Starts on a clean user | yes; no private default in user data; no user pack; only default wake words | yes; lifecycle `start` logged | yes |
| Window | yes, second launch opens the main window (`open_main`, visible) | yes (`open_main`, visible, 1100x780) | yes ("main window created" in the app log); `open_main` is not logged for a second launch |
| Voice start | goes past `begin` when voice is on | reaches `loop-started`, plays the test phrase and transcribes it | reaches `loop-started` on the runner with the GPU off (`--disable-gpu`; below) |
| Wake word, dictation, paste | built and proven on Windows | wake and transcription proven with the test input; dictation hotkey and paste not exercised | not proven |
| Test audio reaches the voice start | yes | yes | yes, with the GPU off |
| Auto-update | yes | the updater ran ("not available, latest 0.1.34") | not observed |
| Noise in the log | none worth noting | GTK accelerator assertions and D-Bus connection errors under xvfb (cosmetic; no session bus in CI) | none observed |

Windows stranger-install proof (first read 2026-11-02): clean machine, silent install, first launch, a visible window after the
second launch, 12 text files in user data with no private name, no voice settings written (voice off until he turns it on),
no user operating-system pack, uninstall removes the app and the Add or remove entry and leaves the 45 user-data files.

## The sidecar, piece by piece: real, stubbed, unproven

`native/baton-dictation` builds and passes its tests on Windows, Linux x64 and macOS arm64 and x64 (CI, `baton-dictation-build.yml`),
and `stageBatonVoice` packages it into every desktop build. What each piece is on each platform:

| Piece | Windows | macOS | Linux |
| --- | --- | --- | --- |
| Microphone capture (`handy-recorder`: WASAPI, CoreAudio, ALSA) | real, used daily | real code; device listing proven on the CI runner (CoreAudio null device); a real microphone and the Microphone permission not tried | real code; listing proven with ALSA's null device; real microphones not tried |
| Test input (`BATON_TEST_WAV`, `BATON_FAKE_MIC`) for CI | real | real | real (this is what the smoke job uses) |
| Parakeet model load and inference (`transcribe-cpp`, the same GGUF) | real | the sidecar alone loads the GGUF in about 1 s and transcribes on the runner (exit 0); inside the app on the GPU-less runner the voice start reaches `loop-started` with `--disable-gpu`. Without that flag the app was SIGKILLed about 50 s in, at the same second its `MTLCompilerService` helpers died: Chromium's GPU process cannot compile Metal shaders on a VM with no GPU. That is a runner fact, not a user one: a Mac with a GPU has no such flag and was not tried | real: the smoke job's phrase is transcribed ("What is the cup of Brazil?") |
| Wake word and VAD (onnxruntime) | real | started in the smoke job (wake phrase not required there) | real in the smoke job |
| Hold-to-dictate hotkey (`handy-keys`) | real | the crate has a CGEventTap backend; needs Input Monitoring and Accessibility; **not exercised** | the crate's Linux backend; **not exercised**; Wayland has no global hotkeys without a portal |
| Paste into the focused app | real (`paste_windows`, receipt-based, restores the clipboard) | real code (`pbcopy`, Command-V through `enigo`, clipboard restored after 1.5 s); needs Accessibility; **not exercised** | real code (`wl-copy` or `xclip` plus a chord; `wtype`/X11); **not exercised** |
| Which app has focus | real | `osascript` front-app lookup; title not available | `hyprctl` / `swaymsg` / X11 tools where present, else "unknown window" (text still pastes) |
| Mouse hooks (chords, side buttons) | real (`mouse_windows`) | **stubbed**: no hook, bindings with mouse buttons do nothing | **stubbed** |
| UI Automation: `ui_tree`, `locate`, `window_at`, window rect, pointer nudge | real | **stubbed** (return nothing); plan: Accessibility API | **stubbed**; plan: AT-SPI |

The desktop app finds the binary next to itself (`resources/baton-voice/baton-dictation`, `.exe` on Windows; `BATON_DICTATION`
overrides) and no longer says "Voice is Windows only for now" when it is there.

## Plan for native feature parity (planned, not built)

| Feature | Windows today | macOS equivalent | Linux equivalent |
| --- | --- | --- | --- |
| Read a window's controls (`ui_tree`) | UI Automation (`Win32_UI_Accessibility`) | Accessibility API (`AXUIElement`), needs the user's Accessibility permission in System Settings | AT-SPI over D-Bus; needs the toolkit's accessibility on (GTK and Qt usually; Chrome needs `--force-renderer-accessibility`) |
| Click a control by name | UIA invoke pattern | `AXPress` action | AT-SPI `doAction` |
| Move the pointer and click | `SendInput` | CGEvent, needs Accessibility permission | X11 XTest; on Wayland only through a portal (libei / RemoteDesktop), which asks the user |
| Global hotkey and push to talk | `handy-keys` (Win32) | `handy-keys` has a macOS backend; needs Input Monitoring permission | X11 grabs; Wayland has no global hotkeys without a portal |
| Type into the focused app | `enigo` + clipboard paste | `enigo` (CGEvent) + `pbpaste`/`Cmd-V`, Accessibility permission | `enigo` on X11; Wayland needs a portal |
| Microphone | `handy-recorder` | `handy-recorder` (CoreAudio), needs the Microphone permission | `handy-recorder` (ALSA/PulseAudio/PipeWire) |
| User-presence gate for the vault | Windows Hello | Touch ID or the login password through LocalAuthentication | polkit prompt or the passphrase only |
| Screen capture | Electron `desktopCapturer` | same, needs Screen Recording permission | same on X11; Wayland through the portal |
| Capture protection of Tessaya's overlays | `setContentProtection` | same | not available on most Linux compositors |

## Checklist for native feature parity

- [ ] Build `baton-dictation` for macOS (arm64 and x64) and Linux (x64): split the Win32 modules behind `cfg(windows)`, keep the
      crates that already support both, and ship the binary with the dmg and the AppImage.
- [ ] Make the voice start reach `models`, `audio` and `wake` on a Mac and a Linux box (CI: the smoke job's `voice start steps`
      must go past `begin`, and `test-audio` must appear).
- [ ] macOS: request Accessibility, Microphone, Input Monitoring and Screen Recording with a plain explanation, and say which is
      missing when a feature does not work.
- [ ] macOS: Accessibility-API `ui_tree` and `click_element` behind the same tool names, so the assistant does not change.
- [ ] Linux: AT-SPI `ui_tree` and `click_element`; X11 first; for Wayland, say plainly what a portal will ask for.
- [ ] Vault consent: LocalAuthentication on macOS; on Linux the passphrase only, stated.
- [ ] Sign and notarise the macOS app (the first-run Gatekeeper warning goes away); sign the AppImage or document the checksum.
- [ ] A `smoke` run on a real Mac and a real Linux desktop by a person, since CI has no microphone, no permissions prompts and no
      real display server.
- [ ] Mobile stays a separate lane (T3's React Native app).
