import LiveKit

/// ReplayKit extension forwards full-screen frames through the shared app group socket.
final class SampleHandler: LKSampleHandler, @unchecked Sendable {
    override var enableLogging: Bool { false }
}
