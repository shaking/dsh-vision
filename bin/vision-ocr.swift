// vision-ocr.swift — macOS Vision.framework OCR 命令行工具
// 用法: vision-ocr <image-path> [--lang zh-Hans] [--json]
// 输出: 图片元信息 + 按阅读顺序排序的识别文本行
import Foundation
import Vision
import AppKit

func fail(_ msg: String, code: Int32) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}

let args = CommandLine.arguments
guard args.count >= 2 else {
    fail("usage: vision-ocr <image> [--lang zh-Hans] [--json]", code: 1)
}
let imagePath = args[1]
var language = "zh-Hans"
var wantsJSON = false
if let idx = args.firstIndex(of: "--lang"), idx + 1 < args.count { language = args[idx + 1] }
if args.contains("--json") { wantsJSON = true }

guard let image = NSImage(contentsOfFile: imagePath) else {
    fail("cannot load image: \(imagePath)", code: 2)
}
guard let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    fail("cannot convert image to CGImage: \(imagePath)", code: 3)
}

let width = cgImage.width
let height = cgImage.height

let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.recognitionLanguages = [language, "en-US"]
request.usesLanguageCorrection = true

let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
do {
    try handler.perform([request])
} catch {
    fail("Vision request failed: \(error)", code: 4)
}

struct Line {
    let text: String
    let y: Double   // Vision 坐标 (0-1, 底部为 0)
    let x: Double
    let confidence: Float
}

var lines: [Line] = []
for obs in request.results ?? [] {
    guard let cand = obs.topCandidates(1).first else { continue }
    let box = obs.boundingBox
    lines.append(Line(text: cand.string, y: Double(box.midY), x: Double(box.minX), confidence: cand.confidence))
}

// 按阅读顺序：从顶到底，同行内从左到右
lines.sort { a, b in
    if abs(a.y - b.y) > 0.02 { return a.y > b.y }
    return a.x < b.x
}

if wantsJSON {
    let rows = lines.map { l in
        "{\"text\": \(jsonEscape(l.text)), \"confidence\": \(String(format: "%.3f", l.confidence)), \"x\": \(String(format: "%.3f", l.x)), \"y\": \(String(format: "%.3f", l.y))}"
    }
    let payload = """
    {"width": \(width), "height": \(height), "lines": [\(rows.joined(separator: ","))]}
    """
    print(payload)
} else {
    print("image: \(imagePath)  size: \(width)x\(height)")
    print("--- OCR (\(language)) ---")
    if lines.isEmpty {
        print("(no text detected)")
    }
    for l in lines {
        print(l.text)
    }
}

func jsonEscape(_ s: String) -> String {
    var out = "\""
    for ch in s.unicodeScalars {
        switch ch {
        case "\"": out += "\\\""
        case "\\": out += "\\\\"
        case "\n": out += "\\n"
        case "\r": out += "\\r"
        case "\t": out += "\\t"
        default:
            if ch.value < 0x20 {
                out += String(format: "\\u%04x", ch.value)
            } else {
                out.append(Character(ch))
            }
        }
    }
    out += "\""
    return out
}
