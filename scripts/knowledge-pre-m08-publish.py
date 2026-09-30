# -*- coding: utf-8 -*-
"""Publish deterministic Pre-M08 contracts and reports.

Reads canonical-v2 and the six intermediate Pre-M08 rows. Writes only
knowledge/pre-m08/. It does not embed, activate, or edit source units.
"""
from __future__ import annotations

import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VD = ROOT / "knowledge" / "canonical-v2" / "stahl-prescribers-guide-7e-cup" / "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
OUT = ROOT / "knowledge" / "pre-m08"
BOOK_ID = "stahl-prescribers-guide-7e-cup"
SOURCE_HASH = "cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
CANONICAL_SOURCE_VERSION = "sha256:" + SOURCE_HASH
SCHEMA_VERSION = "pre-m08-retrieval-schema-v1"
ANSWERABILITY_VERSION = "pre-m08-answerability-v1"


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_text(path: Path, text: str) -> str:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(text)
    return digest(path)


def write_json(path: Path, value) -> str:
    return write_text(path, json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n")


def write_jsonl(path: Path, rows) -> str:
    return write_text(path, "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


book = load_json(VD / "book.json")
qa = load_json(VD / "qa-report.json")
qa_audit = load_json(VD / "review-queue-audit.json")
pages_map = load_json(VD / "pages.map.json")
units = []
for path in sorted(VD.glob("units-*.jsonl")):
    units.extend(load_jsonl(path))
units.sort(key=lambda row: row["id"])
unit_by_id = {row["id"]: row for row in units}
provenance = load_jsonl(OUT / "STHAL7-PROVENANCE-MAP.jsonl")
risk_rows = load_jsonl(OUT / "STHAL7-RISK-CLASSIFICATION.jsonl")
evidence_rows = load_jsonl(OUT / "STHAL7-EVIDENCE-STATUS.jsonl")
table_rows = load_jsonl(OUT / "STHAL7-TABLE-SAFETY.jsonl")
xref_rows = load_jsonl(OUT / "STHAL7-XREF-STATUS.jsonl")
queue_rows = load_jsonl(OUT / "STHAL7-CRITICAL-REVIEW-QUEUE.jsonl")
meds = load_jsonl(VD / "meds.jsonl")
concepts = load_jsonl(VD / "concepts.jsonl")

require(len(units) == 2662, f"canonical units: {len(units)}")
require(len(unit_by_id) == 2662, "canonical unit IDs are not unique")
require(len(provenance) == 2662, f"provenance rows: {len(provenance)}")
require(len(risk_rows) == 2662, f"risk rows: {len(risk_rows)}")
require(len(xref_rows) == 1073, f"xref rows: {len(xref_rows)}")
require(len(meds) == 152 and len(concepts) == 152, "metadata counts differ")
require(qa["counts"] == {"units": 2662, "tables": 0, "concepts": 152, "xrefs": 1073, "meds": 152}, "QA counts differ")
require(qa_audit["queue"]["total"] == 1100, "canonical review queue count differs")
require(qa_audit["xrefs"]["resolved"] == 1049 and qa_audit["xrefs"]["unresolved"] == 24, "xref gate counts differ")
require(book["source_version"] == CANONICAL_SOURCE_VERSION, "canonical source version differs")
require(pages_map["offset"] == 0, "page offset is not zero")
require(qa_audit["provenance"]["u_fffd_total"] == 0, "U+FFFD detected")

risk_counts = Counter(row["clinical_risk"] for row in risk_rows)
evidence_counts = Counter(row["evidence_status"] for row in evidence_rows)
defect_counts = Counter(defect["code"] for row in evidence_rows for defect in row["defects"])
table_counts = Counter(row["table_status"] for row in table_rows)
xref_counts = Counter(row["xref_status"] for row in xref_rows)
queue_priority_counts = Counter(str(row["priority"]) for row in queue_rows)
queue_kind_counts = Counter(row["kind"] for row in queue_rows)
mapping_counts = Counter(row["mapping_status"] for row in provenance)
format_counts = Counter(row["source_version_format"] for row in provenance)
folio_rows = [ref for row in provenance for ref in row["embedded_folio_refs"]]

require(mapping_counts == Counter({"CONFIRMED": 2662}), f"mapping statuses: {mapping_counts}")
require(folio_rows and all(row["mapping_status"] in {"CONFLICT", "UNRESOLVED"} for row in folio_rows), "folio references were silently resolved")
require(xref_counts == Counter({"RESOLVED": 1049, "POINTER_WITHIN_UNIT": 12, "TABLE_CAPTION_WITHIN_UNIT": 7, "TARGET_NOT_ATOMIZED": 5}), f"xref statuses: {xref_counts}")
require(sum(risk_counts.values()) == 2662, "risk total mismatch")
require(sum(evidence_counts.values()) == risk_counts["CRITICAL"] + risk_counts["HIGH"], "evidence coverage mismatch")
require(len(evidence_rows) == 2403, f"expected 2403 evidence rows, got {len(evidence_rows)}")
require(evidence_counts == Counter({"VERIFIED": 2306, "EVIDENCE_CONFLICT": 66, "QUARANTINED": 31}), f"evidence statuses: {evidence_counts}")
require(table_counts == Counter({"TABLE_INTACT": 364, "TABLE_PARTIAL": 2, "TABLE_UNSAFE_FOR_RETRIEVAL": 9}), f"table statuses: {table_counts}")



def unit_citation(unit_ids):
    rows = [unit_by_id[unit_id] for unit_id in sorted(set(unit_ids))]
    return {
        "source_id": book["source_identifier"],
        "edition": book["edition"],
        "source_version": CANONICAL_SOURCE_VERSION,
        "unit_ids": sorted(set(unit_ids)),
        "printed_pages": sorted({(row["printed_page_start"], row["printed_page_end"]) for row in rows}),
        "pdf_pages": sorted({(row["page_start"], row["page_end"]) for row in rows}),
        "citation_format": "Stahl Prescribers Guide 7e, section path, printed page, canonical unit ID",
    }


def proposal(item_id, category, question, state, unit_ids=(), note=""):
    ids = sorted(set(unit_ids))
    citation = unit_citation(ids) if ids else None
    return {
        "proposal_id": item_id,
        "category": category,
        "question": question,
        "expected_answer_scope": "PENDING_CLINICIAN_REVIEW: no clinical answer text is proposed",
        "expected_source": BOOK_ID if ids else None,
        "expected_unit_ids": ids,
        "expected_pages": citation["printed_pages"] if citation else [],
        "expected_citation": citation,
        "expected_answerability_state": state,
        "clinical_review_status": "PROPOSED_PENDING_CLINICIAN_REVIEW",
        "note": note,
    }


def find_unit(predicate, rows=None):
    return next(row for row in (rows or units) if predicate(row))


def unit_id_for(predicate, rows=None):
    return find_unit(predicate, rows)["id"]


def section_has(unit, terms):
    path = " / ".join(unit["structural_path"]).casefold()
    return any(term.casefold() in path for term in terms)


risk_by_id = {row["unit_id"]: row for row in risk_rows}
evidence_by_id = {row["unit_id"]: row for row in evidence_rows}
prov_by_id = {row["unit_id"]: row for row in provenance}
med_by_id = {row["med_id"]: row for row in meds}
concepts_by_id = {row["concept_id"]: row for row in concepts}
table_by_id = {row["unit_id"]: row for row in table_rows}
xref_by_id = {(row["from_unit"], row["target_text"]): row for row in xref_rows}
queue_ids = {row["id"] for row in queue_rows if row["kind"] == "unit"}


# Golden proposals are scope-only: no clinical answer text is invented.
proposals = []
def add(item_id, category, question, state, unit_ids=(), note=""):
    proposals.append(proposal(item_id, category, question, state, unit_ids, note))

add("G001", "direct medication facts", "What therapeutic statement does the source make for Acamprosate?", "SUPPORTED_DIRECT", ["stahl7-u-0024-003"])
add("G002", "dose", "What dose information is recorded for Acamprosate?", "SUPPORTED_DIRECT", ["stahl7-u-0027-006"])
add("G003", "maximum dose", "Which Acamprosate unit contains maximum-dose wording, if any?", "INSUFFICIENT_EVIDENCE", [], "No maximum-dose semantic label is asserted without clinician review.")
add("G004", "titration", "Does the source discuss titration for Acamprosate?", "PARTIALLY_SUPPORTED", ["stahl7-u-0028-007"], "Target scope only; not a clinical answer.")
add("G005", "indication", "What indication scope is represented in the Acamprosate therapeutic unit?", "SUPPORTED_DIRECT", ["stahl7-u-0024-003"])
add("G006", "contraindication", "Which Acamprosate unit is labelled Do Not Use?", "SUPPORTED_DIRECT", [unit_id_for(lambda unit: section_has(unit, ["Do Not Use"]) and unit["subject"] == "Acamprosate")])
add("G007", "precaution", "Which Acamprosate side-effect/precaution units are represented?", "SUPPORTED_SYNTHESIS", [row["unit_id"] for row in risk_rows if row["monograph"] == "Acamprosate" and row["semantic_domain"] in {"precaution", "adverse-effect"}][:3])
add("G008", "interaction", "What interaction evidence is recorded for Alprazolam?", "SUPPORTED_DIRECT", [unit_id_for(lambda unit: unit["subject"] == "Alprazolam" and unit["semantic_domain"] == "interaction")])
add("G009", "pregnancy", "Which Acamprosate unit carries pregnancy information?", "SUPPORTED_DIRECT", [unit_id_for(lambda unit: unit["subject"] == "Acamprosate" and unit["semantic_domain"] == "pregnancy-lactation")])
add("G010", "lactation", "Which Acamprosate unit carries breast-feeding information?", "PARTIALLY_SUPPORTED", [unit_id_for(lambda unit: unit["subject"] == "Acamprosate" and unit["semantic_domain"] == "pregnancy-lactation")])
add("G011", "population-specific question", "Which Acamprosate unit addresses children and adolescents?", "SUPPORTED_DIRECT", [unit_id_for(lambda u: u["subject"] == "Acamprosate" and section_has(u, ["Children and Adolescents"]))])
add("G012", "table lookup", "Which dose-bearing units are explicitly audited as TABLE_INTACT?", "SUPPORTED_DIRECT", [r["unit_id"] for r in table_rows if r["table_status"] == "TABLE_INTACT"][:3], "Lookup target is structural, not a clinical dose assertion.")
add("G013", "page lookup", "Which source evidence is recorded for the first Acamprosate therapeutic unit?", "SUPPORTED_DIRECT", ["stahl7-u-0024-001"])
add("G014", "cross-reference", "What target is recorded for the resolved Acamprosate see-Warnings pointer?", "SUPPORTED_SYNTHESIS", [r["from_unit"] for r in xref_rows if r["xref_status"] == "RESOLVED"][:2], "A resolved xref is not medical support for a new claim.")
add("G015", "synonym/brand query", "Which Acamprosate concept aliases are recorded in the canonical concept metadata?", "SUPPORTED_DIRECT", ["stahl7-u-0024-001"], "Metadata lookup only; aliases are not rewritten evidence.")
add("G016", "French query", "Quels éléments de source sont disponibles pour une question en français ?", "AMBIGUOUS_QUERY", [], "Interface language support and query intent require clinician/interface review.")
add("G017", "Arabic query", "ما وحدة المصدر التي تملك أدلة قابلة للتحقق لهذه الاستفسار؟", "AMBIGUOUS_QUERY", [], "No Arabic clinical answer is proposed; language handling is an interface test.")



# ---- derived retrieval record specification (design only; no records or embeddings) ----
retrieval_schema = {
    "schema_name": "STHAL7-RETRIEVAL-SCHEMA",
    "schema_version": SCHEMA_VERSION,
    "purpose": "Specification for a future derived retrieval view; canonical units remain authoritative.",
    "canonical_hierarchy": ["Book", "Edition", "Monograph/Topic", "Section", "KnowledgeUnit", "Evidence"],
    "canonical_unit_invariant": "All 2662 canonical knowledge_unit_id values remain present; no canonical unit is replaced by a chunk.",
    "record_fields": {
        "knowledge_unit_id": {"type": "string", "required": True, "canonical": True},
        "book_id": {"type": "string", "required": True, "value": BOOK_ID},
        "edition_id": {"type": "string", "required": True, "derivation": "stable digest of book_id + edition"},
        "source_version": {"type": "string", "required": True, "value": CANONICAL_SOURCE_VERSION, "note": "format ambiguity is documented; raw unit form is retained elsewhere"},
        "language": {"type": "string", "required": True, "value": "en"},
        "topic": {"type": "string|null", "required": True, "source": "monograph/topic metadata"},
        "monograph": {"type": "string|null", "required": True},
        "section_path": {"type": "array[string]", "required": True, "min_items": 3, "preserve_hierarchy": True},
        "section_type": {"type": "string", "required": True, "allowed": ["front-matter", "therapeutics", "dosing-and-use", "side-effects", "special-populations", "switching", "art-of-psychopharmacology", "back-matter", "unmapped"]},
        "population": {"type": "string|null", "required": True},
        "medication_entity_ids": {"type": "array[string]", "required": True, "may_be_empty": True},
        "knowledge_type": {"type": "string", "required": True, "note": "metadata classification; source evidence unchanged"},
        "clinical_risk": {"type": "enum", "required": True, "values": ["CRITICAL", "HIGH", "NORMAL"]},
        "evidence_status": {"type": "enum", "required": True, "values": ["VERIFIED", "EVIDENCE_CONFLICT", "QUARANTINED"]},
        "review_status": {"type": "string", "required": True},
        "printed_page": {"type": "object", "required": True, "keys": ["start", "end"], "value_type": "string"},
        "pdf_page": {"type": "object", "required": True, "keys": ["start", "end"], "value_type": "integer"},
        "source_hash": {"type": "string", "required": True, "value": SOURCE_HASH},
        "parent_unit_id": {"type": "string|null", "required": True},
        "related_unit_ids": {"type": "array[string]", "required": True, "may_be_empty": True},
        "xref_ids": {"type": "array[string]", "required": True, "may_be_empty": True},
        "retrieval_eligibility": {"type": "enum", "required": True, "values": ["STRUCTURALLY_ELIGIBLE_PENDING_SOURCE_ACTIVATION", "PENDING_CLINICAL_REVIEW", "BLOCKED_EVIDENCE", "BLOCKED_TABLE"]},
        "evidence": {"type": "object", "required": True, "keys": ["sha256", "chars", "lines", "location"], "location": "segment plus printed/PDF page range"},
    },
    "risk_rules": {
        "CRITICAL": ["dose", "maximum dose", "titration", "contraindication", "warning", "serious adverse effect", "drug interaction", "pregnancy", "lactation", "pediatric/geriatric/renal/hepatic dosing", "overdose/toxicity", "emergency information"],
        "HIGH": ["indication", "population", "major precaution", "monitoring", "switching", "treatment duration", "discontinuation"],
        "NORMAL": ["descriptive/classification", "terminology", "non-critical context"],
        "implementation": "pre-m08-risk-rules-v1; deterministic metadata only",
    },
    "evidence_and_table_gate": {
        "answerable_evidence": ["VERIFIED", "QUARANTINED (only for diagnostic explanation, never as clinical support)"],
        "clinical_retrieval_requires": ["VERIFIED", "TABLE_INTACT or TABLE_RECONSTRUCTED_FROM_GEOMETRY with complete row/column evidence", "authorized source/version", "valid page provenance", "adequate evidence for the question", "no unresolved critical conflict", "mandatory citation"],
        "unsafe": ["EVIDENCE_CONFLICT", "QUARANTINED", "TABLE_PARTIAL", "TABLE_UNSAFE_FOR_RETRIEVAL", "PROVENANCE_UNSAFE"],
        "no_guess": "Defective evidence is never repaired, paraphrased, merged or clinically corrected by this layer.",
    },
    "chunking_rules": [
        "Canonical 2662 units remain source of truth.",
        "A derived chunk may group tightly related canonical units for clinical completeness and must list every underlying knowledge_unit_id.",
        "A chunk with no underlying canonical unit ID is invalid.",
        "A chunk's eligibility is the weakest member eligibility.",
        "Preserve monograph, section, subsection and table relationships in fields and evidence references.",
        "Unresolved xrefs are searchable as explicit records but must not create guessed targets or support new claims.",
    ],
    "xref_status_values": ["RESOLVED", "POINTER_WITHIN_UNIT", "TABLE_CAPTION_WITHIN_UNIT", "TARGET_NOT_ATOMIZED", "UNRESOLVED", "CONFLICT"],
    "prohibitions": ["no embedding", "no vector write", "no production retrieval activation", "no lifecycle change", "no clinical authority decision", "no cross-book xref resolution"],
    "activation_status": "NOT_GRANTED",
}


