import json
import os
import re
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROPOSALS = ROOT / "semantic" / "proposals"
PART_D = PROPOSALS / "part-d-73-85.jsonl"
BUNDLE = ROOT / "work" / "chapters" / "part-d-73-85.jsonl"


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def chapter(path):
    match = re.search(r"/Chapitre\s+(\d+)\b", path or "")
    return int(match.group(1)) if match else None


def locked_rows():
    rows = read_jsonl(BUNDLE)
    return rows, {row["unit"]["unit_id"] for row in rows}


def proposal_rows():
    self_path = PART_D
    if not self_path.exists():
        return None
    return read_jsonl(self_path)


class PartDRegressionTests(unittest.TestCase):
    def test_executable_scope_is_exactly_250_and_partial_artifact_is_replaced(self):
        rows, _ = locked_rows()
        self.assertEqual(len(rows), 250)
        self.assertTrue(PART_D.exists())
        proposals = proposal_rows()
        self.assertIsNotNone(proposals)
        coverage = [record for record in proposals if record["kind"] == "coverage"]
        self.assertEqual(len(coverage), 250)
        self.assertEqual(len({record["unit_id"] for record in coverage}), 250)
        self.assertFalse((PROPOSALS / "part-d-73-79.jsonl").exists())
        self.assertEqual(
            sorted(path.name for path in PROPOSALS.glob("*.jsonl")),
            ["part-a-49-54.jsonl", "part-b-55-65.jsonl", "part-c-66-72.jsonl", "part-d-73-85.jsonl"],
        )

    def test_candidate_proposals_use_locked_candidate_page_block_occurrence_and_text(self):
        proposals = proposal_rows()
        self.assertIsNotNone(proposals)
        rows, unit_ids = locked_rows()
        units = {row["unit"]["unit_id"]: row["unit"] for row in rows}
        locked = {}
        for path, kind in ((ROOT / "medications.jsonl", "medication"), (ROOT / "visuals.jsonl", "visual_review")):
            for candidate in read_jsonl(path):
                if candidate.get("host_unit_id") in unit_ids:
                    locked[candidate["candidate_id"]] = (kind, candidate)
        emitted = {record.get("candidate_id"): record for record in proposals if record["kind"] in {"medication", "visual_review"}}
        self.assertEqual(set(emitted), set(locked))
        for candidate_id, (kind, candidate) in locked.items():
            with self.subTest(candidate_id=candidate_id, kind=kind):
                record = emitted[candidate_id]
                self.assertEqual(record.get("candidate_source_span"), candidate.get("source_span"))
                self.assertEqual(record.get("source_page_index_start"), candidate.get("source_page_index_start"))
                self.assertEqual(record.get("source_page_index_end"), candidate.get("source_page_index_end"))
                self.assertEqual(record.get("printed_page_start"), candidate.get("printed_page_start"))
                self.assertEqual(record.get("printed_page_end"), candidate.get("printed_page_end"))
                self.assertEqual(record.get("source_text"), candidate.get("raw_text"))
                if kind == "medication":
                    for field in ("source_name_text", "brand_name_text", "dose_text", "dose_unit_text", "route_text", "frequency_text"):
                        self.assertEqual(record.get(field), candidate.get(field))
                else:
                    self.assertEqual(record.get("caption"), candidate.get("caption"))

    def test_risperidone_candidate_is_not_bound_to_same_indexed_block_on_another_page(self):
        proposals = proposal_rows()
        self.assertIsNotNone(proposals)
        rows, unit_ids = locked_rows()
        units = {row["unit"]["unit_id"]: row["unit"] for row in rows}
        candidates = [candidate for candidate in read_jsonl(ROOT / "medications.jsonl") if candidate.get("host_unit_id") in unit_ids]
        risperidone = [candidate for candidate in candidates if "risperidone" in json.dumps(candidate, ensure_ascii=False).casefold() or "rispéridone" in json.dumps(candidate, ensure_ascii=False).casefold()]
        self.assertTrue(risperidone, "locked Chapters 73-85 must contain at least one risperidone candidate; a silent skip is not allowed")
        for candidate in risperidone:
            record = next(record for record in proposals if record.get("candidate_id") == candidate["candidate_id"])
            self.assertEqual(record["source_page_index_start"], candidate["source_page_index_start"])
            self.assertEqual(record["source_span"]["source_page_index"], candidate["source_page_index_start"])
            self.assertEqual(record["source_text"], candidate["raw_text"])
            self.assertEqual(record["dose_text"], candidate["dose_text"])
            self.assertEqual(record["route_text"], candidate["route_text"])

    def test_unit_classification_is_computed_from_all_blocks(self):
        proposals = proposal_rows()
        self.assertIsNotNone(proposals)
        rows, _ = locked_rows()
        units = {row["unit"]["unit_id"]: row["unit"] for row in rows}
        coverage = {record["unit_id"]: record for record in proposals if record["kind"] == "coverage"}
        for unit_id, unit in units.items():
            record = coverage[unit_id]
            blocks = [block for block in unit.get("data", {}).get("block_records", []) if block.get("raw_text", "").strip()]
            nonclinical_path = any(marker.casefold() in unit.get("structural_path", "").casefold() for marker in ("Références", "Index", "Front matter", "Couverture", "Crédits"))
            author_only = unit.get("content_type") == "chapter_opening" or all(
                "...." in block.get("raw_text", "")
                or any(marker in block.get("raw_text", "") for marker in ("Ph. D.", "M.D.", "Psychologue", "Psychiatre", "Professeur", "Université", "Département"))
                for block in blocks
            )
            has_clinical = any(re.search(r"[.!?](?=\s|$)", block.get("raw_text", "")) for block in blocks if "...." not in block.get("raw_text", ""))
            if nonclinical_path or author_only or not has_clinical:
                self.assertEqual(record["coverage_status"], "not_clinical")
                self.assertFalse(any(item["unit_id"] == unit_id and item["kind"] in {"claim", "concept"} for item in proposals))
            else:
                self.assertEqual(record["coverage_status"], "covered")

    def test_claim_objects_are_atomic_and_clinical_domain_is_consistent(self):
        proposals = proposal_rows()
        self.assertIsNotNone(proposals)
        claims = [record for record in proposals if record["kind"] == "claim"]
        self.assertGreater(len(claims), 0)
        for record in claims:
            with self.subTest(proposal_id=record["proposal_id"]):
                self.assertEqual(record["clinical_domain"], "Traitements psychosociaux")
                self.assertLessEqual(len(record["object"]), 300)
                self.assertIn(record["object"], record["source_text"])
                self.assertNotRegex(record["object"], r"[.!?].*[.!?]")
                self.assertFalse(re.search(r"(?:\bal|etc)\s*$", record["object"], re.IGNORECASE))
                self.assertRegex(record["subject"], r"(?<!\w).+(?!\w)")
                self.assertNotRegex(record["evidence_or_recommendation_wording"], r"(?i)^a\s+remédiation cognitive")

    def test_claim_audit_rejects_citation_fragments_and_multi_predicate_objects(self):
        audit = json.loads((ROOT / "checkpoints" / "semantic-part-d-audit.json").read_text(encoding="utf-8"))
        self.assertEqual(audit["claim_safety"]["truncated_citation_count"], 0)
        self.assertEqual(audit["claim_safety"]["fragment_count"], 0)
        self.assertEqual(audit["claim_safety"]["multi_predicate_count"], 0)
        self.assertEqual(audit["claim_safety"]["substring_subject_count"], 0)
        self.assertEqual(audit["claim_safety"]["coordinated_object_count"], 0)
        self.assertEqual(audit["claim_safety"]["status"], "PASS")

    def test_claim_safety_detector_fails_on_coordinated_object_classes(self):
        from tools.canon_v2.semantic_audit import claim_safety

        cases = {
            "non_seulement_mais_aussi": {
                "subject": "psychothérapie",
                "object": "traitement non seulement efficace mais aussi rentable",
                "evidence_or_recommendation_wording": "psychothérapie est un traitement non seulement efficace mais aussi rentable",
            },
            "a_la_fois_et": {
                "subject": "thérapie",
                "object": "méthode à la fois brève et efficace",
                "evidence_or_recommendation_wording": "thérapie est une méthode à la fois brève et efficace",
            },
            "bare_conjunction": {
                "subject": "relation thérapeutique",
                "object": "processus dynamique et non linéaire",
                "evidence_or_recommendation_wording": "relation thérapeutique est un processus dynamique et non linéaire",
            },
        }
        for name, record in cases.items():
            with self.subTest(pattern=name):
                result = claim_safety([{"proposal_id": "synthetic", **record}])
                self.assertEqual(result["coordinated_object_count"], 1)
                self.assertEqual(result["status"], "FAIL")
                self.assertIn(name, result["coordinated_object_patterns"])

    def test_coordinated_claim_was_split_into_source_exact_atomic_claims(self):
        proposals = proposal_rows()
        self.assertIsNotNone(proposals)
        claims = [record for record in proposals if record["kind"] == "claim"]
        coordinated = [
            record
            for record in claims
            if re.search(r"(?is)\bnon\s+seulement\b|\bà\s+la\s+fois\b", record["object"])
        ]
        self.assertEqual(coordinated, [], "coordinated objects must be split, not emitted as one claim")
        derived = [record for record in claims if record["source_page_index_start"] == 521 and record["predicate_or_relation"] == "defined_by" and record["object"] == "traitement"]
        self.assertEqual(len(derived), 1)
        efficacy = [record for record in claims if record["source_page_index_start"] == 521 and record["predicate_or_relation"] == "associated_with"]
        self.assertEqual(len(efficacy), 2, "efficacy and cost-effectiveness must be separate atomic claims")
        for record in derived + efficacy:
            with self.subTest(proposal_id=record["proposal_id"]):
                self.assertIn(record["object"], record["source_text"])
                self.assertIn(record["evidence_or_recommendation_wording"], record["source_text"])
                self.assertLessEqual(len(record["object"]), 60)
                self.assertEqual(record["validation_status"], "needs_review")
        cost = next(record for record in efficacy if record["object"] == "rentable")
        self.assertIn("Zimmermann", cost["evidence_or_recommendation_wording"])

    def test_tome2_resolved_xref_targets_exist_in_the_structure(self):
        audit = json.loads((ROOT / "checkpoints" / "semantic-part-d-audit.json").read_text(encoding="utf-8"))
        self.assertEqual(audit["xref_structure"]["error_count"], 0)
        self.assertEqual(audit["xref_structure"]["status"], "PASS")
        self.assertGreater(audit["xref_structure"]["checked_count"], 0)
        self.assertEqual(audit["xref_structure"]["tome2_structure_chapter_count"], 37)
        structure = {
            chapter(row.get("structural_path"))
            for row in read_jsonl(ROOT / "units.jsonl")
            if isinstance(chapter(row.get("structural_path")), int)
        }
        proposals = proposal_rows()
        for record in proposals:
            if record["kind"] != "xref" or record["target_scope"] != "tome-2" or record["xref_status"] != "resolved":
                continue
            match = re.fullmatch(r"(?i)chapitre\s+(\d+)", record["target"].strip())
            if match is not None:
                with self.subTest(target=record["target"]):
                    self.assertIn(int(match.group(1)), structure)

    def test_known_minor_issues_stay_review_only(self):
        audit = json.loads((ROOT / "checkpoints" / "semantic-part-d-audit.json").read_text(encoding="utf-8"))
        known = audit["review_only_known_issues"]
        self.assertEqual(known["status"], "PASS")
        self.assertEqual(known["not_needing_review_proposal_ids"], [])
        self.assertGreater(known["duplicate_visual_review_group_count"], 0)
        self.assertGreater(known["empty_medication_name_candidate_count"], 0)
        proposals = proposal_rows()
        flagged = [record for record in proposals if record["kind"] in {"visual_review", "medication"}]
        self.assertTrue(flagged)
        for record in flagged:
            self.assertEqual(record["validation_status"], "needs_review")

    def test_replay_manifest_does_not_claim_generation_independence(self):
        manifest = json.loads((ROOT / "work" / "replay" / "part-d-73-85-manifest.json").read_text(encoding="utf-8"))
        self.assertNotIn("independent_generation", manifest)
        self.assertEqual(manifest["replay_mode"], "deterministic_regeneration_from_locked_bundle")
        self.assertTrue(manifest["generator_shared_with_approved_proposal"])
        self.assertIn("none", manifest["independence_claim"])
        self.assertEqual(manifest["generator_source"], "tools/canon_v2/semantic_part_d.py")
        self.assertTrue(manifest["match"])

    def test_semantic_modules_have_no_direct_module_entrypoint(self):
        for relative in ("tools/canon_v2/semantic_part_d.py", "tools/canon_v2/semantic_audit.py"):
            with self.subTest(module=relative):
                source = (ROOT / relative).read_text(encoding="utf-8")
                self.assertNotIn('if __name__ == "__main__"', source)
                self.assertNotIn("__main__", source)
                self.assertNotIn("argparse", source)

    def test_direct_module_execution_cannot_overwrite_approved_artifacts(self):
        import subprocess

        modules = ("tools.canon_v2.semantic_part_d", "tools.canon_v2.semantic_audit")
        watched = [
            PART_D,
            ROOT / "checkpoints" / "semantic-part-d-audit.json",
            ROOT / "checkpoints" / "semantic-part-d.json",
            ROOT / "work" / "replay" / "part-d-73-85.jsonl",
            ROOT / "work" / "replay" / "part-d-73-85-manifest.json",
        ]
        before = {path: (path.read_bytes() if path.exists() else None) for path in watched}
        environment = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "PYTHONPATH": str(ROOT)}
        invocations = [
            [sys.executable, str(ROOT / (module.replace(".", "/") + ".py")), str(ROOT)]
            for module in modules
        ] + [
            [sys.executable, "-m", module, str(ROOT)]
            for module in modules
        ]
        for command in invocations:
            label = " ".join(command[1:])
            with self.subTest(invocation=label):
                result = subprocess.run(command, capture_output=True, text=True, cwd=str(ROOT), env=environment)
                self.assertEqual(result.stdout.strip(), "", "a semantic module must not print an operational result")
                self.assertNotIn("proposal_count", result.stdout)
                self.assertNotIn("proposal_path", result.stdout)
        after = {path: (path.read_bytes() if path.exists() else None) for path in watched}
        self.assertEqual(after, before, "direct module execution must not modify approved artifacts")

    def test_cli_generate_writes_proposal_atomically(self):
        import tempfile
        from unittest import mock

        from tools.canon_v2.semantic_part_d import generate

        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / "part-d-73-85.jsonl"
            target.write_text("ORIGINAL-CONTENT", encoding="utf-8")
            with mock.patch.object(Path, "replace", side_effect=OSError("simulated atomic replace failure")):
                with self.assertRaises(OSError):
                    generate(ROOT, target)
            self.assertEqual(target.read_text(encoding="utf-8"), "ORIGINAL-CONTENT")
            self.assertEqual(list(Path(temporary).glob("*.tmp")), [])

    def test_cli_subcommands_leave_no_partial_files(self):
        for relative in (
            "semantic/proposals",
            "checkpoints",
            "work/replay",
        ):
            with self.subTest(directory=relative):
                self.assertEqual([path.name for path in (ROOT / relative).glob("*.tmp")], [])

    def test_cli_exposes_audit_and_replay_subcommands(self):
        from tools.ingest_book import build_parser
        choices = build_parser()._subparsers._group_actions[0].choices
        self.assertIn("audit-semantic", choices)
        self.assertIn("replay-semantic", choices)

    def test_replay_is_independent_and_matches_approved_proposal(self):
        replay_path = ROOT / "work" / "replay" / "part-d-73-85.jsonl"
        manifest_path = ROOT / "work" / "replay" / "part-d-73-85-manifest.json"
        self.assertTrue(replay_path.exists())
        self.assertTrue(manifest_path.exists())
        proposal = ROOT / "semantic" / "proposals" / "part-d-73-85.jsonl"
        self.assertEqual(replay_path.read_bytes(), proposal.read_bytes())
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["proposal_count"], 738)
        self.assertEqual(manifest["kind_counts"]["claim"], 7)
        self.assertEqual(manifest["coverage_count"], 250)
        self.assertEqual(manifest["proposal_sha256"], __import__("hashlib").sha256(replay_path.read_bytes()).hexdigest())
        self.assertEqual(manifest["generator_source"], "tools/canon_v2/semantic_part_d.py")
        self.assertNotEqual(manifest["generator_source"], "semantic/proposals/part-d-73-85.jsonl")

    def test_machine_readable_audit_covers_all_contract_dimensions(self):
        audit_path = ROOT / "checkpoints" / "semantic-part-d-audit.json"
        self.assertTrue(audit_path.exists())
        audit = json.loads(audit_path.read_text(encoding="utf-8"))
        self.assertEqual(audit["scope"]["executable_unit_count"], 250)
        self.assertEqual(audit["scope"]["coverage_count"], 250)
        self.assertEqual(audit["coverage"]["expected_count"], 250)
        self.assertEqual(audit["coverage"]["actual_count"], 250)
        self.assertGreater(audit["provenance"]["checked_count"], 0)
        self.assertGreater(audit["candidate_alignment"]["checked_count"], 0)
        self.assertGreater(audit["subject_safety"]["claim_count"], 0)
        self.assertGreaterEqual(audit["age_temporal"]["claim_count"], 0)
        self.assertEqual(audit["classification"]["covered_count"] + audit["classification"]["not_clinical_count"], 250)
        self.assertEqual(audit["errors"], [])


if __name__ == "__main__":
    unittest.main()
