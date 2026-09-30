# -*- coding: utf-8 -*-
"""Stahl distiller v1: TOC-driven L3 splitter (lead session). P1/3."""
import json, re, sys, io
from pathlib import Path
import pymupdf
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Books" / "prescribers-guide-stahls-essential-psychopharmacology.pdf"
BOOK_ID = "stahl-prescribers-guide-7e-cup"
SV = "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
VD = ROOT / "knowledge" / "canonical-v2" / BOOK_ID / SV.replace(":", "-")
REPAIR = {"\x91": "'", "\x92": "'", "\x93": '"', "\x94": '"',
          "\x96": "-", "\x97": "--", "\x85": "...", "\xa0": " ",
          "\ufffd": "'", "\x95": "-", "\x85 ": "... ",
          "\x91s": "'s", "\x92s": "'s", "\x92t": "'t", "\x92m": "'m",
          "\x92re": "'re", "\x92ll": "'ll", "\x92ve": "'ve"}
CT = {"Brands": "definition", "Generic?": "definition",
      "Class": "definition", "Commonly Prescribed for": "definition",
      "How the Drug Works": "definition", "How Long Until It Works": "prose",
      "If It Works": "prose", "Tests": "list",
      "How Drug Causes Side Effects": "prose",
      "Notable Side Effects": "list",
      "Life-Threatening or Dangerous Side Effects": "list",
      "Weight Gain": "prose", "Sedation": "prose",
      "What to Do About Side Effects": "guideline",
      "Best Augmenting Agents for Side Effects": "guideline",
      "Usual Dosage Range": "rule", "Dosage Forms": "list",
      "How to Dose": "step", "Dosing Tips": "guideline", "Overdose": "prose",
      "Long-Term Use": "prose", "Habit Forming": "definition",
      "How to Stop": "step", "Pharmacokinetics": "definition",
      "Drug Interactions": "list", "Other Warnings/Precautions": "guideline",
      "Do Not Use": "list", "Renal Impairment": "guideline",
      "Hepatic Impairment": "guideline", "Cardiac Impairment": "guideline",
      "Elderly": "guideline", "Children and Adolescents": "guideline",
      "Pregnancy": "guideline", "Breast Feeding": "guideline",
      "Potential Advantages": "list", "Potential Disadvantages": "list",
      "Primary Target Symptoms": "list", "Pearls": "prose"}
SD = {"Brands": "therapeutics", "Generic?": "therapeutics",
      "Class": "therapeutics", "Commonly Prescribed for": "therapeutics",
      "How Long Until It Works": "therapeutics", "If It Works": "therapeutics",
      "Tests": "precaution", "How Drug Causes Side Effects": "adverse-effect",
      "Notable Side Effects": "adverse-effect",
      "Life-Threatening or Dangerous Side Effects": "adverse-effect",
      "Weight Gain": "adverse-effect", "Sedation": "adverse-effect",
      "Usual Dosage Range": "dosing",
      "Dosage Forms": "dosing", "How to Dose": "dosing",
      "Dosing Tips": "dosing", "Overdose": "dosing", "Long-Term Use": "dosing",
      "Habit Forming": "dosing", "How to Stop": "dosing",
      "Pharmacokinetics": "pharmacokinetics",
      "Drug Interactions": "interaction",
      "Other Warnings/Precautions": "precaution", "Do Not Use": "precaution",
      "Pregnancy": "pregnancy-lactation",
      "Breast Feeding": "pregnancy-lactation",
      "Potential Advantages": "art-of-psychopharmacology",
      "Potential Disadvantages": "art-of-psychopharmacology",
      "Primary Target Symptoms": "art-of-psychopharmacology",
      "Pearls": "art-of-psychopharmacology"}

def fix(s):
    for k, v in REPAIR.items():
        s = s.replace(k, v)
    s = s.replace("\u273d", "")
    return re.sub(r"[ \t]+", " ", s).strip()
