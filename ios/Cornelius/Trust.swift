import Foundation
import Security
import CryptoKit

/// Pin the certificate's exact DER SubjectPublicKeyInfo, matching Node crypto.export({type:'spki'}).
/// Read the SPKI field from X.509 rather than hashing Security's PKCS#1 key representation.
enum CertificatePin {
    static func spki(_ certificate: Data) -> Data? {
        let bytes = [UInt8](certificate)
        func element(_ offset: Int) -> (tag: UInt8, body: Range<Int>, end: Int)? {
            guard offset >= 0, offset + 2 <= bytes.count else { return nil }
            var index = offset + 2, length = Int(bytes[offset + 1])
            if length & 128 != 0 {
                let count = length & 127
                guard count > 0, count <= 4, index + count <= bytes.count else { return nil }
                length = 0
                for byte in bytes[index..<(index + count)] { length = length * 256 + Int(byte) }
                index += count
            }
            guard index + length <= bytes.count else { return nil }
            return (bytes[offset], index..<(index + length), index + length)
        }
        guard let root = element(0), root.tag == 0x30, let tbs = element(root.body.lowerBound), tbs.tag == 0x30 else { return nil }
        var index = tbs.body.lowerBound
        if let version = element(index), version.tag == 0xa0 { index = version.end }
        // serial, signature algorithm, issuer, validity, subject, then SPKI.
        for _ in 0..<5 { guard let field = element(index), field.end <= tbs.body.upperBound else { return nil }; index = field.end }
        guard let key = element(index), key.tag == 0x30, key.end <= tbs.body.upperBound else { return nil }
        return Data(bytes[index..<key.end])
    }
    static func matches(_ certificate: Data, fingerprint: String) -> Bool {
        guard let key = spki(certificate) else { return false }
        let digest = SHA256.hash(data: key).map { String(format: "%02X", $0) }.joined()
        return digest == fingerprint.replacingOccurrences(of: ":", with: "").uppercased()
    }
}
final class PinnedSession: NSObject, URLSessionDelegate, URLSessionTaskDelegate {
    let endpoint: Endpoint; let fingerprint: String
    init(endpoint: Endpoint, fingerprint: String) { self.endpoint = endpoint; self.fingerprint = fingerprint }
    static func hostMatches(_ received: String, expected: String?) -> Bool {
        guard let expected else { return false }
        return received.caseInsensitiveCompare(expected) == .orderedSame
    }
    func urlSession(_ session: URLSession, didReceive challenge: URLAuthenticationChallenge, completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust, let trust = challenge.protectionSpace.serverTrust else { completionHandler(.performDefaultHandling, nil); return }
        guard Self.hostMatches(challenge.protectionSpace.host, expected: endpoint.url.host) else {
            completionHandler(.cancelAuthenticationChallenge, nil); return
        }
        if endpoint.trust == "system" { completionHandler(.performDefaultHandling, nil); return }
        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate], let certificate = chain.first,
              CertificatePin.matches(SecCertificateCopyData(certificate) as Data, fingerprint: fingerprint) else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        // The QR establishes the server key independently of its LAN hostname/DHCP address.
        // Keep certificate validity and signature checks; trust only this pinned leaf.
        SecTrustSetPolicies(trust, SecPolicyCreateBasicX509())
        SecTrustSetAnchorCertificates(trust, [certificate] as CFArray)
        SecTrustSetAnchorCertificatesOnly(trust, true)
        guard SecTrustEvaluateWithError(trust, nil) else { completionHandler(.cancelAuthenticationChallenge, nil); return }
        completionHandler(.useCredential, URLCredential(trust: trust))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        // Never forward a bearer token or invitation through a redirect.
        completionHandler(nil)
    }
    func session() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8; config.timeoutIntervalForResource = 15
        config.urlCache = nil; config.httpCookieStorage = nil; config.waitsForConnectivity = false
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }
}
enum CredentialStore {
    private static let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "solutions.pleiades.cornelius", kSecAttrAccount as String: "mirror"]
    static func load() -> Credential? {
        var request = query; request[kSecReturnData as String] = true
        var result: CFTypeRef?
        guard SecItemCopyMatching(request as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return try? JSONDecoder().decode(Credential.self, from: data)
    }
    static func save(_ value: Credential) throws {
        let data = try JSONEncoder().encode(value)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var request = query; request[kSecValueData as String] = data
            request[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            guard SecItemAdd(request as CFDictionary, nil) == errSecSuccess else { throw MirrorError.message("Impossible de mémoriser l’association dans le Trousseau.") }
        } else if status != errSecSuccess { throw MirrorError.message("Impossible de mettre à jour l’association.") }
    }
    static func clear() { SecItemDelete(query as CFDictionary) }
}
