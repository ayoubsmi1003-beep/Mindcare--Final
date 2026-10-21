#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — DIAGNOSTIC de l'ordre de lecture (fidélité structurelle).

Usage :
    python scripts/knowledge-stahl-diagnostic-ordre.py

Sortie :
    knowledge/canonical-v2/<livre>/<version>/diagnostic-ordre.json

CE QUE C'EST
    L'extracteur brut (`knowledge-stahl-raw.py`) conserve l'ordre des BLOCS
    renvoyés par PyMuPDF. Sur les pages de monographie, PyMuPDF rend d'abord
    les blocs GRAS (titres), puis les blocs de CORPS. L'ordre de LECTURE réel
    (celui de l'œil du lecteur) est l'ordre vertical (y), quel que soit le
    gras.

    Ce script RECONSTITUE l'ordre de lecture vrai (tri y puis x) et le compare
    à l'ordre extrait. Il mesure :
      · le nombre de pages dont l'ordre extrait ≠ ordre de lecture ;
      · le nombre de TITRES qui se retrouvent ainsi AVANT le corps de la
        section précédente (décalage d'attribution) ;
      · l'impact en aval : combien de chunks canoniques portent un texte dont
        le PREMIER contenu appartient en réalité au titre PRÉCÉDENT.

Ce diagnostic ne modifie AUCUN artefact : il constate.

Sortie console : un résumé chiffré.
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")
BRUT = DOSSIER / "raw"


def blocs_ordres(page: dict) -> tuple[list[str], list[str]]:
    """Retourne (ordre extrait, ordre de lecture vrai y puis x)."""
    extrait: list[str] = []
    lecture: list[tuple[float, float, str]] = []
    for b in page.get("blocks", []):
        lignes = b.get("lignes", [])
        if not lignes:
            continue
        t = " ".join(l.get("t", "") for l in lignes).strip()
        if not t:
            continue
        bb = lignes[0].get("bb", [0, 0, 0, 0])
        extrait.append(t)
        lecture.append((float(bb[1]), float(bb[0]), t))
    lecture.sort(key=lambda e: (round(e[0], 1), e[1]))
    return extrait, lecture


def main() -> int:
    fichiers = sorted(BRUT.glob("page-*.json"))
    if not fichiers:
        print("raw/ introuvable", file=sys.stderr)
        return 1

    pages_desordonnees: list[dict] = []
    total_titres = 0
    total_pages = 0
    pages_avec_titres = 0
    decalages: list[dict] = []

    for f in fichiers:
        page = json.loads(f.read_text(encoding="utf-8"))
        total_pages += 1
        extrait, lecture = blocs_ordres(page)
        if not extrait:
            continue
        gras_idx = []
        for i, b in enumerate(page.get("blocks", [])):
            lignes = b.get("lignes", [])
            if not lignes:
                continue
            if any(l.get("b") for l in lignes):
                gras_idx.append(i)
        if not gras_idx:
            continue
        pages_avec_titres += 1
        total_titres += len(gras_idx)

        # L'ordre extrait place-t-il les blocs gras AVANT les blocs de corps ?
        premier_corps = None
        for i, b in enumerate(page.get("blocks", [])):
            lignes = b.get("lignes", [])
            if not lignes:
                continue
            if not any(l.get("b") for l in lignes):
                premier_corps = i
                break
        if premier_corps is None:
            continue
        gras_avant = [i for i in gras_idx if i < premier_corps]
        if not gras_avant:
            continue

        # Combien de titres sont extraits AVANT le premier bloc de corps ?
        # Chacun d'eux voit son corps volé par le titre précédent.
        voles = []
        for i in gras_avant:
            t = " ".join(l.get("t", "") for l in page["blocks"][i].get("lignes", [])).strip()
            # le bloc de corps qui suit dans l'ordre de lecture appartient
            # en realite a ce titre (il est en dessous)
            y_titre = page["blocks"][i]["lignes"][0].get("bb", [0, 0, 0, 0])[1]
            suivant = next((e[2] for e in lecture if e[0] > y_titre + 1), None)
            if suivant is not None and suivant != t:
                voles.append({"titre": t, "corps_reel": suivant[:120]})
        if voles:
            pages_desordonnees.append({
                "page": page.get("source_page_index"),
                "titres_extraits_avant_corps": len(gras_avant),
                "decalages": voles[:6],
            })
            decalages.extend(voles)

    # --- impact en aval : chunks canoniques ---------------------------------
    chunks = [json.loads(l) for l in (DOSSIER / "chunks-v2.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]
    marqueur = re_compile = None
    import re
    marqueur = re.compile(r"^(?P<chemin>.+?)\s+—\s+(?P<corps>.*)$", re.S)
    chunk_decale: list[dict] = []
    for c in chunks:
        m = marqueur.match(c.get("texte") or "")
        if m is None:
            continue
        chemin, corps = m.group("chemin"), m.group("corps")
        # le chemin se termine par le titre du chunk ; le corps commence-t-il par
        # un titre QUI suit ce titre dans l'ordre de lecture ?
        parties = [p.strip() for p in chemin.split("›")]
        if len(parties) < 3:
            continue
        l3 = parties[-1]
        premier = corps.strip()[:80]
        # un corps qui commence par un titre connu EN MARQUEUR de section
        # (motif " — " interne ou titre en tete) indique un decalage
        if re.match(r"^[A-Z][A-Za-z’'()/\- ]{3,60}$", premier) and premier != l3:
            chunk_decale.append({
                "chunk_id": c.get("chunk_id"),
                "section": c.get("section"),
                "corps_commence_par": premier,
                "page": c.get("page_start"),
            })

    rapport = {
        "livre": BOOK_ID,
        "version": VERSION,
        "methode": {
            "ordre_extrait": "ordre des blocs renvoyes par PyMuPDF (page.get_text('dict'))",
            "ordre_de_lecture": "tri vertical (y) puis horizontal (x) des lignes",
            "aucune_modification": "diagnostic pur : aucun artefact n'est ecrit hors ce rapport",
        },
        "compteurs": {
            "pages_examinees": total_pages,
            "pages_avec_titres": pages_avec_titres,
            "pages_desordonnees": len(pages_desordonnees),
            "part_pages_desordonnees": round(len(pages_desordonnees) / total_pages, 4) if total_pages else 0,
            "titres_total": total_titres,
            "decalages_titre_corps": len(decalages),
            "chunks_canoniques": len(chunks),
            "chunks_a_corps_decale": len(chunk_decale),
        },
        "pages_desordonnees": pages_desordonnees[:40],
        "chunks_a_corps_decale": chunk_decale[:40],
    }
    SORTIE = DOSSIER / "diagnostic-ordre.json"
    SORTIE.write_text(json.dumps(rapport, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    c = rapport["compteurs"]
    print(f"pages examinees          : {c['pages_examinees']}")
    print(f"pages avec titres        : {c['pages_avec_titres']}")
    print(f"pages desordonnees       : {c['pages_desordonnees']} ({c['part_pages_desordonnees'] * 100:.1f} %)")
    print(f"decalages titre/corps    : {c['decalages_titre_corps']}")
    print(f"chunks a corps decale    : {c['chunks_a_corps_decale']} / {c['chunks_canoniques']}")
    print(f"rapport : {SORTIE.relative_to(RACINE)}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
