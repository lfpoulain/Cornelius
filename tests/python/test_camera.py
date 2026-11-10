import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "perception"))
from camera import Camera, DEFAULT_MODE, valid_mode


class Capture:
    opened = []

    def __init__(self, index, backend):
        self.index, self.closed, self.settings = index, False, {}
        Capture.opened.append(self)
    def set(self, prop, value): self.settings[prop] = value
    def get(self, prop): return 30.0
    def isOpened(self): return not self.closed
    def read(self):
        return (False, None) if self.index == 1 or self.closed else (True, np.zeros((48, 64, 3), dtype=np.uint8))
    def release(self): self.closed = True


class CameraTests(unittest.TestCase):
    def test_failed_switch_restores_previous_capture_and_preview_expires(self):
        devices = [SimpleNamespace(index=i, backend=700, name="Camera " + str(i), path="device-" + str(i)) for i in range(2)]
        with patch("camera.enumerate_cameras", return_value=devices), patch("camera.cv2.VideoCapture", Capture):
            camera = Camera()
            initial = camera.selected_id
            other = next(key for key in camera.devices if key != initial)
            failed = camera.select(other)
            self.assertEqual(failed["selectedId"], initial)
            self.assertIsNotNone(failed["error"])
            self.assertTrue(camera.read()[0])
            image = camera.preview()
            self.assertTrue(image.startswith(b"\xff\xd8"))
            self.assertTrue(image.endswith(b"\xff\xd9"))
            camera.latest_at -= 3
            self.assertIsNone(camera.preview())
            camera.disable()

    def test_lost_camera_is_reopened_and_reported(self):
        devices = [SimpleNamespace(index=0, backend=700, name="Camera 0", path="device-0")]
        with patch("camera.enumerate_cameras", return_value=devices), patch("camera.cv2.VideoCapture", Capture):
            camera = Camera()
            first = Capture.opened[-1]
            boot = camera.boot
            self.assertTrue(camera.read()[0])
            self.assertIsNone(camera.take_status_change())
            # Câble débranché : les lectures échouent, et la réouverture échoue aussi.
            first.closed = True
            with patch.object(Capture, "read", lambda self: (False, None)):
                for _ in range(12):
                    self.assertFalse(camera.read()[0])
                lost = camera.take_status_change()
                self.assertIn("déconnectée", lost["error"])
                self.assertEqual(lost["selectedId"], camera.selected_id)
                # Une seule annonce, et pas de réouverture à chaque image.
                opened = len(Capture.opened)
                for _ in range(5):
                    camera.read()
                self.assertEqual(len(Capture.opened), opened)
                self.assertIsNone(camera.take_status_change())
            # Rebranchée : la tentative suivante la retrouve, sans redémarrer la perception.
            camera.retry_at = 0
            ok, frame, _, new_boot = camera.read()
            self.assertTrue(ok)
            self.assertEqual(frame.shape[:2], (48, 64))
            self.assertNotEqual(new_boot, boot)
            self.assertIsNone(camera.take_status_change()["error"])
            self.assertTrue(camera.read()[0])
            # Caméra éteinte volontairement : aucune tentative.
            camera.disable()
            opened = len(Capture.opened)
            for _ in range(15):
                self.assertFalse(camera.read()[0])
            self.assertEqual(len(Capture.opened), opened)

    def test_detected_face_has_json_serializable_engagement(self):
        import json
        from vision import Vision
        with patch("vision.cv2.FaceDetectorYN.create") as detector, patch("vision.cv2.FaceRecognizerSF.create") as recognizer:
            detector.return_value.detect.return_value = (1, np.array([[100, 100, 180, 180, 140, 150, 240, 150, 190, 190, 150, 230, 230, 230, 0.99]], dtype=np.float32))
            recognizer.return_value.feature.return_value = np.ones((1, 128), dtype=np.float32)
            vision = Vision(Path("models"))
            people, engaged, _ = vision.analyze(np.zeros((480, 640, 3), dtype=np.uint8))
            self.assertIs(engaged, True)
            json.dumps({"people": people, "engaged": engaged})

    def test_mode_is_applied_when_opening_and_changing(self):
        import cv2
        devices = [SimpleNamespace(index=0, backend=700, name="Camera 0", path="device-0")]
        with patch("camera.enumerate_cameras", return_value=devices), patch("camera.cv2.VideoCapture", Capture):
            Capture.opened.clear()
            camera = Camera()
            first = Capture.opened[-1].settings
            self.assertEqual(first[cv2.CAP_PROP_FRAME_WIDTH], DEFAULT_MODE["width"])
            self.assertEqual(first[cv2.CAP_PROP_FPS], DEFAULT_MODE["fps"])
            status = camera.set_mode({"width": 640, "height": 480, "fps": 15})
            self.assertEqual(status["mode"], {"width": 640, "height": 480, "fps": 15, "rotate180": False})
            self.assertEqual(status["selectedId"], camera.selected_id)
            reopened = Capture.opened[-1].settings
            self.assertEqual(reopened[cv2.CAP_PROP_FRAME_WIDTH], 640)
            self.assertEqual(reopened[cv2.CAP_PROP_FPS], 15)
            # La caméra factice renvoie 64 x 48 : l’image réellement reçue est signalée.
            self.assertEqual(status["actual"], {"width": 64, "height": 48, "fps": 30})
            unchanged = camera.set_mode({"width": 123, "height": 45, "fps": 15})
            self.assertEqual(unchanged["mode"]["width"], 640)
            self.assertFalse(valid_mode({"width": 1280, "height": 720, "fps": 60}))
            camera.disable()

    def test_enable_opens_the_saved_camera_directly(self):
        devices = [SimpleNamespace(index=i, backend=700, name="Camera " + str(i), path="device-" + str(i)) for i in range(3)]
        with patch("camera.enumerate_cameras", return_value=devices), patch("camera.cv2.VideoCapture", Capture):
            camera = Camera(enabled=False)
            camera.refresh()
            saved = next(key for key, info in camera.devices.items() if info.index == 2)
            Capture.opened.clear()
            status = camera.enable(saved, {"width": 640, "height": 480, "fps": 15})
            self.assertEqual(status["selectedId"], saved)
            # Une seule ouverture, sur la bonne entrée : jamais l’entrée par défaut d’abord.
            self.assertEqual([capture.index for capture in Capture.opened], [2])
            self.assertEqual(status["mode"], {"width": 640, "height": 480, "fps": 15, "rotate180": False})
            camera.disable()

    def test_upside_down_camera_is_rotated_without_reopening(self):
        devices = [SimpleNamespace(index=0, backend=700, name="Camera 0", path="device-0")]
        with patch("camera.enumerate_cameras", return_value=devices), patch("camera.cv2.VideoCapture", Capture):
            Capture.opened.clear()
            camera = Camera()
            status = camera.set_mode({**DEFAULT_MODE, "rotate180": True})
            self.assertTrue(status["mode"]["rotate180"])
            self.assertEqual(len(Capture.opened), 1)
            marked = np.zeros((48, 64, 3), dtype=np.uint8)
            marked[0, 0] = 255
            with patch.object(Capture, "read", lambda self: (True, marked.copy())):
                _, frame, _, _ = camera.read()
            self.assertEqual(frame[47, 63].tolist(), [255, 255, 255])
            self.assertEqual(frame[0, 0].tolist(), [0, 0, 0])
            camera.disable()

    def test_browser_frames_are_rotated_too(self):
        import cv2
        from browser_camera import BrowserCamera
        camera = BrowserCamera()
        camera.enable(mode={**DEFAULT_MODE, "rotate180": True})
        image = np.zeros((48, 64, 3), dtype=np.uint8)
        image[:8, :8] = 255
        ok, jpeg = cv2.imencode(".jpg", image)
        self.assertTrue(ok and camera.receive(jpeg.tobytes()))
        frame = camera.read()[1]
        self.assertGreater(frame[44, 60].mean(), 200)
        self.assertLess(frame[4, 4].mean(), 50)


if __name__ == "__main__":
    unittest.main()
