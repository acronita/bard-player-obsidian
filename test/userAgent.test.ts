import { test } from "node:test";
import assert from "node:assert/strict";
import { buildProfile, firefoxVersionAt, isEngineOutdated, isSignInRejected, nextUaMode } from "../src/player/userAgent.ts";

const ENGINE = { chrome: "120.0.6099.291", electron: "28.3.3" };

const OCT_2024 = Date.UTC(2024, 9, 15); // Chrome 130 shipped around here
const OCT_2026 = Date.UTC(2026, 9, 31);

test("firefox version estimate tracks the release cadence, lagging slightly", () => {
	const v = firefoxVersionAt(OCT_2024);
	assert.ok(v >= 128 && v <= 131, `firefox ${v}`);
	assert.ok(firefoxVersionAt(OCT_2026) > 145);
	assert.equal(firefoxVersionAt(Date.UTC(2023, 0, 1)), 121);
});

test("chrome profile is consistent between UA string and client hints", () => {
	const p = buildProfile("chrome", "windows", OCT_2026, ENGINE);
	const major = /Chrome\/(\d+)\.0\.0\.0/.exec(p.userAgent)?.[1];
	assert.ok(major);
	assert.ok(!/Electron|obsidian/i.test(p.userAgent));
	assert.ok(p.metadata);
	assert.equal(p.metadata.platform, "Windows");
	assert.deepEqual(p.metadata.brands.find((b) => b.brand === "Google Chrome")?.version, major);
	assert.equal(p.metadata.fullVersion, ENGINE.chrome);
});

test("chrome profile claims the engine's own version, never a newer one", () => {
	const p = buildProfile("chrome", "windows", OCT_2026, ENGINE);
	assert.match(p.userAgent, /Chrome\/120\.0\.0\.0 /);
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
	assert.equal(nextUaMode("firefox"), "chrome");
	assert.equal(nextUaMode("chrome"), "electron");
	assert.equal(nextUaMode("electron"), null);
});

test("flags engines about a year or more behind current Chrome", () => {
	const NOV_2026 = Date.UTC(2026, 10, 2);
	assert.ok(isEngineOutdated("120.0.6099.291", NOV_2026), "refused by Google in late 2026");
	assert.ok(!isEngineOutdated("150.0.7871.250", NOV_2026), "accepted by Google in late 2026");
	assert.ok(!isEngineOutdated("120.0.6099.291", Date.UTC(2024, 0, 15)), "current at the time");
	assert.ok(!isEngineOutdated("", NOV_2026), "unknown engine is not flagged");
});

test("detects Google's rejected sign-in page", () => {
	assert.ok(isSignInRejected("https://accounts.google.com/v3/signin/rejected?continue=x"));
	assert.ok(isSignInRejected("https://accounts.google.com/signin/rejected"));
	assert.ok(!isSignInRejected("https://accounts.google.com/v3/signin/identifier?continue=x"));
	assert.ok(!isSignInRejected("https://music.youtube.com/rejected"));
});
