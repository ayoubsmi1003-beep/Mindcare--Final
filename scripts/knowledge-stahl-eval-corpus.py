#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — CORPUS D'EVALUATION BILINGUE (versionne, reproductible).

Usage :
    python scripts/knowledge-stahl-eval-corpus.py

Sortie :
    knowledge/eval/stahl-bilingue-v1.json

CE QUE C'EST
    Un corpus de questions REALES, derivé des artefacts canoniques, couvrant
    les classes exigees par le cahier des charges M3.2 :
      A. questions de contenu en anglais ;
      B. questions cliniques completes en francais ;
      C. questions francaises (medicament + sujet clinique) ;
      D. requetes reduites au seul nom du medicament ;
      E. synonymes, variantes d'orthographe, differences FR/EN ;
      F. questions ciblant tableaux, figures, posologie, contre-indications,
         effets indesirables ;
      G. questions sans reponse (abstention) ;
      H. requetes qui doivent repondre depuis UNE AUTRE SOURCE active, sans
         attribution erronee a Stahl.

Chaque entree porte l'ATTENDU (chunk / unite / page) et le DROIT de reponse
(source attendue) : une reponse venue d'une autre source est notee
`attribution_incorrecte`, jamais comptee comme un succes.

Aucune question n'est inventee : les medicaments, rubriques, pages et
fragments viennent des artefacts (unites, tables, figures, golden-set).

Version : le fichier porte son numero de version ; toute evolution le
incremente (la comparaison baseline/final doit porter sur LE MEME corpus).
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
SORTIE = RACINE / "knowledge" / "eval" / "stahl-bilingue-v1.json"

# Les trois sources actives reelles (meme libelles que app.knowledge_sources).
TITRE_STAHL = "Prescriber's Guide (Stahl's Essential Psychopharmacology)"
TITRE_MAUDSLEY = "The Maudsley Prescribing Guidelines in Psychiatry"
TITRE_DSM = "DSM-5 — Manuel diagnostique et statistique des troubles mentaux"


def lire_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").split("\n") if l.strip()]


def parties(section: str) -> list[str]:
    return [p.strip() for p in section.split("›")]


