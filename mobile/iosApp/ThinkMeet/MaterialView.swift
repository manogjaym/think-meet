import UIKit
import PDFKit
import AVFoundation
import CoreImage

/// Native authenticated PDF/MP4 renderer. A single PDF and video player are retained per active share.
final class MaterialView: UIView {
    private let pdfView = PDFView()
    private let videoLayer = AVPlayerLayer()
    private let errorLabel = UILabel()
    private var task: URLSessionDataTask?
    private var resourceURL = ""
    private var currentPage = 1
    private var playing = false
    private var position = 0.0
    private var anchor = Date()
    private var observer: Any?
    private var aspect: ((Float) -> Void)?
    private var lastUpdate = ""
    private var frameOutput: AVPlayerItemVideoOutput?
    private var lastFrame: (time: CMTime, buffer: CVPixelBuffer)?
    private var seeking = false
    private static let frameContext = CIContext()
    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .black
        pdfView.autoScales = true
        pdfView.displayMode = .singlePage
        pdfView.displayDirection = .vertical
        pdfView.isUserInteractionEnabled = false
        addSubview(pdfView)
        layer.addSublayer(videoLayer)
        videoLayer.videoGravity = .resizeAspect
        errorLabel.numberOfLines = 0
        errorLabel.textAlignment = .center
        errorLabel.textColor = .white
        addSubview(errorLabel)
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
    override func layoutSubviews() { super.layoutSubviews(); pdfView.frame = bounds; videoLayer.frame = bounds; errorLabel.frame = bounds.insetBy(dx: 16, dy: 16) }
    func update(url: String, cookie: String, type: String, page: Int, playing: Bool, position: Double, updatedAt: String, onAspectRatio: @escaping (Float) -> Void) {
        aspect = onAspectRatio
        currentPage = page
        self.playing = playing; self.position = position
        let parser = ISO8601DateFormatter(); parser.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        anchor = parser.date(from: updatedAt) ?? ISO8601DateFormatter().date(from: updatedAt) ?? Date()
        if resourceURL != url {
            dispose(); resourceURL = url; errorLabel.text = nil
            guard let resource = URL(string: url) else { return }
            pdfView.isHidden = type != "document"
            if type == "document" {
                var request = URLRequest(url: resource); request.setValue(cookie, forHTTPHeaderField: "Cookie")
                task = URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
                    DispatchQueue.main.async {
                        guard let self, self.resourceURL == url else { return }
                        guard let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status), let data, let document = PDFDocument(data: data) else {
                            self.errorLabel.text = "PDF 자료를 불러오지 못했어요. \(error?.localizedDescription ?? "")"; return
                        }
                        self.pdfView.document = document; self.showPage()
                    }
                }; task?.resume()
            } else {
                let cookies = cookie.split(separator: ";").compactMap { part -> HTTPCookie? in
                    let pair = part.trimmingCharacters(in: .whitespaces).split(separator: "=", maxSplits: 1)
                    guard pair.count == 2 else { return nil }
                    return HTTPCookie(properties: [.domain: resource.host ?? "", .path: "/", .name: String(pair[0]), .value: String(pair[1]), .secure: "TRUE"])
                }
                let asset = AVURLAsset(url: resource, options: [AVURLAssetHTTPCookiesKey: cookies])
                let item = AVPlayerItem(asset: asset)
                let output = AVPlayerItemVideoOutput(pixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
                item.add(output)
                frameOutput = output
                let player = AVPlayer(playerItem: item)
                videoLayer.player = player
                observer = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 2, preferredTimescale: 600), queue: .main) { [weak self] _ in
                    guard let self else { return }
                    let size = player.currentItem?.presentationSize ?? .zero
                    if size.height > 0 { self.aspect?(Float(size.width / size.height)) }
                    if self.playing, abs(player.currentTime().seconds - self.expectedPosition()) > 1.5 {
                        self.seek(player, to: self.expectedPosition())
                    }
                }
            }
        }
        if type == "document" { showPage() }
        else if lastUpdate != updatedAt {
            lastUpdate = updatedAt
            if let player = videoLayer.player { seek(player, to: expectedPosition()) }
            if playing { videoLayer.player?.play() } else { videoLayer.player?.pause() }
        }
    }
    private func seek(_ player: AVPlayer, to position: Double) {
        seeking = true
        lastFrame = nil
        player.seek(to: CMTime(seconds: position, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak player] _ in
            DispatchQueue.main.async {
                guard let self, let player, self.videoLayer.player === player else { return }
                self.seeking = false
            }
        }
    }

    func noteFrameReady(page: Int) -> Bool {
        if !pdfView.isHidden { return currentPage == page && pdfView.currentPage != nil }
        return !seeking && videoLayer.isReadyForDisplay && frameOutput != nil
    }

    func noteFrame(page: Int) -> Data? {
        guard noteFrameReady(page: page) else { return nil }
        if !pdfView.isHidden, let page = pdfView.currentPage {
            let box = page.bounds(for: .cropBox)
            guard box.width > 0, box.height > 0 else { return nil }
            let scale = 1600 / max(box.width, box.height)
            return Self.noteJPEG(image: page.thumbnail(of: CGSize(width: box.width * scale, height: box.height * scale), for: .cropBox))
        }
        guard let time = videoLayer.player?.currentTime(), let output = frameOutput else { return nil }
        if let buffer = output.copyPixelBuffer(forItemTime: time, itemTimeForDisplay: nil) { lastFrame = (time, buffer) }
        guard let lastFrame, abs(CMTimeGetSeconds(time - lastFrame.time)) < 0.25 else { return nil }
        return Self.noteJPEG(buffer: lastFrame.buffer, rotation: 0)
    }

    static func noteJPEG(buffer: CVPixelBuffer, rotation: Int) -> Data? {
        let orientation: CGImagePropertyOrientation = switch rotation { case 90: .right; case 180: .down; case 270: .left; default: .up }
        let frame = CIImage(cvPixelBuffer: buffer).oriented(orientation)
        guard let image = frameContext.createCGImage(frame, from: frame.extent) else { return nil }
        return noteJPEG(image: UIImage(cgImage: image))
    }

    static func noteJPEG(image: UIImage) -> Data? {
        guard image.size.width > 0, image.size.height > 0 else { return nil }
        let scale = min(image.scale, 2560 / max(image.size.width, image.size.height))
        let size = CGSize(width: max(1, image.size.width * scale), height: max(1, image.size.height * scale))
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        return UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.94) { context in
            UIColor.white.setFill(); context.fill(CGRect(origin: .zero, size: size))
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }

    private func showPage() {
        guard let document = pdfView.document, let page = document.page(at: min(max(currentPage - 1, 0), document.pageCount - 1)) else { return }
        pdfView.go(to: page)
        let box = page.bounds(for: .cropBox)
        if box.height > 0 { aspect?(Float(box.width / box.height)) }
    }
    private func expectedPosition() -> Double { max(0, position + (playing ? max(0, Date().timeIntervalSince(anchor)) : 0)) }
    func dispose() {
        task?.cancel(); task = nil
        if let observer { videoLayer.player?.removeTimeObserver(observer) }; observer = nil
        videoLayer.player?.pause(); videoLayer.player?.replaceCurrentItem(with: nil); videoLayer.player = nil
        pdfView.document = nil; resourceURL = ""; lastUpdate = ""
        frameOutput = nil; lastFrame = nil; seeking = false
    }
    deinit { dispose() }
}
