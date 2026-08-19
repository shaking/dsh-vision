// dsh-vision 核心逻辑单元测试（node --test，零依赖）
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	resolveApiKey,
	extractDescription,
	buildVLMRequestBody,
	mimeTypeForPath,
	resolveProvider,
	DEFAULT_DESCRIBE_PROMPT,
	VLM_MAX_TOKENS,
} from "../lib/core.js";

// ── resolveApiKey ────────────────────────────────────────────────────────────

test("resolveApiKey 优先读环境变量", () => {
	process.env.DSH_TEST_KEY = "env-key";
	assert.equal(resolveApiKey("DSH_TEST_KEY"), "env-key");
	delete process.env.DSH_TEST_KEY;
});

test("resolveApiKey 从 credentials 文件读取并去除引号", () => {
	const dir = mkdtempSync(join(tmpdir(), "dsh-vision-"));
	const dshDir = join(dir, ".dsh");
	mkdirSync(dshDir);
	const credPath = join(dshDir, ".credentials.yaml");
	writeFileSync(credPath, "DEEPSEEK_API_KEY: sk-real\nDSH_TEST_KEY: \"sk-quoted\"\n");
	// resolveApiKey 用 homedir() 定位 ~/.dsh/.credentials.yaml；注入 HOME 指向临时目录
	const oldHome = process.env.HOME;
	process.env.HOME = dir;
	try {
		assert.equal(resolveApiKey("DEEPSEEK_API_KEY"), "sk-real");
		assert.equal(resolveApiKey("DSH_TEST_KEY"), "sk-quoted");
		assert.equal(resolveApiKey("NOT_EXIST_KEY"), null);
	} finally {
		process.env.HOME = oldHome;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("resolveApiKey 文件不存在返回 null", () => {
	const oldHome = process.env.HOME;
	process.env.HOME = join(tmpdir(), "dsh-vision-nonexistent-" + Date.now());
	try {
		assert.equal(resolveApiKey("DSH_TEST_KEY"), null);
	} finally {
		process.env.HOME = oldHome;
	}
});

// ── extractDescription ───────────────────────────────────────────────────────

test("extractDescription 提取字符串 content", () => {
	const data = { choices: [{ message: { content: "这是描述" } }] };
	assert.equal(extractDescription(data), "这是描述");
});

test("extractDescription 提取数组 content（块式）", () => {
	const data = {
		choices: [{ message: { content: [{ type: "text", text: "第一段" }, { type: "text", text: "第二段" }] } }],
	};
	assert.equal(extractDescription(data), "第一段第二段");
});

test("extractDescription 空响应返回空字符串", () => {
	assert.equal(extractDescription({}), "");
	assert.equal(extractDescription(null), "");
	assert.equal(extractDescription({ choices: [] }), "");
});

// ── buildVLMRequestBody ──────────────────────────────────────────────────────

test("buildVLMRequestBody 结构正确", () => {
	const body = buildVLMRequestBody({
		model: "qwen3-vl-flash",
		prompt: "描述这张图",
		imageBase64: "AAAA",
		mimeType: "image/jpeg",
	});
	assert.equal(body.model, "qwen3-vl-flash");
	assert.equal(body.max_tokens, VLM_MAX_TOKENS);
	assert.equal(body.messages[0].role, "user");
	assert.equal(body.messages[0].content[0].text, "描述这张图");
	assert.equal(body.messages[0].content[1].image_url.url, "data:image/jpeg;base64,AAAA");
});

test("默认提问非空", () => {
	assert.ok(DEFAULT_DESCRIBE_PROMPT.length > 10);
});

// ── mimeTypeForPath ──────────────────────────────────────────────────────────

test("mimeTypeForPath 区分 png 与其他", () => {
	assert.equal(mimeTypeForPath("a.png"), "image/png");
	assert.equal(mimeTypeForPath("a.PNG"), "image/png");
	assert.equal(mimeTypeForPath("a.jpg"), "image/jpeg");
	assert.equal(mimeTypeForPath("a.webp"), "image/jpeg");
});

// ── resolveProvider（多供应商） ───────────────────────────────────────────────

const multiConfig = {
	defaultProvider: "bailian",
	providers: {
		bailian: { baseUrl: "https://a", model: "m1", apiKeyEnv: "K1" },
		zhipu: { baseUrl: "https://b", model: "m2", apiKeyEnv: "K2" },
	},
};

test("resolveProvider 缺省用 defaultProvider", () => {
	const p = resolveProvider(multiConfig);
	assert.equal(p.id, "bailian");
	assert.equal(p.baseUrl, "https://a");
});

test("resolveProvider 指定供应商", () => {
	const p = resolveProvider(multiConfig, "zhipu");
	assert.equal(p.id, "zhipu");
	assert.equal(p.model, "m2");
	assert.equal(p.apiKeyEnv, "K2");
});

test("resolveProvider 未知供应商抛错并列出可用项", () => {
	assert.throws(() => resolveProvider(multiConfig, "nope"), /未知的 VLM 供应商 "nope"/);
	assert.throws(() => resolveProvider(multiConfig, "nope"), /bailian, zhipu/);
});

test("resolveProvider 无任何供应商时抛错", () => {
	assert.throws(() => resolveProvider({ providers: {} }), /未配置任何供应商/);
});
