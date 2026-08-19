# dsh-vision

> 给 DeepSeek Harness（dsh）补上视觉能力的插件：**本地 OCR + 云端 VLM 图片理解**。

DeepSeek 的模型 API 目前不支持图像输入，`read_image` 因此无法使用。本插件提供两个工具绕过这个限制：

| 工具 | 能力 | 成本 |
|---|---|---|
| `read_image_text` | 识别图片中的**文字**（macOS 本地 Vision 引擎，免费离线，中英文） | 免费 |
| `describe_image` | 理解图片的**画面内容**（云端 VLM，OpenAI 兼容端点） | 按量付费 |

## 特性

- 🔒 **本地 OCR**：基于 macOS Vision.framework，图片不出本机，隐私安全
- ☁️ **云端 VLM**：默认阿里云百炼 `qwen3-vl-flash`（快且便宜），OpenAI 兼容接口，可换成任意提供商
- 🖼️ **自动压缩**：VLM 调用前用 `sips` 把大图压到 2048px / JPEG 85%，省钱省流量
- 🔑 **灵活取 Key**：环境变量或 `~/.dsh/.credentials.yaml`
- 🧪 **零依赖单测**：核心逻辑用 Node 内置 `node:test` 覆盖

## 安装

### 方式 A：从 npm 安装（发布后推荐）

```sh
dsh plugin --profile web add @floatingsk/dsh-vision
```

### 方式 B：从源码拷贝

```sh
# 把本仓库拷贝到你的 dsh profile 插件目录
cp -R dsh-vision ~/.dsh/profiles/node_modules/dsh-vision
```

### 编译 OCR 二进制（macOS 需要 Xcode Command Line Tools）（macOS 需要 Xcode Command Line Tools）

```sh
cd ~/.dsh/profiles/node_modules/dsh-vision
# 显式指定 clang 模块缓存目录（沙箱/受限环境下必需）
swiftc -Xcc -fmodules-cache-path="$PWD/.cache" -O bin/vision-ocr.swift -o bin/vision-ocr
```

### 在 profile patch 中启用插件

编辑 `~/.dsh/profiles/web/cordis.patch.yml`（你的 profile 对应文件），追加：

```yaml
- insert:
    - id: dsh-vision
      name: 'dsh-vision'
```

### 配置 VLM API Key（`describe_image` 需要）

任选其一：

```sh
# 方式 A：环境变量
export DASHSCOPE_API_KEY=sk-xxx

# 方式 B：写入 dsh 凭据文件
echo 'DASHSCOPE_API_KEY: sk-xxx' >> ~/.dsh/.credentials.yaml
```

Key 从你的 VLM 提供商控制台获取（默认阿里云百炼：[bailian.console.aliyun.com](https://bailian.console.aliyun.com)）。

### 重启 dsh

重启后工具即可用。**注意：需要新开一个对话**，工具列表在会话开始时注入。

## 使用

在对话中把图片保存到磁盘，告诉 agent 路径即可：

```
看下 /path/to/image.png 里有什么
读取 /path/to/截图.png 中的文字
```

Agent 会自动选择合适的工具（读文字走 OCR，看画面走 VLM）。

## 配置

通过 `cordis.patch.yml` 中 `dsh-vision` 节点的 `config` 覆盖默认值：

```yaml
- insert:
    - id: dsh-vision
      name: 'dsh-vision'
      config:
        # 换模型：任意 OpenAI 兼容的视觉模型
        vlmModel: 'qwen3-vl-flash'
        # 换提供商：OpenAI 兼容 base URL
        vlmBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        # 换 Key 环境变量名
        vlmApiKeyEnv: 'DASHSCOPE_API_KEY'
        # 自定义 OCR 二进制路径（默认插件 bin/vision-ocr）
        ocrBin: ''
        # 上传前压缩最长边（像素）
        vlmMaxImageDim: 2048
```

### 推荐的视觉模型（阿里云百炼）

| 模型 | 特点 |
|---|---|
| `qwen3-vl-flash`（默认） | 快、便宜，日常够用 |
| `qwen3-vl-plus` | 质量更高，稍慢稍贵 |
| `qwen-vl-ocr` | 纯文字识别专用，比本地 OCR 更强（需联网） |

## 开发

```sh
# 运行单元测试
node --test test/

# 重新编译 OCR 二进制
swiftc -Xcc -fmodules-cache-path="$PWD/.cache" -O bin/vision-ocr.swift -o bin/vision-ocr
```

## 平台限制

- **本地 OCR 仅 macOS**：依赖 Vision.framework。仓库不含编译产物（见 `.gitignore`），需自行编译。
- **VLM 通道跨平台**：Node >= 18（需内置 `fetch`），任何有 OpenAI 兼容 VLM 的环境可用。

## 许可证

[MIT](./LICENSE)
