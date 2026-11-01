# Changelog

All notable changes to Bard Player. Versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added
- **Mini player ribbon button** (headphones) next to the player one; it can be hidden with the
  **Ribbon button** setting (Mini player).
- **On startup** setting (Playback): when Obsidian opens, play the last track, playlist or radio
  again, either resuming where it stopped or from the beginning.

### Changed
- Removed YouTube Music branding from the plugin's UI and description: the view is now titled
  "Bard Player" and the command is "Open player". The README keeps a single compatibility and
  trademark note, plus a mini player GIF.

### Fixed
- Mini player showed the play icon instead of pause when opened while music was already playing.
- Seeking on the mini player progress bar now jumps almost instantly instead of gliding slowly.

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
