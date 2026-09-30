import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.canon_v2.qa import freeze, run_qa


class QaTests(unittest.TestCase):
    def test_missing_checkpoint_is_blocked(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "checkpoints").mkdir()
            report = run_qa(root)
            self.assertEqual(report["verdict"], "BLOCKED")
            self.assertTrue(any(check["id"] == "page-checkpoint-coverage" and check["status"] == "FAIL" for check in report["checks"]))

    def test_explicit_warning_does_not_become_pass(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "checkpoints").mkdir()
            (root / "qa-report.json").write_text("{}", encoding="utf-8")
            report = run_qa(root)
            self.assertIn(report["verdict"], {"WARNING", "BLOCKED"})


class FreezeTests(unittest.TestCase):
    def test_freeze_rejects_missing_page_checkpoint(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                freeze(root, {"verdict": "PASS", "checks": []})

    def test_freeze_rejects_missing_explicit_verdict(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                freeze(root, {"checks": []})


if __name__ == "__main__":
    unittest.main()
