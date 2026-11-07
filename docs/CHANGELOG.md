# Changelog

All notable changes to Bard Player. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Fixed
- The elapsed time and progress bar restart with each track instead of adding up across a sequence
  of tracks: position and duration now come from the YouTube player, with the media element only as
  a fallback.
- The total time shows the whole track from the start instead of growing as the track loads: it
  now comes from the track's length in the player response.

## 1.2.0 — 2026-11-02

### Added
- When Google refuses the sign-in and Obsidian's built-in browser engine is about a year or more
  behind, a notice explains that a new Obsidian installer is needed.
- **Debug logging** setting (Troubleshooting): writes sign-in diagnostics to the developer console.
- README: step-by-step help when sign-in fails, starting with updating the Obsidian installer
  (Google refuses sign-in on old built-in browser engines, e.g. Chrome 120).

### Fixed
- The mini player ribbon button no longer comes back after a restart when **Ribbon button** is off.
- Google sign-in works on the first try more often: Bard Player now starts with the Firefox
  identity, applies it before the first request, presents Chrome with the engine's real version,
  and clears the rejected attempt's cookies before retrying. Retries start over after the last
  identity instead of stopping.

## 1.1.2 — 2026-11-01

### Fixed
- Plugin description no longer mentions Obsidian, as required by the community plugin directory.

## 1.1.1 — 2026-10-31

### Changed
- **On startup** now defaults to playing the last track again from the beginning (it was off).

## 1.1.0 — 2026-10-31

### Added
- **Mini player ribbon button** (headphones) next to the player one; it can be hidden with the
  **Ribbon button** setting (Mini player).
- **Mini player background** settings: blurred artwork (with adjustable intensity), theme
  background or black. The cover now lines up with the controls.
- **On startup** setting (Playback): when Obsidian opens, play the last track, playlist or radio
  again, either resuming where it stopped or from the beginning.

### Changed
- Removed YouTube Music branding from the plugin's UI and description: the view is now titled
  "Bard Player" and the command is "Open player". The README keeps a single compatibility and
  trademark note, plus a mini player GIF.

### Fixed
- Mini player showed the play icon instead of pause when opened while music was already playing.
- Seeking on the mini player progress bar now jumps almost instantly instead of gliding slowly.
- Volume is kept across player reloads.

## 1.0.0 — 2026-10-31

First release.

### Added
- **YouTube Music view**: the full music.youtube.com app in an Obsidian tab (ribbon icon or
  "Open YouTube Music"), with back / home / open-mini-player header actions. One persistent
  webview is laid over the view, so switching tabs, splitting or closing the view never restarts
  playback.
- **Mini player**: compact, dockable controls (artwork, title/artist, seekable progress, like,
  previous / play-pause / next, volume) that adapt to the space they are given; works in sidebars,
  splits and popout windows.
- **Windows taskbar buttons** (previous / play-pause / next) on the Obsidian taskbar thumbnail, and
  media keys / Windows media flyout through YouTube Music's own media session.
- Commands: open player, open mini player, play/pause, next, previous, like current track, reset
  sign-in browser identity.
- Persistent sign-in stored in Obsidian's app data (`persist:bard-player` partition), never in the
  vault.
- Loading indicator while YouTube Music loads for the first time.

### Fixed
- Google sign-in on Obsidian's embedded browser: Bard Player presents a current browser identity
  and, if Google still rejects the sign-in, automatically retries with alternative identities.
