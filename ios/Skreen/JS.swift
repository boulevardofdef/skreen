import Foundation

/// Small helpers for talking to the web page.
enum JS {
    /// A Swift value as a JavaScript literal (a quoted string, a number, null, an object).
    static func literal(_ value: Any?) -> String {
        guard let value = value, !(value is NSNull) else { return "null" }
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]),
           let text = String(data: data, encoding: .utf8) {
            return text
        }
        return "null"
    }

    /// The same, for building a call: `JS.call("window.skreenVoice", ["hello"])`.
    static func call(_ function: String, _ args: [Any?]) -> String {
        "\(function) && \(function)(\(args.map { literal($0) }.joined(separator: ",")))"
    }
}

/// The script that gives the page its `window.SkreenNative`, the same name and methods the Android app offers.
/// WebKit can't answer a page synchronously, so values the page reads (accounts, Skreen+ status, photo names)
/// live in `state`, which the app refreshes whenever they change. Everything else is posted to the app.
enum Shim {
    static func script(initialState: [String: Any]) -> String {
        """
        (function () {
          if (window.SkreenNative) return;
          var state = \(JS.literal(initialState));
          var post = function (m, a) { try { window.webkit.messageHandlers.skreen.postMessage({ m: m, a: a || [] }); } catch (e) {} };
          window.__skreenState = function (patch) { for (var k in patch) state[k] = patch[k]; };
          window.SkreenNative = {
            platform: 'ios',
            photoBase: 'skreen-photos://local/',
            setBrightness: function (l) { post('setBrightness', [l]); },
            signIn: function (id) { post('signIn', [id]); },
            getToken: function (id) { post('getTokenFor', [id, '']); },
            getTokenFor: function (id, account) { post('getTokenFor', [id, account || '']); },
            getAccounts: function () { return JSON.stringify(state.accounts || []); },
            getAccount: function () { return (state.accounts || [])[0] || ''; },
            removeAccount: function (a) { state.accounts = (state.accounts || []).filter(function (x) { return x !== a; }); post('removeAccount', [a]); },
            clearToken: function (a) { post('clearToken', [a || '']); },
            signOut: function () { state.accounts = []; post('signOut', []); },
            reverseGeocode: function (id, lat, lon) { post('reverseGeocode', [id, lat, lon]); },
            getVersion: function () { return state.version || 0; },
            getVersionName: function () { return state.versionName || ''; },
            isStoreBuild: function () { return true; },
            openExternal: function (u) { post('openExternal', [u]); },
            getPlus: function () { return JSON.stringify(state.plus || {}); },
            buyPlus: function () { post('buyPlus', []); },
            restorePlus: function () { post('restorePlus', []); },
            pickPhotos: function () { post('pickPhotos', []); },
            listPhotos: function () { return JSON.stringify(state.photos || []); },
            clearPhotos: function () { state.photos = []; post('clearPhotos', []); },
            playAlarm: function () { post('playAlarm', []); },
            stopAlarm: function () { post('stopAlarm', []); },
            startVoice: function () { post('startVoice', []); }
          };
        })();
        """
    }
}
