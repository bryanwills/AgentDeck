// UsageAPIClientThreadingTests.swift — concurrency regression for
// readRawCodexAuthStatus().
//
// Bug context: the Apr 13 crash (_CFRelease.cold.1 during "outlined assign
// with take of CodexAuthStatus?") stemmed from `getpwuid()` returning a
// pointer into a thread-shared buffer. Main thread + ESP32 heartbeat
// background thread both entered `codexAuthStatus` and the returned
// optional corrupted under concurrent ARC cleanup. Fix was (a) resolve
// the home directory once via `getpwuid_r`, and (b) serialize the getter
// through a DispatchQueue.
//
// This test fans out many concurrent reads; without the fix the harness
// crashes instead of failing cleanly, so "test finishes" is the pass
// condition.

#if os(macOS)
import XCTest
@testable import AgentDeck

final class UsageAPIClientThreadingTests: XCTestCase {
    func testCodexAuthStatusConcurrentReadsDoNotCrash() {
        let iterations = 500
        let client = UsageAPIClient.shared

        let expectation = self.expectation(description: "concurrent reads complete")
        expectation.expectedFulfillmentCount = iterations

        DispatchQueue.concurrentPerform(iterations: iterations) { _ in
            // The value is allowed to be nil (no Codex auth file on CI);
            // what we care about is that the call returns rather than
            // crashing in ARC cleanup.
            _ = client.codexAuthStatus
            expectation.fulfill()
        }

        wait(for: [expectation], timeout: 10)
    }
}
#endif
