import { Notice, Platform, Plugin, WorkspaceLeaf, apiVersion } from "obsidian";
import { VIEW_TYPE_MINI, VIEW_TYPE_PLAYER } from "./constants";
import { getMainBrowserWindow, getRemote } from "./electron/remote";
import { ThumbarController } from "./os/ThumbarController";
import { PlayerService, ResumeTarget } from "./player/PlayerService";
import { PlayerState } from "./player/protocol";
import { BardSettings, normalizeSettings } from "./settings";
import { BardSettingTab } from "./SettingsTab";
import { debugLog, setDebugLogging } from "./log";
import { UA_MODES, UaMode, isEngineOutdated, nextUaMode } from "./player/userAgent";
import { MiniPlayerView } from "./views/MiniPlayerView";
import { PlayerView } from "./views/PlayerView";

// v2: the identity order changed; everyone starts over from the new first identity.
const UA_MODE_KEY = "bard-player-ua-mode-v2";
const VOLUME_KEY = "bard-player-volume";
const SESSION_KEY = "bard-player-last-session";

export default class BardPlayerPlugin extends Plugin {
	private player: PlayerService | null = null;
	private thumbar: ThumbarController | null = null;
	private readonly settingsListeners = new Set<(s: BardSettings) => void>();
	private savedSession: ResumeTarget | null = null;
	settings: BardSettings = normalizeSettings(null);

