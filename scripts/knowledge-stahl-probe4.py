# -*- coding: utf-8 -*-
"""Probe 4: hierarchy schema, L2 variant origin, isomer meds + index lines."""
import json, sys, io, collections, re
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
VD = (ROOT / "knowledge" / "canonical-v2" / "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")

def load(name):
    return [json.loads(l) for l in
            (VD / name).read_text(encoding="utf-8").splitlines() if l.strip()]

struct = json.loads((VD / "structure.json").read_text(encoding="utf-8"))
print("hierarchy:", json.dumps(struct["hierarchy"], ensure_ascii=False)[:600])
print("monograph_template_l2:", struct["monograph_template_l2"])
print("toc_source:", struct["toc_source"])
print("unlocated_sections:", json.dumps(struct["unlocated_sections"],
                                        ensure_ascii=False)[:300])

units, meds = load("units.jsonl"), load("meds.jsonl")
# L2 variants per monograph: does a monograph have MIXED casing?
by_m = collections.defaultdict(set)
for r in units:
    if r["content_type"] != "index-entry":
        by_m[r["structural_path"][0]].add(r["structural_path"][1])
mixed = {m: sorted(v) for m, v in by_m.items() if len(v) > 4}
print("monographs with >4 distinct L2:", len(mixed))
# how do variants distribute: per monograph, variant sets
var_sets = collections.Counter(tuple(sorted(v)) for v in by_m.values())
print("distinct L2-sets across monographs:", len(var_sets))
for s, c in var_sets.most_common(8):
    print(f"  x{c}: {s}")

iso = ["Amphetamine (D)", "Amphetamine (D,L)", "Methylfolate (L)",
       "Methylphenidate (D)", "Methylphenidate (D,L)"]
umap = {r["id"]: r for r in units}
for m in meds:
    if m["drug_name"] in iso:
        pages = [(umap[u]["page_start"], umap[u]["page_end"])
                 for u in m["unit_ids"] if u in umap]
        print("MED", m["med_id"], "| pages", min(p[0] for p in pages),
              "-", max(p[1] for p in pages), "| brand", m["brand_names"],
              "| ind", m["indications"][:3], "| class", m["drug_class"])

# index source lines for the isomer generics
src = (ROOT / "knowledge" / "sources")
cands = list(src.rglob("*.jsonl")) + list(src.rglob("*.json"))
print("source files:", [p.name for p in cands][:10])
iso_pat = re.compile(r"(d,\s?l-|d-|l-)(amphetamine|methylphenidate|methylfolate)",
                     re.I)
for p in cands:
    txt = p.read_text(encoding="utf-8", errors="replace")
    hits = [ln.strip()[:120] for ln in txt.splitlines()
            if iso_pat.search(ln)]
    if hits:
        print("FILE", p.name, "hits:", len(hits))
        for h in hits[:14]:
            print("   ", h)
