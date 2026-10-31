/*
 * Bard Player — F0 feasibility spike (GO/NO-GO). NOT shipped with the plugin.
 *
 * Builds into a throwaway plugin `bard-player-spike` (manifest in spike/manifest.json).
 * It exercises every risky platform API the real plugin depends on (PLAN.md §1, §3-F0)
 * and exposes them on `window.bardSpike` so the checks can be driven either by hand
 * (command palette) or by an external harness over the Chrome DevTools Protocol.
 *
 * Results of the run on real Obsidian are recorded in docs/SPIKE.md.
 */
import { Notice, Platform, Plugin, WorkspaceLeaf, apiVersion } from "obsidian";

const PARTITION = "persist:bard-player";
const YTM_URL = "https://music.youtube.com";
const MSG_PREFIX = "__BARD__";
const OFFSCREEN_LEFT = -10000;
const REPORT_PATH = "bard-spike-report.json";
// localStorage test hooks for the renderer-reload (Ctrl+R) experiment.
const LS_SKIP_ONCE = "bard-spike-skip-once";
const LS_NO_GUARD = "bard-spike-no-guard";
const LS_LAST_UNLOAD = "bard-spike-last-unload";

/* ------------------------------------------------------------------ */
/* Minimal typings for the Electron objects we reach through `remote`. */
/* ------------------------------------------------------------------ */

type Listener = (...args: unknown[]) => void;

interface NativeImageLike {
	isEmpty(): boolean;
	getSize(): { width: number; height: number };
}

interface ThumbarButtonSpec {
	tooltip?: string;
	icon: NativeImageLike;
	click: () => void;
	flags?: string[];
}

interface BrowserWindowLike {
	id: number;
	getTitle(): string;
	isDestroyed(): boolean;
	setThumbarButtons(buttons: ThumbarButtonSpec[]): boolean;
	setAlwaysOnTop(flag: boolean, level?: string): void;
	isAlwaysOnTop(): boolean;
	isMinimized(): boolean;
	minimize(): void;
	restore(): void;
	focus(): void;
	getNativeWindowHandle(): ArrayLike<number>;
	on(event: string, cb: Listener): void;
	removeListener(event: string, cb: Listener): void;
	listenerCount(event: string): number;
	webContents: { id: number };
}

interface SessionLike {
	setUserAgent(ua: string): void;
	getUserAgent(): string;
	cookies: { get(filter: object): Promise<Array<{ name: string; domain?: string }>> };
}

interface RemoteLike {
	getCurrentWindow(): BrowserWindowLike;
	BrowserWindow: {
		getAllWindows(): BrowserWindowLike[];
		getFocusedWindow(): BrowserWindowLike | null;
	};
	nativeImage: { createFromDataURL(url: string): NativeImageLike };
	session: { fromPartition(partition: string): SessionLike };
	webContents: { fromId(id: number): unknown };
}

