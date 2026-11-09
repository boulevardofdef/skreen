import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

/// Sign-in with Google, without Google's SDK: the standard OAuth "installed app" flow with PKCE, in the system's
/// secure sign-in sheet. Several accounts can be signed in at once. Each account's refresh token is kept in the
/// Keychain; short-lived access tokens are kept in memory and renewed when they run out.
/// What Skreen asks for is the same as on Android: read the calendars, and manage tasks.
final class GoogleAuth: NSObject, ASWebAuthenticationPresentationContextProviding {
    struct Failure: Error { let code: String }

    private let scopes = [
        "openid", "email",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/tasks",
    ]
    private let defaults = UserDefaults.standard
    private let accountsKey = "google.accounts"
    private var cache: [String: (token: String, expires: Date)] = [:]
    private var session: ASWebAuthenticationSession?
    private weak var anchor: UIWindow?
    /// Set by the screen, so the sign-in sheet knows which window to appear over.
    var presentationWindowProvider: (() -> UIWindow?)?

    /// The client ID created for the iOS app in Google Cloud Console (set in the build, never a secret).
    private var clientID: String {
        (Bundle.main.object(forInfoDictionaryKey: "GoogleClientID") as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
    }
    /// Google's redirect address for an iOS client is the client ID written backwards.
    private var redirectScheme: String {
        "com.googleusercontent.apps." + clientID.replacingOccurrences(of: ".apps.googleusercontent.com", with: "")
    }

    var accounts: [String] { defaults.stringArray(forKey: accountsKey) ?? [] }
    private func saveAccounts(_ list: [String]) { defaults.set(list, forKey: accountsKey) }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        anchor ?? presentationWindowProvider?() ?? ASPresentationAnchor()
    }

    // MARK: Sign in

    /// Shows Google's sign-in and consent. Returns an access token, and remembers the account.
    @MainActor
    func signIn(from window: UIWindow?) async throws -> String {
        guard !clientID.isEmpty else { throw Failure(code: "not_configured") }
        anchor = window
        let verifier = Self.randomString(64)
        let challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = Self.randomString(24)
        var comps = URLComponents(string: "https://accounts.google.com/o/oauth2/v2/auth")!
        comps.queryItems = [
            .init(name: "client_id", value: clientID),
            .init(name: "redirect_uri", value: redirectScheme + ":/oauth2redirect"),
            .init(name: "response_type", value: "code"),
            .init(name: "scope", value: scopes.joined(separator: " ")),
            .init(name: "code_challenge", value: challenge),
            .init(name: "code_challenge_method", value: "S256"),
            .init(name: "state", value: state),
            .init(name: "access_type", value: "offline"),
            .init(name: "prompt", value: "select_account consent"),
        ]
        let callback: URL = try await withCheckedThrowingContinuation { cont in
            let s = ASWebAuthenticationSession(url: comps.url!, callbackURLScheme: redirectScheme) { url, error in
                if let url = url { cont.resume(returning: url) } else { cont.resume(throwing: Failure(code: "cancelled")) }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            self.session = s
            if !s.start() { cont.resume(throwing: Failure(code: "could_not_start")) }
        }
        session = nil
        let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
        guard items.first(where: { $0.name == "state" })?.value == state,
              let code = items.first(where: { $0.name == "code" })?.value else { throw Failure(code: "auth_failed") }
        let granted = items.first(where: { $0.name == "scope" })?.value ?? ""
        guard granted.contains("calendar.readonly"), granted.contains("auth/tasks") else { throw Failure(code: "scope_missing") }

        let reply = try await tokenRequest([
            "client_id": clientID, "code": code, "code_verifier": verifier,
            "grant_type": "authorization_code", "redirect_uri": redirectScheme + ":/oauth2redirect",
        ])
        guard let access = reply["access_token"] as? String, let refresh = reply["refresh_token"] as? String,
              let idToken = reply["id_token"] as? String, let email = Self.email(fromIDToken: idToken) else { throw Failure(code: "auth_failed") }
        Keychain.set(refresh, for: email)
        var list = accounts
        if !list.contains(email) { list.append(email); saveAccounts(list) }
        cache[email] = (access, Date().addingTimeInterval(((reply["expires_in"] as? Double) ?? 3600) - 120))
        return access
    }

    // MARK: Tokens

    /// A working access token for the account (the first one when `account` is empty), renewed silently when needed.
    func token(for account: String) async throws -> String {
        let list = accounts
        let name = account.isEmpty ? (list.first ?? "") : account
        guard !name.isEmpty, list.contains(name) else { throw Failure(code: "no_account") }
        if let hit = cache[name], hit.expires > Date() { return hit.token }
        guard let refresh = Keychain.get(name) else { throw Failure(code: "consent_needed") }
        do {
            let reply = try await tokenRequest(["client_id": clientID, "refresh_token": refresh, "grant_type": "refresh_token"])
            guard let access = reply["access_token"] as? String else { throw Failure(code: "auth_failed") }
            cache[name] = (access, Date().addingTimeInterval(((reply["expires_in"] as? Double) ?? 3600) - 120))
            return access
        } catch let f as Failure where f.code == "invalid_grant" {
            // Access was taken away in the Google account: the next sign-in will ask again.
            Keychain.remove(name)
            throw Failure(code: "consent_needed")
        }
    }

    /// Google said a token is dead: forget it so the next request gets a fresh one.
    func clearToken(_ account: String) {
        if account.isEmpty { cache.removeAll() } else { cache[account] = nil }
    }

    func remove(_ account: String) {
        cache[account] = nil
        Keychain.remove(account)
        saveAccounts(accounts.filter { $0 != account })
    }

    func signOutAll() {
        for a in accounts { Keychain.remove(a) }
        cache.removeAll()
        saveAccounts([])
    }

    // MARK: Plumbing

    private func tokenRequest(_ form: [String: String]) async throws -> [String: Any] {
        var req = URLRequest(url: URL(string: "https://oauth2.googleapis.com/token")!)
        req.httpMethod = "POST"
        req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
        var allowed = CharacterSet.urlQueryAllowed
        allowed.remove(charactersIn: "+&=")
        req.httpBody = form.map { k, v in "\(k)=\(v.addingPercentEncoding(withAllowedCharacters: allowed) ?? v)" }.joined(separator: "&").data(using: .utf8)
        let (data, response) = try await URLSession.shared.data(for: req)
        let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] ?? [:]
        if let status = (response as? HTTPURLResponse)?.statusCode, status >= 400 {
            throw Failure(code: (json["error"] as? String) ?? "http_\(status)")
        }
        return json
    }

    private static func randomString(_ n: Int) -> String {
        var bytes = [UInt8](repeating: 0, count: n)
        _ = SecRandomCopyBytes(kSecRandomDefault, n, &bytes)
        return String(base64url(Data(bytes)).prefix(n))
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }

    /// The email address inside Google's ID token (read here, not verified: it only labels the account).
    private static func email(fromIDToken token: String) -> String? {
        let parts = token.split(separator: ".")
        guard parts.count > 1 else { return nil }
        var b64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let data = Data(base64Encoded: b64),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return (obj["email"] as? String)?.lowercased()
    }
}
