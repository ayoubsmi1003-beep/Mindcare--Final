# -*- coding: utf-8 -*-
"""Stahl back-matter distiller P1: Index by Drug Name / Use / Class +
Abbreviations -> index-entry units + enrichment. No OCR.
Index page refs are PRINTED numbers; identity map (printed=source)."""
import json, re, sys, io
from pathlib import Path
import pymupdf
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Books" / "prescribers-guide-stahls-essential-psychopharmacology.pdf"
BOOK_ID = "stahl-prescribers-guide-7e-cup"
SV = "sha256:cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
SVD = "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
VD = ROOT / "knowledge" / "canonical-v2" / BOOK_ID / SVD

def fix(s):
    s = s.replace("\u273d", "")
    return re.sub(r"[ \t]+", " ", s).strip()

NAME_RX = re.compile(r"^(.+?)\s*\(([^)]+)\)\s*,?\s*(\d+)?\s*$")
PLAIN_RX = re.compile(r"^([A-Za-z][A-Za-z0-9 \-'\/,\.]+?)\s*,?\s*(\d+)\s*$")
BACK = ("Index by Drug Name", "Index by Use", "Index by Class",
        "Abbreviations", "Endmatter")

def drug_index(doc):
    toc = doc.get_toc(simple=True)
    drugs = sorted([(p, t) for lv, t, p in toc if lv == 1 and p >= 24
                    and t not in BACK])
    names = {t.lower(): t for _, t in drugs}
    slugs = {t: re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")
             for _, t in drugs}
    return drugs, names, slugs

def norm_generic(s):
    g = s.split(",")[0].strip().lower()
    g = re.sub(r"\s*\(.*?\)\s*", "", g).strip()
    for pre in ("d,l-", "d, l-", "d-", "l-"):
        if g.startswith(pre):
            g = g[len(pre):].strip()
    return g

def iso_form(s):
    """Lowercase, spaces removed, parens removed, isomer prefix KEPT:
    'd, l-methylphenidate' -> 'd,l-methylphenidate'; 'l-methylfolate' kept."""
    s = re.sub(r"\s*\(.*?\)\s*", " ", s).strip().lower()
    return re.sub(r"\s+", "", s)

def build_keys(names):
    """title.lower() -> title, plus isomer line-forms for paren'd titles:
    'Amphetamine (D,L)' -> 'd,l-amphetamine' -> title (source-established)."""
    keys = dict(names)
    for low, title in names.items():
        m = re.match(r"^(.+?)\s*\(([^)]+)\)$", title)
        if m:
            iso = m.group(2).lower().replace(" ", "") + "-" + m.group(1).lower()
            keys[iso] = title
    return keys

def is_combo(raw):
    return "/" in raw and "combination" in raw.lower()

def clean_entry(ln):
    s = re.sub(r"(?:\s*,\s*\d+)+\s*,?\s*$", "", ln).strip()
    return s.rstrip(", ").strip()

def resolve_title(d, keys):
    """Entry text -> TOC title for link/indications/class attribution."""
    d0 = re.sub(r"\s*\(adjunct\)\s*", "", d)
    low = norm_generic(d0)
    if low in keys:
        return keys[low]
    iso = iso_form(d0)
    if iso in keys:
        return keys[iso]
    mm = re.match(r"^(.+?)\s*\(([^)]+)\)$", d0)
    if mm and mm.group(2).strip().lower() != "adjunct":
        cand = mm.group(2).lower().replace(" ", "") + "-" + mm.group(1).lower()
        if cand in keys:
            return keys[cand]
    return None


