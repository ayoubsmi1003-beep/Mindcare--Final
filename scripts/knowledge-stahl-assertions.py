#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Stahl 7e — S5 assertions quantitatives + audit numerique.

Usage:
    python scripts/knowledge-stahl-assertions.py

Sorties :
  assertions.jsonl      1 assertion par atome quantitatif trouve
  numerical-audit.json  audit : ancrage verbatim, rejets, repartition

Regles ABSOLUES (KNOWLEDGE_INGESTION_PLAN.md §9/§11, FINAL-AUDIT.md) :
  - `raw_value` = chaine source EXACTE (jamais reecrite, jamais arrondie) ;
    `raw_value_source` = la meme chaine telle qu'elle apparait dans le PDF
    (les sauts de ligne intra-mot sont conserves la, avec leur position) ;
  - AUCUNE conversion d'unite, AUCUN arrondi, AUCUN denominateur infere,
    AUCUNE reinterpretation d'une inegalite ;
  - un atome non lisible avec certitude => `parsed_value = null` +
    `atom_reject_reason` + quarantaine (jamais une correction) ;
  - chaque assertion est VERIFIEE verbatim dans la page source (raw/) ;
  - les qualificatifs (may / can / usually / up to / at least ...) sont
    conserves mot pour mot et jamais appliques a une assertion voisine.
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent
BOOK_ID = "stahl-prescribers-guide-7e-cup"
VERSION = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
DOSSIER = RACINE / "knowledge" / "canonical-v2" / BOOK_ID / VERSION.replace(":", "-")

# --- vocabulaire des comparateurs (liste fermee) ---------------------------
COMPARATEURS = {
    "=": "equal",
    "==": "equal",
    "eq": "equal",
    "approx": "approximately",
    "approximately": "approximately",
    "about": "approximately",
    "around": "approximately",
    "up to": "at_most",
    "upto": "at_most",
    "no more than": "at_most",
    "not more than": "at_most",
    "maximum": "at_most",
    "max": "at_most",
    "at least": "at_least",
    "minimum": "at_least",
    "min": "at_least",
    "greater than": "greater_than",
    "less than": "less_than",
    "at most": "at_most",
    "at least": "at_least",
    "more than": "greater_than",
    "lesser than": "less_than",
    "range": "range",
    "to": "range",
    "-": "range",
}

# Symboles -> comparateur (comparaison explicite).
SYMBOLES = {
    ">=": "at_least",
    "≤": "at_most",
    "<=": "at_most",
    ">": "greater_than",
    "<": "less_than",
    "=": "equal",
    "≥": "at_least",
    "±": "plus_minus",
    "≈": "approximately",
    "~": "approximately",
}

# Unites reconnues (jamais converties).
UNITES = [
    "mcg/kg/min", "mcg/kg/hour", "mcg/min", "mcg/hour", "mcg/day", "mcg/mL", "mcg",
    "µg/kg/min", "µg/min", "µg", "mg/kg/day", "mg/kg/hour", "mg/kg/min", "mg/day",
    "mg/hour", "mg/mL", "mg/L", "mg", "g/day", "g/L", "g", "ng/mL", "ng/mL/hr", "ng",
    "mEq/L", "mEq", "mmol/L", "mmol", "mL/hour", "mL/min", "mL/day", "mL", "L",
    "IU/day", "IU/L", "IU", "%", "bpm", "mm Hg", "mmHg", "kg", "hours", "hour",
    "days", "day", "weeks", "week", "months", "month", "years", "year", "times",
    "points", "cycles", "doses", "mg/kg",
]
UNITES_RE = "|".join(re.escape(u) for u in sorted(UNITES, key=len, reverse=True))

# Mots de comparateur (les plus longs d'abord).
COMPARATEURS_MOTS = sorted(
    [w for w in COMPARATEURS if w.isalpha() or " " in w], key=len, reverse=True
)

