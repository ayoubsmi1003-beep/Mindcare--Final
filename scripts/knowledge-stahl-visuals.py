#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — S4 inventaire tables et figures (MESURE, pas supposition).

Usage:
    python scripts/knowledge-stahl-visuals.py

Sorties :
  tables.jsonl              tables detectees (structure complete si applicable)
  figures.jsonl             figures / images placees, avec bbox et classification
  visuals-summary.json      comptes + couverture de la detection

Regles :
  - AUCUNE table inventee : on conserve l'ordre de cellules brut du detecteur,
    jamais de valeur devinee, jamais de cellule manquante comblee.
  - Une table dont la structure est ambigu reste `verification_status:
    needs_review` avec ses cellules brutes.
  - Les images sont classees par TAILLE (icone vs figure) : le livre utilise
    des pictogrammes de classe medicamenteuse ; les distinguer est necessaire
    pour ne pas compter 500 icones comme 500 figures.
  - Zero OCR, zero invention, lecture seule.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

RACINE = Path(__file__).resolve().parent.parent
SRC_REL = "Books/prescribers-guide-stahls-essential-psychopharmacology.pdf"
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")

# Seuil de discrimination icone / figure (points PDF, bord le plus court).
SEUIL_ICONE_PT = 26.0

RE_TABLE = re.compile(r"\b(TABLE|Table)\s+(\d+[A-Za-z]?)\b")
RE_FIGURE = re.compile(r"\b(FIGURE|Figure)\s+(\d+[A-Za-z]?)\b")


def ecrire_json(p: Path, obj) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(
        json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def main() -> int:
    doc = pymupdf.open(RACINE / SRC_REL)
    n = doc.page_count

    tables: list[dict] = []
    figures: list[dict] = []
    tables_par_page: Counter[int] = Counter()
    images_par_page: Counter[int] = Counter()
    pages_avec_image = 0
    total_images = 0
    icones = 0
    figures_geom = 0
    captions_table: list[dict] = []
    captions_figure: list[dict] = []
    erreurs: list[dict] = []

    for index in range(1, n + 1):
        page = doc[index - 1]
        # --- tables geometriques (filets) ---------------------------------
        try:
            trouvees = page.find_tables()
        except Exception as exc:  # pragma: no cover
            trouvees = []
            erreurs.append({"page": index, "motif": f"find_tables:{type(exc).__name__}"})
        for t in trouvees:
            try:
                cellules = t.extract()
            except Exception:
                cellules = []
            lignes = []
            for ligne in cellules:
                lignes.append([(c if isinstance(c, str) else ("" if c is None else str(c))) for c in ligne])
            tables_par_page[index] += 1
            tables.append(
                {
                    "table_id": f"stahl7:table:{index}:{tables_par_page[index]:04d}",
                    "book_id": BOOK_ID,
                    "source_version": VERSION,
                    "title": None,
                    "page_start": index,
                    "page_end": index,
                    "printed_page_start": str(index),
                    "printed_page_end": str(index),
                    "headers": [],
                    "rows": lignes,
                    "footnotes": [],
                    "units": [],
                    "abbreviations": {},
                    "host_unit": None,
                    "detector": "pymupdf-find-tables",
                    "verification_status": "needs_review",
                    "note": "ordre de cellules brut conserve ; aucune valeur devinee",
                }
            )
        # --- images placees ------------------------------------------------
        try:
            infos = page.get_image_info()
        except Exception:
            infos = []
        if infos:
            pages_avec_image += 1
        for k, info in enumerate(infos, start=1):
            total_images += 1
            images_par_page[index] += 1
            bbox = info.get("bbox", (0, 0, 0, 0))
            w = abs(bbox[2] - bbox[0])
            h = abs(bbox[3] - bbox[1])
            court = min(w, h)
            est_icone = court <= SEUIL_ICONE_PT
            if est_icone:
                icones += 1
            else:
                figures_geom += 1
            figures.append(
                {
                    "figure_id": f"stahl7:fig:{index}:{k:04d}",
                    "book_id": BOOK_ID,
                    "source_version": VERSION,
                    "caption": None,
                    "page_start": index,
                    "page_end": index,
                    "printed_page_start": str(index),
                    "printed_page_end": str(index),
                    "bbox": [round(float(v), 2) for v in bbox],
                    "width_pt": round(w, 2),
                    "height_pt": round(h, 2),
                    "pixel_width": info.get("width"),
                    "pixel_height": info.get("height"),
                    "xres": info.get("xres"),
                    "yres": info.get("yres"),
                    "classification": "icone" if est_icone else "figure",
                    "legend": None,
                    "labels": [],
                    "host_unit": None,
                    "detector": "pymupdf-get-image-info",
                    "verification_status": "needs_review",
                    "note": "image source conservee dans le PDF ; aucun contenu visuel n'est suppose",
                }
            )
        # --- captions ------------------------------------------------------
        texte = page.get_text("text")
        for m in RE_TABLE.finditer(texte):
            captions_table.append({"kind": "table", "label": m.group(0), "page": index})
        for m in RE_FIGURE.finditer(texte):
            captions_figure.append({"kind": "figure", "label": m.group(0), "page": index})
        if index % 250 == 0:
            print(f"  {index}/{n} pages (tables={len(tables)} images={total_images})", flush=True)
    doc.close()

    # regroupement des images : une "figure" = page qui porte des images
    # de taille non-iconique ; le detail image par image reste dans figures.jsonl.
    figures_par_page: dict[int, list[str]] = {}
    for f in figures:
        if f["classification"] == "figure":
            figures_par_page.setdefault(f["page_start"], []).append(f["figure_id"])

    with (DOSSIER / "tables-filets.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for t in tables:
            f.write(json.dumps(t, ensure_ascii=False, sort_keys=True) + "\n")
    with (DOSSIER / "figures.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for g in figures:
            f.write(json.dumps(g, ensure_ascii=False, sort_keys=True) + "\n")

    ecrire_json(
        DOSSIER / "visuals-summary.json",
        {
            "book_id": BOOK_ID,
            "source_version": VERSION,
            "pages_total": n,
            "tables_detected": len(tables),
            "pages_with_tables": len(tables_par_page),
            "table_detection": "pymupdf find_tables (filets) sur 100% des pages",
            "figures_detected": len(figures),
            "figures_geometry": figures_geom,
            "icones": icones,
            "pages_with_images": pages_avec_image,
            "pages_with_figures": len(figures_par_page),
            "seuil_icone_pt": SEUIL_ICONE_PT,
            "caption_table_hits": len(captions_table),
            "caption_figure_hits": len(captions_figure),
            "caption_table_examples": captions_table[:20],
            "caption_figure_examples": captions_figure[:20],
            "erreurs": erreurs[:50],
            "erreurs_count": len(erreurs),
            "limites": (
                "Les blocs de couleur du Prescriber's Guide (Therapeutics / Side Effects / "
                "Dosing and Use / Special Populations) ne sont PAS des tableaux a filets : "
                "ils sont deja atomises en unites canoniques (units.jsonl). "
                "Aucun tableau n'est reconstruit a partir d'une mise en page en blocs."
            ),
        },
    )
    print(
        f"visuals : tables={len(tables)} (pages={len(tables_par_page)}) | images={total_images} "
        f"(figures={figures_geom} icones={icones}, pages avec figure={len(figures_par_page)}) | "
        f"captions table={len(captions_table)} figure={len(captions_figure)} | erreurs={len(erreurs)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
