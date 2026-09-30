"""Book-local entry point for canonical Tome 2 ingestion Tasks 2 and 3.

Only executable entry point of the book-local tool. Supports source locking,
independent page extraction, verified glyph-repair map discovery, and logged
reading-layer repair. Paths are resolved relative to the repository root;
only directories below the supplied output directory are created. Exit code
is nonzero on a source mismatch or an unrecoverable failure.
"""

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.canon_v2.constants import SOURCE_VERSION
from tools.canon_v2.page_extraction import extract_pages
from tools.canon_v2.page_mapping import map_pages
from tools.canon_v2.medications import extract_medication_candidates
from tools.canon_v2.semantic_audit import audit as audit_semantic
from tools.canon_v2.semantic_part_d import generate as generate_semantic
from tools.canon_v2.semantic_part_d import replay as replay_semantic
from tools.canon_v2.semantic_contract import (
    ContractError,
    create_chapter_bundle,
    merge_proposals,
    validate_proposal_file,
)
from tools.canon_v2.qa import freeze as freeze_package
from tools.canon_v2.qa import merge_proposals as qa_merge_proposals
from tools.canon_v2.qa import replay as replay_package
from tools.canon_v2.qa import run_qa
from tools.canon_v2.serialization import read_jsonl, write_json, write_json_atomic, write_jsonl
from tools.canon_v2.source_lock import register_source, sha256_file
from tools.canon_v2 import review as review_module
from tools.canon_v2.text_repair import (
    _map_content_hash,
    build_repair_map,
    repair_pages,
)
from tools.canon_v2.structure import build_structure, parse_toc_records
from tools.canon_v2.units import build_units
from tools.canon_v2.visuals import extract_visual_candidates


def _resolve(path_text: str) -> Path:
    path = Path(path_text)
    if not path.is_absolute():
        path = Path.cwd() / path
    return path


def _fail(message: str) -> int:
    sys.stderr.write("ingest_book: error: " + message + "\n")
    return 1


