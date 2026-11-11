"""Worker local text-to-image pour Cornelius.

Le modèle et les prompts ne quittent jamais la machine. Le processus garde un seul
pipeline Diffusers en mémoire et écrit uniquement dans le chemin choisi par le serveur.
"""

import argparse
import asyncio
import gc
import inspect
import json
import os
import random
import shutil
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

from websockets.asyncio.client import connect

ROOT = Path(__file__).resolve().parent.parent
MODELS = {
    "sdxl-turbo": "stabilityai/sdxl-turbo",
    "sana-sprint-0.6b": "Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers",
    "flux2-klein-4b": "black-forest-labs/FLUX.2-klein-4B",
    "z-image-turbo": "Tongyi-MAI/Z-Image-Turbo",
}


GIB = 1024 ** 3
# Activations, VAE et tampons CUDA d’un calcul en 1024 × 1024, en plus des poids.
VRAM_MARGIN = int(3.5 * GIB)
# Copie bf16 du transformer de Z-Image, publié en FP32 : 12 Go à relire au lieu de 25.
BF16_DIRECTORY = "transformer-bf16"
BF16_READY = ".cornelius-bf16"


def stored_float32(folder):
    """Les poids safetensors du dossier sont-ils stockés en FP32 ? Lit seulement l’en-tête."""
    shards = sorted(Path(folder).glob("*.safetensors"))
    if not shards:
        return False
    with open(shards[0], "rb") as handle:
        size = int.from_bytes(handle.read(8), "little")
        header = json.loads(handle.read(size))
    return any(
        isinstance(entry, dict) and entry.get("dtype") == "F32"
        for key, entry in header.items()
        if key != "__metadata__"
    )


def save_bf16_copy(transformer, target):
    """Écrit la copie bf16 une fois. Le marqueur n’arrive qu’après une écriture complète :
    une copie interrompue (disque plein, arrêt) n’est jamais chargée."""
    target = Path(target)
    temporary = target.with_name(target.name + ".tmp")
    shutil.rmtree(temporary, ignore_errors=True)
    transformer.save_pretrained(temporary, safe_serialization=True, max_shard_size="5GB")
    shutil.rmtree(target, ignore_errors=True)
    temporary.rename(target)
    (target / BF16_READY).write_text("bf16\n", encoding="utf-8")


def module_bytes(module):
    """Taille des poids d’un composant dans leur type actuel (bf16, fp16…)."""
    total = 0
    for collection in ("parameters", "buffers"):
        values = getattr(module, collection, None)
        if callable(values):
            total += sum(value.numel() * value.element_size() for value in values())
    return total


def pipeline_bytes(pipe):
    """Taille des poids du pipeline dans leur type de calcul."""
    return sum(module_bytes(component) for component in getattr(pipe, "components", {}).values())


def choose_placement(setting, weights, free, fp8_weights=None):
    """« gpu » si tout tient en VRAM ; sinon « fp8 » si le transformer stocké en FP8 tient ;
    sinon « offload » : un composant à la fois en VRAM.

    Sous Windows, un pipeline plus grand que la VRAM libre ne plante pas : le pilote NVIDIA
    déborde en silence sur la mémoire système partagée et chaque étape devient très lente.
    CORNELIUS_IMAGE_CPU_OFFLOAD=1 impose le déchargement, =0 la VRAM complète en bf16 ;
    CORNELIUS_IMAGE_FP8=0 écarte l’étape FP8 ; CORNELIUS_IMAGE_VRAM_GB fixe la mémoire comptée.
    """
    if setting == "1":
        return "offload"
    if setting == "0" or free is None:
        return "gpu"
    if weights + VRAM_MARGIN <= free:
        return "gpu"
    if fp8_weights is not None and fp8_weights + VRAM_MARGIN <= free:
        return "fp8"
    return "offload"


def vram_budget(free):
    """CORNELIUS_IMAGE_VRAM_GB remplace la mémoire GPU libre lue par PyTorch. Sur un processeur
    à GPU intégré (Ryzen AI, mémoire partagée), ROCm peut ne compter que la réserve du BIOS."""
    configured = os.getenv("CORNELIUS_IMAGE_VRAM_GB", "").strip().replace(",", ".")
    if configured:
        try:
            value = float(configured)
        except ValueError:
            return free
        if value > 0:
            return int(value * GIB)
    return free


def display_device(device):
    """« rocm » pour un GPU AMD : PyTorch ROCm garde volontairement le nom cuda."""
    if device != "cuda":
        return device
    try:
        import torch
    except ImportError:
        return device
    return "rocm" if getattr(torch.version, "hip", None) else device


def gigabytes(value):
    return f"{value / GIB:.1f}".replace(".", ",") + " Go"


