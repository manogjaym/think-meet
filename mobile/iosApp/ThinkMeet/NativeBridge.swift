import Foundation
import UIKit
import AVFoundation
import PDFKit
import Security
import UniformTypeIdentifiers
import LiveKit
import ThinkMeet

/// The platform layer contains media and OS integration only; screens and rules live in KMP.
final class NativeBridge: NSObject, IosNativeBridge, RoomDelegate, BroadcastManagerDelegate, UIDocumentPickerDelegate, AVAudioPlayerDelegate, @unchecked Sendable {
    private let room = Room(roomOptions: RoomOptions(defaultScreenShareCaptureOptions: ScreenShareCaptureOptions(appAudio: true, useBroadcastExtension: true), adaptiveStream: true, dynacast: true, suspendLocalVideoTracksInBackground: false))
    private var listener: ((MediaState) -> Void)?
    private var preview: LocalVideoTrack?
    private weak var previewOwner: VideoView?
    private var previewTask: Task<Void, Never>?
    private var previewStatus = PreviewDevice.checking
    private var previewCanFlip = false
    private var previewMicId: String?
    private var previewMic: AVAudioEngine?
    private var previewToneId: String?
    private var previewTone: AVAudioPlayer?
    private var previewToneCompletion: ((String?) -> Void)?
    private var previewAudioSettings: (AVAudioSession.Category, AVAudioSession.Mode, AVAudioSession.CategoryOptions)?
    private var preferredCamera: AVCaptureDevice.Position {
        read(key: "devices.cameraFacing", fallback: "front") == "back" ? .back : .front
    }
    private var speaker = true
    private var microphoneWanted = false
    private var screenAudioActive = false
    private var restoreMicrophoneAfterReconnect = false
    private var broadcastAllowed = false
    private var screenCaptureId: Int64 = 0
    private var captureGeneration: Int64 = 0
    private var lastError: String?
    private var noteImageCompletion: ((Data?, String?) -> Void)?
    private var pickerCompletion: ((String?, String?, String?, KotlinLong) -> Void)?
    private var videoViews: [WeakVideoView] = []
    private weak var callRootView: UIView?
    #if DEBUG && targetEnvironment(simulator)
    private let simulatorSessionLock = NSLock()
    private var simulatorSessions: [String: String] = [:]
    #endif
    @MainActor private lazy var pictureInPicture = VideoCallPictureInPicture(
        sourceView: { [weak self] in self?.callRootView },
        videoTrack: { [weak self] target in
            guard let self, let target else { return nil }
            let people: [Participant] = [self.room.localParticipant] + Array(self.room.remoteParticipants.values)
            return people.first { $0.identity?.stringValue == target.identity }?.videoTracks
                .first { $0.source == (target.screen ? .screenShareVideo : .camera) && !$0.isMuted }?.track as? VideoTrack
        }
    )
    override init() {
        super.init()
        room.add(delegate: self)
        BroadcastManager.shared.shouldPublishTrack = false
        BroadcastManager.shared.delegate = self
    }

    private func onMain(_ operation: @escaping @MainActor () -> Void) {
        if Thread.isMainThread { MainActor.assumeIsolated { operation() } }
        else { DispatchQueue.main.async { operation() } }
    }
    @MainActor func setCallRootView(_ view: UIView) {
        callRootView = view
        pictureInPicture.refreshSource()
    }
    func listenPictureInPicture(listener: @escaping (PictureInPictureState) -> Void) {
        onMain { self.pictureInPicture.listen(listener) }
    }
    func updatePictureInPicture(enabled: Bool, target: PipVideoTarget?) {
        onMain { self.pictureInPicture.update(enabled: enabled && self.room.connectionState == .connected, target: target) }
    }
    func enterPictureInPicture(completion: @escaping (String?) -> Void) {
        onMain { self.pictureInPicture.enter(completion: completion) }
    }
    func closePictureInPicture() { onMain { self.pictureInPicture.close() } }

