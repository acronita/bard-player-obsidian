import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProfile, chromeVersionAt, firefoxVersionAt, isSignInRejected, nextUaMode } from "../src/player/userAgent.ts";

const ENGINE = { chrome: "120.0.6099.291", electron: "28.3.3" };

const OCT_2024 = Date.UTC(2024, 9, 15); // Chrome 130 shipped around here
const OCT_2026 = Date.UTC(2026, 9, 31);

test("version estimates track the release cadence, lagging slightly", () => {
	const v = chromeVersionAt(OCT_2024);
	assert.ok(v >= 127 && v <= 130, `chrome ${v}`);
	assert.ok(chromeVersionAt(OCT_2026) > 145);
	assert.ok(firefoxVersionAt(OCT_2026) > 145);
	assert.equal(chromeVersionAt(Date.UTC(2023, 0, 1)), 120);
	assert.equal(chromeVersionAt(OCT_2024, 200), 200, "never older than the embedded Chromium");
});

test("chrome profile is consistent between UA string and client hints", () => {
	const p = buildProfile("chrome", "windows", OCT_2026, ENGINE);
	const major = /Chrome\/(\d+)\.0\.0\.0/.exec(p.userAgent)?.[1];
	assert.ok(major);
	assert.ok(!/Electron|obsidian/i.test(p.userAgent));
	assert.ok(p.metadata);
	assert.equal(p.metadata.platform, "Windows");
	assert.deepEqual(p.metadata.brands.find((b) => b.brand === "Google Chrome")?.version, major);
	assert.equal(p.metadata.fullVersion, `${major}.0.0.0`);
});

test("firefox profile sends no client hints", () => {
	const p = buildProfile("firefox", "mac", OCT_2026, ENGINE);
	assert.match(p.userAgent, /^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X 10\.15; rv:(\d+)\.0\) Gecko\/20100101 Firefox\/\1\.0$/);
	assert.equal(p.metadata, null);
	assert.equal(p.emulate, true);
});

test("electron profile reports the real engine without emulation", () => {
	const p = buildProfile("electron", "windows", OCT_2026, ENGINE);
	assert.match(p.userAgent, /Chrome\/120\.0\.6099\.291 Electron\/28\.3\.3/);
	assert.equal(p.emulate, false);
});

test("identities are tried in order and then run out", () => {
	assert.equal(nextUaMode("chrome"), "firefox");
	assert.equal(nextUaMode("firefox"), "electron");
	assert.equal(nextUaMode("electron"), null);
});

test("detects Google's rejected sign-in page", () => {
	assert.ok(isSignInRejected("https://accounts.google.com/v3/signin/rejected?continue=x"));
	assert.ok(isSignInRejected("https://accounts.google.com/signin/rejected"));
	assert.ok(!isSignInRejected("https://accounts.google.com/v3/signin/identifier?continue=x"));
	assert.ok(!isSignInRejected("https://music.youtube.com/rejected"));
});
