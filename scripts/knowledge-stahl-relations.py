#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — S6 relations, index structure, glossaire, renvois.

Usage:
    python scripts/knowledge-stahl-relations.py

Sorties :
  relations.jsonl        aretes sourcee (unite -> concept, index -> medicament, ...)
  index-entries.jsonl    les 3 index du livre, en entrees structurees
  glossary-entries.jsonl liste d'abreviations (p. 2671) en paires
  xrefs-resolved.json    etat des renvois intra-livre

Regles :
  - une arete n'est creee que si la SOURCE la soutient ; rien n'est suppose ;
  - les references de page IMPRIMEES internes aux index (ex. "Alcohol
    dependence, 255") sont conservees VERBATIM et ne servent JAMAIS de
    provenance : elles designent la page imprimee de l'ouvrage ;
  - l'ordre alphabetique de l'index est preserve ; chaque entree garde son
    numero d'ordre d'origine ;
  - un agent d'index non resolu est signale, jamais efface.
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")

# "Topic, 255" : le nombre est une page IMPRIMEE citee par l'index.
RE_SUFFIXE_PAGE = re.compile(r"^(?P<topic>.+?),\s*(?P<page>\d+)\s*$")
RE_ABREVIATION = re.compile(r"^(?P<abbr>[A-Za-z0-9][A-Za-z0-9/\-\. ]{0,24}?)\s*:\s*(?P<exp>.+)$")


def lire_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text(encoding="utf-8").split("\n") if l.strip()]


def ecrire_jsonl(p: Path, lignes: list[dict]) -> None:
    with p.open("w", encoding="utf-8", newline="\n") as f:
        for r in lignes:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")