    @MainActor private func disconnectMedia() async {
        pictureInPicture.update(enabled: false, target: nil)
        await stopPreview()
        stopPrejoinAudio()
        endBroadcast()
        await stopAppAudio()
        await room.disconnect()
        emitState()
    }

    @MainActor private func setCameraEnabled(_ enabled: Bool) async throws {
        if enabled, room.localParticipant.videoTracks.first(where: { $0.source == .camera }) == nil {
            let track = LocalVideoTrack.createCameraTrack(options: CameraCaptureOptions(position: preferredCamera))
            if let camera = track.capturer as? CameraCapturer, camera.isMultitaskingAccessSupported {
                camera.isMultitaskingAccessEnabled = true
            }
            do {
                try await room.localParticipant.publish(videoTrack: track)
                if let camera = track.capturer as? CameraCapturer, camera.isMultitaskingAccessSupported {
                    camera.isMultitaskingAccessEnabled = true
                }
            }
            catch { try? await track.stop(); throw error }
        } else {
            if let camera = (room.localParticipant.videoTracks.first { $0.source == .camera }?.track as? LocalVideoTrack)?.capturer as? CameraCapturer,
               camera.isMultitaskingAccessSupported { camera.isMultitaskingAccessEnabled = true }
            try await room.localParticipant.setCamera(enabled: enabled)
        }
    }

    func listen(listener: @escaping (MediaState) -> Void) { self.listener = listener; emitState() }
    func connect(url: String, token: String, camera: Bool, microphone: Bool, completion: @escaping (String?) -> Void) {
        Task { @MainActor in
            do {
                await stopPreview()
                stopPrejoinAudio()
                await stopAppAudio()
                restoreMicrophoneAfterReconnect = false
                AudioManager.shared.mixer.micVolume = 1
                lastError = nil
                try await room.connect(url: url, token: token)
                if camera, await AVCaptureDevice.requestAccess(for: .video) {
                    do { try await setCameraEnabled(true) }
                    catch { lastError = "카메라를 시작하지 못했어요: \(error.localizedDescription)" }
                }
                if microphone, await AVCaptureDevice.requestAccess(for: .audio) {
                    do { try await room.localParticipant.setMicrophone(enabled: true) }
                    catch { lastError = "마이크를 시작하지 못했어요: \(error.localizedDescription)" }
                }
                microphoneWanted = room.localParticipant.isMicrophoneEnabled()
                emitState(); _ = completion(nil)
            } catch { lastError = error.localizedDescription; emitState(); _ = completion(error.localizedDescription) }
        }
    }
    func action(name: String, enabled: Bool, completion: @escaping (String?) -> Void) {
        Task { @MainActor in
            do {
                switch name {
                case "disconnect": await disconnectMedia()
                case "camera":
                    if enabled, !(await AVCaptureDevice.requestAccess(for: .video)) { throw NativeError.permission("카메라") }
                    try await setCameraEnabled(enabled)
                case "microphone":
                    if enabled, !(await AVCaptureDevice.requestAccess(for: .audio)) { throw NativeError.permission("마이크") }
                    microphoneWanted = enabled
                    if screenAudioActive {
                        // Keep app audio flowing while the hardware microphone is muted separately.
                        AudioManager.shared.mixer.micVolume = enabled ? 1 : 0
                        try await room.localParticipant.setMicrophone(enabled: true)
                    } else {
                        AudioManager.shared.mixer.micVolume = 1
                        try await room.localParticipant.setMicrophone(enabled: enabled)
                    }
                case "screen":
                    if enabled {
                        guard room.connectionState == .connected else { throw NativeError.screenNotConnected }
                        guard !BroadcastManager.shared.isBroadcasting else { throw NativeError.broadcastStopping }
                        broadcastAllowed = true
                        BroadcastManager.shared.shouldPublishTrack = true
                        if !screenAudioActive { microphoneWanted = room.localParticipant.isMicrophoneEnabled() }
                        AudioManager.shared.mixer.micVolume = microphoneWanted ? 1 : 0
                        do { try await room.localParticipant.setScreenShare(enabled: true) }
                        catch { try? await stopScreenShare(); throw error }
                    } else { try await stopScreenShare() }
                case "speaker": try AVAudioSession.sharedInstance().overrideOutputAudioPort(enabled ? .speaker : .none); speaker = enabled
                case "flip":
                    let track = (room.localParticipant.videoTracks.first { $0.source == .camera }?.track as? LocalVideoTrack) ?? preview
                    if let capturer = track?.capturer as? CameraCapturer {
                        if track === preview {
                            guard previewCanFlip else { break }
                            let position: AVCaptureDevice.Position = capturer.position == .front ? .back : .front
                            guard try await capturer.set(cameraPosition: position) else { throw NativeError.previewUnavailable }
                            write(key: "devices.cameraFacing", value: position == .back ? "back" : "front")
                        } else { _ = try await capturer.switchCameraPosition() }
                    }
                default: break
                }
                emitState(); _ = completion(nil)
            } catch { lastError = error.localizedDescription; emitState(); _ = completion(error.localizedDescription) }
        }
    }