def sana_settings(request):
    """SCM n'accepte une étape intermédiaire explicite qu'en mode deux étapes."""
    steps = request.get("sanaSteps", 2)
    if steps not in (2, 4):
        raise ValueError("Nombre d'étapes SANA invalide.")
    settings = {
        "height": 1024,
        "width": 1024,
        "num_inference_steps": steps,
        "guidance_scale": 4.5,
        "use_resolution_binning": False,
    }
    if steps == 4:
        settings["intermediate_timesteps"] = None
    return settings


def model_path(model):
    path = ROOT / "models" / "image-generation" / model
    if not (path / ".cornelius-ready").exists():
        raise RuntimeError("Modèle non installé. Installez-le depuis la page Modules.")
    return path


def load_environment():
    path = ROOT / ".env"
    if not path.exists():
        return
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.lstrip().startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            # Clé en double : la dernière ligne l’emporte, comme pour Node (--env-file).
            values[key.strip()] = value.strip().strip('"').strip("'")
    for key, value in values.items():
        os.environ.setdefault(key, value)


def select_device(torch, requested):
    if requested == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("CUDA demandé mais indisponible.")
        return "cuda"
    if requested == "mps":
        if not torch.backends.mps.is_available():
            raise RuntimeError("Metal demandé mais indisponible.")
        return "mps"
    if requested == "cpu":
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    if torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class GenerationCancelled(Exception):
    """Le serveur a annulé ou remplacé la demande en cours."""


