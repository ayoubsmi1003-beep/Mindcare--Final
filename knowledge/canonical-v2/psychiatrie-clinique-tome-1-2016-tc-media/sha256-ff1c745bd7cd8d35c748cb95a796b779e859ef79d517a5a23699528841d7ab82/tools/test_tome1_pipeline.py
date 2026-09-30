import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

import tome1_pipeline
from tome1_pipeline import (
    canonical_json,
    read_jsonl,
    sha256_bytes,
    sha256_file,
    write_json,
    write_jsonl,
)


class FakePage:
    def __init__(self, text, blocks, error=None):
        self.text = text
        self.blocks = blocks
        self.error = error

    def get_text(self, kind, sort=False):
        if self.error is not None:
            raise self.error
        if sort is not False:
            raise AssertionError("raw extraction must preserve parser order")
        if kind == "text":
            return self.text
        if kind == "blocks":
            return self.blocks
        raise AssertionError(f"unexpected get_text kind: {kind}")


class FakeDocument:
    def __init__(self, pages):
        self.pages = pages
        self.page_count = len(pages)
        self.closed = False

    def __getitem__(self, page_index):
        return self.pages[page_index]

    def close(self):
        self.closed = True


class Tome1PipelineUtilityTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp_directory.name)
        self.file_path = self.directory / "source.txt"
        self.output_path = self.directory / "output.jsonl"

    def tearDown(self):
        self.temp_directory.cleanup()

    def test_canonical_json_sorts_keys(self):
        self.assertEqual(
            canonical_json({"b": 2, "a": 1}),
            '{"a":1,"b":2}',
        )

    def test_canonical_json_preserves_unicode(self):
        self.assertEqual(
            canonical_json({"b": "été", "a": "climat"}),
            '{"a":"climat","b":"été"}',
        )

    def test_sha256_file_matches_sha256_bytes(self):
        self.file_path.write_bytes(b"abc")
        self.assertEqual(sha256_file(self.file_path), sha256_bytes(self.file_path.read_bytes()))
        self.assertEqual(
            sha256_file(self.file_path),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        )

    def test_write_json_is_pretty_deterministic_utf8(self):
        write_json(self.output_path, {"b": "été", "a": 1})
        self.assertEqual(
            self.output_path.read_text(encoding="utf-8"),
            '{\n  "a": 1,\n  "b": "été"\n}\n',
        )

    def test_read_jsonl_parses_non_empty_lines(self):
        self.output_path.write_text(
            '\n{"b": 2, "a": 1}\n  \n{"a": 2}\n',
            encoding="utf-8",
        )
        self.assertEqual(
            read_jsonl(self.output_path),
            [{"a": 1, "b": 2}, {"a": 2}],
        )

    def test_write_jsonl_is_deterministic(self):
        write_jsonl(self.output_path, [{"b": 2, "a": 1}])
        self.assertEqual(self.output_path.read_text(encoding="utf-8"), '{"a": 1, "b": 2}\n')


