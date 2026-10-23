import Foundation
import UIKit
import Combine

@MainActor final class MirrorClient: ObservableObject {
    @Published var credential: Credential? = CredentialStore.load()
    @Published var snapshot: Snapshot?
    @Published var message: String?
    @Published var connected = false
    @Published var busy = false
    @Published var interrupted = false
    @Published var audioReady = false
    @Published var muted = false
    @Published var inputLevel: Float = 0
    @Published var outputLevel: Float = 0
    @Published var transport = ""
    var freshness = Freshness()
    let media = MirrorMedia()
    private let discovery = Discovery()
    private var connection: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?
    private var audioReceiver: Task<Void, Never>?
    private var session: URLSession?
    private var events: URLSessionWebSocketTask?
    private var audioSocket: URLSessionWebSocketTask?
    private var cameraSocket: URLSessionWebSocketTask?
    private var generation: String?
    private var background = false
    private var cameraWanted = true
    private var sendingCamera = false
    private var sendingAudio = false
    private var preparing = false
    private(set) var endpoint: Endpoint?
    init() {
        media.audio = { [weak self] data, level in Task { @MainActor in self?.sendAudio(data, level: level) } }
        media.image = { [weak self] data in Task { @MainActor in self?.sendCamera(data) } }
        media.interruption = { [weak self] in Task { @MainActor in self?.stopConversation() } }
    }
    func pair(_ text: String) async {
        guard !busy else { return }; busy = true; message = nil
        defer { busy = false }
        do {
            let invitation = try Invitation.parse(text)
            var lastError: Error = MirrorError.message("Serveur injoignable. Vérifiez le Wi-Fi ou Tailscale.")
            for endpoint in invitation.endpoints {
                let session = PinnedSession(endpoint: endpoint, fingerprint: invitation.keyFingerprint).session()
                defer { session.invalidateAndCancel() }
                do {
                    var request = URLRequest(url: endpoint.url.appendingPathComponent("mobile/pair"))
                    request.httpMethod = "POST"; request.setValue("application/json", forHTTPHeaderField: "Content-Type")
                    request.httpBody = try JSONSerialization.data(withJSONObject: ["invitation": invitation.invitation, "name": UIDevice.current.name])
                    let (data, response) = try await session.data(for: request)
                    try Self.requireSuccess(data, response)
                    let result = try JSONDecoder().decode(PairResponse.self, from: data)
                    guard result.serverId == invitation.serverId, result.protocol == 1 else { throw MirrorError.message("Identité de serveur inattendue.") }
                    let credential = Credential(deviceId: result.deviceId, token: result.token, serverId: result.serverId, endpoints: invitation.endpoints, keyFingerprint: invitation.keyFingerprint)
                    try CredentialStore.save(credential); self.credential = credential
                    activate(); return
                } catch { lastError = error }
            }
            throw lastError
        } catch { message = error.localizedDescription }
    }
    func activate() {
        guard credential != nil, connection == nil, !preparing else { return }
        interrupted = false; preparing = true; discovery.start()
        connection = Task { [weak self] in
            guard let self else { return }
            defer {
                self.connection = nil; self.preparing = false
                if Task.isCancelled && !self.background && !self.interrupted && self.credential != nil {
                    Task { @MainActor [weak self] in self?.activate() }
                }
            }
            do { try await self.media.prepare(); self.audioReady = true }
            catch { self.message = error.localizedDescription; self.media.stop(); return }
            var delay: UInt64 = 1
            while !Task.isCancelled && !self.interrupted {
                guard !self.background || self.snapshot?.state.session.phase == "ready", let credential = self.credential else { break }
                var endpoints = credential.endpoints
                if let discovered = self.discovery.identifiedServers[credential.serverId], !endpoints.contains(where: { $0.url == discovered }) { endpoints.insert(Endpoint(url: discovered, trust: "pinned"), at: 0) }
                for endpoint in endpoints.sorted(by: { $0.trust == "pinned" && $1.trust != "pinned" }) {
                    if Task.isCancelled || self.interrupted { break }
                    do { try await self.connect(endpoint, credential: credential) }
                    catch {
                        if Task.isCancelled { break }
                        if self.background { self.deactivate(); break }
                        let code = self.events?.closeCode
                        if code == .policyViolation {
                            self.interrupted = true
                            self.message = self.events?.closeReason.flatMap { String(data: $0, encoding: .utf8) } ?? "Miroir affiché sur un autre appareil."
                        } else { self.message = "Connexion au serveur perdue, nouvelle tentative… Vérifiez le réseau local ou Tailscale." }
                    }
                    self.closeNetwork()
                }
                if self.interrupted || Task.isCancelled { break }
                try? await Task.sleep(nanoseconds: delay * 1_000_000_000); delay = min(8, delay * 2)
            }
            self.media.stop(); self.audioReady = false; self.snapshot = nil
        }
    }
    func loadDemo() {
        guard let url = Bundle.main.url(forResource: "mirror-fixture", withExtension: "json"), let data = try? Data(contentsOf: url), let snapshot = try? JSONDecoder().decode(Snapshot.self, from: data) else { message = "Exemple indisponible."; return }
        self.snapshot = snapshot; _ = freshness.accept(snapshot); connected = true; audioReady = true
        transport = "Démonstration"; outputLevel = 0.12
    }
    private func connect(_ endpoint: Endpoint, credential: Credential) async throws {
        self.endpoint = endpoint
        let session = PinnedSession(endpoint: endpoint, fingerprint: credential.keyFingerprint).session()
        self.session = session
        var probe = authorized(endpoint.url.appendingPathComponent("mobile/info"), credential)
        probe.timeoutInterval = endpoint.trust == "pinned" ? 2.5 : 8
        let (data, response) = try await session.data(for: probe)
        try Self.requireSuccess(data, response)
        let info = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard info?["serverId"] as? String == credential.serverId, info?["protocol"] as? Int == 1 else { throw MirrorError.message("Serveur incompatible.") }
        let socket = session.webSocketTask(with: authorized(webSocketURL(endpoint.url, path: "mobile/events"), credential))
        events = socket; socket.resume()
        while !Task.isCancelled {
            let received = try await socket.receive()
            guard case .string(let string) = received, let data = string.data(using: .utf8), data.count < 512000 else { continue }
            let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any]
            switch envelope?["type"] as? String {
            case "mobile":
                let hello = try JSONDecoder().decode(MobileHello.self, from: data)
                guard hello.serverId == credential.serverId, hello.protocol == 1 else { throw MirrorError.message("Serveur incompatible.") }
                generation = hello.generation
                var updated = credential
                updated.endpoints = credential.endpoints.filter { $0.trust != "system" } + hello.endpoints.filter { $0.trust == "system" && $0.url.scheme == "https" && ($0.url.host?.hasSuffix(".ts.net") ?? false) }
                try CredentialStore.save(updated); self.credential = updated
                try await openMedia(session, endpoint: endpoint, credential: credential, generation: hello.generation)
                connected = true; UIApplication.shared.isIdleTimerDisabled = !background; transport = endpoint.trust == "pinned" ? "Réseau local" : "Tailscale"; message = nil
                media.setCameraEnabled(!background && cameraWanted)
                send(["type": "media_ready", "ready": true])
                if background { send(["type": "background", "enabled": true]) }
                heartbeat?.cancel()
                heartbeat = Task { [weak self] in
                    while !Task.isCancelled {
                        self?.send(["type": "heartbeat"])
                        try? await Task.sleep(nanoseconds: 1_000_000_000)
                    }
                }
            case "state":
                let value = try JSONDecoder().decode(Snapshot.self, from: data)
                guard freshness.accept(value), value.state.mobileMirror?.deviceId == credential.deviceId, value.state.mobileMirror?.generation == generation else { continue }
                if snapshot?.state.session.interactionId != value.state.session.interactionId || value.state.session.phase != "ready" || (snapshot?.state.voice.phase != "listening" && value.state.voice.phase == "listening") { media.clear(); outputLevel = 0 }
                snapshot = value
                if background && !["ready", "connecting", "closing"].contains(value.state.session.phase) { deactivate(); return }
            case "heartbeat":
                if let boot = envelope?["bootId"] as? String, let sequence = envelope?["sequence"] as? Int { freshness.heartbeat(boot: boot, sequence: sequence) }
            case "capture":
                cameraWanted = envelope?["enabled"] as? Bool ?? false
                media.setCameraEnabled(cameraWanted && !background && audioReady)
            case "snapshot": media.detailedSnapshot()
            default: break
            }
        }
    }
    private func openMedia(_ session: URLSession, endpoint: Endpoint, credential: Credential, generation: String) async throws {
        for name in ["audio", "camera"] {
            var components = URLComponents(url: webSocketURL(endpoint.url, path: "mobile/" + name), resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "generation", value: generation)]
            let socket = session.webSocketTask(with: authorized(components.url!, credential)); socket.resume()
            if name == "audio" { audioSocket = socket } else { cameraSocket = socket }
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in socket.sendPing { error in if let error { continuation.resume(throwing: error) } else { continuation.resume() } } }
        }
        audioReceiver?.cancel()
        audioReceiver = Task { [weak self, socket = audioSocket!] in
            do {
                while !Task.isCancelled {
                    let received = try await socket.receive()
                    guard !Task.isCancelled, self?.audioSocket === socket else { break }
                    switch received {
                    case .data(let pcm): if self?.snapshot?.state.session.phase == "ready" { self?.outputLevel = self?.media.play(pcm) ?? 0 }
                    case .string: self?.media.clear()
                    @unknown default: break
                    }
                }
            } catch { if !Task.isCancelled { self?.events?.cancel(with: .goingAway, reason: nil) } }
        }
    }
    private func sendAudio(_ data: Data, level: Float) {
        inputLevel = level
        guard connected, !sendingAudio, let socket = audioSocket, let state = snapshot?.state else { return }
        let active = ["connecting", "ready"].contains(state.session.phase) && state.session.satellite == nil
        guard active || (!muted && !background && state.wakeWord.enabled && state.wakeWord.ready && state.session.phase == "idle") else { return }
        let id = active ? state.session.interactionId ?? "-" : "-"
        var packet = Data((id + "\n").utf8); packet.append(muted ? Data(count: data.count) : data)
        sendingAudio = true
        Task { defer { sendingAudio = false }; do { try await socket.send(.data(packet)) } catch { events?.cancel(with: .goingAway, reason: nil) } }
    }
    private func sendCamera(_ data: Data) {
        guard connected, !background, cameraWanted, !sendingCamera, let socket = cameraSocket else { return }
        sendingCamera = true
        Task { defer { sendingCamera = false }; try? await socket.send(.data(data)) }
    }
    func send(_ command: [String: Any]) {
        guard let socket = events, let data = try? JSONSerialization.data(withJSONObject: command), let value = String(data: data, encoding: .utf8) else { return }
        Task { try? await socket.send(.string(value)) }
    }
    func setBackground(_ value: Bool) {
        background = value
        if value {
            discovery.stop()
            media.setCameraEnabled(false)
            if snapshot?.state.session.phase == "ready" { send(["type": "background", "enabled": true]) }
            else { deactivate() }
        } else {
            discovery.start()
            if connected { send(["type": "background", "enabled": false]); media.setCameraEnabled(cameraWanted && audioReady) }
            else if credential != nil && !interrupted { activate() }
        }
        UIApplication.shared.isIdleTimerDisabled = !value && connected
    }
    func stopConversation() { send(["type": "stop"]); media.clear(); if background { deactivate() } }
    func deactivate() { discovery.stop(); connection?.cancel(); heartbeat?.cancel(); closeNetwork(); media.stop(); audioReady = false; snapshot = nil; UIApplication.shared.isIdleTimerDisabled = false }
    func forget() { deactivate(); CredentialStore.clear(); credential = nil; interrupted = false; message = nil }
    func addLocalAddress(_ text: String) {
        guard var credential, let url = URL(string: text), url.scheme == "https", url.host != nil, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, url.path.isEmpty || url.path == "/" else { message = "Saisissez une adresse HTTPS locale."; return }
        let endpoint = Endpoint(url: url, trust: "pinned")
        credential.endpoints.removeAll { $0 == endpoint }; credential.endpoints.insert(endpoint, at: 0)
        try? CredentialStore.save(credential); self.credential = credential
    }
    func image(_ path: String) async -> Data? {
        guard let endpoint, let session, let credential, let name = URL(string: path)?.lastPathComponent, name.hasSuffix(".webp"), !name.contains("..") else { return nil }
        let request = authorized(endpoint.url.appendingPathComponent("mobile/images/" + name), credential)
        guard let (data, response) = try? await session.data(for: request), (response as? HTTPURLResponse)?.statusCode == 200, data.count < 16_000_000 else { return nil }
        return data
    }
    private func closeNetwork() {
        connected = false; UIApplication.shared.isIdleTimerDisabled = false; generation = nil; heartbeat?.cancel(); audioReceiver?.cancel()
        events?.cancel(with: .normalClosure, reason: nil); audioSocket?.cancel(with: .normalClosure, reason: nil); cameraSocket?.cancel(with: .normalClosure, reason: nil)
        session?.invalidateAndCancel(); events = nil; audioSocket = nil; cameraSocket = nil; session = nil
        media.setCameraEnabled(false); media.clear()
    }
    private func authorized(_ url: URL, _ credential: Credential) -> URLRequest { var request = URLRequest(url: url); request.setValue("Bearer " + credential.token, forHTTPHeaderField: "Authorization"); return request }
    private func webSocketURL(_ base: URL, path: String) -> URL { var value = URLComponents(url: base.appendingPathComponent(path), resolvingAgainstBaseURL: false)!; value.scheme = "wss"; return value.url! }
    private static func requireSuccess(_ data: Data, _ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let error = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw MirrorError.message(error ?? "Le serveur a refusé la connexion.")
        }
    }
}
