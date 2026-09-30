from __future__ import annotations

import json
import math
import re
from collections import Counter
from pathlib import Path

from .constants import BOOK_ID, LANGUAGE, SOURCE_PAGE_COUNT, SOURCE_VERSION
from .serialization import canonical_json, read_jsonl, sha256_bytes, write_json_atomic, write_jsonl
from .source_lock import sha256_file

PROPOSAL_KINDS = frozenset(
    {"claim", "concept", "relation", "xref", "medication", "visual_review", "coverage"}
)
RELATION_TYPES = frozenset(
    {
        "symptom_of",
        "diagnostic_feature_of",
        "differential_with",
        "risk_factor_for",
        "associated_with",
        "treated_by",
        "contraindicated_with",
        "adverse_effect_of",
        "monitored_by",
        "subtype_of",
        "parent_of",
        "referenced_by",
        "defined_by",
    }
)
VALIDATION_STATUSES = frozenset({"auto_ok", "needs_review", "blocked"})
XREF_STATUSES = frozenset({"resolved", "unresolved", "unresolved_external", "ambiguous"})
COVERAGE_STATUSES = frozenset({"covered", "not_clinical", "unresolved"})
TARGET_SCOPES = frozenset({"tome-1", "tome-2"})
APPROVED_PROPOSAL_FILES = {
    "part-a-49-54.jsonl": (49, 54),
    "part-b-55-65.jsonl": (55, 65),
    "part-c-66-72.jsonl": (66, 72),
    "part-d-73-85.jsonl": (73, 85),
}
BUNDLE_RANGES = {
    (49, 54): "part-a-49-54",
    (55, 65): "part-b-55-65",
    (66, 72): "part-c-66-72",
    (73, 85): "part-d-73-85",
}
BUNDLE_ENTRY_FIELDS = frozenset(
    {
        "name",
        "path",
        "chapter_start",
        "chapter_end",
        "unit_count",
        "unit_ids_sha256",
        "visual_candidate_count",
        "medication_candidate_count",
        "source_page_index_start",
        "source_page_index_end",
        "printed_page_start",
        "printed_page_end",
        "sha256",
    }
)
REQUIRED_FIELDS = frozenset(
    {
        "proposal_id",
        "book_id",
        "source_version",
        "kind",
        "unit_id",
        "source_text",
        "source_layer",
        "source_span",
        "source_occurrence",
        "source_page_index_start",
        "source_page_index_end",
        "printed_page_start",
        "printed_page_end",
        "structural_path",
        "language",
        "confidence",
        "extraction_status",
        "validation_status",
    }
)
CLAIM_FIELDS = (
    "subject",
    "predicate_or_relation",
    "object",
    "clinical_domain",
    "population",
    "age_group",
    "context",
    "temporal_qualifier",
    "severity_qualifier",
    "exception_or_condition",
    "evidence_or_recommendation_wording",
)
HIGH_RISK_RE = re.compile(
    r"(?i)\b(?:seuil\w*|threshold\w*|minimum|maximum|au moins|au plus|dose\w*|posologie|contre[- ]?indic\w*|interaction\w*|effets? indésirables?|algorithme\w*|algorithm\w*|tableau\w*|table\w*|figure\w*|sch[ée]ma\w*|visual\w*)\b"
)
NUMERIC_THRESHOLD_RE = re.compile(
    r"(?i)\b\d+(?:[,.]\d+)?\s*(?:%|mg|mcg|µg|points?|jours?|heures?|minutes?)\b"
)


class ContractError(ValueError):
    def __init__(self, code: str, message: str, details: object | None = None):
        super().__init__(message)
        self.code = code
        self.details = details


def _require_fields(record: dict, fields: tuple[str, ...] | frozenset[str]) -> None:
    missing = sorted(field for field in fields if field not in record)
    if missing:
        raise ContractError("missing_field", "Missing required fields: " + ", ".join(missing), missing)


def _nonempty_string(value: object, field: str, code: str = "invalid_field") -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(code, field + " must be a non-empty string")
    return value


def _nullable_string(value: object, field: str) -> str | None:
    if value is not None and (not isinstance(value, str) or not value.strip()):
        raise ContractError("invalid_field", field + " must be null or a non-empty string")
    return value


