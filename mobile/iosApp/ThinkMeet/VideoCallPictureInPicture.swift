import AVKit
import UIKit
import LiveKit
import ThinkMeet

/// AVKit presents a second renderer of the existing RTC track. The inline renderer never moves.
@MainActor
final class VideoCallPictureInPicture: NSObject, @MainActor AVPictureInPictureControllerDelegate {
    private let sourceView: () -> UIView?
    private let videoTrack: (PipVideoTarget?) -> VideoTrack?
    private let didCloseCall: () -> Void
    private var listener: ((PictureInPictureState) -> Void)?
    private var controller: AVPictureInPictureController?
    private var contentController: AVPictureInPictureVideoCallViewController?
    private var renderer: VideoView?
    private var placeholder: UILabel?
    private var possibleObservation: NSKeyValueObservation?
    private var entryTimeout: Task<Void, Never>?
    private var pendingEntry: ((String?) -> Void)?
    private var enabled = false
    private var target: PipVideoTarget?
    private var presentationStarted = false
    private var programmaticStop = false
    private var restoring = false
    private var requestedStart = false
    private var appWasBackgrounded = false
    private var returnedFromBackground = false
    private var supported: Bool { AVPictureInPictureController.isPictureInPictureSupported() }
    private var state = PictureInPictureState(supported: false, active: false, transitioning: false, closedByUser: false, error: nil)

