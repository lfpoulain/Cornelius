import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import cv2
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'perception'))
from remote_camera import RemoteCamera

class RemoteCameraTests(unittest.TestCase):
    def jpeg(self, width=640, height=480):
        ok, data = cv2.imencode('.jpg', np.full((height, width, 3), 127, np.uint8))
        self.assertTrue(ok)
        return data.tobytes()

    def test_latest_frame_only_and_stale_frame_never_reused(self):
        camera = RemoteCamera('generation-a')
        self.assertFalse(camera.push(self.jpeg()))
        camera.enable()
        self.assertTrue(camera.push(self.jpeg()))
        self.assertTrue(camera.push(self.jpeg(320, 240)))
        ok, frame, captured, generation = camera.read()
        self.assertTrue(ok)
        self.assertEqual(frame.shape, (240, 320, 3))
        self.assertEqual(generation, 'generation-a')
        with patch('remote_camera.time.monotonic', return_value=time.monotonic() + 3):
            self.assertFalse(camera.read()[0])
            self.assertEqual(camera.frame(), (None, 0))
        camera.disable()
        self.assertFalse(camera.read()[0])

    def test_rejects_invalid_large_and_decompression_bomb_before_decode(self):
        camera = RemoteCamera('generation-b'); camera.enable()
        for value in (b'', b'not jpeg', b'\xff\xd8' + b'x' * 240000, b'\xff\xd8\xff\xc0\x00\x11\x08\xff\xff\xff\xff' + b'0' * 20):
            with patch('remote_camera.cv2.imdecode') as decode:
                self.assertFalse(camera.push(value)); decode.assert_not_called()

    def test_sources_are_independent_and_no_pixel_storage_survives_disable(self):
        first, second = RemoteCamera('first'), RemoteCamera('second')
        first.enable(); second.enable(); first.push(self.jpeg())
        self.assertTrue(first.read()[0]); self.assertFalse(second.read()[0])
        first.disable(); self.assertIsNone(first.latest)