def _plain_int(value: object, field: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ContractError("invalid_field", field + " must be an integer")
    return value


def _page_index(value: object, field: str) -> int:
    page_index = _plain_int(value, field)
    if not 0 <= page_index < SOURCE_PAGE_COUNT:
        raise ContractError("page_mismatch", field + " is outside the locked source")
    return page_index


def _string_list(value: object, field: str) -> list[str]:
    if not isinstance(value, list):
        raise ContractError("invalid_field", field + " must be a list")
    result = []
    for item in value:
        result.append(_nonempty_string(item, field + " item"))
    if len(result) != len(set(result)):
        raise ContractError("invalid_field", field + " items must be unique")
    return result


def _unit_identifier(unit: dict) -> str:
    for field in ("unit_id", "id"):
        value = unit.get(field)
        if isinstance(value, str) and value:
            return value
    raise ContractError("invalid_unit", "unit index record has no unit ID")


def _source_block(unit: dict, source_span: object) -> tuple[dict, int, int, int, int]:
    if not isinstance(source_span, dict):
        raise ContractError("invalid_source_span", "source_span must be an object")
    required = ("source_page_index", "block_index", "start_offset", "end_offset")
    if any(field not in source_span for field in required):
        raise ContractError("invalid_source_span", "source_span requires page, block, start offset, and end offset")
    page_index = _page_index(source_span["source_page_index"], "source_span.source_page_index")
    block_index = _plain_int(source_span["block_index"], "source_span.block_index")
    start_offset = _plain_int(source_span["start_offset"], "source_span.start_offset")
    end_offset = _plain_int(source_span["end_offset"], "source_span.end_offset")
    if block_index < 0 or start_offset < 0 or end_offset <= start_offset:
        raise ContractError("invalid_source_span", "source span block and offsets are invalid")
    data = unit.get("data")
    blocks = data.get("block_records") if isinstance(data, dict) else None
    if not isinstance(blocks, list):
        raise ContractError("missing_source_span", "host unit has no block-local source records")
    matches = [
        block
        for block in blocks
        if isinstance(block, dict)
        and block.get("source_page_index") == page_index
        and block.get("block_index") == block_index
    ]
    if len(matches) != 1:
        raise ContractError("source_span_mismatch", "source span does not identify exactly one host block")
    return matches[0], page_index, block_index, start_offset, end_offset


def _validate_source_provenance(record: dict, unit: dict) -> dict:
    source_text = _nonempty_string(record["source_text"], "source_text", "source_mismatch")
    source_layer = record["source_layer"]
    if source_layer not in {"raw", "reading"}:
        raise ContractError("invalid_source_layer", "source_layer must be raw or reading")
    block, page_index, block_index, start_offset, end_offset = _source_block(unit, record["source_span"])
    layer_text = block.get(source_layer + "_text")
    if not isinstance(layer_text, str):
        raise ContractError("source_mismatch", "selected source layer is absent from the host block")
    occurrences = [match.span() for match in re.finditer(re.escape(source_text), layer_text)]
    if not occurrences:
        raise ContractError("source_mismatch", "source_text is absent from the selected source layer")
    occurrence = _plain_int(record["source_occurrence"], "source_occurrence")
    if occurrence < 1 or occurrence > len(occurrences):
        raise ContractError("source_occurrence_out_of_range", "source occurrence is outside the exact match set")
    expected_start, expected_end = occurrences[occurrence - 1]
    if start_offset != expected_start or end_offset != expected_end:
        raise ContractError("occurrence_offset_mismatch", "source offsets do not identify the declared occurrence")
    if layer_text[start_offset:end_offset] != source_text:
        raise ContractError("source_mismatch", "source offsets do not contain the exact source text")
    start = _page_index(record["source_page_index_start"], "source_page_index_start")
    end = _page_index(record["source_page_index_end"], "source_page_index_end")
    if start != page_index or end != page_index:
        raise ContractError("page_mismatch", "proposal page range does not match its exact source span")
    unit_start = _plain_int(unit.get("source_page_index_start", unit.get("source_page_index")), "unit.source_page_index_start")
    unit_end = _plain_int(unit.get("source_page_index_end", unit_start), "unit.source_page_index_end")
    if page_index < unit_start or page_index > unit_end:
        raise ContractError("page_mismatch", "source span is outside its host unit")
    if "printed_page_number" not in block:
        raise ContractError("printed_page_mismatch", "source span block is missing printed-page mapping")
    printed = block["printed_page_number"]
    if printed is not None and (not isinstance(printed, str) or not printed.strip()):
        raise ContractError("printed_page_mismatch", "source span has no exact printed-page mapping")
    printed_start = _nullable_string(record["printed_page_start"], "printed_page_start")
    printed_end = _nullable_string(record["printed_page_end"], "printed_page_end")
    if printed_start != printed or printed_end != printed:
        raise ContractError("printed_page_mismatch", "proposal printed pages do not match the exact source span")
    structural_path = _nonempty_string(record["structural_path"], "structural_path")
    if structural_path != unit.get("structural_path"):
        raise ContractError("structural_path_mismatch", "proposal structural path does not match its host unit")
    evidence_span = {
        "source_page_index": page_index,
        "block_index": block_index,
        "start_offset": start_offset,
        "end_offset": end_offset,
    }
    return {
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "unit_id": _unit_identifier(unit),
        "source_span": unit.get("source_span"),
        "evidence_source_span": evidence_span,
        "source_page_index_start": page_index,
        "source_page_index_end": page_index,
        "printed_page_start": printed,
        "printed_page_end": printed,
        "structural_path": structural_path,
        "source_text_layer": source_layer,
        "source_occurrence": occurrence,
    }


def _validate_claim(record: dict) -> None:
    _require_fields(record, CLAIM_FIELDS)
    _nonempty_string(record["subject"], "subject")
    relation = _nonempty_string(record["predicate_or_relation"], "predicate_or_relation")
    if relation not in RELATION_TYPES:
        raise ContractError("unsupported_relation", "claim relation is outside the closed vocabulary")
    _nonempty_string(record["object"], "object")
    evidence = _nonempty_string(
        record["evidence_or_recommendation_wording"],
        "evidence_or_recommendation_wording",
        "evidence_mismatch",
    )
    if evidence not in record["source_text"]:
        raise ContractError("evidence_mismatch", "claim evidence is not exact source wording")
    for field in CLAIM_FIELDS[3:-1]:
        value = record[field]
        if value is not None and not isinstance(value, (str, list, dict)):
            raise ContractError("invalid_field", field + " has an unsupported value")


def _validate_concept(record: dict) -> None:
    _require_fields(record, ("concept_id", "canonical_name", "source_term"))
    for field in ("concept_id", "canonical_name", "source_term"):
        _nonempty_string(record[field], field)


def _validate_relation(record: dict) -> None:
    _require_fields(record, ("relation_type", "source_concept_id", "target_concept_id"))
    relation = _nonempty_string(record["relation_type"], "relation_type")
    if relation not in RELATION_TYPES:
        raise ContractError("unsupported_relation", "relation type is outside the closed vocabulary")
    source = _nonempty_string(record["source_concept_id"], "source_concept_id")
    target = _nonempty_string(record["target_concept_id"], "target_concept_id")
    if source == target:
        raise ContractError("invalid_relation_target", "relation endpoints must be distinct")


def _derive_xref_scope(target: object) -> str:
    if not isinstance(target, str) or not target.strip():
        raise ContractError("unverifiable_xref_target", "xref target must identify a locked chapter or tome")
    normalized = target.strip()
    chapter_match = re.search(
        r"(?i)(?:tome[-\s]*([12])\s*/?\s*)?(?:chapitre|chapter)[-\s]*(\d+)",
        normalized,
    )
    if chapter_match is not None:
        chapter = int(chapter_match.group(2))
        explicit_tome = int(chapter_match.group(1)) if chapter_match.group(1) is not None else None
        if 1 <= chapter <= 48:
            derived = "tome-1"
        elif 49 <= chapter <= 85:
            derived = "tome-2"
        else:
            raise ContractError("unsupported_xref_target", "xref chapter is outside Chapters 1-85")
        if explicit_tome is not None and "tome-" + str(explicit_tome) != derived:
            raise ContractError("xref_scope_mismatch", "target chapter conflicts with its explicit tome")
        return derived
    tome_match = re.fullmatch(r"(?i)tome[-\s]*([12])", normalized)
    if tome_match is not None:
        return "tome-1" if int(tome_match.group(1)) == 1 else "tome-2"
    raise ContractError("unverifiable_xref_target", "xref target has no verifiable chapter or tome scope")


def _validate_xref(record: dict) -> None:
    _require_fields(record, ("target", "target_scope", "xref_status"))
    target = _nonempty_string(record["target"], "target")
    derived_scope = _derive_xref_scope(target)
    target_scope = record["target_scope"]
    if target_scope != derived_scope:
        raise ContractError("xref_scope_mismatch", "target_scope does not match the target-derived scope")
    if target_scope not in TARGET_SCOPES:
        raise ContractError("invalid_target_scope", "target_scope is outside the closed vocabulary")
    xref_status = record["xref_status"]
    if xref_status not in XREF_STATUSES:
        raise ContractError("invalid_xref_status", "xref_status is outside the closed vocabulary")
    if derived_scope == "tome-1" and xref_status != "unresolved_external":
        raise ContractError("tome1_target_status", "Tome 1 targets must remain unresolved_external")
    if derived_scope == "tome-2" and xref_status == "unresolved_external":
        raise ContractError("tome2_target_status", "Tome 2 targets cannot be unresolved_external")


def _validate_medication(record: dict) -> None:
    _require_fields(record, ("candidate_id",))
    _nonempty_string(record["candidate_id"], "candidate_id")


def _validate_visual(record: dict) -> None:
    _require_fields(record, ("candidate_id", "region_reference"))
    _nonempty_string(record["candidate_id"], "candidate_id")
    region = record["region_reference"]
    if not isinstance(region, dict):
        raise ContractError("invalid_region_reference", "region_reference must be an object")
    page_index = _page_index(region.get("source_page_index"), "region_reference.source_page_index")
    if page_index != record["source_page_index_start"] or page_index != record["source_page_index_end"]:
        raise ContractError("region_page_mismatch", "visual region page does not match source evidence")
    bbox = region.get("bbox")
    if not isinstance(bbox, list) or len(bbox) != 4 or any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in bbox):
        if not isinstance(region.get("region_id"), str) or not region["region_id"]:
            raise ContractError("invalid_region_reference", "visual region requires bbox or region_id")


