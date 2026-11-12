import asyncio
import json
import sys
import unittest
from unittest.mock import AsyncMock, Mock, patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "perception"))
from worker import Worker


class EventQueueTests(unittest.TestCase):
    def test_callback_queued_before_disconnect_does_not_reach_next_socket(self):
        worker = Worker.__new__(Worker)
        old, current = asyncio.Queue(), asyncio.Queue()
        worker.vision_queue = current
        worker._queue_put(old, {"type": "vision_status", "status": "ready"})
        self.assertTrue(old.empty())
        self.assertTrue(current.empty())
        worker._queue_put(current, {"type": "vision_status", "status": "ready"})
        self.assertEqual(current.qsize(), 1)
        worker.vision_queue = None
        worker._queue_put(current, {})
        self.assertEqual(current.qsize(), 1)


class InstalledModelTests(unittest.TestCase):
    def test_installation_reloads_the_same_model_on_the_existing_thread(self):
        worker = Worker.__new__(Worker)
        worker.vision_model = "1.6b"
        worker.vision_device = "auto"
        worker.scene = Mock()
        with patch("worker.SceneCaptioner") as captioner:
            worker.set_vision_model("1.6b")
            captioner.assert_not_called()
            worker.set_vision_model("1.6b", reload=True)
            captioner.assert_called_once()
            self.assertEqual(captioner.call_args.kwargs["device"], "auto")
            worker.scene.replace_captioner.assert_called_once_with(captioner.return_value)

    def test_device_change_reloads_the_same_model(self):
        worker = Worker.__new__(Worker)
        worker.vision_model = "3b"
        worker.vision_device = "auto"
        worker.scene = Mock()
        with patch("worker.SceneCaptioner") as captioner:
            worker.set_vision_model("3b", device="cpu")
            self.assertEqual(worker.vision_device, "cpu")
            self.assertEqual(captioner.call_args.kwargs["device"], "cpu")
            worker.scene.replace_captioner.assert_called_once_with(captioner.return_value)


class ObservationCadenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_processing_time_is_subtracted_without_catch_up_bursts(self):
        for elapsed, expected_wait in [(0.025, 0.075), (0.16, 0.0)]:
            with self.subTest(elapsed=elapsed):
                worker = Worker.__new__(Worker)
                worker.sequence = 0
                worker.enrollment = None
                worker.frame = Mock()
                frame = (1234, [], False, [], "ok", "camera")
                socket = Mock(send=AsyncMock())
                with patch("worker.asyncio.to_thread", new=AsyncMock(return_value=frame)), \
                     patch("worker.time.monotonic", side_effect=[10.0, 10.0 + elapsed]), \
                     patch("worker.asyncio.sleep", new=AsyncMock(side_effect=asyncio.CancelledError)) as sleep:
                    with self.assertRaises(asyncio.CancelledError):
                        await worker.observations(socket)
                self.assertAlmostEqual(sleep.call_args.args[0], expected_wait)
                socket.send.assert_awaited_once()
                self.assertEqual(worker.sequence, 1)


class VisionQuestionCommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_tracking_duration_updates_before_and_after_camera_activation(self):
        worker = Worker.__new__(Worker)
        worker.vision = None
        class Socket:
            async def __aiter__(self):
                yield json.dumps({"type": "tracking", "graceMs": 15000})
        await worker.commands(Socket())
        self.assertEqual(worker.tracking_grace_ms, 15000)
        worker.vision = Mock()
        await worker.commands(Socket())
        worker.vision.configure_tracking.assert_called_once_with(15000)
        worker.vision.configure_identity_hold.assert_called_once_with(8000)
        class Settings:
            async def __aiter__(self):
                yield json.dumps({"type": "tracking", "graceMs": 9000, "identityHoldMs": 3000})
        await worker.commands(Settings())
        self.assertEqual(worker.identity_hold_ms, 3000)
        worker.vision.configure_identity_hold.assert_called_with(3000)

    async def test_command_passes_the_question_to_the_inference_worker(self):
        worker = Worker.__new__(Worker)
        scene = Mock()
        worker.scene_worker = Mock(return_value=scene)
        class Socket:
            async def __aiter__(self):
                yield json.dumps({"type": "vision", "requestId": "cup", "trigger": "tool", "question": "De quelle couleur est ma tasse ?"})
                yield json.dumps({"type": "vision", "requestId": "opening", "trigger": "scene"})
        await worker.commands(Socket())
        self.assertEqual(scene.request.call_args_list[0].args, ("cup", "tool", "De quelle couleur est ma tasse ?"))
        self.assertEqual(scene.request.call_args_list[1].args, ("opening", "scene", None))


class CameraCommandTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_camera_opening_never_blocks_speech_detection(self):
        import threading
        import time
        worker = Worker.__new__(Worker)
        worker.interaction = "conversation"
        worker.last_speech, worker.last_vad_sent = None, 0
        worker.vad = Mock()
        worker.vad.process.return_value = True
        worker.scene = None
        worker.camera_enabled = False
        opened = threading.Event()

        def slow_enable(preferred=None, mode=None):
            time.sleep(0.5)
            worker.camera_enabled = True
            opened.set()
            return {"type": "camera_status", "selectedId": "one", "devices": [], "error": None}

        worker.enable_camera = slow_enable
        sent = []
        speech_while_opening = []

        class Socket:
            async def send(self, value):
                sent.append(value)
                if isinstance(value, str) and '"vad"' in value:
                    speech_while_opening.append(not opened.is_set())

            async def __aiter__(self):
                yield json.dumps({"type": "camera_enabled", "enabled": True})
                for _ in range(3):
                    yield bytes(1024)
                    await asyncio.sleep(0.05)

        await worker.commands(Socket())
        # Le son est analysé pendant que la caméra s’ouvre encore.
        self.assertTrue(speech_while_opening and speech_while_opening[0])
        await asyncio.gather(*worker.camera_tasks)
        self.assertTrue(any('"camera_status"' in value for value in sent if isinstance(value, str)))
        self.assertTrue(worker.camera_enabled)

    def failing_worker(self):
        worker = Worker.__new__(Worker)
        worker.vision = None
        worker.scene = None
        worker.camera_enabled = False
        worker.recognition_threshold = 0.42
        worker.camera = Mock()
        status = {"type": "camera_status", "selectedId": "one", "devices": [], "error": None}
        worker.camera.enable.return_value = dict(status)
        worker.camera.status.side_effect = lambda: dict(status)
        return worker

    async def test_missing_face_models_are_reported_instead_of_closing_the_connection(self):
        worker = self.failing_worker()
        socket = Mock(send=AsyncMock())
        with patch("worker.Vision", side_effect=OSError("yunet.onnx")), \
             patch("worker.print") as log:
            # Caméra du navigateur : la commande est attendue dans la boucle des commandes.
            await worker.camera_command(socket, {"type": "camera_enabled", "enabled": True})
            # Caméra du serveur : la même commande part en tâche de fond.
            await worker.camera_job(
                lambda: worker.camera_command(socket, {"type": "camera_enabled", "enabled": True}))
        sent = [json.loads(call.args[0]) for call in socket.send.await_args_list]
        self.assertEqual(len(sent), 2)
        for status in sent:
            self.assertEqual(status["type"], "camera_status")
            self.assertIn("Reconnaissance des visages indisponible", status["error"])
        # Une ligne par cause dans le journal, pas une par tentative.
        log.assert_called_once()
        self.assertIn("OSError", log.call_args.args[0])

    async def test_failed_camera_request_still_answers_with_its_request_id(self):
        worker = self.failing_worker()
        worker.camera_enabled = True
        worker.camera.select.side_effect = RuntimeError("pilote")
        socket = Mock(send=AsyncMock())
        with patch("worker.print"):
            await worker.camera_command(socket, {"type": "camera_select", "id": "two", "requestId": "r1"})
        status = json.loads(socket.send.await_args.args[0])
        self.assertEqual(status["requestId"], "r1")
        self.assertIn("RuntimeError", status["error"])

    def test_vision_models_stay_loaded_between_two_camera_activations(self):
        worker = self.failing_worker()
        worker.enrollment = worker.last_progress = None
        worker.profile_templates = []
        worker.engagement = {"poseTolerance": 0.3, "minFaceRatio": 0.14}
        worker.tracking_grace_ms = worker.identity_hold_ms = 8000
        worker.detection_width = None
        with patch("worker.Vision") as vision:
            worker.enable_camera()
            worker.disable_camera()
            worker.enable_camera()
            vision.assert_called_once()
            # Les pistes ne survivent pas à l’extinction, comme avec une instance neuve.
            vision.return_value.reset_tracks.assert_called_once()
        worker.camera.disable.assert_called_once()


class ResilienceTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejected_command_does_not_stop_the_following_ones(self):
        worker = Worker.__new__(Worker)
        worker.vision = Mock()
        worker.vision.configure.side_effect = ValueError("Seuil de reconnaissance invalide.")

        class Socket:
            async def __aiter__(self):
                yield "pas du JSON"
                yield json.dumps({"type": "recognition", "threshold": 3})
                yield json.dumps({"type": "recognition", "threshold": 3})
                yield json.dumps({"type": "tracking", "graceMs": 15000})

        with patch("worker.print") as log:
            await worker.commands(Socket())
        self.assertEqual(worker.tracking_grace_ms, 15000)
        # Le JSON illisible, puis le réglage refusé une seule fois malgré sa répétition.
        self.assertEqual(log.call_count, 2)

    async def test_failed_analysis_publishes_an_unavailable_presence(self):
        worker = Worker.__new__(Worker)
        worker.sequence = 0
        worker.enrollment = None
        worker.vision = Mock()
        worker.camera = Mock(boot="camera")
        worker.camera.take_status_change.return_value = None
        worker.camera.read.side_effect = RuntimeError("image illisible")
        socket = Mock(send=AsyncMock())
        with patch("worker.print") as log, \
             patch("worker.asyncio.sleep", new=AsyncMock(side_effect=[None, asyncio.CancelledError])):
            with self.assertRaises(asyncio.CancelledError):
                await worker.observations(socket)
        observations = [json.loads(call.args[0])["observation"] for call in socket.send.await_args_list]
        self.assertEqual([item["health"] for item in observations], ["unavailable", "unavailable"])
        self.assertEqual(observations[0]["producerBootId"], "camera")
        self.assertFalse(observations[0]["presence"])
        log.assert_called_once()
        worker.vision.reset_tracks.assert_called()