    @MainActor private func endBroadcast() {
        broadcastAllowed = false
        BroadcastManager.shared.shouldPublishTrack = false
        screenCaptureId = 0
        AudioManager.shared.mixer.appVolume = 0
        if BroadcastManager.shared.isBroadcasting { BroadcastManager.shared.requestStop() }
    }

    @MainActor private func stopScreenShare() async throws {
        endBroadcast()
        emitState()
        do { try await room.localParticipant.setScreenShare(enabled: false) }
        catch { await stopAppAudio(); throw error }
        await stopAppAudio()
    }

    func broadcastManager(didChangeState isBroadcasting: Bool) {
        onMain {
            if isBroadcasting {
                guard self.broadcastAllowed else { BroadcastManager.shared.requestStop(); return }
                if self.screenCaptureId == 0 {
                    self.captureGeneration += 1
                    self.screenCaptureId = self.captureGeneration
                    Task { @MainActor in await self.startAppAudio() }
                }
            } else if self.screenCaptureId != 0 {
                self.endBroadcast()
                let ended = self.captureGeneration
                Task { @MainActor in
                    guard self.captureGeneration == ended, !self.broadcastAllowed else { return }
                    try? await self.stopScreenShare()
                }
            }
            self.emitState()
        }
    }

    private func emitState() {
        if !Thread.isMainThread { DispatchQueue.main.async { self.emitState() }; return }
        let people: [Participant] = [room.localParticipant] + Array(room.remoteParticipants.values)
        let state = MediaState(connected: room.connectionState == .connected, reconnecting: room.connectionState == .reconnecting,
            participants: people.compactMap { p in
                guard let id = p.identity?.stringValue else { return nil }
                let dimensions = p.videoTracks.first { $0.source == .screenShareVideo }?.dimensions
                let defaultRatio: Float = 16 / 9
                var ratio = defaultRatio
                if let dimensions, dimensions.height > 0 { ratio = Float(dimensions.width) / Float(dimensions.height) }
                let microphone = p === room.localParticipant && screenAudioActive ? microphoneWanted : p.isMicrophoneEnabled()
                return MediaParticipant(identity: id, name: p.name ?? "", camera: p.isCameraEnabled(), microphone: microphone,
                    screen: p.isScreenShareEnabled(), speaking: p.isSpeaking, local: p === room.localParticipant, screenAspectRatio: ratio)
            }, error: lastError, camera: room.localParticipant.isCameraEnabled(), microphone: screenAudioActive ? microphoneWanted : room.localParticipant.isMicrophoneEnabled(),
            screenSharing: room.localParticipant.isScreenShareEnabled(), speaker: speaker, screenCaptureId: screenCaptureId,
            previewCamera: previewStatus, canFlipPreview: previewCanFlip,
            // Shared code maps the legacy REPLACED:/KICKED: error prefixes to MediaFailure.
            failure: nil)
        _ = listener?(state)
        videoViews = videoViews.filter { $0.view != nil }
        for item in videoViews {
            item.view?.track = people.first { $0.identity?.stringValue == item.identity }?.videoTracks
                .first { $0.source == (item.screen ? .screenShareVideo : .camera) }?.track as? VideoTrack
        }
        onMain {
            self.pictureInPicture.refreshSource()
            self.pictureInPicture.refreshTrack()
        }
    }
    func videoView(identity: String, screen: Bool) -> UIView {
        let view = VideoView()
        view.layoutMode = screen ? .fit : .fill
        videoViews.append(WeakVideoView(view: view, identity: identity, screen: screen))
        emitState()
        return view
    }
    func previewView(enabled: Bool) -> UIView {
        let view = VideoView(); updatePreview(view: view, enabled: enabled); return view
    }
    func updatePreview(view: UIView, enabled: Bool) {
        guard let video = view as? VideoView else { return }
        onMain {
            if !enabled {
                if self.previewOwner === video {
                    self.previewOwner = nil
                    self.previewTask?.cancel()
                    Task { @MainActor in
                        if self.previewOwner == nil { await self.stopPreview() }
                    }
                }
                return
            }
            guard self.previewOwner !== video else { return }
            self.previewOwner = video
            let previousTask = self.previewTask
            previousTask?.cancel()
            self.previewTask = Task { @MainActor in
                await previousTask?.value
                guard !Task.isCancelled, self.previewOwner === video else { return }
                if let old = self.preview {
                    self.preview = nil
                    _ = try? await old.capturer.stopCapture()
                }
                self.previewStatus = .checking
                self.previewCanFlip = false
                self.emitState()
                let devices = (try? await CameraCapturer.captureDevices()) ?? []
                guard !Task.isCancelled, self.previewOwner === video else { return }
                guard !devices.isEmpty else {
                    self.previewStatus = .unavailable
                    self.emitState()
                    return
                }
                let granted = await AVCaptureDevice.requestAccess(for: .video)
                guard !Task.isCancelled, self.previewOwner === video else { return }
                guard granted else {
                    self.previewStatus = .permission
                    self.emitState()
                    return
                }
                let position = devices.contains { $0.position == self.preferredCamera } ? self.preferredCamera : .unspecified
                let track = LocalVideoTrack.createCameraTrack(options: CameraCaptureOptions(position: position))
                do {
                    _ = try await track.capturer.startCapture()
                    guard !Task.isCancelled, self.previewOwner === video else {
                        _ = try? await track.capturer.stopCapture()
                        return
                    }
                    self.preview = track
                    video.track = track
                    for _ in 0..<40 {
                        if track.videoFrame != nil { break }
                        try await Task.sleep(nanoseconds: 100_000_000)
                    }
                    guard !Task.isCancelled, self.previewOwner === video else { return }
                    guard track.videoFrame != nil else { throw NativeError.previewUnavailable }
                    self.previewStatus = .connected
                    self.previewCanFlip = devices.contains { $0.position == .front } && devices.contains { $0.position == .back }
                    self.emitState()
                } catch {
                    _ = try? await track.capturer.stopCapture()
                    if !Task.isCancelled, self.previewOwner === video {
                        self.preview = nil
                        video.track = nil
                        self.previewStatus = .failed
                        self.emitState()
                    }
                }
            }
        }
    }
    @MainActor private func stopPreview() async {
        previewOwner?.track = nil
        previewOwner = nil
        let task = previewTask
        previewTask = nil
        let track = preview
        preview = nil
        task?.cancel()
        await task?.value
        if let track { _ = try? await track.capturer.stopCapture() }
    }

