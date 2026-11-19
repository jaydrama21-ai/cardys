// On-device storage: settings in UserDefaults, scans as JSON + JPEGs in the
// app's Documents folder. Nothing here is sent anywhere.

import Foundation
import UIKit

final class Settings: ObservableObject {
    static let shared = Settings()
    private let d = UserDefaults.standard
    @Published var ageChecked: Bool { didSet { d.set(ageChecked, forKey: "ageChecked") } }
    @Published var under13: Bool { didSet { d.set(under13, forKey: "under13") } }
    @Published var privacySeen: Int { didSet { d.set(privacySeen, forKey: "privacySeen") } }
    @Published var improve: Bool { didSet { d.set(improve, forKey: "improve") } }
    @Published var grader: Grader { didSet { d.set(grader.rawValue, forKey: "grader") } }
    @Published var minNet: Double { didSet { d.set(minNet, forKey: "minNet") } }
    var token: String? { get { d.string(forKey: "token") } set { d.set(newValue, forKey: "token") } }

    private init() {
        ageChecked = d.bool(forKey: "ageChecked")
        under13 = d.bool(forKey: "under13")
        privacySeen = d.integer(forKey: "privacySeen")
        improve = d.object(forKey: "improve") as? Bool ?? true
        grader = Grader(rawValue: d.string(forKey: "grader") ?? "PSA") ?? .PSA
        minNet = d.object(forKey: "minNet") as? Double ?? 100
    }

    func wipe() {
        if let id = Bundle.main.bundleIdentifier { d.removePersistentDomain(forName: id) }
        ageChecked = false; under13 = false; privacySeen = 0; improve = true; grader = .PSA; minNet = 100
    }
}

struct Scan: Codable, Identifiable, Hashable {
    var id = UUID()
    var createdAt = Date()
    var card: Card?
    var frontFile: String?, backFile: String?
    var front: Centering?, back: Centering?
    var frontCheck: PhotoCheck?, backCheck: PhotoCheck?
    var paid: Double?
    static func == (a: Scan, b: Scan) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }
}

@MainActor
final class ScanStore: ObservableObject {
    static let shared = ScanStore()
    @Published private(set) var scans: [Scan] = []
    private let dir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    private var index: URL { dir.appendingPathComponent("scans.json") }

    init() {
        if let data = try? Data(contentsOf: index), let s = try? JSONDecoder().decode([Scan].self, from: data) { scans = s }
    }
    func save(_ scan: Scan) {
        if let i = scans.firstIndex(where: { $0.id == scan.id }) { scans[i] = scan } else { scans.insert(scan, at: 0) }
        try? JSONEncoder().encode(scans).write(to: index, options: .atomic)
    }
    func remove(_ scan: Scan) {
        for f in [scan.frontFile, scan.backFile].compactMap({ $0 }) { try? FileManager.default.removeItem(at: dir.appendingPathComponent(f)) }
        scans.removeAll { $0.id == scan.id }
        try? JSONEncoder().encode(scans).write(to: index, options: .atomic)
    }
    /// JPEG re-encode drops EXIF (location, phone model, time taken).
    func storePhoto(_ image: UIImage) -> String? {
        let name = UUID().uuidString + ".jpg"
        guard let data = image.jpegData(compressionQuality: 0.9) else { return nil }
        try? data.write(to: dir.appendingPathComponent(name), options: .completeFileProtection)
        return name
    }
    func image(_ file: String?) -> UIImage? { file.flatMap { UIImage(contentsOfFile: dir.appendingPathComponent($0).path) } }
    func wipe() {
        for s in scans { remove(s) }
        try? FileManager.default.removeItem(at: index)
    }
}