def _command_register(args: argparse.Namespace) -> int:
    pdf_path = _resolve(args.pdf)
    output_dir = _resolve(args.output)
    try:
        record = register_source(pdf_path, output_dir)
    except ValueError as error:
        return _fail(str(error))
    except OSError as error:
        return _fail(str(error))
    checkpoint = {
        "command": "register --pdf " + str(pdf_path) + " --output " + str(output_dir),
        "timestamp": datetime.now().astimezone().isoformat(),
        "source_version": record["source_version"],
        "source_path": record["source_path"],
        "page_count": record["page_count"],
        "parser": record["parser"],
        "source_lock_path": record["lock_path"],
        "source_lock_sha256": record["lock_sha256"],
    }
    checkpoints_dir = output_dir / "checkpoints"
    checkpoints_dir.mkdir(parents=True, exist_ok=True)
    write_json(checkpoints_dir / "register.json", checkpoint)
    sys.stdout.write(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
    return 0


def _verify_locked_source(pdf_path: Path, output_dir: Path) -> None:
    lock_path = output_dir / "source-lock.json"
    if not lock_path.exists():
        raise ValueError("source lock is missing: " + str(lock_path))
    with lock_path.open("r", encoding="utf-8") as stream:
        lock = json.load(stream)
    locked_hash = lock.get("source_version")
    if locked_hash != SOURCE_VERSION:
        raise ValueError(
            "source lock does not match authoritative source version: "
            + str(locked_hash)
        )
    actual_hash = "sha256:" + sha256_file(pdf_path)
    if actual_hash != SOURCE_VERSION:
        raise ValueError(
            "source PDF does not match authoritative source version: " + actual_hash
        )


def _command_repair_map(args: argparse.Namespace) -> int:
    pdf_path = _resolve(args.pdf)
    output_dir = _resolve(args.output)
    try:
        _verify_locked_source(pdf_path, output_dir)
        raw_path = output_dir / "raw" / "pages.jsonl"
        if not raw_path.exists():
            raise ValueError("raw pages are missing: " + str(raw_path))
        raw_pages = read_jsonl(raw_path)
        rule_map = build_repair_map(raw_pages, pdf_path)
        raw_page_sha256 = sha256_file(raw_path)
        checkpoint_path = output_dir / "checkpoints" / "repair-map.json"
        checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
        map_file_sha256 = write_json_atomic(checkpoint_path, rule_map)
        map_sha256 = _map_content_hash(rule_map)
        summary = {
            "command": "repair-map --pdf "
            + str(pdf_path)
            + " --output "
            + str(output_dir),
            "repair_map_path": "checkpoints/repair-map.json",
            "repair_map_sha256": map_file_sha256,
            "repair_map_content_sha256": map_sha256,
            "repair_map_file_sha256": map_file_sha256,
            "raw_page_path": "raw/pages.jsonl",
            "raw_page_sha256": raw_page_sha256,
            "raw_page_count": len(raw_pages),
            "total_private_use_count": rule_map["total_private_use_count"],
            "private_use_codepoint_count": rule_map["private_use_codepoint_count"],
            "rule_count": len(rule_map["rules"]),
            "unresolved_codepoint_count": len(rule_map["unresolved_codepoints"]),
        }
    except ValueError as error:
        return _fail(str(error))
    except OSError as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return 0


def _command_repair(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        summary = repair_pages(
            output_dir / "raw" / "pages.jsonl",
            output_dir,
            resume=args.resume,
        )
    except ValueError as error:
        return _fail(str(error))
    except OSError as error:
        return _fail(str(error))
    public_summary = {
        key: value
        for key, value in summary.items()
        if key not in {"rule_map", "page_records", "events"}
    }
    sys.stdout.write(json.dumps(public_summary, ensure_ascii=False, indent=2) + "\n")
    return 0


def _read_page_records(output_dir: Path) -> list[dict]:
    repaired_path = output_dir / "raw" / "repaired-pages.jsonl"
    raw_path = output_dir / "raw" / "pages.jsonl"
    path = repaired_path if repaired_path.exists() else raw_path
    if not path.exists():
        raise ValueError("page records are missing: " + str(path))
    return read_jsonl(path)


def _piecewise_rules(rows: list[dict]) -> list[dict]:
    grouped: dict[str, list[int]] = {}
    for row in rows:
        rule_id = row.get("piecewise_rule_id")
        if not isinstance(rule_id, str) or rule_id.startswith("toc-anchor:"):
            continue
        grouped.setdefault(rule_id, []).append(row["source_page_index"])
    return [
        {"rule_id": rule_id, "source_page_indices": sorted(indices)}
        for rule_id, indices in sorted(grouped.items())
    ]


def _command_map_pages(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        pages = _read_page_records(output_dir)
        toc_records = parse_toc_records(pages)
        rows = map_pages(pages, toc_records)
        output_dir.mkdir(parents=True, exist_ok=True)
        page_map_path = output_dir / "page-map.jsonl"
        page_map_sha256 = write_jsonl(page_map_path, rows)
        anchors = [
            {
                "source_page_index": row["source_page_index"],
                "printed_page_number": row["printed_page_number"],
                "evidence_classes": row["evidence_classes"],
            }
            for row in rows
            if "visible_label" in row["evidence_classes"]
        ]
        uncertain = [
            row["source_page_index"]
            for row in rows
            if row["mapping_status"] in {"uncertain", "missing"}
        ]
        checkpoint = {
            "command": "map-pages --output " + str(output_dir),
            "page_count": len(rows),
            "toc_entry_count": len(toc_records),
            "page_map_path": "page-map.jsonl",
            "page_map_sha256": page_map_sha256,
            "anchor_list": anchors,
            "piecewise_rules": _piecewise_rules(rows),
            "uncertain_page_indices": uncertain,
            "evidence_counts": {
                evidence: sum(1 for row in rows if evidence in row["evidence_classes"])
                for evidence in ("visible_label", "toc_entry", "body_anchor", "index_label", "credits_label", "blank_page", "back_cover")
            },
            "status": "PASS",
        }
        checkpoints_dir = output_dir / "checkpoints"
        checkpoints_dir.mkdir(parents=True, exist_ok=True)
        write_json_atomic(checkpoints_dir / "page-map.json", checkpoint)
    except (OSError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
    return 0


def _command_structure(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        page_map_path = output_dir / "page-map.jsonl"
        if not page_map_path.exists():
            raise ValueError("page map is missing: " + str(page_map_path))
        pages = _read_page_records(output_dir)
        toc_records = parse_toc_records(pages)
        structure = build_structure(pages, toc_records)
        output_dir.mkdir(parents=True, exist_ok=True)
        structure_path = output_dir / "structure.json"
        structure_sha256 = write_json_atomic(structure_path, structure)
        chapter_count = len(structure["chapters"])
        section_count = sum(len(chapter["sections"]) for chapter in structure["chapters"])
        subsection_count = sum(len(chapter["subsections"]) for chapter in structure["chapters"])
        checkpoint = {
            "command": "structure --output " + str(output_dir),
            "page_map_path": "page-map.jsonl",
            "page_map_sha256": sha256_file(page_map_path),
            "structure_path": "structure.json",
            "structure_sha256": structure_sha256,
            "part_count": len(structure["parts"]),
            "chapter_count": chapter_count,
            "section_count": section_count,
            "subsection_count": subsection_count,
            "external_reference_count": len(structure["external_references"]),
            "unmatched_toc_count": len(structure["unmatched_toc_entries"]),
            "off_structure_count": len(structure["off_structure"]),
            "orphan_context_count": len(structure["orphan_context"]),
            "status": structure["qa"]["status"],
        }
        checkpoints_dir = output_dir / "checkpoints"
        checkpoints_dir.mkdir(parents=True, exist_ok=True)
        write_json_atomic(checkpoints_dir / "structure.json", checkpoint)
    except (OSError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
    return 0


def _page_records_with_mapping(output_dir: Path) -> list[dict]:
    pages = _read_page_records(output_dir)
    page_map_path = output_dir / "page-map.jsonl"
    if not page_map_path.exists():
        raise ValueError("page map is missing: " + str(page_map_path))
    rows = read_jsonl(page_map_path)
    mapping_by_index = {}
    for row in rows:
        index = row.get("source_page_index")
        if isinstance(index, bool) or not isinstance(index, int):
            raise ValueError("page-map record has an invalid source page index")
        if index in mapping_by_index:
            raise ValueError("page-map contains duplicate source page index")
        if "printed_page_number" not in row:
            raise ValueError("page-map record is missing printed_page_number")
        printed = row["printed_page_number"]
        if printed is not None and (not isinstance(printed, str) or not printed.strip()):
            raise ValueError("page-map printed_page_number must be a non-empty string or null")
        mapping_by_index[index] = row
    merged = []
    for page in pages:
        index = page.get("source_page_index")
        row = mapping_by_index.get(index)
        if row is None:
            raise ValueError("page-map record is missing for a source page")
        combined = dict(page)
        for key in (
            "printed_page_number",
            "printed_page_kind",
            "mapping_status",
            "mapping_anchor",
            "piecewise_rule_id",
        ):
            if key in row:
                combined[key] = row[key]
        merged.append(combined)
    return merged


def _checkpoint(output_dir: Path, name: str, value: dict) -> None:
    path = output_dir / "checkpoints" / name
    path.parent.mkdir(parents=True, exist_ok=True)
    write_json_atomic(path, value)


def _command_units(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        structure_path = output_dir / "structure.json"
        if not structure_path.exists():
            raise ValueError("structure is missing: " + str(structure_path))
        pages = _page_records_with_mapping(output_dir)
        with structure_path.open("r", encoding="utf-8") as stream:
            structure = json.load(stream)
        units = build_units(pages, structure)
        output_dir.mkdir(parents=True, exist_ok=True)
        units_path = output_dir / "units.jsonl"
        units_sha256 = write_jsonl(units_path, units)
        content_counts = dict(sorted(Counter(unit.get("content_type", "unknown") for unit in units).items()))
        empty_pages = sum(1 for page in pages if not str(page.get("reading_text", page.get("text", page.get("raw_text", "")))).strip())
        represented_pages = len(
            {
                page_index
                for unit in units
                for page_index in range(
                    int(unit.get("source_page_index_start", unit.get("source_page_index", 0))),
                    int(unit.get("source_page_index_end", unit.get("source_page_index", 0))) + 1,
                )
            }
        )
        unresolved = sum(1 for unit in units if unit.get("validation_status") == "needs_review")
        checkpoint = {
            "command": "units --output " + str(output_dir),
            "source_page_count": len(pages),
            "page_record_count": len(pages),
            "represented_page_count": represented_pages,
            "empty_page_count": empty_pages,
            "unit_count": len(units),
            "content_type_counts": content_counts,
            "unresolved_unit_count": unresolved,
            "units_path": "units.jsonl",
            "units_sha256": units_sha256,
            "status": "WARNING" if unresolved else "PASS",
        }
        _checkpoint(output_dir, "units.json", checkpoint)
    except (OSError, ValueError, TypeError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
    return 0


def _source_table_detections(output_dir: Path, units: list[dict], pages: list[dict]) -> None:
    lock_path = output_dir / "source-lock.json"
    if not lock_path.exists():
        return
    try:
        with lock_path.open("r", encoding="utf-8") as stream:
            lock = json.load(stream)
        source_path = Path(lock.get("source_path", ""))
        if not source_path.is_absolute():
            source_path = _resolve(str(source_path))
        if lock.get("source_version") != SOURCE_VERSION or not source_path.exists():
            return
        import pymupdf
        table_pages = set()
        for page in pages:
            blocks = page.get("blocks")
            if not isinstance(blocks, list) or not isinstance(page.get("source_page_index"), int):
                continue
            if any(
                isinstance(block, dict)
                and isinstance(block.get("text"), str)
                and re.match(r"^\s*TABLEAU\b", block["text"], re.IGNORECASE)
                for block in blocks
            ):
                table_pages.add(page["source_page_index"])
        page_by_index = {page.get("source_page_index"): page for page in pages}
        document = pymupdf.open(source_path)
        try:
            for page_index in sorted(table_pages):
                if page_index not in page_by_index or page_index < 0 or page_index >= document.page_count:
                    continue
                page = document[page_index]
                detections = []
                try:
                    finder = page.find_tables()
                    for table in finder.tables:
                        extracted = table.extract()
                        cells = []
                        for row_index, row in enumerate(table.rows):
                            row_text = extracted[row_index] if row_index < len(extracted) else []
                            for column_index, bbox in enumerate(row.cells):
                                text = row_text[column_index] if column_index < len(row_text) else None
                                cells.append({"text": text, "bbox": list(bbox) if bbox is not None else None, "row": row_index, "column": column_index})
                        detections.append({"bbox": list(table.bbox) if table.bbox is not None else None, "cells": cells})
                except Exception:
                    detections = []
                page_by_index[page_index]["table_detections"] = detections
        finally:
            document.close()
    except (OSError, ValueError, TypeError, ImportError):
        return


def _command_visuals(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        units_path = output_dir / "units.jsonl"
        if not units_path.exists():
            raise ValueError("units are missing: " + str(units_path))
        units = read_jsonl(units_path)
        pages = _page_records_with_mapping(output_dir)
        _source_table_detections(output_dir, units, pages)
        candidates = extract_visual_candidates(units, pages)
        output_dir.mkdir(parents=True, exist_ok=True)
        visuals_path = output_dir / "visuals.jsonl"
        visuals_sha256 = write_jsonl(visuals_path, candidates)
        content_counts = dict(sorted(Counter(candidate.get("content_type", "unknown") for candidate in candidates).items()))
        continuation_count = sum(1 for candidate in candidates if candidate.get("continuation_of") is not None)
        unresolved = sum(1 for candidate in candidates if candidate.get("validation_status") == "needs_review")
        cell_count = sum(int(candidate.get("unresolved_cell_count", 0)) for candidate in candidates)
        checkpoint = {
            "command": "visuals --output " + str(output_dir),
            "visual_candidate_count": len(candidates),
            "content_type_counts": content_counts,
            "table_continuation_count": continuation_count,
            "unresolved_candidate_count": unresolved,
            "unresolved_cell_count": cell_count,
            "visuals_path": "visuals.jsonl",
            "visuals_sha256": visuals_sha256,
            "status": "WARNING" if unresolved or cell_count else "PASS",
        }
        _checkpoint(output_dir, "visuals.json", checkpoint)
    except (OSError, ValueError, TypeError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
    return 0


def _command_medications(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        units_path = output_dir / "units.jsonl"
        if not units_path.exists():
            raise ValueError("units are missing: " + str(units_path))
        units = read_jsonl(units_path)
        candidates = extract_medication_candidates(units)
        output_dir.mkdir(parents=True, exist_ok=True)
        medications_path = output_dir / "medications.jsonl"
        medications_sha256 = write_jsonl(medications_path, candidates)
        kind_counts = dict(sorted(Counter(candidate.get("candidate_kind", "unknown") for candidate in candidates).items()))
        numeric_count = sum(1 for candidate in candidates if "numeric_dose" in candidate.get("risk_flags", []))
        high_risk_count = sum(1 for candidate in candidates if any(flag in candidate.get("risk_flags", []) for flag in ("high_risk_treatment", "high_risk_source_language")))
        unresolved = sum(1 for candidate in candidates if candidate.get("validation_status") == "needs_review")
        checkpoint = {
            "command": "medications --output " + str(output_dir),
            "medication_candidate_count": len(candidates),
            "candidate_kind_counts": kind_counts,
            "numeric_candidate_count": numeric_count,
            "high_risk_candidate_count": high_risk_count,
            "unresolved_candidate_count": unresolved,
            "medications_path": "medications.jsonl",
            "medications_sha256": medications_sha256,
            "status": "WARNING" if unresolved else "PASS",
        }
        _checkpoint(output_dir, "medications.json", checkpoint)
    except (OSError, ValueError, TypeError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
    return 0


def _semantic_units(output_dir: Path) -> list[dict]:
    units_path = output_dir / "units.jsonl"
    if not units_path.exists():
        raise ValueError("units are missing: " + str(units_path))
    return read_jsonl(units_path)


def _semantic_unit_index(units: list[dict]) -> dict:
    index = {}
    for unit in units:
        unit_id = unit.get("unit_id") if isinstance(unit.get("unit_id"), str) else unit.get("id")
        if not isinstance(unit_id, str) or not unit_id:
            raise ValueError("unit has no stable unit_id")
        index[unit_id] = unit
    return index


def _validation_checkpoint_name(proposal_path: Path) -> str:
    match = re.match(r"^part-([a-z])-", proposal_path.name)
    return "semantic-part-" + match.group(1) + ".json" if match is not None else "semantic-validation.json"


def _command_validate_semantic(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    proposal_path = _resolve(args.proposal)
    try:
        units = _semantic_units(output_dir)
        summary = validate_proposal_file(proposal_path, _semantic_unit_index(units))
        if summary["proposal_count"] == 0:
            summary["valid_count"] = 0
            summary["error_count"] = 1
            summary["errors"].append(
                {
                    "line": 0,
                    "proposal_id": None,
                    "code": "empty_proposal_file",
                    "message": "proposal file is empty",
                }
            )
        checkpoint = {
            "book_id": "psychiatrie-clinique-tome-2-2016-tc-media",
            "source_version": SOURCE_VERSION,
            "proposal_path": str(proposal_path),
            "proposal_sha256": sha256_file(proposal_path),
            "units_path": "units.jsonl",
            "units_sha256": sha256_file(output_dir / "units.jsonl"),
            "proposal_count": summary["proposal_count"],
            "valid_count": summary["valid_count"],
            "error_count": summary["error_count"],
            "kind_counts": summary["kind_counts"],
            "review_count": summary["review_count"],
            "errors": summary["errors"],
            "status": "BLOCKED" if summary["error_count"] else ("WARNING" if summary["review_count"] else "PASS"),
        }
        _checkpoint(output_dir, _validation_checkpoint_name(proposal_path), checkpoint)
    except (ContractError, OSError, TypeError, ValueError) as error:
        blocked = {
            "book_id": "psychiatrie-clinique-tome-2-2016-tc-media",
            "source_version": SOURCE_VERSION,
            "proposal_path": str(proposal_path),
            "status": "BLOCKED",
            "error": str(error),
            "error_code": error.code if isinstance(error, ContractError) else "validation_input_error",
        }
        try:
            _checkpoint(output_dir, _validation_checkpoint_name(proposal_path), blocked)
        except (OSError, TypeError, ValueError):
            pass
        return _fail(str(error))
    sys.stdout.write(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
    return 1 if checkpoint["status"] == "BLOCKED" else 0


def _command_generate_semantic(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        summary = generate_semantic(output_dir)
    except (OSError, TypeError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return 0


def _command_audit_semantic(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        result = audit_semantic(output_dir)
        path = output_dir / "checkpoints" / "semantic-part-d-audit.json"
        write_json_atomic(path, result)
    except (OSError, TypeError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return 0 if result.get("status") == "PASS" else 1


def _command_replay_semantic(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    replay_path = _resolve(args.replay) if args.replay else output_dir / "work" / "replay" / "part-d-73-85.jsonl"
    try:
        result = replay_semantic(output_dir, replay_path)
    except (OSError, TypeError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    return 0 if result.get("match") else 1


def _command_merge_semantic(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        units = _semantic_units(output_dir)
        proposals_dir = output_dir / "semantic" / "proposals"
        if not proposals_dir.exists():
            raise ValueError("semantic proposal directory is missing: " + str(proposals_dir))
        proposal_paths = sorted(proposals_dir.glob("*.jsonl"))
        if not proposal_paths:
            raise ValueError("semantic proposal files are missing: " + str(proposals_dir))
        report = qa_merge_proposals(proposal_paths, units)
    except (ContractError, OSError, TypeError, ValueError) as error:
        blocked = {
            "book_id": "psychiatrie-clinique-tome-2-2016-tc-media",
            "source_version": SOURCE_VERSION,
            "status": "BLOCKED",
            "error": str(error),
            "error_code": error.code if isinstance(error, ContractError) else "merge_input_error",
        }
        try:
            _checkpoint(output_dir, "semantic-merge.json", blocked)
        except (OSError, TypeError, ValueError):
            pass
        return _fail(str(error))
    sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return 0


def _update_sdd_ledgers(output_dir: Path, qa_report: dict) -> None:
    try:
        qa_report_sha = sha256_file(output_dir / "qa-report.json")
    except (OSError, ValueError):
        qa_report_sha = None
    try:
        queue_sha = sha256_file(output_dir / "review-queue.json")
    except (OSError, ValueError):
        queue_sha = None
    try:
        with (output_dir / "semantic" / "merge-report.json").open("r", encoding="utf-8") as stream:
            merge_report = json.load(stream)
        merge_status = merge_report.get("status")
        merge_sha = sha256_file(output_dir / "semantic" / "merge-report.json")
    except (OSError, ValueError):
        merge_report = {}
        merge_status = "NOT RUN"
        merge_sha = None
    try:
        with (output_dir / "checkpoints" / "semantic-merge.json").open("r", encoding="utf-8") as stream:
            merge_checkpoint = json.load(stream)
        merge_counts = merge_checkpoint.get("kind_counts", {})
        merge_proposals_count = merge_checkpoint.get("proposal_count")
    except (OSError, ValueError):
        merge_counts = {}
        merge_proposals_count = None
    for ledger_name, report_name in (
        ("semantic-part-c-ledger.json", "semantic-part-c-report.json"),
        ("semantic-part-d-ledger.json", "semantic-part-d-report.json"),
    ):
        for filename in (ledger_name, report_name):
            path = output_dir / "checkpoints" / filename
            if not path.exists():
                continue
            try:
                with path.open("r", encoding="utf-8") as stream:
                    record = json.load(stream)
            except (OSError, ValueError):
                continue
            if not isinstance(record, dict):
                continue
            if record.get("book_id") != "psychiatrie-clinique-tome-2-2016-tc-media":
                continue
            record["merge_status"] = merge_status
            record["merge_report_path"] = "semantic/merge-report.json"
            record["merge_report_sha256"] = merge_sha
            record["merge_proposal_count"] = merge_proposals_count
            record["merge_kind_counts"] = merge_counts
            record["qa_verdict"] = qa_report.get("verdict")
            record["qa_report_path"] = "qa-report.json"
            record["qa_report_sha256"] = qa_report_sha
            record["review_queue_path"] = "review-queue.json"
            record["review_queue_sha256"] = queue_sha
            if record.get("approval_status") != "NOT APPROVED":
                record["approval_status"] = "NOT APPROVED"
            try:
                write_json_atomic(path, record)
            except (OSError, TypeError, ValueError):
                continue


def _command_qa(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        qa_report = run_qa(output_dir)
    except (OSError, ValueError) as error:
        return _fail(str(error))
    try:
        qa_report_sha = sha256_file(output_dir / "qa-report.json")
        queue_sha = sha256_file(output_dir / "review-queue.json")
    except (OSError, ValueError) as error:
        return _fail(str(error))
    counts = dict(sorted(Counter(check.get("status", "NOT RUN") for check in qa_report.get("checks", [])).items()))
    failing = sorted(check.get("id") for check in qa_report.get("checks", []) if check.get("status") in ("FAIL", "NOT RUN"))
    checkpoint = {
        "command": "qa --output " + str(output_dir),
        "timestamp": datetime.now().astimezone().isoformat(),
        "book_id": "psychiatrie-clinique-tome-2-2016-tc-media",
        "source_version": SOURCE_VERSION,
        "qa_report_path": "qa-report.json",
        "qa_report_sha256": qa_report_sha,
        "review_queue_path": "review-queue.json",
        "review_queue_sha256": queue_sha,
        "verdict": qa_report.get("verdict"),
        "counts_by_status": counts,
        "failing_check_ids": failing,
        "warning_check_ids": sorted(check.get("id") for check in qa_report.get("checks", []) if check.get("status") == "WARNING"),
        "review_item_count": qa_report.get("review_item_count", 0),
    }
    try:
        _checkpoint(output_dir, "qa.json", checkpoint)
        _update_sdd_ledgers(output_dir, qa_report)
    except (OSError, TypeError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
    return 0


def _parse_chapter_range(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"(\d{1,3})-(\d{1,3})", value)
    if match is None:
        raise ValueError("chapter range must use START-END")
    start = int(match.group(1))
    end = int(match.group(2))
    if end < start:
        raise ValueError("chapter range end must be >= start")
    return start, end


def _command_bundle(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        chapter_start, chapter_end = _parse_chapter_range(args.chapters)
        summary = create_chapter_bundle(output_dir, chapter_start, chapter_end)
    except (ContractError, OSError, TypeError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return 0


def _command_extract(args: argparse.Namespace) -> int:
    pdf_path = _resolve(args.pdf)
    output_dir = _resolve(args.output)
    try:
        _verify_locked_source(pdf_path, output_dir)
        summary = extract_pages(pdf_path, output_dir, resume=args.resume)
    except ValueError as error:
        return _fail(str(error))
    except OSError as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    if summary["missing_pages"] != 0:
        return _fail(
            "unrecoverable page failure: "
            + str(summary["missing_pages"])
            + " pages without a terminal checkpoint"
        )
    return 0


def _command_replay(args: argparse.Namespace) -> int:
    pdf_path = _resolve(args.pdf)
    output_dir = _resolve(args.output)
    replay_dir = _resolve(args.replay)
    try:
        report = replay_package(pdf_path, output_dir, replay_dir)
    except (OSError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    return 0 if report.get("match") else 1


def _command_freeze(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        qa_path = output_dir / "qa-report.json"
        if not qa_path.exists():
            return _fail("qa-report.json is missing: " + str(qa_path))
        with qa_path.open("r", encoding="utf-8") as stream:
            qa_report = json.load(stream)
        manifest = freeze_package(output_dir, qa_report)
    except (OSError, ValueError) as error:
        return _fail(str(error))
    try:
        manifest_sha = sha256_file(output_dir / "manifest.json")
    except (OSError, ValueError) as error:
        return _fail(str(error))
    checkpoint = {
        "command": "freeze --output " + str(output_dir),
        "timestamp": datetime.now().astimezone().isoformat(),
        "book_id": "psychiatrie-clinique-tome-2-2016-tc-media",
        "source_version": SOURCE_VERSION,
        "manifest_path": "manifest.json",
        "manifest_sha256": manifest_sha,
        "qa_verdict": manifest.get("qa_verdict"),
        "review_item_count": manifest.get("review_item_count"),
        "page_checkpoint_count": manifest.get("page_checkpoint_count"),
        "file_count": manifest.get("file_count"),
        "status": manifest.get("qa_verdict"),
    }
    try:
        _checkpoint(output_dir, "freeze.json", checkpoint)
    except (OSError, TypeError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(checkpoint, ensure_ascii=False, indent=2) + "\n")
    return 0


def _command_review_worklist(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        worklist = review_module.build_worklist(
            output_dir,
            review_class=args.review_class,
            limit=args.limit,
        )
    except (OSError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(worklist, ensure_ascii=False, indent=2) + "\n")
    return 0


def _command_review_adjudicate(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        record = review_module.adjudicate(
            output_dir,
            queue_id=args.queue_id,
            reviewer_identity=args.reviewer,
            human_disposition=args.disposition,
            review_note=args.note,
            supersedes=args.supersedes,
        )
    except (OSError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    return 0


def _command_review_batch_authorize(args: argparse.Namespace) -> int:
    output_dir = _resolve(args.output)
    try:
        record = review_module.authorize_batch(
            output_dir,
            doctor_identity=args.doctor_identity,
            authorization_scope=args.scope,
            approval_basis=args.basis,
            review_note=args.note,
        )
    except (OSError, ValueError) as error:
        return _fail(str(error))
    sys.stdout.write(json.dumps(record, ensure_ascii=False, indent=2) + "\n")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Book-local canonical ingestion for Tome 2 (Task 2)."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    register = subparsers.add_parser("register", help="Lock the frozen PDF source.")
    register.add_argument("--pdf", required=True, help="Path to the source PDF.")
    register.add_argument(
        "--output", required=True, help="Book-local output directory."
    )
    register.set_defaults(func=_command_register)

    extract = subparsers.add_parser("extract", help="Extract every page independently.")
    extract.add_argument("--pdf", required=True, help="Path to the source PDF.")
    extract.add_argument("--output", required=True, help="Book-local output directory.")
    extract.add_argument(
        "--resume",
        dest="resume",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Resume from matching checkpoints (use --no-resume for a full run).",
    )
    extract.set_defaults(func=_command_extract)

    repair_map = subparsers.add_parser(
        "repair-map", help="Build the verified glyph-repair map."
    )
    repair_map.add_argument("--pdf", required=True, help="Path to the source PDF.")
    repair_map.add_argument(
        "--output", required=True, help="Book-local output directory."
    )
    repair_map.set_defaults(func=_command_repair_map)

    repair = subparsers.add_parser(
        "repair", help="Apply verified glyph repairs to raw pages."
    )
    repair.add_argument(
        "--output", required=True, help="Book-local output directory."
    )
    repair.add_argument(
        "--resume",
        dest="resume",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="Resume from matching checkpoints (use --no-resume for a full run).",
    )
    repair.set_defaults(func=_command_repair)

    map_pages_parser = subparsers.add_parser(
        "map-pages", help="Map source pages to verified printed labels."
    )
    map_pages_parser.add_argument(
        "--output", required=True, help="Book-local output directory."
    )
    map_pages_parser.set_defaults(func=_command_map_pages)

    structure_parser = subparsers.add_parser(
        "structure", help="Build the Tome 2 structural hierarchy."
    )
    structure_parser.add_argument(
        "--output", required=True, help="Book-local output directory."
    )
    structure_parser.set_defaults(func=_command_structure)

    units_parser = subparsers.add_parser("units", help="Build typed content units.")
    units_parser.add_argument("--output", required=True, help="Book-local output directory.")
    units_parser.set_defaults(func=_command_units)

    visuals_parser = subparsers.add_parser("visuals", help="Extract visual candidates.")
    visuals_parser.add_argument("--output", required=True, help="Book-local output directory.")
    visuals_parser.set_defaults(func=_command_visuals)

    medications_parser = subparsers.add_parser("medications", help="Extract medication candidates.")
    medications_parser.add_argument("--output", required=True, help="Book-local output directory.")
    medications_parser.set_defaults(func=_command_medications)

    validate_semantic_parser = subparsers.add_parser(
        "validate-semantic", help="Validate one semantic proposal file."
    )
    validate_semantic_parser.add_argument("--output", required=True, help="Book-local output directory.")
    validate_semantic_parser.add_argument("--proposal", required=True, help="Proposal JSONL file.")
    validate_semantic_parser.set_defaults(func=_command_validate_semantic)

    merge_semantic_parser = subparsers.add_parser(
        "merge-semantic", help="Validate and merge all semantic proposal files."
    )
    merge_semantic_parser.add_argument("--output", required=True, help="Book-local output directory.")
    merge_semantic_parser.set_defaults(func=_command_merge_semantic)

    qa_parser = subparsers.add_parser(
        "qa", help="Run fail-closed QA and write the review queue."
    )
    qa_parser.add_argument("--output", required=True, help="Book-local output directory.")
    qa_parser.set_defaults(func=_command_qa)

    bundle_parser = subparsers.add_parser(
        "bundle", help="Create one approved Tome 2 semantic chapter bundle."
    )
    bundle_parser.add_argument("--output", required=True, help="Book-local output directory.")
    bundle_parser.add_argument("--chapters", required=True, help="Approved chapter range START-END.")
    bundle_parser.set_defaults(func=_command_bundle)

    generate_semantic_parser = subparsers.add_parser("generate-semantic", help="Generate the locked Part D semantic proposal.")
    generate_semantic_parser.add_argument("--output", required=True, help="Book-local output directory.")
    generate_semantic_parser.set_defaults(func=_command_generate_semantic)

    audit_semantic_parser = subparsers.add_parser("audit-semantic", help="Audit the locked Part D semantic proposal.")
    audit_semantic_parser.add_argument("--output", required=True, help="Book-local output directory.")
    audit_semantic_parser.set_defaults(func=_command_audit_semantic)

    replay_semantic_parser = subparsers.add_parser("replay-semantic", help="Regenerate the Part D proposal into work/replay.")
    replay_semantic_parser.add_argument("--output", required=True, help="Book-local output directory.")
    replay_semantic_parser.add_argument("--replay", default=None, help="Replay output path.")
    replay_semantic_parser.set_defaults(func=_command_replay_semantic)

    replay_parser = subparsers.add_parser("replay", help="Rerun deterministic stages into a separate replay directory and compare hashes.")
    replay_parser.add_argument("--pdf", required=True, help="Path to the source PDF.")
    replay_parser.add_argument("--output", required=True, help="Book-local output directory.")
    replay_parser.add_argument("--replay", required=True, help="Separate replay directory (e.g. TARGET/work/replay).")
    replay_parser.set_defaults(func=_command_replay)

    freeze_parser = subparsers.add_parser("freeze", help="Write manifest.json with terminal checkpoints and explicit QA verdict.")
    freeze_parser.add_argument("--output", required=True, help="Book-local output directory.")
    freeze_parser.set_defaults(func=_command_freeze)

    worklist_parser = subparsers.add_parser("review-worklist", help="Build deterministic resumable human-review worklist.")
    worklist_parser.add_argument("--output", required=True, help="Book-local output directory.")
    worklist_parser.add_argument("--review-class", required=False, default=None, help="Filter to one review class.")
    worklist_parser.add_argument("--limit", required=False, default=None, type=int, help="Limit written items.")
    worklist_parser.set_defaults(func=_command_review_worklist)

    adjudicate_parser = subparsers.add_parser("review-adjudicate", help="Append one human adjudication decision.")
    adjudicate_parser.add_argument("--output", required=True, help="Book-local output directory.")
    adjudicate_parser.add_argument("--queue-id", required=True, help="Queue item identifier.")
    adjudicate_parser.add_argument("--reviewer", required=True, help="Explicit reviewer identity (non-empty).")
    adjudicate_parser.add_argument("--disposition", required=True, help="Human disposition.")
    adjudicate_parser.add_argument("--note", required=True, help="Human review note (non-empty).")
    adjudicate_parser.add_argument("--supersedes", required=False, default=None, help="Previous record id for same queue_id.")
    adjudicate_parser.set_defaults(func=_command_review_adjudicate)

    batch_parser = subparsers.add_parser("review-batch-authorize", help="Append one batch authorization record (no individual adjudications).")
    batch_parser.add_argument("--output", required=True, help="Book-local output directory.")
    batch_parser.add_argument("--doctor-identity", required=True, help="Explicit doctor identity (non-empty).")
    batch_parser.add_argument("--scope", required=True, help="Authorization scope (non-empty).")
    batch_parser.add_argument("--basis", required=True, help="Approval basis (non-empty).")
    batch_parser.add_argument("--note", required=True, help="Batch review note (non-empty).")
    batch_parser.set_defaults(func=_command_review_batch_authorize)
    return parser


def main(argv: list | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
