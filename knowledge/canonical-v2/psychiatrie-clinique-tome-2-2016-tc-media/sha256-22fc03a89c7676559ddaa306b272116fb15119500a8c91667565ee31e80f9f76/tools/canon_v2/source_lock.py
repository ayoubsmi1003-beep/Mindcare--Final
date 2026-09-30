"""Book-local source locking for the frozen Tome 2 PDF.

Streaming SHA-256 verification against the frozen ``SOURCE_VERSION`` before
any extraction record is created. No network, no OCR, no database, no
``.env`` access: only ``hashlib``, ``pathlib``, PyMuPDF, and the book-local
constants/serializer.
"""

import hashlib
from pathlib import Path

import pymupdf

from .constants import BOOK_ID, INGESTION_VERSION, SOURCE_VERSION
from .serialization import write_json_atomic

CHUNK_SIZE = 1024 * 1024


def sha256_file(path: Path) -> str:
    """Return the lowercase hex SHA-256 of a file read in streaming chunks."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def register_source(
    pdf_path: Path, output_dir: Path, expected_hash: str = SOURCE_VERSION
) -> dict:
    """Verify the PDF hash, lock the source, and write ``source-lock.json``.

    Raises ``ValueError`` on a hash mismatch before creating any directory
    or extraction record. Returns the lock record including the lock file
    name and its SHA-256.
    """
    pdf_path = Path(pdf_path)
    output_dir = Path(output_dir)
    if expected_hash != SOURCE_VERSION:
        raise ValueError(
            "source hash mismatch: expected "
            + SOURCE_VERSION
            + ", got "
            + expected_hash
        )
    actual_hash = "sha256:" + sha256_file(pdf_path)
    if actual_hash != SOURCE_VERSION:
        raise ValueError(
            "source hash mismatch: expected "
            + SOURCE_VERSION
            + ", got "
            + actual_hash
        )
    document = pymupdf.open(pdf_path)
    try:
        page_count = document.page_count
        metadata = dict(document.metadata or {})
    finally:
        document.close()
    lock = {
        "book_id": BOOK_ID,
        "source_version": actual_hash,
        "expected_source_version": expected_hash,
        "source_path": str(pdf_path),
        "page_count": page_count,
        "metadata": metadata,
        "parser": "pymupdf-" + pymupdf.__version__,
        "ingestion_version": INGESTION_VERSION,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    lock_sha256 = write_json_atomic(output_dir / "source-lock.json", lock)
    record = dict(lock)
    record["lock_path"] = "source-lock.json"
    record["lock_sha256"] = lock_sha256
    return record
