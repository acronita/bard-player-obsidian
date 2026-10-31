import { Platform } from "obsidian";
import { PARTITION, YTM_URL } from "../constants";
import { clearUserAgentOverride, overrideUserAgent, routePopupsToBrowser, setPartitionUserAgent } from "../electron/remote";
import { INJECT_SRC } from "./inject";
import { Command, EMPTY_STATE, PlayerState, parseMessage } from "./protocol";
import { OsKind, UaMode, UaProfile, buildProfile, isSignInRejected } from "./userAgent";

interface WebviewTag extends HTMLElement {
	getWebContentsId(): number;
	executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
	canGoBack(): boolean;
	goBack(): void;
	loadURL(url: string): Promise<void>;
}

type StateListener = (state: PlayerState) => void;

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

	/**
	 * @param mainDoc the main window's document: the webview must never change window.
	 * @param onSignInRejected called when Google shows its "browser may not be secure" page.
	 */
	constructor(
		mainDoc: Document,
		uaMode: UaMode,
		private readonly onSignInRejected: () => void,
	) {
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
				src: YTM_URL,
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
			if (nav.isMainFrame && !nav.isInPlace) this.ready = false;
		});
		wv.addEventListener("console-message", (e) => {
			const next = parseMessage((e as Event & { message?: unknown }).message);
			if (next) this.setState(next);
		});

		window.addEventListener("resize", this.onWindowResize);
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
		void this.webview.loadURL(YTM_URL);
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
		this.host.setCssStyles({
			left: `${r.left}px`,
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
		console.debug(`[bard-player] identity override ${ok ? "applied" : "FAILED"}:`, this.profile.userAgent);
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
		this.state = next;
		for (const l of this.listeners) l(next);
	}
}
