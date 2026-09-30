import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf

from tools.ingest_book import main
from tools.canon_v2.source_lock import register_source


def _make_pdf(path: Path, pages: int) -> None:
    document = pymupdf.open()
    for _ in range(pages):
        document.new_page()
    document.save(path)
    document.close()


def _snapshot(paths: list) -> dict:
    return {path: path.read_bytes() for path in paths if path.exists()}


class ExtractLockGuardTests(unittest.TestCase):
    def test_lock_mismatch_creates_no_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = Path(__file__).resolve().parents[1]
            lock = json.loads((target / "source-lock.json").read_text(encoding="utf-8"))
            pdf_a = Path(lock["source_path"])
            pdf_b = root / "b.pdf"
            _make_pdf(pdf_b, 1)
            out = root / "out"
            register_source(pdf_a, out)

            exit_code = main(
                [
                    "extract",
                    "--pdf",
                    str(pdf_b),
                    "--output",
                    str(out),
                    "--no-resume",
                ]
            )

            self.assertNotEqual(exit_code, 0)
            self.assertFalse((out / "raw" / "pages.jsonl").exists())
            self.assertFalse((out / "raw" / "blocks.jsonl").exists())
            self.assertFalse(
                (out / "checkpoints" / "extract-pages.jsonl").exists()
            )

    def test_lock_mismatch_leaves_existing_output_unchanged(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = Path(__file__).resolve().parents[1]
            lock = json.loads((target / "source-lock.json").read_text(encoding="utf-8"))
            pdf_a = Path(lock["source_path"])
            pdf_b = root / "b.pdf"
            _make_pdf(pdf_b, 2)
            out = root / "out"
            register_source(pdf_a, out)
            watched = [
                out / "raw" / "pages.jsonl",
                out / "raw" / "blocks.jsonl",
                out / "checkpoints" / "extract-pages.jsonl",
            ]
            for path in watched:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(path.name + "\n", encoding="utf-8")
            before = _snapshot(watched)

            exit_code = main(
                [
                    "extract",
                    "--pdf",
                    str(pdf_b),
                    "--output",
                    str(out),
                    "--no-resume",
                ]
            )

            self.assertNotEqual(exit_code, 0)
            self.assertEqual(_snapshot(watched), before)


if __name__ == "__main__":
    unittest.main()
