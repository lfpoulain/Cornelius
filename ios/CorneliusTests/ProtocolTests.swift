import XCTest
@testable import Cornelius

final class ProtocolTests: XCTestCase {
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
    func testPinParserRejectsTruncation() {
        for data in [Data(), Data([0x30,0x80]), Data([0x30,0xff,1,2,3]), Data(repeating: 0, count: 128)] { XCTAssertNil(CertificatePin.spki(data)) }
    }
}
