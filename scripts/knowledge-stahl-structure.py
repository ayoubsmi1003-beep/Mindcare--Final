#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — S2 cartographie des pages + S3 reconciliation de structure.

Usage:
    python scripts/knowledge-stahl-structure.py

Sorties :
  page-map.jsonl                 1 ligne / page physique (double pagination + section)
  structure-v2.json              sections normalisees + couverture
  structure-casing-proposals.json  table de normalisation L2 (variantes / typos)

Regles :
  - AUCUNE correction silencieuse. Le chemin BRUT reste dans units.jsonl ;
    on derive une CLE D'INDEX normalisee, table de correspondance explicite.
  - Une faute de saisie IMPRIMEE (ex. "Specia Populations") n'est PAS un
    simple variant de casse : elle garde sa propre cle d'index et est signalee
    comme faute-candidat avec ses unites et ses pages (verification page image
    par le relecteur).
  - Pagination double : printed = physical (offset 0, ancrees TOC verifiees).
    Pas d'offset global (lecon Taylor : pass1:map-no-global-offset).
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")

# Modele de monographie (source : structure.json.monograph_template_l2) + sections de fond.
CANONIQUES = [
    "Therapeutics",
    "Side Effects",
    "Dosing and Use",
    "Special Populations",
    "The Art of Psychopharmacology",
    "The Art of Switching",
    "Suggested Reading",
    "Index by Use",
    "Index by Class",
    "Index by Drug Name",
    "Abbreviations",
    "Introduction",
    "Pearls",
]
_CANON_CI = {c.casefold(): c for c in CANONIQUES}


def lire_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def ecrire_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def cle_index(l2_brut: str) -> tuple[str, str]:
    """Retourne (cle_index, categorie) pour un L2 brut.

    categorie : 'canonique' | 'variante-casse' | 'distinct'
    Une faute IMPRIMEE reste 'distinct' (jamais fusionnee en silence).
    """
    if l2_brut in _CANON_CI.values():
        return l2_brut, "canonique"
    cible = _CANON_CI.get(l2_brut.casefold())
    if cible is not None:
        return cible, "variante-casse"
    return l2_brut, "distinct"