def _validate_coverage(record: dict, unit_index: dict) -> None:
    _require_fields(record, ("considered_unit_ids", "coverage_status", "skipped_reasons"))
    considered = _string_list(record["considered_unit_ids"], "considered_unit_ids")
    if record["unit_id"] not in considered:
        raise ContractError("coverage_mismatch", "coverage record must include its host unit")
    unknown = sorted(unit_id for unit_id in considered if unit_id not in unit_index)
    if unknown:
        raise ContractError("unknown_unit", "coverage record contains unknown units", unknown)
    if record["coverage_status"] not in COVERAGE_STATUSES:
        raise ContractError("invalid_coverage_status", "coverage_status is outside the closed vocabulary")
    reasons = record["skipped_reasons"]
    if not isinstance(reasons, dict):
        raise ContractError("invalid_field", "skipped_reasons must be an object")
    if record["coverage_status"] == "not_clinical":
        reason = reasons.get(record["unit_id"])
        if not isinstance(reason, str) or not reason.strip():
            raise ContractError("missing_skip_reason", "not_clinical coverage requires a skip reason")
        if not reason.strip().casefold().startswith("nonclinical:") or not reason.split(":", 1)[1].strip():
            raise ContractError("not_clinical_coverage_unjustified", "not_clinical coverage requires a nonclinical: justification")
    if record["coverage_status"] == "unresolved":
        reason = reasons.get(record["unit_id"])
        has_justification = (
            isinstance(reason, str)
            and reason.strip().casefold().startswith("unresolved:")
            and bool(reason.split(":", 1)[1].strip())
        )
        if not has_justification:
            raise ContractError(
                "unresolved_coverage_unjustified",
                "unresolved coverage requires a non-empty unresolved: reason",
            )


REVIEW_METADATA_FIELDS = frozenset(
    {
        "proposal_id",
        "book_id",
        "source_version",
        "unit_id",
        "source_page_index_start",
        "source_page_index_end",
        "printed_page_start",
        "printed_page_end",
        "structural_path",
        "language",
        "confidence",
        "extraction_status",
        "validation_status",
        "source_layer",
        "source_span",
        "source_occurrence",
        "considered_unit_ids",
        "skipped_reasons",
        "skip_reason",
        "coverage_status",
        "target",
        "target_scope",
        "xref_status",
        "concept_id",
        "source_concept_id",
        "target_concept_id",
        "candidate_id",
        "region_reference",
    }
)


def _semantic_strings(value: object, field: str | None = None) -> list[str]:
    if field in REVIEW_METADATA_FIELDS:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [text for item in value for text in _semantic_strings(item)]
    if isinstance(value, dict):
        return [text for key, item in value.items() for text in _semantic_strings(item, key)]
    return []


def _requires_review(record: dict) -> bool:
    if record["kind"] in {"medication", "visual_review"}:
        return True
    if record.get("xref_status") == "ambiguous" or record.get("coverage_status") == "unresolved":
        return True
    if record["kind"] == "relation" and record.get("relation_type") in {"contraindicated_with", "adverse_effect_of"}:
        return True
    if record["kind"] == "claim" and record.get("predicate_or_relation") in {"contraindicated_with", "adverse_effect_of"}:
        return True
    if any(field in record for field in ("interaction", "dose_text", "dose", "contraindication", "adverse_effect", "threshold", "table", "algorithm")):
        return True
    if any(record.get(field) is not None for field in CLAIM_FIELDS[3:-1]):
        return True
    flags = record.get("risk_flags", [])
    if isinstance(flags, list) and flags:
        return True
    semantic_text = " ".join(_semantic_strings(record))
    if re.search(r"\d", semantic_text):
        return True
    return HIGH_RISK_RE.search(semantic_text) is not None or NUMERIC_THRESHOLD_RE.search(semantic_text) is not None


def validate_proposal(record: dict, unit_index: dict) -> dict:
    if not isinstance(record, dict):
        raise ContractError("invalid_record", "proposal must be an object")
    _require_fields(record, REQUIRED_FIELDS)
    _nonempty_string(record["proposal_id"], "proposal_id")
    if record["book_id"] != BOOK_ID or record["source_version"] != SOURCE_VERSION:
        raise ContractError("proposal_identity_mismatch", "proposal identity does not match the frozen Tome 2")
    kind = record["kind"]
    if kind not in PROPOSAL_KINDS:
        raise ContractError("unsupported_kind", "proposal kind is outside the closed vocabulary")
    unit_id = _nonempty_string(record["unit_id"], "unit_id")
    unit = unit_index.get(unit_id) if isinstance(unit_index, dict) else None
    if not isinstance(unit, dict):
        raise ContractError("unknown_unit", "proposal unit is not in the target unit index")
    if unit.get("book_id") != BOOK_ID or unit.get("source_version") != SOURCE_VERSION:
        raise ContractError("unit_identity_mismatch", "proposal host unit identity does not match the frozen Tome 2")
    _unit_bounds(unit)
    provenance = _validate_source_provenance(record, unit)
    if record["language"] != LANGUAGE:
        raise ContractError("invalid_language", "proposal language must be fr")
    confidence = record["confidence"]
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not math.isfinite(float(confidence)) or not 0 <= float(confidence) <= 1:
        raise ContractError("invalid_confidence", "confidence must be a finite number in 0..1")
    if record["extraction_status"] != "proposed":
        raise ContractError("invalid_extraction_status", "semantic extraction_status must be proposed")
    if record["validation_status"] == "blocked":
        raise ContractError("blocked_proposal", "blocked proposals cannot enter validation or merge")
    if record["validation_status"] not in VALIDATION_STATUSES:
        raise ContractError("invalid_validation_status", "validation_status cannot be approved by the proposal contract")
    if kind == "claim":
        _validate_claim(record)
    elif kind == "concept":
        _validate_concept(record)
    elif kind == "relation":
        _validate_relation(record)
    elif kind == "xref":
        _validate_xref(record)
    elif kind == "medication":
        _validate_medication(record)
    elif kind == "visual_review":
        _validate_visual(record)
    elif kind == "coverage":
        _validate_coverage(record, unit_index)
    normalized = dict(record)
    normalized["book_id"] = BOOK_ID
    normalized["source_version"] = SOURCE_VERSION
    normalized["provenance"] = provenance
    if _requires_review(record):
        normalized["validation_status"] = "needs_review"
    return normalized


