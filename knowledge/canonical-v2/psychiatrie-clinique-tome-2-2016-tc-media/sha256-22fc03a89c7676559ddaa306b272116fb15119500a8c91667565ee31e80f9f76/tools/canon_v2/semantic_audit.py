from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from .semantic_part_d import (
    BOOK_ID,
    SOURCE_VERSION,
    chapter_number,
    is_nonclinical_unit,
    read_jsonl,
    source_block,
    source_qualifiers,
    source_span_key,
    temporal_qualifier,
)

APPROVED = {
    "part-a-49-54.jsonl": (49, 54),
    "part-b-55-65.jsonl": (55, 65),
    "part-c-66-72.jsonl": (66, 72),
    "part-d-73-85.jsonl": (73, 85),
}
AGE_CLOSED = {"nouveau-né", "enfant", "enfants", "adolescent", "adolescents", "enfants et adolescents", "adulte", "adultes", "personne âgée", "personnes Verge", "personnes âgées", "65 ans et plus", "plus de 60 ans"}
COORDINATED_OBJECT_PATTERNS = {
    "non_seulement_mais_aussi": re.compile(r"(?is)\bnon\s+seulement\b.*\bmais\s+(?:aussi|encore)\b"),
    "a_la_fois_et": re.compile(r"(?is)\bà\s+la\s+fois\b.*\bet\b"),
    "adversative": re.compile(r"(?is)\b(?:cependant|pourtant|néanmoins|toutefois)\b"),
    "bare_conjunction": re.compile(r"(?is)\bet\b"),
    "addition": re.compile(r"(?is)\b(?:ainsi|également|également)\s+que\b"),
}
PRIVATE_USE_RE = re.compile(r"[\ue000-\uf8ff]")


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def add(errors: list[dict], code: str, detail: dict) -> None:
    errors.append({"code": code, **detail})


def locked_candidates(rows: list[dict]) -> tuple[dict[str, tuple[str, dict, dict]], list[dict]]:
    by_page_block = defaultdict(list)
    for row in rows:
        for block in row["unit"].get("data", {}).get("block_records", []):
            by_page_block[(block["source_page_index"], block["block_index"])].append(row["unit"])
    candidates = {}
    unresolved = []
    for row in rows:
        original = row["unit"]
        for kind, key in (("medication", "medication_candidates"), ("visual_review", "visual_candidates")):
            for candidate in row.get(key, []):
                matches = by_page_block.get(source_span_key(candidate), [])
                host = original if any(unit["unit_id"] == original["unit_id"] for unit in matches) else (matches[0] if matches else None)
                candidates[candidate["candidate_id"]] = (kind, candidate, host)
                if host is None:
                    unresolved.append({"candidate_id": candidate["candidate_id"], "kind": kind, "source_span": candidate.get("source_span"), "reason": "no_locked_unit_contains_candidate_page_block"})
    return candidates, unresolved


def check_source_provenance(record: dict, unit: dict, errors: list[dict]) -> None:
    span = record.get("source_span", {})
    block = source_block(unit, span.get("source_page_index"), span.get("block_index")) if unit else None
    if block is None:
        add(errors, "provenance_block_missing", {"proposal_id": record.get("proposal_id"), "unit_id": record.get("unit_id"), "source_span": span})
        return
    text = block.get(record.get("source_layer", "raw") + "_text")
    if record.get("source_text") != text[span.get("start_offset", -1):span.get("end_offset", -1)]:
        add(errors, "provenance_text_or_offsets", {"proposal_id": record.get("proposal_id"), "unit_id": record.get("unit_id")})
    if record.get("source_page_index_start") != block.get("source_page_index") or record.get("source_page_index_end") != block.get("source_page_index"):
        add(errors, "provenance_page", {"proposal_id": record.get("proposal_id"), "unit_id": record.get("unit_id")})
    if record.get("printed_page_start") != block.get("printed_page_number") or record.get("printed_page_end") != block.get("printed_page_number"):
        add(errors, "provenance_printed_page", {"proposal_id": record.get("proposal_id"), "unit_id": record.get("unit_id")})
    occurrence = text[span.get("start_offset", -1):span.get("end_offset", -1)]
    if record.get("source_occurrence", 1) < 1 or text[:span.get("start_offset", 0)].count(occurrence) + 1 != record.get("source_occurrence"):
        add(errors, "provenance_occurrence", {"proposal_id": record.get("proposal_id"), "unit_id": record.get("unit_id")})


