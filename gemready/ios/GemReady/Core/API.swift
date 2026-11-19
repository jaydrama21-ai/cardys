// GemReady backend client. Same endpoints as web/js/api.js.

import Foundation

struct Card: Codable, Identifiable, Hashable {
    let id: String, name: String, set: String, num: String
    let rarity: String?
    let raw: Double
    let img: String?
}

struct Tier: Codable, Hashable { let id: String, name: String, price: Double?, maxValue: Double?, days: Int?, valueLimitUnknown: Bool? }
struct OutcomeRow: Codable, Hashable, Identifiable {
    var id: String { grade }
    let grade: String, sale: Double?, sales: Int?, net: Double?, reason: String?, source: String?
}
struct Verdict: Codable, Hashable { let kind: String, worthAt: String? }
struct Outcomes: Codable {
    let raw: Double, rawSource: String, grader: String
    let tier: Tier?, rows: [OutcomeRow], verdict: Verdict
    let pricesUpdatedAt: String?, feesAsOf: String
}
struct MatchResult: Codable { let id: String?, confidence: Double, candidates: [Card] }
struct AppConfig: Codable { let modelEnabled: Bool, feesVerifiedAt: String, sampleData: Bool }

enum APIError: Error { case offline, server(String) }

actor API {
    static let shared = API()
    /// Your deployed backend. Same host the web app uses.
    let base = URL(string: Bundle.main.object(forInfoDictionaryKey: "GemReadyAPI") as? String ?? "https://api.gemready.app")!.appendingPathComponent("api")

    private func call<T: Decodable>(_ path: String, method: String = "GET", body: [String: Any]? = nil, auth: Bool = false) async throws -> T {
        var req = URLRequest(url: URL(string: base.absoluteString + path)!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "content-type")
        if let body { req.httpBody = try JSONSerialization.data(withJSONObject: body) }
        if auth, let t = await token() { req.setValue("Bearer \(t)", forHTTPHeaderField: "authorization") }
        let data: Data, resp: URLResponse
        do { (data, resp) = try await URLSession.shared.data(for: req) } catch { throw APIError.offline }
        guard let http = resp as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw APIError.server(msg ?? "Request failed")
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    /// Anonymous sign-in. Never created for under-13 users (COPPA).
    func token() async -> String? {
        let s = Settings.shared
        if let t = s.token { return t }
        if s.under13 { return nil }
        struct Anon: Decodable { let token: String }
        guard let a: Anon = try? await call("/anon", method: "POST", body: ["under13": false]) else { return nil }
        s.token = a.token
        return a.token
    }

    func config() async throws -> AppConfig { try await call("/config") }
    func search(_ q: String) async throws -> [Card] { try await call("/search?q=\(q.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "")") }
    func match(text: String) async throws -> MatchResult { try await call("/match", method: "POST", body: ["text": text]) }
    func outcomes(cardId: String, grader: Grader, shippingIn: Double, minNet: Double) async throws -> Outcomes {
        try await call("/outcomes/\(cardId)?grader=\(grader.rawValue)&shippingIn=\(shippingIn)&minNet=\(minNet)")
    }
    func slabResult(_ body: [String: Any]) async throws { let _: [String: Bool] = try await call("/slab-results", method: "POST", body: body) }
    func feedback(kind: String, text: String, screen: String) async throws {
        let _: [String: Bool] = try await call("/feedback", method: "POST", body: ["kind": kind, "text": text, "screen": screen, "version": "1.0.0"])
    }
    func deleteMe() async throws { let _: [String: Bool] = try await call("/me", method: "DELETE", auth: true) }
}
