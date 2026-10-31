import { setIcon } from "obsidian";
import { PlayerService } from "../player/PlayerService";
import { PlayerState, formatTime, livePosition } from "../player/protocol";
import { BardSettings, MINI_BACKDROPS } from "../settings";

export interface MiniSettingsSource {
	readonly settings: BardSettings;
	onSettingsChange(listener: (s: BardSettings) => void): () => void;
}

/**
 * Compact remote-control UI for the player: artwork, title/artist, seekable progress,
 * like / prev / play / next and volume. It never holds the webview; it reads state and sends
 * commands, so it works in the sidebar, in any leaf and in popout windows.
 */
export class MiniControls {
	private readonly root: HTMLElement;
	private readonly art: HTMLImageElement;
	private readonly artFallback: HTMLElement;
	private readonly title: HTMLElement;
	private readonly artist: HTMLElement;
	private readonly fill: HTMLElement;
	private readonly progress: HTMLElement;
	private readonly elapsed: HTMLElement;
	private readonly total: HTMLElement;
	private readonly likeBtn: HTMLElement;
	private readonly playBtn: HTMLElement;
	private readonly muteBtn: HTMLElement;
	private readonly volume: HTMLInputElement;
	private readonly unsubscribe: () => void;
	private readonly unsubscribeSettings: () => void;
	private readonly bodyObserver: ResizeObserver;
	private readonly ticker: number;
	private state: PlayerState;
	private draggingVolume = false;

	constructor(
		parent: HTMLElement,
		private readonly player: PlayerService,
		settings: MiniSettingsSource,
		onOpenPlayer: () => void,
	) {
		this.state = player.state;
		this.root = parent.createDiv({ cls: "bard-mini" });
		this.root.createDiv({ cls: "bard-mini-backdrop" });

		const artWrap = this.root.createDiv({ cls: "bard-mini-art", attr: { "aria-label": "Open YouTube Music" } });
		artWrap.addEventListener("click", onOpenPlayer);
		this.art = artWrap.createEl("img", { attr: { alt: "", draggable: "false" } });
		this.artFallback = artWrap.createDiv({ cls: "bard-mini-art-fallback" });
		setIcon(this.artFallback, "music");

		const body = this.root.createDiv({ cls: "bard-mini-body" });
		const meta = body.createDiv({ cls: "bard-mini-meta" });
		this.title = meta.createDiv({ cls: "bard-mini-title" });
		this.artist = meta.createDiv({ cls: "bard-mini-artist" });

		const time = body.createDiv({ cls: "bard-mini-time" });
		this.elapsed = time.createSpan({ cls: "bard-mini-elapsed" });
		this.progress = time.createDiv({ cls: "bard-mini-progress", attr: { "aria-label": "Seek" } });
		this.fill = this.progress.createDiv({ cls: "bard-mini-progress-fill" });
		this.total = time.createSpan({ cls: "bard-mini-total" });
		this.progress.addEventListener("click", (e) => this.seekFromClick(e));

		const controls = body.createDiv({ cls: "bard-mini-controls" });
		this.likeBtn = this.button(controls, "heart", "Like", () => player.send({ name: "like" }));
		this.button(controls, "skip-back", "Previous", () => player.send({ name: "prev" }));
		this.playBtn = this.button(controls, "play", "Play", () => player.send({ name: "toggle" }));
		this.playBtn.addClass("bard-mini-play");
		this.button(controls, "skip-forward", "Next", () => player.send({ name: "next" }));

		const vol = controls.createDiv({ cls: "bard-mini-volume" });
		this.muteBtn = this.button(vol, "volume-2", "Mute", () => player.send({ name: "mute" }));
		this.volume = vol.createEl("input", { type: "range", attr: { min: "0", max: "100", step: "1", "aria-label": "Volume" } });
		this.volume.addEventListener("pointerdown", () => (this.draggingVolume = true));
		this.volume.addEventListener("pointerup", () => (this.draggingVolume = false));
		this.volume.addEventListener("input", () => player.send({ name: "volume", value: Number(this.volume.value) }));

		// Size the cover to the text column so it lines up with the title and the controls.
		this.bodyObserver = new ResizeObserver(() => this.root.setCssProps({ "--bard-body-h": `${body.offsetHeight}px` }));
		this.bodyObserver.observe(body);

		this.applySettings(settings.settings);
		this.unsubscribeSettings = settings.onSettingsChange((s) => this.applySettings(s));
		this.unsubscribe = player.subscribe((s) => this.render(s));
		this.ticker = window.setInterval(() => this.renderProgress(), 500);
	}

