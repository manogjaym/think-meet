import AVFoundation
import CoreMedia
import Foundation
import LiveKit
import ReplayKit

/// Mono 48 kHz PCM from one LiveKit source, bounded so a stalled writer never grows memory.
private final class PcmRing: @unchecked Sendable {
    static let rate = 48_000.0
    private let lock = NSLock()
    private var samples: [Int16] = []
    private var phase = 0.0
    private let capacity = 48_000

    func write(_ buffer: AVAudioPCMBuffer) {
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        guard frames > 0, channels > 0 else { return }
        var mono = [Float](repeating: 0, count: frames)
        if let data = buffer.floatChannelData {
            let interleaved = buffer.format.isInterleaved
            for frame in 0..<frames {
                var sum: Float = 0
                for channel in 0..<channels { sum += interleaved ? data[0][frame * channels + channel] : data[channel][frame] }
                mono[frame] = sum / Float(channels)
            }
        } else if let data = buffer.int16ChannelData {
            let interleaved = buffer.format.isInterleaved
            for frame in 0..<frames {
                var sum: Float = 0
                for channel in 0..<channels { sum += Float(interleaved ? data[0][frame * channels + channel] : data[channel][frame]) / 32768 }
                mono[frame] = sum / Float(channels)
            }
        } else { return }
        let step = buffer.format.sampleRate / PcmRing.rate
        lock.lock(); defer { lock.unlock() }
        if abs(step - 1) < 0.0001 {
            for value in mono { push(value) }
            return
        }
        var position = phase
        while position < Double(frames - 1) {
            let index = Int(position), fraction = Float(position - Double(index))
            push(mono[index] * (1 - fraction) + mono[index + 1] * fraction)
            position += step
        }
        phase = max(0, position - Double(frames - 1))
    }

    private func push(_ value: Float) {
        if samples.count >= capacity { samples.removeFirst(samples.count - capacity + 1) }
        samples.append(Int16(max(-1, min(1, value)) * 32767))
    }

    /// Adds up to `count` samples into `target` and keeps at most `maxLatency` buffered afterwards.
    func mix(into target: inout [Int32], count: Int, maxLatency: Int) {
        lock.lock(); defer { lock.unlock() }
        let taken = min(count, samples.count)
        for index in 0..<taken { target[index] += Int32(samples[index]) }
        samples.removeFirst(taken)
        if samples.count > maxLatency { samples.removeFirst(samples.count - maxLatency) }
    }

    func clear() { lock.lock(); samples.removeAll(); phase = 0; lock.unlock() }
}

private final class PcmTap: NSObject, AudioRenderer, @unchecked Sendable {
    let ring = PcmRing()
    func render(pcmBuffer: AVAudioPCMBuffer) { ring.write(pcmBuffer) }
}

/// Records the app's own screen with ReplayKit in-app capture plus the lesson sound into one small MP4.
/// Sound is LiveKit's mixed remote playout and the local microphone, mixed to mono AAC, as on Android.
final class LessonRecorder: @unchecked Sendable {
    private static let maxLongEdge = 1280.0, maxShortEdge = 720.0
    private static let frameRate = 15.0, videoBitrate = 700_000, audioBitrate = 64_000, keyFrameSeconds = 4
    private static let aacFrame = 1024
    private static let jitterFrames: Int64 = 48_000 * 120 / 1000
    private static let maxBufferedFrames = 48_000 * 300 / 1000

    private let queue = DispatchQueue(label: "ThinkMeetRecorder")
    private let remote = PcmTap()
    private let microphone = PcmTap()
    private var url: URL?
    private var writer: AVAssetWriter?
    private var videoInput: AVAssetWriterInput?
    private var audioInput: AVAssetWriterInput?
    private var audioFormat: CMAudioFormatDescription?
    private var sessionStart: CMTime?
    private var lastVideo = CMTime.invalid
    private var audioFrames: Int64 = 0
    private var size = (width: 0, height: 0)
    private var timer: DispatchSourceTimer?
    private var recording = false

    static func videoSize(width: Double, height: Double) -> (Int, Int) {
        let landscape = width >= height
        let long = landscape ? width : height, short = landscape ? height : width
        let scale = min(1, maxLongEdge / long, maxShortEdge / short)
        func aligned(_ value: Double) -> Int { max(16, Int(value) / 16 * 16) }
        return landscape ? (aligned(long * scale), aligned(short * scale)) : (aligned(short * scale), aligned(long * scale))
    }

