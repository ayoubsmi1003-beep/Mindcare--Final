#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — DIAGNOSTIC DU GAP DE VOCABULAIRE (pourquoi la porte AND echoue).

Usage :
    python scripts/knowledge-stahl-diagnostic-vocabulaire.py

Sortie :
    knowledge/eval/stahl-bilingue-v1.gap.json

CE QUE C'EST
    La porte lexicale est un ET (`plainto_tsquery` = AND). UN SEUL terme absent
    du corpus annule TOUTE la requete. Ce script mesure, pour chaque question
    du corpus d'evaluation, quels termes de la requete planifiee sont ABSENTS
    de l'index du corpus, et les regroupe.

    Sortie : la liste des termes qui tuent le recall, avec leur frequence
    dans le corpus (0 = jamais present).

Ce diagnostic ne modifie AUCUN artefact : il constate et il propose.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")
CORPUS = RACINE / "knowledge" / "eval" / "stahl-bilingue-v1.json"
SORTIE = RACINE / "knowledge" / "eval" / "stahl-bilingue-v1.gap.json"
SOURCE_UUID = "d71587f1-3bf3-5d82-81cf-e40d77dbcfa0"

# Mots-outils de la QUESTION (scaffold) — memes que `SCAFFOLD` du planificateur.
SCAFFOLD = {
    "quels", "quelles", "comment", "explique", "expliquer", "parle", "parler", "dit", "dis", "dire",
    "montre", "selon", "apres", "livre", "livres", "ouvrage", "manuel", "references", "reference",
    "sources", "source", "difference", "compare", "comparer", "entre", "chez",
    "what", "which", "how", "explain", "tell", "says", "according", "to", "the", "of", "in", "and", "book",
}


def main() -> int:
    # 1. index des termes du corpus (source Stahl) ------------------------------
    sql = f"""SET default_transaction_read_only=on;
SELECT w || '~#' || count(*)::int AS terme_nb
FROM app.knowledge_chunks c, LATERAL unnest(tsvector_to_array(c.document_tsv)) AS w
WHERE c.source_id='{SOURCE_UUID}'::uuid
GROUP BY w;"""
    tmp = RACINE / ".tmp-gap.sql"
    tmp.write_text(sql, encoding="utf-8")
    subprocess.run(["docker", "cp", str(tmp), "mc-p3:/tmp/gap.sql"], check=True)
    r = subprocess.run(["docker", "exec", "mc-p3", "psql", "-U", "postgres", "-d", "mindcare",
                        "-qAt", "-f", "/tmp/gap.sql"], capture_output=True, text=True, encoding="utf-8")
    index: dict[str, int] = {}
    # Le separateur par defaut de psql -qAt est "|" ; un terme peut contenir
    # "|" (le marqueur de page "[book p.X|src:Y]") : on impose donc un
    # separateur improbable et on coupe sur le DERNIER.
    for ligne in r.stdout.splitlines():
        if "~#" not in ligne:
            continue
        terme, nb = ligne.rsplit("~#", 1)
        index[terme.strip()] = int(nb.strip())
    tmp.unlink(missing_ok=True)
    print(f"index du corpus Stahl : {len(index)} termes distincts")

    # 2. requetes planifiees du corpus d'evaluation ---------------------------
    corpus = json.loads(CORPUS.read_text(encoding="utf-8"))
    detail = json.loads((RACINE / "knowledge" / "eval" / "stahl-bilingue-v1.resultat.json").read_text(encoding="utf-8"))
    plan_requetes: dict[str, list[str]] = {}
    for r in detail.get("detail", []):
        if r.get("plan_requetes"):
            plan_requetes[r["id"]] = r["plan_requetes"]

    # 3. termes absents -------------------------------------------------------
    absents: Counter[str] = Counter()
    absents_par_classe: dict[str, Counter[str]] = defaultdict(Counter)
    questions_touees: dict[str, list[str]] = {}
    for q in corpus["questions"]:
        rid = q["id"]
        if rid not in plan_requetes:
            continue
        questions_touees[rid] = plan_requetes[rid]
        manquants = set()
        for requete in plan_requetes[rid]:
            for terme in requete.split():
                if terme in SCAFFOLD:
                    continue
                if index.get(terme, 0) == 0:
                    manquants.add(terme)
        if manquants:
            absents.update(manquants)
            absents_par_classe[q["classe"]].update(manquants)

    rapport = {
        "methode": {
            "index": "tsvector du corpus Stahl (2677 chunks inactifs)",
            "regle": "la porte est un ET : un seul terme absent annule la requete",
            "scaffold_exclu": sorted(SCAFFOLD),
        },
        "termes_absents": [
            {"terme": t, "questions": n} for t, n in absents.most_common()
        ],
        "absents_par_classe": {c: dict(v.most_common()) for c, v in sorted(absents_par_classe.items())},
        "questions_avec_terme_absent": sum(1 for rid, qs in questions_touees.items()
                                           if any(t in absents for q in qs for t in q.split())),
        "questions_analysees": len(questions_touees),
    }
    SORTIE.write_text(json.dumps(rapport, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"questions analysees : {rapport['questions_analysees']}")
    print(f"questions bloquees par un terme absent : {rapport['questions_avec_terme_absent']}")
    print("\ntermes absents du corpus (par frequence de blocage) :")
    for t, n in absents.most_common(30):
        print(f"  {n:>4}  {t!r}")
    print(f"\nrapport : {SORTIE.relative_to(RACINE)}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
