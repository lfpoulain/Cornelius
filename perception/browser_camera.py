"""Volatile browser JPEG source. No capture device, file, or image history."""
import struct
import time
import uuid

import cv2
import numpy as np
from camera import Camera, clean_mode, valid_mode

MAX_BYTES = 250_000
MAX_WIDTH, MAX_HEIGHT = 1920, 1080


def jpeg_dimensions(data):
    """Read SOF before decoding, so a small compressed image cannot allocate unbounded RAM."""
    if len(data) < 4 or data[:2] != b"\xff\xd8" or data[-2:] != b"\xff\xd9":
        return None
    offset = 2
    while offset + 4 <= len(data):
        if data[offset] != 255:
            return None
        while offset < len(data) and data[offset] == 255:
            offset += 1
        if offset >= len(data):
            return None
        marker = data[offset]
        offset += 1
        if marker in (0xD8, 0xD9, 0x01) or 0xD0 <= marker <= 0xD7:
            continue
        if offset + 2 > len(data):
            return None
        length = int.from_bytes(data[offset:offset + 2], "big")
        if length < 2 or offset + length > len(data):
            return None
        if marker in (0xC0, 0xC1, 0xC2):
            if length < 8:
                return None
            height, width = struct.unpack(">HH", data[offset + 3:offset + 7])
            return width, height
        if marker == 0xDA:
            return None
        offset += length
    return None


class BrowserCamera(Camera):
    def __init__(self):
        super().__init__(enabled=False)
        self.enabled = False
        # Numéro de la dernière image reçue : read() rend la même image jusqu’à la suivante,
        # et le worker ne doit l’analyser (et ne compter un vote d’identité) qu’une fois.
        self.frame_number = 0

    def enable(self, preferred=None, mode=None):
        with self.lock:
            self.enabled = True
            if valid_mode(mode):
                self.mode = clean_mode(mode)
            self.error = "Activez la caméra dans le navigateur du miroir."
            return self.status()

    def disable(self):
        with self.lock:
            self.enabled = False
            super().disable()
            self.actual = None
            return self.status()

    def reset(self):
        with self.lock:
            self.latest = None
            self.latest_at = self.latest_wall = 0
            self.selected_id = None
            self.actual = None
            self.boot = str(uuid.uuid4())
            self.error = "Caméra du navigateur déconnectée."
            return self.status()

    def refresh(self):
        return self.status()

    def select(self, device_id):
        # The browser owns its device IDs and chooses them on the mirror page.
        return self.status()

    def set_mode(self, mode):
        if valid_mode(mode):
            self.mode = clean_mode(mode)
        return self.status()

    def status(self):
        with self.lock:
            return {"type": "camera_status", "selectedId": self.selected_id,
                    "devices": [{"id": "browser", "label": "Caméra du navigateur du miroir"}],
                    "error": self.error, "mode": dict(self.mode),
                    "actual": dict(self.actual) if self.actual else None}

    def receive(self, jpeg):
        if not self.enabled or len(jpeg) > MAX_BYTES:
            return False
        dimensions = jpeg_dimensions(jpeg)
        if not dimensions:
            return False
        width, height = dimensions
        if not (1 <= width <= MAX_WIDTH and 1 <= height <= MAX_HEIGHT):
            return False
        frame = cv2.imdecode(np.frombuffer(jpeg, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None or frame.shape[:2] != (height, width):
            return False
        with self.lock:
            if not self.enabled:
                return False
            self.latest = self.oriented(frame)
            self.frame_number += 1
            self.latest_at = time.monotonic()
            self.latest_wall = int(time.time() * 1000)
            self.selected_id = "browser"
            self.error = None
            self.actual = {"width": width, "height": height, "fps": None}
        return True

    def read(self):
        with self.lock:
            frame = self._fresh()
            return frame is not None, frame, self.latest_wall or int(time.time() * 1000), self.boot
