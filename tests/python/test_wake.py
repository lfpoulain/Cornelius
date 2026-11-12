import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "perception"))
from wake import WakeDetector, WakeStream


class FakeModel:
    def __init__(self):
        self.score = 0.0

    def predict(self, frame):
        assert frame.shape == (1280,)
        return {"cornelius": self.score}


class WakeStreamTest(unittest.TestCase):
    def test_threshold_cooldown_and_frame_size(self):
        stream = WakeStream(FakeModel(), 0.5)
        with patch("wake.time.monotonic", side_effect=[10.0, 10.5, 11.0, 12.6]):
            stream.model.score = 0.49
            self.assertIsNone(stream.process(bytes(2560)))
            stream.model.score = 0.8
            self.assertEqual(stream.process(bytes(2560)), 0.8)
            self.assertIsNone(stream.process(bytes(2560)))
            self.assertEqual(stream.process(bytes(2560)), 0.8)
        self.assertIsNone(stream.process(bytes(1024)))

    def test_each_stream_has_its_own_model_and_cooldown(self):
        detector = WakeDetector.__new__(WakeDetector)
        detector.threshold = 0.5
        detector.load = FakeModel
        mirror, satellite = detector.stream(), detector.stream()
        self.assertIsNot(mirror.model, satellite.model)
        mirror.model.score = satellite.model.score = 0.9
        with patch("wake.time.monotonic", side_effect=[10.0, 10.1]):
            self.assertEqual(mirror.process(bytes(2560)), 0.9)
            self.assertEqual(satellite.process(bytes(2560)), 0.9)

    def test_a_finished_stream_lends_its_reset_model_to_the_next_one(self):
        class Model(FakeModel):
            resets = 0

            def reset(self):
                self.resets += 1

        loads = []
        detector = WakeDetector.__new__(WakeDetector)
        detector.threshold = 0.5
        detector.load = lambda: loads.append(Model()) or loads[-1]
        detector.path = detector.mel = detector.embedding = Path(__file__)
        self.assertTrue(detector.prepare())
        # Le modèle chargé au démarrage sert au premier flux : il n’est pas qu’un témoin.
        mirror = detector.stream()
        self.assertIs(mirror.model, detector.model)
        satellite = detector.stream()
        self.assertIsNot(mirror.model, satellite.model)
        self.assertEqual(len(loads), 2)
        # Retour en veille : le modèle rendu ressert, tampons audio remis à zéro, sans relecture.
        detector.release(mirror)
        again = detector.stream()
        self.assertIs(again.model, mirror.model)
        self.assertIsNot(again, mirror)
        self.assertEqual(again.model.resets, 1)
        self.assertEqual(len(loads), 2)
        # Un modèle en service n’est jamais prêté à un second flux.
        self.assertIsNot(detector.stream().model, again.model)
        self.assertEqual(len(loads), 3)
        # Après une panne, la réserve est jetée ; prepare() recharge.
        detector.fail("Inférence du mot d’appel indisponible (RuntimeError).")
        self.assertFalse(detector.status()["ready"])
        detector.release(again)
        self.assertTrue(detector.prepare())
        self.assertTrue(detector.status()["ready"])
        self.assertIsNone(detector.status()["detail"])


if __name__ == "__main__":
    unittest.main()
