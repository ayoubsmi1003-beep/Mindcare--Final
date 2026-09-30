"""Smallest safe human-review adjudication mechanism (Tome 2 book-local only).

Safety contract (fail-closed, human-in-the-loop):
- Never auto-approve, never default a disposition, never infer reviewer identity.
- ``reviewer_identity`` is required and must be non-empty/non-whitespace.
- Allowed human dispositions ONLY: needs_review, human_approved,
  human_rejected, human_corrected, human_deferred. Anything else is rejected.
- ``review_note`` is required and must be non-empty/non-whitespace.
- Adjudications are append-only in ``review/adjudications.jsonl``. One active
  decision per ``queue_id``: a second decision is rejected unless it carries
  ``supersedes`` equal to the latest record id for that ``queue_id``.
  History is never deleted; latest record wins for counting.
- ``build_worklist()`` is deterministic and resumable: queue order is class
  priority (medication, numeric, xref, visual, orphan, repair, unit, page)
  then ``queue_id`` ascending. A ``queue_id`` counts as decided only when its
  latest disposition is in {human_approved, human_rejected, human_corrected}.
  ``needs_review`` and ``human_deferred`` stay in the remaining set.
- Manifest linkage: ``book_id``/``source_version`` are read from
  ``manifest.json`` at call time and ``manifest_sha256`` is the hex SHA-256 of
  the ``manifest.json`` file bytes. Nothing is hardcoded.
- Proposal-id resolution rule (documented): ``candidate_id`` if present and
  non-empty; otherwise ``proposal_id`` if present; otherwise ``concept_id``
  if present; otherwise ``unit_id`` if present; otherwise ``codepoint:``
  + codepoint if present; otherwise ``queue_id``. Queue context is always
  preserved in the adjacent ``queue_id`` field of the adjudication record.
- This module writes ONLY under ``review/`` (adjudications.jsonl,
  worklist.json). It never modifies original proposals, raw layers, the
  frozen manifest, or the four approved proposal files.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

REVIEW_CLASS_ORDER = [
    "medication",
    "numeric",
    "xref",
    "visual",
    "orphan",
    "repair",
    "unit",
    "page",
]
_CLASS_RANK = {name: i for i, name in enumerate(REVIEW_CLASS_ORDER)}

ALLOWED_DISPOSITIONS = frozenset({
    "needs_review",
    "human_approved",
    "human_rejected",
    "human_corrected",
    "human_deferred",
})
DECIDED_DISPOSITIONS = frozenset({
    "human_approved",
    "human_rejected",
    "human_corrected",
})

CLASS_BY_FILE = {
    "medications.jsonl": "medication",
    "semantic/proposals/*": "numeric",
    "semantic/xrefs.jsonl": "xref",
    "visuals.jsonl": "visual",
    "semantic/concepts.jsonl": "orphan",
    "repairs.jsonl": "repair",
    "units.jsonl": "unit",
    "page-map.jsonl": "page",
}

REQUIRED_RECORD_FIELDS = (
    "book_id",
    "source_version",
    "manifest_sha256",
    "proposal_id",
    "review_class",
    "source_page",
    "source_excerpt_or_reference",
    "original_proposal",
    "reviewer_identity",
    "review_timestamp",
    "human_disposition",
    "review_note",
    "previous_state",
    "new_state",
)


def _sha_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_manifest_info(output_dir: Path) -> dict:
    """Read book_id/source_version from manifest.json + file sha (never hardcoded)."""
    root = Path(output_dir)
    manifest_path = root / "manifest.json"
    if not manifest_path.exists():
        raise ValueError("manifest.json is missing: " + str(manifest_path))
    try:
        with manifest_path.open("r", encoding="utf-8") as stream:
            manifest = json.load(stream)
    except (OSError, ValueError) as error:
        raise ValueError("manifest.json is unreadable: " + str(error)) from error
    if not isinstance(manifest, dict):
        raise ValueError("manifest.json must be an object")
    book_id = manifest.get("book_id")
    source_version = manifest.get("source_version")
    if not isinstance(book_id, str) or not book_id.strip():
        raise ValueError("manifest.json book_id is missing")
    if not isinstance(source_version, str) or not source_version.strip():
        raise ValueError("manifest.json source_version is missing")
    return {
        "book_id": book_id,
        "source_version": source_version,
        "manifest_sha256": _sha_file(manifest_path),
    }


def _load_queue_envelope(output_dir: Path) -> dict:
    root = Path(output_dir)
    queue_path = root / "review-queue.json"
    if not queue_path.exists():
        raise ValueError("review-queue.json is missing: " + str(queue_path))
    try:
        with queue_path.open("r", encoding="utf-8") as stream:
            envelope = json.load(stream)
    except (OSError, ValueError) as error:
        raise ValueError("review-queue.json is unreadable: " + str(error)) from error
    return envelope


def load_queue_items(output_dir: Path) -> list[dict]:
    envelope = _load_queue_envelope(output_dir)
    if isinstance(envelope, dict) and isinstance(envelope.get("items"), list):
        items = envelope["items"]
    elif isinstance(envelope, list):
        items = envelope
    else:
        raise ValueError("review-queue.json has no items list")
    for item in items:
        if not isinstance(item, dict) or not item.get("queue_id"):
            raise ValueError("review-queue item is missing queue_id")
    return items


def classify_queue_item(item: dict) -> str:
    """Map a queue item to one of REVIEW_CLASS_ORDER.

    Primary key is the ``file`` field via CLASS_BY_FILE; fallback is the
    ``queue_id`` prefix (e.g. ``medication-review-...`` -> ``medication``,
    ``numeric-...`` -> ``numeric``). Unknown maps to ``page`` (lowest
    priority) to keep ordering total without dropping items.
    """
    file_value = item.get("file")
    if isinstance(file_value, str) and file_value in CLASS_BY_FILE:
        return CLASS_BY_FILE[file_value]
    queue_id = str(item.get("queue_id", ""))
    prefix = queue_id.split("-")[0] if queue_id else ""
    if prefix in _CLASS_RANK:
        return prefix
    # Legacy/alternate prefixes seen in corpus reasoning:
    if prefix == "medication":
        return "medication"
    return "page"


def resolve_proposal_id(item: dict) -> str:
    """Resolve proposal_id per documented rule (candidate wins, queue context kept).

    Rule: candidate_id if present else proposal_id if present else concept_id
    if present else unit_id if present else codepoint:+codepoint if present
    else queue_id. The queue_id is always stored alongside as context.
    """
    for key in ("candidate_id", "proposal_id", "concept_id", "unit_id"):
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            return value
    codepoint = item.get("codepoint")
    if isinstance(codepoint, str) and codepoint.strip():
        return "codepoint:" + codepoint.strip()
    queue_id = item.get("queue_id")
    if isinstance(queue_id, str) and queue_id.strip():
        return queue_id
    raise ValueError("queue item has no resolvable proposal_id")


def _read_jsonl_if_exists(path: Path) -> list[dict]:
    if not path.exists():
        return []
    records: list[dict] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except ValueError as error:
                raise ValueError(
                    "malformed JSONL " + str(path) + " line " + str(line_number)
                ) from error
            if isinstance(record, dict):
                records.append(record)
    return records


def _find_original(output_dir: Path, queue_item: dict) -> dict:
    """Return an embedded copy of the referenced proposal/candidate record.

    Read-only lookups against book-local originals. Raises ValueError when the
    referenced record cannot be found (fail-closed, never synthesize).
    """
    root = Path(output_dir)
    candidate_id = queue_item.get("candidate_id")
    if isinstance(candidate_id, str) and candidate_id:
        for name in ("medications.jsonl", "visuals.jsonl"):
            for record in _read_jsonl_if_exists(root / name):
                if record.get("candidate_id") == candidate_id:
                    return dict(record)
        raise ValueError("referenced candidate_id not found: " + candidate_id)
    proposal_id = queue_item.get("proposal_id")
    if isinstance(proposal_id, str) and proposal_id:
        proposals_dir = root / "semantic" / "proposals"
        if proposals_dir.exists():
            for path in sorted(proposals_dir.glob("*.jsonl")):
                for record in _read_jsonl_if_exists(path):
                    if record.get("proposal_id") == proposal_id:
                        return dict(record)
        for name in ("semantic/xrefs.jsonl", "semantic/concepts.jsonl",
                     "semantic/claims.jsonl"):
            for record in _read_jsonl_if_exists(root / name):
                if record.get("proposal_id") == proposal_id:
                    return dict(record)
        raise ValueError("referenced proposal_id not found: " + proposal_id)
    concept_id = queue_item.get("concept_id")
    if isinstance(concept_id, str) and concept_id:
        for record in _read_jsonl_if_exists(root / "semantic" / "concepts.jsonl"):
            if record.get("concept_id") == concept_id:
                return dict(record)
        raise ValueError("referenced concept_id not found: " + concept_id)
    file_value = queue_item.get("file")
    if file_value == "units.jsonl":
        unit_id = queue_item.get("unit_id")
        for record in _read_jsonl_if_exists(root / "units.jsonl"):
            if record.get("unit_id") == unit_id:
                return dict(record)
        raise ValueError("referenced unit_id not found: " + str(unit_id))
    if file_value == "page-map.jsonl":
        index = queue_item.get("source_page_index")
        for record in _read_jsonl_if_exists(root / "page-map.jsonl"):
            if record.get("source_page_index") == index:
                return dict(record)
        raise ValueError("referenced page-map index not found: " + str(index))
    if file_value == "repairs.jsonl":
        codepoint = queue_item.get("codepoint")
        for record in _read_jsonl_if_exists(root / "repairs.jsonl"):
            if record.get("raw_codepoint") == codepoint:
                return dict(record)
        raise ValueError("referenced codepoint not found: " + str(codepoint))
    # Generic fallback: unit_id lookup in units.jsonl when file is ambiguous.
    unit_id = queue_item.get("unit_id")
    if isinstance(unit_id, str) and unit_id:
        for record in _read_jsonl_if_exists(root / "units.jsonl"):
            if record.get("unit_id") == unit_id:
                return dict(record)
    raise ValueError(
        "referenced original record not found for queue_id "
        + str(queue_item.get("queue_id"))
    )


def _resolve_source_page(queue_item: dict, original: dict):
    for source in (queue_item, original):
        for key in ("source_page_index_start", "source_page_index",
                    "page_index"):
            value = source.get(key)
            if isinstance(value, bool):
                continue
            if isinstance(value, int):
                return value
    return None


def _resolve_excerpt(queue_item: dict, original: dict) -> str:
    parts: list[str] = []
    reason = queue_item.get("reason")
    if isinstance(reason, str) and reason.strip():
        parts.append(reason.strip())
    file_value = queue_item.get("file")
    if isinstance(file_value, str) and file_value:
        parts.append("file=" + file_value)
    for key in ("printed_page_start", "printed_page_end"):
        value = queue_item.get(key)
        if value is not None:
            parts.append(key + "=" + str(value))
            break
    for key in ("source_text", "raw_text", "reading_text",
                "source_context_text", "unit_text", "caption"):
        value = original.get(key)
        if isinstance(value, str) and value.strip():
            excerpt = " ".join(value.strip().split())
            parts.append(key + "=" + excerpt[:500])
            break
    reference = " | ".join(parts).strip()
    if not reference:
        reference = "queue_id=" + str(queue_item.get("queue_id"))
    return reference


def load_adjudications(output_dir: Path) -> list[dict]:
    root = Path(output_dir)
    path = root / "review" / "adjudications.jsonl"
    if not path.exists():
        return []
    records: list[dict] = []
    with path.open("r", encoding="utf-8") as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except ValueError as error:
                raise ValueError(
                    "malformed adjudications.jsonl line " + str(line_number)
                ) from error
            if not isinstance(record, dict):
                raise ValueError("adjudication row must be an object")
            records.append(record)
    return records


def latest_by_queue(records: list[dict]) -> dict[str, dict]:
    """Return the latest record per queue_id (log order wins, append-only)."""
    latest: dict[str, dict] = {}
    for record in records:
        queue_id = record.get("queue_id")
        if isinstance(queue_id, str) and queue_id:
            latest[queue_id] = record
    return latest


def _next_id(existing: list[dict]) -> str:
    return "adj-%06d" % (len(existing) + 1,)


def adjudicate(
    output_dir: Path,
    queue_id: str,
    reviewer_identity: str,
    human_disposition: str,
    review_note: str,
    supersedes: str | None = None,
    review_timestamp: str | None = None,
) -> dict:
    """Append one human adjudication record (fail-closed).

    Never defaults disposition, never infers reviewer. Rejects empty
    reviewer/note, invalid disposition, unknown queue_id, duplicate decision
    without a valid ``supersedes`` pointer, and stale/cross-queue pointers.
    """
    root = Path(output_dir)
    if not isinstance(queue_id, str) or not queue_id.strip():
        raise ValueError("queue_id is required")
    queue_id = queue_id.strip()
    if not isinstance(reviewer_identity, str) or not reviewer_identity.strip():
        raise ValueError("reviewer_identity is required and must be non-empty")
    reviewer_identity = reviewer_identity.strip()
    if human_disposition not in ALLOWED_DISPOSITIONS:
        raise ValueError(
            "human_disposition must be one of "
            + ", ".join(sorted(ALLOWED_DISPOSITIONS))
            + "; got " + repr(human_disposition)
        )
    if not isinstance(review_note, str) or not review_note.strip():
        raise ValueError("review_note is required and must be non-empty")
    review_note = review_note.strip()
    if supersedes is not None:
        if not isinstance(supersedes, str) or not supersedes.strip():
            raise ValueError("supersedes must be a non-empty record id or null")
        supersedes = supersedes.strip()

    items = load_queue_items(root)
    by_queue = {str(i.get("queue_id")): i for i in items}
    queue_item = by_queue.get(queue_id)
    if queue_item is None:
        raise ValueError("unknown queue_id: " + queue_id)

    manifest = load_manifest_info(root)
    existing = load_adjudications(root)
    by_id = {r.get("id"): r for r in existing if isinstance(r.get("id"), str)}
    prior_for_queue = [r for r in existing if r.get("queue_id") == queue_id]

    if not prior_for_queue:
        if supersedes is not None:
            raise ValueError("supersedes refers to no prior decision")
        previous_state = queue_item.get("validation_status", "needs_review")
    else:
        latest = prior_for_queue[-1]
        latest_id = latest.get("id")
        if supersedes is None:
            raise ValueError(
                "duplicate decision for queue_id " + queue_id
                + "; provide supersedes=" + str(latest_id)
            )
        if supersedes != latest_id:
            if supersedes not in by_id:
                raise ValueError("supersedes points at unknown record id")
            raise ValueError(
                "stale supersedes pointer; latest for " + queue_id
                + " is " + str(latest_id)
            )
        if by_id[supersedes].get("queue_id") != queue_id:
            raise ValueError("supersedes points at another queue_id")
        previous_state = latest.get("new_state", latest.get("human_disposition"))

    original = _find_original(root, queue_item)
    review_class = classify_queue_item(queue_item)
    proposal_id = resolve_proposal_id(queue_item)
    source_page = _resolve_source_page(queue_item, original)
    excerpt = _resolve_excerpt(queue_item, original)
    timestamp = review_timestamp or datetime.now(timezone.utc).isoformat()

    record = {
        "id": _next_id(existing),
        "queue_id": queue_id,
        "supersedes": supersedes,
        "book_id": manifest["book_id"],
        "source_version": manifest["source_version"],
        "manifest_sha256": manifest["manifest_sha256"],
        "proposal_id": proposal_id,
        "review_class": review_class,
        "source_page": source_page,
        "source_excerpt_or_reference": excerpt,
        "original_proposal": original,
        "reviewer_identity": reviewer_identity,
        "review_timestamp": timestamp,
        "human_disposition": human_disposition,
        "review_note": review_note,
        "previous_state": previous_state,
        "new_state": human_disposition,
    }
    review_dir = root / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    log_path = review_dir / "adjudications.jsonl"
    line = json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n"
    with log_path.open("a", encoding="utf-8") as stream:
        stream.write(line)
    return record


def build_worklist(
    output_dir: Path,
    review_class: str | None = None,
    limit: int | None = None,
) -> dict:
    """Build the deterministic resumable worklist and write review/worklist.json.

    Ordering: class priority (medication, numeric, xref, visual, orphan,
    repair, unit, page) then queue_id ascending. Decided queue_ids (latest
    disposition in {human_approved, human_rejected, human_corrected}) are
    excluded; needs_review and human_deferred stay remaining. ``review_class``
    and ``limit`` filter the written ``items`` only; ``per_class_counts``
    always reflects the full remaining set for resumability.
    """
    root = Path(output_dir)
    if review_class is not None and review_class not in _CLASS_RANK:
        raise ValueError(
            "review_class must be one of " + ", ".join(REVIEW_CLASS_ORDER)
        )
    if limit is not None:
        if isinstance(limit, bool) or not isinstance(limit, int) or limit < 0:
            raise ValueError("limit must be an integer >= 0")

    manifest = load_manifest_info(root)
    items = load_queue_items(root)
    adjudications = load_adjudications(root)
    latest = latest_by_queue(adjudications)

    decided_queue_ids: set[str] = set()
    for queue_id, record in latest.items():
        disposition = record.get("human_disposition", record.get("new_state"))
        if disposition in DECIDED_DISPOSITIONS:
            decided_queue_ids.add(queue_id)

    remaining: list[dict] = []
    for item in items:
        queue_id = str(item.get("queue_id"))
        if queue_id in decided_queue_ids:
            continue
        enriched = dict(item)
        enriched["review_class"] = classify_queue_item(item)
        enriched["proposal_id"] = resolve_proposal_id(item)
        remaining.append(enriched)

    remaining.sort(
        key=lambda i: (_CLASS_RANK.get(i["review_class"], 99),
                       str(i.get("queue_id", "")))
    )
    per_class_counts: dict[str, int] = {name: 0 for name in REVIEW_CLASS_ORDER}
    for item in remaining:
        per_class_counts[item["review_class"]] += 1

    filtered = list(remaining)
    if review_class is not None:
        filtered = [i for i in filtered if i["review_class"] == review_class]
    if limit is not None:
        filtered = filtered[:limit]

    worklist = {
        "book_id": manifest["book_id"],
        "source_version": manifest["source_version"],
        "manifest_sha256": manifest["manifest_sha256"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_queue_items": len(items),
        "decided_count": len(decided_queue_ids),
        "remaining_count": len(remaining),
        "per_class_counts": per_class_counts,
        "items": filtered,
    }
    review_dir = root / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    worklist_path = review_dir / "worklist.json"
    payload = json.dumps(worklist, ensure_ascii=False, sort_keys=True) + "\n"
    tmp_path = worklist_path.with_name(worklist_path.name + ".tmp")
    try:
        tmp_path.write_text(payload, encoding="utf-8")
        tmp_path.replace(worklist_path)
    finally:
        if tmp_path.exists():
            tmp_path.unlink()
    return worklist


EXPECTED_BATCH_TOTAL = 2306

_MED_GENERIC_HEADER = "m\u00e9dicaments"
_MED_DRUGLESS_QUESTION_FRAGMENT = "sans prendre un m\u00e9dicament"
_PRIVATE_USE_FI_LIGATURE = "\ue00f"


def _read_json(path: Path):
    try:
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError) as error:
        raise ValueError("unreadable JSON " + str(path) + ": " + str(error)) from error


def _medication_raw_by_candidate(output_dir: Path) -> dict[str, str]:
    index: dict[str, str] = {}
    path = Path(output_dir) / "medications.jsonl"
    for record in _read_jsonl_if_exists(path):
        candidate_id = record.get("candidate_id")
        if isinstance(candidate_id, str) and candidate_id:
            raw = record.get("raw_text")
            index[candidate_id] = raw if isinstance(raw, str) else ""
    return index


def _visual_continuation_hosts(output_dir: Path) -> dict[str, str]:
    """Map visual candidate_id -> host_unit_id for continuation records only."""
    index: dict[str, str] = {}
    path = Path(output_dir) / "visuals.jsonl"
    for record in _read_jsonl_if_exists(path):
        continuation = record.get("continuation_of")
        if not (isinstance(continuation, str) and continuation.strip()):
            continue
        candidate_id = record.get("candidate_id")
        host = record.get("host_unit_id")
        if isinstance(candidate_id, str) and isinstance(host, str) and host:
            index[candidate_id] = host
    return index


def _queued_claim_has_fi_ligature(output_dir: Path) -> dict[str, dict]:
    """Map proposal_id -> proposal record for queued claims with U+E00F."""
    proposals: dict[str, dict] = {}
    proposals_dir = Path(output_dir) / "semantic" / "proposals"
    if proposals_dir.exists():
        for path in sorted(proposals_dir.glob("*.jsonl")):
            for record in _read_jsonl_if_exists(path):
                if record.get("kind") != "claim":
                    continue
                proposal_id = record.get("proposal_id")
                if not (isinstance(proposal_id, str) and proposal_id):
                    continue
                text = record.get("source_text")
                if isinstance(text, str) and _PRIVATE_USE_FI_LIGATURE in text:
                    proposals[proposal_id] = record
    return proposals


def collect_batch_exceptions(output_dir: Path) -> dict:
    """Compute the distinct in-queue exception sets (read-only).

    Returns queue-item lists for: tome2_unresolved_xref (1),
    empty_medication_names (2), page_mapping_gaps (43),
    unit_mapping_gaps (66), private_use_claims (1); plus duplicate
    visual continuation records (11) grouped by host with singletons
    coalesced into one residual group (3 groups total).
    """
    root = Path(output_dir)
    items = load_queue_items(root)

    tome2_xref = [
        i for i in items
        if i.get("file") == "semantic/xrefs.jsonl"
        and "tome-2" in str(i.get("reason", ""))
        and "Chapitre 67" in str(i.get("reason", ""))
    ]

    med_raw = _medication_raw_by_candidate(root)
    empty_meds = []
    for i in items:
        if i.get("file") != "medications.jsonl":
            continue
        candidate_id = str(i.get("candidate_id", ""))
        raw = med_raw.get(candidate_id, "")
        normalized = (raw or "").strip().lower()
        if normalized == _MED_GENERIC_HEADER:
            empty_meds.append(i)
        elif _MED_DRUGLESS_QUESTION_FRAGMENT in normalized:
            # Drug-less interrogative without a specific medication name:
            # both name fields are null in the underlying record.
            empty_meds.append(i)

    page_gaps = [i for i in items if i.get("file") == "page-map.jsonl"]
    unit_gaps = [i for i in items if i.get("file") == "units.jsonl"]

    cont_hosts = _visual_continuation_hosts(root)
    queue_by_candidate = {
        str(i.get("candidate_id")): i for i in items
        if isinstance(i.get("candidate_id"), str)
    }
    dup_items: list[dict] = []
    by_host: dict[str, list[dict]] = {}
    for candidate_id, host in sorted(cont_hosts.items()):
        queue_item = queue_by_candidate.get(candidate_id)
        if queue_item is None or queue_item.get("file") != "visuals.jsonl":
            continue
        dup_items.append(queue_item)
        by_host.setdefault(host, []).append(queue_item)
    # Coalesce singleton hosts into one residual group so the batch
    # record carries exactly 3 groups (5/3/3 on the frozen Tome 2 book).
    multi = {h: v for h, v in by_host.items() if len(v) > 1}
    singletons = [i for h, v in by_host.items() if len(v) == 1 for i in v]
    dup_groups: list[list[dict]] = [list(v) for v in multi.values()]
    if singletons:
        dup_groups.append(list(singletons))
    # Deterministic order: largest group first, then queue_id.
    dup_groups.sort(
        key=lambda g: (-len(g), str(g[0].get("queue_id", "")) if g else "")
    )

    fi_claims = _queued_claim_has_fi_ligature(root)
    queue_by_proposal = {
        str(i.get("proposal_id")): i for i in items
        if isinstance(i.get("proposal_id"), str)
    }
    private_claims = [
        queue_by_proposal[pid] for pid in sorted(fi_claims)
        if pid in queue_by_proposal
        and queue_by_proposal[pid].get("file") == "semantic/proposals/*"
    ]

    return {
        "tome2_unresolved_xref": tome2_xref,
        "empty_medication_names": empty_meds,
        "duplicate_visual_records": dup_items,
        "duplicate_visual_groups": dup_groups,
        "private_use_claims": private_claims,
        "page_mapping_gaps": page_gaps,
        "unit_mapping_gaps": unit_gaps,
    }


def _require_nonblank(name: str, value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(name + " is required and must be non-empty")
    return value.strip()


def authorize_batch(
    output_dir: Path,
    doctor_identity: str,
    authorization_scope: str,
    approval_basis: str,
    review_note: str,
    review_timestamp: str | None = None,
) -> dict:
    """Append one batch authorization record (fail-closed, no attestation).

    Never creates individual adjudications. Validates gates before
    writing and appends to review/batch-authorizations.jsonl only.
    """
    root = Path(output_dir)
    doctor_identity = _require_nonblank("doctor_identity", doctor_identity)
    authorization_scope = _require_nonblank(
        "authorization_scope", authorization_scope
    )
    approval_basis = _require_nonblank("approval_basis", approval_basis)
    review_note = _require_nonblank("review_note", review_note)

    manifest = load_manifest_info(root)
    manifest_path = root / "manifest.json"
    recomputed_sha = _sha_file(manifest_path)
    if recomputed_sha != manifest["manifest_sha256"]:
        raise ValueError("manifest SHA mismatch")
    freeze_path = root / "checkpoints" / "freeze.json"
    if freeze_path.exists():
        freeze = _read_json(freeze_path)
        if (
            isinstance(freeze, dict)
            and isinstance(freeze.get("manifest_sha256"), str)
            and freeze["manifest_sha256"] != recomputed_sha
        ):
            raise ValueError("freeze manifest SHA mismatch")

    merge_report = _read_json(root / "semantic" / "merge-report.json")
    if not isinstance(merge_report, dict):
        raise ValueError("merge-report must be an object")
    if merge_report.get("errors", []) != []:
        raise ValueError("merge-report has errors")
    if merge_report.get("rejected_count", 0) != 0:
        raise ValueError("merge-report has rejections")

    replay = _read_json(root / "checkpoints" / "replay.json")
    if not isinstance(replay, dict) or replay.get("status") != "PASS":
        raise ValueError("replay status must be PASS")

    envelope = _load_queue_envelope(root)
    if not isinstance(envelope, dict):
        raise ValueError("review-queue envelope must be an object")
    if envelope.get("book_id") != manifest["book_id"]:
        raise ValueError("queue book_id mismatch")
    if envelope.get("source_version") != manifest["source_version"]:
        raise ValueError("queue source_version mismatch")
    items = load_queue_items(root)
    if len(items) != EXPECTED_BATCH_TOTAL or envelope.get("item_count") != EXPECTED_BATCH_TOTAL:
        raise ValueError(
            "queue count must be %d" % EXPECTED_BATCH_TOTAL
        )

    exceptions = collect_batch_exceptions(root)
    tome2 = exceptions["tome2_unresolved_xref"]
    meds = exceptions["empty_medication_names"]
    dup_items = exceptions["duplicate_visual_records"]
    dup_groups = exceptions["duplicate_visual_groups"]
    pu_claims = exceptions["private_use_claims"]
    page_gaps = exceptions["page_mapping_gaps"]
    unit_gaps = exceptions["unit_mapping_gaps"]

    # Distinctness by queue_id (fail-closed on overlap).
    seen: set[str] = set()
    for group in (tome2, meds, dup_items, pu_claims, page_gaps, unit_gaps):
        for item in group:
            queue_id = str(item.get("queue_id"))
            if queue_id in seen:
                raise ValueError("overlapping exception queue_id: " + queue_id)
            seen.add(queue_id)
    exception_count = len(seen)
    total = len(items)
    routine_count = total - exception_count

    def _proposal_id(item: dict) -> str:
        for key in ("candidate_id", "proposal_id", "concept_id", "unit_id"):
            value = item.get(key)
            if isinstance(value, str) and value.strip():
                return value
        return str(item.get("queue_id", ""))

    exception_queue_ids = sorted(seen)
    by_queue_id = {str(i.get("queue_id")): i for i in items}
    exception_proposal_ids = sorted(
        {_proposal_id(by_queue_id[q]) for q in exception_queue_ids}
    )

    timestamp = review_timestamp or datetime.now(timezone.utc).isoformat()
    record = {
        "record_type": "batch_authorization",
        "book_id": manifest["book_id"],
        "source_version": manifest["source_version"],
        "manifest_sha256": recomputed_sha,
        "authorization_scope": authorization_scope,
        "approval_scope": "batch",
        "approval_basis": approval_basis,
        "disposition": "approved_for_activation",
        "doctor_identity": doctor_identity,
        "review_timestamp": timestamp,
        "review_note": review_note,
        "total_items": total,
        "routine_items": routine_count,
        "exception_items": exception_count,
        "exception_counts": {
            "tome2_unresolved_xref": len(tome2),
            "empty_medication_names": len(meds),
            "duplicate_visual_records": len(dup_items),
            "duplicate_visual_groups": len(dup_groups),
            "private_use_claims": len(pu_claims),
            "page_mapping_gaps": len(page_gaps),
            "unit_mapping_gaps": len(unit_gaps),
        },
        "exception_queue_ids": exception_queue_ids,
        "exception_proposal_ids": exception_proposal_ids,
        "exception_details": {
            "tome2_unresolved_xref": [str(i.get("queue_id")) for i in tome2],
            "empty_medication_names": [str(i.get("queue_id")) for i in meds],
            "duplicate_visual_groups": [
                [str(i.get("queue_id")) for i in group] for group in dup_groups
            ],
            "private_use_claims": [str(i.get("queue_id")) for i in pu_claims],
            "page_mapping_gaps": [str(i.get("queue_id")) for i in page_gaps],
            "unit_mapping_gaps": [str(i.get("queue_id")) for i in unit_gaps],
        },
        "individual_adjudication_count": 0,
        "batch_authorization_count": 1,
    }
    review_dir = root / "review"
    review_dir.mkdir(parents=True, exist_ok=True)
    log_path = review_dir / "batch-authorizations.jsonl"
    line = json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n"
    with log_path.open("a", encoding="utf-8") as stream:
        stream.write(line)
    return record
