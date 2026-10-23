import Foundation

struct Endpoint: Codable, Equatable, Hashable { let url: URL; let trust: String }
struct Invitation: Codable {
    let `protocol`: Int
    let serverId: String
    let keyFingerprint: String
    let endpoints: [Endpoint]
    let invitation: String
    let expiresAt: Double
    static func parse(_ text: String, now: Double = Date().timeIntervalSince1970 * 1000) throws -> Self {
        guard text.count < 8192, let url = URL(string: text), url.scheme == "cornelius", url.host == "pair",
              let encoded = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "data" })?.value else { throw MirrorError.message("Lien d’association Cornelius invalide.") }
        var base64 = encoded.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
        guard let data = Data(base64Encoded: base64) else { throw MirrorError.message("Invitation illisible.") }
        let value = try JSONDecoder().decode(Self.self, from: data)
        guard value.protocol == 1, value.expiresAt > now, value.expiresAt <= now + 360_000,
              UUID(uuidString: value.serverId) != nil, value.keyFingerprint.filter({ $0 != ":" }).count == 64,
              !value.endpoints.isEmpty, value.endpoints.count <= 8,
              value.endpoints.allSatisfy({ $0.url.scheme == "https" && $0.url.user == nil && $0.url.password == nil && $0.url.query == nil && $0.url.fragment == nil && ($0.url.path.isEmpty || $0.url.path == "/") && ($0.trust == "pinned" || ($0.trust == "system" && ($0.url.host?.hasSuffix(".ts.net") ?? false))) }) else { throw MirrorError.message("Invitation expirée ou incompatible. Créez-en une nouvelle depuis l’administration.") }
        return value
    }
}
struct Credential: Codable {
    let deviceId: String
    let token: String
    let serverId: String
    var endpoints: [Endpoint]
    let keyFingerprint: String
}
struct PairResponse: Decodable { let deviceId: String; let token: String; let serverId: String; let `protocol`: Int }
struct MobileHello: Decodable { let type: String; let generation: String; let serverId: String; let `protocol`: Int; let endpoints: [Endpoint] }
struct MobileMirror: Decodable { let deviceId: String; let generation: String; let background: Bool }
struct Profile: Decodable, Identifiable { let id: String; let name: String }
struct Person: Decodable, Identifiable { let trackId: String; let profileId: String?; let engaged: Bool; var id: String { trackId } }
struct Presence: Decodable { let state: String; let health: String; let peopleCount: Int; let people: [Person]; let observedAt: Double? }
struct SessionState: Decodable {
    let phase: String; let reason: String?; let mode: Int; let interactionId: String?; let profileEpoch: Int; let contextVersion: Int
    let manualStop: Bool; let satellite: Satellite?
    struct Satellite: Decodable { let id: String; let name: String }
}
struct Voice: Decodable { let phase: String; let endsAt: Double? }
struct CardItem: Decodable, Hashable { let label: String; let value: String }
struct CardSource: Decodable, Identifiable { let id: String; let title: String; let url: URL? }
struct CardContent: Decodable {
    let cardType: String; let title: String; let primaryValue: String?; let subtitle: String?; let description: String?
    let items: [CardItem]; let imageUrl: String?; let addonId: String?; let stale: Bool?
}
struct DisplayCard: Decodable, Identifiable {
    let id: String; let profileId: String?; let createdAt: Double; let expiresAt: Double
    let interactionId: String?; let profileEpoch: Int; let contextVersion: Int; let content: CardContent; let sources: [CardSource]; let stale: Bool?
    func visible(in state: MirrorState, now: Double) -> Bool {
        expiresAt > now && state.session.interactionId != nil && interactionId == state.session.interactionId && profileEpoch == state.session.profileEpoch && contextVersion == state.session.contextVersion && (profileId == nil || (profileId == state.activeProfile?.id && state.profileVisible(now: now)))
    }
}
struct Ambient: Decodable, Identifiable {
    let instanceId: String; let profileId: String?; let label: String; let status: String; let fetchedAt: String?; let content: Content?
    var id: String { instanceId }
    struct Content: Decodable { let value: String?; let subtitle: String?; let items: [CardItem]; let showCollectedAt: Bool? }
}
struct MirrorState: Decodable {
    let openaiBlocked: Bool; let privacyMode: Bool; let orbScale: Double?; let session: SessionState
    let presence: Presence; let activeProfile: Profile?; let profiles: [Profile]; let cards: [DisplayCard]; let ambientDisplays: [Ambient]
    let voice: Voice; let webSearchActive: Bool?; let diagnostic: String?; let browserConnected: Bool
    let mobileMirror: MobileMirror?; let wakeWord: WakeWord; let imageGeneration: ImageActivity?; let setup: Setup?
    struct WakeWord: Decodable { let enabled: Bool; let ready: Bool; let detail: String? }
    struct ImageActivity: Decodable { let phase: String? }
    struct Setup: Decodable { let openaiKey: Bool; let perception: Bool }
    func profileVisible(now: Double) -> Bool {
        presence.health == "ok" && now - (presence.observedAt ?? 0) < 2000 && activeProfile != nil && !(privacyMode && presence.peopleCount > 1) && presence.people.contains(where: { $0.profileId == activeProfile?.id })
    }
    func recognized(now: Double) -> Bool {
        presence.health == "ok" && presence.peopleCount == 1 && now - (presence.observedAt ?? 0) < 2000 && activeProfile != nil && presence.people.contains(where: { $0.profileId == activeProfile?.id })
    }
    func ambient(now: Double) -> [Ambient] {
        guard browserConnected, presence.health == "ok", presence.state != "absent", presence.peopleCount > 0, now - (presence.observedAt ?? 0) < 2000, !(privacyMode && presence.peopleCount > 1) else { return [] }
        return ambientDisplays.filter { $0.profileId == nil || (profileVisible(now: now) && $0.profileId == activeProfile?.id) }
    }
}
struct Snapshot: Decodable { let schemaVersion: Int; let bootId: String; let sequence: Int; let sentAt: Double; let state: MirrorState }
enum MirrorError: LocalizedError { case message(String); var errorDescription: String? { if case .message(let text) = self { return text }; return nil } }
struct Freshness {
    private(set) var boot: String?; private(set) var sequence = -1; private(set) var received = Date.distantPast; private(set) var offset: Double = 0
    mutating func accept(_ snapshot: Snapshot, at date: Date = Date()) -> Bool {
        guard snapshot.schemaVersion == 1, boot != snapshot.bootId || snapshot.sequence >= sequence else { return false }
        boot = snapshot.bootId; sequence = snapshot.sequence; received = date; offset = snapshot.sentAt - date.timeIntervalSince1970 * 1000
        return true
    }
    mutating func heartbeat(boot: String, sequence: Int, at date: Date = Date()) {
        guard self.boot == boot, sequence >= self.sequence else { return }; received = date
    }
    func fresh(at date: Date = Date()) -> Bool { date.timeIntervalSince(received) < 5 }
    func serverNow(_ date: Date = Date()) -> Double { date.timeIntervalSince1970 * 1000 + offset }
}
