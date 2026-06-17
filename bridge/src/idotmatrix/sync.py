import asyncio
import os
import signal
import sys
import hashlib
import tempfile
import urllib.request
import urllib.error
import io
import argparse
from PIL import Image as PilImage, ImageEnhance
from idotmatrix import ConnectionManager
from idotmatrix.modules.image import Image as IdmImage
from idotmatrix.modules.common import Common as IdmCommon

# Default settings
DEFAULT_URL = "http://127.0.0.1:9120"
POLL_INTERVAL = 1.5  # 1.5 seconds interval (balanced for BLE bandwidth)
OFFLINE_HASH = "offline"

async def fetch_frame(url: str) -> bytes:
    """Fetch the current 32x32 BMP frame from the AgentDeck bridge."""
    endpoint = f"{url.rstrip('/')}/pixoo/frame?size=32"
    
    # We use urllib run_in_executor to avoid blocking the asyncio event loop
    loop = asyncio.get_running_loop()
    def _fetch():
        with urllib.request.urlopen(endpoint, timeout=3.0) as response:
            return response.read()
            
    return await loop.run_in_executor(None, _fetch)

def make_offline_image() -> PilImage.Image:
    """Create a small local OFFLINE placeholder for bridge outages."""
    img = PilImage.new("RGB", (32, 32), (8, 10, 14))
    px = img.load()
    for y in range(32):
        for x in range(32):
            if x in (0, 31) or y in (0, 31):
                px[x, y] = (70, 76, 86)
    # Compact block text that fits without font dependencies.
    glyphs = {
        "O": ["111", "101", "101", "101", "111"],
        "F": ["111", "100", "110", "100", "100"],
        "L": ["100", "100", "100", "100", "111"],
        "I": ["111", "010", "010", "010", "111"],
        "N": ["101", "111", "111", "111", "101"],
        "E": ["111", "100", "110", "100", "111"],
    }
    def draw_text(text, x0, y0, color):
        x = x0
        for ch in text:
            for yy, row in enumerate(glyphs[ch]):
                for xx, bit in enumerate(row):
                    if bit == "1":
                        px[x + xx, y0 + yy] = color
            x += 4
    draw_text("OFF", 3, 8, (180, 65, 65))
    draw_text("LINE", 3, 18, (130, 138, 150))
    return img

async def upload_pil_image(idm_image: IdmImage, img: PilImage.Image) -> bool:
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img.save(tmp, format="PNG")
        tmp_path = tmp.name
    try:
        return bool(await idm_image.uploadUnprocessed(tmp_path))
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

async def upload_offline_frame(idm_image: IdmImage) -> bool:
    return await upload_pil_image(idm_image, make_offline_image())

async def _interruptible_sleep(stop_event: asyncio.Event, secs: float) -> None:
    """Sleep up to `secs`, but wake immediately if shutdown was requested."""
    try:
        await asyncio.wait_for(stop_event.wait(), timeout=secs)
    except asyncio.TimeoutError:
        pass

