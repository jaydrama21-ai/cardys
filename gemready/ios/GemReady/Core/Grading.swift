// Port of shared/grading.js + shared/outcomes.js. Keep in step with the JS:
// the web app, backend and tests use those files as the source of truth.

import Foundation

enum Grader: String, CaseIterable, Codable, Identifiable {
    case PSA, BGS, CGC, TAG
    var id: String { rawValue }

    /// Outcome ladder shown on "Outcomes If You Grade".
    var ladder: [String] {
        switch self {
        case .PSA, .TAG: return ["10", "9", "8", "≤7"]
        case .BGS, .CGC: return ["10", "9.5", "9", "≤8.5"]
        }
    }

    /// Larger-side % limits, front/back, best grade first.
    var centeringLimits: [(grade: String, front: Int, back: Int)] {
        switch self {
        case .PSA: return [("10", 55, 75), ("9", 60, 90), ("8", 65, 90), ("7", 70, 90), ("6", 80, 90), ("5", 85, 90)]
        case .BGS: return [("10", 50, 55), ("9.5", 55, 60), ("9", 60, 80), ("8.5", 65, 90), ("8", 70, 95)]
        case .CGC: return [("10", 55, 75), ("9.5", 60, 80), ("9", 62, 85), ("8.5", 65, 90), ("8", 70, 90)]
        case .TAG: return [("10", 55, 75), ("9", 60, 90), ("8", 65, 90), ("7", 70, 90)]
        }
    }
    var centeringApproximate: Bool { self == .CGC || self == .TAG }
}

struct Centering: Codable, Equatable {
    var lr: Double   // left share 0…1
    var tb: Double   // top share 0…1
    var confidence: Double

    static func worst(_ f: Double) -> Int { Int((max(f, 1 - f) * 100).rounded()) }
    var label: String {
        let a = Centering.worst(lr), b = Centering.worst(tb)
        return "\(a)/\(100 - a) left-right, \(b)/\(100 - b) top-bottom"
    }
}

/// Best grade centering alone allows on `grader`'s scale.
func centeringGrade(_ grader: Grader, front: Centering?, back: Centering?) -> String? {
    guard let front else { return nil }
    let f = max(Centering.worst(front.lr), Centering.worst(front.tb))
    let b = back.map { max(Centering.worst($0.lr), Centering.worst($0.tb)) }
    for row in grader.centeringLimits where f <= row.front && (b == nil || b! <= row.back) {
        return row.grade
    }
    return "<" + (grader.centeringLimits.last?.grade ?? "")
}

// MARK: - Money

struct EbayFees: Codable {
    var rateUpTo: Double, threshold: Double, rateAbove: Double
    var perOrderSmall: Double, perOrderLarge: Double, smallOrderMax: Double
}

func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }

func ebayFee(_ sale: Double, _ e: EbayFees) -> Double {
    guard sale > 0 else { return 0 }
    let upTo = min(sale, e.threshold) * e.rateUpTo
    let above = max(0, sale - e.threshold) * e.rateAbove
    return round2(upTo + above + (sale <= e.smallOrderMax ? e.perOrderSmall : e.perOrderLarge))
}

/// (sale − eBay fee − grading cost) − (raw − eBay fee on raw)
func netVsRaw(sale: Double, raw: Double, cost: Double, ebay: EbayFees) -> Double {
    round2((sale - ebayFee(sale, ebay) - cost) - (raw - ebayFee(raw, ebay)))
}