    init(sourceView: @escaping () -> UIView?, videoTrack: @escaping (PipVideoTarget?) -> VideoTrack?, didCloseCall: @escaping () -> Void) {
        self.sourceView = sourceView
        self.videoTrack = videoTrack
        self.didCloseCall = didCloseCall
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(prepareForBackground), name: UIApplication.willResignActiveNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(didEnterBackground), name: UIApplication.didEnterBackgroundNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(willEnterForeground), name: UIApplication.willEnterForegroundNotification, object: nil)
        publish(active: false, transitioning: false)
    }

    deinit { NotificationCenter.default.removeObserver(self) }

    @objc private func prepareForBackground() {
        guard enabled, !state.closedByUser else { return }
        prepareIfPossible()
        refreshTrack()
    }

    @objc private func didEnterBackground() { appWasBackgrounded = true }

    @objc private func willEnterForeground() {
        guard appWasBackgrounded else { return }
        appWasBackgrounded = false
        guard enabled, controller?.isPictureInPictureActive == true || presentationStarted || requestedStart else { return }
        // Opening the app icon/App Switcher is restoration even when AVKit omits its restore delegate.
        returnedFromBackground = true
        restoring = true
        programmaticStop = true
        controller?.stopPictureInPicture()
    }

    func listen(_ listener: @escaping (PictureInPictureState) -> Void) {
        self.listener = listener
        listener(state)
    }

    func update(enabled: Bool, target: PipVideoTarget?) {
        self.enabled = enabled
        self.target = target
        if !enabled {
            // Preserve a system-close event until shared UI has performed participant-only leave.
            stop(resetClosedByUser: false)
            return
        }
        guard !state.closedByUser else { return }
        prepareIfPossible()
        refreshTrack()
        controller?.canStartPictureInPictureAutomaticallyFromInline = true
    }

    func refreshSource() {
        guard enabled, !state.closedByUser else { return }
        prepareIfPossible()
    }

    func refreshTrack() {
        guard enabled, !state.closedByUser else { return }
        let track = videoTrack(target)
        if renderer?.track !== track { renderer?.track = track }
        renderer?.layoutMode = target?.screen == true ? .fit : .fill
        renderer?.isHidden = track == nil
        placeholder?.isHidden = track != nil
        let requestedRatio = Double(target?.aspectRatio ?? 16 / 9)
        let ratio = requestedRatio.isFinite ? min(max(requestedRatio, 0.2), 5) : 16 / 9
        contentController?.preferredContentSize = CGSize(width: 640, height: 640 / ratio)
    }

    func enter(completion: @escaping (String?) -> Void) {
        guard supported else { completion("이 기기는 시스템 화면 속 화면을 지원하지 않아요."); return }
        guard enabled else { completion("수업에 연결된 뒤 화면 속 화면을 사용할 수 있어요."); return }
        if controller?.isPictureInPictureActive == true { completion(nil); return }
        guard pendingEntry == nil else { completion("화면 속 화면을 준비하고 있어요."); return }
        programmaticStop = false
        restoring = false
        requestedStart = false
        returnedFromBackground = false
        publish(active: false, transitioning: true, closedByUser: false)
        prepareIfPossible()
        guard controller != nil else {
            let message = "수업 화면이 표시된 뒤 다시 시도해 주세요."
            publish(active: false, transitioning: false, error: message)
            completion(message)
            return
        }
        refreshTrack()
        pendingEntry = completion
        entryTimeout?.cancel()
        entryTimeout = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 5_000_000_000)
            guard !Task.isCancelled, let self, self.pendingEntry != nil else { return }
            let message = "시스템이 화면 속 화면을 시작하지 못했어요. 기기 설정을 확인한 뒤 다시 시도해 주세요."
            self.publish(active: false, transitioning: false, error: message)
            self.finishEntry(message)
        }
        startWhenPossible()
    }

    func close() {
        enabled = false
        target = nil
        stop(resetClosedByUser: true)
    }

    private func prepareIfPossible() {
        guard controller == nil, supported, enabled, let source = sourceView(), source.window != nil,
              !source.isHidden, source.bounds.width > 0, source.bounds.height > 0 else { return }
        let content = AVPictureInPictureVideoCallViewController()
        content.loadViewIfNeeded()
        content.view.backgroundColor = .black
        let video = VideoView()
        video.translatesAutoresizingMaskIntoConstraints = false
        content.view.addSubview(video)
        NSLayoutConstraint.activate([
            video.leadingAnchor.constraint(equalTo: content.view.leadingAnchor),
            video.trailingAnchor.constraint(equalTo: content.view.trailingAnchor),
            video.topAnchor.constraint(equalTo: content.view.topAnchor),
            video.bottomAnchor.constraint(equalTo: content.view.bottomAnchor),
        ])
        let label = UILabel()
        label.text = "수업 진행 중"
        label.textColor = .white
        label.textAlignment = .center
        label.adjustsFontForContentSizeCategory = true
        label.font = .preferredFont(forTextStyle: .body)
        label.translatesAutoresizingMaskIntoConstraints = false
        content.view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: content.view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: content.view.centerYAnchor),
            label.leadingAnchor.constraint(greaterThanOrEqualTo: content.view.leadingAnchor, constant: 12),
            label.trailingAnchor.constraint(lessThanOrEqualTo: content.view.trailingAnchor, constant: -12),
        ])
        let contentSource = AVPictureInPictureController.ContentSource(activeVideoCallSourceView: source, contentViewController: content)
        let pip = AVPictureInPictureController(contentSource: contentSource)
        pip.delegate = self
        pip.canStartPictureInPictureAutomaticallyFromInline = enabled
        controller = pip
        contentController = content
        renderer = video
        placeholder = label
        possibleObservation = pip.observe(\.isPictureInPicturePossible, options: [.new]) { [weak self] _, _ in
            Task { @MainActor in self?.startWhenPossible() }
        }
        refreshTrack()
    }

    private func startWhenPossible() {
        guard pendingEntry != nil, enabled, !programmaticStop, !requestedStart, let controller,
              controller.isPictureInPicturePossible, !controller.isPictureInPictureActive else { return }
        requestedStart = true
        controller.startPictureInPicture()
    }

    private func stop(resetClosedByUser: Bool) {
        programmaticStop = true
        requestedStart = false
        controller?.canStartPictureInPictureAutomaticallyFromInline = false
        finishEntry("화면 속 화면이 닫혔어요.")
        if controller?.isPictureInPictureActive == true || presentationStarted {
            controller?.stopPictureInPicture()
        } else { releasePresentation() }
        publish(active: controller?.isPictureInPictureActive == true, transitioning: false,
                closedByUser: resetClosedByUser ? false : state.closedByUser)
    }

    private func releasePresentation() {
        possibleObservation = nil
        // Apple requires clearing the content source once the call ends, preventing later auto-entry.
        controller?.canStartPictureInPictureAutomaticallyFromInline = false
        controller?.contentSource = nil
        controller?.delegate = nil
        controller = nil
        renderer?.track = nil
        renderer = nil
        placeholder = nil
        contentController = nil
        presentationStarted = false
    }

    private func finishEntry(_ error: String?) {
        entryTimeout?.cancel()
        entryTimeout = nil
        let completion = pendingEntry
        pendingEntry = nil
        completion?(error)
    }

    private func publish(active: Bool, transitioning: Bool, closedByUser: Bool? = nil, error: String? = nil) {
        state = PictureInPictureState(supported: supported, active: active, transitioning: transitioning,
                                     closedByUser: closedByUser ?? state.closedByUser, error: error)
        listener?(state)
    }

    func pictureInPictureControllerWillStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        guard enabled else { pictureInPictureController.stopPictureInPicture(); return }
        guard !returnedFromBackground else {
            programmaticStop = true
            pictureInPictureController.stopPictureInPicture()
            return
        }
        programmaticStop = false
        restoring = false
        requestedStart = true
        publish(active: false, transitioning: true)
    }

    func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        if !enabled || programmaticStop || returnedFromBackground {
            programmaticStop = true
            pictureInPictureController.stopPictureInPicture()
            return
        }
        presentationStarted = true
        publish(active: true, transitioning: false, closedByUser: false)
        finishEntry(nil)
    }

    func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        presentationStarted = false
        requestedStart = false
        let message = "화면 속 화면을 시작하지 못했어요: \(error.localizedDescription)"
        publish(active: false, transitioning: false, error: message)
        finishEntry(message)
    }

    func pictureInPictureControllerWillStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        publish(active: true, transitioning: true)
    }

    func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
        let foregroundReturn = returnedFromBackground || (appWasBackgrounded && UIApplication.shared.applicationState != .background)
        let closedByUser = presentationStarted && !programmaticStop && !restoring && !foregroundReturn
        presentationStarted = false
        requestedStart = false
        if closedByUser { enabled = false }
        publish(active: false, transitioning: false, closedByUser: state.closedByUser || closedByUser)
        if !enabled { releasePresentation() }
        programmaticStop = false
        restoring = false
        returnedFromBackground = false
        // Never call lesson.end: closing a system window leaves only this participant.
        if closedByUser { didCloseCall() }
    }

    func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController,
                                   restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        restoring = true
        let source = sourceView()
        source?.window?.rootViewController?.view.layoutIfNeeded()
        publish(active: state.active, transitioning: true, closedByUser: false)
        // The common Meeting route and room remain alive; AVKit foregrounds the existing scene.
        completionHandler(source != nil && enabled)
    }
}
