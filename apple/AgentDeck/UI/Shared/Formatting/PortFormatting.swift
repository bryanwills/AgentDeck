// PortFormatting.swift — locale-safe port number rendering
//
// SwiftUI `Text(_:)` and Swift's own `String(describing:)` apply
// locale-aware number formatting to `BinaryInteger` values, which in locales
// like ko-KR inserts a thousands separator (":9,120" instead of ":9120").
// That is wrong for TCP port numbers — they are identifiers, not quantities.
// Every port render path must go through `portString(_:)` or wrap the
// interpolation in `Text(verbatim:)`.

import Foundation

/// Render a port number without any locale-aware formatting.
///
/// Use at every site that displays a TCP port, whether the destination is
/// a `String` (interpolation) or a SwiftUI `Text(verbatim:)`.
@inlinable
func portString(_ port: some BinaryInteger) -> String {
    String(UInt64(port))
}