interface WebviewTag extends HTMLElement {
	src: string;
	getWebContentsId(): number;
	getURL(): string;
	executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

interface ConsoleMessageEvent extends Event {
	message: string;
}

/** State shared across plugin reloads (lives on `window`), used to detect duplicated/stale callbacks. */
interface SpikeGlobal {
	generation: number;
	clicks: Array<{ gen: number; action: ThumbAction; at: number; stale: boolean }>;
	log: Array<{ at: number; msg: string }>;
}

type ThumbAction = "prev" | "toggle" | "next";

type SpikeWindow = Window & { __bardSpike?: SpikeGlobal; bardSpike?: BardPlayerSpike; electronWindow?: unknown };

function spikeGlobal(): SpikeGlobal {
	const w = window as SpikeWindow;
	if (!w.__bardSpike) w.__bardSpike = { generation: 0, clicks: [], log: [] };
	return w.__bardSpike;
}

function log(msg: string): void {
	spikeGlobal().log.push({ at: Date.now(), msg });
	console.debug(`[bard-spike] ${msg}`);
}

function errMsg(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* F0.1 — reaching Electron's remote and mapping windows.              */
/* ------------------------------------------------------------------ */

function getRemote(): RemoteLike | null {
	try {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const electron = require("electron") as { remote?: RemoteLike };
		return electron.remote ?? null;
	} catch (err) {
		log(`require("electron") failed: ${errMsg(err)}`);
		return null;
	}
}

/** HWND as a decimal string (getNativeWindowHandle returns a little-endian pointer buffer). */
function hwndOf(win: BrowserWindowLike): string {
	const buf = win.getNativeWindowHandle();
	let v = 0n;
	for (let i = Math.min(buf.length, 8) - 1; i >= 0; i--) v = (v << 8n) | BigInt(buf[i]);
	return v.toString();
}

/**
 * Resolve the BrowserWindow that hosts `doc`. Plugin code runs only in the main renderer,
 * so `remote.getCurrentWindow()` is always the MAIN window; popouts must be matched.
 * Strategy: temporarily stamp a unique title on the document and look for it.
 */
async function resolveBrowserWindow(remote: RemoteLike, doc: Document): Promise<BrowserWindowLike | null> {
	const original = doc.title;
	const token = `bard-spike-${Math.random().toString(36).slice(2)}`;
	doc.title = token;
	try {
		for (let i = 0; i < 40; i++) {
			const hit = remote.BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.getTitle() === token);
			if (hit) return hit;
			await sleep(50);
		}
		return null;
	} finally {
		doc.title = original;
	}
}

/* ------------------------------------------------------------------ */
/* F0.2 — thumbnail toolbar.                                            */
/* ------------------------------------------------------------------ */

type Glyph = "prev" | "play" | "pause" | "next";

function glyphDataUrl(kind: Glyph, size = 32): string {
	const canvas = document.createElement("canvas");
	canvas.width = canvas.height = size;
	const g = canvas.getContext("2d");
	if (!g) throw new Error("no 2d context");
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

class ThumbarSpike {
	private win: BrowserWindowLike | null = null;
	private playing = false;
	private readonly icons = new Map<Glyph, NativeImageLike>();
	private readonly reapply: Listener = () => this.apply("reapply");
	readonly applies: Array<{ at: number; reason: string; ok: boolean }> = [];
	static readonly REAPPLY_EVENTS = ["show", "restore", "focus"];

	constructor(
		private readonly remote: RemoteLike,
		private readonly gen: number,
		private readonly onAction: (action: ThumbAction) => void,
	) {}

	private icon(kind: Glyph): NativeImageLike {
		let img = this.icons.get(kind);
		if (!img) {
			img = this.remote.nativeImage.createFromDataURL(glyphDataUrl(kind));
			this.icons.set(kind, img);
		}
		return img;
	}

	start(win: BrowserWindowLike): boolean {
		this.win = win;
		for (const ev of ThumbarSpike.REAPPLY_EVENTS) win.on(ev, this.reapply);
		return this.apply("start");
	}

	/** Click handlers are thin closures over one stable dispatcher with a generation guard. */
	private click(action: ThumbAction): () => void {
		const gen = this.gen;
		return () => {
			const g = spikeGlobal();
			const stale = gen !== g.generation;
			g.clicks.push({ gen, action, at: Date.now(), stale });
			if (stale) return;
			if (action === "toggle") this.setPlaying(!this.playing);
			this.onAction(action);
		};
	}

	apply(reason: string): boolean {
		const win = this.win;
		if (!win || win.isDestroyed()) return false;
		let ok = false;
		try {
			ok = win.setThumbarButtons([
				{ tooltip: "Previous", icon: this.icon("prev"), click: this.click("prev") },
				{
					tooltip: this.playing ? "Pause" : "Play",
					icon: this.icon(this.playing ? "pause" : "play"),
					click: this.click("toggle"),
				},
				{ tooltip: "Next", icon: this.icon("next"), click: this.click("next") },
			]);
		} catch (err) {
			log(`setThumbarButtons threw: ${errMsg(err)}`);
		}
		this.applies.push({ at: Date.now(), reason, ok });
		return ok;
	}

	setPlaying(playing: boolean): void {
		if (playing === this.playing) return;
		this.playing = playing;
		this.apply("state");
	}

	isPlaying(): boolean {
		return this.playing;
	}

	stop(): void {
		const win = this.win;
		this.win = null;
		if (!win || win.isDestroyed()) return;
		for (const ev of ThumbarSpike.REAPPLY_EVENTS) win.removeListener(ev, this.reapply);
		try {
			win.setThumbarButtons([]);
		} catch (err) {
			log(`clear thumbar threw: ${errMsg(err)}`);
		}
	}
}

/* ------------------------------------------------------------------ */
/* F0.3 / F0.5 — the single persistent webview + bridge.               */
/* ------------------------------------------------------------------ */

/** Guest-side bridge. Idempotent (guard on window.__bard). Emits throttled state via console.debug. */
const INJECT_SRC = `(() => {
	if (window.__bard) { window.__bard.emit(true); return "already"; }
	const P = ${JSON.stringify(MSG_PREFIX)};
	const t0 = Date.now();
	let ticks = 0, last = 0, timer = 0;
	setInterval(() => { ticks++; }, 1000);
	const video = () => document.querySelector("video");
	const player = () => document.querySelector("#movie_player");
	const snap = () => {
		const v = video();
		const md = navigator.mediaSession ? navigator.mediaSession.metadata : null;
		const art = md && md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : null;
		return {
			title: md ? md.title : null, artist: md ? md.artist : null, album: md ? md.album : null, artwork: art,
			paused: v ? v.paused : null, position: v ? v.currentTime : null, duration: v ? v.duration : null,
			volume: v ? v.volume : null, msPlaybackState: navigator.mediaSession ? navigator.mediaSession.playbackState : null,
			visibility: document.visibilityState, hidden: document.hidden, ticks, uptime: (Date.now() - t0) / 1000,
			timeOrigin: performance.timeOrigin, url: location.href, ts: Date.now()
		};
	};
	const emit = (now) => {
		const ts = Date.now();
		if (!now && ts - last < 250) {
			if (!timer) timer = setTimeout(() => { timer = 0; emit(true); }, 250 - (ts - last));
			return;
		}
		last = ts;
		console.debug(P + JSON.stringify(snap()));
	};
	const bind = () => {
		const v = video();
		if (!v || v.__bardBound) return;
		v.__bardBound = true;
		for (const e of ["play", "pause", "timeupdate", "volumechange", "loadedmetadata", "ended"])
			v.addEventListener(e, () => emit(e !== "timeupdate"));
	};
	setInterval(bind, 1000); bind();
	setInterval(() => emit(false), 1000);
	const clickSel = (sel) => { const b = document.querySelector(sel); if (b) { b.click(); return true; } return false; };
	const cmd = (name, arg) => {
		const p = player(), v = video();
		switch (name) {
			case "play": if (p && p.playVideo) p.playVideo(); else if (v) v.play(); break;
			case "pause": if (p && p.pauseVideo) p.pauseVideo(); else if (v) v.pause(); break;
			case "toggle": return cmd(v && !v.paused ? "pause" : "play");
			case "next": if (p && p.nextVideo) p.nextVideo(); else clickSel("ytmusic-player-bar .next-button"); break;
			case "prev": if (p && p.previousVideo) p.previousVideo(); else clickSel("ytmusic-player-bar .previous-button"); break;
			case "seek": if (p && p.seekTo) p.seekTo(arg, true); else if (v) v.currentTime = arg; break;
			case "volume": if (p && p.setVolume) p.setVolume(arg); else if (v) v.volume = arg / 100; break;
		}
		emit(true);
		return snap();
	};
	window.__bard = { cmd, snap, emit };
	emit(true);
	return "injected";
})()`;

/** Chrome UA without the `Electron/` and `obsidian/` tokens (Google sign-in rejects those). */
function cleanUserAgent(): string {
	return navigator.userAgent
		.replace(/\s*(obsidian|Electron)\/[\d.]+/gi, "")
		.replace(/\s{2,}/g, " ")
		.trim();
}

class PlayerSpike {
	readonly host: HTMLDivElement;
	readonly webview: WebviewTag;
	readonly counters = { domReady: 0, didStartLoading: 0, didNavigate: 0, didNavigateInPage: 0, crashed: 0, stateMsgs: 0, injects: 0 };
	lastState: Record<string, unknown> | null = null;
	webContentsIds: number[] = [];
	private target: HTMLElement | null = null;
	private ro: ResizeObserver | null = null;
	private readonly reposition = () => this.place();
	private stateListeners: Array<(s: Record<string, unknown>) => void> = [];

	constructor(private readonly remote: RemoteLike | null) {
		const doc = document; // always the MAIN window: the webview never changes window.
		this.host = doc.createElement("div");
		this.host.className = "bard-spike-host";
		Object.assign(this.host.style, {
			position: "fixed",
			left: `${OFFSCREEN_LEFT}px`,
			top: "0px",
			width: "960px",
			height: "640px",
			zIndex: "var(--layer-popover)",
			overflow: "hidden",
		});
		const ua = cleanUserAgent();
		if (remote) {
			try {
				remote.session.fromPartition(PARTITION).setUserAgent(ua);
			} catch (err) {
				log(`session.setUserAgent failed: ${errMsg(err)}`);
			}
		}
		const wv = doc.createElement("webview") as WebviewTag;
		wv.setAttribute("partition", PARTITION);
		wv.setAttribute("useragent", ua);
		wv.setAttribute("webpreferences", "backgroundThrottling=no, autoplayPolicy=no-user-gesture-required");
		wv.setAttribute("src", YTM_URL);
		Object.assign(wv.style, { width: "100%", height: "100%", border: "0" });
		this.webview = wv;

		wv.addEventListener("dom-ready", () => {
			this.counters.domReady++;
			const id = wv.getWebContentsId();
			if (!this.webContentsIds.includes(id)) this.webContentsIds.push(id);
			void this.inject();
		});
		wv.addEventListener("did-start-loading", () => this.counters.didStartLoading++);
		wv.addEventListener("did-navigate", () => {
			this.counters.didNavigate++;
			void this.inject();
		});
		wv.addEventListener("did-navigate-in-page", () => this.counters.didNavigateInPage++);
		wv.addEventListener("render-process-gone", () => this.counters.crashed++);
		wv.addEventListener("console-message", (e) => {
			const msg = (e as ConsoleMessageEvent).message;
			if (typeof msg !== "string" || !msg.startsWith(MSG_PREFIX)) return;
			try {
				const s = JSON.parse(msg.slice(MSG_PREFIX.length)) as Record<string, unknown>;
				this.lastState = s;
				this.counters.stateMsgs++;
				for (const l of this.stateListeners) l(s);
			} catch {
				/* ignore malformed */
			}
		});

		this.host.appendChild(wv);
		doc.body.appendChild(this.host);
	}

	onState(cb: (s: Record<string, unknown>) => void): void {
		this.stateListeners.push(cb);
	}

	async inject(): Promise<unknown> {
		try {
			this.counters.injects++;
			return await this.webview.executeJavaScript(INJECT_SRC);
		} catch (err) {
			return `inject failed: ${errMsg(err)}`;
		}
	}

	eval(code: string, userGesture = false): Promise<unknown> {
		return this.webview.executeJavaScript(code, userGesture);
	}

	cmd(name: string, arg?: number): Promise<unknown> {
		const call = `window.__bard ? window.__bard.cmd(${JSON.stringify(name)}, ${JSON.stringify(arg ?? null)}) : null`;
		return this.webview.executeJavaScript(call, true);
	}

	/** Overlay: keep the fixed host glued to `el`'s rect. The webview itself never moves in the DOM. */
	attachTo(el: HTMLElement): void {
		this.detachObservers();
		this.target = el;
		this.ro = new ResizeObserver(this.reposition);
		this.ro.observe(el);
		window.addEventListener("resize", this.reposition);
		this.place();
	}

	detach(): void {
		this.detachObservers();
		this.target = null;
		this.place();
	}

	private detachObservers(): void {
		this.ro?.disconnect();
		this.ro = null;
		window.removeEventListener("resize", this.reposition);
	}

	place(): void {
		const el = this.target;
		const r = el?.isConnected ? el.getBoundingClientRect() : null;
		if (!r || r.width === 0 || r.height === 0) {
			// Off-screen, size preserved. Never display:none.
			this.host.style.left = `${OFFSCREEN_LEFT}px`;
			return;
		}
		Object.assign(this.host.style, {
			left: `${r.left}px`,
			top: `${r.top}px`,
			width: `${r.width}px`,
			height: `${r.height}px`,
		});
	}

	geometry(): { left: string; top: string; width: string; height: string } {
		const { left, top, width, height } = this.host.style;
		return { left, top, width, height };
	}

	destroy(): void {
		this.detach();
		this.stateListeners = [];
		this.host.remove();
	}
}

/* ------------------------------------------------------------------ */
/* F0.3 fallback (B-c) — mirror Media Session in the host renderer.    */
/* ------------------------------------------------------------------ */

function silentWavUrl(seconds = 2, rate = 8000): string {
	const n = seconds * rate;
	const buf = new ArrayBuffer(44 + n);
	const v = new DataView(buf);
	const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
	str(0, "RIFF");
	v.setUint32(4, 36 + n, true);
	str(8, "WAVE");
	str(12, "fmt ");
	v.setUint32(16, 16, true);
	v.setUint16(20, 1, true);
	v.setUint16(22, 1, true);
	v.setUint32(24, rate, true);
	v.setUint32(28, rate, true);
	v.setUint16(32, 1, true);
	v.setUint16(34, 8, true);
	str(36, "data");
	v.setUint32(40, n, true);
	for (let i = 0; i < n; i++) v.setUint8(44 + i, 128); // 8-bit PCM silence
	return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

class MirrorSessionSpike {
	private audio: HTMLAudioElement | null = null;
	private url: string | null = null;
	readonly actions: string[] = [];

	constructor(private readonly dispatch: (a: ThumbAction | "play" | "pause") => void) {}

	async start(): Promise<void> {
		this.url = silentWavUrl();
		const a = document.createElement("audio");
		a.src = this.url;
		a.loop = true;
		a.volume = 0.01;
		this.audio = a;
		await a.play();
		const ms = navigator.mediaSession;
		const handle = (name: string, act: ThumbAction | "play" | "pause") => {
			ms.setActionHandler(name as MediaSessionAction, () => {
				this.actions.push(name);
				this.dispatch(act);
			});
		};
		handle("play", "play");
		handle("pause", "pause");
		handle("nexttrack", "next");
		handle("previoustrack", "prev");
	}

	update(s: Record<string, unknown>): void {
		if (!this.audio) return;
		const art = typeof s.artwork === "string" ? [{ src: s.artwork }] : [];
		navigator.mediaSession.metadata = new MediaMetadata({
			title: String(s.title ?? ""),
			artist: String(s.artist ?? ""),
			album: String(s.album ?? ""),
			artwork: art,
		});
		navigator.mediaSession.playbackState = s.paused ? "paused" : "playing";
	}

	stop(): void {
		for (const a of ["play", "pause", "nexttrack", "previoustrack"]) {
			navigator.mediaSession.setActionHandler(a as MediaSessionAction, null);
		}
		navigator.mediaSession.metadata = null;
		this.audio?.pause();
		this.audio = null;
		if (this.url) URL.revokeObjectURL(this.url);
		this.url = null;
	}
}

/* ------------------------------------------------------------------ */
/* Plugin                                                               */
/* ------------------------------------------------------------------ */

export default class BardPlayerSpike extends Plugin {
	gen = 0;
	remote: RemoteLike | null = null;
	mainWin: BrowserWindowLike | null = null;
	thumbar: ThumbarSpike | null = null;
	player: PlayerSpike | null = null;
	mirror: MirrorSessionSpike | null = null;
	floating: { leaf: WorkspaceLeaf; win: BrowserWindowLike | null } | null = null;
	overlayLeaf: WorkspaceLeaf | null = null;
	private readonly clearThumbarOnUnload = () => {
		window.localStorage.setItem("bard-spike-guard-fired", String(Date.now()));
		this.thumbar?.stop();
	};

	async onload(): Promise<void> {
		const g = spikeGlobal();
		this.gen = ++g.generation;
		log(`onload gen=${this.gen}`);
		(window as SpikeWindow).bardSpike = this;

		// Test hook for the renderer-reload experiment: skip one load so stale thumbar
		// callbacks (if any survived the reload) are not overwritten by a fresh setThumbarButtons.
		if (window.localStorage.getItem(LS_SKIP_ONCE)) {
			window.localStorage.removeItem(LS_SKIP_ONCE);
			log("skipped load (test hook)");
			return;
		}

		this.remote = getRemote();
		if (this.remote) {
			try {
				this.mainWin = this.remote.getCurrentWindow();
			} catch (err) {
				log(`getCurrentWindow failed: ${errMsg(err)}`);
			}
		}

		// A renderer reload (Ctrl+R) may skip onunload; drop the thumbar callbacks before the
		// renderer dies so the main process never calls into a released context.
		if (!window.localStorage.getItem(LS_NO_GUARD)) window.addEventListener("beforeunload", this.clearThumbarOnUnload);

		if (Platform.isWin && this.mainWin) {
			this.thumbar = new ThumbarSpike(this.remote as RemoteLike, this.gen, (a) => this.onThumb(a));
			const ok = this.thumbar.start(this.mainWin);
			log(`thumbar start ok=${ok}`);
		}

		this.app.workspace.onLayoutReady(() => {
			this.player = new PlayerSpike(this.remote);
			this.player.onState((s) => {
				if (typeof s.paused === "boolean") this.thumbar?.setPlaying(!s.paused);
				this.mirror?.update(s);
			});
		});

		this.addCommand({ id: "self-test", name: "Run F0.1/F0.2 self-test (writes report)", callback: () => void this.selfTest() });
		this.addCommand({ id: "overlay-show", name: "Show player over a new tab (overlay)", callback: () => void this.showOverlay() });
		this.addCommand({ id: "overlay-hide", name: "Hide player (off-screen)", callback: () => this.hideOverlay() });
		this.addCommand({ id: "floating", name: "Open always-on-top floating popout", callback: () => void this.openFloating() });
		this.addCommand({ id: "mirror", name: "Toggle mirror Media Session (fallback)", callback: () => void this.toggleMirror() });
	}

	onunload(): void {
		log(`onunload gen=${this.gen}`);
		window.localStorage.setItem(LS_LAST_UNLOAD, String(Date.now()));
		window.removeEventListener("beforeunload", this.clearThumbarOnUnload);
		this.thumbar?.stop();
		this.thumbar = null;
		this.mirror?.stop();
		this.mirror = null;
		this.player?.destroy();
		this.player = null;
		this.overlayLeaf?.detach();
		this.floating?.leaf.detach();
		const w = window as SpikeWindow;
		if (w.bardSpike === this) delete w.bardSpike;
	}

	private onThumb(action: ThumbAction | "play" | "pause"): void {
		log(`action ${action}`);
		void this.player?.cmd(action);
	}

	/* ---------------- probes (F0.1) ---------------- */

	probeRemote(): Record<string, unknown> {
		const out: Record<string, unknown> = {
			obsidianApiVersion: apiVersion,
			versions: { ...process.versions },
			platform: process.platform,
			isWin: Platform.isWin,
			hasRemote: !!this.remote,
			windowElectronWindow: typeof (window as SpikeWindow).electronWindow,
		};
		if (!this.remote) return out;
		try {
			const cur = this.remote.getCurrentWindow();
			out.currentWindow = { id: cur.id, title: cur.getTitle(), hwnd: hwndOf(cur), webContentsId: cur.webContents.id };
			out.allWindows = this.remote.BrowserWindow.getAllWindows().map((w) => ({ id: w.id, title: w.getTitle() }));
		} catch (err) {
			out.error = errMsg(err);
		}
		return out;
	}

	async resolveMainByTitle(): Promise<{ id: number | null; matchesCurrent: boolean }> {
		if (!this.remote) return { id: null, matchesCurrent: false };
		const w = await resolveBrowserWindow(this.remote, document);
		return { id: w?.id ?? null, matchesCurrent: !!w && w.id === this.mainWin?.id };
	}

	/* ---------------- thumbar (F0.2) ---------------- */

	thumbarInfo(): Record<string, unknown> {
		const g = spikeGlobal();
		const w = this.mainWin;
		return {
			gen: this.gen,
			globalGen: g.generation,
			hwnd: w ? hwndOf(w) : null,
			playing: this.thumbar?.isPlaying() ?? null,
			applies: this.thumbar?.applies.slice(-10) ?? [],
			listenerCounts: w
				? Object.fromEntries(ThumbarSpike.REAPPLY_EVENTS.map((e) => [e, w.listenerCount(e)]))
				: null,
			clicks: g.clicks.slice(-20),
		};
	}

	minimizeRestore = async (): Promise<Record<string, unknown>> => {
		const w = this.mainWin;
		if (!w) return { error: "no main window" };
		const before = this.thumbar?.applies.length ?? 0;
		w.minimize();
		await sleep(800);
		const minimized = w.isMinimized();
		w.restore();
		await sleep(800);
		return { minimized, restored: !w.isMinimized(), reappliesAfterRestore: (this.thumbar?.applies.length ?? 0) - before };
	};

	/* ---------------- overlay (F0.5) ---------------- */

	async showOverlay(): Promise<Record<string, unknown>> {
		if (!this.player) return { error: "player not ready" };
		if (!this.overlayLeaf || !this.overlayLeaf.view?.containerEl.isConnected) {
			this.overlayLeaf = this.app.workspace.getLeaf("tab");
			await this.overlayLeaf.setViewState({ type: "empty", active: true });
		}
		const target = this.overlayLeaf.view.containerEl.querySelector<HTMLElement>(".view-content") ?? this.overlayLeaf.view.containerEl;
		this.player.attachTo(target);
		return { geometry: this.player.geometry() };
	}

	hideOverlay(): void {
		this.player?.detach();
	}

	/** Split the overlay leaf's pane and collapse/expand the left sidebar to force resizes. */
	async churnLayout(): Promise<Array<Record<string, unknown>>> {
		const out: Array<Record<string, unknown>> = [];
		const snap = (step: string) => out.push({ step, geometry: this.player?.geometry() });
		snap("start");
		const split = this.overlayLeaf ? this.app.workspace.createLeafBySplit(this.overlayLeaf, "vertical") : null;
		await split?.setViewState({ type: "empty" });
		await sleep(400);
		snap("after split");
		this.app.workspace.leftSplit.collapsed ? this.app.workspace.leftSplit.expand() : this.app.workspace.leftSplit.collapse();
		await sleep(600);
		snap("after sidebar toggle");
		split?.detach();
		await sleep(400);
		snap("after unsplit");
		return out;
	}

	/* ---------------- floating popout (F0.1 popout + F0.6) ---------------- */

	async openFloating(): Promise<Record<string, unknown>> {
		if (!this.remote) return { error: "no remote" };
		const before = new Set(this.remote.BrowserWindow.getAllWindows().map((w) => w.id));
		const leaf = this.app.workspace.openPopoutLeaf({ size: { width: 380, height: 240 } });
		await leaf.setViewState({ type: "empty" });
		const doc = leaf.view.containerEl.ownerDocument;
		const focused = this.remote.BrowserWindow.getFocusedWindow();
		const byTitle = await resolveBrowserWindow(this.remote, doc);
		const created = this.remote.BrowserWindow.getAllWindows().filter((w) => !before.has(w.id)).map((w) => w.id);
		const result: Record<string, unknown> = {
			popoutIsMainDocument: doc === document,
			popoutElectronWindow: typeof (doc.defaultView as SpikeWindow | null)?.electronWindow,
			byTitleId: byTitle?.id ?? null,
			focusedId: focused?.id ?? null,
			newWindowIds: created,
			mainId: this.mainWin?.id ?? null,
		};
		this.floating = { leaf, win: byTitle };
		if (byTitle) {
			byTitle.setAlwaysOnTop(true, "floating");
			result.isAlwaysOnTop = byTitle.isAlwaysOnTop();
			result.hwnd = hwndOf(byTitle);
		}
		return result;
	}

	closeFloating(): boolean {
		if (!this.floating) return false;
		this.floating.leaf.detach();
		this.floating = null;
		return true;
	}

	/* ---------------- mirror fallback (F0.3 B-c) ---------------- */

	async toggleMirror(): Promise<boolean> {
		if (this.mirror) {
			this.mirror.stop();
			this.mirror = null;
			return false;
		}
		this.mirror = new MirrorSessionSpike((a) => this.onThumb(a));
		await this.mirror.start();
		if (this.player?.lastState) this.mirror.update(this.player.lastState);
		return true;
	}

	/* ---------------- login (F0.4) ---------------- */

	async sessionInfo(): Promise<Record<string, unknown>> {
		if (!this.remote) return { error: "no remote" };
		const s = this.remote.session.fromPartition(PARTITION);
		const cookies = await s.cookies.get({});
		const names = (d: string) => cookies.filter((c) => (c.domain ?? "").includes(d)).map((c) => c.name);
		return {
			userAgent: s.getUserAgent(),
			cookieCount: cookies.length,
			youtubeCookies: names("youtube.com"),
			googleCookies: names("google.com"),
		};
	}

	/* ---------------- report ---------------- */

	async selfTest(): Promise<Record<string, unknown>> {
		const report = {
			at: new Date().toISOString(),
			remote: this.probeRemote(),
			mainByTitle: await this.resolveMainByTitle(),
			thumbar: this.thumbarInfo(),
			player: this.player ? { counters: this.player.counters, webContentsIds: this.player.webContentsIds, lastState: this.player.lastState } : null,
		};
		await this.app.vault.adapter.write(REPORT_PATH, JSON.stringify(report, null, 2));
		new Notice(`Bard spike: report written to ${REPORT_PATH}`);
		return report;
	}
}