def main() -> int:
    unites = lire_jsonl(DOSSIER / "units.jsonl")
    chunks = lire_jsonl(DOSSIER / "chunks-v2.jsonl")
    golden = lire_jsonl(DOSSIER / "golden-set.jsonl")
    tables = lire_jsonl(DOSSIER / "tables.jsonl")
    figures = lire_jsonl(DOSSIER / "figures.jsonl")

    if not unites or not chunks:
        print("artefacts canoniques introuvables", file=sys.stderr)
        return 1

    par_unite = {u["id"]: u for u in unites}
    chunk_par_unite: dict[str, list[dict]] = defaultdict(list)
    for c in chunks:
        if c.get("unit_id"):
            chunk_par_unite[c["unit_id"]].append(c)

    # unites par (monographie, L2 NORMALISE, L3) avec leur page.
    # `units.jsonl` conserve le chemin BRUT (variantes de casse) ; la clef
    # d'index normalisee est dans les chunks (`section`). On indexe donc par
    # le chemin brut, et on compare les L3 sans tenir compte de la casse.
    unites_par_clef: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for u in unites:
        chemin = u.get("structural_path") or []
        if len(chemin) >= 3:
            unites_par_clef[(chemin[0], chemin[1].casefold(), chemin[2].casefold())].append(u)

    # L2 normalise -> unites, pour repondre a « ou est cette rubrique ? »
    unites_par_l2_l3: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for u in unites:
        chemin = u.get("structural_path") or []
        if len(chemin) >= 3:
            unites_par_l2_l3[(chemin[1].casefold(), chemin[2].casefold())].append(u)

    questions: list[dict] = []
    n = 0

    def ajouter(**kw) -> None:
        nonlocal n
        n += 1
        kw["id"] = f"stahl7-b{n:04d}"
        questions.append(kw)

    # ── A + B + C : le golden-set fournit les paires EN/FR verifiees ───────
    for g in golden:
        if g["kind"] == "sans-reponse":
            ajouter(
                classe="G_sans_reponse", question=g["question"], question_fr=None,
                source_attendue=None, chunks_attendus=g.get("expected_chunk_ids", []),
                unites_attendues=g.get("expected_unit_ids", []),
                page_attendue=g.get("expected_source_page"), printed_page=g.get("expected_printed_page"),
                section_attendue=g.get("expected_section"),
                note="cas sans-reponse du golden-set : le livre ne repond pas",
            )
            continue
        attendu = {
            "source_attendue": TITRE_STAHL,
            "chunks_attendus": g.get("expected_chunk_ids", []),
            "unites_attendues": g.get("expected_unit_ids", []),
            "page_attendue": g.get("expected_source_page"),
            "printed_page": g.get("expected_printed_page"),
            "section_attendue": g.get("expected_section"),
        }
        ajouter(classe="A_contenu_en", question=g["question"], question_fr=None, **attendu,
                note="golden-set : question de contenu (anglais)")
        if g.get("requete_fr"):
            ajouter(classe="B_fr_complete", question=g["question"], question_fr=g["requete_fr"], **attendu,
                    note="golden-set : meme question posee en francais")
            # C : francais, medicament + sujet clinique (on retire la formule)
            fr = g["requete_fr"]
            sujet = re.sub(r"^\s*Quelle\s+est\s+la\s+", "", fr, flags=re.I)
            sujet = re.sub(r"^\s*Comment\s+dose-t-on\s+", "", sujet, flags=re.I)
            sujet = re.sub(r"^\s*Quels\s+sont\s+les\s+", "", sujet, flags=re.I)
            sujet = re.sub(r"^\s*pour\s+", "", sujet, flags=re.I)
            sujet = sujet.replace(" ?", "").strip()
            if sujet and sujet != fr.strip(" ?"):
                ajouter(classe="C_fr_sujet", question=g["question"], question_fr=f"{sujet} ?", **attendu,
                        note="francais, sujet clinique + medicament (formule reduite)")

    # ── D : nom du medicament seul ─────────────────────────────────────────
    for g in golden:
        if g["kind"] == "sans-reponse" or not g.get("drug"):
            continue
        ajouter(
            classe="D_nom_seulement", question=f"{g['drug']} ?", question_fr=f"{g['drug']} ?",
            source_attendue=TITRE_STAHL,
            chunks_attendus=g.get("expected_chunk_ids", []),
            unites_attendues=g.get("expected_unit_ids", []),
            page_attendue=g.get("expected_source_page"), printed_page=g.get("expected_printed_page"),
            section_attendue=g.get("expected_section"),
            note="repli realiste : le nom du medicament seul",
        )

    # ── E : synonymes / variantes / differences FR-EN ──────────────────────
    variantes = [
        ("doses usuelles", "usual dosage range", "Dosing and Use"),
        ("conseils de posologie", "dosing tips", "Dosing and Use"),
        ("effets indesirables", "side effects", "Side Effects"),
        ("contre indications", "do not use", "Dosing and Use"),
        ("interactions medicamenteuses", "drug interactions", "Dosing and Use"),
        ("surdosage", "overdose", "Dosing and Use"),
        ("grossesse", "pregnancy", "Special Populations"),
        ("allaitement", "breast feeding", "Special Populations"),
        ("insuffisance renale", "renal impairment", "Special Populations"),
        ("mechanismisme d action", "how the drug works", "Therapeutics"),
        ("delai d action", "how long until it works", "Therapeutics"),
        ("indications", "commonly prescribed for", "Therapeutics"),
        ("precautions", "other warnings/precautions", "Dosing and Use"),
        ("arret du traitement", "how to stop", "Dosing and Use"),
        ("pharmacocinetique", "pharmacokinetics", "Dosing and Use"),
        ("formes pharmaceutiques", "dosage forms", "Dosing and Use"),
    ]
    for fr_terme, en_rubrique, l2 in variantes:
        # une monographie reellement concernee, de facon deterministe
        candidates_u = unites_par_l2_l3.get((l2.casefold(), en_rubrique.casefold()), [])
        if not candidates_u:
            continue
        u = sorted(candidates_u, key=lambda x: x["id"])[0]
        chemin = u.get("structural_path") or []
        cle = (chemin[0], chemin[1], chemin[2])
        ch = chunk_par_unite.get(u["id"], [])
        ajouter(
            classe="E_synonyme", question=f"What does the {en_rubrique} section say about {cle[0]}?",
            question_fr=f"Que dit la section {fr_terme} de {cle[0]} ?",
            source_attendue=TITRE_STAHL,
            chunks_attendus=[c["chunk_id"] for c in ch],
            unites_attendues=[u["id"]],
            page_attendue=u.get("page_start"), printed_page=str(u.get("page_start")),
            section_attendue=f"{cle[0]} › {cle[1]} › {cle[2]}",
            note=f"synonyme FR/EN mesure : « {fr_terme} » ↔ rubrique « {en_rubrique} »",
        )

    # ── F : tableaux, figures, posologie, contre-indications, effets ────────
    # Les tableaux ne sont pas lies a une unite (les `units` sont vides) : on
    # cible la PAGE qui porte le tableau et on attend le passage qui parle de
    # la table. Le DROIT de reponse reste Stahl ; l'exactitude se mesure sur la
    # page (comme le golden-set).
    # un chunk COUVRE la page s'il la contient (page_start..page_end)
    chunks_par_page: dict[int, list[dict]] = defaultdict(list)
    for c in chunks:
        debut = c.get("page_start")
        fin = c.get("page_end") or debut
        if debut is None:
            continue
        for page in range(int(debut), int(fin) + 1):
            chunks_par_page[page].append(c)
    for tb in tables:
        page = int(tb["page_start"])
        candidats = chunks_par_page.get(page, [])
        if not candidats:
            continue
        chunks_attendus = [c["chunk_id"] for c in candidats]
        unites_attendues = sorted({c["unit_id"] for c in candidats if c.get("unit_id")})
        # 1. question par le SUJET du tableau (requete realiste : c'est ce
        #    qu'un clinicien pose). Le contenu du tableau est dans le texte
        #    indexe -> la porte peut repondre.
        sujet = str(tb.get("title") or "")
        if sujet:
            ajouter(
                classe="F_tableau_contenu",
                question=f"What does the book say about {sujet}?",
                question_fr=f"Que dit le livre sur {sujet} ?",
                source_attendue=TITRE_STAHL,
                chunks_attendus=chunks_attendus,
                unites_attendues=unites_attendues,
                page_attendue=page, printed_page=str(tb["printed_page_start"]),
                section_attendue=candidats[0].get("section"),
                note=f"tableau canonique {tb['label']} (p.{tb['printed_page_start']}) "
                     f"interroge par son SUJET : « {sujet} »",
            )
        # 2. question par le NUMERO DE PAGE seul — MESURE DE LIMITE, pas un
        #    objectif de performance : le marqueur de page n'existe que dans le
        #    TEXTE du chunk, et un chunk couvrant plusieurs pages n'en porte
        #    qu'UN (sa premiere). Une question sans terme de contenu n'a pas
        #    de raison de repondre juste.
        ajouter(
            classe="F_tableau_page",
            question=f"What does the book say on page {tb['printed_page_start']}?",
            question_fr=f"Que dit le livre a la page {tb['printed_page_start']} ?",
            source_attendue=TITRE_STAHL,
            chunks_attendus=chunks_attendus,
            unites_attendues=unites_attendues,
            page_attendue=page, printed_page=str(tb["printed_page_start"]),
            section_attendue=candidats[0].get("section"),
            note=f"tableau canonique {tb['label']} (p.{tb['printed_page_start']}) "
                 f"interroge par sa PAGE seule (mesure de limite)",
        )

    for critere, l3 in (("posologie", "Usual Dosage Range"), ("contre-indications", "Do Not Use"),
                        ("effets indesirables", "Notable Side Effects"),
                        ("effets indesirables graves", "Life-Threatening or Dangerous Side Effects")):
        candidates_u = sorted(unites_par_l2_l3.get(("dosing and use", l3.casefold()), [])
                              + unites_par_l2_l3.get(("side effects", l3.casefold()), [])
                              + unites_par_l2_l3.get(("therapeutics", l3.casefold()), []),
                              key=lambda x: x["id"])
        for u in candidates_u[:6]:
            chemin = u.get("structural_path") or []
            cle = (chemin[0], chemin[1], chemin[2])
            ch = chunk_par_unite.get(u["id"], [])
            ajouter(
                classe="F_cible", question=f"What is the {l3} section of {cle[0]}?",
                question_fr=f"Que dit la rubrique {critere} de {cle[0]} ?",
                source_attendue=TITRE_STAHL,
                chunks_attendus=[c["chunk_id"] for c in ch],
                unites_attendues=[u["id"]],
                page_attendue=u.get("page_start"), printed_page=str(u.get("page_start")),
                section_attendue=f"{cle[0]} › {cle[1]} › {cle[2]}",
                note=f"cible : rubrique « {l3} » de {cle[0]}",
            )

    # ── H : reponse attendue depuis UNE AUTRE source active ────────────────
    # (les questions francaises de diagnostic doivent repondre par le DSM-5,
    #  pas par Stahl : une attribution erronee doit etre detectee)
    for g in golden:
        if g["kind"] != "section":
            continue
        l2 = g.get("l2")
        if l2 != "Dosing and Use" and l2 != "Side Effects":
            continue
    # questions DSM-5 explicites (critères diagnostiques) : source attendue DSM
    dsm = [
        ("Quels sont les critères diagnostiques du trouble dépressif caractérisé ?",
         "critères diagnostiques du trouble dépressif caractérisé", "trouble dépressif caractérisé"),
        ("Quels sont les critères du trouble panique ?", "critères du trouble panique", "trouble panique"),
        ("Quels sont les critères du trouble obsessionnel compulsif ?",
         "critères du trouble obsessionnel compulsif", "trouble obsessionnel compulsif"),
    ]
    for question, _motif, cible in dsm:
        ajouter(
            classe="H_autre_source", question=question, question_fr=question,
            source_attendue=TITRE_DSM,
            chunks_attendus=[], unites_attendues=[],
            page_attendue=None, printed_page=None, section_attendue=None,
            note=f"attribution : la reponse attendue vient du DSM-5 ({cible}), pas de Stahl",
        )

    # --- ecriture -----------------------------------------------------------
    par_classe = Counter(q["classe"] for q in questions)
    rapport = {
        "corpus": "stahl-bilingue-v1",
        "version": 1,
        "livre": BOOK_ID,
        "source_version": VERSION,
        "genere_par": "scripts/knowledge-stahl-eval-corpus.py",
        "methode": {
            "source": "artefacts canoniques (units.jsonl, chunks-v2.jsonl, golden-set.jsonl, tables.jsonl)",
            "questions_inventes": "aucune : medicaments, rubriques, pages et fragments viennent des artefacts",
            "attribution": "source_attendue designe la source qui DOIT porter la reponse ; "
                           "une reponse d'une autre source est notee attribution_incorrecte",
        },
        "classes": dict(sorted(par_classe.items())),
        "totaux": {
            "questions": len(questions),
            "avec_reponse": sum(1 for q in questions if q["source_attendue"] is not None),
            "sans_reponse": sum(1 for q in questions if q["source_attendue"] is None),
            "autre_source": sum(1 for q in questions if q["source_attendue"] == TITRE_DSM),
        },
        "questions": questions,
    }
    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text(json.dumps(rapport, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"corpus ecrit : {SORTIE.relative_to(RACINE)}")
    print(f"  questions : {len(questions)}")
    for k, v in sorted(par_classe.items()):
        print(f"    {k:20} {v}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
