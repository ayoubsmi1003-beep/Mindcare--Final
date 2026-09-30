# -*- coding: utf-8 -*-
"""Pre-M08 probe 16: verify deterministic selection targets for golden set exist."""
import json, re, sys, io, collections
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
units = [json.loads(l) for l in (VD / "units.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
concepts = [json.loads(l) for l in (VD / "concepts.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
xrefs = [json.loads(l) for l in (VD / "xrefs.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

def cnt(pred, src=units):
    r = [u for u in src if pred(u)]
    return len(r), (r[0]["id"], r[0]["title"]) if r else None

print("title Contraindicat:", cnt(lambda u: re.search(r"contraindicat", u["title"], re.I)))
print("title Maximum:", cnt(lambda u: re.search(r"maximum", u["title"], re.I)))
print("dosing evid maximum:", cnt(lambda u: u["semantic_domain"] == "dosing" and re.search(r"maximum", u.get("evidence_wording") or "", re.I)))
print("dosing evid titrat:", cnt(lambda u: u["semantic_domain"] == "dosing" and re.search(r"titrat", u.get("evidence_wording") or "", re.I)))
print("title Commonly Prescribed:", cnt(lambda u: "Commonly Prescribed" in u["title"]))
print("title Warning:", cnt(lambda u: re.search(r"warning", u["title"], re.I)))
print("title Pregnant/Pregnancy:", cnt(lambda u: re.search(r"pregnan", u["title"], re.I)))
print("title Lactation/Breast:", cnt(lambda u: re.search(r"lactat|breast", u["title"], re.I)))
print("title Children:", cnt(lambda u: re.search(r"children|adolescent", u["title"], re.I)))
print("title Interaction:", cnt(lambda u: re.search(r"interaction", u["title"], re.I)))
sp = collections.Counter(u["structural_path"][2] for u in units if u["structural_path"][1].lower().startswith("special population"))
print("special-pop L3:", dict(sp.most_common(12)))
print("evidence titration how-to-dose unit sample:", cnt(lambda u: u["semantic_domain"] == "dosing" and re.search(r"maximum", u.get("evidence_wording") or "", re.I)))
# multi-line dosing unit with most lines
ml = [u for u in units if u["semantic_domain"] == "dosing" and "\n" in (u.get("evidence_wording") or "")]
big = max(ml, key=lambda u: (len(u["evidence_wording"].split("\n")), u["id"]))
print("biggest dose table:", big["id"], big["title"], len(big["evidence_wording"].split("\n")), "lines")
# first resolved xref by from_unit
rx = sorted([x for x in xrefs if x["status"] == "resolved"], key=lambda x: (x["from_unit"], x["target_text"]))
print("first resolved xref:", rx[0])
# first concept sorted with aliases
cs = sorted(concepts, key=lambda c: c.get("concept_id") or c.get("id") or "")
c0 = cs[0]
print("first concept keys:", sorted(c0.keys()))
print("first concept:", json.dumps({k: c0[k] for k in list(c0)[:8]}, ensure_ascii=False)[:300])
# units carrying that concept id
cid = c0.get("concept_id") or c0.get("id")
hits = [u for u in units if cid in (u.get("concept_ids") or [])]
print("units for first concept:", len(hits), [h["id"] for h in hits[:3]])
# not-atomized from units (Brexanolone/Temazepam children/how-to)
na = [x for x in xrefs if x["status"] == "unresolved"]
print("unresolved from_units sample:", [(x["from_unit"], x["target_text"]) for x in na[:3]])
