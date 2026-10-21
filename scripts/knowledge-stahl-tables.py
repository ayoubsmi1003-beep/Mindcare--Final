#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — S4b reconstruction des tables SANS FILETS (borderless).

Usage:
    python scripts/knowledge-stahl-tables.py

Contexte mesure : `find_tables()` (strategie filets) renvoie 0 sur les 2 697
pages. Les tableaux du Prescriber's Guide sont des BLOCS DE COULEUR sans
filets : le detecteur geometrique ne les voit pas. Ils sont reperes par leur
LEGENDRE ("Table 1. Drugs contraindicated due to ..."), puis reconstruits par
la geometrie.

HIERARCHIE DE RECONSTITUTION (mesuree sur la source)
    page -> bloc -> ligne -> span(s)
    - une LIGNE peut contenir plusieurs CELLULES juxtaposees sans separateur
      (ex. "Dextromethorphan" | "Lumateperone" | "Ziprasidone") : les SPANS
      portent chacun leur boite, on les separe par ecart horizontal ;
    - une CELLULE peut se REPLIER sur plusieurs lignes (x constant, y
      adjacent) : elle est reconstituee, pas dupliquee ;
    - une RANGEE = cellules qui se recouvrent verticalement.

Sorties :
  tables.jsonl            tables reconstruites
  tables-summary.json     comptes, continuations, notes de structure

Regles :
  - une table n'est creee que si sa LEGENDRE est presente dans le source ;
  - l'ordre des lignes et des colonnes est celui du source ;
  - une table qui se poursuit sur la page suivante n'est PROLONGEE que si
    l'en-tete se repete (preuve explicite) ; les segments de page d'origine
    sont conserves ;
  - toute ambiguite residuelle => `verification_status: needs_review` ;
  - aucune valeur inventee, aucune cellule manquante comblee.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

import pymupdf

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")

RE_LEGENDE = re.compile(r"^Table\s+(?P<num>\d+)\s*\.\s*(?P<titre>.+)$")
RE_CROSSREF = re.compile(r"\(see\s+Table\s+\d+")
TITRES_SECTION = re.compile(
    r"^(Therapeutics|Side Effects|Dosing and Use|Special Populations|"
    r"The Art of Psychopharmacology|The Art of Switching|Suggested Reading|"
    r"Drug Interactions|Other Warnings/Precautions|Generic\?|Pearls|"
    r"Commonly Prescribed for|How the Drug Works|Dosing Tips|Tests|"
    r"Potential Advantages|Potential Disadvantages)\b"
)
MARGE_BAS_PAGE = 700.0
TOL_Y = 7.0          # recouvrement vertical = meme rangee
TOL_CELL_X = 5.0     # alignement horizontal = meme colonne
TOL_CELL_Y = 4.0     # repli vertical d'une cellule
TOL_FRAGMENT_X = 3.0 # ecart horizontal = nouvelle cellule dans la ligne


def lire_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def lignes_page(page: int) -> list[dict]:
    """Lignes de la page, chacune avec ses fragments (cellules candidates)."""
    r = lire_json(DOSSIER / "raw" / f"page-{page:04d}.json")
    out = []
    for blk in r.get("blocks", []):
        for ln in blk.get("lignes", []):
            bb = ln.get("bb")
            if not bb:
                continue
            spans = [s for s in (ln.get("spans") or []) if s.get("bb")]
            if not spans:
                spans = [{"t": ln.get("t", ""), "bb": bb, "sz": ln.get("sz", 0.0)}]
            # decoupe de la ligne en fragments (cellules juxtaposees)
            fragments = []
            for sp in sorted(spans, key=lambda s: s["bb"][0]):
                sb = sp["bb"]
                if fragments and sb[0] - fragments[-1]["x1"] <= TOL_FRAGMENT_X:
                    f = fragments[-1]
                    f["texte"] += sp["t"]
                    f["x1"] = max(f["x1"], sb[2])
                    f["b"] = f["b"] or bool(sp.get("b"))
                else:
                    fragments.append({"texte": sp["t"], "x0": sb[0], "x1": sb[2],
                                       "b": bool(sp.get("b"))})
            out.append({
                "t": "".join(s["t"] for s in spans).strip(),
                "y0": bb[1], "y1": bb[3],
                "x0": bb[0], "x1": bb[2],
                "sz": ln.get("sz", 0.0),
                "b": bool(ln.get("b")),
                "fragments": fragments,
            })
    out.sort(key=lambda l: (round(l["y0"], 1), l["x0"]))
    return out


