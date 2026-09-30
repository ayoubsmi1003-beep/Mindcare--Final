"""Independent per-page PyMuPDF extraction for the frozen Tome 2 PDF.

Each zero-based page index is extracted independently: raw text plus text
blocks with coordinates become one raw page record. A successful empty page
is ``blank`` (never an error); a parser exception becomes ``needs_review``
with the exception class and page index. Resume reuses only a stored page
whose checkpoint source hash, page index, and raw hash all match.

No network, no OCR, no database, no ``.env`` access.
"""

import hashlib
from pathlib import Path

import pymupdf

from .serialization import read_jsonl, write_jsonl
from .source_lock import sha256_file

TERMINAL_STATUSES = ("auto_ok", "blank", "needs_review")


def _parser_version() -> str:
    return "pymupdf-" + pymupdf.__version__


def extract_page(document: pymupdf.Document, page_index: int) -> dict:
    """Extract one page independently and return its terminal raw record."""
    index = int(page_index)
    try:
        page = document[index]
        raw_text = page.get_text("text") or ""
        block_tuples = page.get_text("blocks") or []
        blocks = []
        for position, item in enumerate(block_tuples):
            x0, y0, x1, y1, text, block_no, block_type = item
            text = str(text)
            blocks.append(
                {
                    "block_index": position,
                    "block_no": int(block_no),
                    "block_type": int(block_type),
                    "bbox": [float(x0), float(y0), float(x1), float(y1)],
                    "text": text,
                    "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
                }
            )
        if raw_text.strip() == "":
            status = "blank"
        else:
            status = "auto_ok"
        return {
            "source_page_index": index,
            "source_page_display": index + 1,
            "raw_text": raw_text,
            "raw_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
            "block_count": len(blocks),
            "blocks": blocks,
            "extraction_status": status,
            "parser": _parser_version(),
            "page_width": float(page.rect.width),
            "page_height": float(page.rect.height),
        }
    except Exception as error:
        raw_text = ""
        return {
            "source_page_index": index,
            "source_page_display": index + 1,
            "raw_text": raw_text,
            "raw_sha256": hashlib.sha256(raw_text.encode("utf-8")).hexdigest(),
            "block_count": 0,
            "blocks": [],
            "extraction_status": "needs_review",
            "parser": _parser_version(),
            "error_class": type(error).__name__,
            "error_message": str(error),
        }


def _load_index(path: Path, key: str) -> dict:
    index = {}
    if path.exists():
        for record in read_jsonl(path):
            if isinstance(record, dict) and key in record:
                index[record[key]] = record
    return index


def extract_pages(pdf_path: Path, output_dir: Path, resume: bool = True) -> dict:
    """Extract every page and write raw records plus per-page checkpoints.

    Writes ``raw/pages.jsonl``, ``raw/blocks.jsonl``, and
    ``checkpoints/extract-pages.jsonl`` below ``output_dir``. Returns the
    summary with command, source hash, page counts, raw file hashes, and
    failed page indices.
    """
    pdf_path = Path(pdf_path)
    output_dir = Path(output_dir)
    source_version = "sha256:" + sha256_file(pdf_path)
    raw_dir = output_dir / "raw"
    checkpoints_dir = output_dir / "checkpoints"
    raw_dir.mkdir(parents=True, exist_ok=True)
    checkpoints_dir.mkdir(parents=True, exist_ok=True)
    pages_path = raw_dir / "pages.jsonl"
    blocks_path = raw_dir / "blocks.jsonl"
    checkpoint_path = checkpoints_dir / "extract-pages.jsonl"

    stored_pages = {}
    stored_checkpoints = {}
    if resume:
        stored_pages = _load_index(pages_path, "source_page_index")
        stored_checkpoints = _load_index(checkpoint_path, "source_page_index")

    document = pymupdf.open(pdf_path)
    try:
        page_count = document.page_count
        page_records = []
        for index in range(page_count):
            checkpoint = stored_checkpoints.get(index)
            stored = stored_pages.get(index)
            if (
                checkpoint is not None
                and stored is not None
                and checkpoint.get("source_version") == source_version
                and checkpoint.get("source_page_index") == index
                and checkpoint.get("raw_sha256") == stored.get("raw_sha256")
            ):
                page_records.append(stored)
                continue
            page_records.append(extract_page(document, index))
    finally:
        document.close()

    block_records = []
    for page_record in page_records:
        for block in page_record["blocks"]:
            block_records.append(
                {
                    "source_page_index": page_record["source_page_index"],
                    "source_page_display": page_record["source_page_display"],
                    "block_index": block["block_index"],
                    "block_no": block["block_no"],
                    "block_type": block["block_type"],
                    "bbox": block["bbox"],
                    "text": block["text"],
                    "text_sha256": block["text_sha256"],
                }
            )

    checkpoints = []
    for page_record in page_records:
        checkpoints.append(
            {
                "command": "extract",
                "source_version": source_version,
                "source_page_index": page_record["source_page_index"],
                "source_page_display": page_record["source_page_display"],
                "raw_sha256": page_record["raw_sha256"],
                "block_count": page_record["block_count"],
                "extraction_status": page_record["extraction_status"],
                "parser": page_record["parser"],
            }
        )

    pages_sha256 = write_jsonl(pages_path, page_records)
    blocks_sha256 = write_jsonl(blocks_path, block_records)
    write_jsonl(checkpoint_path, checkpoints)

    failed = [
        record["source_page_index"]
        for record in page_records
        if record["extraction_status"] == "needs_review"
    ]
    terminal = sum(
        1
        for record in page_records
        if record["extraction_status"] in TERMINAL_STATUSES
    )
    return {
        "command": (
            "extract --pdf "
            + str(pdf_path)
            + " --output "
            + str(output_dir)
            + (" --resume" if resume else " --no-resume")
        ),
        "source_version": source_version,
        "page_count": page_count,
        "terminal_pages": terminal,
        "missing_pages": page_count - terminal,
        "failed_page_indices": failed,
        "pages_path": "raw/pages.jsonl",
        "pages_sha256": pages_sha256,
        "blocks_path": "raw/blocks.jsonl",
        "blocks_sha256": blocks_sha256,
        "checkpoint_path": "checkpoints/extract-pages.jsonl",
    }