    func checkPreviewMicrophone(id: String, onLevel: @escaping (KotlinFloat) -> Void, onError: @escaping (PreviewDevice) -> Void) {
        onMain {
            self.previewMicId = id
            Task { @MainActor in
                let granted = await AVCaptureDevice.requestAccess(for: .audio)
                guard self.previewMicId == id else { return }
                guard granted else { self.previewMicId = nil; onError(.permission); return }
                do {
                    try self.preparePreviewAudio(recording: true)
                    let engine = AVAudioEngine()
                    let input = engine.inputNode
                    let format = input.outputFormat(forBus: 0)
                    guard format.channelCount > 0, format.sampleRate > 0 else {
                        self.stopPreviewMicrophone(id: id); onError(.unavailable); return
                    }
                    input.installTap(onBus: 0, bufferSize: 2048, format: format) { [weak self] buffer, _ in
                        guard let data = buffer.floatChannelData?.pointee, buffer.frameLength > 0 else { return }
                        let count = Int(buffer.frameLength)
                        var square: Float = 0
                        for index in 0..<count { square += data[index] * data[index] }
                        let level = min(1, sqrt(square / Float(count)) * 3.5)
                        DispatchQueue.main.async {
                            if self?.previewMicId == id { onLevel(KotlinFloat(float: level)) }
                        }
                    }
                    self.previewMic = engine
                    try engine.start()
                    onLevel(KotlinFloat(float: 0))
                } catch {
                    self.stopPreviewMicrophone(id: id)
                    onError(.failed)
                }
            }
        }
    }
    func stopPreviewMicrophone(id: String) {
        onMain {
            guard self.previewMicId == id else { return }
            self.previewMicId = nil
            if let engine = self.previewMic {
                engine.inputNode.removeTap(onBus: 0)
                engine.stop()
                self.previewMic = nil
            }
            self.restorePreviewAudioIfIdle()
        }
    }