class BrowserFrameTests(unittest.TestCase):
    def test_a_browser_image_is_analysed_once_however_often_it_is_read(self):
        import cv2
        import numpy as np
        from browser_camera import BrowserCamera
        worker = Worker.__new__(Worker)
        worker.camera = BrowserCamera()
        worker.camera.enable()
        people = [{"trackId": "a", "profileId": "p"}]
        worker.vision = Mock()
        worker.vision.analyze.return_value = (people, True, ["visage"])
        image = cv2.imencode(".jpg", np.zeros((48, 64, 3), dtype=np.uint8))[1].tobytes()
        self.assertTrue(worker.camera.receive(image))
        first = worker.frame()
        self.assertFalse(worker.repeated_frame)
        # La boucle à 10 Hz relit la même image : même observation, aucun vote de plus.
        self.assertEqual(worker.frame(), first)
        self.assertTrue(worker.repeated_frame)
        self.assertEqual(worker.frame()[1], people)
        self.assertEqual(worker.vision.analyze.call_count, 1)
        self.assertTrue(worker.camera.receive(image))
        worker.frame()
        self.assertFalse(worker.repeated_frame)
        self.assertEqual(worker.vision.analyze.call_count, 2)
        # Pistes remises à zéro : l’analyse gardée ne vaut plus, même sans image nouvelle.
        worker.reset_tracks()
        worker.frame()
        self.assertEqual(worker.vision.analyze.call_count, 3)

    def test_a_repeated_image_adds_no_view_to_an_enrollment(self):
        worker = Worker.__new__(Worker)
        worker.sequence = 0
        worker.repeated_frame = True
        worker.enrollment = Mock(request={"id": "e", "expiresAt": 9999})
        socket = Mock(send=AsyncMock())
        frame = (1234, [], False, ["visage"], "ok", "camera")

        async def run():
            with patch("worker.asyncio.to_thread", new=AsyncMock(return_value=frame)), \
                 patch("worker.asyncio.sleep", new=AsyncMock(side_effect=asyncio.CancelledError)):
                with self.assertRaises(asyncio.CancelledError):
                    await worker.observations(socket)

        asyncio.run(run())
        worker.enrollment.add.assert_not_called()
        worker.repeated_frame = False
        worker.enrollment.add.return_value = None
        worker.enrollment.progress.return_value = {"step": 0, "collected": 0, "total": 5, "message": ""}
        worker.last_progress = None
        asyncio.run(run())
        worker.enrollment.add.assert_called_once()


class WakeCommandTests(unittest.IsolatedAsyncioTestCase):
    def worker(self, wake):
        worker = Worker.__new__(Worker)
        worker.wake = wake
        worker.wake_streams = {}
        return worker

    async def test_wake_word_is_retried_at_the_next_stream_after_a_failure(self):
        from wake import WakeDetector

        class Model:
            def __init__(self):
                self.broken = False

            def predict(self, frame):
                if self.broken:
                    raise RuntimeError("inférence")
                return {"cornelius": 0.0}

            def reset(self):
                pass

        loaded = []
        detector = WakeDetector.__new__(WakeDetector)
        detector.threshold = 0.5
        detector.load = lambda: loaded.append(Model()) or loaded[-1]
        detector.path = detector.mel = detector.embedding = Path(__file__)
        self.assertTrue(detector.prepare())
        worker = self.worker(detector)
        sent = []
        pcm = bytes([0x57, 0]) + bytes(2560)
        satellite = bytes([0x57, 1]) + bytes(2560)

        class Socket:
            async def send(self, value):
                sent.append(json.loads(value))

            async def __aiter__(self):
                yield json.dumps({"type": "wake_start", "streamId": "miroir", "slot": 0})
                yield json.dumps({"type": "wake_start", "streamId": "salon", "slot": 1})
                yield pcm
                loaded[0].broken = True
                yield pcm
                # En panne : le son est ignoré sans nouvelle erreur.
                yield satellite
                yield json.dumps({"type": "wake_end", "streamId": "miroir"})
                yield json.dumps({"type": "wake_start", "streamId": "miroir-2", "slot": 0})
                yield pcm
                yield satellite

        await worker.commands(Socket())
        self.assertEqual([(event["type"], event["ready"]) for event in sent],
                         [("wake_status", False), ("wake_status", True)])
        # Le satellite, resté inscrit pendant la panne, a retrouvé un modèle à lui.
        self.assertEqual({slot: entry[0] for slot, entry in worker.wake_streams.items()},
                         {0: "miroir-2", 1: "salon"})
        models = [entry[1].model for entry in worker.wake_streams.values()]
        self.assertIsNot(models[0], models[1])
        self.assertNotIn(loaded[0], models)


if __name__ == "__main__":
    unittest.main()
