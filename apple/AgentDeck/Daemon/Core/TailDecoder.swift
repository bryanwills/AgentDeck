// TailDecoder.swift — byte-offset tail reads → text, without losing the window
// to a split character.
//
// Several readers here tail a large append-only JSONL file (Codex rollouts,
// Claude transcripts, log files) by seeking to `size - maxBytes`. That offset is
// an arbitrary byte, so the window essentially always begins mid-line — and with
// CJK content, mid-CHARACTER.
//
// `String(data:encoding:.utf8)` is STRICT: a single split character makes it
// return nil for the ENTIRE buffer. Callers then see "file has nothing in it"
// rather than "the first line was clipped", so a 256 KB window of perfectly good
// records is discarded silently, with no error anywhere. That is what made Codex
// usage gauges vanish while `~/.codex` was readable and the rollout held 203
// `rate_limits` records.
//
// Node's `buf.toString('utf8')` is lenient (invalid bytes → U+FFFD), which is
// why the Node daemon never showed this and only the Swift one did.
//
// These files are JSONL, so dropping the partial head line is the correct fix
// rather than a patch: it restores a valid UTF-8 boundary AND discards a line
// that could never have been parsed anyway. The lenient decode is a backstop for
// a tail that is still not valid UTF-8 (e.g. a single line longer than the
// window, so there is no newline to align to).
import Foundation

enum TailDecoder {
    /// - Parameter seekedPastStart: whether the read began at a non-zero offset.
    ///   When false this is a whole-file read and the first line is real data,
    ///   so it must be preserved.
    static func decode(_ data: Data, seekedPastStart: Bool) -> String? {
        var slice = data
        if seekedPastStart, let newline = slice.firstIndex(of: 0x0A) {
            slice = slice[slice.index(after: newline)...]
        }
        if slice.isEmpty { return nil }
        return String(data: slice, encoding: .utf8) ?? String(decoding: slice, as: UTF8.self)
    }
}
