import Foundation

final class Discovery: NSObject, ObservableObject, NetServiceBrowserDelegate, NetServiceDelegate {
    @Published var servers: [String: URL] = [:]
    @Published var error: String?
    @Published var identifiedServers: [String: URL] = [:]
    private var started = false
    private let browser = NetServiceBrowser()
    private var services: [NetService] = []
    override init() { super.init(); browser.delegate = self }
    func start() { guard !started else { return }; started = true; browser.searchForServices(ofType: "_cornelius._tcp.", inDomain: "local.") }
    func stop() { started = false; browser.stop(); services.forEach { $0.stop() }; services = [] }
    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) { services.append(service); service.delegate = self; service.resolve(withTimeout: 5) }
    func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) { servers.removeValue(forKey: service.name); services.removeAll { $0 == service } }
    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let txt = sender.txtRecordData(), let mobile = NetService.dictionary(fromTXTRecord: txt)["mobile"], String(data: mobile, encoding: .utf8) == "1", let host = sender.hostName, sender.port > 0 else { return }
        let url = URL(string: "https://\(host.trimmingCharacters(in: CharacterSet(charactersIn: "."))):\(sender.port)")
        servers[sender.name] = url
        if let id = NetService.dictionary(fromTXTRecord: txt)["serverId"].flatMap({ String(data: $0, encoding: .utf8) }), UUID(uuidString: id) != nil { identifiedServers[id] = url }
    }
    func netServiceBrowser(_ browser: NetServiceBrowser, didNotSearch errorDict: [String: NSNumber]) { error = "Découverte locale indisponible. Autorisez le réseau local dans Réglages, ou utilisez le QR code. Les Wi-Fi invités peuvent isoler les appareils." }
}
