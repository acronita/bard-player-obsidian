import { test } from "node:test";
import assert from "node:assert/strict";
import { MSG_PREFIX, formatTime, livePosition, parseMessage, watchUrl } from "../src/player/protocol.ts";

const msg = (o: unknown) => MSG_PREFIX + JSON.stringify(o);

test("ignores non-Bard and malformed messages", () => {
	assert.equal(parseMessage("hello"), null);
	assert.equal(parseMessage(42), null);
	assert.equal(parseMessage(MSG_PREFIX + "{not json"), null);
	assert.equal(parseMessage(MSG_PREFIX + "[1,2]"), null);
	assert.equal(parseMessage(MSG_PREFIX + "null"), null);
});

test("normalizes a playing snapshot", () => {
	const s = parseMessage(
		msg({ title: "Song", artist: "Band", album: "LP", artwork: "https://x/a.jpg", paused: false, position: 12.5, duration: 200, volume: 73.6, muted: false, liked: "LIKE", isAd: false, videoId: "abc", playlistId: "RDAMVMabc", ts: 1000 }),
	);
	assert.deepEqual(s, {
		status: "playing",
		title: "Song",
		artist: "Band",
		album: "LP",
		artworkUrl: "https://x/a.jpg",
		position: 12.5,
		duration: 200,
		volume: 74,
		muted: false,
		liked: "like",
		isAd: false,
		videoId: "abc",
		playlistId: "RDAMVMabc",
		ts: 1000,
	});
});

test("no video or no title means idle; junk fields fall back", () => {
	assert.equal(parseMessage(msg({ title: "Song", paused: null }))?.status, "idle");
	assert.equal(parseMessage(msg({ title: "", paused: false }))?.status, "idle");
	const s = parseMessage(msg({ title: "S", paused: true, duration: null, volume: 500, liked: "weird", artwork: 3 }));
	assert.equal(s?.status, "paused");
	assert.equal(s?.duration, 0);
	assert.equal(s?.volume, 100);
	assert.equal(s?.liked, null);
	assert.equal(s?.artworkUrl, null);
});

test("livePosition extrapolates only while playing and caps at duration", () => {
	const base = parseMessage(msg({ title: "S", paused: false, position: 10, duration: 12, ts: 1000 }));
	assert.ok(base);
	assert.equal(livePosition(base, 2000), 11);
	assert.equal(livePosition(base, 9000), 12);
	assert.equal(livePosition({ ...base, status: "paused" }, 9000), 10);
});

test("watchUrl builds a watch page, with the list only when known", () => {
	assert.equal(watchUrl("https://m", "abc", null), "https://m/watch?v=abc");
	assert.equal(watchUrl("https://m", "abc", "PL1"), "https://m/watch?v=abc&list=PL1");
});

test("formatTime", () => {
	assert.equal(formatTime(0), "0:00");
	assert.equal(formatTime(65.9), "1:05");
	assert.equal(formatTime(3725), "1:02:05");
	assert.equal(formatTime(NaN), "0:00");
});
