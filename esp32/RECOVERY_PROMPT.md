# ESP32-S3 Native USB 벽돌 복구 과제

## 상황

Guition ESP32-S3 디스플레이 보드 2대 (IPS 3.5" JC3248W535, Round AMOLED JC3636W518)가 잘못된 펌웨어로 인해 USB에 인식되지 않는다. 두 보드 모두 Native USB-Serial/JTAG만 있고 (별도 CH340/FTDI 없음), BOOT/RESET 버튼도 없다.

## 핵심 관찰

USB 케이블을 뺐다 꽂으면 **~300ms 동안** macOS에 `/dev/cu.usbmodem*` 포트가 나타났다 사라진다. 이 시간 동안:
- `ioreg`에서 `USB JTAG/serial debug unit` (Espressif VID 0x303a, PID 0x1001)로 잡힘
- pyserial로 포트를 열 수 있음
- ROM 부트로더 메시지 `ESP-ROM:esp32s3-2021` 수신됨
- 펌웨어 로그 `[256][I][esp32-hal-ledc.c:2` 수신됨
- 약 7-8회 read/write 후 `[Errno 6] Device not configured` 발생

포트가 사라지는 이유: 펌웨어가 GPIO19 (USB D-)와 GPIO20 (USB D+)을 터치/디스플레이 핀으로 재설정하면서 USB PHY가 끊어짐.

## 이미 시도하고 실패한 방법 (반복하지 말 것)

1. **esptool 빠른 연결** — esptool의 sync+handshake에 수백ms 필요, 300ms로 불가
2. **esptool subprocess 즉시 실행** — subprocess spawn 오버헤드 + serial open 시 이미 포트 없음
3. **pyserial open → esptool 넘기기** — close 후 esptool이 다시 open하면 포트 없음
4. **OpenOCD JTAG** — USB 디바이스가 없으면 JTAG도 불가
5. **SLIP sync 직접 구현** — ROM 부트로더가 일반 부팅에서는 sync 무시 (다운로드 모드 전용)
6. **DTR/RTS 리셋 신호** — 이 보드에서 DTR/RTS가 GPIO0/EN에 물리 연결 안 됨
7. **JSON reboot 명령** — 펌웨어가 해당 명령 미지원
8. **WiFi OTA** — 펌웨어에 OTA 기능 없음

## 복구 성공을 위해 필요한 것

300ms USB 윈도우 안에 ESP32-S3를 **다운로드 모드**로 전환하거나, USB를 거치지 않는 대안 경로를 찾아야 한다.

## 유력한 접근법 (미시도)

### 접근 A: libusb로 CDC 드라이버 바이패스
macOS의 CDC 드라이버가 시리얼 포트를 생성하는 데 시간이 걸린다. **libusb**로 USB 디바이스에 직접 접근하면 CDC 포트 생성을 기다리지 않고 즉시 bulk transfer가 가능하다.

- Espressif VID=0x303a, PID=0x1001
- USB-Serial/JTAG의 CDC ACM 엔드포인트에 직접 SLIP 패킷 전송
- **BUT**: 일반 부팅에서 ROM 부트로더는 SLIP에 응답 안 함 — 다운로드 모드만 가능
- **HOWEVER**: ROM 부트로더가 USB를 초기화하는 짧은 순간에 SLIP sync를 보내면 다운로드 모드로 전환될 수 있는가? 아니면 strapping pin 상태가 이미 결정된 후인가?

### 접근 B: esptool의 RAM 스텁 로더를 300ms 안에 밀어넣기
esptool은 chip과 sync한 후 "stub loader"를 RAM에 올려서 플래시 작업을 수행한다. 만약 sync 없이도 RAM에 코드를 주입할 수 있다면, 그 코드가 `FORCE_DOWNLOAD_BOOT` 레지스터를 쓰고 리부트할 수 있다.

### 접근 C: JTAG 인터페이스 직접 접근
USB-Serial/JTAG 디바이스는 CDC와 JTAG 두 인터페이스를 동시에 노출한다. CDC가 300ms 후 죽더라도, **JTAG 인터페이스**는 별도 USB 엔드포인트라서 더 오래 살아있을 수 있다. OpenOCD가 JTAG 엔드포인트에 연결하면 메모리 직접 접근이 가능하고, 플래시를 직접 쓸 수 있다.

- OpenOCD를 미리 실행해두고 USB 연결 시 자동 연결
- `openocd -f board/esp32s3-builtin.cfg` + `adapter serial {MAC}` 사용

### 접근 D: GPIO0 패드 물리 접근
Guition JC3248W535/JC3636W518 보드의 PCB에서 GPIO0 테스트 패드를 찾아 GND에 쇼트하면 다운로드 모드 진입. 핀아웃/회로도를 웹에서 찾거나 보드를 육안 검사.

### 접근 E: 외부 USB-Serial 어댑터 + UART0
ESP32-S3 UART0 (TX=GPIO43, RX=GPIO44)에 별도 USB-Serial 어댑터를 연결하면 Native USB와 독립적으로 통신 가능. GPIO0를 GND에 쇼트한 채 전원 인가 → ROM 다운로드 모드 → esptool 플래시.

### 접근 F: macOS kext/dext 레벨 개입
macOS의 USB CDC 드라이버가 시리얼 포트를 만드는 과정을 가속하거나, 포트가 사라질 때 유지하는 방법이 있는지 조사. IOKit 프레임워크로 USB 디바이스에 직접 접근.

## 환경 정보

- macOS 26.3.1 (Darwin 25.3.0), Apple Silicon
- PlatformIO + pioarduino (ESP-IDF 5.x)
- OpenOCD: `tool-openocd-esp32` v0.12.0-esp32-20251215
- esptool: v5.2.0
- Python: 3.14
- 올바른 펌웨어 바이너리 빌드 완료: `.pio/build/ips_35/` 및 `.pio/build/round_amoled/`
- 각각 `bootloader.bin`, `partitions.bin`, `firmware.bin` 3파일

## 파일 위치

- platformio.ini: `esp32/platformio.ini`
- 보드 설정: `esp32/boards/board_35_ips.h`, `esp32/boards/board_round_amoled.h`
- 복구 시도 기록: `.claude/projects/.../memory/esp32-native-usb-recovery.md`
