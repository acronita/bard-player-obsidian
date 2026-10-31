import { Notice, Platform, Plugin, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_MINI, VIEW_TYPE_PLAYER } from "./constants";
import { getMainBrowserWindow, getRemote } from "./electron/remote";
import { ThumbarController } from "./os/ThumbarController";
import { PlayerService } from "./player/PlayerService";
import { BardSettings, normalizeSettings } from "./settings";
import { BardSettingTab } from "./SettingsTab";
import { UA_MODES, UaMode, nextUaMode } from "./player/userAgent";
import { MiniPlayerView } from "./views/MiniPlayerView";
import { PlayerView } from "./views/PlayerView";

const UA_MODE_KEY = "bard-player-ua-mode";

export default class BardPlayerPlugin extends Plugin {
	private player: PlayerService | null = null;
	private thumbar: ThumbarController | null = null;
	private readonly settingsListeners = new Set<(s: BardSettings) => void>();
	settings: BardSettings = normalizeSettings(null);

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		this.addSettingTab(new BardSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_PLAYER, (leaf) => new PlayerView(leaf, this));
		this.registerView(VIEW_TYPE_MINI, (leaf) => new MiniPlayerView(leaf, this));

		this.addRibbonIcon("music", "Open YouTube Music", () => void this.activatePlayerView());

		this.addCommand({ id: "open-player", name: "Open YouTube Music", callback: () => void this.activatePlayerView() });
		this.addCommand({ id: "open-mini-player", name: "Open mini player", callback: () => void this.activateMiniView() });
		this.addCommand({ id: "toggle-playback", name: "Play / pause", callback: () => this.getPlayer().send({ name: "toggle" }) });
		this.addCommand({ id: "next-track", name: "Next track", callback: () => this.getPlayer().send({ name: "next" }) });
		this.addCommand({ id: "previous-track", name: "Previous track", callback: () => this.getPlayer().send({ name: "prev" }) });
		this.addCommand({
			id: "reset-sign-in-identity",
			name: "Reset sign-in browser identity",
			callback: () => {
				this.app.saveLocalStorage(UA_MODE_KEY, null);
				this.player?.setUaMode("chrome");
				new Notice("Bard Player: sign-in identity reset.");
			},
		});
		this.addCommand({ id: "like-track", name: "Like current track", callback: () => this.getPlayer().send({ name: "like" }) });

		// ResizeObserver stalls while the window is hidden; layout events keep the overlay honest.
		const reposition = () => this.repositionPlayer();
		this.registerEvent(this.app.workspace.on("layout-change", reposition));
		this.registerEvent(this.app.workspace.on("active-leaf-change", reposition));
		this.registerEvent(this.app.workspace.on("resize", reposition));
		this.registerEvent(this.app.workspace.on("css-change", reposition));
	}

	onunload(): void {
		this.thumbar?.stop();
		this.thumbar = null;
		this.player?.destroy();
		this.player = null;
	}

	async updateSettings(patch: Partial<BardSettings>): Promise<void> {
		this.settings = { ...this.settings, ...patch };
		await this.saveData(this.settings);
		for (const listener of this.settingsListeners) listener(this.settings);
	}

	onSettingsChange(listener: (s: BardSettings) => void): () => void {
		this.settingsListeners.add(listener);
		return () => this.settingsListeners.delete(listener);
	}

	/** The webview is created on first use, so a vault that never opens the player pays nothing. */
	getPlayer(): PlayerService {
		if (!this.player) {
			this.player = new PlayerService(this.mainDocument(), this.uaMode(), () => this.onSignInRejected());
			this.startThumbar(this.player);
		}
		return this.player;
	}

	getPlayerIfCreated(): PlayerService | null {
		return this.player;
	}

	private uaMode(): UaMode {
		const stored: unknown = this.app.loadLocalStorage(UA_MODE_KEY);
		return UA_MODES.find((m) => m === stored) ?? "chrome";
	}

	/** Google refused the sign-in: move to the next browser identity and send the user back to retry. */
	private onSignInRejected(): void {
		const current = this.uaMode();
		const next = nextUaMode(current);
		console.warn(`[bard-player] sign-in rejected with identity "${current}" (engine Chrome ${process.versions.chrome})`, next ? `-> trying "${next}"` : "-> none left");
		if (!next) {
			new Notice("Google rejected the sign-in with every browser identity Bard Player knows. Run \"reset sign-in browser identity\" to start over.", 15000);
			return;
		}
		this.app.saveLocalStorage(UA_MODE_KEY, next);
		this.player?.setUaMode(next);
		this.player?.goHome();
		const step = UA_MODES.indexOf(next) + 1;
		new Notice(`Google rejected the sign-in. Bard Player switched browser identity (${step}/${UA_MODES.length}); select sign in again.`, 10000);
	}

	mainDocument(): Document {
		return this.app.workspace.containerEl.doc;
	}

	repositionPlayer(): void {
		this.player?.reposition();
	}

	async activatePlayerView(): Promise<void> {
		const { workspace } = this.app;
		// The full view belongs in the main window, where the webview lives.
		const existing = workspace.getLeavesOfType(VIEW_TYPE_PLAYER).find((l) => l.view.containerEl.doc === this.mainDocument());
		const leaf = existing ?? workspace.getLeaf("tab");
		if (!existing) await leaf.setViewState({ type: VIEW_TYPE_PLAYER, active: true });
		await this.reveal(leaf);
	}

	async activateMiniView(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE_MINI)[0] ?? null;
		if (!leaf) {
			leaf = workspace.getRightLeaf(false);
			if (!leaf) return;
			await leaf.setViewState({ type: VIEW_TYPE_MINI, active: true });
		}
		await this.reveal(leaf);
	}

	private async reveal(leaf: WorkspaceLeaf): Promise<void> {
		await this.app.workspace.revealLeaf(leaf);
		this.repositionPlayer();
	}

	private startThumbar(player: PlayerService): void {
		const remote = getRemote();
		const win = getMainBrowserWindow();
		if (!Platform.isWin || !remote || !win) return;
		this.thumbar = new ThumbarController(remote, win, (action) => player.send({ name: action }));
		player.subscribe((s) => this.thumbar?.update(s.status === "playing", s.status !== "idle"));
	}
}
