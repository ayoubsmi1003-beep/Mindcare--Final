# -*- coding: utf-8 -*-
"""Pre-M08 probe 15: index in-text folio numbers vs target unit pdf pages."""
import json, re, sys, io, collections
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
units = {u["id"]: u for u in (json.loads(l) for l in (VD / "units.jsonl").read_text(encoding="utf-8").splitlines() if l.strip())}
xrefs = [json.loads(l) for l in (VD / "xrefs.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]

idx = [u for u in units.values() if u["structural_path"][0] == "Back matter"]
print("idx units:", len(idx))
s = idx[0]
print("sample idx unit:", json.dumps({k: s[k] for k in ("id", "structural_path", "title", "evidence_wording", "page_start", "page_end")}, ensure_ascii=False)[:500])

FOL = re.compile(r"^(?P<txt>.*?)\s*[, ]\s*(?P<fol>\d{1,4})\s*$")
parsed, rows = 0, []
for x in xrefs:
    if x["status"] != "resolved":
        continue
    f = units.get(x["from_unit"])
    if not f or f["structural_path"][0] != "Back matter":
        continue
    t = units.get(x["target_unit"])
    if not t:
        continue
    ev = (f.get("evidence_wording") or "").strip()
    m = FOL.search(ev)
    fol = int(m.group("fol")) if m else None
    if fol is not None:
        parsed += 1
    rows.append((f["id"], fol, t["page_start"], t["page_end"], t["structural_path"][0]))
print("IDX xrefs resolved:", len(rows), "| folio parsed:", parsed)
diffs = collections.Counter(t[2] - t[1] for t in rows if t[1] is not None)
print("target_pdf - folio distribution (top):", diffs.most_common(10))
print("equal (folio==target start):", sum(1 for t in rows if t[1] is not None and t[1] == t[2]))
add = [t for t in rows if t[4].lower().startswith("adder")]
print("Adderall-ish rows:", add[:5])
# monograph raw page for comparison
for u in units.values():
    if u["structural_path"][0] in ("Adderall", "Adderrall"):
        print("mono unit:", u["id"], u["structural_path"], u["page_start"], u["page_end"]); break
# how many IDX units have NO trailing folio in evidence
nofol = [u["id"] for u in idx if not FOL.search((u.get("evidence_wording") or "").strip())]
print("IDX units without trailing folio:", len(nofol), nofol[:5])
