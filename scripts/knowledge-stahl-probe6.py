# -*- coding: utf-8 -*-
"""Probe 6: table caption precision, absent-section verification, 1091 gap."""
import json, sys, io, re, collections
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")

def load(name):
    return [json.loads(l) for l in
            (VD / name).read_text(encoding="utf-8").splitlines() if l.strip()]

units, xrefs = load("units.jsonl"), load("xrefs.jsonl")
umap = {r["id"]: r for r in units}

print("== TABLE refs: caption-like 'Table N. <Cap>' occurrences in monograph ==")
for x in [r for r in xrefs if r["status"] != "resolved"
          and r["target_text"] == "see Table"]:
    f = umap[x["from_unit"]]
    mono = f["structural_path"][0]
    ev = f["evidence_wording"]
    m = re.search(re.escape(x["target_text"]) + r"\s*(\d+)", ev)
    n = m.group(1) if m else "?"
    cap = re.compile(rf"Table {n}\. [A-Z]")
    hits = [(u["id"], u["page_start"], u["structural_path"][2][:26])
            for u in units if u["structural_path"][0] == mono
            and cap.search(u["evidence_wording"])]
    ctx = []
    for u in units:
        if u["structural_path"][0] != mono:
            continue
        mm = cap.search(u["evidence_wording"])
        if mm:
            ctx.append((u["id"] == x["from_unit"],
                        u["evidence_wording"][max(0, mm.start() - 18):
                                              mm.start() + 40]
                        .replace("\n", " ")))
    print(f"  {x['from_unit']} p{f['page_start']} {mono} T{n}: {hits}")
    for self_, c in ctx:
        print(f"      self={self_} ...{c!r}")

print("\n== 1091 gap unit ==")
f = umap["stahl7-u-1091-012"]
print("  ", f["structural_path"], "p", f["page_start"],
      "|", f["evidence_wording"][:160].replace("\n", " | "))
mono = f["structural_path"][0]
print("   pearls cands:", [(u["id"], u["page_start"]) for u in units
                           if u["structural_path"][0] == mono
                           and any("pearl" in e.lower()
                                   for e in u["structural_path"][1:])])

print("\n== absent-section verification ==")
for mono, key in [("Temazepam", "warn"), ("Carbamazepine", "children"),
                  ("Gabapentin", "children"), ("Brexanolone", "how to dose")]:
    secs = sorted({(u["structural_path"][1], u["structural_path"][2])
                   for u in units if u["structural_path"][0] == mono})
    print(f"  {mono}: L3={sorted({s[1] for s in secs})}")
    print(f"      key {key!r} present: "
          f"{any(key in (a + ' ' + b).lower() for a, b in secs)}")