class Tome1PipelineRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp_directory.name)
        self.source = self.directory / "source.pdf"
        self.source.write_bytes(b"source bytes")
        self.output = self.directory / "output"
        self.sha256 = sha256_bytes(self.source.read_bytes())
        self.patchers = [
            patch.object(tome1_pipeline, "verify_qpdf"),
            patch.object(tome1_pipeline, "CANONICAL_SOURCE_SHA256", self.sha256, create=True),
            patch.object(
                tome1_pipeline,
                "CANONICAL_SOURCE_BYTE_SIZE",
                self.source.stat().st_size,
                create=True,
            ),
            patch.object(tome1_pipeline, "CANONICAL_PDF_PAGE_COUNT", 1, create=True),
            patch.object(tome1_pipeline, "CANONICAL_SOURCE_PATH", self.source.name, create=True),
        ]
        for patcher in self.patchers:
            patcher.start()
        self.addCleanup(self.temp_directory.cleanup)
        for patcher in reversed(self.patchers):
            self.addCleanup(patcher.stop)

    def tearDown(self):
        self.temp_directory.cleanup()

    def _write_registration_artifacts(self, source_lock=None, checkpoint=None):
        self.output.mkdir()
        if source_lock is not None:
            write_json(self.output / "source-lock.json", source_lock)
        write_json(self.output / "run-manifest.json", {"sentinel": "manifest"})
        write_json(self.output / "book.json", {"sentinel": "book"})
        checkpoints = self.output / "checkpoints"
        checkpoints.mkdir()
        write_json(
            checkpoints / "register.json",
            checkpoint if checkpoint is not None else {"sentinel": "checkpoint"},
        )

    def _output_snapshot(self):
        return {
            path.relative_to(self.output).as_posix(): path.read_bytes()
            for path in self.output.rglob("*")
            if path.is_file()
        }

    def test_register_writes_source_lock_run_manifest_and_book(self):
        with patch.object(tome1_pipeline, "verify_qpdf", create=True), patch.object(
            tome1_pipeline,
            "load_pdf",
            create=True,
            return_value=SimpleNamespace(page_count=1),
        ):
            result = tome1_pipeline.register_source(self.source, self.output, self.sha256, 1)
        self.assertEqual(result["pdf_page_count"], 1)
        self.assertTrue((self.output / "source-lock.json").exists())
        self.assertTrue((self.output / "run-manifest.json").exists())
        self.assertTrue((self.output / "book.json").exists())

    def test_register_stops_on_hash_mismatch(self):
        with patch.object(tome1_pipeline, "verify_qpdf", create=True), patch.object(
            tome1_pipeline,
            "load_pdf",
            create=True,
            return_value=SimpleNamespace(page_count=1),
        ):
            with self.assertRaises(ValueError):
                tome1_pipeline.register_source(self.source, self.output, "0" * 64, 1)

    def test_source_lock_contains_no_parser_fields(self):
        with patch.object(tome1_pipeline, "verify_qpdf", create=True), patch.object(
            tome1_pipeline,
            "load_pdf",
            create=True,
            return_value=SimpleNamespace(page_count=1),
        ):
            tome1_pipeline.register_source(self.source, self.output, self.sha256, 1)
        lock = json.loads((self.output / "source-lock.json").read_text(encoding="utf-8"))
        self.assertNotIn("parser_version", lock)
        self.assertNotIn("repair_version", lock)

    def test_register_rejects_mismatched_existing_source_lock_without_overwrite(self):
        source_lock = {
            "source_id": tome1_pipeline.BOOK_ID,
            "sha256": "0" * 64,
            "byte_size": self.source.stat().st_size,
            "pdf_page_count": 1,
            "source_path": self.source.as_posix(),
            "source_identifier": self.source.as_posix(),
            "lock_version": "1",
        }
        self._write_registration_artifacts(
            source_lock,
            {"status": "completed", "sentinel": "checkpoint"},
        )
        before = self._output_snapshot()
        with patch.object(tome1_pipeline, "verify_qpdf", create=True), patch.object(
            tome1_pipeline,
            "load_pdf",
            create=True,
            return_value=SimpleNamespace(page_count=1),
        ):
            with self.assertRaises(ValueError):
                tome1_pipeline.register_source(self.source, self.output, self.sha256, 1)
        self.assertEqual(before, self._output_snapshot())

    def test_register_rejects_identical_existing_source_lock_without_overwrite(self):
        with patch.object(tome1_pipeline, "verify_qpdf", create=True), patch.object(
            tome1_pipeline,
            "load_pdf",
            create=True,
            return_value=SimpleNamespace(page_count=1),
        ):
            tome1_pipeline.register_source(self.source, self.output, self.sha256, 1)
        before = self._output_snapshot()
        with patch.object(tome1_pipeline, "verify_qpdf", create=True), patch.object(
            tome1_pipeline,
            "load_pdf",
            create=True,
            return_value=SimpleNamespace(page_count=1),
        ):
            with self.assertRaises(RuntimeError):
                tome1_pipeline.register_source(self.source, self.output, self.sha256, 1)
        self.assertEqual(before, self._output_snapshot())

    def test_register_rejects_existing_completed_checkpoint_without_writing(self):
        self._write_registration_artifacts(
            checkpoint={"status": "completed", "sentinel": "checkpoint"}
        )
        before = self._output_snapshot()
        with patch.object(tome1_pipeline, "verify_qpdf", create=True), patch.object(
            tome1_pipeline,
            "load_pdf",
            create=True,
            return_value=SimpleNamespace(page_count=1),
        ):
            with self.assertRaises(RuntimeError):
                tome1_pipeline.register_source(self.source, self.output, self.sha256, 1)
        self.assertEqual(before, self._output_snapshot())
        self.assertFalse((self.output / "source-lock.json").exists())


