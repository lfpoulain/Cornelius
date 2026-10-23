import AVFoundation
import CoreImage
import UIKit

/// No WebRTC SDK: echo-cancelled PCM and bounded JPEGs go to the home's Cornelius server.
final class MirrorMedia: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    var audio: ((Data, Float) -> Void)?
    var image: ((Data) -> Void)?
    var interruption: (() -> Void)?
    private var engine: AVAudioEngine?
    private let player = AVAudioPlayerNode()
    private let session = AVCaptureSession()
    private let captureQueue = DispatchQueue(label: "cornelius.camera", qos: .userInitiated)
    private let audioQueue = DispatchQueue(label: "cornelius.audio", qos: .userInteractive)
    private let context = CIContext(options: [.cacheIntermediates: false])
    private let lock = NSLock()
    private var queuedSamples = 0
    private var lastFrame: CFTimeInterval = 0
    private var detailed = false
    private var running = false
    private var preparedCamera = false
    private var observer: NSObjectProtocol?
    override init() {
        super.init()
        observer = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            if let type = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, type == AVAudioSession.InterruptionType.began.rawValue { self?.interruption?() }
        }
    }
    deinit { if let observer { NotificationCenter.default.removeObserver(observer) } }
    @MainActor func prepare() async throws {
        if engine != nil { return }
        let mic = await AVAudioApplication.requestRecordPermission()
        guard mic else { throw MirrorError.message("Microphone refusé. Autorisez-le dans Réglages → Cornelius.") }
        let camera = await AVCaptureDevice.requestAccess(for: .video)
        guard camera else { throw MirrorError.message("Caméra refusée. Autorisez-la dans Réglages → Cornelius pour utiliser le miroir complet.") }
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try audioSession.setPreferredSampleRate(48000)
        try audioSession.setPreferredIOBufferDuration(0.02)
        try audioSession.setActive(true)
        let engine = AVAudioEngine()
        try engine.inputNode.setVoiceProcessingEnabled(true)
        let input = engine.inputNode.outputFormat(forBus: 0)
        guard let pcm = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true), let converter = AVAudioConverter(from: input, to: pcm) else { throw MirrorError.message("Format audio indisponible.") }
        var pending = Data()
        engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: input) { [weak self] buffer, _ in
            guard let self else { return }
            let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 16000 / input.sampleRate) + 8)
            guard let output = AVAudioPCMBuffer(pcmFormat: pcm, frameCapacity: capacity) else { return }
            var supplied = false
            var error: NSError?
            converter.convert(to: output, error: &error) { _, status in
                if supplied { status.pointee = .noDataNow; return nil }
                supplied = true; status.pointee = .haveData; return buffer
            }
            guard error == nil, let channel = output.int16ChannelData?[0] else { return }
            let count = Int(output.frameLength)
            pending.append(Data(bytes: channel, count: count * 2))
            var energy: Float = 0
            for i in 0..<count { let sample = Float(channel[i]) / 32768; energy += sample * sample }
            let level = count > 0 ? sqrt(energy / Float(count)) : 0
            while pending.count >= 2560 {
                let frame = Data(pending.prefix(2560)); pending.removeFirst(2560)
                self.audio?(frame, level)
            }
            if pending.count > 5120 { pending.removeAll(keepingCapacity: true) }
        }
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1))
        try engine.start(); player.play()
        self.engine = engine; running = true
    }
    func setCameraEnabled(_ enabled: Bool) {
        captureQueue.async { [weak self] in
            guard let self else { return }
            if enabled {
                do {
                    if !self.preparedCamera {
                        self.session.automaticallyConfiguresApplicationAudioSession = false
                        self.session.beginConfiguration(); defer { self.session.commitConfiguration() }
                        self.session.sessionPreset = .hd1280x720
                        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front) else { return }
                        let input = try AVCaptureDeviceInput(device: device)
                        guard self.session.canAddInput(input) else { return }
                        self.session.addInput(input)
                        let output = AVCaptureVideoDataOutput()
                        output.alwaysDiscardsLateVideoFrames = true
                        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
                        output.setSampleBufferDelegate(self, queue: self.captureQueue)
                        guard self.session.canAddOutput(output) else { return }
                        self.session.addOutput(output)
                        if let connection = output.connection(with: .video) {
                            if connection.isVideoRotationAngleSupported(90) { connection.videoRotationAngle = 90 }
                            if connection.isVideoMirroringSupported { connection.automaticallyAdjustsVideoMirroring = false; connection.isVideoMirrored = false }
                        }
                        self.preparedCamera = true
                    }
                    if !self.session.isRunning { self.session.startRunning() }
                } catch { DispatchQueue.main.async { self.interruption?() } }
            } else if self.session.isRunning { self.session.stopRunning() }
        }
    }
    func detailedSnapshot() { captureQueue.async { self.detailed = true } }
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let now = CACurrentMediaTime()
        guard now - lastFrame >= 0.2, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        lastFrame = now
        let original = CIImage(cvPixelBuffer: buffer)
        let longest: CGFloat = detailed ? 1280 : 640
        detailed = false
        let scale = min(1, longest / max(original.extent.width, original.extent.height))
        let scaled = original.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let color = CGColorSpace(name: CGColorSpace.sRGB), let data = context.jpegRepresentation(of: scaled, colorSpace: color, options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: 0.65]), data.count < 240000 else { return }
        image?(data)
    }
    func play(_ data: Data) -> Float {
        guard running, data.count % 2 == 0, data.count <= 192000, let format = AVAudioFormat(standardFormatWithSampleRate: 16000, channels: 1), let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(data.count / 2)), let samples = buffer.floatChannelData?[0] else { return 0 }
        let count = data.count / 2
        lock.lock(); let allowed = queuedSamples + count <= 16000; if allowed { queuedSamples += count }; lock.unlock()
        guard allowed else { clear(); return 0 }
        var energy: Float = 0
        data.withUnsafeBytes { bytes in
            for i in 0..<count {
                let low = UInt16(bytes[i * 2]), high = UInt16(bytes[i * 2 + 1]) << 8
                let value = Float(Int16(bitPattern: low | high)) / 32768
                samples[i] = value; energy += value * value
            }
        }
        buffer.frameLength = AVAudioFrameCount(count)
        player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self else { return }; self.lock.lock(); self.queuedSamples = max(0, self.queuedSamples - count); self.lock.unlock()
        }
        return count > 0 ? sqrt(energy / Float(count)) : 0
    }
    func clear() { player.stop(); lock.lock(); queuedSamples = 0; lock.unlock(); if running { player.play() } }
    func stop() {
        running = false; setCameraEnabled(false)
        engine?.inputNode.removeTap(onBus: 0); engine?.stop(); engine?.detach(player); engine = nil
        player.stop(); lock.lock(); queuedSamples = 0; lock.unlock()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
