/*
 * Messages between the YouTube Music guest (inject.ts) and the plugin.
 * Kept free of Obsidian/Electron imports so it can be unit-tested with plain Node.
 */

export const MSG_PREFIX = "__BARD__";

export type PlayStatus = "idle" | "playing" | "paused";
export type LikeStatus = "like" | "dislike" | "none";

export interface PlayerState {
	status: PlayStatus;
	title: string;
	artist: string;
	album: string;
	artworkUrl: string | null;
	/** Seconds. */
	position: number;
	/** Seconds; 0 when unknown. */
	duration: number;
	/** 0–100. */
	volume: number;
	muted: boolean;
	liked: LikeStatus | null;
	/** An ad is playing (metadata then describes the ad, not a track). */
	isAd: boolean;
	/** YouTube video id of the current item, when known. */
	videoId: string | null;
	/** Playlist / album / radio the item plays from, when known. */
	playlistId: string | null;
	/** Guest clock (ms) when the snapshot was taken. */
	ts: number;
}

export type Command =
	| { name: "play" | "pause" | "toggle" | "next" | "prev" | "like" | "dislike" | "mute" }
	| { name: "seek"; value: number }
	| { name: "volume"; value: number };

export const EMPTY_STATE: PlayerState = {
	status: "idle",
	title: "",
	artist: "",
	album: "",
	artworkUrl: null,
	position: 0,
	duration: 0,
	volume: 100,
	muted: false,
	liked: null,
	isAd: false,
	videoId: null,
	playlistId: null,
	ts: 0,
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Parse a console message from the guest. Returns null for anything that is not a valid Bard message. */
export function parseMessage(message: unknown): PlayerState | null {
	if (typeof message !== "string" || !message.startsWith(MSG_PREFIX)) return null;
	let raw: unknown;
	try {
		raw = JSON.parse(message.slice(MSG_PREFIX.length));
	} catch {
		return null;
	}
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
	return normalize(raw as Record<string, unknown>);
}

export function normalize(raw: Record<string, unknown>): PlayerState {
	const title = str(raw.title);
	const hasMedia = typeof raw.paused === "boolean" && title !== "";
	const liked = raw.liked === "LIKE" ? "like" : raw.liked === "DISLIKE" ? "dislike" : raw.liked === "INDIFFERENT" ? "none" : null;
	const artwork = str(raw.artwork);
	return {
		status: !hasMedia ? "idle" : raw.paused ? "paused" : "playing",
		title,
		artist: str(raw.artist),
		album: str(raw.album),
		artworkUrl: artwork || null,
		position: Math.max(0, num(raw.position)),
		duration: Math.max(0, num(raw.duration)),
		volume: clamp(Math.round(num(raw.volume, 100)), 0, 100),
		muted: raw.muted === true,
		liked,
		isAd: raw.isAd === true,
		videoId: str(raw.videoId) || null,
		playlistId: str(raw.playlistId) || null,
		ts: num(raw.ts),
	};
}

/** Position extrapolated to `now` (ms) while playing, so progress bars move between messages. */
export function livePosition(s: PlayerState, now: number): number {
	if (s.status !== "playing" || s.ts === 0) return s.position;
	const pos = s.position + (now - s.ts) / 1000;
	return s.duration > 0 ? Math.min(pos, s.duration) : pos;
}

/** YouTube Music page that plays `videoId`, continuing in `playlistId` when given. */
export function watchUrl(base: string, videoId: string, playlistId: string | null): string {
	const params = new URLSearchParams({ v: videoId });
	if (playlistId) params.set("list", playlistId);
	return `${base}/watch?${params.toString()}`;
}

export function formatTime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
	const total = Math.floor(seconds);
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = String(total % 60).padStart(2, "0");
	return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}
