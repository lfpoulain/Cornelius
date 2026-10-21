import importlib.util
import os
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("image_install", ROOT / "image_generation" / "install.py")
install = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(install)


class BackendTest(unittest.TestCase):
    def select(self, nvidia=False, amd=False, kfd=False, env=None):
        with mock.patch.object(install, "has_nvidia_gpu", return_value=nvidia), \
                mock.patch.object(install, "has_amd_gpu", return_value=amd), \
                mock.patch.object(install, "rocm_ready", return_value=kfd), \
                mock.patch.dict(os.environ, env or {"CORNELIUS_IMAGE_BACKEND": ""}):
            return install.select_backend()

    def test_auto_prefers_nvidia_then_amd_with_rocm_then_cpu(self):
        self.assertEqual(self.select(nvidia=True, amd=True, kfd=True), "cuda")
        self.assertEqual(self.select(amd=True, kfd=True), "rocm")
        # Un GPU AMD sans ROCm (/dev/kfd) ne doit pas télécharger une roue inutilisable.
        self.assertEqual(self.select(amd=True, kfd=False), "cpu")
        self.assertEqual(self.select(), "cpu")

    def test_environment_forces_a_backend(self):
        self.assertEqual(self.select(nvidia=True, env={"CORNELIUS_IMAGE_BACKEND": "cpu"}), "cpu")
        self.assertEqual(self.select(env={"CORNELIUS_IMAGE_BACKEND": "ROCm"}), "rocm")
        with self.assertRaises(ValueError):
            self.select(env={"CORNELIUS_IMAGE_BACKEND": "metal"})


class CommandTest(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {}, clear=False)
        patcher.start()
        self.addCleanup(patcher.stop)
        for key in ("CORNELIUS_TORCH_VERSION", "CORNELIUS_TORCH_INDEX_URL"):
            os.environ.pop(key, None)

    def test_each_backend_pins_the_same_torch_version(self):
        cuda = install.torch_install_command("py", "cuda", windows=False)
        cpu = install.torch_install_command("py", "cpu", windows=True, macos=False)
        rocm = install.torch_install_command("py", "rocm", windows=False)
        for command in (cuda, cpu, rocm):
            self.assertIn("torch==" + install.TORCH_VERSION, command)
            self.assertIn("--force-reinstall", command)
        self.assertEqual(cuda[-2:], ["--index-url", "https://download.pytorch.org/whl/cu130"])
        self.assertEqual(cpu[-2:], ["--index-url", "https://download.pytorch.org/whl/cpu"])
        self.assertEqual(
            rocm[-2:], ["--find-links", "https://repo.radeon.com/rocm/manylinux/rocm-rel-7.2.1/"]
        )

    def test_macos_cpu_uses_pypi_wheel_with_mps(self):
        command = install.torch_install_command("py", "cpu", windows=False, macos=True)
        self.assertEqual(command[-1], "torch==" + install.TORCH_VERSION)
        self.assertNotIn("--index-url", command)
        forced = install.torch_install_command("py", "cpu", windows=False, index="https://mirror/", macos=True)
        self.assertEqual(forced[-2:], ["--index-url", "https://mirror/"])

    def test_windows_rocm_uses_amd_python_312_wheel(self):
        command = install.torch_install_command("py", "rocm", windows=True)
        wheel = next(part for part in command if part.endswith(".whl"))
        self.assertIn("rocm/windows/rocm-rel-7.2.1/torch-2.9.1%2Brocm7.2.1-cp312-cp312", wheel)
        self.assertIn("--find-links", command)

    def test_windows_rocm_installs_the_amd_sdk_before_torch(self):
        sdk, torch = install.torch_install_commands("py", "rocm", windows=True)
        folder = "https://repo.radeon.com/rocm/windows/rocm-rel-7.2.1/"
        self.assertEqual(
            [part for part in sdk if part.startswith("https://")],
            [
                folder + "rocm_sdk_core-7.2.1-py3-none-win_amd64.whl",
                folder + "rocm_sdk_devel-7.2.1-py3-none-win_amd64.whl",
                folder + "rocm_sdk_libraries_custom-7.2.1-py3-none-win_amd64.whl",
                folder + "rocm-7.2.1.tar.gz",
            ],
        )
        self.assertNotIn("--force-reinstall", sdk)
        self.assertEqual(torch, install.torch_install_command("py", "rocm", windows=True))
        # Linux, CUDA, CPU et dépôt imposé : PyTorch seul.
        self.assertEqual(len(install.torch_install_commands("py", "rocm", windows=False)), 1)
        self.assertEqual(len(install.torch_install_commands("py", "cuda", windows=True)), 1)
        self.assertEqual(len(install.torch_install_commands("py", "cpu", windows=True)), 1)
        os.environ["CORNELIUS_TORCH_INDEX_URL"] = "https://example.invalid/gfx1150/"
        self.assertEqual(len(install.torch_install_commands("py", "rocm", windows=True)), 1)

    def test_overrides_for_a_nightly_or_custom_index(self):
        os.environ["CORNELIUS_TORCH_VERSION"] = "2.10.0"
        os.environ["CORNELIUS_TORCH_INDEX_URL"] = "https://example.invalid/gfx1150/"
        command = install.torch_install_command("py", "rocm", windows=True)
        self.assertIn("torch==2.10.0", command)
        self.assertEqual(command[-2:], ["--find-links", "https://example.invalid/gfx1150/"])


class MatchTest(unittest.TestCase):
    def test_existing_torch_is_kept_only_in_the_right_variant(self):
        cuda = {"cuda": "13.0", "hip": None, "available": True}
        rocm = {"cuda": None, "hip": "7.2.1", "available": True}
        cpu = {"cuda": None, "hip": None, "available": False}
        self.assertTrue(install.torch_matches(cuda, "cuda"))
        self.assertFalse(install.torch_matches(cpu, "cuda"))
        self.assertTrue(install.torch_matches(rocm, "rocm"))
        self.assertFalse(install.torch_matches(cuda, "rocm"))
        self.assertFalse(install.torch_matches({**rocm, "available": False}, "rocm"))
        self.assertTrue(install.torch_matches(cpu, "cpu"))
        self.assertFalse(install.torch_matches(None, "cpu"))


class LockTest(unittest.TestCase):
    def test_every_requirement_is_pinned_and_torch_is_left_to_the_installer(self):
        lines = [
            line.strip()
            for line in (ROOT / "image_generation" / "requirements.txt").read_text(encoding="utf-8").splitlines()
            if line.strip() and not line.startswith("#")
        ]
        self.assertTrue(lines)
        for line in lines:
            self.assertRegex(line, r"^[A-Za-z0-9_.-]+==[0-9][0-9A-Za-z.+-]*$", line)
        names = {line.split("==")[0].lower() for line in lines}
        self.assertNotIn("torch", names)
        self.assertTrue({"diffusers", "transformers", "accelerate"} <= names)


if __name__ == "__main__":
    unittest.main()