def main(a, b, letter):
    doc = pymupdf.open(SRC)
    toc = doc.get_toc(simple=True)
    heads = [(p, lv, t) for lv, t, p in toc
             if a <= p <= b and lv in (2, 3)]
    # Some monographs use L4/L5/L6 for extra sub-lists (Tests children,
    # Art-of-Switching children, dose-table children): treat L>=4 as
    # L3 units under the current L2.
    heads += [(p, 3, t) for lv, t, p in toc
              if a <= p <= b and lv >= 4]
    heads.sort()
    drugs = sorted([(p, t) for lv, t, p in toc if lv == 1 and p >= 24])
    pages = {}
    for i in range(a, b + 1):
        pages[i] = fix(doc[i - 1].get_text())
    l3set = {t for (p, lv, t) in heads if lv == 3}
    # span-geometry: map each head title -> y of its bold span per page
    # (heads = bold/size-21.2 or bold-15 at section starts; body bold lines
    # like '(bold for FDA approved)' are NOT in l3set so they never match)
    geoms = {}
    for i in range(a, b + 1):
        try:
            d = doc[i - 1].get_text("dict")
        except Exception:
            continue
        for bl in d["blocks"]:
            if bl.get("type") != 0:
                continue
            for ln in bl.get("lines", []):
                for s in ln.get("spans", []):
                    t = s["text"].strip()
                    if not t:
                        continue
                    if t in l3set and "Bold" in s["font"]:
                        geoms.setdefault(i, {})[t] = round(s["bbox"][1], 1)
                    elif t in l3set and s["font"].startswith("Type3"):
                        # icon bullet glued to a head: the head text itself
                        # is a sibling span; accept title on this page
                        geoms.setdefault(i, {}).setdefault(
                            t, round(s["bbox"][1], 1))
    # L2 banners (21.2) also cut units even when no L3 follows on the page
    l2set = {t for (p, lv, t) in heads if lv == 2}
    l2geoms = {}
    for i in range(a, b + 1):
        try:
            d = doc[i - 1].get_text("dict")
        except Exception:
            continue
        for bl in d["blocks"]:
            if bl.get("type") != 0:
                continue
            for ln in bl.get("lines", []):
                for s in ln.get("spans", []):
                    t = s["text"].strip()
                    if t in l2set and ("Bold" in s["font"] or s["size"] > 16):
                        l2geoms.setdefault(i, {})[t] = round(s["bbox"][1], 1)

    def drug_for(pg):
        d = drugs[0][1]
        for p, t in drugs:
            if p <= pg:
                d = t
        return d

    def l2_for(pg):
        run = None
        for p, lv, t in sorted(heads):
            if lv == 2 and p <= pg:
                run = t
        return run
    units, dose_flags = [], []
    cur = None
    pending_l2 = None
    lines = []
    for i in range(a, b + 1):
        for ln in pages[i].splitlines():
            lines.append((i, ln.strip()))
    for pg, ln in lines:
        if ln in l3set and ln in geoms.get(pg, {}):
            if cur and cur[2].strip():
                units.append(cur)
            cur = [drug_for(pg), l2_for(pg) or pending_l2, "", ln, pg, pg]
        elif ln in l2set and ln in l2geoms.get(pg, {}):
            if cur and cur[2].strip():
                units.append(cur)
                cur = None
            pending_l2 = ln
        elif ln == "Introduction" and pg == 13 and cur is None:
            cur = ["_front_matter", "Introduction", "", ln, pg, pg]
        elif cur is not None:
            if ln == cur[0] and not cur[2]:
                continue
            cur[2] += ("\n" if cur[2] else "") + ln
            cur[5] = pg
    if cur and cur[2].strip():
        units.append(cur)
    urows, xrows = [], []
    cseen = {}
    for i, (dg, l2, body, l3, p0, p1) in enumerate(units, 1):
        body = body.strip()
        if not body:
            continue
        if dg == "_front_matter":
            uid = f"stahl7-u-{p0:04d}-{i:03d}"
            urows.append({
                "id": uid, "book_id": BOOK_ID, "source_version": SV,
                "ingestion_version": "canonical-v2.1",
                "structural_path": ["Front matter", "Introduction", l3],
                "title": f"Introduction - {l3}",
                "content_type": "prose", "semantic_domain": "reference",
                "subject": "Prescriber's Guide", "predicate": "described_by",
                "object": body[:300],
                "population": None, "age_group": None,
                "context": "Introduction", "temporal_qualifier": None,
                "severity_qualifier": None, "exception_condition": None,
                "evidence_wording": body, "concept_ids": [],
                "entity_ids": [],
                "page_start": p0, "page_end": p1,
                "printed_page_start": str(p0), "printed_page_end": str(p1),
                "page_mapping_status": "certain", "source_position": i - 1,
                "parent_unit": None, "related_units": [],
                "table_figure_ids": [], "language": "en",
                "provenance": {"extractor": "pymupdf-geometry-v2",
                               "segment": f"range-{a:04d}-{b:04d}"},
                "confidence": "high", "extraction_status": "extracted",
                "validation_status": "auto_ok"})
            continue
        uid = f"stahl7-u-{p0:04d}-{i:03d}"
        l2 = l2 or "?"
        sd = SD.get(l3, "switching" if l2 == "The Art of Switching"
                    else ("medication" if l2 == "Suggested Reading"
                          else "therapeutics"))
        ctype = CT.get(l3, "reference" if l2 == "Suggested Reading"
                       else ("step" if l2 == "The Art of Switching"
                             else "prose"))
        vs = "needs_review" if (sd in ("dosing", "interaction", "precaution",
                                       "pregnancy-lactation")
                                or ctype == "rule") else "auto_ok"
        if re.search(r"\d+\s?(mg|mcg|g|mL|mg/day|units|%)", body):
            dose_flags.append(f"{uid} {l3}")
            if sd == "dosing":
                vs = "needs_review"
        pred = {"dosing": "dosed_as",
                "adverse-effect": "has_adverse_effect",
                "interaction": "interacts_with",
                "precaution": "requires_precaution",
                "pregnancy-lactation": "use_in_pregnancy_lactation",
                "pharmacokinetics": "has_pharmacokinetics",
                "therapeutics": "indicated_for"}.get(sd, "described_by")
        urows.append({
            "id": uid, "book_id": BOOK_ID, "source_version": SV,
            "ingestion_version": "canonical-v2.1",
            "structural_path": [dg, l2, l3], "title": f"{dg} - {l3}",
            "content_type": ctype, "semantic_domain": sd,
            "subject": dg, "predicate": pred, "object": body[:300],
            "population": None, "age_group": None,
            "context": l2, "temporal_qualifier": None,
            "severity_qualifier": None, "exception_condition": None,
            "evidence_wording": body, "concept_ids": [], "entity_ids": [],
            "page_start": p0, "page_end": p1,
            "printed_page_start": str(p0), "printed_page_end": str(p1),
            "page_mapping_status": "certain", "source_position": i - 1,
            "parent_unit": None, "related_units": [], "table_figure_ids": [],
            "language": "en",
            "provenance": {"extractor": "pymupdf-geometry-v2",
                           "segment": f"range-{a:04d}-{b:04d}"},
            "confidence": "high" if vs == "auto_ok" else "medium",
            "extraction_status": "extracted", "validation_status": vs})
        slug = re.sub(r"[^a-z0-9]+", "-", dg.lower()).strip("-")
        cid = f"stahl7-c-{slug}"
        cseen.setdefault(cid, {"concept_id": cid, "canonical": dg,
                               "source_terminology": dg, "aliases": [],
                               "related": [], "source_refs": []})
        cseen[cid]["source_refs"].append(uid)
        for m in re.finditer(
                r"(?:augment(?:ing)? with|see|switch(?:ing)? to) "
                r"([A-Z][a-z\-]+(?: [a-z]+)?)", body):
            xrows.append({"from_unit": uid, "target_text": m.group(0),
                          "target_unit": None, "status": "unresolved"})
    urows.sort(key=lambda r: r["id"])
    crows = [cseen[k] for k in sorted(cseen)]
    (VD / f"units-{letter}.jsonl").write_text(
        "".join(json.dumps(u, ensure_ascii=False) + "\n" for u in urows),
        encoding="utf-8")
    (VD / f"concepts-{letter}.jsonl").write_text(
        "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in crows),
        encoding="utf-8")
    seen_x, xuniq = set(), []
    for x in xrows:
        c = json.dumps(x, sort_keys=True, ensure_ascii=False)
        if c not in seen_x:
            seen_x.add(c)
            xuniq.append(x)
    (VD / f"xrefs-{letter}.jsonl").write_text(
        "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in xuniq),
        encoding="utf-8")
    meds = []
    for p, t in drugs:
        qi = drugs.index((p, t))
        nxt = drugs[qi + 1][0] - 1 if qi + 1 < len(drugs) else 2567
        if nxt < a or p > b:
            continue
        dus = [u for u in urows if u["structural_path"][0] == t]
        by_l3 = {}
        for u in dus:
            by_l3.setdefault(u["structural_path"][2], u["evidence_wording"])
        slug = re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
        gets = by_l3.get
        arts = " // ".join([v for k, v in by_l3.items() if k in (
            "Potential Advantages", "Potential Disadvantages",
            "Primary Target Symptoms", "Pearls")])
        meds.append({
            "med_id": f"stahl7-m-{slug}", "drug_name": t,
            "generic_available": None, "drug_class": gets("Class", ""),
            "brand_names": [], "indications": [],
            "usual_dosage_range": gets("Usual Dosage Range", ""),
            "dosage_forms": [], "how_to_dose": gets("How to Dose", ""),
            "dosing_tips": gets("Dosing Tips", ""),
            "overdose": gets("Overdose", ""),
            "long_term_use": gets("Long-Term Use", ""),
            "habit_forming": gets("Habit Forming", ""),
            "how_to_stop": gets("How to Stop", ""),
            "pharmacokinetics": gets("Pharmacokinetics", ""),
            "drug_interactions": gets("Drug Interactions", ""),
            "warnings_precautions": gets("Other Warnings/Precautions", ""),
            "do_not_use": [], "special_populations": {},
            "pregnancy": gets("Pregnancy", ""),
            "breast_feeding": gets("Breast Feeding", ""),
            "art_of_psychopharmacology": arts, "art_of_switching": "",
            "page_start": max(p, a), "page_end": min(nxt, b),
            "printed_page_start": str(max(p, a)),
            "printed_page_end": str(min(nxt, b)),
            "page_mapping_status": "certain",
            "unit_ids": [u["id"] for u in dus],
            "validation_status": "needs_review"})
    meds.sort(key=lambda r: r["med_id"])
    (VD / f"meds-{letter}.jsonl").write_text(
        "".join(json.dumps(m, ensure_ascii=False) + "\n" for m in meds),
        encoding="utf-8")
    print(f"RANGE {a}-{b} letter={letter}: units={len(urows)} "
          f"meds={len(meds)} concepts={len(crows)} xrefs={len(xuniq)}")
    print("DOSE-FLAGS:", len(dose_flags))
    for f in dose_flags[:20]:
        print("  ", f)


if __name__ == "__main__":
    main(int(sys.argv[1]), int(sys.argv[2]), sys.argv[3])
