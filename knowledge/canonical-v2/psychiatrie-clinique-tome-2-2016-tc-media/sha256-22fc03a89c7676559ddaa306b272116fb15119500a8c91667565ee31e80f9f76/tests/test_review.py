"""TDD red-first tests for the smallest safe human-review adjudication mechanism.

Covers: missing reviewer, invalid disposition, empty note, duplicate
rejection, supersede chain, worklist order/resume counts, original-artifact
immutability, manifest linkage. Minimal scope: Tome 2 book-local target only.
"""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.canon_v2.review import (
    ALLOWED_DISPOSITIONS,
    REVIEW_CLASS_ORDER,
    adjudicate,
    build_worklist,
    classify_queue_item,
    resolve_proposal_id,
)


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


def _make_book(root: Path):
    """Create a minimal synthetic book dir mimicking the Tome 2 layout."""
    book_id = "psychiatrie-clinique-tome-2-2016-tc-media"
    source_version = "sha256:22fc03a89c7676559ddaa306b272116fb15119500a8c91667565ee31e80f9f76"
    manifest = {
        "book_id": book_id,
        "source_version": source_version,
        "frozen": True,
        "qa_verdict": "WARNING",
        "review_item_count": 8,
        "file_count": 1,
        "files": {},
    }
    (root / "manifest.json").write_text(
        json.dumps(manifest, sort_keys=True) + "\n", encoding="utf-8"
    )
    items = [
        _queue_item(
            "page-0001",
            "page-map.jsonl",
            source_page_index=5,
        ),
        _queue_item(
            "unit-0001",
            "units.jsonl",
            unit_id="unit:aaa",
            source_page_index_start=10,
            source_page_index_end=10,
            printed_page_start="100",
            printed_page_end="100",
        ),
        _queue_item(
            "repair-0001",
            "repairs.jsonl",
            codepoint="U+E000",
        ),
        _queue_item(
            "orphan-0001",
            "semantic/concepts.jsonl",
            concept_id="concept:111",
        ),
        _queue_item(
            "visual-0001",
            "visuals.jsonl",
            candidate_id="visual:111",
            unit_id="unit:aaa",
            source_page_index_start=10,
            source_page_index_end=10,
        ),
        _queue_item(
            "xref-0001",
            "semantic/xrefs.jsonl",
            proposal_id="xref-1",
            unit_id="unit:aaa",
            source_page_index_start=10,
            source_page_index_end=10,
        ),
        _queue_item(
            "numeric-0001",
            "semantic/proposals/*",
            proposal_id="claim-1",
            unit_id="unit:aaa",
            source_page_index_start=10,
            source_page_index_end=10,
        ),
        _queue_item(
            "medication-0001",
            "medications.jsonl",
            candidate_id="medication:111",
            unit_id="unit:aaa",
            source_page_index_start=10,
            source_page_index_end=10,
        ),
    ]
    queue = {
        "book_id": book_id,
        "source_version": source_version,
        "qa_verdict": "WARNING",
        "item_count": len(items),
        "items": sorted(items, key=lambda i: i["queue_id"]),
        "approval_status": "NOT APPROVED",
    }
    (root / "review-queue.json").write_text(
        json.dumps(queue, sort_keys=True) + "\n", encoding="utf-8"
    )
    # Minimal original artifacts so original_proposal embedding resolves.
    (root / "medications.jsonl").write_text(
        json.dumps({"candidate_id": "medication:111", "host_unit_id": "unit:aaa",
                    "source_page_index_start": 10, "raw_text": "med text"}) + "\n",
        encoding="utf-8",
    )
    (root / "visuals.jsonl").write_text(
        json.dumps({"candidate_id": "visual:111", "host_unit_id": "unit:aaa",
                    "source_page_index_start": 10}) + "\n",
        encoding="utf-8",
    )
    (root / "units.jsonl").write_text(
        json.dumps({"unit_id": "unit:aaa", "source_page_index_start": 10,
                    "source_page_index_end": 10}) + "\n",
        encoding="utf-8",
    )
    (root / "page-map.jsonl").write_text(
        json.dumps({"source_page_index": 5, "printed_page_number": "10"}) + "\n",
        encoding="utf-8",
    )
    (root / "repairs.jsonl").write_text(
        json.dumps({"raw_codepoint": "U+E000", "page_index": 5}) + "\n",
        encoding="utf-8",
    )
    (root / "qa-report.json").write_text(
        json.dumps({"book_id": book_id, "verdict": "WARNING"}) + "\n",
        encoding="utf-8",
    )
    sem_proposals = root / "semantic" / "proposals"
    sem_proposals.mkdir(parents=True, exist_ok=True)
    for name in (
        "part-a-49-54.jsonl",
        "part-b-55-65.jsonl",
        "part-c-66-72.jsonl",
        "part-d-73-85.jsonl",
    ):
        (sem_proposals / name).write_text("", encoding="utf-8")
    # One numeric proposal + xref + concept records.
    (sem_proposals / "part-a-49-54.jsonl").write_text(
        json.dumps({"proposal_id": "claim-1", "unit_id": "unit:aaa",
                    "source_page_index_start": 10,
                    "source_text": "dose 75 mg needs review"}) + "\n",
        encoding="utf-8",
    )
    sem_dir = root / "semantic"
    (sem_dir / "concepts.jsonl").write_text(
        json.dumps({"concept_id": "concept:111", "proposal_id": "task7-concept-1",
                    "unit_id": "unit:aaa",
                    "source_page_index_start": 10}) + "\n",
        encoding="utf-8",
    )
    (sem_dir / "xrefs.jsonl").write_text(
        json.dumps({"proposal_id": "xref-1", "unit_id": "unit:aaa",
                    "source_page_index_start": 10,
                    "target": "Chapitre 20"}) + "\n",
        encoding="utf-8",
    )
    raw_dir = root / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    (raw_dir / "pages.jsonl").write_text("{}\n", encoding="utf-8")
    (raw_dir / "repaired-pages.jsonl").write_text("{}\n", encoding="utf-8")
    return book_id, source_version


