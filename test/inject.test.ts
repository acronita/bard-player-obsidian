import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { buildSync } from "esbuild";

// inject.ts uses an extensionless import, which plain Node cannot resolve, so bundle it first.
const bundled = buildSync({ entryPoints: ["src/player/inject.ts"], bundle: true, format: "esm", write: false });
const { INJECT_SRC } = (await import(
	"data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64")
)) as { INJECT_SRC: string };

interface Snapshot {
	position: number | null;
	duration: number | null;
}

/** Runs the real guest script against a fake page and returns its first snapshot. */
function snapshot(video: object, player: object | null): Snapshot {
	const page: Record<string, unknown> = {
		document: {
			querySelector: (sel: string) => (sel === "video" ? video : sel === "#movie_player" ? player : null),
		},
		navigator: {},
		location: { pathname: "/", search: "" },
		URLSearchParams,
		console: { debug: () => {} },
		setInterval: () => 0,
		setTimeout: () => 0,
	};
	page.window = page;
	vm.runInNewContext(INJECT_SRC, page);
	return (page.__bard as { snap: () => Snapshot }).snap();
}

const video = (currentTime: number, duration: number) => ({
	paused: false,
	volume: 1,
	muted: false,
	currentTime,
	duration,
	addEventListener: () => {},
});

test("reports the current track's time when the media element keeps counting across tracks", () => {
	const player = { getCurrentTime: () => 5, getDuration: () => 200 };
	const s = snapshot(video(245, 480), player);
	assert.equal(s.position, 5);
	assert.equal(s.duration, 200);
});

test("a track start at 0 s is not mistaken for a missing player value", () => {
	const player = { getCurrentTime: () => 0, getDuration: () => 200 };
	assert.equal(snapshot(video(245, 480), player).position, 0);
});

test("falls back to the media element without the player API", () => {
	const s = snapshot(video(12, 180), null);
	assert.equal(s.position, 12);
	assert.equal(s.duration, 180);
});

test("reports the track's full length, not the part loaded so far", () => {
	const player = {
		getCurrentTime: () => 30,
		getDuration: () => 49,
		getVideoData: () => ({ video_id: "abc" }),
		getPlayerResponse: () => ({ videoDetails: { videoId: "abc", lengthSeconds: "225" } }),
	};
	assert.equal(snapshot(video(30, 49), player).duration, 225);
});

test("ignores a track length that belongs to another item", () => {
	const player = {
		getCurrentTime: () => 2,
		getDuration: () => 180,
		getVideoData: () => ({ video_id: "new" }),
		getPlayerResponse: () => ({ videoDetails: { videoId: "old", lengthSeconds: "225" } }),
	};
	assert.equal(snapshot(video(2, 180), player).duration, 180);
});

test("uses the ad's own duration while an ad plays", () => {
	const player = {
		classList: { contains: (c: string) => c === "ad-showing" },
		getCurrentTime: () => 4,
		getDuration: () => 15,
		getVideoData: () => ({ video_id: "abc" }),
		getPlayerResponse: () => ({ videoDetails: { videoId: "abc", lengthSeconds: "225" } }),
	};
	assert.equal(snapshot(video(4, 15), player).duration, 15);
});

test("falls back to the media element's duration while the player reports none", () => {
	const player = { getCurrentTime: () => 3, getDuration: () => 0 };
	assert.equal(snapshot(video(3, 180), player).duration, 180);
});
