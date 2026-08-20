// clip-state-server.js — 剪贴板图片状态服务
// 供 dsh web 前端轮询：返回 pasted-images 目录的最新图片信息。
// 前端脚本（clip-hint.js）据此在输入框显示"[图片已就绪]"提示。
//
// 用法: node clip-state-server.js [PORT]
import { createServer } from "node:http";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.argv[2] || 51799);
const IMG_DIR = join(process.env.HOME, "Documents", "DeepSeek", "pasted-images");

function latestImages(limit) {
	try {
		const files = readdirSync(IMG_DIR)
			.filter((f) => f.startsWith("pasted-") && /\.(png|jpg|jpeg)$/i.test(f))
			.map((f) => ({ name: f, mtime: statSync(join(IMG_DIR, f)).mtimeMs }))
			.sort((a, b) => b.mtime - a.mtime)
			.slice(0, limit);
		if (files.length === 0) return null;
		return {
			latest: files[0].name,
			ts: Math.round(files[0].mtime),
			count: files.length,
			recent: files.map((f) => f.name),
		};
	} catch {
		return null;
	}
}

createServer((req, res) => {
	// CORS：允许 dsh web（127.0.0.1:3080）跨域读取
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	if (req.url === "/state" || req.url === "/") {
		const data = latestImages(5);
		res.end(JSON.stringify(data ?? { latest: null, ts: 0, count: 0, recent: [] }));
	} else {
		res.statusCode = 404;
		res.end('{"error":"not found"}');
	}
}).listen(PORT, "127.0.0.1", () => {
	console.log(`[clip-state-server] http://127.0.0.1:${PORT}/state`);
});