class Tome1PipelineExtractionTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp_directory.name)
        self.source = self.directory / "source.pdf"
        self.source.write_bytes(b"source bytes")
        self.output = self.directory / "output"
        self.sha256 = sha256_bytes(self.source.read_bytes())
        self.patchers = [
            patch.object(tome1_pipeline, "verify_qpdf"),
            patch.object(tome1_pipeline, "CANONICAL_SOURCE_SHA256", self.sha256, create=True),
            patch.object(
                tome1_pipeline,
                "CANONICAL_SOURCE_BYTE_SIZE",
                self.source.stat().st_size,
                create=True,
            ),
            patch.object(tome1_pipeline, "CANONICAL_PDF_PAGE_COUNT", 2, create=True),
            patch.object(tome1_pipeline, "CANONICAL_SOURCE_PATH", self.source.name, create=True),
        ]
        for patcher in self.patchers:
            patcher.start()
        self.addCleanup(self.temp_directory.cleanup)
        for patcher in reversed(self.patchers):
            self.addCleanup(patcher.stop)
        with patch.object(tome1_pipeline, "verify_qpdf"), patch.object(
            tome1_pipeline,
            "load_pdf",
            return_value=SimpleNamespace(page_count=2),
        ):
            tome1_pipeline.register_source(self.source, self.output, self.sha256, 2)
        successful_blocks = [
            [10.0, 20.0, 30.0, 40.0, "First\n", 7, 0],
            [0.0, 5.0, 15.0, 25.0, " Second ", 9, 0],
        ]
        self.document = FakeDocument(
            [
                FakePage("  First\n unchanged  ", successful_blocks),
                FakePage("", [], ValueError("page two failed")),
            ]
        )

    def tearDown(self):
        self.temp_directory.cleanup()

    def test_extract_page_preserves_order_and_hashes(self):
        record = tome1_pipeline.extract_page(self.document, 0)
        self.assertEqual(
            record["page_id"],
            "psychiatrie-clinique-tome-1-2016-tc-media:page-0000",
        )
        self.assertEqual(record["source_page_index"], 0)
        self.assertEqual(record["source_page_display"], 1)
        self.assertEqual(record["raw_text"], "  First\n unchanged  ")
        self.assertEqual(record["extraction_status"], "extracted")
        self.assertEqual(
            record["parser"],
            {"name": "local-native-parser", "version": "local-native-parser-v1"},
        )
        self.assertEqual([block["order"] for block in record["blocks"]], [1, 2])
        self.assertEqual(
            [block["block_id"] for block in record["blocks"]],
            ["page-0000-block-0001", "page-0000-block-0002"],
        )
        self.assertEqual([block["text"] for block in record["blocks"]], ["First\n", " Second "])
        self.assertEqual(
            [block["bbox"] for block in record["blocks"]],
            [[10.0, 20.0, 30.0, 40.0], [0.0, 5.0, 15.0, 25.0]],
        )
        self.assertTrue(all(len(block["text_sha256"]) == 64 for block in record["blocks"]))
        self.assertEqual(len(record["raw_text_sha256"]), 64)
        self.assertEqual(len(record["coordinates_sha256"]), 64)
        self.assertEqual(len(record["block_sequence_sha256"]), 64)

    def test_extract_page_records_exact_failure(self):
        record = tome1_pipeline.extract_page(self.document, 1)
        self.assertEqual(
            record["page_id"],
            "psychiatrie-clinique-tome-1-2016-tc-media:page-0001",
        )
        self.assertEqual(record["source_page_index"], 1)
        self.assertEqual(record["source_page_display"], 2)
        self.assertEqual(record["extraction_status"], "failed")
        self.assertEqual(
            record["parser"],
            {"name": "local-native-parser", "version": "local-native-parser-v1"},
        )
        self.assertEqual(record["failure_detail"]["exception_class"], "ValueError")
        self.assertEqual(record["failure_detail"]["message"], "page two failed")

    def test_extract_raw_isolates_page_failure(self):
        with patch.object(tome1_pipeline, "load_pdf", return_value=self.document):
            summary = tome1_pipeline.extract_raw(self.source, self.output)
        self.assertEqual(summary["failed_pages"], 1)
        self.assertEqual(summary["extracted_pages"], 1)
        records = read_jsonl(self.output / "page-records.jsonl")
        self.assertEqual(
            [record["page_id"] for record in records],
            [
                "psychiatrie-clinique-tome-1-2016-tc-media:page-0000",
                "psychiatrie-clinique-tome-1-2016-tc-media:page-0001",
            ],
        )
        self.assertEqual(
            [record["raw_file"] for record in records],
            ["raw/page-0000.json", "raw/page-0001.json"],
        )
        self.assertEqual(records[0]["extraction_state"], "extracted")
        self.assertEqual(records[0]["processing_state"], "pending")
        self.assertEqual(records[0]["extraction_checkpoint_status"], "terminal")
        self.assertEqual(records[1]["extraction_state"], "failed")
        self.assertEqual(records[1]["processing_state"], "not_applicable")
        self.assertEqual(records[1]["extraction_checkpoint_status"], "terminal")
        self.assertEqual(records[1]["failure_detail"]["exception_class"], "ValueError")
        self.assertEqual(records[1]["failure_detail"]["message"], "page two failed")
        self.assertTrue((self.output / records[0]["raw_file"]).is_file())
        self.assertTrue((self.output / records[1]["raw_file"]).is_file())
        raw_records = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in (
                self.output / "raw" / "page-0000.json",
                self.output / "raw" / "page-0001.json",
            )
        ]
        self.assertEqual(
            raw_records[0]["parser"],
            {"name": "local-native-parser", "version": "local-native-parser-v1"},
        )
        self.assertEqual(
            raw_records[1]["parser"],
            {"name": "local-native-parser", "version": "local-native-parser-v1"},
        )

    def test_extract_raw_writes_one_terminal_checkpoint_per_page(self):
        with patch.object(tome1_pipeline, "load_pdf", return_value=self.document):
            tome1_pipeline.extract_raw(self.source, self.output)
        checkpoint_rows = read_jsonl(self.output / "checkpoints" / "extract-raw.jsonl")
        self.assertEqual(len(checkpoint_rows), 2)
        self.assertEqual(
            [row["page_id"] for row in checkpoint_rows],
            [
                "psychiatrie-clinique-tome-1-2016-tc-media:page-0000",
                "psychiatrie-clinique-tome-1-2016-tc-media:page-0001",
            ],
        )
        self.assertEqual(
            [row["extraction_state"] for row in checkpoint_rows],
            ["extracted", "failed"],
        )
        self.assertTrue(
            all(row["extraction_checkpoint_status"] == "terminal" for row in checkpoint_rows)
        )

    def test_extract_raw_never_overwrites_existing_checkpoint_file(self):
        checkpoint_path = self.output / "checkpoints" / "extract-raw.jsonl"
        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        checkpoint_path.write_text("sentinel\n", encoding="utf-8")
        with patch.object(tome1_pipeline, "load_pdf", return_value=self.document):
            with self.assertRaises(ValueError):
                tome1_pipeline.extract_raw(self.source, self.output)
        self.assertEqual(checkpoint_path.read_text(encoding="utf-8"), "sentinel\n")
        self.assertFalse(any((self.output / "raw").glob("page-*.json")))

    def test_extract_raw_resumes_without_overwriting_existing_raw_file(self):
        with patch.object(tome1_pipeline, "load_pdf", return_value=self.document):
            tome1_pipeline.extract_raw(self.source, self.output)
        raw_path = self.output / "raw" / "page-0000.json"
        self.assertTrue(raw_path.is_file())
        before = raw_path.read_bytes()
        summary_before = (self.output / "page-records.jsonl").read_bytes()
        with patch.object(tome1_pipeline, "load_pdf", return_value=self.document):
            summary = tome1_pipeline.extract_raw(self.source, self.output)
        self.assertEqual(summary["extracted_pages"], 1)
        self.assertEqual(raw_path.read_bytes(), before)
        self.assertEqual((self.output / "page-records.jsonl").read_bytes(), summary_before)

    def test_extract_raw_persists_each_page_before_next_page(self):
        original_append_jsonl = tome1_pipeline.append_jsonl

        def fail_first_page_record(path, row):
            if path.name == "page-records.jsonl":
                raise OSError("summary write failed")
            return original_append_jsonl(path, row)

        with patch.object(tome1_pipeline, "load_pdf", return_value=self.document), patch.object(
            tome1_pipeline,
            "append_jsonl",
            side_effect=fail_first_page_record,
        ):
            with self.assertRaises(OSError):
                tome1_pipeline.extract_raw(self.source, self.output)
        self.assertTrue((self.output / "raw" / "page-0000.json").is_file())
        self.assertFalse((self.output / "raw" / "page-0001.json").exists())
        self.assertFalse((self.output / "page-records.jsonl").exists())
        self.assertFalse((self.output / "checkpoints" / "extract-raw.jsonl").exists())

    def test_build_page_record_uses_raw_extraction_status(self):
        raw_record = {
            "page_id": "psychiatrie-clinique-tome-1-2016-tc-media:page-0002",
            "source_page_index": 2,
            "source_page_display": 3,
            "raw_text_sha256": "a" * 64,
            "coordinates_sha256": "b" * 64,
            "block_sequence_sha256": "c" * 64,
            "blocks": [
                {
                    "block_id": "page-0002-block-0001",
                    "order": 1,
                }
            ],
            "extraction_status": "failed",
            "failure_detail": {
                "exception_class": "ValueError",
                "message": "bad page",
            },
        }
        record = tome1_pipeline.build_page_record(
            2,
            raw_record,
            "raw/page-0002.json",
        )
        self.assertEqual(
            record["page_id"],
            "psychiatrie-clinique-tome-1-2016-tc-media:page-0002",
        )
        self.assertEqual(record["extraction_state"], "failed")
        self.assertEqual(record["processing_state"], "not_applicable")
        self.assertEqual(record["extraction_checkpoint_status"], "terminal")
        self.assertEqual(record["raw_file"], "raw/page-0002.json")
        self.assertEqual(record["block_count"], 1)
        self.assertEqual(record["failure_detail"]["message"], "bad page")