def _validated_records(path: Path, unit_index: dict) -> tuple[list[dict], dict]:
    records = read_jsonl(path)
    errors = []
    valid = []
    seen = {}
    counts = Counter()
    review_count = 0
    for line_number, record in enumerate(records, start=1):
        try:
            normalized = validate_proposal(record, unit_index)
        except ContractError as error:
            errors.append(
                {
                    "line": line_number,
                    "proposal_id": record.get("proposal_id") if isinstance(record, dict) else None,
                    "code": error.code,
                    "message": str(error),
                }
            )
            continue
        proposal_id = normalized["proposal_id"]
        if proposal_id in seen:
            errors.append(
                {
                    "line": line_number,
                    "proposal_id": proposal_id,
                    "code": "duplicate_proposal_id",
                    "message": "proposal_id is duplicated in the file",
                }
            )
            valid = [candidate for candidate in valid if candidate["proposal_id"] != proposal_id]
            counts.subtract({normalized["kind"]: 1})
            if normalized["validation_status"] == "needs_review":
                review_count -= 1
            continue
        seen[proposal_id] = line_number
        valid.append(normalized)
        counts[normalized["kind"]] += 1
        if normalized["validation_status"] == "needs_review":
            review_count += 1
    summary = {
        "path": str(path),
        "proposal_count": len(records),
        "valid_count": len(valid),
        "error_count": len(errors),
        "kind_counts": dict(sorted(counts.items())),
        "review_count": review_count,
        "errors": errors,
    }
    return valid, summary


def validate_proposal_file(path: Path, unit_index: dict) -> dict:
    valid, summary = _validated_records(Path(path), unit_index)
    del valid
    return summary


def _proposal_root(paths: list[Path]) -> Path:
    if not paths:
        raise ContractError("missing_input", "merge requires at least one proposal file")
    roots = []
    for path in paths:
        proposal_path = Path(path)
        if proposal_path.parent.name != "proposals" or proposal_path.parent.parent.name != "semantic":
            raise ContractError("invalid_proposal_path", "proposal files must be under semantic/proposals")
        roots.append(proposal_path.parent.parent.parent.resolve())
    if len({str(root) for root in roots}) != 1:
        raise ContractError("foreign_source", "proposal files span multiple output roots")
    return roots[0]


def _write_jsonl_atomic(path: Path, records: list[dict]) -> str:
    temporary = path.with_name(path.name + ".tmp")
    try:
        file_hash = write_jsonl(temporary, records)
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()
    return file_hash


def _chapter_number(structural_path: object) -> int | None:
    if not isinstance(structural_path, str):
        return None
    match = re.search(r"/Chapitre\s+(\d+)\b", structural_path, flags=re.IGNORECASE)
    return int(match.group(1)) if match is not None else None


def _validated_proposal_paths(paths: list[Path], output_root: Path) -> list[Path]:
    del output_root
    proposal_dir = paths[0].parent
    discovered_names = sorted(path.name for path in proposal_dir.iterdir() if path.is_file())
    names = [path.name for path in paths]
    expected_names = set(APPROVED_PROPOSAL_FILES)
    if set(discovered_names) != expected_names or len(paths) != len(expected_names) or set(names) != expected_names:
        raise ContractError(
            "proposal_file_set_invalid",
            "merge requires exactly the four approved proposal files",
            {"expected": sorted(expected_names), "actual": sorted(discovered_names)},
        )
    by_name = {path.name: path for path in paths}
    if len(by_name) != len(paths):
        raise ContractError("proposal_file_set_invalid", "proposal filenames must be unique")
    return [by_name[name] for name in APPROVED_PROPOSAL_FILES]


def _unit_index(units: list[dict], page_labels: dict[int, str | None]) -> dict:
    unit_index = {}
    for unit in units:
        if not isinstance(unit, dict):
            raise ContractError("invalid_unit", "merge unit index contains a non-object row")
        unit_id = _unit_identifier(unit)
        if unit_id in unit_index:
            raise ContractError("duplicate_unit_id", "merge unit index contains a duplicate unit ID", unit_id)
        if unit.get("book_id") != BOOK_ID or unit.get("source_version") != SOURCE_VERSION:
            raise ContractError("unit_identity_mismatch", "merge unit identity does not match the frozen Tome 2")
        _validate_unit_page_mapping(unit, page_labels)
        unit_index[unit_id] = unit
    return unit_index


