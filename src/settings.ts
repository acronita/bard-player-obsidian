export type MiniBackdrop = "artwork" | "theme" | "black";

export const MINI_BACKDROPS: readonly MiniBackdrop[] = ["artwork", "theme", "black"];

/** What to do with the last track / playlist / radio when Obsidian opens. */
export type StartupPlayback = "off" | "resume" | "restart";

export const STARTUP_PLAYBACKS: readonly StartupPlayback[] = ["off", "resume", "restart"];

export interface BardSettings {
	miniBackdrop: MiniBackdrop;
	/** Strength of the blurred artwork wash, 0–100. */
	miniArtworkOpacity: number;
	startupPlayback: StartupPlayback;
}

export const DEFAULT_SETTINGS: BardSettings = {
	miniBackdrop: "artwork",
	miniArtworkOpacity: 60,
	startupPlayback: "off",
};

/** Merges stored data over the defaults, dropping anything malformed. */
export function normalizeSettings(raw: unknown): BardSettings {
	const data = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
	const backdrop = MINI_BACKDROPS.find((b) => b === data.miniBackdrop) ?? DEFAULT_SETTINGS.miniBackdrop;
	const opacity = typeof data.miniArtworkOpacity === "number" && Number.isFinite(data.miniArtworkOpacity)
		? Math.min(100, Math.max(0, Math.round(data.miniArtworkOpacity)))
		: DEFAULT_SETTINGS.miniArtworkOpacity;
	const startup = STARTUP_PLAYBACKS.find((p) => p === data.startupPlayback) ?? DEFAULT_SETTINGS.startupPlayback;
	return { miniBackdrop: backdrop, miniArtworkOpacity: opacity, startupPlayback: startup };
}
