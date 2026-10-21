"""Installe l’environnement Diffusers et un modèle depuis l’administration Cornelius."""

import argparse
import json
import os
import shutil
import subprocess
import sys
import venv
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REPOSITORIES = {
    "sdxl-turbo": "stabilityai/sdxl-turbo",
    "sana-sprint-0.6b": "Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers",
    "flux2-klein-4b": "black-forest-labs/FLUX.2-klein-4B",
    "z-image-turbo": "Tongyi-MAI/Z-Image-Turbo",
}
# Une seule version de PyTorch pour tous les GPU : celle qu’AMD publie pour ROCm 7.2.1,
# qui prend en charge les Radeon et les Ryzen AI (Radeon 890M, gfx1150) sous Linux et Windows.
TORCH_VERSION = "2.9.1"
ROCM_RELEASE = "7.2.1"
WINDOWS_ROCM_FOLDER = "https://repo.radeon.com/rocm/windows/rocm-rel-" + ROCM_RELEASE + "/"
# Sous Windows, AMD fait installer ces composants ROCm SDK avant la roue PyTorch.
WINDOWS_ROCM_SDK = (
    "rocm_sdk_core-" + ROCM_RELEASE + "-py3-none-win_amd64.whl",
    "rocm_sdk_devel-" + ROCM_RELEASE + "-py3-none-win_amd64.whl",
    "rocm_sdk_libraries_custom-" + ROCM_RELEASE + "-py3-none-win_amd64.whl",
    "rocm-" + ROCM_RELEASE + ".tar.gz",
)
BACKENDS = ("auto", "cuda", "rocm", "cpu")
BACKEND_LABELS = {
    "cuda": "PyTorch CUDA 13.0 pour le GPU NVIDIA",
    "rocm": "PyTorch ROCm " + ROCM_RELEASE + " pour le GPU AMD",
    "cpu": "PyTorch pour le processeur",
}


def emit(state, file=None, completed=0, files=2):
    print(json.dumps({
        "state": state,
        "file": file,
        "completed": completed,
        "files": files,
        "received": 0,
        "total": None,
    }), flush=True)


def venv_python(directory):
    return directory / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def run(command):
    # stdout reste réservé au protocole JSON lu par le serveur.
    subprocess.run(command, cwd=ROOT, check=True, stdout=sys.stderr, stderr=sys.stderr)


def succeeds(command):
    return subprocess.run(
        command,
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
        check=False,
    ).returncode == 0


def has_nvidia_gpu():
    executable = shutil.which("nvidia-smi")
    return bool(executable) and succeeds([
        executable,
        "--query-gpu=name",
        "--format=csv,noheader",
    ])


def has_amd_gpu():
    """GPU AMD présent : identifiant PCI 0x1002 sous Linux, nom de l’adaptateur sous Windows."""
    if os.name == "nt":
        try:
            names = subprocess.run(
                ["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_VideoController).Name"],
                capture_output=True,
                text=True,
                timeout=20,
                check=False,
            ).stdout
        except (OSError, subprocess.SubprocessError):
            return False
        return "AMD" in names or "Radeon" in names
    for vendor in Path("/sys/class/drm").glob("card*/device/vendor"):
        try:
            if vendor.read_text(encoding="ascii").strip() == "0x1002":
                return True
        except OSError:
            continue
    return False


def rocm_ready():
    """Sous Linux, le pilote amdgpu n’expose /dev/kfd qu’avec ROCm installé et le GPU pris en charge."""
    return os.name == "nt" or Path("/dev/kfd").exists()


def select_backend(requested=None):
    """auto : NVIDIA, sinon AMD avec ROCm, sinon CPU. CORNELIUS_IMAGE_BACKEND impose un choix."""
    choice = (requested or os.getenv("CORNELIUS_IMAGE_BACKEND") or "auto").strip().lower()
    if choice not in BACKENDS:
        raise ValueError("CORNELIUS_IMAGE_BACKEND attend auto, cuda, rocm ou cpu.")
    if choice != "auto":
        return choice
    if has_nvidia_gpu():
        return "cuda"
    if has_amd_gpu():
        if rocm_ready():
            return "rocm"
        print(
            "GPU AMD détecté sans ROCm (/dev/kfd absent) : génération sur le processeur. "
            "Installez ROCm (docs/installation/gpu.md) puis réinstallez le modèle.",
            file=sys.stderr,
        )
    return "cpu"


