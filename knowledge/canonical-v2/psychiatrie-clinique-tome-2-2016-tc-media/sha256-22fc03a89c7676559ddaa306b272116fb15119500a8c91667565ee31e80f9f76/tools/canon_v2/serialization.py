import hashlib
import json
import math
import re
from collections.abc import Iterable
from pathlib import Path

from .constants import (
    BOOK_ID,
    INGESTION_VERSION,
    LANGUAGE,
    SOURCE_PAGE_COUNT,
    SOURCE_VERSION,
)

SOURCE_PAGE_INDEX_MIN = 0
SOURCE_PAGE_INDEX_MAX = SOURCE_PAGE_COUNT - 1
SOURCE_PAGE_DISPLAY_MIN = 1
SOURCE_PAGE_DISPLAY_MAX = SOURCE_PAGE_COUNT

MAPPING_STATUS = frozenset(
    {"certain", "inferred", "uncertain", "missing", "not_applicable"}
)
VALIDATION_STATUS = frozenset({"auto_ok", "needs_review", "blocked", "approved"})
PRINTED_PAGE_KIND = frozenset(
    {
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
    }
)
XREF_STATUS = frozenset(
    {
        "not_applicable",
        "resolved",
        "unresolved",
        "unresolved_external",
        "ambiguous",
    }
)
CONTENT_TYPES = frozenset(
    {
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
    }
)

_ID_PATTERN = re.compile(r"^[a-z_]+:[0-9a-f]{64}$")
_HEX64_PATTERN = re.compile(r"^[0-9a-f]{64}$")

ALLOWED_TOP_FIELDS = frozenset(
    {
        "schema_version",
        "book_id",
        "source_version",
        "ingestion_version",
        "language",
        "record_id",
        "unit_id",
        "kind",
        "structural_path",
        "source_span",
        "occurrence",
        "content_type",
        "title",
        "parent_id",
        "preceding_context_id",
        "following_context_id",
        "semantic_type",
        "confidence",
        "extraction_status",
        "source_page_index",
        "source_page_index_end",
        "source_page_display",
        "source_page_display_end",
        "printed_page_number",
        "printed_page_number_end",
        "printed_page_label",
        "printed_page_label_end",
        "printed_page_kind",
        "mapping_status",
        "mapping_anchor",
        "mapping_evidence",
        "raw_text",
        "raw_sha256",
        "reading_text",
        "repair_references",
        "source_page_index_start",
        "source_page_display_start",
        "printed_page_start",
        "printed_page_end",
        "mapping_status_start",
        "mapping_status_end",
        "source_block_references",
        "xref_status",
        "xref_targets",
        "validation_status",
        "provenance",
        "data",
    }
)

REQUIRED_TOP_FIELDS = frozenset(
    {
        "schema_version",
        "book_id",
        "source_version",
        "ingestion_version",
        "language",
        "kind",
        "structural_path",
        "source_span",
        "source_page_index",
        "source_page_index_end",
        "source_page_display",
        "source_page_display_end",
        "printed_page_kind",
        "mapping_status",
        "xref_status",
        "validation_status",
        "provenance",
    }
)

ALLOWED_EVIDENCE_FIELDS = frozenset(
    {"source_page_index", "text_span", "extraction_version", "observed_label"}
)
REQUIRED_EVIDENCE_FIELDS = frozenset(
    {"source_page_index", "text_span", "extraction_version"}
)

ALLOWED_PROVENANCE_FIELDS = frozenset(
    {
        "book_id",
        "source_version",
        "ingestion_version",
        "extractor",
        "extractor_version",
        "source_page_indices",
        "structural_path",
        "source_span",
        "host_record_id",
        "raw_passage_reference",
        "repair_references",
        "extraction_status",
        "mapping_status",
        "validation_status",
    }
)
REQUIRED_PROVENANCE_FIELDS = frozenset(
    {
        "book_id",
        "source_version",
        "ingestion_version",
        "extractor",
        "extractor_version",
        "source_page_indices",
        "structural_path",
        "source_span",
        "host_record_id",
        "raw_passage_reference",
        "repair_references",
        "extraction_status",
        "mapping_status",
        "validation_status",
    }
)