	async onload(): Promise<void> {
		this.settings = normalizeSettings(await this.loadData());
		setDebugLogging(this.settings.debugLogging);
		this.register(this.onSettingsChange((s) => {
			if (setDebugLogging(s.debugLogging)) this.logEnvironment();
		}));
		this.addSettingTab(new BardSettingTab(this.app, this));

		this.registerView(VIEW_TYPE_PLAYER, (leaf) => new PlayerView(leaf, this));
		this.registerView(VIEW_TYPE_MINI, (leaf) => new MiniPlayerView(leaf, this));

		this.addRibbonIcon("music", "Open Bard Player", () => void this.activatePlayerView());
		const miniRibbon = this.addRibbonIcon("headphones", "Open mini player", () => void this.activateMiniView());
		// Hidden through a class: Obsidian resets the button's display when it loads the ribbon layout.
		miniRibbon.addClass("bard-mini-ribbon");
		miniRibbon.toggleClass("is-hidden-by-setting", !this.settings.miniRibbonIcon);
		this.register(this.onSettingsChange((s) => miniRibbon.toggleClass("is-hidden-by-setting", !s.miniRibbonIcon)));

		this.addCommand({ id: "open-player", name: "Open player", callback: () => void this.activatePlayerView() });
		this.addCommand({ id: "open-mini-player", name: "Open mini player", callback: () => void this.activateMiniView() });
		this.addCommand({ id: "toggle-playback", name: "Play / pause", callback: () => this.getPlayer().send({ name: "toggle" }) });
		this.addCommand({ id: "next-track", name: "Next track", callback: () => this.getPlayer().send({ name: "next" }) });
		this.addCommand({ id: "previous-track", name: "Previous track", callback: () => this.getPlayer().send({ name: "prev" }) });
		this.addCommand({
			id: "reset-sign-in-identity",
			name: "Reset sign-in browser identity",
			callback: () => {
				this.app.saveLocalStorage(UA_MODE_KEY, null);
				this.player?.setUaMode(UA_MODES[0]);
				debugLog(`sign-in identity reset to "${UA_MODES[0]}"`);
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

		// Restored player views may already have created the player; otherwise start it here.
		this.app.workspace.onLayoutReady(() => {
			if (this.settings.startupPlayback !== "off" && this.loadSession()) this.getPlayer();
		});
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
			this.logEnvironment();
			this.player = new PlayerService(this.mainDocument(), this.uaMode(), () => this.onSignInRejected(), {
				load: () => {
					const stored: unknown = this.app.loadLocalStorage(VOLUME_KEY);
					return typeof stored === "number" && stored >= 0 && stored <= 100 ? stored : null;
				},
				save: (volume) => this.app.saveLocalStorage(VOLUME_KEY, volume),
			}, this.startupTarget());
			this.startThumbar(this.player);
			this.player.subscribe((s) => this.saveSession(s));
		}
		return this.player;
	}

	getPlayerIfCreated(): PlayerService | null {
		return this.player;
	}

	/** One line that says which setup the rest of the log comes from. */
	private logEnvironment(): void {
		debugLog(
			`Bard Player ${this.manifest.version}, Obsidian ${apiVersion}, Electron ${process.versions.electron}, Chrome ${process.versions.chrome}, ${process.platform} ${process.arch};`,
			`sign-in identity "${this.uaMode()}"`,
			isEngineOutdated(process.versions.chrome ?? "", Date.now()) ? "(engine OUTDATED: Google will refuse sign-in)" : "(engine up to date)",
			this.player ? "(player running)" : "(player not started yet)",
		);
	}

	private uaMode(): UaMode {
		const stored: unknown = this.app.loadLocalStorage(UA_MODE_KEY);
		return UA_MODES.find((m) => m === stored) ?? UA_MODES[0];
	}

	/**
	 * Google refused the sign-in: move to the next browser identity and send the user back to retry.
	 * After the last one it wraps around, since each retry starts from a clean cookie jar.
	 */
	private onSignInRejected(): void {
		const current = this.uaMode();
		const next = nextUaMode(current);
		console.warn(`[bard-player] sign-in rejected with identity "${current}" (engine Chrome ${process.versions.chrome}, ${process.platform})`, next ? `-> trying "${next}"` : "-> none left");
		const mode = next ?? UA_MODES[0];
		this.app.saveLocalStorage(UA_MODE_KEY, mode);
		void this.player?.retrySignIn(mode);
		const engine = process.versions.chrome ?? "";
		if (isEngineOutdated(engine, Date.now())) {
			console.warn(`[bard-player] browser engine Chrome ${engine} is outdated; a new Obsidian installer is needed`);
			new Notice(
				`Google rejected the sign-in because Obsidian's built-in browser is outdated (Chrome ${parseInt(engine, 10)}). ` +
					"Obsidian's automatic updates do not replace it: download the latest installer from obsidian.md/download, " +
					"install it over the current one (vaults and plugins are kept), then sign in again.",
				0,
			);
			return;
		}
		if (!next) {
			new Notice("Google rejected the sign-in with every browser identity Bard Player knows. Starting over from the first one; select sign in again.", 15000);
			return;
		}
		const step = UA_MODES.indexOf(next) + 1;
		new Notice(`Google rejected the sign-in. Bard Player switched browser identity (${step}/${UA_MODES.length}); select sign in again.`, 10000);
	}

	/** The first player of the session picks up the last session, per the startup setting. */
	private startupTarget(): ResumeTarget | null {
		const mode = this.settings.startupPlayback;
		const last = mode === "off" ? null : this.loadSession();
		if (!last) return null;
		return mode === "restart" ? { ...last, position: 0 } : last;
	}

	private loadSession(): ResumeTarget | null {
		const raw: unknown = this.app.loadLocalStorage(SESSION_KEY);
		if (!raw || typeof raw !== "object") return null;
		const r = raw as Record<string, unknown>;
		if (typeof r.videoId !== "string" || !r.videoId) return null;
		return {
			videoId: r.videoId,
			playlistId: typeof r.playlistId === "string" && r.playlistId ? r.playlistId : null,
			position: typeof r.position === "number" && Number.isFinite(r.position) ? Math.max(0, r.position) : 0,
		};
	}

	/** Remembers what is playing (per device), writing on item changes and every few seconds of progress. */
	private saveSession(s: PlayerState): void {
		if (s.status === "idle" || s.isAd || !s.videoId) return;
		const prev = this.savedSession;
		const same = prev?.videoId === s.videoId && prev.playlistId === s.playlistId;
		if (same && Math.abs(prev.position - s.position) < 5) return;
		this.savedSession = { videoId: s.videoId, playlistId: s.playlistId, position: s.position };
		this.app.saveLocalStorage(SESSION_KEY, this.savedSession);
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
