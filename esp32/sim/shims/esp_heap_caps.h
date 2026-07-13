#pragma once
// Host shim for <esp_heap_caps.h> — maps the capability-aware ESP allocators
// used by util/memory.h onto the plain host heap, and reports generous free
// sizes so no OOM fallback path is taken during host rendering.
#include <cstddef>
#include <cstdlib>

#define MALLOC_CAP_INTERNAL 0
#define MALLOC_CAP_SPIRAM   0
#define MALLOC_CAP_DEFAULT  0
#define MALLOC_CAP_8BIT     0
#define MALLOC_CAP_DMA      0

inline void* heap_caps_malloc(size_t n, unsigned) { return std::malloc(n); }
inline void* heap_caps_calloc(size_t c, size_t s, unsigned) { return std::calloc(c, s); }
inline void* heap_caps_realloc(void* p, size_t n, unsigned) { return std::realloc(p, n); }
inline void  heap_caps_free(void* p) { std::free(p); }
inline size_t heap_caps_get_free_size(unsigned) { return 8u * 1024u * 1024u; }
inline size_t heap_caps_get_largest_free_block(unsigned) { return 8u * 1024u * 1024u; }
