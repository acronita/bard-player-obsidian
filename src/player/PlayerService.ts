import { Platform } from "obsidian";
import { PARTITION, YTM_URL } from "../constants";
import { clearUserAgentOverride, overrideUserAgent, routePopupsToBrowser, setPartitionUserAgent } from "../electron/remote";
import { INJECT_SRC } from "./inject";
import { Command, EMPTY_STATE, PlayerState, parseMessage, watchUrl } from "./protocol";
import { OsKind, UaMode, UaProfile, buildProfile, isSignInRejected } from "./userAgent";

interface WebviewTag extends HTMLElement {
	getWebContentsId(): number;
	executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
	canGoBack(): boolean;
	goBack(): void;
	loadURL(url: string): Promise<void>;
}

type StateListener = (state: PlayerState) => void;

/** Volume kept by the plugin: YTM only remembers changes made through its own slider. */
export interface VolumeStore {
	load(): number | null;
	save(volume: number): void;
}

/** Where playback stopped last session; applied once when the page reports media. */
export interface ResumeTarget {
	videoId: string;
	playlistId: string | null;
	/** Seconds. */
	position: number;
}

const OFFSCREEN_LEFT = "-10000px";

function osKind(): OsKind {
	return Platform.isWin ? "windows" : Platform.isMacOS ? "mac" : "linux";
}

function profileFor(mode: UaMode): UaProfile {
	const engine = { chrome: process.versions.chrome ?? "120.0.0.0", electron: process.versions.electron ?? "28.0.0" };
	return buildProfile(mode, osKind(), Date.now(), engine);
}

/**
 * Owns the single YouTube Music webview and its state.
 *
 * The webview is appended once to a fixed host in the MAIN window's body and never moved:
 * reparenting a <webview> recreates the guest and restarts playback. Views that want to show it
 * call attach(el); the host is then laid over el's rect. Otherwise it sits off-screen (never
 * display:none, which stalls rendering). Login lives in the persistent partition, which Electron
 * stores under Obsidian's app data folder, outside any vault.
 */
export class PlayerService {
	private readonly host: HTMLDivElement;
	private readonly webview: WebviewTag;
	private readonly listeners = new Set<StateListener>();
	private readonly pending: Command[] = [];
	private ready = false;
	private target: HTMLElement | null = null;
	private readonly ro = new ResizeObserver(() => this.reposition());
	private readonly onWindowResize = () => this.reposition();
	state: PlayerState = EMPTY_STATE;

	private profile: UaProfile;
	private webContentsId: number | null = null;
	private lastRejectedUrl = "";
	private loaded = false;
	private readonly loadListeners: Array<() => void> = [];
	/** Whether the stored volume was applied to the current page; YTM resets it on each full load. */
	private volumeRestored = false;
	private resume: ResumeTarget | null;
	private resumeUntil = 0;
	private resumeSeeked = false;
	private lastResumePlay = 0;

