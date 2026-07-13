#pragma once
// Host shim for <freertos/semphr.h> — no-op mutex primitives. Single-threaded
// host rendering means every take/give trivially succeeds.
#include "FreeRTOS.h"

inline SemaphoreHandle_t xSemaphoreCreateMutex() { return (SemaphoreHandle_t)1; }
inline BaseType_t xSemaphoreTake(SemaphoreHandle_t, TickType_t) { return pdTRUE; }
inline BaseType_t xSemaphoreGive(SemaphoreHandle_t) { return pdTRUE; }
inline void vSemaphoreDelete(SemaphoreHandle_t) {}
