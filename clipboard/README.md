# 剪贴板贴图工具集（clipboard）

让 dsh web 支持"**复制图片 → 直接贴给 agent**"的工作流：不需要手动保存文件、不需要给路径。

```
你在任何地方复制图片（截图 ⌘C / 右键复制图片 / Finder 多选）
        ↓ clipboard-watch.sh（常驻监听，LaunchAgent 开机自启）
图片自动保存到 pasted-images/（去重 + 只留最近 30 张）
        ↓ clip-state-server.js（本地状态服务 127.0.0.1:51799）
dsh web 前端 clip-hint.js（轮询状态）→ 输入框右下角显示 "[图片已就绪]"
        ↓ 你对 agent 说 "看下我刚贴的图"
agent 读取图片 → OCR 读文字 / VLM 看画面
```

## 文件

| 文件 | 作用 |
|---|---|
| `clipboard-watch.sh` | 剪贴板监听：图片数据（⌘C 图片）与文件引用（Finder 多选）双通道，自动保存 + 去重 + 清理 |
| `clip-state-server.js` | 本地 HTTP 状态服务（零依赖 Node），供前端轮询最新图片 |
| `clip-hint.js` | dsh web 前端注入脚本：检测到新图时右下角显示占位提示 |
| `install.sh` | 一键安装：部署脚本 + LaunchAgent 开机自启 + 启动状态服务 + 注入前端 |

## 安装

```sh
bash install.sh [保存目录，默认 ~/Documents/DeepSeek/pasted-images]
```

安装后**刷新 dsh web 页面**，复制一张图，右下角会出现绿色提示条 `[图片已就绪: xxx.png]`。

## 多图支持

- **连续复制**：每张都会保存，提示条显示"共 N 张，最近5张: ..."
- **Finder 多选**：选中多张图片 ⌘C，自动全部拷入
- 对 agent 说"**看下刚贴的图**"（最新一张）或"**看下刚贴的 N 张图**"（最近 N 张）

## 配置

| 项 | 位置 |
|---|---|
| 保存目录 | `install.sh` 第 1 个参数；状态服务读 `$HOME/Documents/DeepSeek/pasted-images` |
| 保留张数 | `clipboard-watch.sh` 第 2 个参数（默认 30） |
| 状态服务端口 | `install.sh` 的 `PORT` 变量（默认 51799），`clip-hint.js` 里 `STATE_URL` 需同步 |
| dsh web 注入 | `install.sh` 自动处理；dsh 升级后若失效，重跑 install.sh |

## 平台

- macOS（依赖 osascript 读剪贴板）
- 零第三方依赖：Node >= 18（状态服务）、系统自带 bash/osascript
