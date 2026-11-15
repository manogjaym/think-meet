import SwiftUI
import ThinkMeet

@main
struct ThinkMeetApp: App {
    private let bridge = NativeBridge()
    init() { IosPlatform.shared.bridge = bridge }
    var body: some Scene {
        WindowGroup {
            SharedApp(bridge: bridge).ignoresSafeArea()
                .onOpenURL { AppLinks.shared.receive(url: $0.absoluteString) }
        }
    }
}
private struct SharedApp: UIViewControllerRepresentable {
    let bridge: NativeBridge
    func makeUIViewController(context: Context) -> UIViewController {
        let controller = IosPlatformKt.MainViewController()
        controller.loadViewIfNeeded()
        bridge.setCallRootView(controller.view)
        return controller
    }
    func updateUIViewController(_ uiViewController: UIViewController, context: Context) {}
}
