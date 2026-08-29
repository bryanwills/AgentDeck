// HTTPServerParseTests.swift — request-line parsing contracts.
//
// Regression gate for query-string form-decoding: the Work-board search box
// sends URLSearchParams output (`q=fix+bug`, percent-escaped Korean), which
// Node's url.searchParams decodes before the SQL LIKE. The Swift daemon's
// parseHTTPRequest stored the raw bytes, so the identical dashboard search
// silently matched nothing whenever this daemon owned the port.

#if os(macOS)
import XCTest
@testable import AgentDeck

final class HTTPServerParseTests: XCTestCase {

    private func parse(_ target: String) -> HTTPServer.HTTPRequest {
        let raw = Data("GET \(target) HTTP/1.1\r\nHost: x\r\n\r\n".utf8)
        return HTTPServer.parseHTTPRequest(raw, remoteIP: "127.0.0.1")
    }

    func testQueryParamsFormDecodePlusAndPercent() {
        let req = parse("/apme/tasks?q=fix+bug&project=my%20proj&limit=50")
        XCTAssertEqual(req.path, "/apme/tasks")
        XCTAssertEqual(req.queryParams["q"], "fix bug")
        XCTAssertEqual(req.queryParams["project"], "my proj")
        XCTAssertEqual(req.queryParams["limit"], "50")
    }

    func testQueryParamsDecodeKorean() {
        // URLSearchParams('q=작업 정리') → q=%EC%9E%91%EC%97%85+%EC%A0%95%EB%A6%AC
        let req = parse("/apme/tasks?q=%EC%9E%91%EC%97%85+%EC%A0%95%EB%A6%AC")
        XCTAssertEqual(req.queryParams["q"], "작업 정리")
    }

    func testMalformedEscapeKeepsRawValue() {
        // A broken escape must not drop the parameter — keep the raw string.
        let req = parse("/x?bad=100%zz")
        XCTAssertEqual(req.queryParams["bad"], "100%zz")
    }

    func testPlainTokenValueUnchanged() {
        // Hex pairing tokens carry no '+' or '%' — decoding is a no-op.
        let req = parse("/apme/runs?token=abc123DEF")
        XCTAssertEqual(req.queryParams["token"], "abc123DEF")
    }
}
#endif
