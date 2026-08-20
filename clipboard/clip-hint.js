// clip-hint.js — dsh web 输入框剪贴板图片提示
// 轮询本地状态服务（clip-state-server），剪贴板有图片被捕获时，
// 在输入框上方显示 "[图片已就绪: xxx.png]" 占位提示。
(function () {
	"use strict";
	const STATE_URL = "http://127.0.0.1:51799/state";
	const POLL_MS = 2000;
	let lastTs = 0;
	let hintEl = null;

	function ensureHint() {
		if (hintEl) return hintEl;
		hintEl = document.createElement("div");
		hintEl.id = "dsh-clip-hint";
		hintEl.style.cssText = [
			"position:fixed", "bottom:120px", "right:24px", "z-index:99999",
			"background:rgba(20,20,24,0.92)", "color:#7ee787",
			"padding:8px 14px", "border-radius:8px", "font-size:13px",
			"font-family:ui-monospace,SFMono-Regular,Menlo,monospace",
			"box-shadow:0 4px 16px rgba(0,0,0,0.35)", "border:1px solid rgba(126,231,135,0.35)",
			"display:none", "pointer-events:none", "max-width:420px", "white-space:nowrap",
			"overflow:hidden", "text-overflow:ellipsis",
		].join(";");
		document.body.appendChild(hintEl);
		return hintEl;
	}

	function show(text) {
		const el = ensureHint();
		el.textContent = text;
		el.style.display = "block";
	}

	function hide() {
		if (hintEl) hintEl.style.display = "none";
	}

	async function poll() {
		try {
			const res = await fetch(STATE_URL, { cache: "no-store" });
			if (!res.ok) return;
			const data = await res.json();
			if (data.latest && data.ts !== lastTs) {
				lastTs = data.ts;
				const n = data.count > 1 ? "（共" + data.count + "张，最近5张: " + data.recent.join(", ") + "）" : "";
				show("[图片已就绪: " + data.latest + "]" + n + " 说\"看下我刚贴的图\"即可");
				// 10 秒后自动隐藏
				setTimeout(hide, 10000);
			}
		} catch {
			// 状态服务不可达（未启动），静默忽略
		}
	}

	// 启动轮询
	poll();
	setInterval(poll, POLL_MS);
})();
