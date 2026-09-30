import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf

from tools.canon_v2.page_extraction import extract_page, extract_pages


class PageExtractionTests(unittest.TestCase):
    def test_extract_records_blank_page(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "book.pdf"
            document = pymupdf.open()
            document.new_page()
            document.new_page()
            document.save(pdf)
            document.close()
            summary = extract_pages(pdf, root / "out", resume=False)
            self.assertEqual(summary["page_count"], 2)
            self.assertEqual(summary["terminal_pages"], 2)
            self.assertEqual(summary["missing_pages"], 0)

    def test_extract_page_returns_terminal_blank_record(self):
        with tempfile.TemporaryDirectory() as directory:
            pdf = Path(directory) / "book.pdf"
            document = pymupdf.open()
            document.new_page()
            document.save(pdf)
            document.close()
            source = pymupdf.open(pdf)
            try:
                record = extract_page(source, 0)
            finally:
                source.close()
            self.assertEqual(record["source_page_index"], 0)
            self.assertEqual(record["source_page_display"], 1)
            self.assertEqual(record["raw_text"], "")
            self.assertEqual(record["block_count"], 0)
            self.assertEqual(record["blocks"], [])
            self.assertEqual(record["extraction_status"], "blank")
            self.assertEqual(record["parser"], "pymupdf-" + pymupdf.__version__)


if __name__ == "__main__":
    unittest.main()