class ReviewValidationTests(unittest.TestCase):
    def test_missing_reviewer_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_book(root)
            for bad in ("", "   ", "\t\n"):
                with self.subTest(reviewer=repr(bad)):
                    with self.assertRaises(ValueError):
                        adjudicate(
                            root,
                            queue_id="medication-0001",
                            reviewer_identity=bad,
                            human_disposition="human_approved",
                            review_note="verified dose",
                        )

    def test_invalid_disposition_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_book(root)
            for bad in ("approved", "auto_ok", "needs-review", "", "HUMAN_APPROVED"):
                with self.subTest(disposition=bad):
                    with self.assertRaises(ValueError):
                        adjudicate(
                            root,
                            queue_id="medication-0001",
                            reviewer_identity="Dr Test",
                            human_disposition=bad,
                            review_note="note",
                        )
            # Allowed set must be exactly the five human dispositions.
            self.assertEqual(
                set(ALLOWED_DISPOSITIONS),
                {"needs_review", "human_approved", "human_rejected",
                 "human_corrected", "human_deferred"},
            )

    def test_empty_note_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_book(root)
            for bad in ("", "   ", "\n\t "):
                with self.subTest(note=repr(bad)):
                    with self.assertRaises(ValueError):
                        adjudicate(
                            root,
                            queue_id="medication-0001",
                            reviewer_identity="Dr Test",
                            human_disposition="human_approved",
                            review_note=bad,
                        )

    def test_duplicate_rejected_without_supersedes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_book(root)
            first = adjudicate(
                root, queue_id="medication-0001", reviewer_identity="Dr A",
                human_disposition="human_approved", review_note="first review",
            )
            self.assertIn("id", first)
            with self.assertRaises(ValueError):
                adjudicate(
                    root, queue_id="medication-0001", reviewer_identity="Dr B",
                    human_disposition="human_rejected", review_note="second attempt",
                )
            # History never deleted: exactly one record.
            lines = (root / "review" / "adjudications.jsonl").read_text(
                encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 1)

    def test_supersede_chain_and_latest_wins(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_book(root)
            r1 = adjudicate(
                root, queue_id="numeric-0001", reviewer_identity="Dr A",
                human_disposition="human_rejected", review_note="wrong dose",
            )
            r2 = adjudicate(
                root, queue_id="numeric-0001", reviewer_identity="Dr B",
                human_disposition="human_corrected", review_note="corrected",
                supersedes=r1["id"],
            )
            self.assertEqual(r2["supersedes"], r1["id"])
            self.assertEqual(r2["previous_state"], r1["new_state"])
            r3 = adjudicate(
                root, queue_id="numeric-0001", reviewer_identity="Dr C",
                human_disposition="human_approved", review_note="now ok",
                supersedes=r2["id"],
            )
            self.assertEqual(r3["supersedes"], r2["id"])
            lines = (root / "review" / "adjudications.jsonl").read_text(
                encoding="utf-8").strip().splitlines()
            self.assertEqual(len(lines), 3)
            # Stale supersedes pointer must be rejected.
            with self.assertRaises(ValueError):
                adjudicate(
                    root, queue_id="numeric-0001", reviewer_identity="Dr D",
                    human_disposition="human_approved", review_note="stale",
                    supersedes=r1["id"],
                )
            # Supersedes pointing at another queue's record must be rejected.
            other = adjudicate(
                root, queue_id="xref-0001", reviewer_identity="Dr A",
                human_disposition="human_approved", review_note="xref ok",
            )
            with self.assertRaises(ValueError):
                adjudicate(
                    root, queue_id="numeric-0001", reviewer_identity="Dr E",
                    human_disposition="human_approved", review_note="cross",
                    supersedes=other["id"],
                )
            # Latest-wins counting: numeric-0001 decided once despite 3 records.
            wl = build_worklist(root)
            self.assertEqual(wl["decided_count"], 2)  # numeric + xref
            self.assertEqual(wl["remaining_count"], 6)
            self.assertNotIn("numeric-0001",
                             [i["queue_id"] for i in wl["items"]])

    def test_worklist_order_resume_counts(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_book(root)
            wl = build_worklist(root)
            self.assertEqual(REVIEW_CLASS_ORDER,
                             ["medication", "numeric", "xref", "visual",
                              "orphan", "repair", "unit", "page"])
            got = [(i["review_class"], i["queue_id"]) for i in wl["items"]]
            expected = [
                ("medication", "medication-0001"),
                ("numeric", "numeric-0001"),
                ("xref", "xref-0001"),
                ("visual", "visual-0001"),
                ("orphan", "orphan-0001"),
                ("repair", "repair-0001"),
                ("unit", "unit-0001"),
                ("page", "page-0001"),
            ]
            self.assertEqual(got, expected)
            self.assertEqual(wl["total_queue_items"], 8)
            self.assertEqual(wl["decided_count"], 0)
            self.assertEqual(wl["remaining_count"], 8)
            self.assertEqual(wl["per_class_counts"]["medication"], 1)
            # human_deferred stays in the remaining set.
            adjudicate(root, queue_id="medication-0001",
                       reviewer_identity="Dr A",
                       human_disposition="human_deferred",
                       review_note="defer to specialist")
            wl2 = build_worklist(root)
            self.assertEqual(wl2["decided_count"], 0)
            self.assertEqual(wl2["remaining_count"], 8)
            self.assertIn("medication-0001",
                          [i["queue_id"] for i in wl2["items"]])
            # human_approved removes the item (resume).
            adjudicate(root, queue_id="medication-0001",
                       reviewer_identity="Dr A",
                       human_disposition="human_approved",
                       review_note="now decided",
                       supersedes=wl2["decisions"]["medication-0001"]
                       if "decisions" in wl2 else None
                       if False else _latest_id(root, "medication-0001"))
            wl3 = build_worklist(root)
            self.assertEqual(wl3["decided_count"], 1)
            self.assertEqual(wl3["remaining_count"], 7)
            self.assertNotIn("medication-0001",
                             [i["queue_id"] for i in wl3["items"]])
            # needs_review disposition also stays remaining.
            adjudicate(root, queue_id="numeric-0001",
                       reviewer_identity="Dr A",
                       human_disposition="needs_review",
                       review_note="still needs review")
            wl4 = build_worklist(root)
            self.assertIn("numeric-0001",
                          [i["queue_id"] for i in wl4["items"]])
            self.assertEqual(wl4["decided_count"], 1)

    def test_original_artifact_immutability(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_book(root)
            targets = [
                root / "manifest.json",
                root / "qa-report.json",
                root / "review-queue.json",
                root / "medications.jsonl",
                root / "visuals.jsonl",
                root / "units.jsonl",
                root / "page-map.jsonl",
                root / "repairs.jsonl",
                root / "raw" / "pages.jsonl",
                root / "raw" / "repaired-pages.jsonl",
                root / "semantic" / "proposals" / "part-a-49-54.jsonl",
                root / "semantic" / "proposals" / "part-b-55-65.jsonl",
                root / "semantic" / "proposals" / "part-c-66-72.jsonl",
                root / "semantic" / "proposals" / "part-d-73-85.jsonl",
            ]
            before = {str(p): _sha(p) for p in targets}
            adjudicate(root, queue_id="medication-0001",
                       reviewer_identity="Dr A",
                       human_disposition="human_approved",
                       review_note="immutable check")
            build_worklist(root)
            for p in targets:
                self.assertEqual(_sha(p), before[str(p)],
                                 "forbidden modification: " + str(p))

    def test_manifest_linkage_and_required_fields(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            _make_book(root)
            rec = adjudicate(
                root, queue_id="medication-0001",
                reviewer_identity="Dr Verif",
                human_disposition="human_approved",
                review_note="linkage check",
            )
            manifest_raw = json.loads(
                (root / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(rec["book_id"], manifest_raw["book_id"])
            self.assertEqual(rec["source_version"],
                             manifest_raw["source_version"])
            self.assertEqual(rec["manifest_sha256"], _sha(root / "manifest.json"))
            for field in (
                "book_id", "source_version", "manifest_sha256", "proposal_id",
                "review_class", "source_page", "source_excerpt_or_reference",
                "original_proposal", "reviewer_identity", "review_timestamp",
                "human_disposition", "review_note", "previous_state",
                "new_state", "queue_id", "id",
            ):
                self.assertIn(field, rec, "missing field " + field)
            self.assertTrue(rec["review_note"].strip())
            self.assertEqual(rec["review_class"], "medication")
            self.assertEqual(rec["proposal_id"], "medication:111")
            self.assertIsInstance(rec["original_proposal"], dict)
            self.assertEqual(rec["original_proposal"]["candidate_id"],
                             "medication:111")
            # proposal_id rule: candidate_id wins when present.
            self.assertEqual(
                resolve_proposal_id({"candidate_id": "medication:X",
                                     "unit_id": "unit:Y",
                                     "queue_id": "q"}),
                "medication:X",
            )
            self.assertIn(
                resolve_proposal_id({"unit_id": "unit:Y",
                                     "queue_id": "medication-q"}),
                ("unit:Y", "unit:Y#medication-q", "unit:Y|medication-q"),
            )
            self.assertEqual(classify_queue_item({"file": "medications.jsonl",
                                                  "queue_id": "medication-x"}),
                             "medication")


def _latest_id(root: Path, queue_id: str) -> str:
    for line in (root / "review" / "adjudications.jsonl").read_text(
            encoding="utf-8").strip().splitlines()[::-1]:
        rec = json.loads(line)
        if rec.get("queue_id") == queue_id:
            return rec["id"]
    raise AssertionError("no record for " + queue_id)


if __name__ == "__main__":
    unittest.main()
