"""Local openWakeWord inference for the Cornelius wake-word model (models/cornelius.onnx)."""
import os
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
FEATURES = ROOT / "models" / "openwakeword"


# Modèles gardés en réserve entre deux flux : le miroir et quelques satellites.
MAX_IDLE = 4


class WakeDetector:
    # Réserve vide tant que prepare() n’a rien chargé (et pour un détecteur bâti sans __init__).
    idle = ()

    def __init__(self):
        configured = os.getenv("CORNELIUS_WAKE_MODEL", "models/cornelius.onnx")
        self.path = Path(configured)
        if not self.path.is_absolute():
            self.path = ROOT / self.path
        try:
            self.threshold = float(os.getenv("CORNELIUS_WAKE_THRESHOLD", "0.5"))
        except ValueError:
            self.threshold = 0.5
        if not 0 < self.threshold < 1:
            self.threshold = 0.5
        self.mel = FEATURES / "melspectrogram.onnx"
        self.embedding = FEATURES / "embedding_model.onnx"
        self.prepare()

    def prepare(self):
        """Charge le modèle (au démarrage, puis après une panne) ; rend True s’il est prêt.

        Le modèle chargé ici n’est pas qu’un témoin : il attend dans la réserve et sert au
        premier flux de veille.
        """
        self.model = None
        self.detail = None
        self.idle = []
        if not self.path.is_file():
            self.detail = "Modèle absent : placez Cornelius dans models/cornelius.onnx."
            return False
        if not self.mel.is_file() or not self.embedding.is_file():
            self.detail = "Prétraitement openWakeWord absent : installez les modèles de caractéristiques."
            return False
        try:
            self.model = self.load()
        except Exception as error:
            self.detail = "Modèle Cornelius illisible (" + type(error).__name__ + ")."
            return False
        self.idle = [self.model]
        return True

    def fail(self, detail):
        """Panne de chargement ou d’inférence : la réserve est jetée, prepare() retentera."""
        self.model = None
        self.idle = []
        self.detail = detail

    def load(self):
        from openwakeword.model import Model
        return Model(
            wakeword_models=[str(self.path)],
            inference_framework="onnx",
            melspec_model_path=str(self.mel),
            embedding_model_path=str(self.embedding),
        )

    def status(self):
        return {"type": "wake_status", "ready": self.model is not None, "detail": self.detail}

    def stream(self):
        """A listening stream (the mirror or a satellite) with its own audio features."""
        # Un modèle par flux, jamais partagé ; mais un modèle rendu par release() resservira :
        # sans cela, chaque retour en veille relisait trois graphes ONNX du disque.
        model = self.idle.pop() if self.idle else self.load()
        return WakeStream(model, self.threshold)

    def release(self, stream):
        """Rend à la réserve le modèle d’un flux terminé, tampons audio remis à zéro."""
        if stream is None or len(self.idle) >= MAX_IDLE:
            return
        try:
            stream.model.reset()
        except Exception:
            # Modèle douteux : on l’abandonne, le prochain flux en chargera un neuf.
            return
        self.idle = [*self.idle, stream.model]


class WakeStream:
    def __init__(self, model, threshold):
        self.model = model
        self.threshold = threshold
        self.last_detection = 0.0

    def process(self, pcm):
        if len(pcm) != 2560:
            return None
        scores = self.model.predict(np.frombuffer(pcm, dtype="<i2"))
        score = float(next(iter(scores.values())))
        now = time.monotonic()
        if score >= self.threshold and now - self.last_detection >= 2.0:
            self.last_detection = now
            return score
        return None
