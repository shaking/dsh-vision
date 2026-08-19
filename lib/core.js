// dsh-vision 核心纯逻辑（无 Cordis 依赖，可独立单元测试）
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

/** VLM 请求超时（毫秒） */
export const VLM_TIMEOUT_MS = 120_000;
/** VLM 输出 token 上限 */
export const VLM_MAX_TOKENS = 1024;
/** 上传前图片压缩的最长边（像素） */
export const VLM_MAX_IMAGE_DIM = 2048;
/** 压缩 JPEG 质量（0-100） */
export const JPEG_QUALITY = 85;
/** 本地 OCR 单次执行超时（毫秒） */
export const OCR_TIMEOUT_MS = 60_000;

/** 默认的画面理解提问（当用户未提供具体问题时使用） */
export const DEFAULT_DESCRIBE_PROMPT =
	"请详细描述这张图片的内容：画面主体、场景、人物、构图、颜色、光线、以及任何值得注意的细节。";

/**
 * 从环境变量或 ~/.dsh/.credentials.yaml 解析 API Key。
 * 优先读环境变量；其次读 DSH 凭据文件中的同名条目。
 * @param {string} envName - 环境变量名（如 DASHSCOPE_API_KEY）
 * @returns {string|null} 解析到的 Key，未配置返回 null
 */
export function resolveApiKey(envName) {
	if (process.env[envName]) return process.env[envName];
	try {
		const credPath = join(homedir(), ".dsh", ".credentials.yaml");
		if (!existsSync(credPath)) return null;
		const content = readFileSync(credPath, "utf8");
		const re = new RegExp(`^${envName}\\s*[:=]\\s*(.+)$`, "m");
		const m = content.match(re);
		if (!m) return null;
		return m[1].trim().replace(/^["']|["']$/g, "");
	} catch {
		return null;
	}
}

/**
 * 从 OpenAI 兼容 chat/completions 响应中提取助手文本。
 * @param {unknown} data - API 返回的 JSON
 * @returns {string} 提取到的文本；缺失时返回空字符串
 */
export function extractDescription(data) {
	const content = data?.choices?.[0]?.message?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		// 部分模型返回 content 数组（Anthropic 风格块）
		return content
			.map((b) => (b?.type === "text" ? b.text : ""))
			.join("")
			.trim();
	}
	return "";
}

/**
 * 构建 OpenAI 兼容的 VLM 请求体。
 * @param {object} opts - { model, prompt, imageBase64, mimeType }
 * @returns {object} chat/completions 请求体
 */
export function buildVLMRequestBody({ model, prompt, imageBase64, mimeType }) {
	return {
		model,
		messages: [{
			role: "user",
			content: [
				{ type: "text", text: prompt },
				{ type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
			],
		}],
		max_tokens: VLM_MAX_TOKENS,
	};
}

/** 根据文件扩展名推断图片 MIME 类型（未知按 jpeg 兜底） */
export function mimeTypeForPath(filePath) {
	return filePath.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
}

/**
 * 从多供应商配置中解析指定供应商。
 * @param {object} config - 插件 Config（含 providers 与 defaultProvider）
 * @param {string} [providerId] - 指定供应商 id；缺省用 defaultProvider
 * @returns {{id: string, baseUrl: string, model: string, apiKeyEnv: string}} 供应商配置
 * @throws {Error} 供应商不存在时
 */
export function resolveProvider(config, providerId) {
	const id = providerId || config.defaultProvider || "bailian";
	const provider = config.providers?.[id];
	if (!provider) {
		const available = Object.keys(config.providers ?? {}).join(", ");
		throw new Error(
			`未知的 VLM 供应商 "${id}"。可用：${available || "（未配置任何供应商）"}。` +
			"可在 cordis.patch.yml 中 dsh-vision 节点的 config.providers 下添加。"
		);
	}
	return { id, baseUrl: provider.baseUrl, model: provider.model, apiKeyEnv: provider.apiKeyEnv };
}
