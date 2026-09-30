import copy
import hashlib
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pymupdf
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.canon_v2.constants import SOURCE_VERSION
from tools.canon_v2.serialization import canonical_json, read_jsonl, write_jsonl
from tools.canon_v2.source_lock import register_source
from tools.canon_v2.text_repair import (
    build_repair_map,
    repair_pages,
    repair_text,
)
from tools.ingest_book import main


def _synthetic_pdf(root):
    font_path = root / "synthetic.ttf"
    builder = FontBuilder(1000, isTTF=True)
    builder.setupGlyphOrder([".notdef", "A"])
    builder.setupCharacterMap({0x0069: "A", 0xE00C: "A"})
    pen = TTGlyphPen(None)
    glyph = pen.glyph()
    builder.setupGlyf({".notdef": glyph, "A": glyph})
    builder.setupHorizontalMetrics({".notdef": (500, 0), "A": (500, 0)})
    builder.setupHorizontalHeader(ascent=800, descent=-200)
    builder.setupNameTable({"familyName": "Synthetic", "styleName": "Regular"})
    builder.setupOS2()
    builder.setupPost()
    builder.save(font_path)
    pdf = root / "synthetic.pdf"
    document = pymupdf.open()
    page = document.new_page()
    page.insert_text(
        (72, 72),
        "ab",
        fontname="Synthetic",
        fontfile=str(font_path),
        fontsize=12,
    )
    document.save(pdf)
    document.close()
    return pdf


def _refresh_map_content_hash(rule_map):
    result = copy.deepcopy(rule_map)
    result.pop("map_content_sha256", None)
    result["map_content_sha256"] = hashlib.sha256(
        canonical_json(result).encode("utf-8")
    ).hexdigest()
    return result


def _frozen_pdf():
    target = Path(__file__).resolve().parents[1]
    lock = json.loads((target / "source-lock.json").read_text(encoding="utf-8"))
    return Path(lock["source_path"])


def _write_source_lock(root, pdf):
    source_version = "sha256:" + hashlib.sha256(pdf.read_bytes()).hexdigest()
    (root / "source-lock.json").write_text(
        json.dumps(
            {
                "source_path": str(pdf),
                "source_version": source_version,
                "expected_source_version": source_version,
            }
        ),
        encoding="utf-8",
    )
    return source_version


def _raw_page(raw_text="", page_index=0):
    return {
        "source_page_index": page_index,
        "raw_text": raw_text,
        "raw_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
        "blocks": [],
    }


