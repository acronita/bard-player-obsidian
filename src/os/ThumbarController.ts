import { BrowserWindowLike, NativeImageLike, RemoteLike } from "../electron/remote";

type Glyph = "prev" | "play" | "pause" | "next";
type Action = "prev" | "toggle" | "next";

const REAPPLY_EVENTS = ["show", "restore", "focus"];

/** White 32px glyphs drawn on a canvas; no image assets ship with the plugin. */
function glyphDataUrl(kind: Glyph, size = 32): string {
	const canvas = createEl("canvas");
	canvas.width = canvas.height = size;
	const g = canvas.getContext("2d");
	if (!g) return "";
	g.scale(size / 32, size / 32);
	g.fillStyle = "#ffffff";
	const tri = (a: [number, number], b: [number, number], c: [number, number]) => {
		g.beginPath();
		g.moveTo(...a);
		g.lineTo(...b);
		g.lineTo(...c);
		g.closePath();
		g.fill();
	};
	switch (kind) {
		case "play":
			tri([10, 6], [26, 16], [10, 26]);
			break;
		case "pause":
			g.fillRect(8, 6, 6, 20);
			g.fillRect(18, 6, 6, 20);
			break;
		case "next":
			tri([6, 7], [20, 16], [6, 25]);
			g.fillRect(21, 7, 4, 18);
			break;
		case "prev":
			tri([26, 7], [12, 16], [26, 25]);
			g.fillRect(7, 7, 4, 18);
			break;
	}
	return canvas.toDataURL("image/png");
}

/**
 * Windows taskbar thumbnail buttons (prev / play⇄pause / next) on the main window.
 * Re-applied on show/restore/focus (Windows drops them), cleared on unload and on renderer
 * reload: Ctrl+R skips onunload and would leave dead callbacks behind (docs/SPIKE.md F0.2).
 */
export class ThumbarController {
	private playing = false;
	private hasTrack = false;
	private readonly icons = new Map<Glyph, NativeImageLike>();
	private readonly reapply = () => this.apply();
	private readonly clearOnReload = () => this.stop();

	constructor(
		private readonly remote: RemoteLike,
		private readonly win: BrowserWindowLike,
		private readonly onAction: (action: Action) => void,
	) {
		for (const ev of REAPPLY_EVENTS) win.on(ev, this.reapply);
		window.addEventListener("beforeunload", this.clearOnReload);
		this.apply();
	}

	update(playing: boolean, hasTrack: boolean): void {
		if (playing === this.playing && hasTrack === this.hasTrack) return;
		this.playing = playing;
		this.hasTrack = hasTrack;
		this.apply();
	}

	stop(): void {
		window.removeEventListener("beforeunload", this.clearOnReload);
		if (this.win.isDestroyed()) return;
		for (const ev of REAPPLY_EVENTS) this.win.removeListener(ev, this.reapply);
		try {
			this.win.setThumbarButtons([]);
		} catch (err) {
			console.warn("[bard-player] clearing thumbar failed", err);
		}
	}

	private icon(kind: Glyph): NativeImageLike {
		let img = this.icons.get(kind);
		if (!img) {
			img = this.remote.nativeImage.createFromDataURL(glyphDataUrl(kind));
			this.icons.set(kind, img);
		}
		return img;
	}

	private apply(): void {
		if (this.win.isDestroyed()) return;
		const flags = this.hasTrack ? [] : ["disabled"];
		try {
			this.win.setThumbarButtons([
				{ tooltip: "Previous", icon: this.icon("prev"), click: () => this.onAction("prev"), flags },
				{
					tooltip: this.playing ? "Pause" : "Play",
					icon: this.icon(this.playing ? "pause" : "play"),
					click: () => this.onAction("toggle"),
				},
				{ tooltip: "Next", icon: this.icon("next"), click: () => this.onAction("next"), flags },
			]);
		} catch (err) {
			console.warn("[bard-player] setThumbarButtons failed", err);
		}
	}
}