def cellules_region(lignes: list[dict]) -> list[dict]:
    """Fusionne les fragments en cellules (repli vertical) puis en rangees."""
    cellules: list[dict] = []
    for ln in lignes:
        for fr in ln["fragments"]:
            trouvee = None
            for c in cellules:
                if abs(fr["x0"] - c["x0"]) <= TOL_CELL_X and c["y0"] - 2 <= ln["y0"] <= c["y1"] + TOL_CELL_Y:
                    trouvee = c
                    break
            if trouvee is not None:
                # Un fragment qui REPLIE la cellule vient d'une autre ligne :
                # on espace. Deux fragments juxtaposes sur la MEME ligne
                # n'ont pas de separateur dans la source : on n'en ajoute pas.
                meme_ligne = abs(ln["y0"] - trouvee["y_last"]) < 1.0
                trouvee["texte"] = (trouvee["texte"] + ("" if meme_ligne else " ") + fr["texte"]).strip()
                trouvee["x1"] = max(trouvee["x1"], fr["x1"])
                trouvee["y1"] = max(trouvee["y1"], ln["y1"])
                trouvee["y_last"] = ln["y0"]
            else:
                cellules.append({
                    "texte": fr["texte"].strip(),
                    "x0": fr["x0"], "x1": fr["x1"],
                    "y0": ln["y0"], "y1": ln["y1"],
                    "y_last": ln["y0"],
                    "sz": ln.get("sz", 0.0),
                    "b": bool(fr.get("b")),
                })
    # RANGEES par FRONTIERES.
    # Mesure : sur p.2256 les hauteures de rangee sont irregulieres (71 pt
    # puis 33 pt) ; un simple recouvrement vertical decale les colonnes les
    # unes par rapport aux autres. L'algorithme correct, celui des moteurs de
    # tableaux : une frontiere de rangee est un `y` qu'aucune cellule ne
    # recouvre, dans AUCUNE colonne ; les rangees sont les segments entre
    # deux frontieres, chaque cellule appartient au segment qui la contient.
    intervalles = [(c["y0"], c["y1"]) for c in cellules]
    candidats = sorted({y for y0, y1 in intervalles for y in (y0, y1)})
    frontieres = [y for y in candidats[1:-1]
                  if not any(y0 < y < y1 for y0, y1 in intervalles)]
    bornes = [float("-inf")] + frontieres + [float("inf")]
    # Chaque cellule est affectee a UN SEUL segment : celui qu'elle touche en
    # premier (une cellule qui chevauche deux segments appartient a celui
    # ou elle commence). Sans cette regle, une cellule haute et large
    # serait dupliquee dans deux rangees (mesure : « St. John's wort »).
    segments: list[list[dict]] = [[] for _ in range(len(bornes) - 1)]
    for c in cellules:
        for i in range(len(bornes) - 1):
            bas, haut = bornes[i], bornes[i + 1]
            if c["y0"] < haut and c["y1"] > bas:
                segments[i].append(c)
                break
    rangees_ = [sorted(s, key=lambda c: c["x0"]) for s in segments if s]
    rangees_.sort(key=lambda r: min(c["y0"] for c in r))
    return rangees_


def max_x1_page(page: int) -> float:
    """Bord droit du texte de la page : signature geometrique d'un run tronque."""
    r = lire_json(DOSSIER / "raw" / f"page-{page:04d}.json")
    xs = [s["bb"][2] for blk in r.get("blocks", []) for ln in blk.get("lignes", [])
          for s in (ln.get("spans") or []) if s.get("bb")]
    return max(xs) if xs else 0.0


def detecter_concatenation(texte: str, medicaments: list[str]) -> list[str] | None:
    """Detecte des NOMS DE MEDICAMENTS colles sans separateur dans la source.

    Exemple mesure (p.1110) : le PDF ecrit
    "MethylphenidateCocaineMethamphetamineModafinilArmodafinil" dans UNE seule
    cellule. Le texte VERBATIM est conserve ; un decoupage n'est PROPOSE que si
    le vocabulaire du livre le permet, et la proposition reste une PROPOSITION
    (jamais appliquee automatiquement).
    """
    if " " in texte.strip():
        return None
    trouvees: list[str] = []
    reste = texte
    for nom in sorted(medicaments, key=len, reverse=True):
        while True:
            i = reste.find(nom)
            if i < 0:
                break
            trouvees.append(nom)
            reste = reste[:i] + reste[i + len(nom):]
    if len(trouvees) < 2:
        return None
    # ordre textuel (le scan glouton renvoie l'ordre de suppression)
    return sorted(trouvees, key=lambda n: texte.find(n))