def merge_proposals(paths: list[Path], units: list[dict]) -> dict:
    supplied_paths = [Path(path) for path in paths]
    output_root = _proposal_root(supplied_paths)
    proposal_paths = _validated_proposal_paths(supplied_paths, output_root)
    page_labels = _page_map_labels(output_root)
    unit_index = _unit_index(units, page_labels)
    records = []
    summaries = []
    for path in proposal_paths:
        valid, summary = _validated_records(path, unit_index)
        if summary["error_count"]:
            raise ContractError("proposal_validation_failed", "proposal file failed contract validation", summary["errors"])
        if summary["proposal_count"] == 0:
            raise ContractError("empty_proposal_file", "approved proposal file is empty", path.name)
        chapter_start, chapter_end = APPROVED_PROPOSAL_FILES[path.name]
        wrong_batch = [
            record["proposal_id"]
            for record in valid
            if not chapter_start <= (_chapter_number(record["structural_path"]) or -1) <= chapter_end
        ]
        if wrong_batch:
            raise ContractError("proposal_wrong_batch", "proposal is outside its approved chapter range", wrong_batch)
        summaries.append(summary)
        records.extend(valid)
    proposal_ids = set()
    for record in records:
        proposal_id = record["proposal_id"]
        if proposal_id in proposal_ids:
            raise ContractError("duplicate_proposal_id", "proposal_id is duplicated across proposal files")
        proposal_ids.add(proposal_id)
        if record["validation_status"] == "blocked":
            raise ContractError("blocked_proposal", "blocked proposals cannot be merged")
    expected_unit_ids = {
        unit_id
        for unit_id, unit in unit_index.items()
        if 49 <= (_chapter_number(unit.get("structural_path")) or -1) <= 85
    }
    coverage_unit_ids = set()
    for record in records:
        if record["kind"] != "coverage":
            continue
        unit_id = record["unit_id"]
        if record["considered_unit_ids"] != [unit_id]:
            raise ContractError("coverage_mismatch", "coverage proposal must consider exactly its host unit", unit_id)
        if unit_id in coverage_unit_ids:
            raise ContractError("duplicate_coverage", "unit has more than one coverage proposal", unit_id)
        coverage_unit_ids.add(unit_id)
    missing_coverage = sorted(expected_unit_ids - coverage_unit_ids)
    unexpected_coverage = sorted(coverage_unit_ids - expected_unit_ids)
    if missing_coverage:
        raise ContractError("missing_coverage", "merge is missing one or more unit coverage proposals", missing_coverage)
    if unexpected_coverage:
        raise ContractError("unexpected_coverage", "coverage contains units outside Chapters 49-85", unexpected_coverage)
    concept_ids = set()
    for record in records:
        if record["kind"] == "concept":
            concept_id = record["concept_id"]
            if concept_id in concept_ids:
                raise ContractError("duplicate_concept", "concept_id is duplicated")
            concept_ids.add(concept_id)
    for record in records:
        if record["kind"] != "relation":
            continue
        missing = sorted(
            endpoint
            for endpoint in (record["source_concept_id"], record["target_concept_id"])
            if endpoint not in concept_ids
        )
        if missing:
            raise ContractError("undefined_concept", "relation endpoint has no validated concept", missing)
    records.sort(
        key=lambda record: (
            _chapter_number(record["structural_path"]) or 999,
            record["proposal_id"],
            record["source_page_index_start"],
        )
    )
    grouped = {
        "claims.jsonl": [record for record in records if record["kind"] == "claim"],
        "concepts.jsonl": [record for record in records if record["kind"] == "concept"],
        "relations.jsonl": [record for record in records if record["kind"] == "relation"],
        "xrefs.jsonl": [record for record in records if record["kind"] == "xref"],
    }
    semantic_dir = output_root / "semantic"
    semantic_dir.mkdir(parents=True, exist_ok=True)
    output_hashes = {}
    temporary_paths = []
    try:
        for filename, output_records in grouped.items():
            destination = semantic_dir / filename
            temporary = destination.with_name(destination.name + ".tmp")
            output_hashes[filename] = write_jsonl(temporary, output_records)
            temporary_paths.append((temporary, destination))
        for temporary, destination in temporary_paths:
            temporary.replace(destination)
        temporary_paths.clear()
    finally:
        for temporary, _ in temporary_paths:
            if temporary.exists():
                temporary.unlink()
    kind_counts = dict(sorted(Counter(record["kind"] for record in records).items()))
    review_count = sum(1 for record in records if record["validation_status"] == "needs_review")
    merge_status = "WARNING" if review_count else "PASS"
    report = {
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "proposal_count": len(records),
        "kind_counts": kind_counts,
        "review_count": review_count,
        "coverage_count": len(coverage_unit_ids),
        "expected_coverage_count": len(expected_unit_ids),
        "unresolved_external_xref_count": sum(
            1
            for record in records
            if record["kind"] == "xref" and record["xref_status"] == "unresolved_external"
        ),
        "inputs": [
            {
                "path": str(path.resolve().relative_to(output_root)).replace("\\", "/"),
                "proposal_count": summary["proposal_count"],
                "sha256": sha256_file(path),
            }
            for path, summary in zip(proposal_paths, summaries)
        ],
        "output_paths": {filename: "semantic/" + filename for filename in grouped},
        "output_sha256": output_hashes,
        "errors": [],
        "status": merge_status,
    }
    report_path = semantic_dir / "merge-report.json"
    report_hash = write_json_atomic(report_path, report)
    checkpoint = {
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "merge_report_path": "semantic/merge-report.json",
        "merge_report_sha256": report_hash,
        "proposal_count": report["proposal_count"],
        "kind_counts": report["kind_counts"],
        "review_count": report["review_count"],
        "coverage_count": report["coverage_count"],
        "expected_coverage_count": report["expected_coverage_count"],
        "output_sha256": report["output_sha256"],
        "status": merge_status,
    }
    checkpoint_dir = output_root / "checkpoints"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    write_json_atomic(checkpoint_dir / "semantic-merge.json", checkpoint)
    return report


def _read_required_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        raise ContractError("missing_input", "required Task 5 input is missing: " + str(path))
    return read_jsonl(path)


def _verify_tome2_record(record: dict, record_type: str) -> None:
    if record.get("book_id") != BOOK_ID or record.get("source_version") != SOURCE_VERSION:
        raise ContractError("foreign_source", record_type + " record does not belong to the locked Tome 2 source")


def _unit_bounds(unit: dict) -> tuple[int, int]:
    start = unit.get("source_page_index_start", unit.get("source_page_index"))
    end = unit.get("source_page_index_end", start)
    if isinstance(start, bool) or not isinstance(start, int) or isinstance(end, bool) or not isinstance(end, int):
        raise ContractError("invalid_unit", "unit page range is invalid")
    if not 0 <= start <= end < SOURCE_PAGE_COUNT:
        raise ContractError("invalid_unit_page_range", "unit source page range must be ordered within 0..825")
    return start, end


def _page_printed_label(unit: dict, page_index: int, error_code: str) -> object:
    data = unit.get("data")
    blocks = data.get("block_records") if isinstance(data, dict) else None
    values = []
    if isinstance(blocks, list):
        for block in blocks:
            if not isinstance(block, dict) or block.get("source_page_index") != page_index:
                continue
            page_value = block.get("source_page_index")
            if isinstance(page_value, bool) or not isinstance(page_value, int) or not 0 <= page_value < SOURCE_PAGE_COUNT:
                raise ContractError("invalid_unit_page_range", "unit block source page is outside 0..825")
            if "printed_page_number" not in block:
                raise ContractError(error_code, "host block is missing printed_page_number")
            printed = block["printed_page_number"]
            if printed is not None and (not isinstance(printed, str) or not printed.strip()):
                raise ContractError(error_code, "host printed label must be a non-empty string or null")
            values.append(printed)
    if values:
        if any(value != values[0] for value in values[1:]):
            raise ContractError(error_code, "host page blocks disagree on the exact printed label")
        value = values[0]
        if value is not None and (not isinstance(value, str) or not value):
            raise ContractError(error_code, "host printed label must be an exact string or null")
        return value
    raise ContractError(error_code, "page boundary has no exact host block printed-page provenance")


