#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — S0 source-lock + S1 couche brute immuable (2 697 pages).

Usage:
    python scripts/knowledge-stahl-raw.py lock
    python scripts/knowledge-stahl-raw.py extract [--from N] [--to N] [--force]
    python scripts/knowledge-stahl-raw.py verify

Regles (KNOWLEDGE_INGESTION_PLAN.md, ADR-038) :
  - PDF texte natif, LECTURE SEULE, aucun OCR, aucune reparation de contenu ;
  - sortie DETERMINISTE : pas d'horloge, pas d'aleatoire, cles triees ;
  - chaque page physique a un statut EXPLICITE (jamais de page sautee) ;
  - reprise page par page : un fichier brut existant + hash conforme => saut ;
  - chaine de hash continue sur tout le livre (preuve d'integrite).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import pymupdf

RACINE = Path(__file__).resolve().parent.parent
SRC_REL = "Books/prescribers-guide-stahls-essential-psychopharmacology.pdf"
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")
RAW = DOSSIER / "raw"

# Statuts de page : chaque page physique recoit exactement l'un de ceux-ci.
STATUTS_PAGE = ("ok", "blank", "image-only", "low-text", "error")

PAGES_ATTENDUES = 2697


def sha256_octets(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sha256_texte(t: str) -> str:
    return hashlib.sha256(t.encode("utf-8")).hexdigest()


def ecrire_json(chemin: Path, obj) -> None:
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_text(
        json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def lire_json(chemin: Path):
    return json.loads(chemin.read_text(encoding="utf-8"))


# --------------------------------------------------------------------------- S0
def cmd_lock(_args) -> int:
    src = RACINE / SRC_REL
    if not src.exists():
        print(f"ROUGE - source absente : {SRC_REL}")
        return 1
    octets = src.read_bytes()
    empreinte = sha256_octets(octets)
    doc = pymupdf.open(src)
    n_pages = doc.page_count
    meta = {k: v for k, v in (doc.metadata or {}).items() if v}
    doc.close()

    attendu = VERSION.split(":", 1)[1]
    if empreinte.lower() != attendu:
        print(f"ROUGE - SHA-256 inattendu : {empreinte} != {attendu}")
        return 1
    if n_pages != PAGES_ATTENDUES:
        print(f"ROUGE - nombre de pages inattendu : {n_pages} != {PAGES_ATTENDUES}")
        return 1

    ecrire_json(
        DOSSIER / "source-lock.json",
        {
            "source_id": BOOK_ID,
            "sha256": attendu,
            "byte_size": len(octets),
            "pdf_page_count": n_pages,
            "source_path": SRC_REL,
            "lock_version": "1",
        },
    )
    ecrire_json(
        DOSSIER / "run-manifest.json",
        {
            "run_key": empreinte,
            "source_id": BOOK_ID,
            "book_id": BOOK_ID,
            "source_sha256": attendu,
            "page_count": n_pages,
            "parser_version": f"pymupdf-{pymupdf.__doc__.split()[1] if pymupdf.__doc__ else '?'}",
            "extraction_version": "stahl-raw-v1",
            "repair_version": "reading-repair-v1",
            "mapping_version": "piecewise-page-map-v1",
            "schema_version": "canonical-v2.1",
            "pdf_metadata": meta,
        },
    )
    print(f"source-lock OK : sha256={empreinte[:16]}... pages={n_pages} octets={len(octets)}")
    return 0


# --------------------------------------------------------------------------- S1
def extraire_page(doc: pymupdf.Document, index: int) -> dict:
    """index est 1-based (comme le referentiel du depot)."""
    page = doc[index - 1]
    texte = page.get_text("text")
    brut = page.get_text("dict")
    blocs = []
    for b in brut.get("blocks", []):
        if b.get("type") != 0:
            continue
        lignes = []
        for ln in b.get("lines", []):
            spans = []
            for s in ln.get("spans", []):
                t = s.get("text", "")
                if not t.strip():
                    continue
                sb = s.get("bbox", ln.get("bbox", (0, 0, 0, 0)))
                spans.append({
                    "t": t,
                    "bb": [round(float(v), 2) for v in sb],
                    "sz": round(float(s.get("size", 0.0)), 2),
                    "f": s.get("font", ""),
                    "b": bool(s.get("flags", 0) & 2 ** 4),
                })
            if not spans:
                continue
            premier = spans[0]
            lignes.append(
                {
                    "t": "".join(s["t"] for s in spans),
                    "bb": [round(float(v), 2) for v in ln.get("bbox", (0, 0, 0, 0))],
                    "spans": spans,
                    "sz": premier["sz"],
                    "f": premier["f"],
                    "b": premier["b"],
                }
            )
        if not lignes:
            continue
        blocs.append(
            {
                "bbox": [round(float(v), 2) for v in b.get("bbox", (0, 0, 0, 0))],
                "lignes": lignes,
            }
        )

    n_images = len(page.get_images(full=False))
    try:
        n_dessins = len(page.get_drawings())
    except Exception:  # pragma: no cover - defensive
        n_dessins = -1
    n_car = len(texte.strip())
    if n_car == 0:
        statut = "blank"
    elif n_car < 40:
        statut = "low-text"
    elif n_images > 0 and n_car < 200:
        statut = "image-only"
    else:
        statut = "ok"

    avertissements = []
    if n_car and n_car < 40:
        avertissements.append("texte-tr-court")
    if n_images > 0:
        avertissements.append(f"images={n_images}")
    if n_dessins > 200:
        avertissements.append(f"dessins={n_dessins}")

    return {
        "source_page_index": index,
        "printed_page_number": str(index),
        "page_mapping_status": "certain",
        "method": "native-text",
        "status": statut,
        "char_count": n_car,
        "block_count": len(blocs),
        "image_count": n_images,
        "drawing_count": n_dessins,
        "raw_text": texte,
        "raw_text_sha256": sha256_texte(texte),
        "blocks": blocs,
        "warnings": avertissements,
    }


def cmd_extract(args) -> int:
    src = RACINE / SRC_REL
    if not src.exists():
        print(f"ROUGE - source absente : {SRC_REL}")
        return 1
    RAW.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open(src)
    n = doc.page_count
    premier = args.debut if args.debut else 1
    dernier = args.fin if args.fin else n
    ecrits = 0
    sautes = 0
    for index in range(premier, dernier + 1):
        cible = RAW / f"page-{index:04d}.json"
        if cible.exists() and not args.force:
            try:
                precedent = lire_json(cible)
                page = doc[index - 1]
                lignes = precedent.get("blocks", [])
                a_des_bbox = bool(lignes) and all(
                    "bb" in l and "spans" in l for blk in lignes for l in blk.get("lignes", [])
                )
                if a_des_bbox and precedent.get("raw_text_sha256") == sha256_texte(page.get_text("text")):
                    sautes += 1
                    continue
            except Exception:
                pass
        record = extraire_page(doc, index)
        ecrire_json(cible, record)
        ecrits += 1
        if ecrits % 100 == 0:
            print(f"  {index}/{n} pages extraites", flush=True)
    doc.close()
    print(f"extract OK : ecrits={ecrits} sautes={sautes} (total {premier}..{dernier})")
    return 0


# --------------------------------------------------------------------------- verify
def cmd_verify(_args) -> int:
    doc = pymupdf.open(RACINE / SRC_REL)
    n = doc.page_count
    enregistrements = []
    chain = ""
    ecarts = []
    compte_statuts = {s: 0 for s in STATUTS_PAGE}
    for index in range(1, n + 1):
        fichier = RAW / f"page-{index:04d}.json"
        if not fichier.exists():
            ecarts.append({"page": index, "motif": "fichier-brut-absent"})
            continue
        record = lire_json(fichier)
        if record.get("source_page_index") != index:
            ecarts.append({"page": index, "motif": "index-page-incoherent"})
        texte_relu = doc[index - 1].get_text("text")
        hash_recalcule = sha256_texte(texte_relu)
        if record.get("raw_text_sha256") != hash_recalcule:
            ecarts.append({"page": index, "motif": "hash-texte-incoherent"})
        statut = record.get("status")
        if statut not in STATUTS_PAGE:
            ecarts.append({"page": index, "motif": f"statut-inconnu:{statut}"})
        else:
            compte_statuts[statut] += 1
        chain = sha256_texte(f"{chain}:{record.get('raw_text_sha256', '')}")
        enregistrements.append(
            {
                "source_page_index": index,
                "printed_page_number": record.get("printed_page_number"),
                "page_mapping_status": record.get("page_mapping_status"),
                "method": record.get("method"),
                "status": statut,
                "char_count": record.get("char_count"),
                "block_count": record.get("block_count"),
                "image_count": record.get("image_count"),
                "raw_text_sha256": record.get("raw_text_sha256"),
                "raw_file": f"raw/page-{index:04d}.json",
                "warnings": record.get("warnings", []),
            }
        )
    doc.close()

    if len(enregistrements) != n:
        ecarts.append({"page": 0, "motif": f"couverture:{len(enregistrements)}/{n}"})

    with (DOSSIER / "page-records.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for r in enregistrements:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")

    ecrire_json(
        DOSSIER / "raw-manifest.json",
        {
            "book_id": BOOK_ID,
            "source_version": VERSION,
            "pages_total": n,
            "pages_recorded": len(enregistrements),
            "pages_missing": n - len(enregistrements),
            "status_counts": compte_statuts,
            "hash_chain": chain,
            "extractor": f"pymupdf",
            "method": "native-text",
            "ocr_pages": 0,
            "ocr_policy": "interdit (ADR-038) - PDF texte natif, couche texte presente sur 100% des pages",
            "ecarts": ecarts,
            "coverage_complete": len(enregistrements) == n and not ecarts,
        },
    )
    print(
        f"verify : pages={len(enregistrements)}/{n} statuts={compte_statuts} "
        f"ecarts={len(ecarts)} chain={chain[:16]}"
    )
    if ecarts:
        for e in ecarts[:10]:
            print(f"  ECART {e}")
        return 1
    return 0


def main() -> int:
    p = argparse.ArgumentParser(description="Stahl 7e - couche brute")
    sous = p.add_subparsers(dest="cmd", required=True)
    sous.add_parser("lock")
    e = sous.add_parser("extract")
    e.add_argument("--from", dest="debut", type=int, default=0)
    e.add_argument("--to", dest="fin", type=int, default=0)
    e.add_argument("--force", action="store_true")
    sous.add_parser("verify")
    args = p.parse_args()
    if args.cmd == "lock":
        return cmd_lock(args)
    if args.cmd == "extract":
        return cmd_extract(args)
    return cmd_verify(args)


if __name__ == "__main__":
    sys.exit(main())