def hauteur_page(page: int) -> float:
    doc = pymupdf.open(RACINE / "Books" / "prescribers-guide-stahls-essential-psychopharmacology.pdf")
    try:
        return float(doc[page - 1].rect.height)
    finally:
        doc.close()


def _sans_espace(t: str) -> str:
    return re.sub(r"\s+", "", t or "")


def _fragments_sont_prefixes(fragments: list[str], mots_frere: list[str]) -> bool:
    """Chaque fragment tronque doit-il etre un PREFIXE du mot frere suivant ?

    C'est la preuve qu'une cellule tronquee est une version COUPEE de la
    meme cellule imprimee ailleurs : fragment apres fragment, dans l'ordre.
    """
    i = 0
    for frag in fragments:
        f = _sans_espace(frag).lower()
        if not f:
            continue
        trouve = False
        while i < len(mots_frere):
            mot = mots_frere[i].lower()
            if mot.startswith(f):
                i += 1
                trouve = True
                break
            if f.startswith(mot):
                # le fragment est plus long que le mot : il couvre ce mot et
                # deborde sur le suivant.
                reste = f[len(mot):]
                j = i + 1
                while j < len(mots_frere) and reste:
                    m2 = mots_frere[j].lower()
                    if m2.startswith(reste):
                        reste = ""
                    elif reste.startswith(m2):
                        reste = reste[len(m2):]
                    else:
                        return False
                    j += 1
                if reste:
                    return False
                i = j
                trouve = True
                break
            i += 1
        if not trouve:
            return False
    return True


def resoudre_par_occurrence_soeur(tables: list[dict]) -> dict:
    """Resout les cellules ENDOMMAGEES par l'OCCURRENCE SOEUR dans le meme livre.

    Les trois tableaux des monographies MAOI sont imprimes CINQ fois dans
    l'ouvrage. Certaines copies sont tronquees a la marge droite (p.1110,
    p.1505) ; d'autres sont intactes (p.1775, p.2041, p.2258). La completion
    n'est donc PAS une invention : c'est le MEME tableau, imprime en clair
    ailleurs dans le meme livre. La preuve (table frere + page) est
    conservee ; le texte d'origine, damage, reste dans `raw_cells`.

    DIRECTION : seule la copie DOMMAGEE est corrigee. Une copie intacte ne
    doit jamais heriter du defaut de sa voisine.
    """
    par_groupe: dict[tuple[str, str], list[dict]] = {}
    for t in tables:
        par_groupe.setdefault((t["label"], t["title"]), []).append(t)

    resolues = 0
    for (label, titre), groupe in par_groupe.items():
        if len(groupe) < 2:
            continue
        for t in groupe:
            for idx_row, ligne in enumerate(t["rows"]):
                for idx_col, valeur in enumerate(ligne):
                    if not valeur:
                        continue
                    mots_valeur = re.split(r"\s+", valeur.strip())
                    if not mots_valeur:
                        continue
                    # On RAMASSE tous les freres candidats, puis on retient
                    # le rendu le plus propre (le plus d'espaces : c'est la
                    # copie ou le PDF n'a pas colle les mots).
                    candidats: list[tuple[str, dict, str]] = []
                    for frere in groupe:
                        if frere["table_id"] == t["table_id"]:
                            continue
                        # meme position (rangee, colonne) chez le frere
                        if idx_row >= len(frere["rows"]):
                            continue
                        ligne_frere = frere["rows"][idx_row]
                        if idx_col >= len(ligne_frere):
                            continue
                        candidat = ligne_frere[idx_col]
                        if not candidat or candidat == valeur:
                            continue
                        # (a) concaténation : identique une fois les espaces
                        #     retirés. La copie DOMMAGÉE est celle qui a
                        #     MOINS d'espaces.
                        if _sans_espace(candidat) == _sans_espace(valeur):
                            if valeur.count(" ") < candidat.count(" "):
                                candidats.append((candidat, frere, "concaténation"))
                            continue
                        # (b) troncature : la cellule damage est un prefixe
                        #     strict de la cellule frere, ET elle touche la
                        #     marge droite de sa page (signature geometrique).
                        if (len(valeur) < len(candidat)
                                and _fragments_sont_prefixes(mots_valeur, re.split(r"\s+", candidat.strip()))
                                and _touche_marge_droite(t, valeur)):
                            candidats.append((candidat, frere, "troncature à la marge droite"))
                            continue
                    if candidats:
                        # rendu le plus propre = le plus d'espaces, puis le plus long
                        candidat, frere, nature = max(
                            candidats, key=lambda c: (c[0].count(" "), len(c[0])))
                        base = ("identique une fois les espaces retirés (frontières de mots perdues par le PDF)"
                                if nature == "concaténation" else
                                "cellule tronquée = version coupée de la même cellule imprimée "
                                "en clair dans une autre monographie du même livre")
                        t.setdefault("source_anomalies", []).append({
                            "column": idx_col, "row": idx_row, "text": valeur,
                            "damage": nature,
                            "sibling_occurrence": {
                                "table_id": frere["table_id"],
                                "page": frere["page_start"],
                                "cell_text": candidat,
                                "match_basis": base,
                            },
                            "proposed_completion": candidat,
                            "resolution": "corrigee-par-occurrence-soeur",
                            "raw_cells": valeur,
                        })
                        resolues += 1
    return {"occurrences_soeur_resolues": resolues}


