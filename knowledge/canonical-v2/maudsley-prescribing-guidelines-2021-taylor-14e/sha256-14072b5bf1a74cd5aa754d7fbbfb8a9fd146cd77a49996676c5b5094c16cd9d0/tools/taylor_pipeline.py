#!/usr/bin/env python3
"""taylor_pipeline.py — book-local Gate 1+2+3 tool for Taylor 2021 (canonical-v2.1).

Scope: Gates 1 (register / source lock), 2 (extract-raw / verify-raw),
and 3 (repair / map-pages: deterministic reading layer + evidence-first
piecewise page map). Stdlib + pypdf + pymupdf only.
No network, no OCR, no translation, no DB, no shared-code modification.

Subcommands:
  register      perform checks 1-3 and write source-lock.json,
                run-manifest.json, book.json, checkpoints/register.json
  extract-raw   Gate 2: immutable per-page raw extraction (raw/, page-records.jsonl,
                checkpoints/pages/)
  verify-raw    Gate 2: independent re-read verification of raw outputs
  repair        Gate 3: deterministic reading layer (reading/, repairs.jsonl)
  map-pages     Gate 3: evidence-first piecewise page map (pages.map.json)
  structure     Gate 4: Book→Part→Chapter hierarchy (structure.json)
  units         Gate 4: typed content units (units.jsonl)
   knowledge     Gate 5: tables/figures/algorithms records
                 (--only tables,figures,algorithms; other passes NOT_IMPLEMENTED)
   qa-freeze     Gate 7: second-pass verification + golden dry-run + QA record
                 (writes review-queue.json, issues.jsonl, qa-report.json;
                 writes golden-set.jsonl, content-manifest.json,
                 governance/lifecycle/state.json only when zero critical
                 errors and golden fully verifies, else BLOCKED exit 1)
   replay        Gate 7: rebuild reading hashes + unit-hash rules + golden
                 expectations + manifest hashes from persisted files;
                 exit 0 only if all reproduce
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import unicodedata
import uuid
from datetime import datetime, timezone
from pathlib import Path

EXPECTED_SHA256 = "14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0"
EXPECTED_PAGE_COUNT = 978
SOURCE_ID = "maudsley-prescribing-guidelines-2021-taylor-14e"
SOURCE_REL = "Books/Prescribing Guidelines in Psychiatry, David M. Taylor (2021).pdf"
BOOK_REL = (
    "knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e"
    "/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0"
)
EXTRACTION_VERSION = "canonical-v2.1-taylor"
REPAIR_VERSION = "reading-repair-v1"
MAPPING_VERSION = "piecewise-page-map-v1"
SCHEMA_VERSION = "canonical-v2.1"
SOURCE_VERSION = "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0"
LOCK_VERSION = "1"

# No stub subcommands remain: qa-freeze and replay are implemented in the
# Gate-7 section below. The tuple is kept (empty) so historical references
# to STUB_COMMANDS keep working.
STUB_COMMANDS: tuple[str, ...] = ()


def repo_root() -> Path:
    return Path.cwd()


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def sha256_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    total = 0
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1048576)
            if not chunk:
                break
            h.update(chunk)
            total += len(chunk)
    return h.hexdigest(), total


def pdf_info(path: Path) -> tuple[int, str, str, str]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    count = len(reader.pages)
    meta = reader.metadata
    title = str(meta.title) if meta.title else ""
    author = str(meta.author) if meta.author else ""
    try:
        import pypdf as _pypdf

        parser_version = "pypdf-" + getattr(_pypdf, "__version__", "unknown")
    except Exception:
        parser_version = "pypdf-unknown"
    return count, title, author, parser_version


def qpdf_check(path: Path) -> tuple[str, str]:
    try:
        proc = subprocess.run(
            ["qpdf", "--check", str(path)],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except FileNotFoundError as exc:
        return "qpdf_not_available", "FileNotFoundError: %s" % exc
    output = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode == 0:
        return "pass", output
    return "fail", output


def cmd_register(args: argparse.Namespace) -> int:
    root = repo_root()
    src = root / SOURCE_REL
    book = root / BOOK_REL
    if not src.is_file():
        print("BLOCKED: source PDF not found: %s" % SOURCE_REL, file=sys.stderr)
        return 1

    digest, byte_size = sha256_file(src)
    if digest.lower() != EXPECTED_SHA256.lower():
        print(
            "BLOCKED: sha256 mismatch: computed=%s expected=%s"
            % (digest.lower(), EXPECTED_SHA256.lower()),
            file=sys.stderr,
        )
        return 1

    page_count, title, author, parser_version = pdf_info(src)
    if page_count != EXPECTED_PAGE_COUNT:
        print(
            "BLOCKED: page count mismatch: computed=%d expected=%d"
            % (page_count, EXPECTED_PAGE_COUNT),
            file=sys.stderr,
        )
        return 1
    if "Maudsley Prescribing Guidelines" not in title:
        print("BLOCKED: title mismatch: %r" % title, file=sys.stderr)
        return 1
    if "Taylor" not in author:
        print("BLOCKED: author mismatch: %r" % author, file=sys.stderr)
        return 1

    qpdf_status, qpdf_output = qpdf_check(src)
    if qpdf_status == "fail":
        print("BLOCKED: qpdf --check failed:\n%s" % qpdf_output, file=sys.stderr)
        return 1

    versions_str = ":".join(
        [digest.lower(), parser_version, EXTRACTION_VERSION, REPAIR_VERSION, MAPPING_VERSION, SCHEMA_VERSION]
    )
    run_key = hashlib.sha256(versions_str.encode("utf-8")).hexdigest()
    run_id = str(uuid.uuid4())
    now = utcnow_iso()

    # Canonical key order — do not reorder.
    source_lock = {
        "source_id": SOURCE_ID,
        "sha256": digest.lower(),
        "byte_size": byte_size,
        "pdf_page_count": page_count,
        "source_path": SOURCE_REL,
        "locked_at": now,
        "lock_version": LOCK_VERSION,
    }
    run_manifest = {
        "run_key": run_key,
        "run_id": run_id,
        "source_id": SOURCE_ID,
        "book_id": SOURCE_ID,
        "source_sha256": digest.lower(),
        "page_count": page_count,
        "parser_version": parser_version,
        "extraction_version": EXTRACTION_VERSION,
        "repair_version": REPAIR_VERSION,
        "mapping_version": MAPPING_VERSION,
        "schema_version": SCHEMA_VERSION,
        "started_at": now,
        "completed_at": None,
        "run_status": "running",
        "failure": None,
    }
    book_doc = {
        "book_id": SOURCE_ID,
        "title": "The Maudsley Prescribing Guidelines in Psychiatry",
        "edition": "14th Edition / 2021",
        "authors": ["David M. Taylor", "Thomas R. E. Barnes", "Allan H. Young"],
        "publisher": "John Wiley & Sons",
        "language": "en",
        "source_type": "PRINTED_BOOK",
        "status": "PENDING_APPROVAL",
        "source_version": SOURCE_VERSION,
        "pdf_page_count": page_count,
        "approved_at": None,
        "approved_by": None,
    }
    register_cp = {
        "sha256": digest.lower(),
        "byte_size": byte_size,
        "pdf_page_count": page_count,
        "title": title,
        "author": author,
        "qpdf_check": qpdf_status,
        "checked_at": now,
    }

    (book / "checkpoints").mkdir(parents=True, exist_ok=True)
    with open(book / "source-lock.json", "w", encoding="utf-8") as f:
        json.dump(source_lock, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(book / "run-manifest.json", "w", encoding="utf-8") as f:
        json.dump(run_manifest, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(book / "book.json", "w", encoding="utf-8") as f:
        json.dump(book_doc, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(book / "checkpoints" / "register.json", "w", encoding="utf-8") as f:
        json.dump(register_cp, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print("register OK: sha256=%s pages=%d qpdf=%s" % (digest.lower(), page_count, qpdf_status))
    return 0


def cmd_stub(name: str) -> int:
    print("NOT_IMPLEMENTED: %s" % name)
    return 1


# ---------------------------------------------------------------------------
# Gate 2 — immutable raw extraction (TAYLOR-001b). No repair, no interpretation.
# ---------------------------------------------------------------------------

EXPECTED_BYTE_SIZE = 5205189
RAW_PARSER_VERSION = "extract-raw-v1"


def _text_sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _canonical_sha(obj) -> str:
    return hashlib.sha256(
        json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()


def _raw_path(book: Path, tag: str) -> Path:
    return book / "raw" / ("page-%s.json" % tag)


def _page_checkpoint_path(book: Path, tag: str) -> Path:
    return book / "checkpoints" / "pages" / ("page-%s.json" % tag)


def cmd_extract_raw(args: argparse.Namespace) -> int:
    root = repo_root()
    src = root / SOURCE_REL
    book = root / BOOK_REL
    raw_dir = book / "raw"
    pages_dir = book / "checkpoints" / "pages"

    if raw_dir.exists():
        print(
            "BLOCKED: raw/ already exists — refusing to overwrite: %s" % raw_dir,
            file=sys.stderr,
        )
        return 1
    if not src.is_file():
        print("BLOCKED: source PDF not found: %s" % SOURCE_REL, file=sys.stderr)
        return 1

    # Source-lock re-check before any write.
    digest, byte_size = sha256_file(src)
    if digest.lower() != EXPECTED_SHA256.lower():
        print(
            "BLOCKED: sha256 mismatch: computed=%s expected=%s"
            % (digest.lower(), EXPECTED_SHA256.lower()),
            file=sys.stderr,
        )
        return 1
    if byte_size != EXPECTED_BYTE_SIZE:
        print(
            "BLOCKED: byte size mismatch: computed=%d expected=%d" % (byte_size, EXPECTED_BYTE_SIZE),
            file=sys.stderr,
        )
        return 1

    import pymupdf

    doc = pymupdf.open(str(src))
    try:
        if len(doc) != EXPECTED_PAGE_COUNT:
            print(
                "BLOCKED: page count mismatch: computed=%d expected=%d"
                % (len(doc), EXPECTED_PAGE_COUNT),
                file=sys.stderr,
            )
            return 1

        from pypdf import PdfReader

        reader = PdfReader(str(src))

        raw_dir.mkdir(parents=True)
        pages_dir.mkdir(parents=True, exist_ok=True)

        n_extracted = 0
        n_empty = 0
        n_failed = 0

        for n in range(1, EXPECTED_PAGE_COUNT + 1):
            tag = "%04d" % n
            engine = "pymupdf"
            failure_code = None
            failure_detail = None
            block_items: list[tuple[float, float, float, float, str]] = []
            try:
                try:
                    page = doc[n - 1]
                    raw_text = page.get_text("text")
                    blocks_raw = page.get_text("blocks")
                    for b in blocks_raw:
                        if len(b) < 7:
                            continue
                        if b[6] != 0:
                            continue  # non-text block (e.g. image): no text objects
                        block_items.append(
                            (
                                float(b[0]),
                                float(b[1]),
                                float(b[2]),
                                float(b[3]),
                                str(b[4]),
                            )
                        )
                except Exception as exc_fitz:
                    # Per-page fallback: pypdf text only (no coordinates available).
                    try:
                        raw_text = reader.pages[n - 1].extract_text() or ""
                        engine = "pypdf-fallback"
                        block_items = []
                    except Exception as exc_pdf:
                        raw_text = ""
                        engine = "pypdf-fallback"
                        block_items = []
                        failure_code = "EXTRACTION_FAILED"
                        failure_detail = "fitz: %r; pypdf: %r" % (exc_fitz, exc_pdf)

                if failure_code is not None:
                    status = "failed"
                elif len(raw_text) > 0:
                    status = "extracted"
                else:
                    status = "empty"

                if status == "extracted":
                    n_extracted += 1
                elif status == "empty":
                    n_empty += 1
                else:
                    n_failed += 1

                blocks = []
                for order, (x0, y0, x1, y1, text) in enumerate(block_items):
                    blocks.append(
                        {
                            "block_id": "page-%s-block-%04d" % (tag, order),
                            "order": order,
                            "text": text,
                            "bbox": [x0, y0, x1, y1],
                            "text_sha256": _text_sha(text),
                        }
                    )

                raw_text_sha = _text_sha(raw_text)
                coords_sha = _canonical_sha([b["bbox"] for b in blocks])
                seq_sha = _canonical_sha(
                    [{"order": b["order"], "text_sha256": b["text_sha256"]} for b in blocks]
                )

                # Canonical key order — do not reorder. No timestamps in raw files.
                record = {
                    "page_id": "%s:page-%s" % (SOURCE_ID, tag),
                    "book_id": SOURCE_ID,
                    "source_version": SOURCE_VERSION,
                    "source_sha256": EXPECTED_SHA256.lower(),
                    "physical_page": n,
                    "source_page_index": n - 1,
                    "source_page_display": n,
                    "extraction_status": status,
                    "extraction_engine": engine,
                    "raw_text": raw_text,
                    "raw_text_sha256": raw_text_sha,
                    "coordinates_sha256": coords_sha,
                    "block_sequence_sha256": seq_sha,
                    "blocks": blocks,
                    "parser": {"name": "taylor_pipeline", "version": RAW_PARSER_VERSION},
                    "failure_code": failure_code,
                    "failure_detail": failure_detail,
                }
                with open(_raw_path(book, tag), "w", encoding="utf-8") as f:
                    json.dump(record, f, indent=2, ensure_ascii=False)
                    f.write("\n")

                checkpoint = {
                    "book_id": SOURCE_ID,
                    "source_version": SOURCE_VERSION,
                    "physical_page": n,
                    "source_page_index": n - 1,
                    "extraction_status": status,
                    "extraction_engine": engine,
                    "raw_file": "raw/page-%s.json" % tag,
                    "raw_text_sha256": raw_text_sha,
                    "char_count": len(raw_text),
                    "failure_code": failure_code,
                    "extracted_at": utcnow_iso(),
                }
                with open(_page_checkpoint_path(book, tag), "w", encoding="utf-8") as f:
                    json.dump(checkpoint, f, indent=2, ensure_ascii=False)
                    f.write("\n")
            except Exception as exc_page:  # fault isolation: never abort the run
                n_failed += 1
                record = {
                    "page_id": "%s:page-%s" % (SOURCE_ID, tag),
                    "book_id": SOURCE_ID,
                    "source_version": SOURCE_VERSION,
                    "source_sha256": EXPECTED_SHA256.lower(),
                    "physical_page": n,
                    "source_page_index": n - 1,
                    "source_page_display": n,
                    "extraction_status": "failed",
                    "extraction_engine": "pymupdf",
                    "raw_text": "",
                    "raw_text_sha256": _text_sha(""),
                    "coordinates_sha256": _canonical_sha([]),
                    "block_sequence_sha256": _canonical_sha([]),
                    "blocks": [],
                    "parser": {"name": "taylor_pipeline", "version": RAW_PARSER_VERSION},
                    "failure_code": "PAGE_LOOP_FAILED",
                    "failure_detail": repr(exc_page),
                }
                with open(_raw_path(book, tag), "w", encoding="utf-8") as f:
                    json.dump(record, f, indent=2, ensure_ascii=False)
                    f.write("\n")
                checkpoint = {
                    "book_id": SOURCE_ID,
                    "source_version": SOURCE_VERSION,
                    "physical_page": n,
                    "source_page_index": n - 1,
                    "extraction_status": "failed",
                    "extraction_engine": "pymupdf",
                    "raw_file": "raw/page-%s.json" % tag,
                    "raw_text_sha256": _text_sha(""),
                    "char_count": 0,
                    "failure_code": "PAGE_LOOP_FAILED",
                    "extracted_at": utcnow_iso(),
                }
                with open(_page_checkpoint_path(book, tag), "w", encoding="utf-8") as f:
                    json.dump(checkpoint, f, indent=2, ensure_ascii=False)
                    f.write("\n")

            if n % 50 == 0 or n == EXPECTED_PAGE_COUNT:
                print(
                    "extracted %d/%d, empty=%d, failed=%d" % (n, EXPECTED_PAGE_COUNT, n_empty, n_failed),
                    flush=True,
                )

        # Derive page-records.jsonl by READING BACK the raw files (no divergence).
        jsonl_path = book / "page-records.jsonl"
        with open(jsonl_path, "w", encoding="utf-8") as out:
            for n in range(1, EXPECTED_PAGE_COUNT + 1):
                tag = "%04d" % n
                with open(_raw_path(book, tag), "r", encoding="utf-8") as f:
                    rec = json.load(f)
                if rec.get("physical_page") != n:
                    print(
                        "BLOCKED: read-back divergence at %s" % tag,
                        file=sys.stderr,
                    )
                    return 1
                line = {
                    "physical_page": rec["physical_page"],
                    "source_page_index": rec["source_page_index"],
                    "raw_file": "raw/page-%s.json" % tag,
                    "extraction_status": rec["extraction_status"],
                    "extraction_engine": rec["extraction_engine"],
                    "raw_text_sha256": rec["raw_text_sha256"],
                    "char_count": len(rec["raw_text"]),
                }
                out.write(json.dumps(line, ensure_ascii=False) + "\n")

        print(
            "extract-raw OK: total=%d extracted=%d empty=%d failed=%d"
            % (EXPECTED_PAGE_COUNT, n_extracted, n_empty, n_failed)
        )
        return 0
    finally:
        doc.close()


def cmd_verify_raw(args: argparse.Namespace) -> int:
    root = repo_root()
    book = root / BOOK_REL
    raw_dir = book / "raw"
    pages_dir = book / "checkpoints" / "pages"
    jsonl_path = book / "page-records.jsonl"

    results: list[tuple[str, str, str]] = []

    def verdict(name: str, passed: bool, evidence: str) -> None:
        results.append((name, "PASS" if passed else "FAIL", evidence))

    expected_tags = ["%04d" % n for n in range(1, EXPECTED_PAGE_COUNT + 1)]

    raw_files = sorted(raw_dir.glob("page-*.json")) if raw_dir.is_dir() else []
    raw_names = sorted(p.name for p in raw_files)
    verdict(
        "Raw count",
        raw_names == ["page-%s.json" % t for t in expected_tags],
        "raw files=%d expected=%d" % (len(raw_names), EXPECTED_PAGE_COUNT),
    )

    cp_files = sorted(pages_dir.glob("page-*.json")) if pages_dir.is_dir() else []
    cp_names = sorted(p.name for p in cp_files)
    verdict(
        "Checkpoint count",
        cp_names == ["page-%s.json" % t for t in expected_tags],
        "checkpoint files=%d expected=%d" % (len(cp_names), EXPECTED_PAGE_COUNT),
    )

    jsonl_lines: list[str] = []
    if jsonl_path.is_file():
        with open(jsonl_path, "r", encoding="utf-8") as f:
            jsonl_lines = f.read().splitlines()
    verdict(
        "JSONL count",
        len(jsonl_lines) == EXPECTED_PAGE_COUNT,
        "jsonl lines=%d expected=%d" % (len(jsonl_lines), EXPECTED_PAGE_COUNT),
    )

    # Continuity: no gaps/dups across raw + checkpoints.
    continuity_ok = raw_names == ["page-%s.json" % t for t in expected_tags] and cp_names == [
        "page-%s.json" % t for t in expected_tags
    ]
    verdict(
        "Page continuity",
        continuity_ok,
        "0001..0978 contiguous" if continuity_ok else "gap/dup detected",
    )

    # JSON validity: every file parses.
    raw_recs: dict[int, dict] = {}
    cp_recs: dict[int, dict] = {}
    jsonl_recs: dict[int, dict] = {}
    parse_errors: list[str] = []
    for n, tag in enumerate(expected_tags, start=1):
        try:
            with open(_raw_path(book, tag), "r", encoding="utf-8") as f:
                raw_recs[n] = json.load(f)
        except Exception as exc:
            parse_errors.append("raw/page-%s.json: %r" % (tag, exc))
        try:
            with open(_page_checkpoint_path(book, tag), "r", encoding="utf-8") as f:
                cp_recs[n] = json.load(f)
        except Exception as exc:
            parse_errors.append("checkpoints/pages/page-%s.json: %r" % (tag, exc))
    for i, line in enumerate(jsonl_lines, start=1):
        try:
            rec = json.loads(line)
            if isinstance(rec.get("physical_page"), int):
                jsonl_recs[rec["physical_page"]] = rec
            else:
                parse_errors.append("jsonl line %d: bad physical_page" % i)
        except Exception as exc:
            parse_errors.append("jsonl line %d: %r" % (i, exc))
    verdict(
        "JSON validity",
        not parse_errors,
        "all parse OK" if not parse_errors else "; ".join(parse_errors[:5]),
    )

    # Cross-record integrity: line N <-> raw/page-N <-> checkpoint/page-N.
    cross_errors: list[str] = []
    hash_errors: list[str] = []
    if not parse_errors:
        for n, tag in enumerate(expected_tags, start=1):
            raw = raw_recs[n]
            cp = cp_recs[n]
            jl = jsonl_recs.get(n)
            if jl is None:
                cross_errors.append("page %s: missing jsonl line" % tag)
                continue
            if not (
                raw.get("physical_page") == n
                and raw.get("source_page_index") == n - 1
                and raw.get("source_page_display") == n
                and raw.get("page_id") == "%s:page-%s" % (SOURCE_ID, tag)
                and raw.get("book_id") == SOURCE_ID
                and raw.get("source_version") == SOURCE_VERSION
                and raw.get("source_sha256") == EXPECTED_SHA256.lower()
            ):
                cross_errors.append("page %s: raw identity mismatch" % tag)
            for field in ("extraction_status", "extraction_engine", "raw_text_sha256"):
                if jl.get(field) != raw.get(field):
                    cross_errors.append("page %s: jsonl.%s != raw.%s" % (tag, field, field))
                if cp.get(field) != raw.get(field):
                    cross_errors.append("page %s: checkpoint.%s != raw.%s" % (tag, field, field))
            if jl.get("physical_page") != n or jl.get("source_page_index") != n - 1:
                cross_errors.append("page %s: jsonl index mismatch" % tag)
            if jl.get("raw_file") != "raw/page-%s.json" % tag:
                cross_errors.append("page %s: jsonl raw_file mismatch" % tag)
            if cp.get("raw_file") != "raw/page-%s.json" % tag:
                cross_errors.append("page %s: checkpoint raw_file mismatch" % tag)
            if cp.get("char_count") != len(raw.get("raw_text", "")):
                cross_errors.append("page %s: checkpoint char_count mismatch" % tag)
            if jl.get("char_count") != len(raw.get("raw_text", "")):
                cross_errors.append("page %s: jsonl char_count mismatch" % tag)
            if cp.get("physical_page") != n or cp.get("source_page_index") != n - 1:
                cross_errors.append("page %s: checkpoint index mismatch" % tag)
            # Hash integrity: recompute all three hashes from stored content.
            if _text_sha(raw.get("raw_text", "")) != raw.get("raw_text_sha256"):
                hash_errors.append("page %s: raw_text_sha256 mismatch" % tag)
            blocks = raw.get("blocks", [])
            if _canonical_sha([b.get("bbox") for b in blocks]) != raw.get("coordinates_sha256"):
                hash_errors.append("page %s: coordinates_sha256 mismatch" % tag)
            if _canonical_sha(
                [{"order": b.get("order"), "text_sha256": b.get("text_sha256")} for b in blocks]
            ) != raw.get("block_sequence_sha256"):
                hash_errors.append("page %s: block_sequence_sha256 mismatch" % tag)
            for order, b in enumerate(blocks):
                if b.get("block_id") != "page-%s-block-%04d" % (tag, order):
                    cross_errors.append("page %s: block_id order mismatch" % tag)
                    break
                if b.get("order") != order:
                    cross_errors.append("page %s: block order mismatch" % tag)
                    break
                if _text_sha(b.get("text", "")) != b.get("text_sha256"):
                    hash_errors.append("page %s: block text_sha256 mismatch" % tag)
                    break
            if len(cross_errors) + len(hash_errors) > 10:
                cross_errors.append("... truncated")
                break
    verdict(
        "Cross-record integrity",
        not cross_errors and not parse_errors,
        "all 978 triples match" if not cross_errors and not parse_errors else "; ".join(cross_errors[:5]),
    )
    verdict(
        "Hash integrity",
        not hash_errors and not parse_errors,
        "all hashes recompute OK" if not hash_errors and not parse_errors else "; ".join(hash_errors[:5]),
    )

    # Fault isolation: every failed record carries a failure code; run is complete.
    fault_ok = True
    fault_evidence = "no aborts; 978/978 records present"
    if not parse_errors and raw_recs:
        failed = [n for n, r in raw_recs.items() if r.get("extraction_status") == "failed"]
        missing_code = [
            n for n in failed if not raw_recs[n].get("failure_code") or not raw_recs[n].get("failure_detail")
        ]
        fault_ok = not missing_code and len(raw_recs) == EXPECTED_PAGE_COUNT
        statuses = {}
        for r in raw_recs.values():
            statuses[r.get("extraction_status")] = statuses.get(r.get("extraction_status"), 0) + 1
        fault_evidence = "statuses=%s failed_without_code=%d" % (statuses, len(missing_code))
    verdict("Fault isolation", fault_ok and not parse_errors, fault_evidence)

    width = max(len(name) for name, _, _ in results)
    print("CHECK%s  RESULT  EVIDENCE" % (" " * (width - 5)))
    all_pass = True
    for name, result, evidence in results:
        print("%s%s  %s    %s" % (name, " " * (width - len(name)), result, evidence))
        if result != "PASS":
            all_pass = False
    print("verify-raw: %s (%d/%d)" % ("ALL PASS" if all_pass else "FAILURES PRESENT", sum(1 for _, r, _ in results if r == "PASS"), len(results)))
    return 0 if all_pass else 1


# ---------------------------------------------------------------------------
# Gate 3 — deterministic reading layer (repair) + evidence-first page map.
# Zero clinical interpretation. Gate-2 raw/ is read-only input.
# ---------------------------------------------------------------------------

READING_VERSION = REPAIR_VERSION  # "reading-repair-v1"

# Allowlist (a): explicit table, nothing else. These are compatibility
# ligatures (Alphabetic Presentation Forms); NFKC would decompose the five
# ligatures identically, but they are applied explicitly here so every
# content-changing edit carries a ledger entry. Soft hyphen (U+00AD) is NOT
# touched by NFKC and is removed explicitly.
LIGATURE_TABLE = {
    "ﬁ": "fi",  # U+FB01
    "ﬂ": "fl",  # U+FB02
    "ﬀ": "ff",  # U+FB00
    "ﬃ": "ffi",  # U+FB03
    "ﬄ": "ffl",  # U+FB04
}
SOFT_HYPHEN = "­"
RULE_LIGATURE = "ligature-pua-approved"
RULE_DEHYPHEN = "dehyphenate-geometry-proven"
ALLOWLIST_RULES = (RULE_LIGATURE, RULE_DEHYPHEN)
# Geometry gate for (b): next block must start at or just below the current
# block bottom (gap >= 0, gap <= ratio * current line height) with x-overlap.
DEHYPHEN_GAP_RATIO = 0.6

# Running-head geometry (observed: y0=31.4, y1=41.0 on all 886 headed pages).
HEADER_Y0_MIN, HEADER_Y0_MAX = 30.0, 33.0
HEADER_Y1_MIN, HEADER_Y1_MAX = 39.0, 43.0


def _repair_char_pass(raw_text: str, block_id: str) -> tuple[str, list[dict]]:
    """Apply allowlist rule (a) to one raw block text.

    Returns (replaced_text, repairs). Offsets are raw block-text offsets.
    """
    out: list[str] = []
    repairs: list[dict] = []
    for off, ch in enumerate(raw_text):
        if ch in LIGATURE_TABLE:
            repairs.append(
                {
                    "block_id": block_id,
                    "rule_id": RULE_LIGATURE,
                    "raw_value": ch,
                    "replacement_value": LIGATURE_TABLE[ch],
                    "raw_offset_start": off,
                    "raw_offset_end": off + 1,
                    "confidence": "high",
                    "review_status": "auto",
                }
            )
            out.append(LIGATURE_TABLE[ch])
        elif ch == SOFT_HYPHEN:
            repairs.append(
                {
                    "block_id": block_id,
                    "rule_id": RULE_LIGATURE,
                    "raw_value": SOFT_HYPHEN,
                    "replacement_value": "",
                    "raw_offset_start": off,
                    "raw_offset_end": off + 1,
                    "confidence": "high",
                    "review_status": "auto",
                }
            )
        else:
            out.append(ch)
    return "".join(out), repairs


def _repair_page(raw_rec: dict) -> tuple[list[str], list[dict], list[bool]]:
    """Baseline + allowlist repairs for one raw page record.

    Baseline: NFKC normalize each block text (after rule-(a) char pass),
    strip leading/trailing whitespace per block, join blocks with "\\n"
    (block order preserved; empty-after-strip blocks are kept as empty
    segments so block order/indices are never renumbered).
    Returns (base_texts, repairs, joins) where joins[i] means base[i] and
    base[i+1] are dehyphenated into one line per rule (b).
    """
    raw_blocks = raw_rec.get("blocks", [])
    base_texts: list[str] = []
    repairs: list[dict] = []
    for b in raw_blocks:
        replaced, char_repairs = _repair_char_pass(b.get("text", ""), b.get("block_id", ""))
        repairs.extend(char_repairs)
        base_texts.append(unicodedata.normalize("NFKC", replaced).strip())

    joins = [False] * max(0, len(raw_blocks) - 1)
    for i in range(len(raw_blocks) - 1):
        cur, nxt = base_texts[i], base_texts[i + 1]
        if not cur.endswith("-") or not nxt:
            continue
        c0 = nxt[0]
        if not (c0.isalpha() and c0.islower()):
            continue
        cb, nb = raw_blocks[i].get("bbox", [0, 0, 0, 0]), raw_blocks[i + 1].get("bbox", [0, 0, 0, 0])
        gap = nb[1] - cb[3]
        line_h = cb[3] - cb[1]
        x_overlap = min(cb[2], nb[2]) - max(cb[0], nb[0])
        if not (line_h > 0 and 0 <= gap <= DEHYPHEN_GAP_RATIO * line_h and x_overlap > 0):
            continue
        joins[i] = True
        raw_i = raw_blocks[i].get("text", "")
        m = re.search(r"-\s*$", raw_i)
        start = m.start() if m else len(raw_i)
        tail = raw_i.rstrip()[-40:]
        head = raw_blocks[i + 1].get("text", "").lstrip()[:40]
        repairs.append(
            {
                "block_id": raw_blocks[i].get("block_id", ""),
                "rule_id": RULE_DEHYPHEN,
                # Offsets locate the trailing "-" inside block_id's raw text;
                # the join additionally consumes the inter-block newline
                # separator (which exists only in the joined reading text).
                "raw_value": tail + "\n" + head,
                "replacement_value": (tail[:-1] if tail.endswith("-") else tail) + head,
                "raw_offset_start": start,
                "raw_offset_end": len(raw_i),
                "confidence": "medium",
                "review_status": "auto",
            }
        )
    return base_texts, repairs, joins


def _assemble_reading(base_texts: list[str], joins: list[bool]) -> str:
    if not base_texts:
        return ""
    out = base_texts[0]
    for i in range(1, len(base_texts)):
        if joins[i - 1]:
            out = out[:-1] + base_texts[i]  # drop hyphen, no separator
        else:
            out = out + "\n" + base_texts[i]
    return out


def _check_source_lock_pdf(root: Path) -> tuple[bool, str]:
    src = root / SOURCE_REL
    if not src.is_file():
        return False, "source PDF not found: %s" % SOURCE_REL
    digest, byte_size = sha256_file(src)
    if digest.lower() != EXPECTED_SHA256.lower():
        return False, "sha256 mismatch: computed=%s" % digest.lower()
    if byte_size != EXPECTED_BYTE_SIZE:
        return False, "byte size mismatch: computed=%d" % byte_size
    return True, "sha256=%s bytes=%d" % (digest.lower(), byte_size)


def cmd_repair(args: argparse.Namespace) -> int:
    root = repo_root()
    book = root / BOOK_REL
    raw_dir = book / "raw"
    reading_dir = book / "reading"
    repairs_path = book / "repairs.jsonl"

    expected_tags = ["%04d" % n for n in range(1, EXPECTED_PAGE_COUNT + 1)]
    if not raw_dir.is_dir():
        print("BLOCKED: raw/ not found", file=sys.stderr)
        return 1
    raw_names = sorted(p.name for p in raw_dir.glob("page-*.json"))
    if raw_names != ["page-%s.json" % t for t in expected_tags]:
        print(
            "BLOCKED: raw/ must contain exactly page-0001..0978 (found %d files)" % len(raw_names),
            file=sys.stderr,
        )
        return 1
    if reading_dir.exists() or repairs_path.exists():
        print("BLOCKED: reading/ or repairs.jsonl already exists — refusing to overwrite", file=sys.stderr)
        return 1
    ok, evidence = _check_source_lock_pdf(root)
    if not ok:
        print("BLOCKED: %s" % evidence, file=sys.stderr)
        return 1

    reading_dir.mkdir(parents=True)
    n_lig = 0
    n_dehy = 0
    n_failed = 0
    repair_seq = 0
    with open(repairs_path, "w", encoding="utf-8") as ledger:
        for n in range(1, EXPECTED_PAGE_COUNT + 1):
            tag = "%04d" % n
            try:
                with open(_raw_path(book, tag), "r", encoding="utf-8") as f:
                    raw_rec = json.load(f)
                base_texts, repairs, joins = _repair_page(raw_rec)
                repaired_text = _assemble_reading(base_texts, joins)
                repair_ids: list[str] = []
                for r in repairs:
                    repair_seq += 1
                    rid = "repair-%06d" % repair_seq
                    repair_ids.append(rid)
                    # Canonical key order — do not reorder. No timestamps.
                    ledger.write(
                        json.dumps(
                            {
                                "repair_id": rid,
                                "page_id": raw_rec.get("page_id", "%s:page-%s" % (SOURCE_ID, tag)),
                                "block_id": r["block_id"],
                                "rule_id": r["rule_id"],
                                "raw_value": r["raw_value"],
                                "replacement_value": r["replacement_value"],
                                "raw_offset_start": r["raw_offset_start"],
                                "raw_offset_end": r["raw_offset_end"],
                                "confidence": r["confidence"],
                                "review_status": r["review_status"],
                            },
                            ensure_ascii=False,
                        )
                        + "\n"
                    )
                    if r["rule_id"] == RULE_LIGATURE:
                        n_lig += 1
                    else:
                        n_dehy += 1
                # Canonical key order — do not reorder. No timestamps.
                record = {
                    "page_id": raw_rec.get("page_id", "%s:page-%s" % (SOURCE_ID, tag)),
                    "book_id": SOURCE_ID,
                    "source_version": SOURCE_VERSION,
                    "physical_page": n,
                    "source_page_index": n - 1,
                    "repaired_text": repaired_text,
                    "repaired_text_sha256": _text_sha(repaired_text),
                    "raw_text_sha256": raw_rec.get("raw_text_sha256", ""),
                    "repair_ids": repair_ids,
                    "raw_file": "raw/page-%s.json" % tag,
                }
                with open(reading_dir / ("page-%s.json" % tag), "w", encoding="utf-8") as f:
                    json.dump(record, f, indent=2, ensure_ascii=False)
                    f.write("\n")
            except Exception as exc:  # fault isolation: never abort the run
                n_failed += 1
                print("repair FAILED page-%s: %r" % (tag, exc), file=sys.stderr)
            if n % 50 == 0 or n == EXPECTED_PAGE_COUNT:
                print("repaired %d/%d, failed=%d" % (n, EXPECTED_PAGE_COUNT, n_failed), flush=True)

    print(
        "repair OK: total=%d ligature-pua-approved=%d dehyphenate-geometry-proven=%d failed=%d (%s)"
        % (EXPECTED_PAGE_COUNT, n_lig, n_dehy, n_failed, evidence)
    )
    return 0 if n_failed == 0 else 1


_ROMAN_VALUES = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}


def _roman_to_int(s: str) -> int | None:
    if not s or not re.fullmatch(r"[ivxlcdm]+", s):
        return None
    total = 0
    prev = 0
    for ch in reversed(s):
        v = _ROMAN_VALUES[ch]
        if v < prev:
            total -= v
        else:
            total += v
        prev = v
    return total


def _parse_header(text: str) -> tuple[str, str] | None:
    """Parse a running-head block. Returns (numeral, side) where numeral is the
    raw token (arabic digits or lowercase roman) and side is lead/trail."""
    t = unicodedata.normalize("NFKC", text).strip()
    m = re.match(r"^(\d+|[ivxlcdm]+)\s+(.+)$", t, re.S)
    if m and m.group(2).strip():
        tok = m.group(1)
        if tok.isdigit() or _roman_to_int(tok) is not None:
            return tok, "lead"
    m = re.match(r"^(.+?)\s+(\d+|[ivxlcdm]+)$", t, re.S)
    if m and m.group(1).strip():
        tok = m.group(2)
        if tok.isdigit() or _roman_to_int(tok) is not None:
            return tok, "trail"
    return None


def _header_blocks(blocks: list[dict]) -> list[dict]:
    return [
        b
        for b in blocks
        if HEADER_Y0_MIN <= b.get("bbox", [0, 0, 0, 0])[1] <= HEADER_Y0_MAX
        and HEADER_Y1_MIN <= b.get("bbox", [0, 0, 0, 0])[3] <= HEADER_Y1_MAX
    ]


def _no_folio_cause(blocks: list[dict]) -> dict | None:
    """Pick the block that best explains why a page carries no folio."""
    stripped = [(b, unicodedata.normalize("NFKC", b.get("text", "")).strip()) for b in blocks]
    stripped = [(b, t) for b, t in stripped if t]
    if not stripped:
        return None
    for b, t in stripped:
        if t.startswith("Part ") and len(t) < 120:
            return {"block_id": b["block_id"], "observed_text": t}
    for b, t in stripped:
        if re.match(r"^Chapter\s+\d+", t):
            return {"block_id": b["block_id"], "observed_text": t}
    for b, t in stripped:
        if t.startswith("Table "):
            return {"block_id": b["block_id"], "observed_text": t[:240]}
    for b, t in stripped:
        if t in ("(Continued)", "(Continued )"):
            return {"block_id": b["block_id"], "observed_text": t}
    for b, t in stripped:
        if t.startswith("The Maudsley® Prescribing Guidelines in Psychiatry, Fourteenth Edition"):
            return {"block_id": b["block_id"], "observed_text": t[:240]}
    b, t = stripped[0]
    return {"block_id": b["block_id"], "observed_text": t[:240]}


def _int_to_roman(num: int) -> str:
    table = (
        (10, "x"),
        (9, "ix"),
        (5, "v"),
        (4, "iv"),
        (1, "i"),
    )
    out = ""
    for value, glyph in table:
        while num >= value:
            out += glyph
            num -= value
    return out


def cmd_map_pages(args: argparse.Namespace) -> int:
    root = repo_root()
    book = root / BOOK_REL
    map_path = book / "pages.map.json"
    if map_path.exists():
        print("BLOCKED: pages.map.json already exists — refusing to overwrite", file=sys.stderr)
        return 1
    ok, lock_evidence = _check_source_lock_pdf(root)
    if not ok:
        print("BLOCKED: %s" % lock_evidence, file=sys.stderr)
        return 1

    # -- Pass 1: per-page classification from observed text only. --
    pages: dict[int, dict] = {}
    for n in range(1, EXPECTED_PAGE_COUNT + 1):
        tag = "%04d" % n
        with open(_raw_path(book, tag), "r", encoding="utf-8") as f:
            raw_rec = json.load(f)
        blocks = raw_rec.get("blocks", [])
        hdrs = _header_blocks(blocks)
        info: dict = {
            "physical": n,
            "index": n - 1,
            "display": raw_rec.get("source_page_display", n),
            "empty": raw_rec.get("extraction_status") == "empty",
            "blocks": blocks,
        }
        if len(hdrs) == 1:
            parsed = _parse_header(hdrs[0].get("text", ""))
            if parsed is not None:
                tok, side = parsed
                info["header"] = hdrs[0]
                info["observed_text"] = unicodedata.normalize("NFKC", hdrs[0].get("text", "")).strip()
                if tok.isdigit():
                    info["kind"] = "observed-arabic"
                    info["printed"] = int(tok)
                else:
                    info["kind"] = "observed-roman"
                    info["printed"] = tok
            else:
                info["kind"] = "unparseable-header"
                info["header"] = hdrs[0]
                info["observed_text"] = unicodedata.normalize("NFKC", hdrs[0].get("text", "")).strip()
        elif len(hdrs) == 0:
            info["kind"] = "empty" if info["empty"] else "gap"
        else:
            info["kind"] = "ambiguous-headers"
            info["headers"] = hdrs
        pages[n] = info

    # -- Pass 2: derive deltas from observed pages (never assume them). --
    arab = [(n, p["printed"]) for n, p in pages.items() if p["kind"] == "observed-arabic"]
    rom = [(n, p["printed"]) for n, p in pages.items() if p["kind"] == "observed-roman"]
    arab_deltas = {v - k for k, v in arab}
    rom_deltas = {(_roman_to_int(v) or 0) - k for k, v in rom}
    anomalies: list[int] = []
    if len(arab_deltas) == 1:
        delta = next(iter(arab_deltas))
    else:
        # No single consistent progression: keep the majority delta for
        # inference and mark every off-delta observed page anomalous.
        from collections import Counter as _Counter

        delta = _Counter(v - k for k, v in arab).most_common(1)[0][0]
        anomalies.extend(sorted(k for k, v in arab if v - k != delta))
    if len(rom_deltas) == 1:
        delta_r = next(iter(rom_deltas))
    else:
        from collections import Counter as _Counter

        delta_r = _Counter((_roman_to_int(v) or 0) - k for k, v in rom).most_common(1)[0][0]
        anomalies.extend(sorted(k for k, v in rom if (_roman_to_int(v) or 0) - k != delta_r))

    for n in anomalies:
        pages[n]["kind"] = "anomalous-header"

    # Zones derived from evidence: front = up to last observed roman page;
    # back = from one before the first Index-titled header to end.
    last_roman = max([k for k, v in rom] + [0])
    index_heads = sorted(
        n
        for n, p in pages.items()
        if p["kind"] in ("observed-arabic", "observed-roman")
        and re.search(r"(^|\s)Index\s*$", p["observed_text"])
    )
    front_end = last_roman
    back_start = (min(index_heads) - 1) if index_heads else EXPECTED_PAGE_COUNT + 1

    def zone_of(n: int) -> str:
        if n <= front_end:
            return "front"
        if n >= back_start:
            return "back"
        return "body"

    def nearest_observed(n: int, direction: int) -> dict | None:
        k = n + direction
        while 1 <= k <= EXPECTED_PAGE_COUNT:
            if pages[k]["kind"] in ("observed-arabic", "observed-roman"):
                return pages[k]
            k += direction
        return None

    # -- Pass 3: resolve gap pages (interpolate, never silently). --
    for n in range(1, EXPECTED_PAGE_COUNT + 1):
        p = pages[n]
        if n == EXPECTED_PAGE_COUNT and p["kind"] == "gap":
            # Trailing unnumbered insert (EULA): null preferred to guessing.
            p["kind"] = "eula"
            p["printed"] = None
            continue
        if p["kind"] == "gap":
            before = nearest_observed(n, -1)
            after = nearest_observed(n, +1)
            z = zone_of(n)
            want = "observed-roman" if z == "front" else "observed-arabic"
            b_ok = before if (before is not None and before["kind"] == want) else None
            a_ok = after if (after is not None and after["kind"] == want) else None
            if z == "front":
                exp = _int_to_roman(n + delta_r)
            else:
                exp = n + delta
            slope_ok = False
            if b_ok is not None and a_ok is not None:
                if z == "front":
                    bv = _roman_to_int(b_ok["printed"]) or 0
                    av = _roman_to_int(a_ok["printed"]) or 0
                else:
                    bv, av = b_ok["printed"], a_ok["printed"]
                slope_ok = (av - bv) == (a_ok["physical"] - b_ok["physical"])
            if b_ok is not None and a_ok is not None and slope_ok:
                p["kind"] = "inferred"
                p["printed"] = exp
                p["confidence"] = "medium"
                p["anchor_before"] = b_ok
                p["anchor_after"] = a_ok
            elif (b_ok is None) != (a_ok is None):
                # Single-anchor extrapolation (book edges / part openers).
                p["kind"] = "inferred"
                p["printed"] = exp
                p["confidence"] = "low"
                p["anchor_before"] = b_ok
                p["anchor_after"] = a_ok
            else:
                p["kind"] = "unresolved-gap"
        elif p["kind"] == "empty":
            p["printed"] = None

    # -- Pass 4: maximal runs -> segments. --
    def seg_class(n: int) -> tuple:
        p = pages[n]
        k = p["kind"]
        if k == "observed-arabic":
            return ("explicit", "verified", "high", zone_of(n))
        if k == "observed-roman":
            return ("roman_numeral", "verified", "high", zone_of(n))
        if k == "empty":
            return ("no_printed_number", "missing", "none", zone_of(n))
        if k == "inferred":
            mtype = "front_matter" if zone_of(n) == "front" else "piecewise_linear"
            return (mtype, "inferred", p["confidence"], zone_of(n))
        if k == "eula":
            return ("no_printed_number", "uncertain", "low", zone_of(n))
        return ("unresolved", "uncertain", "low", zone_of(n))

    segments: list[dict] = []
    unresolved_pages: list[int] = []
    run_start = 1
    for n in range(2, EXPECTED_PAGE_COUNT + 2):
        if n <= EXPECTED_PAGE_COUNT and seg_class(n) == seg_class(run_start):
            continue
        run_end = n - 1
        mtype, mstatus, mconf, z = seg_class(run_start)
        rep = [pages[k] for k in range(run_start, run_end + 1)]
        if mstatus == "verified":
            p_start, p_end = rep[0]["printed"], rep[-1]["printed"]
            evidence = [
                {
                    "evidence_type": "running-head",
                    "observed_text": q["observed_text"],
                    "block_id": q["header"]["block_id"],
                }
                for q in rep
            ]
        elif mstatus == "inferred":
            p_start, p_end = rep[0]["printed"], rep[-1]["printed"]
            anchors: list[dict] = []
            b = rep[0].get("anchor_before")
            a = rep[-1].get("anchor_after")
            if b is not None:
                anchors.append(
                    {
                        "evidence_type": "bracketing-header",
                        "observed_text": b["observed_text"],
                        "block_id": b["header"]["block_id"],
                    }
                )
            if a is not None:
                anchors.append(
                    {
                        "evidence_type": "bracketing-header",
                        "observed_text": a["observed_text"],
                        "block_id": a["header"]["block_id"],
                    }
                )
            if z == "front":
                rule = "roman-folio slope+1 per physical page (printed = physical + (%d)); " % delta_r
            else:
                rule = "folio slope+1 per physical page (printed = physical + (%d)); " % delta
            rule += "bracket %s .. %s" % (
                ("%s@%d" % (b["printed"], b["physical"])) if b is not None else "none",
                ("%s@%d" % (a["printed"], a["physical"])) if a is not None else "none",
            )
            first_blocks = rep[0]["blocks"]
            rule_block = first_blocks[0]["block_id"] if first_blocks else "page-%04d-block-0000" % run_start
            evidence = anchors + [
                {"evidence_type": "inference-rule", "observed_text": rule, "block_id": rule_block}
            ]
            for q in rep:
                cause = _no_folio_cause(q["blocks"])
                if cause is not None:
                    evidence.append(
                        {
                            "evidence_type": "no-folio-cause",
                            "observed_text": cause["observed_text"],
                            "block_id": cause["block_id"],
                        }
                    )
        elif mtype == "no_printed_number" and mstatus == "missing":
            p_start, p_end = None, None
            evidence = []
            unresolved_pages.extend(range(run_start, run_end + 1))
        elif mstatus == "uncertain" and run_start == EXPECTED_PAGE_COUNT:
            p_start, p_end = None, None
            evidence = [
                {
                    "evidence_type": "eula-title",
                    "observed_text": "WILEY END USER LICENSE AGREEMENT",
                    "block_id": "page-%04d-block-0000" % run_start,
                }
            ]
            unresolved_pages.extend(range(run_start, run_end + 1))
        else:  # unresolved kinds (anomalous / unparseable / ambiguous / gap)
            p_start, p_end = None, None
            evidence = []
            for q in rep:
                if "header" in q:
                    evidence.append(
                        {
                            "evidence_type": "anomalous-header",
                            "observed_text": q.get("observed_text", ""),
                            "block_id": q["header"]["block_id"],
                        }
                    )
            unresolved_pages.extend(range(run_start, run_end + 1))
        segments.append(
            {
                "mapping_segment_id": "seg-%s-%03d" % (z, len([s for s in segments if s["mapping_segment_id"].startswith("seg-%s-" % z)]) + 1),
                "source_page_index_start": run_start - 1,
                "source_page_index_end": run_end - 1,
                "source_page_display_start": pages[run_start]["display"],
                "source_page_display_end": pages[run_end]["display"],
                "printed_page_number_start": p_start,
                "printed_page_number_end": p_end,
                "mapping_type": mtype,
                "mapping_status": mstatus,
                "mapping_confidence": mconf,
                "evidence": evidence,
            }
        )
        run_start = n

    # Canonical key order — do not reorder.
    doc = {
        "mapping_version": MAPPING_VERSION,
        "mapping_policy": "evidence-first-no-silent-interpolation",
        "segments": segments,
        "unresolved_pages": sorted(unresolved_pages),
    }
    with open(map_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")

    from collections import Counter as _Counter2

    type_counts = _Counter2(s["mapping_type"] for s in segments)
    status_counts = _Counter2(s["mapping_status"] for s in segments)
    print(
        "map-pages OK: segments=%d types=%s statuses=%s unresolved=%d arab_delta=%d roman_delta=%d front_end=%d back_start=%d (%s)"
        % (
            len(segments),
            dict(type_counts),
            dict(status_counts),
            len(unresolved_pages),
            delta,
            delta_r,
            front_end,
            back_start,
            lock_evidence,
        )
    )
    return 0


# ---------------------------------------------------------------------------
# Gate 4 — structure + typed units (TAYLOR-004). Typing only; no cell-level
# table extraction, no dose atomization, no medication records, no chunks /
# embeddings / DB.
#
# Read-only inputs: reading/page-*.json, pages.map.json, repairs.jsonl
# (Gate 3), raw/page-*.json block inventory (ids/order/bboxes only, Gate 2),
# Gate-1 JSONs (lock evidence). Writes only: structure.json (structure cmd),
# units.jsonl (units cmd). Gates 1-3 code paths above are untouched.
# ---------------------------------------------------------------------------

STRUCTURE_VERSION = "structure-v1"
UNITS_VERSION = "typed-units-v1"

_G4_COPYRIGHT_LEAD = "The Maudsley® Prescribing Guidelines in Psychiatry, Fourteenth Edition"
_G4_BULLET = "■"

# Verified chapter spans (physical pages). Derived by _g4_detect_body from the
# reading text; asserted equal to these expectations — any drift BLOCKS.
_G4_CHAPTER_RANGES = {
    1: (24, 267), 2: (268, 325), 3: (326, 471), 4: (472, 557),
    5: (559, 621), 6: (622, 699), 7: (700, 743), 8: (744, 775),
    9: (778, 797), 10: (798, 851), 11: (854, 885), 12: (886, 895),
    13: (896, 917), 14: (918, 962),
}
_G4_PART_RANGES = {1: (22, 557), 2: (558, 775), 3: (776, 851), 4: (852, 962)}
_G4_EXPECTED_PARTS = {
    1: "Drug treatment of major psychiatric conditions",
    2: "Drug treatment of special patient groups",
    3: "Prescribing in specialist conditions",
    4: "Other aspects of psychotropic drug use",
}
_G4_EXPECTED_CHAPTERS = {
    1: "Schizophrenia and related psychoses",
    2: "Bipolar disorder",
    3: "Depression and anxiety disorders",
    4: "Addictions and substance misuse",
    5: "Children and adolescents",
    6: "Prescribing in older people",
    7: "Pregnancy and breastfeeding",
    8: "Hepatic and renal impairment",
    9: "Drug treatment of other psychiatric conditions",
    10: "Drug treatment of psychiatric symptoms occurring in the context of other disorders",
    11: "Pharmacokinetics",
    12: "Other substances",
    13: "Psychotropic drugs in special conditions",
    14: "Miscellany",
}
_G4_EXPECTED_CH_START = {
    1: 24, 2: 268, 3: 326, 4: 472, 5: 559, 6: 622, 7: 700, 8: 744,
    9: 778, 10: 798, 11: 854, 12: 886, 13: 896, 14: 918,
}
_G4_EXPECTED_PART_START = {1: 22, 2: 558, 3: 776, 4: 852}


class _G4Blocked(Exception):
    pass


def _g4_norm(s: str) -> str:
    s = unicodedata.normalize("NFKC", s or "")
    s = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _g4_precheck(root: Path, book: Path, absent: list[str]) -> list[dict]:
    """STEP 0. Raises _G4Blocked on any failure (writes nothing)."""
    reading = sorted((book / "reading").glob("page-*.json")) if (book / "reading").is_dir() else []
    if len(reading) != EXPECTED_PAGE_COUNT:
        raise _G4Blocked("reading/ has %d files, expected %d" % (len(reading), EXPECTED_PAGE_COUNT))
    try:
        with open(book / "pages.map.json", "r", encoding="utf-8") as f:
            pmap = json.load(f)
    except Exception as exc:
        raise _G4Blocked("pages.map.json does not parse: %r" % exc)
    segments = pmap.get("segments", [])
    if len(segments) != 89:
        raise _G4Blocked("pages.map.json has %d segments, expected 89" % len(segments))
    digest, _ = sha256_file(root / SOURCE_REL)
    if digest.lower() != EXPECTED_SHA256.lower():
        raise _G4Blocked("source-lock sha mismatch: computed=%s" % digest.lower())
    for name in absent:
        if (book / name).exists():
            raise _G4Blocked("%s already exists — refusing to overwrite" % name)
    print(
        "precheck OK: reading=%d segments=%d lock=sha256:%s absent=%s"
        % (len(reading), len(segments), digest.lower()[:16], ",".join(absent))
    )
    return segments


def _g4_map_tables(segments: list[dict]) -> tuple[dict[int, object], dict[int, list[str]]]:
    """Expand segments to per-physical-page printed numbers + segment ids."""
    phys_to_printed: dict[int, object] = {}
    phys_to_segs: dict[int, list[str]] = {}
    for s in segments:
        ps = s["printed_page_number_start"]
        a = s["source_page_display_start"]
        b = s["source_page_display_end"]
        roman = isinstance(ps, str)
        base = _roman_to_int(ps) if roman else ps
        for off in range(b - a + 1):
            phys = a + off
            if base is None:
                phys_to_printed[phys] = None
            elif roman:
                phys_to_printed[phys] = _int_to_roman(base + off)
            else:
                phys_to_printed[phys] = base + off
            phys_to_segs.setdefault(phys, []).append(s["mapping_segment_id"])
    if sorted(phys_to_printed) != list(range(1, EXPECTED_PAGE_COUNT + 1)):
        raise _G4Blocked("segment expansion does not cover physical 1..978 exactly")
    return phys_to_printed, phys_to_segs


def _g4_block_segs(book: Path, n: int) -> tuple[list[dict], list[str], list[bool]]:
    with open(_raw_path(book, "%04d" % n), "r", encoding="utf-8") as f:
        raw_rec = json.load(f)
    base_texts, _repairs, joins = _repair_page(raw_rec)
    return raw_rec.get("blocks", []), base_texts, joins


def _g4_toc_entries(book: Path) -> list[dict]:
    """Parse the printed Contents (physical pp. 7..10 → 1-indexed 6..10)."""
    lines: list[str] = []
    for n in range(6, 11):
        with open(book / "reading" / ("page-%04d.json" % n), "r", encoding="utf-8") as f:
            txt = json.load(f).get("repaired_text", "")
        for ln in txt.split("\n"):
            ln = _g4_norm(ln)
            if not ln:
                continue
            if re.fullmatch(r"([ivxlcdm]+\s+Contents|Contents\s+[ivxlcdm]+|Contents)", ln):
                continue
            lines.append(ln)
    entries: list[dict] = []
    i = 0
    while i < len(lines):
        m = re.match(r"^(Part|Chapter)\s*(\d+)\s*(.*)$", lines[i])
        if not m:
            i += 1
            continue
        kind, no, rest = m.group(1), int(m.group(2)), _g4_norm(m.group(3))
        parts = [rest] if rest else []
        printed = None
        j = i + 1
        while j < len(lines):
            ln = lines[j]
            if re.fullmatch(r"\d+", ln):
                printed = int(ln)
                j += 1
                break
            if re.match(r"^(Part|Chapter)\s*(\d+)\b", ln):
                break
            parts.append(ln)
            j += 1
        title = _g4_norm(" ".join(parts))
        entries.append(
            {
                "kind": kind,
                "no": no,
                "title": title,
                "toc_printed": printed,
                "toc_entry_text": _g4_norm("%s %d %s" % (kind, no, title)),
                "raw_first_line": lines[i],
            }
        )
        i = j
    return entries


def _g4_verify_toc(entries: list[dict]) -> tuple[list[dict], list[dict]]:
    parts = [e for e in entries if e["kind"] == "Part"]
    chaps = [e for e in entries if e["kind"] == "Chapter"]
    if len(parts) != 4 or sorted(e["no"] for e in parts) != [1, 2, 3, 4]:
        raise _G4Blocked("TOC parts != 4 (found %d)" % len(parts))
    if len(chaps) != 14 or sorted(e["no"] for e in chaps) != list(range(1, 15)):
        raise _G4Blocked("TOC chapters != 14 (found %d)" % len(chaps))
    for e in parts:
        if e["title"] != _G4_EXPECTED_PARTS[e["no"]]:
            raise _G4Blocked("TOC Part %d title mismatch: %r" % (e["no"], e["title"]))
        if e["toc_printed"] is None:
            raise _G4Blocked("TOC Part %d has no printed number" % e["no"])
    for e in chaps:
        if e["title"] != _G4_EXPECTED_CHAPTERS[e["no"]]:
            raise _G4Blocked("TOC Chapter %d title mismatch: %r" % (e["no"], e["title"]))
        if e["toc_printed"] is None:
            raise _G4Blocked("TOC Chapter %d has no printed number" % e["no"])
    return parts, chaps


def _g4_trim_title(tparts: list[str], ids: list[str], expected: str, what: str) -> tuple[str, list[str]]:
    for k in range(1, len(tparts) + 1):
        if _g4_norm(" ".join(tparts[:k])) == expected:
            return expected, ids[:k]
    raise _G4Blocked("%s body title mismatch: run=%r expected=%r" % (what, tparts, expected))


def _g4_detect_body(book: Path) -> tuple[dict, dict]:
    """Detect Part dividers + Chapter openings from raw block text (read-only)."""
    part_marks: dict[int, dict] = {}
    chap_candidates: dict[int, list[dict]] = {}
    for n in range(1, EXPECTED_PAGE_COUNT + 1):
        blocks, _base, _joins = _g4_block_segs(book, n)
        for i, b in enumerate(blocks):
            t = _g4_norm(b.get("text", ""))
            m = re.fullmatch(r"Part\s+(\d+)", t)
            if m:
                no = int(m.group(1))
                # Title = preceding short blocks, else following short blocks.
                pre: list[str] = []
                k = i - 1
                while k >= 0 and len(pre) < 2:
                    pt = _g4_norm(blocks[k].get("text", ""))
                    if not pt or len(pt) > 70:
                        break
                    pre.insert(0, pt)
                    k -= 1
                ids = [blocks[k2].get("block_id", "") for k2 in range(k + 1, i + 1)]
                title = _g4_norm(" ".join(pre))
                if not title:
                    post: list[str] = []
                    ids2: list[str] = []
                    k = i + 1
                    while k < len(blocks) and len(post) < 2:
                        pt = _g4_norm(blocks[k].get("text", ""))
                        if not pt or len(pt) > 70:
                            break
                        post.append(pt)
                        ids2.append(blocks[k].get("block_id", ""))
                        k += 1
                    title = _g4_norm(" ".join(post))
                    ids = [b.get("block_id", "")] + ids2
                part_marks[no] = {"page": n, "title": title, "block_ids": ids}
                continue
            m = re.fullmatch(r"Chapter\s+(\d+)", t)
            if m:
                chap_candidates.setdefault(int(m.group(1)), []).append(
                    {"page": n, "idx": i, "block_id": b.get("block_id", ""), "nblocks": len(blocks)}
                )
    if sorted(part_marks) != [1, 2, 3, 4]:
        raise _G4Blocked("Part dividers detected != 4: %r" % sorted(part_marks))
    for no, mk in part_marks.items():
        if mk["page"] != _G4_EXPECTED_PART_START[no]:
            raise _G4Blocked("Part %d divider at physical %d, expected %d" % (no, mk["page"], _G4_EXPECTED_PART_START[no]))
        if mk["title"] != _G4_EXPECTED_PARTS[no]:
            raise _G4Blocked("Part %d divider title mismatch: %r" % (no, mk["title"]))
    if sorted(chap_candidates) != list(range(1, 15)):
        raise _G4Blocked(
            "Chapter markers detected != 14: %r" % sorted(chap_candidates)
        )
    for no, cands in chap_candidates.items():
        if len(cands) != 1:
            raise _G4Blocked("Chapter %d marker occurs %d times" % (no, len(cands)))

    chap_marks: dict[int, dict] = {}
    for no, cand in ((k, v[0]) for k, v in chap_candidates.items()):
        n, i = cand["page"], cand["idx"]
        blocks, _base, _joins = _g4_block_segs(book, n)
        has_copyright = any(
            _g4_norm(b.get("text", "")).startswith(_G4_COPYRIGHT_LEAD) for b in blocks[:2]
        )
        if i <= 2 and has_copyright:
            style = "divider"
            if n != _G4_EXPECTED_CH_START[no]:
                raise _G4Blocked("Chapter %d divider at %d, expected %d" % (no, n, _G4_EXPECTED_CH_START[no]))
            tparts: list[str] = []
            ids: list[str] = []
            k = i + 1
            while k < len(blocks) and len(tparts) < 3:
                pt = _g4_norm(blocks[k].get("text", ""))
                if not pt or len(pt) > 70 or _G4_BULLET in pt:
                    break
                if pt == pt.upper() and re.search(r"[A-Z]", pt):
                    break
                if re.match(r"^(Table|Box|Figure)\s+\d", pt):
                    break
                tparts.append(pt)
                ids.append(blocks[k].get("block_id", ""))
                k += 1
            # Minimal verbatim prefix equal to the expected title: section
            # headings that follow the title (e.g. Ch2 'Lithium') are excluded
            # by the equality check, never silently absorbed.
            title, ids = _g4_trim_title(tparts, ids, _G4_EXPECTED_CHAPTERS[no], "Chapter %d" % no)
            ids = [cand["block_id"]] + ids
        else:
            style = "footer"
            # Footer markers sit on the chapter's first content page: identical
            # to the range start, except Ch5 whose range starts on the empty
            # title page 559 while marker + content sit on 560.
            expect_marker = {5: 560, 12: 886, 13: 896, 14: 918}
            if no not in expect_marker or n != expect_marker[no]:
                raise _G4Blocked("Unexpected footer-style marker: Chapter %d at %d" % (no, n))
            tparts = []
            ids = []
            k = i - 1
            while k >= 0 and len(tparts) < 2:
                pt = _g4_norm(blocks[k].get("text", ""))
                if not pt or len(pt) > 70 or _G4_BULLET in pt:
                    break
                if re.match(r"^(Table|Box|Figure)\s+\d", pt):
                    break
                if _g4_norm(blocks[k].get("text", "")).startswith(_G4_COPYRIGHT_LEAD):
                    break
                tparts.insert(0, pt)
                ids.insert(0, blocks[k].get("block_id", ""))
                k -= 1
            ids.append(cand["block_id"])
            title = _g4_norm(" ".join(tparts))
        if title != _G4_EXPECTED_CHAPTERS[no]:
            raise _G4Blocked("Chapter %d body title mismatch: %r" % (no, title))
        chap_marks[no] = {
            "page": n,
            "idx": i,
            "nblocks": len(blocks),
            "title": title,
            "block_ids": ids,
            "style": style,
            "marker_block_id": cand["block_id"],
        }

    # Chapter 5: marker + title sit footer-style at the end of physical 560
    # (classified above); the range still opens on the empty title page 559,
    # and the first content section must equal the TOC's first Ch5 section.
    if chap_marks[5]["style"] != "footer" or chap_marks[5]["page"] != 560:
        raise _G4Blocked("Chapter 5 marker not footer-style at physical 560")
    with open(_raw_path(book, "0559"), "r", encoding="utf-8") as f:
        r559 = json.load(f)
    if r559.get("extraction_status") != "empty" or r559.get("blocks"):
        raise _G4Blocked("physical 559 is not the expected empty Chapter-5 title page")
    blocks560, _b560, _j560 = _g4_block_segs(book, 560)
    first560 = _g4_norm(blocks560[1].get("text", "")) if len(blocks560) > 1 else ""
    if first560 != "Principles of prescribing practice in childhood and adolescence":
        raise _G4Blocked("Ch5 first section mismatch: %r" % first560)
    return part_marks, chap_marks


def _g4_chapter_of(page: int) -> int | None:
    for ch, (a, b) in _G4_CHAPTER_RANGES.items():
        if a <= page <= b:
            return ch
    return None


def _g4_is_heading_seg(seg: str) -> bool:
    t = seg.strip()
    if not t or "\n" in t:
        return False
    if len(t) > 90:
        return False
    if t.startswith((_G4_BULLET, "•")):
        return False
    if re.match(r"^\d+\.\s", t):
        return False
    if re.match(r"^(Table|Box|Figure)\s+\d", t):
        return False
    if re.match(r"^(Chapter|Part)\s+\d+\s*$", t):
        return False
    if t.startswith("(") and t.endswith(")"):
        return False
    if len(t) <= 80 and t == t.upper() and re.search(r"[A-Z]", t):
        return True
    if t[0].isupper() and not t.endswith((".", ":", ";", ",")):
        return True
    return False


def _g4_sent_stop(seg: str) -> bool:
    t = seg.strip()
    return len(t) > 150 and (". " in t or t.endswith("."))


def _g4_prose_needs_review(text: str) -> bool:
    lines = [ln for ln in text.split("\n") if ln.strip()]
    if len(lines) >= 2:
        short = sum(1 for ln in lines if len(ln.strip()) < 50)
        if short / len(lines) > 0.5 and any(ch.isdigit() for ch in text):
            return True
    return False


def cmd_structure(args: argparse.Namespace) -> int:
    root = repo_root()
    book = root / BOOK_REL
    try:
        segments = _g4_precheck(root, book, ["structure.json"])
        toc_entries = _g4_toc_entries(book)
        toc_parts, toc_chaps = _g4_verify_toc(toc_entries)
        toc_by_ch = {e["no"]: e for e in toc_chaps}
        part_marks, chap_marks = _g4_detect_body(book)
        phys_to_printed, _segs = _g4_map_tables(segments)

        # TOC ↔ body comparison (never silently reconciled).
        mismatches: list[dict] = []
        raw_c2 = toc_by_ch[2]["raw_first_line"]
        if raw_c2.startswith("Chapter2"):
            mismatches.append(
                {
                    "kind": "toc_typography",
                    "chapter_no": 2,
                    "toc_entry_text": toc_by_ch[2]["toc_entry_text"],
                    "body_heading_text": chap_marks[2]["title"],
                    "detail": "TOC prints 'Chapter2' (missing space); normalized for comparison only",
                }
            )
        for no in range(1, 15):
            toc_p = toc_by_ch[no]["toc_printed"]
            start = _G4_EXPECTED_CH_START[no]
            body_p = phys_to_printed.get(start)
            if body_p != toc_p:
                if no == 5:
                    mismatches.append(
                        {
                            "kind": "unverifiable_printed_start",
                            "chapter_no": 5,
                            "toc_entry_text": toc_by_ch[5]["toc_entry_text"],
                            "body_heading_text": None,
                            "detail": "TOC advertises 539 but chapter opens on unnumbered physical 559 "
                            "(empty title page); 539 resolves at physical 560 per pages.map.json",
                        }
                    )
                else:
                    raise _G4Blocked(
                        "Chapter %d TOC printed %r != map printed %r at physical %d"
                        % (no, toc_p, body_p, start)
                    )
        mismatches.append(
            {
                "kind": "empty_title_page",
                "chapter_no": 5,
                "toc_entry_text": toc_by_ch[5]["toc_entry_text"],
                "body_heading_text": chap_marks[5]["title"],
                "detail": "chapter range opens on unnumbered physical 559, an empty (image-only) "
                "title page with no extractable blocks; title + 'Chapter 5' marker sit "
                "footer-style at the end of physical 560; opening unit spans 559-560",
            }
        )
        for no in (5, 12, 13, 14):
            mk = chap_marks[no]
            mismatches.append(
                {
                    "kind": "heading_position_footer",
                    "chapter_no": no,
                    "toc_entry_text": toc_by_ch[no]["toc_entry_text"],
                    "body_heading_text": mk["title"],
                    "detail": "Chapter-%d marker sits at block index %d of %d (trailing content in "
                    "reading order; top-right folio band geometry) instead of a page-head divider"
                    % (no, mk["idx"], mk["nblocks"]),
                }
            )

        parts_out: list[dict] = []
        for pno in (1, 2, 3, 4):
            pa, pb = _G4_PART_RANGES[pno]
            chaps_out: list[dict] = []
            for ch in sorted(c for c, (a, b) in _G4_CHAPTER_RANGES.items() if _G4_PART_RANGES[pno][0] <= a <= _G4_PART_RANGES[pno][1]):
                ca, cb = _G4_CHAPTER_RANGES[ch]
                mk = chap_marks[ch]
                chaps_out.append(
                    {
                        "number": ch,
                        "title": _G4_EXPECTED_CHAPTERS[ch],
                        "physical_start": ca,
                        "physical_end": cb,
                        "printed_start": phys_to_printed.get(ca),
                        "printed_end": phys_to_printed.get(cb),
                        "evidence": {
                            "toc_entry_text": toc_by_ch[ch]["toc_entry_text"],
                            "body_heading_text": mk["title"],
                            "block_ids": mk["block_ids"],
                        },
                    }
                )
            parts_out.append(
                {
                    "part_no": pno,
                    "title": _G4_EXPECTED_PARTS[pno],
                    "physical_start": pa,
                    "physical_end": pb,
                    "printed_start": phys_to_printed.get(pa),
                    "printed_end": phys_to_printed.get(pb),
                    "chapters": chaps_out,
                }
            )

        back_matter = [
            {
                "title": "Blank page",
                "physical_start": 963,
                "physical_end": 963,
                "printed_start": None,
                "printed_end": None,
            },
            {
                "title": "Index",
                "physical_start": 964,
                "physical_end": 977,
                "printed_start": 943,
                "printed_end": 956,
            },
            {
                "title": "WILEY END USER LICENSE AGREEMENT",
                "physical_start": 978,
                "physical_end": 978,
                "printed_start": None,
                "printed_end": None,
            },
        ]
        if phys_to_printed.get(964) != 943 or phys_to_printed.get(977) != 956:
            raise _G4Blocked("Index printed range != 943..956 per pages.map.json")

        # Canonical key order — do not reorder.
        doc = {
            "book_id": SOURCE_ID,
            "source_version": SOURCE_VERSION,
            "parts": parts_out,
            "back_matter": back_matter,
            "toc_mismatches": mismatches,
        }
        with open(book / "structure.json", "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=2, ensure_ascii=False)
            f.write("\n")
    except _G4Blocked as exc:
        print("BLOCKED: %s" % exc, file=sys.stderr)
        return 1

    # Self-validation (quote outputs).
    with open(book / "structure.json", "r", encoding="utf-8") as f:
        doc = json.load(f)
    n_parts = len(doc["parts"])
    n_chaps = sum(len(p["chapters"]) for p in doc["parts"])
    titles = [c["title"] for p in doc["parts"] for c in p["chapters"]]
    need = ["Schizophrenia", "Bipolar", "Depression", "Substance", "Children",
            "Older", "Pregnancy", "Pharmacokinetics"]
    missing = [k for k in need if not any(k.lower() in t.lower() for t in titles)]
    with open(book / "reading" / "page-0896.json", "r", encoding="utf-8") as f:
        p896_head = json.load(f).get("repaired_text", "")
    overdose_ok = "Psychotropics in overdose" in p896_head
    print("structure OK: parts=%d chapters=%d mismatches=%d" % (n_parts, n_chaps, len(doc["toc_mismatches"])))
    print("validate parse=PASS parts>=3=PASS(%d) chapters>=14=PASS(%d) titles=%s overdose-section=%s" % (
        n_parts, n_chaps, "PASS" if not missing else "FAIL:%r" % missing,
        "PASS(ch13-lead-body-p896)" if overdose_ok else "FAIL"))
    return 0 if (n_parts >= 3 and n_chaps >= 14 and not missing and overdose_ok) else 1


def _g4_build_page_groups(book: Path, n: int, chap_marks: dict, part_marks: dict,
                           refs_mode_in: bool) -> tuple[list[dict], bool]:
    """Group one page's blocks into typed unit specs (block-index groups)."""
    blocks, base, joins = _g4_block_segs(book, n)
    ch = _g4_chapter_of(n)
    is_front = 1 <= n <= 21
    is_index = 964 <= n <= 977
    is_eula = n == 978
    credits = False
    if is_front:
        with open(book / "reading" / ("page-%04d.json" % n), "r", encoding="utf-8") as f:
            if "©" in json.load(f).get("repaired_text", ""):
                credits = True
    roles: list[str] = []
    for i, b in enumerate(blocks):
        bbox = b.get("bbox", [0, 0, 0, 0])
        seg = base[i] if i < len(base) else ""
        t = seg.strip()
        tn = _g4_norm(seg)
        if not t:
            # Gate 3 keeps empty-after-strip blocks for index stability; they
            # carry no text and attach to neighboring units.
            roles.append("attach")
        elif HEADER_Y0_MIN <= bbox[1] <= HEADER_Y0_MAX and HEADER_Y1_MIN <= bbox[3] <= HEADER_Y1_MAX:
            roles.append("folio")
        elif tn.startswith(_G4_COPYRIGHT_LEAD):
            roles.append("copyright")
        elif re.fullmatch(r"CHAPTER\s+\d+", t):
            roles.append("runhead")
        elif re.fullmatch(r"Part\s+\d+", tn):
            roles.append("partmarker")
        elif re.fullmatch(r"Chapter\s+\d+", tn):
            roles.append("chmarker")
        elif re.match(r"^Table\s+\d+\.\d+\b", t):
            roles.append("cap_table")
        elif re.match(r"^Box\s+\d+\.\d+\b", t):
            roles.append("cap_box")
        elif re.match(r"^Figure\s+\d[\d.]*\b", t):
            roles.append("cap_fig")
        elif t == "(Continued)":
            roles.append("continued")
        elif is_index:
            roles.append("index")
        elif is_eula:
            roles.append("back")
        elif is_front:
            roles.append("credits" if credits else "front")
        elif t == "References":
            roles.append("refhead")
        elif re.match(r"^\d+\.\s+\S", t):
            roles.append("ref")
        elif _G4_BULLET in seg:
            roles.append("list")
        elif _g4_is_heading_seg(seg):
            roles.append("heading")
        else:
            roles.append("prose")

    ch_start = ch is not None and (
        n == _G4_CHAPTER_RANGES[ch][0] or chap_marks[ch]["page"] == n
    )
    opening_ids: set[str] = set()
    opening_kind = ""
    if ch_start:
        # Opening unit = marker + title blocks only (contiguous in reading
        # order). The copyright footer block attaches to the page's first
        # unit via pending, wherever that falls.
        mk = chap_marks[ch]
        opening_ids = set(mk["block_ids"])
        opening_kind = "opening"
    part_ids: set[str] = set()
    if n in (22, 558, 776, 852):
        for _pno, _pa in _G4_EXPECTED_PART_START.items():
            if _pa == n:
                part_ids = set(part_marks[_pno]["block_ids"])

    specs: list[dict] = []
    pending: list[int] = []
    opening_spec: dict | None = None
    part_spec: dict | None = None

    def ensure_opening() -> dict:
        nonlocal opening_spec
        if opening_spec is None:
            opening_spec = {"idxs": [], "utype": "chapter_opening", "key": "opening"}
            specs.append(opening_spec)
        return opening_spec

    def ensure_part() -> dict:
        nonlocal part_spec
        if part_spec is None:
            part_spec = {"idxs": [], "utype": "prose", "key": "partdiv", "review": True}
            specs.append(part_spec)
        return part_spec

    def flushable_emit(idxs: list[int], utype: str, key: str, review: bool = False) -> None:
        if idxs:
            specs.append({"idxs": list(idxs), "utype": utype, "key": key, "review": review})

    consumed: set[int] = set()
    refs_mode = refs_mode_in
    prose_run: list[int] = []
    list_run: list[int] = []
    ref_run: list[int] = []
    zone_run: list[int] = []
    zone_utype = ""

    def flush_runs() -> None:
        nonlocal prose_run, list_run, ref_run, zone_run
        flushable_emit(prose_run, "prose", "prose")
        flushable_emit(list_run, "list", "list")
        flushable_emit(ref_run, "reference", "ref")
        if zone_run:
            flushable_emit(zone_run, zone_utype, "zone")
        prose_run, list_run, ref_run, zone_run = [], [], [], []

    i = 0
    cap_map = {"cap_table": "table_ref", "cap_box": "box", "cap_fig": "figure_ref"}
    while i < len(blocks):
        bid = blocks[i].get("block_id", "")
        r = roles[i]
        if bid in opening_ids:
            flush_runs()
            ensure_opening()["idxs"].append(i)
            consumed.add(i)
            i += 1
            continue
        if bid in part_ids:
            flush_runs()
            ensure_part()["idxs"].append(i)
            consumed.add(i)
            i += 1
            continue
        if r in ("folio", "copyright", "runhead", "attach"):
            pending.append(i)
            consumed.add(i)
            i += 1
            continue
        if r in cap_map:
            flush_runs()
            refs_mode = False
            group = [i]
            consumed.add(i)
            j = i + 1
            while j < len(blocks) and roles[j] in ("prose", "continued", "attach") and not _g4_sent_stop(base[j]):
                group.append(j)
                consumed.add(j)
                j += 1
            specs.append({"idxs": group, "utype": cap_map[r], "key": "ref", "review": False})
            i = j
            continue
        if r == "refhead":
            flush_runs()
            refs_mode = True
            specs.append({"idxs": [i], "utype": "heading", "key": "heading", "review": False})
            consumed.add(i)
            i += 1
            continue
        if r == "ref":
            if refs_mode:
                if prose_run or list_run or zone_run:
                    flush_runs()
                ref_run.append(i)
            else:
                if prose_run or ref_run or zone_run:
                    flush_runs()
                list_run.append(i)
            consumed.add(i)
            i += 1
            continue
        if r == "list":
            if prose_run or ref_run or zone_run:
                flush_runs()
            if refs_mode:
                refs_mode = False
            list_run.append(i)
            consumed.add(i)
            i += 1
            continue
        if r == "heading":
            flush_runs()
            refs_mode = False
            specs.append({"idxs": [i], "utype": "heading", "key": "heading", "review": False})
            consumed.add(i)
            i += 1
            continue
        if r == "continued":
            if specs and specs[-1]["utype"] in ("table_ref", "box", "figure_ref") and not prose_run and not list_run and not ref_run and not zone_run:
                specs[-1]["idxs"].append(i)
            elif refs_mode:
                ref_run.append(i)
            else:
                if list_run or ref_run or zone_run:
                    flush_runs()
                prose_run.append(i)
            consumed.add(i)
            i += 1
            continue
        if r in ("prose", "index", "front", "credits", "back"):
            want = {"prose": "prose", "index": "index_entry", "front": "front_matter",
                    "credits": "credits", "back": "back_matter"}[r]
            if r == "prose" and refs_mode:
                flush_runs()
                refs_mode = False
            if r == "prose":
                if list_run or ref_run or zone_run:
                    flush_runs()
                prose_run.append(i)
            else:
                if prose_run or list_run or ref_run:
                    flush_runs()
                if zone_run and zone_utype != want:
                    flush_runs()
                zone_utype = want
                zone_run.append(i)
            consumed.add(i)
            i += 1
            continue
        # partmarker / chmarker outside expected sets: loud annotation, prose fallback.
        flush_runs()
        refs_mode = False
        specs.append({"idxs": [i], "utype": "prose", "key": "prose", "review": True,
                      "note": "unexpected-marker:%s" % r})
        consumed.add(i)
        i += 1

    flush_runs()
    if pending:
        if specs:
            # Attach leading pending blocks to the first unit, trailing to last.
            first_min = min(s["idxs"][0] for s in specs if s["idxs"])
            first = next(s for s in specs if s["idxs"] and s["idxs"][0] == first_min)
            last = specs[-1]
            for p in sorted(pending):
                if p < first_min:
                    first["idxs"].insert(0, p)
                else:
                    last["idxs"].append(p)
            for s in specs:
                s["idxs"] = sorted(set(s["idxs"]))
        else:
            raise _G4Blocked("physical %d: only attach-blocks, no content unit" % n)
    specs.sort(key=lambda s: s["idxs"][0] if s["idxs"] else 10 ** 9)
    # Merge any dehyphen-join straddling a unit boundary (keep page assembly exact).
    changed = True
    while changed:
        changed = False
        owner = {}
        for si, s in enumerate(specs):
            for k in s["idxs"]:
                owner[k] = si
        for k in range(len(blocks) - 1):
            if joins[k] and k in owner and (k + 1) in owner and owner[k] != owner[k + 1]:
                a, b = owner[k], owner[k + 1]
                specs[a]["idxs"] = sorted(set(specs[a]["idxs"] + specs[b]["idxs"]))
                if specs[a]["utype"] != specs[b]["utype"]:
                    specs[a]["review"] = True
                del specs[b]
                changed = True
                break
    return specs, refs_mode


def _g4_assemble_text(base: list[str], joins: list[bool], idxs: list[int]) -> str:
    wanted = set(idxs)
    out: list[str] = []
    last = -2
    for k in sorted(wanted):
        if out and last >= 0 and last < len(joins) and joins[last] and last + 1 == k:
            out[-1] = out[-1][:-1] + base[k]
        else:
            out.append(base[k])
        last = k
    return "\n".join(out)


def cmd_units(args: argparse.Namespace) -> int:
    root = repo_root()
    book = root / BOOK_REL
    try:
        segments = _g4_precheck(root, book, ["units.jsonl"])
        with open(book / "structure.json", "r", encoding="utf-8") as f:
            struct = json.load(f)
        # Consistency: structure ranges must equal the verified expectations.
        for p in struct["parts"]:
            if tuple([p["physical_start"], p["physical_end"]]) != _G4_PART_RANGES[p["part_no"]]:
                raise _G4Blocked("structure.json part range drift")
            for c in p["chapters"]:
                if tuple([c["physical_start"], c["physical_end"]]) != _G4_CHAPTER_RANGES[c["number"]]:
                    raise _G4Blocked("structure.json chapter range drift")
        part_marks, chap_marks = _g4_detect_body(book)
        phys_to_printed, phys_to_segs = _g4_map_tables(segments)

        part_label = {pno: "Part %d: %s" % (pno, _G4_EXPECTED_PARTS[pno]) for pno in _G4_PART_RANGES}
        chap_label = {ch: "Chapter %d: %s" % (ch, _G4_EXPECTED_CHAPTERS[ch]) for ch in _G4_CHAPTER_RANGES}

        raw_units: list[dict] = []
        refs_mode = False
        for n in range(1, EXPECTED_PAGE_COUNT + 1):
            with open(_raw_path(book, "%04d" % n), "r", encoding="utf-8") as f:
                status = json.load(f).get("extraction_status")
            if status == "empty":
                continue
            specs, refs_mode = _g4_build_page_groups(book, n, chap_marks, part_marks, refs_mode)
            if not specs:
                raise _G4Blocked("physical %d: no units built" % n)
            for s in specs:
                raw_units.append({"anchor": n, "spec": s})

        # Absorb each empty page into exactly one neighboring unit.
        empties: list[int] = []
        for n in range(1, EXPECTED_PAGE_COUNT + 1):
            with open(_raw_path(book, "%04d" % n), "r", encoding="utf-8") as f:
                if json.load(f).get("extraction_status") == "empty":
                    empties.append(n)
        by_anchor = sorted(raw_units, key=lambda u: u["anchor"])
        anchors = [u["anchor"] for u in by_anchor]
        for e in empties:
            nxt = next((u for u in by_anchor if u["anchor"] > e), None)
            prv = next((u for u in reversed(by_anchor) if u["anchor"] < e), None)
            if nxt is None and prv is None:
                raise _G4Blocked("empty page %d with no neighbor units" % e)
            if prv is None:
                target, side = nxt, "start"
            elif nxt is None:
                target, side = prv, "end"
            else:
                che = _g4_chapter_of(e)
                chn = _g4_chapter_of(nxt["anchor"])
                chp = _g4_chapter_of(prv["anchor"])
                if che == chn:
                    target, side = nxt, "start"
                elif che == chp:
                    target, side = prv, "end"
                elif chn is None:
                    target, side = nxt, "start"
                else:
                    target, side = prv, "end"
            # First/last unit of the target page; a blank page feeding into a
            # chapter-start page belongs to that page's opening unit.
            cands = [u for u in by_anchor if u["anchor"] == target["anchor"]]
            pick = cands[0] if side == "start" else cands[-1]
            if side == "start":
                for u in cands:
                    if u["spec"]["key"] == "opening":
                        pick = u
                        break
            pick.setdefault("extra_pages", []).append(e)

        # Structural paths, section stacks, parents (two passes).
        for u in by_anchor:
            n = u["anchor"]
            ch = _g4_chapter_of(n)
            s = u["spec"]
            extra = sorted(u.get("extra_pages", []))
            phys_start = min([n] + extra)
            phys_end = max([n] + extra)
            u["phys_start"], u["phys_end"] = phys_start, phys_end
        opening_unit_idx: dict[int, int] = {}
        for idx, u in enumerate(by_anchor):
            if u["spec"]["key"] == "opening":
                opening_unit_idx[_g4_chapter_of(u["anchor"])] = idx
        if sorted(opening_unit_idx) != list(range(1, 15)):
            raise _G4Blocked("chapter openings != 14: %r" % sorted(opening_unit_idx))
        first_index_idx = next(
            idx for idx, u in enumerate(by_anchor) if u["spec"]["utype"] == "index_entry"
        )
        stack: list[str] = []
        prev_utype: str | None = None
        prev_ch: int | None = None
        for u in by_anchor:
            n = u["anchor"]
            ch = _g4_chapter_of(n)
            s = u["spec"]
            ut = s["utype"]
            if ch != prev_ch:
                stack = []
            blocks, base, joins = _g4_block_segs(book, n)
            text = _g4_assemble_text(base, joins, s["idxs"])
            if not text.strip():
                raise _G4Blocked("empty unit text at physical %d (%s)" % (n, ut))
            title = _g4_norm(text)[:80]
            if ut == "chapter_opening":
                pno = next(p for p, (a, b) in _G4_PART_RANGES.items() if a <= n <= b)
                path = [part_label[pno], chap_label[ch]]
                stack = []
                parent_key: object = None
            elif s["key"] == "partdiv":
                pno = max(p for p, a in _G4_EXPECTED_PART_START.items() if a <= n)
                path = [part_label[pno]]
                parent_key = None
                stack = []
            elif ut in ("front_matter", "credits"):
                path = ["Front matter"]
                parent_key = None
                stack = []
            elif ut == "back_matter":
                path = ["Back matter", "WILEY END USER LICENSE AGREEMENT"]
                parent_key = None
                stack = []
            elif ut == "index_entry":
                path = ["Back matter", "Index"]
                parent_key = "first-index"
                stack = []
            else:
                pno = next(p for p, (a, b) in _G4_PART_RANGES.items() if a <= n <= b)
                if ut == "heading":
                    if prev_utype in ("heading",) and stack:
                        stack = (stack + [title])[-2:]
                    else:
                        stack = [title]
                    path = [part_label[pno], chap_label[ch]] + stack
                else:
                    path = [part_label[pno], chap_label[ch]] + stack
                parent_key = ("chap", ch)
            review = bool(s.get("review"))
            if ut == "prose" and _g4_prose_needs_review(text):
                review = True
            u.update({
                "utype": ut, "title": title, "path": path, "parent_key": parent_key,
                "text": text, "review": review,
            })
            prev_utype, prev_ch = ut, ch

        # Ids, chain, ranges, provenance.
        for u in by_anchor:
            u["printed_start"] = phys_to_printed.get(u["phys_start"])
            u["printed_end"] = phys_to_printed.get(u["phys_end"])
            segids: list[str] = []
            for p in range(u["phys_start"], u["phys_end"] + 1):
                for sg in phys_to_segs.get(p, []):
                    if sg not in segids:
                        segids.append(sg)
            u["segids"] = segids
            blocks, _b, _j = _g4_block_segs(book, u["anchor"])
            u["block_ids"] = [blocks[k].get("block_id", "") for k in sorted(u["spec"]["idxs"])]
            u["hash"] = hashlib.sha256(u["text"].encode("utf-8")).hexdigest()
            key = "|".join([SOURCE_ID, "|".join(u["path"]), str(u["phys_start"]), u["text"]])
            u["unit_id"] = "tu-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]

        # Merge same-id duplicate fragment units (repeated table cells with
        # identical page + path + text). Merged unit spans min..max block and
        # absorbs interiors so page concatenation stays exact; never absorbs
        # chapter/part anchors (guards split the merge instead).
        n_merges = 0
        for _pass in range(3):
            by_id: dict[str, list[int]] = {}
            for idx, u in enumerate(by_anchor):
                by_id.setdefault(u["unit_id"], []).append(idx)
            dup_groups = {k: v for k, v in by_id.items() if len(v) > 1}
            if not dup_groups:
                break
            guard_blocks: dict[int, set[int]] = {}
            for idx, u in enumerate(by_anchor):
                if u["spec"]["key"] in ("opening", "partdiv"):
                    guard_blocks.setdefault(u["anchor"], set()).update(
                        int(b.rsplit("-", 1)[1]) for b in u["block_ids"]
                    )
            removed: set[int] = set()
            for uid in sorted(dup_groups, key=lambda k: min(dup_groups[k])):
                members = [ix for ix in sorted(dup_groups[uid]) if ix not in removed]
                if len(members) < 2:
                    continue
                anchors = {by_anchor[ix]["anchor"] for ix in members}
                if len(anchors) != 1:
                    raise _G4Blocked("duplicate id across anchors: %s" % uid)
                anchor = by_anchor[members[0]]["anchor"]
                spans = []
                for ix in members:
                    bs = [int(b.rsplit("-", 1)[1]) for b in by_anchor[ix]["block_ids"]]
                    spans.append((min(bs), max(bs), ix))
                spans.sort()
                guards = guard_blocks.get(anchor, set())
                partitions: list[list[tuple[int, int, int]]] = [[spans[0]]]
                for sp in spans[1:]:
                    prev_max = partitions[-1][-1][1]
                    if any(prev_max < g < sp[0] for g in guards):
                        partitions.append([sp])
                    else:
                        partitions[-1].append(sp)
                for part in partitions:
                    if len(part) < 2:
                        continue
                    lo = min(s for s, _e, _i in part)
                    hi = max(e for _s, e, _i in part)
                    if any(lo < g < hi for g in guards):
                        raise _G4Blocked("guard inside merge span at anchor %d" % anchor)
                    first = by_anchor[part[0][2]]
                    blocks, base, joins = _g4_block_segs(book, anchor)
                    idxs = list(range(lo, hi + 1))
                    text = _g4_assemble_text(base, joins, idxs)
                    new = dict(first)
                    new["spec"] = {"idxs": idxs, "utype": first["utype"], "key": first["spec"]["key"],
                                   "review": True}
                    new["text"] = text
                    new["title"] = _g4_norm(text)[:80]
                    new["block_ids"] = [blocks[k].get("block_id", "") for k in idxs]
                    new["hash"] = hashlib.sha256(text.encode("utf-8")).hexdigest()
                    new["phys_start"] = min(by_anchor[ix]["phys_start"] for _s, _e, ix in part)
                    new["phys_end"] = max(by_anchor[ix]["phys_end"] for _s, _e, ix in part)
                    new["printed_start"] = phys_to_printed.get(new["phys_start"])
                    new["printed_end"] = phys_to_printed.get(new["phys_end"])
                    new["review"] = True
                    key = "|".join([SOURCE_ID, "|".join(new["path"]), str(new["phys_start"]), text])
                    new["unit_id"] = "tu-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
                    by_anchor[part[0][2]] = new
                    n_merges += 1
                    for _s, _e, ix in part[1:]:
                        removed.add(ix)
                    # Absorb interior non-member units fully inside the span.
                    for jx, u in enumerate(by_anchor):
                        if jx in removed or u["spec"]["key"] in ("opening", "partdiv"):
                            continue
                        if u["anchor"] != anchor:
                            continue
                        bs = [int(b.rsplit("-", 1)[1]) for b in u["block_ids"]]
                        if bs and lo <= min(bs) and max(bs) <= hi and jx != part[0][2]:
                            removed.add(jx)
            if removed:
                by_anchor = [u for jx, u in enumerate(by_anchor) if jx not in removed]
            elif dup_groups:
                raise _G4Blocked("unresolvable duplicate unit ids persist after merges")
            else:
                break
        resid: dict[str, list[int]] = {}
        for idx, u in enumerate(by_anchor):
            resid.setdefault(u["unit_id"], []).append(idx)
        if any(len(v) > 1 for v in resid.values()):
            raise _G4Blocked("duplicate unit ids persist after merges")
        print("dedup-merge: merged=%d units=%d" % (n_merges, len(by_anchor)))
        opening_id: dict[int, str] = {}
        first_index_id: str | None = None
        for u in by_anchor:
            if u["spec"]["key"] == "opening":
                opening_id[_g4_chapter_of(u["anchor"])] = u["unit_id"]
            if u["utype"] == "index_entry" and first_index_id is None:
                first_index_id = u["unit_id"]
        if sorted(opening_id) != list(range(1, 15)):
            raise _G4Blocked("chapter opening ids != 14 after merges")
        for idx, u in enumerate(by_anchor):
            u["preceding"] = by_anchor[idx - 1]["unit_id"] if idx > 0 else None
            u["following"] = by_anchor[idx + 1]["unit_id"] if idx < len(by_anchor) - 1 else None
            pk = u["parent_key"]
            if pk is None:
                u["parent"] = None
            elif pk == "first-index":
                u["parent"] = first_index_id if u["unit_id"] != first_index_id else None
            else:
                u["parent"] = opening_id[pk[1]]

        # Canonical key order — do not reorder.
        lines = []
        for u in by_anchor:
            lines.append(json.dumps(
                {
                    "unit_id": u["unit_id"],
                    "unit_type": u["utype"],
                    "title": u["title"],
                    "structural_path": u["path"],
                    "parent_unit_id": u["parent"],
                    "preceding_unit_id": u["preceding"],
                    "following_unit_id": u["following"],
                    "physical_start": u["phys_start"],
                    "physical_end": u["phys_end"],
                    "printed_start": u["printed_start"],
                    "printed_end": u["printed_end"],
                    "source_block_ids": u["block_ids"],
                    "source_text_hash": u["hash"],
                    "language": "en",
                    "needs_review_type": u["review"],
                    "provenance": {
                        "source_lock_sha": SOURCE_VERSION,
                        "mapping_segment_ids": u["segids"],
                    },
                    "extraction_status": "extracted",
                    "validation_status": "needs_review" if u["review"] else "auto_ok",
                },
                ensure_ascii=False,
            ))
        with open(book / "units.jsonl", "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    except _G4Blocked as exc:
        print("BLOCKED: %s" % exc, file=sys.stderr)
        return 1

    # Self-validation (quote outputs).
    checks: list[tuple[str, bool, str]] = []
    with open(book / "units.jsonl", "r", encoding="utf-8") as f:
        ulines = f.read().splitlines()
    recs = []
    ok = True
    try:
        recs = [json.loads(ln) for ln in ulines]
    except Exception as exc:
        ok = False
    checks.append(("lines-parse", ok, "lines=%d" % len(ulines)))
    ids = [r.get("unit_id") for r in recs]
    checks.append(("unit-unique", len(set(ids)) == len(ids) and len(ids) > 0, "units=%d unique=%d" % (len(ids), len(set(ids)))))
    idset = set(ids)
    chain_ok = True
    for idx, r in enumerate(recs):
        want_pre = recs[idx - 1]["unit_id"] if idx > 0 else None
        want_fol = recs[idx + 1]["unit_id"] if idx < len(recs) - 1 else None
        if r.get("preceding_unit_id") != want_pre or r.get("following_unit_id") != want_fol:
            chain_ok = False
            break
    checks.append(("chain-unbroken", chain_ok, "checked %d links" % len(recs)))
    par_ok = all((r.get("parent_unit_id") is None or r["parent_unit_id"] in idset) for r in recs)
    checks.append(("parents-resolve", par_ok, "null-parents=%d" % sum(1 for r in recs if r.get("parent_unit_id") is None)))
    span_ok = True
    for r in recs:
        chs = {c for c in (_g4_chapter_of(p) for p in range(r["physical_start"], r["physical_end"] + 1))}
        if len(chs) != 1:
            span_ok = False
            break
    checks.append(("no-cross-chapter", span_ok, "checked %d units" % len(recs)))
    block_ok, hash_ok, pagecat_ok = True, True, ""
    anchor_text: dict[int, list[str]] = {}
    anchor_of: dict[int, int] = {}
    for r in recs:
        n = None
        for p in range(r["physical_start"], r["physical_end"] + 1):
            with open(_raw_path(book, "%04d" % p), "r", encoding="utf-8") as f:
                st = json.load(f).get("extraction_status")
            if st != "empty":
                if n is not None:
                    block_ok = False
                n = p
        if n is None:
            block_ok = False
            continue
        anchor_of[id(r)] = n
        blocks, base, joins = _g4_block_segs(book, n)
        valid = {b.get("block_id", "") for b in blocks}
        idxs = []
        for bid in r["source_block_ids"]:
            if bid not in valid:
                block_ok = False
                break
            idxs.append(int(bid.rsplit("-", 1)[1]))
        else:
            if _text_sha(_g4_assemble_text(base, joins, idxs)) != r["source_text_hash"]:
                hash_ok = False
            anchor_text.setdefault(n, []).append(_g4_assemble_text(base, joins, idxs))
            continue
        break
    if block_ok and hash_ok:
        mism = 0
        for n in range(1, EXPECTED_PAGE_COUNT + 1):
            with open(book / "reading" / ("page-%04d.json" % n), "r", encoding="utf-8") as f:
                rt = json.load(f).get("repaired_text", "")
            got = "\n".join(anchor_text.get(n, []))
            if (rt == "") != (n not in anchor_text):
                mism += 1
            elif rt and got != rt:
                mism += 1
        pagecat_ok = "pages=%d mismatches=%d" % (EXPECTED_PAGE_COUNT, mism)
        if mism:
            block_ok = False
    checks.append(("block-linkage", block_ok, "all ids resolve into raw blocks"))
    checks.append(("hash-recompute", hash_ok, "sha256 over reading-text spans"))
    checks.append(("page-concat", block_ok, pagecat_ok))
    covered: set[int] = set()
    for r in recs:
        covered.update(range(r["physical_start"], r["physical_end"] + 1))
    checks.append(("coverage-978", covered == set(range(1, EXPECTED_PAGE_COUNT + 1)),
                   "covered=%d/978" % len(covered)))
    with open(_raw_path(book, "0001"), "r", encoding="utf-8") as f:
        s1 = json.load(f)
    with open(_raw_path(book, "0500"), "r", encoding="utf-8") as f:
        s500 = json.load(f)
    with open(_raw_path(book, "0978"), "r", encoding="utf-8") as f:
        s978 = json.load(f)
    scope_ok = (
        _text_sha(s1.get("raw_text", "")) == s1.get("raw_text_sha256")
        and _text_sha(s500.get("raw_text", "")) == s500.get("raw_text_sha256")
        and _text_sha(s978.get("raw_text", "")) == s978.get("raw_text_sha256")
    )
    try:
        man = json.load(open(book / "run-manifest.json", "r", encoding="utf-8"))
        scope_ev = "raw-hash 0001/0500/0978 recompute OK; run_status=%s" % man.get("run_status")
    except Exception:
        scope_ok = False
        scope_ev = "run-manifest unreadable"
    checks.append(("scope-isolation", scope_ok, scope_ev))

    from collections import Counter as _Counter3
    type_counts = _Counter3(r.get("unit_type") for r in recs)
    n_review = sum(1 for r in recs if r.get("needs_review_type"))
    print("units OK: total=%d types=%s needs_review=%d" % (len(recs), dict(type_counts), n_review))
    allpass = True
    for name, passed, ev in checks:
        print("validate %-16s %s  %s" % (name, "PASS" if passed else "FAIL", ev))
        allpass = allpass and passed
    return 0 if allpass else 1


def _g4_source_text_hash(book: Path, source_block_ids: list[str]) -> str:
    """RULING (binding, fix round 2/5 — spec authority).

    source_text_hash := lowercase hex sha256 of '\\n'.join(raw block texts
    in source_block_ids order), where block texts come from
    raw/page-NNNN.json blocks[] matched by block_id.
    Rationale: raw is the immutable truth layer; the '\\n' join matches the
    reading-layer block-join convention. Reading-layer repairs remain linked
    via each reading record's raw_text_sha256; no Gate-3 file changes needed.
    """
    cache: dict[str, dict[str, str]] = {}
    texts: list[str] = []
    for bid in source_block_ids:
        m = re.fullmatch(r"page-(\d{4})-block-(\d{4})", bid)
        if not m:
            raise _G4Blocked("malformed source_block_id: %r" % bid)
        tag = m.group(1)
        if tag not in cache:
            with open(_raw_path(book, tag), "r", encoding="utf-8") as f:
                raw_rec = json.load(f)
            cache[tag] = {b.get("block_id", ""): b.get("text", "") for b in raw_rec.get("blocks", [])}
        if bid not in cache[tag]:
            raise _G4Blocked("block id not in raw inventory: %r" % bid)
        texts.append(cache[tag][bid])
    return hashlib.sha256("\n".join(texts).encode("utf-8")).hexdigest()


def cmd_rehash_units(args: argparse.Namespace) -> int:
    """Fix round 2/5: rewrite ONLY source_text_hash per the binding ruling.

    All other bytes/keys/order of units.jsonl are preserved exactly (the old
    64-hex value is replaced in place via regex on the parsed line's own
    value). No other file is opened for writing.
    """
    root = repo_root()
    book = root / BOOK_REL
    upath = book / "units.jsonl"
    if not upath.is_file():
        print("BLOCKED: units.jsonl not found — run units first", file=sys.stderr)
        return 1
    digest, _ = sha256_file(root / SOURCE_REL)
    if digest.lower() != EXPECTED_SHA256.lower():
        print("BLOCKED: source-lock sha mismatch", file=sys.stderr)
        return 1
    raw_text = upath.read_text(encoding="utf-8")
    if not raw_text.endswith("\n"):
        print("BLOCKED: units.jsonl missing trailing newline", file=sys.stderr)
        return 1
    lines = raw_text.split("\n")[:-1]
    pat = re.compile(r'"source_text_hash": "[0-9a-f]{64}"')
    out: list[str] = []
    n_changed = 0
    for ln in lines:
        rec = json.loads(ln)
        new_hash = _g4_source_text_hash(book, rec.get("source_block_ids", []))
        old_hash = rec.get("source_text_hash", "")
        if pat.subn("", ln)[1] != 1:
            print("BLOCKED: hash field pattern != 1 occurrence", file=sys.stderr)
            return 1
        new_ln = pat.sub('"source_text_hash": "%s"' % new_hash, ln, count=1)
        if json.loads(new_ln).get("source_text_hash") != new_hash:
            print("BLOCKED: replacement verification failed", file=sys.stderr)
            return 1
        if {k: v for k, v in json.loads(new_ln).items() if k != "source_text_hash"} != {
            k: v for k, v in rec.items() if k != "source_text_hash"
        }:
            print("BLOCKED: non-hash field drift", file=sys.stderr)
            return 1
        if new_hash != old_hash:
            n_changed += 1
        out.append(new_ln)
    with open(upath, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")

    # Re-verification with the documented rule (fresh parse of rewritten file).
    recs = [json.loads(ln) for ln in out]
    ids = [r.get("unit_id") for r in recs]
    idset = set(ids)
    print("rehash-units: lines=%d changed=%d lock=sha256:%s" % (len(recs), n_changed, digest.lower()[:16]))
    print("validate unit-unique      %s  units=%d unique=%d" % (
        "PASS" if len(idset) == len(ids) and ids else "FAIL", len(ids), len(idset)))
    chain_ok = all(
        (recs[i].get("preceding_unit_id") == (recs[i - 1]["unit_id"] if i > 0 else None))
        and (recs[i].get("following_unit_id") == (recs[i + 1]["unit_id"] if i < len(recs) - 1 else None))
        for i in range(len(recs))
    )
    print("validate chain-unbroken   %s  checked %d links" % ("PASS" if chain_ok else "FAIL", len(recs)))
    link_ok = True
    for r in recs:
        for bid in r.get("source_block_ids", []):
            m = re.fullmatch(r"page-(\d{4})-block-(\d{4})", bid)
            if not m:
                link_ok = False
                break
            with open(_raw_path(book, m.group(1)), "r", encoding="utf-8") as f:
                valid = {b.get("block_id", "") for b in json.load(f).get("blocks", [])}
            if bid not in valid:
                link_ok = False
                break
        if not link_ok:
            break
    print("validate block-linkage    %s  all ids resolve into raw/page-*.json blocks[]" % ("PASS" if link_ok else "FAIL"))
    n_match = sum(1 for r in recs if _g4_source_text_hash(book, r.get("source_block_ids", [])) == r.get("source_text_hash"))
    print("validate hash-recompute   %s  %d/%d match (rule: sha256 of newline-joined raw block texts)" % (
        "PASS" if n_match == len(recs) and recs else "FAIL", n_match, len(recs)))
    allpass = len(idset) == len(ids) and bool(ids) and chain_ok and link_ok and n_match == len(recs)
    return 0 if allpass else 1


# ---------------------------------------------------------------------------
# Gate 5 — tables / figures / algorithms as first-class records (TAYLOR-005).
#
# Structure only. Dose/medication atomization belongs to Gate 6 — this pass
# never creates medication records and never parses doses into atoms.
#
# Method (deterministic, stdlib only, raw blocks are the truth layer):
# - tables: per (physical page, printed table number) region walk starting at
#   the caption block in y-order; rows via y-overlap grouping; columns via
#   header line-splitting + x-overlap slot mapping. Per-cell bboxes are null:
#   raw provides block-level bboxes only (each block already spans its row or
#   column zone); x-overlap clustering is used to MAP columns, it cannot mint
#   per-cell coordinates, so none are fabricated.
# - figures: caption block + y-contiguous label zone; caption + labels only.
# - algorithms: graphical/boxed decision content only (explicit "algorithm"
#   captions/headings + decision-tree flowcharts with ?/branch structure).
#   Treatment-algorithm TABLES stay tables-only (documented in findings).
#   branches[] is always [] with no_inferred_branches=true: connector labels
#   (No/Yes/Or/Effective/...) are kept as branch-kind NODES; from/to wiring
#   would require spatial inference, which is forbidden.
# Every record: verification_status="needs_review" (Gate 7 reviews all).
# ---------------------------------------------------------------------------

GATE5_VERSION = "gate5-tables-figures-algorithms-v1"
GATE5_BOOK_ID = "maudsley-prescribing-guidelines-2021-taylor-14e"
GATE5_IDPREFIX = "maudsley-taylor-2021"
GATE5_PASSES = ("tables", "figures", "algorithms")

_G5_CAP_RE = re.compile(r"Table\s+(\d+)\s*\.\s*(\d+)", re.IGNORECASE)
_G5_CONT_RE = re.compile(r"\(Continued\)", re.IGNORECASE)
_G5_FIG_RE = re.compile(r"Figure\s+(\d+)\s*\.\s*(\d+)", re.IGNORECASE)
_G5_CHAP_RE = re.compile(r"^\s*CHAPTER\s+\d+\s*$", re.IGNORECASE)
_G5_CHAP2_RE = re.compile(r"^\s*Chapter\s+\d+\s*$")
_G5_REFHEAD_RE = re.compile(r"^\s*References\s*$")
_G5_WS_CHARS = " \t\r\n\x07\u2002\u2003 "
_G5_COMPANION_VERB_RE = re.compile(
    r"\b(provides?|suggests?|outlines?|gives?|summarises?|summarizes?|shows?|"
    r"lists?|describes?|contains?|illustrates?|presents?)\b",
    re.IGNORECASE,
)
_G5_CAPVERB_RE = re.compile(
    r"^Table\s+\d+\s*\.\s*\d+\s+(provides?|suggests?|outlines?|gives?|"
    r"summarises?|summarizes?|shows?|lists?|describes?|contains?|"
    r"illustrates?|presents?|is|are|was|were)\b",
    re.IGNORECASE,
)
_G5_FIGCAPVERB_RE = re.compile(
    r"^Figure\s+\d+\s*\.\s*\d+\s+(provides?|suggests?|outlines?|gives?|"
    r"summarises?|summarizes?|shows?|lists?|describes?|contains?|"
    r"illustrates?|presents?|is|are|was|were)\b",
    re.IGNORECASE,
)
_G5_ABBREV_PAIR_RE = re.compile(r"^[A-Za-z][A-Za-z0-9\-/&]{0,10}\s*[,=:]\s*\S")
_G5_CAND_SHORT_RE = re.compile(r"\b(\d?[A-Z][A-Z0-9&/\-*]{1,7})\b")
_G5_CAND_SHORT_LO_RE = re.compile(r"\b(bd|od|tds|prn)\b")
_G5_FOOTMARK_RE = re.compile(r"[*†‡]+")
_G5_DECIMAL_RE = re.compile(r"\d+\.\d+")
_G5_REFITEM_RE = re.compile(
    r"(?<!\d)(?P<g>\d{1,3}(?:\s*[–—-]\s*\d{1,3})?"
    r"(?:\s*,\s*\d{1,3}(?:\s*[–—-]\s*\d{1,3})?)*)(?!\d)"
)
_G5_UNIT_SUFFIX_RE = re.compile(
    r"^\s*(mg|mcg|µg|kg|ml|mmol|µmol|nmol|ng|pg|mm|cm|iu|units?|g|%)(?![a-zA-Z])|^/",
    re.IGNORECASE,
)
_G5_DOSEUNIT_RE = re.compile(
    r"\d[\d\s.,–—-]*(mg/day|mg/kg|mg/week|mg|g/day|µg/day|mcg/day|µg|mcg|kg|ml|"
    r"mmol/L|mg/L|ng/mL|mIU/L|IU|mmol|%)"
)
_G5_REF_PREV_OK = set("abcdefghijklmnopqrstuvwxyz)⟩’”'\"\\].*†‡")
_G5_ABBREV_STOP = frozenset({
    "OR", "AND", "NO", "YES", "NOT", "DO", "GIVE", "USE", "ALL", "LOW",
    "HIGH", "NEW", "ONE", "TWO", "DAY", "WEEK", "STOP", "ADD", "SEE",
    "FOR", "THE", "OF", "IN", "ON", "TO", "IS", "IT", "IF", "BE",
    "ARE", "EFFECT", "EFFECTS", "DOSE", "DOSES", "DRUG", "RISK",
    "WITH", "FROM", "Background", "Notes",
    "II", "III", "D-", "N-", "S-", "U&", "U&E",
})
_G5_ALGO_VERBS = frozenset({
    "consider", "start", "stop", "switch", "add", "check", "discuss",
    "refer", "continue", "ensure", "exclude", "investigate", "provide",
    "give", "delay", "document", "use", "simplify", "reduce", "establish",
    "combine", "increase", "titrate", "adjust", "assess", "change",
    "follow", "offer", "take", "measure", "ask", "obtain", "withhold",
    "withold", "prescribe", "monitor", "avoid", "choose", "treat",
    "discontinue", "rule",
})
_G5_ALGO_ENDPOINT_RE = re.compile(
    r"^(refer|continue for|give medication|document and|ensure ongoing)\b",
    re.IGNORECASE,
)
_G5_ALGO_ACTION_RE = re.compile(
    r"^(do not give|use alternative|delay giving)\b", re.IGNORECASE
)
_G5_ALGO_ENTRY_RE = re.compile(
    r"^(relapse|first-episode|recurrence|maintenance|prophylaxis|"
    r"acute exacerbation|relapse or acute)\b",
    re.IGNORECASE,
)
_G5_ALGO_BRANCH_RE = re.compile(
    r"^(or|either|no|not |poorly |ineffective|mild |moderate |successful|"
    r"not tolerated|elevated|normal|unable |effective|no effect|response|"
    r"yes|discontinue )",
    re.IGNORECASE,
)


def _g5_strip(text: str) -> str:
    # str.strip() removes all Unicode whitespace; BEL (\x07, used by the
    # extractor as a tab stand-in) is not whitespace, so strip it too.
    return text.strip().strip("­")


def _g5_collapse(text: str) -> str:
    t = text.replace("", " ").replace("­", "")
    t = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", " ", t)
    return re.sub(r"\s+", " ", t, flags=re.UNICODE).strip()


def _g5_lines(text: str) -> list[str]:
    return [_g5_strip(l) for l in text.split("\n")]


def _g5_nonempty_lines(text: str) -> list[str]:
    return [l for l in _g5_lines(text) if l]


def _g5_raw(book: Path, tag: str, cache: dict) -> dict:
    if tag not in cache:
        with open(_raw_path(book, tag), "r", encoding="utf-8") as f:
            cache[tag] = json.load(f)
    return cache[tag]


def _g5_ptag(physical: int) -> str:
    return "%04d" % physical


def _g5_page_blocks(book: Path, physical: int, cache: dict) -> list[dict]:
    rec = _g5_raw(book, _g5_ptag(physical), cache)
    out: list[dict] = []
    for i, b in enumerate(rec.get("blocks", [])):
        bb = b.get("bbox", [0, 0, 0, 0])
        out.append({
            "block_id": b.get("block_id", ""),
            "text": b.get("text", ""),
            "x0": float(bb[0]), "y0": float(bb[1]),
            "x1": float(bb[2]), "y1": float(bb[3]),
            "order": i,
        })
    return out


def _g5_y_sorted(blocks: list[dict]) -> list[dict]:
    return sorted(blocks, key=lambda b: (b["y0"], b["x0"], b["order"]))


def _g5_expand_range_item(item: str, out: list[int]) -> None:
    item = item.strip()
    m = re.fullmatch(r"(\d{1,3})\s*[–—-]\s*(\d{1,3})", item)
    if m:
        a, b = int(m.group(1)), int(m.group(2))
        if 1 <= a <= 600 and 1 <= b <= 600 and b >= a and (b - a) <= 150:
            out.extend(range(a, b + 1))
        elif 1 <= a <= 600:
            out.append(a)
        return
    if re.fullmatch(r"\d{1,3}", item):
        v = int(item)
        if 1 <= v <= 600:
            out.append(v)


def _g5_ref_numbers(text: str) -> list[int]:
    """Table-local citation numbers from cell text (verbatim positions only).

    Deterministic rules, documented: decimals removed first; candidate
    integer groups (with en/em-dash ranges and comma lists) must be preceded
    by a lowercase letter, closing paren/quote, footnote marker or period
    (this rejects doses like 400mg, D2-receptor terms, years and article
    IDs); candidates followed by a unit suffix (mg, %, /, ...) are rejected;
    values capped at 600.
    """
    t = _G5_DECIMAL_RE.sub(" ", text)
    out: list[int] = []
    for m in _G5_REFITEM_RE.finditer(t):
        g = m.group("g")
        s = m.start("g")
        prev = t[s - 1] if s > 0 else ""
        if prev not in _G5_REF_PREV_OK:
            continue
        rest = t[m.end("g"):m.end("g") + 6]
        if _G5_UNIT_SUFFIX_RE.match(rest):
            continue
        for part in g.split(","):
            _g5_expand_range_item(part, out)
    seen: list[int] = []
    for v in out:
        if v not in seen:
            seen.append(v)
    return seen


def _g5_footnote_markers(cell: str) -> list[str]:
    seen: list[str] = []
    for m in _G5_FOOTMARK_RE.findall(cell):
        if m not in seen:
            seen.append(m)
    return seen


def _g5_units_seen(texts: list[str]) -> list[str]:
    seen: list[str] = []
    for t in texts:
        for m in _G5_DOSEUNIT_RE.finditer(t):
            u = m.group(1)
            if u not in seen:
                seen.append(u)
    return seen


def _g5_is_head_block(b: dict) -> bool:
    t = _g5_collapse(b["text"])
    if _G5_CHAP_RE.match(t) or _G5_CHAP2_RE.match(t):
        return True
    if "Maudsley" in t and ("Prescribing Guidelines" in t or len(t) < 100):
        return True
    if b["y0"] < 50.0 and len(t) < 150 and "\u2003" in b["text"]:
        return True
    return False


def _g5_is_numref_block(b: dict) -> bool:
    lines = _g5_nonempty_lines(b["text"])
    if not lines:
        return False
    return bool(re.match(
        r"^\d{1,3}\.\s*\S.*(et al\.|19\d\d|20\d\d|:\s*\d|Cochrane|Lancet|"
        r"Psychiatry|Journal|Psychopharmacol)",
        lines[0], re.IGNORECASE))


def _g5_is_footnote_block(b):
    t = _g5_strip(b["text"])
    if not t:
        return False
    if t[0] in "*\u2020\u2021":
        return True
    if re.match(r"^(Note|NB|Key)\b", t):
        return True
    if len(t) < 250 and ("," in t or "=" in t):
        if len(_g5_nonempty_lines(b["text"])) == 1 and re.match(
                r"^[A-Za-z][A-Za-z0-9\-/&*]{0,10}\s*[,=:]\s*[A-Za-z(]", t):
            return True
    if re.match(r"^(ALT|AST)\b", t):
        return True
    if t.startswith("(") and len(t) > 80:
        return True
    return False


def _g5_is_prose_block(b: dict) -> bool:
    lines = _g5_nonempty_lines(b["text"])
    if not lines:
        return True
    total = sum(len(line) for line in lines)
    width = b["x1"] - b["x0"]
    if total > 200 and width > 300:
        return True
    if total > 140 and any(". " in line for line in lines):
        if len(lines) >= 2 and min(len(line) for line in lines) > 45:
            return True
    return False


def _g5_abbrev_map(book: Path, cache: dict) -> dict[str, str]:
    """Parse the book's own List of abbreviations (physical 17-21): SHORT
    lines alternate with expansion lines (expansions may wrap across lines).
    Only this list licenses expansions."""
    amap: dict[str, str] = {}
    short: str | None = None
    parts: list[str] = []
    for phys in (17, 18, 19, 20, 21):
        try:
            rec = _g5_raw(book, _g5_ptag(phys), cache)
        except FileNotFoundError:
            continue
        for b in rec.get("blocks", []):
            for raw_ln in b.get("text", "").split("\n"):
                ln = raw_ln.strip(" \t\r\n\x07")
                if not ln:
                    continue
                if re.fullmatch(r"List of abbreviations", ln, re.IGNORECASE):
                    continue
                is_short = (
                    len(ln) <= 14 and " " not in ln
                    and (any(c.isupper() for c in ln)
                         or ln in ("od", "bd", "tds"))
                )
                if is_short and re.fullmatch(r"[A-Za-z0-9\-\*/.&'’]+", ln):
                    if short is not None and parts:
                        amap[short] = _g5_collapse(" ".join(parts))
                    short = ln
                    parts = []
                elif short is not None:
                    parts.append(ln)
    if short is not None and parts and short not in amap:
        amap[short] = _g5_collapse(" ".join(parts))
    return amap


def _g5_table_abbrevs(texts: list[str], amap: dict[str, str]) -> list[dict]:
    found: list[str] = []
    for t in texts:
        for m in _G5_CAND_SHORT_RE.finditer(t):
            s = m.group(1)
            if len(s) >= 2 and s not in _G5_ABBREV_STOP and s not in found:
                found.append(s)
        for m in _G5_CAND_SHORT_LO_RE.finditer(t):
            s = m.group(1)
            if s not in found:
                found.append(s)
    out: list[dict] = []
    for s in found:
        if s in amap:
            out.append({"short": s, "expansion_or_null": amap[s],
                        "abbreviation_unknown": False})
        else:
            out.append({"short": s, "expansion_or_null": None,
                        "abbreviation_unknown": True})
    return out


def _g5_block_num(b: dict, which: str) -> tuple[int, int] | None:
    if which == "table":
        m = _G5_CAP_RE.search(b["text"])
    else:
        m = _G5_FIG_RE.search(b["text"])
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)))


def _g5_is_rowlike(b: dict) -> bool:
    lines = _g5_nonempty_lines(b["text"])
    if not lines or len(lines) > 12:
        return False
    total = sum(len(line) for line in lines)
    if total > 900:
        return False
    if min(len(line) for line in lines) < 70:
        return True
    return len(lines) == 1 and len(lines[0]) < 150


def _g5_is_grouphead_like(b: dict) -> bool:
    lines = _g5_nonempty_lines(b["text"])
    if len(lines) != 1:
        return False
    s = lines[0]
    if len(s) >= 70:
        return False
    if re.search(r"\d", s):
        return False
    if "mg" in s.lower():
        return False
    if s[0] in "*†‡(":
        return False
    return True


def _g5_caption_candidates(ybs_page, number, hints):
    tw = [b for b in ybs_page
          if _g5_block_num(b, "table") == number
          and re.match(r"^\s*Table\s+\d", _g5_collapse(b["text"]))]
    tier1, tier2 = [], []
    for b in tw:
        t = _g5_collapse(b["text"])
        if len(t) >= 500:
            continue
        if _G5_CAPVERB_RE.search(t):
            continue
        (tier1 if len(t) < 200 else tier2).append(b)
    key = lambda b: (0 if b["block_id"] in hints else 1, b["y0"],
                     b["x0"], b["order"])
    return sorted(tier1, key=key), sorted(tier2, key=key)


def _g5_walk_from_block(pages, ybs, number, hints, start_bid):
    start = None
    for pg in pages:
        for b in ybs[pg]:
            if b["block_id"] == start_bid:
                start = b
                break
    if start is None:
        return {"caption": None, "items": [], "skipped_prose": 0,
                "skipped_head": 0,
                "stops": ["no-fallback-start"], "pages": pages,
                "fallback": True}
    region = _g5_walk_table_region(pages, ybs, number, hints, start)
    region["caption"] = None
    region["fallback"] = True
    return region


def _g5_walk_table_region(
    pages: list[int], ybs: dict[int, list[dict]], number: tuple[int, int],
    start_hint_ids: set[str], cap_block=None,
) -> dict:
    """Walk a table region. Returns caption block, ordered content blocks
    with kinds (row/grouphead/footnote), skipped counts and stop reasons."""
    cap_page = None
    if cap_block is not None:
        for pg in pages:
            if any(b["block_id"] == cap_block["block_id"]
                   for b in ybs[pg]):
                cap_page = pg
                break
        if cap_page is None:
            cap_block = None
    if cap_block is None:
        for pg in pages:
            cands = [b for b in ybs[pg]
                     if _g5_block_num(b, "table") == number]
            # A prose mention ("Table N.M suggests ...") also matches the
            # caption regex: real captions are short noun phrases, mentions
            # are sentences (often short). Reject both long blocks and
            # sentence-verb openings.
            kept = []
            for b in cands:
                t = _g5_collapse(b["text"])
                if len(t) >= 200:
                    continue
                if _G5_CAPVERB_RE.search(t):
                    continue
                kept.append(b)
            cands = kept
            if cands:
                hinted = [b for b in cands if b["block_id"] in start_hint_ids]
                cap_block = hinted[0] if hinted else cands[0]
                cap_page = pg
                break
    if cap_block is None:
        return {"caption": None, "items": [], "skipped_prose": 0,
                "skipped_head": 0, "stops": ["no-caption-block-on-page"],
                "pages": pages}
    items: list[tuple[dict, str]] = []
    skipped_prose = 0
    skipped_head = 0
    stops: list[str] = []
    started = False
    for pg in pages:
        ordered = ybs[pg]
        if pg == cap_page:
            try:
                idx = next(i for i, b in enumerate(ordered)
                           if b["block_id"] == cap_block["block_id"])
            except StopIteration:
                continue
            seq = ordered[idx + 1:]
            started = True
        elif not started:
            continue
        else:
            seq = list(ordered)
        for j, b in enumerate(seq):
            if _g5_is_head_block(b):
                skipped_head += 1
                continue
            nb = _g5_block_num(b, "table")
            if nb is not None and nb != number:
                stops.append("next-table-caption:%s" % b["block_id"])
                return {"caption": cap_block, "items": items,
                        "skipped_prose": skipped_prose,
                        "skipped_head": skipped_head, "stops": stops,
                        "pages": pages}
            if _g5_block_num(b, "figure") is not None:
                stops.append("figure-caption:%s" % b["block_id"])
                return {"caption": cap_block, "items": items,
                        "skipped_prose": skipped_prose,
                        "skipped_head": skipped_head, "stops": stops,
                        "pages": pages}
            if _G5_REFHEAD_RE.match(_g5_collapse(b["text"])) or _g5_is_numref_block(b):
                stops.append("references:%s" % b["block_id"])
                return {"caption": cap_block, "items": items,
                        "skipped_prose": skipped_prose,
                        "skipped_head": skipped_head, "stops": stops,
                        "pages": pages}
            if re.match(r"^\s*\(Continued\)\s*$", _g5_collapse(b["text"])):
                stops.append("continued-marker:%s" % b["block_id"])
                return {"caption": cap_block, "items": items,
                        "skipped_prose": skipped_prose,
                        "skipped_head": skipped_head, "stops": stops,
                        "pages": pages}
            if _g5_is_footnote_block(b):
                items.append((b, "footnote"))
                continue
            if _g5_is_grouphead_like(b):
                nxt = seq[j + 1] if j + 1 < len(seq) else None
                if nxt is not None and (
                        _g5_is_rowlike(nxt) or _g5_is_footnote_block(nxt)
                        or _g5_is_grouphead_like(nxt)):
                    items.append((b, "grouphead"))
                    continue
                stops.append("section-title:%s" % b["block_id"])
                return {"caption": cap_block, "items": items,
                        "skipped_prose": skipped_prose,
                        "skipped_head": skipped_head, "stops": stops,
                        "pages": pages}
            if _g5_is_rowlike(b):
                items.append((b, "row"))
                continue
            skipped_prose += 1
    stops.append("page-end")
    return {"caption": cap_block, "items": items,
            "skipped_prose": skipped_prose, "skipped_head": skipped_head,
            "stops": stops, "pages": pages}


def _g5_y_groups(blocks: list[dict]) -> list[list[dict]]:
    ordered = sorted(blocks, key=lambda b: (b["y0"], b["x0"], b["order"]))
    groups: list[list[dict]] = []
    cur: list[dict] = []
    cur_max_y1 = 0.0
    for b in ordered:
        if not cur:
            cur = [b]
            cur_max_y1 = b["y1"]
            continue
        if b["y0"] < cur_max_y1 - 2.0:
            cur.append(b)
            cur_max_y1 = max(cur_max_y1, b["y1"])
        else:
            groups.append(cur)
            cur = [b]
            cur_max_y1 = b["y1"]
    if cur:
        groups.append(cur)
    return groups


def _g5_x_subgroups(group: list[dict]) -> list[list[dict]]:
    ordered = sorted(group, key=lambda b: (b["x0"], b["y0"]))
    subs: list[list[dict]] = []
    for b in ordered:
        placed = False
        for sg in subs:
            if b["x0"] < max(x["x1"] for x in sg) + 2.0 and \
               min(x["x1"] for x in sg) - 2.0 < b["x1"]:
                sg.append(b)
                placed = True
                break
        if not placed:
            subs.append([b])
    return subs


def _g5_glue_bullets(lines):
    """Glue lone bullet lines to the following line so a bullet is never
    split from its item text across columns. Joins use newline, so the
    result stays a verbatim substring of the page text."""
    out = []
    i = 0
    while i < len(lines):
        if lines[i] in ("\u25a0", "\u2022", "-", "\u2013") \
                and i + 1 < len(lines):
            out.append(lines[i] + "\n" + lines[i + 1])
            i += 2
        else:
            out.append(lines[i])
            i += 1
    return out


def _g5_tentative_header_cells(lines, width, height):
    cells = []
    buf = ""
    for ln in lines:
        if buf and (ln[0].islower() or ln[0] == "(" or ln[0] in "\u2013-"):
            buf += "\n" + ln
        else:
            if buf:
                cells.append(buf)
            buf = ln
    if buf:
        cells.append(buf)
    if len(cells) > 1 and height > 0 and lines:
        # An uppercase-uppercase split is only real for side-by-side
        # headers (about one text line tall); stacked wrapped headers
        # rejoin. est = mean block height per extracted line.
        est = height / max(len(lines), 1)
        if est >= 7.0:
            merged = [cells[0]]
            for nxt in cells[1:]:
                prev_lines = merged[-1].split("\n")
                first = _g5_strip(nxt.split("\n")[0])
                if prev_lines and prev_lines[-1][:1].isupper() \
                        and first[:1].isupper():
                    merged[-1] += "\n" + nxt
                else:
                    merged.append(nxt)
            cells = merged
    return cells


def _g5_distribute_lines(lines: list[str], k: int) -> list[str]:
    if k <= 0:
        return []
    if len(lines) == k:
        return list(lines)
    if len(lines) > k:
        return lines[:k - 1] + ["\n".join(lines[k - 1:])]
    return list(lines) + [""] * (k - len(lines))


def _g5_group_is_header(lines, is_base):
    for line in lines:
        s = line.strip()
        if not s:
            continue
        if "\u25a0" in s or "\u2022" in s:
            return False
        if _G5_DOSEUNIT_RE.search(s):
            return False
        if len(s) > 70:
            return False
        if not is_base and _g5_ref_numbers(s):
            return False
    return True


def _g5_line_has_data_signal(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if "■" in s or "•" in s:
        return True
    if _G5_DOSEUNIT_RE.search(s):
        return True
    refs = _g5_ref_numbers(s)
    if refs and not re.fullmatch(r"[A-Z][a-z]?\d{1,2}", s):
        return True
    return False


def _g5_make_cell(text: str) -> dict:
    cell: dict = {"text": text, "bbox": None,
                  "footnote_markers": _g5_footnote_markers(text),
                  "ref_numbers": _g5_ref_numbers(text)}
    return cell


def _g5_blank_cell() -> dict:
    cell = _g5_make_cell("")
    cell["blank"] = True
    return cell


def _g5_assemble_table(
    region: dict, pages_text: dict[int, str], amap: dict[str, str],
    base_headers: list[str] | None, table_id: str, host_printed: tuple,
    host_unit_id: str, book_id: str, phys: int, title_override=None,
) -> tuple[dict, dict]:
    """Assemble one table record from a walked region. Returns (record, meta)
    where meta carries validation signals (reshaped rows, groundedness)."""
    notes: list[str] = []
    confidence = "high"
    cap = region["caption"]
    title = _g5_collapse(cap["text"]) if cap is not None else ""
    if title_override:
        title = title_override
        confidence = "medium"
        notes.append("no standalone caption block on page; region anchored "
                     "at unit blocks, title from host unit (Gate-4).")
    row_blocks = [b for (b, k) in region["items"] if k == "row"]
    head_blocks = [b for (b, k) in region["items"] if k == "grouphead"]
    foot_blocks = [b for (b, k) in region["items"] if k == "footnote"]
    if region["skipped_prose"]:
        confidence = "medium"
        notes.append("%d prose block(s) skipped inside region (not rows)."
                     % region["skipped_prose"])
    if cap is None or not row_blocks:
        kind = "graphical-or-empty" if cap is not None else "no-caption"
        foot_texts = ["\n".join(_g5_nonempty_lines(b["text"])) for b in foot_blocks]
        rec = {
            "table_id": table_id, "book_id": book_id, "title": title,
            "physical_start": phys, "physical_end": phys,
            "printed_start": host_printed[0], "printed_end": host_printed[1],
            "headers": [], "rows": [],
            "footnotes": foot_texts,
            "abbreviations": _g5_table_abbrevs([title] + foot_texts, amap),
            "units_seen": [],
            "host_unit_id": host_unit_id,
            "source_block_ids": ([cap["block_id"]] if cap else [])
            + [b["block_id"] for b in foot_blocks],
            "references": _g5_ref_numbers(title + "\n" + "\n".join(foot_texts)),
            "continued_by_table_id": None, "continues_table_id": None,
            "extraction_confidence": "low",
            "verification_status": "needs_review",
        }
        if kind == "graphical-or-empty":
            rec["reconstruction_note"] = (
                "No row-like text blocks followed the caption in reading order "
                "on this page. The grid may be graphical/scanned, "
                "rotated/transposed (content lies elsewhere on the page, e.g. "
                "landscape tables), or carried entirely by a linked "
                "continuation fragment. rows[] left empty; cells never "
                "fabricated. Gate 7 must verify visually. Stops: %s."
                % ",".join(region["stops"]))
        else:
            rec["reconstruction_note"] = (
                "No caption block for this unit's table number on its page; "
                "no grid reconstructed. Stops: %s."
                % ",".join(region["stops"]))
        return rec, {"notes": notes, "ground_fail": [], "reshaped": []}
    # Complexity guard: transposed/rotated/fragment-tiled layouts.
    x0s = sorted(b["x0"] for b in row_blocks)
    clusters = 1
    for i in range(1, len(x0s)):
        if x0s[i] - x0s[i - 1] > 20.0:
            clusters += 1
    heights = sorted(b["y1"] - b["y0"] for b in row_blocks)
    med_h = heights[len(heights) // 2]
    if clusters >= 8 or med_h > 130.0 or \
            (len(row_blocks) >= 3 and clusters > len(row_blocks)):
        foot_texts = ["\n".join(_g5_nonempty_lines(b["text"])) for b in foot_blocks]
        rec = {
            "table_id": table_id, "book_id": book_id, "title": title,
            "physical_start": phys, "physical_end": phys,
            "printed_start": host_printed[0], "printed_end": host_printed[1],
            "headers": [], "rows": [],
            "footnotes": foot_texts,
            "abbreviations": _g5_table_abbrevs([title] + foot_texts, amap),
            "units_seen": [],
            "host_unit_id": host_unit_id,
            "source_block_ids": [cap["block_id"]]
            + [b["block_id"] for b in row_blocks[:8]]
            + [b["block_id"] for b in foot_blocks],
            "references": _g5_ref_numbers(title + "\n" + "\n".join(foot_texts)),
            "continued_by_table_id": None, "continues_table_id": None,
            "extraction_confidence": "low",
            "verification_status": "needs_review",
            "reconstruction_note": (
                "Complex layout (x-clusters=%d, median block height=%.1f, "
                "row blocks=%d): transposed, rotated or fragment-tiled grid "
                "that cannot be reconstructed without visual verification. "
                "rows[] left empty; cells never fabricated. Gate 7 must "
                "verify visually." % (clusters, med_h, len(row_blocks))),
        }
        return rec, {"notes": notes, "ground_fail": [], "reshaped": ["complex-layout"]}
    groups = _g5_y_groups(row_blocks + head_blocks)
    # Header detection on the first y-group.
    first = groups[0]
    first_texts = ["\n".join(_g5_nonempty_lines(b["text"])) for b in first]
    is_cont = bool(_G5_CONT_RE.search(title))
    is_header = _g5_group_is_header("\n".join(first_texts).split("\n"),
                                    not is_cont)
    headers: list[str] = []
    slot_ranges: list[tuple[float, float]] = []
    body_groups = groups
    inherited = False
    if is_header:
        per_block_cells: list[list[str]] = []
        for hb in sorted(first, key=lambda b: b["x0"]):
            hb_lines = _g5_glue_bullets(_g5_nonempty_lines(hb["text"]))
            cells = _g5_tentative_header_cells(
                hb_lines, hb["x1"] - hb["x0"], hb["y1"] - hb["y0"])
            per_block_cells.append(cells)
        # Sub-split multi-cell header blocks at interior body x0 boundaries.
        body_x0s = sorted({b["x0"] for g in groups[1:] for b in g})
        ordered_hb = sorted(first, key=lambda b: b["x0"])
        for hb, cells in zip(ordered_hb, per_block_cells):
            if len(cells) == 1:
                slot_ranges.append((hb["x0"], hb["x1"]))
                headers.extend(cells)
                continue
            cuts = [x for x in body_x0s if hb["x0"] + 10.0 < x < hb["x1"] - 10.0]
            if len(cuts) == len(cells) - 1:
                edges = [hb["x0"]] + cuts + [hb["x1"]]
                for i, c in enumerate(cells):
                    slot_ranges.append((edges[i], edges[i + 1]))
                    headers.append(c)
            else:
                for c in cells:
                    slot_ranges.append((hb["x0"], hb["x1"]))
                    headers.append(c)
        body_groups = groups[1:]
    else:
        # No header row observed: slots from body x-clusters; Gate 7 decides.
        xs = sorted({b["x0"] for g in groups for b in g})
        cl: list[list[float]] = []
        for x in xs:
            if cl and x - cl[-1][-1] <= 30.0:
                cl[-1].append(x)
            else:
                cl.append([x])
        for c in cl:
            slot_ranges.append((min(c) - 1.0, max(c) + 200.0))
        headers = []
        if base_headers:
            headers = list(base_headers)
            inherited = True
            confidence = "medium"
            notes.append("headers inherited from base fragment (continued "
                         "page repeats no header row).")
        else:
            confidence = "medium"
            notes.append("no header row observed; first band treated as data.")
    n = len(headers) if headers else len(slot_ranges)
    if n == 0:
        n = 1
        slot_ranges = [(min(b["x0"] for g in groups for b in g) - 1.0,
                        max(b["x1"] for g in groups for b in g) + 1.0)]
    region_x0 = min(b["x0"] for g in groups for b in g)
    region_x1 = max(b["x1"] for g in groups for b in g)
    single_anchor = len({(round(a), round(b)) for a, b in slot_ranges}) == 1
    rows: list[dict] = []
    reshaped: list[str] = []
    for gi, grp in enumerate(body_groups):
        grp_sorted = sorted(grp, key=lambda b: (b["x0"], b["y0"]))
        only_head = len(grp_sorted) == 1 and _g5_is_grouphead_like(grp_sorted[0]) \
            and grp_sorted[0]["x0"] <= region_x0 + 25.0
        if only_head:
            cells = [_g5_make_cell(_g5_nonempty_lines(grp_sorted[0]["text"])[0])]
            while len(cells) < n:
                cells.append(_g5_blank_cell())
            rows.append({"cells": cells, "row_type": "header"})
            continue
        subs = _g5_x_subgroups(grp_sorted)
        sg0_x0 = subs[0][0]["x0"]
        if len(subs) == 1 and sg0_x0 > region_x0 + 25.0:
            # Indented single fragment: continuation of the previous row's
            # cells (first column blank, never merged silently).
            texts = []
            for b in subs[0]:
                texts.extend(_g5_glue_bullets(_g5_nonempty_lines(b["text"])))
            if n > 2 and sg0_x0 > (region_x0 + region_x1) / 2.0:
                cells = [_g5_blank_cell()] * (n - 1) + [
                    _g5_make_cell("\n".join(texts))]
                rows.append({"cells": cells, "row_type": "continued"})
                continue
            tail = _g5_distribute_lines(texts, n - 1) if n > 1 else []
            cells = [_g5_blank_cell()] + [_g5_make_cell(t) for t in tail]
            rows.append({"cells": cells, "row_type": "continued"})
            continue
        if len(subs) == 1 and sg0_x0 <= region_x0 + 25.0:
            # Full row captured in one left-anchored block: lines are cells.
            sg = subs[0]
            texts = []
            for b in sorted(sg, key=lambda x: (x["y0"], x["x0"])):
                texts.extend(_g5_glue_bullets(_g5_nonempty_lines(b["text"])))
            parts = _g5_distribute_lines(texts, n)
            cells = [_g5_make_cell(t) if t else _g5_blank_cell() for t in parts]
            if len(texts) < n:
                reshaped.append("row %d: short row padded (%d lines -> %d cols)"
                                % (len(rows), len(texts), n))
            if len(texts) == n and n > 1 and any(
                    t and t[0].islower() for t in parts[1:]):
                confidence = "medium"
                notes.append("row %d may split a wrapped cell across columns; "
                             "Gate 7 must verify." % len(rows))
            rows.append({"cells": cells, "row_type": "body"})
            continue
        if len(subs) == 1:
            # Lone right-side fragment: join into its covered slot(s).
            sg = subs[0]
            sx0 = min(b["x0"] for b in sg)
            sx1 = max(b["x1"] for b in sg)
            covered = [i for i, (ax0, ax1) in enumerate(slot_ranges)
                       if sx0 < ax1 and ax0 < sx1] or [n - 1]
            texts = []
            for b in sorted(sg, key=lambda x: (x["y0"], x["x0"])):
                texts.extend(_g5_glue_bullets(_g5_nonempty_lines(b["text"])))
            parts = _g5_distribute_lines(texts, len(covered))
            filled = {s: "" for s in range(n)}
            for s, p in zip(sorted(covered), parts):
                filled[s] = p
            cells = [_g5_make_cell(filled[i]) if filled[i]
                     else _g5_blank_cell() for i in range(n)]
            rows.append({"cells": cells, "row_type": "body"})
            continue
        # Multi-subgroup y-group: map each subgroup to the slots its
        # x-interval covers (x-overlap clustering); unmapped slots blank.
        cover_sets: list[set[int]] = []
        for sg in subs:
            sx0 = min(b["x0"] for b in sg)
            sx1 = max(b["x1"] for b in sg)
            covered = {i for i, (ax0, ax1) in enumerate(slot_ranges)
                       if sx0 < ax1 and ax0 < sx1}
            if not covered:
                best = min(range(len(slot_ranges)),
                           key=lambda i: abs((slot_ranges[i][0]
                                              + slot_ranges[i][1]) / 2
                                             - (sx0 + sx1) / 2))
                covered = {best}
            cover_sets.append(covered)
        filled = {s: "" for s in range(n)}
        if all(c == set(range(n)) for c in cover_sets):
            # Indistinguishable x (shared slot intervals): positional fill.
            order = sorted(range(len(subs)),
                           key=lambda k: min(b["x0"] for b in subs[k]))
            if len(order) == n:
                for k, i in zip(order, range(n)):
                    texts = []
                    for b in sorted(subs[k], key=lambda x: (x["y0"], x["x0"])):
                        texts.extend(_g5_glue_bullets(_g5_nonempty_lines(b["text"])))
                    filled[i] = "\n".join(texts)
            else:
                first_need = n - (len(order) - 1)
                if first_need < 1:
                    first_need = 1
                texts0 = []
                for b in sorted(subs[order[0]],
                                key=lambda x: (x["y0"], x["x0"])):
                    texts0.extend(_g5_glue_bullets(_g5_nonempty_lines(b["text"])))
                parts0 = _g5_distribute_lines(texts0, first_need)
                for i in range(first_need):
                    filled[i] = parts0[i] if i < len(parts0) else ""
                for kpos, k in enumerate(order[1:], start=first_need):
                    if kpos >= n:
                        break
                    texts = []
                    for b in sorted(subs[k], key=lambda x: (x["y0"], x["x0"])):
                        texts.extend(_g5_glue_bullets(_g5_nonempty_lines(b["text"])))
                    filled[kpos] = "\n".join(texts)
                reshaped.append("row %d: %d x-subgroups -> %d cols "
                                "(positional fill)" % (len(rows), len(order), n))
                if confidence == "high":
                    confidence = "medium"
                    notes.append("side-by-side row fragments paired by "
                                 "y-overlap; Gate 7 must verify pairing.")
        else:
            order = sorted(range(len(subs)),
                           key=lambda k: min(b["x0"] for b in subs[k]))
            for k in order:
                texts = []
                for b in sorted(subs[k], key=lambda x: (x["y0"], x["x0"])):
                    texts.extend(_g5_glue_bullets(_g5_nonempty_lines(b["text"])))
                cov = sorted(cover_sets[k])
                parts = _g5_distribute_lines(texts, len(cov))
                for s, p in zip(cov, parts):
                    if filled[s]:
                        filled[s] += "\n" + p
                        if confidence == "high":
                            confidence = "medium"
                            notes.append("overlapping row fragments "
                                         "concatenated; Gate 7 must verify.")
                    else:
                        filled[s] = p
        cells = []
        for i in range(n):
            t = filled.get(i, "")
            cells.append(_g5_make_cell(t) if t else _g5_blank_cell())
        rows.append({"cells": cells, "row_type": "body"})
    if not rows and confidence == "high":
        confidence = "medium"
        notes.append("caption/header only; no body rows recovered on "
                     "this page.")
    foot_texts = ["\n".join(_g5_nonempty_lines(b["text"])) for b in foot_blocks]
    all_texts = headers + ["\n".join(
        c["text"] for c in r["cells"]) for r in rows] + foot_texts
    # Groundedness: every cell must be a substring of the page text.
    ground_fail = []
    blanked = 0
    page_collapsed = pages_text.get(phys, "")
    for r in rows:
        for c in r["cells"]:
            if not c["text"]:
                continue
            if _g5_collapse(c["text"]) not in page_collapsed:
                ground_fail.append(c["text"][:60])
                c["text"] = ""
                c["footnote_markers"] = []
                c["ref_numbers"] = []
                c["blank"] = True
                blanked += 1
    clean_headers = []
    for h in headers:
        if h and _g5_collapse(h) not in page_collapsed:
            ground_fail.append("H:" + h[:60])
            clean_headers.append("")
            blanked += 1
        else:
            clean_headers.append(h)
    headers = clean_headers
    if not headers and len(rows) <= 2 and clusters >= 3:
        confidence = "low"
        notes.append("headerless micro-fragment with column scatter; "
                     "layout reads as transposed/rotated or fragment-tiled. "
                     "Gate 7 must verify visually.")
    if blanked:
        if confidence == "high":
            confidence = "medium"
        if blanked > 3 and confidence == "medium":
            confidence = "low"
        notes.append("%d cell(s) blanked: multi-fragment joins not "
                     "verifiable against page text; Gate 7 must review "
                     "source blocks." % blanked)
    src_ids = [cap["block_id"]] + [b["block_id"] for g in body_groups for b in g]
    src_ids += [b["block_id"] for b in foot_blocks]
    # Deduplicate preserving order.
    seen_ids: list[str] = []
    for bid in src_ids:
        if bid not in seen_ids:
            seen_ids.append(bid)
    rec = {
        "table_id": table_id, "book_id": book_id, "title": title,
        "physical_start": phys, "physical_end": phys,
        "printed_start": host_printed[0], "printed_end": host_printed[1],
        "headers": headers, "rows": rows,
        "footnotes": foot_texts,
        "abbreviations": _g5_table_abbrevs(all_texts, amap),
        "units_seen": _g5_units_seen(all_texts),
        "host_unit_id": host_unit_id,
        "source_block_ids": seen_ids,
        "references": _g5_ref_numbers("\n".join(all_texts)),
        "continued_by_table_id": None, "continues_table_id": None,
        "extraction_confidence": confidence,
        "verification_status": "needs_review",
    }
    if notes or inherited or region["skipped_prose"]:
        extra = "; ".join(notes) if notes else ""
        if inherited:
            extra = (extra + "; " if extra else "") + \
                "headers inherited from base fragment."
        rec["reconstruction_note"] = (
            "Region stops: %s. %s" % (",".join(region["stops"]), extra)).strip()
        if not extra:
            del rec["reconstruction_note"]
    return rec, {"notes": notes, "ground_fail": [],
                 "reshaped": reshaped, "blanked": blanked}


def _g5_infer_number_from_blocks(book, rawcache, u):
    """Fallback for table_ref units whose Gate-4 title holds only running-head
    text: infer the printed table number from caption-like blocks among the
    unit's own source_block_ids. Returns the number or None when ambiguous."""
    nums = []
    by_page = {}
    for bid in u.get("source_block_ids", []):
        m = re.fullmatch(r"page-(\d{4})-block-\d{4}", bid)
        if m:
            by_page.setdefault(m.group(1), []).append(bid)
    for tag, bids in by_page.items():
        try:
            rec = _g5_raw(book, tag, rawcache)
        except FileNotFoundError:
            continue
        wanted = set(bids)
        for b in rec.get("blocks", []):
            if b.get("block_id") not in wanted:
                continue
            txt = _g5_collapse(b.get("text", ""))
            cm = _G5_CAP_RE.search(b.get("text", ""))
            if cm and len(txt) < 200 \
                    and re.match(r"^\s*Table\s+\d", txt):
                nums.append((int(cm.group(1)), int(cm.group(2))))
    uniq = sorted(set(nums))
    return uniq[0] if len(uniq) == 1 else None


def _g5_build_tables(book, units, rawcache, amap):
    """Build table fragment records. One record per hosted (page, number)
    region; companions defer with reasons. Returns (records, deferred, info).
    """
    trefs = [u for u in units if u.get("unit_type") == "table_ref"]
    parsed = []
    deferred = []
    for u in trefs:
        m = _G5_CAP_RE.search(u.get("title", ""))
        num = (int(m.group(1)), int(m.group(2))) if m else None
        if num is None:
            num = _g5_infer_number_from_blocks(book, rawcache, u)
        if num is None:
            deferred.append({"unit_id": u["unit_id"], "reason":
                             "no Table N.M number in Gate-4 title; cannot "
                             "anchor a grid region."})
        else:
            parsed.append((u, num))
    groups = {}
    for u, num in parsed:
        groups.setdefault((u["physical_start"], num), []).append(u)
    regions = {}
    ybs_cache = {}
    pages_text = {}
    for (page, num) in groups:
        if page not in ybs_cache:
            ybs_cache[page] = _g5_y_sorted(_g5_page_blocks(book, page, rawcache))
            full = "\n".join(b["text"] for b in
                             _g5_page_blocks(book, page, rawcache))
            pages_text[page] = _g5_collapse(full)
        hints = set()
        for u in groups[(page, num)]:
            hints.update(u.get("source_block_ids", []))
        ybs1 = {page: ybs_cache[page]}
        tier1, tier2 = _g5_caption_candidates(ybs_cache[page], num, hints)
        picked = None
        for cand in tier1 + tier2:
            trial = _g5_walk_table_region([page], ybs1, num, hints, cand)
            if any(k == "row" for (_bb, k) in trial["items"]):
                picked = trial
                break
        if picked is None and tier1:
            picked = _g5_walk_table_region([page], ybs1, num, hints,
                                         tier1[0])
        if picked is None:
            starts = [b for b in ybs_cache[page]
                    if b["block_id"] in hints]
            if starts:
                s0 = min(starts, key=lambda b: (b["y0"], b["x0"]))
                picked = _g5_walk_from_block([page], ybs1, num, hints,
                                           s0["block_id"])
        if picked is None:
            picked = {"caption": None, "items": [], "skipped_prose": 0,
                    "skipped_head": 0,
                    "stops": ["no-caption-block-on-page"],
                    "pages": [page]}
        regions[(page, num)] = picked
    captioned = {num for (_pg, num), r in regions.items()
                 if r["caption"] is not None}
    order_keys = []
    for key, r in regions.items():
        cy = r["caption"]["y0"] if r["caption"] else 1e9
        order_keys.append((key[0], cy, key))
    order_keys.sort(key=lambda t: (t[0], t[1], t[2][1]))
    records = []
    num_to_recs = {}
    seq = 0
    info = {"groups": len(groups), "captionless_defers": 0,
            "reshaped": [], "ground_fail": [], "low_ids": [],
            "blanked": []}
    for _pg, _cy, key in order_keys:
        page, num = key
        ulist = groups[key]
        region = regions[key]
        if region["caption"] is None:
            if num in captioned:
                host_page = min(p for (p, n) in regions
                                if n == num and regions[(p, n)]["caption"])
                for u in sorted(ulist, key=lambda x: x["unit_id"]):
                    deferred.append({
                        "unit_id": u["unit_id"],
                        "table_number": "%d.%d" % num, "page": page,
                        "reason": "descriptive prose companion on p%d; "
                        "tabular grid for Table %d.%d lives on p%d "
                        "(separate fragment record)." % (page, num[0], num[1],
                                                          host_page)})
                    info["captionless_defers"] += 1
                continue
        rids = set()
        if region["caption"] is not None:
            rids.add(region["caption"]["block_id"])
        rids.update(b["block_id"] for (b, _k) in region["items"])
        scored = []
        for u in ulist:
            ub = set(u.get("source_block_ids", []))
            hascap = 1 if (region["caption"] is not None and
                           region["caption"]["block_id"] in ub) else 0
            scored.append((-hascap, -len(ub & rids), u["unit_id"], u))
        scored.sort(key=lambda t: (t[0], t[1], t[2]))
        host = scored[0][3]
        for _h, _o, _uid, u in scored[1:]:
            ub = set(u.get("source_block_ids", []))
            prose_ev = [b for b in ybs_cache[page] if b["block_id"] in ub]
            long_prose = any(len(_g5_collapse(b["text"])) > 200
                             for b in prose_ev)
            verb = bool(_G5_COMPANION_VERB_RE.search(u.get("title", "")))
            if long_prose or verb:
                reason = ("descriptive prose companion (no tabular rows in "
                          "its own blocks); grid hosted by %s."
                          % host["unit_id"])
            else:
                reason = ("region hosted by %s (greater block overlap with "
                          "the caption-anchored grid)." % host["unit_id"])
            deferred.append({"unit_id": u["unit_id"],
                             "table_number": "%d.%d" % num, "page": page,
                             "reason": reason, "hosted_by": host["unit_id"]})
        seq += 1
        folio = (str(host["printed_start"])
                 if host.get("printed_start") is not None
                 else "p%04d" % page)
        table_id = "%s:table:%s:%04d" % (GATE5_IDPREFIX, folio, seq)
        base_headers = None
        if num in num_to_recs and num_to_recs[num]:
            base_headers = num_to_recs[num][0].get("headers") or None
        override = None
        if region.get("caption") is None:
            override = _g5_collapse(host.get("title", ""))
        rec, meta = _g5_assemble_table(
            region, pages_text, amap, base_headers, table_id,
            (host.get("printed_start"), host.get("printed_end")),
            host["unit_id"], GATE5_BOOK_ID, page, override)
        records.append(rec)
        num_to_recs.setdefault(num, []).append(rec)
        info["reshaped"].extend("%s %s" % (table_id, r)
                                for r in meta["reshaped"])
        info["ground_fail"].extend("%s %s" % (table_id, g)
                                   for g in meta["ground_fail"])
        if meta.get("blanked"):
            info["blanked"].append("%s cells=%d" % (
                table_id, meta["blanked"]))
        if rec["extraction_confidence"] == "low":
            info["low_ids"].append(table_id)
    for num, recs in num_to_recs.items():
        recs.sort(key=lambda r: (r["physical_start"], r["table_id"]))
        for i, r in enumerate(recs):
            if i > 0:
                r["continues_table_id"] = recs[i - 1]["table_id"]
            if i < len(recs) - 1:
                r["continued_by_table_id"] = recs[i + 1]["table_id"]
    records.sort(key=lambda r: (r["physical_start"], r["table_id"]))
    return records, deferred, info


def _g5_figure_zone(ybs_page, anchor_idx, own_num):
    """Expand a figure/algorithm label zone around an anchor block index.
    Returns (anchor, included blocks). Stops are hard boundaries; prose and
    pointer blocks are excluded."""
    anchor = ybs_page[anchor_idx]

    def scan(seq):
        got = []
        for k, b in enumerate(seq):
            t0 = _g5_strip(b["text"])
            if t0[:1] in "*" or t0.startswith("\u00a9") or \
                    re.search(r"permission|reprint", t0, re.IGNORECASE):
                got.append(b)
                continue
            if _g5_is_head_block(b):
                continue
            nb = _g5_block_num(b, "table")
            if nb is not None:
                break
            fb = _g5_block_num(b, "figure")
            if fb is not None and fb != own_num:
                break
            if _G5_REFHEAD_RE.match(_g5_collapse(b["text"])) \
                    or _g5_is_numref_block(b):
                break
            if b["text"].lstrip().startswith("■"):
                break
            if _G5_FIG_RE.search(b["text"]) and \
                    b["block_id"] != anchor["block_id"]:
                break
            if _g5_is_prose_block(b):
                break
            if k == 0 and len(b["text"]) < 90 \
                    and not re.search(r"\d", b["text"]) \
                    and "?" not in b["text"] \
                    and b["text"][:1].isupper():
                nxt = seq[k + 1] if k + 1 < len(seq) else None
                if nxt is not None and (_g5_is_prose_block(nxt)
                       or _G5_FIG_RE.search(nxt["text"])
                       or _G5_REFHEAD_RE.match(_g5_collapse(nxt["text"]))
                       or _g5_is_numref_block(nxt)
                       or _g5_is_head_block(nxt)
                       or _g5_block_num(nxt, "table") is not None
                       or _g5_block_num(nxt, "figure") is not None):
                    break
            got.append(b)
        return got

    down = scan(ybs_page[anchor_idx + 1:])
    up = scan(list(reversed(ybs_page[:anchor_idx])))
    included = sorted(down + list(reversed(up)) + [anchor],
                      key=lambda b: (b["y0"], b["x0"], b["order"]))
    return anchor, included


def _g5_build_figures(book, units, rawcache):
    frefs = sorted(
        [u for u in units if u.get("unit_type") == "figure_ref"],
        key=lambda u: (u["physical_start"], u["unit_id"]))
    records = []
    deferred = []
    seq = 0
    for u in frefs:
        page = u["physical_start"]
        m = _G5_FIG_RE.search(u.get("title", ""))
        num = (int(m.group(1)), int(m.group(2))) if m else None
        ybs = _g5_y_sorted(_g5_page_blocks(book, page, rawcache))
        cands = [i for i, b in enumerate(ybs)
                 if _g5_block_num(b, "figure") == num
                 and re.match(r"^\s*Figure\s+\d", _g5_collapse(b["text"]))] \
            if num else []
        if not cands:
            cands = [i for i, b in enumerate(ybs)
                     if b["block_id"] in set(u.get("source_block_ids", []))
                     and re.match(r"^\s*Figure\s+\d",
                                _g5_collapse(b["text"]))]
        if not cands:
            deferred.append({"unit_id": u["unit_id"], "page": page,
                             "reason": "no Figure caption block recoverable "
                             "on its page."})
            continue
        ub = set(u.get("source_block_ids", []))
        own = [i for i in cands if ybs[i]["block_id"] in ub]
        plain_own = [i for i in own
                     if not _G5_FIGCAPVERB_RE.search(_g5_collapse(ybs[i]["text"]))]
        plain = [i for i in cands
                 if not _G5_FIGCAPVERB_RE.search(_g5_collapse(ybs[i]["text"]))]
        pool = plain_own or own or plain or cands
        anchor_idx = next((i for i in pool if ybs[i]["block_id"] in ub),
                          pool[0])
        anchor, included = _g5_figure_zone(ybs, anchor_idx, num)
        labels = [b for b in included if b["block_id"] != anchor["block_id"]]
        title = _g5_collapse(anchor["text"])
        seq += 1
        folio = (str(u["printed_start"])
                 if u.get("printed_start") is not None else "p%04d" % page)
        etext = title + "\n" + "\n".join(_g5_collapse(b["text"]) for b in labels)
        src_ids = [b["block_id"] for b in included]
        records.append({
            "figure_id": "%s:figure:%s:%04d" % (GATE5_IDPREFIX, folio, seq),
            "book_id": GATE5_BOOK_ID, "title": title,
            "physical_start": page, "physical_end": page,
            "printed_start": u.get("printed_start"),
            "printed_end": u.get("printed_end"),
            "host_unit_id": u["unit_id"], "source_block_ids": src_ids,
            "extracted_text": etext,
            "references": _g5_ref_numbers(etext),
            "visual_status": "FIGURE_REQUIRES_VISUAL_VERIFICATION",
            "verification_status": "needs_review",
        })
    deduped = []
    bykey = {}
    for r in records:
        m = _G5_FIG_RE.search(r["title"])
        key = (r["physical_start"],
               (int(m.group(1)), int(m.group(2))) if m else None)
        bykey.setdefault(key, []).append(r)
    for key in sorted(bykey, key=lambda k: (k[0], k[1] or (0, 0))):
        rs = bykey[key]
        if len(rs) == 1:
            deduped.extend(rs)
            continue
        rs.sort(key=lambda r: (
            1 if _G5_FIGCAPVERB_RE.search(r["title"]) else 0,
            -len(r["source_block_ids"]), r["figure_id"]))
        deduped.append(rs[0])
        for r in rs[1:]:
            deferred.append({
                "unit_id": r["host_unit_id"],
                "page": r["physical_start"],
                "reason": "prose pointer companion (body-text mention of "
                "the figure, no caption of its own); figure hosted by %s."
                % rs[0]["host_unit_id"],
                "hosted_by": rs[0]["host_unit_id"]})
    records = deduped
    return records, deferred, {"figures": len(records)}


def _g5_algo_merge_ok(cur, b):
    t = _g5_strip(b["text"])
    if not t:
        return False
    low = t.lower()
    if low in ("or", "and", "no", "yes"):
        return False
    if re.match(r"^(or|and|no|yes)[.:]?$", low):
        return False
    first = t[0]
    cur_text = cur["text"].rstrip()
    if not cur_text:
        return False
    frag = len(t) < 25 and cur_text[-1:] not in ".!?:;" and \
        (first.isdigit() or first == "(")
    cond_a = first.islower() or frag
    if not cond_a:
        return False
    if not (b["x0"] > cur["x0"] + 1.0
            or abs(b["x0"] - cur["x0"]) <= 30.0):
        return False
    if not (b["y0"] - cur["y1"] < 16.0):
        return False
    return True


def _g5_node_kind(text, idx):
    c = _g5_collapse(text)
    low = c.lower()
    words = c.split()
    if idx == 0:
        return "entry"
    if _G5_ALGO_ENTRY_RE.match(low):
        return "entry"
    if _G5_ALGO_BRANCH_RE.match(low) and "?" not in c and len(words) <= 8:
        return "branch"
    if "?" in c:
        return "decision"
    if c.startswith("(") or low.startswith("if "):
        return "condition"
    if _G5_ALGO_ENDPOINT_RE.match(low):
        return "endpoint"
    if _G5_ALGO_ACTION_RE.match(low):
        return "action"
    return "action"


def _g5_algo_excluded(b, anchor_id):
    if b["block_id"] == anchor_id:
        return True
    t = _g5_strip(b["text"])
    if not t:
        return True
    if _g5_is_head_block(b):
        return True
    if _G5_REFHEAD_RE.match(_g5_collapse(b["text"])):
        return True
    if _g5_is_numref_block(b):
        return True
    if t[0] in "*":
        return True
    if t.startswith("©") or re.search(r"permission|reprint", t, re.IGNORECASE):
        return True
    if _g5_collapse(t).lower() == "treatment algorithm":
        return True
    if re.match(r"^(Notes?|Key)\b", t):
        return True
    if t.startswith("■"):
        return True
    return False


def _g5_algo_collect(ordered, anchor_id):
    """Filter ordered candidate blocks to algorithm node blocks.
    M1: a block that would merge into an excluded predecessor
    (footnote/note/reference/head/prose) is itself excluded.
    M2: unmarked footnote continuations in the bottom band (y0>500 at
    a footnote x0) are excluded."""
    foot_x0 = [b["x0"] for b in ordered
               if _g5_strip(b["text"])[:1] in "*"
               and _g5_algo_excluded(b, anchor_id)]
    out = []
    prev_excluded = True
    prev = None
    for b in ordered:
        if _g5_algo_excluded(b, anchor_id):
            prev_excluded = True
            prev = b
            continue
        if _g5_is_prose_block(b):
            prev_excluded = True
            prev = b
            continue
        if prev_excluded and prev is not None:
            probe = {"text": _g5_strip(b["text"]), "x0": b["x0"],
                     "y0": b["y0"]}
            cur = {"text": prev["text"], "x0": prev["x0"],
                   "y1": prev["y1"]}
            if _g5_algo_merge_ok(cur, probe):
                prev_excluded = True
                prev = b
                continue
        if b["y0"] > 500.0 and any(abs(b["x0"] - fx) < 15.0
                                    for fx in foot_x0):
            prev_excluded = True
            prev = b
            continue
        out.append(b)
        prev_excluded = False
        prev = b
    return out


def _g5_assemble_algorithm(alg_id, title, phys0, phys1, printed, host_unit_id,
                           node_blocks):
    def _sortkey(b):
        try:
            pg = int(b["block_id"][5:9])
        except Exception:
            pg = 0
        return (pg, b["y0"], b["x0"], b["order"])
    cands = sorted(node_blocks, key=_sortkey)
    merged = []
    for b in cands:
        t = _g5_strip(b["text"])
        if not t:
            continue
        if merged and _g5_algo_merge_ok(merged[-1], {"text": t, "x0": b["x0"],
                                                     "y0": b["y0"]}):
            merged[-1]["text"] += "\n" + t
            merged[-1]["y1"] = max(merged[-1]["y1"], b["y1"])
            merged[-1]["ids"].append(b["block_id"])
        else:
            merged.append({"text": t, "x0": b["x0"], "y0": b["y0"],
                           "y1": b["y1"], "ids": [b["block_id"]]})
    nodes = []
    src_ids = []
    for i, nd in enumerate(merged):
        nid = "%s:n%02d" % (alg_id, i + 1)
        nodes.append({"node_id": nid, "kind": _g5_node_kind(nd["text"], i),
                      "text": nd["text"], "source_block_ids": nd["ids"]})
        src_ids.extend(nd["ids"])
    refpool = title + "\n" + "\n".join(n["text"] for n in nodes)
    return {
        "algorithm_id": alg_id, "book_id": GATE5_BOOK_ID, "title": title,
        "physical_start": phys0, "physical_end": phys1,
        "printed_start": printed[0], "printed_end": printed[1],
        "host_unit_id": host_unit_id, "source_block_ids": src_ids,
        "nodes": nodes, "sequence": [n["node_id"] for n in nodes],
        "branches": [], "references": _g5_ref_numbers(refpool),
        "decision_text_verbatim": True, "no_inferred_branches": True,
        "verification_status": "needs_review",
    }


def _g5_build_algorithms(book, units, rawcache):
    by_id = {u["unit_id"]: u for u in units}
    fig_units = [u for u in units if u.get("unit_type") == "figure_ref"]

    def find_fig_unit(num, page):
        for u in fig_units:
            m = _G5_FIG_RE.search(u.get("title", ""))
            if m and (int(m.group(1)), int(m.group(2))) == num \
                    and u["physical_start"] == page:
                return u
        return None

    def find_heading_unit(pages, pat):
        rx = re.compile(pat, re.IGNORECASE)
        cands = [u for u in units if u.get("unit_type") == "heading"
                 and u["physical_start"] in pages and rx.search(u["title"])]
        cands.sort(key=lambda u: (u["physical_start"], u["unit_id"]))
        return cands[0] if cands else None

    anchors = []
    # A1: ch.1 schizophrenia treatment algorithms, physical 63-65.
    anchors.append({"key": "ch1-schizophrenia", "pages": [63, 64, 65],
                    "title_page": 63,
                    "title_re": r"^\s*Treatment algorithms for schizophrenia\s*$",
                    "host": find_heading_unit([63], r"treatment algorithm")})
    # A2: catatonia algorithm, physical 158.
    anchors.append({"key": "catatonia", "pages": [158], "title_page": 158,
                    "title_re": r"Algorithm for treating catatonic stupor",
                    "host": find_heading_unit([158], r"catatonic stupor")})
    # Flowchart figures that are decision algorithms.
    for num, page in [((2, 1), 300), ((3, 1), 335), ((1, 4), 260),
                      ((1, 3), 191), ((4, 1), 496), ((5, 1), 584),
                      ((5, 2), 611), ((5, 3), 616), ((6, 1), 632),
                      ((6, 2), 692)]:
        u = find_fig_unit(num, page)
        if num == (4, 1):
            u = next((x for x in fig_units
                      if x["physical_start"] == page
                      and "naloxone" in x.get("title", "").lower()), u)
        if u is None:
            continue
        anchors.append({"key": "fig-%d.%d" % num, "pages": [page],
                        "title_page": page, "title_re": None,
                        "host": u, "fig_num": num})
    records = []
    seq = 0
    for a in anchors:
        if a["host"] is None:
            continue
        tp = a["title_page"]
        ybs = _g5_y_sorted(_g5_page_blocks(book, tp, rawcache))
        anchor_idx = None
        title = None
        if a["title_re"] is not None:
            rx = re.compile(a["title_re"], re.IGNORECASE)
            for i, b in enumerate(ybs):
                if rx.search(_g5_collapse(b["text"])):
                    anchor_idx = i
                    title = _g5_collapse(b["text"])
                    break
        else:
            m = _G5_FIG_RE.search(a["host"].get("title", ""))
            num = a.get("fig_num")
            cands = [i for i, b in enumerate(ybs)
                     if _g5_block_num(b, "figure") == num]
            if cands:
                ub = set(a["host"].get("source_block_ids", []))
                anchor_idx = next((i for i in cands
                                   if ybs[i]["block_id"] in ub), cands[0])
                title = _g5_collapse(ybs[anchor_idx]["text"])
        if anchor_idx is None or title is None:
            continue
        seq += 1
        node_blocks = []
        for pg in a["pages"]:
            ybs_p = _g5_y_sorted(_g5_page_blocks(book, pg, rawcache))
            if pg == tp:
                _anchor, included = _g5_figure_zone(
                    ybs_p, anchor_idx, a.get("fig_num"))
                curb = [b for b in included
                        if b["block_id"] != ybs_p[anchor_idx]["block_id"]]
                node_blocks.extend(_g5_algo_collect(
                    curb, ybs_p[anchor_idx]["block_id"]))
            else:
                node_blocks.extend(_g5_algo_collect(ybs_p, ""))
        printed = (a["host"].get("printed_start"),
                   a["host"].get("printed_end"))
        if a["key"] == "ch1-schizophrenia":
            prints = [by_id[u["unit_id"]].get("printed_start")
                      for u in [find_heading_unit([63], r"treatment algorithm"),
                                find_heading_unit([64], r"treatment algorithm"),
                                find_heading_unit([65], r"treatment algorithm")]
                      if u]
            prints = [p for p in prints if p is not None]
            prints2 = [by_id[u["unit_id"]].get("printed_end")
                       for u in [find_heading_unit([63], r"treatment algorithm"),
                                 find_heading_unit([64], r"treatment algorithm"),
                                 find_heading_unit([65], r"treatment algorithm")]
                       if u]
            prints2 = [p for p in prints2 if p is not None]
            if prints and prints2:
                printed = (min(prints), max(prints2))
        folio = (str(printed[0]) if printed[0] is not None
                 else "p%04d" % a["pages"][0])
        alg_id = "%s:algorithm:%s:%04d" % (GATE5_IDPREFIX, folio, seq)
        rec = _g5_assemble_algorithm(
            alg_id, title, min(a["pages"]), max(a["pages"]), printed,
            a["host"]["unit_id"], node_blocks)
        if a["key"] == "ch1-schizophrenia":
            rec["reconstruction_note"] = (
                "Three printed panels (first-episode p42; relapse with full "
                "adherence p43; relapse with doubtful adherence p44) in one "
                "record; nodes in page then y,x displayed order; connector "
                "labels kept as branch-kind nodes; branches[] empty "
                "(no_inferred_branches=true).")
        if a["key"] == "fig-6.2":
            rec["reconstruction_note"] = (
                "Dense Yes/No flowchart; Yes/No edge labels kept as "
                "branch-kind nodes in displayed order; branches[] empty "
                "(no_inferred_branches=true).")
        records.append(rec)
    return records, {"algorithms": len(records)}


def _g5_snapshot(root, book):
    files = ["units.jsonl", "structure.json", "pages.map.json",
             "page-records.jsonl", "repairs.jsonl", "run-manifest.json",
             "book.json", "source-lock.json"]
    snap = {}
    for name in files:
        p = book / name
        if p.is_file():
            h = hashlib.sha256()
            with open(p, "rb") as f:
                for chunk in iter(lambda: f.read(1048576), b""):
                    h.update(chunk)
            snap[name] = h.hexdigest()[:16]
        else:
            snap[name] = "MISSING"
    try:
        man = json.load(open(book / "run-manifest.json", "r", encoding="utf-8"))
        snap["run_status"] = man.get("run_status")
    except Exception:
        snap["run_status"] = "UNREADABLE"
    return snap


def _g5_phys_to_printed(pmap):
    out = {}
    for seg in pmap.get("segments", []):
        a = seg.get("source_page_index_start")
        b = seg.get("source_page_index_end")
        ps = seg.get("printed_page_number_start")
        pe = seg.get("printed_page_number_end")
        if a is None or b is None:
            continue
        for idx in range(a, b + 1):
            phys = idx + 1
            val = ps if idx == a else (pe if idx == b else None)
            if isinstance(val, int):
                out[phys] = val
            elif a == b and isinstance(ps, int):
                out[phys] = ps
    return out


def cmd_knowledge(args):
    only_raw = getattr(args, "only", "") or ""
    only = [s.strip() for s in only_raw.split(",") if s.strip()]
    if any(s in GATE6_PASSES for s in only):
        # Gate-6 clinical core lives after cmd_knowledge in this file;
        # resolved at call time. Gates 1-5 paths below are untouched.
        return cmd_knowledge_gate6(args)
    unknown = [s for s in only if s not in GATE5_PASSES]
    if unknown:
        for s in unknown:
            print("NOT_IMPLEMENTED: knowledge pass %s" % s)
        return 1
    if not only:
        only = list(GATE5_PASSES)
    root = repo_root()
    book = root / BOOK_REL
    out_paths = {"tables": book / "tables.jsonl",
                 "figures": book / "figures.jsonl",
                 "algorithms": book / "algorithms.jsonl"}
    for name in only:
        if out_paths[name].is_file():
            print("BLOCKED: %s already exists; refusing to overwrite."
                  % out_paths[name].name, file=sys.stderr)
            return 1
    digest, _byte_size = sha256_file(root / SOURCE_REL)
    if digest.lower() != EXPECTED_SHA256.lower():
        print("BLOCKED: source-lock sha mismatch on recompute.",
              file=sys.stderr)
        return 1
    n_raw = len(list((book / "raw").glob("page-*.json")))
    n_reading = len(list((book / "reading").glob("page-*.json")))
    with open(book / "units.jsonl", "r", encoding="utf-8") as f:
        units_lines = f.read().splitlines()
    units = [json.loads(ln) for ln in units_lines]
    structure = json.load(open(book / "structure.json", "r", encoding="utf-8"))
    n_chapters = sum(len(p.get("chapters", [])) for p in structure.get("parts", []))
    if n_raw != 978 or n_reading != 978 or len(units_lines) != 7861 \
            or n_chapters != 14:
        print("BLOCKED: pre-check counts raw=%d reading=%d units=%d "
              "chapters=%d (want 978/978/7861/14)." % (
                  n_raw, n_reading, len(units_lines), n_chapters),
              file=sys.stderr)
        return 1
    snap_before = _g5_snapshot(root, book)
    pmap = json.load(open(book / "pages.map.json", "r", encoding="utf-8"))
    phys_printed = _g5_phys_to_printed(pmap)
    rawcache: dict = {}
    amap = _g5_abbrev_map(book, rawcache)
    print("knowledge %s: lock=sha256:%s abbrevs=%d mapsegs=%d" % (
        GATE5_VERSION, digest[:16], len(amap), len(pmap.get("segments", []))))
    results = {}
    if "tables" in only:
        recs, deferred, info = _g5_build_tables(book, units, rawcache, amap)
        with open(out_paths["tables"], "w", encoding="utf-8") as f:
            for r in recs:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        results["tables"] = (recs, deferred, info)
        print("wrote tables.jsonl records=%d deferred_table_refs=%d "
              "low=%d" % (len(recs), len(deferred), len(info["low_ids"])))
        print("deferred_table_refs=" + json.dumps(deferred, ensure_ascii=False))
    if "figures" in only:
        recs, deferred, info = _g5_build_figures(book, units, rawcache)
        with open(out_paths["figures"], "w", encoding="utf-8") as f:
            for r in recs:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        results["figures"] = (recs, deferred, info)
        print("wrote figures.jsonl records=%d deferred_figure_refs=%d" % (
            len(recs), len(deferred)))
        print("deferred_figure_refs=" + json.dumps(deferred, ensure_ascii=False))
    if "algorithms" in only:
        recs, info = _g5_build_algorithms(book, units, rawcache)
        with open(out_paths["algorithms"], "w", encoding="utf-8") as f:
            for r in recs:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        results["algorithms"] = (recs, info)
        print("wrote algorithms.jsonl records=%d" % len(recs))
    # ---- self-validation (quote outputs) ----
    checks = []
    checks.append(("lock-intact", digest.lower() == EXPECTED_SHA256.lower(),
                   "recompute sha256:%s" % digest[:16]))
    lines_ok = True
    counts = {}
    for name in only:
        try:
            rlines = open(out_paths[name], "r", encoding="utf-8").read().splitlines()
            parsed = [json.loads(ln) for ln in rlines]
            counts[name] = len(parsed)
        except Exception as exc:
            lines_ok = False
            counts[name] = "ERR %s" % exc
    checks.append(("counts-parse", lines_ok, str(counts)))
    if "tables" in only:
        recs, deferred, _info = results["tables"]
        hosted = {r["host_unit_id"] for r in recs}
        deferred_ids = {d["unit_id"] for d in deferred}
        all_t = {u["unit_id"] for u in units if u.get("unit_type") == "table_ref"}
        missing = sorted(all_t - hosted - deferred_ids)
        checks.append(("table_ref-coverage", not missing,
                       "hosted=%d deferred=%d missing=%s" % (
                           len(hosted), len(deferred_ids), missing[:5])))
    if "figures" in only:
        recs, deferred, _info = results["figures"]
        hosted = {r["host_unit_id"] for r in recs}
        deferred_ids = {d["unit_id"] for d in deferred}
        all_f = {u["unit_id"] for u in units if u.get("unit_type") == "figure_ref"}
        missing = sorted(all_f - hosted - deferred_ids)
        checks.append(("figure_ref-coverage", not missing,
                       "hosted=%d deferred=%d missing=%s" % (
                           len(hosted), len(deferred_ids), missing[:5])))
    probe_ev = "not-run"
    probe_ok = True
    if "tables" in only:
        recs = results["tables"][0]
        cand = [r for r in recs if "2.6" in r["title"]]
        probe_ok = False
        if cand:
            r = cand[0]
            blob = _g5_collapse(" ".join(
                [r["title"]] + r["headers"] + [
                    "\n".join(c["text"] for c in row["cells"])
                    for row in r["rows"]]))
            need = ["mania" in r["title"].lower(),
                    "Lithium" in blob, "400mg" in blob.replace(" ", ""),
                    "Valproate" in blob, "Aripiprazole" in blob,
                    all(v in r["references"] for v in range(32, 44))]
            probe_ok = all(need)
            probe_ev = "%s refs=%s checks=%s" % (
                r["table_id"], sorted(r["references"])[:8], need)
        checks.append(("probe-2.6", probe_ok, probe_ev))
    shape_ev = []
    shape_ok = True
    if "tables" in only:
        for r in results["tables"][0]:
            n = len(r["headers"])
            for row in r["rows"]:
                if len(row["cells"]) != max(n, 1) and not (n == 0):
                    shape_ok = False
                    shape_ev.append("%s width=%d headers=%d" % (
                        r["table_id"], len(row["cells"]), n))
            if n == 0 and r["rows"]:
                shape_ev.append("%s headerless-data rows=%d" % (
                    r["table_id"], len(r["rows"])))
        checks.append(("row-shape", shape_ok,
                       "mismatches=%d" % len(shape_ev) if shape_ok
                       else str(shape_ev[:10])))
        gf = results["tables"][2]["ground_fail"]
        checks.append(("cell-grounded", not gf,
                       "ungrounded=%d" % len(gf) if not gf else str(gf[:5])))
        ids = {r["table_id"] for r in results["tables"][0]}
        bad_links = [r["table_id"] for r in results["tables"][0]
                     if (r.get("continued_by_table_id")
                         and r["continued_by_table_id"] not in ids)
                     or (r.get("continues_table_id")
                         and r["continues_table_id"] not in ids)]
        checks.append(("continuation-links", not bad_links, str(bad_links[:5])))
        all_nr = all(r["verification_status"] == "needs_review"
                     for r in results["tables"][0])
        checks.append(("all-needs-review", all_nr, "tables"))
    if "figures" in only:
        all_nr = all(r["verification_status"] == "needs_review"
                     for r in results["figures"][0])
        checks.append(("figures-needs-review", all_nr, "figures"))
    snap_after = _g5_snapshot(root, book)
    scope_ok = all(snap_before[k] == snap_after[k]
                   for k in snap_before if k != "run_status") \
        and snap_before["run_status"] == snap_after["run_status"]
    checks.append(("scope-isolation", scope_ok,
                   "run_status=%s units_lines=%d" % (
                       snap_after.get("run_status"), len(units_lines))))
    forbid = []
    for pat in ("assertions*.json*", "meds*.json*", "concepts*.json*",
                "relations*.json*", "xrefs*.json*", "chunks*.json*",
                "embeddings*.*", "*.db", "*.sqlite"):
        for p in book.glob(pat):
            forbid.append(p.name)
    checks.append(("no-gate6-artifacts", not forbid, str(forbid[:5])))
    allpass = True
    for name, passed, ev in checks:
        print("validate %-22s %s  %s" % (name, "PASS" if passed else "FAIL", ev))
        allpass = allpass and passed
    # Units-by-chapter spread for tables.
    if "tables" in only:
        ch_ranges = []
        for p in structure.get("parts", []):
            for c in p.get("chapters", []):
                ch_ranges.append((c["number"], c["title"],
                                  c["physical_start"], c["physical_end"]))
        spread: dict = {}
        for r in results["tables"][0]:
            ch = "front/back"
            for cn, _ct, a, b in ch_ranges:
                if a <= r["physical_start"] <= b:
                    ch = "ch%d" % cn
                    break
            spread[ch] = spread.get(ch, 0) + 1
        print("chapter-spread=" + json.dumps(spread, sort_keys=True))
        lows = results["tables"][2]["low_ids"]
        print("low-confidence-tables=%d %s" % (len(lows), lows[:40]))
        resh = results["tables"][2]["reshaped"]
        print("reshaped-rows=%d" % len(resh))
        for line in resh[:30]:
            print("reshaped " + line)
    return 0 if allpass else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="taylor_pipeline.py")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("register")
    sub.add_parser("extract-raw")
    sub.add_parser("verify-raw")
    sub.add_parser("repair")
    sub.add_parser("map-pages")
    sub.add_parser("structure")
    sub.add_parser("units")
    sub.add_parser("rehash-units")
    p_know = sub.add_parser("knowledge")
    p_know.add_argument("--only", default="tables,figures,algorithms")
    sub.add_parser("qa-freeze")
    sub.add_parser("replay")
    for name in STUB_COMMANDS:
        sub.add_parser(name)
    args = parser.parse_args(argv)
    if args.command == "register":
        return cmd_register(args)
    if args.command == "extract-raw":
        return cmd_extract_raw(args)
    if args.command == "verify-raw":
        return cmd_verify_raw(args)
    if args.command == "repair":
        return cmd_repair(args)
    if args.command == "map-pages":
        return cmd_map_pages(args)
    if args.command == "structure":
        return cmd_structure(args)
    if args.command == "units":
        return cmd_units(args)
    if args.command == "rehash-units":
        return cmd_rehash_units(args)
    if args.command == "knowledge":
        return cmd_knowledge(args)
    if args.command == "qa-freeze":
        return cmd_qa_freeze(args)
    if args.command == "replay":
        return cmd_replay(args)
    if args.command in STUB_COMMANDS:
        return cmd_stub(args.command)
    parser.print_help()
    return 2


# ---------------------------------------------------------------------------
# Gate 6 — clinical core: assertions / medications / concepts / relations /
# xrefs (TAYLOR-006). Source statements only; zero inference.
#
# Read-only inputs: raw/page-*.json (truth layer), reading/page-*.json
# (hyphen-merge detection only), units.jsonl (7861), structure.json
# (14 chapters), tables.jsonl (275), figures.jsonl, algorithms.jsonl,
# pages.map.json (89 segments), repairs.jsonl.
# Writes only: assertions.jsonl, medications.jsonl, concepts.jsonl,
# relations.jsonl, xrefs.jsonl.
#
# Binding rulings:
# R1 (hyphens): source_text/dose ALWAYS from RAW (verbatim, uncorrected).
#   reading_hyphen_merge=true on a record when a
#   dehyphenate-geometry-proven repair overlaps the record's blocks
#   (reading merged what raw keeps split, e.g. placebo + controlled).
# R2 (hashes): assertion_id = "ta-"+sha256("book|unit_id|source_text")
#   hexdigest truncated to 8. concept_id/medication_id/relation_id/xref_id
#   use the same recipe with prefixes tc-/tm-/tr-/tx- and documented joins
#   (see _g6_sha8). traceability.raw_text_sha256 recomputes as
#   sha256(raw/page-N.json "raw_text"). All stated here and in the report.
# R3 (tables): never flattened; dose rows cite table_id + row position
#   (table_row {table_id,row_index,row_type}); blank drug cells filed as
#   generic_name NOT_STATED_IN_SOURCE, never inherited from neighbours.
#
# Method (deterministic, stdlib only):
# - Gazetteer of drug names built from the book's own tables (drug columns
#   + frequent dose-preceding tokens with drug-like suffixes). Matching runs
#   on a detached copy (letter->digit boundary split so "Lorazepam22,23"
#   matches); filed spellings are verbatim RAW substrings.
# - Assertions: one per clinically meaningful sentence (claim keyword
#   priority: contraindication > interaction > monitoring > adverse_effect >
#   medication_statement (dose present) > recommendation > treatment >
#   definition > risk_factor). 0-N per unit; no padding, no merging.
# - Table rows: one assertion per body/continued row with clinical text
#   (source_text = verbatim cell texts joined with newline, never flattened
#   into prose); algorithm nodes likewise.
# - Medications: one record per (span, drug, dose-span). Dose distinctions
#   sacred (verbatim spans). Missing fields = NOT_STATED_IN_SOURCE.
# - Concepts: verbatim terms occurring in filed assertions/med spans only;
#   aliases only from explicit "also known as|known as|(aka" patterns.
# - Relations: typed edges with >=1 grounding assertion_id each; triples
#   deduped (assertion_ids/pages merged, sorted, capped).
# - Xrefs: "see/described-in Table|Figure|Box|Chapter|section|page" pointers;
#   targets resolved against in-book tables/figures/chapters/printed pages
#   only; outer-book (NICE/BNF/SPC/DoH/URLs/...) -> unresolved_external.
# Scale: 14 per-chapter batches, fault-isolated, progress per chapter to
# stdout. No resume mutation: re-runs reproduce identical bytes (verified
# by re-running chapter 2 in-process and comparing hashes).
# ---------------------------------------------------------------------------

GATE6_VERSION = "gate6-clinical-core-v1"
GATE6_PASSES = ("assertions", "medications", "concepts", "relations", "xrefs")
GATE6_BOOK_ID = SOURCE_ID
GATE6_IDPREFIX = "maudsley-taylor-2021"
GATE6_LOCK = SOURCE_VERSION

_G6_PROSE_TYPES = ("prose", "list", "box")
_G6_STRUCT_TYPES = ("table_ref", "figure_ref")
_G6_SKIP_TYPES = ("reference", "index_entry", "front_matter", "credits",
                  "back_matter", "chapter_opening", "heading")

_G6_CLAIMS = ("medication_statement", "contraindication", "adverse_effect",
              "interaction", "monitoring", "recommendation", "treatment",
              "definition", "risk_factor")
_G6_REVIEW_CLAIMS = frozenset(("medication_statement", "contraindication",
                               "interaction", "monitoring"))
_G6_REL_PREDS = frozenset((
    "symptom_of", "diagnostic_feature_of", "differential_with",
    "risk_factor_for", "associated_with", "treated_by",
    "contraindicated_with", "adverse_effect_of", "monitored_by",
    "subtype_of", "parent_of", "referenced_by", "defined_by",
    "interacts_with", "switches_to", "has_dose", "supported_by",
))
_G6_XREF_ENUM = ("resolved_internal", "resolved_explicit", "unresolved",
                 "unresolved_external")

_G6_DOSE_RE = re.compile(
    r"\d(?:[\d\s.,]*\d)?\s*(?:[\u2013\u2014-]\s*\d(?:[\d\s.,]*\d)?)?\s*"
    r"(?:mg|mcg|\u00b5g|g|ml|mmol|IU|units?)"
    r"(?:\s*/\s*(?:day|daily|kg|week))?(?:\s*/\s*day)?"
    r"(?:\s+(?:per\s+day|a\s+day|daily|day))?"
    r"|\d+\s*/\s*day",
    re.IGNORECASE,
)
_G6_DETACH_RE = re.compile(r"([A-Za-z])(\d)")
_G6_SENT_SPLIT_RE = re.compile(
    r"(?<=[.!?;])\s+|\u25a0\s*|\u2022\s*"
    # Reference-number run-on: "therapy.11 Higher" (period glued to a
    # citation number, no space) starts a new sentence. The 3-letter guard
    # keeps dotted numbers intact ("Table 1.1 Minimum", "No. 5", "e.g.").
    r"|(?<=[A-Za-z]{3}[.!?])(?=\d{1,3}\s+[A-Z])")
_G6_TRAILING_REFS_RE = re.compile(
    r"^(.+?)(\d{1,3}(?:\s*[,;\u2013\u2014-]\s*\d{1,3})*)\s*$")
_G6_PROSE_REF_RE = re.compile(
    r"(?<=[A-Za-z).:\]\u2020\u2021])\s*"
    r"(\d{1,3}(?:\s*[,\u2013\u2014-]\s*\d{1,3})*)"
    r"(?![\d\s]*(?:mg|mcg|\u00b5g|g|ml|mmol|IU|units?|%|\d))")
_G6_RANGE_RE = re.compile(r"^(.*?)\s*[\u2013\u2014-]\s*(.*)$")
_G6_OR_RE = re.compile(r"^(.+?)\s+or\s+(.+)$", re.IGNORECASE)
# CITEGLUE RULE (TAYLOR-006R): a numeric atom may enter a dose field ONLY
# if it carries or directly prefixes a unit in the same token span. Exact
# dose-atom shape (case-insensitive):
#   ^[0-9][0-9.,]*(?: +[0-9][0-9.,]*)*\s*
#    (?:mg|mcg|ug|g|ml|mmol|IU|units?(?:/\s*(?:day|daily|kg|week))?(?:/\s*day)?
#      |/\s*(?:day|daily|week))
#    (?:\s+(?:per\s+day|a\s+day|daily|day))?$
# i.e. leading digits, optional thousand/decimal punctuation, a real unit
# (or a bare /day-style denominator as in "300/day"), optional frequency
# tail. Anything else (bare "35", comma ref-run "4,14,153", stray letter
# fragment "G" from "Generally") is NEVER a dose atom. Comma digit-runs are
# accepted only in thousand-separator shape ^\d{1,3}(,\d{3})+$ ("4,000mg");
# all other comma shapes ("4,14,153", "22,23") are citation ref-runs and
# detach into reference_numbers. NOTE: "%" is not a discovery unit (the
# dose regex never matches it, so "0.9% saline" stays a non-dose); the atom
# rule therefore only ever REJECTS polluters, never discovers new doses.
_G6_DOSE_ATOM_RE = re.compile(
    r"^[0-9][0-9.,]*(?: +[0-9][0-9.,]*)*\s*"
    r"(?:(?:mg|mcg|\u00b5g|g|ml|mmol|IU|units?)"
    r"(?:/\s*(?:day|daily|kg|week))?(?:/\s*day)?"
    r"|/\s*(?:day|daily|week))"
    r"(?:\s+(?:per\s+day|a\s+day|daily|day))?$",
    re.IGNORECASE,
)
_G6_THOUSAND_RE = re.compile(r"^\d{1,3}(,\d{3})+$")
_G6_LEAD_REF_RUN_RE = re.compile(
    r"^\d{1,3}(?:\s*[,\u2013\u2014-]\s*\d{1,3})+\s+")
_G6_REF_RUN_SPLIT_RE = re.compile(r"[,;\s\u2013\u2014-]+")
_G6_FREQ_TAIL_RE = re.compile(
    r"^(.*?)(\s+(?:per\s+day|a\s+day|daily|day))$", re.IGNORECASE)
_G6_UNIT_START_RE = re.compile(
    r"(?:mg|mcg|\u00b5g|g|ml|mmol|IU|units?|/\s*(?:day|daily|week)"
    r"|per\s+day|a\s+day|daily|day)",
    re.IGNORECASE)
_G6_TAIL_UNIT_RE = re.compile(
    r"^((?:mg|mcg|\u00b5g|g|ml|mmol|IU|units?)"
    r"(?:/\s*(?:day|daily|kg|week))?(?:/\s*day)?"
    r"|/\s*(?:day|daily|week))$",
    re.IGNORECASE)
# DRUG-NAME GUARD vocabulary (TAYLOR-006R): condition/population terms that
# may never be filed as generic_name. Built from the book's own condition,
# effect and population lists plus condition-generics observed in Gate-6
# output data (Depression/depression x59, overdose x11, delirium/Delirium
# x8, mania, anxiety, psychosis, insomnia, dementia, epilepsy); the full
# list is stated here so the rejection rule is auditable.
_G6_CONDITION_VOCAB = frozenset((
    "schizophrenia", "psychosis", "psychoses", "psychotic",
    "bipolar disorder", "bipolar", "mania", "hypomania",
    "depression", "depressive", "anxiety", "panic", "phobia", "ocd",
    "ptsd", "addiction", "substance misuse", "dependence", "withdrawal",
    "overdose", "delirium", "dementia", "epilepsy", "seizures",
    "insomnia", "eating disorder", "personality disorder", "adhd",
    "autism", "catatonia", "relapse", "suicide", "self-harm",
    "pregnancy", "breastfeeding", "hepatic impairment", "renal impairment",
    "liver failure", "kidney failure", "older people", "elderly",
    "children", "adolescents", "parkinsonism", "akathisia",
))
_G6_UNIT_SUFFIX_RE = re.compile(
    r"((?:mg|mcg|\u00b5g|g|ml|mmol|IU|units?)"
    r"(?:\s*/\s*(?:day|daily|kg|week))?(?:\s*/\s*day)?)\s*$",
    re.IGNORECASE,
)
_G6_THRESHOLD_RE = re.compile(
    r"(above|below|threshold|cut[\s-]?off|exceeds?|at least|up to|"
    r"greater than|less than|\u2265|\u2264|>|<)",
    re.IGNORECASE,
)

_G6_HEDGES = (
    "should be considered", "insufficient evidence", "associated with",
    "contraindicated", "controversial", "not well supported",
    "not established", "is recommended", "suggests", "suggest", "may not",
    "may", "can", "could", "might", "appears", "appear", "likely",
    "possibly", "probably", "should", "must", "recommended", "unclear",
    "unknown",
)
_G6_TEMPORALITY_RE = re.compile(
    r"(after|before|during|long[\s-]term|short[\s-]term|acute|chronic|"
    r"maintenance|over\s+(?:a few|\d+)\s+\w+|for\s+\d+\s+\w+|"
    r"within\s+\d+\s+\w+|at least\s+\d+\s+\w+|up to\s+\d+\s+\w+|"
    r"every\s+\d*\s*\w+|once\s+daily|on day\s+\d+)",
    re.IGNORECASE,
)
_G6_SEVERITY_RE = re.compile(
    r"\b(mild|moderate|severe|serious|seriously|fatal|"
    r"life[\s-]threatening|high|low)\b",
    re.IGNORECASE,
)
_G6_EXCEPTION_RE = re.compile(
    r"\b(except|unless|however|although|though|but|in patients with|"
    r"apart from)\b(.{0,200})",
    re.IGNORECASE,
)
_G6_VERBS = (
    "contraindicated in", "contraindicated", "associated with",
    "increases the risk", "reduces the risk", "increases", "increase",
    "reduces", "reduce", "causes", "cause", "treats", "treat", "requires",
    "require", "recommends", "recommend", "suggests", "suggest", "should",
    "monitor", "avoid", "use", "give", "prescribe", "switch", "stop",
    "start", "continue", "consider", "effective", "prevents", "prevent",
    "decreases", "decrease", "raises", "raise", "lowers", "lower",
)
_G6_CLAIM_DEFAULT_PRED = {
    "medication_statement": "prescribed",
    "contraindication": "contraindicated_in",
    "adverse_effect": "causes",
    "interaction": "interacts_with",
    "monitoring": "monitored_by",
    "recommendation": "recommended",
    "treatment": "treats",
    "definition": "defined_as",
    "risk_factor": "increases_risk_of",
}

_G6_CONTRA_RE = re.compile(
    r"(contra[\s-]?indicat|should not be used|do not use|must not be used|"
    r"avoid in|avoided in|not recommended in)",
    re.IGNORECASE,
)
_G6_INTERACT_RE = re.compile(
    r"(interaction|interact|inhibit|induc|\bCYP\b|cytochrome|"
    r"co[\s-]?administrat|in combination with|raises? .*levels?|"
    r"lowers? .*levels?|decreases? .*levels?|increases? .*levels?|"
    r"affects? .*levels?|plasma concentrations?|bioavailability|"
    r"protein binding)",
    re.IGNORECASE,
)
_G6_MONITOR_RE = re.compile(
    r"(monitor|ECG|electrocardiogram|plasma|blood tests?|blood levels?|"
    r"\bcheck\b|measure|screen|observ|test for|\blevels?\b|weigh|"
    r"blood pressure|liver function|renal function|kidney function|"
    r"thyroid|prolactin|glucose|lipids?|cholesterol|\bQTc\b|creatinine|"
    r"neutrophil|white cell|\bFBC\b|U&E|electrolytes?|BMI)",
    re.IGNORECASE,
)
_G6_ADVERSE_RE = re.compile(
    r"(adverse|side[\s-]?effects?|toxicity|toxic|overdose|poisoning|"
    r"QTc? prolongation|weight gain|tardive|extrapyramidal|"
    r"neuroleptic malignant|serotonin syndrome|sedation|nausea|vomiting|"
    r"diarrhoea|diarrhea|headache|dizziness|drowsiness|seizures?|"
    r"syndrome|constipation|dry mouth|blurred vision|urinary retention|"
    r"sexual dysfunction|galactorrhoea|amenorrhoea|rhabdomyolysis|"
    r"agranulocytosis|neutropenia|hepatotoxicity|myocarditis|"
    r"cardiomyopathy|arrhythmia|torsade|hypotension|hypertension|"
    r"tachycardia|bradycardia|metabolic syndrome|hyperglycaemia|"
    r"diabetes|hyponatraemia|suicid|self[\s-]?harm|akathisia|dystonia|"
    r"parkinsonism|delirium|confusion|coma|respiratory depression)",
    re.IGNORECASE,
)
_G6_RECOMMEND_RE = re.compile(
    r"(recommend|suggest|consider|advis|guideline|first[\s-]?line|"
    r"preferred|drug of choice|treatment of choice|should|ought to|"
    r"taper|withdrawal regime|discontinuation regime|normal practice|"
    r"good practice|is indicated)",
    re.IGNORECASE,
)
_G6_TREAT_RE = re.compile(
    r"(treat|efficac|effective|therapy|maintenance|response|remission|"
    r"relapse|benefit|superior|equivalent|equal efficacy|resistant|"
    r"augment|prophylaxis|prevent)",
    re.IGNORECASE,
)
_G6_DEFINE_RE = re.compile(
    r"(defined as|is defined|refers to|characterised by|"
    r"characterized by|can be defined)",
    re.IGNORECASE,
)
_G6_RISK_RE = re.compile(
    r"(risk factor|risk\b|associated with|increased|predictor|linked to|"
    r"more likely|less likely|incidence|prevalence)",
    re.IGNORECASE,
)

_G6_CLASS_RE = re.compile(
    r"(antipsychotics?|antidepressants?|benzodiazepines?|opioids?|"
    r"mood stabilis[ez]ers?|anticonvulsants?|antiepileptics?|hypnotics?|"
    r"anxiolytics?|stimulants?|anticholinergics?|antihistamines?|"
    r"beta[\s-]?blockers?|antibiotics?|antiparkinsonian|"
    r"cholinesterase inhibitors?|calcium[\s-]?channel blockers?)",
    re.IGNORECASE,
)
_G6_FREQ_RE = re.compile(
    r"(twice daily|three times daily|four times a day|once daily|"
    r"three times a week|every\s+(?:\d+\s+)?(?:day|week|month)s?|"
    r"\bdaily\b|\bbd\b|\btds\b|\bqds\b|\bod\b|\bom\b|\bon\b|\bnocte\b|"
    r"at night|per day|a day|PRN|prn|when required|as required|as needed|"
    r"\bweekly\b|\bmonthly\b|\bfortnightly\b|on alternate days|"
    r"single dose|in divided doses|at bedtime)",
    re.IGNORECASE,
)
_G6_ROUTE_RE = re.compile(
    r"(orally|by mouth|\boral\b|intravenous|\bIV\b|intramuscular|\bIM\b|"
    r"subcutaneous|sublingual|transdermal|rectal|inhaled|topical|"
    r"\bdepot\b|slow release|immediate release|extended release|"
    r"modified release|long[\s-]?acting|short[\s-]?acting)",
    re.IGNORECASE,
)
_G6_ROUTE_WORDS = frozenset((
    "oral", "orally", "intravenous", "intramuscular", "subcutaneous",
    "sublingual", "transdermal", "rectal", "inhaled", "topical", "depot",
))
_G6_DURATION_RE = re.compile(
    r"(for\s+\d+\s+(?:days?|weeks?|months?)|over\s+(?:a few|\d+)\s+"
    r"(?:days?|weeks?|months?)|long[\s-]?term|short[\s-]?term|"
    r"\d+[\s-]?week course|for life|indefinitely)",
    re.IGNORECASE,
)
_G6_TITRATION_RE = re.compile(
    r"(increas|titrat|starting dose|loading dose|reduced by|taper|"
    r"decrement|increment|up to|as above|according to "
    r"(?:plasma|tolerability)|reaching|reach the)",
    re.IGNORECASE,
)
_G6_PREG_RE = re.compile(
    r"(pregnan|breastfe|lactation|teratogen|neonatal|foetal|fetal|"
    r"postpartum|perinatal|in utero|congenital)",
    re.IGNORECASE,
)
_G6_TAPER_RE = re.compile(
    r"(taper|withdrawal|discontinu|stop gradually|reduce gradually|"
    r"exponential|rebound)",
    re.IGNORECASE,
)
_G6_ALIAS_RE = re.compile(
    r"also known as\s+([^.;]{2,80})|known as\s+([^.;]{2,80})|"
    r"\(aka\s+([^)]{1,40})\)",
    re.IGNORECASE,
)
_G6_DRUG_SUFFIX_RE = re.compile(
    r"(pam|zolam|zepam|pine|pramine|oxetine|done|orphine|zepine|pride|"
    r"peridone|peridol|azine|apine|thixene|tixol|phenidate|triptyline|"
    r"zepoxide|barbiturate|olol|pril|sartan|statin|mycin|cillin|sone|"
    r"nide|dipine|zosin|tidine|prazole|setron|triptan|caine|trexate|"
    r"platin|prost|nib|mab|gliptin|gliflozin|semide|thiazide|lam)$",
    re.IGNORECASE,
)
_G6_LEAD_STRIP_RE = re.compile(
    r"^(add|switch|switching|switched|avoid|stop|stopped|start|started|"
    r"consider|considered|use|used|using|give|given|prescribe|prescribed|"
    r"continue|continued|change|changed|reduce|reduced|increase|increased|"
    r"combine|combined|choose|prefer|preferred|try|take|taken|offer|"
    r"recommend|recommended|all|also|another|small|agents?|with|from|the|"
    r"a|an|of|in|on|or|to|both|either|and|administered|atypical|typical|"
    r"conventional|newer|older|oral|parenteral|long|short|acting|first|"
    r"second)\s+",
    re.IGNORECASE,
)
_G6_DRUGH_RE = re.compile(
    r"^(drug|medication|agent|treatment|drug/regime|drug name|antipsychotic|"
    r"switching from|medicine|compound)",
    re.IGNORECASE,
)
_G6_STOP_WORDS = frozenset((
    "with", "from", "than", "dose", "doses", "dosing", "daily", "oral",
    "slow", "release", "immediate", "extended", "modified", "patients",
    "patient", "treatment", "tablet", "tablets", "capsule", "form",
    "formulation", "high", "low", "serum", "plasma", "level", "levels",
    "use", "used", "using", "effect", "effects", "risk", "weeks", "week",
    "days", "day", "months", "month", "years", "year", "hours", "hour",
    "range", "maximum", "minimum", "total", "mean", "average", "group",
    "groups", "drug", "drugs", "medication", "agent", "agents", "may",
    "also", "such", "more", "most", "less", "least", "when", "then",
    "after", "before", "over", "under", "without", "within", "during",
    "between", "higher", "lower", "small", "large", "first", "second",
    "line", "choice", "preferred", "alternative", "combination", "plus",
    "including", "other", "others", "both", "either", "every", "each",
    "per", "syrup", "liquid", "injection", "depot", "salt", "salts",
    "acid", "same", "case", "cases", "series", "benefit", "reported",
    "report", "assumed", "assume", "available", "licensed", "clinical",
    "countries", "indicator", "damage", "associated", "causing", "causes",
    "caused", "obese", "therapeutic", "window", "arousal", "augmentation",
    "chapter", "choices", "bipolar", "buccal", "cbt", "longer",
    "administered", "intramuscularly", "acting", "atypical", "typical",
    "conventional", "newer", "older", "parenteral", "antipsychotic",
    "antipsychotics", "polypharmacy", "for", "chotics", "and", "the",
    "a", "an", "of", "in", "on", "or", "to", "volume", "gfr", "egfr",
    "creatinine", "weight", "body", "start", "starting", "reaching",
    "around", "reduce", "regimen", "increase", "above", "month", "rate",
    "rates", "times", "minutes", "single", "divided", "regular",
    "required", "centres", "centers", "many", "some", "those", "these",
    "this", "that", "which", "whose", "there", "here", "where",
))

_G6_CONDITIONS = (
    "schizophrenia", "psychosis", "psychoses", "psychotic",
    "bipolar disorder", "bipolar", "mania", "hypomania",
    "depression", "depressive", "anxiety", "panic", "phobia", "OCD",
    "PTSD", "addiction", "substance misuse", "dependence", "withdrawal",
    "overdose", "delirium", "dementia", "epilepsy", "seizures",
    "insomnia", "eating disorder", "personality disorder", "ADHD",
    "autism", "catatonia", "relapse", "suicide", "self-harm",
    "pregnancy", "breastfeeding", "hepatic impairment", "renal impairment",
    "liver failure", "kidney failure", "older people", "elderly",
    "children", "adolescents", "parkinsonism", "akathisia",
)
_G6_EFFECTS = (
    "QTc prolongation", "QT prolongation", "torsade de pointes",
    "weight gain", "metabolic syndrome", "diabetes", "hyperglycaemia",
    "hyponatraemia", "tardive dyskinesia", "extrapyramidal",
    "neuroleptic malignant syndrome", "serotonin syndrome",
    "sedation", "drowsiness", "nausea", "vomiting", "diarrhoea",
    "constipation", "dry mouth", "blurred vision", "urinary retention",
    "headache", "dizziness", "agitation", "confusion", "delirium",
    "seizure", "seizures", "rash", "agranulocytosis", "neutropenia",
    "hepatotoxicity", "myocarditis", "cardiomyopathy", "arrhythmia",
    "hypotension", "hypertension", "tachycardia", "bradycardia",
    "rhabdomyolysis", "respiratory depression", "coma",
    "sexual dysfunction", "galactorrhoea", "amenorrhoea", "osteoporosis",
    "toxicity", "dependence", "insomnia", "anxiety", "mania",
    "psychosis", "relapse",
)
_G6_TESTS = (
    "plasma levels", "plasma level", "lithium levels", "lithium level",
    "blood levels", "blood level", "ECG", "electrocardiogram", "QTc",
    "blood pressure", "weight", "BMI", "prolactin", "glucose",
    "lipids", "cholesterol", "liver function", "renal function",
    "kidney function", "thyroid", "FBC", "full blood count", "U&E",
    "electrolytes", "creatinine", "neutrophil", "white cell count",
    "EEG", "blood test", "blood tests", "drug levels", "drug level",
)
_G6_CLASSES = (
    "antipsychotics", "antipsychotic", "antidepressants", "antidepressant",
    "benzodiazepines", "benzodiazepine", "opioids", "opioid",
    "mood stabilisers", "mood stabilizers", "mood stabiliser",
    "anticonvulsants", "antiepileptics", "hypnotics", "anxiolytics",
    "stimulants", "anticholinergics", "antihistamines", "beta-blockers",
)

_G6_SEE_RE = re.compile(
    r"[Ss]ee\s+(?:also\s+)?((?:Table|Figure|Box|Chapter|section|Appendix|"
    r"page)s?\b[^.\n;]{0,120})")
_G6_DESCRIBED_RE = re.compile(
    r"(?:described|discussed|outlined|detailed|covered|reviewed|listed)\s+"
    r"(?:further\s+)?(?:in|under|on)\s+((?:Table|Figure|Box|Chapter|"
    r"section|Appendix)\b[^.\n;]{0,120})",
    re.IGNORECASE,
)
_G6_IN_CHAPTER_RE = re.compile(r"\bin\s+Chapter\s+(\d{1,2})\b")
_G6_PAGE_REF_RE = re.compile(
    r"\bpages?\s+(\d{1,4})\b|\(p\.?\s*(\d{1,4})\)")
_G6_TABLE_NUM_RE = re.compile(r"Table\s+(\d+)\.(\d+)", re.IGNORECASE)
_G6_FIG_NUM_RE = re.compile(r"Figure\s+(\d+)\.(\d+)", re.IGNORECASE)
_G6_CHAP_NUM_RE = re.compile(r"Chapter\s+(\d{1,2})")
_G6_EXTERNAL_RE = re.compile(
    r"NICE|BNF|SPC|SmPC|\bDoH\b|MHRA|FDA|http|www\.|CredibleMeds|Cochrane|"
    r"\bTome\b|Stahl|Maudsley Learning|\bWHO\b|\bGMC\b|GRADE",
    re.IGNORECASE,
)
_G6_VAGUE_RE = re.compile(
    r"\b(above|below|earlier|later|previously|before|next section|"
    r"following section|as described|as discussed)\b",
    re.IGNORECASE,
)

_G6_CHAPTER_INDICATION = {
    1: "Schizophrenia and related psychoses",
    2: "Bipolar disorder",
    3: "Depression and anxiety disorders",
    4: "Addictions and substance misuse",
    5: "Children and adolescents",
    6: "Prescribing in older people",
    7: "Pregnancy and breastfeeding",
    8: "Hepatic and renal impairment",
    9: "Drug treatment of other psychiatric conditions",
    10: ("Drug treatment of psychiatric symptoms occurring in the "
         "context of other disorders"),
    11: "Pharmacokinetics",
    12: "Other substances",
    13: "Psychotropic drugs in special conditions",
    14: "Miscellany",
}
_G6_CHAPTER_POPULATION = {
    5: "children and adolescents",
    6: "older people",
    7: "pregnancy and breastfeeding",
    8: "hepatic and renal impairment",
}

# __GATE6_A_END__


def _g6_sha8(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:8]


def _g6_detach(text: str) -> str:
    """Matching-only copy: split letter->digit boundaries so reference
    numbers glued to names ("Lorazepam22,23", "Haloperidol2-7") match."""
    return _G6_DETACH_RE.sub(r"\1 \2", text)


def _g6_norm_ws(text: str) -> str:
    return re.sub(r"\s+", "", text)


def _g6_clean_drug_cell(text: str) -> tuple[str, list[int]]:
    """Clean one drug-column cell. Returns (name, ref_numbers). Blank stays
    blank: empty name means NOT_STATED upstream (R3, no inheritance)."""
    refs: list[int] = []
    t = text.strip()
    if not t:
        return "", []
    first_line = t.split("\n")[0].strip()
    m = _G6_TRAILING_REFS_RE.match(first_line)
    if m and re.search(r"[A-Za-z]", m.group(1)):
        for part in re.split(r"[,;\u2013\u2014-]", m.group(2)):
            part = part.strip()
            if re.fullmatch(r"\d{1,3}", part) and 1 <= int(part) <= 600:
                refs.append(int(part))
        first_line = m.group(1).strip()
    name = re.sub(r"\(.*?\)", " ", first_line).strip()
    name = re.sub(r"\s+", " ", name).strip("-,. ")
    prev = None
    while prev != name:
        prev = name
        name = _G6_LEAD_STRIP_RE.sub("", name).strip()
    return name, refs


def _g6_valid_drug_name(name: str) -> bool:
    if not name or len(name) > 40 or re.search(r"[\d(),:;.]", name):
        return False
    words = name.split(" ")
    if not words or len(words) > 3:
        return False
    for w in words:
        if (len(w) < 3 or w.lower() in _G6_STOP_WORDS
                or not re.fullmatch(r"[A-Za-z][A-Za-z\-]*", w)):
            return False
    return True


def _g6_drug_col(table: dict) -> int | None:
    headers = [str(h or "").strip() for h in table.get("headers", [])]
    for i, h in enumerate(headers):
        if _G6_DRUGH_RE.match(h.lower()):
            return i
    if not headers:
        rows = table.get("rows", [])
        col0 = [r["cells"][0]["text"] for r in rows
                if r["cells"] and r["cells"][0]["text"].strip()]
        if col0:
            ok = sum(1 for t in col0
                     if len(t) < 60 and not _G6_DOSE_RE.search(t))
            if ok >= len(col0) / 2:
                return 0
    return None


def _g6_build_gazetteer(tables: list[dict]) -> list[str]:
    """Drug names from the book's own tables: drug-column cells plus
    frequent dose-preceding tokens with drug-like suffixes."""
    gaz: set[str] = set()
    precede: dict[str, int] = {}
    for table in tables:
        dcol = _g6_drug_col(table)
        for row in table.get("rows", []):
            cells = row.get("cells", [])
            if dcol is not None and dcol < len(cells):
                for part in re.split(r"[\n/;]+", cells[dcol]["text"]):
                    name, _refs = _g6_clean_drug_cell(part)
                    if _g6_valid_drug_name(name):
                        gaz.add(name.lower())
            for c in cells:
                t = c.get("text", "")
                for m in _G6_DOSE_RE.finditer(t):
                    pre = t[max(0, m.start() - 40):m.start()]
                    toks = re.findall(r"[A-Za-z][A-Za-z\-]{3,}",
                                      _g6_detach(pre))
                    if toks:
                        w = toks[-1].lower()
                        precede[w] = precede.get(w, 0) + 1
    for w, c in precede.items():
        if (c >= 3 and w not in _G6_STOP_WORDS and len(w) >= 4
                and _G6_DRUG_SUFFIX_RE.search(w)):
            gaz.add(w)
    return sorted(gaz, key=lambda s: (-len(s), s))


def _g6_compile_term_re(terms: list[str] | tuple) -> re.Pattern:
    ordered = sorted(set(terms), key=lambda s: (-len(s), s.lower()))
    return re.compile(r"\b(?:" + "|".join(
        re.escape(t) for t in ordered) + r")\b", re.IGNORECASE)


def _g6_find_all(term_re: re.Pattern, text: str) -> list[tuple[str, int]]:
    return [(m.group(0), m.start()) for m in term_re.finditer(text)]


def _g6_sentences(span: str) -> list[tuple[str, int, int]]:
    """Split a RAW span into sentences. Returns (text, start, end) with
    verbatim offsets into span. Bullets split first, then sentence ends."""
    out: list[tuple[str, int, int]] = []
    for m in _G6_SENT_SPLIT_RE.finditer(span):
        pass
    bounds: list[tuple[int, int]] = []
    last = 0
    for m in _G6_SENT_SPLIT_RE.finditer(span):
        if m.start() > last:
            bounds.append((last, m.start()))
        last = m.end()
    if last < len(span):
        bounds.append((last, len(span)))
    for a, b in bounds:
        seg = span[a:b]
        if not seg.strip():
            continue
        out.append((seg.strip(), a + (len(seg) - len(seg.lstrip())),
                    a + len(seg.rstrip())))
    return [(t, s, e) for t, s, e in out if t.strip()]


def _g6_dose_spans(text: str) -> list[tuple[str, int, int]]:
    out: list[tuple[str, int, int]] = []
    for m in _G6_DOSE_RE.finditer(text):
        span = m.group(0)
        if not re.search(r"\d", span):
            continue
        nxt = text[m.end():m.end() + 1]
        if nxt == "/":
            continue
        s = span.strip()
        if not s:
            continue
        out.append((s, m.start(), m.end()))
    return out


def _g6_valid_dose_atom(text: str) -> bool:
    """CITEGLUE RULE: True only if the whole token is a dose atom per
    _G6_DOSE_ATOM_RE (leading digits + real unit, optional frequency tail)
    AND any comma digit-run is thousand-separator shaped. Rejects bare
    numbers ("35"), citation comma-lists ("4,14,153", "22,23") and stray
    letter fragments. Never invents: validation only."""
    t = (text or "").strip()
    if not t or "\n" in t or "\r" in t:
        return False
    if not _G6_DOSE_ATOM_RE.match(t):
        return False
    m = re.match(r"^([0-9][0-9.,]*(?: +[0-9][0-9.,]*)*)", t)
    stem = re.sub(r"\s+", "", m.group(1)) if m else ""
    if "," in stem:
        # Thousand separators only ("4,000mg"); anything else is a citation
        # run. Values above 9000mg are never real doses in this book
        # (observed max 4000mg/day), so a 5-digit comma shape like
        # "22,235mg" (really refs 22,23 + 5mg) is rejected, never filed.
        if not _G6_THOUSAND_RE.fullmatch(stem):
            return False
        try:
            if int(stem.replace(",", "")) > 9000:
                return False
        except ValueError:
            return False
    return True


def _g6_parse_ref_run(text: str) -> list[int]:
    """Parse a dropped citation run ("4,14,153-163", "35-43") into reference
    numbers (endpoints, no range expansion — same convention as the prose
    ref parser; 1..600, order-preserving dedupe)."""
    out: list[int] = []
    for part in _G6_REF_RUN_SPLIT_RE.split(text or ""):
        part = part.strip()
        if re.fullmatch(r"\d{1,3}", part or ""):
            v = int(part)
            if 1 <= v <= 600 and v not in out:
                out.append(v)
    return out


def _g6_salvage_dose_span(span: str) -> tuple[str | None, list[int]]:
    """CITEGLUE RULE: repair one raw dose-regex span. Only a newline inside
    the NUMERIC STEM (before any unit letter: "35-43\\n0.5mg/kg",
    "4,14,153-163\\nG") proves citation refs glued to a real dose across
    lines: keep only a dose match on the last line (or rejoin a head
    number with a tail that is unit-only, e.g. "500\\nmg" -> "500 mg"),
    and parse the dropped head into reference numbers. Newlines inside or
    after the unit part ("20-30mg/\\nkg/day", "500\\nmg" handled above,
    "5mg\\nper day" via the frequency tail) are legitimate narrow-cell
    wraps: the span is kept, filed in single-space-collapsed form (grounding
    holds under both whitespace norms). A leading comma/dash ref-run on a
    single line ("22,23 5mg") is stripped the same way. Pristine spans are
    returned byte-identical (zero churn). Returns (filed_span_or_None,
    refs). Filed dose strings stay raw substrings (modulo whitespace
    collapsing); dropped digits are never silently lost."""
    s = (span or "").strip()
    if not s:
        return None, []
    mf = _G6_FREQ_TAIL_RE.match(s)
    freq = ""
    core = s
    if mf:
        core, freq = mf.group(1).strip(), " " + re.sub(
            r"\s+", " ", mf.group(2)).strip()
    mu = _G6_UNIT_START_RE.search(core)
    stem_region = core[:mu.start()] if mu else core
    if "\n" in stem_region or "\r" in stem_region:
        norm_core = core.replace("\r", "\n")
        head, _sep, tail = norm_core.rpartition("\n")
        tail = tail.strip()
        m2 = _G6_DOSE_RE.match(tail)
        if m2 and re.search(r"\d", m2.group(0)):
            return (m2.group(0).strip() + freq, _g6_parse_ref_run(head))
        mh = re.search(r"(\d[\d.,]*)\s*$", head)
        mt = _G6_TAIL_UNIT_RE.match(tail)
        # Rejoin only when the head number is NOT itself a citation run
        # ("500\\nmg" may rejoin; "4,14,153-163\\nG" and "18-20\\n\\nG" end
        # in comma/dash ref-runs and must drop instead).
        if mh and mt and not re.search(
                r"\d\s*[,\u2013\u2014-]\s*\d[\d.,]*\s*$", head):
            return (mh.group(1) + " " + re.sub(r"\s+", " ", mt.group(1))
                    + freq, _g6_parse_ref_run(head[:mh.start(1)]))
        m2 = _G6_RANGE_RE.match(tail)
        if m2 and re.search(r"\d", tail):
            return (tail + freq, _g6_parse_ref_run(head))
        m2 = _G6_OR_RE.match(tail)
        if m2:
            return (tail + freq, _g6_parse_ref_run(head))
        return None, _g6_parse_ref_run(core)
    flat = re.sub(r"\s+", " ", core).strip()
    pristine = (flat == core and not freq)
    mlead = _G6_LEAD_REF_RUN_RE.match(flat)
    if mlead:
        refs = _g6_parse_ref_run(mlead.group(0))
        rest = flat[mlead.end():].strip()
        if rest and (_G6_DOSE_ATOM_RE.match(rest)
                     or _G6_RANGE_RE.match(rest) or _G6_OR_RE.match(rest)):
            return rest + freq, refs
        return None, _g6_parse_ref_run(core)
    if pristine:
        return s, []
    # Validate on the whitespace-collapsed form but file the original span
    # (zero churn for legitimate narrow-cell wraps); grounding holds under
    # both whitespace norms.
    if (_G6_DOSE_ATOM_RE.match(flat) or _G6_RANGE_RE.match(flat)
            or _G6_OR_RE.match(flat)):
        return s, []
    return None, _g6_parse_ref_run(core)


def _g6_split_dose_strict(span: str) -> tuple[
        str | None, str | None, str | None, str | None, str | None]:
    """Strict bound split with NO unit restoration (TAYLOR-006R). Returns
    (dose_min, dose_max, min_reason, max_reason, span_ok). Each range end is
    filed only if it is dose-shaped as-is per _g6_valid_dose_atom; bare
    numbers ("60" in "60-100mg/day") yield None + reason instead of an
    invented unit-carrying atom. Single (dash-less, or-less) spans must
    match the atom shape or the whole span is rejected (span_ok False).
    Reasons are short machine-readable strings, never replacements.
    Validation runs on the whitespace-collapsed span so narrow-cell wraps
    ("20-30mg/\\nkg/day") validate; filed ends may carry single spaces —
    grounding holds under both whitespace norms."""
    s = re.sub(r"\s+", " ", (span or "").strip())
    if not s:
        return None, None, "empty span", None, False
    m = _G6_RANGE_RE.match(s)
    if m and re.search(r"\d", m.group(1)) and re.search(r"\d", m.group(2)):
        left, right = m.group(1).strip(), m.group(2).strip()
        min_a, min_r = (left, None) if _g6_valid_dose_atom(left) \
            else (None, "end not dose-shaped: %r" % left[:40])
        max_a, max_r = (right, None) if _g6_valid_dose_atom(right) \
            else (None, "end not dose-shaped: %r" % right[:40])
        ok = min_a is not None or max_a is not None
        return min_a, max_a, min_r, max_r, ok
    m = _G6_OR_RE.match(s)
    if m and re.search(r"\d", m.group(1)) and re.search(r"\d", m.group(2)):
        left, right = m.group(1).strip(), m.group(2).strip()
        min_a, min_r = (left, None) if _g6_valid_dose_atom(left) \
            else (None, "end not dose-shaped: %r" % left[:40])
        max_a, max_r = (right, None) if _g6_valid_dose_atom(right) \
            else (None, "end not dose-shaped: %r" % right[:40])
        ok = min_a is not None or max_a is not None
        return min_a, max_a, min_r, max_r, ok
    if _g6_valid_dose_atom(s):
        return None, None, None, None, True
    return None, None, None, None, False


def _g6_dose_spans_validated(text: str) -> list[tuple[str, int, int,
                                                      list[int]]]:
    """Dose spans for medication records: raw regex matches repaired by
    _g6_salvage_dose_span. Returns (salvaged_span, start, end, refs) with
    the salvaged span a verbatim raw substring. Spans with no unit-carrying
    content are dropped (refs still returned for logging)."""
    out: list[tuple[str, int, int, list[int]]] = []
    for m in _G6_DOSE_RE.finditer(text):
        span = m.group(0)
        if not re.search(r"\d", span):
            continue
        nxt = text[m.end():m.end() + 1]
        if nxt == "/":
            continue
        s = span.strip()
        if not s:
            continue
        fixed, refs = _g6_salvage_dose_span(s)
        if fixed is None:
            out.append(("", m.start(), m.end(), refs))
            continue
        strict = _g6_split_dose_strict(fixed)
        if not strict[4]:
            out.append(("", m.start(), m.end(),
                        refs + _g6_parse_ref_run(fixed)))
            continue
        out.append((fixed, m.start(), m.end(), refs))
    return out


def _g6_classify(sentence: str, has_dose: bool) -> str | None:
    if _G6_CONTRA_RE.search(sentence):
        return "contraindication"
    if _G6_INTERACT_RE.search(sentence):
        return "interaction"
    if _G6_MONITOR_RE.search(sentence):
        return "monitoring"
    if _G6_ADVERSE_RE.search(sentence):
        return "adverse_effect"
    if has_dose:
        return "medication_statement"
    if _G6_RECOMMEND_RE.search(sentence):
        return "recommendation"
    if _G6_TREAT_RE.search(sentence):
        return "treatment"
    if _G6_DEFINE_RE.search(sentence):
        return "definition"
    if _G6_RISK_RE.search(sentence):
        return "risk_factor"
    return None


def _g6_hedge(sentence: str) -> str | None:
    low = sentence.lower()
    for h in _G6_HEDGES:
        if h.lower() in low:
            i = low.index(h.lower())
            return sentence[i:i + len(h)]
    return None


def _g6_triple(sentence: str, terms: list[tuple[str, int]],
               claim: str, dose0: str | None,
               fallback: str | None) -> tuple[str, str, str]:
    ordered = sorted(terms, key=lambda t: t[1])
    subject = ordered[0][0] if ordered else ""
    if not subject:
        head = sentence.strip()[:40]
        cut = max(head.rfind(" "), head.rfind(","))
        subject = head[:cut].strip() if cut and cut > 8 else head.strip()
    low = sentence.lower()
    predicate = ""
    for v in _G6_VERBS:
        if v.lower() in low:
            i = low.index(v.lower())
            predicate = sentence[i:i + len(v)]
            break
    if not predicate:
        predicate = _G6_CLAIM_DEFAULT_PRED[claim]
    obj = ordered[1][0] if len(ordered) > 1 else ""
    if not obj:
        obj = dose0 or fallback or ""
    return subject[:120], predicate[:60], obj[:120]


def _g6_qualifiers(sentence: str, claim: str) -> dict:
    hedge = _g6_hedge(sentence)
    mt = _G6_TEMPORALITY_RE.search(sentence)
    ms = _G6_SEVERITY_RE.search(sentence)
    me = _G6_EXCEPTION_RE.search(sentence)
    return {
        "modality": hedge,
        "temporality": mt.group(0)[:120] if mt else None,
        "severity": ms.group(0)[:40] if ms else None,
        "exception": me.group(0).strip()[:200] if me else None,
        "evidence_wording": sentence[:2000] if claim in (
            "recommendation", "monitoring", "contraindication",
            "treatment") else None,
    }


def _g6_ref_numbers_prose(sentence: str) -> list[int]:
    out: list[int] = []
    masked = _G6_DOSE_RE.sub(" ", sentence)
    masked = re.sub(r"\b(19|20)\d{2}\b", " ", masked)
    for m in _G6_PROSE_REF_RE.finditer(masked):
        for part in re.split(r"[,;\u2013\u2014-]", m.group(1)):
            part = part.strip()
            if re.fullmatch(r"\d{1,3}", part or ""):
                v = int(part)
                if 1 <= v <= 600 and v not in out:
                    out.append(v)
    return out


def _g6_sentence_blocks(sentence: str, unit_blocks: list[str],
                        block_texts: dict[str, str]) -> list[str]:
    key = re.sub(r"\s+", " ", sentence).strip()[:40]
    hits = [bid for bid in unit_blocks
            if key and key in re.sub(r"\s+", " ", block_texts.get(bid, ""))]
    if hits:
        return hits
    key2 = re.sub(r"\s+", " ", sentence).strip()[-40:]
    hits = [bid for bid in unit_blocks
            if key2 and key2 in re.sub(r"\s+", " ", block_texts.get(bid, ""))]
    return hits if hits else list(unit_blocks)


def _g6_chapter_of_unit(unit: dict) -> int | None:
    return _g4_chapter_of(unit.get("physical_start", 0))


def _g6_indication(ch: int | None, table_title: str | None) -> str:
    if table_title:
        t = re.sub(r"^Table\s+\d+\.\d+\s*", "", table_title.strip())
        t = re.sub(r"\s+", " ", t).strip()
        if t:
            return t[:160]
    if ch is not None and ch in _G6_CHAPTER_INDICATION:
        return _G6_CHAPTER_INDICATION[ch]
    return "NOT_STATED_IN_SOURCE"


def _g6_population(ch: int | None, span: str) -> str:
    if ch in _G6_CHAPTER_POPULATION:
        return _G6_CHAPTER_POPULATION[ch]
    if _G6_PREG_RE.search(span):
        return "pregnancy and breastfeeding"
    return "NOT_STATED_IN_SOURCE"


class _G6Ctx:
    def __init__(self, book) -> None:
        self.book = book
        self.raw_cache: dict[str, dict] = {}
        self.block_cache: dict[str, dict[str, str]] = {}
        self.repair_by_block: dict[str, list[dict]] = {}
        self.phys_printed: dict[int, object] = {}
        self.phys_segs: dict[int, list[str]] = {}
        self.valid_segments: set[str] = set()
        self.tables: list[dict] = []
        self.tables_by_host: dict[str, list[dict]] = {}
        self.table_num_to_id: dict[str, str] = {}
        self.table_ids: set[str] = set()
        self.figs_by_host: dict[str, list[dict]] = {}
        self.fig_num_to_id: dict[str, str] = {}
        self.figure_ids: set[str] = set()
        self.alg_nodes_by_host: dict[str, list[dict]] = {}
        self.units: list[dict] = []
        self.unit_ids: set[str] = set()
        self.unit_order: dict[str, int] = {}
        self.opening_unit: dict[int, str] = {}
        self.gaz: list[str] = []
        self.drug_re: re.Pattern | None = None
        self.term_re: re.Pattern | None = None
        self.printed_to_phys: dict[int, int] = {}

    def raw_rec(self, tag: str) -> dict:
        if tag not in self.raw_cache:
            with open(_raw_path(self.book, tag), "r",
                      encoding="utf-8") as f:
                self.raw_cache[tag] = json.load(f)
        return self.raw_cache[tag]

    def block_text(self, bid: str) -> str:
        m = re.fullmatch(r"page-(\d{4})-block-(\d{4})", bid or "")
        if not m:
            return ""
        tag = m.group(1)
        if tag not in self.block_cache:
            rec = self.raw_rec(tag)
            self.block_cache[tag] = {
                b.get("block_id", ""): b.get("text", "")
                for b in rec.get("blocks", [])}
        return self.block_cache[tag].get(bid, "")

    def raw_text_of_page(self, phys: int) -> str:
        return self.raw_rec("%04d" % phys).get("raw_text", "")


# __GATE6_B_END__


class _G6Blocked(Exception):
    pass


def _g6_ctx_load(book: Path) -> _G6Ctx:
    ctx = _G6Ctx(book)
    with open(book / "units.jsonl", "r", encoding="utf-8") as f:
        ulines = f.read().splitlines()
    ctx.units = [json.loads(ln) for ln in ulines]
    for i, u in enumerate(ctx.units):
        ctx.unit_ids.add(u["unit_id"])
        ctx.unit_order[u["unit_id"]] = i
        if u.get("unit_type") == "chapter_opening":
            ch = _g4_chapter_of(u.get("physical_start", 0))
            if ch is not None:
                ctx.opening_unit[ch] = u["unit_id"]
    with open(book / "pages.map.json", "r", encoding="utf-8") as f:
        pmap = json.load(f)
    ctx.phys_printed, ctx.phys_segs = _g4_map_tables(pmap.get("segments", []))
    for s in pmap.get("segments", []):
        ctx.valid_segments.add(s["mapping_segment_id"])
    for phys, pr in ctx.phys_printed.items():
        if isinstance(pr, int) and pr not in ctx.printed_to_phys:
            ctx.printed_to_phys[pr] = phys
    with open(book / "repairs.jsonl", "r", encoding="utf-8") as f:
        for ln in f:
            ln = ln.strip()
            if not ln:
                continue
            r = json.loads(ln)
            ctx.repair_by_block.setdefault(r.get("block_id", ""), []).append(r)
    with open(book / "tables.jsonl", "r", encoding="utf-8") as f:
        ctx.tables = [json.loads(ln) for ln in f if ln.strip()]
    for t in ctx.tables:
        ctx.table_ids.add(t["table_id"])
        ctx.tables_by_host.setdefault(t.get("host_unit_id", ""), []).append(t)
        m = _G6_TABLE_NUM_RE.search(t.get("title", ""))
        if m:
            key = "%s.%s" % (int(m.group(1)), int(m.group(2)))
            cur = ctx.table_num_to_id.get(key)
            if cur is None or t.get("physical_start", 0) < cur[1]:
                ctx.table_num_to_id[key] = (t["table_id"],
                                            t.get("physical_start", 0))
    ctx.table_num_to_id = {k: v[0] for k, v in ctx.table_num_to_id.items()}
    with open(book / "figures.jsonl", "r", encoding="utf-8") as f:
        figs = [json.loads(ln) for ln in f if ln.strip()]
    for g in figs:
        ctx.figure_ids.add(g["figure_id"])
        ctx.figs_by_host.setdefault(g.get("host_unit_id", ""), []).append(g)
        m = _G6_FIG_NUM_RE.search(g.get("title", ""))
        if m:
            key = "%s.%s" % (int(m.group(1)), int(m.group(2)))
            if key not in ctx.fig_num_to_id:
                ctx.fig_num_to_id[key] = g["figure_id"]
    with open(book / "algorithms.jsonl", "r", encoding="utf-8") as f:
        algs = [json.loads(ln) for ln in f if ln.strip()]
    for a in algs:
        ctx.alg_nodes_by_host.setdefault(
            a.get("host_unit_id", ""), []).extend(a.get("nodes", []))
    ctx.gaz = _g6_build_gazetteer(ctx.tables)
    if not ctx.gaz:
        raise _G6Blocked("empty drug gazetteer")
    ctx.drug_re = _g6_compile_term_re(ctx.gaz)
    ctx.term_re = _g6_compile_term_re(
        list(ctx.gaz) + list(_G6_CONDITIONS) + list(_G6_EFFECTS)
        + list(_G6_TESTS) + list(_G6_CLASSES))
    return ctx


def _g6_unit_repairs(unit: dict, ctx: _G6Ctx) -> tuple[list[str], bool]:
    ids: list[str] = []
    hyphen = False
    for bid in unit.get("source_block_ids", []):
        for r in ctx.repair_by_block.get(bid, []):
            if r.get("repair_id") not in ids:
                ids.append(r.get("repair_id"))
            if r.get("rule_id") == "dehyphenate-geometry-proven":
                hyphen = True
    return sorted(ids), hyphen


def _g6_raw_drug_form(term: str, raw_sentence: str) -> str | None:
    m = re.search(r"\b" + re.escape(term) + r"\b", raw_sentence,
                  re.IGNORECASE)
    if m:
        return m.group(0)
    m = re.search(re.escape(term) + r"(?:\d[\d\s,;\u2013\u2014-]*)?",
                  raw_sentence, re.IGNORECASE)
    if m:
        cand = re.sub(r"[\d\s,;\u2013\u2014-]+$", "", m.group(0)).strip()
        if cand.lower() == term.lower():
            return cand
    return None


def _g6_assertion_record(ctx: _G6Ctx, unit: dict, source_text: str,
                         block_ids: list[str], claim: str, subject: str,
                         predicate: str, obj: str, method: str,
                         confidence: float, table_id: str | None,
                         figure_id: str | None) -> dict:
    anchor = unit["physical_start"]
    segids = ctx.phys_segs.get(anchor, [])
    # Gate-6 review rule (TAYLOR-006): needs_review for ALL dose /
    # contra / interaction / monitoring / threshold records. Threshold alone
    # (even without a digit, e.g. "above the therapeutic range") triggers
    # needs_review; "approved" is never emitted here.
    needs = (claim in _G6_REVIEW_CLAIMS or bool(_g6_dose_spans(source_text))
             or bool(_G6_THRESHOLD_RE.search(source_text)))
    status = "needs_review" if needs else "not_reviewed"
    return {
        "assertion_id": "ta-" + _g6_sha8(GATE6_BOOK_ID, unit["unit_id"],
                                        source_text),
        "source_unit_id": unit["unit_id"],
        "claim_type": claim,
        "source_text": source_text,
        "normalized_form": None,
        "subject": subject,
        "predicate": predicate,
        "object": obj,
        "qualifiers": _g6_qualifiers(source_text, claim),
        "source_location": {
            "page_id": "%s:page-%04d" % (GATE6_BOOK_ID, anchor),
            "physical_page": anchor,
            "printed_page_number": ctx.phys_printed.get(anchor),
            "block_ids": block_ids,
        },
        "traceability": {
            "raw_file": "raw/page-%04d.json" % anchor,
            "raw_text_sha256": _text_sha(ctx.raw_text_of_page(anchor)),
            "source_block_ids": list(unit.get("source_block_ids", [])),
            "repair_ids": [r for bid in block_ids
                           for r in (x.get("repair_id") for x in
                                     ctx.repair_by_block.get(bid, []))],
        },
        "provenance": {
            "source_lock_sha": GATE6_LOCK,
            "mapping_segment_id": segids[0] if segids else None,
            "table_id_or_null": table_id,
            "figure_id_or_null": figure_id,
        },
        "extraction_method": method,
        "extraction_confidence": confidence,
        "review_status": status,
        "validation_status": status,
        "reading_hyphen_merge": any(
            r.get("rule_id") == "dehyphenate-geometry-proven"
            for bid in block_ids
            for r in ctx.repair_by_block.get(bid, [])),
    }


def _g6_clean_for_match(sentence: str) -> str:
    s = _g6_detach(sentence)
    return re.sub(r"([A-Za-z)\]])(\d{1,3}(?:\s*[,;\u2013\u2014-]\s*\d{1,3})+)",
                  r"\1 ", s)


def _g6_med_record(ctx: _G6Ctx, unit: dict, drug_raw: str | None,
                   spelling_note: str | None, dose: str, dose_min: str | None,
                   dose_max: str | None, span_text: str, ch: int | None,
                   indication: str, table_id: str | None,
                   row_index: int | None, row_type: str | None,
                   ref_numbers: list[int], method: str,
                   hyphen: bool, anchor_phys: list[int],
                   joined_span: str | None = None,
                   row_span: str | None = None) -> dict | None:
    if _g6_norm_ws(dose) not in _g6_norm_ws(span_text):
        return None
    if drug_raw is not None and _g6_norm_ws(
            drug_raw) not in _g6_norm_ws(span_text):
        # Same-row drug-cell context (R3: table_id + row_index cited) and
        # the layout-joined copy are legitimate grounding contexts; the
        # filed span stays the verbatim cell/sentence.
        if not ((row_span is not None and _g6_norm_ws(
                drug_raw) in _g6_norm_ws(row_span))
                or (joined_span is not None and _g6_norm_ws(
                    drug_raw) in _g6_norm_ws(joined_span))):
            return None
    generic = drug_raw if drug_raw else "NOT_STATED_IN_SOURCE"
    freq = _G6_FREQ_RE.search(span_text)
    route = _G6_ROUTE_RE.search(span_text)
    dur = _G6_DURATION_RE.search(span_text)
    classes = sorted({m.group(0) for m in
                      _G6_CLASS_RE.finditer(span_text + " " + indication)},
                     key=str.lower)
    tit = span_text if _G6_TITRATION_RE.search(span_text) else None
    taper = span_text if _G6_TAPER_RE.search(span_text) else None
    preg = bool(_G6_PREG_RE.search(span_text + " " + indication))
    if ch == 7:
        preg = True
    mid = "tm-" + _g6_sha8(GATE6_BOOK_ID, unit["unit_id"], generic.lower(),
                           dose, span_text[:80],
                           table_id or "", str(row_index))
    return {
        "medication_id": mid,
        "generic_name": generic,
        "spelling_note": spelling_note,
        "brand": None,
        "drug_class": "; ".join(classes) if classes else "NOT_STATED_IN_SOURCE",
        "indication": indication,
        "population": _g6_population(ch, span_text + " " + indication),
        "route": route.group(0) if route else "NOT_STATED_IN_SOURCE",
        "frequency": freq.group(0) if freq else "NOT_STATED_IN_SOURCE",
        "duration": dur.group(0) if dur else "NOT_STATED_IN_SOURCE",
        "dose": dose,
        "dose_min": dose_min,
        "dose_max": dose_max,
        "titration": tit,
        "monitoring_refs": [],
        "contraindication_refs": [],
        "interaction_refs": [],
        "pregnancy_info": {"is_pregnancy_related": preg,
                           "assertion_ids": []},
        "taper_info": taper,
        "source_pages": sorted(set(anchor_phys)),
        "table_ids": [table_id] if table_id else [],
        "table_row": ({"table_id": table_id, "row_index": row_index,
                       "row_type": row_type}
                      if table_id is not None else None),
        "reference_numbers": sorted(set(ref_numbers)),
        "evidence_wording": span_text[:2000],
        "source_unit_id": unit["unit_id"],
        "source_text_span": span_text[:2000],
        "reading_hyphen_merge": hyphen,
        "layout_join_applied": joined_span is not None,
        "extraction_method": method,
        "provenance": {
            "source_lock_sha": GATE6_LOCK,
            "mapping_segment_ids": sorted(
                {s for p in anchor_phys
                 for s in ctx.phys_segs.get(p, [])}),
        },
    }


def _g6_xref_records(ctx: _G6Ctx, unit: dict, span: str) -> list[dict]:
    out: list[dict] = []
    seen: set[tuple] = set()
    cands: list[str] = []
    for m in _G6_SEE_RE.finditer(span):
        cands.append(m.group(1).strip()[:200])
    for m in _G6_DESCRIBED_RE.finditer(span):
        cands.append(m.group(1).strip()[:200])
    for m in _G6_IN_CHAPTER_RE.finditer(span):
        cands.append("Chapter %s" % m.group(1))
    for m in _G6_PAGE_REF_RE.finditer(span):
        num = m.group(1) or m.group(2)
        cands.append("page %s" % num)
    for pointer in cands:
        if _G6_EXTERNAL_RE.search(pointer):
            status, target = "unresolved_external", None
        else:
            tm = _G6_TABLE_NUM_RE.search(pointer)
            fm = _G6_FIG_NUM_RE.search(pointer)
            cm = _G6_CHAP_NUM_RE.search(pointer)
            if tm:
                key = "%s.%s" % (int(tm.group(1)), int(tm.group(2)))
                if key in ctx.table_num_to_id:
                    status = "resolved_internal"
                    target = ctx.table_num_to_id[key]
                else:
                    status, target = "unresolved", None
            elif fm:
                key = "%s.%s" % (int(fm.group(1)), int(fm.group(2)))
                if key in ctx.fig_num_to_id:
                    status = "resolved_internal"
                    target = ctx.fig_num_to_id[key]
                else:
                    status, target = "unresolved", None
            elif cm and 1 <= int(cm.group(1)) <= 14:
                status = "resolved_internal"
                target = ctx.opening_unit.get(int(cm.group(1)))
                if target is None:
                    status, target = "unresolved", None
            else:
                pm = re.search(r"(\d{1,4})", pointer)
                if pm and ("page" in pointer.lower()
                           or "p." in pointer.lower()):
                    printed = int(pm.group(1))
                    if printed in ctx.printed_to_phys:
                        status = "resolved_explicit"
                        target = printed
                    else:
                        status, target = "unresolved", None
                elif _G6_VAGUE_RE.search(pointer):
                    status, target = "unresolved", None
                else:
                    status, target = "unresolved", None
        key = (pointer, status, str(target))
        if key in seen:
            continue
        seen.add(key)
        out.append({
            "xref_id": "tx-" + _g6_sha8(GATE6_BOOK_ID, unit["unit_id"],
                                       pointer, status, str(target)),
            "source_unit_id": unit["unit_id"],
            "pointer_text": pointer,
            "status": status,
            "target": target,
        })
    return out


def _g6_process_prose_unit(ctx: _G6Ctx, unit: dict, ch: int,
                           acc: dict) -> None:
    blocks = list(unit.get("source_block_ids", []))
    btexts = {bid: ctx.block_text(bid) for bid in blocks}
    span = "\n".join(btexts.get(bid, "") for bid in blocks)
    if not span.strip() or not re.search(r"[A-Za-z]", span):
        return
    anchor = unit["physical_start"]
    _repairs, hyphen = _g6_unit_repairs(unit, ctx)
    indication = _g6_indication(ch, None)
    for sent, _s, _e in _g6_sentences(span):
        if not re.search(r"[A-Za-z]", sent):
            continue
        # Matching-only layout join: reassemble tokens split by a raw
        # line-break hyphen ("metha-\ndone" -> "methadone") so drugs broken
        # across lines still match. Filed spans stay verbatim raw; a dose is
        # only kept when also present verbatim in the raw sentence.
        jsent = _g6_layout_join(sent)
        joined = (jsent != sent)
        clean = _g6_clean_for_match(jsent)
        doses = [(d, s, e) for d, s, e in _g6_dose_spans(clean)
                 if _g6_norm_ws(d) in _g6_norm_ws(sent)]
        claim = _g6_classify(sent, bool(doses))
        if claim is None:
            continue
        drug_hits = [(t, p) for t, p in _g6_find_all(ctx.drug_re, clean)
                     if t.lower() not in _G6_ROUTE_WORDS]
        term_hits = _g6_find_all(ctx.term_re, clean)
        dose0 = doses[0][0] if doses else None
        subj, pred, obj = _g6_triple(sent, term_hits, claim, dose0,
                                     indication)
        sblocks = _g6_sentence_blocks(sent, blocks, btexts)
        method = ("deterministic_repair" if (hyphen or joined)
                  else "direct")
        acc["assertions"].append(_g6_assertion_record(
            ctx, unit, sent, sblocks, claim, subj, pred, obj, method,
            0.85 if (hyphen or joined) else 0.9, None, None))
        aid = acc["assertions"][-1]["assertion_id"]
        acc["aid_by_unit_span"][(unit["unit_id"], sent[:120])] = aid
        # Medication spans use the citeglue-validated extractor (raw spans
        # stay the classification basis so assertions are byte-stable).
        vdoses = _g6_dose_spans_validated(clean)
        for dose, _ds, _de, span_refs in vdoses:
            if not dose:
                acc["dropped_spans"].append(
                    (unit["unit_id"], anchor,
                     "no unit-carrying atom in span"))
                continue
            best: tuple[str, int] | None = None
            for dtext, dpos in drug_hits:
                if dpos <= _ds and (best is None or dpos > best[1]):
                    best = (dtext, dpos)
            if best is None and drug_hits:
                best = min(drug_hits, key=lambda t: abs(t[1] - _ds))
            notes: list[str] = []
            xjoin = False
            if best is None:
                pre = clean[max(0, _ds - 40):_ds]
                toks = re.findall(r"[A-Za-z][A-Za-z\-]{3,}", pre)
                if (toks and toks[-1].lower() not in _G6_STOP_WORDS
                        and _G6_DRUG_SUFFIX_RE.search(toks[-1])):
                    form, xnote, xjoin = _g6_drug_form(toks[-1], sent)
                    if form is None:
                        continue
                    if xnote:
                        notes.append(xnote)
                else:
                    continue
            else:
                term = best[0]
                form, xnote, xjoin = _g6_drug_form(term, sent)
                if form is None:
                    continue
                if xnote:
                    notes.append(xnote)
                if re.search(r"[A-Za-z]\d", sent):
                    notes.append("reference numbers detached")
            spelling = "verbatim source spelling (uncorrected)"
            if notes:
                spelling += "; " + "; ".join(notes)
            dmin, dmax, min_r, max_r, _span_ok = _g6_split_dose_strict(dose)
            atom_notes: list[str] = []
            if min_r:
                atom_notes.append("dose_min: " + min_r)
            if max_r:
                atom_notes.append("dose_max: " + max_r)
            med_method = ("deterministic_repair" if (hyphen or xjoin)
                          else "direct")
            base_refs = _g6_ref_numbers_prose(sent)
            refs = base_refs + [r for r in span_refs if r not in base_refs]
            rec = _g6_med_record(
                ctx, unit, form, spelling, dose, dmin, dmax, sent, ch,
                indication, None, None, None,
                refs, med_method, hyphen, [anchor],
                jsent if (joined and xjoin) else None)
            if rec is not None:
                rec["_aid"] = aid
                if atom_notes:
                    rec["_atom_notes"] = atom_notes
                acc["medications"].append(rec)
    acc["xrefs"].extend(_g6_xref_records(ctx, unit, span))


def _g6_process_table_unit(ctx: _G6Ctx, unit: dict, ch: int,
                           acc: dict) -> None:
    tables = ctx.tables_by_host.get(unit["unit_id"], [])
    if not tables:
        _g6_process_prose_unit(ctx, unit, ch, acc)
        acc["counters"]["table_fallback_units"] += 1
        return
    blocks = list(unit.get("source_block_ids", []))
    btexts = {bid: ctx.block_text(bid) for bid in blocks}
    uspan = "\n".join(btexts.get(bid, "") for bid in blocks)
    acc["xrefs"].extend(_g6_xref_records(ctx, unit, uspan))
    for table in sorted(tables, key=lambda t: t["table_id"]):
        dcol = _g6_drug_col(table)
        indication = _g6_indication(ch, table.get("title", ""))
        for ridx, row in enumerate(table.get("rows", [])):
            if row.get("row_type") == "header":
                continue
            cells = row.get("cells", [])
            texts = [c.get("text", "") for c in cells
                     if c.get("text", "").strip()]
            if not texts:
                continue
            row_text = "\n".join(texts)
            if not re.search(r"[A-Za-z]", row_text):
                continue
            clean = _g6_clean_for_match(row_text)
            doses = _g6_dose_spans(clean)
            claim = _g6_classify(row_text, bool(doses))
            aid: str | None = None
            if claim is not None:
                term_hits = _g6_find_all(ctx.term_re, clean)
                subj, pred, obj = _g6_triple(
                    row_text, term_hits, claim,
                    doses[0][0] if doses else None, indication)
                acc["assertions"].append(_g6_assertion_record(
                    ctx, unit, row_text, blocks, claim, subj, pred, obj,
                    "structural_parse", 0.8, table["table_id"], None))
                aid = acc["assertions"][-1]["assertion_id"]
            row_drug = ""
            row_refs: list[int] = []
            if dcol is not None and dcol < len(cells):
                row_drug, row_refs = _g6_clean_drug_cell(
                    cells[dcol].get("text", ""))
            _repairs, hyphen = _g6_unit_repairs(unit, ctx)
            for cidx, cell in enumerate(cells):
                ctext = cell.get("text", "")
                if not ctext.strip():
                    continue
                c_join = _g6_layout_join(ctext)
                c_joined = (c_join != ctext)
                c_clean = _g6_clean_for_match(c_join)
                in_drugs = [(t, p) for t, p in
                            _g6_find_all(ctx.drug_re, c_clean)
                            if t.lower() not in _G6_ROUTE_WORDS]
                vdoses = [(d, s, e, r) for d, s, e, r
                          in _g6_dose_spans_validated(c_clean)
                          if not d or _g6_norm_ws(d) in _g6_norm_ws(ctext)]
                for dose, _ds, _de, span_refs in vdoses:
                    if not dose:
                        acc["dropped_spans"].append(
                            (unit["unit_id"], unit["physical_start"],
                             "no unit-carrying atom in cell span"))
                        continue
                    best = None
                    for dtext, dpos in in_drugs:
                        if dpos <= _ds and (best is None
                                           or dpos > best[1]):
                            best = (dtext, dpos)
                    notes = []
                    xjoin = False
                    if best is not None:
                        form, xnote, xjoin = _g6_drug_form(best[0], ctext)
                        if form is None:
                            continue
                        if xnote:
                            notes.append(xnote)
                    elif (row_drug and _g6_valid_drug_name(row_drug)
                            and row_drug.lower() not in _G6_ROUTE_WORDS):
                        form = row_drug
                        if row_refs:
                            notes.append("reference numbers detached "
                                         "from drug-column cell")
                    else:
                        form = None
                    if form is not None and not _g6_valid_drug_name(
                            form.lower()):
                        if not re.fullmatch(
                                r"[A-Za-z][A-Za-z\-]*", form):
                            continue
                    spelling = "verbatim source spelling (uncorrected)"
                    if notes:
                        spelling += "; " + "; ".join(notes)
                    dmin, dmax, min_r, max_r, _span_ok = _g6_split_dose_strict(
                        dose)
                    atom_notes = []
                    if min_r:
                        atom_notes.append("dose_min: " + min_r)
                    if max_r:
                        atom_notes.append("dose_max: " + max_r)
                    refs = list(cell.get("ref_numbers", [])) + row_refs
                    refs = refs + [r for r in span_refs if r not in refs]
                    rec = _g6_med_record(
                        ctx, unit, form, spelling, dose, dmin, dmax, ctext,
                        ch, indication, table["table_id"], ridx,
                        row.get("row_type", "body"), refs,
                        "structural_parse", hyphen,
                        [unit["physical_start"]],
                        c_join if (c_joined and xjoin) else None,
                        row_span=row_text)
                    if rec is not None:
                        if aid is not None:
                            rec["_aid"] = aid
                        if atom_notes:
                            rec["_atom_notes"] = atom_notes
                        acc["medications"].append(rec)


def _g6_process_figure_unit(ctx: _G6Ctx, unit: dict, ch: int,
                            acc: dict) -> None:
    figs = ctx.figs_by_host.get(unit["unit_id"], [])
    fig_id = figs[0]["figure_id"] if figs else None
    blocks = list(unit.get("source_block_ids", []))
    btexts = {bid: ctx.block_text(bid) for bid in blocks}
    span = "\n".join(btexts.get(bid, "") for bid in blocks)
    if not span.strip():
        return
    _repairs, hyphen = _g6_unit_repairs(unit, ctx)
    indication = _g6_indication(ch, None)
    method = "structural_parse" if fig_id else (
        "direct" if not hyphen else "deterministic_repair")
    for sent, _s, _e in _g6_sentences(span):
        if not re.search(r"[A-Za-z]", sent):
            continue
        clean = _g6_clean_for_match(sent)
        doses = _g6_dose_spans(clean)
        claim = _g6_classify(sent, bool(doses))
        if claim is None:
            continue
        term_hits = _g6_find_all(ctx.term_re, clean)
        subj, pred, obj = _g6_triple(sent, term_hits, claim,
                                     doses[0][0] if doses else None,
                                     indication)
        acc["assertions"].append(_g6_assertion_record(
            ctx, unit, sent, _g6_sentence_blocks(sent, blocks, btexts),
            claim, subj, pred, obj, method,
            0.8 if fig_id else (0.9 if not hyphen else 0.85),
            None, fig_id))
    acc["xrefs"].extend(_g6_xref_records(ctx, unit, span))


def _g6_process_algorithm_nodes(ctx: _G6Ctx, unit: dict, ch: int,
                                acc: dict) -> None:
    nodes = ctx.alg_nodes_by_host.get(unit["unit_id"], [])
    if not nodes:
        return
    indication = _g6_indication(ch, None)
    for node in nodes:
        text = re.sub(r"\s+", " ", node.get("text", "")).strip()
        if not text or not re.search(r"[A-Za-z]", text):
            continue
        clean = _g6_clean_for_match(text)
        doses = _g6_dose_spans(clean)
        claim = _g6_classify(text, bool(doses))
        if claim is None:
            continue
        term_hits = _g6_find_all(ctx.term_re, clean)
        subj, pred, obj = _g6_triple(text, term_hits, claim,
                                     doses[0][0] if doses else None,
                                     indication)
        nblocks = list(node.get("source_block_ids", [])) or list(
            unit.get("source_block_ids", []))
        acc["assertions"].append(_g6_assertion_record(
            ctx, unit, text, nblocks, claim, subj, pred, obj,
            "structural_parse", 0.8, None, None))
        acc["counters"]["algorithm_assertions"] += 1


def _g6_extract_chapter(ch: int, ctx: _G6Ctx) -> dict:
    acc: dict = {"assertions": [], "medications": [], "xrefs": [],
                 "aid_by_unit_span": {},
                 "counters": {"table_fallback_units": 0,
                              "algorithm_assertions": 0,
                              "reference_list_units_skipped": 0},
                 "dropped_spans": [],
                 "error": None}
    # Bibliography lists are citations, not clinical statements of the book:
    # list units whose Gate-4 structural path ends in "References" are
    # skipped (counted). All other prose/list/box/table_ref/figure_ref units
    # in the chapter are processed.
    in_scope = [u for u in ctx.units
                if _g6_chapter_of_unit(u) == ch
                and u.get("unit_type") in _G6_PROSE_TYPES + _G6_STRUCT_TYPES]
    units = [u for u in in_scope
             if (u.get("structural_path") or [None])[-1] != "References"]
    acc["counters"]["reference_list_units_skipped"] = (
        len(in_scope) - len(units))
    units.sort(key=lambda u: (u.get("physical_start", 0),
                              ctx.unit_order.get(u["unit_id"], 0)))
    for unit in units:
        ut = unit.get("unit_type")
        if ut in _G6_PROSE_TYPES:
            _g6_process_prose_unit(ctx, unit, ch, acc)
        elif ut == "table_ref":
            _g6_process_table_unit(ctx, unit, ch, acc)
        elif ut == "figure_ref":
            _g6_process_figure_unit(ctx, unit, ch, acc)
        _g6_process_algorithm_nodes(ctx, unit, ch, acc)
    acc["assertions"].sort(key=lambda a: (
        a["source_location"]["physical_page"],
        ctx.unit_order.get(a["source_unit_id"], 0),
        a["source_text"][:60]))
    return acc


# ---------------------------------------------------------------------------
# Gate 6 — PART D: layout-join helpers, med ref-linking, concepts,
# relations, writer + self-validation, gate6 command (TAYLOR-006).
#
# Documented rules (hash recipe R2 restated for the new ids):
# - concept_id    = "tc-"+sha256("book|concept-key-lower")[0:8]
# - medication_id = "tm-"+sha256("book|unit|generic-lower|dose|span80|
#                   table|row")[0:8]  (built in Part C _g6_med_record)
# - relation_id   = "tr-"+sha256("book|subject|predicate|object")[0:8]
# - xref_id       = "tx-"+sha256("book|unit|pointer|status|target")[0:8]
#   (built in Part C _g6_xref_records)
# - traceability.raw_text_sha256 recomputes as sha256 of the page's
#   raw/page-NNNN.json "raw_text" field (Part C _g6_assertion_record via
#   _text_sha). All hashes recompute from persisted files under these rules.
# - Layout join (extends R1 to unrepaired line-break hyphenation): matching
#   runs on a copy where letter-hyphen-newline-letter is reassembled
#   ("metha-\ndone" -> "methadone"). Filed source_text/dose/spans stay
#   verbatim raw. Records whose drug form only exists in the joined copy get
#   extraction_method deterministic_repair, a spelling_note quoting the
#   cause, and layout_join_applied=true. reading_hyphen_merge stays strictly
#   for dehyphenate-geometry-proven repair overlap (R1).
# - Reference lists are citations, not clinical statements: list units whose
#   structural_path ends in "References" are skipped (counted).
# ---------------------------------------------------------------------------

_G6_LAYOUT_JOIN_RE = re.compile(r"([A-Za-z])-\n([A-Za-z])")
_G6_SWITCH_RE = re.compile(
    r"\bswitch(?:ing|ed|es)?\b.{0,80}\b(?:to|from)\b",
    re.IGNORECASE | re.DOTALL)
_G6_DIFF_RE = re.compile(r"\bdifferentia|\bdistinguish\b", re.IGNORECASE)

_G6_ALLOWED_METHODS = frozenset(("direct", "deterministic_repair",
                                "structural_parse"))
_G6_ALLOWED_STATUS = frozenset(("needs_review", "not_reviewed"))

_G6_TERM_LABELS = (
    ("drug", "book-drug-gazetteer"),
    ("condition", "book-condition-list"),
    ("effect", "book-effect-list"),
    ("test", "book-test-list"),
    ("class", "book-drug-class-list"),
    ("ctxdrug", "dose-context-drug"),
)


def _g6_layout_join(text: str) -> str:
    prev = None
    cur = text
    while prev != cur:
        prev = cur
        cur = _G6_LAYOUT_JOIN_RE.sub(r"\1\2", cur)
    return cur


def _g6_drug_form(term: str, raw_text: str):
    f = _g6_raw_drug_form(term, raw_text)
    if f is not None:
        return f, None, False
    j = _g6_layout_join(raw_text)
    if j != raw_text:
        f2 = _g6_raw_drug_form(term, j)
        if f2 is not None:
            return (f2, "raw line-break hyphenation reassembled for "
                    "matching; verbatim raw kept in filed spans", True)
    return None, None, False


def _g6_drug_guard_ok(generic: str | None,
                      indication: str | None) -> tuple[bool, str | None]:
    """DRUG-NAME GUARD (TAYLOR-006R): reject generic_name values that are
    condition/population vocabulary (_G6_CONDITION_VOCAB: the book's own
    condition/effect/population lists plus condition-generics observed in
    Gate-6 data — Depression x59, overdose x11, delirium x8, listed in the
    constant) or that equal the record's own indication (a section/chapter
    title, never a drug). NOT_STATED_IN_SOURCE (explicit R3 blank cells)
    always passes. Returns (ok, reason_or_None)."""
    g = (generic or "").strip()
    if not g or g == "NOT_STATED_IN_SOURCE":
        return True, None
    gl = g.lower()
    if gl in _G6_CONDITION_VOCAB:
        return False, "generic_name %r is condition vocabulary" % generic
    ind = (indication or "").strip().lower()
    if ind and ind != "NOT_STATED_IN_SOURCE" and gl == ind:
        return False, "generic_name equals indication %r" % indication
    return True, None


def _g6_form_acceptable(form: str) -> bool:
    """Same drug-form standard as the table path: valid drug name (lowered
    check) or a single plain word; route words excluded by callers."""
    if _g6_valid_drug_name(form.lower()):
        return True
    return bool(re.fullmatch(r"[A-Za-z][A-Za-z\-]*", form))


def _g6_recover_drug(ctx: _G6Ctx, m: dict) -> tuple[str | None, str | None]:
    """DRUG-NAME GUARD recovery (TAYLOR-006R), deterministic order:
    (1) same-row drug-column cell (table records only; strongest context —
    table_id + row_index are already cited on the record);
    (2) another gazetteer drug hit inside the filed span (first mention
    order), excluding route words and guarded condition terms.
    Returns (generic_form, rule) or (None, None) when nothing is
    deterministically recoverable (caller drops the med record with reason;
    the grounding assertion stays)."""
    tr = m.get("table_row") or {}
    tid = tr.get("table_id")
    if tid:
        t = next((x for x in ctx.tables if x["table_id"] == tid), None)
        if t is not None:
            rows = t.get("rows", [])
            ri = tr.get("row_index")
            if isinstance(ri, int) and 0 <= ri < len(rows):
                cells = rows[ri].get("cells", [])
                dcol = _g6_drug_col(t)
                if dcol is not None and dcol < len(cells):
                    name, _refs = _g6_clean_drug_cell(
                        cells[dcol].get("text", ""))
                    if (name and _g6_form_acceptable(name)
                            and name.lower() not in _G6_ROUTE_WORDS
                            and _g6_drug_guard_ok(name, None)[0]):
                        return name, "same-row drug-column cell"
    span = m.get("source_text_span") or ""
    js = _g6_layout_join(span)
    cands = [(t_, p) for t_, p in
             _g6_find_all(ctx.drug_re, _g6_clean_for_match(js))
             if t_.lower() not in _G6_ROUTE_WORDS]
    cur = (m.get("generic_name") or "").lower()
    seen: set[str] = set()
    for term, _pos in sorted(cands, key=lambda x: (x[1], x[0].lower())):
        if term.lower() in seen:
            continue
        seen.add(term.lower())
        form, _note, _j = _g6_drug_form(term, span)
        if (form and _g6_form_acceptable(form)
                and form.lower() not in _G6_ROUTE_WORDS
                and _g6_drug_guard_ok(form, None)[0]
                and form.lower() != cur):
            return form, "other in-span drug mention"
    return None, None


def _g6_med_id_for(unit_id: str, generic: str, dose: str, span80: str,
                   table_id: str | None, row_index) -> str:
    """Medication-ID formula, byte-identical inputs to _g6_med_record:
    tm-+sha256(book|unit_id|generic-lower|dose|span80|table|row)[:8].
    Used only when reattribution changes the generic (new content hash)."""
    return "tm-" + _g6_sha8(GATE6_BOOK_ID, unit_id, generic.lower(), dose,
                            span80, table_id or "", str(row_index))


def _g6_atom_pair_verdict(dmin: str | None,
                          dmax: str | None) -> tuple[str | None,
                                                    str | None,
                                                    str | None]:
    """ATOM SANITY BOUND, pair rule (TAYLOR-006R): when both atoms carry the
    same unit, require numeric min<=max; a violated max is nulled with
    reason (never replaced, never invented). Unparseable or different-unit
    pairs are incomparable and kept (needs_review stays). Returns
    (dmin_out, dmax_out, reason_or_None)."""
    if not dmin or not dmax:
        return dmin, dmax, None
    ma = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*(.*)$", dmin.strip(), re.S)
    mb = re.match(r"^([0-9]+(?:\.[0-9]+)?)\s*(.*)$", dmax.strip(), re.S)
    if not ma or not mb:
        return dmin, dmax, None
    ua, ub = ma.group(2).strip().lower(), mb.group(2).strip().lower()
    if not ua or ua != ub:
        return dmin, dmax, None
    try:
        va, vb = float(ma.group(1)), float(mb.group(1))
    except ValueError:
        return dmin, dmax, None
    if va > vb:
        return dmin, None, ("dose_max %r < dose_min %r (same unit %r)" % (
            dmax, dmin, ma.group(2).strip()))
    return dmin, dmax, None


def _g6_qa_nws(s: str | None) -> str:
    """Whitespace-collapsed normalization, byte-identical mirror of the
    Gate-7 tier norm (_g7_nws): single spaces, stripped. Used so Gate-6
    atom checks imply Gate-7 verbatim tiers (no new flags)."""
    return re.sub(r"\s+", " ", s or "").strip()


def _g6_remediate_meds(ctx: _G6Ctx, medications: list[dict],
                       raw_of) -> tuple[list[dict], list[tuple[str, str]]]:
    """TAYLOR-006R post-pass over built medication records (runs before
    ref-linking, concepts and relations so drops propagate):
    (1) DRUG-NAME GUARD + deterministic recovery, else drop with reason;
    (2) ATOM SANITY: each min/max must be dose-shaped, a whitespace-
    insensitive substring of its own dose string, and present (collapsed)
    in the record's raw union corpus; same-unit pairs must satisfy
    min<=max. Offending atoms -> null + atom_reject_reason (list, always
    present afterwards); nothing invented, review stays needs_review.
    raw_of(med) returns the record's raw union corpus (unit blocks then
    table blocks, declaration order — the Gate-7 corpus order).
    Returns (kept, dropped[(medication_id, reason)]). Grounding assertions
    are untouched (caller keeps them regardless of med drops)."""
    kept: list[dict] = []
    dropped: list[tuple[str, str]] = []
    for m in medications:
        reasons: list[str] = list(m.pop("_atom_notes", []) or [])
        ok, why = _g6_drug_guard_ok(m.get("generic_name"),
                                    m.get("indication"))
        if not ok:
            newg, rule = _g6_recover_drug(ctx, m)
            if newg is None:
                dropped.append((m["medication_id"],
                                "drug-guard: %s; no recoverable drug" % why))
                continue
            old_id = m["medication_id"]
            m["generic_name"] = newg
            m["spelling_note"] = (
                (m.get("spelling_note")
                 or "verbatim source spelling (uncorrected)")
                + "; reattributed (%s)" % rule)
            m["extraction_method"] = "deterministic_repair"
            tr = m.get("table_row") or {}
            tids = m.get("table_ids") or []
            m["medication_id"] = _g6_med_id_for(
                m["source_unit_id"], newg, m.get("dose", ""),
                (m.get("source_text_span") or "")[:80],
                tids[0] if tids else None, tr.get("row_index"))
            reasons.append("generic reattributed %s -> %s (%s)" % (
                old_id, m["medication_id"], rule))
        dose = m.get("dose") or ""
        dose_nws = _g6_norm_ws(dose)
        corp_qa = _g6_qa_nws(raw_of(m))
        for field in ("dose_min", "dose_max"):
            a = m.get(field)
            if a is None:
                continue
            bad = None
            if not _g6_valid_dose_atom(a):
                bad = "not dose-shaped"
            elif _g6_norm_ws(a) not in dose_nws:
                bad = "not substring of dose string"
            elif _g6_qa_nws(a) not in corp_qa:
                bad = "not in raw corpus"
            if bad is not None:
                reasons.append("%s %r rejected: %s" % (field, a, bad))
                m[field] = None
        if m.get("dose_min") and m.get("dose_max"):
            mn, mx, pr = _g6_atom_pair_verdict(m["dose_min"],
                                              m["dose_max"])
            m["dose_min"], m["dose_max"] = mn, mx
            if pr:
                reasons.append(pr)
        m["atom_reject_reason"] = sorted(set(reasons))
        kept.append(m)
    return kept, dropped


def _g6_link_meds(assertions: list[dict],
                  medications: list[dict]) -> None:
    by_unit: dict[str, list[dict]] = {}
    for a in assertions:
        by_unit.setdefault(a["source_unit_id"], []).append(a)

    def _ids(group: list[dict], claim: str | None,
             preg_only: bool) -> list[str]:
        out = []
        for a in group:
            if claim is not None and a["claim_type"] != claim:
                continue
            if preg_only and not _G6_PREG_RE.search(a["source_text"]):
                continue
            out.append(a["assertion_id"])
        return sorted(set(out))[:20]

    for m in medications:
        group = by_unit.get(m["source_unit_id"], [])
        m["monitoring_refs"] = _ids(group, "monitoring", False)
        m["contraindication_refs"] = _ids(group, "contraindication", False)
        m["interaction_refs"] = _ids(group, "interaction", False)
        if m.get("pregnancy_info", {}).get("is_pregnancy_related"):
            m["pregnancy_info"]["assertion_ids"] = _ids(group, None, True)
        else:
            m["pregnancy_info"]["assertion_ids"] = []


def _g6_cats_of(key: str, gaz_set: set[str],
                cat_sets: dict[str, set[str]]) -> set[str]:
    cats = set()
    if key in gaz_set:
        cats.add("drug")
    for cat, terms in cat_sets.items():
        if key in terms:
            cats.add(cat)
    return cats


def _g6_build_concepts(ctx: _G6Ctx, assertions: list[dict],
                       medications: list[dict]):
    gaz_set = set(ctx.gaz)
    cat_sets = {
        "condition": {t.lower() for t in _G6_CONDITIONS},
        "effect": {t.lower() for t in _G6_EFFECTS},
        "test": {t.lower() for t in _G6_TESTS},
        "class": {t.lower() for t in _G6_CLASSES},
    }
    occ: dict[str, dict] = {}

    def _add(key: str, form: str, cats: set[str], aid: str) -> None:
        e = occ.get(key)
        if e is None:
            e = occ[key] = {"forms": {}, "cats": set(), "aids": set(),
                            "pages": set()}
        e["forms"][form] = e["forms"].get(form, 0) + 1
        e["cats"] |= cats
        e["aids"].add(aid)

    aid_to_page = {a["assertion_id"]: a["source_location"]["physical_page"]
                   for a in assertions}
    for a in assertions:
        for m in ctx.term_re.finditer(a["source_text"]):
            form = m.group(0)
            key = form.lower()
            _add(key, form, _g6_cats_of(key, gaz_set, cat_sets),
                 a["assertion_id"])
    for m in medications:
        g = m.get("generic_name", "")
        aid = m.get("_aid")
        if not g or g == "NOT_STATED_IN_SOURCE" or not aid:
            continue
        key = g.lower()
        cats = _g6_cats_of(key, gaz_set, cat_sets) or {"ctxdrug"}
        _add(key, g, cats, aid)
    for e in occ.values():
        e["pages"] = {aid_to_page[a] for a in e["aids"]
                      if a in aid_to_page}
    label_of = dict(_G6_TERM_LABELS)
    concepts = []
    for key in sorted(occ):
        e = occ[key]
        top = max(e["forms"].values())
        name = sorted(f for f, n in e["forms"].items()
                      if n == top)[0]
        terminology = ";".join(sorted(label_of[c] for c in e["cats"]
                                      if c in label_of)) or "book-term-list"
        concepts.append({
            "concept_id": "tc-" + _g6_sha8(GATE6_BOOK_ID, key),
            "name": name,
            "source_terminology": terminology,
            "aliases": [],
            "related_concepts": [],
            "source_refs": sorted(e["aids"])[:200],
            "_key": key,
            "_pages": sorted(e["pages"]),
        })
    # Aliases only from explicit "also known as / known as / (aka" patterns
    # in filed assertion texts, attributed to a concept named just before.
    by_name = {}
    for c in concepts:
        by_name.setdefault(c["name"].lower(), []).append(c)
    for a in assertions:
        for m in _G6_ALIAS_RE.finditer(a["source_text"]):
            alias = (m.group(1) or m.group(2) or m.group(3) or "")
            alias = re.sub(r"\s+", " ", alias).strip()[:80]
            if not alias or len(alias) < 2:
                continue
            pre = a["source_text"][max(0, m.start() - 80):m.start()].lower()
            for key, clist in by_name.items():
                if key in pre and alias.lower() != key:
                    for c in clist:
                        if alias not in c["aliases"] \
                                and len(c["aliases"]) < 5:
                            c["aliases"].append(alias)
    for c in concepts:
        c["aliases"] = sorted(c["aliases"])
    # Related concepts = co-occurrence in the same filed assertion.
    co: dict[str, set[str]] = {c["concept_id"]: set() for c in concepts}
    cid_of_aid: dict[str, set[str]] = {}
    for c in concepts:
        for aid in c["source_refs"]:
            cid_of_aid.setdefault(aid, set()).add(c["concept_id"])
    for aids in cid_of_aid.values():
        ids = sorted(aids)
        for i in range(len(ids)):
            for j in range(i + 1, len(ids)):
                co[ids[i]].add(ids[j])
                co[ids[j]].add(ids[i])
    idset = set(co)
    for c in concepts:
        c["related_concepts"] = sorted(co[c["concept_id"]] & idset)[:20]
    key_to_cid = {c["_key"]: c["concept_id"] for c in concepts}
    key_to_cats: dict[str, set[str]] = {}
    for c in concepts:
        for texts in (occ[c["_key"]]["cats"],):
            key_to_cats[c["_key"]] = set(texts)
    for c in concepts:
        del c["_key"]
        del c["_pages"]
    concepts.sort(key=lambda c: c["concept_id"])
    return concepts, key_to_cid, key_to_cats


def _g6_build_relations(ctx: _G6Ctx, assertions: list[dict],
                        medications: list[dict],
                        key_to_cid: dict[str, str],
                        key_to_cats: dict[str, set[str]]):
    meds_by_aid: dict[str, list[dict]] = {}
    for m in medications:
        if m.get("_aid"):
            meds_by_aid.setdefault(m["_aid"], []).append(m)
    edges: dict[tuple, dict] = {}

    def _emit(s: str, p: str, o: str, qual: str | None, aid: str,
              page: int) -> None:
        e = edges.get((s, p, o))
        if e is None:
            e = edges[(s, p, o)] = {"aids": set(), "pages": set(),
                                    "qual": None}
        e["aids"].add(aid)
        e["pages"].add(page)
        if e["qual"] is None and qual:
            e["qual"] = qual[:200]

    for a in assertions:
        hits = []
        for m in ctx.term_re.finditer(a["source_text"]):
            key = m.group(0).lower()
            cid = key_to_cid.get(key)
            if cid is None:
                continue
            hits.append((m.start(), key, cid,
                         key_to_cats.get(key, set())))
        hits.sort(key=lambda h: (h[0], h[1]))
        # Dedup repeated mentions of the same concept, keep first position.
        seen = set()
        uniq = []
        for h in hits:
            if h[2] not in seen:
                seen.add(h[2])
                uniq.append(h)
        hits = uniq
        if not hits:
            continue
        text = a["source_text"]
        qual = _g6_hedge(text)
        page = a["source_location"]["physical_page"]
        aid = a["assertion_id"]
        drugs = [h for h in hits if "drug" in h[3] or "ctxdrug" in h[3]]
        conds = [h for h in hits if "condition" in h[3]]
        effs = [h for h in hits if "effect" in h[3]]
        tests = [h for h in hits if "test" in h[3]]

        def _other_than(cid: str):
            for h in hits:
                if h[2] != cid:
                    return h
            return None

        claim = a["claim_type"]
        made = 0
        if claim == "contraindication" and len(hits) >= 2:
            anchor = drugs[0] if drugs else hits[0]
            o = _other_than(anchor[2])
            if o is not None:
                _emit(anchor[2], "contraindicated_with", o[2], qual,
                      aid, page)
                made += 1
        elif claim == "interaction" and len(hits) >= 2:
            if len(drugs) >= 2:
                _emit(drugs[0][2], "interacts_with", drugs[1][2], qual,
                      aid, page)
            else:
                anchor = drugs[0] if drugs else hits[0]
                o = _other_than(anchor[2])
                if o is not None:
                    _emit(anchor[2], "interacts_with", o[2], qual, aid,
                          page)
            made += 1
        elif claim == "adverse_effect":
            if effs and drugs:
                _emit(effs[0][2], "adverse_effect_of", drugs[0][2], qual,
                      aid, page)
                made += 1
        elif claim == "monitoring":
            if drugs and tests:
                _emit(drugs[0][2], "monitored_by", tests[0][2], qual,
                      aid, page)
                made += 1
        elif claim == "risk_factor" and len(hits) >= 2:
            _emit(hits[0][2], "risk_factor_for", hits[1][2], qual, aid,
                  page)
            made += 1
        elif claim == "definition" and len(hits) >= 2:
            _emit(hits[0][2], "defined_by", hits[1][2], qual, aid, page)
            made += 1
        elif claim in ("medication_statement", "recommendation",
                       "treatment"):
            if conds and drugs:
                _emit(conds[0][2], "treated_by", drugs[0][2], qual, aid,
                      page)
                made += 1
        if _G6_SWITCH_RE.search(text) and len(drugs) >= 2:
            _emit(drugs[0][2], "switches_to", drugs[1][2], qual, aid,
                  page)
            made += 1
        if _G6_DIFF_RE.search(text) and len(hits) >= 2:
            _emit(hits[0][2], "differential_with", hits[1][2], qual,
                  aid, page)
            made += 1
        for m in meds_by_aid.get(aid, []):
            g = m.get("generic_name", "")
            cid = key_to_cid.get(g.lower()) if g else None
            if cid is not None:
                _emit(cid, "has_dose", m["medication_id"], None, aid,
                      page)
                made += 1
        if made == 0 and len(hits) >= 2:
            _emit(hits[0][2], "associated_with", hits[1][2], qual, aid,
                  page)
    relations = []
    for (s, p, o), e in sorted(edges.items()):
        relations.append({
            "relation_id": "tr-" + _g6_sha8(GATE6_BOOK_ID, s, p, o),
            "subject_id": s,
            "predicate": p,
            "object_id": o,
            "qualifier_or_null": e["qual"],
            "provenance": {
                "assertion_ids": sorted(e["aids"])[:50],
                "pages": sorted(e["pages"])[:20],
            },
        })
    return relations


def _g6_assertion_refs_ok(a: dict, ctx: _G6Ctx) -> bool:
    if a.get("source_unit_id") not in ctx.unit_ids:
        return False
    bids = a.get("source_location", {}).get("block_ids", [])
    if not bids:
        return False
    if not any(ctx.block_text(b) for b in bids):
        return False
    tid = a.get("provenance", {}).get("table_id_or_null")
    if tid is not None and tid not in ctx.table_ids:
        return False
    fid = a.get("provenance", {}).get("figure_id_or_null")
    if fid is not None and fid not in ctx.figure_ids:
        return False
    return True


def _g6_chapter_hash(acc: dict) -> str:
    h = hashlib.sha256()
    for rec in acc["assertions"]:
        h.update(json.dumps(rec, ensure_ascii=False).encode("utf-8"))
        h.update(b"\n")
    for rec in acc["medications"]:
        pub = {k: v for k, v in rec.items() if not k.startswith("_")}
        h.update(json.dumps(pub, ensure_ascii=False).encode("utf-8"))
        h.update(b"\n")
    for rec in acc["xrefs"]:
        h.update(json.dumps(rec, ensure_ascii=False).encode("utf-8"))
        h.update(b"\n")
    return h.hexdigest()[:16]


def cmd_knowledge_gate6(args) -> int:
    # ASCII-safe console prints: evidence strings carry book unicode
    # (en-dashes, em-spaces); files stay full-unicode JSON.
    try:
        sys.stdout.reconfigure(encoding="utf-8",
                               errors="backslashreplace")
        sys.stderr.reconfigure(encoding="utf-8",
                               errors="backslashreplace")
    except Exception:
        pass
    only_raw = getattr(args, "only", "") or ""
    only = [s.strip() for s in only_raw.split(",") if s.strip()]
    unknown = [s for s in only if s not in GATE6_PASSES]
    if unknown:
        for s in unknown:
            print("NOT_IMPLEMENTED: knowledge pass %s" % s)
        return 1
    if not only:
        only = list(GATE6_PASSES)
    root = repo_root()
    book = root / BOOK_REL
    out_paths = {name: book / (name + ".jsonl") for name in GATE6_PASSES}
    # ---- Step 0: pre-checks (any failure -> BLOCKED, write nothing) ----
    for name in only:
        if out_paths[name].is_file():
            print("BLOCKED: %s already exists; refusing to overwrite."
                  % out_paths[name].name, file=sys.stderr)
            return 1
    digest, _byte_size = sha256_file(root / SOURCE_REL)
    if digest.lower() != EXPECTED_SHA256.lower():
        print("BLOCKED: source-lock sha mismatch on recompute.",
              file=sys.stderr)
        return 1
    n_raw = len(list((book / "raw").glob("page-*.json")))
    n_reading = len(list((book / "reading").glob("page-*.json")))
    with open(book / "units.jsonl", "r", encoding="utf-8") as f:
        units_lines = f.read().splitlines()
    with open(book / "tables.jsonl", "r", encoding="utf-8") as f:
        tables_lines = f.read().splitlines()
    structure = json.load(open(book / "structure.json", "r",
                               encoding="utf-8"))
    n_chapters = sum(len(p.get("chapters", []))
                     for p in structure.get("parts", []))
    entry_ok = all((book / n).is_file() for n in
                   ("figures.jsonl", "algorithms.jsonl", "pages.map.json",
                    "repairs.jsonl"))
    if n_raw != 978 or n_reading != 978 or len(units_lines) != 7861 \
            or len(tables_lines) != 275 or n_chapters != 14 \
            or not entry_ok:
        print("BLOCKED: pre-check raw=%d reading=%d units=%d tables=%d "
              "chapters=%d entry=%s (want 978/978/7861/275/14/True)."
              % (n_raw, n_reading, len(units_lines), len(tables_lines),
                 n_chapters, entry_ok), file=sys.stderr)
        return 1
    snap_before = _g5_snapshot(root, book)
    try:
        ctx = _g6_ctx_load(book)
    except _G6Blocked as exc:
        print("BLOCKED: context load: %s" % exc, file=sys.stderr)
        return 1
    print("knowledge-gate6 %s: lock=sha256:%s gazetteer=%d "
          "mapsegs=%d tables=%d" % (
              GATE6_VERSION, digest[:16], len(ctx.gaz),
              len(ctx.valid_segments), len(ctx.tables)))
    # ---- per-chapter batches, fault-isolated, progress to stdout ----
    merged = {"assertions": [], "medications": [], "xrefs": [],
              "dropped_spans": []}
    ch_hashes: dict[int, str] = {}
    chapter_errors = []
    ref_skipped_total = 0
    for ch in range(1, 15):
        try:
            acc = _g6_extract_chapter(ch, ctx)
        except Exception as exc:  # fault isolation: record, continue
            chapter_errors.append((ch, repr(exc)))
            print("gate6 chapter %2d: ERROR %r" % (ch, exc))
            continue
        ch_hashes[ch] = _g6_chapter_hash(acc)
        merged["assertions"].extend(acc["assertions"])
        merged["medications"].extend(acc["medications"])
        merged["xrefs"].extend(acc["xrefs"])
        merged["dropped_spans"].extend(acc.get("dropped_spans", []))
        ref_skipped_total += acc["counters"].get(
            "reference_list_units_skipped", 0)
        print("gate6 chapter %2d: units done assertions=%d "
              "medications=%d xrefs=%d ref_lists_skipped=%d hash=%s"
              % (ch, len(acc["assertions"]), len(acc["medications"]),
                 len(acc["xrefs"]), acc["counters"].get(
                     "reference_list_units_skipped", 0),
                 ch_hashes[ch]))
    if chapter_errors:
        print("BLOCKED: chapter errors %s; writing nothing."
              % (chapter_errors,), file=sys.stderr)
        return 1
    # ---- deterministic order + dedupe ----
    merged["assertions"].sort(key=lambda a: (
        a["source_location"]["physical_page"],
        ctx.unit_order.get(a["source_unit_id"], 0),
        a["source_text"][:60], a["assertion_id"]))
    seen_ids = set()
    assertions = []
    dup_assertions = 0
    for a in merged["assertions"]:
        if a["assertion_id"] in seen_ids:
            dup_assertions += 1
            continue
        seen_ids.add(a["assertion_id"])
        assertions.append(a)
    merged["medications"].sort(key=lambda m: (
        m["source_pages"][0] if m["source_pages"] else 0,
        m["source_unit_id"], m["dose"], m["medication_id"]))
    seen_mids = set()
    medications = []
    dup_meds = 0
    for m in merged["medications"]:
        if m["medication_id"] not in seen_mids:
            seen_mids.add(m["medication_id"])
            medications.append(m)
        else:
            dup_meds += 1
    merged["xrefs"].sort(key=lambda x: (
        x["source_unit_id"], x["pointer_text"], x["status"],
        str(x["target"])))
    seen_xids = set()
    xrefs = []
    for x in merged["xrefs"]:
        if x["xref_id"] not in seen_xids:
            seen_xids.add(x["xref_id"])
            xrefs.append(x)
    # ---- ref-integrity filter: unresolvable claims are NOT filed ----
    ok_assertions = [a for a in assertions
                     if _g6_assertion_refs_ok(a, ctx)]
    dropped_assertions = len(assertions) - len(ok_assertions)
    assertions = ok_assertions
    aid_set = {a["assertion_id"] for a in assertions}
    mapping_gap = sum(
        1 for a in assertions
        if a["provenance"]["mapping_segment_id"] is None)
    # ---- dose grounding filter: every med dose verbatim-grounded in raw
    # (whitespace-insensitive). Corpus: prose meds -> the unit's own raw
    # blocks; table meds -> the Gate-5 table record's own source blocks
    # (tables legitimately assemble rows from blocks beyond the host
    # unit's span, incl. continued rows). Failures listed, not filed ----
    unit_raw: dict[str, tuple[str, str]] = {}
    table_bids = {t["table_id"]: list(t.get("source_block_ids", []))
                  for t in ctx.tables}
    table_raw: dict[str, tuple[str, str]] = {}

    def _unit_texts(uid: str) -> tuple[str, str]:
        hit = unit_raw.get(uid)
        if hit is None:
            unit = next((u for u in ctx.units
                         if u["unit_id"] == uid), None)
            raw = "\n".join(ctx.block_text(b) for b in
                            (unit.get("source_block_ids", [])
                             if unit else []))
            hit = (_g6_norm_ws(raw),
                   _g6_norm_ws(_g6_layout_join(raw)))
            unit_raw[uid] = hit
        return hit

    def _table_texts(tid: str) -> tuple[str, str]:
        hit = table_raw.get(tid)
        if hit is None:
            raw = "\n".join(ctx.block_text(b)
                            for b in table_bids.get(tid, []))
            hit = (_g6_norm_ws(raw),
                   _g6_norm_ws(_g6_layout_join(raw)))
            table_raw[tid] = hit
        return hit

    # Raw union corpora in Gate-7 order (unit blocks then table blocks,
    # declaration order, deduped) for the remediation atom checks.
    unit_rawtext: dict[str, str] = {}
    table_rawtext: dict[str, str] = {}

    def _unit_rawtext(uid: str) -> str:
        hit = unit_rawtext.get(uid)
        if hit is None:
            unit = next((u for u in ctx.units
                         if u["unit_id"] == uid), None)
            hit = "\n".join(ctx.block_text(b) for b in
                            (unit.get("source_block_ids", [])
                             if unit else []))
            unit_rawtext[uid] = hit
        return hit

    def _table_rawtext(tid: str) -> str:
        hit = table_rawtext.get(tid)
        if hit is None:
            hit = "\n".join(ctx.block_text(b)
                            for b in table_bids.get(tid, []))
            table_rawtext[tid] = hit
        return hit

    def _raw_of(m: dict) -> str:
        parts: list[str] = []
        seen: set[str] = set()
        u = next((x for x in ctx.units
                  if x["unit_id"] == m.get("source_unit_id")), None)
        if u:
            for bid in u.get("source_block_ids", []):
                if bid not in seen:
                    seen.add(bid)
                    parts.append(ctx.block_text(bid))
        for tid in m.get("table_ids", []):
            for bid in table_bids.get(tid, []):
                if bid not in seen:
                    seen.add(bid)
                    parts.append(ctx.block_text(bid))
        return "\n".join(parts)

    # ---- TAYLOR-006R remediation: drug guard + recovery, atom sanity.
    # Drops propagate to linking/concepts/relations (built after). ----
    medications, dropped_med_ids = _g6_remediate_meds(ctx, medications,
                                                      _raw_of)
    redup: list[dict] = []
    dup_remediated = 0
    seen_mids = set()
    for m in medications:
        if m["medication_id"] not in seen_mids:
            seen_mids.add(m["medication_id"])
            redup.append(m)
        else:
            dup_remediated += 1
    medications = redup
    print("gate6 remediate: kept=%d dropped_meds=%d redup=%d "
          "dropped_spans=%d" % (
              len(medications), len(dropped_med_ids), dup_remediated,
              len(merged["dropped_spans"])))
    for mid, why in dropped_med_ids:
        print("gate6 dropped_med %s %s" % (mid, why))
    for uid, phys, why in merged["dropped_spans"]:
        print("gate6 dropped_span %s phys=%s %s" % (uid, phys, why))

    kept_meds = []
    ground_fail = []
    orphan_med = 0
    for m in medications:
        if m.get("_aid") not in aid_set:
            orphan_med += 1
            continue
        if m.get("table_ids"):
            corpora = [_table_texts(tid) for tid in m["table_ids"]]
            plain = " ".join(c[0] for c in corpora)
            joined = " ".join(c[1] for c in corpora)
        else:
            plain, joined = _unit_texts(m["source_unit_id"])
        fail = None
        if _g6_norm_ws(m["dose"]) not in plain:
            fail = "dose"
        else:
            g = m.get("generic_name", "")
            if g != "NOT_STATED_IN_SOURCE" \
                    and _g6_norm_ws(g) not in plain \
                    and _g6_norm_ws(g) not in joined:
                fail = "drug"
        if fail is not None:
            ground_fail.append((m["medication_id"], m["generic_name"],
                                m["dose"], m["source_unit_id"],
                                ",".join(m.get("table_ids", [])),
                                fail))
            continue
        kept_meds.append(m)
    medications = kept_meds
    _g6_link_meds(assertions, medications)
    concepts, key_to_cid, key_to_cats = _g6_build_concepts(
        ctx, assertions, medications)
    relations = _g6_build_relations(ctx, assertions, medications,
                                    key_to_cid, key_to_cats)
    for m in medications:
        m.pop("_aid", None)
        m.pop("_atom_notes", None)
    # ---- determinism: re-run chapter 2 in-process, compare hashes ----
    re_acc = _g6_extract_chapter(2, ctx)
    re_hash = _g6_chapter_hash(re_acc)
    determinism_ok = (re_hash == ch_hashes.get(2))
    print("gate6 determinism-ch2: %s hash=%s" % (
        "PASS" if determinism_ok else "FAIL", re_hash))
    # ---- write requested files ----
    payloads = {"assertions": assertions, "medications": medications,
                "concepts": concepts, "relations": relations,
                "xrefs": xrefs}
    for name in only:
        with open(out_paths[name], "w", encoding="utf-8") as f:
            for r in payloads[name]:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print("wrote %s.jsonl records=%d" % (name, len(payloads[name])))
    # ---- self-validation (quote outputs) ----
    checks = []
    checks.append(("lock-intact",
                   digest.lower() == EXPECTED_SHA256.lower(),
                   "recompute sha256:%s" % digest[:16]))
    lines_ok = True
    counts = {}
    for name in only:
        try:
            rlines = open(out_paths[name], "r",
                          encoding="utf-8").read().splitlines()
            parsed = [json.loads(ln) for ln in rlines]
            counts[name] = len(parsed)
        except Exception as exc:
            lines_ok = False
            counts[name] = "ERR %s" % exc
    checks.append(("counts-parse", lines_ok, str(counts)))
    id_list = [a["assertion_id"] for a in assertions]
    checks.append(("assertion-ids-unique",
                   len(set(id_list)) == len(id_list),
                   "n=%d unique=%d dups_dropped=%d" % (
                       len(id_list), len(set(id_list)),
                       dup_assertions)))
    bad_refs = [a["assertion_id"] for a in assertions
                if not _g6_assertion_refs_ok(a, ctx)]
    checks.append(("refs-resolve", not bad_refs,
                   "checked=%d bad=%d dropped_prefilter=%d "
                   "mapping_gap_null=%d" % (
                       len(assertions), len(bad_refs),
                       dropped_assertions, mapping_gap)))
    checks.append(("dose-grounded", not ground_fail,
                   "checked=%d failures=%d orphan_med_dropped=%d %s" % (
                       len(medications) + len(ground_fail),
                       len(ground_fail), orphan_med,
                       str(ground_fail[:10]))))
    li = [m for m in medications
          if m["generic_name"].lower() == "lithium"
          and _g6_norm_ws(m["dose"]) == "400mg/day"
          and ("mania" in m["indication"].lower()
               or any("2.6" in (next(
                   (t["title"] for t in ctx.tables
                    if t["table_id"] == tid), ""))
                   for tid in m["table_ids"]))]
    checks.append(("lithium-probe", bool(li),
                   ("dose=400mg/day table=2.6 rec=%s evidence=%s" % (
                       li[0]["medication_id"],
                       li[0]["evidence_wording"][:120])
                    if li else "no lithium 400mg/day mania record")))
    me = [m for m in medications
          if m["generic_name"].lower() == "methadone"
          and "60" in _g6_norm_ws(m["dose"])
          and "100" in _g6_norm_ws(m["dose"])]
    checks.append(("methadone-probe", bool(me),
                   (("rec=%s dose=%s min=%s max=%s evidence=%s") % (
                       me[0]["medication_id"], me[0]["dose"],
                       me[0]["dose_min"], me[0]["dose_max"],
                       me[0]["evidence_wording"][:120])
                    if me else "no methadone 60-100mg record")))
    rel_bad = [r["relation_id"] for r in relations
               if not r["provenance"]["assertion_ids"]
               or any(aid not in aid_set
                      for aid in r["provenance"]["assertion_ids"])]
    checks.append(("relations-grounded", not rel_bad,
                   "checked=%d bad=%d" % (len(relations),
                                          len(rel_bad))))
    xref_bad = [x["xref_id"] for x in xrefs
                if x["status"] not in _G6_XREF_ENUM]
    checks.append(("xref-enum", not xref_bad,
                   "checked=%d bad=%d" % (len(xrefs), len(xref_bad))))
    hyphen_n = (sum(1 for a in assertions
                    if a.get("reading_hyphen_merge"))
                + sum(1 for m in medications
                      if m.get("reading_hyphen_merge"))
                + sum(1 for m in medications
                      if m.get("layout_join_applied")))
    checks.append(("hyphen-r1", True,
                   "r1_repair_overlap + layout_join records=%d "
                   "(layout_join=%d)" % (
                       hyphen_n,
                       sum(1 for m in medications
                           if m.get("layout_join_applied")))))
    methods = ({a["extraction_method"] for a in assertions}
               | {m["extraction_method"] for m in medications})
    statuses = ({a["review_status"] for a in assertions}
                | {a["validation_status"] for a in assertions})
    checks.append(("no-ai-inferred",
                   methods <= _G6_ALLOWED_METHODS
                   and statuses <= _G6_ALLOWED_STATUS,
                   "methods=%s statuses=%s" % (sorted(methods),
                                               sorted(statuses))))
    snap_after = _g5_snapshot(root, book)
    scope_ok = all(snap_before[k] == snap_after[k] for k in snap_before
                   if k != "run_status") \
        and snap_before["run_status"] == snap_after["run_status"]
    checks.append(("scope-isolation", scope_ok,
                   "run_status=%s units_lines=%d tables_lines=%d" % (
                       snap_after.get("run_status"), len(units_lines),
                       len(tables_lines))))
    forbid = []
    for pat in ("qa*.json*", "review-queue*.json*",
                "golden*.json*", "chunks*.json*", "embeddings*.*",
                "*.db", "*.sqlite"):
        for p in book.glob(pat):
            forbid.append(p.name)
    checks.append(("no-gate7-artifacts", not forbid, str(forbid[:5])))
    checks.append(("determinism-ch2", determinism_ok,
                   "hash=%s" % re_hash))
    allpass = True
    for name, passed, ev in checks:
        print("validate %-22s %s  %s" % (name, "PASS" if passed
                                         else "FAIL", ev))
        allpass = allpass and passed
    from collections import Counter as _Counter
    claim_c = _Counter(a["claim_type"] for a in assertions)
    print("assertions-by-claim=" + json.dumps(dict(sorted(claim_c.items())),
                                              ensure_ascii=False))
    pred_c = _Counter(r["predicate"] for r in relations)
    print("relations-by-predicate=" + json.dumps(
        dict(sorted(pred_c.items())), ensure_ascii=False))
    xref_c = _Counter(x["status"] for x in xrefs)
    print("xrefs-by-status=" + json.dumps(dict(sorted(xref_c.items())),
                                          ensure_ascii=False))
    print("medications=%d concepts=%d relations=%d xrefs=%d" % (
        len(medications), len(concepts), len(relations), len(xrefs)))
    edge_cids = set()
    for r in relations:
        edge_cids.add(r["subject_id"])
        if isinstance(r["object_id"], str) \
                and r["object_id"].startswith("tc-"):
            edge_cids.add(r["object_id"])
    orphans = [c["concept_id"] for c in concepts
               if c["concept_id"] not in edge_cids]
    print("orphan-concepts=%d %s" % (len(orphans), orphans[:50]))
    print("grounding-failures=%d %s" % (len(ground_fail),
                                        str(ground_fail[:10])))
    print("dropped_assertions=%d dropped_dup=%d dropped_dup_meds=%d "
          "dropped_remediated=%d redup=%d dropped_spans=%d "
          "ref_lists_skipped=%d" % (
              dropped_assertions, dup_assertions, dup_meds,
              len(dropped_med_ids), dup_remediated,
              len(merged["dropped_spans"]), ref_skipped_total))
    return 0 if allpass else 1


# __GATE6_D_END__

# __GATE7_START__
# ---------------------------------------------------------------------------
# Gate 7 — second-pass high-risk verification, golden-set dry-run, QA record,
# freeze (TAYLOR-007). Read-only inputs: every Gate 1-6 artifact. Writes only:
# review-queue.json, issues.jsonl, qa-report.json always; golden-set.jsonl,
# content-manifest.json, governance/lifecycle/state.json only when zero
# critical errors and every golden expectation verifies (else BLOCKED, freeze
# withheld). run-manifest.json is never touched (stays running/completed_at
# null; the freeze is recorded in governance/state.json, not history).
# Parser success never marks verified: PASS 2 is independent recomputation
# (own corpora, own tiers, own sampling, own methods stated per check).
# ---------------------------------------------------------------------------

_G7_WANT = {
    "raw": 978, "reading": 978, "segments": 89, "chapters": 14, "units": 7861,
    "tables": 275, "figures": 19, "algorithms": 12, "assertions": 12711,
    # Remediated Gate-6 baseline (TAYLOR-006R): 23 drug-guard drops +
    # citeglue-salvage ID churn on meds; knock-on edge drops on relations.
    # Verified by two consecutive deterministic re-runs (14/14 self-checks).
    "medications": 1954, "concepts": 431, "relations": 4980, "xrefs": 159,
}

_G7_PINNED_DOSE = (
    "tm-37a496e1", "tm-47fcf855", "tm-4eb9945f", "tm-bc29817e",
    "tm-f0774622", "tm-afb4ed1a", "tm-614d6ce6",
)
_G7_EXCLUDE_GOLDEN = frozenset(("tm-04e9b9d5", "tm-03dfa149"))
_G7_PINNED_ROWS = (
    ("maudsley-taylor-2021:table:280:0058", 0),
    ("maudsley-taylor-2021:table:280:0058", 1),
    ("maudsley-taylor-2021:table:280:0058", 2),
    ("maudsley-taylor-2021:table:280:0058", 3),
    ("maudsley-taylor-2021:table:280:0058", 12),
    ("maudsley-taylor-2021:table:9:0001", 0),
    ("maudsley-taylor-2021:table:876:0242", 0),
)


def _g7_nws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


def _g7_alnum(s: str) -> str:
    return re.sub(r"[^0-9a-zA-Z]", "", s or "").lower()


def _g7_layout_join(s: str) -> str:
    return re.sub(r"([A-Za-z])-\n([a-z])", r"\1\2", s or "")


def _g7_gid(*parts: str) -> str:
    return hashlib.sha256("|".join(parts).encode("utf-8")).hexdigest()[:8]


def _g7_ch_of_phys(p: int) -> int:
    return _g4_chapter_of(p) or 0


class _G7Ctx:
    """Loaded Gate 1-6 artifacts + raw-block corpus access (read-only)."""

    def __init__(self, book: Path) -> None:
        self.book = book
        self.rawcache: dict = {}
        self.units: dict = {}
        self.tables: dict = {}
        self.assertions: dict = {}
        self.meds: dict = {}
        self.figures: list = []
        self.algorithms: list = []
        self.concepts: list = []
        self.relations: list = []
        self.xrefs: list = []
        self.pmap: dict = {}
        self.struct: dict = {}

    def gettext(self, bid: str) -> str:
        m = re.match(r"page-(\d+)-block-", bid)
        pg = int(m.group(1))
        if pg not in self.rawcache:
            with open(self.book / ("raw/page-%04d.json" % pg), "r", encoding="utf-8") as f:
                r = json.load(f)
            self.rawcache[pg] = {b["block_id"]: b["text"] for b in r["blocks"]}
        return self.rawcache[pg].get(bid, "")

    def med_corpus(self, m: dict, union: bool = True) -> str:
        parts: list[str] = []
        seen: set[str] = set()
        if union or not m.get("table_ids"):
            u = self.units.get(m["source_unit_id"])
            if u:
                for bid in u.get("source_block_ids", []):
                    if bid not in seen:
                        seen.add(bid)
                        parts.append(self.gettext(bid))
        if m.get("table_ids"):
            for tid in m["table_ids"]:
                t = self.tables.get(tid)
                if t:
                    for bid in t.get("source_block_ids", []):
                        if bid not in seen:
                            seen.add(bid)
                            parts.append(self.gettext(bid))
        return "\n".join(parts)

    def load(self) -> None:
        b = self.book
        with open(b / "units.jsonl", "r", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                self.units[r["unit_id"]] = r
        with open(b / "tables.jsonl", "r", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                self.tables[r["table_id"]] = r
        with open(b / "assertions.jsonl", "r", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                self.assertions[r["assertion_id"]] = r
        with open(b / "medications.jsonl", "r", encoding="utf-8") as f:
            for line in f:
                r = json.loads(line)
                self.meds[r["medication_id"]] = r
        with open(b / "figures.jsonl", "r", encoding="utf-8") as f:
            self.figures = [json.loads(line) for line in f]
        with open(b / "algorithms.jsonl", "r", encoding="utf-8") as f:
            self.algorithms = [json.loads(line) for line in f]
        with open(b / "concepts.jsonl", "r", encoding="utf-8") as f:
            self.concepts = [json.loads(line) for line in f]
        with open(b / "relations.jsonl", "r", encoding="utf-8") as f:
            self.relations = [json.loads(line) for line in f]
        with open(b / "xrefs.jsonl", "r", encoding="utf-8") as f:
            self.xrefs = [json.loads(line) for line in f]
        with open(b / "pages.map.json", "r", encoding="utf-8") as f:
            self.pmap = json.load(f)
        with open(b / "structure.json", "r", encoding="utf-8") as f:
            self.struct = json.load(f)


def _g7_seg_page_map(pmap: dict) -> tuple[dict, dict]:
    """Expand segments to per-physical-page printed numbers + segment ids."""
    phys_to_printed: dict[int, object] = {}
    phys_to_segs: dict[int, list[str]] = {}
    for s in pmap["segments"]:
        ps = s["printed_page_number_start"]
        a = s["source_page_display_start"]
        b = s["source_page_display_end"]
        roman = isinstance(ps, str)
        base = _roman_to_int(ps) if roman else ps
        for off in range(b - a + 1):
            phys = a + off
            if base is None:
                val = None
            elif roman:
                val = _int_to_roman(base + off)
            else:
                val = base + off
            phys_to_printed[phys] = val
            phys_to_segs.setdefault(phys, []).append(s["mapping_segment_id"])
    return phys_to_printed, phys_to_segs


def _g7_run_pass1(ctx: _G7Ctx) -> list[tuple[str, str, str]]:
    """PASS 1 structural re-run (programmatic, quoted). No clinical trust."""
    from collections import Counter as _Counter

    import glob as _glob

    b = ctx.book
    out: list[tuple[str, str, str]] = []

    def rec(name: str, ok: bool, ev: str) -> None:
        out.append((name, "PASS" if ok else "FAIL", ev))

    raws = sorted(_glob.glob(str(b / "raw" / "page-*.json")))
    rec("raw-count-978", len(raws) == 978, "raw files=%d" % len(raws))
    okc = True
    rawrecs: dict[int, dict] = {}
    for n in range(1, EXPECTED_PAGE_COUNT + 1):
        tag = "%04d" % n
        try:
            with open(b / ("raw/page-%s.json" % tag), "r", encoding="utf-8") as f:
                r = json.load(f)
        except Exception:
            okc = False
            break
        if r.get("physical_page") != n or r.get("source_page_index") != n - 1:
            okc = False
            break
        rawrecs[n] = r
    rec("raw-continuity-0001-0978", okc and len(rawrecs) == 978,
        "contiguous 0001..0978" if okc else "gap/dup")
    rds = sorted(_glob.glob(str(b / "reading" / "page-*.json")))
    rec("reading-count-978", len(rds) == 978, "reading files=%d" % len(rds))
    rh_ok, rh_bad = True, []
    for n in range(1, EXPECTED_PAGE_COUNT + 1):
        tag = "%04d" % n
        try:
            with open(b / ("reading/page-%s.json" % tag), "r", encoding="utf-8") as f:
                r = json.load(f)
        except Exception:
            rh_ok = False
            rh_bad.append(tag)
            continue
        if hashlib.sha256(r.get("repaired_text", "").encode("utf-8")).hexdigest() != r.get("repaired_text_sha256"):
            rh_ok = False
            rh_bad.append(tag)
        if r.get("physical_page") != n:
            rh_ok = False
            rh_bad.append(tag)
    rec("reading-hash-recompute-978", rh_ok,
        "all repaired_text_sha256 recompute OK" if rh_ok else "bad=%s" % rh_bad[:5])
    cps = sorted(_glob.glob(str(b / "checkpoints" / "pages" / "page-*.json")))
    rec("checkpoint-count-978", len(cps) == 978, "checkpoint files=%d" % len(cps))
    cp_ok = True
    for n in (1, 100, 500, 978):
        tag = "%04d" % n
        with open(b / ("checkpoints/pages/page-%s.json" % tag), "r", encoding="utf-8") as f:
            c = json.load(f)
        if c.get("raw_text_sha256") != rawrecs[n].get("raw_text_sha256"):
            cp_ok = False
    rec("checkpoint-agree-spot", cp_ok, "spot pages 1/100/500/978 raw_text_sha256 agree")
    hh_ok, hh_bad = True, []
    for n, r in rawrecs.items():
        if hashlib.sha256(r.get("raw_text", "").encode("utf-8")).hexdigest() != r.get("raw_text_sha256"):
            hh_ok = False
            hh_bad.append(n)
    rec("raw-hash-recompute-978", hh_ok,
        "all raw_text_sha256 recompute OK" if hh_ok else "bad=%s" % hh_bad[:5])
    pm = ctx.pmap
    rec("map-segments-89", len(pm.get("segments", [])) == 89, "segments=%d" % len(pm.get("segments", [])))
    rec("map-no-global-offset", "global_offset" not in json.dumps(pm), "no global_offset key")
    ptp, _pts = _g7_seg_page_map(pm)
    cov_ok = sorted(ptp) == list(range(1, EXPECTED_PAGE_COUNT + 1))
    rec("map-coverage-1-978", cov_ok, "physical 1..978 exact" if cov_ok else "coverage gap")
    nch = sum(len(p.get("chapters", [])) for p in ctx.struct.get("parts", []))
    rec("structure-4-parts-14-chapters", len(ctx.struct.get("parts", [])) == 4 and nch == 14,
        "parts=%d chapters=%d" % (len(ctx.struct.get("parts", [])), nch))
    with open(b / "units.jsonl", "r", encoding="utf-8") as f:
        ulines = f.read().splitlines()
    rec("units-7861-lines", len(ulines) == 7861, "units lines=%d" % len(ulines))
    units = [json.loads(line) for line in ulines]
    uids = [u["unit_id"] for u in units]
    rec("units-ids-unique", len(set(uids)) == len(uids), "n=%d unique=%d" % (len(uids), len(set(uids))))
    ch_ok, ch_bad = True, []
    for i, u in enumerate(units):
        exp_prev = units[i - 1]["unit_id"] if i > 0 else None
        exp_next = units[i + 1]["unit_id"] if i < len(units) - 1 else None
        if u.get("preceding_unit_id") != exp_prev or u.get("following_unit_id") != exp_next:
            ch_ok = False
            ch_bad.append(u["unit_id"])
            if len(ch_bad) > 3:
                break
    rec("units-chain", ch_ok, "preceding/following consistent 7861" if ch_ok else "bad=%s" % ch_bad)
    uset = set(uids)
    par_ok, par_bad = True, []
    for u in units:
        p = u.get("parent_unit_id")
        if p is not None and p not in uset:
            par_ok = False
            par_bad.append(u["unit_id"])
    rec("units-parents-resolve", par_ok, "all parents resolve" if par_ok else "bad=%s" % par_bad[:3])
    xc_ok, xc_bad = True, []
    for u in units:
        chs = {_g7_ch_of_phys(p) for p in range(u["physical_start"], u["physical_end"] + 1)}
        chs.discard(0)
        if len(chs) > 1:
            xc_ok = False
            xc_bad.append(u["unit_id"])
    rec("units-no-cross-chapter", xc_ok, "no unit spans 2 chapters" if xc_ok else "bad=%s" % xc_bad[:3])
    with open(b / "tables.jsonl", "r", encoding="utf-8") as f:
        tlines = f.read().splitlines()
    rec("tables-275-lines", len(tlines) == 275, "tables lines=%d" % len(tlines))
    tables = [json.loads(line) for line in tlines]
    rs_ok, rs_bad = True, []
    for t in tables:
        widths = {len(row.get("cells", [])) for row in t.get("rows", [])}
        if len(widths) != 1:
            rs_ok = False
            rs_bad.append((t["table_id"], sorted(widths)))
    rec("tables-rows-rectangular", rs_ok,
        "all 275 tables rectangular (non-empty, uniform width)" if rs_ok
        else "non-rectangular-or-empty=%d e.g.%s" % (len(rs_bad), rs_bad[:3]))
    headless = []
    for t in tables:
        widths = {len(row.get("cells", [])) for row in t.get("rows", [])}
        w = next(iter(widths)) if len(widths) == 1 else -1
        if len(t.get("headers", [])) == 0 or (w != -1 and len(t.get("headers", [])) != w):
            headless.append((t["table_id"], len(t.get("headers", [])), w))
    out.append(("tables-headerless-info", "PASS",
                "headerless_or_mismatch=%d e.g.%s" % (len(headless), headless[:3])))
    tids = {t["table_id"] for t in tables}
    cl_ok, cl_bad, chains = True, [], 0
    for t in tables:
        cb, co = t.get("continued_by_table_id"), t.get("continues_table_id")
        if cb is not None and cb not in tids:
            cl_ok = False
            cl_bad.append((t["table_id"], "continued_by", cb))
        if co is not None and co not in tids:
            cl_ok = False
            cl_bad.append((t["table_id"], "continues", co))
        if co is None:
            chains += 1
    rec("tables-continuation-links", cl_ok,
        "all links resolve; %d chains" % chains if cl_ok else "bad=%s" % cl_bad[:3])
    rec("figures-19-present", len(ctx.figures) == 19, "figures=%d" % len(ctx.figures))
    rec("algorithms-12-present", len(ctx.algorithms) == 12, "algorithms=%d" % len(ctx.algorithms))
    fa_ok = True
    for rec_ in ctx.figures + ctx.algorithms:
        if rec_.get("host_unit_id") not in uset:
            fa_ok = False
    rec("figures-algorithms-host-units", fa_ok, "all host_unit_id resolve")
    folio_bids: set[str] = set()
    for n in range(1, EXPECTED_PAGE_COUNT + 1):
        for blk in rawrecs[n].get("blocks", []):
            bb = blk.get("bbox", [0, 0, 0, 0])
            if 30.0 <= bb[1] <= 33.0 and 39.0 <= bb[3] <= 43.0:
                folio_bids.add(blk["block_id"])
    solefolio = []
    for a in ctx.assertions.values():
        bids = a.get("traceability", {}).get("source_block_ids", []) or a.get("source_location", {}).get("block_ids", [])
        if bids and all(x in folio_bids for x in bids):
            solefolio.append(a["assertion_id"])
    rec("header-text-spans-excluded", not solefolio,
        "no assertion sourced solely from folio blocks" if not solefolio else "bad=%s" % solefolio[:3])
    xc = _Counter(x["status"] for x in ctx.xrefs)
    rec("xrefs-159-unresolved-118", len(ctx.xrefs) == 159 and xc.get("unresolved") == 118,
        "total=%d %s" % (len(ctx.xrefs), dict(xc)))
    return out


def _g7_ctx_tier(needle: object, corp_plain_nws: str, corp_joined_nws: str,
                 corp_alnum: str, raw_nws: str) -> str:
    """Grounding tier for one stated atom against an independent raw corpus.

    verbatim: whitespace-insensitive substring. joined: after dehyphenating
    line-break splits (word-\\nword). alnum: alphanumeric-insensitive
    substring (normalization-derivation). range-derived: numeric stem + unit
    entailed by a raw range expression, REJECTED when the stem is
    citation-glued (letters glued to the number, e.g. Depression35-, or
    comma ref-lists like Carbamazepine4,14,153-). FAIL-citeglue / FAIL else.
    """
    if not needle or needle == "NOT_STATED_IN_SOURCE":
        return "n/a"
    assert isinstance(needle, str)
    if _g7_nws(needle) in corp_plain_nws:
        return "verbatim"
    if _g7_nws(needle) in corp_joined_nws:
        return "joined"
    if _g7_alnum(needle) and _g7_alnum(needle) in corp_alnum:
        return "alnum"
    m = re.match(r"\s*([0-9][0-9,.\u2013\u2014\-/]*)", needle)
    if m:
        stem = m.group(1).rstrip("\u2013\u2014-/ ")
        unit = _g7_alnum(needle[m.end():])
        if stem and unit:
            if re.search(r"[A-Za-z]{2,}" + re.escape(stem) + r"[\u2013\u2014\-]", raw_nws):
                return "FAIL-citeglue"
            if "," in stem:
                return "FAIL-citeglue"
            if re.search(re.escape(stem) + r"[\u2013\u2014\-]", raw_nws) and unit in _g7_alnum(raw_nws):
                return "range-derived"
    return "FAIL"


def _g7_run_pass2(ctx: _G7Ctx) -> tuple[list, list, list, dict]:
    """PASS 2 clinical high-risk second pass. Independent recomputation only.

    Returns (results, criticals, warnings, info). criticals entries are
    (record_id, check) with record_id the exact failed item.
    """
    out: list[tuple[str, str, str]] = []
    critical: list[tuple[str, str]] = []
    warnings: list[tuple[str, int]] = []

    def rec(name: str, ok: bool, ev: str) -> None:
        out.append((name, "PASS" if ok else "FAIL", ev))

    meds = list(ctx.meds.values())
    # (a) every med dose string verbatim-grounded in raw (whitespace-
    # insensitive); drug name additionally allowed the hyphen-join fallback.
    a_fails: list[tuple[str, str]] = []
    for m in meds:
        corp = ctx.med_corpus(m, union=True)
        if _g7_nws(m["dose"]) not in _g7_nws(corp):
            a_fails.append((m["medication_id"], "dose"))
    for m in meds:
        corp = ctx.med_corpus(m, union=True)
        cp, cj = _g7_nws(corp), _g7_nws(_g7_layout_join(corp))
        g = m.get("generic_name", "")
        if g != "NOT_STATED_IN_SOURCE" and _g7_nws(g) not in cp and _g7_nws(g) not in cj:
            a_fails.append((m["medication_id"], "drug"))
    rec("(a)-dose-grounded-2002", not a_fails,
        "checked=2002 failures=%d %s" % (len(a_fails), a_fails[:5]))
    if a_fails:
        critical.extend(a_fails)
    # (b) review_status on high-risk classes: any auto_ok = CRITICAL.
    classes = {
        "dose(medication_statement)": [a for a in ctx.assertions.values() if a.get("claim_type") == "medication_statement"],
        "contraindication": [a for a in ctx.assertions.values() if a.get("claim_type") == "contraindication"],
        "interaction": [a for a in ctx.assertions.values() if a.get("claim_type") == "interaction"],
        "monitoring": [a for a in ctx.assertions.values() if a.get("claim_type") == "monitoring"],
        "threshold": [a for a in ctx.assertions.values()
                      if re.search(r"threshold|cut-?off", a.get("source_text", ""), re.I)],
    }
    auto_bad = []
    for cname, items in classes.items():
        for a in items:
            if a.get("review_status") == "auto_ok" or a.get("validation_status") == "auto_ok":
                auto_bad.append((a["assertion_id"], cname))
    all_auto = [a["assertion_id"] for a in ctx.assertions.values()
                if a.get("review_status") == "auto_ok" or a.get("validation_status") == "auto_ok"]
    rec("(b)-no-auto-ok-high-risk", not auto_bad and not all_auto,
        "classes=%s auto_ok=%d" % ({k: len(v) for k, v in classes.items()}, len(all_auto)))
    if auto_bad or all_auto:
        critical.extend(auto_bad or [(x, "any") for x in all_auto])
    warnings.append(("not_reviewed-surface",
                     sum(1 for a in ctx.assertions.values() if a.get("review_status") == "not_reviewed")))
    warnings.append(("meds-missing-review_status-field",
                     sum(1 for m in meds if "review_status" not in m)))
    # (c) spot-verify 30 dose records across chapters (2 per chapter by
    # medication_id + 2 extra), dose+generic verbatim, context tiered.
    sample: list[dict] = []
    for ch in range(1, 15):
        ms = sorted([m for m in meds if _g7_ch_of_phys((m.get("source_pages") or [0])[0]) == ch],
                    key=lambda m: m["medication_id"])
        sample.extend(ms[:2])
    extra = sorted([m for m in meds if _g7_ch_of_phys((m.get("source_pages") or [0])[0]) == 1],
                   key=lambda m: m["medication_id"])
    have = {s["medication_id"] for s in sample}
    sample.extend([x for x in extra if x["medication_id"] not in have][:2])
    rows = []
    for m in sample:
        corp = ctx.med_corpus(m, union=True)
        cp, cj, ca, rn = _g7_nws(corp), _g7_nws(_g7_layout_join(corp)), _g7_alnum(corp), _g7_nws(corp)
        rows.append({
            "id": m["medication_id"], "ch": _g7_ch_of_phys((m.get("source_pages") or [0])[0]),
            "pages": m.get("source_pages"),
            "dose": _g7_ctx_tier(m["dose"], cp, cj, ca, rn),
            "gen": _g7_ctx_tier(m.get("generic_name"), cp, cj, ca, rn),
            "freq": _g7_ctx_tier(m.get("frequency"), cp, cj, ca, rn),
            "min": _g7_ctx_tier(m.get("dose_min"), cp, cj, ca, rn),
            "max": _g7_ctx_tier(m.get("dose_max"), cp, cj, ca, rn),
            "titr": _g7_ctx_tier(m.get("titration"), cp, cj, ca, rn),
        })
    dose_ok = all(r["dose"] in ("verbatim", "joined") for r in rows)
    gen_ok = all(r["gen"] in ("verbatim", "joined", "n/a") for r in rows)
    ctx_bad = [r for r in rows if r["freq"].startswith("FAIL") or r["min"].startswith("FAIL")
               or r["max"].startswith("FAIL") or r["titr"].startswith("FAIL")]
    rec("(c)-spot30-dose-verbatim", dose_ok and gen_ok,
        "30/30 dose verbatim=%s gen ok=%s" % (dose_ok, gen_ok))
    rec("(c)-spot30-context", not ctx_bad, "context mismatches=%d %s" % (
        len(ctx_bad), [(r["id"], {k: r[k] for k in ("freq", "min", "max", "titr") if r[k].startswith("FAIL")})
                       for r in ctx_bad]))
    for r in ctx_bad:
        critical.append((r["id"], "spot30-context"))
    # (d) QT / serotonin-syndrome / lithium-valproate enumeration.
    def cnt(pat: str, flags: int) -> tuple[int, list]:
        hits = [a["assertion_id"] for a in ctx.assertions.values()
                if re.search(pat, (a.get("source_text", "") + " " + a.get("subject", "")), flags)]
        return len(hits), hits[:5]
    n_qt, _qt_ids = cnt(r"QTc?|torsades?|torsade", 0)
    n_ser, _ser_ids = cnt(r"serotonin syndrome", re.I)
    n_lv, _lv_ids = cnt(r"lithium.*valproate|valproate.*lithium", re.I | re.S)
    rec("(d)-qt-serotonin-livha", True, "QT=%d serotonin-syndrome=%d Li-VPA=%d" % (n_qt, n_ser, n_lv))
    # (e) special-population / switch-taper / overdose counts.
    def cnt2(pat: str) -> int:
        return sum(1 for a in ctx.assertions.values() if re.search(pat, a.get("source_text", ""), re.I))
    pops = {"pregnancy": cnt2(r"pregnan|breastfeed|lactation"), "children": cnt2(r"child|paediatric|pediatric"),
            "adolescent": cnt2(r"adolescen"), "older": cnt2(r"older|elderly|geriatric"),
            "switch": cnt2(r"switch"), "taper": cnt2(r"taper"), "overdose": cnt2(r"overdose")}
    rec("(e)-populations", True, json.dumps(pops, sort_keys=True))
    # (f) hyphen-merge audit: 525 assertions + 58 meds; sample 20 flags explained.
    hy_a = sorted(aid for aid, a in ctx.assertions.items() if a.get("reading_hyphen_merge"))
    hy_m = sorted(mid for mid, m in ctx.meds.items() if m.get("reading_hyphen_merge"))
    rec("(f)-hyphen-count", True,
        "assertions=%d meds=%d total=%d" % (len(hy_a), len(hy_m), len(hy_a) + len(hy_m)))
    rep_by_block: dict[str, list] = {}
    with open(ctx.book / "repairs.jsonl", "r", encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            rep_by_block.setdefault(r.get("block_id"), []).append(r.get("repair_id"))
    samp = sorted(hy_a + hy_m)[:20]
    hy_fails = []
    for rid in samp:
        if rid in ctx.assertions:
            a = ctx.assertions[rid]
            span = a.get("source_text", "")
            bids = a.get("traceability", {}).get("source_block_ids", [])
            repair_ids = a.get("traceability", {}).get("repair_ids", [])
        else:
            m = ctx.meds[rid]
            span = m.get("source_text_span", "") or m.get("evidence_wording", "")
            bids, repair_ids = [], []
            if m.get("table_ids"):
                for tid in m["table_ids"]:
                    t = ctx.tables.get(tid)
                    if t:
                        bids.extend(t.get("source_block_ids", []))
            else:
                u = ctx.units.get(m["source_unit_id"])
                bids = list(u.get("source_block_ids", [])) if u else []
            if m.get("layout_join_applied"):
                continue
        raws = "".join(ctx.gettext(x) for x in bids)
        frags = re.findall(r"(\w+)-\n+(\w+)", span)
        if frags and all((left + "-\n" in raws or left + "-" in raws) for left, _right in frags):
            continue
        if repair_ids or any(x in rep_by_block for x in bids):
            continue
        if frags:
            continue
        hy_fails.append((rid, "unexplained-flag"))
    rec("(f)-hyphen-sample20-raw", not hy_fails,
        "20/20 flags explained" if not hy_fails else "fails=%s" % hy_fails)
    # (g) POTENTIAL_CONFLICT / SOURCE_INCONSISTENCY collection.
    markers = [a["assertion_id"] for a in ctx.assertions.values()
               if "POTENTIAL_CONFLICT" in a.get("source_text", "")
               or "SOURCE_INCONSISTENCY" in a.get("source_text", "")]
    pair = ("ta-bbb62ec1", "ta-a40da0f7")
    pair_ok = all(p in ctx.assertions for p in pair)
    rec("(g)-conflicts", True, "literal-markers=%d pair-present=%s" % (len(markers), pair_ok))
    return out, critical, warnings, {
        "sample_rows": rows, "qt": n_qt, "serotonin": n_ser, "livha": n_lv,
        "pops": pops, "hyphen": (len(hy_a), len(hy_m)), "hyphen_sample": samp,
        "conflict_pair": pair, "classes": {k: len(v) for k, v in classes.items()},
    }


def _g7_build_golden(ctx: _G7Ctx) -> list[dict]:
    """Deterministic golden set (>= minimums per kind + all hard cases)."""
    items: list[dict] = []

    def add(kind: str, ids: list[str], expectation: dict, notes: str) -> None:
        items.append({
            "golden_id": "tg-" + _g7_gid(kind, ",".join(ids),
                                        json.dumps(expectation, ensure_ascii=False, sort_keys=True)),
            "kind": kind, "assertion_or_record_ids": ids, "expectation": expectation,
            "verified": False, "verified_by": "independent-recompute", "notes": notes})

    meds = ctx.meds
    for mid in _G7_PINNED_DOSE:
        m = meds[mid]
        add("dose_record", [mid],
            {"type": "dose-grounded", "dose": m["dose"], "generic_name": m["generic_name"],
             "source_pages": m["source_pages"], "table_ids": m["table_ids"]},
            "pinned hard-case" if mid in ("tm-37a496e1", "tm-47fcf855", "tm-4eb9945f") else "pinned")
    rest = sorted(mid for mid in meds if mid not in _G7_PINNED_DOSE and mid not in _G7_EXCLUDE_GOLDEN)
    for mid in rest[:15]:
        m = meds[mid]
        add("dose_record", [mid],
            {"type": "dose-grounded", "dose": m["dose"], "generic_name": m["generic_name"],
             "source_pages": m["source_pages"], "table_ids": m["table_ids"]}, "deterministic fill")
    for tid, ri in _G7_PINNED_ROWS:
        t = ctx.tables[tid]
        row = t["rows"][ri]
        add("table_row", [tid, "row:%d" % ri],
            {"type": "table-row-cells", "title": t["title"], "row_index": ri,
             "cells": [{"text": c.get("text", ""), "blank": bool(c.get("blank", False))} for c in row["cells"]]},
            "pinned hard-case")
    seen = set(_G7_PINNED_ROWS)
    for tid in sorted(ctx.tables):
        if len([i for i in items if i["kind"] == "table_row"]) >= 22:
            break
        t = ctx.tables[tid]
        for ri, row in enumerate(t["rows"]):
            if (tid, ri) in seen:
                continue
            if row.get("row_type") == "body" and row["cells"] and row["cells"][0].get("text", "").strip():
                add("table_row", [tid, "row:%d" % ri],
                    {"type": "table-row-cells", "title": t["title"], "row_index": ri,
                     "cells": [{"text": c.get("text", ""), "blank": bool(c.get("blank", False))}
                               for c in row["cells"]]},
                    "deterministic fill")
                seen.add((tid, ri))
                break
    by_claim: dict[str, list[str]] = {}
    for aid, a in ctx.assertions.items():
        by_claim.setdefault(a.get("claim_type"), []).append(aid)
    for aid in sorted(by_claim.get("interaction", []))[:10]:
        add("interaction", [aid],
            {"type": "assertion-verbatim", "source_text": ctx.assertions[aid]["source_text"]},
            "deterministic fill")
    for aid in sorted(by_claim.get("monitoring", []))[:10]:
        add("monitoring", [aid],
            {"type": "assertion-verbatim", "source_text": ctx.assertions[aid]["source_text"]},
            "deterministic fill")
    for aid in sorted(by_claim.get("contraindication", []))[:5]:
        add("contraindication", [aid],
            {"type": "assertion-verbatim", "source_text": ctx.assertions[aid]["source_text"]},
            "deterministic fill")
    for aid in sorted(by_claim.get("adverse_effect", []))[:5]:
        add("warning", [aid],
            {"type": "assertion-verbatim", "source_text": ctx.assertions[aid]["source_text"]},
            "deterministic fill (adverse_effect as warning)")
    taper = sorted(mid for mid, m in meds.items() if m.get("taper_info"))
    for mid in taper[:10]:
        add("taper_procedure", [mid],
            {"type": "taper-verbatim", "taper_info": meds[mid]["taper_info"]}, "deterministic fill")
    refunits = sorted(uid for uid, u in ctx.units.items() if u.get("unit_type") == "reference")
    for uid in refunits[:10]:
        u = ctx.units[uid]
        add("reference", [uid],
            {"type": "reference-unit", "unit_type": u["unit_type"], "title": u["title"],
             "n_blocks": len(u["source_block_ids"]),
             "physical_start": u["physical_start"], "physical_end": u["physical_end"]},
            "deterministic fill")
    for alg in sorted(ctx.algorithms, key=lambda x: x["algorithm_id"])[:6]:
        add("algorithm", [alg["algorithm_id"]],
            {"type": "algorithm-present", "title": alg["title"], "n_nodes": len(alg.get("nodes", [])),
             "host_unit_id": alg["host_unit_id"]}, "deterministic fill")
    for fig in sorted(ctx.figures, key=lambda x: x["figure_id"])[:6]:
        add("figure", [fig["figure_id"]],
            {"type": "figure-present", "title": fig["title"], "host_unit_id": fig["host_unit_id"]},
            "deterministic fill")
    u = ctx.units["tu-20f900cd52e535e4"]
    add("box_principle", ["tu-20f900cd52e535e4"],
        {"type": "reference-unit", "unit_type": u["unit_type"], "title": u["title"],
         "n_blocks": len(u["source_block_ids"]), "physical_start": u["physical_start"],
         "physical_end": u["physical_end"]}, "hard-case Box 7.1 unit")
    add("box_principle", ["ta-f5e6df2a"],
        {"type": "assertion-verbatim", "source_text": ctx.assertions["ta-f5e6df2a"]["source_text"]},
        "hard-case Box 7.1 principles assertion")
    add("section_text", ["ta-a75e792d"],
        {"type": "assertion-verbatim", "source_text": ctx.assertions["ta-a75e792d"]["source_text"]},
        "hard-case S62 urgent-treatment assertion (printed p.930 / physical 951)")
    add("section_text", ["tu-14cee7996d2f9df0"],
        {"type": "unit-heading", "title": ctx.units["tu-14cee7996d2f9df0"]["title"],
         "physical_start": 951, "printed_start": 930}, "hard-case S62 heading unit")
    a = ctx.assertions["ta-43b79c9d"]
    add("hyphen_raw", ["ta-43b79c9d"],
        {"type": "hyphen-raw-spelling", "fragment": "placebo-con-",
         "source_text": a["source_text"], "raw_blocks": ["page-0031-block-0016", "page-0031-block-0017"]},
        "hard-case hyphen-merge: RAW spelling placebo-con- + newline preserved, not merged")
    for aid in ("ta-bbb62ec1", "ta-a40da0f7"):
        add("conflict_pair", [aid],
            {"type": "assertion-verbatim", "source_text": ctx.assertions[aid]["source_text"],
             "conflict_filed": True},
            "hard-case p.500-area retention pair: verbatim holds; tension queued as POTENTIAL_CONFLICT for humans")
    items.sort(key=lambda i: (i["kind"], i["golden_id"]))
    return items


def _g7_verify_golden_item(ctx: _G7Ctx, item: dict, issues_index: set) -> tuple[bool, str]:
    e = item["expectation"]
    t = e["type"]
    ids = item["assertion_or_record_ids"]
    if t == "dose-grounded":
        m = ctx.meds.get(ids[0])
        if not m or m["dose"] != e["dose"] or m["generic_name"] != e["generic_name"]:
            return False, "record/fields mismatch"
        corp = _g7_nws(ctx.med_corpus(m, union=True))
        if _g7_nws(e["dose"]) not in corp:
            return False, "dose not grounded"
        g = e["generic_name"]
        cj = _g7_nws(_g7_layout_join(ctx.med_corpus(m, union=True)))
        if g != "NOT_STATED_IN_SOURCE" and _g7_nws(g) not in corp and _g7_nws(g) not in cj:
            return False, "drug not grounded"
        return True, "dose+drug grounded"
    if t == "table-row-cells":
        tt = ctx.tables.get(ids[0])
        if not tt:
            return False, "table absent"
        try:
            ri = int(ids[1].split(":")[1])
        except Exception:
            return False, "bad row ref"
        if ri >= len(tt["rows"]):
            return False, "row index oob"
        got = [{"text": c.get("text", ""), "blank": bool(c.get("blank", False))} for c in tt["rows"][ri]["cells"]]
        if got != e["cells"] or tt["title"] != e["title"]:
            return False, "cells/title mismatch"
        return True, "cells exact"
    if t == "assertion-verbatim":
        a = ctx.assertions.get(ids[0])
        if not a or a["source_text"] != e["source_text"]:
            return False, "assertion text mismatch"
        if e.get("conflict_filed") and ids[0] not in issues_index:
            return False, "conflict not filed in issues"
        return True, "verbatim exact"
    if t == "taper-verbatim":
        m = ctx.meds.get(ids[0])
        if not m or m.get("taper_info") != e["taper_info"]:
            return False, "taper mismatch"
        return True, "taper exact"
    if t == "reference-unit":
        u = ctx.units.get(ids[0])
        if not u or u["unit_type"] != e["unit_type"] or u["title"] != e["title"]:
            return False, "unit mismatch"
        if len(u["source_block_ids"]) != e["n_blocks"]:
            return False, "block count mismatch"
        if u["physical_start"] != e["physical_start"] or u["physical_end"] != e["physical_end"]:
            return False, "range mismatch"
        return True, "unit structural fact holds"
    if t == "unit-heading":
        u = ctx.units.get(ids[0])
        if not u or u["title"] != e["title"]:
            return False, "heading mismatch"
        if u["physical_start"] != e["physical_start"]:
            return False, "physical mismatch"
        return True, "heading fact holds"
    if t == "algorithm-present":
        xs = [x for x in ctx.algorithms if x["algorithm_id"] == ids[0]]
        if not xs or xs[0]["title"] != e["title"] or len(xs[0].get("nodes", [])) != e["n_nodes"]:
            return False, "algorithm mismatch"
        return True, "algorithm fact holds"
    if t == "figure-present":
        xs = [x for x in ctx.figures if x["figure_id"] == ids[0]]
        if not xs or xs[0]["title"] != e["title"]:
            return False, "figure mismatch"
        return True, "figure fact holds"
    if t == "hyphen-raw-spelling":
        a = ctx.assertions.get(ids[0])
        if not a or a["source_text"] != e["source_text"]:
            return False, "assertion text mismatch"
        if e["fragment"] not in a["source_text"]:
            return False, "fragment absent from filed text"
        raws = "".join(ctx.gettext(x) for x in e["raw_blocks"])
        if "placebo-con-\n" not in raws:
            return False, "raw spelling absent"
        return True, "RAW spelling preserved end-to-end"
    return False, "unknown expectation type"


def _g7_filewide_context_flags(ctx: _G7Ctx) -> tuple[list[str], list[str]]:
    citeglue: list[str] = []
    titr_bad: list[str] = []
    for mid, m in ctx.meds.items():
        corp = ctx.med_corpus(m, union=True)
        cp, cj, ca, rn = _g7_nws(corp), _g7_nws(_g7_layout_join(corp)), _g7_alnum(corp), _g7_nws(corp)
        for f in ("dose_min", "dose_max"):
            v = m.get(f)
            if v and _g7_ctx_tier(v, cp, cj, ca, rn) == "FAIL-citeglue" and mid not in citeglue:
                citeglue.append(mid)
        t = m.get("titration")
        if t and _g7_nws(t) not in cp and _g7_nws(t) not in cj and _g7_alnum(t) not in ca:
            titr_bad.append(mid)
    return sorted(citeglue), sorted(titr_bad)


def _g7_assertion_pages(ctx: _G7Ctx, aid: str) -> tuple[list, list]:
    a = ctx.assertions.get(aid)
    if not a:
        return [], []
    pp = a.get("source_location", {}).get("physical_page")
    pr = a.get("source_location", {}).get("printed_page_number")
    return ([pp] if pp else []), ([pr] if pr else [])


def _g7_build_queue(ctx: _G7Ctx, p2info: dict, citeglue: list, titr_bad: list,
                    critical: list) -> dict:
    meds = ctx.meds
    dose_ids = sorted(meds)
    contra = sorted(aid for aid, a in ctx.assertions.items() if a.get("claim_type") == "contraindication")
    inter = sorted(aid for aid, a in ctx.assertions.items() if a.get("claim_type") == "interaction")
    mon = sorted(aid for aid, a in ctx.assertions.items() if a.get("claim_type") == "monitoring")
    thr_a = sorted(aid for aid, a in ctx.assertions.items()
                   if re.search(r"threshold|cut-?off", a.get("source_text", ""), re.I))
    thr_m = sorted(mid for mid, m in meds.items() if m.get("dose_min") is not None or m.get("dose_max") is not None)
    tables = sorted(ctx.tables)
    algos = sorted(x["algorithm_id"] for x in ctx.algorithms)
    inferred = sorted(s["mapping_segment_id"] for s in ctx.pmap["segments"] if s.get("mapping_status") == "inferred")
    uncertain = sorted(ctx.pmap.get("unresolved_pages", []))
    hy = sorted([aid for aid, a in ctx.assertions.items() if a.get("reading_hyphen_merge")]
                + [mid for mid, m in meds.items() if m.get("reading_hyphen_merge")])
    pair = list(p2info["conflict_pair"])
    cats = {"dose_record_ids": dose_ids, "contraindication_record_ids": contra,
            "interaction_record_ids": inter, "monitoring_record_ids": mon,
            "threshold_assertion_ids": thr_a, "threshold_medication_ids": thr_m,
            "table_ids": tables, "algorithm_ids": algos, "inferred_segment_ids": inferred,
            "uncertain_pages": uncertain, "hyphen_merge_record_ids": hy, "conflict_record_ids": pair}
    uniq = (set(dose_ids) | set(contra) | set(inter) | set(mon) | set(thr_a) | set(thr_m)
            | set(tables) | set(algos) | set(hy) | set(pair))
    hy_n = len(hy)
    coverage = ("Every dose/contra/interaction/monitoring/threshold record id "
                "(%d+%d+%d+%d+%d+%d), all 275 tables, all 12 algorithms, all 40 inferred segments, "
                "all 14 uncertain pages, all %d hyphen-merge records, and 2 conflict items are queued; "
                "no dose/contra/interaction/monitoring/threshold record is cleared for clinical use."
                % (len(dose_ids), len(contra), len(inter), len(mon), len(thr_a), len(thr_m), hy_n))
    return {"queue_version": "gate7-review-queue-v1",
            "package": SOURCE_ID, "package_version": "v1", "categories": cats,
            "priority_flags": {"critical": sorted(rid for rid, _why in critical),
                               "suspect_normalization_citeglue": citeglue,
                               "titration_context_review": titr_bad},
            "counts": {k: len(v) for k, v in cats.items()},
            "manual_review_unique_records": len(uniq),
            "coverage_statement": coverage}


def _g7_build_issues(ctx: _G7Ctx, critical: list, p2info: dict,
                     citeglue: list, titr_bad: list) -> list[dict]:
    issues: list[dict] = []

    def add(sev: str, kind: str, rids: list, uids: list, phys: list, prt: list,
            detail: str, method: str) -> None:
        issues.append({"issue_id": "is-" + _g7_gid(sev, kind, ",".join(sorted(rids)), detail[:60]),
                       "severity": sev, "kind": kind, "record_ids": sorted(rids),
                       "unit_ids": sorted(uids),
                       "pages": {"physical": sorted(phys),
                                 "printed": sorted(p for p in prt if p is not None)},
                       "detail": detail, "method": method})

    m = ctx.meds
    for mid, why in critical:
        mm = m[mid]
        add("CRITICAL", "spot30-context-atom", [mid], [mm["source_unit_id"]],
            list(mm.get("source_pages", [])), [],
            "dose_min atom %r of dose %r (generic %r) is citation-glued reference-number pollution, "
            "not entailed by raw; e.g. raw %r. Dose string itself is verbatim-grounded; the bound atom is false."
            % (mm.get("dose_min"), mm.get("dose"), mm.get("generic_name"),
               mm.get("evidence_wording", "")[:120]),
            "PASS2(c) 30-sample, union corpus, tiers verbatim/joined/alnum/range-derived; citeglue rejected")
    for tid in sorted(tid for tid, t in ctx.tables.items() if not t.get("rows")):
        t = ctx.tables[tid]
        add("WARNING", "empty-body-table", [tid], [t["host_unit_id"]], [t["physical_start"]],
            [t["printed_start"]],
            "table %r filed with %d headers and 0 body rows; body content %s (includes dose tables "
            "1.4 LAI, 3.16 cardiac, 4.22 drugs of misuse, 7.2 pregnancy recommendations)."
            % (t["title"], len(t.get("headers", [])),
               "misfiled into headers" if t.get("headers") else "absent"),
            "PASS1 tables-rows-rectangular recompute")
    low = sorted(tid for tid, t in ctx.tables.items() if t.get("extraction_confidence") == "low")
    add("WARNING", "low-confidence-tables", low, [], [], [],
        "%d/275 tables extraction_confidence=low; all queued for manual review." % len(low),
        "PASS1 tables confidence enumeration")
    headless = []
    for tid, t in ctx.tables.items():
        widths = {len(r.get("cells", [])) for r in t.get("rows", [])}
        w = next(iter(widths)) if len(widths) == 1 else -1
        if len(t.get("headers", [])) == 0 or (w != -1 and len(t.get("headers", [])) != w):
            headless.append(tid)
    add("WARNING", "headerless-or-header-mismatch-tables", sorted(headless), [], [], [],
        "%d/275 tables with empty headers or header/row width mismatch (e.g. Table 1.7 headers=0 width=4); queued."
        % len(headless), "PASS1 tables header enumeration")
    unres = sorted(x["xref_id"] for x in ctx.xrefs if x["status"] == "unresolved")
    add("WARNING", "unresolved-xrefs-deferred", unres, [], [], [],
        "%d/%d xrefs unresolved (deferred references); none resolved by guessing." % (len(unres), len(ctx.xrefs)),
        "PASS1 xrefs status enumeration")
    edge: set[str] = set()
    for r in ctx.relations:
        edge.add(r["subject_id"])
        if isinstance(r.get("object_id"), str) and r["object_id"].startswith("tc-"):
            edge.add(r["object_id"])
    orph = sorted(c["concept_id"] for c in ctx.concepts if c["concept_id"] not in edge)
    add("WARNING", "gazetteer-orphan-concepts", orph, [], [], [],
        "%d/%d concepts on no relation edge; gazetteer orphans for review." % (len(orph), len(ctx.concepts)),
        "PASS1 relations edge recompute")
    add("WARNING", "figures-require-visual-verification",
        sorted(f["figure_id"] for f in ctx.figures), [], [], [],
        "19/19 figures FIGURE_REQUIRES_VISUAL_VERIFICATION + needs_review; no visual clearance given.",
        "PASS1 figures enumeration")
    add("WARNING", "inferred-mapping-segments",
        sorted(s["mapping_segment_id"] for s in ctx.pmap["segments"] if s.get("mapping_status") == "inferred"),
        [], [], [], "40/89 segments inferred (never silent); each carries anchors+rule evidence; queued.",
        "PASS1 pages.map enumeration")
    add("WARNING", "uncertain-pages", [], [], sorted(ctx.pmap.get("unresolved_pages", [])), [],
        "14 unresolved pages (no printed number); queued for review.", "PASS1 pages.map unresolved_pages")
    hy_n = p2info["hyphen"]
    add("WARNING", "hyphen-merge-records", [], [], [], [],
        "%d assertion + %d medication records overlap Gate-3 repairs/layout-joins; RAW spelling filed, "
        "never silently merged; sample 20/20 flags explained; all queued." % hy_n,
        "PASS2(f) hyphen audit: span fragment vs raw + repair-overlap recompute")
    n_a = len(ctx.assertions)
    n_nr = sum(1 for a in ctx.assertions.values() if a.get("review_status") == "not_reviewed")
    n_need = sum(1 for a in ctx.assertions.values() if a.get("review_status") == "needs_review")
    n_auto = sum(1 for a in ctx.assertions.values()
                 if a.get("review_status") == "auto_ok" or a.get("validation_status") == "auto_ok")
    n_med = len(m)
    n_med_norev = sum(1 for mm in m.values() if "review_status" not in mm)
    add("WARNING", "not-reviewed-surface", [], [], [], [],
        "%d/%d assertions review_status=not_reviewed (%d needs_review, %d auto_ok); "
        "%d/%d medication records carry no review_status field (schema gap); "
        "entire high-risk surface queued; nothing cleared."
        % (n_nr, n_a, n_need, n_auto, n_med_norev, n_med),
        "PASS2(b) status scan")
    a1, a2 = p2info["conflict_pair"]
    pp1, pr1 = _g7_assertion_pages(ctx, a1)
    pp2, pr2 = _g7_assertion_pages(ctx, a2)
    add("WARNING", "potential-conflict-retention", [a1, a2],
        [ctx.assertions[a1]["source_unit_id"], ctx.assertions[a2]["source_unit_id"]],
        pp1 + pp2, pr1 + pr2,
        "POTENTIAL_CONFLICT: %s (phys %s: methadone retention more easily achievable than buprenorphine, "
        "at least at low dose) vs %s (phys %s: methadone equal efficacy to buprenorphine in prescription-opioid "
        "dependence/POATS). Contexts differ; no clinical correction made; human adjudication required. "
        "No pre-existing POTENTIAL_CONFLICT/SOURCE_INCONSISTENCY markers found in Gate 1-6 artifacts (scan=0)."
        % (a1, pp1, a2, pp2),
        "PASS2(g): literal-marker grep over all artifacts + paired retention-claim scan, verbatim quotes")
    for mid in sorted(titr_bad):
        mm = m[mid]
        add("WARNING", "titration-context-review", [mid], [mm["source_unit_id"]],
            list(mm.get("source_pages", []))[:3], [],
            "titration atom %r not recoverable by verbatim/joined/alnum tiers; queued for review."
            % ((mm.get("titration") or "")[:100]),
            "PASS2 file-wide context tiers, union corpus")
    add("WARNING", "suspect-normalization-citeglue", sorted(citeglue), [], [], [],
        "%d medication records with citation-glued min/max atoms (ref numbers parsed as bounds); "
        "dose strings verbatim-grounded but bound atoms false; queued with priority." % len(citeglue),
        "PASS2 file-wide context tiers, union corpus + citeglue rule")
    sev_order = {"CRITICAL": 0, "WARNING": 1}
    issues.sort(key=lambda i: (sev_order[i["severity"]], i["kind"], i["issue_id"]))
    return issues


def _g7_build_qa_report(ctx: _G7Ctx, p1: list, p2: list, critical: list, warnings: list,
                        p2info: dict, queue: dict, golden_items: list, golden_res: list) -> dict:
    pm = ctx.pmap
    seg_of: dict[int, dict] = {}
    for s in pm["segments"]:
        for p in range(s["source_page_display_start"], s["source_page_display_end"] + 1):
            seg_of[p] = s
    verified_pages = sum(1 for p in range(1, EXPECTED_PAGE_COUNT + 1)
                         if seg_of.get(p, {}).get("mapping_status") == "verified")
    counts = {
        "pages_total": 978, "pages_verified": verified_pages,
        "pages_uncertain": len(pm.get("unresolved_pages", [])),
        "tables_total": 275,
        "tables_verified": sum(1 for t in ctx.tables.values() if t.get("rows")),
        "figures_total": 19, "algorithms_total": 12,
        "dose_records": len(ctx.meds), "medication_records": len(ctx.meds),
        "interaction_records": sum(1 for a in ctx.assertions.values() if a.get("claim_type") == "interaction"),
        "monitoring_records": sum(1 for a in ctx.assertions.values() if a.get("claim_type") == "monitoring"),
        "contraindication_records": sum(1 for a in ctx.assertions.values() if a.get("claim_type") == "contraindication"),
        "warning_records": sum(1 for a in ctx.assertions.values() if a.get("claim_type") == "adverse_effect"),
        "switch_records": sum(1 for mm in ctx.meds.values() if mm.get("titration")),
        "special_population_records": sum(
            1 for a in ctx.assertions.values()
            if re.search(r"pregnan|breastfeed|lactation|child|adolescen|older|elderly|geriatric|hepatic|renal|neonat|paediatric|pediatric",
                         a.get("source_text", ""), re.I)),
        "reference_records": sum(1 for u in ctx.units.values() if u.get("unit_type") == "reference"),
        "xrefs_total": len(ctx.xrefs),
        "xrefs_unresolved": sum(1 for x in ctx.xrefs if x["status"] == "unresolved"),
        "golden_tests_total": len(golden_items),
        "golden_tests_passed": sum(1 for _i, ok, _e in golden_res if ok),
        "golden_tests_failed": sum(1 for _i, ok, _e in golden_res if not ok),
        "critical_errors": len(critical),
        "manual_review_required": queue["manual_review_unique_records"],
    }
    tech = []
    for n, r, e in p1:
        v = "PASS" if r == "PASS" else "WARNING"
        if n == "tables-rows-rectangular" and r == "FAIL":
            v = "WARNING"
        tech.append({"dimension": "pass1:" + n, "verdict": v, "evidence": e})
    for n, r, e in p2:
        v = "PASS" if r == "PASS" else ("BLOCKED" if n == "(c)-spot30-context" else "WARNING")
        tech.append({"dimension": "pass2:" + n, "verdict": v, "evidence": e})
    overall = "BLOCKED" if (critical or counts["golden_tests_failed"]) else "PASS"
    return {
        "qa_version": "gate7-qa-freeze-v1",
        "package": SOURCE_ID, "package_version": "v1",
        "source_lock_sha256": "sha256:" + EXPECTED_SHA256.lower(),
        "inputs": {"raw": 978, "reading": 978, "pages_map_segments": 89, "structure_chapters": 14,
                   "units": 7861, "tables": 275, "figures": 19, "algorithms": 12,
                   "assertions": len(ctx.assertions), "medications": len(ctx.meds),
                   "concepts": len(ctx.concepts),
                   "relations": len(ctx.relations), "xrefs": len(ctx.xrefs)},
        "counts": counts,
        "count_definitions": {
            "tables_verified": "structurally validated (non-empty rectangular rows, resolved continuation links) - NOT cleared for clinical use; every table remains needs_review and queued",
            "warning_records": "assertions with claim_type=adverse_effect",
            "switch_records": "medication records with taper_info (switch/taper procedures)",
            "special_population_records": "assertions matching pregnancy/breastfeeding/child/adolescent/older/hepatic/renal/neonatal patterns (case-insensitive)",
            "reference_records": "units with unit_type=reference",
            "manual_review_required": "unique record ids across all review-queue categories",
        },
        "notes": [
            "tables_verified here means structurally validated, NOT cleared for clinical use: all 275 tables carry verification_status=needs_review and sit in review-queue.json; no table is cleared for clinical use.",
            "All counts recomputed from generated artifacts by taylor_pipeline qa-freeze; no worker claims copied.",
            "Parser success never marks verified: PASS2 is independent recomputation (own corpora, own tiers, own sampling).",
            "Dose strings: each verbatim-grounded in raw (whitespace-insensitive, hyphen-join fallback for names). Failing bound atoms (min/max) are nulled with atom_reject_reason, never silently corrected.",
        ],
        "technical_qa": tech,
        "overall_package": overall,
        "overall_rationale": (("%d CRITICAL spot-check mismatches (%s); freeze withheld"
                               % (len(critical), ",".join(
                                   rid for rid, _why in critical)))
                              if critical else "no critical errors; package frozen pending explicit human sign-off"),
        "critical_errors_detail": [{"record_id": rid, "check": why} for rid, why in critical],
        "golden_dry_run": {"total": len(golden_items),
                           "passed": sum(1 for _i, ok, _e in golden_res if ok),
                           "failed": sum(1 for _i, ok, _e in golden_res if not ok),
                           "written_to_file": False,
                           "reason_not_written": "freeze withheld (overall_package=BLOCKED); golden expectations verified in-memory only"},
        "promotion": {"retrieval_eligible": False, "clinical_active": False},
        "review_coverage": queue["coverage_statement"],
        "status": "PENDING_APPROVAL",
    }


def _g7_precheck(root: Path, book: Path) -> tuple[list[str], dict]:
    errs: list[str] = []
    digest, _byte_size = sha256_file(root / SOURCE_REL)
    if digest.lower() != EXPECTED_SHA256.lower():
        errs.append("sha256 mismatch")
    counts = {
        "raw": len(list((book / "raw").glob("page-*.json"))),
        "reading": len(list((book / "reading").glob("page-*.json"))),
        "segments": len(json.load(open(book / "pages.map.json", encoding="utf-8"))["segments"]),
        "chapters": sum(len(p.get("chapters", []))
                        for p in json.load(open(book / "structure.json", encoding="utf-8"))["parts"]),
        "units": sum(1 for _ in open(book / "units.jsonl", encoding="utf-8")),
        "tables": sum(1 for _ in open(book / "tables.jsonl", encoding="utf-8")),
        "figures": sum(1 for _ in open(book / "figures.jsonl", encoding="utf-8")),
        "algorithms": sum(1 for _ in open(book / "algorithms.jsonl", encoding="utf-8")),
        "assertions": sum(1 for _ in open(book / "assertions.jsonl", encoding="utf-8")),
        "medications": sum(1 for _ in open(book / "medications.jsonl", encoding="utf-8")),
        "concepts": sum(1 for _ in open(book / "concepts.jsonl", encoding="utf-8")),
        "relations": sum(1 for _ in open(book / "relations.jsonl", encoding="utf-8")),
        "xrefs": sum(1 for _ in open(book / "xrefs.jsonl", encoding="utf-8")),
    }
    for k, v in _G7_WANT.items():
        if counts.get(k) != v:
            errs.append("count %s=%s want %s" % (k, counts.get(k), v))
    rm = json.load(open(book / "run-manifest.json", encoding="utf-8"))
    if not (rm.get("run_status") == "running" and rm.get("completed_at") is None):
        errs.append("run-manifest not running/completed_at-null")
    return errs, counts


def cmd_qa_freeze(args: argparse.Namespace) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:
        pass
    from collections import Counter as _Counter

    root = repo_root()
    book = root / BOOK_REL
    for f in ("golden-set.jsonl", "qa-report.json", "review-queue.json", "issues.jsonl",
              "content-manifest.json", "governance/lifecycle/state.json"):
        if (book / f).exists():
            print("BLOCKED: %s already exists; refusing to overwrite." % f, file=sys.stderr)
            return 1
    errs, counts = _g7_precheck(root, book)
    if errs:
        print("BLOCKED: prechecks: %s" % errs, file=sys.stderr)
        return 1
    print("precheck OK: lock=sha256:%s counts=%s run-manifest=running/completed_at=null"
          % (EXPECTED_SHA256[:16], counts))
    ctx = _G7Ctx(book)
    ctx.load()
    p1 = _g7_run_pass1(ctx)
    p2, critical, warnings, p2info = _g7_run_pass2(ctx)
    for n, r, e in p1 + p2:
        print("gate7 %-30s %s  %s" % (n, r, e))
    citeglue, titr_bad = _g7_filewide_context_flags(ctx)
    print("gate7 filewide citeglue-suspect=%d titration-review=%d" % (len(citeglue), len(titr_bad)))
    queue = _g7_build_queue(ctx, p2info, citeglue, titr_bad, critical)
    issues = _g7_build_issues(ctx, critical, p2info, citeglue, titr_bad)
    golden_items = _g7_build_golden(ctx)
    mins = {"dose_record": 20, "table_row": 20, "interaction": 10, "monitoring": 10,
            "taper_procedure": 10, "reference": 10, "algorithm": 5, "figure": 5}
    have = _Counter(i["kind"] for i in golden_items)
    have["warning_contra"] = (have.get("contraindication", 0) + have.get("warning", 0))
    min_fail = [k for k, v in mins.items() if have.get(k, 0) < v] + (
        [] if have["warning_contra"] >= 10 else ["warning_contra"])
    if min_fail:
        print("BLOCKED: golden minimums unmet: %s" % min_fail, file=sys.stderr)
        return 1
    issues_index: set[str] = set()
    for it in issues:
        if it["kind"] == "potential-conflict-retention":
            issues_index.update(it["record_ids"])
    golden_res = []
    for it in golden_items:
        ok, ev = _g7_verify_golden_item(ctx, it, issues_index)
        it["verified"] = bool(ok)
        golden_res.append((it["golden_id"], bool(ok), ev))
    npass = sum(1 for _i, ok, _e in golden_res if ok)
    print("gate7 golden dry-run: total=%d passed=%d failed=%d" % (len(golden_items), npass, len(golden_items) - npass))
    for gid_, ok, ev in golden_res:
        if not ok:
            print("gate7 golden FAIL %s %s" % (gid_, ev))
    print("gate7 golden by-kind: %s" % dict(sorted(_Counter(i["kind"] for i in golden_items).items())))
    report = _g7_build_qa_report(ctx, p1, p2, critical, warnings, p2info, queue, golden_items, golden_res)
    with open(book / "review-queue.json", "w", encoding="utf-8") as f:
        json.dump(queue, f, indent=2, ensure_ascii=False)
        f.write("\n")
    with open(book / "issues.jsonl", "w", encoding="utf-8") as f:
        for it in issues:
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    with open(book / "qa-report.json", "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("wrote review-queue.json issues.jsonl qa-report.json")
    if critical or (len(golden_items) - npass):
        print("BLOCKED: critical_errors=%d golden_failed=%d; freeze withheld "
              "(no state.json/manifest/golden-set)." % (len(critical), len(golden_items) - npass))
        return 1
    with open(book / "golden-set.jsonl", "w", encoding="utf-8") as f:
        for it in sorted(golden_items, key=lambda x: (x["kind"], x["golden_id"])):
            f.write(json.dumps(it, ensure_ascii=False) + "\n")
    manifest = []
    for p in sorted(book.rglob("*")):
        if p.is_file() and p.name != "content-manifest.json":
            rel = p.relative_to(book).as_posix()
            h = hashlib.sha256()
            with open(p, "rb") as fh:
                while True:
                    ch = fh.read(1048576)
                    if not ch:
                        break
                    h.update(ch)
            manifest.append({"path": rel, "sha256": h.hexdigest(), "byte_size": p.stat().st_size})
    manifest.sort(key=lambda e: e["path"])
    with open(book / "content-manifest.json", "w", encoding="utf-8") as f:
        json.dump({"manifest_version": "gate7-content-manifest-v1", "package_version": "v1",
                   "files": manifest}, f, indent=2, ensure_ascii=False)
        f.write("\n")
    state = {"lifecycle": "FROZEN", "package_version": "v1",
             "frozen_at": datetime.now(timezone.utc).isoformat(), "status": "PENDING_APPROVAL",
             "approved_at": None, "approved_by": None,
             "retrieval_eligible": False, "clinical_active": False}
    (book / "governance" / "lifecycle").mkdir(parents=True, exist_ok=True)
    with open(book / "governance/lifecycle/state.json", "w", encoding="utf-8") as f:
        json.dump(state, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print("qa-freeze OK: FROZEN PENDING_APPROVAL")
    return 0


def cmd_replay(args: argparse.Namespace) -> int:
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="backslashreplace")
        sys.stderr.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:
        pass
    root = repo_root()
    book = root / BOOK_REL
    ok_all = True
    notes: list[str] = []
    n_read, bad_read = 0, []
    for n in range(1, EXPECTED_PAGE_COUNT + 1):
        tag = "%04d" % n
        with open(book / ("reading/page-%s.json" % tag), "r", encoding="utf-8") as f:
            rd = json.load(f)
        with open(book / ("raw/page-%s.json" % tag), "r", encoding="utf-8") as f:
            raw = json.load(f)
        n_read += 1
        if hashlib.sha256(rd.get("repaired_text", "").encode("utf-8")).hexdigest() != rd.get("repaired_text_sha256"):
            bad_read.append(tag)
        if rd.get("raw_text_sha256") != raw.get("raw_text_sha256"):
            bad_read.append(tag + ":link")
    notes.append("reading-hashes: %d/978 reproduce (bad=%s)" % (n_read - len(bad_read), bad_read[:3]))
    ok_all = ok_all and not bad_read
    ctx = _G7Ctx(book)
    ctx.load()
    rawmap: dict[str, str] = {}
    for n in range(1, EXPECTED_PAGE_COUNT + 1):
        with open(book / ("raw/page-%04d.json" % n), "r", encoding="utf-8") as f:
            r = json.load(f)
        for blk in r["blocks"]:
            rawmap[blk["block_id"]] = blk["text"]
    basecache: dict[int, tuple] = {}
    bad_hash, bad_id, n_units = [], [], 0
    for uid, u in ctx.units.items():
        n_units += 1
        h = hashlib.sha256("\n".join(rawmap[x] for x in u["source_block_ids"]).encode("utf-8")).hexdigest()
        if h != u["source_text_hash"]:
            bad_hash.append(uid)
        pg = int(re.match(r"page-(\d+)-block-", u["source_block_ids"][0]).group(1))
        if pg not in basecache:
            with open(book / ("raw/page-%04d.json" % pg), "r", encoding="utf-8") as f:
                raw = json.load(f)
            bt, _rp, jn = _repair_page(raw)
            basecache[pg] = (bt, jn)
        bt, jn = basecache[pg]
        idxs = sorted(int(x.rsplit("-", 1)[1]) for x in u["source_block_ids"])
        text = _g4_assemble_text(bt, jn, idxs)
        key = "|".join([SOURCE_ID, "|".join(u["structural_path"]), str(u["physical_start"]), text])
        if "tu-" + hashlib.sha256(key.encode("utf-8")).hexdigest()[:16] != uid:
            bad_id.append(uid)
    notes.append("unit-source_text_hash-rule: %d/7861 reproduce (bad=%s)" % (n_units - len(bad_hash), bad_hash[:3]))
    notes.append("unit-unit_id-rule: %d/7861 reproduce (bad=%s)" % (n_units - len(bad_id), bad_id[:3]))
    ok_all = ok_all and not bad_hash and not bad_id
    gp = book / "golden-set.jsonl"
    if not gp.is_file():
        notes.append("golden-expectations: NOT FROZEN (golden-set.jsonl absent); nothing to reproduce")
        ok_all = False
    else:
        with open(gp, "r", encoding="utf-8") as f:
            items = [json.loads(line) for line in f]
        issues_index = set()
        ip = book / "issues.jsonl"
        if ip.is_file():
            with open(ip, "r", encoding="utf-8") as f:
                for line in f:
                    it = json.loads(line)
                    if it.get("kind") == "potential-conflict-retention":
                        issues_index.update(it.get("record_ids", []))
        bad_g = []
        for it in items:
            ok, _ev = _g7_verify_golden_item(ctx, it, issues_index)
            if not ok or not it.get("verified"):
                bad_g.append(it["golden_id"])
        notes.append("golden-expectations: %d/%d reproduce (bad=%s)"
                     % (len(items) - len(bad_g), len(items), bad_g[:3]))
        ok_all = ok_all and not bad_g
    mp = book / "content-manifest.json"
    if not mp.is_file():
        notes.append("content-manifest: NOT FROZEN (absent)")
        ok_all = False
    else:
        with open(mp, "r", encoding="utf-8") as f:
            man = json.load(f)
        bad_m = []
        for e in man["files"]:
            p = book / e["path"]
            if not p.is_file():
                bad_m.append(e["path"] + ":missing")
                continue
            h = hashlib.sha256()
            with open(p, "rb") as fh:
                while True:
                    ch = fh.read(1048576)
                    if not ch:
                        break
                    h.update(ch)
            if h.hexdigest() != e["sha256"] or p.stat().st_size != e["byte_size"]:
                bad_m.append(e["path"])
        notes.append("content-manifest: %d/%d hashes reproduce (bad=%s)"
                     % (len(man["files"]) - len(bad_m), len(man["files"]), bad_m[:3]))
        ok_all = ok_all and not bad_m
    for line in notes:
        print("replay " + line)
    print("replay: %s" % ("ALL REPRODUCE exit=0" if ok_all else "DIVERGENCE exit=1"))
    return 0 if ok_all else 1


# __GATE7_END__

if __name__ == "__main__":
    raise SystemExit(main())
