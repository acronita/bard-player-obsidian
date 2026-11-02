/*
 * Opt-in diagnostics (Settings → Debug logging), meant to be copied from the developer console when
 * sign-in fails. Written as warnings: the console hides debug output by default and the plugin
 * guidelines rule out log/info, and an empty console after "turn on debug logging" would mislead.
 */

let enabled = false;

/** @returns whether logging was just switched on. */
export function setDebugLogging(on: boolean): boolean {
	const turnedOn = on && !enabled;
	enabled = on;
	return turnedOn;
}

export function debugLog(...args: unknown[]): void {
	if (enabled) console.warn("[bard-player]", ...args);
}

/** Origin and path only: sign-in URLs carry tokens and the e-mail in their query. */
export function redactUrl(url: string): string {
	return url.split(/[?#]/)[0] ?? url;
}