def _touche_marge_droite(table: dict, valeur: str) -> bool:
    """La cellule s'arrete-t-elle au bord droit du texte de sa page ?

    Signature geometrique d'un run tronque par la mise en page.
    """
    page = table.get("page_start")
    if page is None:
        return False
    try:
        bord = max_x1_page(int(page))
    except Exception:
        return False
    # la cellule est la derniere de sa rangee : on compare sa fin a la marge
    for r in table.get("rows", []):
        if valeur in r:
            dernier = r[-1]
            if dernier != valeur:
                return False
            return True
    return False


def main() -> int:
    pages = json.loads((DOSSIER / "visuals-summary.json").read_text(encoding="utf-8"))
    n = pages["pages_total"]

    # --- reperage des legendres (definitions, pas renvois) ---------------
    legendres: list[dict] = []
    for page in range(1, n + 1):
        try:
            ls = lignes_page(page)
        except FileNotFoundError:
            continue
        for i, ln in enumerate(ls):
            t = ln["t"].strip()
            m = RE_LEGENDE.match(t)
            if not m or RE_CROSSREF.search(t):
                continue
            titre = m.group("titre").strip()
            # Le titre peut se poursuivre sur la ligne suivante (mesure :
            # p.2258 "… should only be used" / "with MAOIs"). Une suite de
            # titre reprend la marge GAUCHE de la legende ; une cellule de
            # tableau, elle, commence sur la position d'une colonne.
            y_fin = ln["y1"]
            if i + 1 < len(ls):
                suiv = ls[i + 1]
                st = suiv["t"].strip()
                if st and abs(suiv["x0"] - ln["x0"]) <= 3.0 and not suiv.get("b") \
                   and not RE_LEGENDE.match(st) and not RE_CROSSREF.search(st) \
                   and suiv["y0"] - ln["y1"] < 6.0:
                    titre = (titre + " " + st).strip()
                    y_fin = suiv["y1"]
            legendres.append({
                "page": page, "label": f"Table {m.group('num')}",
                "num": m.group("num"), "titre": titre, "y0": ln["y0"], "y_fin": y_fin,
            })

    # --- extraction de chaque table ---------------------------------------
    tables: list[dict] = []
    compteur = 0
    medicaments = []
    mp = DOSSIER / "meds.jsonl"
    if mp.exists():
        medicaments = [json.loads(l)["drug_name"] for l in
                       mp.read_text(encoding="utf-8").split("\n") if l.strip()]
    for leg in legendres:
        compteur += 1
        page = leg["page"]
        ls = lignes_page(page)
        apres = [l for l in ls if l["y0"] > leg["y_fin"] + 1]

        # region de la page de legende : jusqu'a la legende suivante, un titre
        # de section, ou la fin de page.
        region = []
        for l in apres:
            t2 = l["t"].strip()
            if RE_LEGENDE.match(t2) and not RE_CROSSREF.search(t2):
                break
            if TITRES_SECTION.match(t2) and l.get("sz", 0) >= 12:
                break
            region.append(l)
        if not region:
            continue

        rangees_ = cellules_region(region)
        if not rangees_:
            continue

        # Etiquettes (« Do Not Use: », « Use With Caution: ») et rangees utiles.
        etiquettes: list[str] = []
        rangees_utiles: list[list[dict]] = []
        for r in rangees_:
            if len(r) == 1 and r[0]["texte"].rstrip().endswith(":"):
                etiquettes.append(r[0]["texte"].strip())
            else:
                rangees_utiles.append(r)
        # L'en-tete peut etre ABSENT de la page de legende (mesure : p.1505,
        # « Table 3 » est en bas de page, tout l'en-tete est sur p.1506).
        en_tete_legende = rangees_utiles[0] if rangees_utiles else None
        corps_legende = rangees_utiles[1:] if rangees_utiles else []

        # --- CONTINUATION : l'en-tete peut se repeter sur la page suivante.
        # La page de legende ne porte souvent qu'UNE partie de l'en-tete
        # (mesure : p.2258 n'a que « Decongestants » ; le reste de l'en-tete
        # est sur p.2259). C'est l'en-tete COMPLET qui fait foi.
        # Tentative de continuation SI (a) la page de legende ne porte aucune
        # ligne de donnees (legende isolee en bas de page), ou (b) la region
        # descend dans le pied de page (le tableau deborde).
        hauteur = hauteur_page(page)
        descend_au_pied = bool(region) and max(l["y1"] for l in region) > hauteur - 100.0
        en_tete_continuation = None
        corps_continuation: list[list[dict]] = []
        page_continuation = None
        if True:  # tentative systematique : c'est l'en-tete repete qui decide
            try:
                suivante = lignes_page(page + 1)
            except FileNotFoundError:
                suivante = []
            if suivante:
                reperes = [l for l in suivante if l["y0"] > 0 and l["y0"] < hauteur - 40.0]
                rangees_suivantes = cellules_region(reperes)
                # On travaille en RANGEES (et non en lignes) : l'en-tete peut
                # etre compose de plusieurs cellules sur la meme bande
                # verticale (mesure : p.1506, 4 cellules d'en-tete).
                idx_repere = None
                for i, r in enumerate(rangees_suivantes):
                    if en_tete_legende is not None and r and r[0]["texte"].strip() == en_tete_legende[0]["texte"].strip():
                        idx_repere = i
                        break
                if idx_repere is None and en_tete_legende is None:
                    for i, r in enumerate(rangees_suivantes):
                        if r and all(c.get("b") for c in r):
                            idx_repere = i
                            break
                if idx_repere is not None:
                    rangees_suivantes = rangees_suivantes[idx_repere:]
                    # la rangee d'en-tete peut elle-meme etre partielle
                    while rangees_suivantes and rangees_suivantes[0] and not all(c.get("b") for c in rangees_suivantes[0]):
                        # rangee non grasse : elle appartient deja au corps
                        corps_continuation = rangees_suivantes
                        rangees_suivantes = []
                        break
                    if rangees_suivantes:
                        en_tete_continuation = rangees_suivantes[0]
                        corps_continuation = rangees_suivantes[1:] + corps_continuation
                        page_continuation = page + 1

        # En-tete de reference : celui qui porte le PLUS de colonnes.
        en_tete = en_tete_legende if en_tete_legende is not None else en_tete_continuation
        if en_tete_continuation is not None:
            if en_tete is None or len(en_tete_continuation) >= len(en_tete):
                en_tete = en_tete_continuation
        if en_tete is None:
            continue
        colonnes = [c["x0"] for c in en_tete]
        n_col = max(1, len(colonnes))
        entete_textes = [c["texte"] for c in en_tete]

        def en_ligne(cs: list[dict]) -> list[str]:
            ligne = [""] * n_col
            for c in cs:
                idx = min(range(n_col), key=lambda k: abs(colonnes[k] - c["x0"]))
                ligne[idx] = (ligne[idx] + " " + c["texte"]).strip() if ligne[idx] else c["texte"]
            return ligne

        def est_hors_tableau(cs: list[dict]) -> bool:
            """Une rangee d'UNE seule cellule, loin de toute colonne, n'est pas
            dans le tableau : c'est le bloc qui suit (« Do Not Use » centre,
            liste a puces en retrait)."""
            if len(cs) != 1:
                return False
            return min(abs(cs[0]["x0"] - x) for x in colonnes) > 10.0

        lignes_table: list[list[str]] = []
        anomalies: list[dict] = list()
        notes: list[str] = []
        for cs in corps_legende:
            if any(c.get("b") for c in cs) or est_hors_tableau(cs):
                break
            if len(cs) == 1 and cs[0]["texte"].strip().startswith("*"):
                notes.append(cs[0]["texte"].strip())
                continue
            lignes_table.append(en_ligne(cs))
        for cs in corps_continuation:
            if any(c.get("b") for c in cs) or est_hors_tableau(cs):
                break
            if len(cs) == 1 and cs[0]["texte"].strip().startswith("*"):
                notes.append(cs[0]["texte"].strip())
                continue
            lignes_table.append(en_ligne(cs))

        segments = [{"page": page, "rows": len(lignes_table)}]
        continuation = {"continued": False, "reason": None, "page": None}
        if page_continuation is not None and corps_continuation:
            segments.append({"page": page_continuation, "rows": len(lignes_table)})
            continuation = {
                "continued": True,
                "reason": "en-tete repete en haut de la page suivante (preuve explicite)",
                "page": page_continuation,
            }

        tables.append({
            "table_id": f"stahl7:table:{page}:{compteur:04d}",
            "book_id": BOOK_ID,
            "source_version": VERSION,
            "label": leg["label"],
            "title": leg["titre"],
            "page_start": page,
            "page_end": segments[-1]["page"],
            "printed_page_start": str(page),
            "printed_page_end": str(segments[-1]["page"]),
            "body_start_page": page_continuation if page_continuation else page,
            "page_segments": segments,
            "continuation": continuation,
            "headers": entete_textes,
            "columns": n_col,
            "rows": lignes_table,
            "rows_count": len(lignes_table),
            "label_rows": etiquettes,
            "footnotes": notes,
            "source_anomalies": anomalies,
            "units": [],
            "abbreviations": {},
            "host_unit": None,
            "detector": "legendre-ancree + geometrie (tables sans filets)",
            "verification_status": "needs_review",
            "note": (
                "Cellules reconstruites depuis la geometrie des lignes et des spans ; "
                "texte conserve tel quel. Ordre source preserve."
            ),
        })

    # Resolution par occurrence soeur (meme tableau imprime ailleurs, en clair).
    resolution = resoudre_par_occurrence_soeur(tables)

    with (DOSSIER / "tables.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for t in tables:
            f.write(json.dumps(t, ensure_ascii=False, sort_keys=True) + "\n")
    ft = DOSSIER / "tables-filets.jsonl"
    if ft.exists():
        tables_filets = [json.loads(l) for l in ft.read_text(encoding="utf-8").split("\n") if l.strip()]
        with (DOSSIER / "tables.jsonl").open("a", encoding="utf-8", newline="\n") as f:
            for t in tables_filets:
                f.write(json.dumps(t, ensure_ascii=False, sort_keys=True) + "\n")

    resume = {
        "book_id": BOOK_ID,
        "source_version": VERSION,
        "counts": {
            "tables_borderless_reconstruites": len(tables),
            "tables_filets_detectees": len(tables_filets),
            "tables_total": len(tables) + len(tables_filets),
            "tables_avec_continuation": sum(1 for t in tables if t["continuation"]["continued"]),
            "lignes_de_donnees": sum(t["rows_count"] for t in tables),
            "anomalies_source": sum(len(t.get("source_anomalies", [])) for t in tables),
            "anomalies_resolues_par_occurrence_soeur": resolution["occurrences_soeur_resolues"],
            "colonnes": dict(Counter(t["columns"] for t in tables)),
            "par_page": dict(Counter(str(t["page_start"]) for t in tables)),
        },
        "method": (
            "Les tableaux du livre sont des blocs de couleur SANS filets : la strategie "
            "filets de PyMuPDF en detecte 0 sur 2 697 pages. Ils sont reperes par leur "
            "legendre ('Table N. <titre>') puis reconstruits par la geometrie "
            "(ligne -> span -> cellule -> rangee)."
        ),
        "tables": [
            {"table_id": t["table_id"], "label": t["label"], "title": t["title"],
             "pages": f"{t['page_start']}-{t['page_end']}", "rows": t["rows_count"],
             "columns": t["columns"], "continuation": t["continuation"]["continued"]}
            for t in tables
        ],
    }
    (DOSSIER / "tables-summary.json").write_text(
        json.dumps(resume, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    print(f"tables : {len(tables)} borderless + {len(tables_filets)} filets | "
          f"lignes={resume['counts']['lignes_de_donnees']} | "
          f"continuations={resume['counts']['tables_avec_continuation']}")
    for t in tables:
        print(f"  {t['label']:9s} p.{t['page_start']}-{t['page_end']} "
              f"{t['rows_count']}l x {t['columns']}c :: {t['title'][:52]}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