class Generator:
    def __init__(self, requested_device):
        self.requested_device = requested_device
        self.model = None
        self.pipe = None
        self.device = None
        # Placement retenu au chargement, affiché dans l’administration.
        self.placement = None
        # Un seul calcul à la fois sur le pipeline, même après une reconnexion du serveur.
        self.lock = threading.RLock()

    def ready_detail(self, prefix="Modèle prêt"):
        return prefix + (" · " + self.placement if self.placement else "") + "."

    def load(self, model):
        with self.lock:
            self._load(model)

    def _load(self, model):
        if self.pipe is not None and self.model == model:
            return
        import torch
        from diffusers import DiffusionPipeline

        device = select_device(torch, self.requested_device)
        if self.pipe is not None:
            previous = self.pipe
            self.pipe = None
            self.model = None
            self.device = None
            self.placement = None
            del previous
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        if model == "sdxl-turbo":
            dtype = torch.float32 if device == "cpu" else torch.float16
            pipe = DiffusionPipeline.from_pretrained(
                model_path(model),
                torch_dtype=dtype,
                variant="fp16",
                use_safetensors=True,
            )
        elif model == "sana-sprint-0.6b":
            dtype = (
                torch.bfloat16
                if device == "cuda" and torch.cuda.is_bf16_supported()
                else torch.float32
            )
            pipe = DiffusionPipeline.from_pretrained(model_path(model), torch_dtype=dtype)
        else:
            dtype = (
                torch.bfloat16
                if device == "cuda" and torch.cuda.is_bf16_supported()
                else torch.float16
                if device in ("cuda", "mps")
                else torch.float32
            )
            path = model_path(model)
            converted = path / BF16_DIRECTORY
            if dtype == torch.bfloat16 and (converted / BF16_READY).exists():
                from diffusers import AutoModel

                transformer = AutoModel.from_pretrained(str(converted), torch_dtype=dtype)
                pipe = DiffusionPipeline.from_pretrained(
                    path, transformer=transformer, torch_dtype=dtype
                )
            else:
                pipe = DiffusionPipeline.from_pretrained(path, torch_dtype=dtype)
                # Z-Image publie son transformer en FP32 et la fiche du modèle le fait tourner
                # en bf16 : la conversion faite à chaque chargement est écrite une fois.
                if (
                    dtype == torch.bfloat16
                    and stored_float32(path / "transformer")
                    and shutil.disk_usage(path).free > 14 * GIB
                ):
                    try:
                        save_bf16_copy(pipe.transformer, converted)
                        print("Génération d’image : copie bf16 de " + model + " créée.", flush=True)
                    except Exception as error:
                        print("Copie bf16 impossible : " + type(error).__name__, flush=True)
        placement = None
        if device == "cuda":
            torch.cuda.empty_cache()
            weights = pipeline_bytes(pipe)
            try:
                free = torch.cuda.mem_get_info()[0]
            except RuntimeError:
                free = None
            free = vram_budget(free)
            transformer = getattr(pipe, "transformer", None)
            encoder = getattr(pipe, "text_encoder", None)
            fp8 = (
                os.getenv("CORNELIUS_IMAGE_FP8", "1") != "0"
                and hasattr(torch, "float8_e4m3fn")
                and callable(getattr(transformer, "enable_layerwise_casting", None))
            )
            mode = choose_placement(
                os.getenv("CORNELIUS_IMAGE_CPU_OFFLOAD", "auto"),
                weights,
                free,
                # Couches linéaires sur un octet au lieu de deux ; normalisations et
                # plongements restent en bf16, d’où une économie comptée à 45 %.
                weights - int((module_bytes(transformer) + module_bytes(encoder)) * 0.45)
                if fp8
                else None,
            )
            if mode == "offload":
                pipe.enable_model_cpu_offload()
                placement = (
                    "déchargement CPU : " + gigabytes(weights) + " de poids pour "
                    + (gigabytes(free) if free is not None else "une VRAM inconnue")
                    + " libres, un composant à la fois en VRAM"
                )
            elif mode == "fp8":
                # Stockage FP8, calcul en bf16 couche par couche : tout reste en VRAM.
                # Les versions FP8 du transformer et de Qwen3 sont courantes sous ComfyUI.
                from diffusers.hooks import apply_layerwise_casting

                transformer.enable_layerwise_casting(
                    storage_dtype=torch.float8_e4m3fn, compute_dtype=dtype
                )
                if isinstance(encoder, torch.nn.Module):
                    apply_layerwise_casting(
                        encoder, storage_dtype=torch.float8_e4m3fn, compute_dtype=dtype
                    )
                pipe.to(device)
                placement = (
                    "poids stockés en FP8 (" + gigabytes(free) + " libres pour "
                    + gigabytes(weights) + " en bf16), calcul en bf16, tout en VRAM"
                )
            else:
                pipe.to(device)
                placement = "entièrement en VRAM (" + gigabytes(weights) + ")"
            print("Génération d’image : " + model + " " + placement, flush=True)
        else:
            pipe.to(device)
        pipe.set_progress_bar_config(disable=True)
        self.pipe = pipe
        self.model = model
        self.device = device
        self.placement = placement

    def generate(self, request, stop=None):
        """stop : signal levé par le serveur ; l’inférence s’arrête à l’étape suivante."""
        with self.lock:
            return self._generate(request, stop or threading.Event())

    def _generate(self, request, stop):
        import torch

        if stop.is_set():
            raise GenerationCancelled()
        self._load(request["model"])
        seed = request.get("seed")
        if seed is None:
            seed = random.SystemRandom().randint(0, 2_147_483_647)
        generator_device = "cuda" if self.device == "cuda" else "cpu"
        generator = torch.Generator(device=generator_device).manual_seed(seed)
        parameters = {
            "prompt": request["prompt"],
            "height": request["height"],
            "width": request["width"],
            "generator": generator,
        }
        def step(pipe, index, timestep, callback_kwargs):
            if stop.is_set():
                raise GenerationCancelled()
            return callback_kwargs

        if "callback_on_step_end" in inspect.signature(self.pipe.__call__).parameters:
            parameters["callback_on_step_end"] = step
        if request["model"] == "sdxl-turbo":
            parameters.update(num_inference_steps=1, guidance_scale=0.0)
        elif request["model"] == "sana-sprint-0.6b":
            # Le calcul se fait à 1024 px ; le fichier final reste à 512 px.
            parameters.update(sana_settings(request))
        elif request["model"] == "z-image-turbo":
            # Réglages de la fiche du modèle : 1024 px, 9 pas (8 passes), sans guidance.
            # Le fichier final reste à 512 px, comme pour SANA.
            parameters.update(height=1024, width=1024, num_inference_steps=9, guidance_scale=0.0)
        else:
            parameters.update(num_inference_steps=4, guidance_scale=1.0)
        image = self.pipe(**parameters).images[0]
        if stop.is_set():
            raise GenerationCancelled()
        if image.size != (request["width"], request["height"]):
            from PIL import Image

            image = image.resize(
                (request["width"], request["height"]), Image.Resampling.LANCZOS
            )
        output = Path(request["output"]).resolve()
        allowed = (ROOT / "data" / "generated-images").resolve()
        if output.parent != allowed or output.suffix.lower() != ".webp":
            raise RuntimeError("Chemin de sortie refusé.")
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_suffix(".tmp.webp")
        image.save(temporary, format="WEBP", quality=92, method=4)
        temporary.replace(output)
        return seed


def validate_request(event):
    return (
        isinstance(event.get("requestId"), str)
        and isinstance(event.get("prompt"), str)
        and 3 <= len(event["prompt"]) <= 1000
        and event.get("model") in MODELS
        and (event.get("model") != "sana-sprint-0.6b" or event.get("sanaSteps", 2) in (2, 4))
        and event.get("width") == 512
        and event.get("height") == 512
        and isinstance(event.get("output"), str)
        and (event.get("seed") is None or isinstance(event.get("seed"), int))
    )