def _validate_unit_page_mapping(unit: dict, page_labels: dict[int, str | None]) -> None:
    start, end = _unit_bounds(unit)
    if "source_page_index" in unit and unit["source_page_index"] != start:
        raise ContractError("invalid_unit_page_range", "unit source_page_index disagrees with source_page_index_start")
    if "source_page_index_end" in unit and unit["source_page_index_end"] != end:
        raise ContractError("invalid_unit_page_range", "unit source_page_index_end disagrees with its range")
    for field in ("printed_page_start", "printed_page_end"):
        if field not in unit:
            raise ContractError("unit_printed_page_mismatch", "unit is missing " + field)
    data = unit.get("data")
    blocks = data.get("block_records") if isinstance(data, dict) else None
    if isinstance(blocks, list):
        for block in blocks:
            if not isinstance(block, dict):
                raise ContractError("invalid_unit_page_range", "unit block provenance is not an object")
            index = block.get("source_page_index")
            if isinstance(index, bool) or not isinstance(index, int) or not start <= index <= end or not 0 <= index < SOURCE_PAGE_COUNT:
                raise ContractError("invalid_unit_page_range", "unit block source page is outside its declared range")
            if "printed_page_number" not in block:
                raise ContractError("unit_printed_page_mismatch", "unit block is missing printed_page_number")
            printed = block["printed_page_number"]
            if printed is not None and (not isinstance(printed, str) or not printed.strip()):
                raise ContractError("unit_printed_page_mismatch", "unit block printed label must be a non-empty string or null")
            if index not in page_labels:
                raise ContractError("missing_page_map_provenance", "unit block page is absent from page-map")
            if printed != page_labels[index]:
                raise ContractError("unit_printed_page_mismatch", "unit block label differs from page-map")
    printed_start = _nullable_string(unit.get("printed_page_start"), "unit.printed_page_start")
    printed_end = _nullable_string(unit.get("printed_page_end"), "unit.printed_page_end")
    if printed_start != _page_printed_label(unit, start, "unit_printed_page_mismatch"):
        raise ContractError("unit_printed_page_mismatch", "unit printed start does not match host page provenance")
    if printed_end != _page_printed_label(unit, end, "unit_printed_page_mismatch"):
        raise ContractError("unit_printed_page_mismatch", "unit printed end does not match host page provenance")
    provenance = unit.get("provenance")
    indices = provenance.get("source_page_indices") if isinstance(provenance, dict) else None
    if isinstance(indices, list):
        for index in indices:
            if isinstance(index, bool) or not isinstance(index, int) or not 0 <= index < SOURCE_PAGE_COUNT:
                raise ContractError("invalid_unit_page_range", "unit provenance page index is outside 0..825")


def _printed_bounds(units: list[dict]) -> tuple[str | None, str | None]:
    if not units:
        raise ContractError("printed_page_mismatch", "chapter bundle has no exact printed-page boundary mapping")
    for unit, field in ((units[0], "printed_page_start"), (units[-1], "printed_page_end")):
        if field not in unit:
            raise ContractError("printed_page_mismatch", "chapter bundle boundary is missing " + field)
    first_start = _nullable_string(units[0]["printed_page_start"], "unit.printed_page_start")
    last_end = _nullable_string(units[-1]["printed_page_end"], "unit.printed_page_end")
    return first_start, last_end


def _verify_candidate_page(
    candidate: dict,
    unit: dict,
    candidate_type: str,
    page_labels: dict[int, str | None],
) -> None:
    if not isinstance(page_labels, dict):
        raise ContractError("missing_page_map_provenance", "candidate page labels are required")
    _verify_tome2_record(candidate, candidate_type)
    candidate_id = candidate.get("candidate_id")
    if not isinstance(candidate_id, str) or not candidate_id:
        raise ContractError("invalid_candidate_id", candidate_type + " candidate has no stable candidate ID")
    if candidate.get("host_unit_id") != _unit_identifier(unit):
        raise ContractError("invalid_candidate_host", candidate_type + " candidate host does not match its unit")
    if candidate.get("structural_path") != unit.get("structural_path"):
        raise ContractError("candidate_structural_path_mismatch", candidate_type + " candidate structural path does not match its host unit")
    start = candidate.get("source_page_index_start", candidate.get("source_page_index"))
    end = candidate.get("source_page_index_end", start)
    unit_start, unit_end = _unit_bounds(unit)
    if (
        isinstance(start, bool)
        or not isinstance(start, int)
        or isinstance(end, bool)
        or not isinstance(end, int)
        or not 0 <= start <= end < SOURCE_PAGE_COUNT
    ):
        raise ContractError("candidate_page_mismatch", candidate_type + " candidate page range is invalid")
    if start < unit_start or end > unit_end:
        raise ContractError("candidate_page_mismatch", candidate_type + " candidate page is outside its host unit")
    if "printed_page_start" not in candidate or "printed_page_end" not in candidate:
        raise ContractError("candidate_printed_page_mismatch", candidate_type + " candidate has no printed-page boundary")
    printed_start = _nullable_string(candidate.get("printed_page_start"), "candidate.printed_page_start")
    printed_end = _nullable_string(candidate.get("printed_page_end"), "candidate.printed_page_end")
    if printed_start != _page_printed_label(unit, start, "candidate_printed_page_mismatch"):
        raise ContractError("candidate_printed_page_mismatch", candidate_type + " candidate start label disagrees with host provenance")
    if printed_end != _page_printed_label(unit, end, "candidate_printed_page_mismatch"):
        raise ContractError("candidate_printed_page_mismatch", candidate_type + " candidate end label disagrees with host provenance")
    if start not in page_labels or end not in page_labels:
        raise ContractError("missing_page_map_provenance", "candidate page is absent from page-map")
    if printed_start != page_labels[start] or printed_end != page_labels[end]:
        raise ContractError("candidate_printed_page_mismatch", "candidate label differs from page-map")


def _expected_units(units: list[dict], chapter_start: int, chapter_end: int) -> list[dict]:
    return sorted(
        [
            unit
            for unit in units
            if chapter_start <= (_chapter_number(unit.get("structural_path")) or -1) <= chapter_end
        ],
        key=lambda unit: (_unit_bounds(unit)[0], _unit_identifier(unit)),
    )


def _unit_ids_sha256(units: list[dict]) -> str:
    return sha256_bytes(canonical_json(sorted(_unit_identifier(unit) for unit in units)).encode("utf-8"))


def _validate_bundle_rows(
    rows: list[dict],
    expected_units: list[dict],
    visual_by_unit: dict[str, list[dict]] | None = None,
    medication_by_unit: dict[str, list[dict]] | None = None,
) -> None:
    expected_ids = [_unit_identifier(unit) for unit in expected_units]
    actual_ids = []
    for row in rows:
        unit = row.get("unit") if isinstance(row, dict) else None
        if not isinstance(unit, dict):
            raise ContractError("invalid_bundle_row", "bundle row has no exact unit object")
        actual_ids.append(_unit_identifier(unit))
    if len(actual_ids) != len(set(actual_ids)):
        raise ContractError("duplicate_bundle_unit", "bundle contains duplicate unit IDs")
    if set(actual_ids) != set(expected_ids) or len(actual_ids) != len(expected_ids):
        raise ContractError("bundle_unit_set_mismatch", "bundle unit IDs do not exactly match the expected range")
    by_id = {_unit_identifier(unit): unit for unit in expected_units}
    for row in rows:
        unit = row["unit"]
        if row.get("book_id") != BOOK_ID or row.get("source_version") != SOURCE_VERSION:
            raise ContractError("foreign_source", "bundle row identity does not match the frozen Tome 2")
        if unit != by_id[_unit_identifier(unit)]:
            raise ContractError("bundle_unit_mismatch", "bundle unit differs from Task 5 source unit")
        unit_id = _unit_identifier(unit)
        if visual_by_unit is not None and row.get("visual_candidates") != visual_by_unit.get(unit_id, []):
            raise ContractError("bundle_visual_mismatch", "bundle visual candidates differ from Task 5 source")
        if medication_by_unit is not None and row.get("medication_candidates") != medication_by_unit.get(unit_id, []):
            raise ContractError("bundle_medication_mismatch", "bundle medication candidates differ from Task 5 source")


