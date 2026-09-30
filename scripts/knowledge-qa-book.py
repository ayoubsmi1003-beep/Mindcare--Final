# -*- coding: utf-8 -*-
"""Book QA gates for canonical-v2 (PASS / WARNING / BLOCKED) + review queue.
Usage: python scripts/knowledge-qa-book.py <book_version_dir>
Reads book.json, pages.map.json, structure.json, merged *.jsonl; writes
qa-report.json and review-queue.json. Never repairs content; only reports.
"""
import json, sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

UNIT_KEYS = ["id","book_id","source_version","ingestion_version","structural_path",
 "title","content_type","semantic_domain","subject","predicate","object",
 "population","age_group","context","temporal_qualifier","severity_qualifier",
 "exception_condition","evidence_wording","concept_ids","entity_ids",
 "page_start","page_end","printed_page_start","printed_page_end",
 "page_mapping_status","source_position","parent_unit","related_units",
 "table_figure_ids","language","provenance","confidence","extraction_status",
 "validation_status"]
CT_ENUM = {"definition","guideline","rule","step","example","criteria","specifier",
 "severity","box","list","footnote","table-ref","algorithm-ref","prose",
 "reference","index-entry","code-list"}
VS_ENUM = {"auto_ok","needs_review","blocked","approved"}
PM_ENUM = {"certain","uncertain","inferred","missing"}

def load_jsonl(p: Path):
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines()
            if l.strip()] if p.exists() else []