def check_candidate_alignment(record: dict, candidate: tuple[str, dict, dict | None], errors: list[dict]) -> None:
    kind, locked, host = candidate
    if host is None or record.get("unit_id") != host["unit_id"]:
        add(errors, "candidate_host_alignment", {"proposal_id": record.get("proposal_id"), "candidate_id": record.get("candidate_id"), "expected_unit_id": host.get("unit_id") if host else None, "actual_unit_id": record.get("unit_id")})
    for field in ("source_page_index_start", "source_page_index_end", "printed_page_start", "printed_page_end"):
        if record.get(field) != locked.get(field):
            add(errors, "candidate_field_alignment", {"proposal_id": record.get("proposal_id"), "candidate_id": record.get("candidate_id"), "field": field, "expected": locked.get(field), "actual": record.get(field)})
    if record.get("candidate_source_span") != locked.get("source_span"):
        add(errors, "candidate_source_span", {"proposal_id": record.get("proposal_id"), "candidate_id": record.get("candidate_id")})
    if record.get("source_text") != locked.get("raw_text"):
        add(errors, "candidate_exact_text", {"proposal_id": record.get("proposal_id"), "candidate_id": record.get("candidate_id")})
    for field in (("source_name_text", "brand_name_text", "dose_text", "dose_unit_text", "route_text", "frequency_text") if kind == "medication" else ("caption", "content_type")):
        if record.get(field) != locked.get(field):
            add(errors, "candidate_payload_alignment", {"proposal_id": record.get("proposal_id"), "candidate_id": record.get("candidate_id"), "field": field, "expected": locked.get(field), "actual": record.get(field)})


def claim_safety(claims: list[dict]) -> dict:
    truncated_citations = 0
    fragments = 0
    multi_predicates = 0
    substring_subjects = 0
    coordinated_objects = 0
    coordinated_offenders: list[str] = []
    coordination_hits: Counter = Counter()
    for record in claims:
        evidence = record.get("evidence_or_recommendation_wording", "")
        object_text = record.get("object", "")
        subject = record.get("subject", "")
        if re.search(r"(?i)(?:\bal|etc)\s*$", object_text):
            truncated_citations += 1
        if re.search(r"(?i)^a\s+remédiation cognitive|^[,;]|(?:^|\s)etc\s*$", evidence):
            fragments += 1
        if re.search(r"(?i),\s*(?:il|elle|on)\s+(?:est|sont|peut|doit|devroit|devrait)\b|\bcorrespond\b", object_text):
            multi_predicates += 1
        if subject in {"intervention", "traitement", "approche"} and not re.search(rf"(?i)(?:ce type d’|cette\s+|l’|le\s+|la\s+){re.escape(subject)}", evidence):
            substring_subjects += 1
        matched = [name for name, pattern in COORDINATED_OBJECT_PATTERNS.items() if pattern.search(object_text)]
        if matched:
            coordinated_objects += 1
            coordination_hits.update(matched)
            coordinated_offenders.append(record.get("proposal_id"))
    total = truncated_citations + fragments + multi_predicates + substring_subjects + coordinated_objects
    return {
        "claim_count": len(claims),
        "truncated_citation_count": truncated_citations,
        "fragment_count": fragments,
        "multi_predicate_count": multi_predicates,
        "substring_subject_count": substring_subjects,
        "coordinated_object_count": coordinated_objects,
        "coordinated_object_patterns": dict(sorted(coordination_hits.items())),
        "coordinated_object_proposal_ids": coordinated_offenders,
        "status": "PASS" if total == 0 else "FAIL",
    }



def tome2_structure_chapters(output_dir: Path) -> set[int]:
    path = output_dir / "units.jsonl"
    if not path.exists():
        return set()
    chapters = set()
    for unit in read_jsonl(path):
        number = chapter_number(unit.get("structural_path"))
        if number is not None and 49 <= number <= 85:
            chapters.add(number)
    return chapters


def check_xref_structure(record: dict, structure_chapters: set[int], errors: list[dict]) -> bool:
    if record.get("kind") != "xref":
        return False
    if record.get("target_scope") != "tome-2" or record.get("xref_status") != "resolved":
        return False
    target = str(record.get("target") or "").strip()
    chapter_match = re.fullmatch(r"(?i)chapitre\s+(\d+)", target)
    tome_match = re.fullmatch(r"(?i)tome\s*(\d+)", target)
    if chapter_match is not None:
        if int(chapter_match.group(1)) not in structure_chapters:
            add(errors, "xref_structure_existence", {"proposal_id": record.get("proposal_id"), "target": target, "reason": "chapter is absent from the locked Tome 2 structure"})
            return True
    elif tome_match is not None:
        if not structure_chapters:
            add(errors, "xref_structure_existence", {"proposal_id": record.get("proposal_id"), "target": target, "reason": "Tome 2 structure is empty"})
            return True
    else:
        add(errors, "xref_structure_existence", {"proposal_id": record.get("proposal_id"), "target": target, "reason": "resolved Tome 2 target has no verifiable structure form"})
        return True
    return False