RE_QUALIF = re.compile(
    r"\b(may|can|could|usually|often|sometimes|occasionally|rarely|commonly|typically|"
    r"generally|uncommonly|approximately|about|around|up to|no more than|not more than|"
    r"at least|at most|maximum|minimum|greater than|less than|more than|lesser than|"
    r"most|many|some|few|likely|unlikely|consider|considered|recommended|not recommended|"
    r"contraindicated|not established|no evidence|insufficient|unknown|variable)\b",
    re.IGNORECASE,
)

RE_NEGATION = re.compile(
    r"\b(not|no|never|without|contraindicated|avoid|avoided|do not|does not|"
    r"not recommended|not established|insufficient)\b",
    re.IGNORECASE,
)

# Atome : nombre [separateur nombre] unite | pourcentage | duree
RE_ATOME = re.compile(
    r"(?P<pre>"
    r"(?:(?P<cmp_sym>>=|<=|>=|<=|>|<|=|±|≈|~)\s*)?"
    r"|(?P<cmp_word>no more than|not more than|up to|at least|at most|approximately|about|around|maximum|minimum|greater than|less than|more than|lesser than)\s+"
    r")?"
    r"(?P<neg1>-)?"
    r"(?P<a>\d+(?:[.,]\d+)?)"
    r"(?P<sep>\s*(?:-|–|—|to)\s*(?P<b>\d+(?:[.,]\d+)?))?"
    r"\s*(?P<unit>(?:" + UNITES_RE + r")\b)?",
    re.IGNORECASE,
)

RE_PCT = re.compile(r"(?P<v>\d+(?:[.,]\d+)?)\s*(?P<sep>%|percent|pour cent)", re.IGNORECASE)

# Signal bibliographique : reference de revue ("Am J Addictions 2008 ; 17 :70-6",
# "J Natl Med Assoc 2012 ;104 (7-8):342-50"). Ces numeros de page ne sont PAS
# des quantites cliniques. Le motif tolere le volume et le fascicule entre
# l'annee et les deux-points.
RE_CITATION = re.compile(r"\b(19|20)\d{2}\b[^.]{0,80}[:;]\s*\d")
# Sections de bibliographie du livre.
L2_BIBLIO = {"Suggested Reading"}

# Fenetre de pages sur laquelle on cherche l'ancrage verbatim : une unite
# peut deborder sur plusieurs pages (page_start..page_end).
FENETRE_PAGES = 6


def normaliser_avec_index(texte: str) -> tuple[str, list[int]]:
    """Normalise les blancs en conservant la correspondance vers l'original.

    Les sauts de ligne intra-mot du PDF ('Stahl's\\nEssential') deviennent une
    espace unique ; chaque caractere normalise retient son index d'origine.
    """
    out: list[str] = []
    idx: list[int] = []
    i = 0
    n = len(texte)
    while i < n:
        c = texte[i]
        if c.isspace():
            j = i
            while j < n and texte[j].isspace():
                j += 1
            out.append(" ")
            idx.append(i)
            i = j
            continue
        out.append(c)
        idx.append(i)
        i += 1
    return "".join(out), idx


def source_span(texte_original: str, debut: int, fin: int) -> str:
    return texte_original[debut:fin]


def nombre_fr(valeur: str) -> float | None:
    v = valeur.replace(",", ".")
    try:
        f = float(v)
    except ValueError:
        return None
    return f


def qualifier_proche(texte_normalise: str, debut: int, fin: int) -> tuple[list[str], bool]:
    """Qualificatifs immediatement anterieurs (fenetre de 40 caracteres)."""
    fenetre = texte_normalise[max(0, debut - 40):debut]
    q = [m.group(0) for m in RE_QUALIF.finditer(fenetre)]
    return q, bool(RE_NEGATION.search(fenetre))


