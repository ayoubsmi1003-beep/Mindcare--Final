# -*- coding: utf-8 -*-
"""Review-phase audit: classify the 1100-item queue, atomization metrics,
xref resolution breakdown, concepts/meds integrity, provenance checks.
Writes review-queue-audit.json next to the version dir. Read-only otherwise."""
import json, re, sys, io, collections
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")

def load(n):
    return [json.loads(l) for l in
            (VD / n).read_text(encoding="utf-8").splitlines() if l.strip()]

units, meds, xrefs, concepts = (load("units.jsonl"), load("meds.jsonl"),
                                load("xrefs.jsonl"), load("concepts.jsonl"))
queue = json.loads((VD / "review-queue.json").read_text(encoding="utf-8"))
umap = {u["id"]: u for u in units}
IDX = [u for u in units if u["content_type"] == "index-entry"]
CONTENT = [u for u in units if u["content_type"] != "index-entry"]

# --- 1. queue classification -------------------------------------------
UCAT = {"dosing": "unit/dose-therapeutic",
        "precaution": "unit/precaution-safety",
        "pregnancy-lactation": "unit/pregnancy-lactation",
        "interaction": "unit/drug-interaction"}
q_class = collections.Counter()
for q in queue:
    if q["kind"] == "med":
        q_class["med/dose-bearing"] += 1
    else:
        u = umap.get(q["id"])
        q_class[UCAT.get(u["semantic_domain"], "unit/other")
                if u else "unit/missing"] += 1

# --- 2. atomization metrics --------------------------------------------
depth_ok = sum(1 for u in units if len(u["structural_path"]) == 3)
title_ok = sum(1 for u in units
               if u["structural_path"][-1] == u["title"].split(" - ")[-1].strip())
atom_ok = sum(1 for u in units if u["subject"] and u["predicate"]
              and u["object"] and u["evidence_wording"])
page_ok = sum(1 for u in units if u["page_start"] <= u["page_end"])
back_ok = [u for u in units if u["page_end"] > 2682 or u["page_start"] > 2682]
short = [u for u in units if len(u["evidence_wording"]) < 40]
dup = collections.Counter(u["evidence_wording"] for u in units)
dup_groups = [k for k, v in dup.items() if v > 1]
has_xref = collections.Counter(x["from_unit"] for x in xrefs)
cap_see = re.compile(r"\bsee\s+[A-Z]")
uncov_see = [u["id"] for u in units
             if cap_see.search(u["evidence_wording"]) and not has_xref[u["id"]]]

low_see = collections.Counter()
low_see_uncovered = 0
for u in units:
    hits = re.findall(r"\bsee\s+([a-z][a-z]+)", u["evidence_wording"])
    if hits:
        for h in hits:
            low_see[h] += 1
        if not has_xref[u["id"]]:
            low_see_uncovered += 1

# --- 3. xref breakdown --------------------------------------------------
unres = [x for x in xrefs if x["status"] != "resolved"]
u_class = collections.Counter()
for x in unres:
    u_ = umap[x["from_unit"]]
    if x["target_text"] == "see Table":
        i = u_["evidence_wording"].find(x["target_text"])
        n = re.search(r"see Table\s*(\d+)", u_["evidence_wording"][i:])
        cap = re.compile(rf"Table {n.group(1) if n else '?'}. [A-Z]")
        u_class["intra-book/table-caption-in-same-unit"
                if cap.search(u_["evidence_wording"])
                else "intra-book/table-not-atomized"] += 1
    elif any("warn" in e.lower() for e in u_["structural_path"][1:]):
        u_class["intra-book/pointer-resolved-within-same-unit"] += 1
    else:
        u_class["intra-book/target-section-not-atomized"] += 1
CROSS_BOOK = [x for x in unres if not re.match(
    r"^see (Pearls|Warnings|Table|Children|How to|What to)",
    x["target_text"])]

# --- 4. concepts / meds integrity --------------------------------------
alias_concepts = [c for c in concepts if c.get("aliases")]
uid = set(u["id"] for u in units)
med_ids = set(m["med_id"] for m in meds)
med_dangling = [m["med_id"] for m in meds
                if any(u not in uid for u in m["unit_ids"])]
xref_dangling = [x for x in xrefs if x["from_unit"] not in uid]
xref_med_dangling = [x for x in xrefs if x["status"] == "resolved"
                     and x["target_unit"].startswith("stahl7-m-")
                     and x["target_unit"] not in med_ids]
xref_unit_dangling = [x for x in xrefs if x["status"] == "resolved"
                      and not x["target_unit"].startswith("stahl7-m-")
                      and x["target_unit"] not in uid]

# --- 5. provenance ------------------------------------------------------
sv = {f: sorted({r.get("source_version", "(absent)") for r in load(f)})
      for f in ("units.jsonl", "meds.jsonl", "concepts.jsonl")}
fffd = sum((VD / f).read_text(encoding="utf-8").count("\ufffd")
           for f in ("units.jsonl", "meds.jsonl", "xrefs.jsonl",
                     "concepts.jsonl", "structure.json", "book.json"))
report = {
  "phase": "canonical review (pre-chunking)",
  "queue": {"total": len(queue),
            "by_category": dict(sorted(q_class.items()))},
  "atomization": {"units_total": len(units), "content_units": len(CONTENT),
                  "index_units": len(IDX), "depth3": depth_ok,
                  "title_matches_path": title_ok, "atoms_complete": atom_ok,
                  "page_ranges_valid": page_ok,
                  "units_past_2682": len(back_ok),
                  "short_evidence_lt40": len(short),
                  "short_by_type": dict(collections.Counter(
                      u["content_type"] for u in short)),
                  "duplicate_evidence_groups": len(dup_groups),
                  "duplicate_rows_involved": sum(dup[k] for k in dup_groups),
                  "capital_see_uncovered": len(uncov_see),
                  "lowercase_see_uncovered_units": low_see_uncovered,
                  "lowercase_see_words": dict(low_see.most_common(8))},
  "xrefs": {"total": len(xrefs),
            "resolved": sum(1 for x in xrefs if x["status"] == "resolved"),
            "unresolved": len(unres),
            "unresolved_by_class": dict(sorted(u_class.items())),
            "unresolved_cross_book": len(CROSS_BOOK),
            "cross_book_rows": CROSS_BOOK,
            "dangling_from_units": len(xref_dangling),
            "dangling_med_targets": len(xref_med_dangling),
            "dangling_unit_targets": len(xref_unit_dangling)},
  "concepts": {"total": len(concepts),
               "with_aliases": len(alias_concepts),
               "total_trade_aliases": sum(len(c.get("aliases") or [])
                                          for c in alias_concepts)},
  "meds": {"total": len(meds),
           "with_brand_names": sum(1 for m in meds if m["brand_names"]),
           "with_indications": sum(1 for m in meds if m["indications"]),
           "with_drug_class": sum(1 for m in meds if m["drug_class"]),
           "dangling_unit_refs": len(med_dangling),
           "needs_review": sum(1 for m in meds
                               if m["validation_status"] == "needs_review")},
  "provenance": {"source_versions": sv, "u_fffd_total": fffd,
                 "page_span_all_units":
                     [min(u["page_start"] for u in units),
                      max(u["page_end"] for u in units)],
                 "idx_pages_included":
                     [min(u["page_start"] for u in IDX),
                      max(u["page_end"] for u in IDX)],
                 "src_2683_2697_units": len(back_ok)},
}
(VD / "review-queue-audit.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=1))
