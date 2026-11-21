import AVFoundation
import UIKit

final class WorksheetCameraView: UIView, AVCapturePhotoCaptureDelegate {
    private let session = AVCaptureSession()
    private let output = AVCapturePhotoOutput()
    private static let captureQueue = DispatchQueue(label: "com.woongjin.thinkmeet.worksheet-camera")
    private var queue: DispatchQueue { Self.captureQueue }
    private let onReady: (String?) -> Void
    private var disposed = false
    private var rotation: AVCaptureDevice.RotationCoordinator?
    private var rotationObserver: NSKeyValueObservation?
    private var cameraObservers: [NSObjectProtocol] = []

    // Read and written on the capture queue.
    private var pending: ((Data?, String?) -> Void)?
    private var processedPhoto: Data?
    private var stopping = false

    override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
    private var preview: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }

    init(onReady: @escaping (String?) -> Void) {
        self.onReady = onReady
        super.init(frame: .zero)
        preview.videoGravity = .resizeAspectFill
        preview.session = session
        cameraObservers = [AVCaptureSession.wasInterruptedNotification, AVCaptureSession.interruptionEndedNotification,
                           AVCaptureSession.runtimeErrorNotification].map { name in
            NotificationCenter.default.addObserver(forName: name, object: session, queue: .main) { [weak self] notice in
                guard let self, !self.disposed else { return }
                self.onReady(notice.name == AVCaptureSession.interruptionEndedNotification ? nil : "카메라 사용이 중단됐어요.")
            }
        }
        DispatchQueue.main.async { [weak self] in self?.authorize() }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func authorize() {
        guard !disposed else { return }
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                ?? AVCaptureDevice.default(for: .video) else {
            onReady("이 기기에서 카메라를 사용할 수 없어요.")
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            start(device: device)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
                DispatchQueue.main.async {
                    guard let self, !self.disposed else { return }
                    if allowed { self.start(device: device) }
                    else { self.onReady("설정에서 카메라 권한을 허용해 주세요.") }
                }
            }
        default:
            onReady("설정에서 카메라 권한을 허용해 주세요.")
        }
    }

    private func start(device: AVCaptureDevice) {
        let coordinator = AVCaptureDevice.RotationCoordinator(device: device, previewLayer: preview)
        rotation = coordinator
        rotationObserver = coordinator.observe(\.videoRotationAngleForHorizonLevelPreview, options: [.new]) { [weak self] _, _ in
            DispatchQueue.main.async { self?.updatePreviewRotation() }
        }
        queue.async { [weak self] in
            guard let self, !self.stopping else { return }
            guard let input = try? AVCaptureDeviceInput(device: device), self.configure(input: input) else {
                DispatchQueue.main.async { if !self.disposed { self.onReady("카메라를 열지 못했어요.") } }
                return
            }
            self.session.startRunning()
            let error = self.session.isRunning ? nil : "카메라를 열지 못했어요."
            DispatchQueue.main.async {
                guard !self.disposed else { return }
                self.updatePreviewRotation()
                self.onReady(error)
            }
        }
    }

    private func configure(input: AVCaptureDeviceInput) -> Bool {
        session.beginConfiguration()
        defer { session.commitConfiguration() }
        session.sessionPreset = .photo
        guard session.canAddInput(input), session.canAddOutput(output) else { return false }
        session.addInput(input)
        session.addOutput(output)
        return true
    }

    private func updatePreviewRotation() {
        guard let angle = rotation?.videoRotationAngleForHorizonLevelPreview,
              let connection = preview.connection, connection.isVideoRotationAngleSupported(angle) else { return }
        connection.videoRotationAngle = angle
    }

    func capturePhoto(completion: @escaping (Data?, String?) -> Void) {
        let angle = rotation?.videoRotationAngleForHorizonLevelCapture
        queue.async { [weak self] in
            guard let self, self.session.isRunning, !self.stopping, self.pending == nil else {
                DispatchQueue.main.async { completion(nil, "촬영하지 못했어요. 다시 시도해 주세요.") }
                return
            }
            if let angle, let connection = self.output.connection(with: .video), connection.isVideoRotationAngleSupported(angle) {
                connection.videoRotationAngle = angle
            }
            self.pending = completion
            self.processedPhoto = nil
            self.output.capturePhoto(with: AVCapturePhotoSettings(), delegate: self)
        }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
        let bytes = error == nil ? photo.fileDataRepresentation() : nil
        queue.async { self.processedPhoto = bytes }
    }

    func photoOutput(_ output: AVCapturePhotoOutput, didFinishCaptureFor resolvedSettings: AVCaptureResolvedPhotoSettings, error: Error?) {
        queue.async {
            let bytes = error == nil ? self.processedPhoto : nil
            let completion = self.pending
            self.pending = nil
            self.processedPhoto = nil
            DispatchQueue.main.async {
                guard !self.disposed else { return }
                let jpeg = bytes.flatMap { UIImage(data: $0) }.flatMap { MaterialView.noteJPEG(image: $0) }
                completion?(jpeg, jpeg == nil ? "학습지 사진을 열 수 없어요." : nil)
            }
        }
    }

    func stop() {
        disposed = true
        cameraObservers.forEach { NotificationCenter.default.removeObserver($0) }
        cameraObservers.removeAll()
        rotationObserver = nil
        rotation = nil
        preview.session = nil
        queue.async {
            self.stopping = true
            self.pending = nil
            self.processedPhoto = nil
            if self.session.isRunning { self.session.stopRunning() }
        }
    }
}
