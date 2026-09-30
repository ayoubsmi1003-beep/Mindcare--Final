import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pymupdf

from tools.canon_v2.source_lock import register_source


class SourceLockTests(unittest.TestCase):
    def test_register_rejects_wrong_hash(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            pdf = root / "book.pdf"
            document = pymupdf.open()
            document.new_page()
            document.save(pdf)
            document.close()
            with self.assertRaises(ValueError):
                register_source(pdf, root / "out", expected_hash="sha256:" + "0" * 64)


if __name__ == "__main__":
    unittest.main()