def main(d: Path) -> int:
    checks, review = [], []
    def gate(name, status, detail):
        checks.append({"check": name, "status": status, "detail": detail})

    book = json.loads((d / "book.json").read_text(encoding="utf-8"))
    pmap = json.loads((d / "pages.map.json").read_text(encoding="utf-8"))
    struct = json.loads((d / "structure.json").read_text(encoding="utf-8"))
    units = load_jsonl(d / "units.jsonl")
    tables = load_jsonl(d / "tables.jsonl")
    concepts = load_jsonl(d / "concepts.jsonl")
    xrefs = load_jsonl(d / "xrefs.jsonl")
    meds = load_jsonl(d / "meds.jsonl")
    if meds:
        badm = [m.get("med_id", "?") for m in meds
                if not m.get("med_id") or not m.get("drug_name")
                or m.get("validation_status") != "needs_review"]
        gate("meds-review-closed", "PASS" if not badm else "BLOCKED",
             badm or f"{len(meds)} meds rows, all needs_review")
        nomed = [m["med_id"] for m in meds if not m.get("unit_ids")]
        gate("meds-units-linked", "PASS" if not nomed else "WARNING",
             nomed or "all meds link >=1 unit")
        # dose text verbatim: flag suspicious numeric/unit patterns
        import re as _re
        susp = [m["med_id"] for m in meds if _re.search(
            r"\ufffd", (m.get("usual_dosage_range", "") or "")
            + (m.get("how_to_dose", "") or ""))]
        gate("meds-encoding-clean", "PASS" if not susp else "BLOCKED",
             susp or "no U+FFFD in dose fields")

    # 1. schema conformance
    bad = []
    for u in units:
        missing = [k for k in UNIT_KEYS if k not in u]
        if missing: bad.append((u.get("id","?"), f"missing keys {missing}"))
        if u.get("content_type") not in CT_ENUM: bad.append((u["id"], "content_type"))
        if u.get("validation_status") not in VS_ENUM: bad.append((u["id"], "validation_status"))
        if u.get("page_mapping_status") not in PM_ENUM: bad.append((u["id"], "page_mapping_status"))
    gate("schema-units", "PASS" if not bad else "BLOCKED", bad or f"{len(units)} units conform")

    # 2. id uniqueness
    ids = [u["id"] for u in units]
    dup = sorted({i for i in ids if ids.count(i) > 1})
    gate("unit-id-unique", "PASS" if not dup else "BLOCKED", dup or f"{len(ids)} unique")

    # 3. dual-page consistency (printed = src + offset)
    off = pmap.get("offset")
    mism = []
    for u in units:
        try:
            if int(u["printed_page_start"]) != u["page_start"] + off:
                mism.append(u["id"])
        except (TypeError, ValueError):
            mism.append(f'{u["id"]}(non-numeric printed)')
    gate("dual-page-consistency", "PASS" if not mism else "BLOCKED",
         mism or f"offset {off} holds for all units")

    # 4. uncertain pages never silent
    unc = [u["id"] for u in units if u["page_mapping_status"] != "certain"]
    gate("page-uncertainty-surfaced", "PASS" if not unc else "WARNING",
         unc or "all unit pages certain")

    # 5. structure coverage: L1 drug sections appearing in >=1 unit path.
    # section_id drug-NNN maps to the Nth drug title; drug_index also stored.
    covered = {s for u in units for s in u["structural_path"]}
    drug_secs = [s for s in struct["sections"] if s.get("depth") == 1]
    gaps = [s["section_id"] for s in drug_secs
            if s.get("title") not in covered]
    all_secs = [s["section_id"] for s in drug_secs]
    pct = 100 * (len(all_secs) - len(gaps)) / max(1, len(all_secs))
    gate("structure-coverage", "WARNING" if gaps else "PASS",
         f"{len(all_secs)-len(gaps)}/{len(all_secs)} sections covered ({pct:.1f}%); gaps: {len(gaps)}")

    # 6. orphan concepts + unreferenced concepts.
    # NOTE: this book's concepts are per-drug rows whose source_refs point
    # at unit ids; units carry concept_ids=[] by design (link lives on the
    # concept side + meds.unit_ids). So "referenced" = has >=1 valid
    # source_ref, not appearance in unit.concept_ids.
    unit_ids = set(ids)
    orphan, unref = [], []
    for c in concepts:
        miss = [r for r in c.get("source_refs", []) if r not in unit_ids]
        if miss:
            orphan.append({c["concept_id"]: miss})
        if not c.get("source_refs"):
            unref.append(c["concept_id"])
    gate("concept-refs-resolve", "PASS" if not orphan else "WARNING", orphan or "ok")
    gate("concepts-referenced", "PASS" if not unref else "WARNING",
         unref[:20] or "all concepts carry >=1 valid source_ref")

    # 7. unresolved xrefs
    unr = [x for x in xrefs if x.get("status") != "resolved"]
    gate("xrefs-resolved", "PASS" if not unr else "WARNING",
         f"{len(unr)}/{len(xrefs)} unresolved")

    # 8. tables pending review
    tnr = [t["table_id"] for t in tables if t.get("validation_status") != "auto_ok"]
    gate("tables-reviewed", "PASS" if not tnr else "WARNING", tnr or "ok")

    # review queue: units/tables needing human eyes + uncertain structure anchors
    for u in units:
        if u["validation_status"] != "auto_ok" or u["page_mapping_status"] != "certain":
            review.append({"kind": "unit", "id": u["id"],
                           "reason": f'{u["validation_status"]}/{u["page_mapping_status"]}',
                           "printed_pages": [u["printed_page_start"], u["printed_page_end"]]})
    for t in tables:
        if t.get("validation_status") != "auto_ok":
            review.append({"kind": "table", "id": t["table_id"], "reason": t["validation_status"],
                           "printed_pages": [t["printed_page_start"], t["printed_page_end"]]})
    for s in struct["sections"]:
        if s.get("page_mapping_status") != "certain":
            review.append({"kind": "structure-anchor", "id": s["section_id"],
                           "reason": s.get("page_mapping_status"),
                           "printed_pages": [s.get("printed_page_start")]})

    worst = "BLOCKED" if any(c["status"] == "BLOCKED" for c in checks) else \
            ("WARNING" if any(c["status"] == "WARNING" for c in checks) else "PASS")
    counts = {"units": len(units), "tables": len(tables),
              "concepts": len(concepts), "xrefs": len(xrefs)}
    if meds:
        counts["meds"] = len(meds)
        for m in meds:
            review.append({"kind": "med", "id": m["med_id"],
                           "reason": "dose-bearing: human verification "
                                     "required",
                           "printed_pages": [m.get("printed_page_start"),
                                             m.get("printed_page_end")]})
    report = {"book_id": book["book_id"], "source_version": book["source_version"],
              "ingestion_version": book["ingestion_version"],
              "overall": worst, "counts": counts,
              "checks": checks, "review_queue_size": len(review)}
    (d / "qa-report.json").write_text(json.dumps(report, ensure_ascii=False, indent=1),
                                      encoding="utf-8")
    (d / "review-queue.json").write_text(json.dumps(review, ensure_ascii=False, indent=1),
                                         encoding="utf-8")
    print(f"OVERALL: {worst} | units={len(units)} tables={len(tables)} "
          f"concepts={len(concepts)} xrefs={len(xrefs)} | review queue={len(review)}")
    for c in checks:
        print(f"  [{c['status']}] {c['check']}: {str(c['detail'])[:120]}")
    return 0 if worst != "BLOCKED" else 1

if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
