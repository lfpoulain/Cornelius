import Foundation
import UIKit

@MainActor final class Discovery: NSObject, ObservableObject, NetServiceBrowserDelegate, NetServiceDelegate {
    struct Server: Hashable {
        let name: String
        let url: URL
        let serverId: String
        let fingerprint: String
    }
    @Published var candidates: [String: Server] = [:]
    @Published var servers: [String: URL] = [:]
    @Published var error: String?
    @Published var identifiedServers: [String: URL] = [:]
    private var browser: NetServiceBrowser?
    private var services: [ObjectIdentifier: NetService] = [:]
    private var wanted = false
    private var retrySeconds: UInt64 = 1
    private var restartTask: Task<Void, Never>?
    private var activeObserver: NSObjectProtocol?
    func start() {
        guard !wanted else { return }
        wanted = true
        activeObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.scheduleRestart(after: .milliseconds(150)) }
        }
        restart()
    }
    func stop() {
        wanted = false; restartTask?.cancel(); restartTask = nil
        browser?.stop(); browser = nil
        services.values.forEach { $0.stop() }; services.removeAll()
        if let activeObserver { NotificationCenter.default.removeObserver(activeObserver) }
        activeObserver = nil
    }
    private func scheduleRestart(after delay: Duration) {
        guard wanted else { return }
        restartTask?.cancel()
        restartTask = Task { [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled else { return }
            self?.restart()
        }
    }
    private func restart() {
        guard wanted else { return }
        restartTask?.cancel(); restartTask = nil
        browser?.stop(); services.values.forEach { $0.stop() }; services.removeAll(); error = nil
        let next = NetServiceBrowser(); next.delegate = self; browser = next
        next.searchForServices(ofType: "_cornelius._tcp.", inDomain: "local.")
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        guard browser === self.browser else { return }
        retrySeconds = 1
        // Resolve every result immediately and independently instead of waiting for the previous one.
        services[ObjectIdentifier(service)] = service; service.delegate = self; service.resolve(withTimeout: 3)
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        guard browser === self.browser else { return }
        servers.removeValue(forKey: service.name); candidates.removeValue(forKey: service.name); services.removeValue(forKey: ObjectIdentifier(service))
    }
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard services[ObjectIdentifier(sender)] === sender, let txt = sender.txtRecordData(), let mobile = NetService.dictionary(fromTXTRecord: txt)["mobile"], String(data: mobile, encoding: .utf8) == "1", let host = sender.hostName, sender.port > 0 else { return }
        let url = URL(string: "https://\(host.trimmingCharacters(in: CharacterSet(charactersIn: "."))):\(sender.port)")
        servers[sender.name] = url
        if let id = NetService.dictionary(fromTXTRecord: txt)["serverId"].flatMap({ String(data: $0, encoding: .utf8) }), UUID(uuidString: id) != nil { identifiedServers[id] = url
            if let url, let key = NetService.dictionary(fromTXTRecord: txt)["key"].flatMap({ String(data: $0, encoding: .utf8) }), key.replacingOccurrences(of: ":", with: "").count == 64 {
                candidates[sender.name] = Server(name: sender.name, url: url, serverId: id, fingerprint: key)
            }
        }
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) {
        guard browser === self.browser else { return }
        error = "Découverte locale indisponible. Autorisez le réseau local dans Réglages, ou utilisez le QR code. Les Wi-Fi invités peuvent isoler les appareils."
        // The permission sheet can interrupt the initial browse. Retry here and as soon as the app becomes active.
        scheduleRestart(after: .seconds(retrySeconds))
        retrySeconds = min(retrySeconds * 2, 8)
    }
}