def main() -> int:
    structure = lire_json(DOSSIER / "structure.json")
    pages_map = lire_json(DOSSIER / "pages.map.json")
    units = [
        json.loads(l)
        for l in (DOSSIER / "units.jsonl").read_text(encoding="utf-8").split("\n")
        if l.strip()
    ]

    sections = structure.get("sections", [])
    if not sections:
        print("ROUGE - structure.json sans sections")
        return 1

    # --- S2 : page -> section (par plage source) ---------------------------
    section_par_page: dict[int, dict] = {}
    for s in sections:
        for p in range(int(s["source_page_start"]), int(s["source_page_end"]) + 1):
            section_par_page[p] = s

    # unites -> section, par page_start (verifie ensuite par page_end)
    unite_par_id = {u["id"]: u for u in units}
    section_unites: dict[str, list[str]] = defaultdict(list)
    unites_hors_section: list[str] = []
    for u in units:
        p = int(u.get("page_start") or 0)
        s = section_par_page.get(p)
        if s is None:
            unites_hors_section.append(u["id"])
            continue
        section_unites[s["section_id"]].append(u["id"])

    # --- S3 : normalisation L2 ---------------------------------------------
    variantes: dict[str, dict] = {}
    for u in units:
        chemin = u.get("structural_path") or []
        if len(chemin) < 2:
            continue
        brut = chemin[1]
        cle, categorie = cle_index(brut)
        v = variantes.setdefault(
            brut,
            {
                "l2_brut": brut,
                "l2_index": cle,
                "categorie": categorie,
                "unites": 0,
                "sections": set(),
                "exemples_unit_ids": [],
                "pages": set(),
            },
        )
        v["unites"] += 1
        v["sections"].add(chemin[0])
        if len(v["exemples_unit_ids"]) < 5:
            v["exemples_unit_ids"].append(u["id"])
        if u.get("page_start") is not None:
            v["pages"].add(int(u["page_start"]))

    propositions = []
    for brut in sorted(variantes, key=lambda k: (-variantes[k]["unites"], k)):
        v = variantes[brut]
        if v["categorie"] == "canonique" and v["l2_brut"] == v["l2_index"]:
            continue
        propositions.append(
            {
                "l2_brut": v["l2_brut"],
                "l2_index": v["l2_index"],
                "categorie": v["categorie"],
                "unites": v["unites"],
                "sections_touchees": len(v["sections"]),
                "exemples_unit_ids": v["exemples_unit_ids"],
                "pages_exemples": sorted(v["pages"])[:8],
                "traitement": (
                    "cle d'index normalisee ; texte BRUT conserve dans units.jsonl (perte nulle)"
                    if v["categorie"] == "variante-casse"
                    else "cle d'index propre ; CANDIDAT FAUTE IMPRIMEE a valider par le relecteur "
                    "(correction silencieuse interdite)"
                ),
            }
        )

    # --- structure-v2 -------------------------------------------------------
    sections_v2 = []
    couverture_manquante = []
    for s in sections:
        ids = section_unites.get(s["section_id"], [])
        if not ids:
            couverture_manquante.append(s["section_id"])
        l2_utilises = Counter()
        for uid in ids:
            chemin = unite_par_id[uid].get("structural_path") or []
            if len(chemin) > 1:
                l2_utilises[cle_index(chemin[1])[0]] += 1
        bloc = dict(s)
        bloc["unites"] = len(ids)
        bloc["l2_index_utilises"] = dict(sorted(l2_utilises.items()))
        sections_v2.append(bloc)

    ecrire_json(
        DOSSIER / "structure-v2.json",
        {
            "book_id": BOOK_ID,
            "source_version": VERSION,
            "schema_version": "canonical-v2.1",
            "structure_version": "stahl-structure-v2",
            "hierarchy": structure.get("hierarchy"),
            "toc_source": structure.get("toc_source"),
            "toc_drug_range": structure.get("toc_drug_range"),
            "body_start_source_page": structure.get("body_start_source_page"),
            "heading_detection": structure.get("heading_detection"),
            "monograph_template_l2": structure.get("monograph_template_l2"),
            "sections": sections_v2,
            "counts": {
                "sections_total": len(sections_v2),
                "sections_depth0": sum(1 for s in sections_v2 if s.get("depth") == 0),
                "sections_depth1": sum(1 for s in sections_v2 if s.get("depth") == 1),
                "unites_total": len(units),
                "unites_rattachees": len(units) - len(unites_hors_section),
                "unites_hors_section": len(unites_hors_section),
                "sections_sans_unite": len(couverture_manquante),
                "l2_brut_distinctes": len(variantes),
                "l2_index_distinctes": len({v["l2_index"] for v in variantes.values()}),
                "l2_variantes_casse": sum(1 for v in variantes.values() if v["categorie"] == "variante-casse"),
                "l2_fautes_candidates": sum(1 for v in variantes.values() if v["categorie"] == "distinct"),
            },
            "unites_hors_section": unites_hors_section,
            "sections_sans_unite": couverture_manquante,
        },
    )

    ecrire_json(
        DOSSIER / "structure-casing-proposals.json",
        {
            "book_id": BOOK_ID,
            "source_version": VERSION,
            "regle": (
                "Cle d'INDEX derivee (jamais une reecriture du source). "
                "Les variantes de casse fusionnent vers le modele de monographie ; "
                "les fautes IMPRIMEES restent isolees et sont soumises a relecture."
            ),
            "canoniques": CANONIQUES,
            "l2_index_map": {
                brut: {"l2_index": v["l2_index"], "categorie": v["categorie"],
                       "unites": v["unites"]}
                for brut, v in sorted(variantes.items())
            },
            "propositions": propositions,
        },
    )

    # --- page-map.jsonl ----------------------------------------------------
    n = len(pages_map.get("pages", []))
    ecrits = 0
    sans_section = 0
    with (DOSSIER / "page-map.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for i in range(1, n + 1):
            pm = pages_map["pages"][i - 1]
            s = section_par_page.get(i)
            if s is None:
                sans_section += 1
            f.write(
                json.dumps(
                    {
                        "source_page_index": i,
                        "printed_page_number": pm.get("printed_page_number"),
                        "page_mapping_status": pm.get("page_mapping_status"),
                        "section_id": s["section_id"] if s else None,
                        "section_title": s["title"] if s else None,
                        "section_depth": s.get("depth") if s else None,
                        "mapping_rule": pages_map.get("rule"),
                    },
                    ensure_ascii=False,
                    sort_keys=True,
                )
                + "\n"
            )
            ecrits += 1

    c = Counter(v["categorie"] for v in variantes.values())
    print(f"structure-v2 : sections={len(sections_v2)} unites={len(units)} "
          f"hors_section={len(unites_hors_section)} sections_sans_unite={len(couverture_manquante)}")
    print(f"L2 : {len(variantes)} cles brutes -> {len({v['l2_index'] for v in variantes.values()})} cles index "
          f"| variantes={c['variante-casse']} distinctes/typos={c['distinct']}")
    print(f"propositions ecrites : {len(propositions)}")
    print(f"page-map : {ecrits} lignes, {sans_section} pages sans section")
    for p in propositions:
        print(f"  [{p['categorie']}] {p['l2_brut']!r} -> {p['l2_index']!r} ({p['unites']} unites)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
