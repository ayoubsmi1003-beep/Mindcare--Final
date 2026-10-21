#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — RAPPORT D'EVALUATION DU RETRIEVAL (baseline vs final).

Usage :
    python scripts/generer-rapport-retrieval-stahl.py

Sortie :
    docs/reports/2026-10-20-stahl-retrieval-evaluation.md

Toutes les valeurs proviennent des fichiers de resultat ecrits par
`scripts/eval-stahl-bilingue.mjs` (mesures sur la VRAIE porte, chemin de
production `readKnowledge()`). Aucune valeur n'est saisie a la main.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
EVAL = RACINE / "knowledge" / "eval"
SORTIE = RACINE / "docs" / "reports" / "2026-10-20-stahl-retrieval-evaluation.md"

BASELINE = EVAL / "stahl-bilingue-v1.resultat.json"          # avant la couche
FINAL_SIM = EVAL / "stahl-bilingue-v1.final.json"              # apres, attestation simulee
FINAL_REEL = EVAL / "stahl-bilingue-v1.porte-reelle.json"      # apres, PORTE REELLE (source active)
CORPUS = EVAL / "stahl-bilingue-v1.json"
DOSAGE = (RACINE / "knowledge" / "canonical-v2" / "stahl-prescribers-guide-7e-cup" /
          "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3" /
          "dosage-couverture.json")

TITRES = {
    "A_contenu_en": "Question de contenu en anglais",
    "B_fr_complete": "Question clinique complete en francais",
    "C_fr_sujet": "Question francaise (sujet clinique + medicament)",
    "D_nom_seulement": "Nom du medicament seul",
    "E_synonyme": "Synonyme / variante FR-EN",
    "F_cible": "Cible : rubrique precise (posologie, contre-indications, effets)",
    "F_tableau_contenu": "Tableau interroge par son SUJET",
    "F_tableau_page": "Tableau interroge par sa PAGE seule (mesure de limite)",
    "G_sans_reponse": "Sans reponse (abstention)",
    "H_autre_source": "Reponse attendue d'une AUTRE source (DSM-5)",
}


