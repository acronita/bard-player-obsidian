/*
 * Browser identity presented to Google. Obsidian ships an old Chromium whose client hints only say
 * "Chromium", which Google sign-in rejects as an embedded/unsafe browser. We present a current
 * browser consistently in the User-Agent header, the Sec-CH-UA headers and navigator.userAgentData.
 * Pure functions, unit-tested.
 */

export type UaMode = "chrome" | "firefox" | "electron";

/** Order in which identities are tried when Google rejects the sign-in. */
export const UA_MODES: readonly UaMode[] = ["chrome", "firefox", "electron"];

export function nextUaMode(mode: UaMode): UaMode | null {
	return UA_MODES[UA_MODES.indexOf(mode) + 1] ?? null;
}
export type OsKind = "windows" | "mac" | "linux";

/** CDP Emulation.UserAgentMetadata. */
export interface UaMetadata {
	brands: Array<{ brand: string; version: string }>;
	fullVersionList: Array<{ brand: string; version: string }>;
	fullVersion: string;
	platform: string;
	platformVersion: string;
	architecture: string;
	model: string;
	mobile: boolean;
	bitness: string;
	wow64: boolean;
}

export interface UaProfile {
	userAgent: string;
	/** null = send no client hints (Firefox does not have them). */
	metadata: UaMetadata | null;
	/** false = no DevTools override at all: the embedded browser's own client hints are used. */
	emulate: boolean;
}

export interface EngineVersions {
	/** e.g. "120.0.6099.291" */
	chrome: string;
	/** e.g. "28.3.3" */
	electron: string;
}

const DAY = 86_400_000;
const RELEASE_INTERVAL = 28 * DAY;
// Anchors: Chrome 120 and Firefox 121 both shipped in early December 2023; both release every ~4 weeks.
const CHROME_ANCHOR = { version: 120, at: Date.UTC(2023, 11, 5) };
const FIREFOX_ANCHOR = { version: 121, at: Date.UTC(2023, 11, 19) };
/** Stay a couple of releases behind "today" so we never claim a version that does not exist yet. */
const SAFETY_LAG = 2;

function versionAt(anchor: { version: number; at: number }, now: number): number {
	const steps = Math.floor((now - anchor.at) / RELEASE_INTERVAL) - SAFETY_LAG;
	return anchor.version + Math.max(0, steps);
}

export const chromeVersionAt = (now: number, actual = 0): number => Math.max(actual, versionAt(CHROME_ANCHOR, now));
export const firefoxVersionAt = (now: number): number => versionAt(FIREFOX_ANCHOR, now);

const CHROME_OS: Record<OsKind, string> = {
	windows: "Windows NT 10.0; Win64; x64",
	mac: "Macintosh; Intel Mac OS X 10_15_7",
	linux: "X11; Linux x86_64",
};

const FIREFOX_OS: Record<OsKind, string> = {
	windows: "Windows NT 10.0; Win64; x64",
	mac: "Macintosh; Intel Mac OS X 10.15",
	linux: "X11; Linux x86_64",
};

const HINT_PLATFORM: Record<OsKind, { platform: string; platformVersion: string }> = {
	windows: { platform: "Windows", platformVersion: "15.0.0" },
	mac: { platform: "macOS", platformVersion: "14.0.0" },
	linux: { platform: "Linux", platformVersion: "" },
};

/**
 * @param engine versions of the embedded Chromium/Electron. We never claim to be older than it, and
 *   "electron" mode reports it as is (Pear Desktop's retry fallback).
 */
export function buildProfile(mode: UaMode, os: OsKind, now: number, engine: EngineVersions): UaProfile {
	if (mode === "electron") {
		return {
			userAgent: `Mozilla/5.0 (${CHROME_OS[os]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${engine.chrome} Electron/${engine.electron} Safari/537.36`,
			metadata: null,
			emulate: false,
		};
	}
	if (mode === "firefox") {
		const v = firefoxVersionAt(now);
		return { userAgent: `Mozilla/5.0 (${FIREFOX_OS[os]}; rv:${v}.0) Gecko/20100101 Firefox/${v}.0`, metadata: null, emulate: true };
	}
	const v = chromeVersionAt(now, parseInt(engine.chrome, 10) || 0);
	const full = `${v}.0.0.0`;
	const brands = [
		{ brand: "Google Chrome", version: String(v) },
		{ brand: "Chromium", version: String(v) },
		{ brand: "Not_A Brand", version: "24" },
	];
	return {
		userAgent: `Mozilla/5.0 (${CHROME_OS[os]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${full} Safari/537.36`,
		metadata: {
			brands,
			fullVersionList: brands.map((b) => ({ brand: b.brand, version: b.brand === "Not_A Brand" ? "24.0.0.0" : full })),
			fullVersion: full,
			...HINT_PLATFORM[os],
			architecture: "x86",
			model: "",
			mobile: false,
			bitness: "64",
			wow64: false,
		},
		emulate: true,
	};
}

/** Google's "This browser or app may not be secure" page. */
export function isSignInRejected(url: string): boolean {
	return /^https:\/\/accounts\.google\.com\/(?:[^?#]*\/)?rejected(?:[/?#]|$)/i.test(url);
}