class Tome1PipelineVerificationTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp_directory.name)
        self.source = self.directory / "source.pdf"
        self.source.write_bytes(b"source bytes")
        self.output = self.directory / "output"
        self.sha256 = sha256_bytes(self.source.read_bytes())
        self.patchers = [
            patch.object(tome1_pipeline, "verify_qpdf"),
            patch.object(tome1_pipeline, "CANONICAL_SOURCE_SHA256", self.sha256, create=True),
            patch.object(
                tome1_pipeline,
                "CANONICAL_SOURCE_BYTE_SIZE",
                self.source.stat().st_size,
                create=True,
            ),
            patch.object(tome1_pipeline, "CANONICAL_PDF_PAGE_COUNT", 2, create=True),
            patch.object(tome1_pipeline, "CANONICAL_SOURCE_PATH", self.source.name, create=True),
        ]
        for patcher in self.patchers:
            patcher.start()
        self.addCleanup(self.temp_directory.cleanup)
        for patcher in reversed(self.patchers):
            self.addCleanup(patcher.stop)
        blocks = [[0.0, 1.0, 2.0, 3.0, "Page text", 0, 0]]
        self.document = FakeDocument(
            [FakePage("Page 0", blocks), FakePage("Page 1", blocks)]
        )

    def tearDown(self):
        self.temp_directory.cleanup()

    def _register(self):
        with patch.object(tome1_pipeline, "load_pdf", return_value=SimpleNamespace(page_count=2)):
            tome1_pipeline.register_source(self.source, self.output, self.sha256, 2)

    def _verify(self):
        with patch.object(tome1_pipeline, "load_pdf", return_value=self.document):
            return tome1_pipeline.verify_raw(self.output, self.sha256, 2)

    def write_valid_pages(self):
        self._register()
        raw_dir = self.output / "raw"
        raw_dir.mkdir()
        checkpoint_dir = self.output / "checkpoints"
        checkpoint_dir.mkdir(exist_ok=True)
        page_records = []
        checkpoint_rows = []
        blocks = [[0.0, 1.0, 2.0, 3.0, "Page text", 0, 0]]
        for page_index in range(2):
            raw_record = tome1_pipeline.extract_page(
                self.document,
                page_index,
            )
            raw_file = f"raw/page-{page_index:04d}.json"
            write_json(self.output / raw_file, raw_record)
            page_record = tome1_pipeline.build_page_record(
                page_index,
                raw_record,
                raw_file,
            )
            page_records.append(page_record)
            checkpoint_rows.append(
                {
                    "page_id": page_record["page_id"],
                    "source_page_index": page_record["source_page_index"],
                    "raw_file": page_record["raw_file"],
                    "extraction_state": page_record["extraction_state"],
                    "processing_state": page_record["processing_state"],
                    "extraction_checkpoint_status": "terminal",
                }
            )
        write_jsonl(self.output / "page-records.jsonl", page_records)
        write_jsonl(checkpoint_dir / "extract-raw.jsonl", checkpoint_rows)
        with patch.object(tome1_pipeline, "load_pdf", return_value=self.document):
            tome1_pipeline.extract_raw(self.source, self.output)

    def test_verify_raw_accepts_complete_output(self):
        self.write_valid_pages()
        result = self._verify()

        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["raw_page_count"], 2)

    def test_verify_raw_detects_tampered_raw_page(self):
        self.write_valid_pages()
        raw = self.output / "raw" / "page-0000.json"
        data = json.loads(raw.read_text(encoding="utf-8"))
        data["raw_text"] = data["raw_text"] + "tampered"
        raw.write_text(json.dumps(data), encoding="utf-8")
        with self.assertRaises(ValueError):
            self._verify()

    def test_verify_raw_requires_checkpoint_file(self):
        self.write_valid_pages()
        (self.output / "checkpoints" / "extract-raw.jsonl").unlink()
        with self.assertRaises(ValueError):
            self._verify()

    def test_verify_raw_rejects_non_final_extraction_state(self):
        self.write_valid_pages()
        raw = self.output / "raw" / "page-0000.json"
        raw_record = json.loads(raw.read_text(encoding="utf-8"))
        raw_record["extraction_status"] = "bogus"
        write_json(raw, raw_record)
        page_records = read_jsonl(self.output / "page-records.jsonl")
        page_records[0]["extraction_state"] = "bogus"
        write_jsonl(self.output / "page-records.jsonl", page_records)
        checkpoint_path = self.output / "checkpoints" / "extract-raw.jsonl"
        checkpoint_rows = read_jsonl(checkpoint_path)
        checkpoint_rows[0]["extraction_state"] = "bogus"
        write_jsonl(checkpoint_path, checkpoint_rows)
        with self.assertRaises(ValueError):
            self._verify()

    def test_verify_raw_requires_failed_page_failure_detail(self):
        self.write_valid_pages()
        raw = self.output / "raw" / "page-0000.json"
        raw_record = json.loads(raw.read_text(encoding="utf-8"))
        raw_record["extraction_status"] = "failed"
        raw_record.pop("failure_detail", None)
        write_json(raw, raw_record)
        page_records = read_jsonl(self.output / "page-records.jsonl")
        page_records[0]["extraction_state"] = "failed"
        page_records[0]["processing_state"] = "not_applicable"
        page_records[0].pop("failure_detail", None)
        write_jsonl(self.output / "page-records.jsonl", page_records)
        checkpoint_path = self.output / "checkpoints" / "extract-raw.jsonl"
        checkpoint_rows = read_jsonl(checkpoint_path)
        checkpoint_rows[0]["extraction_state"] = "failed"
        checkpoint_rows[0]["processing_state"] = "not_applicable"
        write_jsonl(checkpoint_path, checkpoint_rows)
        with self.assertRaises(ValueError):
            self._verify()


