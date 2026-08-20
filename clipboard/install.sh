#!/bin/bash
# install.sh — 安装 dsh-vision 剪贴板贴图工具集
#
# 功能：
#   1. 部署脚本到 $INSTALL_DIR
#   2. 注册 LaunchAgent（开机自启剪贴板监听）
#   3. 启动状态服务（clip-state-server，端口 $PORT）
#   4. 注入 dsh web 前端提示脚本（clip-hint.js → dist/index.html）
#
# 用法: bash install.sh [保存目录]
set -e

SAVE_DIR="${1:-$HOME/Documents/DeepSeek/pasted-images}"
INSTALL_DIR="$HOME/.dsh-vision/clipboard"
PORT=51799
LABEL="com.floatingsk.clipboard-watch"

mkdir -p "$INSTALL_DIR" "$SAVE_DIR"

echo "==> 1/4 部署脚本到 $INSTALL_DIR"
cp "$(dirname "$0")/clipboard-watch.sh" "$INSTALL_DIR/"
cp "$(dirname "$0")/clip-state-server.js" "$INSTALL_DIR/"
cp "$(dirname "$0")/clip-hint.js" "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/clipboard-watch.sh"

echo "==> 2/4 注册 LaunchAgent（开机自启）"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$INSTALL_DIR/clipboard-watch.sh</string>
		<string>$SAVE_DIR</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<true/>
	<key>StandardOutPath</key>
	<string>$INSTALL_DIR/clipboard-watch.log</string>
	<key>StandardErrorPath</key>
	<string>$INSTALL_DIR/clipboard-watch.log</string>
	<key>ProcessType</key>
	<string>Background</string>
</dict>
</plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null || echo "  (LaunchAgent 加载失败，可手动执行: launchctl bootstrap gui/\$(id -u) $PLIST)"

echo "==> 3/4 启动状态服务 (http://127.0.0.1:$PORT/state)"
if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "  (端口 $PORT 已被占用，跳过)"
else
  nohup node "$INSTALL_DIR/clip-state-server.js" "$PORT" > "$INSTALL_DIR/clip-state-server.log" 2>&1 &
  echo "  已启动 (PID $!)"
fi

echo "==> 4/4 注入 dsh web 前端提示"
DIST=""
if command -v node >/dev/null 2>&1; then
  DIST=$(node -e "try{console.log(require.resolve('@deepseek-ai/dsh-web-frontend/dist/index.html'))}catch(e){process.exit(1)}" 2>/dev/null || true)
fi
if [ -z "$DIST" ] || [ ! -f "$DIST" ]; then
  echo "  (未找到 dsh web dist，跳过注入。找到后手动执行: cp $INSTALL_DIR/clip-hint.js <dist> && 在 index.html 的 </body> 前加 <script src=\"/clip-hint.js\"></script>)"
else
  cp "$INSTALL_DIR/clip-hint.js" "$(dirname "$DIST")/clip-hint.js"
  if ! grep -q "clip-hint.js" "$DIST"; then
    cp "$DIST" "$DIST.bak"
    sed -i '' 's|</body>|    <script src="/clip-hint.js"></script>\n  </body>|' "$DIST"
  fi
  echo "  已注入: $DIST"
fi

echo ""
echo "✅ 安装完成"
echo "  保存目录:   $SAVE_DIR"
echo "  提示条:     复制图片后刷新 dsh web 页面，右下角会显示 [图片已就绪]"
echo "  使用:       复制图片 → 说\"看下我刚贴的图\""
