import XCTest
@testable import Cornelius

final class ProtocolTests: XCTestCase {
    func testPinnedHostComparisonAcceptsBonjourCapitalization() {
        XCTAssertTrue(PinnedSession.hostMatches("cornelius.local", expected: "Cornelius.local"))
        XCTAssertFalse(PinnedSession.hostMatches("other.local", expected: "Cornelius.local"))
        XCTAssertFalse(PinnedSession.hostMatches("cornelius.local", expected: nil))
    }
    func testInvitationRejectsExpiredAndUntrustedRemote() throws {
        let base: [String: Any] = ["protocol": 1, "serverId": UUID().uuidString, "keyFingerprint": String(repeating: "AB", count: 32), "endpoints": [["url": "https://mirror.local:3443", "trust": "pinned"]], "invitation": "example", "expiresAt": 301000]
        func link(_ value: [String: Any]) throws -> String { "cornelius://pair?data=" + (try JSONSerialization.data(withJSONObject: value)).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
        XCTAssertNoThrow(try Invitation.parse(link(base), now: 1000))
        XCTAssertThrowsError(try Invitation.parse(link(base), now: 301000))
        var unsafe=base; unsafe["endpoints"]=[["url":"https://example.com","trust":"system"]]
        XCTAssertThrowsError(try Invitation.parse(link(unsafe), now: 1000))
        unsafe=base; unsafe["endpoints"]=[["url":"http://mirror.local","trust":"pinned"]]
        XCTAssertThrowsError(try Invitation.parse(link(unsafe), now: 1000))
    }
    func testSharedServerSnapshotAndPrivateCardScope() throws {
        let url=try XCTUnwrap(Bundle.main.url(forResource: "mirror-fixture", withExtension: "json"))
        let event=try JSONDecoder().decode(Snapshot.self, from: Data(contentsOf: url))
        XCTAssertEqual(event.state.cards.count, 2)
        XCTAssertTrue(event.state.cards[0].visible(in: event.state, now: event.sentAt))
        XCTAssertFalse(event.state.cards[0].visible(in: event.state, now: event.state.cards[0].expiresAt))
        var freshness=Freshness()
        XCTAssertTrue(freshness.accept(event, at: Date(timeIntervalSince1970: event.sentAt / 1000)))
        XCTAssertFalse(freshness.fresh(at: Date(timeIntervalSince1970: event.sentAt / 1000 + 5)))
        XCTAssertEqual(event.state.ambient(now: event.sentAt).count, 1)
    }
    func testCertificatePinMatchesNodeSPKIAndRejectsOtherKeys() throws {
        let certificate = try Data(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "test-certificate", withExtension: "der")))
        let pin = try String(contentsOf: XCTUnwrap(Bundle.main.url(forResource: "test-certificate-pin", withExtension: "txt")), encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines)
        XCTAssertTrue(CertificatePin.matches(certificate, fingerprint: pin))
        XCTAssertFalse(CertificatePin.matches(certificate, fingerprint: String(repeating: "00", count: 32)))
        for length in 0..<min(certificate.count, 128) { XCTAssertNil(CertificatePin.spki(certificate.prefix(length))) }
    }
    func testNativeTLSAssociationAndWebSocketContract() async throws {
        let bootstrap = URL(string: "http://localhost:19444/fixture")!
        var probe = URLRequest(url: bootstrap); probe.timeoutInterval = 1
        let data: Data
        do { (data, _) = try await URLSession.shared.data(for: probe) }
        catch { throw XCTSkip("Launch scripts/test-ios.sh to include the real local TLS fixture.") }
        let invitation = try JSONDecoder().decode(Invitation.self, from: data)
        let endpoint = Endpoint(url: URL(string: "https://localhost:19443")!, trust: "pinned")
        let session = PinnedSession(endpoint: endpoint, fingerprint: invitation.keyFingerprint).session()
        defer { session.invalidateAndCancel() }
        let (_, unauthorized) = try await session.data(from: endpoint.url.appendingPathComponent("mobile/info"))
        XCTAssertEqual((unauthorized as? HTTPURLResponse)?.statusCode, 401)
        var pair = URLRequest(url: endpoint.url.appendingPathComponent("mobile/pair"))
        pair.httpMethod="POST"; pair.setValue("application/json", forHTTPHeaderField: "Content-Type")
        pair.httpBody = try JSONSerialization.data(withJSONObject: ["invitation": invitation.invitation, "name": "Simulator contract"])
        let (paired, response) = try await session.data(for: pair)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        let credential = try JSONDecoder().decode(PairResponse.self, from: paired)
        XCTAssertEqual(credential.serverId, invitation.serverId)
        var request = URLRequest(url: endpoint.url.appendingPathComponent("mobile/info"))
        request.setValue("Bearer " + credential.token, forHTTPHeaderField: "Authorization")
        let (_, authorized) = try await session.data(for: request)
        XCTAssertEqual((authorized as? HTTPURLResponse)?.statusCode, 200)
        let (_, replayed) = try await session.data(for: pair)
        XCTAssertEqual((replayed as? HTTPURLResponse)?.statusCode, 403)
        let wrong = PinnedSession(endpoint: endpoint, fingerprint: String(repeating: "00", count: 32)).session()
        defer { wrong.invalidateAndCancel() }
        do { _ = try await wrong.data(for: request); XCTFail("An unknown server key must never be accepted") } catch { }
        var events = URLRequest(url: URL(string: "wss://localhost:19443/mobile/events")!)
        events.setValue("Bearer " + credential.token, forHTTPHeaderField: "Authorization")
        let socket=session.webSocketTask(with: events); socket.resume()
        defer { socket.cancel(with: .normalClosure, reason: nil) }
        guard case .string(let hello) = try await socket.receive(), let helloData=hello.data(using: .utf8) else { return XCTFail("Mobile hello expected") }
        let value=try JSONDecoder().decode(MobileHello.self, from: helloData)
        XCTAssertEqual(value.serverId, invitation.serverId); XCTAssertNotNil(UUID(uuidString: value.generation))
    }
    func testPinParserRejectsTruncation() {
        for data in [Data(), Data([0x30,0x80]), Data([0x30,0xff,1,2,3]), Data(repeating: 0, count: 128)] { XCTAssertNil(CertificatePin.spki(data)) }
    }
}
