import tempfile
import unittest
from pathlib import Path

from tools.canon_v2.serialization import write_jsonl
from tools.canon_v2.structure import build_structure, parse_toc_records
from tools.ingest_book import main


class MappingAndStructureTests(unittest.TestCase):
    def test_external_reference_is_not_a_body_node(self):
        tree = build_structure(
            [{"source_page_index": 0, "text": "Table des matières", "kind": "toc"}],
            [{"chapter": 1, "printed_page": "20", "volume": 1}],
        )
        self.assertNotIn(1, [node["chapter"] for node in tree["chapters"] if "chapter" in node])
    def test_external_toc_entries_remain_separate_unresolved_references(self):
        pages = [
            {
                "source_page_index": 0,
                "reading_text": "TOME 1\nPARTIE 1\nIntroduction\nCHAPITRE\n1 \nPsychiatrie bio-psycho-sociale\n2 \nRelation médecin-patient",
            }
        ]
        records = parse_toc_records(pages)
        self.assertEqual([record["chapter"] for record in records], [1, 2])
        self.assertTrue(all(record["volume"] == 1 for record in records))
        tree = build_structure(pages, records)
        self.assertEqual(len(tree["external_references"]), 2)
        self.assertTrue(all(item["xref_status"] == "unresolved_external" for item in tree["external_references"]))

        pages = [
            {
                "source_page_index": 0,
                "reading_text": "Table des matières\nTOME 2\nPARTIE 5\nSpécialités psychiatriques\nSituations de crise\nCHAPITRE\n49 \nUrgences psychiatriques...1083",
            },
            {"source_page_index": 1, "reading_text": "Chapitre 49\nUrgences psychiatriques"},
            {
                "source_page_index": 2,
                "reading_text": "1084\nPsychiatrie clinique",
                "page_height": 783,
                "blocks": [{"bbox": [48, 747, 100, 759], "text": "1084\n"}],
            },
        ]
        records = parse_toc_records(pages)
        chapter_49 = next(record for record in records if record["chapter"] == 49)
        self.assertEqual(chapter_49["source_page_index"], 1)
        self.assertEqual(chapter_49["printed_page"], "1083")

        pages = [
            {"source_page_index": 0, "text": "Note au lecteur"},
            {"source_page_index": 18, "text": "Chapitre 49\nUrgences psychiatriques"},
            {"source_page_index": 19, "text": "49.1\nÉvaluation\n49.1.1\nCadre"},
            {"source_page_index": 20, "text": "Chapitre 50\nSuicide"},
            {"source_page_index": 21, "text": "Chapitre 66\nPsychopharmacologie"},
            {"source_page_index": 22, "text": "66.1\nTraitement\nVoir le chapitre 3."},
            {"source_page_index": 23, "text": "Chapitre 85\nThérapie de soutien"},
        ]
        toc = [
            {"chapter": 49, "printed_page": "1083", "source_page_index": 18, "part_number": 5, "domain_group": "Situations de crise", "volume": 2},
            {"chapter": 50, "printed_page": "1118", "source_page_index": 20, "part_number": 5, "domain_group": "Situations de crise", "volume": 2},
            {"chapter": 66, "printed_page": "1429", "source_page_index": 21, "part_number": 6, "domain_group": "Traitements biologiques", "volume": 2},
            {"chapter": 85, "printed_page": "1786", "source_page_index": 23, "part_number": 6, "domain_group": "Traitements psychosociaux", "volume": 2},
            {"chapter": 3, "printed_page": "70", "volume": 1},
        ]
        tree = build_structure(pages, toc)
        self.assertEqual([part["label"] for part in tree["parts"]], ["PARTIE 5", "PARTIE 6"])
        self.assertEqual([node["chapter"] for node in tree["chapters"]], [49, 50, 66, 85])
        self.assertEqual(tree["chapters"][0]["sections"][0]["number"], "49.1")
        self.assertEqual(tree["chapters"][0]["subsections"][0]["number"], "49.1.1")
        self.assertEqual(tree["chapters"][0]["domain_group"], "Situations de crise")
        self.assertEqual(tree["chapters"][2]["domain_group"], "Traitements biologiques")
        self.assertTrue(any(item["xref_status"] == "unresolved_external" and item["chapter"] == 3 for item in tree["external_references"]))
        self.assertEqual(tree["off_structure"][0]["qa_flag"], "off_structure")

    def test_toc_parser_retains_each_domain_group(self):
        pages = [
            {
                "source_page_index": 0,
                "reading_text": "Table des matières\nTOME 2\nPARTIE 5\nSpécialités psychiatriques\nSituations de crise\nCHAPITRE\n49 \nUrgences...1083\nPsychiatrie légale\nCHAPITRE\n52 \nDroit civil...1167\nPARTIE 6\nTraitements\nTraitements biologiques\nCHAPITRE\n66 \nPsychopharmacologie...1429\nTraitements psychosociaux\nCHAPITRE\n73 \nFondements...1566",
            }
        ]
        records = parse_toc_records(pages)
        groups = {record["chapter"]: record["domain_group"] for record in records if record.get("volume") == 2}
        self.assertEqual(groups[49], "Situations de crise")
        self.assertEqual(groups[52], "Psychiatrie légale")
        self.assertEqual(groups[66], "Traitements biologiques")
        self.assertEqual(groups[73], "Traitements psychosociaux")

        pages = [
            {
                "source_page_index": 0,
                "reading_text": "Table des matières\nTOME 2\nPARTIE 5\nSpécialités psychiatriques\nSituations de crise\nCHAPITRE\n51 \nAgression...1138",
            },
            {
                "source_page_index": 1,
                "reading_text": "Voir le chapitre 51 pour la suite.",
                "page_height": 783,
                "blocks": [{"bbox": [54, 700, 300, 720], "text": "Voir le chapitre 51 pour la suite."}],
            },
            {
                "source_page_index": 2,
                "reading_text": "CHAPITRE51\nAgression, violence et dangerosité",
                "page_height": 783,
                "blocks": [{"bbox": [250, 0, 400, 30], "text": "CHAPITRE51\nAgression, violence et dangerosité"}],
            },
        ]
        records = parse_toc_records(pages)
        chapter_51 = next(record for record in records if record["chapter"] == 51)
        self.assertEqual(chapter_51["source_page_index"], 2)

    def test_final_chapter_keeps_its_verified_body_tail(self):
        pages = [
            {"source_page_index": 23, "text": "Chapitre 85", "blocks": []},
            {
                "source_page_index": 24,
                "reading_text": "1787",
                "page_height": 783,
                "blocks": [{"bbox": [360, 747, 555, 759], "text": "1787\n"}],
            },
            {
                "source_page_index": 25,
                "reading_text": "1788",
                "page_height": 783,
                "blocks": [{"bbox": [360, 747, 555, 759], "text": "1788\n"}],
            },
            {"source_page_index": 26, "reading_text": "Références", "blocks": []},
        ]
        tree = build_structure(
            pages,
            [{"chapter": 85, "printed_page": "1786", "source_page_index": 23, "volume": 2}],
        )
        self.assertEqual(tree["chapters"][0]["page_end"], 25)

    def test_structure_retains_all_tome2_chapters_49_through_85(self):
        toc = [
            {
                "chapter": chapter,
                "printed_page": str(1000 + chapter),
                "source_page_index": chapter,
                "volume": 2,
            }
            for chapter in range(49, 86)
        ]
        pages = [{"source_page_index": chapter, "text": "Chapitre " + str(chapter)} for chapter in range(49, 86)]
        tree = build_structure(pages, toc)
        self.assertEqual([node["chapter"] for node in tree["chapters"]], list(range(49, 86)))
        self.assertEqual(tree["qa"]["part_count"], 2)

    def test_cli_writes_page_map_structure_and_checkpoints(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw_dir = root / "raw"
            raw_dir.mkdir()
            pages = [
                {
                    "source_page_index": 0,
                    "reading_text": "Table des matières\nTOME 2\nPARTIE 5\nSpécialités psychiatriques\nSituations de crise\nCHAPITRE\n49 \nUrgences psychiatriques...1083\nPARTIE 6\nTraitements\nTraitements biologiques\nCHAPITRE\n66 \nPsychopharmacologie...1429",
                    "blocks": [],
                },
                {"source_page_index": 1, "reading_text": "Chapitre 49\nUrgences psychiatriques", "blocks": []},
                {
                    "source_page_index": 2,
                    "reading_text": "1084\nPsychiatrie clinique",
                    "blocks": [{"bbox": [0, 747, 100, 759], "text": "1084\n"}],
                },
                {"source_page_index": 3, "reading_text": "Chapitre 66\nPsychopharmacologie", "blocks": []},
                {"source_page_index": 4, "reading_text": "", "extraction_status": "blank", "blocks": []},
                {"source_page_index": 5, "reading_text": "back cover", "blocks": []},
            ]
            write_jsonl(raw_dir / "repaired-pages.jsonl", pages)
            self.assertEqual(main(["map-pages", "--output", str(root)]), 0)
            self.assertEqual(main(["structure", "--output", str(root)]), 0)
            self.assertEqual(len((root / "page-map.jsonl").read_text(encoding="utf-8").splitlines()), 6)
            self.assertEqual((root / "checkpoints" / "page-map.json").exists(), True)
            self.assertEqual((root / "checkpoints" / "structure.json").exists(), True)
    def test_external_target_scope_preserved_without_volume(self):
        pages = [{"source_page_index": 0, "text": "Table des matières", "blocks": []}]
        toc = [
            {"chapter": 3, "target_scope": "tome-1"},
            {"chapter": 4, "target_scope": "external"},
        ]
        tree = build_structure(pages, toc)
        self.assertEqual(
            [(item["chapter"], item["target_scope"], item["xref_status"]) for item in tree["external_references"]],
            [(3, "tome-1", "unresolved_external"), (4, "external", "unresolved_external")],
        )
        self.assertEqual(tree["chapters"], [])


if __name__ == "__main__":
    unittest.main()
