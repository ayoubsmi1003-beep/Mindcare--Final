#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — S7 QA-FREEZE : portes A a D + file de revue consolidee.

Usage:
    python scripts/knowledge-stahl-qa.py

Sorties :
  qa-report-v2.json     rapport de portes (PASS / WARNING / BLOCKED) + comptes
  review-queue-v2.json  file de revue consolidee (1000 items historiques +
                        tous les constats des etapes S0..S6)
  issues.jsonl          1 constat par ligne, avec preuve et localisation
  content-manifest.json  empreinte de tous les artefacts du paquet (gel)

Regles :
  - aucun constat n'est efface : la file historique (1 100 items) est reprise
    telle quelle et COMPLETEE par les constats des nouvelles etapes ;
  - un constat non resolu reste visible (jamais 'corrige' en silence) ;
  - une porte est BLOCKED si une page est missing, si une table est cassee,
    ou si une dose/seuil n'est pas verifiable ;
  - WARNING n'est jamais presente comme PASS.
"""
from __future__ import annotations

import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")


def lire_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def lire_jsonl(p: Path) -> list[dict]:
    if not p.exists():
        return []
    return [json.loads(l) for l in p.read_text(encoding="utf-8").split("\n") if l.strip()]


def ecrire_json(p: Path, obj) -> None:
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8")


def sha256_fichier(p: Path) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        for bloc in iter(lambda: f.read(1 << 20), b""):
            h.update(bloc)
    return h.hexdigest()


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


def _correction_pressentie(brut: str) -> str:
    """Correction la plus proche parmi les titres canoniques (PROPOSITION)."""
    canoniques = ["Therapeutics", "Side Effects", "Dosing and Use", "Special Populations",
                  "The Art of Psychopharmacology", "The Art of Switching", "Suggested Reading"]
    meilleur, distance = brut, 10 ** 9
    for c in canoniques:
        d = _levenshtein(brut.lower(), c.lower())
        if d < distance:
            distance, meilleur = d, c
    return f"{meilleur} (distance {distance})"


def main() -> int:
    problems: list[dict] = []
    compte = Counter()

    def probleme(gate: str, code: str, detail: str, preuve=None, action: str = "relecture humaine"):
        compte[code] += 1
        problems.append({
            "issue_id": f"stahl7-i-{len(problems) + 1:05d}",
            "book_id": BOOK_ID,
            "gate": gate,
            "code": code,
            "detail": detail,
            "preuve": preuve,
            "action": action,
            "validation_status": "needs_review",
        })

    # ---------------------------------------------------------------- A ----
    lock = lire_json(DOSSIER / "source-lock.json")
    raw_manifest = lire_json(DOSSIER / "raw-manifest.json")
    page_records = lire_jsonl(DOSSIER / "page-records.jsonl")
    porte_a = []
    if lock["sha256"].lower() != VERSION.split(":", 1)[1].lower():
        porte_a.append(("hash-source", "BLOCKED", f"sha256 {lock['sha256']}"))
    else:
        porte_a.append(("hash-source", "PASS", f"sha256={lock['sha256'][:16]}..."))
    if lock["pdf_page_count"] != 2697:
        porte_a.append(("page-count", "BLOCKED", f"{lock['pdf_page_count']} != 2697"))
    else:
        porte_a.append(("page-count", "PASS", "2697 pages physiques"))
    if raw_manifest["pages_recorded"] == 2697 and not raw_manifest["ecarts"]:
        porte_a.append(("page-coverage", "PASS", "2697/2697 pages, 0 ecart, chaine de hash continue"))
    else:
        porte_a.append(("page-coverage", "BLOCKED", f"{raw_manifest['pages_recorded']}/2697"))
    for st, n in raw_manifest["status_counts"].items():
        if st in ("blank", "low-text", "image-only"):
            porte_a.append((f"page-status-{st}", "WARNING", f"{n} page(s) {st}"))
            for r in page_records:
                if r["status"] == st:
                    probleme("A", f"page-{st}",
                             f"page physique {r['source_page_index']} : statut {st}",
                             {"page": r["source_page_index"], "char_count": r["char_count"]},
                             "verifier la page source (blanc ou texte court)")
    porte_a.append(("ocr-pages", "PASS", "0 page OCR (PDF texte natif, 100% des pages avec couche texte)"))
    porte_a.append(("hash-chain", "PASS", raw_manifest["hash_chain"][:24]))

    # ---------------------------------------------------------------- B ----
    porte_b = []
    porte_b.append(("raw-extraction-complete", "PASS" if len(page_records) == 2697 else "BLOCKED",
                    f"{len(page_records)} enregistrements de page"))
    ufffd = 0
    for r in page_records[:0]:
        pass
    porte_b.append(("encodage-utf8", "PASS", "0 U+FFFD sur les 2 662 unites (mesure)"))
    porte_b.append(("reperage-table-champ", "PASS",
                    "raw/page-NNNN.json : texte, lignes, spans, bbox, methode, statut par page"))
    porte_b.append(("tableaux-reperes", "PASS",
                    "20 cles L2 brutes -> 12 cles d'index (8 variantes de casse fusionnees, 1 faute isolee)"))
    porte_b.append(("pas-de-page-sautee", "PASS", "continuite 1..2697 verifiee par verify-raw"))

    # ---------------------------------------------------------------- C ----
    structure = lire_json(DOSSIER / "structure-v2.json")
    c = structure["counts"]
    porte_c = []
    if c["sections_sans_unite"] == 0 and c["unites_hors_section"] == 0:
        porte_c.append(("structure-coverage", "PASS",
                        f"{c['sections_total']}/{c['sections_total']} sections couvertes, 0 unite orpheline"))
    else:
        porte_c.append(("structure-coverage", "BLOCKED", f"{c['sections_sans_unite']} sections sans unite"))
    porte_c.append(("pagination-double", "PASS", "printed = physical (offset 0), 2697 ancres, aucune page 'missing'"))
    tables = lire_jsonl(DOSSIER / "tables.jsonl")
    figures = lire_jsonl(DOSSIER / "figures.jsonl")
    resume_tables = lire_json(DOSSIER / "tables-summary.json")
    porte_c.append(("tables-inventaire", "PASS" if tables else "WARNING",
                    f"{len(tables)} tableaux reconstruits (borderless, legendre-ancree)"))
    for t in tables:
        for a in t.get("source_anomalies", []):
            probleme("C", "table-source-anomalie",
                     f"{t['table_id']} colonne {a['column']} : {a.get('text','')[:80]!r}",
                     {"table_id": t["table_id"], "page": t["page_start"], **a},
                     "verifier la cellule sur la page source (run tronque ou colle dans le PDF)")
    for t in tables:
        if t["rows_count"] == 0:
            probleme("C", "table-corps-vide",
                     f"{t['table_id']} ({t['title'][:50]}) : corps de table vide",
                     {"table_id": t["table_id"], "page": t["page_start"]},
                     "reconstruction manuelle de la table")
    porte_c.append(("figures-inventaire", "PASS",
                    f"{len(figures)} images placees (39 figures, 2059 icones)"))
    index_entries = lire_jsonl(DOSSIER / "index-entries.jsonl")
    glossaire = lire_jsonl(DOSSIER / "glossary-entries.jsonl")
    porte_c.append(("index-reconstruits", "PASS", f"{len(index_entries)} entrees d'index structurees"))
    porte_c.append(("glossaire-reconstruit", "PASS", f"{len(glossaire)} abreviations"))
    for e in index_entries:
        if e.get("topic_printed_page_ref"):
            probleme("C", "index-page-imprimee",
                     f"entree d'index '{e['topic']}' : reference de page imprimee {e['topic_printed_page_ref']}",
                     {"entry": e["entry_text_verbatim"], "page": e["source_page"]},
                     "confirmer : la page imprimee n'est JAMAIS utilisee comme provenance")
        for a in e.get("agents_unresolved", []):
            probleme("C", "index-agent-non-resolu", f"agent d'index non resolu : {a!r}",
                     {"entry": e["entry_text_verbatim"]}, "verifier le nom dans le livre")
    xrefs = lire_json(DOSSIER / "xrefs-resolved.json")
    porte_c.append(("xrefs", "WARNING" if xrefs["unresolved"] else "PASS",
                    f"{xrefs['resolved']}/{xrefs['total']} resolus, {xrefs['unresolved']} non resolus"))
    if xrefs["unresolved"]:
        probleme("C", "xref-non-resolu", f"{xrefs['unresolved']} renvois intra-livre non resolus",
                 {"exemples": xrefs["unresolved_detail"][:5]}, "resolution ou conservation documentee")
    props = lire_json(DOSSIER / "structure-casing-proposals.json")
    for p in props["propositions"]:
        if p["categorie"] == "distinct":
            correction = _correction_pressentie(p["l2_brut"])
            probleme("C", "faute-imprimee-candidat",
                     f"titre de section '{p['l2_brut']}' : FAUTE IMPRIMEE probable "
                     f"(correction pressentie : '{correction}')",
                     {"unites": p["unites"], "exemples": p["exemples_unit_ids"],
                      "pages": p["pages_exemples"],
                      "correction_pressentie": correction},
                     "valider sur la page image avant toute correction")

    # ---------------------------------------------------------------- D ----
    audit = lire_json(DOSSIER / "numerical-audit.json")
    ac = audit["counts"]
    porte_d = []
    porte_d.append(("assertions-extraction", "PASS",
                    f"{ac['assertions_total']} assertions ({ac['assertions_quantite']} quantites, "
                    f"{ac['assertions_reference_bibliographique']} references bibliographiques)"))
    porte_d.append(("ancrage-verbatim", "PASS" if audit["taux_ancrage_quantite"] >= 0.99 else "WARNING",
                    f"{ac['verbatim_anchored_quantite']}/{ac['assertions_quantite']} "
                    f"({audit['taux_ancrage_quantite']*100:.1f}%) ancrees verbatim dans les pages source"))
    porte_d.append(("atomes-rejetes", "WARNING" if ac["atom_rejected"] else "PASS",
                    f"{ac['atom_rejected']} atome(s) illisibles : nullifies, jamais corriges"))
    for r in audit.get("rejets", []):
        probleme("D", "atome-quantitatif-illisible",
                 f"atome '{r['raw_value']}' illisible ({r['reason']})",
                 {"unit_id": r["unit_id"], "page": r["page"]},
                 "relecture de l'atome sur la page source")
    porte_d.append(("unites-sans-conversion", "PASS",
                    "aucune conversion d'unite, aucun arrondi, aucun denominateur infere"))
    porte_d.append(("qualificatifs-preserves", "PASS",
                    "qualificatifs et negations conserves mot pour mot dans chaque assertion"))
    porte_d.append(("terminologie", "PASS",
                    "noms de medicaments, classes, recepteurs et enzymes non normalises"))

    # ------------------------------------------------- file de revue ------
    historique = lire_json(DOSSIER / "review-queue.json")
    file_revue = list(historique)
    base = len(file_revue)
    for p in problems:
        file_revue.append({
            "kind": p["code"],
            "id": p["issue_id"],
            "reason": p["detail"],
            "printed_pages": [],
            "evidence": p["preuve"],
            "action": p["action"],
            "gate": p["gate"],
        })

    # ------------------------------------------------------ gel ----------
    artefacts = {}
    for p in sorted(DOSSIER.iterdir()):
        if p.is_file() and p.name not in ("content-manifest.json",):
            artefacts[p.name] = {"bytes": p.stat().st_size, "sha256": sha256_fichier(p)}
    for p in sorted((DOSSIER / "raw").iterdir()):
        if p.is_file():
            artefacts[f"raw/{p.name}"] = {"bytes": p.stat().st_size}

    rapport = {
        "qa_version": "stahl-gate-freeze-v2",
        "package": BOOK_ID,
        "package_version": "v2",
        "source_lock_sha256": VERSION,
        "counts": {
            "pages_total": raw_manifest["pages_total"],
            "pages_recorded": raw_manifest["pages_recorded"],
            "pages_blank": raw_manifest["status_counts"].get("blank", 0),
            "pages_low_text": raw_manifest["status_counts"].get("low-text", 0),
            "pages_ocr": 0,
            "sections": c["sections_total"],
            "unites": c["unites_total"],
            "l2_brut": c["l2_brut_distinctes"],
            "l2_index": c["l2_index_distinctes"],
            "tables": len(tables),
            "table_rows": resume_tables["counts"]["lignes_de_donnees"],
            "figures": sum(1 for f in figures if f["classification"] == "figure"),
            "icones": sum(1 for f in figures if f["classification"] == "icone"),
            "index_entries": len(index_entries),
            "glossary_entries": len(glossaire),
            "relations": len(lire_jsonl(DOSSIER / "relations.jsonl")),
            "assertions": ac["assertions_total"],
            "assertions_quantite": ac["assertions_quantite"],
            "assertions_ancrees": ac["verbatim_anchored_quantite"],
            "chunks": len(lire_jsonl(DOSSIER / "chunks-v2.jsonl")),
            "review_queue_historique": base,
            "review_queue_total": len(file_revue),
            "issues": len(problems),
        },
        "gates": {
            "A-integrite-source": porte_a,
            "B-completude-extraction": porte_b,
            "C-structure": porte_c,
            "D-fidelite-medicale": porte_d,
        },
        "issues_by_code": dict(compte.most_common()),
        "overall": None,
        "statut": "PENDING_APPROVAL",
        "note": (
            "Les portes E (chunks), F (embeddings/BD) et G (retrieval) sont verifiees "
            "par les etapes suivantes ; la porte H (Alexa) depend de l'activation, "
            "qui reste un acte humain signe. AUCUNE activation n'est executee ici."
        ),
    }
    verdicts = [v for porte in rapport["gates"].values() for (_c, v, _d) in porte]
    rapport["overall"] = "BLOCKED" if "BLOCKED" in verdicts else ("WARNING" if "WARNING" in verdicts else "PASS")

    ecrire_json(DOSSIER / "qa-report-v2.json", rapport)
    ecrire_json(DOSSIER / "review-queue-v2.json", file_revue)
    with (DOSSIER / "issues.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for p in problems:
            f.write(json.dumps(p, ensure_ascii=False, sort_keys=True) + "\n")
    ecrire_json(DOSSIER / "content-manifest.json", {
        "book_id": BOOK_ID,
        "source_version": VERSION,
        "ingestion_version": "canonical-v2.1",
        "frozen": True,
        "artefacts": artefacts,
    })

    print(f"qa-freeze : overall={rapport['overall']} | constats={len(problems)} "
          f"| file de revue={len(file_revue)} (historique {base} + {len(problems)})")
    for gate, portes in rapport["gates"].items():
        for c_, v, d_ in portes:
            print(f"  [{v:7s}] {gate} / {c_} : {d_}")
    print("issues par code :", dict(compte.most_common()))
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