def _read_bundle_checkpoint(output_dir: Path) -> dict:
    checkpoint_path = output_dir / "checkpoints" / "semantic-bundles.json"
    if not checkpoint_path.exists():
        return {"bundles": []}
    with checkpoint_path.open("r", encoding="utf-8") as stream:
        checkpoint = json.load(stream)
    if checkpoint.get("book_id") != BOOK_ID or checkpoint.get("source_version") != SOURCE_VERSION:
        raise ContractError("foreign_source", "semantic bundle checkpoint belongs to another source")
    if not isinstance(checkpoint.get("bundles"), list):
        raise ContractError("invalid_checkpoint", "semantic bundle checkpoint is malformed")
    return checkpoint


def _page_map_labels(output_dir: Path) -> dict[int, str | None]:
    page_map_path = output_dir / "page-map.jsonl"
    if not page_map_path.exists():
        raise ContractError("missing_page_map", "printed-page provenance requires page-map.jsonl")
    labels = {}
    for row in read_jsonl(page_map_path):
        index = row.get("source_page_index")
        if isinstance(index, bool) or not isinstance(index, int):
            raise ContractError("invalid_page_map", "page-map record has an invalid source page index")
        if index in labels:
            raise ContractError("invalid_page_map", "page-map contains duplicate source page index")
        if "printed_page_number" not in row:
            raise ContractError("missing_page_map_printed_page", "page-map record is missing printed_page_number")
        printed = row["printed_page_number"]
        if printed is not None and (not isinstance(printed, str) or not printed.strip()):
            raise ContractError("invalid_page_map_printed_page", "page-map printed_page_number must be a non-empty string or null")
        labels[index] = printed
    return labels


def _write_blocked_bundle_checkpoint(output_dir: Path, error: Exception) -> None:
    try:
        existing = _read_bundle_checkpoint(output_dir)
    except (ContractError, OSError, TypeError, ValueError):
        existing = {"bundles": []}
    checkpoint = {
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "bundle_count": len(existing.get("bundles", [])),
        "expected_bundle_count": len(BUNDLE_RANGES),
        "bundles": existing.get("bundles", []),
        "status": "BLOCKED",
        "error_code": error.code if isinstance(error, ContractError) else "bundle_input_error",
        "error": str(error),
    }
    checkpoint_dir = output_dir / "checkpoints"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    write_json_atomic(checkpoint_dir / "semantic-bundles.json", checkpoint)



def _bundle_entry_is_current(
    item: dict,
    output_dir: Path,
    all_units: list[dict],
    visual_by_unit: dict[str, list[dict]],
    medication_by_unit: dict[str, list[dict]],
) -> bool:
    if set(item) != BUNDLE_ENTRY_FIELDS:
        return False
    name = item.get("name")
    matching_ranges = [chapter_range for chapter_range, bundle_name in BUNDLE_RANGES.items() if bundle_name == name]
    if len(matching_ranges) != 1:
        return False
    chapter_range = matching_ranges[0]
    expected_units = _expected_units(all_units, *chapter_range)
    expected_visual_map = {
        _unit_identifier(unit): visual_by_unit.get(_unit_identifier(unit), [])
        for unit in expected_units
    }
    expected_medication_map = {
        _unit_identifier(unit): medication_by_unit.get(_unit_identifier(unit), [])
        for unit in expected_units
    }
    expected = {
        "name": name,
        "path": (Path("work") / "chapters" / (str(name) + ".jsonl")).as_posix(),
        "chapter_start": chapter_range[0],
        "chapter_end": chapter_range[1],
        "unit_count": len(expected_units),
        "unit_ids_sha256": _unit_ids_sha256(expected_units),
        "visual_candidate_count": sum(len(records) for records in expected_visual_map.values()),
        "medication_candidate_count": sum(len(records) for records in expected_medication_map.values()),
        "source_page_index_start": min((_unit_bounds(unit)[0] for unit in expected_units), default=0),
        "source_page_index_end": max((_unit_bounds(unit)[1] for unit in expected_units), default=0),
        "printed_page_start": expected_units[0].get("printed_page_start") if expected_units else None,
        "printed_page_end": expected_units[-1].get("printed_page_end") if expected_units else None,
    }
    if any(item.get(key) != value for key, value in expected.items()):
        return False
    relative_path = item.get("path")
    if not isinstance(relative_path, str):
        return False
    bundle_path = output_dir / relative_path
    if not bundle_path.exists() or sha256_file(bundle_path) != item.get("sha256"):
        return False
    try:
        _validate_bundle_rows(
            read_jsonl(bundle_path),
            expected_units,
            expected_visual_map,
            expected_medication_map,
        )
    except (ContractError, KeyError, OSError, TypeError, ValueError):
        return False
    return True


def _bundle_checkpoint(
    output_dir: Path,
    entry: dict,
    all_units: list[dict],
    visual_by_unit: dict[str, list[dict]],
    medication_by_unit: dict[str, list[dict]],
) -> dict:
    if not _bundle_entry_is_current(entry, output_dir, all_units, visual_by_unit, medication_by_unit):
        raise ContractError("invalid_bundle_checkpoint_entry", "new bundle checkpoint entry does not match current inputs")
    existing = _read_bundle_checkpoint(output_dir)
    existing_entries = [item for item in existing["bundles"] if isinstance(item, dict)]
    existing_name_counts = Counter(item.get("name") for item in existing_entries)
    existing_duplicate = any(
        name in BUNDLE_RANGES.values() and count > 1
        for name, count in existing_name_counts.items()
    )
    previous = [item for item in existing_entries if item.get("name") != entry["name"]]
    valid_previous = [
        item
        for item in previous
        if _bundle_entry_is_current(item, output_dir, all_units, visual_by_unit, medication_by_unit)
    ]
    bundles = valid_previous + [entry]
    order = {name: position for position, name in enumerate(BUNDLE_RANGES.values())}
    bundles.sort(key=lambda item: order.get(item.get("name"), 999))
    names = [item["name"] for item in bundles]
    expected_names = set(BUNDLE_RANGES.values())
    duplicate_names = existing_duplicate or len(names) != len(set(names))
    missing_names = set(names) != expected_names
    checkpoint = {
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "bundle_count": len(bundles),
        "expected_bundle_count": len(BUNDLE_RANGES),
        "bundles": bundles,
        "status": "PASS",
    }
    if duplicate_names:
        checkpoint["status"] = "BLOCKED"
        checkpoint["error_code"] = "duplicate_bundle_set"
        checkpoint["error"] = "approved bundle name occurs more than once"
    elif missing_names:
        checkpoint["status"] = "BLOCKED"
        checkpoint["error_code"] = "missing_bundle_set"
        checkpoint["error"] = "checkpoint does not contain exactly the four approved bundles"
    checkpoint_dir = output_dir / "checkpoints"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    write_json_atomic(checkpoint_dir / "semantic-bundles.json", checkpoint)
    return checkpoint


