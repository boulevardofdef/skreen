import AVFoundation
import Foundation

/// The sound of a finished timer: a repeating three-beep chime, made here (iPads let apps use only their own sounds),
/// played so it is heard even with the side switch set to silent.
final class Alarm {
    private var player: AVAudioPlayer?

    func start() {
        stop()
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        guard let p = try? AVAudioPlayer(data: Alarm.chime()) else { return }
        p.numberOfLoops = -1
        p.volume = 1
        p.play()
        player = p
    }

    func stop() {
        player?.stop()
        player = nil
    }

    /// 16-bit mono WAV: three short 880 Hz beeps, then a pause.
    private static func chime() -> Data {
        let rate = 22050
        var samples = [Int16]()
        func tone(_ ms: Int) {
            let n = rate * ms / 1000
            for i in 0..<n {
                let fade = min(1, Double(min(i, n - i)) / Double(rate / 200))
                samples.append(Int16(sin(2 * Double.pi * 880 * Double(i) / Double(rate)) * 0.6 * fade * 32767))
            }
        }
        func silence(_ ms: Int) { samples.append(contentsOf: [Int16](repeating: 0, count: rate * ms / 1000)) }
        for _ in 0..<3 { tone(160); silence(120) }
        silence(900)
        var data = Data()
        func put32(_ v: UInt32) { var x = v.littleEndian; data.append(Data(bytes: &x, count: 4)) }
        func put16(_ v: UInt16) { var x = v.littleEndian; data.append(Data(bytes: &x, count: 2)) }
        let bytes = UInt32(samples.count * 2)
        data.append("RIFF".data(using: .ascii)!); put32(36 + bytes); data.append("WAVEfmt ".data(using: .ascii)!)
        put32(16); put16(1); put16(1); put32(UInt32(rate)); put32(UInt32(rate * 2)); put16(2); put16(16)
        data.append("data".data(using: .ascii)!); put32(bytes)
        for s in samples { put16(UInt16(bitPattern: s)) }
        return data
    }
}
