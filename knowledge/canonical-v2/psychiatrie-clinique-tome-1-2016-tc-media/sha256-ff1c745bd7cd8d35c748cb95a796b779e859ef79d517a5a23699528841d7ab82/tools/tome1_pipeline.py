from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pymupdf import Document


BOOK_ID = "psychiatrie-clinique-tome-1-2016-tc-media"
CANONICAL_SOURCE_SHA256 = "ff1c745bd7cd8d35c748cb95a796b779e859ef79d517a5a23699528841d7ab82"
CANONICAL_SOURCE_BYTE_SIZE = 30603439
CANONICAL_PDF_PAGE_COUNT = 1220
CANONICAL_SOURCE_PATH = "Books/dokumen.pub_psychiatrie-clinique-approche-bio-psycho-sociale-tome-1-.pdf"
SOURCE_PATH_BASE = "repository_root"
EXTRACTION_VERSION = "canonical-v2.1-tome1"
PARSER_VERSION = "local-native-parser-v1"
REPAIR_VERSION = "reading-repair-v1"
MAPPING_VERSION = "piecewise-page-map-v1"
SCHEMA_VERSION = "canonical-v2.1"
PACKAGE_VERSION = "v1"
CODE_REVISION = "uncommitted-book-local-tool"
FINAL_RAW_EXTRACTION_STATES = frozenset({"extracted", "failed"})
REGISTRATION_ARTIFACTS = (
    "source-lock.json",
    "run-manifest.json",
    "book.json",
    "checkpoints/register.json",
)
FORBIDDEN_OUTPUT_NAMES = frozenset(
    {
        "reading",
        "repairs.jsonl",
        "pages.map.json",
        "structure.json",
        "units.jsonl",
        "assertions.jsonl",
        "concepts.jsonl",
        "relations.jsonl",
        "tables.jsonl",
        "figures.jsonl",
        "algorithms.jsonl",
        "medications.jsonl",
        "xrefs.jsonl",
        "qa-report.json",
        "review-queue.json",
        "content-manifest.json",
        "governance",
        "chunks",
        "embeddings",
        "retrieval",
        "database",
    }
)
FORBIDDEN_OUTPUT_MARKERS = ("chunk", "embedding", "retrieval", "database")


def canonical_json(value: object) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _pretty_json(value: object) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        indent=2,
        sort_keys=True,
    )
    return f"{payload}\n"


def write_json(path: Path, value: object) -> None:
    path.write_bytes(_pretty_json(value).encode("utf-8"))


def read_jsonl(path: Path) -> list[dict]:
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def write_jsonl(path: Path, rows: list[dict]) -> None:
    payload = "".join(
        f"{json.dumps(row, ensure_ascii=False, sort_keys=True)}\n"
        for row in rows
    )
    path.write_bytes(payload.encode("utf-8"))