def review_only_known_issues(proposals: list[dict]) -> dict:
    visual_groups: dict[tuple, list[dict]] = defaultdict(list)
    for record in proposals:
        if record.get("kind") == "visual_review":
            visual_groups[(record.get("source_page_index_start"), record.get("source_text"))].append(record)
    duplicate_groups = [group for group in visual_groups.values() if len(group) > 1]
    duplicate_records = [record for group in duplicate_groups for record in group]
    empty_name = [
        record
        for record in proposals
        if record.get("kind") == "medication" and not str(record.get("source_name_text") or "").strip()
    ]
    private_use = [
        record
        for record in proposals
        if record.get("kind") == "claim" and PRIVATE_USE_RE.search(str(record.get("object") or ""))
    ]
    flagged = duplicate_records + empty_name
    not_review = sorted(record.get("proposal_id") for record in flagged if record.get("validation_status") != "needs_review")
    return {
        "duplicate_visual_review_group_count": len(duplicate_groups),
        "duplicate_visual_review_record_count": len(duplicate_records),
        "empty_medication_name_candidate_count": len(empty_name),
        "flagged_record_count": len(flagged),
        "not_needing_review_proposal_ids": not_review,
        "source_private_use_claim_object_count": len(private_use),
        "source_private_use_claim_proposal_ids": sorted(record.get("proposal_id") for record in private_use),
        "disposition": "review-only: duplicate visual reviews are not deduplicated and empty medication names are not inferred",
        "source_private_use_disposition": "review-only: the locked source encodes the fi ligature as U+E00E, so source-exact claim objects keep that private-use character and are not normalized",
        "status": "PASS" if not not_review else "FAIL",
    }


