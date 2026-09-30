# -*- coding: utf-8 -*-
"""Pre-M08 probe 13: validate evidence/table heuristics on real units (read-only)."""
import json, re, sys, io, collections
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")

units = [json.loads(l) for l in (VD / "units.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
meds = [json.loads(l) for l in (VD / "meds.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

# 1 heading format
hbad = [u["id"] for u in units
        if u["title"] != f'{u["structural_path"][1]} - {u["structural_path"][2]}']
print("heading mismatch:", len(hbad), hbad[:5])

DANG = re.compile(r"\b(and|or|of|the|to|with|in|for|a|an|on|at|by|as|is|are|be|from)$", re.I)
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
FOOT = re.compile(r"copyright|all rights reserved|wolters kluwer|^\s*©", re.I)
DOSE_PAT = re.compile(r"\d+(\.\d+)?\s*(mg|mcg|µg|ug|g|ml|mg/kg|tabs?|tablets?|caps?)\b", re.I)

dang = ctrl = foot = fffd = 0
for u in units:
    ev = u.get("evidence_wording") or ""
    ob = u.get("object") or ""
    if DANG.search(ev.strip().split("\n")[-1].strip(" .;:")) and not ev.rstrip().endswith((".", "!", "?", ":", ";", ")")):
        dang += 1
    if CTRL.search(ev) or CTRL.search(ob):
        ctrl += 1
    if FOOT.search(ev) or FOOT.search(ob):
        foot += 1
    if "\ufffd" in ev or "\ufffd" in ob or "\ufffd" in u["title"]:
        fffd += 1
print("continuation-suspect:", dang, "| control-chars:", ctrl, "| footer-leak:", foot, "| U+FFFD:", fffd)

# standalone page-number line == pdf page (footer leakage heuristic)
fnum = sum(1 for u in units
           if any(ln.strip().isdigit() and int(ln.strip()) in (u["page_start"], u["page_end"])
                  for ln in (u.get("evidence_wording") or "").split("\n")))
print("standalone page-number line:", fnum)

# 2 short evidence among likely-critical
short = [u for u in units if len((u.get("evidence_wording") or "").strip()) < 40]
print("evidence<40 total:", len(short))
print("  by domain:", dict(collections.Counter(u["semantic_domain"] for u in short)))

# 3 dose multiline shape
dose = [u for u in units if u["semantic_domain"] == "dosing"]
ml = [u for u in dose if "\n" in (u.get("evidence_wording") or "")]
print("dosing multiline:", len(ml), "/", len(dose))
lens = collections.Counter(len((u["evidence_wording"] or "").split("\n")) for u in ml)
print("  line-count dist (top):", dict(sorted(lens.items())[:12]))
dose_lines = sum(1 for u in ml if sum(1 for ln in u["evidence_wording"].split("\n") if DOSE_PAT.search(ln)))
print("  units w/ >=1 dose line:", sum(1 for u in ml if any(DOSE_PAT.search(ln) for ln in u["evidence_wording"].split("\n"))))
endbad = sum(1 for u in ml if not u["evidence_wording"].rstrip().endswith((".", "!", "?", ")", '"', "'", "%", ":")))
print("  multiline not ending in terminal punct:", endbad)
emptyline = sum(1 for u in ml if any(not ln.strip() for ln in u["evidence_wording"].split("\n")))
print("  multiline with empty lines:", emptyline)

# 4 meds dose field completeness
for f in ("usual_dosage_range", "how_to_dose", "overdose", "pregnancy", "breast_feeding",
          "warnings_precautions", "drug_interactions", "special_populations"):
    n = sum(1 for m in meds if not (m.get(f) or "").strip())
    print(f"  med empty {f}: {n}/152")

# 5 see-index boilerplate
si = [u for u in units if "see index for additional brand" in (u.get("evidence_wording") or "").lower()]
print("see-index boilerplate units:", len(si))

# 6 evidence vs object divergence sample
print("object!=evidence_wording:", sum(1 for u in units if (u.get("object") or "") != (u.get("evidence_wording") or "")))
