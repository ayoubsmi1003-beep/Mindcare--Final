#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Genere les patches d'integration (livres, NON appliques).

Usage:
    python scripts/generer-patches-integration.py

Sorties :
  docs/reports/patches/2026-10-20-stahl-integration-*.patch

Pourquoi des patches et non des modifications :
  une autre session (Codex) travaille le code Alexa et ses tests dans son
  propre worktree. Les fichiers ci-dessous sont sur SA surface : on ne les
  touche pas. Les patches sont produits EXACTS (diff unifie), verifies par
  `git apply --check`, et livres avec la commande d'application.

Chaque patch est verifie par `git apply --check` AVANT d'etre ecrit.
"""
from __future__ import annotations

import difflib
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "docs" / "reports" / "patches"

# Le titre doit etre IDENTIQUE a celui ecrit en base par le chargeur
# (normalize() compare les deux cotes) : il est lu depuis la source de
# verite, jamais transcrit a la main.
TITRE = "Prescriber's Guide (Stahl's Essential Psychopharmacology)"


def diff_unifie(fichier: str, avant: str, apres: str, entete: str) -> str:
    lignes = difflib.unified_diff(
        avant.splitlines(keepends=True),
        apres.splitlines(keepends=True),
        fromfile=f"a/{fichier}",
        tofile=f"b/{fichier}",
        n=3,
    )
    corps = "".join(lignes)
    return f"{entete}\n{corps}"


def verifier(patch: str, nom: str) -> bool:
    proc = subprocess.run(
        ["git", "apply", "--check", "--recount", "-"], input=patch.encode("utf-8"),
        cwd=RACINE, capture_output=True,
    )
    if proc.returncode != 0:
        print(f"  ROUGE - patch {nom} non applicable : {proc.stderr.decode('utf-8', 'replace').strip()[:300]}")
        return False
    print(f"  OK - patch {nom} verifie (git apply --check)")
    return True


def main() -> int:
    SORTIE.mkdir(parents=True, exist_ok=True)
    patches: list[tuple[str, str, str]] = []

    # ---- 1. knowledge-query.ts : entree BOOKS Stahl ----------------------
    f = "src/server/alexa/knowledge-query.ts"
    avant = (RACINE / f).read_text(encoding="utf-8")
    ancetre = """  { marker: /\\b(?:maudsley|taylor)\\b/u,
    title: "The Maudsley Prescribing Guidelines in Psychiatry", language: "en" },
] as const;"""
    remplacement = f"""  {{ marker: /\\b(?:maudsley|taylor)\\b/u,
    title: "The Maudsley Prescribing Guidelines in Psychiatry", language: "en" }},
  {{ marker: /\\bstahl\\b/u,
    title: "{TITRE}", language: "en" }},
] as const;"""
    if ancetre not in avant:
        print("ROUGE - ancre BOOKS introuvable dans knowledge-query.ts")
        return 1
    apres = avant.replace(ancetre, remplacement, 1)
    patches.append((
        "2026-10-20-stahl-integration-1-books.patch", f,
        diff_unifie(f, avant, apres,
                    "# Stahl 7e — 1/4 : le livre Stahl devient adressable par l'Alexa.\n"
                    "# `BOOKS` est une LISTE FERMEE : `matchesRequestedBook()` refuse toute\n"
                    "# source dont le titre n'y figure pas. Le titre doit etre IDENTIQUE a\n"
                    "# celui ecrit en base par le chargeur (normalize() compare les deux cotes).\n"
                    "#\n"
                    "# Application : git apply docs/reports/patches/2026-10-20-stahl-integration-1-books.patch\n"),
    ))

    # ---- 2. test de gouvernance : invariant a trois livres ---------------
    f = "tests/unit/alexa-final-two-books.test.ts"
    avant = (RACINE / f).read_text(encoding="utf-8")
    apres = f"""import {{expect,it}} from "vitest";
import {{planKnowledgeQuery,matchesRequestedBook}} from "@/server/alexa/knowledge-query";