def _ensure_jsonable(value: object) -> None:
    if value is None:
        return
    if isinstance(value, bool):
        return
    if isinstance(value, int):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"Non-finite float is not valid JSON: {value!r}")
        return
    if isinstance(value, str):
        return
    if isinstance(value, list):
        for item in value:
            _ensure_jsonable(item)
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise TypeError(f"JSON object keys must be strings: {key!r}")
            _ensure_jsonable(item)
        return
    raise TypeError(f"Value is not JSON-serializable: {type(value).__name__}")


def canonical_json(value: object) -> str:
    _ensure_jsonable(value)
    return (
        json.dumps(
            value,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
            allow_nan=False,
        )
        + "\n"
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def stable_id(
    kind: str,
    source_version: str,
    structural_path: str,
    source_span: str,
    occurrence: int,
) -> str:
    fields = {
        "kind": kind,
        "source_version": source_version,
        "structural_path": structural_path,
        "source_span": source_span,
        "occurrence": occurrence,
    }
    return f"{kind}:{sha256_bytes(canonical_json(fields).encode('utf-8'))}"


def write_json(path: Path, value: object) -> str:
    payload = canonical_json(value).encode("utf-8")
    path.write_bytes(payload)
    return sha256_bytes(payload)


def write_json_atomic(path: Path, value: object) -> str:
    payload = canonical_json(value).encode("utf-8")
    temporary_path = path.with_name(path.name + ".tmp")
    try:
        temporary_path.write_bytes(payload)
        temporary_path.replace(path)
    finally:
        if temporary_path.exists():
            temporary_path.unlink()
    return sha256_bytes(payload)


def write_jsonl(path: Path, records: Iterable[dict]) -> str:
    lines = []
    for record in records:
        if not isinstance(record, dict):
            raise ValueError("JSONL rows must be objects")
        lines.append(canonical_json(record))
    payload = "".join(lines).encode("utf-8")
    path.write_bytes(payload)
    return sha256_bytes(payload)


def read_jsonl(path: Path) -> list[dict]:
    records = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            try:
                record = json.loads(line, parse_constant=_reject_json_constant)
            except ValueError as error:
                raise ValueError(f"Malformed JSONL at line {line_number}") from error
            if not isinstance(record, dict):
                raise ValueError(f"JSONL row {line_number} must be an object")
            records.append(record)
    return records


def _reject_json_constant(value: str) -> None:
    raise ValueError(f"Invalid JSON constant: {value}")


def _is_plain_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _check_non_empty_str(value: object, field: str) -> str:
    if not isinstance(value, str) or len(value) < 1:
        raise ValueError(f"{field} must be a non-empty string")
    return value


def _check_nullable_non_empty_str(value: object, field: str) -> None:
    if value is None:
        return
    if not isinstance(value, str) or len(value) < 1:
        raise ValueError(f"{field} must be null or a non-empty string")


def _check_id(value: object, field: str) -> None:
    if not isinstance(value, str) or not _ID_PATTERN.match(value):
        raise ValueError(f"{field} must match kind:sha256hex")


def _check_string_list(value: object, field: str) -> None:
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list of strings")
    seen = set()
    for item in value:
        if not isinstance(item, str) or len(item) < 1:
            raise ValueError(f"{field} items must be non-empty strings")
        if item in seen:
            raise ValueError(f"{field} items must be unique")
        seen.add(item)


def _check_bbox(value: object, field: str) -> None:
    if not isinstance(value, list) or len(value) != 4:
        raise ValueError(f"{field} must contain four numbers")
    if any(isinstance(item, bool) or not isinstance(item, (int, float)) for item in value):
        raise ValueError(f"{field} must contain four numbers")


def _check_source_block_references(value: object) -> None:
    if not isinstance(value, list):
        raise ValueError("source_block_references must be a list")
    for position, reference in enumerate(value):
        field = f"source_block_references[{position}]"
        if not isinstance(reference, dict):
            raise ValueError(field + " must be an object")
        block_index = reference.get("block_index")
        if isinstance(block_index, bool) or not isinstance(block_index, int) or block_index < 0:
            raise ValueError(field + ".block_index must be an integer >= 0")
        if "bbox" in reference:
            _check_bbox(reference["bbox"], field + ".bbox")
        text_hash = reference.get("text_sha256")
        if text_hash is not None and (not isinstance(text_hash, str) or not _HEX64_PATTERN.match(text_hash)):
            raise ValueError(field + ".text_sha256 must be lowercase hex sha256")


def _check_page_index(value: object, field: str) -> int:
    if not _is_plain_int(value):
        raise ValueError(f"{field} must be an integer")
    if not (SOURCE_PAGE_INDEX_MIN <= value <= SOURCE_PAGE_INDEX_MAX):
        raise ValueError(
            f"{field} must be in {SOURCE_PAGE_INDEX_MIN}..{SOURCE_PAGE_INDEX_MAX}"
        )
    return value


def _check_page_display(value: object, field: str) -> int:
    if not _is_plain_int(value):
        raise ValueError(f"{field} must be an integer")
    if not (SOURCE_PAGE_DISPLAY_MIN <= value <= SOURCE_PAGE_DISPLAY_MAX):
        raise ValueError(
            f"{field} must be in {SOURCE_PAGE_DISPLAY_MIN}..{SOURCE_PAGE_DISPLAY_MAX}"
        )
    return value


def _validate_mapping_evidence(value: object) -> None:
    if not isinstance(value, dict):
        raise ValueError("mapping_evidence must be an object")
    for key in value:
        if key not in ALLOWED_EVIDENCE_FIELDS:
            raise ValueError(f"mapping_evidence has unexpected field: {key}")
    for key in REQUIRED_EVIDENCE_FIELDS:
        if key not in value:
            raise ValueError(f"mapping_evidence missing required field: {key}")
    _check_page_index(value["source_page_index"], "mapping_evidence.source_page_index")
    _check_non_empty_str(value["text_span"], "mapping_evidence.text_span")
    _check_non_empty_str(
        value["extraction_version"], "mapping_evidence.extraction_version"
    )
    if "observed_label" in value:
        _check_nullable_non_empty_str(
            value["observed_label"], "mapping_evidence.observed_label"
        )


def _validate_provenance(value: object) -> dict:
    if not isinstance(value, dict):
        raise ValueError("provenance must be an object")
    for key in value:
        if key not in ALLOWED_PROVENANCE_FIELDS:
            raise ValueError(f"provenance has unexpected field: {key}")
    for key in REQUIRED_PROVENANCE_FIELDS:
        if key not in value:
            raise ValueError(f"provenance missing required field: {key}")
    if value["book_id"] != BOOK_ID:
        raise ValueError("provenance.book_id mismatch")
    if value["source_version"] != SOURCE_VERSION:
        raise ValueError("provenance.source_version mismatch")
    if value["ingestion_version"] != INGESTION_VERSION:
        raise ValueError("provenance.ingestion_version mismatch")
    _check_non_empty_str(value["extractor"], "provenance.extractor")
    _check_non_empty_str(
        value["extractor_version"], "provenance.extractor_version"
    )
    indices = value["source_page_indices"]
    if not isinstance(indices, list) or len(indices) < 1:
        raise ValueError("provenance.source_page_indices must be a non-empty list")
    seen = set()
    for item in indices:
        _check_page_index(item, "provenance.source_page_indices[]")
        if item in seen:
            raise ValueError("provenance.source_page_indices must be unique")
        seen.add(item)
    _check_non_empty_str(value["structural_path"], "provenance.structural_path")
    _check_non_empty_str(value["source_span"], "provenance.source_span")
    _check_nullable_non_empty_str(
        value["host_record_id"], "provenance.host_record_id"
    )
    _check_nullable_non_empty_str(
        value["raw_passage_reference"], "provenance.raw_passage_reference"
    )
    _check_string_list(value["repair_references"], "provenance.repair_references")
    _check_non_empty_str(
        value["extraction_status"], "provenance.extraction_status"
    )
    if value["mapping_status"] not in MAPPING_STATUS:
        raise ValueError("provenance.mapping_status outside closed vocabulary")
    if value["validation_status"] not in VALIDATION_STATUS:
        raise ValueError("provenance.validation_status outside closed vocabulary")
    return value


def validate_record(record: dict) -> dict:
    if not isinstance(record, dict):
        raise ValueError("record must be an object")
    for key in record:
        if key not in ALLOWED_TOP_FIELDS:
            raise ValueError(f"unexpected field: {key}")
    for key in REQUIRED_TOP_FIELDS:
        if key not in record:
            raise ValueError(f"missing required field: {key}")
    if "record_id" not in record and "unit_id" not in record:
        raise ValueError("record must contain record_id or unit_id")
    if record["schema_version"] != INGESTION_VERSION:
        raise ValueError("schema_version mismatch")
    if record["book_id"] != BOOK_ID:
        raise ValueError("book_id mismatch")
    if record["source_version"] != SOURCE_VERSION:
        raise ValueError("source_version mismatch")
    if record["ingestion_version"] != INGESTION_VERSION:
        raise ValueError("ingestion_version mismatch")
    if record["language"] != LANGUAGE:
        raise ValueError("language mismatch")
    if "record_id" in record:
        _check_id(record["record_id"], "record_id")
    if "unit_id" in record:
        _check_id(record["unit_id"], "unit_id")
    _check_non_empty_str(record["kind"], "kind")
    _check_non_empty_str(record["structural_path"], "structural_path")
    _check_non_empty_str(record["source_span"], "source_span")
    if "occurrence" in record:
        occurrence = record["occurrence"]
        if not _is_plain_int(occurrence) or occurrence < 0:
            raise ValueError("occurrence must be an integer >= 0")
    if "content_type" in record:
        if record["content_type"] not in CONTENT_TYPES:
            raise ValueError("content_type outside closed vocabulary")
    for field in (
        "title",
        "parent_id",
        "preceding_context_id",
        "following_context_id",
        "semantic_type",
    ):
        if field in record:
            _check_nullable_non_empty_str(record[field], field)
    if "confidence" in record:
        confidence = record["confidence"]
        if confidence is not None:
            if isinstance(confidence, bool) or not isinstance(
                confidence, (int, float)
            ):
                raise ValueError("confidence must be null or a number")
            as_float = float(confidence)
            if not math.isfinite(as_float) or not (0 <= as_float <= 1):
                raise ValueError("confidence must be in 0..1")
    if "extraction_status" in record:
        _check_non_empty_str(record["extraction_status"], "extraction_status")
    start = _check_page_index(record["source_page_index"], "source_page_index")
    end = _check_page_index(
        record["source_page_index_end"], "source_page_index_end"
    )
    display = _check_page_display(
        record["source_page_display"], "source_page_display"
    )
    display_end = _check_page_display(
        record["source_page_display_end"], "source_page_display_end"
    )
    if end < start:
        raise ValueError("source_page_index_end must be >= source_page_index")
    if display_end < display:
        raise ValueError("source_page_display_end must be >= source_page_display")
    if display != start + 1:
        raise ValueError("source_page_display must equal source_page_index + 1")
    if display_end != end + 1:
        raise ValueError(
            "source_page_display_end must equal source_page_index_end + 1"
        )
    if "source_page_index_start" in record and _check_page_index(record["source_page_index_start"], "source_page_index_start") != start:
        raise ValueError("source_page_index_start must equal source_page_index")
    if "source_page_display_start" in record and _check_page_display(record["source_page_display_start"], "source_page_display_start") != display:
        raise ValueError("source_page_display_start must equal source_page_display")
    for field in (
        "printed_page_number",
        "printed_page_number_end",
        "printed_page_label",
        "printed_page_label_end",
    ):
        if field in record:
            _check_nullable_non_empty_str(record[field], field)
    if record["printed_page_kind"] not in PRINTED_PAGE_KIND:
        raise ValueError("printed_page_kind outside closed vocabulary")
    if record["mapping_status"] not in MAPPING_STATUS:
        raise ValueError("mapping_status outside closed vocabulary")
    if "printed_page_start" in record and record["printed_page_start"] != record.get("printed_page_number"):
        raise ValueError("printed_page_start must equal printed_page_number")
    if "printed_page_end" in record and record["printed_page_end"] != record.get("printed_page_number_end"):
        raise ValueError("printed_page_end must equal printed_page_number_end")
    if "mapping_status_start" in record and record["mapping_status_start"] != record["mapping_status"]:
        raise ValueError("mapping_status_start must equal mapping_status")
    if "mapping_status_end" in record and record["mapping_status_end"] != record["mapping_status"]:
        raise ValueError("mapping_status_end must equal mapping_status")
    if "mapping_anchor" in record:
        _check_nullable_non_empty_str(record["mapping_anchor"], "mapping_anchor")
    if "mapping_evidence" in record:
        _validate_mapping_evidence(record["mapping_evidence"])
    if "raw_text" in record:
        if not isinstance(record["raw_text"], str):
            raise ValueError("raw_text must be a string")
    if "raw_sha256" in record:
        raw_hash = record["raw_sha256"]
        if not isinstance(raw_hash, str) or not _HEX64_PATTERN.match(raw_hash):
            raise ValueError("raw_sha256 must be lowercase hex sha256")
    if "raw_text" in record and "raw_sha256" in record:
        expected = hashlib.sha256(
            record["raw_text"].encode("utf-8")
        ).hexdigest()
        if record["raw_sha256"] != expected:
            raise ValueError("raw_sha256 does not match raw_text")
    if "reading_text" in record:
        if not isinstance(record["reading_text"], str):
            raise ValueError("reading_text must be a string")
    if "repair_references" in record:
        _check_string_list(record["repair_references"], "repair_references")
    if "source_block_references" in record:
        _check_source_block_references(record["source_block_references"])
    if record["xref_status"] not in XREF_STATUS:
        raise ValueError("xref_status outside closed vocabulary")
    if "xref_targets" in record:
        _check_string_list(record["xref_targets"], "xref_targets")
    if record["validation_status"] not in VALIDATION_STATUS:
        raise ValueError("validation_status outside closed vocabulary")
    provenance = record["provenance"]
    _validate_provenance(provenance)
    if provenance["book_id"] != record["book_id"]:
        raise ValueError("provenance.book_id must match envelope book_id")
    if provenance["source_version"] != record["source_version"]:
        raise ValueError("provenance.source_version must match envelope")
    if provenance["ingestion_version"] != record["ingestion_version"]:
        raise ValueError("provenance.ingestion_version must match envelope")
    if provenance["structural_path"] != record["structural_path"]:
        raise ValueError("provenance.structural_path must match envelope")
    if provenance["source_span"] != record["source_span"]:
        raise ValueError("provenance.source_span must match envelope")
    if provenance["mapping_status"] != record["mapping_status"]:
        raise ValueError("provenance.mapping_status must match envelope")
    if provenance["validation_status"] != record["validation_status"]:
        raise ValueError("provenance.validation_status must match envelope")
    if start not in provenance["source_page_indices"]:
        raise ValueError("provenance.source_page_indices must contain start index")
    if end not in provenance["source_page_indices"]:
        raise ValueError("provenance.source_page_indices must contain end index")
    if "data" in record:
        if not isinstance(record["data"], dict):
            raise ValueError("data must be an object")
    return record
