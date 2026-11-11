"""Install only openWakeWord's shared ONNX feature models, on explicit request."""
import hashlib
from pathlib import Path
from urllib.request import urlopen

# Même dossier et même environnement Python : l’empreinte n’est écrite qu’une fois.
from download_models import digest

ROOT = Path(__file__).resolve().parent.parent
DESTINATION = ROOT / "models" / "openwakeword"
BASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1/"
FILES = {
    "melspectrogram.onnx": "ba2b0e0f8b7b875369a2c89cb13360ff53bac436f2895cced9f479fa65eb176f",
    "embedding_model.onnx": "70d164290c1d095d1d4ee149bc5e00543250a7316b59f31d056cff7bd3075c1f",
}


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    for name, expected in FILES.items():
        target = DESTINATION / name
        if target.is_file() and digest(target) == expected:
            print(name + " : déjà présent")
            continue
        temporary = target.with_suffix(".part")
        try:
            value = hashlib.sha256()
            with urlopen(BASE + name, timeout=30) as response, temporary.open("wb") as output:
                received = 0
                while chunk := response.read(64 * 1024):
                    received += len(chunk)
                    if received > 30_000_000:
                        raise ValueError("Fichier de modèle trop volumineux.")
                    value.update(chunk)
                    output.write(chunk)
            if value.hexdigest() != expected:
                raise ValueError(name + " : empreinte SHA-256 inattendue.")
            temporary.replace(target)
            print(name + " : installé")
        finally:
            temporary.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
