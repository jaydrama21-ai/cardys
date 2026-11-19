// On-device centering + photo checks. Port of shared/analysis.js, with one
// upgrade only native code gets cheaply: Vision finds the card's four corners
// and Core Image squares it up first, so tilted photos measure correctly.

import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision

struct PhotoCheck: Codable, Equatable {
    enum Issue: String, Codable { case blur, dark, washed, glare, noCard }
    var issues: [Issue]
    var glareWhere: String?
    var sharpness: Double
    var glare: Double
    var ok: Bool { issues.isEmpty }
}

enum Analysis {
    static let context = CIContext()

    /// Detect the card and return it flattened to a 630×880 image (63×88 mm).
    static func flattenedCard(_ image: UIImage) -> CGImage? {
        guard let cg = image.cgImage else { return nil }
        let request = VNDetectRectanglesRequest()
        request.minimumAspectRatio = 0.6
        request.maximumAspectRatio = 0.8
        request.minimumSize = 0.3
        request.maximumObservations = 1
        try? VNImageRequestHandler(cgImage: cg, orientation: .up).perform([request])
        guard let r = request.results?.first else { return nil }
        let ci = CIImage(cgImage: cg)
        let size = ci.extent.size
        func pt(_ p: CGPoint) -> CGPoint { CGPoint(x: p.x * size.width, y: p.y * size.height) }
        let f = CIFilter.perspectiveCorrection()
        f.inputImage = ci
        f.topLeft = pt(r.topLeft); f.topRight = pt(r.topRight)
        f.bottomLeft = pt(r.bottomLeft); f.bottomRight = pt(r.bottomRight)
        guard let out = f.outputImage else { return nil }
        let scaled = out.transformed(by: CGAffineTransform(scaleX: 630 / out.extent.width, y: 880 / out.extent.height))
        return context.createCGImage(scaled, from: CGRect(x: 0, y: 0, width: 630, height: 880))
    }

    /// RGBA bytes for a CGImage.
    static func pixels(_ cg: CGImage) -> (w: Int, h: Int, data: [UInt8]) {
        let w = cg.width, h = cg.height
        var data = [UInt8](repeating: 0, count: w * h * 4)
        let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        ctx?.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        return (w, h, data)
    }

    /// Centering on a flattened card: border = first strong color edge coming
    /// in from each side (same rule as the JS version).
    static func centering(_ card: CGImage) -> Centering? {
        let (w, h, d) = pixels(card)
        func color(_ x: Int, _ y: Int) -> (Double, Double, Double) {
            let i = (y * w + x) * 4
            return (Double(d[i]), Double(d[i + 1]), Double(d[i + 2]))
        }
        func profile(cols: Bool) -> [(Double, Double, Double)] {
            let n = cols ? w : h, m = cols ? h : w
            let a = Int(Double(m) * 0.3), b = Int(Double(m) * 0.7)
            return (0..<n).map { i in
                var r = 0.0, g = 0.0, bl = 0.0
                for j in a..<b { let c = cols ? color(i, j) : color(j, i); r += c.0; g += c.1; bl += c.2 }
                let k = Double(b - a); return (r / k, g / k, bl / k)
            }
        }
        func diffs(_ p: [(Double, Double, Double)]) -> [Double] {
            (0..<p.count).map { i in
                i + 1 < p.count ? sqrt(pow(p[i].0 - p[i + 1].0, 2) + pow(p[i].1 - p[i + 1].1, 2) + pow(p[i].2 - p[i + 1].2, 2)) : 0
            }
        }
        func median(_ a: [Double]) -> Double { let s = a.filter { $0 > 0 }.sorted(); return s.isEmpty ? 0 : s[s.count / 2] }
        func firstStrong(_ a: [Double], from: Int, to: Int, base: Double) -> Int {
            let lo = max(1, min(from, to)), hi = min(a.count - 2, max(from, to))
            guard lo < hi else { return from }
            let peak = a[lo...hi].max() ?? 0
            let need = max(peak * 0.35, base * 4)
            let range: [Int] = from <= to ? Array(lo...hi) : Array((lo...hi).reversed())
            for i in range where a[i] >= need && a[i] >= a[i - 1] && a[i] >= a[i + 1] { return i }
            return a[lo...hi].firstIndex(of: peak) ?? from
        }
        let dc = diffs(profile(cols: true)), dr = diffs(profile(cols: false))
        let base = max(1, (median(dc) + median(dr)) / 2)
        let lo = 0.012, hi = 0.16
        let L = firstStrong(dc, from: Int(Double(w) * lo) + 2, to: Int(Double(w) * hi), base: base)
        let R = firstStrong(dc, from: w - 2 - Int(Double(w) * lo), to: w - Int(Double(w) * hi), base: base)
        let T = firstStrong(dr, from: Int(Double(h) * lo) + 2, to: Int(Double(h) * hi), base: base)
        let B = firstStrong(dr, from: h - 2 - Int(Double(h) * lo), to: h - Int(Double(h) * hi), base: base)
        let left = Double(L + 1), right = Double(w - 1 - R), top = Double(T + 1), bottom = Double(h - 1 - B)
        guard left + right > 0, top + bottom > 0 else { return nil }
        return Centering(lr: left / (left + right), tb: top / (top + bottom), confidence: 1)
    }

