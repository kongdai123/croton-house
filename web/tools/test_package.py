"""Small packaging fixtures; no bake processing or browser required."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
import subprocess
import sys

import package


class LightmapPackage(unittest.TestCase):
    def fixture(self, root, split):
        src = root / "source"
        meta = {"K": {"slot": 0.1, "lamps": 0.2}}
        if split:
            meta["rows"] = {"slot": [2, 3], "lamps": [2, 3]}
        files = {"v2/lightmap_uv2.bin.gz": b"\x1f\x8bexact gzip bytes",
                 "v2/sunrise/encoding.json": json.dumps(meta).encode(),
                 "sunrise/probes.bin": b"probe bytes", "sunrise/sky_bg.hdr": b"sky bytes",
                 "sunrise/refl/meta.json": b'[{"i": 0}, {"i": 25}]',
                 "sunrise/refl/probe_00.hdr": b"reflection 0", "sunrise/refl/probe_25.hdr": b"reflection 25",
                 "v2/sunrise/foliage.bin.gz": b"\x1f\x8bfoliage"}
        for layer in ("slot", "lamps"):
            for name in ([f"{layer}_0.webp", f"{layer}_1.webp"] if split else [f"{layer}.webp"]):
                files[f"v2/sunrise/{name}"] = name.encode() + b"\x00\xff"
            files[f"v2/sunrise/half/{layer}.webp"] = b"pre-encoded half " + layer.encode()
            files[f"v2/sunrise/quarter/{layer}.webp"] = b"pre-encoded quarter " + layer.encode()
        # A second slot has its own split layout, tiers, probes and optional foliage.
        for name, data in list(files.items()):
            if "/sunrise/" in "/" + name:
                files[name.replace("sunrise/", "dusk/")] = data
        dusk = {"K": {"slot": 0.3, "lamps": 0.4}}
        if not split: dusk["rows"] = {"slot": [1, 4], "lamps": [1, 4]}
        files["v2/dusk/encoding.json"] = json.dumps(dusk).encode()
        for layer in ("slot", "lamps"):
            for name in ([f"{layer}_0.webp", f"{layer}_1.webp"] if split else [f"{layer}.webp"]):
                del files[f"v2/dusk/{name}"]
            for name in ([f"{layer}.webp"] if split else [f"{layer}_0.webp", f"{layer}_1.webp"]):
                files[f"v2/dusk/{name}"] = b"dusk " + name.encode()
        for name, data in files.items():
            path = src / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        (src / "v2/sunrise/slot_tone.npy").write_bytes(b"never publish")
        if split:
            with (src / "v2/sunrise/slot.webp").open("wb") as f: f.truncate(package.FILE_LIMIT + 1)
        return src, files

    def test_exact_copy_and_manifest(self):
        for split in (False, True):
            with self.subTest(split=split), tempfile.TemporaryDirectory() as folder:
                root = Path(folder); src, files = self.fixture(root, split); dst = root / "build/assets/lightmaps"
                package.copy_lightmaps(src, dst)
                manifest = json.loads((dst / "manifest.json").read_text())
                self.assertEqual(set(manifest), set(files))
                for name, data in files.items():
                    self.assertEqual((dst / manifest[name]).read_bytes(), data)
                    self.assertIn(hashlib.sha256(data).hexdigest()[:16], manifest[name])
                before = (dst / "manifest.json").read_bytes()
                package.copy_lightmaps(src, dst)
                self.assertEqual((dst / "manifest.json").read_bytes(), before)
                with contextlib.redirect_stdout(io.StringIO()) as report: package.report_and_check(root / "build")
                self.assertIn("assets/lightmaps", report.getvalue())

    def test_all_slots_share_sunrise_lamps(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); src, files = self.fixture(root, True)
            # Keep only the shared sunrise lamps; the other three slots have their own irradiance/tiers.
            for name in list(files):
                if "/dusk/" in "/" + name and "/lamps" in name:
                    (src / name).unlink(); del files[name]
            meta = json.loads((src / "v2/dusk/encoding.json").read_text()); meta["lampsSlot"] = "sunrise"
            files["v2/dusk/encoding.json"] = json.dumps(meta).encode()
            (src / "v2/dusk/encoding.json").write_bytes(files["v2/dusk/encoding.json"])
            for slot in ("noon", "golden"):
                for name, data in list(files.items()):
                    if "/dusk/" in "/" + name:
                        target = name.replace("dusk/", slot + "/"); files[target] = data
                        path = src / target; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
            dst = root / "out"; package.copy_lightmaps(src, dst)
            manifest = json.loads((dst / "manifest.json").read_text())
            self.assertEqual(set(manifest), set(files))
            self.assertTrue(all("sunrise/" in name for name in manifest if "/lamps" in name))
            for slot in ("sunrise", "noon", "golden", "dusk"):
                self.assertIn(f"v2/{slot}/encoding.json", manifest)
                self.assertIn(f"{slot}/probes.bin", manifest)

    def test_reject_unsplit_oversize(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); src, _ = self.fixture(root, False)
            with (src / "v2/sunrise/slot.webp").open("wb") as f: f.truncate(package.FILE_LIMIT + 1)
            with self.assertRaisesRegex(RuntimeError, "encode_webp.py --split"):
                package.copy_lightmaps(src, root / "build/assets/lightmaps")

    def test_limits_include_bakes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); src, _ = self.fixture(root, True)
            package.copy_lightmaps(src, root / "build/assets/lightmaps")
            old = package.TOTAL_LIMIT
            try:
                package.TOTAL_LIMIT = 1
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(RuntimeError, "total"):
                    package.report_and_check(root / "build")
            finally: package.TOTAL_LIMIT = old

    def test_other_slot_limits_and_missing_tier(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); src, _ = self.fixture(root, False)
            path = src / "v2/dusk/quarter/lamps.webp"; data = path.read_bytes(); path.unlink()
            with self.assertRaises(FileNotFoundError): package.copy_lightmaps(src, root / "out")
            path.write_bytes(data)
            with (src / "v2/dusk/foliage.bin.gz").open("wb") as f: f.truncate(package.FILE_LIMIT + 1)
            with self.assertRaisesRegex(RuntimeError, "exceeds 15 MB"): package.copy_lightmaps(src, root / "out2")

    def test_runtime_bundles_and_failed_package(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); src, _ = self.fixture(root, True)
            (root / "assets").mkdir(); src.rename(root / "assets/lightmaps")
            (root / "data").mkdir(); (root / "data/fixture.bin").write_bytes(b"data")
            for name in package.ASSET_FOLDERS:
                (root / "assets" / name).mkdir(exist_ok=True)
            bundles = {}
            for name in package.RUNTIME_FILES:
                path = root / name; path.parent.mkdir(exist_ok=True)
                bundles[name] = b"exact\r\n//# sourceMappingURL=fixture.js.map\r\n"
                path.write_bytes(bundles[name])
            with patch.object(package, "ROOT", root), contextlib.redirect_stdout(io.StringIO()): package.main()
            for name, data in bundles.items(): self.assertEqual((root / "build" / name).read_bytes(), data)
            marker = root / "build/previous"; marker.write_bytes(b"keep")
            with (root / "dist/webgpu.js").open("wb") as f: f.truncate(package.FILE_LIMIT + 1)
            with patch.object(package, "ROOT", root), contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(RuntimeError, "dist/webgpu.js"):
                package.main()
            self.assertEqual(marker.read_bytes(), b"keep")
            (root / "dist/webgpu.js").unlink()
            with patch.object(package, "ROOT", root), self.assertRaises(FileNotFoundError): package.main()
            self.assertEqual(marker.read_bytes(), b"keep")

    def test_encoder_odd_rows(self):
        import numpy as np
        from PIL import Image
        encoder = Path(__file__).resolve().parents[2] / "bake/scripts/encode_webp.py"
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); a = np.arange(5 * 7 * 3, dtype=np.uint8).reshape(5, 7, 3)
            (root / "encoding.json").write_text('{"K":{"slot":0.1,"lamps":0.2}}')
            for layer in ("slot", "lamps"): np.save(root / f"{layer}_tone.npy", a)
            subprocess.run([sys.executable, str(encoder), folder, "--split"], check=True, capture_output=True)
            meta = json.loads((root / "encoding.json").read_text())
            self.assertEqual(meta["rows"], {"slot": [2, 3], "lamps": [2, 3]})
            for layer in ("slot", "lamps"):
                parts = []
                for i in range(2):
                    with Image.open(root / f"{layer}_{i}.webp") as im: parts.append(np.array(im))
                self.assertTrue(np.array_equal(np.concatenate(parts), a))
            subprocess.run([sys.executable, str(encoder), folder], check=True, capture_output=True)
            self.assertNotIn("rows", json.loads((root / "encoding.json").read_text()))
            with Image.open(root / "slot.webp") as im: self.assertTrue(np.array_equal(np.asarray(im), a))


if __name__ == "__main__": unittest.main()
