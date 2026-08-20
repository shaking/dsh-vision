#!/bin/bash
# clipboard-watch.sh — 监听 macOS 剪贴板，图片自动落盘
# 你在任何地方复制图片（截图后 ⌘C / 网页右键复制图片 / 图片 App 里复制），
# 脚本自动保存到 OUT_DIR，文件名带时间戳，供 dsh agent 用 OCR/VLM 读取。
# 自动清理：只保留最近 MAX_FILES 张（默认 30），防止目录无限增长。
#
# 用法: bash clipboard-watch.sh [OUT_DIR] [MAX_FILES]
OUT_DIR="${1:-$HOME/Documents/DeepSeek/pasted-images}"
MAX_FILES="${2:-30}"
mkdir -p "$OUT_DIR"

LAST_HASH=""
echo "[clipboard-watch] 监听启动 | 保存目录: $OUT_DIR | 最多保留 $MAX_FILES 张"

# 保存一张图（带去重 + 清理）
save_image() {
  local src="$1"
  local hash ext out
  hash=$(md5 -q "$src")
  EXISTING=$(find "$OUT_DIR" -name "pasted-*.png" -exec md5 -q {} \; 2>/dev/null)
  if echo "$EXISTING" | grep -qx "$hash"; then
    echo "[$(date +%H:%M:%S)] 跳过重复图 (hash $hash)"
    return
  fi
  ext="${src##*.}"; [ "$ext" != "png" ] && [ "$ext" != "jpg" ] && [ "$ext" != "jpeg" ] && [ "$ext" != "PNG" ] && [ "$ext" != "JPG" ] && ext="png"
  TS=$(date +%Y%m%d-%H%M%S)
  OUT="$OUT_DIR/pasted-$TS.$ext"
  cp "$src" "$OUT"
  echo "[$(date +%H:%M:%S)] 已保存: $OUT ($(stat -f%z "$OUT") bytes)"
  # 清理旧图：只保留最近 MAX_FILES 张
  ls -t "$OUT_DIR"/pasted-*.png 2>/dev/null | tail -n +$((MAX_FILES + 1)) | while read -r f; do
    rm -f "$f"
    echo "[$(date +%H:%M:%S)] 清理旧图: $(basename "$f")"
  done
}

while true; do
  # ── 通道1：剪贴板图片数据（⌘C 复制图片 / 截图） ──
  TMP="/tmp/clip_paste_$$.png"
  osascript \
    -e "set p to POSIX file \"$TMP\"" \
    -e 'set d to the clipboard as «class PNGf»' \
    -e 'set fp to open for access p with write permission' \
    -e 'write d to fp' \
    -e 'close access fp' >/dev/null 2>&1
  if [ -f "$TMP" ] && [ -s "$TMP" ]; then
    save_image "$TMP"
    rm -f "$TMP"
  fi

  # ── 通道2：剪贴板文件引用（Finder 多选图片 ⌘C） ──
  # 剪贴板为图片数据时 as list 会失败（输出空），自然跳过；仅文件引用时返回 "file <HFS路径>"
  CLIPLIST=$(osascript -e 'the clipboard as list' 2>/dev/null)
  if [ -n "$CLIPLIST" ]; then
    while IFS= read -r line; do
      case "$line" in
        file\ *)
          hfs="${line#file }"
          P=$(osascript -e "POSIX path of (alias \"$hfs\")" 2>/dev/null)
          case "$P" in
            *.png|*.jpg|*.jpeg|*.PNG|*.JPG|*.JPEG)
              if [ -f "$P" ]; then
                save_image "$P"
              fi
              ;;
          esac
          ;;
      esac
    done <<< "$CLIPLIST"
  fi

  sleep 2.5
done
