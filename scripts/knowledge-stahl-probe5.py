# -*- coding: utf-8 -*-
"""Probe 5: L3 inventory + dry-run section-target candidates for 55 refs."""
import json, sys, io, collections, re
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")

def load(name):
    return [json.loads(l) for l in
            (VD / name).read_text(encoding="utf-8").splitlines() if l.strip()]

units, xrefs = load("units.jsonl"), load("xrefs.jsonl")
l3 = collections.Counter(r["structural_path"][2] for r in units)
print("== L3 titles (top 45) ==")
for t, c in l3.most_common(45):
    print(f"  {c:4d}  {t}")

umap = {r["id"]: r for r in units}
KEYS = {
    "see Pearls": ["pearl"],
    "see Warnings below": ["warning"],
    "see Children and": ["children"],
    "see How to": ["how to dose", "how to"],
    "see What to": ["what to do"],
}
print("== dry-run resolution candidates ==")
for x in [r for r in xrefs if r["status"] != "resolved"]:
    t = x["target_text"]
    r = umap[x["from_unit"]]
    mono = r["structural_path"][0]
    key = KEYS.get(t)
    if key is None:
        m = re.match(r"see ([A-Z][a-z]+)", t)
        kind = "table" if t.startswith("see Table") else (
            "drug" if m else "?")
        if kind == "drug":
            # formulation section inside same monograph?
            rest = t[len("see "):]
            keys = [rest.lower()]
            # full phrase extends past newline (e.g. Olanzapine Pamoate)
            mm = re.search(re.escape(t) + r"[\s]?([A-Za-z ]+)",
                           r["evidence_wording"])
            full = mm.group(0) if mm else t
            keys = [w for w in ["pamoate", "palmitate", "decanoate",
                                "depot", rest.lower()] if w in full.lower()]
            print(f"  DRUG {t!r} full={full[:60]!r} keys={keys}", end=" ")
        elif kind == "table":
            m2 = re.search(r"see Table (\d+)", t)
            n = m2.group(1)
            cands = [u["id"] for u in units
                     if u["structural_path"][0] == mono
                     and re.search(rf"\bTable {n}\.", u["evidence_wording"])]
            cands = [c for c in cands if c != r["id"]]
            print(f"  TABLE {t!r} mono={mono} n={n} cands={cands}", end=" ")
            continue
        else:
            keys = []
    else:
        print(f"  SECT {t!r}", end=" ")
        keys = key
    hits = [u for u in units if u["structural_path"][0] == mono
            and any(k in e.lower() for e in u["structural_path"][1:]
                     for k in keys)]
    hits.sort(key=lambda u: (u["page_start"], u["id"]))
    print(f"-> {len(hits)} hits"
          + (f" first={hits[0]['id']} {hits[0]['structural_path']}"
             if hits else ""))
