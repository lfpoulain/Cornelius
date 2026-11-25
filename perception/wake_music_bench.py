"""Banc d'essai hors ligne : le mot d'appel est-il entendu par-dessus un fond sonore ?

Mélange des prises « Cornelius » à des fonds (musique, radio, bruit) à plusieurs rapports
signal sur bruit, puis les passe au vrai détecteur (models/cornelius.onnx, mêmes trames de
1 280 échantillons que le miroir). Mesure aussi les fausses détections sur les fonds seuls.

Ce banc ne remplace pas un essai dans la pièce : pas d'acoustique, pas de haut-parleur, pas
d'annulation d'écho du navigateur. Voir docs/developpement/mesure-mot-appel-musique.md.

    python perception/wake_music_bench.py --wake <dossier de prises> --background <dossier de fonds>
        [--features <dossier melspectrogram/embedding>] [--snr 20 10 5 0 -5] [--fonds 40]
"""
from __future__ import annotations

import argparse
import random
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RATE = 16_000
FRAME = 1_280
THRESHOLD = 0.5
# Contexte avant le mot : le détecteur a besoin d'une à deux secondes pour se remplir.
LEAD_S = 2.5
# Fenêtre où une détection compte comme réponse au mot.
WINDOW_S = 2.0


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as stream:
        if stream.getframerate() != RATE or stream.getnchannels() != 1 or stream.getsampwidth() != 2:
            raise ValueError(f"{path.name} : WAV 16 kHz mono 16 bits attendu")
        data = np.frombuffer(stream.readframes(stream.getnframes()), dtype="<i2")
    return data.astype(np.float32)


def rms(signal: np.ndarray) -> float:
    return float(np.sqrt(np.mean(signal**2))) if len(signal) else 0.0


def active_rms(signal: np.ndarray) -> float:
    """Niveau de la parole seule : les trames de 20 ms au-dessus d'un dixième du pic."""
    frames = signal[: len(signal) // 320 * 320].reshape(-1, 320)
    levels = np.sqrt(np.mean(frames**2, axis=1))
    voiced = levels[levels > levels.max() * 0.1]
    return float(np.sqrt(np.mean(voiced**2))) if len(voiced) else rms(signal)


def load_model(features: Path):
    from openwakeword.model import Model

    return Model(
        wakeword_models=[str(ROOT / "models" / "cornelius.onnx")],
        inference_framework="onnx",
        melspec_model_path=str(features / "melspectrogram.onnx"),
        embedding_model_path=str(features / "embedding_model.onnx"),
    )


def scores(model, signal: np.ndarray) -> np.ndarray:
    """Score de chaque trame, modèle remis à zéro : un essai ne déborde pas sur le suivant."""
    model.reset()
    pcm = np.clip(signal, -32768, 32767).astype("<i2")
    out = []
    for start in range(0, len(pcm) - FRAME + 1, FRAME):
        prediction = model.predict(pcm[start : start + FRAME])
        out.append(float(next(iter(prediction.values()))))
    return np.array(out)


def trial(model, wake: np.ndarray, background: np.ndarray | None, snr_db: float | None) -> float:
    """Meilleur score dans la fenêtre du mot, prononcé après LEAD_S secondes de fond."""
    lead = int(LEAD_S * RATE)
    total = lead + len(wake) + int(WINDOW_S * RATE)
    mix = np.zeros(total, dtype=np.float32)
    mix[lead : lead + len(wake)] += wake
    if background is not None and snr_db is not None:
        bed = np.resize(background, total)
        level = rms(bed)
        if level > 0:
            target = active_rms(wake) / (10 ** (snr_db / 20))
            mix += bed * (target / level)
    # Écrêtage évité : le niveau global est ramené sous la pleine échelle si besoin.
    peak = np.max(np.abs(mix))
    if peak > 30_000:
        mix *= 30_000 / peak
    frame_scores = scores(model, mix)
    first = lead // FRAME
    return float(frame_scores[first:].max()) if len(frame_scores) > first else 0.0


def false_alarms(model, backgrounds: list[np.ndarray]) -> tuple[int, float]:
    """Détections sur les fonds seuls, avec le délai de deux secondes du serveur."""
    count = 0
    seconds = 0.0
    for background in backgrounds:
        frame_scores = scores(model, background)
        seconds += len(background) / RATE
        last = -1e9
        for index, score in enumerate(frame_scores):
            at = index * FRAME / RATE
            if score >= THRESHOLD and at - last >= 2.0:
                count += 1
                last = at
    return count, seconds


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--wake", type=Path, required=True, help="dossier de prises WAV du mot")
    parser.add_argument("--background", type=Path, required=True, help="dossier de fonds WAV")
    parser.add_argument("--features", type=Path, default=ROOT / "models" / "openwakeword")
    parser.add_argument("--snr", type=float, nargs="+", default=[20, 10, 5, 0, -5, -10])
    parser.add_argument("--fonds", type=int, default=40, help="fonds tirés pour les mélanges")
    parser.add_argument("--graine", type=int, default=7)
    args = parser.parse_args()

    wakes = [read_wav(path) for path in sorted(args.wake.glob("*.wav"))]
    paths = sorted(args.background.glob("*.wav"))
    if not wakes or not paths:
        print("Prises ou fonds introuvables.", file=sys.stderr)
        return 1
    random.seed(args.graine)
    chosen = random.sample(paths, min(args.fonds, len(paths)))
    beds = [read_wav(path) for path in chosen]
    model = load_model(args.features)

    clean = [trial(model, wake, None, None) for wake in wakes]
    print(f"Prises : {len(wakes)} ; fonds tirés : {len(beds)} sur {len(paths)} ; seuil {THRESHOLD}")
    print(f"Sans fond : {sum(score >= THRESHOLD for score in clean)}/{len(clean)} détectées")
    print("RSB (dB) | détectées | taux | score médian")
    for snr in args.snr:
        results = []
        for index, wake in enumerate(wakes):
            # Chaque prise passe sur plusieurs fonds, toujours les mêmes d'un RSB à l'autre.
            for bed in beds[index % len(beds) :: max(1, len(beds) // 8)][:8]:
                results.append(trial(model, wake, bed, snr))
        hits = sum(score >= THRESHOLD for score in results)
        print(
            f"{snr:+8.0f} | {hits:4d}/{len(results):<4d} | {100 * hits / len(results):5.1f} % |"
            f" {np.median(results):.2f}"
        )
    alarms, seconds = false_alarms(model, [read_wav(path) for path in paths])
    print(
        f"Fausses détections sur les {len(paths)} fonds seuls ({seconds / 60:.0f} min) : {alarms}"
        f" ({alarms / (seconds / 3600):.2f} par heure)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
