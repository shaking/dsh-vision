// dsh-vision 插件：给模型提供图片理解能力
// - read_image_text : 本地 OCR（macOS Vision），免费离线，识别图中文字
// - describe_image  : 云端 VLM（OpenAI 兼容端点，默认阿里云百炼 qwen3-vl-flash），理解画面内容
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
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
} from "./core.js";

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

export const name = "dsh-vision";
export const inject = ["tools"];

export const Config = z.object({
	/** 本地 OCR 可执行文件路径（默认指向插件 bin/vision-ocr） */
	ocrBin: z.string().default(""),
	/** 云端 VLM：OpenAI 兼容 base URL */
	vlmBaseUrl: z.string().default("https://dashscope.aliyuncs.com/compatible-mode/v1"),
	/** 云端 VLM 模型名 */
	vlmModel: z.string().default("qwen3-vl-flash"),
	/** 读取 API Key 的环境变量名 */
	vlmApiKeyEnv: z.string().default("DASHSCOPE_API_KEY"),
	/** 上传前压缩图片的最长边（像素） */
	vlmMaxImageDim: z.number().default(VLM_MAX_IMAGE_DIM),
});

/** 用 sips 把图片压到最长边 <= maxDim 的 JPEG；失败时退回原图（不落盘） */
async function prepareImage(filePath, maxDim) {
	const tmpOut = join(__dirname, "..", ".cache", `vlm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`);
	try {
		await execFileAsync("sips", [
			"-Z", String(maxDim),
			"-s", "format", "jpeg",
			"-s", "formatOptions", String(JPEG_QUALITY),
			filePath, "--out", tmpOut,
		]);
		return { path: tmpOut, cleanup: () => void unlink(tmpOut).catch(() => {}) };
	} catch {
		return { path: filePath, cleanup: () => {} };
	}
}

/** 调用 OpenAI 兼容 VLM 端点，返回描述文本 */
async function callVLM({ baseUrl, model, apiKey, imagePath, question }) {
	const { path, cleanup } = await prepareImage(imagePath, VLM_MAX_IMAGE_DIM);
	try {
		const imageBytes = await readFile(path);
		const imageBase64 = imageBytes.toString("base64");
		const prompt = question && question.trim().length > 0 ? question : DEFAULT_DESCRIBE_PROMPT;
		const body = buildVLMRequestBody({
			model,
			prompt,
			imageBase64,
			mimeType: mimeTypeForPath(path),
		});

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);
		let res;
		try {
			res = await fetch(`${baseUrl}/chat/completions`, {
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
		cleanup();
	}
}

export function apply(ctx, config) {
	const resolved = config;
	const ocrBin = resolved.ocrBin && resolved.ocrBin.length > 0
		? resolved.ocrBin
		: join(__dirname, "..", "bin", "vision-ocr");

	// ── 工具1：本地 OCR ────────────────────────────────────────────────
	ctx.tools.register(defineTool({
		name: "read_image_text",
		description: "识别图片中的文字（OCR）。使用 macOS 本地 Vision 引擎，免费、离线、隐私安全，支持中英文。返回按阅读顺序排列的文本行与图片尺寸。",
		parameters: {
			file_path: {
				type: "string",
				required: true,
				description: "图片文件路径（PNG/JPEG 等）",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: { type: "string", required: true },
					width: { type: "integer", required: true },
					height: { type: "integer", required: true },
					text: { type: "string", required: true },
					lines: { type: "array", items: { type: "string" } },
				},
			},
			render: (_args, value) => [{
				type: "text",
				text: `【图片文字识别】 ${value.path} (${value.width}x${value.height})\n${value.text}`,
			}],
		},
		async execute(args) {
			const { stdout } = await execFileAsync(ocrBin, [args.file_path, "--json"], { timeout: OCR_TIMEOUT_MS });
			const parsed = JSON.parse(stdout);
			const lines = parsed.lines.map((l) => l.text);
			return {
				path: args.file_path,
				width: parsed.width,
				height: parsed.height,
				text: lines.length > 0 ? lines.join("\n") : "(未检测到文字)",
				lines,
			};
		},
	}));

	// ── 工具2：云端 VLM 画面理解 ──────────────────────────────────────
	ctx.tools.register(defineTool({
		name: "describe_image",
		description: "理解图片的画面内容（视觉语言模型 VLM）。调用可配置的云端视觉模型（默认阿里云百炼 qwen3-vl-flash），返回对图片内容的自然语言描述或对指定问题的回答。需要先配置 API Key（环境变量或 ~/.dsh/.credentials.yaml）。",
		parameters: {
			file_path: {
				type: "string",
				required: true,
				description: "图片文件路径（PNG/JPEG）",
			},
			question: {
				type: "string",
				required: false,
				description: "可选的具体问题；留空则描述整体画面内容",
			},
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: { type: "string", required: true },
					model: { type: "string", required: true },
					description: { type: "string", required: true },
				},
			},
			render: (_args, value) => [{
				type: "text",
				text: `【图片理解·${value.model}】 ${value.path}\n${value.description}`,
			}],
		},
		async execute(args) {
			const apiKey = resolveApiKey(resolved.vlmApiKeyEnv);
			if (!apiKey) {
				throw new Error(`describe_image 需要视觉模型 API Key：请设置环境变量 ${resolved.vlmApiKeyEnv}，或添加到 ~/.dsh/.credentials.yaml（例如：${resolved.vlmApiKeyEnv}: sk-xxx）。阿里云百炼控制台可申请：https://bailian.console.aliyun.com`);
			}
			const description = await callVLM({
				baseUrl: resolved.vlmBaseUrl,
				model: resolved.vlmModel,
				apiKey,
				imagePath: args.file_path,
				question: args.question,
			});
			return {
				path: args.file_path,
				model: resolved.vlmModel,
				description,
			};
		},
	}));
}
