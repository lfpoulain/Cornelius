import argparse
import asyncio
import json
import os
import time
from pathlib import Path
from urllib.parse import urlparse

import numpy as np
from websockets.asyncio.client import connect
from vision import DEFAULT_ENGAGEMENT, Vision
from vad import Vad
from wake import WakeDetector
from camera import Camera
from browser_camera import BrowserCamera
from enrollment import Enrollment
from scene import MODEL_DIRECTORIES, SceneCaptioner, SceneWorker

ROOT = Path(__file__).resolve().parent.parent
VISION_DEVICES = {"auto", "gpu", "cpu"}

def load_environment():
    path = ROOT / ".env"
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.strip() and not line.lstrip().startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

class Worker:
    def __init__(self, camera):
        self.vision = None
        self.vad = Vad(ROOT / "models" / "silero.onnx")
        self.wake = WakeDetector()
        # Flux de veille par emplacement : (identifiant du flux, état openWakeWord propre).
        self.wake_streams = {}
        self.server_camera_index = camera
        self.camera = Camera(camera, enabled=False)
        self.camera_enabled = False
        self.sequence = 0
        self.enrollment = None
        self.last_progress = None
        self.interaction = None
        self.last_vad_sent = 0
        self.last_speech = False
        self.profile_templates = []
        # Scores en direct pour l’administration, seulement tant qu’elle les demande.
        self.debug_until = 0
        self.recognition_threshold = 0.42
        self.engagement = dict(DEFAULT_ENGAGEMENT)
        self.tracking_grace_ms = 8000
        self.identity_hold_ms = 8000
        self.vision_model = os.getenv("CORNELIUS_VISION_MODEL", "450m")
        if self.vision_model not in MODEL_DIRECTORIES:
            self.vision_model = "450m"
        self.vision_device = os.getenv("CORNELIUS_VISION_DEVICE", "auto")
        if self.vision_device not in VISION_DEVICES:
            self.vision_device = "auto"
        self.captioner = SceneCaptioner(
            ROOT / "models" / MODEL_DIRECTORIES[self.vision_model],
            model=self.vision_model,
            device=self.vision_device,
        )
        self.scene = None
        self.vision_queue = None
        self.loop = None
        self.camera_lock = None
        self.camera_tasks = set()

    def enable_camera(self, preferred=None, mode=None):
        status = self.camera.enable(preferred, mode)
        self.camera_enabled = True
        if self.vision is None:
            self.vision = Vision(ROOT / "models", self.recognition_threshold)
            self.configure_vision()
        return status

    def configure_vision(self):
        """Applique au module de vision chargé les profils et réglages reçus du serveur."""
        self.vision.set_profiles([
            (profile_id, np.asarray(templates, dtype=np.float32))
            for profile_id, templates in self.profile_templates
        ])
        self.vision.configure(self.recognition_threshold)
        self.vision.configure_engagement(self.engagement)
        self.vision.configure_tracking(self.tracking_grace_ms)
        self.vision.configure_identity_hold(self.identity_hold_ms)

    def start_enrollment(self, request):
        existing = None
        if request.get("mode") == "add":
            existing = next((templates for profile_id, templates in self.profile_templates
                             if profile_id == request.get("profileId")), None)
        return Enrollment(request, existing)

    def live_faces(self, embeddings):
        return [{
            "identity": sample.identity,
            "usable": sample.usable,
            "issue": sample.issue,
            "required": sample.required,
            "scores": [{"profileId": profile_id, "score": score} for score, profile_id in sample.scores],
        } for sample in embeddings]

    def disable_camera(self):
        self.camera_enabled = False
        self.enrollment = None
        self.last_progress = None
        self.vision = None
        return self.camera.disable()

    def frame(self):
        ok, frame, captured, boot = self.camera.read()
        if not ok or self.vision is None:
            return captured, [], False, [], "unavailable", boot
        people, engaged, embeddings = self.vision.analyze(frame)
        return captured, people, engaged, embeddings, "ok", boot

    def _queue_put(self, queue, event):
        if queue is not self.vision_queue:
            return
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            # Queue pleine : on lâche l'événement plutôt que de laisser l'exception
            # remonter dans la boucle (les demandes expirent côté serveur).
            pass

    def vision_emit(self, event):
        # Called from the inference thread; never touch the socket from there.
        queue, loop = self.vision_queue, self.loop
        if queue is None or loop is None:
            return
        try:
            loop.call_soon_threadsafe(self._queue_put, queue, event)
        except RuntimeError:
            # The event loop may close while a native inference is completing.
            pass

    def scene_worker(self):
        if self.scene is None:
            self.scene = SceneWorker(self.captioner, lambda: self.camera.frame(), self.vision_emit)
        return self.scene

    def set_vision_model(self, requested, device=None, reload=False):
        """Switch model/device on the existing inference thread, without blocking audio."""
        if not isinstance(requested, str) or requested not in MODEL_DIRECTORIES:
            return
        device = self.vision_device if device is None else device
        if not isinstance(device, str) or device not in VISION_DEVICES:
            return
        if requested == self.vision_model and device == self.vision_device and not reload:
            return
        self.vision_model = requested
        self.vision_device = device
        self.captioner = SceneCaptioner(
            ROOT / "models" / MODEL_DIRECTORIES[requested],
            model=requested,
            device=device,
        )
        if self.scene:
            self.scene.replace_captioner(self.captioner)

    async def vision_events(self, socket):
        while True:
            event = await self.vision_queue.get()
            await socket.send(json.dumps(event))

    async def observations(self, socket):
        # Target 10 Hz including capture, recognition and publication. Slow frames
        # never cause catch-up bursts; sleep(0) still yields to audio and commands.
        while True:
            if not getattr(self, "camera_enabled", True):
                await asyncio.sleep(0.1)
                continue
            started = time.monotonic()
            captured, people, engaged, embeddings, health, boot = await asyncio.to_thread(self.frame)
            self.sequence += 1
            await socket.send(json.dumps({"type": "observation", "observation": {
                "schemaVersion": 1, "producerBootId": boot, "sequence": self.sequence,
                "observedAt": captured, "health": health, "presence": bool(people),
                "engaged": engaged, "people": people,
            }}))
            debug_until = getattr(self, "debug_until", 0)
            if debug_until and self.sequence % 3 == 0 and time.monotonic() < debug_until:
                await socket.send(json.dumps({
                    "type": "recognition_live", "observedAt": captured,
                    "threshold": self.recognition_threshold, "faces": self.live_faces(embeddings),
                }))
            enrollment = self.enrollment
            if enrollment and enrollment.request["expiresAt"] > captured:
                templates = enrollment.add(embeddings, time.monotonic())
                if templates:
                    await socket.send(json.dumps({"type": "enrolled", "id": enrollment.request["id"], "templates": templates}))
                    self.enrollment = None
                else:
                    progress = enrollment.progress()
                    if progress != self.last_progress:
                        await socket.send(json.dumps({"type": "enrollment_progress", "id": enrollment.request["id"], **progress}))
                        self.last_progress = progress
            await asyncio.sleep(max(0.0, 0.1 - (time.monotonic() - started)))

    def camera_job(self, job):
        """Opération caméra en tâche de fond, dans l’ordre d’arrivée.

        Ouvrir une caméra prend une à plusieurs secondes (surtout sous Windows et en HD). Faite
        dans la boucle des commandes, elle bloquait le son du micro : plus de détection de
        parole, et le serveur coupait la conversation qui venait de s’ouvrir.
        """
        if getattr(self, "camera_lock", None) is None:
            self.camera_lock = asyncio.Lock()
        if getattr(self, "camera_tasks", None) is None:
            self.camera_tasks = set()
        lock = self.camera_lock

        async def run():
            async with lock:
                await job()

        task = asyncio.create_task(run())
        self.camera_tasks.add(task)
        task.add_done_callback(self.camera_tasks.discard)
        task.add_done_callback(lambda done: done.cancelled() or done.exception())
        return task

    async def commands(self, socket):
        async for message in socket:
            if isinstance(message, bytes):
                # Binary dispatch reserves 1024 bytes for VAD PCM and 2562 bytes
                # starting with 0x57 for wake PCM. Camera packets start with 0x43;
                # encodeBrowserCameraFrame inserts a JPEG comment to avoid both
                # reserved lengths. Future binary messages must preserve this rule.
                if (len(message) >= 9 and len(message) not in (1024, 2562)
                        and message[0] == 0x43 and message[5:7] == b"\xff\xd8"):
                    accepted = False
                    if isinstance(getattr(self, "camera", None), BrowserCamera) and self.camera_enabled:
                        had_frame = self.camera.selected_id is not None
                        accepted = await asyncio.to_thread(self.camera.receive, message[5:])
                        if accepted and not had_frame:
                            await socket.send(json.dumps(self.camera.status()))
                    await socket.send(json.dumps({"type": "camera_frame_ack",
                        "sequence": int.from_bytes(message[1:5], "big"), "accepted": accepted}))
                    continue
                if len(message) == 2562 and message[0] == 0x57:
                    entry = self.wake_streams.get(message[1])
                    if entry is None or self.wake.model is None:
                        continue
                    stream_id, stream = entry
                    try:
                        score = await asyncio.to_thread(stream.process, message[2:])
                    except Exception as error:
                        self.wake.model = None
                        self.wake_streams = {}
                        self.wake.detail = "Inférence du mot d’appel indisponible (" + type(error).__name__ + ")."
                        await socket.send(json.dumps(self.wake.status()))
                        continue
                    if score is not None:
                        await socket.send(json.dumps({
                            "type": "wake_detected", "streamId": stream_id, "score": score
                        }))
                    continue
                if len(message) != 1024 or self.interaction is None:
                    continue
                speaking = self.vad.process(message)
                now = time.monotonic()
                if speaking != self.last_speech or now - self.last_vad_sent > 0.25:
                    await socket.send(json.dumps({"type": "vad", "interactionId": self.interaction, "speaking": speaking}))
                    self.last_speech, self.last_vad_sent = speaking, now
                continue
            event = json.loads(message)
            if event["type"] == "camera_source" and event.get("source") in ("server", "browser"):
                requested = event["source"] == "browser"
                if requested != isinstance(self.camera, BrowserCamera):
                    for task in list(self.camera_tasks):
                        await task
                    if self.scene:
                        self.scene.cancel("Source de la caméra modifiée.")
                    await asyncio.to_thread(self.disable_camera)
                    self.camera = BrowserCamera() if requested else Camera(self.server_camera_index, enabled=False)
                await socket.send(json.dumps({"type": "camera_source_status", "source": event["source"]}))
            elif event["type"] == "browser_camera_reset":
                if isinstance(getattr(self, "camera", None), BrowserCamera):
                    await asyncio.to_thread(self.camera.reset)
                    if self.vision:
                        self.vision.reset_tracks()
                    await socket.send(json.dumps(self.camera.status()))
            elif event["type"] in ("camera_enabled", "camera_list", "camera_select", "camera_mode", "camera_preview"):
                if isinstance(getattr(self, "camera", None), BrowserCamera):
                    await self.camera_command(socket, event)
                else:
                    self.camera_job(lambda event=event: self.camera_command(socket, event))
            elif event["type"] == "engagement":
                self.engagement = event["settings"]
                if self.vision:
                    self.vision.configure_engagement(self.engagement)
            elif event["type"] == "tracking":
                self.tracking_grace_ms = event["graceMs"]
                self.identity_hold_ms = event.get("identityHoldMs", 8000)
                if self.vision:
                    self.vision.configure_tracking(self.tracking_grace_ms)
                    self.vision.configure_identity_hold(self.identity_hold_ms)
            elif event["type"] == "recognition":
                self.recognition_threshold = event["threshold"]
                if self.vision:
                    self.vision.configure(self.recognition_threshold)
            elif event["type"] == "profiles":
                self.profile_templates = [
                    (p["profileId"], p["templates"]) for p in event["profiles"]
                ]
                self.recognition_threshold = event.get("recognitionThreshold", 0.42)
                self.tracking_grace_ms = event.get("trackingGraceMs", 8000)
                self.identity_hold_ms = event.get("identityHoldMs", 8000)
                self.engagement = event.get("engagement", dict(DEFAULT_ENGAGEMENT))
                if self.vision:
                    self.configure_vision()
                request = event.get("enrollment")
                if request is None or self.enrollment is None or self.enrollment.request["id"] != request["id"]:
                    self.enrollment = self.start_enrollment(request) if request and self.camera_enabled else None
                    self.last_progress = None
            elif event["type"] == "enroll":
                if self.camera_enabled:
                    self.enrollment, self.last_progress = self.start_enrollment(event["enrollment"]), None
            elif event["type"] == "recognition_debug":
                self.debug_until = time.monotonic() + 5
            elif event["type"] == "vision_cancel":
                if self.scene:
                    self.scene.cancel("Analyse annulée par le serveur.")
            elif event["type"] == "vision":
                self.scene_worker().request(event["requestId"], event["trigger"], event.get("question"))
            elif event["type"] == "vision_warm":
                self.scene_worker().warm()
            elif event["type"] == "vision_model":
                requested = event.get("model")
                self.set_vision_model(
                    requested,
                    device=event.get("device"),
                    reload=event.get("reload") is True,
                )
            elif event["type"] == "audio":
                self.interaction = event["interactionId"]
                self.vad.reset()
            elif (event["type"] == "wake_start" and isinstance(event.get("streamId"), str)
                  and isinstance(event.get("slot"), int) and 0 <= event["slot"] < 256):
                if self.wake.model is not None:
                    try:
                        stream = await asyncio.to_thread(self.wake.stream)
                    except Exception as error:
                        self.wake.model = None
                        self.wake_streams = {}
                        self.wake.detail = "Modèle Cornelius illisible (" + type(error).__name__ + ")."
                        await socket.send(json.dumps(self.wake.status()))
                    else:
                        self.wake_streams[event["slot"]] = (event["streamId"], stream)
            elif event["type"] == "wake_end":
                self.wake_streams = {slot: entry for slot, entry in self.wake_streams.items()
                                     if entry[0] != event.get("streamId")}

    async def camera_command(self, socket, event):
        if event["type"] == "camera_enabled":
            enabled = event.get("enabled") is True
            if enabled:
                status = await asyncio.to_thread(self.enable_camera, event.get("deviceId"), event.get("mode"))
            else:
                status = await asyncio.to_thread(self.disable_camera)
                if self.scene:
                    self.scene.cancel("Caméra désactivée.")
            await socket.send(json.dumps(status))
        elif event["type"] == "camera_list":
            if self.camera_enabled:
                await socket.send(json.dumps(await asyncio.to_thread(self.camera.refresh)))
        elif event["type"] == "camera_select":
            if not self.camera_enabled:
                return
            status = await asyncio.to_thread(self.camera.select, event["id"])
            if self.vision:
                self.vision.reset_tracks()
            self.enrollment, self.last_progress = None, None
            status["requestId"] = event["requestId"]
            await socket.send(json.dumps(status))
        elif event["type"] == "camera_mode":
            status = await asyncio.to_thread(self.camera.set_mode, event.get("mode"))
            if self.vision:
                self.vision.reset_tracks()
            if "requestId" in event:
                status["requestId"] = event["requestId"]
            if self.camera_enabled:
                await socket.send(json.dumps(status))
        elif event["type"] == "camera_preview":
            image = await asyncio.to_thread(self.camera.preview)
            if image is not None:
                await socket.send(event["requestId"].encode("ascii") + image)

    async def run(self, origin, token):
        url = urlparse(origin)
        if url.scheme != "http" or url.hostname not in ("localhost", "127.0.0.1"):
            raise ValueError("La perception exige un serveur HTTP sur la boucle locale.")
        while True:
            try:
                async with connect("ws://" + url.netloc + "/perception", origin=origin,
                                   additional_headers={"Authorization": "Bearer " + token},
                                   max_size=256_000, max_queue=4, open_timeout=5) as socket:
                    self.enrollment, self.last_progress, self.interaction = None, None, None
                    self.wake_streams = {}
                    self.vad.reset()
                    self.loop = asyncio.get_running_loop()
                    self.vision_queue = asyncio.Queue(maxsize=16)
                    if self.scene:
                        self.scene.cancel("Perception reconnectée.")
                    await socket.send(json.dumps(self.wake.status()))
                    tasks = [asyncio.create_task(self.observations(socket)),
                             asyncio.create_task(self.commands(socket)),
                             asyncio.create_task(self.vision_events(socket))]
                    try:
                        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                        for task in done:
                            task.result()
                    finally:
                        pending = [*tasks, *self.camera_tasks]
                        for task in pending:
                            task.cancel()
                        await asyncio.gather(*pending, return_exceptions=True)
                        self.camera_tasks.clear()
                        self.camera_lock = None
                        if self.scene:
                            self.scene.cancel("Perception déconnectée.")
                        await asyncio.to_thread(self.disable_camera)
                        self.vision_queue = None
                        self.loop = None
            except Exception as error:
                # No images, embeddings, tokens or transcript content in logs.
                print("Perception déconnectée : " + type(error).__name__, flush=True)
                await asyncio.sleep(2)

