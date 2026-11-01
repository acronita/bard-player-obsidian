import { ItemView, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_PLAYER } from "../constants";
import type BardPlayerPlugin from "../main";
import { MiniControls } from "./MiniControls";

/**
 * Full YouTube Music view. It reserves a surface and the plugin's single webview is laid over it
 * (see PlayerService). In a popout window the webview cannot follow, so the view falls back to
 * the compact controls plus a way back to the main window.
 */
export class PlayerView extends ItemView {
	private surface: HTMLElement | null = null;
	private fallback: MiniControls | null = null;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: BardPlayerPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_PLAYER;
	}

	getDisplayText(): string {
		return "Bard Player";
	}

	getIcon(): string {
		return "music";
	}

	async onOpen(): Promise<void> {
		this.contentEl.empty();
		this.contentEl.addClass("bard-player-view");
		const player = this.plugin.getPlayer();

		this.addAction("panel-right-open", "Open mini player", () => void this.plugin.activateMiniView());
		this.addAction("home", "Home", () => player.goHome());
		this.addAction("arrow-left", "Back", () => player.goBack());

		if (this.contentEl.doc !== this.plugin.mainDocument()) {
			this.contentEl.addClass("is-popout");
			const box = this.contentEl.createDiv({ cls: "bard-popout-fallback" });
			box.createEl("p", { text: "The player page can only be shown in the main window." });
			box.createEl("button", { text: "Move to main window", cls: "mod-cta" }).addEventListener("click", () => {
				this.leaf.detach();
				void this.plugin.activatePlayerView();
			});
			this.fallback = new MiniControls(this.contentEl, player, this.plugin, () => {});
			return;
		}

		const surface = this.contentEl.createDiv({ cls: "bard-player-surface" });
		const loading = surface.createDiv({ cls: "bard-player-loading" });
		loading.createDiv({ cls: "bard-spinner" });
		loading.createDiv({ text: "Loading player…" });
		player.whenLoaded(() => surface.addClass("is-loaded"));
		this.surface = surface;
		player.attach(surface);
	}

	onResize(): void {
		this.plugin.repositionPlayer();
	}

	async onClose(): Promise<void> {
		if (this.surface) this.plugin.getPlayerIfCreated()?.detach(this.surface);
		this.surface = null;
		this.fallback?.destroy();
		this.fallback = null;
	}
}
