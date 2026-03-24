*** Settings ***
Documentation       ESP32 performance benchmarks (BDD style).
...                 Requires physical ESP32 device connected via USB.
...                 Measures boot time, serial latency, throughput,
...                 and records firmware/heap metrics per board.
Resource            ../resources/bdd_keywords.robot
Force Tags          hw    perf
Suite Teardown      Disconnect Device

*** Test Cases ***
# ═══════════════════════════════════════════════════════════════════
# Boot Time
# ═══════════════════════════════════════════════════════════════════

Box 86 Boot Time
    [Template]    Boot Time Scenario
    box_86

IPS 3.5 Boot Time
    [Template]    Boot Time Scenario
    ips_35

Round AMOLED Boot Time
    [Template]    Boot Time Scenario
    round_amoled

Ulanzi TC001 Boot Time
    [Template]    Boot Time Scenario
    ulanzi_tc001

# ═══════════════════════════════════════════════════════════════════
# Serial Response Latency
# ═══════════════════════════════════════════════════════════════════

Box 86 Response Latency
    [Template]    Response Latency Scenario
    box_86

IPS 3.5 Response Latency
    [Template]    Response Latency Scenario
    ips_35

Round AMOLED Response Latency
    [Template]    Response Latency Scenario
    round_amoled

Ulanzi TC001 Response Latency
    [Template]    Response Latency Scenario
    ulanzi_tc001

# ═══════════════════════════════════════════════════════════════════
# Burst Throughput
# ═══════════════════════════════════════════════════════════════════

Box 86 Burst Throughput
    [Template]    Burst Throughput Scenario
    box_86

IPS 3.5 Burst Throughput
    [Template]    Burst Throughput Scenario
    ips_35

Round AMOLED Burst Throughput
    [Template]    Burst Throughput Scenario
    round_amoled

Ulanzi TC001 Burst Throughput
    [Template]    Burst Throughput Scenario
    ulanzi_tc001

# ═══════════════════════════════════════════════════════════════════
# Firmware Metrics (recorded, soft thresholds)
# ═══════════════════════════════════════════════════════════════════

Box 86 Firmware Metrics
    [Template]    Firmware Metrics Scenario
    box_86

IPS 3.5 Firmware Metrics
    [Template]    Firmware Metrics Scenario
    ips_35

Round AMOLED Firmware Metrics
    [Template]    Firmware Metrics Scenario
    round_amoled

Ulanzi TC001 Firmware Metrics
    [Template]    Firmware Metrics Scenario
    ulanzi_tc001

*** Keywords ***
Boot Time Scenario
    [Documentation]    Measure time from serial open to boot marker.
    [Arguments]    ${board}
    Given the ESP32 device "${board}" is connected and booted
    Then the boot time should be under "30000" ms

Response Latency Scenario
    [Documentation]    Measure device_info request→response round-trip.
    [Arguments]    ${board}
    Given the ESP32 device "${board}" is connected and booted
    When I send a device info request
    Then the serial response latency should be under "500" ms

Burst Throughput Scenario
    [Documentation]    Measure throughput of rapid message burst.
    [Arguments]    ${board}
    Given the ESP32 device "${board}" is connected and booted
    Then the burst throughput of "50" messages should exceed "100" msg/s
    And the device should still be responsive

Firmware Metrics Scenario
    [Documentation]    Record firmware size and boot heap for comparison.
    [Arguments]    ${board}
    Given the "${board}" firmware is built if not exists
    And the ESP32 device "${board}" is connected and booted
    Then the firmware size for "${board}" should be recorded
    And the heap at boot should be recorded
