import hashlib
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.canon_v2.constants import (
    BOOK_ID,
    INGESTION_VERSION,
    LANGUAGE,
    SOURCE_VERSION,
)
from tools.canon_v2.serialization import (
    canonical_json,
    read_jsonl,
    stable_id,
    validate_record,
    write_json,
    write_jsonl,
)


CONTENT_TYPES = (
    "chapter_opening",
    "heading",
    "definition",
    "prose",
    "list",
    "clinical_case",
    "box",
    "table",
    "figure",
    "algorithm",
    "recommendation",
    "diagnostic_criteria",
    "differential",
    "investigation",
    "scale",
    "medication_statement",
    "reference",
    "bibliography",
    "index_entry",
    "credits",
    "back_matter",
)


def valid_record():
    identity = stable_id(
        "unit",
        SOURCE_VERSION,
        "Book/Part 5/Chapter 49",
        "source_page_index:19;block:b19-0",
        1,
    )
    structural_path = "Book/Part 5/Chapter 49"
    source_span = "source_page_index:19;block:b19-0"
    return {
        "schema_version": INGESTION_VERSION,
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "ingestion_version": INGESTION_VERSION,
        "language": LANGUAGE,
        "unit_id": identity,
        "record_id": identity,
        "kind": "unit",
        "structural_path": structural_path,
        "source_span": source_span,
        "occurrence": 1,
        "content_type": "prose",
        "title": "Exemple de passage",
        "source_page_index": 19,
        "source_page_index_end": 19,
        "source_page_display": 20,
        "source_page_display_end": 20,
        "printed_page_number": "1084",
        "printed_page_number_end": "1084",
        "printed_page_label": "1084",
        "printed_page_label_end": "1084",
        "printed_page_kind": "body",
        "mapping_status": "certain",
        "mapping_anchor": "Printed label 1084 observed on PDF display page 20",
        "mapping_evidence": {
            "source_page_index": 19,
            "text_span": "1084",
            "extraction_version": "pymupdf-1.28.2",
        },
        "raw_text": "Texte brut.",
        "raw_sha256": hashlib.sha256("Texte brut.".encode("utf-8")).hexdigest(),
        "reading_text": "Texte brut.",
        "repair_references": ["repair:pymupdf-pua:000001"],
        "xref_status": "not_applicable",
        "xref_targets": [],
        "extraction_status": "complete",
        "confidence": 1.0,
        "validation_status": "auto_ok",
        "provenance": {
            "book_id": BOOK_ID,
            "source_version": SOURCE_VERSION,
            "ingestion_version": INGESTION_VERSION,
            "extractor": "PyMuPDF",
            "extractor_version": "1.28.2",
            "source_page_indices": [19],
            "structural_path": structural_path,
            "source_span": source_span,
            "host_record_id": None,
            "raw_passage_reference": "raw/pages.jsonl#page-index-19",
            "repair_references": ["repair:pymupdf-pua:000001"],
            "extraction_status": "complete",
            "mapping_status": "certain",
            "validation_status": "auto_ok",
        },
    }


