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

    // MARK: - Rollout tail decoding

    // A byte-offset tail read lands at an arbitrary byte, so with CJK content
    // the window routinely begins mid-character. String(data:encoding:.utf8) is
    // strict and returns nil for the WHOLE buffer, which made Codex usage vanish
    // entirely (no gauges, no error) whenever the split happened to hit a
    // multi-byte character. Node's toString('utf8') is lenient, so only the
    // Swift daemon showed it.
    func testDecodeRolloutTailRecoversFromSplitMultibyteCharacter() throws {
        let line = #"{"type":"event_msg","payload":{"rate_limits":{"primary":{"used_percent":90,"window_minutes":10080}}}}"#
        // "한글" ahead of the payload so the tail can be cut mid-character.
        var full = Data("앞선 한글 로그 줄\n".utf8)
        full.append(Data((line + "\n").utf8))

        // Cut one byte into the leading multi-byte character.
        let cut = full[1...]
        XCTAssertNil(String(data: cut, encoding: .utf8),
                     "precondition: a mid-character cut must defeat strict decoding")

        let text = try XCTUnwrap(UsageAPIClient.decodeRolloutTail(cut, seekedPastStart: true))
        let parsed = try XCTUnwrap(UsageAPIClient.parseCodexRateLimits(text),
                                   "rate limits must survive a mid-character cut")
        XCTAssertEqual(parsed.primary?.windowMinutes, 10080)
        XCTAssertEqual(parsed.primary?.usedPercent, 90)
    }

    // Reading from offset 0 is a whole-file read: there is no partial head line
    // to drop, so the first line must be preserved.
    func testDecodeRolloutTailKeepsFirstLineWhenNotSeeked() throws {
        let data = Data("{\"a\":1}\n{\"b\":2}\n".utf8)
        let text = try XCTUnwrap(UsageAPIClient.decodeRolloutTail(data, seekedPastStart: false))
        XCTAssertTrue(text.hasPrefix("{\"a\":1}"))
    }
}
#endif
