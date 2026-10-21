#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — INVENTAIRE DE COUVERTURE POSOLOGIQUE (mesure, pas opinion).

Usage :
    python scripts/knowledge-stahl-dosage.py

Sortie :
    knowledge/canonical-v2/<livre>/<version>/dosage-couverture.json

CE QUE C'EST
    Le Prescriber's Guide n'a PAS une rubrique « posologie » unique : chaque
    monographie range sa posologie sous des intitulés différents. Ce script
    MESURE, sur les chunks canoniques :
      · les rubriques L2 et L3 réellement présentes ;
      · pour chaque monographie, les rubriques qui portent une information
        posologique (une dose chiffrée) ;
      · la couverture : combien de monographies sont atteignables par une
        question de posologie, et par quelles rubriques.

CE QUE CE N'EST PAS
    · Ce n'est pas une correction du livre : aucune dose n'est déduite, nulle
      part, à partir d'une connaissance médicale générale.
    · Ce n'est pas un inventaire de l'index de recherche : c'est un inventaire
      de la STRUCTURE source, mesurée sur les artefacts canoniques.
"""
from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")

SEP = "›"

# Une dose chiffrée : « 150–300 mg », « 20 mg/mL », « 0,5 mg », « 75-225 mg/day ».
# Motif volontairement STRICT : un nombre, un séparateur de plage éventuel, une
# unité. Aucun chiffre seul n'est retenu (un numéro de page n'est pas une dose).
DOSE = re.compile(
    r"\d+(?:[.,]\d+)?\s*(?:[-–—]\s*\d+(?:[.,]\d+)?\s*)?"
    r"(?:mg|mcg|µg|g|ml|mL|IU|unites?|units?)\b",
    re.IGNORECASE,
)


def lire_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").split("\n") if l.strip()]


def main() -> int:
    chunks = lire_jsonl(DOSSIER / "chunks-v2.jsonl")
    if not chunks:
        print("chunks-v2.jsonl introuvable ou vide", file=sys.stderr)
        return 1

    l2_index: dict[str, set[str]] = defaultdict(set)
    l3_index: dict[str, set[str]] = defaultdict(set)
    l2_l3: dict[str, set[str]] = defaultdict(set)
    monographie_rubriques: dict[str, set[str]] = defaultdict(set)
    rubriques_poso: dict[str, set[str]] = defaultdict(set)
    monographies_sans_poso: set[str] = set()
    couverture_rubrique: dict[str, int] = defaultdict(int)
    chunks_par_rubrique: dict[str, int] = defaultdict(int)

    for c in chunks:
        parts = [p.strip() for p in (c.get("section") or "").split(SEP)]
        if len(parts) < 2:
            continue
        monographie = parts[0]
        l2 = parts[1]
        l3 = parts[2] if len(parts) > 2 else ""
        l2_index[l2].add(monographie)
        l3_index[l3].add(monographie)
        l2_l3[l2].add(l3)
        monographie_rubriques[monographie].add(f"{l2} | {l3}" if l3 else l2)
        chunks_par_rubrique[f"{l2} | {l3}" if l3 else l2] += 1
        texte = c.get("texte") or ""
        if DOSE.search(texte):
            rubriques_poso[f"{l2} | {l3}" if l3 else l2].add(monographie)
            couverture_rubrique[f"{l2} | {l3}" if l3 else l2] += 1

    for monographie, rubriques in monographie_rubriques.items():
        if not (rubriques & set(rubriques_poso)):
            monographies_sans_poso.add(monographie)

    total_monographies = len(monographie_rubriques)
    avec_poso = total_monographies - len(monographies_sans_poso)

    # Les rubriques qui portent la posologie pour AU MOINS une monographie,
    # triées par couverture décroissante : c'est l'inventaire des réalisations
    # possibles du concept « posologie » dans CE livre.
    realiseurs = sorted(
        (
            {
                "rubrique": r,
                "monographies": len(rubriques_poso[r]),
                "chunks_avec_dose": couverture_rubrique[r],
                "chunks_total": chunks_par_rubrique[r],
                "monographies_total_l3": len(l3_index.get(r.split(" | ")[-1], set())),
            }
            for r in rubriques_poso
        ),
        key=lambda d: (-d["monographies"], d["rubrique"]),
    )

    rapport = {
        "livre": BOOK_ID,
        "version": VERSION,
        "methode": {
            "source": "chunks-v2.jsonl (artefact canonique)",
            "monographies": "premier niveau du chemin de section",
            "rubrique_posologie": "chunk dont le texte contient une dose chiffree (nombre + unite)",
            "separateur_section": "U+203A encadre d'espaces",
        },
        "compteurs": {
            "chunks": len(chunks),
            "monographies": total_monographies,
            "rubriques_l2": len(l2_index),
            "rubriques_l3": len(l3_index),
            "monographies_avec_posologie_chiffree": avec_poso,
            "monographies_sans_posologie_chiffree": len(monographies_sans_poso),
            "couverture_posologie": round(avec_poso / total_monographies, 4) if total_monographies else 0,
            "rubriques_portant_des_doses": len(rubriques_poso),
        },
        "rubriques_l2": {
            k: {"monographies": len(v), "sous_rubriques": sorted(l2_l3[k])}
            for k, v in sorted(l2_index.items())
        },
        "realisations_posologie": realiseurs,
        "monographies_sans_posologie_chiffree": sorted(monographies_sans_poso),
        "par_monographie": {
            m: sorted(r for r in rubriques if r in rubriques_poso)
            for m, rubriques in sorted(monographie_rubriques.items())
        },
    }

    SORTIE = DOSSIER / "dosage-couverture.json"
    SORTIE.write_text(json.dumps(rapport, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"inventaire ecrit : {SORTIE.relative_to(RACINE)}")
    print(f"  monographies : {total_monographies} | avec posologie chiffree : {avec_poso} "
          f"({rapport['compteurs']['couverture_posologie'] * 100:.1f} %)")
    print(f"  rubriques portant des doses : {len(rubriques_poso)}")
    for r in realiseurs[:12]:
        print(f"    {r['monographies']:>4} monographies | {r['rubrique']}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