def drug_name_lines(doc, keys):
    alias = {}
    for i in range(2568, 2628):
        for ln in fix(doc[i - 1].get_text()).splitlines():
            ln = ln.strip()
            if not ln or ln.startswith("Index by") or ln.startswith(
                    "(trade names"):
                continue
            m = NAME_RX.match(ln)
            if not m or not m.group(1).strip():
                continue
            trade, gen = m.group(1).strip(), m.group(2).strip()
            g = norm_generic(gen)
            if g in keys:
                alias.setdefault(g, set()).add(trade)
            elif gen.strip().lower() in keys:
                alias.setdefault(keys[gen.strip().lower()].lower(),
                                 set()).add(trade)
            elif iso_form(gen) in keys:
                # isomer-qualified generic -> isomer monograph title key
                alias.setdefault(keys[iso_form(gen)].lower(),
                                 set()).add(trade)
    return alias

def use_class_lines(doc, keys, a, b, skip):
    out, cur = {}, None
    for i in range(a, b + 1):
        for ln in fix(doc[i - 1].get_text()).splitlines():
            ln = ln.strip()
            if not ln or any(ln.startswith(s) for s in skip):
                continue
            m = NAME_RX.match(ln) or PLAIN_RX.match(ln)
            if m:
                raw = m.group(1).strip()
                low = norm_generic(re.sub(r"\s*\(adjunct\)\s*", "", raw))
                g2 = (m.group(2).strip()
                      if NAME_RX.match(ln) and m.re is NAME_RX else "")
                if low in keys and cur:
                    out.setdefault(cur, []).append(raw)
                elif g2 and g2.lower() != "adjunct" and \
                        (g2.lower().replace(" ", "") + "-" + raw.lower()) \
                        in keys and cur:
                    # isomer entry (e.g. amphetamine (d,l)): stays under the
                    # current use/class header, qualifier kept in the entry
                    out.setdefault(cur, []).append(f"{raw} ({g2})")
                elif not g2 and iso_form(raw) in keys and cur:
                    # isomer-qualified base as group1 (e.g. l-methylfolate
                    # with '(adjunct)' split off by NAME_RX)
                    out.setdefault(cur, []).append(raw)
                elif g2 and g2.lower() == "adjunct" and \
                        iso_form(raw) in keys and cur:
                    out.setdefault(cur, []).append(raw)
                elif is_combo(raw) and cur:
                    # combination therapy line: index entry, no monograph
                    out.setdefault(cur, []).append(clean_entry(ln))
                elif low not in keys and not is_combo(raw) and \
                        iso_form(raw) not in keys and \
                        (not g2 or g2.lower() == "adjunct" or
                         (g2.lower().replace(" ", "") + "-" + raw.lower())
                         not in keys):
                    cur = ln  # genuine header line (source-verbatim)
            else:
                cur = ln
    return out
