import Foundation
import UIKit
import AVFoundation
import PDFKit
import Security
import UniformTypeIdentifiers
import LiveKit
import ThinkMeet

/// The platform layer contains media and OS integration only; screens and rules live in KMP.
final class NativeBridge: NSObject, IosNativeBridge, RoomDelegate, UIDocumentPickerDelegate, @unchecked Sendable {
    private let room = Room(roomOptions: RoomOptions(defaultScreenShareCaptureOptions: ScreenShareCaptureOptions(appAudio: true, useBroadcastExtension: true), adaptiveStream: true, dynacast: true, suspendLocalVideoTracksInBackground: false))
    private var listener: ((MediaState) -> Void)?
    private var preview: LocalVideoTrack?
    private var previewEnabled = false
    private var speaker = true
    private var microphoneWanted = false
    private var screenAudioActive = false
    private var lastError: String?
    private var pickerCompletion: ((String?, String?, String?, KotlinLong) -> Void)?
    private var videoViews: [WeakVideoView] = []
    private weak var callRootView: UIView?
    @MainActor private lazy var pictureInPicture = VideoCallPictureInPicture(
        sourceView: { [weak self] in self?.callRootView },
        videoTrack: { [weak self] target in
            guard let self, let target else { return nil }
            let people: [Participant] = [self.room.localParticipant] + Array(self.room.remoteParticipants.values)
            return people.first { $0.identity?.stringValue == target.identity }?.videoTracks
                .first { $0.source == (target.screen ? .screenShareVideo : .camera) && !$0.isMuted }?.track as? VideoTrack
        },
        didCloseCall: { [weak self] in
            Task { @MainActor [weak self] in await self?.disconnectMedia() }
        }
    )
    override init() { super.init(); room.add(delegate: self) }

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
        BroadcastManager.shared.requestStop()
        await stopAppAudio()
        await room.disconnect()
        emitState()
    }

    @MainActor private func setCameraEnabled(_ enabled: Bool) async throws {
        if enabled, room.localParticipant.videoTracks.first(where: { $0.source == .camera }) == nil {
            let track = LocalVideoTrack.createCameraTrack()
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
                await stopAppAudio()
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
                        if !screenAudioActive { microphoneWanted = room.localParticipant.isMicrophoneEnabled() }
                        AudioManager.shared.mixer.micVolume = microphoneWanted ? 1 : 0
                        try await room.localParticipant.setScreenShare(enabled: true)
                    } else { BroadcastManager.shared.requestStop(); try await room.localParticipant.setScreenShare(enabled: false); await stopAppAudio() }
                case "speaker": try AVAudioSession.sharedInstance().overrideOutputAudioPort(enabled ? .speaker : .none); speaker = enabled
                case "flip":
                    let track = (room.localParticipant.videoTracks.first { $0.source == .camera }?.track as? LocalVideoTrack) ?? preview
                    if let capturer = track?.capturer as? CameraCapturer { _ = try await capturer.switchCameraPosition() }
                default: break
                }
                emitState(); _ = completion(nil)
            } catch { lastError = error.localizedDescription; emitState(); _ = completion(error.localizedDescription) }
        }
    }
    private func emitState() {
        if !Thread.isMainThread { DispatchQueue.main.async { self.emitState() }; return }
        let people: [Participant] = [room.localParticipant] + Array(room.remoteParticipants.values)
        let state = MediaState(connected: room.connectionState == .connected, reconnecting: room.connectionState == .reconnecting,
            participants: people.compactMap { p in
                guard let id = p.identity?.stringValue else { return nil }
                let dimensions = p.videoTracks.first { $0.source == .screenShareVideo }?.dimensions
                let ratio = dimensions.map { $0.height > 0 ? Float($0.width) / Float($0.height) : 16 / 9 } ?? 16 / 9
                let microphone = p === room.localParticipant && screenAudioActive ? microphoneWanted : p.isMicrophoneEnabled()
                return MediaParticipant(identity: id, name: p.name ?? "", camera: p.isCameraEnabled(), microphone: microphone,
                    screen: p.isScreenShareEnabled(), speaking: p.isSpeaking, local: p === room.localParticipant, screenAspectRatio: ratio)
            }, error: lastError, camera: room.localParticipant.isCameraEnabled(), microphone: screenAudioActive ? microphoneWanted : room.localParticipant.isMicrophoneEnabled(),
            screenSharing: room.localParticipant.isScreenShareEnabled(), speaker: speaker)
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
        previewEnabled = enabled
        Task { @MainActor in
            if enabled {
                guard await AVCaptureDevice.requestAccess(for: .video), previewEnabled else { return }
                do {
                    if preview == nil {
                        let track = LocalVideoTrack.createCameraTrack()
                        _ = try await track.capturer.startCapture()
                        preview = track
                    }
                    video.track = preview
                } catch { lastError = error.localizedDescription; emitState() }
            } else { video.track = nil; await stopPreview() }
        }
    }
    private func stopPreview() async {
        previewEnabled = false
        if let track = preview { _ = try? await track.capturer.stopCapture() }
        preview = nil
    }
    @MainActor private func startAppAudio() async {
        guard !screenAudioActive, room.connectionState == .connected, room.localParticipant.isScreenShareEnabled() else { return }
        guard await AVCaptureDevice.requestAccess(for: .audio) else {
            lastError = "화면 소리를 전달하려면 설정에서 마이크 권한을 허용해 주세요. 화면 영상은 계속 공유됩니다."
            emitState(); return
        }
        guard room.connectionState == .connected, room.localParticipant.isScreenShareEnabled() else { return }
        screenAudioActive = true
        AudioManager.shared.mixer.micVolume = microphoneWanted ? 1 : 0
        AudioManager.shared.mixer.appVolume = 1
        do { try await room.localParticipant.setMicrophone(enabled: true) }
        catch { screenAudioActive = false; lastError = "화면 소리를 시작하지 못했어요: \(error.localizedDescription)" }
        emitState()
    }
    @MainActor private func stopAppAudio() async {
        guard screenAudioActive else { AudioManager.shared.mixer.micVolume = 1; return }
        screenAudioActive = false
        if room.connectionState == .connected { _ = try? await room.localParticipant.setMicrophone(enabled: microphoneWanted) }
        AudioManager.shared.mixer.micVolume = 1
        emitState()
    }
    func materialView() -> UIView { MaterialView() }
    func updateMaterial(view: UIView, url: String, cookie: String, type: String, page: Int32, playing: Bool, position: Double, updatedAt: String, onAspectRatio: @escaping (KotlinFloat) -> Void) {
        (view as? MaterialView)?.update(url: url, cookie: cookie, type: type, page: Int(page), playing: playing, position: position, updatedAt: updatedAt) { ratio in _ = onAspectRatio(KotlinFloat(float: ratio)) }
    }
    func disposeMaterial(view: UIView) { (view as? MaterialView)?.dispose() }

    func read(key: String, fallback: String) -> String {
        guard key.hasPrefix("session:") else { return UserDefaults.standard.string(forKey: key) ?? fallback }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.woongjin.thinkmeet", kSecAttrAccount as String: key, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return fallback }
        return String(data: data, encoding: .utf8) ?? fallback
    }
    func write(key: String, value: String) {
        guard key.hasPrefix("session:") else { UserDefaults.standard.set(value, forKey: key); return }
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "com.woongjin.thinkmeet", kSecAttrAccount as String: key]
        SecItemDelete(query as CFDictionary)
        if !value.isEmpty {
            var attributes = query
            attributes[kSecValueData as String] = Data(value.utf8)
            attributes[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            SecItemAdd(attributes as CFDictionary, nil)
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
    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) { _ = pickerCompletion?(nil, nil, nil, KotlinLong(longLong: 0)); pickerCompletion = nil }
    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else { documentPickerWasCancelled(controller); return }
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
    func roomDidReconnect(_ room: Room) { emitState() }
    func roomIsReconnecting(_ room: Room) { emitState() }
    func room(_ room: Room, participantDidConnect participant: RemoteParticipant) { emitState() }
    func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) { emitState() }
    func room(_ room: Room, didUpdateSpeakingParticipants participants: [Participant]) { emitState() }
    func room(_ room: Room, participant: Participant, trackPublication: TrackPublication, didUpdateIsMuted isMuted: Bool) { emitState() }
    func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) { emitState() }
    func room(_ room: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) { emitState() }
    func room(_ room: Room, participant: LocalParticipant, didPublishTrack publication: LocalTrackPublication) {
        emitState()
        if publication.source == .screenShareVideo { Task { @MainActor in await startAppAudio() } }
    }
    func room(_ room: Room, participant: LocalParticipant, didUnpublishTrack publication: LocalTrackPublication) {
        emitState()
        if publication.source == .screenShareVideo { Task { @MainActor in await stopAppAudio() } }
    }
    func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        DispatchQueue.main.async {
            self.pictureInPicture.update(enabled: false, target: nil)
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
    case permission(String), fileSize
    var errorDescription: String? {
        switch self {
        case .permission(let name): return "설정에서 \(name) 권한을 허용해 주세요."
        case .fileSize: return "PDF는 50MB, MP4는 500MB까지 선택할 수 있어요."
        }
    }
}
