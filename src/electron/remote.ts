/*
 * Thin, failure-tolerant access to Electron's `remote` (the same path surfing-obsidian uses).
 * Nothing here throws: callers get null and degrade (see docs/SPIKE.md F0.1).
 */

type Listener = (...args: unknown[]) => void;

export interface NativeImageLike {
	isEmpty(): boolean;
}

export interface ThumbarButton {
	tooltip?: string;
	icon: NativeImageLike;
	click: () => void;
	flags?: string[];
}

export interface BrowserWindowLike {
	id: number;
	isDestroyed(): boolean;
	setThumbarButtons(buttons: ThumbarButton[]): boolean;
	on(event: string, cb: Listener): void;
	removeListener(event: string, cb: Listener): void;
}

interface WebContentsLike {
	setWindowOpenHandler(handler: (details: { url: string }) => { action: "deny" | "allow" }): void;
}

export interface RemoteLike {
	getCurrentWindow(): BrowserWindowLike;
	nativeImage: { createFromDataURL(url: string): NativeImageLike };
	session: { fromPartition(partition: string): { setUserAgent(ua: string): void } };
	webContents: { fromId(id: number): WebContentsLike | undefined };
}

let cached: RemoteLike | null | undefined;

export function getRemote(): RemoteLike | null {
	if (cached !== undefined) return cached;
	try {
		const req = (window as unknown as { require?: (id: string) => unknown }).require;
		const electron = req?.("electron") as { remote?: RemoteLike } | undefined;
		cached = electron?.remote ?? null;
	} catch (err) {
		console.warn("[bard-player] electron remote unavailable", err);
		cached = null;
	}
	return cached;
}

/** Plugin code runs only in the main renderer, so the current window is always the main one. */
export function getMainBrowserWindow(): BrowserWindowLike | null {
	try {
		return getRemote()?.getCurrentWindow() ?? null;
	} catch {
		return null;
	}
}

export function setPartitionUserAgent(partition: string, ua: string): void {
	try {
		getRemote()?.session.fromPartition(partition).setUserAgent(ua);
	} catch (err) {
		console.warn("[bard-player] setUserAgent failed", err);
	}
}

/** Popups from the guest (e.g. "open in YouTube", external links) go to the system browser. */
export function routePopupsToBrowser(webContentsId: number): void {
	try {
		const wc = getRemote()?.webContents.fromId(webContentsId);
		wc?.setWindowOpenHandler(({ url }) => {
			if (/^https?:/i.test(url)) window.open(url);
			return { action: "deny" };
		});
	} catch (err) {
		console.warn("[bard-player] setWindowOpenHandler failed", err);
	}
}
