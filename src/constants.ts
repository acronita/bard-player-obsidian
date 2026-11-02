export const PLUGIN_ID = "bard-player";

export const VIEW_TYPE_PLAYER = "bard-player-view";
export const VIEW_TYPE_MINI = "bard-player-mini";

/** Set by `npm run build:test`, so the test vault signs in apart from the everyday one. */
declare const BARD_PARTITION: string | undefined;

/**
 * Persistent Electron partition: cookies/login are stored in Obsidian's app data, never in the vault,
 * and are shared by every vault of that Obsidian install.
 */
export const PARTITION = typeof BARD_PARTITION === "string" ? BARD_PARTITION : "persist:bard-player";
export const YTM_URL = "https://music.youtube.com";
