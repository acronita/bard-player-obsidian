/*
 * Browser identity presented to Google. Obsidian's Chromium client hints only say "Chromium", which
 * Google sign-in rejects as an embedded/unsafe browser. We present another browser consistently in
 * the User-Agent header, the Sec-CH-UA headers and navigator.userAgentData. Pure functions, unit-tested.
 */

export type UaMode = "chrome" | "firefox" | "electron";

/**
 * Order in which identities are tried when Google rejects the sign-in. Firefox goes first: it is the
 * identity sign-in has been seen to accept on the first try.
 */
export const UA_MODES: readonly UaMode[] = ["firefox", "chrome", "electron"];

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
// Anchor: Firefox 121 shipped in December 2023; it releases every ~4 weeks.
const FIREFOX_ANCHOR = { version: 121, at: Date.UTC(2023, 11, 19) };
/** Stay a couple of releases behind "today" so we never claim a version that does not exist yet. */
const SAFETY_LAG = 2;

function versionAt(anchor: { version: number; at: number }, now: number): number {
	const steps = Math.floor((now - anchor.at) / RELEASE_INTERVAL) - SAFETY_LAG;
	return anchor.version + Math.max(0, steps);
}

export const firefoxVersionAt = (now: number): number => versionAt(FIREFOX_ANCHOR, now);

// Anchor: Chrome 120 shipped in December 2023, on the same ~4-week cadence.
const CHROME_ANCHOR = { version: 120, at: Date.UTC(2023, 11, 5) };
/** About a year of Chrome releases. */
const OUTDATED_RELEASES = 13;

/**
 * Whether the embedded engine is more than about a year behind current Chrome. Google refuses
 * sign-in on old engines whatever identity is presented (seen: Chrome 120 refused in late 2026,
 * Chrome 150 accepted). Only a new Obsidian installer updates the engine.
 */
export function isEngineOutdated(chrome: string, now: number): boolean {
	const major = parseInt(chrome, 10);
	return Number.isFinite(major) && versionAt(CHROME_ANCHOR, now) - major > OUTDATED_RELEASES;
}

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
 * @param engine versions of the embedded Chromium/Electron. "chrome" mode claims exactly this version:
 *   a newer claim is contradicted by the page's JS features, which Google sign-in checks. "electron" mode reports it as is (Pear Desktop's retry fallback).
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
	const v = parseInt(engine.chrome, 10) || 120;
	const full = /^\d+\.\d+\.\d+\.\d+$/.test(engine.chrome) ? engine.chrome : `${v}.0.0.0`;
	const brands = [
		{ brand: "Google Chrome", version: String(v) },
		{ brand: "Chromium", version: String(v) },
		{ brand: "Not_A Brand", version: "24" },
	];
	return {
		userAgent: `Mozilla/5.0 (${CHROME_OS[os]}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v}.0.0.0 Safari/537.36`,
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
