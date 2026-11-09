import AVFoundation
import Speech
import UIKit

/// Tap the microphone button: a small "Listening" sheet appears, the words are turned into text, and the page gets them.
/// The microphone is on only while that sheet is showing.
final class Voice {
    private let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer()
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var best = ""
    private var finished = false
    private var onDone: ((String) -> Void)?
    private weak var sheet: UIAlertController?

    func listen(from controller: UIViewController, done: @escaping (String) -> Void) {
        onDone = done
        finished = false
        SFSpeechRecognizer.requestAuthorization { status in
            DispatchQueue.main.async {
                guard status == .authorized else { self.finish(""); return }
                AVAudioSession.sharedInstance().requestRecordPermission { granted in
                    DispatchQueue.main.async { granted ? self.begin(controller) : self.finish("") }
                }
            }
        }
    }

    private func begin(_ controller: UIViewController) {
        guard let recognizer = recognizer, recognizer.isAvailable else { finish(""); return }
        best = ""
        finished = false
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.record, mode: .measurement, options: [.duckOthers])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
        } catch { finish(""); return }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        request = req
        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { buffer, _ in req.append(buffer) }
        engine.prepare()
        do { try engine.start() } catch { finish(""); return }

        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self = self else { return }
            if let result = result {
                self.best = result.bestTranscription.formattedString
                if result.isFinal { DispatchQueue.main.async { self.finish(self.best) } }
            }
            if error != nil { DispatchQueue.main.async { self.finish(self.best) } }
        }

        let alert = UIAlertController(title: "Listening\u{2026}", message: "Say what to add.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "Cancel", style: .cancel) { [weak self] _ in self?.finish("") })
        alert.addAction(UIAlertAction(title: "Done", style: .default) { [weak self] _ in
            guard let self = self else { return }
            self.request?.endAudio()
            // Give the recognizer a moment to settle on its final words.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { self.finish(self.best) }
        })
        sheet = alert
        controller.present(alert, animated: true)
        // Stop by itself after a pause in speech or 20 seconds, whichever comes first.
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            guard let self = self, !self.finished else { return }
            self.finish(self.best)
        }
    }

    private func finish(_ text: String) {
        guard !finished else { return }
        finished = true
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        sheet?.dismiss(animated: true)
        let cb = onDone
        onDone = nil
        cb?(text)
    }
}
