import { Platform } from "obsidian";
import { PARTITION, YTM_URL } from "../constants";
import { routePopupsToBrowser, setPartitionUserAgent } from "../electron/remote";
import { INJECT_SRC } from "./inject";
import { Command, EMPTY_STATE, PlayerState, parseMessage } from "./protocol";

interface WebviewTag extends HTMLElement {
	getWebContentsId(): number;
	executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
	canGoBack(): boolean;
	goBack(): void;
	loadURL(url: string): Promise<void>;
}

type StateListener = (state: PlayerState) => void;

const OFFSCREEN_LEFT = "-10000px";

/** Plain Chrome UA (no `Electron/` or `obsidian/` tokens); Google sign-in rejects those. */
function cleanUserAgent(): string {
	const os = Platform.isWin
		? "Windows NT 10.0; Win64; x64"
		: Platform.isMacOS
			? "Macintosh; Intel Mac OS X 10_15_7"
			: "X11; Linux x86_64";
	return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
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

	/** @param mainDoc the main window's document: the webview must never change window. */
	constructor(mainDoc: Document) {
		const ua = cleanUserAgent();
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

		let popupsRouted = false;
		wv.addEventListener("dom-ready", () => {
			if (!popupsRouted) {
				popupsRouted = true;
				routePopupsToBrowser(wv.getWebContentsId());
			}
			void this.inject();
		});
		wv.addEventListener("did-navigate", () => void this.inject());
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