def main():
    load_environment()
    parser = argparse.ArgumentParser()
    parser.add_argument("--camera", type=int, default=int(os.getenv("CORNELIUS_CAMERA_INDEX", "0")))
    parser.add_argument("--model", default=os.getenv("CORNELIUS_VISION_MODEL", "450m"),
                        help="Modèle de vision : 450m, 1.6b ou 3b.")
    parser.add_argument("--device", choices=sorted(VISION_DEVICES),
                        default=os.getenv("CORNELIUS_VISION_DEVICE", "auto"),
                        help="Calcul de vision : auto, gpu ou cpu.")
    parser.add_argument("--check", action="store_true", help="Vérifie la caméra et les modèles sans serveur ni cloud.")
    parser.add_argument("--with-vision", action="store_true",
                        help="Charge vraiment le modèle LFM dans --check (lent : lit ~1 Go) ; sinon seuls les fichiers sont vérifiés.")
    args = parser.parse_args()
    if args.model in MODEL_DIRECTORIES:
        os.environ["CORNELIUS_VISION_MODEL"] = args.model
    os.environ["CORNELIUS_VISION_DEVICE"] = args.device
    worker = Worker(args.camera)
    try:
        if args.check:
            worker.enable_camera()
            frames = [worker.frame() for _ in range(5)]
            vision_files = worker.captioner.files_present()
            vision_ready = bool(vision_files)
            if vision_files and args.with_vision:
                try:
                    worker.captioner.load()
                except Exception as error:
                    vision_ready = False
                    print("Modèle de vision illisible : " + str(error)[:240], flush=True)
            print(json.dumps({"camera": all(f[4] == "ok" for f in frames), "frames": len(frames),
                              "vadSilence": worker.vad.process(bytes(1024)),
                              "wakeWord": worker.wake.status(),
                              "visionModel": worker.vision_model,
                              "visionDeviceSetting": worker.vision_device,
                              "visionFiles": vision_files,
                              "visionReady": vision_ready,
                              "visionDevice": worker.captioner.device_label()}))
            if any(f[4] != "ok" for f in frames):
                raise SystemExit(1)
            return
        token = os.getenv("CORNELIUS_PERCEPTION_TOKEN", "")
        if len(token) < 32:
            raise ValueError("Exécutez npm run setup pour préparer la clé de perception.")
        asyncio.run(worker.run("http://127.0.0.1:" + os.getenv("PORT", "3000"), token))
    finally:
        if worker.scene:
            worker.scene.stop()
        worker.disable_camera()

if __name__ == "__main__":
    main()