async def serve(socket, generator):
    """Lit les commandes pendant qu’une image se calcule : une annulation interrompt la
    génération en cours et une demande déjà annulée n’est jamais lancée."""
    jobs = asyncio.Queue()
    cancelled = set()
    current = {"id": None, "stop": None}

    def ready(prefix):
        detail = getattr(generator, "ready_detail", None)
        return detail(prefix) if callable(detail) else prefix + "."

    async def status(detail):
        await socket.send(json.dumps({
            "type": "status",
            "model": generator.model,
            "device": display_device(generator.device),
            "detail": detail,
        }))

    async def read():
        async for message in socket:
            event = json.loads(message)
            kind = event.get("type")
            if kind == "cancel" and isinstance(event.get("requestId"), str):
                cancelled.add(event["requestId"])
                while len(cancelled) > 256:
                    cancelled.pop()
                if current["id"] == event["requestId"]:
                    current["stop"].set()
            elif kind == "configure" and event.get("model") in MODELS:
                if event.get("preload") is True:
                    jobs.put_nowait(("load", event["model"]))
            elif kind == "generate" and validate_request(event):
                jobs.put_nowait(("generate", event))

    async def work():
        while True:
            job = await jobs.get()
            if job[0] == "load":
                if generator.pipe is not None and generator.model == job[1]:
                    continue
                await status("Préchargement du modèle…")
                try:
                    await asyncio.to_thread(generator.load, job[1])
                    await status(ready("Modèle préchargé, prêt pour la première image"))
                except Exception as error:
                    await status(("Préchargement impossible : " + type(error).__name__ + ": " + str(error))[:240])
                continue
            event = job[1]
            request_id = event["requestId"]
            if request_id in cancelled:
                cancelled.discard(request_id)
                continue
            stop = threading.Event()
            current.update(id=request_id, stop=stop)
            started = time.monotonic()
            try:
                await status("Chargement du modèle ou génération en cours…")
                seed = await asyncio.to_thread(generator.generate, event, stop)
                await status(ready("Modèle prêt"))
                await socket.send(json.dumps({
                    "type": "result",
                    "requestId": request_id,
                    "seed": seed,
                    "durationMs": round((time.monotonic() - started) * 1000),
                }))
            except GenerationCancelled:
                await status("Génération interrompue par une nouvelle demande.")
            except Exception as error:
                await socket.send(json.dumps({
                    "type": "error",
                    "requestId": request_id,
                    "message": (type(error).__name__ + ": " + str(error))[:240],
                }))
            finally:
                current.update(id=None, stop=None)

    tasks = [asyncio.create_task(read()), asyncio.create_task(work())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in done:
            task.result()
    finally:
        # Une génération native en cours s’arrête à l’étape suivante après déconnexion.
        if current["stop"] is not None:
            current["stop"].set()
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


async def run(origin, token, requested_device):
    url = urlparse(origin)
    if url.scheme != "http" or url.hostname not in ("localhost", "127.0.0.1"):
        raise ValueError("Le générateur exige un serveur HTTP sur la boucle locale.")
    import torch

    generator = Generator(requested_device)
    generator.device = select_device(torch, requested_device)
    device_detail = (
        ("ROCm" if getattr(torch.version, "hip", None) else "CUDA")
        + " prêt · " + torch.cuda.get_device_name(0) + " ; modèle chargé à la demande."
        if generator.device == "cuda"
        else generator.device.upper() + " prêt ; modèle chargé à la demande."
    )
    while True:
        try:
            async with connect(
                "ws://" + url.netloc + "/image-generation",
                origin=origin,
                additional_headers={"Authorization": "Bearer " + token},
                max_size=256_000,
                max_queue=4,
                open_timeout=5,
            ) as socket:
                await socket.send(json.dumps({
                    "type": "status",
                    "model": generator.model,
                    "device": display_device(generator.device),
                    "detail": device_detail,
                }))
                await serve(socket, generator)
        except Exception as error:
            print("Générateur déconnecté : " + type(error).__name__, flush=True)
            await asyncio.sleep(2)


def main():
    load_environment()
    parser = argparse.ArgumentParser()
    parser.add_argument("--origin", default=os.getenv("CORNELIUS_ORIGIN", "http://127.0.0.1:3000"))
    parser.add_argument(
        "--device",
        choices=("auto", "cuda", "mps", "cpu"),
        default=os.getenv("CORNELIUS_IMAGE_DEVICE", "auto"),
    )
    args = parser.parse_args()
    token = os.getenv("CORNELIUS_IMAGE_GENERATION_TOKEN", "")
    if not token:
        raise SystemExit("CORNELIUS_IMAGE_GENERATION_TOKEN manque dans .env.")
    asyncio.run(run(args.origin, token, args.device))


if __name__ == "__main__":
    main()