	/**
	 * @param mainDoc the main window's document: the webview must never change window.
	 * @param onSignInRejected called when Google shows its "browser may not be secure" page.
	 * @param resume when given, opens that item instead of the home page and starts playing it.
	 */
	constructor(
		mainDoc: Document,
		uaMode: UaMode,
		private readonly onSignInRejected: () => void,
		private readonly volumeStore: VolumeStore,
		resume: ResumeTarget | null = null,
	) {
		this.resume = resume;
		this.profile = profileFor(uaMode);
		const ua = this.profile.userAgent;
		setPartitionUserAgent(PARTITION, ua);

		this.host = mainDoc.body.createDiv({ cls: "bard-host" });
		// Attributes are applied before the element is attached, so the partition is set before the first navigation.
		const wv = this.host.createEl("webview" as "div", {
			cls: "bard-webview",
			attr: {
				partition: PARTITION,
				useragent: ua,
				webpreferences: "backgroundThrottling=no, autoplayPolicy=no-user-gesture-required",
				allowpopups: "",
				src: resume ? watchUrl(YTM_URL, resume.videoId, resume.playlistId) : YTM_URL,
			},
		}) as unknown as WebviewTag;
		this.webview = wv;

		wv.addEventListener("dom-ready", () => {
			if (this.webContentsId === null) {
				this.webContentsId = wv.getWebContentsId();
				routePopupsToBrowser(this.webContentsId);
				void this.applyProfile();
			}
			void this.inject();
		});
		wv.addEventListener("did-navigate", (e) => {
			this.checkSignIn((e as Event & { url?: string }).url);
			void this.inject();
		});
		// Google's sign-in flow is itself a SPA: the rejection page can arrive as an in-page navigation.
		wv.addEventListener("did-navigate-in-page", (e) => {
			const nav = e as Event & { url?: string; isMainFrame?: boolean };
			if (nav.isMainFrame !== false) this.checkSignIn(nav.url);
		});
		// A full page load drops the bridge; queue commands until it is re-injected.
		wv.addEventListener("did-start-navigation", (e) => {
			const nav = e as Event & { isMainFrame?: boolean; isInPlace?: boolean };
			if (nav.isMainFrame && !nav.isInPlace) {
				this.ready = false;
				this.volumeRestored = false;
			}
		});
		const markLoaded = () => {
			if (this.loaded) return;
			this.loaded = true;
			window.clearTimeout(loadTimeout);
			this.reposition();
			for (const l of this.loadListeners.splice(0)) l();
		};
		// did-stop-loading means resources are in; give YTM's app shell a beat to paint.
		wv.addEventListener("did-stop-loading", () => window.setTimeout(markLoaded, 300));
		const loadTimeout = window.setTimeout(markLoaded, 20000);
		wv.addEventListener("console-message", (e) => {
			const next = parseMessage((e as Event & { message?: unknown }).message);
			if (next) this.setState(next);
		});

		window.addEventListener("resize", this.onWindowResize);
	}

	/** Runs `cb` once the first page load has finished (immediately if it already has). */
	whenLoaded(cb: () => void): void {
		if (this.loaded) cb();
		else this.loadListeners.push(cb);
	}

	subscribe(listener: StateListener): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	send(cmd: Command): void {
		if (!this.ready) {
			this.pending.push(cmd);
			return;
		}
		const arg = "value" in cmd ? cmd.value : null;
		const code = `window.__bard ? window.__bard.cmd(${JSON.stringify(cmd.name)}, ${JSON.stringify(arg)}) : false`;
		this.webview.executeJavaScript(code, true).catch((err) => console.warn("[bard-player] command failed", cmd, err));
	}

	/** Switch the browser identity presented to Google (applies to the next requests). */
	setUaMode(mode: UaMode): void {
		this.profile = profileFor(mode);
		setPartitionUserAgent(PARTITION, this.profile.userAgent);
		void this.applyProfile();
	}

	goBack(): void {
		if (this.webview.canGoBack()) this.webview.goBack();
	}

	goHome(): void {
		// Interrupting an in-flight navigation rejects with ERR_ABORTED; the new load still proceeds.
		this.webview.loadURL(YTM_URL).catch(() => {});
	}

	/** Lay the webview over `el`. Only one element is attached at a time. */
	attach(el: HTMLElement): void {
		if (this.target === el) return this.reposition();
		if (this.target) this.ro.unobserve(this.target);
		this.target = el;
		this.ro.observe(el);
		this.reposition();
	}

	detach(el: HTMLElement): void {
		if (this.target !== el) return;
		this.ro.unobserve(el);
		this.target = null;
		this.reposition();
	}