class Tome1FinalFixTests(unittest.TestCase):
    def setUp(self):
        self.temp_directory = tempfile.TemporaryDirectory()
        self.directory = Path(self.temp_directory.name)
        self.source = self.directory / "source.pdf"
        self.source.write_bytes(b"source bytes")
        self.sha256 = sha256_bytes(self.source.read_bytes())
        self.output = self.directory / "output"
        self.pages = 2
        self.patchers = [
            patch.object(
                tome1_pipeline,
                "CANONICAL_SOURCE_SHA256",
                self.sha256,
                create=True,
            ),
            patch.object(
                tome1_pipeline,
                "CANONICAL_SOURCE_BYTE_SIZE",
                self.source.stat().st_size,
                create=True,
            ),
            patch.object(
                tome1_pipeline,
                "CANONICAL_PDF_PAGE_COUNT",
                self.pages,
                create=True,
            ),
            patch.object(
                tome1_pipeline,
                "CANONICAL_SOURCE_PATH",
                self.source.name,
                create=True,
            ),
        ]
        for patcher in self.patchers:
            patcher.start()
        self.addCleanup(self.temp_directory.cleanup)
        for patcher in reversed(self.patchers):
            self.addCleanup(patcher.stop)
        self._register()

    def _document(self, texts=("page zero", "page one")):
        blocks = [
            [0.0, 1.0, 2.0, 3.0, text, 0, 0]
            for text in texts
        ]
        return FakeDocument(
            [FakePage(text, blocks) for text in texts]
        )

    def _register(self):
        with patch.object(tome1_pipeline, "verify_qpdf"), patch.object(
            tome1_pipeline,
            "load_pdf",
            return_value=SimpleNamespace(page_count=self.pages),
        ):
            tome1_pipeline.register_source(
                self.source,
                self.output,
                self.sha256,
                self.pages,
            )

    def _extract(self, document=None):
        with patch.object(tome1_pipeline, "verify_qpdf"), patch.object(
            tome1_pipeline,
            "load_pdf",
            return_value=document or self._document(),
        ):
            return tome1_pipeline.extract_raw(self.source, self.output)

    def _verify(self, document=None):
        with patch.object(tome1_pipeline, "verify_qpdf"), patch.object(
            tome1_pipeline,
            "load_pdf",
            return_value=document or self._document(),
        ):
            return tome1_pipeline.verify_raw(self.output, self.sha256, self.pages)

    def test_register_rejects_noncanonical_caller_identity(self):
        output = self.directory / "other-output"
        with patch.object(tome1_pipeline, "verify_qpdf"), patch.object(
            tome1_pipeline,
            "load_pdf",
            return_value=SimpleNamespace(page_count=self.pages),
        ):
            with self.assertRaises(ValueError):
                tome1_pipeline.register_source(self.source, output, "0" * 64, self.pages)
        self.assertFalse((output / "source-lock.json").exists())

    def test_extract_raw_blocks_without_source_lock(self):
        (self.output / "source-lock.json").unlink()
        with self.assertRaises(ValueError):
            self._extract()
        self.assertFalse((self.output / "raw").exists())

    def test_extract_raw_finalizes_manifest_with_output_hashes(self):
        manifest_path = self.output / "run-manifest.json"
        stale_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        stale_manifest["code_revision"] = "book-local-tool"
        write_json(manifest_path, stale_manifest)
        summary = self._extract()
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(summary["extracted_pages"], 2)
        self.assertEqual(manifest["run_status"], "raw_extraction_completed")
        self.assertEqual(manifest["code_revision"], tome1_pipeline.CODE_REVISION)
        self.assertEqual(manifest["processed_page_count"], 2)
        self.assertEqual(manifest["failed_page_count"], 0)
        self.assertIsNotNone(manifest["completed_at"])
        self.assertIn("page-records.jsonl", manifest["output_hashes"])
        self.assertIn("checkpoints/extract-raw.jsonl", manifest["output_hashes"])
        self.assertIn("raw/page-0000.json", manifest["output_hashes"])

    def test_extract_raw_resumes_after_page_failure_without_duplicate_rows(self):
        original_write_json_exclusive = tome1_pipeline.write_json_exclusive
        failed_once = False

        def fail_on_second_raw(path, value):
            nonlocal failed_once
            if path.name == "page-0001.json" and not failed_once:
                failed_once = True
                raise OSError("simulated page publication failure")
            return original_write_json_exclusive(path, value)

        with patch.object(tome1_pipeline, "write_json_exclusive", side_effect=fail_on_second_raw):
            with self.assertRaises(OSError):
                self._extract()
        manifest_after_failure = json.loads(
            (self.output / "run-manifest.json").read_text(encoding="utf-8")
        )
        self.assertEqual(manifest_after_failure["run_status"], "raw_extraction_in_progress")
        summary = self._extract()
        self.assertEqual(summary["extracted_pages"], 2)
        records = read_jsonl(self.output / "page-records.jsonl")
        checkpoints = read_jsonl(self.output / "checkpoints" / "extract-raw.jsonl")
        self.assertEqual(len(records), 2)
        self.assertEqual(len(checkpoints), 2)
        self.assertEqual([record["source_page_index"] for record in records], [0, 1])
        self.assertEqual([row["source_page_index"] for row in checkpoints], [0, 1])

    def test_extract_raw_reuses_isolated_existing_raw_page(self):
        raw_dir = self.output / "raw"
        raw_dir.mkdir()
        page_record = tome1_pipeline.extract_page(self._document(), 0)
        write_json(raw_dir / "page-0000.json", page_record)
        summary = self._extract()
        self.assertEqual(summary["extracted_pages"], 2)
        self.assertEqual(len(read_jsonl(self.output / "page-records.jsonl")), 2)

    def test_extract_raw_blocks_wrong_supplied_source(self):
        wrong_source = self.directory / "wrong.pdf"
        wrong_source.write_bytes(b"wrong source")
        with patch.object(tome1_pipeline, "verify_qpdf"), patch.object(
            tome1_pipeline,
            "load_pdf",
            return_value=self._document(),
        ):
            with self.assertRaises(ValueError):
                tome1_pipeline.extract_raw(wrong_source, self.output)
        self.assertFalse((self.output / "raw").exists())

    def test_extract_raw_recovers_torn_jsonl_suffix(self):
        self._extract()
        records_path = self.output / "page-records.jsonl"
        checkpoint_path = self.output / "checkpoints" / "extract-raw.jsonl"
        records_path.write_bytes(records_path.read_bytes() + b'{"source_page_index": 2')
        checkpoint_path.write_bytes(checkpoint_path.read_bytes() + b'{"source_page_index": 2')
        summary = self._extract()
        self.assertEqual(summary["extracted_pages"], 2)
        self.assertEqual(len(read_jsonl(records_path)), 2)
        self.assertEqual(len(read_jsonl(checkpoint_path)), 2)

    def test_extract_raw_blocks_duplicate_existing_record_rows(self):
        self._extract()
        records_path = self.output / "page-records.jsonl"
        records = read_jsonl(records_path)
        write_jsonl(records_path, records + [records[0]])
        with self.assertRaises(ValueError):
            self._extract()

    def test_verify_raw_requires_all_registration_artifacts(self):
        self._extract()
        (self.output / "book.json").unlink()
        with self.assertRaises(ValueError):
            self._verify()

    def test_verify_raw_rejects_forbidden_downstream_outputs(self):
        self._extract()
        (self.output / "repairs.jsonl").write_text("{}\n", encoding="utf-8")
        with self.assertRaises(ValueError):
            self._verify()

    def test_verify_raw_blocks_records_extracted_from_wrong_source(self):
        self._extract()
        with self.assertRaises(ValueError):
            self._verify(self._document(("other zero", "other one")))

    def test_registration_failure_rolls_back_new_artifacts(self):
        output = self.directory / "rollback-output"
        original_write_json = tome1_pipeline.write_json
        original_write_json_exclusive = tome1_pipeline.write_json_exclusive

        def fail_on_book(path, value):
            if path.name == "book.json":
                raise OSError("simulated registration publication failure")
            return original_write_json(path, value)

        def fail_on_book_exclusive(path, value):
            if path.name == "book.json":
                raise OSError("simulated registration publication failure")
            return original_write_json_exclusive(path, value)

        with patch.object(tome1_pipeline, "verify_qpdf"), patch.object(
            tome1_pipeline,
            "load_pdf",
            return_value=SimpleNamespace(page_count=self.pages),
        ), patch.object(
            tome1_pipeline,
            "write_json",
            side_effect=fail_on_book,
        ), patch.object(
            tome1_pipeline,
            "write_json_exclusive",
            side_effect=fail_on_book_exclusive,
        ):
            with self.assertRaises(OSError):
                tome1_pipeline.register_source(
                    self.source,
                    output,
                    self.sha256,
                    self.pages,
                )
        self.assertFalse((output / "source-lock.json").exists())
        self.assertFalse((output / "run-manifest.json").exists())
        self.assertFalse((output / "book.json").exists())
        self.assertFalse((output / "checkpoints" / "register.json").exists())


if __name__ == "__main__":
    unittest.main()
