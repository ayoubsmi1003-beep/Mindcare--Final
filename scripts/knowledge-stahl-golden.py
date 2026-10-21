#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — construction du jeu d'evaluation (golden set).

Usage:
    python scripts/knowledge-stahl-golden.py [--taille 72]

Sortie :
  golden-set.jsonl   1 question par entree, avec la reponse attendue,
                     la section attendue et la page IMPRIMEE attendue

Principe :
  - les questions sont tires de VRAIES unites du livre (section, page,
    verbatim) : le jeu mesure la recherche, pas la generation ;
  - couverture : posologie, mecanisme, effets indesirables, interactions,
    populations speciales, index, glossaire, qualifiers, negation, numerique,
    et cas SANS REPONSE (le livre ne repond pas -> le systeme doit le dire) ;
  - reproductible : graine fixe, tri stable, aucun aleatoire libre ;
  - l'identifiant de chunk attendu est resolu depuis la section + la page,
    jamais devine.
"""
from __future__ import annotations

import json
import random
import sys
from collections import defaultdict
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")

# Modele de question ANGLAIS par section L3 (le L3 determine l'angle).
QUESTIONS_FR: dict[str, str] = {
    "Usual Dosage Range": "Quelle est la posologie habituelle de {drug} ?",
    "How to Dose": "Comment dose-t-on {drug} ?",
    "Dosing Tips": "Quels sont les conseils de posologie pour {drug} ?",
    "How the Drug Works": "Comment {drug} agit-il ?",
    "Notable Side Effects": "Quels sont les effets indesirables notables de {drug} ?",
    "Drug Interactions": "Quelles sont les interactions medicamenteuses de {drug} ?",
    "Other Warnings/Precautions": "Quelles precautions faut-il prendre avec {drug} ?",
    "Pregnancy": "Qu'est-il dit de {drug} pendant la grossesse ?",
    "Breast Feeding": "{drug} est-il utilisable pendant l'allaitement ?",
    "Commonly Prescribed for": "Pour quoi {drug} est-il prescrit le plus souvent ?",
    "Generic?": "{drug} existe-t-il en generique ?",
    "Tests": "Quels examens faut-il prescrire avec {drug} ?",
    "Pearls": "Quels sont les conseils cliniques pour {drug} ?",
    "Long-Term Use": "Que sait-on de l'usage prolonge de {drug} ?",
    "Pharmacokinetics": "Quelles sont les pharmacometiques de {drug} ?",
    "Potential Advantages": "Quels sont les avantages potentials de {drug} ?",
    "Potential Disadvantages": "Quels sont les inconvenients potentials de {drug} ?",
}

# Modele de question par section L3 (le L3 determine l'angle de la question).
QUESTIONS_L3: dict[str, str] = {
    "Usual Dosage Range": "What is the usual dosage range of {drug}?",
    "How to Dose": "How is {drug} dosed?",
    "Dosing Tips": "What are the dosing tips for {drug}?",
    "How the Drug Works": "How does {drug} work?",
    "Notable Side Effects": "What are the notable side effects of {drug}?",
    "Life-Threatening or Dangerous Side Effects": "What are the life-threatening side effects of {drug}?",
    "Drug Interactions": "What are the drug interactions with {drug}?",
    "Other Warnings/Precautions": "What other warnings and precautions apply to {drug}?",
    "Pregnancy": "What is known about {drug} in pregnancy?",
    "Breast Feeding": "Is {drug} safe during breast feeding?",
    "Commonly Prescribed for": "What is {drug} commonly prescribed for?",
    "Generic?": "Is {drug} available as a generic?",
    "Tests": "Which tests are required when prescribing {drug}?",
    "Pearls": "What are the clinical pearls for {drug}?",
    "If It Works": "What should be done if {drug} works?",
    "If It Doesn't Work": "What should be done if {drug} does not work?",
    "Potential Advantages": "What are the potential advantages of {drug}?",
    "Potential Disadvantages": "What are the potential disadvantages of {drug}?",
    "Long-Term Use": "What is known about the long-term use of {drug}?",
    "Pharmacokinetics": "What are the pharmacokinetics of {drug}?",
    "Overdose": "What are the symptoms of overdose with {drug}?",
    "Habit Forming": "Is {drug} habit forming?",
    "How to Stop": "How should {drug} be stopped?",
    "Dosage Forms": "What dosage forms of {drug} are available?",
    "Side Effects": "What side effects does {drug} cause?",
    "Dosing and Use": "What is known about dosing and use of {drug}?",
    "Special Populations": "What are the special population considerations for {drug}?",
    "Therapeutics": "What is the therapeutic profile of {drug}?",
}

# Cas sans reponse : la question porte sur un sujet ABSENT du livre.
# Le systeme doit rendre « sans preuve », jamais inventer.
SANS_REPONSE = [
    ("What is the recommended insulin regimen for type 1 diabetes?", "insulin"),
    ("What is the dosing of methotrexate in rheumatoid arthritis?", "methotrexate"),
    ("What is the antibiotic of choice for community-acquired pneumonia?", "pneumonia"),
    ("What is the target INR for mechanical aortic valve anticoagulation?", "valve"),
    ("What is the recommended vitamin D dose for osteomalacia?", "osteomalacia"),
    ("What is the treatment for hookworm infection?", "hookworm"),
]


def slug(s: str) -> str:
    return "".join(c.lower() if c.isalnum() else "-" for c in s).strip("-").replace("--", "-")


def main() -> int:
    args = sys.argv
    taille = 72
    if "--taille" in args:
        taille = int(args[args.index("--taille") + 1])

    unites = [json.loads(l) for l in (DOSSIER / "units.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]
    chunks = [json.loads(l) for l in (DOSSIER / "chunks-v2.jsonl").read_text(encoding="utf-8").split("\n") if l.strip()]
    par_unite: dict[str, list[dict]] = defaultdict(list)
    for c in chunks:
        par_unite[c["unit_id"]].append(c)

    # --- 1. candidats par angle de question -------------------------------
    par_l3: dict[str, list[dict]] = defaultdict(list)
    for u in unites:
        chemin = u.get("structural_path") or []
        if len(chemin) < 3:
            continue
        l3 = chemin[2]
        if l3 in QUESTIONS_L3:
            par_l3[l3].append(u)

    rng = random.Random(20261020)
    entrees: list[dict] = []
    compteur = 0

    def ajouter(u: dict, question: str, kind: str) -> None:
        nonlocal compteur
        compteur += 1
        chunks_unite = par_unite.get(u["id"], [])
        chemin = u.get("structural_path") or []
        # Requete TECHNIQUE : les mots de contenu que le planificateur de
        # production conserve (nom du medicament + L2 + L3). Elle est
        # PERMISSIBLE parce que le chunk porte le chemin de titres DANS son
        # texte : le contenu de l book's section est donc adressable
        # lexicalement. Elle sert a mesurer la QUALITE DU CORPUS, distincte
        # de la QUALITE DU PLANIFICATEUR (mesuree separement).
        technique = " ".join(w for w in [chemin[0], chemin[1] if len(chemin) > 1 else None,
                                         chemin[2] if len(chemin) > 2 else None] if w)
        entrees.append({
            "id": f"stahl7-g-{compteur:04d}",
            "question": question,
            "requete_technique": technique,
        "requete_fr": (QUESTIONS_FR.get(chemin[2] if len(chemin) > 2 else "", "")
                       .format(drug=chemin[0] if chemin else "") or None),
            "language": "en",
            "kind": kind,
            "drug": chemin[0] if chemin else None,
            "l2": chemin[1] if len(chemin) > 1 else None,
            "l3": chemin[2] if len(chemin) > 2 else None,
            "expected_section": " › ".join(chemin),
            "expected_printed_page": u.get("printed_page_start"),
            "expected_source_page": u.get("page_start"),
            "expected_unit_ids": [u["id"]],
            "expected_chunk_ids": [c["chunk_id"] for c in chunks_unite],
            "expected_evidence": (u.get("evidence_wording") or "")[:600],
            "source": BOOK_ID,
        })

    # --- 2. couverture des angles -----------------------------------------
    # 3 medicaments distincts par angle (le plus large : ~22 angles)
    medicaments_vus: set[str] = set()
    for l3, modele in QUESTIONS_L3.items():
        candidats = par_l3.get(l3) or []
        if not candidats:
            continue
        rng.shuffle(candidats)
        pris = 0
        for u in candidats:
            drug = (u.get("structural_path") or [""])[0]
            if drug in medicaments_vus and pris < 2:
                continue
            ajouter(u, modele.format(drug=drug), "section")
            medicaments_vus.add(drug)
            pris += 1
            if pris >= 3:
                break

    # --- 3. cas qualifiers / negation / numerique ------------------------
    qualifiers = []
    negations = []
    numeriques = []
    for u in unites:
        ev = (u.get("evidence_wording") or "")
        chemin = u.get("structural_path") or []
        if len(chemin) < 3:
            continue
        drug = chemin[0]
        l3 = chemin[2]
        if l3 not in QUESTIONS_L3:
            continue
        if re.search(r"\b(may|usually|typically|can|could|often)\b", ev, re.IGNORECASE):
            qualifiers.append(u)
        if re.search(r"\b(not recommended|contraindicated|avoid|do not use|should not)\b", ev, re.IGNORECASE):
            negations.append(u)
        if re.search(r"\d+\s*(mg|mcg|g|%)", ev):
            numeriques.append(u)

    for u in (rng.sample(qualifiers, min(6, len(qualifiers))) if qualifiers else []):
        chemin = u.get("structural_path") or []
        ajouter(u, QUESTIONS_L3[chemin[2]].format(drug=chemin[0]), "qualifier")
    for u in (rng.sample(negations, min(4, len(negations))) if negations else []):
        chemin = u.get("structural_path") or []
        ajouter(u, QUESTIONS_L3[chemin[2]].format(drug=chemin[0]), "negation")
    for u in (rng.sample(numeriques, min(6, len(numeriques))) if numeriques else []):
        chemin = u.get("structural_path") or []
        ajouter(u, QUESTIONS_L3[chemin[2]].format(drug=chemin[0]), "numerique")

    # --- 4. index et glossaire -------------------------------------------
    n_index = 0
    for u in unites:
        chemin = u.get("structural_path") or []
        if len(chemin) < 3 or chemin[0] != "Back matter":
            continue
        if n_index >= 8:
            break
        if chemin[1] == "Index by Use":
            ajouter(u, f"Which drugs are used for {chemin[2]}?", "index")
            n_index += 1
        elif chemin[1] == "Index by Class":
            ajouter(u, f"Which drugs belong to the {chemin[2]} class?", "index")
            n_index += 1

    for u in unites:
        chemin = u.get("structural_path") or []
        if len(chemin) < 3 or chemin[1] != "Abbreviations":
            continue
        for abbr in ("5HT", "AChE", "MAOI", "SSRI"):
            if f"\n{abbr}:" in (u.get("evidence_wording") or ""):
                ajouter(u, f"What does the abbreviation {abbr} stand for in this book?", "glossaire")
                break
        break

    # --- 5. cas SANS REPONSE ----------------------------------------------
    for question, _ in SANS_REPONSE:
        compteur += 1
        entrees.append({
            "id": f"stahl7-g-{compteur:04d}",
            "question": question,
            "requete_technique": None,
            "requete_fr": None,
            "language": "en",
            "kind": "sans-reponse",
            "expected_section": None,
            "expected_printed_page": None,
            "expected_unit_ids": [],
            "expected_chunk_ids": [],
            "expected_evidence": None,
            "source": BOOK_ID,
        })

    with (DOSSIER / "golden-set.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for e in entrees:
            f.write(json.dumps(e, ensure_ascii=False, sort_keys=True) + "\n")

    par_kind: dict[str, int] = defaultdict(int)
    for e in entrees:
        par_kind[e["kind"]] += 1
    medicaments = {e.get("drug") for e in entrees if e.get("drug")}
    print(f"golden-set : {len(entrees)} questions | kinds={dict(par_kind)} | medicaments={len(medicaments)}")
    return 0


import re  # noqa: E402  (utilise plus bas)

if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
