import hashlib
import json
import re
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.canon_v2.constants import BOOK_ID, SOURCE_VERSION
from tools.canon_v2.semantic_contract import (
    ContractError,
    _verify_candidate_page,
    create_chapter_bundle,
    merge_proposals,
    validate_proposal,
    validate_proposal_file,
)
from tools.canon_v2.serialization import read_jsonl, write_json, write_jsonl
from tools.ingest_book import main


def is_closed_age_group(value):
    if value in {
        "nouveau-né",
        "enfant",
        "enfants",
        "adolescent",
        "adolescents",
        "enfants et adolescents",
        "adulte",
        "adultes",
        "personne âgée",
        "personnes âgées",
    }:
        return True
    return bool(
        re.fullmatch(
            r"(?:à\s+)?\d+\s*(?:an|ans|mois)|\d+\s*(?:à|-|et)\s*\d+\s*(?:ans|mois)|(?:avant|après|à partir de|plus de|moins de)\s+\d+\s*(?:ans|mois)|\d+\s+ans\s+et\s+plus",
            value or "",
            re.IGNORECASE,
        )
    )


def source_clauses(text):
    normalized = " ".join(text.split())
    return [clause.strip() for clause in re.split(r"(?<=[.!?])\s+|;\s+", normalized) if clause.strip()]


def classify_age_group(text, scope_text=None):
    normalized = " ".join(text.split())
    clauses = source_clauses(normalized)
    scope = " ".join((scope_text if scope_text is not None else clauses[0] if clauses else normalized).split())
    scope = re.sub(r"\bavant\s+l’âge adulte\b", "", scope, flags=re.IGNORECASE)
    if re.search(r"\bpersonnes?\s+âgées?\b", scope, re.IGNORECASE):
        return "personne âgée" if re.search(r"\bpersonne âgée\b", scope, re.IGNORECASE) else "personnes âgées"
    if re.search(r"\bpatients?\s+âgés?\b|\baînés?\b", scope, re.IGNORECASE):
        return "personnes âgées"
    if re.search(r"\bnouveau[- ]né(?:e|s)?\b", scope, re.IGNORECASE):
        return "nouveau-né"
    if re.search(r"\b\d+\s*(?:à|-|et)\s*\d+\s*(?:ans|mois)\b|\b(?:avant|après|à partir de|plus de|moins de)\s+\d+\s*(?:ans|mois)\b|\b\d+\s+ans\s+et\s+plus\b", scope, re.IGNORECASE):
        return re.search(r"\d+\s*(?:à|-|et)\s*\d+\s*(?:ans|mois)|(?:avant|après|à partir de|plus de|moins de)\s+\d+\s*(?:ans|mois)|\d+\s+ans\s+et\s+plus", scope, re.IGNORECASE).group(0)
    if re.search(r"\b(?:à|de)\s+\d+\s*(?:an|ans|mois)\b", scope, re.IGNORECASE):
        return re.search(r"\b(?:à|de)\s+\d+\s*(?:an|ans|mois)\b", scope, re.IGNORECASE).group(0).replace("à ", "", 1).replace("de ", "", 1)
    if re.search(r"\bpetite enfance\b", scope, re.IGNORECASE):
        return "enfant"
    if re.search(r"\benfants? d’âge scolaire\b|\bpetite enfance\b|\benfance\b", scope, re.IGNORECASE) and re.search(r"\badolescents?\b|\badolescence\b", scope, re.IGNORECASE):
        return "enfants et adolescents"
    if re.search(r"\bfin de l’adolescence\b|\badolescents?\b|\badolescence\b", scope, re.IGNORECASE):
        return "adolescents"
    if re.search(r"\bchez\s+les\s+adultes?\b|\bpatients?\s+adultes?\b", scope, re.IGNORECASE):
        return "adultes" if re.search(r"\bchez\s+les\s+adultes\b|\bpatients?\s+adultes\b", scope, re.IGNORECASE) else "adulte"
    if re.search(r"\bchez\s+l’adulte\b|\bà l’âge adulte\b", scope, re.IGNORECASE):
        return "adulte"
    if re.search(r"\benfants?\b|\benfant\b", scope, re.IGNORECASE):
        return "enfants"
    if re.search(r"\badultes\b", scope, re.IGNORECASE):
        return "adultes"
    if re.search(r"\badulte\b", scope, re.IGNORECASE):
        return "adulte"
    if re.search(r"\bâge de l’enfant\b", scope, re.IGNORECASE):
        return "enfant"
    return None


def explicit_age_scope(text):
    normalized = re.sub(r"\bavant\s+l’âge adulte\b", "", " ".join(text.split()), flags=re.IGNORECASE)
    patterns = (
        r"\b(?:à|de|à partir de|après|avant)\s+\d+\s*(?:an|ans|mois)\b",
        r"\bâge\s+(?:du|de|des)\s+\d+\s*(?:an|ans|mois)\b",
        r"\b\d+\s*(?:à|-|et)\s*\d+\s*(?:ans|mois)\b",
        r"\b(?:avant|après|à partir de|plus de|moins de)\s+\d+\s*(?:ans|mois)\b",
        r"\b\d+\s+ans\s+et\s+plus\b",
        r"\bnouveau[- ]né(?:e|s)?\b",
        r"\b(?:petite\s+)?enfance\b",
        r"\badolescence\b",
        r"\b(?:fin|à\s+la\s+fin)\s+de\s+l’adolescence\b",
        r"\bâge\s+(?:du|de|des)\s+(?:l’|la\s+|le\s+)?(?:patient|enfant|adolescent|personne|bébé|nouveau[- ]né)\b",
        r"\bpersonnes?\s+âgées?\b",
        r"\bpatients?\s+âgés?\b",
        r"\baînés?\b",
        r"\b(?:enfants?|adolescents?|adulte|adultes)\b",
    )
    return any(re.search(pattern, normalized, re.IGNORECASE) for pattern in patterns)


