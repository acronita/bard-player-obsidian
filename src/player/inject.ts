import { MSG_PREFIX } from "./protocol";

/*
 * Guest-side bridge, run inside music.youtube.com via webview.executeJavaScript.
 * Idempotent (guarded by window.__bard); YTM is a SPA so it survives in-app navigation.
 *
 * State goes out through console.debug(MSG_PREFIX + JSON), picked up by the webview's
 * `console-message` event. Commands come in as window.__bard.cmd(name, arg).
 *
 * Like Pear Desktop, the YouTube player API on #movie_player is the primary control surface,
 * with clicks on the player bar as fallback. All YTM selectors live here.
 */
export const INJECT_SRC = `(() => {
	if (window.__bard) { window.__bard.emit(true); return "already"; }
	const P = ${JSON.stringify(MSG_PREFIX)};
	let last = 0, timer = 0, lastKey = "";
	const video = () => document.querySelector("video");
	const player = () => document.querySelector("#movie_player");
	const bar = () => document.querySelector("ytmusic-player-bar");
	const call = (p, fn, ...args) => (p && typeof p[fn] === "function" ? p[fn](...args) : undefined);
	const clickSel = (sel) => {
		const root = bar() || document;
		const b = root.querySelector(sel);
		if (b) { b.click(); return true; }
		return false;
	};
	const watchParam = (k) => (location.pathname === "/watch" ? new URLSearchParams(location.search).get(k) : null);
	const snap = () => {
		const v = video(), p = player();
		const md = navigator.mediaSession ? navigator.mediaSession.metadata : null;
		const art = md && md.artwork && md.artwork.length ? md.artwork[md.artwork.length - 1].src : null;
		const data = call(p, "getVideoData") || {};
		const likeEl = document.querySelector("ytmusic-player-bar ytmusic-like-button-renderer");
		const vol = call(p, "getVolume");
		return {
			title: (md && md.title) || data.title || null,
			artist: (md && md.artist) || data.author || null,
			album: md ? md.album : null,
			artwork: art,
			paused: v ? v.paused : null,
			position: v ? v.currentTime : null,
			duration: v && Number.isFinite(v.duration) ? v.duration : call(p, "getDuration") || null,
			volume: typeof vol === "number" ? vol : v ? v.volume * 100 : null,
			muted: call(p, "isMuted") === true || (v ? v.muted : false),
			liked: likeEl ? likeEl.getAttribute("like-status") : null,
			isAd: !!(p && p.classList && p.classList.contains("ad-showing")),
			videoId: data.video_id || watchParam("v") || null,
			playlistId: call(p, "getPlaylistId") || data.list || watchParam("list") || null,
			ts: Date.now()
		};
	};
	const emit = (now) => {
		const ts = Date.now();
		if (!now && ts - last < 250) {
			if (!timer) timer = setTimeout(() => { timer = 0; emit(true); }, 250 - (ts - last));
			return;
		}
		last = ts;
		console.debug(P + JSON.stringify(snap()));
	};
	const bind = () => {
		const v = video();
		if (v && !v.__bardBound) {
			v.__bardBound = true;
			for (const e of ["play", "pause", "volumechange", "loadedmetadata", "durationchange", "ended", "seeked"])
				v.addEventListener(e, () => emit(true));
			v.addEventListener("timeupdate", () => emit(false));
		}
		const p = player();
		if (p && !p.__bardBound && typeof p.addEventListener === "function") {
			p.__bardBound = true;
			p.addEventListener("videodatachange", () => emit(true));
		}
		const s = snap();
		const key = [s.title, s.artist, s.liked, s.isAd].join("|");
		if (key !== lastKey) { lastKey = key; emit(true); }
	};
	setInterval(bind, 1000); bind();
	setInterval(() => emit(false), 2000);
	const cmd = (name, arg) => {
		const p = player(), v = video();
		switch (name) {
			case "play": if (p && p.playVideo) p.playVideo(); else if (v) v.play(); break;
			case "pause": if (p && p.pauseVideo) p.pauseVideo(); else if (v) v.pause(); break;
			case "toggle": return cmd(v && !v.paused ? "pause" : "play");
			case "next": if (p && p.nextVideo) p.nextVideo(); else clickSel(".next-button"); break;
			case "prev": if (p && p.previousVideo) p.previousVideo(); else clickSel(".previous-button"); break;
			case "seek": if (p && p.seekTo) p.seekTo(arg, true); else if (v) v.currentTime = arg; break;
			case "volume":
				if (p && p.setVolume) { p.setVolume(arg); if (arg > 0) call(p, "unMute"); }
				else if (v) v.volume = arg / 100;
				break;
			case "mute":
				if (p && p.isMuted) { if (p.isMuted()) p.unMute(); else p.mute(); }
				else if (v) v.muted = !v.muted;
				break;
			case "like": clickSel("ytmusic-like-button-renderer #button-shape-like button") || clickSel("ytmusic-like-button-renderer .like"); break;
			case "dislike": clickSel("ytmusic-like-button-renderer #button-shape-dislike button") || clickSel("ytmusic-like-button-renderer .dislike"); break;
		}
		setTimeout(() => emit(true), 150);
		return true;
	};
	window.__bard = { cmd, snap, emit };
	emit(true);
	return "injected";
})()`;