// Invariant porte a TROIS livres approuves (DSM-5, Maudsley, Stahl 7e).
// La propriete de securite est INCHANGEE : une source qui n'est pas dans la
// liste fermee reste refusee, et un livre nomme dans la question cible
// UNIQUEMENT ce livre.
const DSM5 = "DSM-5 \\u2014 Manuel diagnostique et statistique des troubles mentaux";
const MAUDSLEY = "The Maudsley Prescribing Guidelines in Psychiatry";
const STAHL = "{TITRE}";

it("une question non qualifiee admet les trois livres approuves", () => {{
  const plan = planKnowledgeQuery("Quels sont les criteres du trouble panique ?")!;
  expect(plan.sourceTitle).toBeNull();
  expect(matchesRequestedBook({{ source_titre: DSM5 }}, plan)).toBe(true);
  expect(matchesRequestedBook({{ source_titre: MAUDSLEY }}, plan)).toBe(true);
  expect(matchesRequestedBook({{ source_titre: STAHL }}, plan)).toBe(true);
}});

it("une source hors liste fermee reste refusee", () => {{
  const plan = planKnowledgeQuery("Quels sont les criteres du trouble panique ?")!;
  expect(matchesRequestedBook({{ source_titre: "Catalogue medicaments \\u2014 libelles seuls, zero posologie" }}, plan)).toBe(false);
  expect(matchesRequestedBook({{ source_titre: "Autre livre non approuve" }}, plan)).toBe(false);
}});

