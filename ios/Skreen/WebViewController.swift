import CoreLocation
import Network
import UIKit
import WebKit

/// The whole app: one full-screen web view showing the Skreen dashboard, plus the native abilities the page asks for
/// (Google sign-in, the Skreen+ purchase, photos, voice, timers' sound, brightness) through `window.SkreenNative`.
final class WebViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    private let liveURL = URL(string: "https://app.skreen.fyi/")!
    private var web: WKWebView!
    private let auth = GoogleAuth()
    private let purchases = Purchases()
    private let photos = PhotoStore()
    private let alarm = Alarm()
    private let voice = Voice()
    private let geocoder = CLGeocoder()
    private let monitor = NWPathMonitor()
    private var onFallback = false
    private var savedBrightness: CGFloat?

    override var prefersStatusBarHidden: Bool { true }
    override var prefersHomeIndicatorAutoHidden: Bool { true }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .all }

    override func viewDidLoad() {
        super.viewDidLoad()
        let ink = UIColor(red: 0.055, green: 0.051, blue: 0.043, alpha: 1)
        view.backgroundColor = ink

        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.setURLSchemeHandler(PhotoSchemeHandler(store: photos), forURLScheme: "skreen-photos")
        let controller = WKUserContentController()
        controller.add(WeakHandler(self), name: "skreen")
        controller.addUserScript(WKUserScript(source: Shim.script(initialState: state()), injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController = controller

        web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.isOpaque = false
        web.backgroundColor = ink
        web.scrollView.backgroundColor = ink
        web.scrollView.bounces = false
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.pinchGestureRecognizer?.isEnabled = false
        web.allowsLinkPreview = false
        web.navigationDelegate = self
        web.uiDelegate = self
        view.addSubview(web)

        UIApplication.shared.isIdleTimerDisabled = true   // a wall display never sleeps
        NotificationCenter.default.addObserver(self, selector: #selector(restoreBrightness), name: UIApplication.willResignActiveNotification, object: nil)

        auth.presentationWindowProvider = { [weak self] in self?.view.window }
        photos.onProgress = { [weak self] done, total, finished in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.push(["photos": self.photos.names])
                self.run(JS.call("window.skreenPhotos", [done, total, finished, self.photos.names.count]))
            }
        }
        Task { @MainActor in
            purchases.onChange = { [weak self] in
                guard let self = self else { return }
                self.push(["plus": self.purchases.json])
                self.run(JS.call("window.skreenPlus", [JS.literal(self.purchases.json)]))
            }
            purchases.start()
        }

        monitor.pathUpdateHandler = { [weak self] path in
            guard path.status == .satisfied else { return }
            DispatchQueue.main.async {
                guard let self = self, self.onFallback else { return }
                self.onFallback = false
                self.web.load(URLRequest(url: self.liveURL))
            }
        }
        monitor.start(queue: DispatchQueue(label: "skreen.network"))

        web.load(URLRequest(url: liveURL))
    }

    deinit { monitor.cancel() }

    // MARK: State the page reads synchronously

    private func state() -> [String: Any] {
        let info = Bundle.main.infoDictionary
        return [
            "accounts": auth.accounts,
            "plus": purchases.json,
            "photos": photos.names,
            "version": Int(info?["CFBundleVersion"] as? String ?? "0") ?? 0,
            "versionName": info?["CFBundleShortVersionString"] as? String ?? "",
        ]
    }

    /// Updates the page's copy of that state.
    private func push(_ patch: [String: Any]) {
        run("window.__skreenState && window.__skreenState(\(JS.literal(patch)))")
    }

    private func run(_ js: String) {
        DispatchQueue.main.async { self.web?.evaluateJavaScript(js, completionHandler: nil) }
    }

    // MARK: Messages from the page

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.host == "app.skreen.fyi" || message.frameInfo.request.url?.isFileURL == true,
              let body = message.body as? [String: Any], let name = body["m"] as? String else { return }
        let args = body["a"] as? [Any] ?? []
        func int(_ i: Int) -> Int { (args.indices.contains(i) ? (args[i] as? NSNumber)?.intValue : nil) ?? 0 }
        func dbl(_ i: Int) -> Double { (args.indices.contains(i) ? (args[i] as? NSNumber)?.doubleValue : nil) ?? 0 }
        func str(_ i: Int) -> String { (args.indices.contains(i) ? args[i] as? String : nil) ?? "" }

        switch name {
        case "setBrightness":
            let level = dbl(0)
            DispatchQueue.main.async {
                if level < 0 { self.restoreBrightness(); return }
                if self.savedBrightness == nil { self.savedBrightness = UIScreen.main.brightness }
                UIScreen.main.brightness = CGFloat(max(0.01, min(1, level)))
            }
        case "signIn":
            let id = int(0)
            Task { @MainActor in
                do {
                    let token = try await auth.signIn(from: view.window)
                    push(["accounts": auth.accounts])
                    deliver(id, token, nil)
                } catch let f as GoogleAuth.Failure { deliver(id, nil, f.code) } catch { deliver(id, nil, "auth_failed") }
            }
        case "getTokenFor":
            let id = int(0), account = str(1)
            Task { @MainActor in
                do { deliver(id, try await auth.token(for: account), nil) }
                catch let f as GoogleAuth.Failure { deliver(id, nil, f.code) } catch { deliver(id, nil, "network") }
            }
        case "clearToken": auth.clearToken(str(0))
        case "removeAccount": auth.remove(str(0)); push(["accounts": auth.accounts])
        case "signOut": auth.signOutAll(); push(["accounts": auth.accounts])
        case "reverseGeocode":
            let id = int(0), loc = CLLocation(latitude: dbl(1), longitude: dbl(2))
            geocoder.reverseGeocodeLocation(loc) { [weak self] marks, _ in
                var place: Any = NSNull()
                if let m = marks?.first {
                    place = ["city": orNull(m.locality ?? m.subAdministrativeArea), "region": orNull(m.administrativeArea), "country": orNull(m.isoCountryCode)]
                }
                self?.run("window.skreenPlace && window.skreenPlace(\(id),\(JS.literal(place)))")
            }
        case "openExternal":
            if let url = URL(string: str(0)), url.scheme == "https" { DispatchQueue.main.async { UIApplication.shared.open(url) } }
        case "buyPlus": Task { @MainActor in await purchases.buy() }
        case "restorePlus": Task { @MainActor in await purchases.restore() }
        case "pickPhotos": DispatchQueue.main.async { self.photos.present(from: self) }
        case "clearPhotos": photos.clear(); push(["photos": []])
        case "playAlarm": DispatchQueue.main.async { self.alarm.start() }
        case "stopAlarm": DispatchQueue.main.async { self.alarm.stop() }
        case "startVoice":
            DispatchQueue.main.async {
                self.voice.listen(from: self) { text in self.run(JS.call("window.skreenVoice", [text])) }
            }
        default: break
        }
    }

    private func deliver(_ id: Int, _ token: String?, _ error: String?) {
        run(JS.call("window.skreenToken", [id, token, error]))
    }

    @objc private func restoreBrightness() {
        if let b = savedBrightness { UIScreen.main.brightness = b; savedBrightness = nil }
    }

    // MARK: Navigation

    /// Only Skreen's own pages stay in the app; anything else opens in Safari.
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.isFileURL || url.scheme == "about" || url.scheme == "skreen-photos" || url.host == "app.skreen.fyi" {
            decisionHandler(.allow)
        } else {
            if url.scheme == "https" || url.scheme == "mailto" { UIApplication.shared.open(url) }
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https" { UIApplication.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fallBack() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fallBack() }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        // The page's process died (usually low memory). Start fresh.
        onFallback = false
        web.load(URLRequest(url: liveURL))
    }

    /// The live site couldn't be reached: show the copy inside the app until the network is back.
    private var bundledURL: URL? { Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "dashboard") }

    private func fallBack() {
        guard !onFallback, let page = bundledURL else { return }
        onFallback = true
        web.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }
}

private func orNull(_ value: String?) -> Any { if let v = value { return v }; return NSNull() }

/// WebKit holds its message handlers strongly; this keeps the view controller from being held in a loop.
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    private weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) { target?.userContentController(c, didReceive: message) }
}