class TextRepairTests(unittest.TestCase):
    def test_unmapped_private_use_character_is_preserved(self):
        text, repairs = repair_text("ab", {}, 3, 0)
        self.assertEqual(text, "ab")
        self.assertEqual(repairs, [])

    def test_explicit_mapping_is_logged_with_offsets(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf = _synthetic_pdf(Path(directory))
            source_version = "sha256:" + hashlib.sha256(pdf.read_bytes()).hexdigest()
            with patch("tools.canon_v2.text_repair.SOURCE_VERSION", source_version):
                rule_map = build_repair_map([_raw_page("ab")], pdf)
                text, repairs = repair_text("ab", rule_map, 3, 0)
        self.assertIn("map_content_sha256", rule_map)
        self.assertNotIn("map_hmac", rule_map)
        self.assertEqual(text, "aib")
        self.assertEqual(repairs[0]["raw_offset"], 1)
        self.assertEqual(repairs[0]["replacement"], "i")

    def test_unknown_rule_cannot_change_numbers_or_doses(self):
        text, repairs = repair_text("100 mg", {}, 4, 0)
        self.assertEqual(text, "100 mg")
        self.assertEqual(repairs, [])

    def test_hand_edited_replacement_without_provenance_is_not_applied(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf = _synthetic_pdf(Path(directory))
            source_version = "sha256:" + hashlib.sha256(pdf.read_bytes()).hexdigest()
            with patch("tools.canon_v2.text_repair.SOURCE_VERSION", source_version):
                rule_map = build_repair_map([_raw_page("ab")], pdf)
            edited = copy.deepcopy(rule_map)
            edited["rules"][""]["replacement"] = "x"
            with patch("tools.canon_v2.text_repair.SOURCE_VERSION", source_version):
                text, repairs = repair_text("ab", edited, 3, 0)
        self.assertEqual(text, "ab")
        self.assertEqual(repairs, [])

    def test_malformed_verified_rule_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf = _synthetic_pdf(Path(directory))
            source_version = "sha256:" + hashlib.sha256(pdf.read_bytes()).hexdigest()
            with patch("tools.canon_v2.text_repair.SOURCE_VERSION", source_version):
                rule_map = build_repair_map([_raw_page("ab")], pdf)
            malformed = copy.deepcopy(rule_map)
            del malformed["rules"][""]["font_identity"]
            malformed = _refresh_map_content_hash(malformed)
            with patch("tools.canon_v2.text_repair.SOURCE_VERSION", source_version):
                with self.assertRaisesRegex(ValueError, "font_identity"):
                    repair_text("ab", malformed, 3, 0)

    def test_ordinary_character_rule_is_never_applied(self):
        for character in ("A", "0", " ", "."):
            with self.subTest(character=character):
                text, repairs = repair_text(character, {}, 0, 0)
                self.assertEqual(text, character)
                self.assertEqual(repairs, [])

    def test_fabricated_self_consistent_map_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _synthetic_pdf(root)
            source_version = "sha256:" + hashlib.sha256(pdf.read_bytes()).hexdigest()
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            page = _raw_page("ab")
            write_jsonl(raw_path, [page])
            _write_source_lock(root, pdf)
            with patch("tools.canon_v2.text_repair.SOURCE_VERSION", source_version):
                derived = build_repair_map([page], pdf)
                fabricated = copy.deepcopy(derived)
                fabricated["rules"][""]["replacement"] = "x"
                fabricated["unresolved"] = []
                fabricated["unresolved_codepoints"] = []
                rule_map_path = root / "checkpoints" / "repair-map.json"
                rule_map_path.parent.mkdir(parents=True)
                rule_map_path.write_text(
                    json.dumps(fabricated, ensure_ascii=False), encoding="utf-8"
                )

                with self.assertRaisesRegex(ValueError, "re-derivation"):
                    repair_pages(raw_path, root)

    def test_edited_stored_map_is_rejected_without_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _frozen_pdf()
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            page = _raw_page("")
            write_jsonl(raw_path, [page])
            _write_source_lock(root, pdf)
            rule_map_path = root / "checkpoints" / "repair-map.json"
            rule_map_path.parent.mkdir(parents=True)
            rule_map = build_repair_map([page], pdf)
            rule_map["parser"] = "edited"
            rule_map_path.write_text(
                json.dumps(rule_map, ensure_ascii=False), encoding="utf-8"
            )

            with self.assertRaisesRegex(ValueError, "re-derivation"):
                repair_pages(raw_path, root)

            self.assertFalse((root / "raw" / "repaired-pages.jsonl").exists())
            self.assertFalse((root / "repairs.jsonl").exists())
            blocked = json.loads(
                (root / "checkpoints" / "text-repair.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(blocked["status"], "BLOCKED")
            self.assertIn("re-derivation", blocked["reason"])

    def test_valid_map_generated_from_source_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _frozen_pdf()
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            page = _raw_page("")
            write_jsonl(raw_path, [page])
            _write_source_lock(root, pdf)
            rule_map = build_repair_map([page], pdf)
            rule_map_path = root / "checkpoints" / "repair-map.json"
            rule_map_path.parent.mkdir(parents=True)
            rule_map_path.write_text(
                json.dumps(rule_map, ensure_ascii=False), encoding="utf-8"
            )

            summary = repair_pages(raw_path, root)

            self.assertEqual(summary["repair_count"], 0)
            self.assertTrue((root / "raw" / "repaired-pages.jsonl").exists())
            checkpoint = json.loads(
                (root / "checkpoints" / "text-repair.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                checkpoint["rule_map_sha256"],
                hashlib.sha256(rule_map_path.read_bytes()).hexdigest(),
            )
            self.assertEqual(
                checkpoint["rule_map_file_sha256"],
                hashlib.sha256(rule_map_path.read_bytes()).hexdigest(),
            )
            self.assertEqual(
                checkpoint["repaired_page_sha256"],
                hashlib.sha256(
                    (root / "raw" / "repaired-pages.jsonl").read_bytes()
                ).hexdigest(),
            )
            self.assertEqual(
                checkpoint["repairs_sha256"],
                hashlib.sha256((root / "repairs.jsonl").read_bytes()).hexdigest(),
            )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            alternate_pdf = root / "alternate.pdf"
            document = pymupdf.open()
            document.new_page()
            document.save(alternate_pdf)
            document.close()
            alternate_version = "sha256:" + hashlib.sha256(
                alternate_pdf.read_bytes()
            ).hexdigest()
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            page = _raw_page("")
            write_jsonl(raw_path, [page])
            (root / "source-lock.json").write_text(
                json.dumps(
                    {
                        "source_path": str(alternate_pdf),
                        "source_version": alternate_version,
                        "expected_source_version": alternate_version,
                    }
                ),
                encoding="utf-8",
            )
            rule_map_path = root / "checkpoints" / "repair-map.json"
            rule_map_path.parent.mkdir(parents=True)
            rule_map_path.write_text("{}", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "authoritative source"):
                repair_pages(raw_path, root)

            self.assertFalse((root / "raw" / "repaired-pages.jsonl").exists())
            self.assertFalse((root / "repairs.jsonl").exists())

    def test_alternate_pdf_build_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "alternate.pdf"
            document = pymupdf.open()
            document.new_page()
            document.save(pdf)
            document.close()
            with self.assertRaisesRegex(ValueError, "authoritative source"):
                build_repair_map([_raw_page("")], pdf)

    def test_persisted_map_without_content_hash_cannot_apply(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf = _synthetic_pdf(Path(directory))
            source_version = "sha256:" + hashlib.sha256(pdf.read_bytes()).hexdigest()
            with patch("tools.canon_v2.text_repair.SOURCE_VERSION", source_version):
                rule_map = build_repair_map([_raw_page("ab")], pdf)
                unsigned = copy.deepcopy(rule_map)
                unsigned.pop("map_content_sha256", None)
                text, repairs = repair_text("ab", unsigned, 3, 0)
        self.assertEqual(text, "ab")
        self.assertEqual(repairs, [])

    def test_register_rejects_alternate_caller_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "alternate.pdf"
            document = pymupdf.open()
            document.new_page()
            document.save(pdf)
            document.close()
            alternate_hash = hashlib.sha256(pdf.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, "source hash mismatch"):
                register_source(
                    pdf,
                    root / "out",
                    expected_hash="sha256:" + alternate_hash,
                )
            self.assertFalse((root / "out" / "source-lock.json").exists())

    def test_repair_map_rejects_missing_or_mismatched_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            write_jsonl(raw_path, [_raw_page("")])
            actual_pdf = _frozen_pdf()
            self.assertEqual(
                main(["repair-map", "--pdf", str(actual_pdf), "--output", str(root)]),
                1,
            )
            alternate_pdf = root / "alternate.pdf"
            document = pymupdf.open()
            document.new_page()
            document.save(alternate_pdf)
            document.close()
            alternate_hash = hashlib.sha256(alternate_pdf.read_bytes()).hexdigest()
            (root / "source-lock.json").write_text(
                json.dumps(
                    {
                        "source_path": str(alternate_pdf),
                        "source_version": "sha256:" + alternate_hash,
                    }
                ),
                encoding="utf-8",
            )
            self.assertEqual(
                main(
                    [
                        "repair-map",
                        "--pdf",
                        str(alternate_pdf),
                        "--output",
                        str(root),
                    ]
                ),
                1,
            )
            self.assertFalse((root / "checkpoints" / "repair-map.json").exists())

    def test_atomic_source_lock_failure_leaves_no_canonical_or_temp_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch("pathlib.Path.replace", side_effect=OSError("forced lock write")):
                with self.assertRaisesRegex(OSError, "forced lock write"):
                    register_source(_frozen_pdf(), root)
            self.assertFalse((root / "source-lock.json").exists())
            self.assertFalse((root / "source-lock.json.tmp").exists())

    def test_atomic_repair_map_failure_leaves_no_canonical_or_temp_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _frozen_pdf()
            _write_source_lock(root, pdf)
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            write_jsonl(raw_path, [_raw_page("")])
            with patch("pathlib.Path.replace", side_effect=OSError("forced map write")):
                exit_code = main(
                    ["repair-map", "--pdf", str(pdf), "--output", str(root)]
                )
            self.assertEqual(exit_code, 1)
            self.assertFalse((root / "checkpoints" / "repair-map.json").exists())
            self.assertFalse((root / "checkpoints" / "repair-map.json.tmp").exists())

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _frozen_pdf()
            _write_source_lock(root, pdf)
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            page = _raw_page("")
            write_jsonl(raw_path, [page])
            rule_map_path = root / "checkpoints" / "repair-map.json"
            rule_map_path.parent.mkdir(parents=True)
            rule_map = build_repair_map([page], pdf)
            rule_map_path.write_text(
                json.dumps(rule_map, ensure_ascii=False), encoding="utf-8"
            )
            raw_before = raw_path.read_bytes()
            repair_pages(raw_path, root)
            self.assertTrue((root / "raw" / "repaired-pages.jsonl").exists())
            self.assertTrue((root / "repairs.jsonl").exists())
            self.assertTrue((root / "checkpoints" / "text-repair.json").exists())
            rule_map["parser"] = "edited"
            rule_map_path.write_text(
                json.dumps(rule_map, ensure_ascii=False), encoding="utf-8"
            )

            with self.assertRaisesRegex(ValueError, "re-derivation"):
                repair_pages(raw_path, root)

            self.assertEqual(raw_path.read_bytes(), raw_before)
            self.assertFalse((root / "raw" / "repaired-pages.jsonl").exists())
            self.assertFalse((root / "repairs.jsonl").exists())
            blocked = json.loads(
                (root / "checkpoints" / "text-repair.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(blocked["status"], "BLOCKED")
            self.assertIn("re-derivation", blocked["reason"])
            quarantine = root / "quarantine" / "repair-failures"
            self.assertTrue(any(quarantine.rglob("repaired-pages.jsonl")))
            self.assertTrue(any(quarantine.rglob("repairs.jsonl")))
            self.assertTrue(any(quarantine.rglob("repair-map.json")))

    def test_real_output_without_proven_rules_logs_all_pua(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _frozen_pdf()
            _write_source_lock(root, pdf)
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            raw_text = ""
            page = _raw_page(raw_text)
            write_jsonl(raw_path, [page])
            rule_map_path = root / "checkpoints" / "repair-map.json"
            rule_map_path.parent.mkdir(parents=True)
            rule_map_path.write_text(
                json.dumps(build_repair_map([page], pdf), ensure_ascii=False),
                encoding="utf-8",
            )
            before = raw_path.read_bytes()
            summary = repair_pages(raw_path, root)
            self.assertEqual(raw_path.read_bytes(), before)
            self.assertEqual(summary["repair_count"], 0)
            self.assertEqual(summary["unresolved_count"], 2)
            events = read_jsonl(root / "repairs.jsonl")
            self.assertEqual(len(events), 2)
            self.assertTrue(all(event["review_status"] == "unresolved" for event in events))

    def test_forced_repair_processing_failure_quarantines_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _frozen_pdf()
            _write_source_lock(root, pdf)
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            page = _raw_page("")
            write_jsonl(raw_path, [page])
            rule_map_path = root / "checkpoints" / "repair-map.json"
            rule_map_path.parent.mkdir(parents=True)
            rule_map_path.write_text(
                json.dumps(build_repair_map([page], pdf), ensure_ascii=False),
                encoding="utf-8",
            )
            raw_before = raw_path.read_bytes()
            repair_pages(raw_path, root)
            self.assertTrue((root / "raw" / "repaired-pages.jsonl").exists())
            self.assertTrue((root / "repairs.jsonl").exists())

            with patch(
                "tools.canon_v2.text_repair.repair_text",
                side_effect=OSError("forced repair processing failure"),
            ):
                with self.assertRaisesRegex(OSError, "forced repair processing failure"):
                    repair_pages(raw_path, root)

            self.assertEqual(raw_path.read_bytes(), raw_before)
            self.assertFalse((root / "raw" / "repaired-pages.jsonl").exists())
            self.assertFalse((root / "repairs.jsonl").exists())
            blocked = json.loads(
                (root / "checkpoints" / "text-repair.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(blocked["status"], "BLOCKED")
            self.assertIn("forced repair processing failure", blocked["reason"])
            quarantine = root / "quarantine" / "repair-failures"
            self.assertTrue(any(quarantine.rglob("repaired-pages.jsonl")))
            self.assertTrue(any(quarantine.rglob("repairs.jsonl")))

    def test_forced_multi_file_failure_leaves_blocked_and_no_canonical_set(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _frozen_pdf()
            _write_source_lock(root, pdf)
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            page = _raw_page("")
            write_jsonl(raw_path, [page])
            rule_map_path = root / "checkpoints" / "repair-map.json"
            rule_map_path.parent.mkdir(parents=True)
            rule_map_path.write_text(
                json.dumps(build_repair_map([page], pdf), ensure_ascii=False),
                encoding="utf-8",
            )
            raw_before = raw_path.read_bytes()
            repair_pages(raw_path, root)
            self.assertTrue((root / "raw" / "repaired-pages.jsonl").exists())
            self.assertTrue((root / "repairs.jsonl").exists())
            with patch(
                "tools.canon_v2.text_repair._atomic_write_jsonl",
                side_effect=OSError("forced multi-file write failure"),
            ):
                with self.assertRaisesRegex(OSError, "forced multi-file write failure"):
                    repair_pages(raw_path, root)
            self.assertEqual(raw_path.read_bytes(), raw_before)
            self.assertFalse((root / "raw" / "repaired-pages.jsonl").exists())
            self.assertFalse((root / "repairs.jsonl").exists())
            self.assertFalse(rule_map_path.exists())
            blocked = json.loads(
                (root / "checkpoints" / "text-repair.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(blocked["status"], "BLOCKED")
            self.assertIn("forced multi-file write failure", blocked["reason"])
            quarantine = root / "quarantine" / "repair-failures"
            self.assertTrue(any(quarantine.rglob("repaired-pages.jsonl")))
            self.assertTrue(any(quarantine.rglob("repairs.jsonl")))

    def test_fresh_processes_produce_identical_map_and_checkpoint_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _synthetic_pdf(root)
            source_version = "sha256:" + hashlib.sha256(pdf.read_bytes()).hexdigest()
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            write_jsonl(raw_path, [_raw_page("ab")])
            _write_source_lock(root, pdf)
            (root / "checkpoints").mkdir()
            target = Path(__file__).resolve().parents[1]
            first_script = "\n".join(
                [
                    "import sys",
                    "from pathlib import Path",
                    "from tools.canon_v2.serialization import read_jsonl",
                    "import tools.canon_v2.text_repair as tr",
                    "root = Path(sys.argv[1])",
                    "pdf = Path(sys.argv[2])",
                    "tr.SOURCE_VERSION = sys.argv[3]",
                    "pages = read_jsonl(root / 'raw' / 'pages.jsonl')",
                    "tr._atomic_write_json(root / 'checkpoints' / 'repair-map.json', tr.build_repair_map(pages, pdf))",
                    "tr.repair_pages(root / 'raw' / 'pages.jsonl', root)",
                ]
            )
            second_script = "\n".join(
                [
                    "import sys",
                    "from pathlib import Path",
                    "import tools.canon_v2.text_repair as tr",
                    "root = Path(sys.argv[1])",
                    "tr.SOURCE_VERSION = sys.argv[3]",
                    "tr.repair_pages(root / 'raw' / 'pages.jsonl', root)",
                ]
            )
            subprocess.run(
                [sys.executable, "-c", first_script, str(root), str(pdf), source_version],
                cwd=target,
                check=True,
                capture_output=True,
                text=True,
            )
            map_path = root / "checkpoints" / "repair-map.json"
            checkpoint_path = root / "checkpoints" / "text-repair.json"
            first_map = map_path.read_bytes()
            first_checkpoint = checkpoint_path.read_bytes()
            subprocess.run(
                [sys.executable, "-c", second_script, str(root), str(pdf), source_version],
                cwd=target,
                check=True,
                capture_output=True,
                text=True,
            )
            second_map = map_path.read_bytes()
            second_checkpoint = checkpoint_path.read_bytes()
            map_record = json.loads(second_map)
            self.assertNotIn("map_hmac", map_record)
            content = {
                key: value
                for key, value in map_record.items()
                if key != "map_content_sha256"
            }
            self.assertEqual(
                map_record["map_content_sha256"],
                hashlib.sha256(canonical_json(content).encode("utf-8")).hexdigest(),
            )
            self.assertEqual(first_map, second_map)
            self.assertEqual(first_checkpoint, second_checkpoint)
            self.assertEqual(
                hashlib.sha256(first_map).hexdigest(),
                hashlib.sha256(second_map).hexdigest(),
            )
            self.assertEqual(
                hashlib.sha256(first_checkpoint).hexdigest(),
                hashlib.sha256(second_checkpoint).hexdigest(),
            )

    def test_frozen_source_inventory_remains_fully_unresolved(self):
        target = Path(__file__).resolve().parents[1]
        lock = json.loads((target / "source-lock.json").read_text(encoding="utf-8"))
        raw_pages = read_jsonl(target / "raw" / "pages.jsonl")
        result = build_repair_map(raw_pages, Path(lock["source_path"]))
        self.assertEqual(result["total_private_use_count"], 14268)
        self.assertEqual(result["private_use_codepoint_count"], 82)
        self.assertEqual(result["rules"], {})
        self.assertEqual(len(result["unresolved_codepoints"]), 82)

    def test_repair_map_records_unobserved_source_font_as_unresolved(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "book.pdf"
            document = pymupdf.open()
            document.new_page()
            document.save(pdf)
            document.close()
            raw_text = "ab"
            raw_pages = [
                {
                    "source_page_index": 0,
                    "raw_text": raw_text,
                    "raw_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
                }
            ]

            source_version = "sha256:" + hashlib.sha256(pdf.read_bytes()).hexdigest()
            with patch("tools.canon_v2.text_repair.SOURCE_VERSION", source_version):
                result = build_repair_map(raw_pages, pdf)

            self.assertEqual(result["total_private_use_count"], 1)
            self.assertEqual(result["unresolved_codepoints"], ["U+E00C"])

    def test_cli_runs_repair_map_and_repair_stages(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _frozen_pdf()
            _write_source_lock(root, pdf)
            raw_path = root / "raw" / "pages.jsonl"
            raw_path.parent.mkdir(parents=True)
            write_jsonl(
                raw_path,
                [
                    {
                        "source_page_index": 0,
                        "source_page_display": 1,
                        "raw_text": "",
                        "raw_sha256": hashlib.sha256(b"").hexdigest(),
                        "block_count": 0,
                        "blocks": [],
                        "extraction_status": "blank",
                    }
                ],
            )

            self.assertEqual(
                main(["repair-map", "--pdf", str(pdf), "--output", str(root)]),
                0,
            )
            self.assertEqual(main(["repair", "--output", str(root), "--resume"]), 0)
            self.assertTrue((root / "checkpoints" / "repair-map.json").exists())
            self.assertTrue((root / "checkpoints" / "text-repair.json").exists())
            self.assertTrue((root / "repairs.jsonl").exists())

    def test_repair_pages_keeps_raw_records_and_logs_unresolved_pua(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = _frozen_pdf()
            _write_source_lock(root, pdf)
            raw_path = root / "raw" / "pages.jsonl"
            raw_text = "ab\n"
            block_text = raw_text
            block = {
                "block_index": 0,
                "block_no": 0,
                "block_type": 0,
                "bbox": [0, 0, 1, 1],
                "text": block_text,
                "text_sha256": hashlib.sha256(block_text.encode("utf-8")).hexdigest(),
            }
            page = {
                "source_page_index": 0,
                "source_page_display": 1,
                "raw_text": raw_text,
                "raw_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
                "block_count": 1,
                "blocks": [block],
                "extraction_status": "auto_ok",
            }
            raw_path.parent.mkdir(parents=True)
            write_jsonl(raw_path, [page])
            rule_map_path = root / "checkpoints" / "repair-map.json"
            rule_map_path.parent.mkdir(parents=True)
            rule_map_path.write_text(
                json.dumps(build_repair_map([page], pdf), ensure_ascii=False),
                encoding="utf-8",
            )
            before = raw_path.read_bytes()

            summary = repair_pages(raw_path, root)

            self.assertEqual(raw_path.read_bytes(), before)
            repaired = read_jsonl(root / "raw" / "repaired-pages.jsonl")
            self.assertEqual(repaired[0]["raw_text"], raw_text)
            self.assertEqual(repaired[0]["reading_text"], raw_text)
            events = read_jsonl(root / "repairs.jsonl")
            self.assertEqual(summary["repair_count"], 0)
            self.assertEqual(summary["unresolved_count"], 2)
            self.assertEqual(events[0]["review_status"], "unresolved")
            self.assertEqual(events[1]["review_status"], "unresolved")


if __name__ == "__main__":
    unittest.main()
