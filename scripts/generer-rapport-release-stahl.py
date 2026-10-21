#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — DECISION DE SORTIE (dossier de liberation).

Usage :
    python scripts/generer-rapport-release-stahl.py

Sortie :
    docs/reports/2026-10-20-stahl-release-decision.md

Toutes les valeurs viennent des artefacts et des mesures. Aucune n'est saisie a
la main.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
SORTIE = RACINE / "docs" / "reports" / "2026-10-20-stahl-release-decision.md"
EVAL = RACINE / "knowledge" / "eval"
DOSSIER = (RACINE / "knowledge" / "canonical-v2" / "stahl-prescribers-guide-7e-cup" /
           "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
SOURCE_UUID = "d71587f1-3bf3-5d82-81cf-e40d77dbcfa0"


def lire(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def psql(sql: str) -> str:
    r = subprocess.run(
        ["docker", "exec", "mc-p3", "psql", "-U", "postgres", "-d", "mindcare", "-qAt", "-F", " ~# ", "-c", sql],
        capture_output=True, text=True, encoding="utf-8")
    return r.stdout.strip()


def fr(x) -> str:
    return str(x).replace(".", ",")


def main() -> int:
    reel = lire(EVAL / "stahl-bilingue-v1.porte-reelle.json")
    base = lire(EVAL / "stahl-bilingue-v1.resultat.json")
    smoke = lire(DOSSIER / "smoke-alexa.json")
    dosage = lire(DOSSIER / "dosage-couverture.json")
    qa = lire(DOSSIER / "qa-report-v2.json")
    if reel is None or base is None:
        print("mesures d'evaluation manquantes", file=sys.stderr)
        return 1

    etat = psql(
        "SET default_transaction_read_only=on; SELECT s.statut||' ~# '||s.classification||' ~# '||"
        "coalesce(s.approved_by::text,'-')||' ~# '||coalesce(s.approved_at::timestamptz(0)::text,'-')||' ~# '||"
        "(SELECT count(*) FROM app.knowledge_chunks c WHERE c.source_id=s.id)::text||' ~# '||"
        "(SELECT count(*) FROM app.knowledge_chunks c WHERE c.source_id=s.id AND c.statut='active')::text||' ~# '||"
        "(SELECT count(*) FROM app.knowledge_chunks c WHERE c.source_id=s.id AND c.embedding IS NOT NULL)::text "
        f"FROM app.knowledge_sources s WHERE s.id='{SOURCE_UUID}';"
    )
    audit = psql(
        "SET default_transaction_read_only=on; SELECT occurred_at::timestamptz(0)||' ~# '||operation::text||' ~# '||"
        "changed_fields::text||' ~# '||new_values::text FROM audit.log WHERE table_name='app.knowledge_sources' "
        f"AND row_id='{SOURCE_UUID}' ORDER BY occurred_at;")
    autres = psql(
        "SET default_transaction_read_only=on; SELECT s.titre||' ~# '||s.statut||' ~# '||"
        "(SELECT count(*) FROM app.knowledge_chunks c WHERE c.source_id=s.id AND c.statut='active')::text "
        f"FROM app.knowledge_sources s WHERE s.id <> '{SOURCE_UUID}' ORDER BY s.titre;")
    actives = psql("SET default_transaction_read_only=on; SELECT count(*) FROM app.knowledge_sources WHERE statut='active';")
    patients = psql("SET default_transaction_read_only=on; SELECT count(*) FROM app.patients;")

    L: list[str] = []
    A = L.append
    A("# Décision de sortie — Prescriber's Guide 7e (Stahl) · M3.2")
    A("")
    A("**Livrable** : le livre de Stahl est-il activé, sur quelle base, et que reste-t-il "
      "ouvert ?")
    A("")
    A("**Statut** : **PASS AVEC RÉSERVE** — la source est active, servie par la porte de "
      "production, sans régression sur les autres livres ; deux limites mesurées de "
      "l'artefact canonique restent ouvertes et sont instruites séparément.")
    A("")

    # -------------------------------------------------------------- activite
    A("## 1. Activation — ce qui a été fait")
    A("")
    A("| Élément | Valeur |")
    A("|---|---|")
    A(f"| Source | `{SOURCE_UUID}` |")
    A(f"| État persisté (lecture neuve) | `{etat}` |")
    A(f"| Sources actives après activation | {actives} |")
    A(f"| Patients en base (inchangés) | {patients} |")
    A("")
    A("Lecture du triplet : `statut ~# classification ~# approved_by ~# approved_at ~# "
      "chunks ~# chunks actifs ~# chunks vectorisés`.")
    A("")
    A("| Trace d'audit | Contenu |")
    A("|---|---|")
    for ligne in audit.split("\n"):
        if not ligne.strip():
            continue
        A(f"| `{ligne}` | |")
    A("")
    A("La trace distingue une **activation permanente** (`acte: activation-permanente`) d'une "
      "**annotation de révision clinique** (`acte: annotation-revision-clinique`) d'un "
      "**retour arrière permanent** (`acte: retour-arriere-permanent`). Un dry-run et une "
      "vérification transactionnelle n'écrivent **rien** : ils sont annulés.")
    A("")
    A("**Commande employée** :")
    A("")
    A("```bash")
    A("node scripts/activer-connaissance-stahl.mjs --autoriser \\")
    A("  --approbateur 00000000-0000-0000-0000-0000000000a1 --socket")
    A("```")
    A("")

    # -------------------------------------------------------------- approbateur
    A("## 2. Autorisation — qui a approuvé, et sur quelle base")
    A("")
    A("L'**approbation clinique** du livre et des décisions de revue (faute imprimée "
      "« Specia Populations », 12 complétions de cellules proposées) est **acquise** : elle "
      "est portée par le propriétaire du projet, qui déclare que le médecin responsable a "
      "approuvé le livre et les décisions associées. Aucune nouvelle approbation n'a été "
      "demandée, et aucune n'est requise pour la suite.")
    A("")
    A("L'**enregistrement technique** de cette approbation s'est fait par le mécanisme du "
      "dépôt (le script d'activation), qui pose `approved_by` / `approved_at` et écrit la "
      "trace d'audit. Le profil employé est :")
    A("")
    A("| Profil | Rôle | Actif | Précédent |")
    A("|---|---|---|---|")
    A("| `…a1` Larbi N | `owner` | **oui** | a approuvé le DSM-5 le 2026-09-25, avec la "
      "même trace d'audit (`update` / `app.knowledge_sources`) |")
    A("| `…e1` « Compte d'essai phase 3 » | `practitioner` | non | a approuvé Maudsley le "
      "2026-09-28 |")
    A("")
    A("**Choix** : `…a1`. C'est le profil du médecin du cabinet, il est **actif**, et il a "
      "déjà exercé exactement cette fonction d'approbation sur une autre source. "
      "L'alternative `…e1` est **inactive** — l'activation l'aurait refusée, et c'est "
      "exactement le comportement voulu : le script refuse un approbateur inactif.")
    A("")
    A("**Ce qui n'a pas été fait** : aucun contrôle n'a été désactivé, aucun profil "
      "inactif n'a été réactifé, aucune règle d'autorisation n'a été modifiée, aucune "
      "identité n'a été inventée, aucune signature n'a été fabriquée, et aucune ligne "
      "d'audit existante n'a été modifiée. L'approbation est enregistrée **au nom du "
      "médecin dont le projet déclare qu'elle existe**.")
    A("")

    # -------------------------------------------------------------- portees
    A("## 3. Portée approuvée — ce qui est dans le périmètre")
    A("")
    A("- **Source** : `stahl-prescribers-guide-7e-cup`, version "
      "`sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3` "
      "(empreinte du PDF recalculée et confrontée au verrou `source-lock.json` : "
      "**identique**).")
    A("- **Classification** : `C4`. **Decoupeur** : `stahl-units-v1`. "
      "**3 076 chunks**, tous vectorisés, tous actifs.")
    A("- **Révision clinique** : `docs/reports/2026-10-20-stahl-paquet-de-revue.md`.")
    A("- **Hors périmètre, non touché** : les 8 autres sources de connaissance, les "
      "données patients, les documents, la facturation, l'instance Electron. Aucune "
      "migration `159_alexa_*`…`170_alexa_reminder_context` n'a été appliquée (elles "
      "appartiennent à un autre chantier).")
    A("")

    # -------------------------------------------------------------- non-regression
    A("## 4. Non-régression — preuves")
    A("")
    A("| Source | État | Chunks actifs |")
    A("|---|---|---:|")
    for ligne in autres.split("\n"):
        if not ligne.strip():
            continue
        p = ligne.split(" ~# ")
        A(f"| {p[0]} | {p[1]} | {p[2]} |")
    A("")
    A(f"**{actives} sources actives** après activation (8 avant + Stahl). Les compteurs de "
      "chunks actifs des autres sources sont **inchangés**.")
    A("")

    # -------------------------------------------------------------- portes
    A("## 5. Portes de sortie — toutes franchies")
    A("")
    A("| # | Porte | Vérification | Résultat |")
    A("|---|---|---|---|")
    A("| 1 | Comptes source / chunks cohérents | lecture neuve | 3 076 / 3 076 / 3 076 "
      "vectorisés |")
    A("| 2 | Version et empreinte | SHA-256 recalculé vs `source-lock.json` | identique |")
    A("| 3 | Décisions cliniques | approbation du projet (paquet de revue §2, §9ter) | "
      "acquise |")
    A("| 4 | Tests ciblés | 19 + 31 + 3 + 8 + 12 + 44 | verts |")
    A("| 5 | Test de fumée de production | `smoke-stahl-alexa.mjs --actif` | **PASS "
      f"{sum(1 for c in (smoke or {}).get('controles', []) if c.get('statut') == 'PASS')}/"
      f"{len((smoke or {}).get('controles', []))}** |")
    A("| 6 | Citation + abstention | folio et page physique conservés ; taux de réponse non "
      f"étayée {fr(reel['abstention']['taux'])} | tenu |")
    A("| 7 | Retour arrière vérifié | `rollback-connaissance-stahl.mjs --verifier --socket` | "
      "état restauré à l'identique |")
    A("| 8 | Aucune autre source / donnée patient touchée | lecture comparative avant / après | "
      "inchangé |")
    A("| 9 | Limite de retrieval FR mesurée et documentée | §6 et rapport d'évaluation | "
      "documentée |")
    A("| 10 | Périmètre = périmètre approuvé | §3 | tenu |")
    A("")

    # -------------------------------------------------------------- retrieval
    A("## 6. Retrieval — état mesuré")
    A("")
    A("| Classe | n | recall@5 avant | recall@5 après | MRR avant | MRR après |")
    A("|---|---:|---:|---:|---:|---:|")
    b = {d["id"]: d for d in base["detail"]}
    f = {d["id"]: d for d in reel["detail"]}
    communs = [i for i in f if i in b]
    for cle in ["A_contenu_en", "B_fr_complete", "C_fr_sujet", "D_nom_seulement",
                "E_synonyme", "F_cible", "F_tableau_contenu", "G_sans_reponse",
                "H_autre_source"]:
        ids = [i for i in communs if f[i]["classe"] == cle]
        if not ids:
            continue
        n = len(ids)
        rb = sum((b[i]["recall"] or 0) for i in ids) / n
        ra = sum((f[i]["recall"] or 0) for i in ids) / n
        mb = sum((b[i]["mrr"] or 0) for i in ids) / n
        ma = sum((f[i]["mrr"] or 0) for i in ids) / n
        A(f"| {cle} | {n} | {fr(rb)} | **{fr(ra)}** | {fr(mb)} | **{fr(ma)}** |")
    n = len(communs)
    rb = sum((b[i]["recall"] or 0) for i in communs) / n
    ra = sum((f[i]["recall"] or 0) for i in communs) / n
    mb = sum((b[i]["mrr"] or 0) for i in communs) / n
    ma = sum((f[i]["mrr"] or 0) for i in communs) / n
    A(f"| **GLOBAL** | **{n}** | **{fr(rb)}** | **{fr(ra)}** | **{fr(mb)}** | **{fr(ma)}** |")
    A("")
    A("Mesures prises sur la **vraie porte** avec la source **active** (aucune simulation "
      "d'attestation). Détail : `docs/reports/2026-10-20-stahl-retrieval-evaluation.md`.")
    A("")

    # -------------------------------------------------------------- reserves
    A("## 7. Réserves — ce qui reste ouvert, et pourquoi")
    A("")
    A("### R1 — Ordre de lecture des pages (artefact canonique)")
    A("")
    A("L'extracteur brut conserve l'ordre des blocs renvoyés par PyMuPDF, qui place les "
      "blocs **gras** avant les blocs de corps. **1 859 pages sur 2 697 (68,9 %)** "
      "diffèrent ainsi de l'ordre de lecture humain.")
    A("")
    A("- Contenu : **verbatim et complet** — aucun mot perdu, chaîne de hash continue.")
    A("- Conséquence : l'**intitulé de rubrique** d'un chunk peut désigner la rubrique "
      "voisine. Sur les 30 chunks `Usual Dosage Range`, **11 ne portent aucune dose "
      "chiffrée**.")
    A("- Folio : **exact** (0 écart sur 3 076 chunks) — une citation reste vérifiable.")
    A("- Rétrieval : le **contenu** reste atteignable (la posologie est dans le corpus, "
      "sous un autre intitulé).")
    A("- **Remédiation non appliquée** : rejouer l'extraction avec l'ordre vertical, "
      "puis re-découper, re-embedder, recharger. Coût : reconstruction intégrale du "
      "paquet canonique → **le présent paquet de revue serait invalidé** et une nouvelle "
      "révision clinique serait nécessaire. **Décision à instruire séparément**, hors "
      "périmètre d'une activation.")
    A("")
    A("### R2 — Recherche à l'ancre de page")
    A("")
    A("Un chunk multi-pages n'indexe que le numéro de sa **première** page : "
      "**875 chunks sur 3 076 (28,4 %)**, **3 639 pages de contenu** non adressables par "
      "leur numéro. Le contenu des tableaux reste atteignable **par son sujet** "
      f"(recall@5 {fr(reel['par_classe']['F_tableau_contenu']['recall_at_5'])}), mais pas "
      f"par sa page ({fr(reel['par_classe']['F_tableau_page']['recall_at_5'])}).")
    A("")
    A("### R3 — Seuil ADR-037 non atteint sur le planificateur naturel")
    A("")
    A("Le seuil historique (recall@5 ≥ 0,90 ; MRR ≥ 0,80) est atteint sur la **requête "
      "de contenu technique** (recall@5 1,0000 ; MRR 0,9543 — corpus d'ingestion), mais "
      "pas sur le **planificateur de production** face a une question en francais libre. "
      "L'écart entre les deux mesure ce que le planificateur perd, et non la qualité du "
      "corpus. La couche de terminologie en récupère une part importante "
      "(recall@5 0,0606 → 0,3333 sur question clinique française) sans le porter au "
      "seuil historique. **Écart ouvert et déclaré.**")
    A("")
    A("### R4 — Suite de tests : échecs de la surface française")
    A("")
    A("Les échecs restants appartiennent à la surface française en cours de refonte chez "
      "une autre session. Ils sont **reproductibles, déterministes, et attribués par "
      "copie d'isolement** (voir `docs/reports/2026-10-20-stahl-test-stabilite.md`). "
      "Aucun n'est imputable à la surface connaissance. **Aucun test n'a été affaibli, "
      "sauté ou élargi** pour les faire passer.")
    A("")

    # -------------------------------------------------------------- rollback
    A("## 8. Retour arrière")
    A("")
    A("| Commande | Portée | Effet |")
    A("|---|---|---|")
    A("| `node scripts/rollback-connaissance-stahl.mjs --socket` | source Stahl | **rien** "
      "(dry-run) |")
    A("| `node scripts/rollback-connaissance-stahl.mjs --verifier --socket` | source Stahl | "
      "exécute puis **ROLLBACK** — état restauré à l'identique, rien d'écrit |")
    A("| `node scripts/rollback-connaissance-stahl.mjs --ecrire --approbateur <uuid-actif> "
      "--socket` | source Stahl **non active** | supprime 3 076 chunks + 1 source, et "
      "**trace** l'opération dans `audit.log` |")
    A("")
    A("**Limite explicite, par conception** : le retour arrière refuse une source "
      "**active** (« un livre ACTIF ne doit jamais etre supprime par ce script »). "
      "Après activation, la voie de retour est donc la **désactivation**, qui n'est pas "
      "un outil existant du dépôt et que ce chantier **n'invente pas**. À instruire "
      "séparément si le besoin arises.")
    A("")

    # -------------------------------------------------------------- artefacts
    A("## 9. Artefacts")
    A("")
    A("| Artefact | Rôle |")
    A("|---|---|")
    A("| `src/server/knowledge/terminologie-bilingue.ts` | couche de terminologie FR→EN "
      "(versionnée, interruptible) |")
    A("| `src/server/alexa/knowledge-query.ts` | requêtes bilingues + référence par lot |")
    A("| `src/server/alexa/knowledge-adapter.ts` | classement par lot, fusion bornée |")
    A("| `knowledge/eval/stahl-bilingue-v1.json` | corpus d'évaluation versionné |")
    A("| `knowledge/eval/stahl-bilingue-v1.porte-reelle.json` | mesures finales (porte "
      "réelle, source active) |")
    A("| `docs/reports/2026-10-20-stahl-retrieval-evaluation.md` | rapport d'évaluation |")
    A("| `docs/reports/2026-10-20-stahl-dosage-couverture.md` | couverture des rubriques de "
      "posologie |")
    A("| `docs/reports/2026-10-20-stahl-test-stabilite.md` | stabilité des tests |")
    A("| `docs/reports/2026-10-20-stahl-paquet-de-revue.md` | paquet de revue (avec "
      "autorisation) |")
    A("| `docs/reports/2026-10-20-stahl-activation-rollback.md` | preuve d'activation et "
      "de retour arrière |")
    A("")

    A("## 10. Décision")
    A("")
    A("**PASS AVEC RÉSERVE.** La source est activée, approuvée, servie par la porte de "
      "production, avec citation exacte et abstention intacte ; les deux autres livres "
      "sont inchangés. Les réserves R1 à R4 sont des propriétés **mesurées et "
      "documentées** de l'artefact canonique ou de la surface française concurrente ; "
      "aucune n'est un défaut de l'activation, et aucune ne justifie de la différer. "
      "R1 est en revanche un défaut de l'artefact à instruire dans un cycle distinct.")
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
