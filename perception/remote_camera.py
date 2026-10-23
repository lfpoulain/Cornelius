"""Bounded volatile JPEG source; identity is always computed by the existing Vision model."""
import threading
import time
import struct
import cv2
import numpy as np

class RemoteCamera:
    def __init__(self, generation):
        self.boot = generation
        self.lock = threading.RLock()
        self.latest = None
        self.latest_at = self.latest_wall = 0
        self.enabled = False
        self.sequence = 0

    def enable(self, preferred=None, mode=None):
        self.enabled = True
        return self.status()

    def disable(self):
        with self.lock:
            self.enabled = False
            self.latest = None
        return self.status()

    def push(self, jpeg):
        if not self.enabled or not 4 <= len(jpeg) <= 240000 or jpeg[:2] != b'\xff\xd8':
            return False
        # Inspect JPEG SOF before decoding to bound allocations (malicious dimensions).
        i, size = 2, None
        while i + 4 <= len(jpeg):
            if jpeg[i] != 255:
                return False
            marker = jpeg[i + 1]
            if marker in (0xd9, 0xda):
                break
            length = int.from_bytes(jpeg[i + 2:i + 4], 'big')
            if length < 2 or i + 2 + length > len(jpeg):
                return False
            if marker in (0xc0, 0xc1, 0xc2):
                if length < 8:
                    return False
                height, width = struct.unpack('>HH', jpeg[i + 5:i + 9])
                size = (width, height)
                break
            i += length + 2
        if not size or min(size) < 16 or max(size) > 1920 or size[0] * size[1] > 1920 * 1080:
            return False
        image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        if image is None:
            return False
        with self.lock:
            if not self.enabled:
                return False
            self.latest = image
            self.latest_at = time.monotonic()
            self.latest_wall = int(time.time() * 1000)
        return True

    def read(self):
        with self.lock:
            fresh = self.enabled and self.latest is not None and time.monotonic() - self.latest_at < 2
            return fresh, self.latest.copy() if fresh else None, self.latest_wall if fresh else int(time.time() * 1000), self.boot

    def frame(self):
        ok, image, captured, _ = self.read()
        return (image, captured) if ok else (None, 0)

    def preview(self):
        image, _ = self.frame()
        if image is None:
            return None
        ok, data = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 70])
        return data.tobytes() if ok else None

    def status(self):
        return {"type": "camera_status", "devices": [], "selectedId": "mobile", "error": None, "mode": {"width": 640, "height": 480, "fps": 5}}
    def refresh(self):
        return self.status()
    def select(self, _):
        return self.status()
    def set_mode(self, _):
        return self.status()
