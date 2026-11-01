import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, normalizeSettings } from "../src/settings.ts";

test("missing data falls back to defaults", () => {
	assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
	assert.deepEqual(normalizeSettings({}), DEFAULT_SETTINGS);
});

test("valid stored values are kept", () => {
	assert.deepEqual(normalizeSettings({ miniBackdrop: "black", miniArtworkOpacity: 25, startupPlayback: "restart" }), {
		miniBackdrop: "black",
		miniArtworkOpacity: 25,
		startupPlayback: "restart",
	});
});

test("malformed values are dropped or clamped", () => {
	assert.deepEqual(normalizeSettings({ miniBackdrop: "neon", miniArtworkOpacity: "high", startupPlayback: "yes" }), DEFAULT_SETTINGS);
	assert.equal(normalizeSettings({ miniArtworkOpacity: 140 }).miniArtworkOpacity, 100);
	assert.equal(normalizeSettings({ miniArtworkOpacity: -5 }).miniArtworkOpacity, 0);
});
