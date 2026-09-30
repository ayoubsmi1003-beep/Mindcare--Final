"""TDD red-first tests for minimal batch-authorization extension.

Covers: refusal paths, exception enumeration exactness on the real
Tome 2 book (read-only, no writes), record schema completeness,
canonical-file immutability, no individual dispositions created.
Never records a real attestation: write-path tests use synthetic temp
books only; real-book tests are read-only enumeration.
"""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

BOOK_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BOOK_ROOT))

from tools.canon_v2.review import authorize_batch  # noqa: E402 (red: missing)


def _sha(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as s:
        for chunk in iter(lambda: s.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _queue_item(queue_id, file, **extra):
    base = {
        "queue_id": queue_id,
        "file": file,
        "reason": "needs human review: " + queue_id,
        "validation_status": "needs_review",
    }
    base.update(extra)
    return base


def _make_synthetic_success_book(root: Path, n_total: int = 2306):
    """Build a synthetic book that passes all batch gates.

    Manifest + merge-report (errors==[], rejected 0) + replay PASS +
    review-queue with n_total items sharing one envelope. Exception
    members are synthesized to mirror the real-book shapes:
    1 xref tome-2 Chapitre 67, 2 empty-medication-name raws,
    11 continuation visuals (grouped 5/3/3 by host), 1 claim with
    U+E00F, 43 page-map + 66 unit mapping gaps. Remaining are routine.
    """
    book_id = "psychiatrie-clinique-tome-2-2016-tc-media"
    source_version = (
        "sha256:22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76"
    )
    (root / "manifest.json").write_text(
        json.dumps(
            {"book_id": book_id, "source_version": source_version}, sort_keys=True
        )
        + "\n",
        encoding="utf-8",
    )
    (root / "semantic").mkdir(parents=True, exist_ok=True)
    (root / "semantic" / "merge-report.json").write_text(
        json.dumps(
            {"errors": [], "rejected_count": 0, "rejected_proposal_ids": []},
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )
    (root / "checkpoints").mkdir(parents=True, exist_ok=True)
    (root / "checkpoints" / "replay.json").write_text(
        json.dumps({"status": "PASS", "match": True}, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    items = []
    # 1 xref tome-2 Chapitre 67
    items.append(
        _queue_item(
            "xref-task7-xref-7399b372fb407925c85b",
            "semantic/xrefs.jsonl",
            proposal_id="task7-xref-7399b372fb407925c85b",
            reason=(
                "xref status unresolved scope tome-2 target Chapitre 67; "
                "Tome 1 targets remain unresolved_external"
            ),
        )
    )
    # 2 empty meds (generic header + drug-less question)
    items.append(
        _queue_item(
            "medication-review-medication:fbc6a3bfa7bf4",
            "medications.jsonl",
            candidate_id=(
                "medication:fbc6a3bfa7bf4c8cf137929789a2b84baa0d3246ad9ab78"
                "763b534994255db7b"
            ),
        )
    )
    items.append(
        _queue_item(
            "medication-review-medication:c51021d2ce204",
            "medications.jsonl",
            candidate_id=(
                "medication:c51021d2ce204dfc8ee5fbf41a4d688c501d8f2b73708097"
                "3d5fc1d144eee024"
            ),
        )
    )
    (root / "medications.jsonl").write_text(
        "".join(
            json.dumps(
                {
                    "candidate_id": cid,
                    "source_name_text": None,
                    "brand_name_text": None,
                    "dose_text": None,
                    "raw_text": raw,
                },
                ensure_ascii=False,
            )
            + "\n"
            for cid, raw in (
                (
                    "medication:fbc6a3bfa7bf4c8cf137929789a2b84baa0d3246ad9ab78"
                    "763b534994255db7b",
                    "m\u00e9dicaments",
                ),
                (
                    "medication:c51021d2ce204dfc8ee5fbf41a4d688c501d8f2b73708097"
                    "3d5fc1d144eee024",
                    "a-t-il moyen d'\u00e9viter les rechutes sans prendre un "
                    "m\u00e9dicament",
                ),
            )
        ),
        encoding="utf-8",
    )
    # 11 continuation visuals: hosts 5 / 3 / 1+1+1(coalesced)=3
    cont_hosts = (
        ["unit:host-5"] * 5 + ["unit:host-3"] * 3 + ["unit:s1", "unit:s2", "unit:s3"]
    )
    visuals_lines = []
    for idx, host in enumerate(cont_hosts):
        cid = "visual:cont-%04d-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" % idx
        qid = "visual-review-visual:cont-%04d" % idx
        items.append(
            _queue_item(
                qid, "visuals.jsonl", candidate_id=cid, unit_id=host,
            )
        )
        visuals_lines.append(
            json.dumps(
                {
                    "candidate_id": cid,
                    "host_unit_id": host,
                    "continuation_of": "visual:parent",
                    "caption": "TABLEAU cont %d" % idx,
                },
                ensure_ascii=False,
            )
        )
    (root / "visuals.jsonl").write_text(
        "\n".join(visuals_lines) + "\n", encoding="utf-8"
    )
    # 1 private-use claim with U+E00F
    items.append(
        _queue_item(
            "numeric-claim-fix-6fc9ca179d79224c6c75",
            "semantic/proposals/*",
            proposal_id="claim-fix-6fc9ca179d79224c6c75",
        )
    )
    prop_dir = root / "semantic" / "proposals"
    prop_dir.mkdir(parents=True, exist_ok=True)
    (prop_dir / "part-a-49-54.jsonl").write_text(
        json.dumps(
            {
                "proposal_id": "claim-fix-6fc9ca179d79224c6c75",
                "kind": "claim",
                "source_text": "Trouble d\ue00fcit de l'attention",
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )
    # 43 page-map + 66 unit gaps
    for idx in range(43):
        items.append(_queue_item("page-%04d" % idx, "page-map.jsonl"))
    for idx in range(66):
        items.append(
            _queue_item(
                "unit-%04d" % idx, "units.jsonl", unit_id="unit:gap-%04d" % idx
            )
        )
    # routine remainder
    need = n_total - len(items)
    for idx in range(need):
        items.append(_queue_item("routine-%04d" % idx, "repairs.jsonl"))
    assert len(items) == n_total
    queue = {
        "book_id": book_id,
        "source_version": source_version,
        "qa_verdict": "WARNING",
        "item_count": len(items),
        "items": items,
        "approval_status": "NOT APPROVED",
    }
    (root / "review-queue.json").write_text(
        json.dumps(queue, sort_keys=True) + "\n", encoding="utf-8"
    )
    return book_id, source_version


class BatchRefusalTests(unittest.TestCase):
    def test_blank_identity_scope_basis_note_refused_no_write(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_synthetic_success_book(root)
            target = root / "review" / "batch-authorizations.jsonl"
            for kwargs in (
                {"doctor_identity": "", "authorization_scope": "s",
                 "approval_basis": "b", "review_note": "n"},
                {"doctor_identity": "   ", "authorization_scope": "s",
                 "approval_basis": "b", "review_note": "n"},
                {"doctor_identity": "Dr T", "authorization_scope": "",
                 "approval_basis": "b", "review_note": "n"},
                {"doctor_identity": "Dr T", "authorization_scope": "s",
                 "approval_basis": "  ", "review_note": "n"},
                {"doctor_identity": "Dr T", "authorization_scope": "s",
                 "approval_basis": "b", "review_note": ""},
                {"doctor_identity": "Dr T", "authorization_scope": "s",
                 "approval_basis": "b", "review_note": "   "},
            ):
                with self.subTest(kwargs=kwargs):
                    with self.assertRaises(ValueError):
                        authorize_batch(root, **kwargs)
                    self.assertFalse(target.exists())

    def test_queue_count_mismatch_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_synthetic_success_book(root, n_total=2306)
            # corrupt count by dropping one item
            q = json.loads((root / "review-queue.json").read_text(encoding="utf-8"))
            q["items"] = q["items"][:-1]
            q["item_count"] = len(q["items"])
            (root / "review-queue.json").write_text(
                json.dumps(q, sort_keys=True) + "\n", encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                authorize_batch(
                    root,
                    doctor_identity="Dr Test",
                    authorization_scope="scope",
                    approval_basis="basis",
                    review_note="note",
                )
            self.assertFalse((root / "review" / "batch-authorizations.jsonl").exists())

    def test_hash_gate_mismatch_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_synthetic_success_book(root)
            # tamper manifest after computing nothing: authorize recomputes,
            # so break the gate by making merge-report fail
            m = json.loads(
                (root / "semantic" / "merge-report.json").read_text(encoding="utf-8")
            )
            m["errors"] = [{"code": "x"}]
            (root / "semantic" / "merge-report.json").write_text(
                json.dumps(m, sort_keys=True) + "\n", encoding="utf-8"
            )
            with self.assertRaises(ValueError):
                authorize_batch(
                    root,
                    doctor_identity="Dr Test",
                    authorization_scope="scope",
                    approval_basis="basis",
                    review_note="note",
                )
            self.assertFalse((root / "review" / "batch-authorizations.jsonl").exists())


class BatchSuccessTests(unittest.TestCase):
    def test_success_record_schema_and_counts(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_synthetic_success_book(root)
            rec = authorize_batch(
                root,
                doctor_identity="Dr Test",
                authorization_scope="test-scope",
                approval_basis="test-basis",
                review_note="synthetic batch review note",
            )
            for field in (
                "record_type", "book_id", "source_version", "manifest_sha256",
                "authorization_scope", "approval_scope", "approval_basis",
                "disposition", "doctor_identity", "review_timestamp",
                "review_note", "total_items", "routine_items",
                "exception_items", "individual_adjudication_count",
                "batch_authorization_count",
            ):
                self.assertIn(field, rec, "missing " + field)
            self.assertEqual(rec["record_type"], "batch_authorization")
            self.assertEqual(rec["approval_scope"], "batch")
            self.assertEqual(rec["disposition"], "approved_for_activation")
            self.assertEqual(rec["individual_adjudication_count"], 0)
            self.assertEqual(rec["batch_authorization_count"], 1)
            self.assertEqual(rec["total_items"], 2306)
            self.assertEqual(
                rec["exception_items"], 1 + 2 + 11 + 1 + 43 + 66
            )
            self.assertEqual(rec["routine_items"], 2306 - rec["exception_items"])
            # exact exception IDs embedded
            self.assertIn("exception_queue_ids", rec)
            self.assertIn("exception_proposal_ids", rec)
            # log appended, adjudications untouched
            lines = (root / "review" / "batch-authorizations.jsonl").read_text(
                encoding="utf-8"
            ).strip().splitlines()
            self.assertEqual(len(lines), 1)
            self.assertFalse((root / "review" / "adjudications.jsonl").exists())

    def test_canonical_immutability_and_no_individual_dispositions(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_synthetic_success_book(root)
            targets = [
                root / "manifest.json",
                root / "review-queue.json",
                root / "medications.jsonl",
                root / "visuals.jsonl",
                root / "semantic" / "merge-report.json",
                root / "semantic" / "proposals" / "part-a-49-54.jsonl",
                root / "checkpoints" / "replay.json",
            ]
            before = {str(p): _sha(p) for p in targets}
            authorize_batch(
                root,
                doctor_identity="Dr Test",
                authorization_scope="s",
                approval_basis="b",
                review_note="n",
            )
            for p in targets:
                self.assertEqual(_sha(p), before[str(p)])
            # no adjudication records created
            self.assertFalse((root / "review" / "adjudications.jsonl").exists())


class RealBookEnumerationTests(unittest.TestCase):
    def test_real_book_exception_exactness_readonly(self):
        from tools.canon_v2.review import collect_batch_exceptions

        exc = collect_batch_exceptions(BOOK_ROOT)
        self.assertEqual(len(exc["tome2_unresolved_xref"]), 1)
        self.assertEqual(len(exc["empty_medication_names"]), 2)
        self.assertEqual(len(exc["duplicate_visual_records"]), 11)
        self.assertEqual(len(exc["duplicate_visual_groups"]), 3)
        self.assertEqual(len(exc["private_use_claims"]), 1)
        self.assertEqual(len(exc["page_mapping_gaps"]), 43)
        self.assertEqual(len(exc["unit_mapping_gaps"]), 66)
        # exact known IDs present (truncated forms from audit)
        med_ids = " ".join(
            json.dumps(x, ensure_ascii=False) for x in exc["empty_medication_names"]
        )
        self.assertIn("fbc6a3bfa7bf4", med_ids)
        self.assertIn("c51021d2ce204", med_ids)
        xref_ids = " ".join(
            json.dumps(x, ensure_ascii=False) for x in exc["tome2_unresolved_xref"]
        )
        self.assertIn("Chapitre 67", xref_ids)
        self.assertIn("tome-2", xref_ids)


if __name__ == "__main__":
    unittest.main()