class SemanticContractTests(unittest.TestCase):
    def setUp(self):
        self.structural_path = "Partie 5/Spécialités psychiatriques/Chapitre 49"
        self.unit = {
            "unit_id": "unit-49-1",
            "book_id": BOOK_ID,
            "source_version": SOURCE_VERSION,
            "source_page_index_start": 19,
            "source_page_index_end": 19,
            "printed_page_start": "1084",
            "printed_page_end": "1084",
            "structural_path": self.structural_path,
            "raw_text": "Le traitement doit être considéré.",
            "reading_text": "Le traitement doit être considéré.",
            "source_span": "p19:b1",
            "data": {
                "block_records": [
                    {
                        "source_page_index": 19,
                        "block_index": 1,
                        "raw_text": "Le traitement doit être considéré.",
                        "reading_text": "Le traitement doit être considéré.",
                        "printed_page_number": "1084",
                    }
                ]
            },
        }
        self.range_units = [self.unit] + [self.chapter_unit(chapter) for chapter in range(50, 86)]
        self.unit_index = {unit["unit_id"]: unit for unit in self.range_units}

    def candidate_record(self, printed_page_start="1084", printed_page_end="1084"):
        return {
            "candidate_id": "visual-1",
            "book_id": BOOK_ID,
            "source_version": SOURCE_VERSION,
            "structural_path": self.structural_path,
            "host_unit_id": self.unit["unit_id"],
            "source_page_index_start": 19,
            "source_page_index_end": 19,
            "printed_page_start": printed_page_start,
            "printed_page_end": printed_page_end,
        }

    def test_candidate_page_requires_authoritative_page_labels(self):
        with self.assertRaises(ContractError) as error:
            _verify_candidate_page(self.candidate_record(), self.unit, "visual", None)
        self.assertEqual(error.exception.code, "missing_page_map_provenance")
        self.assertIn("page labels", str(error.exception))

        for label in ("1084", None):
            with self.subTest(label=label):
                unit = json.loads(json.dumps(self.unit))
                unit["printed_page_start"] = label
                unit["printed_page_end"] = label
                unit["data"]["block_records"][0]["printed_page_number"] = label
                candidate = self.candidate_record(label, label)
                self.assertIsNone(_verify_candidate_page(candidate, unit, "visual", {19: label}))

    def chapter_unit(self, chapter):
        part = 5 if chapter <= 65 else 6
        title = "Spécialités psychiatriques" if part == 5 else "Traitements"
        return {
            "unit_id": "unit-" + str(chapter) + "-1",
            "book_id": BOOK_ID,
            "source_version": SOURCE_VERSION,
            "source_page_index_start": 18 + chapter,
            "source_page_index_end": 18 + chapter,
            "printed_page_start": str(1083 + chapter),
            "printed_page_end": str(1083 + chapter),
            "structural_path": "Partie " + str(part) + "/" + title + "/Chapitre " + str(chapter),
            "raw_text": "evidence",
            "reading_text": "evidence",
            "source_span": "p" + str(18 + chapter) + ":b1",
            "data": {
                "block_records": [
                    {
                        "source_page_index": 18 + chapter,
                        "block_index": 1,
                        "raw_text": "evidence",
                        "reading_text": "evidence",
                        "printed_page_number": str(1083 + chapter),
                    }
                ]
            },
        }

    def proposal(self, kind="claim", unit=None, **overrides):
        unit = unit or self.unit
        record = {
            "proposal_id": "proposal-1",
            "book_id": BOOK_ID,
            "source_version": SOURCE_VERSION,
            "kind": kind,
            "unit_id": unit["unit_id"],
            "source_text": "traitement",
            "source_layer": "raw",
            "source_span": {
                "source_page_index": 19,
                "block_index": 1,
                "start_offset": 3,
                "end_offset": 13,
            },
            "source_occurrence": 1,
            "source_page_index_start": 19,
            "source_page_index_end": 19,
            "printed_page_start": "1084",
            "printed_page_end": "1084",
            "structural_path": self.structural_path,
            "language": "fr",
            "confidence": 1.0,
            "extraction_status": "proposed",
            "validation_status": "auto_ok",
        }
        if kind == "claim":
            record.update(
                {
                    "subject": "Le traitement",
                    "predicate_or_relation": "associated_with",
                    "object": "une prise en charge",
                    "clinical_domain": None,
                    "population": None,
                    "age_group": None,
                    "context": None,
                    "temporal_qualifier": None,
                    "severity_qualifier": None,
                    "exception_or_condition": None,
                    "evidence_or_recommendation_wording": "traitement",
                }
            )
        elif kind == "concept":
            record.update(
                {
                    "concept_id": "concept-treatment",
                    "canonical_name": "Traitement",
                    "source_term": "traitement",
                }
            )
        elif kind == "relation":
            record.update(
                {
                    "relation_type": "associated_with",
                    "source_concept_id": "concept-treatment",
                    "target_concept_id": "concept-care",
                }
            )
        elif kind == "xref":
            record.update(
                {
                    "target": "chapter-3",
                    "target_scope": "tome-1",
                    "xref_status": "unresolved_external",
                }
            )
        elif kind == "medication":
            record.update({"candidate_id": "medication-1", "dose_text": "100 mg"})
        elif kind == "visual_review":
            record.update(
                {
                    "candidate_id": "visual-1",
                    "region_reference": {"source_page_index": 19, "bbox": [10.0, 20.0, 30.0, 40.0]},
                }
            )
        elif kind == "coverage":
            record.update(
                {
                    "considered_unit_ids": [unit["unit_id"]],
                    "coverage_status": "covered",
                    "skipped_reasons": {},
                }
            )
        record.update(overrides)
        return record

    def test_claim_requires_complete_source_backed_payload(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal({"kind": "claim", "unit_id": "unit-49-1"}, self.unit_index)
        self.assertEqual(error.exception.code, "missing_field")

    def test_claim_is_normalized_with_exact_host_provenance(self):
        record = validate_proposal(self.proposal(), self.unit_index)
        self.assertEqual(record["provenance"]["unit_id"], "unit-49-1")
        self.assertEqual(record["provenance"]["source_span"], "p19:b1")
        self.assertEqual(record["provenance"]["source_text_layer"], "raw")
        self.assertEqual(record["book_id"], BOOK_ID)
        self.assertEqual(record["source_version"], SOURCE_VERSION)

    def test_unknown_unit_fails_closed(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(unit_id="unit-unknown"), self.unit_index)
        self.assertEqual(error.exception.code, "unknown_unit")

    def test_proposal_identity_must_match_frozen_tome2(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(book_id="other-book"), self.unit_index)
        self.assertEqual(error.exception.code, "proposal_identity_mismatch")
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(source_version="sha256:" + "0" * 64), self.unit_index)
        self.assertEqual(error.exception.code, "proposal_identity_mismatch")

    def test_unit_identity_is_required_and_must_match_frozen_tome2(self):
        unit = json.loads(json.dumps(self.unit))
        del unit["book_id"]
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(), {unit["unit_id"]: unit})
        self.assertEqual(error.exception.code, "unit_identity_mismatch")
        unit["book_id"] = "other-book"
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(), {unit["unit_id"]: unit})
        self.assertEqual(error.exception.code, "unit_identity_mismatch")

    def test_missing_source_text_fails_closed(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(source_text=""), self.unit_index)
        self.assertEqual(error.exception.code, "source_mismatch")

    def test_source_text_must_exist_in_raw_or_reading_layer(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(source_text="médicament inexistant"), self.unit_index)
        self.assertEqual(error.exception.code, "source_mismatch")

    def test_reading_layer_only_source_is_accepted(self):
        unit = dict(self.unit)
        unit["raw_text"] = "Le traitement doit être considré."
        unit["reading_text"] = "Le traitement doit être considéré."
        unit["data"] = {
            "block_records": [
                {
                    "source_page_index": 19,
                    "block_index": 1,
                    "raw_text": unit["raw_text"],
                    "reading_text": unit["reading_text"],
                    "printed_page_number": "1084",
                }
            ]
        }
        record = validate_proposal(
            self.proposal(
                source_text="considéré",
                source_layer="reading",
                source_span={
                    "source_page_index": 19,
                    "block_index": 1,
                    "start_offset": 24,
                    "end_offset": 33,
                },
                evidence_or_recommendation_wording="considéré",
            ),
            {unit["unit_id"]: unit},
        )
        self.assertEqual(record["provenance"]["source_text_layer"], "reading")

    def test_raw_layer_cannot_silently_use_reading_only_evidence(self):
        unit = json.loads(json.dumps(self.unit))
        unit["raw_text"] = "Le traitement doit être considré."
        unit["reading_text"] = "Le traitement doit être considéré."
        unit["data"]["block_records"][0]["raw_text"] = unit["raw_text"]
        unit["data"]["block_records"][0]["reading_text"] = unit["reading_text"]
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal(
                    source_text="considéré",
                    source_layer="raw",
                    source_span={
                        "source_page_index": 19,
                        "block_index": 1,
                        "start_offset": 23,
                        "end_offset": 32,
                    },
                    evidence_or_recommendation_wording="considéré",
                ),
                {unit["unit_id"]: unit},
            )
        self.assertEqual(error.exception.code, "source_mismatch")

    def test_source_layer_is_explicit(self):
        proposal = self.proposal()
        del proposal["source_layer"]
        with self.assertRaises(ContractError) as error:
            validate_proposal(proposal, self.unit_index)
        self.assertEqual(error.exception.code, "missing_field")

    def test_source_span_requires_offsets(self):
        proposal = self.proposal(source_span={"source_page_index": 19, "block_index": 1})
        with self.assertRaises(ContractError) as error:
            validate_proposal(proposal, self.unit_index)
        self.assertEqual(error.exception.code, "invalid_source_span")

    def test_ambiguous_source_occurrence_must_be_supplied(self):
        unit = json.loads(json.dumps(self.unit))
        unit["raw_text"] = "traitement et traitement"
        unit["reading_text"] = unit["raw_text"]
        unit["data"]["block_records"][0]["raw_text"] = unit["raw_text"]
        unit["data"]["block_records"][0]["reading_text"] = unit["reading_text"]
        proposal = self.proposal(
            source_span={
                "source_page_index": 19,
                "block_index": 1,
                "start_offset": 0,
                "end_offset": 24,
            }
        )
        del proposal["source_occurrence"]
        with self.assertRaises(ContractError) as error:
            validate_proposal(proposal, {unit["unit_id"]: unit})
        self.assertEqual(error.exception.code, "missing_field")

    def test_exact_source_occurrence_selects_matching_offsets(self):
        unit = json.loads(json.dumps(self.unit))
        unit["raw_text"] = "traitement et traitement"
        unit["reading_text"] = unit["raw_text"]
        unit["data"]["block_records"][0]["raw_text"] = unit["raw_text"]
        unit["data"]["block_records"][0]["reading_text"] = unit["reading_text"]
        record = validate_proposal(
            self.proposal(
                source_occurrence=2,
                source_span={
                    "source_page_index": 19,
                    "block_index": 1,
                    "start_offset": 14,
                    "end_offset": 24,
                },
            ),
            {unit["unit_id"]: unit},
        )
        self.assertEqual(record["provenance"]["source_occurrence"], 2)

    def test_source_occurrence_offsets_must_match_exact_text(self):
        proposal = self.proposal(
            source_occurrence=1,
            source_span={
                "source_page_index": 19,
                "block_index": 1,
                "start_offset": 4,
                "end_offset": 13,
            },
        )
        with self.assertRaises(ContractError) as error:
            validate_proposal(proposal, self.unit_index)
        self.assertEqual(error.exception.code, "occurrence_offset_mismatch")

    def test_source_page_mismatch_fails_closed(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(source_page_index_start=20, source_page_index_end=20), self.unit_index)
        self.assertEqual(error.exception.code, "page_mismatch")

    def test_invented_printed_page_fails_closed(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(printed_page_start="9999", printed_page_end="9999"), self.unit_index)
        self.assertEqual(error.exception.code, "printed_page_mismatch")

    def test_source_provenance_accepts_explicit_null_printed_page(self):
        unit = json.loads(json.dumps(self.unit))
        unit["printed_page_start"] = None
        unit["printed_page_end"] = None
        unit["data"]["block_records"][0]["printed_page_number"] = None
        record = validate_proposal(
            self.proposal(unit=unit, printed_page_start=None, printed_page_end=None),
            {unit["unit_id"]: unit},
        )
        self.assertIsNone(record["printed_page_start"])
        self.assertIsNone(record["printed_page_end"])

    def test_source_provenance_rejects_missing_invalid_and_mismatched_printed_page(self):
        missing = object()
        for label in (missing, 1084, ""):
            with self.subTest(label=label):
                unit = json.loads(json.dumps(self.unit))
                block = unit["data"]["block_records"][0]
                if label is missing:
                    block.pop("printed_page_number")
                else:
                    block["printed_page_number"] = label
                with self.assertRaises(ContractError) as error:
                    validate_proposal(self.proposal(), {unit["unit_id"]: unit})
                self.assertEqual(error.exception.code, "printed_page_mismatch")

        unit = json.loads(json.dumps(self.unit))
        unit["data"]["block_records"][0]["printed_page_number"] = None
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal(unit=unit, printed_page_start="1084", printed_page_end="1084"),
                {unit["unit_id"]: unit},
            )
        self.assertEqual(error.exception.code, "printed_page_mismatch")

    def test_age_scope_is_source_grounded(self):
        cases = (
            ("Le trouble apparaît avant l’âge adulte.", None),
            ("Le patient est évalué chez l’adulte.", "adulte"),
            ("Le patient est évalué chez l’enfant.", "enfants"),
            ("Chez les adultes, les signes sont différents de ceux des enfants.", "adultes"),
            ("Pour les enfants, les signes sont différents. Chez les adultes, ils sont moins manifestes.", "enfants"),
        )
        for source, expected in cases:
            with self.subTest(source=source):
                self.assertEqual(classify_age_group(source), expected)

    def test_round5_adult_boundaries_and_local_scope(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-b-55-65.jsonl")
        by_id = {proposal["proposal_id"]: proposal for proposal in proposals}
        onset = by_id["claim-fix-c29b5247c547f114a26f"]
        self.assertIsNone(onset["age_group"])
        self.assertIsNone(onset["population"])
        adult = by_id["claim-fix-90b4bce090e8c0ab8eb5"]
        self.assertEqual(adult["age_group"], "adultes")
        self.assertEqual(adult["population"], "adultes")
        mixed = by_id["claim-fix-2b35707ca04de454af72"]
        self.assertEqual(mixed["age_group"], "enfants")
        self.assertEqual(mixed["population"], "enfants")

    def test_metadata_marker_audit_covers_claims_concepts_relations(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-b-55-65.jsonl")
        context_markers = ("gérontopsychiatrie", "vieillissement", "groupe d’âge")
        author_markers = (
            "Gérontopsychiatre, programme de gérontopsychiatrie",
            "Neuropsychologue, chercheuse",
            "Psychiatre responsable, programme",
            "Psychiatre, Clinique spécialisée des troubles anxieux",
        )
        for proposal in proposals:
            if proposal["kind"] not in {"claim", "concept", "relation"}:
                continue
            source_text = proposal["source_text"]
            with self.subTest(proposal_id=proposal["proposal_id"], kind=proposal["kind"]):
                self.assertFalse(any(marker in source_text for marker in author_markers))
                if any(marker in source_text for marker in context_markers) and not explicit_age_scope(source_text):
                    self.assertIsNone(proposal.get("age_group"))
                    self.assertIsNone(proposal.get("population"))

    def test_age_group_vocabulary_and_context_semantics(self):
        cases = {
            "Le trouble apparaît avant l’âge adulte.": None,
            "Le patient est évalué chez l’adulte.": "adulte",
            "Le patient est évalué chez les adultes.": "adultes",
            "Le patient est évalué chez l’enfant.": "enfants",
            "Le patient est évalué à 5 ans.": "5 ans",
            "Les patients âgés nécessitent un suivi particulier.": "personnes âgées",
            "La gérontopsychiatrie est une spécialité médicale.": None,
            "Le vieillissement modifie plusieurs fonctions.": None,
            "Ce groupe d’âge présente une prévalence élevée.": None,
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(classify_age_group(source), expected)

    def test_author_metadata_units_have_no_claim(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-b-55-65.jsonl")
        metadata_markers = (
            "Gérontopsychiatre, programme de gérontopsychiatrie",
            "Neuropsychologue, chercheuse",
            "Psychiatre responsable, programme",
            "Psychiatre, Clinique spécialisée des troubles anxieux",
        )
        metadata_claims = [
            proposal["proposal_id"]
            for proposal in proposals
            if proposal["kind"] == "claim"
            and any(marker in proposal["source_text"] for marker in metadata_markers)
        ]
        self.assertEqual(metadata_claims, [])

    def test_context_terms_are_not_explicit_age_scope(self):
        for term in ("pédiatrique", "gérontopsychiatrie", "vieillissement", "groupe d’âge"):
            with self.subTest(term=term):
                self.assertFalse(explicit_age_scope(term))

    def test_part_b_explicit_age_scope_has_structured_fields(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-b-55-65.jsonl")
        violations = []
        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            source_text = " ".join(proposal["source_text"].split())
            if not explicit_age_scope(source_text):
                continue
            if proposal.get("age_group") is None or proposal.get("population") is None or (proposal.get("age_group") is not None and not is_closed_age_group(proposal["age_group"])): 
                violations.append(
                    {
                        "proposal_id": proposal["proposal_id"],
                        "age_group": proposal.get("age_group"),
                        "population": proposal.get("population"),
                    }
                )
        self.assertEqual(violations, [])

    def test_part_c_concepts_are_complete_source_phrases(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        invalid = []
        stopword = re.compile(r"(?i)\b(?:de|la|le|les|des|du|et|à|pour|avec|par|un|une)$")
        for proposal in proposals:
            if proposal["kind"] != "concept":
                continue
            term = proposal["source_term"]
            if (
                len(term.split()) < 2
                or term == "Antipsychotiques administrés"
                or stopword.search(term)
                or re.search(r"-\s*$", term)
                or re.search(r"-\n", term)
                or " ".join(term.split()) != proposal["canonical_name"]
                or term not in proposal["source_text"]
            ):
                invalid.append(proposal["proposal_id"])
        self.assertEqual(invalid, [])

    def test_part_c_heading_only_units_have_no_claim(self):
        root = Path(__file__).resolve().parents[1]
        bundle = read_jsonl(root / "work/chapters/part-c-66-72.jsonl")
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        coverage = {proposal["unit_id"]: proposal for proposal in proposals if proposal["kind"] == "coverage"}
        claims = {proposal["unit_id"] for proposal in proposals if proposal["kind"] == "claim"}
        for row in bundle:
            unit = row["unit"]
            has_sentence = any(
                "...." not in block.get("raw_text", "")
                and re.search(r"[.!?](?=\s|$)", block.get("raw_text", ""))
                for block in unit.get("data", {}).get("block_records", [])
            )
            if not has_sentence:
                self.assertEqual(coverage[unit["unit_id"]]["coverage_status"], "not_clinical")
                self.assertNotIn(unit["unit_id"], claims)
        for proposal in proposals:
            if proposal["kind"] == "claim":
                self.assertRegex(proposal["source_text"], r"[.!?](?=\s|$)")

    def test_part_c_claim_predicates_are_explicitly_supported(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        cues = {
            "defined_by": r"(?i)représent\w*|définit|défini|consiste|constitue|constituent|est l’étude|est l'étude|est une? (?:étude|spécialité|molécule|classe)|propriétés?|effet de",
            "treated_by": r"(?i)\b(?:traitements?|médicaments?|antidépresseurs?|antipsychotiques?|pharmacothérap\w*|psychothérap\w*|thérapeutiques?|thérapies|prescri\w*|utilis(?:é|ée|és|ées)|indiqu(?:é|ée)|administr(?:é|ée)|doses?|dosages?|posologies?|surdoses?|mégadoses?|lithium|lithothérapie|ECT|électroconvulsivothérapie|sismothérapie|luminothérapie)\b",
            "monitored_by": r"(?i)surveill\w*|surveillance|monitorage|monitor(?:er|é|ée)",
            "adverse_effect_of": r"(?i)effet indésirable|effets indésirables|effet secondaire|effets secondaires",
            "contraindicated_with": r"(?i)contre-indiqu\w*|à éviter|éviter|ne doit pas|n’est pas recommandé",
        }
        unsupported = []
        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            cue = cues.get(proposal["predicate_or_relation"])
            if cue is None or re.search(cue, proposal["source_text"]) is None:
                unsupported.append(proposal["proposal_id"])
        self.assertEqual(unsupported, [])

    def test_part_c_mixed_age_population_is_source_grounded(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        claims = [proposal for proposal in proposals if proposal["kind"] == "claim"]
        mixed_adolescents = [
            proposal
            for proposal in claims
            if re.search(r"(?i)enfants\s+(?:et|aux)\s+(?:les\s+)?adolescents", proposal["source_text"])
            and re.search(r"(?i)adulte|adultes", proposal["source_text"]) is None
        ]
        for proposal in mixed_adolescents:
            phrase = re.search(r"(?i)enfants\s+(?:et|aux)\s+(?:les\s+)?adolescents", proposal["source_text"])
            self.assertEqual(proposal["age_group"], "enfants et adolescents")
            self.assertEqual(proposal["population"], " ".join(phrase.group(0).split()))
        pregnancy = [
            proposal
            for proposal in claims
            if re.search(r"(?i)enfants\s+et\s+(?:les\s+)?femmes enceintes", proposal["source_text"])
        ]
        for proposal in pregnancy:
            phrase = re.search(r"(?i)enfants\s+et\s+(?:les\s+)?femmes enceintes", proposal["source_text"])
            self.assertNotIn(proposal.get("age_group"), {"enfant", "enfants"})
            self.assertIn("femmes enceintes", proposal.get("population") or "")

    def test_part_c_adult_onset_is_not_adult(self):
        source = "Le trouble apparaît avant l’âge adulte."
        self.assertIsNone(classify_age_group(source))
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        for proposal in proposals:
            if proposal["kind"] == "claim" and "avant l’âge adulte" in proposal["source_text"].casefold():
                self.assertIsNone(proposal["age_group"])
                self.assertIsNone(proposal["population"])

    def test_part_c_age_over_60_uses_single_age_qualifier(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        claims = [proposal for proposal in proposals if proposal["kind"] == "claim"]
        over_60 = [proposal for proposal in claims if re.search(r"(?i)plus\s+de\s+60\s+ans|âge\s+supérieur\s+à\s+60\s+ans", proposal["source_text"])]
        for proposal in over_60:
            if re.search(r"(?i)65 ans", proposal["source_text"]):
                self.assertEqual(proposal["age_group"], "65 ans et plus")
            else:
                self.assertEqual(proposal["age_group"], "plus de 60 ans")

    def test_part_c_claim_subjects_are_same_span_complete_terms(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        invalid = []
        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            subject = proposal["subject"]
            source = proposal["source_text"]
            if (
                subject not in source
                or re.search(r"(?i)\b(?:de|la|le|les|des|du|et|à|pour|avec|par|un|une)$", subject)
                or re.match(r"(?i)^(?:ex\.|p\. ex\.|[•–(\[])", source)
                or re.match(r"^[a-zà-öø-ÿ]", source)
                or source.casefold().startswith("pierres angulaires")
            ):
                invalid.append(proposal["proposal_id"])
        self.assertEqual(invalid, [])

    def test_part_c_predicates_reject_contradictory_or_inferred_claims(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        invalid = []
        historical = re.compile(r"(?i)au cours des|années|siècle|découverte|commercialis|homologation|histoire")
        pharmacokinetic = re.compile(r"(?i)pharmacocinétique|pharmacodynamique|absorption|métabolisme|élimination|taux plasmatique")
        treatment = re.compile(r"(?i)traitement|thérapeutique|indication|prescri|utilis(?:é|ée|és|ées)|administré|dose|posologie")
        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            text = proposal["source_text"]
            lowered = text.casefold()
            if proposal["predicate_or_relation"] == "contraindicated_with" and "pas nécessairement contre-indiqué" in lowered:
                invalid.append(proposal["proposal_id"])
            if proposal["predicate_or_relation"] == "monitored_by" and historical.search(text):
                invalid.append(proposal["proposal_id"])
            if proposal["predicate_or_relation"] == "treated_by" and pharmacokinetic.search(text) and not treatment.search(text):
                invalid.append(proposal["proposal_id"])
            if proposal["predicate_or_relation"] == "defined_by" and re.search(r"(?i)diagnostic|différentiel", text):
                invalid.append(proposal["proposal_id"])
        self.assertEqual(invalid, [])

    def test_part_c_medication_subjects_are_not_inherited(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        medications = ("donépézil", "galantamine", "rivastigmine", "psychostimulant")
        invalid = []
        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            source = proposal["source_text"].casefold()
            subject = proposal["subject"].casefold()
            for medication in medications:
                if medication in source and ("nmda" in subject or "mémantine" in subject):
                    invalid.append(proposal["proposal_id"])
                    break
        self.assertEqual(invalid, [])

    def test_part_c_explicit_age_qualifiers_are_populated(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        explicit = re.compile(r"(?i)enfants|adolescents|adultes|à l’âge adulte|personnes âgées|patients âgés|plus de 60 ans|âge supérieur à 60 ans|65 ans")
        closed = {"nouveau-né", "enfant", "enfants", "adolescent", "adolescents", "enfants et adolescents", "adulte", "adultes", "personne âgée", "personnes âgées", "65 ans et plus", "plus de 60 ans"}
        invalid = []
        for proposal in proposals:
            if proposal["kind"] != "claim" or not explicit.search(proposal["source_text"]):
                continue
            age = proposal.get("age_group")
            values = age if isinstance(age, list) else [age]
            if proposal.get("population") is None or age is None or any(value not in closed and not re.fullmatch(r"\d+\s+ans(?:\s+et\s+plus)?", str(value)) for value in values):
                invalid.append(proposal["proposal_id"])
            if "avant l’âge adulte" in proposal["source_text"].casefold() and any(value in {"adulte", "adultes"} for value in values):
                invalid.append(proposal["proposal_id"])
        self.assertEqual(invalid, [])

    def test_part_c_unsafe_predicates_are_omitted(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        invalid = []
        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            source = proposal["source_text"]
            predicate = proposal["predicate_or_relation"]
            if predicate == "contraindicated_with" and re.search(r"(?i)\bcontre-indiqu\w*", source) is None:
                invalid.append(proposal["proposal_id"])
            if predicate == "defined_by" and re.search(r"(?i)\b(?:c’est|s’agit|se définit|est défini|représente|constitue|est une? (?:molécule|classe|étude|spécialité))\b", source) is None:
                invalid.append(proposal["proposal_id"])
            if predicate == "treated_by" and re.search(r"(?i)pharmacocinétique|pharmacodynamique|absorption|métabolisme|élimination|taux plasmatique", source) and re.search(r"(?i)traitement|thérapeutique|indication|prescri|utilis(?:é|ée|és|ées)|administré|dose|posologie", source) is None:
                invalid.append(proposal["proposal_id"])
        self.assertEqual(invalid, [])

    def test_part_c_medication_subjects_bind_to_named_drugs(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        medication_terms = (
            "trimipramine", "guanfacine", "donépézil", "galantamine", "rivastigmine",
            "mémantine", "lithium", "lamotrigine", "carbamazépine", "prégabaline",
            "gabapentine", "clonidine", "atomoxétine", "méthylphénidate", "citalopram",
            "escitalopram", "vilazodone", "vortioxétine", "psychostimulant", "non-stimulant",
            "antidépresseur", "antipsychotique", "benzodiazépine",
        )
        invalid = []
        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            source = proposal["source_text"].casefold()
            subject = proposal["subject"].casefold()
            named = [term for term in medication_terms if term in source]
            if named and (len(named) > 1 or not any(term in subject for term in named)):
                invalid.append(proposal["proposal_id"])
        self.assertEqual(invalid, [])

    def test_part_c_claims_are_complete_unclipped_evidence(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        invalid = []
        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            source = proposal["source_text"]
            if re.search(r"[^\W\d_]-\n[^\W\d_]", source, re.UNICODE) or re.search(r"(?i)(?:\bet|\bou|de|du|des|à|avec)$", source.strip()):
                invalid.append(proposal["proposal_id"])
        self.assertEqual(invalid, [])

    def test_part_c_exact_age_populations_and_pregnancy(self):
        root = Path(__file__).resolve().parent.parent
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        pregnancy = []

        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            source = proposal["source_text"]
            if re.search(r"(?i)enfants\s+et\s+(?:les\s+)?femmes enceintes", source):
                pregnancy.append(proposal)
                self.assertNotIn(proposal.get("age_group"), {"enfant", "enfants"})
                self.assertIn("femmes enceintes", proposal.get("population") or "")
            for pattern, expected in (
                (r"(?i)\b40\s*(?:à|-|–)\s*60\s+ans\b", "40 à 60 ans"),
                (r"(?i)\b50\s+ans\s+(?:et|ou)\s+plus\b", "50 ans et plus"),
                (r"(?i)(?:âge\s+)?supérieur\s+à\s+60\s+ans", "plus de 60 ans"),
            ):
                if re.search(pattern, source):
                    self.assertEqual(proposal.get("age_group"), expected)
                    self.assertIn(expected, proposal.get("population") or "")
    def test_part_c_adult_study_absence_is_not_adult_population(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")
        absence = re.compile(r"(?i)(?:absence|aucune|pas\s+d['’]).{0,50}(?:étude|recherche|donnée|information).{0,50}(?:adulte|adultes)")
        claims = [proposal for proposal in proposals if proposal["kind"] == "claim" and absence.search(proposal["source_text"])]
        self.assertEqual(claims, [])

    def test_part_c_temporal_qualifiers_are_explicit(self):
        root = Path(__file__).resolve().parents[1]
        proposals = read_jsonl(root / "semantic/proposals/part-c-66-72.jsonl")

        explicit = re.compile(r"(?i)\b(?:aigu[ëe]s?|retard[ée]s?|précoces?|post[- ]ECT|après\s+la\s+phase\s+aiguë)\b")
        for proposal in proposals:
            if proposal["kind"] != "claim":
                continue
            source = proposal["source_text"]
            qualifier = proposal.get("temporal_qualifier")
            if explicit.search(source):
                self.assertIsNotNone(qualifier, proposal["proposal_id"])
            if qualifier is not None:
                self.assertIn(qualifier.casefold(), source.casefold(), proposal["proposal_id"])

        units = [row["unit"] for row in read_jsonl(root / "work/chapters/part-a-49-54.jsonl")]
        page_map = {
            row["source_page_index"]: row["printed_page_number"]
            for row in read_jsonl(root / "page-map.jsonl")
        }
        selected = [unit for unit in units if unit.get("printed_page_start") is None and unit.get("printed_page_end") is None]
        self.assertEqual(len(selected), 3)
        for unit in selected:
            null_blocks = [
                block
                for block in unit["data"]["block_records"]
                if block["printed_page_number"] is None
            ]
            self.assertTrue(null_blocks)
            for block in null_blocks:
                self.assertIsNone(page_map[block["source_page_index"]])
            block = null_blocks[0]
            source_text = block["raw_text"]
            self.assertTrue(source_text)
            proposal = {
                "proposal_id": "coverage-" + unit["unit_id"],
                "book_id": BOOK_ID,
                "source_version": SOURCE_VERSION,
                "kind": "coverage",
                "unit_id": unit["unit_id"],
                "source_text": source_text,
                "source_layer": "raw",
                "source_span": {
                    "source_page_index": block["source_page_index"],
                    "block_index": block["block_index"],
                    "start_offset": 0,
                    "end_offset": len(source_text),
                },
                "source_occurrence": 1,
                "source_page_index_start": block["source_page_index"],
                "source_page_index_end": block["source_page_index"],
                "printed_page_start": None,
                "printed_page_end": None,
                "structural_path": unit["structural_path"],
                "language": "fr",
                "confidence": 1.0,
                "extraction_status": "proposed",
                "validation_status": "auto_ok",
                "considered_unit_ids": [unit["unit_id"]],
                "coverage_status": "covered",
                "skipped_reasons": {},
            }
            record = validate_proposal(proposal, {unit["unit_id"]: unit})
            self.assertIsNone(record["printed_page_start"])
            self.assertIsNone(record["printed_page_end"])

    def test_structural_path_mismatch_fails_closed(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(structural_path="Partie 6/Traitements/Chapitre 70"), self.unit_index)
        self.assertEqual(error.exception.code, "structural_path_mismatch")

    def test_claim_evidence_must_be_exact_source_wording(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(evidence_or_recommendation_wording="médicament"), self.unit_index)
        self.assertEqual(error.exception.code, "evidence_mismatch")

    def test_tome_one_target_must_be_unresolved_external(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal("xref", xref_status="resolved"), self.unit_index)
        self.assertEqual(error.exception.code, "tome1_target_status")
        record = validate_proposal(self.proposal("xref"), self.unit_index)
        self.assertEqual(record["xref_status"], "unresolved_external")

    def test_tome_two_target_cannot_be_unresolved_external(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal("xref", target="chapter-50", target_scope="tome-2"),
                self.unit_index,
            )
        self.assertEqual(error.exception.code, "tome2_target_status")

    def test_xref_scope_is_derived_from_target_chapter(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal(
                    "xref",
                    target="chapter-49",
                    target_scope="tome-1",
                    xref_status="unresolved_external",
                ),
                self.unit_index,
            )
        self.assertEqual(error.exception.code, "xref_scope_mismatch")
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal(
                    "xref",
                    target="chapter-3",
                    target_scope="external",
                    xref_status="unresolved_external",
                ),
                self.unit_index,
            )
        self.assertEqual(error.exception.code, "xref_scope_mismatch")

    def test_xref_target_without_verifiable_scope_fails_closed(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal(
                    "xref",
                    target="reference externe",
                    target_scope="external",
                    xref_status="unresolved_external",
                ),
                self.unit_index,
            )
        self.assertEqual(error.exception.code, "unverifiable_xref_target")

    def test_verified_tome2_xref_is_not_external(self):
        record = validate_proposal(
            self.proposal(
                "xref",
                target="chapter-50",
                target_scope="tome-2",
                xref_status="resolved",
            ),
            self.unit_index,
        )
        self.assertEqual(record["target_scope"], "tome-2")
        self.assertEqual(record["xref_status"], "resolved")

    def test_ambiguous_tome2_xref_needs_review(self):
        record = validate_proposal(
            self.proposal(
                "xref",
                target="chapter-50",
                target_scope="tome-2",
                xref_status="ambiguous",
            ),
            self.unit_index,
        )
        self.assertEqual(record["validation_status"], "needs_review")

    def test_chapter_48_target_is_verified_tome1_external(self):
        record = validate_proposal(
            self.proposal(
                "xref",
                target="tome-1/chapter-48",
                target_scope="tome-1",
                xref_status="unresolved_external",
            ),
            self.unit_index,
        )
        self.assertEqual(record["target_scope"], "tome-1")

    def test_unsupported_relation_type_fails_closed(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal("relation", relation_type="invented_relation"), self.unit_index)
        self.assertEqual(error.exception.code, "unsupported_relation")

    def test_relation_requires_distinct_source_and_target_concepts(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal("relation", target_concept_id="concept-treatment"),
                self.unit_index,
            )
        self.assertEqual(error.exception.code, "invalid_relation_target")

    def test_medication_is_always_needs_review(self):
        record = validate_proposal(self.proposal("medication", validation_status="auto_ok"), self.unit_index)
        self.assertEqual(record["validation_status"], "needs_review")

    def test_visual_review_is_always_needs_review(self):
        record = validate_proposal(self.proposal("visual_review", validation_status="auto_ok"), self.unit_index)
        self.assertEqual(record["validation_status"], "needs_review")

    def test_threshold_claim_is_always_needs_review(self):
        unit = json.loads(json.dumps(self.unit))
        unit["raw_text"] = "Un seuil de 20 mg est proposé."
        unit["reading_text"] = unit["raw_text"]
        unit["data"]["block_records"][0]["raw_text"] = unit["raw_text"]
        unit["data"]["block_records"][0]["reading_text"] = unit["raw_text"]
        record = self.proposal(
            source_text="seuil de 20 mg",
            source_span={
                "source_page_index": 19,
                "block_index": 1,
                "start_offset": 3,
                "end_offset": 17,
            },
            evidence_or_recommendation_wording="seuil de 20 mg",
            validation_status="auto_ok",
        )
        self.assertEqual(validate_proposal(record, {unit["unit_id"]: unit})["validation_status"], "needs_review")

    def test_any_numeric_semantic_content_needs_review(self):
        cases = [
            self.proposal(object="score 20"),
            self.proposal(proposal_id="proposal-context", context="au moins deux fois"),
            self.proposal(proposal_id="proposal-custom", custom_measurement="7"),
        ]
        for record in cases:
            with self.subTest(proposal_id=record["proposal_id"]):
                self.assertEqual(validate_proposal(record, self.unit_index)["validation_status"], "needs_review")

    def test_non_null_qualifier_or_context_needs_review(self):
        record = self.proposal(severity_qualifier="limite clinique")
        self.assertEqual(validate_proposal(record, self.unit_index)["validation_status"], "needs_review")

    def test_table_algorithm_interaction_and_contraindication_need_review(self):
        cases = [
            self.proposal(proposal_id="proposal-table", content_type="table"),
            self.proposal(proposal_id="proposal-algorithm", content_type="algorithm"),
            self.proposal(proposal_id="proposal-interaction", interaction="association médicamenteuse"),
            self.proposal(proposal_id="proposal-contra", predicate_or_relation="contraindicated_with"),
        ]
        for record in cases:
            with self.subTest(proposal_id=record["proposal_id"]):
                self.assertEqual(validate_proposal(record, self.unit_index)["validation_status"], "needs_review")

    def test_visual_region_page_must_match_source_evidence(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal("visual_review", region_reference={"source_page_index": 20, "bbox": [10, 20, 30, 40]}),
                self.unit_index,
            )
        self.assertEqual(error.exception.code, "region_page_mismatch")

    def test_unresolved_clinical_coverage_accepts_unresolved_reason(self):
        record = validate_proposal(
            self.proposal(
                "coverage",
                coverage_status="unresolved",
                skipped_reasons={"unit-49-1": "unresolved: clinical interpretation remains uncertain"},
            ),
            self.unit_index,
        )
        self.assertEqual(record["validation_status"], "needs_review")

    def test_not_clinical_coverage_requires_nonclinical_reason(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal(
                    "coverage",
                    coverage_status="not_clinical",
                    skipped_reasons={"unit-49-1": "unresolved: this is not a skip reason"},
                ),
                self.unit_index,
            )
        self.assertEqual(error.exception.code, "not_clinical_coverage_unjustified")

    def test_not_clinical_coverage_accepts_nonclinical_reason(self):
        record = validate_proposal(
            self.proposal(
                "coverage",
                coverage_status="not_clinical",
                skipped_reasons={"unit-49-1": "nonclinical: repeated index header"},
            ),
            self.unit_index,
        )
        self.assertEqual(record["validation_status"], "auto_ok")

    def test_not_clinical_coverage_requires_skip_reason(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal("coverage", coverage_status="not_clinical", skipped_reasons={}),
                self.unit_index,
            )
        self.assertEqual(error.exception.code, "missing_skip_reason")

    def test_unresolved_coverage_requires_unresolved_reason(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(
                self.proposal("coverage", coverage_status="unresolved", skipped_reasons={}),
                self.unit_index,
            )
        self.assertEqual(error.exception.code, "unresolved_coverage_unjustified")
        unit = json.loads(json.dumps(self.unit))
        unit["content_type"] = "index_entry"
        with self.assertRaises(ContractError) as empty_reason_error:
            validate_proposal(
                self.proposal(
                    "coverage",
                    coverage_status="unresolved",
                    skipped_reasons={"unit-49-1": "nonclinical:"},
                ),
                {unit["unit_id"]: unit},
            )
        self.assertEqual(empty_reason_error.exception.code, "unresolved_coverage_unjustified")
        with self.assertRaises(ContractError) as nonclinical_error:
            validate_proposal(
                self.proposal(
                    "coverage",
                    coverage_status="unresolved",
                    skipped_reasons={"unit-49-1": "nonclinical: repeated index header"},
                ),
                self.unit_index,
            )
        self.assertEqual(nonclinical_error.exception.code, "unresolved_coverage_unjustified")

    def test_approved_proposal_cannot_enter_contract(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(validation_status="approved"), self.unit_index)
        self.assertEqual(error.exception.code, "invalid_validation_status")

    def test_blocked_proposal_fails_closed(self):
        with self.assertRaises(ContractError) as error:
            validate_proposal(self.proposal(validation_status="blocked"), self.unit_index)
        self.assertEqual(error.exception.code, "blocked_proposal")

    def test_validate_proposal_file_returns_counts_and_errors(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "proposals.jsonl"
            write_jsonl(path, [self.proposal(), self.proposal(proposal_id="proposal-2", source_text="absent")])
            summary = validate_proposal_file(path, self.unit_index)
        self.assertEqual(summary["proposal_count"], 2)
        self.assertEqual(summary["valid_count"], 1)
        self.assertEqual(summary["error_count"], 1)
        self.assertEqual(summary["errors"][0]["line"], 2)
        self.assertEqual(summary["errors"][0]["code"], "source_mismatch")

    def test_validate_proposal_file_rejects_duplicate_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "proposals.jsonl"
            write_jsonl(path, [self.proposal(), self.proposal()])
            summary = validate_proposal_file(path, self.unit_index)
        self.assertEqual(summary["valid_count"], 0)
        self.assertEqual(summary["errors"][0]["code"], "duplicate_proposal_id")

    def coverage_proposal(self, unit):
        page = unit["source_page_index_start"]
        source_text = "traitement" if unit["unit_id"] == "unit-49-1" else "evidence"
        start_offset = 3 if unit["unit_id"] == "unit-49-1" else 0
        end_offset = 13 if unit["unit_id"] == "unit-49-1" else 8
        return self.proposal(
            "coverage",
            unit=unit,
            proposal_id="coverage-" + unit["unit_id"],
            source_text=source_text,
            source_span={
                "source_page_index": page,
                "block_index": 1,
                "start_offset": start_offset,
                "end_offset": end_offset,
            },
            source_occurrence=1,
            source_page_index_start=page,
            source_page_index_end=page,
            printed_page_start=unit["printed_page_start"],
            printed_page_end=unit["printed_page_end"],
            structural_path=unit["structural_path"],
            considered_unit_ids=[unit["unit_id"]],
            coverage_status="covered",
            skipped_reasons={},
        )

    def write_merge_inputs(self, root, records=None, omit_coverage=None, empty_files=None, extra_files=None):
        proposals_dir = root / "semantic" / "proposals"
        proposals_dir.mkdir(parents=True)
        omit_coverage = set(omit_coverage or [])
        empty_files = set(empty_files or [])
        extra_files = extra_files or {}
        ranges = [
            (49, 54, "part-a-49-54.jsonl"),
            (55, 65, "part-b-55-65.jsonl"),
            (66, 72, "part-c-66-72.jsonl"),
            (73, 85, "part-d-73-85.jsonl"),
        ]
        paths = []
        for chapter_start, chapter_end, filename in ranges:
            path = proposals_dir / filename
            file_records = list(extra_files.get(filename, []))
            if filename == "part-a-49-54.jsonl":
                file_records.extend(records or [])
            if filename not in empty_files:
                file_records.extend(
                    self.coverage_proposal(unit)
                    for unit in self.range_units
                    if chapter_start <= int(unit["unit_id"].split("-")[1]) <= chapter_end
                    and unit["unit_id"] not in omit_coverage
                )
            write_jsonl(path, file_records)
            paths.append(path)
        write_jsonl(
            root / "page-map.jsonl",
            [
                {"source_page_index": unit["source_page_index_start"], "printed_page_number": unit["printed_page_start"]}
                for unit in self.range_units
            ],
        )
        return paths

    def test_merge_writes_only_canonical_semantic_outputs(self):
        records = [
            self.proposal("concept", concept_id="concept-treatment", canonical_name="Traitement", source_term="traitement"),
            self.proposal("concept", proposal_id="proposal-2", concept_id="concept-care", canonical_name="Soins", source_term="considéré"),
            self.proposal("relation", proposal_id="proposal-3"),
            self.proposal(proposal_id="proposal-4"),
            self.proposal("xref", proposal_id="proposal-5"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = self.write_merge_inputs(root, records)
            report = merge_proposals(paths, self.range_units)
            self.assertTrue((root / "semantic" / "claims.jsonl").exists())
            self.assertTrue((root / "semantic" / "concepts.jsonl").exists())
            self.assertTrue((root / "semantic" / "relations.jsonl").exists())
            self.assertTrue((root / "semantic" / "xrefs.jsonl").exists())
            self.assertFalse((root / "semantic" / "medications.jsonl").exists())
            self.assertEqual(report["kind_counts"]["concept"], 2)
            self.assertEqual(report["output_sha256"]["claims.jsonl"], hashlib.sha256((root / "semantic" / "claims.jsonl").read_bytes()).hexdigest())
            relation = json.loads((root / "semantic" / "relations.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(relation["provenance"]["unit_id"], "unit-49-1")

    def test_merge_rejects_undefined_relation_endpoint(self):
        records = [self.proposal("relation")]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = self.write_merge_inputs(root, records)
            with self.assertRaises(ContractError) as error:
                merge_proposals(paths, self.range_units)
        self.assertEqual(error.exception.code, "undefined_concept")

    def test_merge_cli_writes_merge_checkpoint(self):
        records = [self.proposal()]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_merge_inputs(root, records)
            write_jsonl(root / "units.jsonl", self.range_units)
            self.assertEqual(main(["merge-semantic", "--output", str(root)]), 0)
            checkpoint = json.loads((root / "checkpoints" / "semantic-merge.json").read_text(encoding="utf-8"))
        self.assertEqual(checkpoint["status"], "PASS")
        self.assertGreater(checkpoint["proposal_count"], 1)

    def test_merge_requires_exact_four_approved_nonempty_files(self):
        cases = ["missing", "extra", "empty", "unknown", "unknown_extension"]
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.write_merge_inputs(root)
                write_jsonl(root / "units.jsonl", self.range_units)
                proposals = root / "semantic" / "proposals"
                if case == "missing":
                    (proposals / "part-d-73-85.jsonl").unlink()
                elif case == "extra":
                    write_jsonl(proposals / "extra.jsonl", [self.proposal()])
                elif case == "empty":
                    write_jsonl(proposals / "part-c-66-72.jsonl", [])
                elif case == "unknown":
                    write_jsonl(proposals / "unknown.jsonl", [self.proposal()])
                else:
                    write_jsonl(proposals / "notes.txt", [{"unexpected": "file"}])
                self.assertEqual(main(["merge-semantic", "--output", str(root)]), 1)
                checkpoint = json.loads((root / "checkpoints" / "semantic-merge.json").read_text(encoding="utf-8"))
                self.assertEqual(checkpoint["status"], "BLOCKED")
                self.assertFalse((root / "semantic" / "claims.jsonl").exists())

    def test_one_record_partial_batch_is_blocked(self):
        partial_units = {"unit-" + str(chapter) + "-1" for chapter in range(73, 85)}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_merge_inputs(root, omit_coverage=partial_units)
            write_jsonl(root / "units.jsonl", self.range_units)
            self.assertEqual(main(["merge-semantic", "--output", str(root)]), 1)
            checkpoint = json.loads((root / "checkpoints" / "semantic-merge.json").read_text(encoding="utf-8"))
            self.assertEqual(checkpoint["status"], "BLOCKED")
            self.assertFalse((root / "semantic" / "claims.jsonl").exists())

    def test_merge_requires_authoritative_page_map(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = self.write_merge_inputs(root, [self.proposal()])
            page_map = root / "page-map.jsonl"
            if page_map.exists():
                page_map.unlink()
            with self.assertRaises(ContractError) as error:
                merge_proposals(paths, self.range_units)
        self.assertEqual(error.exception.code, "missing_page_map")

    def test_merge_rejects_missing_block_printed_label_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = self.write_merge_inputs(root, [self.proposal()])
            units = json.loads(json.dumps(self.range_units))
            units[0]["data"]["block_records"][0].pop("printed_page_number")
            with self.assertRaises(ContractError) as error:
                merge_proposals(paths, units)
        self.assertEqual(error.exception.code, "unit_printed_page_mismatch")

    def test_merge_directly_blocks_missing_unit_coverage(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = self.write_merge_inputs(root, omit_coverage={"unit-85-1"})
            with self.assertRaises(ContractError) as error:
                merge_proposals(paths, self.range_units)
            self.assertEqual(error.exception.code, "missing_coverage")
            self.assertFalse((root / "semantic" / "claims.jsonl").exists())

    def test_merge_rejects_records_in_wrong_approved_batch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.write_merge_inputs(
                root,
                extra_files={"part-b-55-65.jsonl": [self.proposal(proposal_id="wrong-batch")]},
            )
            with self.assertRaises(ContractError) as error:
                merge_proposals(
                    [
                        root / "semantic" / "proposals" / filename
                        for filename in (
                            "part-a-49-54.jsonl",
                            "part-b-55-65.jsonl",
                            "part-c-66-72.jsonl",
                            "part-d-73-85.jsonl",
                        )
                    ],
                    self.range_units,
                )
            self.assertEqual(error.exception.code, "proposal_wrong_batch")
            self.assertFalse((root / "semantic" / "claims.jsonl").exists())

    def test_merge_status_is_warning_when_records_need_review(self):
        medication = self.proposal(
            "medication",
            proposal_id="proposal-medication-review",
            source_text="traitement",
            dose_text="100 mg",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = self.write_merge_inputs(root, [medication])
            report = merge_proposals(paths, self.range_units)
            self.assertEqual(report["status"], "WARNING")
            checkpoint = json.loads((root / "checkpoints" / "semantic-merge.json").read_text(encoding="utf-8"))
            self.assertEqual(checkpoint["status"], "WARNING")

    def test_merge_ambiguous_xref_is_warning(self):
        xref = self.proposal(
            "xref",
            proposal_id="proposal-ambiguous-xref",
            target="chapter-50",
            target_scope="tome-2",
            xref_status="ambiguous",
        )
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = self.write_merge_inputs(root, [xref])
            report = merge_proposals(paths, self.range_units)
        self.assertEqual(report["status"], "WARNING")
        self.assertGreaterEqual(report["review_count"], 1)

    def test_validate_cli_writes_pass_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proposal = root / "semantic" / "proposals" / "part-a-49-54.jsonl"
            proposal.parent.mkdir(parents=True)
            write_jsonl(proposal, [self.proposal()])
            (root / "units.jsonl").write_text(json.dumps(self.unit, ensure_ascii=False) + "\n", encoding="utf-8")
            self.assertEqual(main(["validate-semantic", "--output", str(root), "--proposal", str(proposal)]), 0)
            checkpoint = json.loads((root / "checkpoints" / "semantic-part-a.json").read_text(encoding="utf-8"))
        self.assertEqual(checkpoint["status"], "PASS")
        self.assertEqual(checkpoint["valid_count"], 1)

    def test_validate_cli_blocks_blocked_proposal_status(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proposal = root / "semantic" / "proposals" / "part-a-49-54.jsonl"
            proposal.parent.mkdir(parents=True)
            write_jsonl(proposal, [self.proposal(validation_status="blocked")])
            write_jsonl(root / "units.jsonl", self.range_units)
            self.assertEqual(main(["validate-semantic", "--output", str(root), "--proposal", str(proposal)]), 1)
            checkpoint = json.loads((root / "checkpoints" / "semantic-part-a.json").read_text(encoding="utf-8"))
        self.assertEqual(checkpoint["status"], "BLOCKED")
        self.assertEqual(checkpoint["error_count"], 1)

    def test_validate_cli_uses_warning_for_review_records(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proposal = root / "semantic" / "proposals" / "part-a-49-54.jsonl"
            proposal.parent.mkdir(parents=True)
            write_jsonl(proposal, [self.proposal(object="score 20")])
            write_jsonl(root / "units.jsonl", self.range_units)
            self.assertEqual(main(["validate-semantic", "--output", str(root), "--proposal", str(proposal)]), 0)
            checkpoint = json.loads((root / "checkpoints" / "semantic-part-a.json").read_text(encoding="utf-8"))
        self.assertEqual(checkpoint["status"], "WARNING")
        self.assertEqual(checkpoint["review_count"], 1)

    def test_validate_cli_writes_blocked_checkpoint_on_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            proposal = root / "semantic" / "proposals" / "invalid.jsonl"
            proposal.parent.mkdir(parents=True)
            write_jsonl(proposal, [self.proposal(source_text="absent")])
            (root / "units.jsonl").write_text(json.dumps(self.unit, ensure_ascii=False) + "\n", encoding="utf-8")
            self.assertEqual(main(["validate-semantic", "--output", str(root), "--proposal", str(proposal)]), 1)
            checkpoint = json.loads((root / "checkpoints" / "semantic-validation.json").read_text(encoding="utf-8"))
        self.assertEqual(checkpoint["status"], "BLOCKED")
        self.assertEqual(checkpoint["error_count"], 1)

    def bundle_inputs(self, root):
        structure = {
            "tome": {"number": 2, "label": "TOME 2"},
            "chapters": [
                {"chapter": chapter, "id": "chapter-" + str(chapter), "page_start": 19 + chapter - 49, "page_end": 20 + chapter - 49}
                for chapter in range(49, 55)
            ],
        }
        units = [json.loads(json.dumps(self.unit))] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
        visuals = [
            {
                "candidate_id": "visual-1",
                "book_id": BOOK_ID,
                "source_version": SOURCE_VERSION,
                "structural_path": self.structural_path,
                "host_unit_id": "unit-49-1",
                "source_page_index_start": 19,
                "source_page_index_end": 19,
                "printed_page_start": "1084",
                "printed_page_end": "1084",
                "raw_text": "traitement",
                "reading_text": "traitement",
            }
        ]
        medications = [
            {
                "candidate_id": "medication-1",
                "book_id": BOOK_ID,
                "source_version": SOURCE_VERSION,
                "structural_path": self.structural_path,
                "host_unit_id": "unit-49-1",
                "source_page_index_start": 19,
                "source_page_index_end": 19,
                "printed_page_start": "1084",
                "printed_page_end": "1084",
                "raw_text": "traitement",
                "reading_text": "traitement",
            }
        ]
        write_json(root / "structure.json", structure)
        write_jsonl(root / "units.jsonl", units)
        write_jsonl(root / "visuals.jsonl", visuals)
        write_jsonl(root / "medications.jsonl", medications)
        write_jsonl(
            root / "page-map.jsonl",
            [
                {"source_page_index": unit["source_page_index_start"], "printed_page_number": unit["printed_page_start"]}
                for unit in units
            ],
        )

    def write_page_map(self, root, units):
        write_jsonl(
            root / "page-map.jsonl",
            [
                {"source_page_index": unit["source_page_index_start"], "printed_page_number": unit["printed_page_start"]}
                for unit in units
            ],
        )

    def full_bundle_inputs(self, root):
        structure = {
            "tome": {"number": 2, "label": "TOME 2"},
            "chapters": [
                {"chapter": chapter, "id": "chapter-" + str(chapter), "page_start": 18 + chapter, "page_end": 18 + chapter}
                for chapter in range(49, 86)
            ],
        }
        candidate = {
            "candidate_id": "visual-1",
            "book_id": BOOK_ID,
            "source_version": SOURCE_VERSION,
            "structural_path": self.structural_path,
            "host_unit_id": "unit-49-1",
            "source_page_index_start": 19,
            "source_page_index_end": 19,
            "printed_page_start": "1084",
            "printed_page_end": "1084",
        }
        write_json(root / "structure.json", structure)
        write_jsonl(root / "units.jsonl", self.range_units)
        write_jsonl(root / "visuals.jsonl", [candidate])
        write_jsonl(root / "medications.jsonl", [])
        write_jsonl(
            root / "page-map.jsonl",
            [
                {"source_page_index": unit["source_page_index_start"], "printed_page_number": unit["printed_page_start"]}
                for unit in self.range_units
            ],
        )

    def test_checkpoint_discards_bundle_with_candidate_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.full_bundle_inputs(root)
            for chapter_start, chapter_end in ((49, 54), (55, 65), (66, 72), (73, 85)):
                create_chapter_bundle(root, chapter_start, chapter_end)
            part_a = root / "work" / "chapters" / "part-a-49-54.jsonl"
            rows = [json.loads(line) for line in part_a.read_text(encoding="utf-8").splitlines()]
            rows[0]["visual_candidates"] = []
            write_jsonl(part_a, rows)
            checkpoint_path = root / "checkpoints" / "semantic-bundles.json"
            checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
            checkpoint["bundles"][0]["sha256"] = hashlib.sha256(part_a.read_bytes()).hexdigest()
            write_json(checkpoint_path, checkpoint)
            create_chapter_bundle(root, 55, 65)
            checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        self.assertEqual(checkpoint["status"], "BLOCKED")
        self.assertEqual(checkpoint["error_code"], "missing_bundle_set")
        self.assertNotIn("part-a-49-54", [entry["name"] for entry in checkpoint["bundles"]])

    def test_checkpoint_duplicate_approved_bundle_is_blocked(self):
        for duplicate_index in (0, 1):
            with self.subTest(duplicate_index=duplicate_index), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.full_bundle_inputs(root)
                for chapter_start, chapter_end in ((49, 54), (55, 65), (66, 72), (73, 85)):
                    create_chapter_bundle(root, chapter_start, chapter_end)
                checkpoint_path = root / "checkpoints" / "semantic-bundles.json"
                checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
                checkpoint["bundles"].append(dict(checkpoint["bundles"][duplicate_index]))
                write_json(checkpoint_path, checkpoint)
                create_chapter_bundle(root, 49, 54)
                checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
                self.assertEqual(checkpoint["status"], "BLOCKED")
                self.assertEqual(checkpoint["error_code"], "duplicate_bundle_set")

    def test_checkpoint_rejects_stale_or_mismatched_metadata(self):
        mutations = {
            "chapter_range": lambda entry: entry.update({"chapter_start": 50}),
            "unit_ids": lambda entry: entry.update({"unit_ids_sha256": "0" * 64}),
            "candidate_count": lambda entry: entry.update({"visual_candidate_count": 999}),
            "extra_metadata": lambda entry: entry.update({"legacy": "stale"}),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.full_bundle_inputs(root)
                for chapter_start, chapter_end in ((49, 54), (55, 65), (66, 72), (73, 85)):
                    create_chapter_bundle(root, chapter_start, chapter_end)
                checkpoint_path = root / "checkpoints" / "semantic-bundles.json"
                checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
                mutate(checkpoint["bundles"][1])
                write_json(checkpoint_path, checkpoint)
                create_chapter_bundle(root, 49, 54)
                checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
                self.assertEqual(checkpoint["status"], "BLOCKED")
                self.assertEqual(checkpoint["error_code"], "missing_bundle_set")

    def test_bundle_preserves_exact_dual_text_unit_and_candidate_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            summary = create_chapter_bundle(root, 49, 54)
            path = root / "work" / "chapters" / "part-a-49-54.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            checkpoint = json.loads((root / "checkpoints" / "semantic-bundles.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["unit_count"], 6)
            self.assertEqual(len(summary["unit_ids_sha256"]), 64)
            self.assertEqual(rows[0]["unit"]["raw_text"], self.unit["raw_text"])
            self.assertEqual(rows[0]["unit"]["reading_text"], self.unit["reading_text"])
            self.assertEqual(rows[0]["visual_candidates"][0]["candidate_id"], "visual-1")
            self.assertEqual(rows[0]["medication_candidates"][0]["candidate_id"], "medication-1")
            self.assertEqual(checkpoint["bundles"][0]["sha256"], hashlib.sha256(path.read_bytes()).hexdigest())
            self.assertEqual(checkpoint["status"], "BLOCKED")
            self.assertEqual(checkpoint["error_code"], "missing_bundle_set")

    def test_bundle_rejects_empty_page_map_label(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            page_map = read_jsonl(root / "page-map.jsonl")
            page_map[0]["printed_page_number"] = ""
            write_jsonl(root / "page-map.jsonl", page_map)
            with self.assertRaises(ContractError) as error:
                create_chapter_bundle(root, 49, 54)
        self.assertEqual(error.exception.code, "invalid_page_map_printed_page")

    def test_bundle_preserves_non_numeric_exact_printed_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            units = [self.unit] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
            units[-1] = json.loads(json.dumps(units[-1]))
            units[-1]["printed_page_start"] = "X"
            units[-1]["printed_page_end"] = "X"
            units[-1]["data"]["block_records"][0]["printed_page_number"] = "X"
            write_jsonl(root / "units.jsonl", units)
            self.write_page_map(root, units)
            summary = create_chapter_bundle(root, 49, 54)
            path = root / "work" / "chapters" / "part-a-49-54.jsonl"
            rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
            self.assertEqual(summary["printed_page_end"], "X")
            self.assertEqual(rows[-1]["unit"]["printed_page_end"], "X")

    def test_bundle_rejects_duplicate_unit_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            units = [self.unit] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
            units.append(json.loads(json.dumps(self.unit)))
            write_jsonl(root / "units.jsonl", units)
            with self.assertRaises(ContractError) as error:
                create_chapter_bundle(root, 49, 54)
            checkpoint = json.loads((root / "checkpoints" / "semantic-bundles.json").read_text(encoding="utf-8"))
        self.assertEqual(error.exception.code, "duplicate_unit_id")
        self.assertEqual(checkpoint["status"], "BLOCKED")

    def test_bundle_preserves_exact_null_bundle_boundary_labels(self):
        for boundary in ("start", "end"):
            with self.subTest(boundary=boundary), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.bundle_inputs(root)
                units = [json.loads(json.dumps(self.unit))] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
                unit = units[0] if boundary == "start" else units[-1]
                unit["printed_page_start"] = None
                unit["printed_page_end"] = None
                unit["data"]["block_records"][0]["printed_page_number"] = None
                write_jsonl(root / "units.jsonl", units)
                self.write_page_map(root, units)
                if boundary == "start":
                    visuals = [json.loads(json.dumps(record)) for record in read_jsonl(root / "visuals.jsonl")]
                    medications = [json.loads(json.dumps(record)) for record in read_jsonl(root / "medications.jsonl")]
                    for record in visuals + medications:
                        record["printed_page_start"] = None
                        record["printed_page_end"] = None
                    write_jsonl(root / "visuals.jsonl", visuals)
                    write_jsonl(root / "medications.jsonl", medications)
                summary = create_chapter_bundle(root, 49, 54)
                self.assertIsNone(summary["printed_page_" + boundary])

    def test_bundle_rejects_invalid_unit_page_bounds(self):
        cases = {
            "out_of_bounds": (826, 826),
            "inverted": (20, 19),
            "block_page": (19, 19),
        }
        for case, (start, end) in cases.items():
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.bundle_inputs(root)
                units = [json.loads(json.dumps(self.unit))] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
                units[0]["source_page_index_start"] = start
                units[0]["source_page_index_end"] = end
                if case == "block_page":
                    units[0]["data"]["block_records"][0]["source_page_index"] = 826
                write_jsonl(root / "units.jsonl", units)
                with self.assertRaises(ContractError) as error:
                    create_chapter_bundle(root, 49, 54)
                self.assertEqual(error.exception.code, "invalid_unit_page_range")

    def test_bundle_rejects_unit_printed_label_not_matching_page_block(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            units = [json.loads(json.dumps(self.unit))] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
            units[1]["printed_page_start"] = "9999"
            units[1]["printed_page_end"] = "9999"
            write_jsonl(root / "units.jsonl", units)
            with self.assertRaises(ContractError) as error:
                create_chapter_bundle(root, 49, 54)
        self.assertEqual(error.exception.code, "unit_printed_page_mismatch")

    def test_bundle_rejects_missing_unit_printed_boundary_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            units = [json.loads(json.dumps(self.unit))] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
            units[1]["printed_page_start"] = None
            units[1]["printed_page_end"] = None
            units[1]["data"]["block_records"][0]["printed_page_number"] = None
            self.write_page_map(root, units)
            units[1].pop("printed_page_start")
            write_jsonl(root / "units.jsonl", units)
            with self.assertRaises(ContractError) as error:
                create_chapter_bundle(root, 49, 54)
        self.assertEqual(error.exception.code, "unit_printed_page_mismatch")

    def test_bundle_rejects_block_without_printed_page_key(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            units = [json.loads(json.dumps(self.unit))] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
            units[1]["data"]["block_records"][0].pop("printed_page_number")
            write_jsonl(root / "units.jsonl", units)
            with self.assertRaises(ContractError) as error:
                create_chapter_bundle(root, 49, 54)
        self.assertEqual(error.exception.code, "unit_printed_page_mismatch")

    def test_bundle_rejects_unit_boundary_without_host_block_provenance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            units = [json.loads(json.dumps(self.unit))] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
            units[1]["data"]["block_records"] = []
            write_jsonl(root / "units.jsonl", units)
            with self.assertRaises(ContractError) as error:
                create_chapter_bundle(root, 49, 54)
        self.assertEqual(error.exception.code, "unit_printed_page_mismatch")

    def test_bundle_accepts_exact_null_unit_and_candidate_printed_labels(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            units = [json.loads(json.dumps(self.unit))] + [self.chapter_unit(chapter) for chapter in range(50, 55)]
            units[1]["printed_page_start"] = None
            units[1]["printed_page_end"] = None
            units[1]["data"]["block_records"][0]["printed_page_number"] = None
            write_jsonl(root / "units.jsonl", units)
            self.write_page_map(root, units)
            candidate = {
                "candidate_id": "visual-null",
                "book_id": BOOK_ID,
                "source_version": SOURCE_VERSION,
                "structural_path": units[1]["structural_path"],
                "host_unit_id": units[1]["unit_id"],
                "source_page_index_start": 68,
                "source_page_index_end": 68,
                "printed_page_start": None,
                "printed_page_end": None,
            }
            write_jsonl(root / "visuals.jsonl", [candidate])
            create_chapter_bundle(root, 49, 54)

    def test_bundle_missing_chapter_units_replaces_stale_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            (root / "checkpoints").mkdir()
            write_json(
                root / "checkpoints" / "semantic-bundles.json",
                {
                    "book_id": BOOK_ID,
                    "source_version": SOURCE_VERSION,
                    "bundle_count": 4,
                    "expected_bundle_count": 4,
                    "bundles": [],
                    "status": "PASS",
                },
            )
            units = [self.unit] + [self.chapter_unit(chapter) for chapter in range(51, 55)]
            write_jsonl(root / "units.jsonl", units)
            with self.assertRaises(ContractError) as error:
                create_chapter_bundle(root, 49, 54)
            checkpoint = json.loads((root / "checkpoints" / "semantic-bundles.json").read_text(encoding="utf-8"))
        self.assertEqual(error.exception.code, "missing_chapter_units")
        self.assertEqual(checkpoint["status"], "BLOCKED")
        self.assertEqual(checkpoint["error_code"], "missing_chapter_units")

    def test_bundle_rejects_candidate_host_page_and_structural_path(self):
        cases = ["host", "page", "structural_path", "inverted", "out_of_bounds", "printed_mismatch", "null_mismatch", "missing_label", "empty_label"]
        host_unit = self.chapter_unit(50)
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                self.bundle_inputs(root)
                candidate = {
                    "candidate_id": "visual-1",
                    "book_id": BOOK_ID,
                    "source_version": SOURCE_VERSION,
                    "structural_path": host_unit["structural_path"],
                    "host_unit_id": host_unit["unit_id"],
                    "source_page_index_start": 68,
                    "source_page_index_end": 68,
                    "printed_page_start": "1133",
                    "printed_page_end": "1133",
                }
                if case == "host":
                    candidate["host_unit_id"] = "unit-missing"
                elif case == "page":
                    candidate["source_page_index_start"] = 90
                    candidate["source_page_index_end"] = 90
                elif case == "structural_path":
                    candidate["structural_path"] = "Partie 6/Traitements/Chapitre 70"
                elif case == "inverted":
                    candidate["source_page_index_start"] = 69
                    candidate["source_page_index_end"] = 68
                elif case == "out_of_bounds":
                    candidate["source_page_index_start"] = 826
                    candidate["source_page_index_end"] = 826
                elif case == "printed_mismatch":
                    candidate["printed_page_start"] = "9999"
                    candidate["printed_page_end"] = "9999"
                elif case == "null_mismatch":
                    candidate["printed_page_start"] = None
                    candidate["printed_page_end"] = None
                elif case == "missing_label":
                    candidate.pop("printed_page_start")
                    candidate.pop("printed_page_end")
                else:
                    candidate["printed_page_start"] = ""
                    candidate["printed_page_end"] = ""
                write_jsonl(root / "visuals.jsonl", [candidate])
                with self.assertRaises(ContractError):
                    create_chapter_bundle(root, 49, 54)
                checkpoint = json.loads((root / "checkpoints" / "semantic-bundles.json").read_text(encoding="utf-8"))
                self.assertEqual(checkpoint["status"], "BLOCKED")

    def test_bundle_rejects_other_book_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            units = [dict(self.unit)]
            units[0]["book_id"] = "other-book"
            write_jsonl(root / "units.jsonl", units)
            with self.assertRaises(ContractError) as error:
                create_chapter_bundle(root, 49, 54)
        self.assertEqual(error.exception.code, "foreign_source")

    def test_bundle_rejects_non_tome_two_chapter_range(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.bundle_inputs(root)
            with self.assertRaises(ContractError) as error:
                create_chapter_bundle(root, 48, 54)
        self.assertEqual(error.exception.code, "invalid_chapter_range")


if __name__ == "__main__":
    unittest.main()