def _create_chapter_bundle(output_dir: Path, chapter_start: int, chapter_end: int) -> dict:
    output_dir = Path(output_dir)
    chapter_range = (chapter_start, chapter_end)
    if chapter_range not in BUNDLE_RANGES:
        raise ContractError("invalid_chapter_range", "chapter range is not one of the four approved Tome 2 batches")
    structure_path = output_dir / "structure.json"
    if not structure_path.exists():
        raise ContractError("missing_input", "Task 4 structure.json is missing")
    with structure_path.open("r", encoding="utf-8") as stream:
        structure = json.load(stream)
    tome = structure.get("tome")
    if not isinstance(tome, dict) or tome.get("number") != 2:
        raise ContractError("foreign_source", "structure is not Tome 2")
    structure_chapters = {
        chapter.get("chapter")
        for chapter in structure.get("chapters", [])
        if isinstance(chapter, dict) and isinstance(chapter.get("chapter"), int)
    }
    expected_chapters = set(range(chapter_start, chapter_end + 1))
    if not expected_chapters.issubset(structure_chapters) or any(chapter < 49 or chapter > 85 for chapter in structure_chapters):
        raise ContractError("invalid_structure", "Task 4 structure does not cover the approved Tome 2 chapter range")
    page_labels = _page_map_labels(output_dir)
    units = _read_required_jsonl(output_dir / "units.jsonl")
    visuals = _read_required_jsonl(output_dir / "visuals.jsonl")
    medications = _read_required_jsonl(output_dir / "medications.jsonl")
    all_unit_by_id = {}
    for unit in units:
        _verify_tome2_record(unit, "unit")
        _validate_unit_page_mapping(unit, page_labels)
        unit_id = _unit_identifier(unit)
        if unit_id in all_unit_by_id:
            raise ContractError("duplicate_unit_id", "Task 5 unit index contains a duplicate unit ID", unit_id)
        chapter = _chapter_number(unit.get("structural_path"))
        if chapter is not None and not 49 <= chapter <= 85:
            raise ContractError("invalid_chapter_range", "unit points outside Chapters 49-85")
        all_unit_by_id[unit_id] = unit
    selected_units = _expected_units(units, chapter_start, chapter_end)
    represented_chapters = {
        _chapter_number(unit.get("structural_path"))
        for unit in selected_units
    }
    missing_chapters = sorted(expected_chapters - represented_chapters)
    if missing_chapters:
        raise ContractError("missing_chapter_units", "Task 5 units are missing for approved chapters", missing_chapters)
    if not selected_units:
        raise ContractError("empty_bundle", "approved chapter range contains no units")
    selected_unit_ids = {_unit_identifier(unit) for unit in selected_units}
    unit_by_id = {unit_id: unit for unit_id, unit in all_unit_by_id.items() if unit_id in selected_unit_ids}
    all_visual_by_unit = {unit_id: [] for unit_id in all_unit_by_id}
    all_medication_by_unit = {unit_id: [] for unit_id in all_unit_by_id}
    visual_ids = set()
    for visual in visuals:
        host = visual.get("host_unit_id")
        if host not in all_unit_by_id:
            raise ContractError("invalid_candidate_host", "visual candidate host is not in the Task 5 unit index")
        candidate_id = visual.get("candidate_id")
        if candidate_id in visual_ids:
            raise ContractError("duplicate_candidate_id", "visual candidate ID is duplicated", candidate_id)
        visual_ids.add(candidate_id)
        _verify_candidate_page(visual, all_unit_by_id[host], "visual", page_labels)
        all_visual_by_unit[host].append(visual)
    medication_ids = set()
    for medication in medications:
        host = medication.get("host_unit_id")
        if host not in all_unit_by_id:
            raise ContractError("invalid_candidate_host", "medication candidate host is not in the Task 5 unit index")
        candidate_id = medication.get("candidate_id")
        if candidate_id in medication_ids:
            raise ContractError("duplicate_candidate_id", "medication candidate ID is duplicated", candidate_id)
        medication_ids.add(candidate_id)
        _verify_candidate_page(medication, all_unit_by_id[host], "medication", page_labels)
        all_medication_by_unit[host].append(medication)
    visual_by_unit = {unit_id: all_visual_by_unit[unit_id] for unit_id in unit_by_id}
    medication_by_unit = {unit_id: all_medication_by_unit[unit_id] for unit_id in unit_by_id}
    rows = []
    for unit in selected_units:
        unit_id = _unit_identifier(unit)
        rows.append(
            {
                "book_id": BOOK_ID,
                "source_version": SOURCE_VERSION,
                "chapter_start": chapter_start,
                "chapter_end": chapter_end,
                "unit": unit,
                "visual_candidates": visual_by_unit[unit_id],
                "medication_candidates": medication_by_unit[unit_id],
            }
        )
    _validate_bundle_rows(rows, selected_units, visual_by_unit, medication_by_unit)
    name = BUNDLE_RANGES[chapter_range]
    relative_path = Path("work") / "chapters" / (name + ".jsonl")
    bundle_path = output_dir / relative_path
    bundle_path.parent.mkdir(parents=True, exist_ok=True)
    bundle_hash = _write_jsonl_atomic(bundle_path, rows)
    source_start = min(_unit_bounds(unit)[0] for unit in selected_units)
    source_end = max(_unit_bounds(unit)[1] for unit in selected_units)
    printed_start, printed_end = _printed_bounds(selected_units)
    entry = {
        "name": name,
        "path": relative_path.as_posix(),
        "chapter_start": chapter_start,
        "chapter_end": chapter_end,
        "unit_count": len(selected_units),
        "unit_ids_sha256": _unit_ids_sha256(selected_units),
        "visual_candidate_count": sum(len(records) for records in visual_by_unit.values()),
        "medication_candidate_count": sum(len(records) for records in medication_by_unit.values()),
        "source_page_index_start": source_start,
        "source_page_index_end": source_end,
        "printed_page_start": printed_start,
        "printed_page_end": printed_end,
        "sha256": bundle_hash,
    }
    _bundle_checkpoint(
        output_dir,
        entry,
        units,
        all_visual_by_unit,
        all_medication_by_unit,
    )
    return entry


def create_chapter_bundle(output_dir: Path, chapter_start: int, chapter_end: int) -> dict:
    try:
        return _create_chapter_bundle(Path(output_dir), chapter_start, chapter_end)
    except (ContractError, KeyError, OSError, TypeError, ValueError) as error:
        _write_blocked_bundle_checkpoint(Path(output_dir), error)
        raise