async def run_sync(address: str, url: str, brightness: int = 100, boost: float = 1.5):
    print(f"Initializing iDotMatrix Synchronization...")
    print(f"Target Device BLE Address: {address}")
    print(f"AgentDeck Bridge API URL: {url}")
    print(f"Initial Hardware Brightness: {brightness}%")
    print(f"Software Brightness Boost: {boost}x")
    
    manager = ConnectionManager()
    
    idm_image = IdmImage()
    idm_image.conn = manager
    
    idm_common = IdmCommon()
    idm_common.conn = manager
    
    last_hash = ""
    connected = False

    # Graceful shutdown: when the daemon (or a user) stops us, we must leave the
    # panel in a clean state — a stateful BLE display otherwise freezes on the
    # last dashboard frame forever. Trap SIGTERM/SIGINT, break the loop, and push
    # the OFFLINE frame before disconnecting (mirrors the Pixoo/D200H teardown
    # invariant). add_signal_handler isn't available on all platforms; fall back
    # to default handling there.
    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()
    for _sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(_sig, stop_event.set)
        except (NotImplementedError, RuntimeError):
            pass

    while not stop_event.is_set():
        try:
            # 1. Ensure bluetooth connection
            if not connected:
                print(f"Connecting to iDotMatrix ({address})...")
                await manager.connectByAddress(address)
                print("Connected to Bluetooth device!")
                
                # Set initial hardware brightness
                if brightness:
                    print(f"Setting hardware brightness to {brightness}%...")
                    await idm_common.setBrightness(brightness)
                
                # Enter DIY drawing mode (mode 1)
                print("Entering DIY drawing mode...")
                await idm_image.setMode(1)
                connected = True
                last_hash = "" # Force immediate push of first frame after reconnect
            
            # 2. Fetch frame from AgentDeck Bridge
            try:
                frame_data = await fetch_frame(url)
            except urllib.error.URLError as ue:
                print(f"Bridge API offline or unreachable (GET /pixoo/frame): {ue.reason}")
                if connected and last_hash != OFFLINE_HASH:
                    print("Sending local OFFLINE frame to iDotMatrix...")
                    if await upload_offline_frame(idm_image):
                        last_hash = OFFLINE_HASH
                await _interruptible_sleep(stop_event, 5.0)
                continue
            except Exception as fe:
                print(f"Failed to fetch frame from bridge: {fe}")
                if connected and last_hash != OFFLINE_HASH:
                    print("Sending local OFFLINE frame to iDotMatrix...")
                    if await upload_offline_frame(idm_image):
                        last_hash = OFFLINE_HASH
                await _interruptible_sleep(stop_event, 3.0)
                continue
                
            # 3. Check if frame has changed
            current_hash = hashlib.sha256(frame_data).hexdigest()
            if current_hash == last_hash:
                # Frame didn't change, skip BLE transmission to save battery and bandwidth
                await _interruptible_sleep(stop_event, POLL_INTERVAL)
                continue
                
            print(f"New frame detected (hash: {current_hash[:8]}). Enhancing and sending to display...")
            
            # 4. Pillow Image Enhancement (Brightness & Contrast Boost)
            # Load 32x32 BMP data
            img = PilImage.open(io.BytesIO(frame_data))
            if img.size != (32, 32):
                try:
                    resample = PilImage.Resampling.BOX
                except AttributeError:
                    resample = PilImage.BOX
                img = img.resize((32, 32), resample)
            
            # Apply Software Brightness Boost if set
            if boost != 1.0:
                bright_enhancer = ImageEnhance.Brightness(img)
                img = bright_enhancer.enhance(boost)
                
                # Boost contrast slightly to prevent color washing out
                contrast_enhancer = ImageEnhance.Contrast(img)
                img = contrast_enhancer.enhance(1.2)
            
            # Use uploadUnprocessed because we already resized and enhanced the image
            res = await upload_pil_image(idm_image, img)
            if res:
                last_hash = current_hash
                print("Frame uploaded successfully.")
            else:
                print("Failed to upload frame (uploadUnprocessed returned False).")

            await _interruptible_sleep(stop_event, POLL_INTERVAL)

        except asyncio.CancelledError:
            print("Sync task cancelled.")
            break
        except Exception as e:
            print(f"Error during loop: {e}")
            print("Resetting bluetooth connection...")
            connected = False
            try:
                await manager.disconnect()
            except Exception:
                pass
            await _interruptible_sleep(stop_event, 3.0)

    # Loop exited (shutdown requested). Leave the panel showing OFFLINE instead
    # of a frozen dashboard frame, then drop the BLE link.
    if connected:
        print("Shutting down — sending OFFLINE frame to iDotMatrix...")
        try:
            await upload_offline_frame(idm_image)
        except Exception as e:
            print(f"  offline frame push failed: {e}")
        try:
            await manager.disconnect()
        except Exception:
            pass

def main():
    parser = argparse.ArgumentParser(description="AgentDeck iDotMatrix Sync Client")
    parser.add_argument("-a", "--address", required=True, help="BLE MAC/UUID Address of the iDotMatrix device")
    parser.add_argument("-u", "--url", default=DEFAULT_URL, help=f"AgentDeck Bridge URL (default: {DEFAULT_URL})")
    parser.add_argument("-b", "--brightness", type=int, default=100, help="Initial hardware brightness percent (5-100, default: 100)")
    parser.add_argument("--boost", type=float, default=1.6, help="Software brightness boost factor (default: 1.6)")
    args = parser.parse_args()
    
    if args.brightness not in range(5, 101):
        print("ERROR: Brightness must be between 5 and 100 percent.")
        sys.exit(1)
        
    try:
        asyncio.run(run_sync(args.address, args.url, args.brightness, args.boost))
    except KeyboardInterrupt:
        print("\nExiting iDotMatrix Sync Client. Goodbye!")

if __name__ == "__main__":
    main()
