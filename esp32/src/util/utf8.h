#pragma once
// UTF-8-safe truncation helpers. Byte-sized firmware buffers (TimelineEntry.raw,
// SessionInfo.question, …) are filled with strncpy from daemon JSON; a cut that
// lands mid-sequence leaves a broken trailing glyph (한글/CJK renders as garbage
// on LVGL and e-ink). Every strncpy of daemon-supplied text should be followed
// by utf8TrimEnd(), and manual compositions should back off with utf8Boundary().
//
// C++11-safe (shared by pioarduino C++20/23 envs, the `led8x32` espressif32
// env, and the host simulator).
#include <stddef.h>
#include <stdint.h>

namespace Utf8 {

// Largest cut point ≤ n that does not split a multi-byte sequence in s.
inline size_t utf8Boundary(const char* s, size_t n) {
    while (n > 0 && ((uint8_t)s[n] & 0xC0) == 0x80) n--;
    // n now points at a lead (or ASCII) byte — verify the sequence that starts
    // there actually ends before the cut; a lead byte whose continuation bytes
    // were themselves truncated must go too.
    if (n > 0) {
        size_t lead = n - 1;
        while (lead > 0 && ((uint8_t)s[lead] & 0xC0) == 0x80) lead--;
        uint8_t b = (uint8_t)s[lead];
        size_t needed = (b & 0xF8) == 0xF0 ? 4 : (b & 0xF0) == 0xE0 ? 3 : (b & 0xE0) == 0xC0 ? 2 : 1;
        if (lead + needed > n) n = lead;
    }
    return n;
}

// In-place: drop a trailing incomplete UTF-8 sequence left by a byte-truncating
// strncpy. No-op on well-formed endings.
inline void utf8TrimEnd(char* s) {
    size_t n = 0;
    while (s[n]) n++;
    s[utf8Boundary(s, n)] = '\0';
}

// Number of UTF-8 code points (lead/ASCII bytes) in s.
inline size_t utf8CharCount(const char* s) {
    size_t n = 0;
    for (; *s; s++) if (((uint8_t)*s & 0xC0) != 0x80) n++;
    return n;
}

}  // namespace Utf8