	/**
	 * Sync the host to the target's rect. getBoundingClientRect works even when the window is
	 * hidden (where ResizeObserver/rAF callbacks stall), so layout events call this directly.
	 * A target in an inactive tab has a zero rect and sends the host off-screen.
	 */
	reposition(): void {
		const el = this.target;
		const r = el?.isConnected ? el.getBoundingClientRect() : null;
		if (!r || r.width === 0 || r.height === 0) {
			this.host.setCssStyles({ left: OFFSCREEN_LEFT });
			return;
		}
		// Until the first load finishes the page is a blank dark rectangle: keep it off-screen (at the
		// right size, so the layout is ready) and let the view show its loading state instead.
		this.host.setCssStyles({
			left: this.loaded ? `${r.left}px` : OFFSCREEN_LEFT,
			top: `${r.top}px`,
			width: `${r.width}px`,
			height: `${r.height}px`,
		});
	}

	destroy(): void {
		this.ro.disconnect();
		window.removeEventListener("resize", this.onWindowResize);
		this.listeners.clear();
		this.pending.length = 0;
		this.loadListeners.length = 0;
		this.host.remove();
	}

	private async applyProfile(): Promise<void> {
		if (this.webContentsId === null) return;
		if (!this.profile.emulate) {
			clearUserAgentOverride(this.webContentsId);
			console.debug("[bard-player] identity: embedded browser", this.profile.userAgent);
			return;
		}
		const ok = await overrideUserAgent(this.webContentsId, this.profile.userAgent, this.profile.metadata);
		if (ok) console.debug("[bard-player] identity override applied:", this.profile.userAgent);
		else console.warn("[bard-player] identity override failed:", this.profile.userAgent);
	}

	private checkSignIn(url: string | undefined): void {
		if (!url?.startsWith("https://accounts.google.com")) return;
		console.debug("[bard-player] sign-in navigation:", url.split("?")[0]);
		if (isSignInRejected(url) && url !== this.lastRejectedUrl) {
			this.lastRejectedUrl = url;
			this.onSignInRejected();
		}
	}

	private async inject(): Promise<void> {
		try {
			await this.webview.executeJavaScript(INJECT_SRC);
			this.ready = true;
			for (const cmd of this.pending.splice(0)) this.send(cmd);
		} catch (err) {
			console.warn("[bard-player] inject failed", err);
		}
	}

	private setState(next: PlayerState): void {
		const prev = this.state;
		this.state = next;
		this.syncVolume(prev, next);
		this.applyResume(next);
		for (const l of this.listeners) l(next);
	}

	/**
	 * Seek to where the last session stopped and keep asking to play until it does: YTM may load
	 * the item paused, or swallow a play sent while the media is still loading. Gives up after 15 s.
	 */
	private applyResume(next: PlayerState): void {
		const r = this.resume;
		if (!r || next.status === "idle" || next.isAd) return;
		const now = Date.now();
		if (!this.resumeUntil) this.resumeUntil = now + 15000;
		if (now > this.resumeUntil) {
			this.resume = null;
			return;
		}
		if (!this.resumeSeeked && next.duration > 0) {
			this.resumeSeeked = true;
			const sameItem = !next.videoId || next.videoId === r.videoId;
			if (sameItem && r.position > 5 && r.position < next.duration - 5) this.send({ name: "seek", value: r.position });
		}
		if (next.status === "playing") {
			if (this.resumeSeeked) this.resume = null;
			return;
		}
		if (now - this.lastResumePlay > 1000) {
			this.lastResumePlay = now;
			this.send({ name: "play" });
		}
	}

	/**
	 * Once media is loaded, push the stored volume into the page; after that, store every change
	 * (from our slider or YTM's). Saving before the restore would overwrite it with YTM's default.
	 */
	private syncVolume(prev: PlayerState, next: PlayerState): void {
		if (next.status === "idle") return;
		if (!this.volumeRestored) {
			this.volumeRestored = true;
			const stored = this.volumeStore.load();
			if (stored !== null && stored !== next.volume) this.send({ name: "volume", value: stored });
			return;
		}
		if (next.volume !== prev.volume) this.volumeStore.save(next.volume);
	}
}
