import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.canon_v2.medications import extract_medication_candidates
from tools.canon_v2.serialization import write_jsonl
from tools.ingest_book import main


class MedicationCandidateTests(unittest.TestCase):
    def with_provenance(self, units):
        enriched = []
        for unit in units:
            if isinstance(unit.get("data"), dict) and isinstance(unit["data"].get("block_records"), list):
                enriched.append(unit)
                continue
            raw_text = unit.get("raw_text", unit.get("text", ""))
            reading_text = unit.get("reading_text", unit.get("text", ""))
            raw_lines = raw_text.splitlines() or [""]
            reading_lines = reading_text.splitlines() or [""]
            block_records = []
            for block_index, (raw_line, reading_line) in enumerate(zip(raw_lines, reading_lines)):
                block_records.append(
                    {
                        "source_page_index": unit.get("source_page_index", unit.get("source_page_index_start", 0)),
                        "block_index": block_index,
                        "printed_page_number": None,
                        "raw_text": raw_line,
                        "reading_text": reading_line,
                        "line_records": [
                            {
                                "raw_line_index": 0,
                                "raw_offset_start": 0,
                                "raw_offset_end": len(raw_line),
                                "reading_line_index": 0,
                                "reading_offset_start": 0,
                                "reading_offset_end": len(reading_line),
                                "raw_text": raw_line,
                                "reading_text": reading_line,
                            }
                        ],
                    }
                )
            copy = dict(unit)
            copy["data"] = dict(unit.get("data") or {})
            copy["data"]["block_records"] = block_records
            enriched.append(copy)
        return enriched
    def test_dose_is_preserved_verbatim(self):
        units = [{"id": "unit-2", "text": "thiamine 100 à 300 mg/jour", "source_page_index": 33}]
        records = extract_medication_candidates(self.with_provenance(units))
        self.assertEqual(records[0]["dose_text"], "100 à 300 mg/jour")
        self.assertEqual(records[0]["validation_status"], "needs_review")

    def test_dose_unit_route_and_frequency_tokens_are_exact(self):
        units = [{"id": "unit", "text": "Halopéridol 2 mg IM, 1 fois par jour", "source_page_index": 98}]
        record = extract_medication_candidates(self.with_provenance(units))[0]
        self.assertEqual(record["source_name_text"], "Halopéridol")
        self.assertEqual(record["dose_text"], "2 mg")
        self.assertEqual(record["dose_unit_text"], "mg")
        self.assertEqual(record["route_text"], "IM")
        self.assertEqual(record["frequency_text"], "1 fois par jour")
        self.assertEqual(record["source_context_text"], units[0]["text"])

    def test_salt_and_brand_text_are_never_normalized_or_inferred(self):
        units = [{"id": "unit", "text": "Zuclopenthixol acétate IM : 25 mg BID", "source_page_index": 99}]
        record = extract_medication_candidates(self.with_provenance(units))[0]
        self.assertEqual(record["source_name_text"], "Zuclopenthixol acétate")
        self.assertEqual(record["dose_text"], "25 mg")
        self.assertEqual(record["route_text"], "IM")
        self.assertEqual(record["frequency_text"], "BID")
        self.assertNotIn("generic_name", record)
        self.assertNotIn("normalized_name", record)

    def test_numeric_dose_candidate_is_always_review(self):
        units = [{"id": "unit", "text": "citalopram : 20 mg au maximum", "source_page_index": 349}]
        record = extract_medication_candidates(self.with_provenance(units))[0]
        self.assertEqual(record["dose_text"], "20 mg")
        self.assertIn("numeric_dose", record["risk_flags"])
        self.assertIn("high_risk_source_language", record["risk_flags"])
        self.assertEqual(record["validation_status"], "needs_review")

    def test_author_credential_sc_is_not_a_route_token(self):
        units = [{"id": "unit", "text": "Philippe Vincent, BCPP, M. Sc. (pharmacothérapie avancée)", "source_page_index": 6}]
        self.assertEqual(extract_medication_candidates(self.with_provenance(units)), [])

    def test_explicit_high_risk_treatment_statement_is_review(self):
        units = [{"id": "unit", "text": "Il faut éviter les antidépresseurs tricycliques dans ce cas.", "source_page_index": 30}]
        record = extract_medication_candidates(self.with_provenance(units))[0]
        self.assertEqual(record["candidate_kind"], "high_risk_treatment_statement")
        self.assertEqual(record["source_context_text"], units[0]["text"])
        self.assertEqual(record["validation_status"], "needs_review")
        self.assertEqual(record["recommendation_status"], "source_text_only")

    def test_explicit_medication_section_without_dose_remains_a_candidate(self):
        units = [{"id": "unit", "content_type": "medication_statement", "text": "Traitement pharmacologique", "source_page_index": 30}]
        record = extract_medication_candidates(self.with_provenance(units))[0]
        self.assertEqual(record["candidate_kind"], "explicit_medication_section")
        self.assertIsNone(record["dose_text"])
        self.assertEqual(record["validation_status"], "needs_review")

    def test_unrelated_numeric_text_is_not_promoted_to_medication(self):
        units = [{"id": "unit", "text": "Le quotient intellectuel est de 100.", "source_page_index": 180}]
        self.assertEqual(extract_medication_candidates(self.with_provenance(units)), [])

    def test_dose_detection_does_not_cross_newline(self):
        units = [{"id": "unit", "text": "thiamine\n100 mg", "source_page_index": 10}]
        self.assertEqual(extract_medication_candidates(self.with_provenance(units)), [])

    def test_slash_j_unit_is_preserved_verbatim(self):
        units = [{"id": "unit", "text": "sertraline 50 mg/j", "source_page_index": 10}]
        record = extract_medication_candidates(self.with_provenance(units))[0]
        self.assertEqual(record["dose_text"], "50 mg/j")
        self.assertEqual(record["dose_unit_text"], "mg/j")

    def test_each_dose_uses_its_local_route(self):
        units = [{"id": "unit", "text": "Halopéridol 2 mg IM\nDiazépam 5 mg IV", "source_page_index": 10}]
        records = extract_medication_candidates(self.with_provenance(units))
        self.assertEqual([(record["dose_text"], record["route_text"]) for record in records], [("2 mg", "IM"), ("5 mg", "IV")])

    def test_numeric_dose_does_not_suppress_later_high_risk_line(self):
        units = [{"id": "unit", "text": "citalopram 20 mg\nIl faut éviter le diazépam.", "source_page_index": 10}]
        records = extract_medication_candidates(self.with_provenance(units))
        self.assertEqual([record["candidate_kind"] for record in records], ["numeric_dose", "high_risk_treatment_statement"])

    def test_multiple_doses_on_one_line_do_not_inherit_previous_route(self):
        units = [{"id": "unit", "text": "Halopéridol 2 mg IM; diazépam 5 mg", "source_page_index": 10}]
        records = extract_medication_candidates(self.with_provenance(units))
        self.assertEqual([(record["source_name_text"], record["dose_text"], record["route_text"]) for record in records], [("Halopéridol", "2 mg", "IM"), ("diazépam", "5 mg", None)])

    def test_explicit_section_metadata_anywhere_in_group_is_eligible(self):
        units = [{"id": "unit", "content_type": "heading", "data": {"explicit_medication_section": True}, "text": "Introduction\nTraitement pharmacologique\nConsignes", "source_page_index": 10}]
        records = extract_medication_candidates(self.with_provenance(units))
        self.assertEqual([record["candidate_kind"] for record in records], ["explicit_medication_section"])

    def test_front_matter_and_index_medication_text_is_excluded(self):
        units = [
            {"id": "front", "text": "thiamine 100 mg", "structural_path": "Tome 2/Front matter", "source_page_index": 5},
            {"id": "index", "text": "thiamine 100 mg", "structural_path": "Tome 2/Index des médicaments", "source_page_index": 700},
        ]
        self.assertEqual(extract_medication_candidates(self.with_provenance(units)), [])

    def test_numbered_explicit_section_candidate_keeps_heading_line_context(self):
        units = [{"id": "unit", "data": {"explicit_medication_section": True}, "text": "71.2.3 Modalités de prescription\nDétail de la section.", "source_page_index": 10}]
        record = extract_medication_candidates(self.with_provenance(units))[0]
        self.assertEqual(record["source_context_text"], "71.2.3 Modalités de prescription")

        units = [{"id": "front", "content_type": "medication_statement", "text": "Traitement pharmacologique\nthiamine 100 mg", "structural_path": "Tome 2/Front matter", "source_page_index": 5}]
        self.assertEqual(len(extract_medication_candidates(self.with_provenance(units))), 1)

    def test_medication_candidate_rejects_absent_block_page_evidence(self):
        with self.assertRaises(ValueError):
            extract_medication_candidates([{"id": "unit", "text": "citalopram 20 mg", "source_page_index": 10}])

    def test_medication_candidate_rejects_invalid_block_printed_label(self):
        text = "citalopram 20 mg"
        missing = object()
        for printed in (1234, "", missing):
            with self.subTest(printed=printed):
                unit = {
                    "id": "unit",
                    "text": text,
                    "raw_text": text,
                    "reading_text": text,
                    "data": {
                        "block_records": [
                            {
                                "source_page_index": 10,
                                "block_index": 0,
                                "printed_page_number": printed,
                                "raw_text": text,
                                "reading_text": text,
                                "line_records": [
                                    {
                                        "raw_line_index": 0,
                                        "raw_offset_start": 0,
                                        "raw_offset_end": len(text),
                                        "reading_line_index": 0,
                                        "reading_offset_start": 0,
                                        "reading_offset_end": len(text),
                                        "raw_text": text,
                                        "reading_text": text,
                                    }
                                ],
                            }
                        ]
                    },
                }
                if printed is missing:
                    unit["data"]["block_records"][0].pop("printed_page_number")
                with self.assertRaises(ValueError):
                    extract_medication_candidates([unit])

    def test_medication_candidate_provenance_is_line_and_block_local(self):
        unit = {
            "unit_id": "unit-host",
            "text": "Introduction\ncitalopram 20 mg\nConclusion",
            "raw_text": "Introduction\ncitalopram 20 mg\nConclusion",
            "reading_text": "Introduction\ncitalopram 20 mg\nConclusion",
            "source_page_index": 10,
            "source_page_index_start": 10,
            "source_page_index_end": 12,
            "source_span": "p10:b0+p11:b4+p12:b2",
            "source_block_references": [{"block_index": 0}, {"block_index": 4}, {"block_index": 2}],
            "data": {
                "block_records": [
                    {"source_page_index": 10, "printed_page_number": None, "block_index": 0, "raw_text": "Introduction", "reading_text": "Introduction"},
                    {"source_page_index": 10, "printed_page_number": None, "block_index": 0, "raw_text": "Introduction", "reading_text": "Introduction", "line_records": [{"raw_line_index": 0, "raw_offset_start": 0, "raw_offset_end": 12, "reading_line_index": 0, "reading_offset_start": 0, "reading_offset_end": 12, "raw_text": "Introduction", "reading_text": "Introduction"}]},
                    {"source_page_index": 11, "printed_page_number": None, "block_index": 4, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg", "bbox": [50, 40, 500, 55], "line_records": [{"raw_line_index": 0, "raw_offset_start": 0, "raw_offset_end": 16, "reading_line_index": 0, "reading_offset_start": 0, "reading_offset_end": 16, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg"}]},
                    {"source_page_index": 12, "printed_page_number": None, "block_index": 2, "raw_text": "Conclusion", "reading_text": "Conclusion", "line_records": [{"raw_line_index": 0, "raw_offset_start": 0, "raw_offset_end": 10, "reading_line_index": 0, "reading_offset_start": 0, "reading_offset_end": 10, "raw_text": "Conclusion", "reading_text": "Conclusion"}]},
                    {"source_page_index": 12, "printed_page_number": None, "block_index": 2, "raw_text": "Conclusion", "reading_text": "Conclusion"},
                ]
            },
        }
        record = extract_medication_candidates([unit])[0]
        self.assertEqual(record["source_page_index_start"], 11)
        self.assertEqual(record["source_page_index_end"], 11)
        self.assertEqual(record["source_span"], "p11:b4:l1:o0-16")
        self.assertEqual(record["raw_text"], "citalopram 20 mg")
        self.assertEqual(record["reading_text"], "citalopram 20 mg")
        self.assertEqual(record["source_block_references"], [{"block_index": 4, "bbox": [50, 40, 500, 55]}])

    def test_repeated_identical_lines_map_to_distinct_block_line_identities(self):
        unit = {
            "unit_id": "unit-host",
            "text": "citalopram 20 mg\ncitalopram 20 mg",
            "raw_text": "citalopram 20 mg\ncitalopram 20 mg",
            "reading_text": "citalopram 20 mg\ncitalopram 20 mg",
            "data": {"block_records": [
                {"source_page_index": 10, "printed_page_number": None, "block_index": 0, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg", "line_records": [{"raw_line_index": 0, "raw_offset_start": 0, "raw_offset_end": 16, "reading_line_index": 0, "reading_offset_start": 0, "reading_offset_end": 16, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg"}]},
                {"source_page_index": 10, "printed_page_number": None, "block_index": 1, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg", "line_records": [{"raw_line_index": 0, "raw_offset_start": 0, "raw_offset_end": 16, "reading_line_index": 0, "reading_offset_start": 0, "reading_offset_end": 16, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg"}]},
            ]},
        }
        records = extract_medication_candidates([unit])
        self.assertEqual([record["source_span"] for record in records], ["p10:b0:l1:o0-16", "p10:b1:l1:o0-16"])

    def test_raw_and_reading_lines_are_preserved_separately(self):
        unit = {
            "unit_id": "unit-host",
            "text": "citalopram 20 mg réparé",
            "raw_text": "citalopram 20 mg",
            "reading_text": "citalopram 20 mg réparé",
            "data": {"block_records": [{"source_page_index": 10, "printed_page_number": None, "block_index": 0, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg réparé", "line_records": [{"raw_line_index": 0, "raw_offset_start": 0, "raw_offset_end": 16, "reading_line_index": 0, "reading_offset_start": 0, "reading_offset_end": 23, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg réparé"}]}]},
        }
        record = extract_medication_candidates([unit])[0]
        self.assertEqual(record["raw_text"], "citalopram 20 mg")
        self.assertEqual(record["reading_text"], "citalopram 20 mg réparé")
        self.assertEqual(record["raw_sha256"], hashlib.sha256(b"citalopram 20 mg").hexdigest())

    def test_source_span_uses_block_local_line_and_offsets(self):
        unit = {
            "unit_id": "unit-host",
            "text": "citalopram 20 mg",
            "raw_text": "citalopram 20 mg",
            "reading_text": "citalopram 20 mg",
            "data": {"block_records": [{"source_page_index": 10, "printed_page_number": None, "block_index": 4, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg", "line_records": [{"raw_line_index": 0, "raw_offset_start": 0, "raw_offset_end": 16, "reading_line_index": 0, "reading_offset_start": 0, "reading_offset_end": 16, "raw_text": "citalopram 20 mg", "reading_text": "citalopram 20 mg"}]}]},
        }
        record = extract_medication_candidates([unit])[0]
        self.assertEqual(record["source_span"], "p10:b4:l1:o0-16")
        self.assertEqual(record["source_line_identity"], {"source_page_index": 10, "block_index": 4, "raw_line_index": 0, "raw_offset_start": 0, "raw_offset_end": 16, "reading_line_index": 0, "reading_offset_start": 0, "reading_offset_end": 16})

    def test_clause_delimiter_does_not_truncate_source_context(self):
        unit = {
            "unit_id": "unit-host",
            "text": "citalopram 300 mg ou 500 mg",
            "raw_text": "citalopram 300 mg ou 500 mg",
            "reading_text": "citalopram 300 mg ou 500 mg",
            "data": {"block_records": [{"source_page_index": 10, "printed_page_number": None, "block_index": 0, "raw_text": "citalopram 300 mg ou 500 mg", "reading_text": "citalopram 300 mg ou 500 mg", "line_records": [{"raw_line_index": 0, "raw_offset_start": 0, "raw_offset_end": 27, "reading_line_index": 0, "reading_offset_start": 0, "reading_offset_end": 27, "raw_text": "citalopram 300 mg ou 500 mg", "reading_text": "citalopram 300 mg ou 500 mg"}]}]},
        }
        records = extract_medication_candidates([unit])
        self.assertEqual([record["source_context_text"] for record in records], ["citalopram 300 mg ou 500 mg", "citalopram 300 mg ou 500 mg"])
        self.assertEqual([record["raw_text"] for record in records], ["citalopram 300 mg ou 500 mg", "citalopram 300 mg ou 500 mg"])
        self.assertEqual([record["source_name_text"] for record in records], ["citalopram", None])

        units = [{"id": "unit", "text": "Halopéridol 2 mg IM et diazépam 5 mg IV", "source_page_index": 10}]
        records = extract_medication_candidates(self.with_provenance(units))
        self.assertEqual([(record["source_name_text"], record["route_text"]) for record in records], [("Halopéridol", "IM"), ("diazépam", "IV")])

        units = [{"id": "unit", "text": "La prescription : halopéridol (Haldol) 2 mg", "source_page_index": 10}]
        record = extract_medication_candidates(self.with_provenance(units))[0]
        self.assertEqual(record["source_name_text"], "halopéridol")
        self.assertEqual(record["brand_name_text"], "Haldol")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            unit = self.with_provenance([{"id": "unit", "text": "thiamine 100 à 300 mg/jour", "source_page_index": 33, "source_page_index_start": 33, "source_page_index_end": 33}])[0]
            write_jsonl(root / "units.jsonl", [unit])
            self.assertEqual(main(["medications", "--output", str(root)]), 0)
            records = [json.loads(line) for line in (root / "medications.jsonl").read_text(encoding="utf-8").splitlines()]
            checkpoint = json.loads((root / "checkpoints" / "medications.json").read_text(encoding="utf-8"))
            self.assertEqual(len(records), 1)
            self.assertEqual(checkpoint["medication_candidate_count"], 1)
            self.assertEqual(checkpoint["numeric_candidate_count"], 1)
            self.assertEqual(checkpoint["unresolved_candidate_count"], 1)


if __name__ == "__main__":
    unittest.main()
