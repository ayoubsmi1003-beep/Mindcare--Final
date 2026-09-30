# -*- coding: utf-8 -*-
"""Pre-M08 probe 14: title/path formats, med->dosing-unit coverage, how_to_dose relation."""
import json, re, sys, io, collections
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
units = [json.loads(l) for l in (VD / "units.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
meds = [json.loads(l) for l in (VD / "meds.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
umap = {u["id"]: u for u in units}

# 1. title construction rules
def title_ok(u):
    p = u["structural_path"]
    t = u["title"]
    cands = {"p1-p2": f"{p[1]} - {p[2]}", "p0-p2": f"{p[0]} - {p[2]}",
             "p0-p1-p2": " - ".join(p), "p0": p[0], "p1": p[1]}
    return [k for k, v in cands.items() if t == v]
cnt = collections.Counter()
bad = []
for u in units:
    ks = title_ok(u)
    if ks:
        cnt["|".join(ks)] += 1
    else:
        bad.append(u)
print("title-rule distribution:", dict(cnt))
print("no-rule matches:", len(bad))
for u in bad[:6]:
    print("  ", u["id"], u["structural_path"], "||", u["title"])

# path shapes: depth always 3?
print("depths:", collections.Counter(len(u["structural_path"]) for u in units))
# monograph roots
roots = collections.Counter(u["structural_path"][0] for u in units)
print("distinct roots:", len(roots), "| top:", roots.most_common(3))

# 2. med -> dosing units coverage
by_mono = collections.defaultdict(list)
for u in units:
    by_mono[u["structural_path"][0]].append(u)
no_dose = []
dose_cov = {}
for m in meds:
    uids = m.get("unit_ids") or []
    ds = [i for i in uids if i in umap and umap[i]["semantic_domain"] == "dosing"]
    dose_cov[m["med_id"]] = len(ds)
    if not ds:
        no_dose.append(m["med_id"])
print("meds with 0 dosing units:", len(no_dose), no_dose[:10])
dist = collections.Counter(min(v, 5) for v in dose_cov.values())
print("dosing-unit coverage dist (0..5+):", dict(sorted(dist.items())))

# 3. how_to_dose vs unit evidence relation
rel = collections.Counter()
for m in meds:
    h = (m.get("how_to_dose") or "").strip()
    if not h:
        rel["empty"] += 1
        continue
    uids = [i for i in (m.get("unit_ids") or []) if i in umap]
    evs = [umap[i]["evidence_wording"] for i in uids]
    if any(h == (e or "").strip() for e in evs):
        rel["equal-unit-evidence"] += 1
    elif any((e or "").strip().startswith(h) or h.startswith((e or "").strip()[:60]) for e in evs if e):
        rel["prefix-of-unit-evidence"] += 1
    elif any(h in (e or "") for e in evs):
        rel["substring-of-unit-evidence"] += 1
    else:
        rel["not-found-in-units"] += 1
print("how_to_dose relation:", dict(rel))

# 4. short adverse-effect units: which titles (CRITICAL candidates?)
short = [u for u in units if len((u.get("evidence_wording") or "").strip()) < 40
         and u["semantic_domain"] == "adverse-effect"]
print("short adverse-effect units:", [(u["id"], u["title"], repr(u["evidence_wording"])) for u in short])

# 5. L2 section distribution (for risk rules)
l2 = collections.Counter(u["structural_path"][1] for u in units)
print("L2 sections:", dict(l2.most_common(30)))