def main() -> int:
    unites = [
        json.loads(l)
        for l in (DOSSIER / "units.jsonl").read_text(encoding="utf-8").split("\n")
        if l.strip()
    ]
    cas = {s["section_id"]: s for s in json.loads(
        (DOSSIER / "structure-v2.json").read_text(encoding="utf-8"))["sections"]}

    # index page -> section
    page_section: dict[int, str] = {}
    for s in cas.values():
        for p in range(int(s["source_page_start"]), int(s["source_page_end"]) + 1):
            page_section[p] = s["section_id"]

    # cache des pages brutes (verification d'ancrage)
    cache_page: dict[int, str] = {}

    def texte_page(p: int) -> str:
        if p not in cache_page:
            f = DOSSIER / "raw" / f"page-{p:04d}.json"
            cache_page[p] = json.loads(f.read_text(encoding="utf-8"))["raw_text"] if f.exists() else ""
        return cache_page[p]

    def ancre_dans_plages(page_start, page_end, valeur: str) -> bool:
        """La valeur doit se retrouver VERBATIM dans l'une des pages de l'unite.

        Une unite peut deborder : on cherche sur toute sa plage de pages
        (bornée), pas seulement sur page_start.
        """
        if page_start is None:
            return False
        debut = int(page_start)
        fin = int(page_end) if page_end else debut
        fin = min(fin, debut + FENETRE_PAGES - 1)
        cible = re.sub(r"\s+", " ", valeur).strip()
        if not cible:
            return False
        for p in range(debut, fin + 1):
            plat = re.sub(r"\s+", " ", texte_page(p))
            if plat and cible in plat:
                return True
        return False

    assertions: list[dict] = []
    compteur = 0
    rejets: list[dict] = []
    par_type: Counter[str] = Counter()
    par_unite: Counter[str] = Counter()

    for u in unites:
        brut = u.get("evidence_wording") or ""
        if not brut.strip():
            continue
        norm, index = normaliser_avec_index(brut)
        chemin = u.get("structural_path") or []
        sujet = chemin[0] if chemin else None
        l2 = chemin[1] if len(chemin) > 1 else None
        l3 = chemin[2] if len(chemin) > 2 else None
        p_start = u.get("page_start")

        # segment de phrase contenant l'atome (extrait de contexte)
        for m in RE_ATOME.finditer(norm):
            a_txt = m.group("a")
            b_txt = m.group("b")
            unite_txt = m.group("unit")
            if unite_txt is None and b_txt is None:
                continue
            # un nombre isole sans unite ni comparaison n'est pas un atome clinique
            if unite_txt is None and b_txt is None and m.group("cmp_sym") is None \
               and m.group("cmp_word") is None and not RE_PCT.fullmatch(m.group(0).strip()):
                # on ne garde que si un pourcentage est imminent : ignore
                if not re.match(r"^\s*\d+(?:[.,]\d+)?\s*$", m.group(0)):
                    continue
            debut, fin = m.start(), m.end()
            qualif, negation = qualifier_proche(norm, debut, fin)

            # --- phrase de contexte (prealable a la classification) --------
            g_debut = norm.rfind(".", 0, debut) + 1
            g_fin = norm.find(".", fin)
            g_fin = g_fin if g_fin != -1 else min(len(norm), fin + 200)
            phrase = norm[g_debut:g_fin].strip()

            # --- nature de l'atome -----------------------------------------
            # Une reference bibliographique ("Am J Addictions 2008 ; 17 :70-6")
            # porte des numeros de page, PAS une quantite clinique : elle est
            # conservee telle quelle mais jamais lue comme un intervalle.
            bibliographique = (l2 in L2_BIBLIO) or bool(RE_CITATION.search(phrase))
            kind = "reference-page-range" if bibliographique else "quantite"

            va = nombre_fr(a_txt)
            vb = nombre_fr(b_txt) if b_txt else None
            comparateur = None
            if bibliographique:
                comparateur = "reference"
            elif m.group("cmp_sym"):
                comparateur = SYMBOLES.get(m.group("cmp_sym"))
            elif m.group("cmp_word"):
                comparateur = COMPARATEURS.get(m.group("cmp_word").lower())
            elif b_txt:
                comparateur = "range"
            elif unite_txt:
                comparateur = "equal"

            rejet = None
            if bibliographique:
                rejet = "reference-page-range"
            elif va is None:
                rejet = "valeur_illisible"
            elif vb is not None and vb < va:
                rejet = "ordre_intervalle_incoherent"
            elif m.group("neg1") and not b_txt:
                comparateur = "negative"

            # unite : si absente sur un intervalle, on ne l'invente pas
            unite_finale = unite_txt
            if unite_finale is None and b_txt:
                unite_finale = None

            # valeur source exacte
            d_src = index[debut]
            f_src = index[min(fin, len(index) - 1)] + 1
            raw_source = source_span(brut, d_src, f_src)
            raw_norm = norm[debut:fin].strip()

            # ancrage verbatim dans les pages source de l'unite
            ancre = ancre_dans_plages(p_start, u.get("page_end"), raw_norm)

            compteur += 1
            aid = f"stahl7-a-{compteur:05d}"
            par_type[kind] += 1
            if unite_finale and not bibliographique:
                par_unite[unite_finale] += 1
            if rejet and not bibliographique:
                rejets.append({"assertion_id": aid, "unit_id": u["id"], "raw_value": raw_norm,
                               "reason": rejet, "page": p_start})
            assertions.append(
                {
                    "assertion_id": aid,
                    "book_id": BOOK_ID,
                    "source_version": VERSION,
                    "kind": kind,
                    "unit_id": u["id"],
                    "structural_path": chemin,
                    "subject": sujet,
                    "l2": l2,
                    "l3": l3,
                    "raw_value": raw_norm,
                    "raw_value_source": raw_source,
                    "parsed_value": None if rejet else va,
                    "range_min": None if rejet or vb is None else va,
                    "range_max": None if rejet or vb is None else vb,
                    "unit": unite_finale,
                    "unit_present": unite_finale is not None,
                    "comparator": comparateur,
                    "qualifiers": qualif,
                    "negation_context": negation,
                    "sentence": phrase[:1200],
                    "page_start": p_start,
                    "page_end": u.get("page_end"),
                    "printed_page_start": u.get("printed_page_start"),
                    "printed_page_end": u.get("printed_page_end"),
                    "section_id": page_section.get(int(p_start)) if p_start else None,
                    "verbatim_anchored": ancre,
                    "confidence": "high" if ancre and not rejet else "low",
                    "validation_status": "auto_ok" if ancre and not rejet else "needs_review",
                    "atom_reject_reason": rejet,
                }
            )

        # pourcentages isoles (non deja captures par RE_ATOME)
        deja = {(a["raw_value"], a["unit_id"]) for a in assertions[-50:]}
        for m in RE_PCT.finditer(norm):
            brut_pct = m.group(0)
            if re.match(r"^\s*\d+(?:[.,]\d+)?\s*(?:%|percent|pour cent)$", brut_pct, re.IGNORECASE):
                if any(a["raw_value"] == brut_pct.strip() and a["unit_id"] == u["id"] for a in assertions):
                    continue
                deb, fin = m.start(), m.end()
                val = nombre_fr(m.group("v"))
                qualif, negation = qualifier_proche(norm, deb, fin)
                d_src = index[deb]
                f_src = index[min(fin, len(index) - 1)] + 1
                compteur += 1
                aid = f"stahl7-a-{compteur:05d}"
                par_type["quantite"] += 1
                par_unite["%"] += 1
                ancre = ancre_dans_plages(p_start, u.get("page_end"), norm[deb:fin].strip())
                assertions.append(
                    {
                        "assertion_id": aid,
                        "book_id": BOOK_ID,
                        "source_version": VERSION,
                        "kind": "quantite",
                        "unit_id": u["id"],
                        "structural_path": chemin,
                        "subject": sujet,
                        "l2": l2,
                        "l3": l3,
                        "raw_value": norm[deb:fin].strip(),
                        "raw_value_source": source_span(brut, d_src, f_src),
                        "parsed_value": val,
                        "range_min": None,
                        "range_max": None,
                        "unit": "%",
                        "unit_present": True,
                        "comparator": "equal",
                        "qualifiers": qualif,
                        "negation_context": negation,
                        "sentence": norm[max(0, norm.rfind(".", 0, deb) + 1): (norm.find(".", fin) + 1 or len(norm))].strip()[:1200],
                        "page_start": p_start,
                        "page_end": u.get("page_end"),
                        "printed_page_start": u.get("printed_page_start"),
                        "printed_page_end": u.get("printed_page_end"),
                        "section_id": page_section.get(int(p_start)) if p_start else None,
                        "verbatim_anchored": ancre,
                        "confidence": "high" if ancre else "low",
                        "validation_status": "auto_ok" if ancre else "needs_review",
                        "atom_reject_reason": None if val is not None else "valeur_illisible",
                    }
                )

    with (DOSSIER / "assertions.jsonl").open("w", encoding="utf-8", newline="\n") as f:
        for a in assertions:
            f.write(json.dumps(a, ensure_ascii=False, sort_keys=True) + "\n")

    ancrees = sum(1 for a in assertions if a["verbatim_anchored"])
    rejetees = sum(1 for a in assertions if a["atom_reject_reason"] and a["kind"] == "quantite")
    quantites = [a for a in assertions if a["kind"] == "quantite"]
    ancrees_quantite = sum(1 for a in quantites if a["verbatim_anchored"])
    ecrire = {
        "book_id": BOOK_ID,
        "source_version": VERSION,
        "counts": {
            "assertions_total": len(assertions),
            "assertions_quantite": len(quantites),
            "assertions_reference_bibliographique": len(assertions) - len(quantites),
            "verbatim_anchored": ancrees,
            "verbatim_anchored_quantite": ancrees_quantite,
            "non_anchored": len(assertions) - ancrees,
            "non_anchored_quantite": len(quantites) - ancrees_quantite,
            "atom_rejected": rejetees,
            "auto_ok": sum(1 for a in assertions if a["validation_status"] == "auto_ok"),
            "needs_review": sum(1 for a in assertions if a["validation_status"] == "needs_review"),
            "par_type": dict(par_type),
            "unites_top": dict(par_unite.most_common(30)),
        },
        "taux_ancrage": round(ancrees / len(assertions), 4) if assertions else 0.0,
        "taux_ancrage_quantite": round(ancrees_quantite / len(quantites), 4) if quantites else 0.0,
        "ancrage": (
            "chaque atome est recherche VERBATIM dans les pages source de son unite "
            "(page_start..page_end borne a 6 pages) ; un atome non retrouve est "
            "non ancre et part en revue, jamais reecrit"
        ),
        "rejets": rejets[:200],
        "rejets_count": len(rejets),
        "regles": {
            "conversion_unite": "jamais",
            "arrondi": "jamais",
            "denominateur_inferere": "jamais",
            "inegalite_reinterpretee": "jamais",
            "valeur_illisible": "parsed_value=null + atom_reject_reason + quarantaine",
        },
    }
    (DOSSIER / "numerical-audit.json").write_text(
        json.dumps(ecrire, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"assertions : {len(assertions)} | dont quantites={len(quantites)} "
          f"references={len(assertions)-len(quantites)}")
    print(f"ancrage verbatim : global={ecrire['taux_ancrage']*100:.1f}% | "
          f"quantites={ecrire['taux_ancrage_quantite']*100:.1f}% | rejets atomiques={rejetees}")
    print(f"types={dict(par_type)}")
    print(f"top unites={dict(par_unite.most_common(12))}")
    return 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    sys.exit(main())
