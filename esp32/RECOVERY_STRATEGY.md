# ESP32-S3 Native USB Recovery Strategy

이 문서는 기존 8개 실패 경로를 반복하지 않고, 남은 소프트웨어 가능성을 가장 빨리 판별하기 위한 결정 트리다.

## 새 관점

핵심 질문은 "300ms 안에 플래시할 수 있는가"가 아니다. 먼저 아래 두 가지를 분리해서 판별해야 한다.

1. `libusb`로 CDC 드라이버보다 먼저 디바이스를 열 수 있는가
2. CDC가 죽은 뒤에도 다른 USB 인터페이스, 특히 JTAG가 더 오래 살아남는가

이 둘이 둘 다 `아니오`면 소프트웨어만으로 복구할 가능성은 급격히 낮아진다. 그 시점에서는 GPIO0 패드 접근이나 UART0 어댑터로 바로 넘어가는 것이 맞다.

## 왜 이게 새로운가

- 지금까지 시도는 대부분 `/dev/cu.usbmodem*`가 생긴 뒤에 시리얼 계층에서 붙는 방식이었다.
- 하지만 macOS의 CDC 포트 생성은 이미 늦다.
- 반대로 JTAG는 `/dev/cu.*`와 무관하게 같은 USB 디바이스의 다른 인터페이스일 수 있으므로, 장치 레벨에서 먼저 붙어봐야 한다.
- 다만 이 보드가 죽는 원인이 `GPIO19/GPIO20` 재설정이라면, CDC와 JTAG가 둘 다 같은 `USB_SERIAL_JTAG` PHY를 쓰기 때문에 같이 죽을 가능성이 높다.

즉 접근 C는 "바로 성공할 가설"이라기보다, 소프트웨어 복구 가능성을 판별하는 가장 중요한 실험이다.

## 저장소에 추가한 프로브

`[usb_hotplug_probe.py](/Users/puritysb/github/AgentDeck/esp32/scripts/usb_hotplug_probe.py)`

이 스크립트는 `libusb` hotplug 콜백으로 Espressif `0x303a:0x1001`이 붙는 즉시:

- 장치를 연다
- 설정/인터페이스/엔드포인트 디스크립터를 출력한다
- 지정한 인터페이스들을 즉시 `claim`한다
- 분리될 때까지 살아 있던 시간을 ms 단위로 출력한다

이걸로 아래를 바로 알 수 있다.

- `/dev/cu.usbmodem*` 없이도 장치를 먼저 잡을 수 있는지
- 인터페이스 번호가 실제로 몇 개인지
- JTAG로 보이는 인터페이스가 따로 있는지
- 인터페이스를 잡고 있어도 전체 디바이스가 동일 시점에 사라지는지

`[usb_bulk_probe.py](/Users/puritysb/github/AgentDeck/esp32/scripts/usb_bulk_probe.py)`

이 스크립트는 한 단계 더 내려가서:

- `iface 1` CDC bulk endpoint
- `iface 2` vendor/JTAG bulk endpoint

를 attach 직후 claim하고, 각 엔드포인트가 실제로 언제까지 `bulk_transfer`를 받아주는지 측정한다.

이걸로 알 수 있는 건 다음이다.

- JTAG endpoint가 CDC보다 더 오래 살아 있는지
- CDC IN endpoint에 ROM 로그나 펌웨어 로그가 실제로 들어오는지
- bulk write가 가능한 창이 존재하는지

## 추천 절차

### 1. libusb 프로브 먼저 실행

```bash
python3 esp32/scripts/usb_hotplug_probe.py
```

그 상태에서 문제 보드를 USB에 다시 연결한다.

### 1-2. 엔드포인트 생존 시간 확인

```bash
python3 esp32/scripts/usb_bulk_probe.py
```

필요하면 쓰기 테스트까지:

```bash
python3 esp32/scripts/usb_bulk_probe.py --write
```

### 2. 결과 해석

#### 경우 A: 장치는 잡히지만 모든 인터페이스가 같이 200~300ms 내 사라짐

- 의미: CDC만의 문제가 아니라 USB PHY 전체가 앱에서 끊기고 있다는 뜻이다.
- 결론: 접근 C는 실질 복구 경로가 아니라 진단 경로로 끝난다.
- 다음 단계: GPIO0 패드 또는 UART0 어댑터로 넘어간다.

#### 경우 B: CDC 관련 인터페이스만 빨리 죽고, 다른 인터페이스가 더 오래 남음

- 의미: 접근 C가 살아 있다.
- 다음 단계: OpenOCD를 그 인터페이스에 맞춰 붙인다.
- 이 경우에만 `board/esp32s3-builtin.cfg` 경로를 계속 밀어볼 가치가 있다.

이 판단은 `usb_bulk_probe.py`에서 `iface 2`의 마지막 성공 시각이 `iface 1`보다 늦을 때만 성립한다.

#### 경우 C: libusb open 자체가 `/dev/cu.*`보다 훨씬 빨라지고, 인터페이스 claim도 성공함

- 의미: 접근 A는 유효하다.
- 다음 단계: CDC bulk endpoint로 직접 프레임을 보내는 전용 최소 구현으로 넘어간다.
- 단, 이건 "다운로드 모드 진입"이 선행되지 않으면 여전히 ROM sync가 안 될 수 있다.

`usb_bulk_probe.py --write`에서 `iface 1` OUT endpoint가 반복적으로 성공하면 이 경로를 더 밀어볼 가치가 있다.

## OpenOCD에 대한 현실적 판단

`[esp_usb_jtag.cfg](/Users/puritysb/.platformio/tools/tool-openocd-esp32/share/openocd/scripts/interface/esp_usb_jtag.cfg)`와 `[esp32s3-builtin.cfg](/Users/puritysb/.platformio/tools/tool-openocd-esp32/share/openocd/scripts/board/esp32s3-builtin.cfg)`를 보면 OpenOCD는 별도 시리얼 포트가 아니라 USB 디바이스 `0x303a:0x1001` 자체에 붙는다.

그래서 OpenOCD 실험의 전제는 단순하다.

- libusb 프로브에서 JTAG 인터페이스가 실제로 보이고
- 그 인터페이스가 CDC보다 오래 살아야 한다

이 전제가 성립하지 않으면 OpenOCD를 반복 실행하는 것은 같은 실패를 다시 밟는 셈이다.

## 가장 가능성 높은 결론

현재 정보만 보면, 원인이 `GPIO19/GPIO20` 재설정인 3.5" 보드는 CDC와 JTAG가 같이 죽을 가능성이 높다. 즉 소프트웨어만으로는 "살아 있는 창"을 더 빨리 잡을 수는 있어도, 앱이 USB PHY를 끊는 순간 전체 디바이스가 사라질 수 있다.

그래서 우선순위는 이렇게 본다.

1. `libusb` 프로브로 접근 A/C의 생존 여부를 판별
2. JTAG가 더 오래 살면 OpenOCD로 진행
3. 아니면 즉시 GPIO0 패드 접근 또는 UART0 어댑터로 전환

## 실행 메모

- `pyusb`는 현재 환경에 없지만, 시스템 `libusb-1.0.dylib`는 있다.
- 그래서 Python `ctypes` 기반 프로브로 구현했다.
- 이 스크립트는 복구 도구가 아니라 의사결정 도구다. 이걸로 방향을 틀어야 같은 300ms 싸움을 반복하지 않게 된다.