def audit(output_dir: Path) -> dict:
    rows = read_jsonl(output_dir / "work" / "chapters" / "part-d-73-85.jsonl")
    proposal_path = output_dir / "semantic" / "proposals" / "part-d-73-85.jsonl"
    proposals = read_jsonl(proposal_path) if proposal_path.exists() else []
    units = {row["unit"]["unit_id"]: row["unit"] for row in rows}
    proposal_units = {record["unit_id"] for record in proposals}
    errors = []
    coverage = [record for record in proposals if record.get("kind") == "coverage"]
    coverage_by_unit = {record["unit_id"]: record for record in coverage}
    if len(rows) != 250 or len(coverage) != 250 or set(coverage_by_unit) != set(units):
        add(errors, "coverage_scope", {"executable_count": len(rows), "actual_coverage_count": len(coverage), "missing": sorted(set(units) - set(coverage_by_unit)), "extra": sorted(set(coverage_by_unit) - set(units))})
    for record in proposals:
        unit = units.get(record.get("unit_id"))
        if unit is None:
            add(errors, "proposal_unit_scope", {"proposal_id": record.get("proposal_id"), "unit_id": record.get("unit_id")})
            continue
        if chapter_number(record.get("structural_path")) not in range(73, 86):
            add(errors, "proposal_chapter_scope", {"proposal_id": record.get("proposal_id"), "structural_path": record.get("structural_path")})
        if record.get("validation_status") != "needs_review":
            add(errors, "review_status", {"proposal_id": record.get("proposal_id")})
        check_source_provenance(record, unit, errors)
    candidates, unresolved_candidates = locked_candidates(rows)
    candidate_records = {record.get("candidate_id"): record for record in proposals if record.get("kind") in {"medication", "visual_review"}}
    if set(candidate_records) != set(candidates):
        add(errors, "candidate_set", {"missing": sorted(set(candidates) - set(candidate_records)), "extra": sorted(set(candidate_records) - set(candidates))})
    for candidate_id, candidate in candidates.items():
        record = candidate_records.get(candidate_id)
        if record is not None:
            check_candidate_alignment(record, candidate, errors)
    claims = [record for record in proposals if record.get("kind") == "claim"]
    subject_errors = []
    age_errors = []
    for record in claims:
        subject = record.get("subject", "")
        source = record.get("source_text", "")
        if subject.casefold() not in source.casefold() or record.get("object") not in source or len(record.get("object", "")) > 300 or record.get("clinical_domain") != "Traitements psychosociaux":
            subject_errors.append(record.get("proposal_id"))
        expected_age, expected_population = source_qualifiers(record.get("evidence_or_recommendation_wording", ""))
        expected_temporal = temporal_qualifier(record.get("evidence_or_recommendation_wording", ""))
        if record.get("age_group") != expected_age or record.get("population") != expected_population or record.get("temporal_qualifier") != expected_temporal:
            age_errors.append(record.get("proposal_id"))
    if subject_errors:
        add(errors, "subject_safety", {"proposal_ids": subject_errors})
    if age_errors:
        add(errors, "age_temporal", {"proposal_ids": age_errors})
    claim_safety_result = claim_safety(claims)
    if claim_safety_result["status"] != "PASS":
        add(errors, "claim_safety", claim_safety_result)
    structure_chapters = tome2_structure_chapters(output_dir)
    xref_structure_checked = 0
    xref_structure_errors = 0
    for record in proposals:
        if record.get("kind") == "xref" and record.get("target_scope") == "tome-2" and record.get("xref_status") == "resolved":
            xref_structure_checked += 1
        if check_xref_structure(record, structure_chapters, errors):
            xref_structure_errors += 1
    known_issues = review_only_known_issues(proposals)
    if known_issues["status"] != "PASS":
        add(errors, "review_only_known_issues", known_issues)
    classification_errors = []
    for unit_id, unit in units.items():
        expected = "not_clinical" if is_nonclinical_unit(unit) else "covered"
        if coverage_by_unit.get(unit_id, {}).get("coverage_status") != expected:
            classification_errors.append(unit_id)
    if classification_errors:
        add(errors, "unit_classification", {"unit_ids": classification_errors})
    kind_counts = dict(sorted(Counter(record.get("kind") for record in proposals).items()))
    classification_counts = Counter(record.get("coverage_status") for record in coverage)
    result = {
        "book_id": BOOK_ID,
        "source_version": SOURCE_VERSION,
        "checkpoint_reference": "checkpoints/semantic-part-d.json",
        "proposal_reference": "semantic/proposals/part-d-73-85.jsonl",
        "bundle_reference": "work/chapters/part-d-73-85.jsonl",
        "scope": {
            "executable_unit_count": len(rows),
            "coverage_count": len(coverage),
            "proposal_count": len(proposals),
            "chapter_counts": dict(sorted(Counter(str(chapter_number(row["unit"].get("structural_path"))) for row in rows).items())),
        },
        "kind_counts": kind_counts,
        "coverage": {
            "expected_count": 250,
            "actual_count": len(coverage),
            "covered_count": classification_counts.get("covered", 0),
            "not_clinical_count": classification_counts.get("not_clinical", 0),
            "status": "PASS" if len(coverage) == 250 and set(coverage_by_unit) == set(units) else "FAIL",
        },
        "provenance": {
            "checked_count": len(proposals),
            "status": "PASS" if not any(error["code"].startswith("provenance_") for error in errors) else "FAIL",
        },
        "candidate_alignment": {
            "checked_count": len(candidates),
            "aligned_count": len(candidates) - len(unresolved_candidates) - sum(1 for error in errors if error["code"] == "candidate_host_alignment"),
            "unresolved_count": len(unresolved_candidates),
            "unresolved_candidates": unresolved_candidates,
            "status": "PASS" if not any(error["code"].startswith("candidate_") for error in errors) and not unresolved_candidates else "FAIL",
        },
        "subject_safety": {
            "claim_count": len(claims),
            "status": "PASS" if not subject_errors else "FAIL",
        },
        "age_temporal": {
            "claim_count": len(claims),
            "status": "PASS" if not age_errors else "FAIL",
        },
        "claim_safety": claim_safety_result,
        "xref_structure": {
            "checked_count": xref_structure_checked,
            "error_count": xref_structure_errors,
            "tome2_structure_chapter_count": len(structure_chapters),
            "status": "PASS" if not xref_structure_errors else "FAIL",
        },
        "review_only_known_issues": known_issues,
        "classification": {
            "checked_count": len(units),
            "covered_count": classification_counts.get("covered", 0),
            "not_clinical_count": classification_counts.get("not_clinical", 0),
            "status": "PASS" if not classification_errors else "FAIL",
        },
        "errors": errors,
        "status": "PASS" if not errors else "FAIL",
    }
    return result