def torch_install_command(python, backend, windows=None, version=None, index=None, macos=None):
    """Commande pip qui installe la variante de PyTorch du backend, sans toucher au reste."""
    windows = os.name == "nt" if windows is None else windows
    macos = sys.platform == "darwin" if macos is None else macos
    version = version or os.getenv("CORNELIUS_TORCH_VERSION") or TORCH_VERSION
    index = index or os.getenv("CORNELIUS_TORCH_INDEX_URL")
    base = [str(python), "-m", "pip", "install", "--disable-pip-version-check", "--force-reinstall"]
    if backend == "rocm":
        if index:
            return base + ["torch==" + version, "--find-links", index]
        if windows:
            # AMD ne publie la version Windows que pour Python 3.12, en fichier direct ; ses
            # éventuelles dépendances ROCm se trouvent dans le même dossier.
            return base + [
                WINDOWS_ROCM_FOLDER + "torch-" + version + "%2Brocm" + ROCM_RELEASE + "-cp312-cp312-win_amd64.whl",
                "--find-links", WINDOWS_ROCM_FOLDER,
            ]
        # Le dépôt d’AMD fournit la roue ROCm ; PyPI fournit les dépendances communes.
        return base + [
            "torch==" + version,
            "--find-links", "https://repo.radeon.com/rocm/manylinux/rocm-rel-" + ROCM_RELEASE + "/",
        ]
    if backend == "cpu" and macos and not index:
        # Sous macOS, la roue de PyPI est la bonne : elle utilise le GPU Apple (MPS) s’il existe.
        return base + ["torch==" + version]
    default = "https://download.pytorch.org/whl/" + ("cu130" if backend == "cuda" else "cpu")
    return base + ["torch==" + version, "--index-url", index or default]


def torch_install_commands(python, backend, windows=None, version=None, index=None):
    """Commandes pip, dans l’ordre. Sous Windows, ROCm SDK d’abord, comme dans la doc d’AMD."""
    windows = os.name == "nt" if windows is None else windows
    index = index or os.getenv("CORNELIUS_TORCH_INDEX_URL")
    torch = torch_install_command(python, backend, windows, version, index)
    if backend != "rocm" or not windows or index:
        return [torch]
    # Sans --force-reinstall : des composants déjà présents dans la bonne version sont gardés.
    sdk = [str(python), "-m", "pip", "install", "--disable-pip-version-check"]
    return [sdk + [WINDOWS_ROCM_FOLDER + name for name in WINDOWS_ROCM_SDK], torch]


TORCH_PROBE = (
    "import json, torch; print(json.dumps({'cuda': torch.version.cuda, "
    "'hip': getattr(torch.version, 'hip', None), 'available': torch.cuda.is_available()}))"
)


def torch_state(python):
    try:
        result = subprocess.run(
            [str(python), "-c", TORCH_PROBE],
            cwd=ROOT,
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return None


def torch_matches(state, backend):
    """Un PyTorch déjà installé et utilisable dans la bonne variante est gardé tel quel."""
    if not state:
        return False
    if backend == "cuda":
        return bool(state.get("cuda")) and state.get("available") is True
    if backend == "rocm":
        return bool(state.get("hip")) and state.get("available") is True
    return True


def ensure_torch(python, backend=None):
    backend = backend or select_backend()
    if torch_matches(torch_state(python), backend):
        return backend
    if backend == "rocm" and sys.version_info[:2] != (3, 12):
        raise RuntimeError("PyTorch ROCm d’AMD n’existe que pour Python 3.12.")
    emit("downloading", BACKEND_LABELS[backend], 0)
    for command in torch_install_commands(python, backend):
        run(command)
    state = torch_state(python)
    if not torch_matches(state, backend):
        if backend == "cpu":
            raise RuntimeError("PyTorch ne se charge pas dans l’environnement Python isolé.")
        raise RuntimeError(
            BACKEND_LABELS[backend] + " est installé mais le GPU reste indisponible. "
            "Vérifiez le pilote (ROCm pour AMD) ; CORNELIUS_IMAGE_BACKEND=cpu force le processeur."
        )
    return backend


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True, choices=tuple(REPOSITORIES))
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    environment = ROOT / ".venv-image"
    python = venv_python(environment)
    emit("checking", "Environnement Python isolé", 0)
    if not python.exists():
        venv.EnvBuilder(with_pip=True, clear=False).create(environment)
    ensure_torch(python)
    emit("downloading", "Dépendances verrouillées (Diffusers, Transformers)", 0)
    run([
        str(python), "-m", "pip", "install", "--disable-pip-version-check",
        "-r", str(ROOT / "image_generation/requirements.txt"),
    ])

    emit("downloading", "Modèle " + args.model + " depuis Hugging Face", 1)
    run([
        str(python), str(ROOT / "image_generation/download_model.py"),
        "--model", args.model,
    ])
    emit("ready", None, 2)


if __name__ == "__main__":
    main()
