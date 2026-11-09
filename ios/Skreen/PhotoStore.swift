import Foundation
import PhotosUI
import UIKit
import WebKit

/// Pictures chosen for the slideshow are shrunk and kept in the app's own storage, and shown to the page through
/// the `skreen-photos://` address.
final class PhotoStore: NSObject, PHPickerViewControllerDelegate {
    static let maxPhotos = 300
    static let longSide: CGFloat = 2048

    let directory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("photos", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

    var onProgress: ((_ done: Int, _ total: Int, _ finished: Bool) -> Void)?

    var names: [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: directory.path)) ?? []).filter { $0.hasSuffix(".jpg") }.sorted()
    }

    func clear() {
        for n in names { try? FileManager.default.removeItem(at: directory.appendingPathComponent(n)) }
    }

    func present(from controller: UIViewController) {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.filter = .images
        config.selectionLimit = 100
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        controller.present(picker, animated: true)
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else { onProgress?(0, 0, true); return }
        let total = results.count
        Task.detached { [weak self] in
            guard let self = self else { return }
            var done = 0
            for r in results {
                if self.names.count >= PhotoStore.maxPhotos { break }
                if let data = await PhotoStore.loadData(r.itemProvider), let image = UIImage(data: data) { self.save(image) }
                done += 1
                self.onProgress?(done, total, false)
            }
            self.onProgress?(done, total, true)
        }
    }

    private static func loadData(_ provider: NSItemProvider) async -> Data? {
        await withCheckedContinuation { cont in
            provider.loadDataRepresentation(forTypeIdentifier: "public.image") { data, _ in cont.resume(returning: data) }
        }
    }

    /// Scales to at most 2048 pixels on the long side, upright, and stores a JPEG.
    private func save(_ image: UIImage) {
        let size = image.size
        let scale = min(1, PhotoStore.longSide / max(size.width, size.height))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let out = UIGraphicsImageRenderer(size: target, format: format).jpegData(withCompressionQuality: 0.85) { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        let name = "p\(Int(Date().timeIntervalSince1970 * 1000))_\(Int.random(in: 0..<100000)).jpg"
        try? out.write(to: directory.appendingPathComponent(name))
    }
}

/// Serves the saved pictures to the page: skreen-photos://local/<file name>.
final class PhotoSchemeHandler: NSObject, WKURLSchemeHandler {
    private let store: PhotoStore
    init(store: PhotoStore) { self.store = store }

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        let name = urlSchemeTask.request.url?.lastPathComponent ?? ""
        let file = store.directory.appendingPathComponent(name)
        guard name.hasSuffix(".jpg"), !name.contains("/"), let data = try? Data(contentsOf: file) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let response = HTTPURLResponse(url: urlSchemeTask.request.url!, statusCode: 200, httpVersion: "HTTP/1.1",
                                       headerFields: ["Content-Type": "image/jpeg", "Content-Length": "\(data.count)", "Access-Control-Allow-Origin": "*"])!
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}
