# Platforms: what works where (2026-11-02)

Tessaya is Windows first. This page says what was observed on each platform, how, and what stands between it and the same
features. "Observed" means a CI run read the logs of a released build (`baton-v0.1.34`); nothing here was tried by a person on
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
| Voice start | goes past `begin` when voice is on | stops at `begin`: `binary:false`, the dictation sidecar is not built for Linux | stops at `begin`: `binary:false`, same |
| Wake word, dictation, paste | built and proven on Windows | not available (needs the sidecar) | not available |
| Test audio reaches the voice start | yes on Windows | no | no |
| Auto-update | yes | the updater ran ("not available, latest 0.1.34") | not observed |
| Noise in the log | none worth noting | GTK accelerator assertions and D-Bus connection errors under xvfb (cosmetic; no session bus in CI) | none observed |

Windows stranger-install proof (first read 2026-11-02): clean machine, silent install, first launch, a visible window after the
second launch, 12 text files in user data with no private name, no voice settings written (voice off until he turns it on),
no user operating-system pack, uninstall removes the app and the Add or remove entry and leaves the 45 user-data files.

## What is Windows only today

- The dictation and wake sidecar (`native/baton-dictation`): Parakeet through `transcribe-cpp`, `handy-recorder`,
  `handy-keys` hotkeys, `enigo` typing, the Windows paste path and Win32 window work. It is the whole voice start beyond
  `begin`. Its crates build on mac and Linux; the Win32 modules do not.
- UI Automation: `ui_tree`, `click_element`, the focused-control reads and the drive's window-under-point lookup.
- Windows Hello as the vault's consent gate (`UserConsentVerifier` through PowerShell) and DPAPI as one of the vault's key
  wraps (Electron's `safeStorage` uses the Keychain on macOS and the Secret Service or kwallet on Linux, so the wrap itself
  carries over; the Hello prompt does not).
- The Windows installer packaging checks (SmartScreen, NSIS uninstall).

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