    func playPreviewTone(id: String, completion: @escaping (String?) -> Void) {
        onMain {
            self.previewToneId = id
            self.previewToneCompletion = completion
            do {
                try self.preparePreviewAudio(recording: self.previewMic != nil)
                let player = try AVAudioPlayer(data: Self.previewToneData())
                player.delegate = self
                self.previewTone = player
                if !player.play() { self.finishPreviewTone(error: "재생 실패") }
            } catch { self.finishPreviewTone(error: error.localizedDescription) }
        }
    }
    func stopPreviewTone(id: String) {
        onMain {
            if self.previewToneId == id { self.finishPreviewTone(error: nil) }
        }
    }
    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        onMain {
            if self.previewTone === player { self.finishPreviewTone(error: flag ? nil : "재생 실패") }
        }
    }
    func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        onMain {
            if self.previewTone === player { self.finishPreviewTone(error: error?.localizedDescription ?? "재생 실패") }
        }
    }
    @MainActor private func finishPreviewTone(error: String?) {
        let completion = previewToneCompletion
        previewTone?.stop()
        previewTone = nil
        previewToneId = nil
        previewToneCompletion = nil
        restorePreviewAudioIfIdle()
        completion?(error)
    }
    @MainActor private func preparePreviewAudio(recording: Bool) throws {
        let session = AVAudioSession.sharedInstance()
        if previewAudioSettings == nil { previewAudioSettings = (session.category, session.mode, session.categoryOptions) }
        let category: AVAudioSession.Category = recording ? .playAndRecord : .playback
        let options: AVAudioSession.CategoryOptions = recording ? [.defaultToSpeaker, .allowBluetooth] : []
        if session.category != category || session.mode != .default || session.categoryOptions != options {
            try session.setCategory(category, mode: .default, options: options)
        }
        try session.setActive(true)
    }
    @MainActor private func restorePreviewAudioIfIdle() {
        guard previewMic == nil, previewTone == nil, let saved = previewAudioSettings else { return }
        previewAudioSettings = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        try? AVAudioSession.sharedInstance().setCategory(saved.0, mode: saved.1, options: saved.2)
    }
    @MainActor private func stopPrejoinAudio() {
        if let id = previewMicId { stopPreviewMicrophone(id: id) }
        if let id = previewToneId { stopPreviewTone(id: id) }
    }
    private static func previewToneData() -> Data {
        let rate = 16_000
        let count = rate * 65 / 100
        var data = Data()
        func append<T: FixedWidthInteger>(_ number: T) {
            var value = number.littleEndian
            withUnsafeBytes(of: &value) { data.append(contentsOf: $0) }
        }
        data.append(contentsOf: "RIFF".utf8)
        append(UInt32(36 + count * 2))
        data.append(contentsOf: "WAVEfmt ".utf8)
        append(UInt32(16)); append(UInt16(1)); append(UInt16(1))
        append(UInt32(rate)); append(UInt32(rate * 2)); append(UInt16(2)); append(UInt16(16))
        data.append(contentsOf: "data".utf8)
        append(UInt32(count * 2))
        for index in 0..<count {
            let fade = min(1, Double(index) / 320, Double(count - 1 - index) / 320)
            append(Int16(4000 * fade * sin(2 * .pi * 440 * Double(index) / Double(rate))))
        }
        return data
    }
    @MainActor private func startAppAudio() async {
        let capture = screenCaptureId
        guard capture != 0, !screenAudioActive, room.connectionState == .connected, room.localParticipant.isScreenShareEnabled() else { return }
        guard await AVCaptureDevice.requestAccess(for: .audio) else {
            lastError = "화면 소리를 전달하려면 설정에서 마이크 권한을 허용해 주세요. 화면 영상은 계속 공유됩니다."
            emitState(); return
        }
        guard screenCaptureId == capture, !screenAudioActive, room.connectionState == .connected, room.localParticipant.isScreenShareEnabled() else { return }
        screenAudioActive = true
        restoreMicrophoneAfterReconnect = false
        AudioManager.shared.mixer.micVolume = microphoneWanted ? 1 : 0
        AudioManager.shared.mixer.appVolume = 1
        do { try await room.localParticipant.setMicrophone(enabled: true) }
        catch { screenAudioActive = false; lastError = "화면 소리를 시작하지 못했어요: \(error.localizedDescription)" }
        emitState()
    }
    @MainActor private func stopAppAudio() async {
        AudioManager.shared.mixer.appVolume = 0
        guard screenAudioActive else { return }
        screenAudioActive = false
        // Keep a muted microphone silent while the publication is still up during a reconnect.
        AudioManager.shared.mixer.micVolume = microphoneWanted ? 1 : 0
        if room.connectionState == .connected {
            _ = try? await room.localParticipant.setMicrophone(enabled: microphoneWanted)
        } else if room.connectionState == .reconnecting {
            restoreMicrophoneAfterReconnect = true
        }
        emitState()
    }
    func materialView() -> UIView { MaterialView() }
    func updateMaterial(view: UIView, url: String, cookie: String, type: String, page: Int32, playing: Bool, position: Double, updatedAt: String, onAspectRatio: @escaping (KotlinFloat) -> Void) {
        (view as? MaterialView)?.update(url: url, cookie: cookie, type: type, page: Int(page), playing: playing, position: position, updatedAt: updatedAt) { ratio in _ = onAspectRatio(KotlinFloat(float: ratio)) }
    }
    func disposeMaterial(view: UIView) { (view as? MaterialView)?.dispose() }

    func isNoteFrameReady(view: UIView, page: Int32) -> Bool {
        if let material = view as? MaterialView { return material.noteFrameReady(page: Int(page)) }
        return (view as? VideoView)?.track?.videoFrame != nil
    }
    func readNoteFrame(view: UIView, page: Int32) -> Data? {
        if let material = view as? MaterialView { return material.noteFrame(page: Int(page)) }
        guard let frame = (view as? VideoView)?.track?.videoFrame else { return nil }
        let buffer = (frame.buffer as? CVPixelVideoBuffer)?.pixelBuffer ?? (frame.buffer as? I420VideoBuffer)?.toPixelBuffer()
        guard let buffer else { return nil }
        return MaterialView.noteJPEG(buffer: buffer, rotation: frame.rotation.rawValue)
    }

    func worksheetCameraView(onReady: @escaping (String?) -> Void) -> UIView {
        WorksheetCameraView(onReady: onReady)
    }
    func captureWorksheetPhoto(view: UIView, completion: @escaping (Data?, String?) -> Void) {
        guard let camera = view as? WorksheetCameraView else { completion(nil, "카메라를 열지 못했어요."); return }
        camera.capturePhoto(completion: completion)
    }
    func disposeWorksheetCamera(view: UIView) { (view as? WorksheetCameraView)?.stop() }

    func pickNoteImage(completion: @escaping (Data?, String?) -> Void) {
        guard noteImageCompletion == nil, pickerCompletion == nil, let presenter = topController() else {
            completion(nil, "이미지 선택 화면을 열 수 없어요."); return
        }
        noteImageCompletion = completion
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.jpeg, .png], asCopy: false)
        picker.delegate = self
        presenter.present(picker, animated: true)
    }

    func read(key: String, fallback: String) -> String {
        guard key.hasPrefix("session:") else { return UserDefaults.standard.string(forKey: key) ?? fallback }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.woongjin.thinkmeet", kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        #if DEBUG && targetEnvironment(simulator)
        if status == errSecMissingEntitlement {
            return simulatorSessionLock.withLock { simulatorSessions[key] ?? fallback }
        }
        #endif
        guard status == errSecSuccess, let data = item as? Data else { return fallback }
        return String(data: data, encoding: .utf8) ?? fallback
    }
    func write(key: String, value: String) {
        guard key.hasPrefix("session:") else { UserDefaults.standard.set(value, forKey: key); return }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.woongjin.thinkmeet", kSecAttrAccount as String: key]
        let deletion = SecItemDelete(query as CFDictionary)
        #if DEBUG && targetEnvironment(simulator)
        // Locally built simulator apps may have no Keychain access group. Keep their session in memory.
        if deletion == errSecMissingEntitlement {
            simulatorSessionLock.withLock { simulatorSessions[key] = value.isEmpty ? nil : value }
            return
        }
        #endif
        guard deletion == errSecSuccess || deletion == errSecItemNotFound else {
            NSLog("ThinkMeet session Keychain delete failed (%d)", deletion)
            return
        }
        if !value.isEmpty {
            var attributes = query
            attributes[kSecValueData as String] = Data(value.utf8)
            attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let status = SecItemAdd(attributes as CFDictionary, nil)
            #if DEBUG && targetEnvironment(simulator)
            if status == errSecMissingEntitlement {
                simulatorSessionLock.withLock { simulatorSessions[key] = value }
                return
            }
            #endif
            if status != errSecSuccess { NSLog("ThinkMeet session Keychain write failed (%d)", status) }
        }
    }
    func share(url: String) {
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let presenter = topController() {
            sheet.popoverPresentationController?.sourceView = presenter.view
            sheet.popoverPresentationController?.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            presenter.present(sheet, animated: true)
        }
    }
    func doCopy(text: String) { UIPasteboard.general.string = text }
    func pickFile(completion: @escaping (String?, String?, String?, KotlinLong) -> Void) {
        pickerCompletion = completion
        let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf, .mpeg4Movie], asCopy: false)
        picker.delegate = self
        topController()?.present(picker, animated: true)
    }
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        if let completion = noteImageCompletion { noteImageCompletion = nil; completion(nil, nil); return }
        _ = pickerCompletion?(nil, nil, nil, KotlinLong(longLong: 0)); pickerCompletion = nil
    }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { documentPickerWasCancelled(controller); return }
        if let completion = noteImageCompletion {
            noteImageCompletion = nil
            Task.detached {
                let permitted = url.startAccessingSecurityScopedResource()
                defer { if permitted { url.stopAccessingSecurityScopedResource() } }
                do {
                    let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
                    guard size > 0 && size <= 10 * 1024 * 1024 else { throw NativeError.fileSize }
                    let data = try Data(contentsOf: url, options: .mappedIfSafe)
                    await MainActor.run { completion(data, nil) }
                } catch {
                    await MainActor.run { completion(nil, "JPEG·PNG 이미지는 10MiB까지 선택할 수 있어요.") }
                }
            }
            return
        }
        let completion = pickerCompletion; pickerCompletion = nil
        Task {
            let permitted = url.startAccessingSecurityScopedResource(); defer { if permitted { url.stopAccessingSecurityScopedResource() } }
            let pdf = url.pathExtension.lowercased() == "pdf"
            let limit = (pdf ? 50 : 500) * 1024 * 1024
            do {
                let values = try url.resourceValues(forKeys: [.fileSizeKey])
                guard let size = values.fileSize, size > 0, size <= limit else { throw NativeError.fileSize }
                let temporary = FileManager.default.temporaryDirectory.appendingPathComponent("upload-" + UUID().uuidString + "." + url.pathExtension)
                try FileManager.default.copyItem(at: url, to: temporary)
                await MainActor.run { _ = completion?(url.lastPathComponent, temporary.path, pdf ? "application/pdf" : "video/mp4", KotlinLong(longLong: Int64(size))) }
            } catch {
                await MainActor.run {
                    _ = completion?(nil, nil, nil, KotlinLong(longLong: 0))
                    let alert = UIAlertController(title: "자료를 선택하지 못했어요", message: error.localizedDescription, preferredStyle: .alert)
                    alert.addAction(UIAlertAction(title: "확인", style: .default)); self.topController()?.present(alert, animated: true)
                }
            }
        }
    }
    private func topController() -> UIViewController? {
        var top = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows).first { $0.isKeyWindow }?.rootViewController
        while let presented = top?.presentedViewController { top = presented }
        return top
    }
    func roomDidConnect(_ room: Room) { emitState() }
    func roomDidReconnect(_ room: Room) {
        onMain {
            self.emitState()
            if self.restoreMicrophoneAfterReconnect && !self.screenAudioActive {
                self.restoreMicrophoneAfterReconnect = false
                Task { @MainActor in _ = try? await room.localParticipant.setMicrophone(enabled: self.microphoneWanted) }
            }
        }
    }
    func roomIsReconnecting(_ room: Room) { emitState() }
    func room(_ room: Room, participantDidConnect participant: RemoteParticipant) { emitState() }
    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) { emitState() }
    func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) { emitState() }
    func room(_ room: Room, participant: Participant, trackPublication: TrackPublication, didUpdateIsMuted isMuted: Bool) { emitState() }
    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) { emitState() }
    func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) { emitState() }
    func room(_ room: Room, participant: LocalParticipant, didPublishTrack publication: LocalTrackPublication) {
        emitState()
        if publication.source == .screenShareVideo {
            Task { @MainActor in
                if broadcastAllowed && BroadcastManager.shared.isBroadcasting { await startAppAudio() }
                else { try? await participant.unpublish(publication: publication) }
            }
        }
    }
    func room(_ room: Room, participant: LocalParticipant, didUnpublishTrack publication: LocalTrackPublication) {
        emitState()
    }
    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        DispatchQueue.main.async {
            self.pictureInPicture.update(enabled: false, target: nil)
            if self.broadcastAllowed {
                self.endBroadcast()
                Task { @MainActor in await self.stopAppAudio() }
            }
            if error?.type == .duplicateIdentity { self.lastError = "REPLACED: 다른 기기에서 수업에 입장했어요." }
            else if error?.type == .participantRemoved { self.lastError = "KICKED: 선생님이 참여를 종료했어요." }
            else { self.lastError = error?.localizedDescription }
            self.emitState()
        }
    }
    func room(_ room: Room, didUpdateConnectionState connectionState: ConnectionState, from oldConnectionState: ConnectionState) { emitState() }
}
private struct WeakVideoView { weak var view: VideoView?; let identity: String; let screen: Bool }
private enum NativeError: LocalizedError {
    case previewUnavailable
    case permission(String), fileSize, broadcastStopping, screenNotConnected
    var errorDescription: String? {
        switch self {
        case .previewUnavailable: return "카메라 미리보기를 사용할 수 없어요."
        case .permission(let name): return "설정에서 \(name) 권한을 허용해 주세요."
        case .fileSize: return "PDF는 50MB, MP4는 500MB까지 선택할 수 있어요."
        case .broadcastStopping: return "이전 화면 공유가 멈춘 뒤 다시 시도해 주세요."
        case .screenNotConnected: return "수업 연결 후 화면을 공유해 주세요."
        }
    }
}
