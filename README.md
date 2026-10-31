# Bard Player

YouTube Music player for [Obsidian](https://obsidian.md): a full player view, a mini player (dock, popout or floating always-on-top window), Windows taskbar buttons and media-key integration.

> **Desktop only.** Bard Player relies on Electron's `<webview>` and is not available on mobile.
>
> **Not affiliated with YouTube or Google.** "YouTube" and "YouTube Music" are trademarks of Google LLC. Bard Player only embeds the official `music.youtube.com` web app; it does not block ads or download content.

## Status

Early scaffold (v0.1.0). See [docs/PLAN.md](docs/PLAN.md) for the roadmap.

## Development

```
npm install
npm run build   # type-check, bundle main.js, copy to vault if .env.local sets OBSIDIAN_PLUGIN_DIR
npm run lint
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[GPL-3.0](LICENSE)
