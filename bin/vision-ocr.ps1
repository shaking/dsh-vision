# vision-ocr.ps1 — Windows OCR 后端（Windows.Media.Ocr）
#
# 与 macOS 版 vision-ocr 输出相同 JSON 格式的 OCR 命令行工具。
# 使用 Windows 10/11 内置 OCR 引擎（Windows.Media.Ocr），免费、离线、支持中文。
#
# 用法:
#   powershell -ExecutionPolicy Bypass -File vision-ocr.ps1 <image-path> [-Json]
#
# 注意:
#   - 需要 Windows 10 1803+ / Windows 11
#   - 需要安装对应语言的 OCR 语言包（设置 → 时间和语言 → 语言 → 可选功能 → 光学字符识别(OCR)）
#   - 作者在 macOS 上开发，此脚本未在 Windows 上实测，欢迎提交 issue/PR
#   - 坐标单位为 DIP（与 macOS 版归一化坐标不同，但文本内容一致）

param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ImagePath,

    [switch]$Json
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $ImagePath)) {
    Write-Error "cannot load image: $ImagePath"
    exit 2
}

# ── 加载 WinRT 类型 ───────────────────────────────────────────────────────────
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime] | Out-Null

Add-Type -AssemblyName System.Runtime.WindowsRuntime -ErrorAction SilentlyContinue

# ── Await helper：把 WinRT IAsyncOperation 转成 .NET Task（PowerShell 5.1 兼容）──
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($WinRtTask, $ResultType) {
    $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
    $netTask = $asTask.Invoke($null, @($WinRtTask))
    $netTask.Wait(-1) | Out-Null
    return $netTask.Result
}

# ── 打开并解码图片 ────────────────────────────────────────────────────────────
try {
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
} catch {
    Write-Error "cannot open image: $ImagePath ($_)"
    exit 3
}

$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

# ── OCR 引擎（优先中文） ──────────────────────────────────────────────────────
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
    Write-Error "no OCR language pack available; install OCR language packs in Settings"
    exit 4
}

$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])

# ── 组装输出（与 macOS vision-ocr 的 --json 格式一致） ───────────────────────
$lines = @()
foreach ($line in $result.Lines) {
    $words = @($line.Words)
    if ($words.Count -eq 0) { continue }
    $first = $words[0].BoundingRect
    $last = $words[$words.Count - 1].BoundingRect
    $lines += [PSCustomObject]@{
        text       = $line.Text
        confidence = 1.0
        x          = [math]::Round($first.X, 3)
        y          = [math]::Round($first.Y, 3)
    }
}

$resultObj = [PSCustomObject]@{
    width  = $decoder.PixelWidth
    height = $decoder.PixelHeight
    lines  = $lines
}

if ($Json) {
    $resultObj | ConvertTo-Json -Depth 5
} else {
    Write-Host "image: $ImagePath  size: $($decoder.PixelWidth)x$($decoder.PixelHeight)"
    Write-Host "--- OCR ---"
    if ($lines.Count -eq 0) { Write-Host "(no text detected)" }
    foreach ($l in $lines) { Write-Host $l.text }
}

$stream.Dispose()
exit 0
