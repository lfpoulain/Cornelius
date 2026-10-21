"""One capture shared by local recognition and the on-demand admin preview."""
import hashlib
import sys
import threading
import time
import uuid

import cv2
from cv2_enumerate_cameras import enumerate_cameras


# Résolutions et cadences proposées dans l’administration ; 1280 x 720 à 30 i/s par défaut.
RESOLUTIONS = ((640, 480), (1280, 720), (1920, 1080))
FRAME_RATES = (15, 30)
DEFAULT_MODE = {"width": 1280, "height": 720, "fps": 30}


def valid_mode(mode):
    return (
        isinstance(mode, dict)
        and (mode.get("width"), mode.get("height")) in RESOLUTIONS
        and mode.get("fps") in FRAME_RATES
    )


def camera_backend(platform=sys.platform):
    """API de capture d’OpenCV : DirectShow sous Windows, AVFoundation sous macOS, V4L2 sous Linux."""
    if platform == "win32":
        return cv2.CAP_DSHOW
    if platform == "darwin":
        return cv2.CAP_AVFOUNDATION
    return cv2.CAP_V4L2


class Camera:
    def __init__(self, index=0, enabled=True):
        self.backend = camera_backend()
        self.lock = threading.RLock()
        self.devices = {}
        self.selected_id = None
        self.capture = None
        self.latest = None
        self.latest_at = 0
        self.latest_wall = 0
        self.boot = str(uuid.uuid4())
        self.error = None
        self.default_index = index
        self.mode = dict(DEFAULT_MODE)
        # Ce que la caméra a réellement accepté (elle peut arrondir ou refuser).
        self.actual = None
        if enabled:
            self.enable()

    def enable(self, preferred=None, mode=None):
        """Allume la caméra choisie dans l’administration (sinon celle de CORNELIUS_CAMERA_INDEX)."""
        if valid_mode(mode):
            self.mode = {"width": mode["width"], "height": mode["height"], "fps": mode["fps"]}
        self.refresh()
        if preferred in self.devices:
            return self.select(preferred)
        initial = next(
            (key for key, info in self.devices.items() if info.index == self.default_index),
            None,
        )
        if initial:
            return self.select(initial)
        self.error = "Caméra configurée introuvable. Choisissez un périphérique."
        return self.status()

    def disable(self):
        with self.lock:
            if self.capture:
                self.capture.release()
            self.capture = None
            self.latest = None
            self.latest_at = 0
            self.latest_wall = 0
            self.selected_id = None
            self.error = None
            self.boot = str(uuid.uuid4())
            return self.status()

    def refresh(self):
        entries = enumerate_cameras(self.backend)
        with self.lock:
            self.devices = {
                hashlib.sha256(str(info.path or (str(info.backend) + ":" + str(info.index))).encode()).hexdigest(): info
                for info in entries
            }
        return self.status()

    def status(self):
        with self.lock:
            return {
                "type": "camera_status",
                "selectedId": self.selected_id,
                "devices": [{"id": key, "label": info.name[:120] or "Caméra " + str(info.index)}
                            for key, info in self.devices.items()],
                "error": self.error,
                "mode": dict(self.mode),
                "actual": dict(self.actual) if self.actual else None,
            }

    def _open(self, info):
        capture = cv2.VideoCapture(info.index, info.backend)
        # MJPG d’abord : beaucoup de webcams USB ne donnent 720p ou 1080p à 30 i/s qu’ainsi.
        capture.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
        capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.mode["width"])
        capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.mode["height"])
        capture.set(cv2.CAP_PROP_FPS, self.mode["fps"])
        capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        ok, frame = capture.read()
        if not ok:
            capture.release()
            return None, None
        height, width = frame.shape[:2]
        fps = capture.get(cv2.CAP_PROP_FPS)
        self.actual = {"width": int(width), "height": int(height), "fps": round(fps) if fps and fps > 0 else None}
        return capture, frame

    def set_mode(self, mode):
        """Nouvelle résolution ou cadence : la caméra choisie est rouverte avec elle."""
        if not valid_mode(mode):
            return self.status()
        with self.lock:
            self.mode = {"width": mode["width"], "height": mode["height"], "fps": mode["fps"]}
            device_id = self.selected_id
            if device_id is None:
                return self.status()
            if self.capture:
                self.capture.release()
            self.capture = None
            self.selected_id = None
            return self.select(device_id)

    def select(self, device_id):
        with self.lock:
            target = self.devices.get(device_id)
            if target is None:
                self.error = "Caméra débranchée. Actualisez la liste."
                return self.status()
            if self.selected_id == device_id and self.capture and self.capture.isOpened():
                self.error = None
                return self.status()
            previous = self.devices.get(self.selected_id)
            if self.capture:
                self.capture.release()
            self.capture, frame = self._open(target)
            if self.capture is None:
                self.error = "Caméra inaccessible ou utilisée par une autre application."
                if previous:
                    self.capture, frame = self._open(previous)
                if self.capture is None:
                    self.selected_id = None
            else:
                self.selected_id = device_id
                self.error = None
            self.latest = frame
            self.latest_at = time.monotonic() if frame is not None else 0
            self.latest_wall = int(time.time() * 1000) if frame is not None else 0
            self.boot = str(uuid.uuid4())
            return self.status()

    def read(self):
        with self.lock:
            ok, frame = self.capture.read() if self.capture else (False, None)
            captured = int(time.time() * 1000)
            self.latest = frame if ok else None
            self.latest_at = time.monotonic() if ok else 0
            self.latest_wall = captured if ok else 0
            return ok, frame, captured, self.boot

    def _fresh(self):
        """The latest frame, only while it is at most 2 s old; caller holds the lock."""
        if self.latest is None or time.monotonic() - self.latest_at > 2:
            return None
        return self.latest

    def frame(self):
        """Latest full-resolution frame for local vision, without keeping it in memory."""
        with self.lock:
            latest = self._fresh()
            return (latest.copy(), self.latest_wall) if latest is not None else (None, 0)

    def preview(self):
        with self.lock:
            latest = self._fresh()
            if latest is None:
                return None
            frame = latest.copy()
        height, width = frame.shape[:2]
        if width > 960:
            frame = cv2.resize(frame, (960, round(height * 960 / width)), interpolation=cv2.INTER_AREA)
        ok, data = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
        return data.tobytes() if ok and len(data) <= 255_964 else None