def main() -> int:
    unites = lire_jsonl(DOSSIER / "units.jsonl")
    concepts = lire_jsonl(DOSSIER / "concepts.jsonl")
    meds = lire_jsonl(DOSSIER / "meds.jsonl")
    xrefs = lire_jsonl(DOSSIER / "xrefs.jsonl")
    structure = json.loads((DOSSIER / "structure-v2.json").read_text(encoding="utf-8"))

    unite_par_id = {u["id"]: u for u in unites}
    medicament_par_nom = {m["drug_name"]: m for m in meds}
    concept_par_canonique = {c["canonical"]: c for c in concepts}

    def normaliser_nom(nom: str) -> str:
        """Forme de comparaison : minuscules, sans partie entre parentheses."""
        return re.sub(r"\s+", " ", nom.split("(")[0].strip().lower()).strip()

    def sans_prefixe_stereo(cle: str) -> str:
        """Retire un prefixe stereochimique de tete ('l-methylfolate').

        L'index ecrit "l-methylfolate" la ou la monographie ecrit
        "Methylfolate (L)" : meme molecule, forme d'ecriture differente.
        La comparaison est faite sur une FORME DERIVEE, jamais sur la source.
        """
        return re.sub(r"^[ldrs](?:-|\s)?(?=[a-z])", "", cle).strip()

    index_par_normalise: dict[str, dict] = {}
    for m in meds:
        index_par_normalise.setdefault(normaliser_nom(m["drug_name"]), m)
    # alias de concepts (noms commerciaux, DCI, formes d'index)
    alias_par_normalise: dict[str, dict] = {}
    for c in concepts:
        canon = c.get("canonical")
        if not canon:
            continue
        for nom in [canon] + list(c.get("aliases") or []) + [c.get("source_terminology") or ""]:
            cle = normaliser_nom(nom)
            if cle and cle not in alias_par_normalise:
                alias_par_normalise[cle] = c

    def resoudre_agent(nom: str) -> tuple[dict | None, str]:
        """Resout un agent d'index. Retourne (trouve, forme).

        forme : 'medicament' | 'combination'
        Une association ("olanzapine/fluoxetine combination") n'est PAS une
        monographie du Guide : elle se resout par ses COMPOSANTS, et le
        statut reste visible (aucune monographie inventee).
        """
        cle = normaliser_nom(nom)
        m = index_par_normalise.get(cle)
        if m is not None:
            return {"med_id": m["med_id"], "drug_name": m["drug_name"]}, "medicament"
        alt = sans_prefixe_stereo(cle)
        if alt != cle:
            m = index_par_normalise.get(alt)
            if m is not None:
                return {"med_id": m["med_id"], "drug_name": m["drug_name"]}, "medicament"
        c = alias_par_normalise.get(cle) or alias_par_normalise.get(alt)
        if c is not None:
            return {"med_id": None, "drug_name": c.get("canonical"),
                    "concept_id": c.get("concept_id")}, "medicament"
        if "/" in nom or "combination" in nom.lower():
            base = re.sub(r"\bcombination\b", "", nom, flags=re.IGNORECASE)
            composants = []
            for part in re.split(r"[/,]", base):
                part = normaliser_nom(part)
                if not part:
                    continue
                mm = index_par_normalise.get(part)
                if mm is not None:
                    composants.append({"agent": part, "med_id": mm["med_id"],
                                       "drug_name": mm["drug_name"]})
            if composants:
                return {"components": composants}, "combination"
        return None, "absent"

    relations: list[dict] = []
    compteur = 0

    def arête(rel: str, src: str, dst: str, evidence: str, etiq: str | None = None,
              type_relation: str = "source") -> None:
        nonlocal compteur
        compteur += 1
        relations.append({
            "relation_id": f"stahl7-r-{compteur:05d}",
            "book_id": BOOK_ID,
            "source_version": VERSION,
            "relation": rel,
            "from_id": src,
            "to_id": dst,
            "evidence": evidence[:400],
            "label": etiq,
            "assertion_kind": type_relation,
            "validation_status": "auto_ok",
        })

    # --- 1. unite -> concept (source_refs portees par le concept) ---------
    concept_par_ref: dict[str, list[dict]] = {}
    for c in concepts:
        for ref in c.get("source_refs", []) or []:
            concept_par_ref.setdefault(ref, []).append(c)
    for ref, cs in sorted(concept_par_ref.items()):
        if ref not in unite_par_id:
            continue
        for c in cs:
            arête("about", ref, c["concept_id"], c.get("canonical", ""),
                  c.get("source_terminology"))

    # --- 2. medicament -> unites (liaison explicite des fiches) -----------
    for m in meds:
        for uid in m.get("unit_ids", []) or []:
            if uid in unite_par_id:
                arête("documented_by", m["med_id"], uid, m.get("drug_name", ""),
                      m.get("drug_class"))

    # --- 3. index structure ------------------------------------------------
    index_entries: list[dict] = []
    contre_index = 0
    for u in unites:
        chemin = u.get("structural_path") or []
        if len(chemin) < 2 or chemin[0] != "Back matter":
            continue
        l2 = chemin[1]
        if l2 not in ("Index by Use", "Index by Class"):
            continue
        contre_index += 1
        evidence = u.get("evidence_wording") or ""
        brut = evidence.strip()
        # separation topic / liste d'agents
        if ":" in brut:
            topic_part, agents_part = brut.split(":", 1)
        else:
            topic_part, agents_part = brut, ""
        topic_part = topic_part.strip()
        page_ref = None
        m = RE_SUFFIXE_PAGE.match(topic_part)
        if m:
            topic = m.group("topic").strip()
            page_ref = m.group("page")
        else:
            topic = topic_part
        agents = [a.strip() for a in agents_part.split(";") if a.strip()]
        resolus = []
        non_resolus = []
        combinaisons = []
        for a in agents:
            trouve, forme = resoudre_agent(a)
            if trouve is not None and forme == "combination":
                combinaisons.append(trouve)
                resolus.append({"agent": a, "med_id": None, "drug_name": a,
                                 "kind": "combination",
                                 "components": trouve["components"]})
            elif trouve is not None:
                resolus.append({"agent": a, "med_id": trouve["med_id"],
                                "drug_name": trouve["drug_name"], "kind": "medicament"})
            else:
                non_resolus.append(a)
        index_entries.append({
            "index_entry_id": f"stahl7-ix-{contre_index:04d}",
            "book_id": BOOK_ID,
            "source_version": VERSION,
            "index_name": l2,
            "entry_text_verbatim": brut,
            "topic": topic,
            "topic_printed_page_ref": page_ref,
            "topic_printed_page_ref_note": (
                "page IMPRIMEE citee par l'index lui-meme ; jamais utilisee comme provenance"
                if page_ref else None
            ),
            "agents": [a["agent"] for a in resolus],
            "agents_resolved": resolus,
            "agents_unresolved": non_resolus,
            "unit_id": u["id"],
            "source_page": u.get("page_start"),
            "printed_page": u.get("printed_page_start"),
            "order_in_index": contre_index,
            "validation_status": "needs_review" if non_resolus else "auto_ok",
        })
        # arete index -> medicament
        for r in resolus:
            if r.get("med_id"):
                arête("indexes", u["id"], r["med_id"], brut, r["drug_name"], "index-entry")
            for comp in r.get("components", []) or []:
                arête("indexes", u["id"], comp["med_id"], brut, comp["drug_name"],
                      "index-entry/composant")

    # --- 4. glossaire (liste d'abreviations) ------------------------------
    glossaire: list[dict] = []
    for u in unites:
        chemin = u.get("structural_path") or []
        if len(chemin) < 2 or chemin[1] != "Abbreviations":
            continue
        texte = u.get("evidence_wording") or ""
        numero = 0
        for ligne in texte.split("\n"):
            ligne = ligne.strip()
            if not ligne or ":" not in ligne:
                continue
            m = RE_ABREVIATION.match(ligne)
            if not m:
                continue
            numero += 1
            glossaire.append({
                "glossary_id": f"stahl7-g-{numero:04d}",
                "book_id": BOOK_ID,
                "source_version": VERSION,
                "abbreviation": m.group("abbr").strip(),
                "expansion": m.group("exp").strip(),
                "entry_text_verbatim": ligne,
                "unit_id": u["id"],
                "source_page": u.get("page_start"),
                "printed_page": u.get("printed_page_start"),
                "validation_status": "auto_ok",
            })

    # --- 5. renvois intra-livre -------------------------------------------
    xrefs_etat = {
        "total": len(xrefs),
        "resolved": sum(1 for x in xrefs if x.get("status") == "resolved"),
        "unresolved": sum(1 for x in xrefs if x.get("status") != "resolved"),
        "par_cible": dict(Counter(
            (x.get("target_unit") or "unresolved").split("-")[0] for x in xrefs
        ).most_common()),
        "unresolved_detail": [
            {"from_unit": x.get("from_unit"), "target_text": x.get("target_text"),
             "reason": "cible non atomisee ou renvoi interne"}
            for x in xrefs if x.get("status") != "resolved"
        ][:100],
    }

    # --- ecriture ---------------------------------------------------------
    ecrire_jsonl(DOSSIER / "relations.jsonl", relations)
    ecrire_jsonl(DOSSIER / "index-entries.jsonl", index_entries)
    ecrire_jsonl(DOSSIER / "glossary-entries.jsonl", glossaire)
    (DOSSIER / "xrefs-resolved.json").write_text(
        json.dumps(xrefs_etat, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
        encoding="utf-8")

    non_res = sum(len(e["agents_unresolved"]) for e in index_entries)
    avec_page = sum(1 for e in index_entries if e["topic_printed_page_ref"])
    print(f"relations   : {len(relations)} aretes")
    print(f"index       : {len(index_entries)} entrees "
          f"(avec reference de page imprimee={avec_page}) | agents non resolus={non_res}")
    print(f"glossaire   : {len(glossaire)} abreviations")
    print(f"xrefs       : {xrefs_etat['resolved']}/{xrefs_etat['total']} resolus, "
          f"{xrefs_etat['unresolved']} non resolus")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
