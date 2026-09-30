import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.canon_v2.serialization import validate_record, write_json, write_jsonl
from tools.canon_v2.units import build_units
from tools.ingest_book import main


class UnitTests(unittest.TestCase):
    def test_units_keep_source_span_and_parent(self):
        pages = [{"source_page_index": 19, "source_page_display": 20, "printed_page_number": None, "text": "49.1\nÉvaluation clinique", "raw_sha256": "a"}]
        structure = {"chapters": [{"chapter": 49, "id": "chapter-49", "page_start": 19, "sections": [{"id": "section-49-1", "number": "49.1", "title": "Évaluation clinique"}]}]}
        units = build_units(pages, structure)
        self.assertEqual(units[0]["structural_path"], "Partie 5/Spécialités psychiatriques/Chapitre 49/49.1")
        self.assertEqual(units[0]["source_page_index_start"], 19)

    def test_unit_preserves_dual_text_page_mapping_and_block_provenance(self):
        raw_text = "49.1\nÉvaluation clinique"
        reading_text = "49.1\nÉvaluation clinique"
        pages = [
            {
                "source_page_index": 19,
                "source_page_display": 20,
                "raw_text": raw_text,
                "reading_text": reading_text,
                "raw_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
                "repair_references": ["repair-49-1"],
                "printed_page_number": "1084",
                "printed_page_kind": "body",
                "mapping_status": "certain",
                "mapping_anchor": "visible:1084",
                "blocks": [
                    {
                        "block_index": 3,
                        "text": raw_text,
                        "bbox": [48.0, 40.0, 420.0, 80.0],
                        "text_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
                    }
                ],
            }
        ]
        structure = {
            "chapters": [
                {
                    "chapter": 49,
                    "id": "chapter-49",
                    "part_number": 5,
                    "part": "PARTIE 5",
                    "domain_group": "Situations de crise",
                    "page_start": 19,
                    "page_end": 19,
                }
            ]
        }
        unit = build_units(pages, structure)[0]
        self.assertEqual(unit["raw_text"], raw_text)
        self.assertEqual(unit["reading_text"], reading_text)
        self.assertEqual(unit["source_page_index_start"], 19)
        self.assertEqual(unit["source_page_index_end"], 19)
        self.assertEqual(unit["source_page_display_start"], 20)
        self.assertEqual(unit["source_page_display_end"], 20)
        self.assertEqual(unit["printed_page_start"], "1084")
        self.assertEqual(unit["printed_page_end"], "1084")
        self.assertEqual(unit["mapping_status_start"], "certain")
        self.assertEqual(unit["mapping_status_end"], "certain")
        self.assertEqual(unit["source_block_references"], [{"block_index": 3, "bbox": [48.0, 40.0, 420.0, 80.0], "text_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest()}])
        self.assertEqual(unit["repair_references"], ["repair-49-1"])
        self.assertEqual(validate_record(unit), unit)

    def test_empty_pages_are_covered_without_fabricated_units(self):
        pages = [
            {"source_page_index": 1, "printed_page_number": None, "reading_text": "", "extraction_status": "blank", "blocks": []},
            {"source_page_index": 2, "printed_page_number": None, "reading_text": "Prose", "blocks": [{"block_index": 0, "text": "Prose", "bbox": [10, 20, 30, 40]}]},
        ]
        units = build_units(pages, {"chapters": []})
        self.assertEqual([unit["source_page_index_start"] for unit in units], [2])
        self.assertTrue(all(unit["raw_text"].strip() for unit in units))

    def test_units_never_merge_across_chapter_boundaries(self):
        pages = [
            {"source_page_index": 19, "printed_page_number": None, "reading_text": "49.1 Fin", "blocks": [{"block_index": 0, "text": "49.1 Fin", "bbox": [0, 0, 1, 1]}]},
            {"source_page_index": 20, "printed_page_number": None, "reading_text": "50.1 Début", "blocks": [{"block_index": 0, "text": "50.1 Début", "bbox": [0, 0, 1, 1]}]},
        ]
        structure = {
            "chapters": [
                {"chapter": 49, "id": "chapter-49", "part_number": 5, "domain_group": "Situations de crise", "page_start": 19, "page_end": 19, "sections": [{"id": "section-49-1", "number": "49.1", "title": "Fin"}]},
                {"chapter": 50, "id": "chapter-50", "part_number": 5, "domain_group": "Situations de crise", "page_start": 20, "page_end": 20, "sections": [{"id": "section-50-1", "number": "50.1", "title": "Début"}]},
            ]
        }
        units = build_units(pages, structure)
        self.assertEqual([unit["structural_path"].split("/")[-2] for unit in units], ["Chapitre 49", "Chapitre 50"])
        self.assertEqual(units[0]["following_context_id"], units[1]["unit_id"])
        self.assertEqual(units[1]["preceding_context_id"], units[0]["unit_id"])

    def test_cli_rejects_malformed_page_map_printed_labels_and_preserves_exact_values(self):
        raw_text = "49.1\nÉvaluation clinique"
        base_page = {
            "source_page_index": 19,
            "source_page_display": 20,
            "raw_text": raw_text,
            "reading_text": raw_text,
            "raw_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
            "extraction_status": "proposed",
            "blocks": [{"block_index": 1, "text": raw_text, "bbox": [10, 20, 30, 40]}],
        }
        structure = {
            "tome": {"number": 2, "label": "TOME 2"},
            "chapters": [{"chapter": 49, "id": "chapter-49", "page_start": 19, "page_end": 19}],
        }
        cases = {
            "missing": (None, False),
            "integer": (1084, False),
            "empty": ("", False),
            "null": (None, True),
            "string": ("1084", True),
        }
        for name, (printed, valid) in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                (root / "raw").mkdir()
                write_json(root / "structure.json", structure)
                write_jsonl(root / "raw" / "repaired-pages.jsonl", [base_page])
                page_map = {"source_page_index": 19, "mapping_status": "certain"}
                if name != "missing":
                    page_map["printed_page_number"] = printed
                write_jsonl(root / "page-map.jsonl", [page_map])
                result = main(["units", "--output", str(root)])
                if not valid:
                    self.assertNotEqual(result, 0)
                    self.assertFalse((root / "units.jsonl").exists())
                    continue
                self.assertEqual(result, 0)
                unit = json.loads((root / "units.jsonl").read_text(encoding="utf-8").splitlines()[0])
                self.assertEqual(unit["printed_page_start"], printed)
                self.assertEqual(unit["data"]["block_records"][0]["printed_page_number"], printed)

    def test_unit_preserves_exact_null_end_page_label(self):
        pages = [
            {"source_page_index": 19, "printed_page_number": "1084", "reading_text": "Même bloc", "blocks": [{"block_index": 0, "text": "Même bloc", "bbox": [0, 0, 1, 1]}]},
            {"source_page_index": 20, "printed_page_number": None, "reading_text": "Même bloc", "blocks": [{"block_index": 0, "text": "Même bloc", "bbox": [0, 0, 1, 1]}]},
        ]
        units = build_units(pages, {"chapters": [{"chapter": 49, "id": "chapter-49", "page_start": 19, "page_end": 20}]})
        self.assertEqual(units[0]["printed_page_start"], "1084")
        self.assertIsNone(units[0]["printed_page_end"])
        self.assertIsNone(units[0]["printed_page_number_end"])

    def test_same_source_produces_same_ordered_ids(self):
        pages = [
            {"source_page_index": 19, "printed_page_number": None, "reading_text": "Même bloc", "blocks": [{"block_index": 0, "text": "Même bloc", "bbox": [0, 0, 1, 1]}]},
            {"source_page_index": 20, "printed_page_number": None, "reading_text": "Même bloc", "blocks": [{"block_index": 0, "text": "Même bloc", "bbox": [0, 0, 1, 1]}]},
        ]
        structure = {"chapters": [{"chapter": 49, "id": "chapter-49", "page_start": 19, "page_end": 20}]}
        first = build_units(pages, structure)
        second = build_units(pages, structure)
        self.assertEqual([unit["unit_id"] for unit in first], [unit["unit_id"] for unit in second])
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]["source_page_index_start"], 19)
        self.assertEqual(first[0]["source_page_index_end"], 20)

    def test_contiguous_body_blocks_group_between_verified_boundaries(self):
        pages = [
            {
                "source_page_index": 10,
                "printed_page_number": "1084",
                "source_page_display": 11,
                "blocks": [
                    {"block_index": 0, "text": "49 Urgences psychiatriques\n", "bbox": [54, 130, 439, 175]},
                    {"block_index": 1, "text": "Introduction\n", "bbox": [54, 190, 300, 210]},
                    {"block_index": 2, "text": "49.1\nÉvaluation clinique\n", "bbox": [54, 220, 300, 250]},
                    {"block_index": 3, "text": "49.1.1\nLieu de l’évaluation\n", "bbox": [54, 300, 300, 325]},
                    {"block_index": 4, "text": "Texte de la section.\n", "bbox": [54, 340, 500, 380]},
                    {"block_index": 5, "text": "1084\nPsychiatrie clinique : approche bio-psycho-sociale | PARTIE 5 Spécialités psychiatriques\n", "bbox": [48, 747, 438, 759]},
                ],
            },
            {
                "source_page_index": 11,
                "printed_page_number": "1085",
                "source_page_display": 12,
                "blocks": [
                    {"block_index": 0, "text": "CHAPITRE49\n", "bbox": [263, -8, 561, 127]},
                    {"block_index": 1, "text": "Suite de la section.\n", "bbox": [48, 80, 500, 120]},
                    {"block_index": 2, "text": "49.1.2\nDocumentation de la situation\n", "bbox": [48, 150, 400, 180]},
                    {"block_index": 3, "text": "Texte de la documentation.\n", "bbox": [48, 200, 500, 240]},
                    {"block_index": 4, "text": "1085\nPsychiatrie clinique : approche bio-psycho-sociale | PARTIE 5 Spécialités psychiatriques\n", "bbox": [48, 747, 438, 759]},
                ],
            },
        ]
        structure = {
            "chapters": [
                {
                    "chapter": 49,
                    "id": "chapter-49",
                    "part_number": 5,
                    "domain_group": "Situations de crise",
                    "page_start": 10,
                    "page_end": 11,
                    "sections": [{"id": "section-49-1", "number": "49.1", "title": "Évaluation clinique", "source_page_index": 10}],
                    "subsections": [
                        {"id": "subsection-49-1-1", "number": "49.1.1", "title": "Lieu de l’évaluation", "source_page_index": 10},
                        {"id": "subsection-49-1-2", "number": "49.1.2", "title": "Documentation de la situation", "source_page_index": 11},
                    ],
                }
            ]
        }
        units = build_units(pages, structure)
        self.assertEqual(len(units), 4)
        self.assertEqual(units[0]["content_type"], "chapter_opening")
        self.assertEqual([reference["block_index"] for reference in units[0]["source_block_references"]], [0, 1])
        self.assertEqual(units[1]["structural_path"], "Partie 5/Spécialités psychiatriques/Chapitre 49/49.1")
        self.assertEqual(units[2]["structural_path"], "Partie 5/Spécialités psychiatriques/Chapitre 49/49.1/49.1.1")
        self.assertEqual(units[2]["source_page_index_start"], 10)
        self.assertEqual(units[2]["source_page_index_end"], 11)
        self.assertEqual([reference["block_index"] for reference in units[2]["source_block_references"]], [3, 4, 1])
        self.assertEqual(units[3]["structural_path"], "Partie 5/Spécialités psychiatriques/Chapitre 49/49.1/49.1.2")
        self.assertTrue(all("1084" not in unit["raw_text"] and "1085" not in unit["raw_text"] for unit in units))

    def test_group_retains_explicit_medication_section_metadata(self):
        pages = [
            {
                "source_page_index": 10,
                "printed_page_number": None,
                "blocks": [
                    {"block_index": 0, "text": "49.1\nTraitement pharmacologique\n", "bbox": [50, 40, 500, 80]},
                    {"block_index": 1, "text": "Consignes de prescription.\n", "bbox": [50, 90, 500, 120]},
                ],
            }
        ]
        structure = {"chapters": [{"chapter": 49, "id": "chapter-49", "part_number": 5, "page_start": 10, "page_end": 10, "sections": [{"id": "section-49-1", "number": "49.1", "title": "Traitement pharmacologique"}]}]}
        unit = build_units(pages, structure)[0]
        self.assertTrue(unit["data"]["explicit_medication_section"])

        pages = [
            {"source_page_index": 10, "printed_page_number": None, "blocks": [{"block_index": 0, "text": "49 Urgences", "bbox": [54, 130, 300, 170]}, {"block_index": 1, "text": "Introduction", "bbox": [54, 200, 300, 220]}]},
            {"source_page_index": 20, "printed_page_number": None, "blocks": [{"block_index": 0, "text": "50 Suicide", "bbox": [54, 130, 300, 170]}, {"block_index": 1, "text": "Introduction", "bbox": [54, 200, 300, 220]}]},
        ]
        structure = {"chapters": [{"chapter": 49, "id": "chapter-49", "part_number": 5, "page_start": 10, "page_end": 19, "sections": []}, {"chapter": 50, "id": "chapter-50", "part_number": 5, "page_start": 20, "page_end": 29, "sections": []}]}
        units = build_units(pages, structure)
        self.assertEqual(sum(unit["content_type"] == "chapter_opening" for unit in units), 2)
        self.assertEqual([unit["structural_path"].split("/")[2] for unit in units], ["Chapitre 49", "Chapitre 50"])

    def test_units_keep_block_local_records_for_downstream_candidates(self):
        pages = [{"source_page_index": 10, "printed_page_number": None, "blocks": [{"block_index": 0, "text": "49.1\nTraitement pharmacologique\n", "bbox": [50, 40, 500, 80]}, {"block_index": 1, "text": "citalopram 20 mg", "bbox": [50, 90, 500, 120]}]}]
        structure = {"chapters": [{"chapter": 49, "id": "chapter-49", "part_number": 5, "page_start": 10, "page_end": 10, "sections": [{"id": "section-49-1", "number": "49.1", "title": "Traitement pharmacologique"}]}]}
        unit = build_units(pages, structure)[0]
        self.assertEqual([record["block_index"] for record in unit["data"]["block_records"]], [0, 1])
        self.assertEqual(unit["data"]["block_records"][1]["source_page_index"], 10)

        pages = [{"source_page_index": 10, "printed_page_number": None, "blocks": [{"block_index": 0, "text": "49.9 Faux titre", "bbox": [54, 200, 300, 230]}, {"block_index": 1, "text": "Texte", "bbox": [54, 240, 300, 270]}]}]
        structure = {"chapters": [{"chapter": 49, "id": "chapter-49", "part_number": 5, "page_start": 10, "page_end": 10, "sections": [], "subsections": []}]}
        units = build_units(pages, structure)
        self.assertEqual(len(units), 1)
        self.assertNotIn("/49.9", units[0]["structural_path"])

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "raw").mkdir()
            pages = [
                {"source_page_index": 1, "reading_text": "", "extraction_status": "blank", "blocks": []},
                {"source_page_index": 19, "reading_text": "49.1\nÉvaluation clinique", "blocks": [{"block_index": 0, "text": "49.1\nÉvaluation clinique", "bbox": [1, 2, 3, 4]}]},
            ]
            page_map = [
                {"source_page_index": 1, "printed_page_number": None, "printed_page_kind": "blank", "mapping_status": "not_applicable", "mapping_anchor": None},
                {"source_page_index": 19, "printed_page_number": "1084", "printed_page_kind": "body", "mapping_status": "certain", "mapping_anchor": "visible:1084"},
            ]
            structure = {"chapters": [{"chapter": 49, "id": "chapter-49", "part_number": 5, "domain_group": "Situations de crise", "page_start": 19, "page_end": 19}]}
            write_jsonl(root / "raw" / "repaired-pages.jsonl", pages)
            write_jsonl(root / "page-map.jsonl", page_map)
            write_json(root / "structure.json", structure)
            self.assertEqual(main(["units", "--output", str(root)]), 0)
            units = [json.loads(line) for line in (root / "units.jsonl").read_text(encoding="utf-8").splitlines()]
            checkpoint = json.loads((root / "checkpoints" / "units.json").read_text(encoding="utf-8"))
            self.assertEqual(len(units), 1)
            self.assertEqual(checkpoint["source_page_count"], 2)
            self.assertEqual(checkpoint["page_record_count"], 2)
            self.assertEqual(checkpoint["empty_page_count"], 1)
            self.assertEqual(checkpoint["unresolved_unit_count"], 0)


if __name__ == "__main__":
    unittest.main()