	destroy(): void {
		this.unsubscribe();
		this.unsubscribeSettings();
		this.bodyObserver.disconnect();
		window.clearInterval(this.ticker);
		this.root.remove();
	}

	private button(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
		const btn = parent.createEl("button", { cls: "clickable-icon bard-mini-btn", attr: { "aria-label": label } });
		setIcon(btn, icon);
		btn.addEventListener("click", onClick);
		return btn;
	}

	private applySettings(s: BardSettings): void {
		for (const b of MINI_BACKDROPS) this.root.toggleClass(`bg-${b}`, b === s.miniBackdrop);
		this.root.setCssProps({ "--bard-art-opacity": String(s.miniArtworkOpacity / 100) });
	}

	private render(s: PlayerState): void {
		const prev = this.state;
		this.state = s;
		const idle = s.status === "idle";
		this.root.toggleClass("is-idle", idle);
		this.root.toggleClass("is-ad", s.isAd);

		this.title.setText(idle ? "Nothing playing" : s.title);
		this.artist.setText(idle ? "Pick something in YouTube Music" : s.isAd ? "Ad" : [s.artist, s.album].filter(Boolean).join(" · "));
		this.title.setAttr("title", s.title);

		if (s.artworkUrl !== prev.artworkUrl || !this.art.getAttr("src")) {
			if (s.artworkUrl) {
				this.art.src = s.artworkUrl;
				this.root.setCssProps({ "--bard-art": `url(${JSON.stringify(s.artworkUrl)})` });
			} else {
				this.art.removeAttribute("src");
				this.root.setCssProps({ "--bard-art": "none" });
			}
		}
		this.root.toggleClass("has-art", !!s.artworkUrl);

		const playing = s.status === "playing";
		if (playing !== (prev.status === "playing") || !this.playBtn.hasChildNodes()) {
			setIcon(this.playBtn, playing ? "pause" : "play");
			this.playBtn.setAttr("aria-label", playing ? "Pause" : "Play");
		}
		this.likeBtn.toggleClass("is-active", s.liked === "like");
		this.likeBtn.toggleClass("is-hidden", s.liked === null);

		const muted = s.muted || s.volume === 0;
		setIcon(this.muteBtn, muted ? "volume-x" : s.volume < 50 ? "volume-1" : "volume-2");
		this.muteBtn.setAttr("aria-label", muted ? "Unmute" : "Mute");
		if (!this.draggingVolume) this.volume.value = String(muted ? 0 : s.volume);

		this.renderProgress();
	}

	private renderProgress(): void {
		const s = this.state;
		const pos = livePosition(s, Date.now());
		const pct = s.duration > 0 ? (pos / s.duration) * 100 : 0;
		this.fill.setCssStyles({ width: `${pct}%` });
		this.elapsed.setText(s.status === "idle" ? "" : formatTime(pos));
		this.total.setText(s.status === "idle" || !s.duration ? "" : formatTime(s.duration));
	}

	private seekFromClick(e: MouseEvent): void {
		const s = this.state;
		if (s.duration <= 0 || s.isAd) return;
		const r = this.progress.getBoundingClientRect();
		const frac = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
		this.player.send({ name: "seek", value: frac * s.duration });
	}
}
