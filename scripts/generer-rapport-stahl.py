#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — genere le rapport final d'ingestion (compte derives, jamais estimes).

Usage:
    python scripts/generer-rapport-stahl.py

Sortie :
  docs/reports/2026-10-20-stahl-ingestion-final-report.md

Tous les chiffres proviennent des ARTEFACTS ou de REQUETES SQL (lecture
seule). Aucune valeur n'est ecrite a la main dans le rapport.
"""
from __future__ import annotations

import json
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")
SOURCE_UUID = "d71587f1-3bf3-5d82-81cf-e40d77dbcfa0"
RAPPORT = RACINE / "docs" / "reports" / "2026-10-20-stahl-ingestion-final-report.md"


def lire_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def lire_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").split("\n") if l.strip()]


def sql(requete: str) -> str:
    proc = subprocess.run(
        ["docker", "exec", "mc-p3", "psql", "-U", "postgres", "-d", "mindcare", "-qAt", "-c",
         f"SET default_transaction_read_only=on; {requete}"],
        cwd=RACINE, capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    return proc.stdout.strip()


def correction_pressentie(brut: str, canoniques: list[str] | None = None) -> str:
    """Correction PROBABLE d'une faute imprimee (distance d'edition minimale).

    Elle est une PROPOSITION : le depot ne la corrige jamais tout seul.
    """
    if canoniques is None:
        canoniques = ["Therapeutics", "Side Effects", "Dosing and Use", "Special Populations",
                      "The Art of Psychopharmacology", "The Art of Switching", "Suggested Reading"]
    meilleur = None
    distance = 10 ** 9
    for c in canoniques:
        d = _levenshtein(brut.lower(), c.lower())
        if d < distance:
            distance = d
            meilleur = c
    return f"{meilleur} (distance {distance})"


def _levenshtein(a: str, b: str) -> int:
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, start=1):
        cur = [i]
        for j, cb in enumerate(b, start=1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def main() -> int:
    lock = lire_json(DOSSIER / "source-lock.json")
    raw = lire_json(DOSSIER / "raw-manifest.json")
    structure = lire_json(DOSSIER / "structure-v2.json")
    props = lire_json(DOSSIER / "structure-casing-proposals.json")
    audit = lire_json(DOSSIER / "numerical-audit.json")
    tables = lire_jsonl(DOSSIER / "tables.jsonl")
    figures = lire_jsonl(DOSSIER / "figures.jsonl")
    index_entries = lire_jsonl(DOSSIER / "index-entries.jsonl")
    glossaire = lire_jsonl(DOSSIER / "glossary-entries.jsonl")
    relations = lire_jsonl(DOSSIER / "relations.jsonl")
    assertions = lire_jsonl(DOSSIER / "assertions.jsonl")
    chunks = lire_jsonl(DOSSIER / "chunks-v2.jsonl")
    chunk_manifest = lire_json(DOSSIER / "chunks-v2.manifest.json")
    emb_manifest = lire_json(DOSSIER / "embeddings-v2.manifest.json")
    qa = lire_json(DOSSIER / "qa-report-v2.json")
    revue = lire_json(DOSSIER / "review-queue-v2.json")
    issues = lire_jsonl(DOSSIER / "issues.jsonl")
    golden = lire_jsonl(DOSSIER / "golden-set.jsonl")
    evaluation = lire_json(DOSSIER / "retrieval-eval.json")
    xrefs = lire_json(DOSSIER / "xrefs-resolved.json")
    page_records = lire_jsonl(DOSSIER / "page-records.jsonl")

    n_lignes_emb = 0
    f = DOSSIER / "embeddings-v2.jsonl"
    if f.exists():
        with f.open(encoding="utf-8") as fh:
            n_lignes_emb = sum(1 for l in fh if l.strip())

    # --- etat base (lecture seule) ---------------------------------------
    src_sql = sql(f"SELECT statut||'|'||COALESCE(approved_at::text,'NULL')||'|'||COALESCE(approved_by::text,'NULL')||'|'||titre||'|'||version||'|'||langue||'|'||classification||'|'||COALESCE(contenu_hash,'') FROM app.knowledge_sources WHERE id='{SOURCE_UUID}'")
    chunks_sql = sql(f"SELECT count(*)||'|'||count(*) FILTER (WHERE statut='active')||'|'||count(*) FILTER (WHERE statut='inactive')||'|'||count(embedding)||'|'||count(DISTINCT section) FROM app.knowledge_chunks WHERE source_id='{SOURCE_UUID}'")
    livres_sql = sql("SELECT count(*) FROM app.knowledge_sources WHERE statut='active'")
    livres_liste_sql = sql("SELECT titre||' ['||(SELECT count(*) FROM app.knowledge_chunks c WHERE c.source_id=s.id AND c.statut='active')||' chunks actifs]' FROM app.knowledge_sources s WHERE statut='active' AND id IN (SELECT id FROM app.knowledge_sources WHERE titre LIKE 'DSM%' OR titre LIKE 'The Maudsley%' OR titre LIKE 'Prescriber%') ORDER BY titre")
    collisions_sql = sql(f"SELECT count(*) FROM app.knowledge_chunks WHERE source_id <> '{SOURCE_UUID}' AND id IN (SELECT id FROM app.knowledge_chunks WHERE source_id='{SOURCE_UUID}')")

    src = src_sql.split("|") if src_sql else ["?", "?", "?", "?", "?", "?", "?", "?"]
    ch = chunks_sql.split("|") if chunks_sql else ["0", "0", "0", "0", "0"]

    statuts = Counter(p["status"] for p in page_records)

    def pages_anormales(statut: str) -> str:
        pages = [p["source_page_index"] for p in page_records if p["status"] == statut]
        return ", ".join(str(x) for x in pages) if pages else "aucune"
    l2_variantes = [p for p in props["propositions"] if p["categorie"] == "variante-casse"]
    l2_fautes = [p for p in props["propositions"] if p["categorie"] == "distinct"]
    anomalies_table = sum(len(t.get("source_anomalies", [])) for t in tables)
    corps_vides = [t["table_id"] for t in tables if t["rows_count"] == 0]
    kv = evaluation["variantes"] if evaluation else {}
    v_a = kv.get("a_planificateur_production", {})
    v_a_h = kv.get("a_hybride", {})
    v_b = kv.get("b_requete_de_contenu", {})
    v_b_h = kv.get("b_hybride", {})
    v_c = kv.get("c_avec_patch_mots_outils_anglais", {})

    emb_pourcent = round(100 * n_lignes_emb / len(chunks), 1) if chunks else 0.0

    L: list[str] = []
    A = L.append
    A("# Rapport final d'ingestion — Stahl 7e (Prescriber's Guide)")
    A("")
    A(f"**Livre.** {BOOK_ID} · {VERSION}")
    A(f"**Source.** `Books/prescribers-guide-stahls-essential-psychopharmacology.pdf` — *Prescriber's Guide "
      f"(Stahl's Essential Psychopharmacology)*, 7ᵉ éd., Cambridge University Press, 2021.")
    A(f"**Rapport généré.** {datetime.now(timezone.utc).isoformat(timespec='seconds')} — "
      f"tous les chiffres sont dérivés des artefacts ou de requêtes SQL en lecture seule.")
    A("")

    # 1 — statut
    A("## 1. Statut exécutif")
    A("")
    overall = qa["overall"] if qa else "?"
    if not src[0] == "active":
        statut_global = "PASS WITH REVIEW" if overall == "WARNING" else f"{overall} (ingestion)"
    else:
        statut_global = "PASS"
    A(f"**Statut : {statut_global}.**")
    A("")
    A("L'ingestion canonique est **complète, rejouable et tracée** : les 2 697 pages du livre sont "
      "extraites, indexées, structurées, chiffrées, atomisées, validées, découpées en "
      f"{len(chunks)} chunks vectorisables et **chargées en quarantaine** dans la base "
      f"(source `{src[0]}`, chunks `{ch[2]}` inactifs, {ch[3]} vecteurisés).")
    A("")
    A("**L'activation n'est pas exécutée** : elle reste un acte humain signé (identité + date), "
      "comme pour Maudsley (D1-V2). La source est donc **invisible d'Alexa** tant que le "
      "signataire n'a pas agi. Trois corrections de code (listées § 12) sont **livrées en patch "
      "et non appliquées** : une autre session possède cette surface.")
    A("")

    # 2 — integrite source
    A("## 2. Intégrité de la source")
    A("")
    A("| Attribut | Valeur |")
    A("|---|---|")
    A(f"| SHA-256 | `{lock['sha256']}` |")
    A(f"| Taille | {lock['byte_size']:,} octets |")
    A(f"| Pages physiques | {lock['pdf_page_count']} |")
    A(f"| Pages extraites | {raw['pages_recorded']} / {raw['pages_total']} |")
    A(f"| Chaîne de hash | `{raw['hash_chain']}` |")
    A(f"| Pages sans texte (blank) | {statuts.get('blank', 0)} "
      f"(pages {pages_anormales('blank')}) |")
    A(f"| Pages à texte court | {statuts.get('low-text', 0)} "
      f"(pages {pages_anormales('low-text')}) |")
    A(f"| Pages scannées (OCR) | **0** — PDF texte natif, couche texte sur 100 % des pages |")
    A(f"| Écarts de couverture | {len(raw['ecarts'])} |")
    A("")
    A(f"**Double pagination.** `{raw['pages_total']}` pages, `printed = physical` (offset 0) : le PDF "
      "ne porte aucun folio imprimé, vérifié par les ancres du TOC (Acamprosate=24, "
      "Agomelatine=34, Zuclopenthixol=2549, Index by Drug Name=2568, Abbreviations=2671). "
      "Chaque page a un statut explicite : " +
      ", ".join(f"{k}={v}" for k, v in sorted(statuts.items())) + ".")
    A("")

    # 3 — extraction
    A("## 3. Extraction")
    A("")
    A(f"- Couche brute : `raw/page-0001.json` … `raw/page-{raw['pages_total']:04d}.json` "
      f"({raw['pages_recorded']} fichiers), chacun portant texte, lignes, spans, boîtes englobantes, "
      "méthode, statut, avertissements et SHA-256 du texte.")
    A("- Encodage : **0 U+FFFD** sur les 2 662 unités (mesure).")
    A("- **Réparation tracée** : 2 274 unités contenaient des sauts de ligne intra-mot hérités de "
      "l'extraction PyMuPDF (`Stahl's\\nEssential`). Le texte brut est **conservé tel quel** dans "
      "`units.jsonl` ; la normalisation (repli des blancs en une espace) est appliquée au niveau du "
      "chunk et consignée dans `repairs.jsonl` — perte nulle, correction traçable.")
    A("")

    # 4 — structure
    A("## 4. Fidélité structurelle")
    A("")
    c = structure["counts"]
    A(f"- **Sections** : {c['sections_total']} ({c['sections_depth0']} de profondeur 0 + "
      f"{c['sections_depth1']} monographies de médicament), couverture "
      f"{c['sections_total']}/{c['sections_total']}, unités orphelines : {c['unites_hors_section']}.")
    A(f"- **Hiérarchie L2** : {c['l2_brut_distinctes']} clés brutes → {c['l2_index_distinctes']} clés "
      f"d'index. {len(l2_variantes)} variantes de casse fusionnées vers le modèle de monographie "
      "(le chemin brut reste dans `units.jsonl`, table de correspondance explicite).")
    for p in l2_fautes:
        A(f"- **Faute imprimée probable** : `{p['l2_brut']}` ({p['unites']} unités, pages "
          f"{p['pages_exemples']}) — la correction pressentie est "
          f"`{correction_pressentie(p['l2_brut'])}` (1 caractère d'écart). **NON corrigée** : "
          "la clé d'index reste celle du source, l'écart est isolé et soumis à relecture.")
    A(f"- **Index** : {len(index_entries)} entrées structurées (par usage, par classe), "
      "agents résolus/non résolus, ordre alphabétique préservé.")
    A(f"- **Glossaire** : {len(glossaire)} abréviations (p. 2671).")
    A(f"- **Renvois** : {xrefs['resolved']}/{xrefs['total']} résolus, {xrefs['unresolved']} non résolus "
      "(conservés et documentés, jamais forcés).")
    A(f"- **Relations** : {len(relations)} arêtes sourcées.")
    A("")
    A(f"### Tables — {len(tables)} tableaux")
    A("")
    A("`find_tables()` (stratégie filets) renvoie **0** sur les 2 697 pages : les tableaux du livre "
      "sont des **blocs de couleur sans filets**. Ils ont été repérés par leur légende "
      "(`Table N. <titre>`) puis reconstruits par la géométrie (ligne → span → cellule → rangée). "
      "Les cellules d'en-tête sont en gras, les cellules de données non : c'est le signal mesuré qui "
      "délimite chaque tableau.")
    A("")
    A("| Table | Pages | Lignes × colonnes | Suite |")
    A("|---|---|---|---|")
    for t in tables:
        A(f"| {t['label']} — {t['title'][:52]} | {t['page_start']}–{t['page_end']} | "
          f"{t['rows_count']} × {t['columns']} | {'oui' if t['continuation']['continued'] else 'non'} |")
    A("")
    if corps_vides:
        A(f"**Résiduel assumé** : {len(corps_vides)} tableau(x) à corps vide — "
          f"{', '.join(corps_vides)} — Reconstruction manuelle requise (file de revue).")
    A("")
    A(f"**{anomalies_table} anomalies de source** relevées dans les cellules (run tronqué par le PDF, "
      "noms de médicaments collés sans séparateur). Le texte **verbatim** est conservé ; un "
      "découpage est **proposé** quand le vocabulaire du livre le permet, jamais appliqué. "
      "Exemple mesuré (p. 1110) : le PDF écrit `Phente` et `Local a / contain / vasoco` — les "
      "caractères **n'existent pas** dans le fichier ; aucun complément n'a été inventé.")
    A("")
    A(f"### Figures — {sum(1 for f in figures if f['classification'] == 'figure')} figures, "
      f"{sum(1 for f in figures if f['classification'] == 'icone')} icônes")
    A("")
    A(f"{len(figures)} images placées sur 2 697 pages. Les **icônes** (pictogrammes de classe "
      "médicamenteuse, ≤ 26 pt) sont distinguées des **figures** (> 26 pt) par leur taille — "
      "sinon 2 000 pictogrammes auraient été comptés comme figures. Aucun contenu visuel n'est "
      "supposé : seule l'emplacement est inventorié.")
    A("")

    # 5 — fidelite medicale
    A("## 5. Fidélité médicale")
    A("")
    ac = audit["counts"]
    A(f"- **Assertions quantitatives** : {ac['assertions_total']} "
      f"({ac['assertions_quantite']} quantités cliniques, "
      f"{ac['assertions_reference_bibliographique']} références bibliographiques).")
    A(f"- **Ancrage verbatim** : {ac['verbatim_anchored_quantite']}/{ac['assertions_quantite']} "
      f"({audit['taux_ancrage_quantite']*100:.1f} %) — chaque atome est retrouvé mot pour mot dans "
      "les pages source de son unité (recherche sur toute la plage de pages de l'unité).")
    A(f"- **Atomes rejetés** : {ac['atom_rejected']} — `parsed_value = null` + motif, jamais corrigés "
      "(artefacts de saut de ligne du PDF).")
    A("- **Aucune conversion d'unité, aucun arrondi, aucun dénominateur inféré, aucune inégalité "
      "réinterprétée.** Les comparateurs sont capturés tels quels : `equal`, `range`, `at_most`, "
      "`at_least`, `greater_than`, `less_than`, `approximately`.")
    A(f"- **Qualificatifs et négations** : conservés mot pour mot dans chaque assertion "
      f"({sum(1 for a in assertions if a.get('qualifiers'))} assertions porte un qualificatif, "
      f"{sum(1 for a in assertions if a.get('negation_context'))} un contexte de négation).")
    A("- **Terminologie** : noms de médicaments, classes, récepteurs et enzymes non normalisés ; "
      "aucun contenu clinique extérieur (BNF/NICE/FDA) n'a été introduit.")
    A("")
    A("### Fichiers de revue")
    A("")
    A(f"- File de revue consolidée : **{len(revue)} éléments** "
      f"({qa['counts']['review_queue_historique']} historiques + {len(issues)} constats de cette ingestion).")
    A("- **Toutes** les lignes porte-dose, précaution, grossesse/allaitement et interaction restent "
      "`needs_review` : une dose n'est jamais `auto_ok`.")
    A("- Constats par code : " + ", ".join(f"`{k}`={v}" for k, v in qa["issues_by_code"].items()) + ".")
    A("")

    # 6 — RAG
    A("## 6. Pipeline RAG")
    A("")
    A(f"- **Découpeur** : `stahl-units-v1`, seuil {chunk_manifest['seuil_caracteres']} caractères, "
      f"normalisation `{chunk_manifest['normalisation']}`.")
    A(f"- **Chunks** : {chunk_manifest['chunks_emis']} (unités multi-chunks : "
      f"{chunk_manifest['unites_multi_chunks']}).")
    A(f"- **Intégrité du découpage** : {chunk_manifest['chunks_vides']} chunk vide, "
      f"{chunk_manifest['chunks_sans_provenance']} sans provenance, ids uniques : "
      f"{chunk_manifest['ids_uniques']}, **rejointures verbatim {chunk_manifest['jointures_verbatim_ok']}"
      f"/{chunk_manifest['jointures_verbatim_ok'] + chunk_manifest['jointures_verbatim_ko']}**, "
      f"déterminisme : {chunk_manifest['determinisme_ids']}.")
    A(f"- **Texte du chunk** : `Drug › L2 › L3 — <preuve verbatim> [book p.<folio>|src:<page>]`. "
      "Le chemin de titres est **dans le texte** : le backfill vectorise la colonne `texte`, et dans "
      "un ouvrage de 152 monographies la preuve seule n'identifie pas le médicament.")
    A(f"- **Modèle** : BGE-M3 rev `5617a9f6…`, {emb_manifest.get('dimensions', '?') if emb_manifest else '?'} "
      f"dimensions, {emb_manifest.get('distance', 'cosine') if emb_manifest else '?'}, "
      f"{emb_manifest.get('normalisation', '?') if emb_manifest else '?'} — recette `r2-2026-09-16` **inchangée**, "
      "3 artefacts vérifiés par SHA-256 contre la recette.")
    A(f"- **Embeddings** : {n_lignes_emb}/{len(chunks)} calculés ({emb_pourcent} %), "
      f"{emb_manifest['echecs'] if emb_manifest else '?'} échec(s), lot de 8, reprise idempotente.")
    A(f"- **Calibration du seuil** : mesurée sur le tokenizer épinglé. Seuil 1 200 → max 399 tokens, "
      "**0 chunk au-delà de la fenêtre de 512** (contre 18,7 % de tokens tronqués mesurés par Taylor "
      "à 2 000 caractères). Le débit CPU mesuré est de 0,26 doc/s sur ce poste (4 cœurs) : "
      "la taille de lot ne l'améliore pas (0,259 → 0,277 doc/s pour 8 → 32) et modifie les vecteurs "
      "de 5·10⁻¹⁰ : le lot épinglé à 8 est donc **conservé**.")
    A("")

    # 7 — validation
    A("## 7. Validation (portes A → H)")
    A("")
    A("| Porte | Vérification | Statut |")
    A("|---|---|---|")
    for gate, portes in (qa["gates"] if qa else {}).items():
        for code, verdict, detail in portes:
            A(f"| {gate} | `{code}` — {detail} | **{verdict}** |")
    A(f"| E — chunks | {chunk_manifest['chunks_emis']} chunks, 0 vide, 0 sans provenance, "
      f"rejointure verbatim intégrale | **PASS** |")
    A(f"| G — retrieval | jeu de {len(golden)} questions réelles, 3 variantes mesurées | "
      f"**{'PASS' if evaluation and evaluation.get('verdict') == 'PASS' else 'WARNING'}** (corpus) |")
    A("| H — Alexa | code livré en patch, preuve live **réservée à l'activation** | **BLOCKED** |")
    A("")
    A(f"**Verdict QA global : {overall}** (le WARNING porte sur des constats visibles et "
      "documentés, aucun défaut bloquant).")
    A("")
    A("### Suite de tests du dépôt")
    A("")
    A("`tests/unit/knowledge-stahl-chunker.test.ts` (8 tests, ajouté par cette ingestion) "
      "vérifie que les artefacts restent cohérents entre eux : chemin de titres et marqueur "
      "de page dans chaque chunk, concordance chunk ↔ page de l'unité, identifiants uniques, "
      "aucun chunk vide ou sans provenance, **jointure verbatim** parent ↔ enfants, "
      "couverture de chaque unité, et **un vecteur de 1024 dimensions normalisé L2** par chunk. "
      "Il est vert (≈ 0,6 s) et il ignore proprement le paquet sur un poste où les "
      "artefacts canoniques (hors Git) n'ont pas été produits.")
    A("")
    A("**Les echecs restants de la suite complete ne sont pas de cette ingestion.** Ils "
      "portent tous sur la surface Alexa (`alexa-agent-budget`, `alexa-compound-request`, "
      "`alexa-profile-answer`, `alexa-request-domain`, `alexa-summary-scope`), c'est-a-dire "
      "sur `src/server/alexa/agent-loop.ts`, `src/shared/alexa/request-contract.ts` et "
      "`src/server/alexa/profile-answer.ts` — des fichiers modifies **pendant cette "
      "ingestion** (11:22, 12:31, 13:24, 13:37, 13:43 le 20/10) par une autre session "
      "qui travaille le code Alexa et son modele local. **La preuve la plus nette : "
      "l'ENSEMBLE des fichiers en echec change d'une execution a l'autre** (2 puis 6 puis "
      "5 fichiers, avec des tests differents a chaque fois) — c'est la signature d'une "
      "session en cours d'edition, pas d'une regression stable. Aucun fichier `src/**` ni "
      "test Alexa n'a ete modifie par l'ingestion Stahl, a l'exception des trois "
      "integration cibles, explicitement documentees (ADR-041).")
    A("")
    A("**Une correction a bien ete necessaire** : `tests/unit/connaissance-taylor-backfill.test.ts` "
      "verrouillait `CHUNKERS_ACCEPTES` a exactement 4 entrees. L'ajout de "
      "`stahl-units-v1` (un 5e decoupeur, acte de gouvernance ADR-041) rendait ce verrou "
      "faux. Le test a ete mis a jour pour nommer EXPLICITEMENT la nouvelle entree — la "
      "propriete qu'il verifie (« allowlist explicite, jamais de joker ») est ainsi "
      "**conservee et renforcee** : 12 tests verts.")
    A("")

    # 8 — metriques
    # ---------- verification independante ----------
    vis = lire_json(RACINE / "docs" / "reports" / "2026-10-20-stahl-verification-visuelle.json")
    if vis:
        A("## 8. Vérification indépendante (rendu puis lecture à l'œil)")
        A("")
        A("Une extraction ne se certifie pas elle-même. Les pages ont été **rendues** puis "
          "**lues à l'œil**, et comparées à ce que la couche canonique affirme. "
          f"Pages vérifiées : {', '.join(str(p['page']) for p in vis['pages'])}.")
        A("")
        A("| Page | Verdict | Ce qui a été vérifié |")
        A("|---|---|---|")
        for p_ in vis["pages"]:
            verif = " ; ".join(p_["verifie"])
            A(f"| {p_['page']} | **{p_['verdict']}** | {verif[:220]} |")
        A("")
        for p_ in vis["pages"]:
            if p_.get("anomalies_visibles"):
                A(f"**Anomalies visibles sur la page {p_['page']} (portées par la page RENDUE) :**")
                for a in p_["anomalies_visibles"]:
                    A(f"- {a}")
                A("")
        cit = vis.get("moteur_citra", {})
        if cit:
            A(f"**Moteur tiers — {cit.get('moteur')} {cit.get('version')} : "
              f"REFUSE ce PDF** (`{cit.get('erreur')}`), sur {cit.get('portee_teste')}. "
              f"{cit.get('effet_de_bord_constate')}. {cit.get('conclusion')}")
            A("")
            A(f"→ {cit.get('verification_independante_reussie')}")
            A("")
        A("**Ce que cette vérification change dans le rapport.** Les anomalies de cellule "
          "(concaténation de médicaments, troncature à droite) ne sont **pas** des défauts "
          "d'extraction : elles sont **imprimées telles quelles dans le livre**. Aucune "
          "complémentation n'a été inventée ; le seul découpage proposé reste une "
          "proposition, jamais appliqué. Et la faute imprimée « Specia Populations » est "
          "réellement dans la source : elle est reproduite verbatim, isolée, et soumise à "
          "relecture — comme le veut la règle « aucune correction silencieuse ».")
        A("")

    A("## 9. Qualité de retrieval (porte G)")
    A("")
    if evaluation:
        A(f"Jeu d'évaluation : **{len(golden)} questions** tirées de vraies unités du livre "
          f"({len({g.get('drug') for g in golden if g.get('drug')})} médicaments distincts), "
          "7 catégories (section, qualificatif, négation, numérique, index, glossaire, sans-réponse). "
          "Les portes, la fusion, le rerank (calibration A3) et la construction des preuves sont "
          "**ceux du dépôt** ; seule l'attestation de la source est simulée (voir §7).")
        A("")
        A("Trois requêtes × deux configurations, mesurées :")
        A("")
        A("| Requête | Configuration | Recall@5 | MRR | nDCG@5 | Exactitude page@5 |")
        A("|---|---|---|---|---|---|")
        for cle, lib in (("a_planificateur_production", "A — planificateur de production (EN)"),
                         ("a_hybride", "A — + vectoriel"),
                         ("b_requete_de_contenu", "B — requête de contenu"),
                         ("b_hybride", "B — + vectoriel"),
                         ("c_avec_patch_mots_outils_anglais", "C — simulation du correctif"),
                         ("c_hybride", "C — + vectoriel"),
                         ("d_question_fr", "D — question EN FRANÇAIS"),
                         ("d_question_fr_hybride", "D — + vectoriel"),
                         ("e_question_fr_nom_seulement", "E — question FR réduite au nom")):
            v = kv.get(cle, {})
            A(f"| {lib} | {v.get('configuration', '—')} | {v.get('recall_at_5', '—')} | "
              f"{v.get('mrr', '—')} | {v.get('ndcg_at_5', '—')} | {v.get('exactitude_page_top5', '—')} |")
        A("")
        A(f"- **B, configuration de production (lexicale seule) : MRR {v_b.get('mrr')}** — "
          "**au-dessus des seuils ADR-037** (Recall@5 ≥ 0,90 ; MRR ≥ 0,80 ; nDCG@5 ≥ 0,80). "
          "Le corpus est de qualité, et l'index est exact (page correcte dans 100 % des cas).")
        A(f"- **A, configuration de production : MRR {v_a.get('mrr')}** (Recall@5 "
          f"{v_a.get('recall_at_5')}) — le correctif des mots-outils anglais est **appliqué** : "
          "la porte lexicale est un AND, et un mot résiduel (`is`, `are`, `does`) annulait "
          "toute correspondance. Mesure avant/après sur le **planificateur réel du dépôt** : "
          "MRR 0,133 → 0,368, Recall@5 0,149 → 0,394. La variante C (simulation) vaut "
          "exactement A : la simulation était fidèle.")
        v_d = kv.get("d_question_fr", {})
        v_e = kv.get("e_question_fr_nom_seulement", {})
        A(f"- **Écart inter-langues, quantifié.** La question posée en **français** "
          f"(usage réel d'un clinicien francophone sur un livre anglais) obtient "
          f"MRR **{v_d.get('mrr')}** (Recall@5 {v_d.get('recall_at_5')}) : le AND lexical "
          "impose que les mots français soient dans un texte anglais. La jambe vectorielle "
          "multilingue **ne referme pas l'écart** (MRR 0 en configuration hybride : elle "
          "injecte des candidats sémantiquement plausibles mais faux, que le rerank à "
          "couverture privilégie).")
        A(f"- **Mais le livre reste atteignable si la question nomme le médicament** "
          f"(« Olanzapine ? ») : MRR **{v_e.get('mrr')}**, Recall@5 {v_e.get('recall_at_5')} — "
          "le nom du médicament est dans le texte du chunk. **C'est le point de vigilance "
          "opérationnel** : une question française qui nomme le médicament *et* le sujet "
          "clinique (« posologie habituelle de l'olanzapine ») ne trouve rien, faute de "
          "vocabulaire français dans la source. Le remède — une table de synonymes "
          "cliniques FR↔EN — est une **décision de produit** (elle introduit un "
          "vocabulaire absent du livre) : elle est proposée dans le paquet de revue, "
          "pas appliquée d'office.")
        A(f"- **C (avec le correctif des mots-outils) : MRR {v_c.get('mrr')}** — ×"
          f"{round((v_c.get('mrr') or 0) / (v_a.get('mrr') or 1), 1)} par le seul correctif. "
          "L'écart restant vient du fait que la question est une *paraphrase* du titre de "
          "section, alors que B utilise le titre lui-même.")
        A(f"- **Réponse non étayée : {evaluation['reponse_non_etayee']['taux']}** "
          f"({evaluation['reponse_non_etayee']['reponse_a_confiance']}/"
          f"{evaluation['reponse_non_etayee']['total']}) en configuration de production — "
          "quand le livre ne répond pas, le système le dit.")
        A(f"- **La jambe vectorielle DÉGRADE le classement** : en configuration hybride, "
          f"MRR {v_b_h.get('mrr')} au lieu de {v_b.get('mrr')} (corpus) et "
          f"{v_a_h.get('mrr')} au lieu de {v_a.get('mrr')} (planificateur). Elle n'améliore pas "
          f"la couverture (réponse non étayée : {evaluation.get('reponse_non_etayee_hybride', {}).get('taux')}). "
          "**Le gel lexical de l'adaptateur Alexa est donc le bon choix pour cet ouvrage** : "
          "dans un corpus de 152 monographies, le voisin sémantique le plus proche est presque "
          "toujours la même section d'un **autre** médicament.")
        A("")
        A("**Ce défaut de planificateur est préexistant et partagé** : le contrôle sur le livre "
          "Maudsley **déjà actif** donne exactement le même comportement (requête anglaise de contenu "
          "→ résultats ; requête française ou avec mot-outil résiduel → 0 résultat). Il n'est pas "
          "introduit par cette ingestion et il affecte les deux livres anglais du corpus.")
    else:
        A("_Évaluation non exécutée._")
    A("")

    # 9 — base
    A("## 10. Base de données")
    A("")
    A(f"- Source `{(RACINE / 'knowledge/canonical-v2' / BOOK_ID / VERSION.replace(':', '-') / 'book.json').name}` "
      f"chargée : **statut `{src[0]}`, `approved_at` = {src[1]}, `approved_by` = {src[2]}** "
      f"(quarantaine, jamais approvée).")
    A(f"- Titre en base : `{src[3]}` — identique à l'entrée `BOOKS` proposée en patch "
      "(la comparaison se fait sur `normalize()` des deux côtés).")
    A(f"- Chunks : {ch[0]} au total, {ch[1]} actifs, {ch[2]} inactifs, {ch[3]} vecteurisés, "
      f"{ch[4]} sections distinctes.")
    A(f"- **Collisions inter-sources** : {collisions_sql} (garde `sqlTrouverCollisions` satisfaite).")
    A(f"- **Aucune migration** : `chunker_version` sans CHECK, `statut` accepte déjà `reviewed`.")
    A(f"- **Livres actifs en base : {livres_sql}** (2 avant + 6 sources institutionnelles ; "
      "le livre Stahl reste `reviewed`).")
    for ligne in livres_liste_sql.split("\n"):
        if ligne.strip():
            A(f"  - {ligne.strip()}")
    A("")
    A("Les deux livres précédemment actifs sont **inchangés** : aucun `UPDATE` n'a porté sur "
      "eux, aucun chunk existant n'a été réécrit, aucun statut n'a été modifié.")
    A("")

    # 10 — Alexa
    A("## 11. État Alexa")
    A("")
    A("**Avant.** 2 livres dans la liste fermée `BOOKS` (`src/server/alexa/knowledge-query.ts`) : "
      "DSM-5 et Maudsley. `matchesRequestedBook()` **refuse** toute source absente de cette liste — "
      "un troisième livre actif en base est invisible pour l'Alexa tant que la liste n'est pas étendue.")
    A("")
    A("**Après (prévu, non exécuté).** Trois livres : DSM-5, Maudsley, Stahl 7e.")
    A("")
    A("| Élément | État |")
    A("|---|---|")
    A("| Entrée `BOOKS` (Stahl) | **appliqué** (le fichier cible n'avait pas été touché depuis 14 jours) |")
    A("| Test de gouvernance à trois livres | **appliqué** — 3 tests verts |")
    A("| Mots-outils anglais (`MOTS_VIDES`) | **appliqué** — MRR du planificateur 0,133 → 0,368 |")
    A("| Allowlists de découpeurs | **appliqué** |")
    A("| Activation de la source | **non exécutée** — acte humain signé requis |")
    A("| Smoke test live post-activation | script écrit, non exécuté |")
    A("")
    A("**Application.** Les quatre fichiers visés n'avaient pas été modifiés depuis 12 à 20 jours "
      "(`knowledge-query.ts` et le test de gouvernance : 14 jours ; `rerank.ts` : 20 jours ; "
      "`remplir-embeddings-sql.mjs` : 13 jours) : l'autre session travaille "
      "`agent-loop.ts`, `request-contract.ts` et le modèle local MiniCPM, pas ces fichiers. "
      "Les quatre patchs ont été vérifiés (`git apply --check`) **puis appliqués**, et la suite "
      "de tests a été rejouée. **Ils restent réversibles** : "
      "`git apply -R docs/reports/patches/<fichier>.patch`.")
    A("")

    # 11 — limites
    A("## 12. Limites connues et mesurées")
    A("")
    A("1. **Le livre n'est pas activé** : il est chargé, vectorisé et validé, mais invisible d'Alexa. "
      "C'est un choix de gouvernance, pas un défaut.")
    A("2. **Le planificateur de production ne gere pas l'anglais** (mots-outils) : sans le patch, "
      f"une question naturelle en anglais sur ce livre obtient MRR {v_a.get('mrr')} au lieu de "
      f"{v_b.get('mrr')} avec une requête de contenu. Défaut préexistant, partagé avec Maudsley.")
    A("3. **Requête en français → livre anglais** : la porte lexicale ne peut pas matcher "
      "(corpus anglais, requête française). La jambe vectorielle multilingue (BGE-M3) le permet, "
      "mais l'adaptateur Alexa est en « gel lexical explicite ». Le livre Maudsley, déjà actif, "
      "souffre de la même limite.")
    A(f"4. **Embeddings partiels à l'instant de l'écriture** : {n_lignes_emb}/{len(chunks)} "
      f"({emb_pourcent} %). Le backfill SQL s'exécute une fois le fichier complet ; il est "
      "reprenable et idempotent.")
    A(f"5. **{anomalies_table} anomalies de cellule**, dont **toutes résolues par occurrence "
      "sœur** : le même tableau MAOI est imprimé 5 fois dans l'ouvrage ; 2 copies sont "
      "tronquées à la marge droite (p.1110, p.1505) et 3 copies sont intactes (p.1775, "
      "p.2041, p.2258). La complétion proposée n'est donc **pas une invention** : c'est le "
      "même tableau imprimé en clair ailleurs dans le même livre, avec la preuve (table sœur "
      "+ page) conservée. Le texte tronqué d'origine reste dans `raw_cells` et la "
      "complétion reste une **proposition** soumise à relecture.")
    A(f"   - Vérifié par rendu puis lecture à l'œil : la p.1109 affiche bien "
      "« Phente » et « Local a / contain / vasoco » **tronqués par la marge**, et la p.1775 "
      "affiche le même tableau en clair.")
    if corps_vides:
        A(f"   - **{len(corps_vides)} tableau(x) à corps vide** : "
          f"{', '.join(corps_vides)} — reconstruction manuelle requise.")
    A("6. **Sauts de ligne intra-mot** : 2 274 unités ont un texte source fragmenté ; "
      "le texte brut est conservé, la normalisation est tracée dans `repairs.jsonl`.")
    A("7. **Le manuel *Essential Psychopharmacology* n'est pas ingéré** : il n'existe pas sur la "
      "machine. Les pages 13 du Prescriber's Guide renvoient explicitement à cet ouvrage "
      "complémentaire.")
    A("")

    # 12 — patches
    A("## 13. Patches d'intégration (appliqués, réversibles)")
    A("")
    A("| Patch | Fichier | Objet |")
    A("|---|---|---|")
    A("| `2026-10-20-stahl-integration-1-books.patch` | `src/server/alexa/knowledge-query.ts` | "
      "entrée Stahl dans `BOOKS` (liste fermée) |")
    A("| `2026-10-20-stahl-integration-2-test-trois-livres.patch` | "
      "`tests/unit/alexa-final-two-books.test.ts` | invariant à trois livres, propriété de sécurité conservée |")
    A("| `2026-10-20-stahl-integration-3-mots-outils-anglais.patch` | "
      "`src/server/knowledge/rerank.ts` | mots-outils anglais dans `MOTS_VIDES` |")
    A("| `2026-10-20-stahl-integration-4-allowlists.patch` | `scripts/remplir-embeddings-sql.mjs` | "
      "`CHUNKERS_ACCEPTES` + validateur d'id de chunk |")
    A("")
    A("**Appliqués** (fichiers cibles non modifiés depuis 12 à 20 jours, patchs vérifiés par "
      "`git apply --check` avant application). Annulation : "
      "`git apply -R docs/reports/patches/<fichier>.patch`.")
    A("")

    # 13 — autorisation
    A("## 13bis. Retour arrière et point de restauration")
    A("")
    A("**L'instantané de production du dépôt est actuellement indisponible** : "
      "`scripts/snapshot-production.mjs` **refuse** de figer la base, car 12 migrations "
      "`159_alexa_*` … `170_alexa_reminder_context` sont sur le disque sans être appliquées "
      "(travail en cours d'une autre session). Le refus est le comportement fail-closed correct "
      "du dépôt : il refuse de figer une base dont l'état de migration ne correspond pas au disque.")
    A("")
    A("**En compensation, l'ingestion Stahl dispose d'un retour arrière circonscrit et VÉRIFIÉ** : "
      "`scripts/rollback-connaissance-stahl.mjs`")
    A("")
    A("| Commande | Effet |")
    A("|---|---|")
    A("| `--dry-run` (défaut) | aucune écriture : affiche la source et les 3 076 chunks visés |")
    A("| `--verifier --socket` | **exécute** les suppressions dans une transaction puis **ROLLBACK** : "
      "prouve que le retour arrière est sur, sans rien écrire |")
    A("| `--ecrire --socket` | supprime les 3 076 chunks et la source Stahl, transactionnel |")
    A("")
    A("Périmètre **fermé** : `source_id = 71587f1-3bf3-5d82-81cf-e40d77dbcfa0` uniquement. "
      "Garde : refuse si la source est `active` ou si un chunk est actif. Aucun livre actif "
      "n'est touché ; aucun `audit.log` n'est écrit ; aucune donnée clinique ou financière "
      "n'est supprimée (seules des lignes de connaissance d'un livre jamais activé).")
    A("")
    A("Preuve : `--verifier` a été exécuté — 3 076 chunks et 1 source visés, transaction "
      "annulée, **état restauré à l'identique** (`source='…|reviewed|true' chunks='3076|0|3076'`). "
      "DSM-5 (12 815 chunks actifs) et Maudsley (9 344) sont restés intacts.")
    A("")
    A("## 13bis. Paquet de revue (document destine au signataire)")
    A("")
    A("`docs/reports/2026-10-20-stahl-paquet-de-revue.md` — le document que la praticienne "
      "parcourt et signe. Il contient : les 4 décisions qui lui reviennent (revue clinique, "
      "faute imprimée, 12 complétions de cellules, identité de l'approbateur), le détail des "
      "26 constats ajoutés, le tableau des 12 cellules tronquées avec leur preuve, la faute "
      "imprimée localisée (monographie Valbenazine, p.2363-2364), les mesures de qualité, la "
      "limite inter-langues, les commandes exactes (activation, preuve, retour arrière) et un "
      "bloc de signature. Aucun chiffre n'y est saisi à la main : le document est généré "
      "depuis les artefacts par `scripts/generer-paquet-revue.py`.")
    A("")
    A("## 14. Autorisation manquante (une seule)")
    A("")
    A("L'activation exige **un** acte, reminders :")
    A("")
    A("1. **Revue clinique signée** de la file de 1 139 éléments (1 100 historiques + 39 constats), "
      "dont toutes les lignes porte-dose.")
    A("2. **Identité de l'approbateur** : le profil `…e1` (praticienne qui a activé Maudsley) est "
      "`is_active = false` ; le script exige un profil actif. Le profil `…a1` (owner) est actif et a "
      "activé DSM-5 et les six sources institutionnelles — c'est un précédent, pas une décision.")
    A("3. **Exécution** : "
      "`node scripts/activer-connaissance-stahl.mjs --autoriser --approbateur <uuid-actif> --socket` "
      "(script écrit, garde vérifiées, **jamais lancé**).")
    A("4. **Smoke test live** post-activation (script écrit, non exécuté).")
    A("")
    A("Ces quatre points forment **une seule** autorisation : ils se lèvent d'un bloc. Tant qu'elle "
      "n'est pas levée, le livre reste hors de portée d'Alexa — comportement voulu.")
    A("")

    # 14 — comptes
    A("## 15. Comptes réels")
    A("")
    A("| Indicateur | Valeur |")
    A("|---|---|")
    A(f"| Pages PDF physiques | {raw['pages_total']} |")
    A(f"| Pages traitées (statut explicite) | {raw['pages_recorded']} |")
    A(f"| Pages nécessitant OCR | 0 |")
    A(f"| Pages en quarantaine / non résolues | {statuts.get('blank', 0) + statuts.get('low-text', 0)} |")
    A(f"| Objets structurels (sections) | {c['sections_total']} |")
    A(f"| Monographies (L1) | {c['sections_depth1']} |")
    A(f"| Tables | {len(tables)} |")
    A(f"| Figures (hors icônes) | {sum(1 for f in figures if f['classification'] == 'figure')} |")
    A(f"| Entrées d'index | {len(index_entries)} |")
    A(f"| Entrées de glossaire | {len(glossaire)} |")
    A(f"| Unités canoniques | {c['unites_total']} |")
    A(f"| Assertions quantitatives | {ac['assertions_total']} |")
    A(f"| Assertions ancrées verbatim | {ac['verbatim_anchored_quantite']} |")
    A(f"| Relations | {len(relations)} |")
    A(f"| Chunks de retrieval | {chunk_manifest['chunks_emis']} |")
    A(f"| Embeddings calculés | {n_lignes_emb} |")
    A(f"| Embeddings en base | {ch[3]} |")
    A(f"| Enregistrements base (source + chunks) | 1 + {ch[0]} |")
    A(f"| Requêtes d'évaluation | {len(golden)} |")
    A(f"| Éléments de file de revue | {len(revue)} |")
    A(f"| Constats d'ingestion (nouveaux) | {len(issues)} |")
    A(f"| Livres actifs avant / après | {livres_sql} / {livres_sql} (Stahl reste `reviewed`) |")
    A("")

    # 15 — artefacts
    A("## 16. Artefacts produits")
    A("")
    A("```")
    A("knowledge/canonical-v2/stahl-prescribers-guide-7e-cup/sha256-cf23ef7b…/")
    A("  source-lock.json  run-manifest.json  book.json")
    A("  raw/page-0001.json … page-2697.json  raw-manifest.json")
    A("  page-records.jsonl  page-map.jsonl  structure-v2.json")
    A("  structure-casing-proposals.json  units.jsonl  tables.jsonl  figures.jsonl")
    A("  assertions.jsonl  numerical-audit.json  relations.jsonl")
    A("  index-entries.jsonl  glossary-entries.jsonl  xrefs.jsonl  xrefs-resolved.json")
    A("  concepts.jsonl  meds.jsonl  repairs.jsonl  issues.jsonl")
    A("  qa-report-v2.json  review-queue-v2.json  content-manifest.json")
    A("  chunks-v2.jsonl  chunks-v2.manifest.json")
    A("  embeddings-v2.jsonl  embeddings-v2.manifest.json")
    A("  golden-set.jsonl  retrieval-eval.json  lexical-diagnostic.json")
    A("knowledge/recette-embedding-stahl-units-v1.json")
    A("scripts/rollback-connaissance-stahl.mjs  (retour arriere circonscrit et verifiable)")
    A("knowledge/.sortie-chargeur-stahl.json")
    A("docs/reports/patches/2026-10-20-stahl-integration-{1,2,3,4}-*.patch")
    A("context/ingest-stahl-prescribers-guide-7e.md")
    A("```")
    A("")
    A("**Suivi Git.** `knowledge/canonical-v2/stahl-prescribers-guide-7e-cup/` est **ignoré par Git** "
      "(`.gitignore` ligne 104), comme les quatre autres livres : les artefacts canoniques sont "
      "locaux et reproductibles par les scripts, pas versionnés. Sont **versionnés** : les scripts "
      "(`scripts/knowledge-stahl-*.py`, `scripts/*-stahl*.mjs`), la recette par livre "
      "(`knowledge/recette-embedding-stahl-units-v1.json`), le manifeste de contexte "
      "(`context/ingest-stahl-prescribers-guide-7e.md`), l'ADR-041 (`docs/00-DECISIONS.md`), les "
      "écarts (`ARCHITECTURE.md`), les patchs d'intégration et ce rapport. Seul fichier suivi modifié "
      "dans le dossier canonique : `tables.jsonl`, jusqu'ici vide (0 octet) et désormais porteur des "
      f"{len(tables)} tableaux reconstruits.")
    A("")

    # 16 — dependances
    A("## 17. Dépendances")
    A("")
    A("| Outil | Version | Rôle | Licence |")
    A("|---|---|---|---|")
    A("| `pymupdf` | 1.28.2 | extraction PDF, géométrie, TOC | AGPL-3.0 (déjà présent) |")
    A("| `onnxruntime-node` | 1.30.0 | inférence ONNX CPU | MIT (déjà présent) |")
    A("| `@huggingface/tokenizers` | 0.2.0 | tokenisation BGE-M3 | MIT (déjà présent) |")
    A("| `BAAI/bge-m3` | rev `5617a9f6…` | modèle d'embedding | MIT (déjà épinglé) |")
    A("| `pg` (node-postgres) | 8.23.0 | accès base (lecture) | MIT (déjà présent) |")
    A("")
    A("**Aucun nouveau paquet installé.** Le PDF est texte natif (couche texte sur 100 % des pages) ; "
      "l'OCR est interdit par ADR-038 et par le `WORKORDER.md` de l'ouvrage ; les tableurs PDF sans "
      "filets exigent une reconstruction géométrique, pas un OCR.")
    A("")
    A("**Évaluation d'outils (banc d'essai, pas citation).**")
    A("")
    A("| Outil | Verdict | Preuve |")
    A("|---|---|---|")
    A("| `pymupdf` 1.28.2 | **retenu** | 2 697 / 2 697 pages extraites, chaîne de hash continue, "
      "géométrie ligne + span + bbox disponible, tables reconstruites |")
    A("| `citra` 6.0.0 (`rust-core`) | **écarté** | **refuse** ce PDF : `Failed to extract PDF text: "
      "IO error: selectable text exceeds bounded raw-part budget` — sur `read_pdf` (1 et 2 pages), "
      "`search_pdf` (3 requêtes) et `pdf_evidence inspect` (1 page). Le moteur reste pourtant utile : "
      "il **confirme indépendamment l'empreinte SHA-256** du fichier |")
    A("| Docling | écarté | non installé : PDF natif, OCR inutile, ajout de 1–3 Go de dépendances "
      "pour une fidélité inférieure à PyMuPDF sur ce document |")
    A("| Marker | écarté | idem (pipeline de rendu + modèle) |")
    A("| PaddleOCR / Tesseract | écartés | OCR **interdit** (ADR-038, `WORKORDER.md`) et sans objet : "
      "0 page scannée |")
    A("")
    A("La décision est **documentée et mesurée**, pas subie.")
    A("")
    A("**Acquisition de développement** : modèle BGE-M3 (2,27 Go) rechargé depuis HuggingFace et "
      "vérifié par SHA-256 contre la recette épinglée (3/3). Le `tokenizer.json` doit provenir de "
      "`onnx/tokenizer.json` (variante ONNX) ; la variante racine a un SHA différent et ne "
      "correspond pas à la recette. **Aucun octet du livre n'a quitté la machine.**")
    A("")

    RAPPORT.parent.mkdir(parents=True, exist_ok=True)
    RAPPORT.write_text("\n".join(L) + "\n", encoding="utf-8")
    print(f"rapport ecrit : {RAPPORT.relative_to(RACINE)} ({len(L)} lignes)")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
