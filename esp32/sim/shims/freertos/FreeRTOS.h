#pragma once
// Host shim for <freertos/FreeRTOS.h>. The terrarium render surface never takes
// the state mutex itself — it only needs the SemaphoreHandle_t type so that
// state/agent_state.h (which declares `extern SemaphoreHandle_t g_stateMutex`)
// parses on the host toolchain.
#include <cstdint>

typedef void*    SemaphoreHandle_t;
typedef uint32_t TickType_t;
typedef int      BaseType_t;

#define pdTRUE          1
#define pdFALSE         0
#define portMAX_DELAY   0xFFFFFFFFu
#define pdMS_TO_TICKS(ms) ((TickType_t)(ms))
