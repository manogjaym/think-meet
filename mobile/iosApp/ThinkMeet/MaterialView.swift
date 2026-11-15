import UIKit
import PDFKit
import AVFoundation

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
                let player = AVPlayer(playerItem: AVPlayerItem(asset: asset))
                videoLayer.player = player
                observer = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 2, preferredTimescale: 600), queue: .main) { [weak self] _ in
                    guard let self else { return }
                    let size = player.currentItem?.presentationSize ?? .zero
                    if size.height > 0 { self.aspect?(Float(size.width / size.height)) }
                    if self.playing, abs(player.currentTime().seconds - self.expectedPosition()) > 1.5 {
                        player.seek(to: CMTime(seconds: self.expectedPosition(), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
                    }
                }
            }
        }
        if type == "document" { showPage() }
        else if lastUpdate != updatedAt {
            lastUpdate = updatedAt
            videoLayer.player?.seek(to: CMTime(seconds: expectedPosition(), preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: .zero)
            if playing { videoLayer.player?.play() } else { videoLayer.player?.pause() }
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
    }
    deinit { dispose() }
}