def main():
    doc = pymupdf.open(SRC)
    drugs, names, slugs = drug_index(doc)
    keys = build_keys(names)
    alias = drug_name_lines(doc, keys)
    uses = use_class_lines(doc, keys, 2628, 2657,
                           ("Index by", "Commonly Prescribed"))
    klass = use_class_lines(doc, keys, 2658, 2670, ("Index by",))
    buf = []
    for i in range(2671, 2683):
        for ln in fix(doc[i - 1].get_text()).splitlines():
            ln = ln.strip()
            if ln and ln != "Abbreviations":
                buf.append(ln)
    abbr = {buf[k]: buf[k + 1] for k in range(0, len(buf) - 1, 2)}
    urows, xrows = [], []

    def emit(path, title, body, p0, p1):
        urows.append({
            "id": f"stahl7-u-{p0:04d}-x{len(urows)+1:02d}",
            "book_id": BOOK_ID, "source_version": SV,
            "ingestion_version": "canonical-v2.1",
            "structural_path": path, "title": title,
            "content_type": "index-entry", "semantic_domain": "reference",
            "subject": path[-1], "predicate": "indexed_in",
            "object": body[:300], "population": None, "age_group": None,
            "context": "Back matter index", "temporal_qualifier": None,
            "severity_qualifier": None, "exception_condition": None,
            "evidence_wording": body, "concept_ids": [], "entity_ids": [],
            "page_start": p0, "page_end": p1,
            "printed_page_start": str(p0), "printed_page_end": str(p1),
            "page_mapping_status": "certain",
            "source_position": len(urows), "parent_unit": None,
            "related_units": [], "table_figure_ids": [], "language": "en",
            "provenance": {"extractor": "pymupdf-index",
                           "segment": "range-2568-2682"},
            "confidence": "high", "extraction_status": "extracted",
            "validation_status": "auto_ok"})
        return urows[-1]["id"]

    def link(uid, label, d):
        title = resolve_title(d, keys)
        if title:
            xrows.append({"from_unit": uid,
                          "target_text": f"{label}: {d}",
                          "target_unit": f"stahl7-m-{slugs[title]}",
                          "status": "resolved"})
    for use, ds in sorted(uses.items()):
        emit(["Back matter", "Index by Use", use],
             f"Index by Use - {use}",
             f"{use}: " + "; ".join(ds), 2628, 2657)
        uid = urows[-1]["id"]
        for d in ds:
            link(uid, "Index by Use", d)
    for cl, ds in sorted(klass.items()):
        emit(["Back matter", "Index by Class", cl],
             f"Index by Class - {cl}", f"{cl}: " + "; ".join(ds),
             2658, 2670)
        uid = urows[-1]["id"]
        for d in ds:
            link(uid, "Index by Class", d)
    emit(["Back matter", "Abbreviations", "Abbreviations"],
         "Abbreviations",
         "\n".join(f"{k}: {v}" for k, v in sorted(abbr.items())),
         2671, 2682)
    (VD / "units-IDX.jsonl").write_text(
        "".join(json.dumps(u, ensure_ascii=False) + "\n" for u in urows),
        encoding="utf-8")
    (VD / "xrefs-IDX.jsonl").write_text(
        "".join(json.dumps(x, ensure_ascii=False) + "\n" for x in xrows),
        encoding="utf-8")
    cons = [json.loads(l) for l in
            (VD / "concepts.jsonl").read_text(encoding="utf-8").splitlines()
            if l.strip()]
    inv_use, inv_cl = {}, {}
    for use, ds in uses.items():
        for d in ds:
            t = resolve_title(d, keys)
            if t:
                inv_use.setdefault(t, []).append(use)
    for cl, ds in klass.items():
        for d in ds:
            t = resolve_title(d, keys)
            if t:
                inv_cl.setdefault(t, []).append(cl)
    for c in cons:
        g = c["canonical"].lower()
        if g in alias:
            c["aliases"] = sorted(alias[g])
    (VD / "concepts.jsonl").write_text(
        "".join(json.dumps(c, ensure_ascii=False) + "\n" for c in cons),
        encoding="utf-8")
    meds = [json.loads(l) for l in
            (VD / "meds.jsonl").read_text(encoding="utf-8").splitlines()
            if l.strip()]
    for m in meds:
        dn = m["drug_name"]
        if dn in inv_use:
            m["indications"] = sorted(set(inv_use[dn]))
        if dn in inv_cl:
            extra = sorted(set(inv_cl[dn]))
            have = [s.strip() for s in m["drug_class"].split("//")]
            have = [h for h in have if h]
            merged = list(have)
            base = set()
            for h in have:
                base.update(x.strip() for x in h.split(";") if x.strip())
            for e in extra:
                if e not in base and e not in merged:
                    merged.append(e)
            m["drug_class"] = " // ".join(merged)
        trades = sorted(alias.get(dn.lower(), []))
        if trades:
            m["brand_names"] = trades
    (VD / "meds.jsonl").write_text(
        "".join(json.dumps(m, ensure_ascii=False) + "\n" for m in meds),
        encoding="utf-8")
    print(f"IDX: units={len(urows)} xrefs={len(xrows)} "
          f"({sum(1 for x in xrows if x['status']=='resolved')} resolved)")
    print(f"alias generics: {len(alias)} | uses: {len(uses)} | "
          f"classes: {len(klass)} | abbr: {len(abbr)}")


if __name__ == "__main__":
    main()
