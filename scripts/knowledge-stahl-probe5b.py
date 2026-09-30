# -*- coding: utf-8 -*-
"""Probe 5b: per-ref candidate detail with page ordering (read-only)."""
import json, sys, io, re
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
for x in [r for r in xrefs if r["status"] != "resolved"]:
    t, uid = x["target_text"], x["from_unit"]
    f = umap[uid]
    mono, fp = f["structural_path"], f["page_start"]
    ev = f["evidence_wording"]
    i = ev.find(t)
    after = ev[i + len(t):i + len(t) + 55].replace("\n", " ") if i >= 0 else "?"
    print(f"\n{uid} p{fp} {mono} :: {t!r} -> {after!r}")
    if t.startswith("see Table"):
        m = re.search(re.escape(t) + r"\s*(\d+)", ev)
        n = m.group(1) if m else None
        if n:
            cands = [(u["id"], u["page_start"], u["structural_path"][2][:32],
                      u["evidence_wording"][:45].replace("\n", " "))
                     for u in units
                     if u["structural_path"][0] == mono[0]
                     and u["id"] != uid
                     and re.search(rf"\bTable {n}\.", u["evidence_wording"])]
            print(f"   Table {n} caption cands: {cands}")
        else:
            print("   table number NOT found in evidence")
        continue
    # section/drug candidates: any path element containing key words
    rest = t[4:].lower()
    keys = [rest.split(" ")[0]]
    if "warnings" in rest:
        keys = ["warn"]
    if "children" in rest:
        keys = ["children"]
    if "how to" in rest:
        keys = ["how to"]
    if "what to" in rest:
        keys = ["what to do"]
    if "pearls" in rest:
        keys = ["pearl"]
    # formulation refs: use continuation words
    mm = re.search(re.escape(t) + r"\s+([A-Za-z ]{0,40})", ev)
    full = (mm.group(1) if mm else "").lower()
    for w in ("pamoate", "palmitate", "decanoate", "depot"):
        if w in full:
            keys = [w]
    seen = {}
    for u in units:
        if u["structural_path"][0] != mono[0]:
            continue
        for e in u["structural_path"][1:]:
            el = e.lower()
            if any(k in el for k in keys):
                seen.setdefault((u["structural_path"][1],
                                 u["structural_path"][2]),
                                []).append((u["id"], u["page_start"]))
    for sec, rows in sorted(seen.items()):
        rows.sort(key=lambda r: r[1])
        pos = "-> " + ("AFTER" if rows[0][1] >= fp else
                       "contains-self" if any(r[0] == uid for r in rows)
                       else "BEFORE")
        print(f"   sec {sec} n={len(rows)} pages {rows[0][1]}-{rows[-1][1]} "
              f"{pos} first={rows[0][0]} self={'Y' if any(r[0]==uid for r in rows) else 'n'}")
