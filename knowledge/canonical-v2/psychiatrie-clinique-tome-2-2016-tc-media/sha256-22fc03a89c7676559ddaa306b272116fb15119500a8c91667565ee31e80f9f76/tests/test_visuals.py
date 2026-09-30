import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.canon_v2.serialization import write_jsonl
from tools.canon_v2.visuals import extract_visual_candidates
from tools.ingest_book import main


class VisualCandidateTests(unittest.TestCase):
    def page(self, index, printed="test"):
        return {"source_page_index": index, "printed_page_number": printed, "blocks": []}
    def test_visual_caption_is_first_class(self):
        units = [{"id": "unit-1", "text": "TABLEAU 49.3 Facteurs de risque du suicide", "source_page_index": 26}]
        candidates = extract_visual_candidates(units, [self.page(26)])
        self.assertEqual(candidates[0]["content_type"], "table")
        self.assertEqual(candidates[0]["caption"], "TABLEAU 49.3 Facteurs de risque du suicide")

    def test_visual_caption_reads_the_reading_layer_when_text_is_not_duplicated(self):
        units = [{"id": "unit-1", "reading_text": "TABLEAU 49.3 Facteurs de risque du suicide", "source_page_index": 26}]
        candidates = extract_visual_candidates(units, [self.page(26)])
        self.assertEqual(candidates[0]["caption"], "TABLEAU 49.3 Facteurs de risque du suicide")

    def test_supported_caption_prefixes_map_to_exact_visual_types(self):
        cases = [
            ("TABLEAU 49.1 Titre", "table"),
            ("FIGURE 49.2 Titre", "figure"),
            ("ENCADRÉ 49.3 Titre", "box"),
            ("ALGORITHME 49.4 Titre", "algorithm"),
            ("SCHÉMA 49.5 Titre", "figure"),
        ]
        for position, (caption, expected) in enumerate(cases):
            with self.subTest(caption=caption):
                candidate = extract_visual_candidates([{"id": "unit", "text": caption, "source_page_index": position}], [self.page(position)])[0]
                self.assertEqual(candidate["content_type"], expected)
                self.assertEqual(candidate["caption"], caption)
                self.assertEqual(candidate["validation_status"], "needs_review")

    def test_caption_geometry_and_exact_footnotes_are_preserved(self):
        unit = {
            "id": "unit-figure",
            "unit_id": "unit:figure",
            "text": "FIGURE 50.5 Taux de mortalité*",
            "source_page_index": 57,
            "source_page_index_start": 57,
            "source_page_index_end": 57,
            "printed_page_start": "1122",
            "printed_page_end": "1122",
            "source_block_references": [{"block_index": 3, "bbox": [50.25, 394.75, 471.5, 407.0]}],
        }
        pages = [
            {
                "source_page_index": 57,
                "printed_page_number": "1122",
                "page_width": 603.0,
                "page_height": 783.0,
                "blocks": [
                    {"block_index": 3, "text": unit["text"], "bbox": [50.25, 394.75, 471.5, 407.0]},
                    {"block_index": 5, "text": "* Moyennes mobiles calculées sur des périodes de trois ans.\n", "bbox": [48.25, 709.8, 218.9, 718.6]},
                ],
            }
        ]
        candidate = extract_visual_candidates([unit], pages)[0]
        self.assertEqual(candidate["caption_bbox"], [50.25, 394.75, 471.5, 407.0])
        self.assertEqual(candidate["page_geometry"], {"page_width": 603.0, "page_height": 783.0})
        self.assertEqual(candidate["footnotes"], ["* Moyennes mobiles calculées sur des périodes de trois ans.\n"])

    def test_visual_candidate_rejects_missing_or_invalid_page_label(self):
        unit = {
            "id": "unit-1",
            "unit_id": "unit-1",
            "text": "TABLEAU 57.4 Fonctionnement adaptatif",
            "source_page_index": 180,
            "source_page_index_start": 180,
            "source_page_index_end": 180,
            "printed_page_start": "1238",
            "printed_page_end": "1238",
        }
        for name, page_value in (("missing", None), ("integer", 1238), ("empty", "")):
            with self.subTest(name=name):
                page = {
                    "source_page_index": 180,
                    "blocks": [{"block_index": 1, "text": unit["text"], "bbox": [10, 20, 30, 40]}],
                }
                if name != "missing":
                    page["printed_page_number"] = page_value
                with self.assertRaises(ValueError):
                    extract_visual_candidates([unit], [page])

    def test_visual_candidate_rejects_absent_page_record(self):
        unit = {
            "id": "unit-1",
            "unit_id": "unit-1",
            "text": "TABLEAU 57.4 Fonctionnement adaptatif",
            "source_page_index": 180,
            "source_page_index_start": 180,
            "source_page_index_end": 180,
            "printed_page_start": "1238",
            "printed_page_end": "1238",
        }
        with self.assertRaises(ValueError):
            extract_visual_candidates([unit], [])

    def test_visual_candidate_uses_exact_caption_page_label(self):
        unit = {
            "id": "unit-1",
            "unit_id": "unit-1",
            "text": "TABLEAU 57.4 Fonctionnement adaptatif",
            "source_page_index": 180,
            "source_page_index_start": 180,
            "source_page_index_end": 181,
            "printed_page_start": "1238",
            "printed_page_end": "1239",
            "structural_path": "Partie 5/Chapitre 57",
        }
        pages = [
            {"source_page_index": 180, "printed_page_number": "1238", "blocks": []},
            {
                "source_page_index": 181,
                "printed_page_number": None,
                "blocks": [{"block_index": 2, "text": unit["text"], "bbox": [10, 20, 30, 40]}],
            },
        ]
        candidate = extract_visual_candidates([unit], pages)[0]
        self.assertIsNone(candidate["printed_page_start"])
        self.assertIsNone(candidate["printed_page_end"])

    def test_cross_page_table_continuations_are_linked_not_merged(self):
        units = [
            {"id": "unit-1", "text": "TABLEAU 57.4 Fonctionnement adaptatif", "source_page_index": 180, "structural_path": "Partie 5/Chapitre 57"},
            {"id": "unit-2", "text": "TABLEAU 57.4 Fonctionnement adaptatif (suite)", "source_page_index": 181, "structural_path": "Partie 5/Chapitre 57"},
        ]
        candidates = extract_visual_candidates(units, [self.page(180), self.page(181)])
        self.assertEqual(len(candidates), 2)
        self.assertIsNone(candidates[0]["continuation_of"])
        self.assertEqual(candidates[1]["continuation_of"], candidates[0]["candidate_id"])
        self.assertEqual(candidates[0]["continuation_candidate_ids"], [candidates[1]["candidate_id"]])

    def test_continuation_requires_same_structural_path(self):
        units = [
            {"id": "unit-1", "text": "TABLEAU 57.4 Fonctionnement adaptatif", "source_page_index": 180, "structural_path": "Partie 5/Chapitre 57"},
            {"id": "unit-2", "text": "TABLEAU 57.4 Fonctionnement adaptatif (suite)", "source_page_index": 181, "structural_path": "Partie 6/Chapitre 66"},
        ]
        candidates = extract_visual_candidates(units, [self.page(180), self.page(181)])
        self.assertIsNone(candidates[1]["continuation_of"])

    def test_continuation_requires_adjacent_source_pages(self):
        units = [
            {"id": "unit-1", "text": "TABLEAU 57.4 Fonctionnement adaptatif", "source_page_index": 180, "structural_path": "Partie 5/Chapitre 57"},
            {"id": "unit-2", "text": "TABLEAU 57.4 Fonctionnement adaptatif (suite)", "source_page_index": 182, "structural_path": "Partie 5/Chapitre 57"},
        ]
        candidates = extract_visual_candidates(units, [self.page(180), self.page(182)])
        self.assertIsNone(candidates[1]["continuation_of"])

    def test_unrelated_later_same_key_requires_explicit_continuation_signal(self):
        units = [
            {"id": "unit-1", "text": "TABLEAU 57.4 Fonctionnement adaptatif", "source_page_index": 180, "structural_path": "Partie 5/Chapitre 57"},
            {"id": "unit-2", "text": "TABLEAU 57.4 Fonctionnement adaptatif (suite)", "source_page_index": 181, "structural_path": "Partie 5/Chapitre 57"},
            {"id": "unit-3", "text": "TABLEAU 57.4 Fonctionnement adaptatif", "source_page_index": 182, "structural_path": "Partie 5/Chapitre 57"},
        ]
        candidates = extract_visual_candidates(units, [self.page(180), self.page(181), self.page(182)])
        self.assertEqual(candidates[1]["continuation_of"], candidates[0]["candidate_id"])
        self.assertIsNone(candidates[2]["continuation_of"])
        self.assertEqual(candidates[1]["continuation_candidate_ids"], None)

    def test_candidate_provenance_is_caption_local(self):
        unit = {
            "unit_id": "unit-host",
            "text": "Introduction\nTABLEAU 49.3 Facteurs de risque\nConclusion",
            "raw_text": "Introduction\nTABLEAU 49.3 Facteurs de risque\nConclusion",
            "reading_text": "Introduction\nTABLEAU 49.3 Facteurs de risque\nConclusion",
            "source_span": "p10:b0+b1+b2",
            "source_page_index": 10,
            "source_page_index_start": 10,
            "source_page_index_end": 10,
            "structural_path": "Partie 5/Chapitre 49",
            "source_block_references": [
                {"block_index": 0, "bbox": [50, 20, 500, 35]},
                {"block_index": 1, "bbox": [50, 40, 500, 55]},
                {"block_index": 2, "bbox": [50, 60, 500, 75]},
            ],
        }
        page = {
            "source_page_index": 10,
            "printed_page_number": "test",
            "page_width": 603.0,
            "page_height": 783.0,
            "blocks": [
                {"block_index": 0, "text": "Introduction", "bbox": [50, 20, 500, 35]},
                {"block_index": 1, "text": "TABLEAU 49.3 Facteurs de risque", "bbox": [50, 40, 500, 55]},
                {"block_index": 2, "text": "Conclusion", "bbox": [50, 60, 500, 75]},
            ],
        }
        candidate = extract_visual_candidates([unit], [page])[0]
        self.assertEqual(candidate["host_unit_id"], "unit-host")
        self.assertEqual(candidate["source_span"], "p10:b1")
        self.assertEqual(candidate["source_page_index_start"], 10)
        self.assertEqual(candidate["source_page_index_end"], 10)
        self.assertEqual(candidate["raw_text"], "TABLEAU 49.3 Facteurs de risque")
        self.assertEqual(candidate["reading_text"], "TABLEAU 49.3 Facteurs de risque")
        self.assertEqual(candidate["source_block_references"], [{"block_index": 1, "bbox": [50, 40, 500, 55]}])

        unit = {
            "id": "unit-table",
            "text": "TABLEAU 69.3 Posologie initiale et maximale",
            "source_page_index": 425,
            "source_block_references": [{"block_index": 1, "bbox": [56.25, 41.0, 427.0, 53.0]}],
        }
        pages = [
            {
                "source_page_index": 425,
                "printed_page_number": "test",
                "page_width": 603.0,
                "page_height": 783.0,
                "table_detections": [
                    {
                        "bbox": [50.0, 40.0, 530.0, 720.0],
                        "cells": [{"text": "Amitriptyline (ElavilMD)\n75 mg\n300 mg", "bbox": [183.6, 73.7, 505.8, 84.0], "row": 0, "column": 0}],
                    }
                ],
            }
        ]
        candidate = extract_visual_candidates([unit], pages)[0]
        self.assertEqual(candidate["cell_relationships"], [{"text": "Amitriptyline (ElavilMD)\n75 mg\n300 mg", "bbox": [183.6, 73.7, 505.8, 84.0], "row": 0, "column": 0, "validation_status": "needs_review"}])
        self.assertEqual(candidate["unresolved_cell_count"], 1)
        self.assertEqual(candidate["validation_status"], "needs_review")

    def test_table_cells_bind_to_the_nearest_caption_region(self):
        units = [
            {"id": "unit-1", "text": "TABLEAU 49.1 Premier tableau", "source_page_index": 10, "source_block_references": [{"block_index": 1, "bbox": [50, 40, 500, 55]}]},
            {"id": "unit-2", "text": "TABLEAU 49.2 Second tableau", "source_page_index": 10, "source_block_references": [{"block_index": 5, "bbox": [50, 420, 500, 435]}]},
        ]
        page = {
            "source_page_index": 10,
            "printed_page_number": "test",
            "page_width": 603.0,
            "page_height": 783.0,
            "blocks": [
                {"block_index": 1, "text": units[0]["text"], "bbox": [50, 40, 500, 55]},
                {"block_index": 5, "text": units[1]["text"], "bbox": [50, 420, 500, 435]},
            ],
            "table_detections": [
                {"bbox": [50, 55, 500, 300], "cells": [{"text": "cell A", "bbox": [50, 55, 200, 80], "row": 0, "column": 0}]},
                {"bbox": [50, 435, 500, 700], "cells": [{"text": "cell B", "bbox": [50, 435, 200, 460], "row": 0, "column": 0}]},
            ],
        }
        candidates = extract_visual_candidates(units, [page])
        self.assertEqual([candidate["cell_relationships"][0]["text"] for candidate in candidates], ["cell A", "cell B"])

    def test_footnotes_bind_to_their_spatial_caption_region(self):
        units = [
            {"id": "unit-1", "text": "FIGURE 49.1 Premier", "source_page_index": 10, "source_block_references": [{"block_index": 1, "bbox": [50, 40, 500, 55]}]},
            {"id": "unit-2", "text": "FIGURE 49.2 Second", "source_page_index": 10, "source_block_references": [{"block_index": 5, "bbox": [50, 420, 500, 435]}]},
        ]
        page = {
            "source_page_index": 10,
            "printed_page_number": "test",
            "page_width": 603.0,
            "page_height": 783.0,
            "blocks": [
                {"block_index": 1, "text": units[0]["text"], "bbox": [50, 40, 500, 55]},
                {"block_index": 2, "text": "Note : première note", "bbox": [50, 350, 200, 365]},
                {"block_index": 5, "text": units[1]["text"], "bbox": [50, 420, 500, 435]},
                {"block_index": 6, "text": "Note : deuxième note", "bbox": [50, 700, 200, 715]},
            ],
        }
        candidates = extract_visual_candidates(units, [page])
        self.assertEqual(candidates[0]["footnotes"], ["Note : première note"])
        self.assertEqual(candidates[1]["footnotes"], ["Note : deuxième note"])

    def test_same_page_repeated_caption_is_not_a_continuation(self):
        units = [
            {"id": "unit-1", "text": "TABLEAU 49.1 Titre", "source_page_index": 10},
            {"id": "unit-2", "text": "TABLEAU 49.1 Titre", "source_page_index": 10},
        ]
        candidates = extract_visual_candidates(units, [self.page(10)])
        self.assertIsNone(candidates[0]["continuation_of"])
        self.assertIsNone(candidates[1]["continuation_of"])
        self.assertIsNone(candidates[0]["continuation_candidate_ids"])

    def test_unrelated_suite_elsewhere_on_adjacent_page_does_not_link(self):
        units = [
            {"id": "unit-1", "text": "TABLEAU 57.4 Fonctionnement adaptatif", "source_page_index": 180, "structural_path": "Partie 5/Chapitre 57"},
            {"id": "unit-2", "text": "TABLEAU 57.4 Fonctionnement adaptatif", "source_page_index": 181, "structural_path": "Partie 5/Chapitre 57"},
        ]
        pages = [
            {"source_page_index": 180, "printed_page_number": "1238", "page_height": 783.0, "blocks": [{"block_index": 1, "text": units[0]["text"], "bbox": [50, 40, 500, 55]}]},
            {"source_page_index": 181, "printed_page_number": "1239", "page_height": 783.0, "blocks": [{"block_index": 1, "text": units[1]["text"], "bbox": [50, 40, 500, 55]}, {"block_index": 2, "text": "Texte intermédiaire", "bbox": [50, 100, 500, 115]}, {"block_index": 3, "text": "Suite du chapitre suivant", "bbox": [50, 300, 500, 315]}]},
        ]
        candidates = extract_visual_candidates(units, pages)
        self.assertIsNone(candidates[1]["continuation_of"])

    def test_two_captions_in_one_host_unit_keep_distinct_regions(self):
        unit = {
            "unit_id": "unit-host",
            "text": "TABLEAU 49.1 Premier\nTABLEAU 49.2 Second",
            "source_page_index": 10,
            "source_page_index_start": 10,
            "source_page_index_end": 10,
            "structural_path": "Partie 5/Chapitre 49",
            "source_block_references": [{"block_index": 1, "bbox": [50, 40, 500, 55]}, {"block_index": 2, "bbox": [50, 420, 500, 435]}],
        }
        page = {
            "source_page_index": 10,
            "printed_page_number": "test",
            "page_width": 603.0,
            "page_height": 783.0,
            "blocks": [
                {"block_index": 1, "text": "TABLEAU 49.1 Premier", "bbox": [50, 40, 500, 55]},
                {"block_index": 2, "text": "TABLEAU 49.2 Second", "bbox": [50, 420, 500, 435]},
                {"block_index": 3, "text": "Note : première note", "bbox": [50, 350, 200, 365]},
                {"block_index": 4, "text": "Note : deuxième note", "bbox": [50, 700, 200, 715]},
            ],
            "table_detections": [
                {"bbox": [50, 55, 500, 300], "cells": [{"text": "cell A", "bbox": [50, 55, 200, 80], "row": 0, "column": 0}]},
                {"bbox": [50, 435, 500, 700], "cells": [{"text": "cell B", "bbox": [50, 435, 200, 460], "row": 0, "column": 0}]},
            ],
        }
        candidates = extract_visual_candidates([unit], [page])
        self.assertEqual([candidate["caption_bbox"] for candidate in candidates], [[50, 40, 500, 55], [50, 420, 500, 435]])
        self.assertEqual([candidate["cell_relationships"][0]["text"] for candidate in candidates], ["cell A", "cell B"])
        self.assertEqual([candidate["footnotes"] for candidate in candidates], [["Note : première note"], ["Note : deuxième note"]])

        self.assertEqual(extract_visual_candidates([{"id": "unit", "text": "Voir le tableau 49.3.", "source_page_index": 26}], []), [])

    def test_cli_writes_visual_candidates_and_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "raw").mkdir()
            unit = {
                "unit_id": "unit:table",
                "text": "TABLEAU 49.1 Titre",
                "source_page_index": 23,
                "source_page_index_start": 23,
                "source_page_index_end": 23,
                "printed_page_start": "1088",
                "printed_page_end": "1088",
                "mapping_status": "certain",
                "source_span": "p23:b1",
                "structural_path": "Partie 5/Spécialités psychiatriques/Chapitre 49",
                "source_block_references": [{"block_index": 1, "bbox": [50.0, 40.0, 400.0, 60.0]}],
            }
            page = {"source_page_index": 23, "printed_page_number": None, "page_width": 603.0, "page_height": 783.0, "blocks": [{"block_index": 1, "text": unit["text"], "bbox": [50.0, 40.0, 400.0, 60.0]}]}
            write_jsonl(root / "units.jsonl", [unit])
            write_jsonl(root / "raw" / "repaired-pages.jsonl", [page])
            write_jsonl(root / "page-map.jsonl", [{"source_page_index": 23, "printed_page_number": "1089"}])
            self.assertEqual(main(["visuals", "--output", str(root)]), 0)
            records = [json.loads(line) for line in (root / "visuals.jsonl").read_text(encoding="utf-8").splitlines()]
            checkpoint = json.loads((root / "checkpoints" / "visuals.json").read_text(encoding="utf-8"))
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["printed_page_start"], "1089")
            self.assertEqual(records[0]["printed_page_end"], "1089")
            self.assertEqual(checkpoint["visual_candidate_count"], 1)
            self.assertEqual(checkpoint["table_continuation_count"], 0)
            self.assertEqual(checkpoint["unresolved_candidate_count"], 1)


if __name__ == "__main__":
    unittest.main()
