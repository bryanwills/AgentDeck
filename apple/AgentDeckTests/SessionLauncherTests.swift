import XCTest
#if os(macOS)
@testable import AgentDeck

final class SessionLauncherTests: XCTestCase {
    func testDaemonPromotionUsesCurrentFallbackPort() {
        XCTAssertEqual(
            DaemonService.promotionTargetPort(currentPort: 9124, effectivePort: 9120),
            9124
        )
    }

    func testDaemonPromotionFallsBackToConfiguredPortWhenDisconnected() {
        XCTAssertEqual(
            DaemonService.promotionTargetPort(currentPort: 0, effectivePort: 9120),
            9120
        )
    }

    func testResolvedSessionOverrideTracksActualBoundPort() {
        XCTAssertEqual(
            DaemonService.resolvedSessionOverridePort(configuredPort: 9120, actualPort: 9124),
            9124
        )
        XCTAssertNil(
            DaemonService.resolvedSessionOverridePort(configuredPort: 9124, actualPort: 9124)
        )
    }
}
#endif
