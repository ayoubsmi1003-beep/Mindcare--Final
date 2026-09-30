# -*- coding: utf-8 -*-
"""Read-only probe for the Stahl 7 canonical review phase (no writes)."""
import json, sys, io, collections, statistics
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")

def load(name):
    return [json.loads(l) for l in
            (VD / name).read_text(encoding="utf-8").splitlines() if l.strip()]

units, meds, xrefs, concepts = (load("units.jsonl"), load("meds.jsonl"),
                                load("xrefs.jsonl"), load("concepts.jsonl"))
nr = [r for r in units if r["validation_status"] == "needs_review"]
print("needs_review:", len(nr))
print("by L2:", collections.Counter(
    r["structural_path"][1] if len(r["structural_path"]) > 1 else "<none>"
    for r in nr).most_common(25))
print("by sem:", collections.Counter(
    r["semantic_domain"] for r in nr).most_common(15))
ew = [len(r["evidence_wording"]) for r in units]
print("ew min/med/p95/max:", min(ew), statistics.median(ew),
      sorted(ew)[int(len(ew) * .95)], max(ew))
print("empty ew:", sum(1 for e in ew if e == 0),
      "| empty subject:", sum(1 for r in units if not r["subject"]),
      "| empty predicate:", sum(1 for r in units if not r["predicate"]),
      "| empty object:", sum(1 for r in units if not r["object"]))
print("depth:", collections.Counter(len(r["structural_path"]) for r in units))
print("bad page range:", sum(1 for r in units
                             if r["page_start"] > r["page_end"]))
print("IDX page span:", min(r["page_start"] for r in units
                            if r["content_type"] == "index-entry"),
      max(r["page_end"] for r in units
          if r["content_type"] == "index-entry"))
med_ids = set(m["med_id"] for m in meds)
uid = set(r["id"] for r in units)
bad_t = [x for x in xrefs if x["status"] == "resolved"
         and x["target_unit"] not in med_ids and x["target_unit"] not in uid]
print("resolved xrefs w/ dangling target:", len(bad_t), bad_t[:3])
bad_f = [x for x in xrefs if x["from_unit"] not in uid]
print("xrefs w/ dangling from_unit:", len(bad_f))
m_no_unit = [m["med_id"] for m in meds
             if any(u not in uid for u in m["unit_ids"])]
print("meds with dangling unit_ids:", len(m_no_unit), m_no_unit[:5])
print("meds no brand:", sum(1 for m in meds if not m["brand_names"]),
      [m["drug_name"] for m in meds if not m["brand_names"]])
print("meds no indications:", sum(1 for m in meds if not m["indications"]))
print("meds no class:", sum(1 for m in meds if not m["drug_class"]))
ew_units = [r for r in units if "see " in r["evidence_wording"].lower()]
print("units w/ internal 'see ':", len(ew_units))
xs = set(x["from_unit"] for x in xrefs)
print("  ...of which covered by xref row:", sum(
    1 for r in ew_units if r["id"] in xs))
dup = collections.Counter(r["evidence_wording"] for r in units)
d2 = [k for k, v in dup.items() if v > 1]
print("duplicate evidence_wording groups:", len(d2),
      "| rows involved:", sum(dup[k] for k in d2))
print("title==last(path):", sum(1 for r in units
    if r["structural_path"] and r["title"].split(" - ")[-1].strip()
    == r["structural_path"][-1]), "/", len(units))
