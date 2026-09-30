# -*- coding: utf-8 -*-
"""Probe 12: concepts aliases + meds enrichment after fixed index run."""
import json, sys, io
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")

def load(n):
    return [json.loads(l) for l in
            (VD / n).read_text(encoding="utf-8").splitlines() if l.strip()]

cons, meds = load("concepts.jsonl"), load("meds.jsonl")
al = {c["canonical"]: c["aliases"] for c in cons if c.get("aliases")}
print("concepts with aliases:", len(al))
print("sample:", dict(list(al.items())[:3]))
iso = ["Amphetamine (D)", "Amphetamine (D,L)", "Methylfolate (L)",
       "Methylphenidate (D)", "Methylphenidate (D,L)"]
for m in meds:
    if m["drug_name"] in iso:
        print(f"  {m['drug_name']}: brands={len(m['brand_names'])} "
              f"ind={m['indications']} class={m['drug_class'][:70]}")
        print("    brands sample:", m["brand_names"][:6])
nb = [m["drug_name"] for m in meds if not m["brand_names"]]
print("meds still without brand:", nb)
ni = [m["drug_name"] for m in meds if not m["indications"]]
print("meds still without indications:", ni)
nc = [m["drug_name"] for m in meds if not m["drug_class"]]
print("meds still without class:", nc)
