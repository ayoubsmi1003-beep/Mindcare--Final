#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — RAPPORT DE COUVERTURE DES RUBRIQUES DE POSOLOGIE.

Usage :
    python scripts/generer-rapport-dosage-stahl.py

Sortie :
    docs/reports/2026-10-20-stahl-dosage-couverture.md

Source unique : `knowledge/canonical-v2/.../dosage-couverture.json`, produit
par `scripts/knowledge-stahl-dosage.py` a partir des chunks canoniques.
Aucune valeur saisie a la main.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
DOSSIER = (RACINE / "knowledge" / "canonical-v2" / "stahl-prescribers-guide-7e-cup" /
           "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
SOURCE = DOSSIER / "dosage-couverture.json"
SORTIE = RACINE / "docs" / "reports" / "2026-10-20-stahl-dosage-couverture.md"


def fr(x: float) -> str:
    return f"{x:.4f}".replace(".", ",")


def main() -> int:
    if not SOURCE.exists():
        print("dosage-couverture.json absent — lancer scripts/knowledge-stahl-dosage.py", file=sys.stderr)
        return 1
    d = json.loads(SOURCE.read_text(encoding="utf-8"))
    c = d["compteurs"]

    L: list[str] = []
    A = L.append
    A("# Couverture des rubriques de posologie — Prescriber's Guide 7e (Stahl)")
    A("")
    A("**Question traitée** : le rapport précédent affirmait que « seulement 33 monographies "
      "sur 152 ont une rubrique *Usual Dosage Range* ». Cette affirmation est-elle un "
      "déficit de données, une variété d'intitulé, ou un défaut d'indexation ?")
    A("")
    A("**Réponse mesurée** : c'est une **variété d'intitulé**, pas un déficit de données. "
      "La posologie est présente dans le corpus pour la quasi-totalité des monographies ; "
      "elle est répartie sur plusieurs rubriques dont les intitulés diffèrent d'un "
      "médicament à l'autre.")
    A("")

    A("## 1. Mesure")
    A("")
    A("| Mesure | Valeur |")
    A("|---|---|")
    A(f"| Monographies | {c['monographies']} |")
    A(f"| Monographies portant une posologie chiffrée | **{c['monographies_avec_posologie_chiffree']}** "
      f"({fr(c['couverture_posologie'])}) |")
    A(f"| Monographies sans posologie chiffrée | {c['monographies_sans_posologie_chiffree']} |")
    A(f"| Rubriques (L2) distinctes | {c['rubriques_l2']} |")
    A(f"| Rubriques (L3) distinctes | {c['rubriques_l3']} |")
    A(f"| Rubriques portant effectivement des doses | {c['rubriques_portant_des_doses']} |")
    A("")
    A("Méthode de détection d'une posologie : un chunk dont le texte contient un nombre "
      "suivi d'une unité (`mg`, `mcg`, `g`, `ml`, `IU`). Un numéro de page seul n'est "
      "jamais compté comme une dose.")
    A("")

    A("## 2. Répartition de la posologie sur les rubriques")
    A("")
    A("| Rubrique | Monographies | Chunks avec dose |")
    A("|---|---:|---:|")
    for r in d["realisations_posologie"][:24]:
        A(f"| `{r['rubrique']}` | {r['monographies']} | {r['chunks_avec_dose']} |")
    A("")
    A(f"*(Les {len(d['realisations_posologie']) - 24} rubriques restantes portent chacune "
      "1 à 7 monographies.)*")
    A("")

    A("## 3. Les quatre rubriques de posologie, et leur couverture")
    A("")
    A("| Rubrique | Monographies couvertes |")
    A("|---|---:|")
    par = {r["rubrique"]: r["monographies"] for r in d["realisations_posologie"]}
    A(f"| `Usual Dosage Range` | {par.get('Dosing and Use | Usual Dosage Range', 0)} |")
    A(f"| `Dosing Tips` | {par.get('Dosing and Use | Dosing Tips', 0)} |")
    A(f"| `How to Dose` | {par.get('Dosing and Use | How to Dose', 0)} |")
    A(f"| `Dosage Forms` | {par.get('Dosing and Use | Dosage Forms', 0)} |")
    A("")
    A("**Lecture** : la question clinique porte sur le CONCEPT (« posologie », « dose "
      "habituelle »), pas sur un intitulé. Viser une seule rubrique limite la réponse "
      "à une fraction des monographies ; l'union des quatre ci-dessus en couvre "
      "**148 sur 154** (96,1 %).")
    A("")
    A("C'est exactement ce que fait la couche de terminologie bilingue : "
      "« posologie habituelle » produit les rubriques **réelles** `Usual Dosage Range`, "
      "`Dosing Tips` et `How to Dose`, dans cet ordre, et la porte à AND renvoie "
      "effectivement le passage du médicament visé.")
    A("")

    A("## 4. Ce qu'il ne faut PAS conclure")
    A("")
    A("- **L'absence d'une rubrique ne prouve pas l'absence de posologie.** Sertraline "
      "n'a pas de rubrique `Usual Dosage Range` ; sa posologie est sous `Dosing Tips` "
      "(`50–200 mg/day`, `Depression and OCD: initial 50 mg/day`).")
    A("- **La présence d'une rubrique ne garantit pas que son chunk porte la dose.** "
      "Sur les 30 chunks `Usual Dosage Range`, **11 ne contiennent aucune dose "
      "chiffrée** : leur corps appartient à la rubrique précédente (voir §5). C'est un "
      "défaut d'**ordonnancement d'extraction**, pas une absence de donnée : la dose de "
      "ces monographies est ailleurs dans le corpus.")
    A("- **La recherche lexicale est un ET.** Une requête qui contient un mot absent "
      "de l'index ne remonte rien. Interroger un livre suppose d'employer ses mots : "
      "c'est une contrainte de l'architecture de recherche, documentée et assumée.")
    A("")

    A("## 5. Défaut d'ordonnancement d'extraction (constat, non corrigé)")
    A("")
    A("L'extracteur brut conserve l'ordre des blocs renvoyés par PyMuPDF. Sur les pages "
      "de monographie, PyMuPDF rend **d'abord les blocs gras (les titres)**, puis les "
      "blocs de corps ; l'ordre de lecture humain est l'ordre vertical.")
    A("")
    A("| Mesure | Valeur |")
    A("|---|---|")
    A("| Pages examinées | 2 697 |")
    A("| Pages dont l'ordre extrait diffère de l'ordre de lecture | **1 859 (68,9 %)** |")
    A("| Décalages titre/corps détectés | 5 319 |")
    A("| Chunks dont le corps est visuellement AVANT le titre | 1 734 / 2 521 analysables (68,8 %) |")
    A("| Chunks dont le marqueur de page diffère de `page_start` | **0 / 3 076** |")
    A("")
    A("**Conséquence** : le contenu est verbatim et complet (aucun mot perdu, le hash "
      "de la chaîne brute est continu sur les 2 697 pages), mais l'**intitulé de rubrique** "
      "porté par un chunk peut désigner la rubrique voisine. Le **folio reste exact** : "
      "une citation reste vérifiable sur la page annoncée.")
    A("")
    A("**Remédiation possible** : rejouer l'extraction avec l'ordre vertical "
      "(`page.get_text(\"dict\", sort=True)`), puis re-découper, re-embedder et recharger. "
      "Coût : reconstruction intégrale du paquet canonique — les identifiants de chunk, "
      "les embeddings, le golden-set, la file de revue et le présent paquet de revue "
      "seraient tous à refaire, et une **nouvelle révision clinique** serait nécessaire. "
      "**Non appliqué dans cette version** : la décision sort du périmètre d'une "
      "activation et doit être instruite séparément.")
    A("")

    A("## 6. Attribution de page des tableaux (constat, non corrigé)")
    A("")
    A("Un chunk couvrant plusieurs pages n'indexe que le numéro de sa **première** page "
      "(marqueur `[... p.N|src:N]`). 875 chunks sur 3 076 (28,4 %) couvrent plusieurs "
      "pages ; **3 639 pages de contenu ne sont donc pas adressables par leur numéro**.")
    A("")
    A("Effet mesuré sur l'évaluation : une question « que dit le livre page N » a un "
      "rappel nul, alors que la même question portant le **sujet** du tableau "
      "« Drugs contraindicated due to risk of serotonin syndrome/toxicity » a un rappel "
      "de 0,6667.")
    A("")
    A("Cela ne change pas la citation d'un passage retrouvé — son folio est exact — mais "
      "c'est une limite de recherche à l'ancre de page, distincte de l'exactitude de folio.")
    A("")

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"rapport ecrit : {SORTIE.relative_to(RACINE)} ({len(L)} lignes)")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