    func start(path: String, completion: @escaping (String?) -> Void) {
        let recorder = RPScreenRecorder.shared()
        guard recorder.isAvailable else { completion("이 기기에서는 화면 녹화를 사용할 수 없어요."); return }
        let started: Bool = queue.sync {
            guard !recording else { return false }
            let target = URL(fileURLWithPath: path)
            try? FileManager.default.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: target)
            url = target; writer = nil; videoInput = nil; audioInput = nil; sessionStart = nil
            lastVideo = .invalid; audioFrames = 0; remote.ring.clear(); microphone.ring.clear()
            recording = true
            return true
        }
        guard started else { completion("이미 화면을 녹화하고 있어요."); return }
        // The LiveKit microphone and playout taps replace ReplayKit audio, which would capture the call twice.
        recorder.isMicrophoneEnabled = false
        AudioManager.shared.add(remoteAudioRenderer: remote)
        AudioManager.shared.add(localAudioRenderer: microphone)
        recorder.startCapture(handler: { [weak self] sample, type, error in
            guard let self, error == nil, type == .video, CMSampleBufferDataIsReady(sample) else { return }
            self.queue.async { self.appendVideo(sample) }
        }, completionHandler: { [weak self] error in
            guard let self else { return }
            if let error {
                self.detachAudio()
                self.queue.sync { self.recording = false; if let url = self.url { try? FileManager.default.removeItem(at: url) } }
                let declined = (error as NSError).domain == RPRecordingErrorDomain && (error as NSError).code == RPRecordingErrorCode.userDeclined.rawValue
                completion(declined ? "화면 녹화를 허용하지 않아 녹화 없이 수업을 진행해요." : "화면 녹화를 시작하지 못했어요. \(error.localizedDescription)")
            } else {
                completion(nil)
            }
        })
    }

    private func detachAudio() {
        AudioManager.shared.remove(remoteAudioRenderer: remote)
        AudioManager.shared.remove(localAudioRenderer: microphone)
    }

    private func appendVideo(_ sample: CMSampleBuffer) {
        guard recording else { return }
        let time = CMSampleBufferGetPresentationTimeStamp(sample)
        if writer == nil {
            guard let format = CMSampleBufferGetFormatDescription(sample) else { return }
            let dimensions = CMVideoFormatDescriptionGetDimensions(format)
            guard dimensions.width > 0, dimensions.height > 0, prepareWriter(width: Double(dimensions.width), height: Double(dimensions.height), start: time) else { return }
        }
        // ReplayKit delivers up to 60 fps; keep the recording at the target frame rate.
        if lastVideo.isValid, CMTimeGetSeconds(CMTimeSubtract(time, lastVideo)) < 1 / LessonRecorder.frameRate - 0.004 { return }
        guard let input = videoInput, input.isReadyForMoreMediaData else { return }
        if input.append(sample) { lastVideo = time }
    }

    private func prepareWriter(width: Double, height: Double, start: CMTime) -> Bool {
        guard let url else { return false }
        let (w, h) = LessonRecorder.videoSize(width: width, height: height)
        do {
            let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
            let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
                AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: w, AVVideoHeightKey: h,
                AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
                AVVideoCompressionPropertiesKey: [
                    AVVideoAverageBitRateKey: LessonRecorder.videoBitrate,
                    AVVideoExpectedSourceFrameRateKey: Int(LessonRecorder.frameRate),
                    AVVideoMaxKeyFrameIntervalDurationKey: LessonRecorder.keyFrameSeconds,
                    AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
                ],
            ])
            video.expectsMediaDataInRealTime = true
            let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
                AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: PcmRing.rate, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: LessonRecorder.audioBitrate,
            ])
            audio.expectsMediaDataInRealTime = true
            guard writer.canAdd(video), writer.canAdd(audio) else { return false }
            writer.add(video); writer.add(audio)
            guard writer.startWriting() else { return false }
            writer.startSession(atSourceTime: start)
            var description = AudioStreamBasicDescription(mSampleRate: PcmRing.rate, mFormatID: kAudioFormatLinearPCM,
                mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked, mBytesPerPacket: 2, mFramesPerPacket: 1,
                mBytesPerFrame: 2, mChannelsPerFrame: 1, mBitsPerChannel: 16, mReserved: 0)
            var format: CMAudioFormatDescription?
            CMAudioFormatDescriptionCreate(allocator: kCFAllocatorDefault, asbd: &description, layoutSize: 0, layout: nil,
                magicCookieSize: 0, magicCookie: nil, extensions: nil, formatDescriptionOut: &format)
            self.writer = writer; videoInput = video; audioInput = audio; audioFormat = format
            sessionStart = start; size = (w, h)
            let timer = DispatchSource.makeTimerSource(queue: queue)
            timer.schedule(deadline: .now() + .milliseconds(20), repeating: .milliseconds(20))
            timer.setEventHandler { [weak self] in self?.appendAudio(final: false) }
            timer.resume()
            self.timer = timer
            return true
        } catch { return false }
    }

    /// Mixes blocks up to "now minus a small jitter allowance" on the same host clock as ReplayKit frames.
    private func appendAudio(final: Bool) {
        guard let start = sessionStart, let input = audioInput, let format = audioFormat else { return }
        let elapsed = CMTimeGetSeconds(CMTimeSubtract(CMClockGetTime(CMClockGetHostTimeClock()), start))
        let now = Int64(elapsed * PcmRing.rate)
        let target = final ? now : now - LessonRecorder.jitterFrames
        let count = LessonRecorder.aacFrame
        while audioFrames + Int64(count) <= target, input.isReadyForMoreMediaData {
            var mixed = [Int32](repeating: 0, count: count)
            remote.ring.mix(into: &mixed, count: count, maxLatency: LessonRecorder.maxBufferedFrames)
            microphone.ring.mix(into: &mixed, count: count, maxLatency: LessonRecorder.maxBufferedFrames)
            var pcm = mixed.map { Int16(clamping: $0) }
            let bytes = count * 2
            var block: CMBlockBuffer?
            guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: bytes, blockAllocator: kCFAllocatorDefault,
                customBlockSource: nil, offsetToData: 0, dataLength: bytes, flags: kCMBlockBufferAssureMemoryNowFlag, blockBufferOut: &block) == noErr, let block else { return }
            pcm.withUnsafeMutableBytes { raw in _ = CMBlockBufferReplaceDataBytes(with: raw.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: bytes) }
            let time = CMTimeAdd(start, CMTime(value: audioFrames, timescale: CMTimeScale(PcmRing.rate)))
            var sample: CMSampleBuffer?
            guard CMAudioSampleBufferCreateReadyWithPacketDescriptions(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format,
                sampleCount: count, presentationTimeStamp: time, packetDescriptions: nil, sampleBufferOut: &sample) == noErr, let sample else { return }
            guard input.append(sample) else { return }
            audioFrames += Int64(count)
        }
    }

    /// Completion receives `{"size","durationMs","width","height"}` as JSON, or an error message.
    func stop(completion: @escaping (String?, String?) -> Void) {
        let active = queue.sync { recording }
        guard active else { completion(nil, "녹화 중이 아니에요."); return }
        detachAudio()
        RPScreenRecorder.shared().stopCapture { [weak self] _ in
            guard let self else { return }
            self.queue.async { self.finish(completion) }
        }
    }

    private func finish(_ completion: @escaping (String?, String?) -> Void) {
        recording = false
        timer?.cancel(); timer = nil
        guard let writer, let start = sessionStart, let url else {
            if let url { try? FileManager.default.removeItem(at: url) }
            completion(nil, "녹화된 화면이 없어요."); return
        }
        appendAudio(final: true)
        videoInput?.markAsFinished(); audioInput?.markAsFinished()
        let audioEnd = CMTimeGetSeconds(CMTime(value: audioFrames, timescale: CMTimeScale(PcmRing.rate)))
        let videoEnd = lastVideo.isValid ? CMTimeGetSeconds(CMTimeSubtract(lastVideo, start)) : 0
        let (width, height) = size
        writer.finishWriting { [weak self] in
            self?.queue.async {
                self?.writer = nil; self?.videoInput = nil; self?.audioInput = nil; self?.sessionStart = nil
                let bytes = ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value ?? 0
                guard writer.status == .completed, bytes > 0 else {
                    try? FileManager.default.removeItem(at: url)
                    completion(nil, writer.error?.localizedDescription ?? "녹화 파일을 저장하지 못했어요."); return
                }
                let duration = Int64(max(audioEnd, videoEnd) * 1000)
                completion("{\"size\":\(bytes),\"durationMs\":\(duration),\"width\":\(width),\"height\":\(height)}", nil)
            }
        }
    }
}