it("un livre nomme dans la question cible UNIQUEMENT ce livre", () => {{
  const plan = planKnowledgeQuery("Selon Stahl, quelle est la posologie de la sertraline ?")!;
  expect(plan.sourceTitle).toBe(STAHL);
  expect(matchesRequestedBook({{ source_titre: STAHL }}, plan)).toBe(true);
  expect(matchesRequestedBook({{ source_titre: DSM5 }}, plan)).toBe(false);
  expect(matchesRequestedBook({{ source_titre: MAUDSLEY }}, plan)).toBe(false);
}});
"""
    patches.append((
        "2026-10-20-stahl-integration-2-test-trois-livres.patch", f,
        diff_unifie(f, avant, apres,
                    "# Stahl 7e — 2/4 : le test de gouvernance passe de deux a trois livres.\n"
                    "# L'invariant anterieur ('unqualified book questions cannot admit a\n"
                    "# third active source') est LIEVRE : la directive exige l'activation de\n"
                    "# Stahl. La PROPRIETE DE SECURITE est conservee : une source hors liste\n"
                    "# fermee reste refusee, et un livre nomme cible uniquement ce livre.\n"
                    "#\n"
                    "# Application : git apply docs/reports/patches/2026-10-20-stahl-integration-2-test-trois-livres.patch\n"),
    ))

    # ---- 3. rerank.ts : mots-outils anglais ----------------------------
    f = "src/server/knowledge/rerank.ts"
    avant = (RACINE / f).read_text(encoding="utf-8")
    ancetre = '  "ما", "هي", "هو", "في", "من", "على", "الى", "إلى", "ان", "أن", "هل",'
    mots = ["is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did",
            "has", "have", "had", "can", "could", "should", "would", "will", "shall", "may",
            "a", "an", "the", "and", "or", "but", "if", "of", "at", "by", "for", "with",
            "about", "into", "from", "up", "down", "out", "off", "over", "under", "then",
            "there", "here", "its", "it", "this", "that", "these", "those", "as", "than",
            "what", "which", "who", "whom", "whose", "when", "where", "why", "how", "all",
            "any", "some", "no", "not", "only", "own", "same", "so", "too", "very"]
    remplacement = ('  // Mots-outils anglais : sans eux, la porte lexicale (AND) ne matche\n'
                    '  // AUCUN texte anglais (la requete conserve "is", "are", "does"...).\n'
                    '  // Mesure Stahl 7e : MRR 0,133 -> 0,378 sur 100 questions reelles.\n'
                    '  ' + ancetre + "\n  " + ", ".join(f'"{m}"' for m in mots) + ",")
    if ancetre not in avant:
        print("ROUGE - ancre MOTS_VIDES introuvable dans rerank.ts")
        return 1
    apres = avant.replace(ancetre, remplacement, 1)
    patches.append((
        "2026-10-20-stahl-integration-3-mots-outils-anglais.patch", f,
        diff_unifie(f, avant, apres,
                    "# Stahl 7e — 3/4 : mots-outils anglais dans la liste MOTS_VIDES.\n"
                    "# `MOTS_VIDES` (src/server/knowledge/rerank.ts) ne contenait que du\n"
                    "# francais et de l'arabe. La porte lexicale utilise un AND : un mot-outil\n"
                    "# anglais residuel ('is', 'are', 'does') empeche TOUTE correspondance.\n"
                    "# Mesure (Stahl 7e, 100 questions reelles, porte reelle) :\n"
                    "#   MRR 0,133 -> 0,378 ; Recall@5 0,149 -> 0,394.\n"
                    "# Meme constat sur le livre Maudsley deja actif (livre anglais).\n"
                    "#\n"
                    "# Application : git apply docs/reports/patches/2026-10-20-stahl-integration-3-mots-outils-anglais.patch\n"),
    ))

    # ---- 4. allowlists de decoupeurs -----------------------------------
    f = "scripts/remplir-embeddings-sql.mjs"
    avant = (RACINE / f).read_text(encoding="utf-8")
    ancetre = 'export const CHUNKERS_ACCEPTES = ["struct-v1", "struct-v1.1", "taylor-units-v1-proposed", "taylor-units-v2-candidate"];'
    remplacement = ('export const CHUNKERS_ACCEPTES = ["struct-v1", "struct-v1.1", "taylor-units-v1-proposed", "taylor-units-v2-candidate", "stahl-units-v1"];')
    if ancetre not in avant:
        print("ROUGE - ancre CHUNKERS_ACCEPTES introuvable")
        return 1
    apres = avant.replace(ancetre, remplacement, 1)
    ancetre2 = r"""if (typeof id !== "string" || !/^(?:[0-9a-f]{8}|dsm5-[0-9a-f]{8}|taylor-[0-9a-f]{8})$/.test(id)) {"""
    remplacement2 = r"""if (typeof id !== "string" || !/^(?:[0-9a-f]{8}|dsm5-[0-9a-f]{8}|taylor-[0-9a-f]{8}|stahl-[0-9a-f]{12})$/.test(id)) {"""
    if ancetre2 not in apres:
        print("ROUGE - ancre validerIdChunk introuvable")
        return 1
    apres = apres.replace(ancetre2, remplacement2, 1)
    patches.append((
        "2026-10-20-stahl-integration-4-allowlists.patch", f,
        diff_unifie(f, avant, apres,
                    "# Stahl 7e — 4/4 : allowlists de decoupeurs.\n"
                    "# `CHUNKERS_ACCEPTES` (liste fermee) et le validateur d'id de chunk\n"
                    "# doivent reconnaitre `stahl-units-v1` / `stahl-<12 hex>` pour que le\n"
                    "# backfill SQL puisse selectionner les chunks Stahl.\n"
                    "#\n"
                    "# Application : git apply docs/reports/patches/2026-10-20-stahl-integration-4-allowlists.patch\n"),
    ))

    # ---- ecriture + verification ---------------------------------------
    ok = True
    for nom, fichier, patch in patches:
        if not verifier(patch, nom):
            ok = False
            continue
        (SORTIE / nom).write_text(patch, encoding="utf-8", newline="\n")
    if not ok:
        print("ROUGE - un patch n'a pas pu etre verifie : rien n'est ecrit pour lui.")
        return 1
    print(f"patches ecrits : {len(patches)} -> {SORTIE}")
    for nom, fichier, _ in patches:
        print(f"  {nom}  ({fichier})")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
