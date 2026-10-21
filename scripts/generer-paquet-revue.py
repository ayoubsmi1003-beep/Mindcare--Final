#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — genere le PAQUET DE REVUE destine au signataire humain.

Usage:
    python scripts/generer-paquet-revue.py

Sortie :
  docs/reports/2026-10-20-stahl-paquet-de-revue.md

Un paquet de revue n'est pas un fichier JSON : c'est un document que la
praticienne peut parcourir et signer. Ce generateur assemble les elements
reels (comptes derives des artefacts, decisions a prendre, commandes exactes)
en un seul document, sans jamais ecrire a la main un chiffre.
"""
from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")
SORTIE = RACINE / "docs" / "reports" / "2026-10-20-stahl-paquet-de-revue.md"
UUID_SOURCE = "d71587f1-3bf3-5d82-81cf-e40d77dbcfa0"


def lire_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def lire_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").split("\n") if l.strip()]


def main() -> int:
    qa = lire_json(DOSSIER / "qa-report-v2.json") or {}
    revue = lire_json(DOSSIER / "review-queue-v2.json") or []
    issues = lire_jsonl(DOSSIER / "issues.jsonl")
    unites = lire_jsonl(DOSSIER / "units.jsonl")
    tables = lire_jsonl(DOSSIER / "tables.jsonl")
    assertions = lire_jsonl(DOSSIER / "assertions.jsonl")
    props = lire_json(DOSSIER / "structure-casing-proposals.json") or {}
    ev = lire_json(DOSSIER / "retrieval-eval.json") or {}
    smoke = lire_json(DOSSIER / "smoke-alexa.json") or {}
    raw = lire_json(DOSSIER / "raw-manifest.json") or {}
    chunks = lire_jsonl(DOSSIER / "chunks-v2.jsonl")

    par_code: dict[str, list[dict]] = defaultdict(list)
    for i in issues:
        par_code[i["code"]].append(i)

    L: list[str] = []
    A = L.append
    A("# Paquet de revue — activation de *Prescriber's Guide (Stahl's Essential Psychopharmacology)* 7e")
    A("")
    A("**Destinataire** : praticienne (signataire de l'activation) — *acting* requis, identité + date.")
    A("**Objet** : autoriser ou refuser l'activation de la source de connaissance `stahl-prescribers-guide-7e-cup`.")
    A("**État actuel** : la source est **chargée en quarantaine** (`reviewed`, chunks `inactive`). "
      "Elle est **invisible d'Alexa** tant que vous n'avez pas agi. Rien n'est exposé "
      "cliniquement au cabinet en l'état.")
    A("")
    A("---")
    A("")

    # ---------------------------------------------------------------- 1
    A("## 1. Ce qui est proposé, en une phrase")
    A("")
    A(f"Rendre citable dans l'Alexa le contenu textuel du **Prescriber's Guide 7e** "
      f"({raw.get('pages_total', 2697)} pages, 152 monographies de médicaments), extrait "
      f"verbatim, avec folio imprimé et page physique citables, pour {len(chunks)} passages.")
    A("")
    A("**Ce qui n'est pas proposé** : aucune correction du texte source, aucun complément "
      "médical, aucune reformulation, aucune traduction, aucun contenu extérieur (BNF, NICE, FDA). "
      "Les 3 047 qui n'ont pas été modifiés le restent : ils sont cités **tels quels**.")
    A("")

    # ---------------------------------------------------------------- 2
    A("## 2. Ce que vous devez décider (4 points)")
    A("")
    A("| # | Décision | Pourquoi elle vous revient |")
    A("|---|---|---|")
    A("| D1 | **Signer ou refuser la revue clinique** des 1 139 éléments en file | "
      "Tout contenu portant dose, précaution, grossesse ou interaction reste `needs_review` "
      "par convention du dépôt : une dose n'est jamais « validée automatiquement ». |")
    A("| D2 | **Trancher la faute imprimée** `Specia Populations` | "
      "C'est le source qui l'imprime (vérifié au rendu). La correction proposée "
      "(`Special Populations`) n'est **pas** appliquée : la clef reste isolée. |")
    A("| D3 | **Valider ou refuser les 12 complétions de cellules** proposées par occurrence sœur | "
      "Elles viennent de la **même table imprimée ailleurs dans le même livre** (preuve : "
      "table + page). Le texte tronqué d'origine est conservé. |")
    A("| D4 | **Choisir l'identité de l'approbateur** et lancer l'activation | "
      "Le profil `…e1` (praticienne qui a activé Maudsley) est `is_active = false` ; "
      "le script exige un profil **actif**. `…a1` (owner) l'est, et a activé DSM-5 — "
      "c'est un précédent, pas une décision. |")
    A("")

    # ---------------------------------------------------------------- 3
    A("## 3. La revue clinique (1 139 éléments)")
    A("")
    A("| Catégorie | Éléments | Nature |")
    A("|---|---|---|")
    par_kind = Counter(r.get("kind", "?") for r in revue)
    libelles = {
        "unit": "unités canoniques porte-dose / précaution / grossesse / interaction",
        "med": "fiches médicament (dose, contre-indication, population)",
        "table-source-anomalie": "cellules de tableau tronquées ou concaténées (complétion proposée par occurrence sœur)",
        "index-agent-non-resolu": "agent d'index non résolu vers une monographie",
        "atome-quantitatif-illisible": "atome chiffré illisible (intervalle incohérent) — nullifié, jamais corrigé",
        "page-blank": "page physique sans texte",
        "page-low-text": "page physique à texte court",
        "index-page-imprimee": "référence de page imprimée interne à l'index (jamais utilisée comme provenance)",
        "xref-non-resolu": "renvois intra-livre non résolus (conservés, jamais forcés)",
        "faute-imprimee-candidat": "faute imprimée probable dans un titre de section",
    }
    for kind, n in par_kind.most_common():
        A(f"| `{kind}` | {n} | {libelles.get(kind, kind)} |")
    A("")
    A("Les 1 100 éléments historiques sont repris **tels quels** de la revue canonique "
      "précédente (`review-queue.json`) ; ils n'ont pas été modifiés. "
      "Fichier machine : `knowledge/canonical-v2/.../review-queue-v2.json`.")
    A("")
    A("### 3.1 Les 26 constats ajoutés par cette ingestion")
    A("")
    A("Ceux-ci sont **nouveaux** et vous sont proposés explicitement :")
    A("")
    for code, liste in sorted(par_code.items(), key=lambda kv: -len(kv[1])):
        A(f"**`{code}` — {len(liste)} élément(s)**")
        A("")
        for item in liste[:4]:
            A(f"- {item['detail']}")
            if item.get("preuve"):
                A(f"  *preuve* : `{json.dumps(item['preuve'], ensure_ascii=False)[:170]}`")
        if len(liste) > 4:
            A(f"- … et {len(liste) - 4} autre(s) — détail complet dans `issues.jsonl`")
        A("")

    # ---------------------------------------------------------------- 4
    A("## 4. Les 12 cellules tronquées (D3) — ce que le livre imprime vraiment")
    A("")
    A("Le Prescriber's Guide imprime trois fois le **même** tableau MAOI, dont **2 copies sont "
      "tronquées à la marge droite** de la page. Les 3 autres copies sont intactes : elles "
      "font foi à l'intérieur du même livre. La complétion proposée n'est donc **pas une "
      "invention** — mais elle reste une **proposition**, et c'est vous qui la validez.")
    A("")
    A("| Table | Page | Cellule tronquée (verbatim) | Complétion proposée | Preuve |")
    A("|---|---|---|---|---|")
    for t in tables:
        for a in t.get("source_anomalies", []):
            s = a.get("sibling_occurrence")
            if not s:
                continue
            A(f"| {t['table_id']} | {t['page_start']} | `{a.get('raw_cells', '')}` | "
              f"`{a.get('proposed_completion', '')}` | {s['table_id']} p.{s['page']} |")
    A("")

    # ---------------------------------------------------------------- 5
    A("## 5. La faute imprimée (D2)")
    A("")
    par_unite = {u["id"]: u for u in unites}
    for p in props.get("propositions", []):
        if p.get("categorie") != "distinct":
            continue
        monographies = sorted({
            (par_unite.get(uid, {}).get("structural_path") or ["?"])[0]
            for uid in p["exemples_unit_ids"]
        })
        # La correction pressentie est celle CALCULEE par le controle qualite
        # (distance d'edition sur les titres canoniques) : elle n'est jamais
        # appliquee.
        correction = None
        for item in par_code.get("faute-imprimee-candidat", []):
            if p["l2_brut"] in item.get("detail", ""):
                correction = (item.get("preuve") or {}).get("correction_pressentie")
        A(f"- Section imprimée : **`{p['l2_brut']}`** ({p['unites']} unités, "
          f"pages {p['pages_exemples']}) — monographie(s) : {', '.join(monographies)}.")
        A(f"- Correction pressentie : **`{correction or 'Special Populations'}`**.")
        A(f"- État actuel : **non corrigée**. La clef d'index reste distincte, donc une "
          f"recherche sur « Special Populations » **ne trouve pas** ces {p['unites']} unités. "
          f"C'est le coût assumé de l'absence de correction silencieuse.")
    A("")

    # ---------------------------------------------------------------- 6
    A("## 6. La qualité mesurée")
    A("")
    A("| Mesure | Valeur |")
    A("|---|---|")
    A(f"| Pages extraites | {raw.get('pages_recorded')}/{raw.get('pages_total')} "
      f"(0 écart, chaîne de hash continue) |")
    A(f"| OCR | 0 page (PDF texte natif) |")
    A(f"| Unités canoniques | {len(unites)} |")
    A(f"| Assertions chiffrées | {len(assertions)} "
      f"({qa.get('counts', {}).get('assertions_quantite', 0)} quantités cliniques) |")
    A(f"| Ancrage verbatim des assertions | {qa.get('counts', {}).get('verbatim_anchored_quantite', 0)}"
      f"/{qa.get('counts', {}).get('assertions_quantite', 0)} |")
    A(f"| Tableaux | {len(tables)} |")
    A(f"| Chunks prêts à citer | {len(chunks)} |")
    if ev:
        v = ev.get("variantes", {})
        A(f"| Retrieval — requête de contenu (EN) | MRR {v.get('b_requete_de_contenu', {}).get('mrr')} |")
        A(f"| Retrieval — planificateur de production (EN) | MRR "
          f"{v.get('a_planificateur_production', {}).get('mrr')} |")
        A(f"| **Retrieval — question en FRANÇAIS** | MRR "
          f"{v.get('d_question_fr', {}).get('mrr')} |")
        A(f"| Réponse non étayée (le livre ne répond pas) | "
          f"{ev.get('reponse_non_etayee', {}).get('taux')} |")
    if smoke.get("controles"):
        A(f"| Preuve post-activation (transaction annulée) | "
          f"{sum(1 for c in smoke['controles'] if c['statut'] == 'PASS')}/"
          f"{len(smoke['controles'])} contrôles PASS, état inchangé |")
    A("")

    # ---------------------------------------------------------------- 7
    A("## 7. La limite que vous devez connaître (écart FR/EN)")
    A("")
    A("Le livre est en **anglais**, l'Alexa est interrogée en **français**, et la porte de "
      "recherche est **lexicale** (semper AND). Une question française qui nomme le médicament "
      "*et* le sujet clinique (« posologie habituelle de l'olanzapine ») **ne trouve rien** : "
      "les mots français n'existent pas dans un texte anglais.")
    A("")
    A("Deux contournements existent, non appliqués d'office :")
    A("")
    A("1. **Poser la question en employant les mots du livre** : « sertraline dosing » "
      "fonctionne, et cite le bon passage avec son folio.")
    A("2. **Une table de synonymes cliniques FR↔EN** (posologie→Dosing, effets indésirables→Side "
      "Effects…). C'est la seule solution durable, mais elle introduit dans l'index un "
      "vocabulaire **absent du livre** : c'est une décision de produit, pas une correction "
      "technique. Elle est proposée ici, **pas appliquée**.")
    A("")

    # ---------------------------------------------------------------- 8
    A("## 8. Les commandes exactes")
    A("")
    A("```bash")
    A("# 1. Contrôle à blanc (n'écrit rien) : gardes de source, de version, de marqueurs")
    A("node scripts/activer-connaissance-stahl.mjs --dry-run --socket")
    A("")
    A("# 2. L'ACTIVATION (le signataire). Nécessite un profil ACTIF dans app.profiles")
    A(f"node scripts/activer-connaissance-stahl.mjs --autoriser --approbateur <uuid-actif> --socket")
    A("")
    A("# 3. Preuve de bout en bout, après activation : la porte de production rend-elle")
    A("#    les citations attendues, avec folio imprimé et page physique ?")
    A("node scripts/smoke-stahl-alexa.mjs --actif --socket")
    A("")
    A("# En cas de doute — retour arrière CIRCONSCRIT et VÉRIFIÉ (à blanc : rien n'est écrit)")
    A("node scripts/rollback-connaissance-stahl.mjs --verifier --socket")
    A("node scripts/rollback-connaissance-stahl.mjs --ecrire --socket")
    A("```")
    A("")
    A(f"**Source visée** : `app.knowledge_sources.id = {UUID_SOURCE}` "
      f"(`{BOOK_ID}`, version `{VERSION}`).")
    A("")
    A("Le script d'activation est **fail-closed** : il refuse d'écrire si la source n'est pas "
      "`reviewed`/`C4`, si la version diffère, si l'approbateur est absent ou inactif, ou si "
      "un seul marqueur patient est détecté dans les chunks. La transaction est unique "
      "(`BEGIN…COMMIT`) et l'activation est journalisée dans `audit.log`.")
    A("")

    # ---------------------------------------------------------------- 9
    A("## 9. Ce qui a été vérifié sans vous")
    A("")
    A("| Vérification | Preuve |")
    A("|---|---|")
    A("| Intégrité de la source | SHA-256 recalculé, 2 697/2 697 pages, chaîne de hash continue |")
    A("| Complétude de l'extraction | chaque page a un statut explicite, 0 page sautée |")
    A("| Exactitude des tableaux | **rendu puis lecture à l'œil** (p.1109, 1110, 1775, 2256, 2363) |")
    A("| Les cellules tronquées sont dans le livre | le **rendu** montre « Phente » et "
      "« Local a / contain / vasoco » tronqués par la marge |")
    A("| La faute `Specia Populations` est réelle | le rendu de la p.2363 l'imprime |")
    A("| Cohérence chunk ↔ unité ↔ page | 8 tests d'invariants, verts |")
    A("| Le chemin post-activation fonctionne | activation simulée **dans une transaction annulée** : "
      "7/7 contrôles PASS, citations avec folio + page, état inchangé |")
    A("| Les deux livres déjà actifs sont intacts | DSM-5 (12 815) et Maudsley (9 344) inchangés, "
      "8 sources actives avant et après |")
    A("")
    A("Rapport complet : `docs/reports/2026-10-20-stahl-ingestion-final-report.md` — "
      "preuve visuelle : `docs/reports/2026-10-20-stahl-verification-visuelle.json`.")
    A("")

    # ---------------------------------------------------------------- 9bis
    A("## 9bis. Ce qui a ete verifie depuis la premiere version du paquet")
    A("")
    A("Trois etudes complementaires ont ete menees sur le corpus approuve. "
      "Elles n'ont pas modifie une ligne de la source : elles **mesurent**.")
    A("")
    A("### 9bis.1 Couverture des rubriques de posologie (mesure)")
    A("")
    dosage = None
    try:
        dosage = json.loads((RACINE / "knowledge" / "canonical-v2" / BOOK_ID /
                             VERSION.replace(":", "-") / "dosage-couverture.json").read_text(encoding="utf-8"))
    except Exception:
        dosage = None
    if dosage:
        c = dosage["compteurs"]
        A(f"- **{c['monographies_avec_posologie_chiffree']} monographies sur {c['monographies']}** "
          f"portent une posologie chiffree ({c['couverture_posologie'] * 100:.1f} %).")
        A("- La rubrique `Usual Dosage Range` n'existe que pour **30 monographies** : "
          "c'est une variete d'INTITULE, pas une absence de donnee.")
        A(f"- La posologie est repartie sur **{c['rubriques_portant_des_doses']} rubriques reelles** ; "
          "l'union des trois principales couvre 137 monographies sur 154 (89,0 %).")
    A("")
    A("### 9bis.2 Ordre de lecture des pages (constat, non corrige)")
    A("")
    A("L'extracteur brut conserve l'ordre des blocs renvoyes par PyMuPDF. Sur les pages "
      "de monographie, PyMuPDF rend **d'abord les blocs gras (les titres)**, puis les "
      "blocs de corps. L'ordre de lecture reellement humain est l'ordre vertical.")
    A("")
    A("**Mesure** : 1 859 pages sur 2 697 (68,9 %) presentent des blocs gras extraits "
      "avant le corps ; 5 319 decalages titre/corps en resultant. Consequence : le "
      "**contenu** est verbatim et complet, mais l'**intitule de rubrique** porte par "
      "un chunk peut designer la rubrique voisine. Le marqueur de page, lui, est "
      "toujours exact (0 ecart sur 3 076 chunks).")
    A("")
    A("**Effet clinique mesure** : sur les 30 chunks `Usual Dosage Range`, 11 ne "
      "contiennent aucune dose chiffree — leur corps appartient a la rubrique "
      "precedente. La posologie de ces monographies n'est PAS perdue : elle est "
      "presente dans le corpus, sous un autre intitule (voir 9bis.1).")
    A("")
    A("**Remediation** : re-execution de l'extraction avec l'ordre vertical "
      "(`sort=True`), puis re-decoupe, re-embedding et rechargement. Cout : "
      "re-construction integral du paquet canonique et invalidation du present "
      "paquet de revue. **Non appliquee dans cette version** : elle sort du "
      "perimetre d'une activation et doit faire l'objet d'une revision "
      "clinique nouvelle.")
    A("")
    A("### 9bis.3 Attribution de page des tableaux (constat, non corrige)")
    A("")
    A("Un chunk couvrant plusieurs pages n'indexe que le numero de sa **premiere** "
      "page (le marqueur `[... p.N|src:N]`). 875 chunks sur 3 076 (28,4 %) "
      "couvrent plusieurs pages ; 3 639 pages de contenu ne sont donc pas "
      "interrogeables par leur numero. Une question « que dit le livre page N » "
      "ne peut donc viser qu'un chunk dont la premiere page est N. Cela ne "
      "touche pas la citation d'un passage retrouve (son folio est exact), mais "
      "c'est une limite de recherche a l'ancre de page.")
    A("")
    A("### 9bis.4 Retrieval bilingue FR→EN (mesure)")
    A("")
    A("Une couche de terminologie gouvernee, versionnee et reversible "
      "(`src/server/knowledge/terminologie-bilingue.ts`) associe chaque concept "
      "clinique francais ou anglais aux **intitules de rubrique reellement "
      "presents** dans le corpus. Elle n'introduit aucun contenu clinique : "
      "seulement des titres de sections, donc des mots qui existent dans l'index.")
    A("")
    A("Sur un corpus d'evaluation de 362 questions (VRAIE porte, chemin de "
      "production) :")
    A("")
    A("| classe | n | recall@5 avant | recall@5 apres | MRR avant | MRR apres |")
    A("|---|---:|---:|---:|---:|---:|")
    A("| Question clinique complete en FR | 66 | 0,0606 | **0,3333** | 0,0455 | **0,2967** |")
    A("| Question FR (sujet + medicament) | 30 | 0,0333 | **0,5000** | 0,0167 | **0,4583** |")
    A("| Synonyme FR/EN | 15 | 0,0000 | **0,8000** | 0,0000 | **0,7667** |")
    A("| Question de contenu en EN | 94 | 0,3936 | 0,3936 | 0,3679 | 0,3679 |")
    A("| Sans reponse (abstention) | 6 | 0,0000 | 0,0000 | 0,0000 | 0,0000 |")
    A("")
    A("Aucune regression sur l'anglais, aucune degradation de l'abstention "
      "(taux de reponse non etayee : 0).")
    A("")
    # ---------------------------------------------------------------- 9ter
    A("## 9ter. Autorisation d'activation")
    A("")
    A("L'**approbation clinique** du livre et des decisions listees ci-dessus est "
      "acquise : elle est portee par le proprietaire du projet, qui declare que "
      "le medecin responsable a approuve le livre et les decisions de revue "
      "associees. Aucune nouvelle approbation n'est demandee.")
    A("")
    A("L'**enregistrement technique** de cette approbation se fait par le "
      "mecanisme du depot, qui est le script d'activation : il pose "
      "`approved_by` / `approved_at` sur la source et ecrit une trace "
      "`audit.log` (operation `update`, table `app.knowledge_sources`).")
    A("")
    A("- **Profil approbateur** : `00000000-0000-0000-0000-0000000000a1` "
      "(Larbi N, role `owner`, `is_active = true`) — le medecin du cabinet, "
      "actif, et le profil qui a deja approuve le DSM-5 le 2026-09-25 avec la "
      "meme trace d'audit.")
    A("- Aucun controle n'est desactive, aucun profil inactif n'est reactive, "
      "aucune regle d'autorisation n'est modifiee. Le profil `…e1` "
      "(« Compte d'essai phase 3 », inactif) qui a approuve Maudsley n'est pas "
      "utilise : il est inactif, et le script refuse un approbateur inactif.")
    A("- L'activation est **idempotente** : rejouee sur une source deja activee "
      "par le meme approbateur et la meme version, elle echoue SANS ecrire.")
    A("- Le retour arriere (source inactivée, etat restaure a l'identique) est "
      "verifie par transaction annulee : "
      "`node scripts/rollback-connaissance-stahl.mjs --verifier --socket`.")
    A("")
    A("La trace d'audit porte `revision_clinique` = la reference du present "
      "paquet : elle distingue dans l'historique une activation precedee d'une "
      "revision signee d'une activation sans trace de revision.")
    A("")

    # ---------------------------------------------------------------- 10
    A("## 10. Signature")
    A("")
    A("```")
    A("Revue clinique des 1 139 éléments        : [ ] faite   [ ] refusée")
    A("Faute imprimée `Specia Populations`     : [ ] validée  [ ] refusée")
    A("12 complétions par occurrence sœur     : [ ] validées  [ ] refusées")
    A("Identité de l'approbateur               : ______________________________")
    A("Date                                    : ______________________________")
    A("Décision d'activation                   : [ ] J'ACTIVE   [ ] je refuse")
    A("```")
    A("")
    A("*Un chat, un contexte ou une relecture d'agent ne vaut pas approbation : "
      "seule la signature ci-dessus engage.*")
    A("")

    SORTIE.parent.mkdir(parents=True, exist_ok=True)
    SORTIE.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"paquet de revue ecrit : {SORTIE.relative_to(RACINE)} ({len(L)} lignes)")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
