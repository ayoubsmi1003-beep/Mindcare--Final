import unittest

from tools.canon_v2.page_mapping import map_pages


class MappingAndStructureTests(unittest.TestCase):
    def test_body_mapping_uses_observed_anchor_and_keeps_status(self):
        pages = [
            {"source_page_index": 18, "text": "Chapitre 49"},
            {"source_page_index": 19, "text": "1084 Psychiatrie clinique"},
        ]
        toc = [{"chapter": 49, "printed_page": "1083", "source_page_index": 18}]
        rows = map_pages(pages, toc)
        self.assertEqual(rows[1]["printed_page_number"], "1084")
        self.assertEqual(rows[1]["mapping_status"], "certain")
        self.assertEqual(rows[0]["mapping_status"], "inferred")

    def test_piecewise_mapping_keeps_all_pages_and_never_invents_nonbody_labels(self):
        footer_1084 = {
            "bbox": [0, 747, 100, 759],
            "text": "1084\n",
        }
        footer_1086 = {
            "bbox": [0, 747, 100, 759],
            "text": "1086\n",
        }
        pages = [
            {"source_page_index": 18, "text": "Chapitre 49", "blocks": []},
            {
                "source_page_index": 19,
                "reading_text": "1084\nPsychiatrie clinique",
                "blocks": [footer_1084],
            },
            {"source_page_index": 20, "reading_text": "body", "blocks": []},
            {
                "source_page_index": 21,
                "reading_text": "1086\nPsychiatrie clinique",
                "blocks": [footer_1086],
            },
            {"source_page_index": 824, "reading_text": "", "extraction_status": "blank", "blocks": []},
            {"source_page_index": 825, "reading_text": "back cover", "blocks": []},
        ]
        rows = map_pages(
            pages,
            [{"chapter": 49, "printed_page": "1083", "source_page_index": 18}],
        )
        self.assertEqual(len(rows), len(pages))
        self.assertEqual(rows[2]["printed_page_number"], "1085")
        self.assertEqual(rows[2]["mapping_status"], "inferred")
        self.assertIsNone(rows[4]["printed_page_number"])
        self.assertEqual(rows[4]["mapping_status"], "not_applicable")
        self.assertIn("blank_page", rows[4]["evidence_classes"])
        self.assertIsNone(rows[5]["printed_page_number"])
        self.assertEqual(rows[5]["mapping_status"], "not_applicable")
        self.assertIn("back_cover", rows[5]["evidence_classes"])

    def test_index_citation_is_not_a_printed_page_label(self):
        rows = map_pages(
            [
                {
                    "source_page_index": 789,
                    "reading_text": "Index\nI24\nIndex\n",
                    "page_height": 783,
                    "blocks": [
                        {"bbox": [75, 711, 90, 723], "text": "965\n"},
                        {"bbox": [48, 747, 106, 759], "text": "I24\nIndex\n"},
                    ],
                }
            ],
            [],
        )
        self.assertEqual(rows[0]["printed_page_number"], "I24")
        self.assertEqual(rows[0]["printed_page_label"], "I24")

    def test_body_number_in_unlocated_text_is_not_a_page_label(self):
        rows = map_pages(
            [{"source_page_index": 0, "text": "100 mg", "blocks": []}],
            [],
        )
        self.assertIsNone(rows[0]["printed_page_number"])
        self.assertNotEqual(rows[0]["mapping_status"], "certain")

    def test_credits_page_is_retained_without_inventing_a_number(self):
        rows = map_pages(
            [{"source_page_index": 823, "text": "Crédits", "blocks": []}],
            [],
        )
        self.assertIsNone(rows[0]["printed_page_number"])
        self.assertIn("credits_label", rows[0]["evidence_classes"])
    def test_visible_labels_preserve_exact_case_and_non_numeric_strings(self):
        pages = [
            {
                "source_page_index": 10,
                "reading_text": "iv\nPréface",
                "page_height": 783,
                "blocks": [{"bbox": [48, 747, 100, 759], "text": "iv\n"}],
            },
            {
                "source_page_index": 20,
                "reading_text": "I57\nIndex",
                "page_height": 783,
                "blocks": [{"bbox": [496, 747, 555, 759], "text": "I57\n"}],
            },
            {
                "source_page_index": 30,
                "reading_text": "R3\nRéférences",
                "page_height": 783,
                "blocks": [{"bbox": [48, 747, 100, 759], "text": "R3\n"}],
            },
        ]
        rows = map_pages(pages, [])
        self.assertEqual([row["printed_page_number"] for row in rows], ["iv", "I57", "R3"])
        self.assertEqual([row["printed_page_label"] for row in rows], ["iv", "I57", "R3"])

    def test_page_kinds_use_front_matter_and_cover_rules(self):
        pages = [
            {"source_page_index": 0, "text": "PSYCHIATRIE CLINIQUE\nApproche bio-psycho-sociale", "blocks": []},
            {"source_page_index": 3, "text": "Psychiatrie clinique\nApproche bio-psycho-sociale\n© 2016", "blocks": []},
            {"source_page_index": 8, "text": "Remerciements", "blocks": []},
            {"source_page_index": 9, "text": "Note au lecteur", "blocks": []},
            {"source_page_index": 10, "text": "Préface", "blocks": []},
            {"source_page_index": 11, "text": "Table des matières\nCrédits", "blocks": []},
            {"source_page_index": 14, "text": "Abréviations", "blocks": []},
            {"source_page_index": 825, "text": "back cover", "blocks": []},
        ]
        rows = map_pages(pages, [])
        kinds = {row["source_page_index"]: row["printed_page_kind"] for row in rows}
        self.assertEqual(kinds[3], "front_matter")
        self.assertEqual(kinds[8], "front_matter")
        self.assertEqual(kinds[9], "front_matter")
        self.assertEqual(kinds[10], "front_matter")
        self.assertEqual(kinds[11], "front_matter")
        self.assertEqual(kinds[14], "front_matter")
        self.assertEqual(kinds[825], "cover")
        back = next(row for row in rows if row["source_page_index"] == 825)
        self.assertEqual(back["evidence_classes"], ["back_cover"])

    def test_piecewise_mapping_skips_nonbody_rows_inside_body_range(self):
        pages = [
            {"source_page_index": 18, "text": "Chapitre 49", "blocks": []},
            {
                "source_page_index": 19,
                "reading_text": "1084\nPsychiatrie clinique",
                "page_height": 783,
                "blocks": [{"bbox": [48, 747, 100, 759], "text": "1084\n"}],
            },
            {"source_page_index": 20, "text": "Références", "blocks": []},
            {
                "source_page_index": 21,
                "reading_text": "1086\nPsychiatrie clinique",
                "page_height": 783,
                "blocks": [{"bbox": [48, 747, 100, 759], "text": "1086\n"}],
            },
            {"source_page_index": 22, "text": "Index\nI1", "blocks": []},
            {"source_page_index": 23, "text": "Crédits", "blocks": []},
            {
                "source_page_index": 24,
                "reading_text": "1088\nPsychiatrie clinique",
                "page_height": 783,
                "blocks": [{"bbox": [48, 747, 100, 759], "text": "1088\n"}],
            },
        ]
        rows = map_pages(pages, [{"chapter": 49, "printed_page": "1083", "source_page_index": 18}])
        for index in (20, 22, 23):
            self.assertIsNone(rows[index - 18]["printed_page_number"])
            self.assertNotEqual(rows[index - 18]["mapping_status"], "inferred")


if __name__ == "__main__":
    unittest.main()