    /// Blur / exposure / glare. Same thresholds as THRESHOLDS in analysis.js.
    static func checks(_ image: UIImage) -> PhotoCheck {
        guard let cg = image.cgImage else { return PhotoCheck(issues: [.noCard], glareWhere: nil, sharpness: 0, glare: 0) }
        let small = downscaled(cg, max: 1024) ?? cg
        let (w, h, d) = pixels(small)
        var L = [Double](repeating: 0, count: w * h)
        var sum = 0.0, high = 0
        var hits = Array(repeating: Array(repeating: 0, count: 3), count: 3)
        for y in 0..<h { for x in 0..<w {
            let i = (y * w + x) * 4
            let r = Double(d[i]), g = Double(d[i + 1]), b = Double(d[i + 2])
            let v = 0.299 * r + 0.587 * g + 0.114 * b
            L[y * w + x] = v; sum += v; if v >= 250 { high += 1 }
            if min(r, g, b) >= 240 && max(r, g, b) - min(r, g, b) <= 18 { hits[min(2, y * 3 / h)][min(2, x * 3 / w)] += 1 }
        } }
        var issues: [PhotoCheck.Issue] = []
        let mean = sum / Double(w * h)
        if mean < 55 { issues.append(.dark) }
        if mean > 225 || Double(high) / Double(w * h) > 0.25 { issues.append(.washed) }
        // Edge sharpness: Laplacian vs gradient at the strongest edges.
        var G = [Double](repeating: 0, count: w * h), sample: [Double] = []
        for y in 1..<(h - 1) { for x in 1..<(w - 1) {
            let p = y * w + x
            G[p] = hypot((L[p + 1] - L[p - 1]) / 2, (L[p + w] - L[p - w]) / 2)
            if (x + y) % 7 == 0 { sample.append(G[p]) }
        } }
        sample.sort()
        let T = max(3, sample.isEmpty ? 3 : sample[Int(Double(sample.count) * 0.985)])
        var sl = 0.0, sg = 0.0, n = 0
        for y in 1..<(h - 1) { for x in 1..<(w - 1) {
            let p = y * w + x
            guard G[p] >= T else { continue }
            sl += abs(L[p - 1] + L[p + 1] + L[p - w] + L[p + w] - 4 * L[p]); sg += G[p]; n += 1
        } }
        let sharp = n < 30 ? 0 : 100 * sl / sg
        if sharp < 60 { issues.append(.blur) }
        let names = [["top left", "top", "top right"], ["left", "middle", "right"], ["bottom left", "bottom", "bottom right"]]
        let cell = Double(w * h) / 9
        var worst = 0.0, whereName: String?
        for gy in 0..<3 { for gx in 0..<3 { let s = Double(hits[gy][gx]) / cell; if s > worst { worst = s; whereName = names[gy][gx] } } }
        if worst >= 0.04 { issues.append(.glare) } else { whereName = nil }
        return PhotoCheck(issues: issues, glareWhere: whereName, sharpness: sharp, glare: worst)
    }

    static func downscaled(_ cg: CGImage, max m: Int) -> CGImage? {
        let s = min(1, Double(m) / Double(max(cg.width, cg.height)))
        if s >= 1 { return cg }
        let ci = CIImage(cgImage: cg).transformed(by: CGAffineTransform(scaleX: s, y: s))
        return context.createCGImage(ci, from: ci.extent)
    }
}
