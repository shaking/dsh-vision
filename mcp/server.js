// dsh-vision MCP server — 给 Claude Code 等 MCP 客户端提供图片理解能力
//
// 提供两个工具（与 dsh-vision 插件一致）：
//   - read_image_text : 本地 OCR（macOS Vision / Windows），免费离线
//   - describe_image  : 云端 VLM（多供应商，OpenAI 兼容），默认阿里云百炼 qwen3-vl-flash
//
// 用法:
//   node mcp/server.js
// 在 Claude Code 中接入:
//   claude mcp add dsh-vision -- node /path/to/dsh-vision/mcp/server.js
//
// 依赖: 复用 ../lib/core.js（纯逻辑）与 ../bin/vision-ocr（OCR 二进制）
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	VLM_TIMEOUT_MS,
	VLM_MAX_IMAGE_DIM,
	JPEG_QUALITY,
	OCR_TIMEOUT_MS,
	DEFAULT_DESCRIBE_PROMPT,
	resolveApiKey,
	extractDescription,
	buildVLMRequestBody,
	mimeTypeForPath,
} from "../lib/core.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ocrBin = join(__dirname, "..", "bin", "vision-ocr");

// ── 内置供应商（与插件 Config 默认值一致） ──────────────────────────────────
const PROVIDERS = {
	deepseek: { baseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash-vision-exp", apiKeyEnv: "DEEPSEEK_API_KEY" },
	bailian: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen3-vl-flash", apiKeyEnv: "DASHSCOPE_API_KEY" },
	siliconflow: { baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-VL-7B-Instruct", apiKeyEnv: "SILICONFLOW_API_KEY" },
	zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4v-flash", apiKeyEnv: "ZHIPU_API_KEY" },
	volcengine: { baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1.6-vision", apiKeyEnv: "ARK_API_KEY" },
};
const DEFAULT_PROVIDER = "deepseek";

// ── 工具实现 ─────────────────────────────────────────────────────────────────

async function runOCR(filePath) {
	const { stdout } = await execFileAsync(ocrBin, [filePath, "--json"], { timeout: OCR_TIMEOUT_MS });
	const parsed = JSON.parse(stdout);
	const lines = parsed.lines.map((l) => l.text);
	return {
		path: filePath,
		width: parsed.width,
		height: parsed.height,
		text: lines.length > 0 ? lines.join("\n") : "(未检测到文字)",
	};
}

async function runVLM(filePath, question, providerId) {
	const provider = PROVIDERS[providerId || DEFAULT_PROVIDER];
	if (!provider) throw new Error(`未知供应商 "${providerId}"，可用: ${Object.keys(PROVIDERS).join(", ")}`);
	const apiKey = resolveApiKey(provider.apiKeyEnv);
	if (!apiKey) {
		throw new Error(`需要 ${provider.apiKeyEnv}（可在环境变量或 ~/.dsh/.credentials.yaml 配置）`);
	}

	// 压缩图片（sips，macOS）；失败退回原图
	let imagePath = filePath;
	try {
		const tmpOut = join(tmpdir(), `dsh-vision-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`);
		await execFileAsync("sips", ["-Z", String(VLM_MAX_IMAGE_DIM), "-s", "format", "jpeg", "-s", "formatOptions", String(JPEG_QUALITY), filePath, "--out", tmpOut]);
		imagePath = tmpOut;
	} catch { /* 保留原图 */ }

	try {
		const imageBytes = await readFile(imagePath);
		const prompt = question && question.trim().length > 0 ? question : DEFAULT_DESCRIBE_PROMPT;
		const body = buildVLMRequestBody({
			model: provider.model,
			prompt,
			imageBase64: imageBytes.toString("base64"),
			mimeType: mimeTypeForPath(imagePath),
		});
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);
		let res;
		try {
			res = await fetch(`${provider.baseUrl}/chat/completions`, {
				method: "POST",
				headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
				body: JSON.stringify(body),
				signal: controller.signal,
			});
		} finally {
			clearTimeout(timer);
		}
		if (!res.ok) {
			const detail = (await res.text()).slice(0, 500);
			throw new Error(`VLM HTTP ${res.status}: ${detail}`);
		}
		const description = extractDescription(await res.json());
		return description || "(空回复)";
	} finally {
		if (imagePath !== filePath) {
			const { unlink } = await import("node:fs/promises");
			await unlink(imagePath).catch(() => {});
		}
	}
}

// ── MCP 工具定义 ─────────────────────────────────────────────────────────────

const TOOLS = [
	{
		name: "read_image_text",
		description: "识别图片中的文字（OCR）。macOS 使用本地 Vision 引擎，Windows 使用内置 OCR，免费离线，支持中英文。返回按阅读顺序排列的文本行与图片尺寸。",
		inputSchema: {
			type: "object",
			properties: {
				file_path: { type: "string", description: "图片文件路径（PNG/JPEG 等）" },
			},
			required: ["file_path"],
		},
		handler: async (args) => {
			if (!args?.file_path) throw new Error("file_path 必填");
			const r = await runOCR(String(args.file_path));
			return `【图片文字识别】 ${r.path} (${r.width}x${r.height})\n${r.text}`;
		},
	},
	{
		name: "describe_image",
		description: "理解图片的画面内容（视觉语言模型 VLM）。调用可配置的云端视觉模型（默认阿里云百炼 qwen3-vl-flash），返回对图片内容的自然语言描述或对指定问题的回答。需要配置 API Key（DASHSCOPE_API_KEY 等环境变量，或 ~/.dsh/.credentials.yaml）。",
		inputSchema: {
			type: "object",
			properties: {
				file_path: { type: "string", description: "图片文件路径（PNG/JPEG）" },
				question: { type: "string", description: "可选的具体问题；留空则描述整体画面内容" },
				provider: { type: "string", description: "可选：VLM 供应商（bailian/siliconflow/zhipu/volcengine），留空用默认" },
			},
			required: ["file_path"],
		},
		handler: async (args) => {
			if (!args?.file_path) throw new Error("file_path 必填");
			const provider = args.provider || DEFAULT_PROVIDER;
			const description = await runVLM(String(args.file_path), args.question ? String(args.question) : undefined, String(provider));
			return `【图片理解·${provider}】 ${args.file_path}\n${description}`;
		},
	},
];

// ── stdio JSON-RPC 循环（零依赖 MCP server） ─────────────────────────────────

function sendMessage(msg) {
	process.stdout.write(JSON.stringify(msg) + "\n");
}

async function handleRequest(msg) {
	const { id, method, params } = msg;
	switch (method) {
		case "initialize":
			return {
				protocolVersion: params?.protocolVersion ?? "2024-11-05",
				capabilities: { tools: {} },
				serverInfo: { name: "dsh-vision", version: "0.1.0" },
			};
		case "tools/list":
			return {
				tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
			};
		case "tools/call": {
			const tool = TOOLS.find((t) => t.name === params?.name);
			if (!tool) throw new Error(`未知工具: ${params?.name}`);
			const text = await tool.handler(params?.arguments ?? {});
			return { content: [{ type: "text", text }] };
		}
		default:
			throw new Error(`未知方法: ${method}`);
	}
}

const readline = await import("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", async (line) => {
	if (!line.trim()) return;
	let msg;
	try {
		msg = JSON.parse(line);
	} catch {
		return; // 忽略非法 JSON
	}
	if (msg.method === "notifications/initialized") return; // 通知无需响应
	if (msg.id === undefined) return; // 忽略无 id 的消息

	try {
		const result = await handleRequest(msg);
		sendMessage({ jsonrpc: "2.0", id: msg.id, result });
	} catch (err) {
		sendMessage({ jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: String(err?.message ?? err) } });
	}
});

// 保持进程常驻：MCP server 生命周期由客户端（Claude Code）管理，
// 不能在 stdin 结束时立即退出（异步工具调用可能尚未完成）。
// 预留 SIGTERM/SIGINT 优雅退出，便于测试脚本终止。
process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