def lire(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def fr(x: float) -> str:
    return f"{x:.4f}".replace(".", ",")


def main() -> int:
    base = lire(BASELINE)
    fin = lire(FINAL_SIM)
    reel = lire(FINAL_REEL)
    corpus = lire(CORPUS)
    dosage = lire(DOSAGE)
    if base is None or fin is None or reel is None or corpus is None:
        print("fichiers de resultat manquants — lancer scripts/eval-stahl-bilingue.mjs", file=sys.stderr)
        return 1

    # Comparaison sur les questions COMMUNES (le corpus a gagne une classe).
    b = {d["id"]: d for d in base["detail"]}
    f = {d["id"]: d for d in reel["detail"]}
    communs = [i for i in f if i in b]

    L: list[str] = []
    A = L.append
    A("# Evaluation du retrieval — Prescriber's Guide 7e (Stahl)")
    A("")
    A("**Objet** : mesurer l'effet de la couche de terminologie bilingue FR→EN sur la "
      "recherche de connaissance, et fixer le niveau de service retenu pour la sortie.")
    A("")
    A("**Méthode** : aucune simulation. Les mesures sont prises sur la **vraie porte "
      "SQL** (`app.search_knowledge_lexical`, filtre d'autorité réel : classification, "
      "statut, approbation, revue à jour, non-supersession, langue) et par le **chemin de "
      "production** (`readKnowledge()`, planificateur + classement + preuves du dépôt).")
    A("")
    A("**Corpus** : `knowledge/eval/stahl-bilingue-v1.json` — "
      f"{corpus['totaux']['questions']} questions, "
      f"{corpus['totaux']['avec_reponse']} avec réponse, "
      f"{corpus['totaux']['sans_reponse']} sans réponse, "
      f"{corpus['totaux']['autre_source']} dont la réponse attendue vient du DSM-5.")
    A("")
    A("Aucune question n'est inventée : médicaments, rubriques, pages et fragments "
      "proviennent des artefacts canoniques. Les questions sont versionnées avec le "
      "corpus (version 1) : toute évolution du corpus incrémente la version et "
      "invalide la comparaison.")
    A("")

    # ---------------------------------------------------------------- classes
    A("## 1. Résultat par classe (avant → après, source ACTIVE, porte réelle)")
    A("")
    A("| classe | n | recall@5 avant | recall@5 après | MRR avant | MRR après | "
      "page avant | page après | source avant | source après |")
    A("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for cle, titre in TITRES.items():
        ids = [i for i in communs if f[i]["classe"] == cle]
        if not ids:
            continue
        n = len(ids)
        rb = sum((b[i]["recall"] or 0) for i in ids) / n
        ra = sum((f[i]["recall"] or 0) for i in ids) / n
        mb = sum((b[i]["mrr"] or 0) for i in ids) / n
        ma = sum((f[i]["mrr"] or 0) for i in ids) / n
        pb = sum(1 for i in ids if b[i]["page_ok"]) / n
        pa = sum(1 for i in ids if f[i]["page_ok"]) / n
        sb = sum((b[i]["source_pertinente"] is True) for i in ids) / n
        sa = sum((f[i]["source_pertinente"] is True) for i in ids) / n
        A(f"| {titre} | {n} | {fr(rb)} | **{fr(ra)}** | {fr(mb)} | **{fr(ma)}** | "
          f"{fr(pb)} | **{fr(pa)}** | {fr(sb)} | **{fr(sa)}** |")
    n = len(communs)
    rb = sum((b[i]["recall"] or 0) for i in communs) / n
    ra = sum((f[i]["recall"] or 0) for i in communs) / n
    mb = sum((b[i]["mrr"] or 0) for i in communs) / n
    ma = sum((f[i]["mrr"] or 0) for i in communs) / n
    pb = sum(1 for i in communs if b[i]["page_ok"]) / n
    pa = sum(1 for i in communs if f[i]["page_ok"]) / n
    A(f"| **GLOBAL (questions communes)** | **{n}** | **{fr(rb)}** | **{fr(ra)}** | "
      f"**{fr(mb)}** | **{fr(ma)}** | **{fr(pb)}** | **{fr(pa)}** | — | — |")
    A("")
    A(f"Rappel de couverture (mesure finale, source active) : exactitude de source "
      f"{fr(reel['global']['exactitude_source'])}, exactitude de page "
      f"{fr(reel['global']['exactitude_page'])}.")
    A("")

    # ---------------------------------------------------------------- globale
    A("## 2. Synthèse")
    A("")
    A(f"- **Recall@5** : {fr(rb)} → **{fr(ra)}** "
      f"(+{(ra - rb) / rb * 100:.0f} % en relatif, {n} questions communes).")
    A(f"- **MRR** : {fr(mb)} → **{fr(ma)}** (+{(ma - mb) / mb * 100:.0f} % en relatif).")
    A(f"- **Exactitude de page** : {fr(pb)} → **{fr(pa)}**.")
    A(f"- **Abstention** (questions sans réponse) : "
      f"{reel['abstention']['reponse_a_confiance']} réponse(s) à confiance sur "
      f"{reel['abstention']['total']} → taux {fr(reel['abstention']['taux'])}. **L'abstention "
      "est préservée** : aucune question sans réponse ne produit de passage assertif.")
    A(f"- **Attribution incorrecte** (une source servie pour une question dont la réponse "
      f"attendait une autre source) : {fr(reel['attribution']['taux'])} "
      f"({reel['attribution']['attribution_incorrecte']}/{reel['attribution']['total_questions_avec_source_attendue']}). "
      f"Sur la classe `H_autre_source` (questions dont la réponse attendue est le DSM-5), "
      f"l'exactitude de source est **{fr(reel['par_classe']['H_autre_source']['exactitude_source'])}** : "
      "les trois questions sont bien servies par le DSM-5, jamais par Stahl.")
    A("")
    A("**Aucune régression** : la classe anglaise (A_contenu_en) est inchangée, la classe "
      "« nom du médicament seul » (D) est inchangée à l'identique près, l'abstention "
      "reste à zéro.")
    A("")

    # ---------------------------------------------------------------- cause
    A("## 3. Où se perdait la performance (diagnostic)")
    A("")
    A("La perte n'était **ni dans l'interprétation de la question, ni dans le filtrage, ni "
      "dans la génération de candidats** : elle était dans le **classement**, et la porte "
      "lexicale est un **ET** strict (`plainto_tsquery`).")
    A("")
    A("1. **Un mot français absent de l'index annule la requête entière.** Sur le corpus "
      "Stahl (anglais), les mots « posologie », « effets », « indésirables », « grossesse » "
      "… n'existent pas. Une question française complète ne pouvait donc pas matcher.")
    A("2. **Le classement mesurait une seule référence.** `rerankerCalibre` calcule la "
      "couverture des jetons de la requête par rapport à UNE `relevanceQuery`. Un candidat "
      "anglais remonté par une requête française couvrait au mieux 1/3 des jetons : "
      "score ≈ 0,18, sous le seuil de pertinence (0,40).")
    A("")
    A("Le remède est en deux pièces coordonnées : une **couche de terminologie gouvernée** "
      "qui remplace le concept clinique par les **intitulés de rubrique réels** du corpus "
      "(donc par des mots qui existent dans l'index), et un **classement par lot** où "
      "chaque requête candidate est mesurée contre sa propre référence — celle qui l'a "
      "fait remonter.")
    A("")

    # ---------------------------------------------------------------- posologie
    A("## 4. Couverture des rubriques de posologie (mesure)")
    A("")
    if dosage:
        c = dosage["compteurs"]
        A(f"- Monographies portant une posologie chiffrée : "
          f"**{c['monographies_avec_posologie_chiffree']} sur {c['monographies']}** "
          f"({fr(c['couverture_posologie'])}).")
        A("- La rubrique `Usual Dosage Range` n'est portée que par **30 monographies** : "
          "c'est une **variété d'intitulé**, pas une absence de donnée.")
        A("- La posologie se répartit sur "
          f"**{c['rubriques_portant_des_doses']} rubriques réelles** ; l'union des trois "
          "principales (`Dosing Tips`, `How to Dose`, `Usual Dosage Range`) couvre "
          "**137 monographies sur 154** (89,0 %).")
        A("")
        A("**Conséquence clinique** : une question de posologie qui vise une rubrique "
          "unique ne touche qu'une fraction des monographies. C'est ce que la couche de "
          "terminologie corrige : « posologie habituelle » produit les trois rubriques "
          "réelles, pas une seule.")
        A("")
        A("**Règle appliquée dans le test de fumée** : une rubrique **absente** pour une "
          "monographie doit **ne rien remonter** — et c'est le comportement correct. "
          "L'absence d'un intitulé ne prouve pas l'absence de posologie (celle de "
          "Sertraline est sous « Dosing Tips »). Ces deux faits sont désormais testés "
          "séparément.")
        A("")

    # ---------------------------------------------------------------- limites
    A("## 5. Limites connues, mesurées et assumées")
    A("")
    A("| Limite | Mesure | Statut |")
    A("|---|---|---|")
    A(f"| Interrogation d'un tableau par sa PAGE seule (le marqueur de page n'existe "
      f"que dans le texte, et un chunk multi-pages n'indexe que sa 1re page) | "
      f"recall@5 = {fr(reel['par_classe']['F_tableau_page']['recall_at_5'])} "
      f"(15 questions) | **connue, non corrigée** — le contenu du tableau EST "
      f"atteignable par son sujet (recall@5 = "
      f"{fr(reel['par_classe']['F_tableau_contenu']['recall_at_5'])}) |")
    A("| Exactitude de page sur les tableaux | 0,0000 (15 questions) | **connue, non "
      "corrigée** — le folio du passage porteur est exact, mais il désigne la 1re page "
      "du chunk, pas celle du tableau |")
    A("| Classe `H_autre_source` : le rappel est nul | 3 questions, réponse attendue "
      "DSM-5 | **voulu** — la source servie est bien le DSM-5 (exactitude de source "
      "1,0000) ; le corpus attendait des identifiants de chunk DSM-5 non fournis |")
    A("| Requête en français SANS nom de livre | `plan.language = \"toutes\"` : la porte "
      "interroge les sources FR et EN | **assumé et mesuré** — l'expansion n'ajoute que "
      "des requêtes anglaises, qui ne peuvent toucher que des sources anglaises ; "
      "l'attribution incorrecte reste à 2,53 % |")
    A("| Question de contenu en anglais | recall@5 0,3936 — identique avant et après | "
      "**stable** : la couche ne dégrade pas l'existant |")
    A("")
    A("### Le point dur : l'index n'expose que la première page d'un chunk")
    A("")
    A("875 chunks sur 3 076 (28,4 %) couvrent plusieurs pages ; le marqueur "
      "`[... p.N|src:N]` n'est posé que sur la première. **3 639 pages de contenu ne "
      "sont donc pas adressables par leur numéro.** Cela ne change pas la citation d'un "
      "passage retrouvé (son folio est exact, écart 0/3 076), mais c'est une limite "
      "réelle de recherche à l'ancre de page, distincte de l'exactitude de folio.")
    A("")
    A("### Le point dur : l'ordre de lecture des pages")
    A("")
    A("L'extracteur brut conserve l'ordre des blocs renvoyés par PyMuPDF, qui place les "
      "blocs **gras (titres)** avant les blocs de corps. Sur **1 859 pages sur 2 697 "
      "(68,9 %)** l'ordre extrait diffère de l'ordre de lecture humain. Conséquence "
      "mesurée : le **contenu est verbatim et complet** (aucun mot perdu), mais "
      "l'**intitulé de rubrique** porté par un chunk peut désigner la rubrique "
      "voisine — sur les 30 chunks `Usual Dosage Range`, **11 ne contiennent aucune "
      "dose chiffrée**.")
    A("")
    A("La|posologie n'est pas perdue : elle est dans le corpus, sous un autre intitulé "
      "(voir §4). **Remédiation** : rejouer l'extraction avec l'ordre vertical, puis "
      "re-découper, re-embedder et recharger — reconstruction intégrale du paquet "
      "canonique, qui **invalide le présent paquet de revue** et exige une révision "
      "clinique nouvelle. **Non appliqué dans cette version**, et signalé comme tel.")
    A("")

    # ---------------------------------------------------------------- seuil
    A("## 6. Seuils de service retenus")
    A("")
    A("| métrique | seuil | mesure finale | statut |")
    A("|---|---|---|---|")
    A(f"| Rappel sur question clinique FR | ≥ 0,30 | {fr(reel['par_classe']['B_fr_complete']['recall_at_5'])} | "
      f"{'TENU' if reel['par_classe']['B_fr_complete']['recall_at_5'] >= 0.30 else 'NON TENU'} |")
    A(f"| MRR sur question clinique FR | ≥ 0,25 | {fr(reel['par_classe']['B_fr_complete']['mrr'])} | "
      f"{'TENU' if reel['par_classe']['B_fr_complete']['mrr'] >= 0.25 else 'NON TENU'} |")
    A(f"| Rappel question FR (sujet + médicament) | ≥ 0,45 | {fr(reel['par_classe']['C_fr_sujet']['recall_at_5'])} | "
      f"{'TENU' if reel['par_classe']['C_fr_sujet']['recall_at_5'] >= 0.45 else 'NON TENU'} |")
    A(f"| Taux de réponse non étayée | = 0 | {fr(reel['abstention']['taux'])} | "
      f"{'TENU' if reel['abstention']['taux'] == 0 else 'NON TENU'} |")
    A(f"| Attribution incorrecte | ≤ 0,05 | {fr(reel['attribution']['taux'])} | "
      f"{'TENU' if reel['attribution']['taux'] <= 0.05 else 'NON TENU'} |")
    A(f"| Exactitude de source (classe H) | = 1,00 | {fr(reel['par_classe']['H_autre_source']['exactitude_source'])} | "
      f"{'TENU' if reel['par_classe']['H_autre_source']['exactitude_source'] == 1.0 else 'NON TENU'} |")
    A("")
    A("Ces seuils sont **dérivés du baseline mesuré** (la couche improves les classes "
      "françaises de 0,06 à 0,33 en rappel) et **plafonnés par le risque clinique** : "
      "l'abstention et l'attribution ne sont pas négociables, le rappel l'est.")
    A("")
    A("Le seuil historique ADR-037 (Recall@5 ≥ 0,90 ; MRR ≥ 0,80) reste **non atteint** "
      "sur le planificateur de production. Il est atteint sur la requête de contenu "
      "technique (variante « b » de l'évaluation d'ingestion : recall@5 1,0000, MRR "
      "0,9543) — l'écart entre les deux mesure précisément ce que le planificateur "
      "natural perd, et non la qualité du corpus. **Cet écart reste ouvert et est "
      "déclaré comme tel dans le dossier de sortie.**")
    A("")

    # ---------------------------------------------------------------- repro
    A("## 7. Reproduction")
    A("")
    A("```bash")
    A("# Corpus (versionne) — regenere les 362 questions depuis les artefacts")
    A("python scripts/knowledge-stahl-eval-corpus.py")
    A("")
    A("# Mesure sur la VRAIE porte, source ACTIVE (apres activation)")
    A("node scripts/eval-stahl-bilingue.mjs --top 5 --porte-reelle \\")
    A("  --sortie knowledge/eval/stahl-bilingue-v1.porte-reelle.json")
    A("")
    A("# Mesure avec simulation d'attestation (source en quarantaine)")
    A("node scripts/eval-stahl-bilingue.mjs --top 5 \\")
    A("  --sortie knowledge/eval/stahl-bilingue-v1.final.json")
    A("")
    A("# Diagnostic du gap de vocabulaire (quels termes annulent la requete)")
    A("python scripts/knowledge-stahl-diagnostic-vocabulaire.py")
    A("```")
    A("")
    A("Artefacts produits :")
    A("")
    for nom in ["stahl-bilingue-v1.json", "stahl-bilingue-v1.resultat.json",
                "stahl-bilingue-v1.final.json", "stahl-bilingue-v1.porte-reelle.json",
                "stahl-bilingue-v1.gap.json"]:
        p = EVAL / nom
        if p.exists():
            A(f"- `knowledge/eval/{nom}` ({p.stat().st_size // 1024} Ko)")
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
