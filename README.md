# dsh-vision

> 给 DeepSeek Harness（dsh）补上视觉能力的插件：**本地 OCR（macOS / Windows）+ 云端 VLM（多供应商）图片理解**。

DeepSeek 的模型 API 目前不支持图像输入，`read_image` 因此无法使用。本插件提供两个工具绕过这个限制：

| 工具 | 能力 | 成本 |
|---|---|---|
| `read_image_text` | 识别图片中的**文字**（macOS Vision / Windows 内置 OCR，免费离线，中英文） | 免费 |
| `describe_image` | 理解图片的**画面内容**（云端 VLM，多供应商，OpenAI 兼容端点） | 按量付费 |

## 特性

- 🔒 **本地 OCR**：macOS 基于 Vision.framework，Windows 基于内置 OCR 引擎，图片不出本机，隐私安全
- ☁️ **云端 VLM**：默认阿里云百炼 `qwen3-vl-flash`（快且便宜），OpenAI 兼容接口，可换成任意提供商
- 🖼️ **自动压缩**：VLM 调用前用 `sips` 把大图压到 2048px / JPEG 85%，省钱省流量
- 🔑 **灵活取 Key**：环境变量或 `~/.dsh/.credentials.yaml`
- 🧪 **零依赖单测**：核心逻辑用 Node 内置 `node:test` 覆盖（13 用例）
- 🌏 **多供应商 VLM**：内置百炼 / 硅基流动 / 智谱 / 火山方舟，OpenAI 兼容可加任意家
- 🪟 **Windows 支持**：附 PowerShell OCR 后端（Windows.Media.Ocr），VLM 通道跨平台

## 安装

### 方式 A：从 npm 安装（推荐）

```sh
dsh plugin --profile web add @floatingsk/dsh-vision
```

### 方式 B：从源码拷贝

```sh
# 把本仓库拷贝到你的 dsh profile 插件目录
cp -R dsh-vision ~/.dsh/profiles/node_modules/dsh-vision
```

### 方式 C：从 GitHub Release 下载预编译二进制（免编译，推荐）

维护者在打 `v*` tag 时，GitHub Actions 会自动在两种 macOS 架构上编译并附到 Release：

1. 打开本仓库的 **Releases** 页面，选择最新版本
2. 按你的 Mac 架构下载：
   - Apple Silicon（M 系列）：`vision-ocr-arm64`
   - Intel Mac：`vision-ocr-x86_64`
3. 放到插件目录并加执行权限：

```sh
cp vision-ocr-arm64 ~/.dsh/profiles/node_modules/dsh-vision/bin/vision-ocr
chmod +x ~/.dsh/profiles/node_modules/dsh-vision/bin/vision-ocr
```

### 编译 OCR 二进制（macOS 需要 Xcode Command Line Tools）

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

Agent 会自动选择合适的工具（读文字走 OCR，看画面走 VLM）。想指定 VLM 供应商时，可让 agent 传 `provider` 参数（如 `bailian` / `siliconflow` / `zhipu` / `volcengine`）。

## 配置

通过 `cordis.patch.yml` 中 `dsh-vision` 节点的 `config` 覆盖默认值。

### 多供应商 VLM

内置四家国内供应商，`describe_image` 可传 `provider` 参数选择（留空用 `defaultProvider`）：

```yaml
- insert:
    - id: dsh-vision
      name: 'dsh-vision'
      config:
        defaultProvider: 'bailian'          # 默认供应商
        providers:
          bailian:                          # 阿里云百炼
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
            model: 'qwen3-vl-flash'         # 或 qwen3-vl-plus / qwen-vl-ocr
            apiKeyEnv: 'DASHSCOPE_API_KEY'
          siliconflow:                      # 硅基流动
            baseUrl: 'https://api.siliconflow.cn/v1'
            model: 'Qwen/Qwen2.5-VL-7B-Instruct'
            apiKeyEnv: 'SILICONFLOW_API_KEY'
          zhipu:                            # 智谱
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4'
            model: 'glm-4v-flash'
            apiKeyEnv: 'ZHIPU_API_KEY'
          volcengine:                       # 火山方舟（豆包）
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3'
            model: 'doubao-seed-1.6-vision'
            apiKeyEnv: 'ARK_API_KEY'
        # 自定义 OCR 二进制路径（默认插件 bin/vision-ocr）
        ocrBin: ''
        # 上传前压缩最长边（像素）
        vlmMaxImageDim: 2048
```

换供应商：改 `defaultProvider`，或在调用时指定 `provider` 参数；加新供应商：在 `providers` 下加任意键名（任何 OpenAI 兼容端点都行）。

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

## 平台支持

| 能力 | macOS (Apple Silicon) | macOS (Intel) | Windows |
|---|---|---|---|
| 本地 OCR | ✅ 已编译 | ✅ 自编译或用 Release 二进制 | ✅ PowerShell 后端（Windows.Media.Ocr，未实测） |
| 云端 VLM | ✅ | ✅ | ✅（纯 Node） |

- **macOS OCR**：依赖 Vision.framework。仓库不含编译产物（见 `.gitignore`）：
  - Apple Silicon：`npm run build:ocr` 自编译，或下载 GitHub Release 的 `vision-ocr-arm64`
  - Intel：`npm run build:ocr` 自编译，或下载 Release 的 `vision-ocr-x86_64`
  - 打 `v*` tag 推 GitHub 时，Actions 自动在两种架构编译并附到 Release
- **Windows OCR**：`bin/vision-ocr.ps1`（Windows 10/11 内置 OCR 引擎，需装中文 OCR 语言包），插件 `ocrBin` 指向它即可：
  ```powershell
  powershell -ExecutionPolicy Bypass -File bin/vision-ocr.ps1 <image> -Json
  ```
  > 注：该脚本在 macOS 上开发，未在 Windows 实测，欢迎提交 issue/PR。
- **VLM 通道**：Node >= 18（内置 `fetch`），全平台可用。

## 许可证

[MIT](./LICENSE)
