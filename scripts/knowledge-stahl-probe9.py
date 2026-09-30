# -*- coding: utf-8 -*-
"""Probe 9: IDX use/class titles sanity, xrefs file ranges, folio note."""
import json, sys, io, re, collections
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
idx = [json.loads(l) for l in
       (VD / "units-IDX.jsonl").read_text(encoding="utf-8").splitlines()
       if l.strip()]
uses = [u for u in idx if u["structural_path"][1] == "Index by Use"]
kls = [u for u in idx if u["structural_path"][1] == "Index by Class"]
print("uses:", len(uses), "classes:", len(kls))
junk = re.compile(r"\d|,\s*\d|\(adjunct\)|phenidate\)|amphetamine\)")
print("== suspicious use titles ==")
for u in uses:
    if junk.search(u["title"]):
        print("  ", repr(u["title"]), "|", u["evidence_wording"][:100])
print("== all use titles ==")
for u in uses:
    print("  ", u["title"])
print("== class titles ==")
for u in kls:
    print("  ", u["title"])

print("\n== lettered xrefs file page ranges ==")
for f in sorted(VD.glob("xrefs-*.jsonl")):
    if f.name == "xrefs-IDX.jsonl":
        continue
    pages = [int(re.match(r"stahl7-u-(\d+)-", json.loads(l)["from_unit"]).group(1))
             for l in f.read_text(encoding="utf-8").splitlines() if l.strip()]
    if pages:
        print(f"  {f.name}: {min(pages)}-{max(pages)} ({len(pages)})")