def _fsync_directory(path: Path) -> None:
    try:
        descriptor = os.open(str(path), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def write_json_exclusive(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary_path.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(_pretty_json(value))
            handle.flush()
            os.fsync(handle.fileno())
        try:
            os.link(temporary_path, path)
        except FileExistsError as error:
            raise RuntimeError(f"refusing to overwrite existing artifact: {path}") from error
        _fsync_directory(path.parent)
    finally:
        temporary_path.unlink(missing_ok=True)


def write_json_atomic(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        with temporary_path.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(_pretty_json(value))
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, path)
        _fsync_directory(path.parent)
    finally:
        temporary_path.unlink(missing_ok=True)


def append_jsonl(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as handle:
        handle.write(f"{json.dumps(row, ensure_ascii=False, sort_keys=True)}\n")
        handle.flush()
        os.fsync(handle.fileno())
    _fsync_directory(path.parent)


def _read_resumable_jsonl(path: Path, label: str) -> list[dict]:
    if not path.exists():
        return []
    payload = path.read_bytes()
    last_newline = payload.rfind(b"\n")
    trailing = payload[last_newline + 1 :]
    if trailing.strip():
        with path.open("r+b") as handle:
            handle.truncate(last_newline + 1 if last_newline >= 0 else 0)
            handle.flush()
            os.fsync(handle.fileno())
        payload = payload[: last_newline + 1] if last_newline >= 0 else b""
    try:
        return [
            json.loads(line)
            for line in payload.decode("utf-8").splitlines()
            if line.strip()
        ]
    except (UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is unreadable: {path}") from error


def _index_prefix_rows(rows: list[dict], label: str, expected_pages: int) -> dict[int, dict]:
    by_index: dict[int, dict] = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError(f"{label} contains a non-object row")
        page_index = row.get("source_page_index")
        if not isinstance(page_index, int) or page_index < 0 or page_index >= expected_pages:
            raise ValueError(f"{label} contains an invalid source page index: {page_index}")
        if page_index in by_index:
            raise ValueError(f"{label} contains a duplicate source page index: {page_index}")
        if page_index != len(by_index):
            raise ValueError(f"{label} is not a contiguous prefix at page {page_index}")
        by_index[page_index] = row
    return by_index


def _read_prefix_rows(path: Path, label: str, expected_pages: int) -> dict[int, dict]:
    if not path.exists():
        return {}
    try:
        rows = read_jsonl(path)
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is unreadable: {path}") from error
    return _index_prefix_rows(rows, label, expected_pages)


def _read_resumable_prefix_rows(path: Path, label: str, expected_pages: int) -> dict[int, dict]:
    if not path.exists():
        return {}
    return _index_prefix_rows(_read_resumable_jsonl(path, label), label, expected_pages)


def verify_qpdf(source_path: Path) -> None:
    try:
        subprocess.run(
            ["qpdf", "--check", str(source_path)],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as error:
        detail = (error.stderr or error.stdout or "").strip()
        message = f"qpdf --check failed for {source_path}"
        if detail:
            message = f"{message}: {detail}"
        raise RuntimeError(message) from error
    except OSError as error:
        raise RuntimeError(f"qpdf --check could not run for {source_path}: {error}") from error


def load_pdf(source_path: Path) -> Document:
    try:
        import pymupdf as fitz
    except ImportError:
        try:
            import fitz
        except ImportError as error:
            raise RuntimeError("PyMuPDF is required to load the source PDF") from error
    return fitz.open(str(source_path))


def _repository_root(output_dir: Path) -> Path:
    for candidate in (output_dir, *output_dir.parents):
        if (candidate / "Books").is_dir() and (candidate / "context").is_dir():
            return candidate
    return output_dir.parent


def _resolve_source_path(source_identifier: str, output_dir: Path, source_path_base: str | None) -> Path:
    source_path = Path(source_identifier)
    if source_path.is_absolute():
        return source_path.resolve()
    if source_path_base not in (None, SOURCE_PATH_BASE):
        raise ValueError(f"unsupported source path base: {source_path_base}")
    return (_repository_root(output_dir) / source_path).resolve()


def _canonical_source_path(output_dir: Path) -> Path:
    return (_repository_root(output_dir) / CANONICAL_SOURCE_PATH).resolve()


def _validate_expected_identity(expected_sha256: str, expected_pages: int) -> None:
    if expected_sha256 != CANONICAL_SOURCE_SHA256:
        raise ValueError(
            f"expected SHA-256 must be the canonical Tome 1 source: {CANONICAL_SOURCE_SHA256}"
        )
    if expected_pages != CANONICAL_PDF_PAGE_COUNT:
        raise ValueError(
            f"expected page count must be the canonical Tome 1 page count: {CANONICAL_PDF_PAGE_COUNT}"
        )


def _read_verification_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{label} is unreadable: {path}") from error
    if not isinstance(value, dict):
        raise ValueError(f"{label} is not an object: {path}")
    return value


def _has_structured_failure_detail(value: object) -> bool:
    return (
        isinstance(value, dict)
        and isinstance(value.get("exception_class"), str)
        and bool(value["exception_class"].strip())
        and isinstance(value.get("message"), str)
        and bool(value["message"].strip())
    )


def _validate_source_lock(
    output_dir: Path,
    expected_sha256: str,
    expected_pages: int,
) -> tuple[dict, Path]:
    _validate_expected_identity(expected_sha256, expected_pages)
    source_lock_path = output_dir / "source-lock.json"
    if not source_lock_path.is_file():
        raise ValueError(f"source lock is missing: {source_lock_path}")
    source_lock = _read_verification_json(source_lock_path, "source lock")
    required_identity = {
        "source_id": BOOK_ID,
        "sha256": CANONICAL_SOURCE_SHA256,
        "byte_size": CANONICAL_SOURCE_BYTE_SIZE,
        "pdf_page_count": CANONICAL_PDF_PAGE_COUNT,
        "source_path": CANONICAL_SOURCE_PATH,
        "source_identifier": CANONICAL_SOURCE_PATH,
        "lock_version": "1",
    }
    mismatches = [
        field
        for field, expected_value in required_identity.items()
        if source_lock.get(field) != expected_value
    ]
    if source_lock.get("source_path_base") not in (None, SOURCE_PATH_BASE):
        mismatches.append("source_path_base")
    if mismatches:
        raise ValueError(f"source lock identity mismatch in fields: {', '.join(mismatches)}")
    source_path = _resolve_source_path(
        source_lock["source_identifier"],
        output_dir,
        source_lock.get("source_path_base"),
    )
    if not source_path.is_file():
        raise ValueError(f"source PDF referenced by source lock does not exist: {source_path}")
    if source_path.stat().st_size != CANONICAL_SOURCE_BYTE_SIZE:
        raise ValueError("source PDF byte size does not match the canonical Tome 1 source")
    if sha256_file(source_path) != CANONICAL_SOURCE_SHA256:
        raise ValueError("source PDF SHA-256 does not match the canonical Tome 1 source")
    return source_lock, source_path


def _validate_registration_artifacts(
    output_dir: Path,
    expected_sha256: str,
    expected_pages: int,
) -> tuple[dict, dict, dict, dict, Path]:
    source_lock, source_path = _validate_source_lock(output_dir, expected_sha256, expected_pages)
    run_manifest_path = output_dir / "run-manifest.json"
    book_path = output_dir / "book.json"
    register_checkpoint_path = output_dir / "checkpoints" / "register.json"
    for path, label in (
        (run_manifest_path, "run manifest"),
        (book_path, "book metadata"),
        (register_checkpoint_path, "registration checkpoint"),
    ):
        if not path.is_file():
            raise ValueError(f"{label} is missing: {path}")
    run_manifest = _read_verification_json(run_manifest_path, "run manifest")
    book = _read_verification_json(book_path, "book metadata")
    register_checkpoint = _read_verification_json(register_checkpoint_path, "registration checkpoint")
    run_identity_fields = {
        "source_id": BOOK_ID,
        "source_sha256": CANONICAL_SOURCE_SHA256,
        "book_id": BOOK_ID,
        "page_count": CANONICAL_PDF_PAGE_COUNT,
    }
    for field, expected_value in run_identity_fields.items():
        if run_manifest.get(field) != expected_value:
            raise ValueError(f"run manifest {field} does not match the canonical source")
    book_identity_fields = {
        "source_id": BOOK_ID,
        "source_sha256": CANONICAL_SOURCE_SHA256,
        "book_id": BOOK_ID,
        "pdf_page_count": CANONICAL_PDF_PAGE_COUNT,
    }
    for field, expected_value in book_identity_fields.items():
        if book.get(field) != expected_value:
            raise ValueError(f"book metadata {field} does not match the canonical source")
    if register_checkpoint.get("status") != "completed":
        raise ValueError("registration checkpoint is not completed")
    for field, expected_value in (
        ("source_id", BOOK_ID),
        ("source_sha256", CANONICAL_SOURCE_SHA256),
        ("pdf_page_count", CANONICAL_PDF_PAGE_COUNT),
    ):
        if register_checkpoint.get(field) != expected_value:
            raise ValueError(f"registration checkpoint {field} does not match the canonical source")
    return source_lock, run_manifest, book, register_checkpoint, source_path


def _load_source_document(source_path: Path, expected_pages: int) -> Document:
    verify_qpdf(source_path)
    document = load_pdf(source_path)
    if document.page_count != expected_pages:
        page_count = document.page_count
        close = getattr(document, "close", None)
        if callable(close):
            close()
        raise ValueError(f"source page count mismatch: expected {expected_pages}, got {page_count}")
    return document


def _page_id(page_index: int) -> str:
    return f"{BOOK_ID}:page-{page_index:04d}"


def _raw_page_filename(page_index: int) -> Path:
    return Path("raw") / f"page-{page_index:04d}.json"


def _sha256_json(value: object) -> str:
    return sha256_bytes(canonical_json(value).encode("utf-8"))


def extract_page(document: Document, page_index: int) -> dict:
    try:
        page = document[page_index]
        raw_text = page.get_text("text", sort=False)
        returned_blocks = page.get_text("blocks", sort=False)
        blocks = []
        for order, block in enumerate(returned_blocks, start=1):
            text = block[4] if len(block) > 4 else ""
            blocks.append(
                {
                    "block_id": f"page-{page_index:04d}-block-{order:04d}",
                    "order": order,
                    "text": text,
                    "text_sha256": sha256_bytes(text.encode("utf-8")),
                    "bbox": list(block[:4]),
                }
            )
        coordinates = [
            {"order": block["order"], "bbox": block["bbox"]}
            for block in blocks
        ]
        sequence = [
            {
                "order": block["order"],
                "text_sha256": block["text_sha256"],
            }
            for block in blocks
        ]
        return {
            "page_id": _page_id(page_index),
            "source_page_index": page_index,
            "source_page_display": page_index + 1,
            "raw_text": raw_text,
            "raw_text_sha256": sha256_bytes(raw_text.encode("utf-8")),
            "coordinates_sha256": _sha256_json(coordinates),
            "block_sequence_sha256": _sha256_json(sequence),
            "blocks": blocks,
            "parser": {
                "name": "local-native-parser",
                "version": PARSER_VERSION,
            },
            "extraction_status": "extracted",
        }
    except Exception as error:
        return {
            "page_id": _page_id(page_index),
            "source_page_index": page_index,
            "source_page_display": page_index + 1,
            "raw_text": "",
            "raw_text_sha256": sha256_bytes(b""),
            "coordinates_sha256": _sha256_json([]),
            "block_sequence_sha256": _sha256_json([]),
            "blocks": [],
            "parser": {
                "name": "local-native-parser",
                "version": PARSER_VERSION,
            },
            "extraction_status": "failed",
            "failure_detail": {
                "exception_class": type(error).__name__,
                "message": str(error),
            },
        }


def build_page_record(page_index: int, raw_record: dict, raw_file: str) -> dict:
    extraction_status = raw_record["extraction_status"]
    if extraction_status not in FINAL_RAW_EXTRACTION_STATES:
        raise ValueError(f"unsupported extraction status: {extraction_status}")
    failed = extraction_status == "failed"
    return {
        "page_id": raw_record["page_id"],
        "source_page_index": page_index,
        "source_page_display": page_index + 1,
        "raw_file": raw_file,
        "raw_text_sha256": raw_record["raw_text_sha256"],
        "coordinates_sha256": raw_record["coordinates_sha256"],
        "block_sequence_sha256": raw_record["block_sequence_sha256"],
        "block_count": len(raw_record["blocks"]),
        "extraction_state": extraction_status,
        "processing_state": "not_applicable" if failed else "pending",
        "extraction_checkpoint_status": "terminal",
        "failure_detail": raw_record.get("failure_detail"),
    }


def _raw_record_errors(raw_record: object, page_index: int) -> list[str]:
    errors: list[str] = []
    if not isinstance(raw_record, dict):
        return [f"raw page {page_index} is not an object"]
    expected_fields = {
        "page_id": _page_id(page_index),
        "source_page_index": page_index,
        "source_page_display": page_index + 1,
    }
    for field, expected_value in expected_fields.items():
        if raw_record.get(field) != expected_value:
            errors.append(f"raw page {page_index} has invalid {field}")
    status = raw_record.get("extraction_status")
    if status not in FINAL_RAW_EXTRACTION_STATES:
        errors.append(f"raw page {page_index} has invalid extraction_state {status}")
    parser = raw_record.get("parser")
    if parser != {"name": "local-native-parser", "version": PARSER_VERSION}:
        errors.append(f"raw page {page_index} has an invalid parser identity")
    raw_text = raw_record.get("raw_text")
    blocks = raw_record.get("blocks")
    if not isinstance(raw_text, str) or not isinstance(blocks, list):
        errors.append(f"raw page {page_index} has invalid raw text or blocks")
        return errors
    coordinates = []
    sequence = []
    for block_order, block in enumerate(blocks, start=1):
        if not isinstance(block, dict):
            errors.append(f"raw page {page_index} contains a non-object block")
            continue
        block_text = block.get("text")
        bbox = block.get("bbox")
        if not isinstance(block_text, str):
            errors.append(f"raw page {page_index} contains a block without text")
            continue
        if not isinstance(bbox, list) or len(bbox) != 4:
            errors.append(f"raw page {page_index} contains an invalid block bounding box")
        if block.get("order") != block_order:
            errors.append(f"raw page {page_index} block order mismatch at position {block_order}")
        expected_block_id = f"page-{page_index:04d}-block-{block_order:04d}"
        if block.get("block_id") != expected_block_id:
            errors.append(f"raw page {page_index} has an invalid block_id")
        block_text_sha256 = sha256_bytes(block_text.encode("utf-8"))
        if block.get("text_sha256") != block_text_sha256:
            errors.append(f"raw page {page_index} block {block_order} text hash mismatch")
        coordinates.append({"order": block.get("order"), "bbox": bbox})
        sequence.append(
            {
                "order": block.get("order"),
                "text_sha256": block.get("text_sha256"),
            }
        )
    recomputed = {
        "raw_text_sha256": sha256_bytes(raw_text.encode("utf-8")),
        "coordinates_sha256": _sha256_json(coordinates),
        "block_sequence_sha256": _sha256_json(sequence),
    }
    for field, expected_value in recomputed.items():
        if raw_record.get(field) != expected_value:
            errors.append(f"raw page {page_index} {field} mismatch")
    if status == "failed" and not _has_structured_failure_detail(raw_record.get("failure_detail")):
        errors.append(f"raw page {page_index} failed page requires structured failure_detail")
    if status == "extracted" and raw_record.get("failure_detail") is not None:
        errors.append(f"raw page {page_index} extracted page must not contain failure_detail")
    return errors


def _validate_raw_record(raw_record: object, page_index: int) -> None:
    errors = _raw_record_errors(raw_record, page_index)
    if errors:
        raise ValueError("; ".join(errors))


def _validate_page_record(record: dict, raw_record: dict, page_index: int) -> None:
    expected_raw_file = _raw_page_filename(page_index).as_posix()
    expected = build_page_record(page_index, raw_record, expected_raw_file)
    if record != expected:
        errors = [
            f"page {page_index} record field {field} does not match its raw record"
            for field in expected
            if record.get(field) != expected.get(field)
        ]
        if not errors:
            errors.append(f"page {page_index} record contains unexpected fields")
        raise ValueError("; ".join(errors))


def _checkpoint_from_page_record(page_record: dict) -> dict:
    return {
        "page_id": page_record["page_id"],
        "source_page_index": page_record["source_page_index"],
        "raw_file": page_record["raw_file"],
        "extraction_state": page_record["extraction_state"],
        "processing_state": page_record["processing_state"],
        "extraction_checkpoint_status": "terminal",
    }


def _validate_checkpoint(checkpoint: dict, page_record: dict) -> None:
    if checkpoint != _checkpoint_from_page_record(page_record):
        raise ValueError(
            f"checkpoint for page {page_record.get('source_page_index')} does not match page record"
        )


def _read_raw_record(path: Path, page_index: int) -> dict:
    if not path.is_file():
        raise ValueError(f"raw page file is missing: {path}")
    raw_record = _read_verification_json(path, f"raw page {page_index}")
    _validate_raw_record(raw_record, page_index)
    return raw_record


def _output_paths(output_dir: Path, page_count: int) -> list[Path]:
    paths = [output_dir / "page-records.jsonl", output_dir / "checkpoints" / "extract-raw.jsonl"]
    paths.extend(output_dir / _raw_page_filename(page_index) for page_index in range(page_count))
    return paths


def _output_hashes(output_dir: Path, page_count: int) -> dict[str, str]:
    return {
        path.relative_to(output_dir).as_posix(): sha256_file(path)
        for path in _output_paths(output_dir, page_count)
    }


def _forbidden_outputs(output_dir: Path) -> list[str]:
    forbidden: list[str] = []
    for path in output_dir.rglob("*"):
        relative_parts = path.relative_to(output_dir).parts
        if any(part in FORBIDDEN_OUTPUT_NAMES for part in relative_parts):
            forbidden.append(path.relative_to(output_dir).as_posix())
        elif any(
            marker in path.name.lower()
            for marker in FORBIDDEN_OUTPUT_MARKERS
        ):
            forbidden.append(path.relative_to(output_dir).as_posix())
    return sorted(set(forbidden))


def _update_manifest_in_progress(
    manifest: dict,
    processed_page_count: int,
    failed_page_count: int,
) -> None:
    manifest.update(
        {
            "completed_at": None,
            "processed_page_count": processed_page_count,
            "failed_page_count": failed_page_count,
            "run_status": "raw_extraction_in_progress",
            "failure": None,
            "output_hashes": {},
        }
    )
    write_json_atomic(Path(manifest["_manifest_path"]), {key: value for key, value in manifest.items() if key != "_manifest_path"})


def _manifest_counts(records: dict[int, dict]) -> tuple[int, int]:
    failed = sum(record.get("extraction_state") == "failed" for record in records.values())
    return len(records), failed


def extract_raw(source_path: Path, output_dir: Path) -> dict:
    source_lock, run_manifest, _book, _register_checkpoint, locked_source_path = _validate_registration_artifacts(
        output_dir,
        CANONICAL_SOURCE_SHA256,
        CANONICAL_PDF_PAGE_COUNT,
    )
    if source_path.resolve() != locked_source_path.resolve():
        raise ValueError("supplied source PDF is not the PDF locked for this package")
    document = _load_source_document(source_path, CANONICAL_PDF_PAGE_COUNT)
    try:
        page_records_path = output_dir / "page-records.jsonl"
        checkpoint_path = output_dir / "checkpoints" / "extract-raw.jsonl"
        raw_dir = output_dir / "raw"
        output_dir.mkdir(parents=True, exist_ok=True)
        raw_dir.mkdir(parents=True, exist_ok=True)
        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        records = _read_resumable_prefix_rows(
            page_records_path,
            "page records",
            CANONICAL_PDF_PAGE_COUNT,
        )
        checkpoints = _read_resumable_prefix_rows(
            checkpoint_path,
            "raw extraction checkpoints",
            CANONICAL_PDF_PAGE_COUNT,
        )
        manifest = dict(run_manifest)
        manifest["code_revision"] = CODE_REVISION
        manifest["_manifest_path"] = (output_dir / "run-manifest.json").as_posix()
        _update_manifest_in_progress(manifest, *_manifest_counts(records))
        for page_index in range(CANONICAL_PDF_PAGE_COUNT):
            raw_path = output_dir / _raw_page_filename(page_index)
            page_record = records.get(page_index)
            checkpoint = checkpoints.get(page_index)
            if page_record is not None:
                raw_record = _read_raw_record(raw_path, page_index)
                _validate_page_record(page_record, raw_record, page_index)
                if checkpoint is None:
                    append_jsonl(checkpoint_path, _checkpoint_from_page_record(page_record))
                    checkpoints[page_index] = _checkpoint_from_page_record(page_record)
                else:
                    _validate_checkpoint(checkpoint, page_record)
                continue
            if checkpoint is not None:
                raw_record = _read_raw_record(raw_path, page_index)
                expected_record = build_page_record(page_index, raw_record, raw_path.relative_to(output_dir).as_posix())
                _validate_checkpoint(checkpoint, expected_record)
                append_jsonl(page_records_path, expected_record)
                records[page_index] = expected_record
                continue
            raw_record = extract_page(document, page_index)
            if raw_path.exists():
                existing_raw_record = _read_raw_record(raw_path, page_index)
                if canonical_json(existing_raw_record) != canonical_json(raw_record):
                    raise ValueError(f"existing raw page {page_index} is not the same source extraction")
            else:
                write_json_exclusive(raw_path, raw_record)
            page_record = build_page_record(page_index, raw_record, raw_path.relative_to(output_dir).as_posix())
            append_jsonl(page_records_path, page_record)
            records[page_index] = page_record
            checkpoint = _checkpoint_from_page_record(page_record)
            append_jsonl(checkpoint_path, checkpoint)
            checkpoints[page_index] = checkpoint
            processed_page_count, failed_page_count = _manifest_counts(records)
            _update_manifest_in_progress(
                manifest,
                processed_page_count,
                failed_page_count,
            )
        if set(records) != set(range(CANONICAL_PDF_PAGE_COUNT)):
            raise ValueError("page records do not cover the canonical page range")
        if set(checkpoints) != set(range(CANONICAL_PDF_PAGE_COUNT)):
            raise ValueError("raw extraction checkpoints do not cover the canonical page range")
        raw_file_names = {
            path.name
            for path in raw_dir.glob("page-*.json")
            if path.is_file()
        }
        expected_raw_file_names = {
            f"page-{page_index:04d}.json"
            for page_index in range(CANONICAL_PDF_PAGE_COUNT)
        }
        if raw_file_names != expected_raw_file_names:
            raise ValueError("raw page files do not match the canonical page range")
        processed_page_count, failed_page_count = _manifest_counts(records)
        output_hashes = _output_hashes(output_dir, CANONICAL_PDF_PAGE_COUNT)
        manifest = {
            key: value
            for key, value in manifest.items()
            if key != "_manifest_path"
        }
        manifest.update(
            {
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "processed_page_count": processed_page_count,
                "failed_page_count": failed_page_count,
                "run_status": "raw_extraction_completed",
                "failure": None,
                "output_hashes": output_hashes,
            }
        )
        write_json_atomic(output_dir / "run-manifest.json", manifest)
        return {
            "source_path": source_lock["source_identifier"],
            "page_count": CANONICAL_PDF_PAGE_COUNT,
            "extracted_pages": processed_page_count - failed_page_count,
            "failed_pages": failed_page_count,
            "page_records_file": page_records_path.name,
        }
    finally:
        close = getattr(document, "close", None)
        if callable(close):
            close()


def _validate_complete_manifest(
    run_manifest: dict,
    output_dir: Path,
    expected_pages: int,
) -> None:
    if run_manifest.get("run_status") != "raw_extraction_completed":
        raise ValueError("run manifest is not finalized as raw_extraction_completed")
    if run_manifest.get("processed_page_count") != expected_pages:
        raise ValueError("run manifest processed page count does not match the raw output")
    if not isinstance(run_manifest.get("failed_page_count"), int):
        raise ValueError("run manifest failed page count is missing")
    completed_at = run_manifest.get("completed_at")
    if not isinstance(completed_at, str) or not completed_at:
        raise ValueError("run manifest completion timestamp is missing")
    try:
        datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
    except ValueError as error:
        raise ValueError("run manifest completion timestamp is invalid") from error
    output_hashes = run_manifest.get("output_hashes")
    if not isinstance(output_hashes, dict):
        raise ValueError("run manifest output hashes are missing")
    expected_hashes = _output_hashes(output_dir, expected_pages)
    if output_hashes != expected_hashes:
        raise ValueError("run manifest deterministic output hashes do not match the package")


def verify_raw(output_dir: Path, expected_sha256: str, expected_pages: int) -> dict:
    _validate_expected_identity(expected_sha256, expected_pages)
    source_lock, run_manifest, _book, _register_checkpoint, source_path = _validate_registration_artifacts(
        output_dir,
        expected_sha256,
        expected_pages,
    )
    forbidden = _forbidden_outputs(output_dir)
    if forbidden:
        raise ValueError(f"forbidden downstream outputs exist: {', '.join(forbidden)}")
    if not (output_dir / "raw").is_dir():
        raise ValueError(f"raw output directory is missing: {output_dir / 'raw'}")
    if not (output_dir / "page-records.jsonl").is_file():
        raise ValueError(f"page records are missing: {output_dir / 'page-records.jsonl'}")
    if not (output_dir / "checkpoints" / "extract-raw.jsonl").is_file():
        raise ValueError(
            f"raw extraction checkpoints are missing: {output_dir / 'checkpoints' / 'extract-raw.jsonl'}"
        )
    _validate_complete_manifest(run_manifest, output_dir, expected_pages)
    raw_dir = output_dir / "raw"
    if not raw_dir.is_dir():
        raise ValueError(f"raw output directory is missing: {raw_dir}")
    raw_paths = {
        path.name: path
        for path in raw_dir.glob("page-*.json")
        if path.is_file()
    }
    expected_raw_names = {
        f"page-{page_index:04d}.json" for page_index in range(expected_pages)
    }
    if set(raw_paths) != expected_raw_names:
        missing = sorted(expected_raw_names - set(raw_paths))
        unexpected = sorted(set(raw_paths) - expected_raw_names)
        raise ValueError(
            "raw page file count or names mismatch: "
            f"expected {expected_pages}, missing {missing}, unexpected {unexpected}"
        )
    page_records_path = output_dir / "page-records.jsonl"
    checkpoint_path = output_dir / "checkpoints" / "extract-raw.jsonl"
    if not page_records_path.is_file():
        raise ValueError(f"page records are missing: {page_records_path}")
    if not checkpoint_path.is_file():
        raise ValueError(f"raw extraction checkpoints are missing: {checkpoint_path}")
    records = _read_prefix_rows(page_records_path, "page records", expected_pages)
    checkpoints = _read_prefix_rows(
        checkpoint_path,
        "raw extraction checkpoints",
        expected_pages,
    )
    document = _load_source_document(source_path, expected_pages)
    errors: list[str] = []
    hash_mismatches: list[str] = []
    failed_pages = 0
    try:
        if set(records) != set(range(expected_pages)):
            raise ValueError("page record indices do not match the canonical page range")
        if set(checkpoints) != set(range(expected_pages)):
            raise ValueError("checkpoint indices do not match the canonical page range")
        for page_index in range(expected_pages):
            page_record = records[page_index]
            raw_path = output_dir / _raw_page_filename(page_index)
            raw_record = _read_raw_record(raw_path, page_index)
            try:
                _validate_page_record(page_record, raw_record, page_index)
            except ValueError as error:
                errors.append(str(error))
            checkpoint = checkpoints[page_index]
            try:
                _validate_checkpoint(checkpoint, page_record)
            except ValueError as error:
                errors.append(str(error))
            expected_raw_record = extract_page(document, page_index)
            if canonical_json(expected_raw_record) != canonical_json(raw_record):
                errors.append(f"raw page {page_index} does not match the locked PDF extraction")
            if page_record.get("extraction_state") == "failed":
                failed_pages += 1
        expected_hashes = _output_hashes(output_dir, expected_pages)
        if run_manifest.get("failed_page_count") != failed_pages:
            errors.append("run manifest failed page count does not match page records")
        if run_manifest.get("output_hashes") != expected_hashes:
            errors.append("run manifest output hashes do not match raw outputs")
        for page_index in range(expected_pages):
            for field in ("raw_text_sha256", "coordinates_sha256", "block_sequence_sha256"):
                if records[page_index].get(field) != _read_raw_record(
                    output_dir / _raw_page_filename(page_index), page_index
                ).get(field):
                    hash_mismatches.append(f"raw/page-{page_index:04d}.json:{field}")
    finally:
        close = getattr(document, "close", None)
        if callable(close):
            close()
    if errors or hash_mismatches:
        details = "; ".join(errors)
        if hash_mismatches:
            details = f"{details}; hash mismatches: {', '.join(hash_mismatches)}"
        raise ValueError(f"raw verification BLOCKED: {details}")
    return {
        "status": "PASS",
        "raw_page_count": expected_pages,
        "record_count": len(records),
        "failed_pages": failed_pages,
        "hash_mismatches": hash_mismatches,
    }


def _publish_registration_artifacts(output_dir: Path, artifacts: list[tuple[Path, dict]]) -> None:
    created: list[Path] = []
    try:
        for path, value in artifacts:
            write_json_exclusive(path, value)
            created.append(path)
    except Exception:
        for path in reversed(created):
            path.unlink(missing_ok=True)
        raise


def register_source(
    source_path: Path,
    output_dir: Path,
    expected_sha256: str,
    expected_pages: int,
) -> dict:
    _validate_expected_identity(expected_sha256, expected_pages)
    if not source_path.is_file():
        raise FileNotFoundError(f"source PDF does not exist: {source_path}")
    resolved_source_path = source_path.resolve()
    canonical_source_path = _canonical_source_path(output_dir)
    if resolved_source_path != canonical_source_path:
        raise ValueError("source PDF is not the canonical Tome 1 source path")
    source_sha256 = sha256_file(source_path)
    if source_sha256 != CANONICAL_SOURCE_SHA256:
        raise ValueError(
            f"source SHA-256 mismatch: expected {CANONICAL_SOURCE_SHA256}, got {source_sha256}"
        )
    byte_size = source_path.stat().st_size
    if byte_size != CANONICAL_SOURCE_BYTE_SIZE:
        raise ValueError(
            f"source byte size mismatch: expected {CANONICAL_SOURCE_BYTE_SIZE}, got {byte_size}"
        )
    verify_qpdf(source_path)
    document = load_pdf(source_path)
    try:
        pdf_page_count = document.page_count
    finally:
        close = getattr(document, "close", None)
        if callable(close):
            close()
    if pdf_page_count != CANONICAL_PDF_PAGE_COUNT:
        raise ValueError(
            f"source page count mismatch: expected {CANONICAL_PDF_PAGE_COUNT}, got {pdf_page_count}"
        )
    source_lock_path = output_dir / "source-lock.json"
    if source_lock_path.exists():
        existing_lock = _read_verification_json(source_lock_path, "source lock")
        identity = {
            "source_id": BOOK_ID,
            "sha256": CANONICAL_SOURCE_SHA256,
            "byte_size": CANONICAL_SOURCE_BYTE_SIZE,
            "pdf_page_count": CANONICAL_PDF_PAGE_COUNT,
            "source_path": CANONICAL_SOURCE_PATH,
            "source_identifier": CANONICAL_SOURCE_PATH,
        }
        mismatches = [
            field
            for field, expected_value in identity.items()
            if existing_lock.get(field) != expected_value
        ]
        if mismatches:
            raise ValueError(
                f"existing source lock mismatch in fields: {', '.join(mismatches)}"
            )
        raise RuntimeError(
            "registration output is already registered; refusing to overwrite source lock"
        )
    existing_artifact_paths = tuple(output_dir / name for name in REGISTRATION_ARTIFACTS[1:])
    existing_artifacts = [path for path in existing_artifact_paths if path.exists()]
    if existing_artifacts:
        artifact_names = ", ".join(path.relative_to(output_dir).as_posix() for path in existing_artifacts)
        raise RuntimeError(
            f"registration output already contains metadata artifacts: {artifact_names}"
        )
    registered_at = datetime.now(timezone.utc).isoformat()
    source_lock = {
        "source_id": BOOK_ID,
        "sha256": CANONICAL_SOURCE_SHA256,
        "byte_size": CANONICAL_SOURCE_BYTE_SIZE,
        "pdf_page_count": CANONICAL_PDF_PAGE_COUNT,
        "source_path": CANONICAL_SOURCE_PATH,
        "source_identifier": CANONICAL_SOURCE_PATH,
        "source_path_base": SOURCE_PATH_BASE,
        "locked_at": registered_at,
        "lock_version": "1",
    }
    run_recipe = {
        "source_sha256": CANONICAL_SOURCE_SHA256,
        "extraction_version": EXTRACTION_VERSION,
        "parser_version": PARSER_VERSION,
        "repair_version": REPAIR_VERSION,
        "mapping_version": MAPPING_VERSION,
        "schema_version": SCHEMA_VERSION,
    }
    run_manifest = {
        "run_key": sha256_bytes(canonical_json(run_recipe).encode("utf-8")),
        "run_id": uuid.uuid4().hex,
        "source_id": BOOK_ID,
        "source_sha256": CANONICAL_SOURCE_SHA256,
        "book_id": BOOK_ID,
        "package_version": PACKAGE_VERSION,
        "parser_version": PARSER_VERSION,
        "extraction_version": EXTRACTION_VERSION,
        "repair_version": REPAIR_VERSION,
        "mapping_version": MAPPING_VERSION,
        "schema_version": SCHEMA_VERSION,
        "code_revision": CODE_REVISION,
        "started_at": registered_at,
        "completed_at": None,
        "page_count": CANONICAL_PDF_PAGE_COUNT,
        "processed_page_count": 0,
        "failed_page_count": 0,
        "run_status": "registered",
        "stop_phase": "TOME1-001",
        "failure": None,
        "output_hashes": {},
    }
    book = {
        "book_id": BOOK_ID,
        "title": "Psychiatrie clinique — Approche bio-psycho-sociale",
        "volume": "Tome 1",
        "edition": "4e édition",
        "year": 2016,
        "language": "fr",
        "source_id": BOOK_ID,
        "source_sha256": CANONICAL_SOURCE_SHA256,
        "pdf_page_count": CANONICAL_PDF_PAGE_COUNT,
        "metadata_status": "partial",
        "unverified_fields": {
            "authors": None,
            "publisher": None,
            "isbn": None,
        },
    }
    checkpoint = {
        "status": "completed",
        "source_id": BOOK_ID,
        "source_sha256": CANONICAL_SOURCE_SHA256,
        "pdf_page_count": CANONICAL_PDF_PAGE_COUNT,
        "completed_at": registered_at,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "checkpoints").mkdir(parents=True, exist_ok=True)
    _publish_registration_artifacts(
        output_dir,
        [
            (source_lock_path, source_lock),
            (output_dir / "run-manifest.json", run_manifest),
            (output_dir / "book.json", book),
            (output_dir / "checkpoints" / "register.json", checkpoint),
        ],
    )
    return {
        **source_lock,
        "output_dir": output_dir.as_posix(),
        "run_id": run_manifest["run_id"],
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    register_parser = subparsers.add_parser("register")
    register_parser.add_argument("--source", type=Path, required=True)
    register_parser.add_argument("--output", type=Path, required=True)
    register_parser.add_argument("--expected-sha256", required=True)
    register_parser.add_argument("--expected-pages", type=int, required=True)

    extract_parser = subparsers.add_parser("extract-raw")
    extract_parser.add_argument("--source", type=Path, required=True)
    extract_parser.add_argument("--output", type=Path, required=True)

    verify_parser = subparsers.add_parser("verify-raw")
    verify_parser.add_argument("--output", type=Path, required=True)
    verify_parser.add_argument("--expected-sha256", required=True)
    verify_parser.add_argument("--expected-pages", type=int, required=True)

    args = parser.parse_args(argv)
    if args.command == "register":
        result = register_source(
            args.source,
            args.output,
            args.expected_sha256,
            args.expected_pages,
        )
        print(canonical_json(result))
        return 0
    if args.command == "extract-raw":
        result = extract_raw(args.source, args.output)
        print(canonical_json(result))
        return 0
    if args.command == "verify-raw":
        try:
            result = verify_raw(
                args.output,
                args.expected_sha256,
                args.expected_pages,
            )
        except (FileNotFoundError, RuntimeError, ValueError) as error:
            print(
                canonical_json(
                    {
                        "status": "BLOCKED",
                        "raw_page_count": 0,
                        "record_count": 0,
                        "failed_pages": 0,
                        "hash_mismatches": [],
                        "error": str(error),
                    }
                )
            )
            return 1
        print(canonical_json(result))
        return 0 if result.get("status") == "PASS" else 1
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