class SerializationTests(unittest.TestCase):
    def test_canonical_json_is_exact_compact_utf8_json(self):
        payload = canonical_json({"z": "é", "a": 1}).encode("utf-8")

        self.assertEqual(payload, '{"a":1,"z":"é"}\n'.encode("utf-8"))
        self.assertFalse(payload.startswith(b"\xef\xbb\xbf"))

    def test_canonical_json_rejects_non_json_values(self):
        for value in ({1, 2}, (1, 2), {1: "one"}, {"invalid": float("nan")}):
            with self.subTest(value=value):
                with self.assertRaises((TypeError, ValueError)):
                    canonical_json(value)

    def test_stable_id_changes_with_occurrence(self):
        first = stable_id("unit", SOURCE_VERSION, "Part 5/Chapter 49", "p1:0-10", 1)
        second = stable_id("unit", SOURCE_VERSION, "Part 5/Chapter 49", "p1:0-10", 2)

        self.assertNotEqual(first, second)

    def test_stable_id_is_accepted_as_record_identity(self):
        record = valid_record()

        validated = validate_record(record)

        self.assertIs(validated, record)
        self.assertEqual(
            record["unit_id"],
            stable_id(
                "unit",
                SOURCE_VERSION,
                "Book/Part 5/Chapter 49",
                "source_page_index:19;block:b19-0",
                1,
            ),
        )

    def test_write_json_returns_file_hash_and_writes_utf8_without_bom(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "record.json"
            expected = '{"a":1,"z":"é"}\n'.encode("utf-8")

            digest = write_json(path, {"z": "é", "a": 1})

            self.assertEqual(path.read_bytes(), expected)
            self.assertEqual(digest, hashlib.sha256(expected).hexdigest())
            self.assertFalse(path.read_bytes().startswith(b"\xef\xbb\xbf"))

    def test_write_jsonl_returns_file_hash_and_round_trips_object_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.jsonl"
            records = [{"b": 2, "a": 1}, {"d": 4, "c": 3}]
            expected = b'{"a":1,"b":2}\n{"c":3,"d":4}\n'

            digest = write_jsonl(path, records)

            self.assertEqual(path.read_bytes(), expected)
            self.assertEqual(digest, hashlib.sha256(expected).hexdigest())
            self.assertEqual(read_jsonl(path), records)
            self.assertFalse(path.read_bytes().startswith(b"\xef\xbb\xbf"))

    def test_read_jsonl_rejects_malformed_json(self):
        malformed_rows = (b'{"a":1\n', b'{"a":NaN}\n')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.jsonl"
            for payload in malformed_rows:
                with self.subTest(payload=payload):
                    path.write_bytes(payload)
                    with self.assertRaises(ValueError):
                        read_jsonl(path)

    def test_read_jsonl_rejects_non_object_rows(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "records.jsonl"
            path.write_text("[]\n", encoding="utf-8")

            with self.assertRaises(ValueError):
                read_jsonl(path)

    def test_validate_record_accepts_approved_enum_vocabularies(self):
        vocabularies = {
            "mapping_status": (
                "certain",
                "inferred",
                "uncertain",
                "missing",
                "not_applicable",
            ),
            "validation_status": ("auto_ok", "needs_review", "blocked", "approved"),
            "content_type": CONTENT_TYPES,
            "printed_page_kind": (
                "front_matter",
                "body",
                "references",
                "author_index",
                "medication_index",
                "subject_index",
                "credits",
                "cover",
                "blank",
                "unknown",
            ),
            "xref_status": (
                "not_applicable",
                "resolved",
                "unresolved",
                "unresolved_external",
                "ambiguous",
            ),
        }

        for field, values in vocabularies.items():
            for value in values:
                with self.subTest(field=field, value=value):
                    record = valid_record()
                    record[field] = value
                    if field in ("mapping_status", "validation_status"):
                        record["provenance"][field] = value
                    self.assertIs(validate_record(record), record)

    def test_validate_record_rejects_values_outside_approved_enums(self):
        for field in (
            "mapping_status",
            "validation_status",
            "content_type",
            "printed_page_kind",
            "xref_status",
        ):
            with self.subTest(field=field):
                record = valid_record()
                record[field] = "legacy_value"
                with self.assertRaises(ValueError):
                    validate_record(record)

    def test_validate_record_enforces_page_index_and_display_ranges(self):
        invalid_fields = {
            "source_page_index": 826,
            "source_page_index_end": -1,
            "source_page_display": 0,
            "source_page_display_end": 827,
            "printed_page_number": 1084,
            "printed_page_label": 1084,
        }
        for field, value in invalid_fields.items():
            with self.subTest(field=field):
                record = valid_record()
                record[field] = value
                with self.assertRaises(ValueError):
                    validate_record(record)

        record = valid_record()
        record["source_page_display"] = 21
        with self.assertRaises(ValueError):
            validate_record(record)

    def test_validate_record_preserves_exact_nullable_printed_labels(self):
        for printed_page in (None, "I57"):
            with self.subTest(printed_page=printed_page):
                record = valid_record()
                record["printed_page_number"] = printed_page
                record["printed_page_number_end"] = printed_page
                record["printed_page_label"] = printed_page
                record["printed_page_label_end"] = printed_page
                self.assertIs(validate_record(record), record)

    def test_validate_record_rejects_legacy_page_fields(self):
        for field, value in (("source_page", 20), ("printed_page", 1084)):
            with self.subTest(field=field):
                record = valid_record()
                record[field] = value
                with self.assertRaises(ValueError):
                    validate_record(record)

    def test_validate_record_accepts_dual_text_mapping_and_provenance(self):
        record = valid_record()

        self.assertIs(validate_record(record), record)
        self.assertEqual(record["raw_sha256"], hashlib.sha256(record["raw_text"].encode("utf-8")).hexdigest())
        self.assertEqual(record["reading_text"], "Texte brut.")
        self.assertEqual(record["repair_references"], ["repair:pymupdf-pua:000001"])
        self.assertEqual(record["mapping_evidence"]["source_page_index"], 19)

    def test_validate_record_rejects_malformed_envelopes_and_nested_evidence(self):
        malformed = []
        missing = valid_record()
        del missing["source_version"]
        malformed.append(missing)
        extra = valid_record()
        extra["unexpected"] = True
        malformed.append(extra)
        evidence = valid_record()
        evidence["mapping_evidence"]["source_page"] = 20
        malformed.append(evidence)
        non_object = []

        for record in malformed:
            with self.subTest(record=record):
                with self.assertRaises(ValueError):
                    validate_record(record)
        with self.assertRaises(ValueError):
            validate_record(non_object)

    def test_validate_record_rejects_cross_envelope_status_mismatches(self):
        record = deepcopy(valid_record())
        record["validation_status"] = "needs_review"
        record["provenance"]["validation_status"] = "auto_ok"

        with self.assertRaises(ValueError):
            validate_record(record)


if __name__ == "__main__":
    unittest.main()
