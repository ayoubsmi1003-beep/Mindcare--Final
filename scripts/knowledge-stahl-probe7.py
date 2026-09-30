# -*- coding: utf-8 -*-
"""Probe 7: PDF index lines for isomer generics (read-only diagnostics)."""
import json, sys, io, re
from pathlib import Path
import pymupdf
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Books" / "prescribers-guide-stahls-essential-psychopharmacology.pdf"
VD = (ROOT / "knowledge" / "canonical-v2" / "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
BACK = ("Index by Drug Name", "Index by Use", "Index by Class",
        "Abbreviations", "Endmatter")
NAME_RX = re.compile(r"^(.+?)\s*\(([^)]+)\)\s*,?\s*(\d+)?\s*$")

doc = pymupdf.open(SRC)
toc = doc.get_toc(simple=True)
titles = sorted([t for lv, t, p in toc if lv == 1 and p >= 24
                 and t not in BACK])
print("titles with parens:", [t for t in titles if "(" in t])

iso = re.compile(r"^(d,\s*l-|d-|l-)(amphetamine|methylphenidate|methylfolate)$",
                 re.I)
print("\n== Index by Drug Name (2568-2627): isomer-paren lines ==")
n_iso = 0
for i in range(2568, 2628):
    for ln in doc[i - 1].get_text().splitlines():
        ln = ln.strip()
        m = NAME_RX.match(ln)
        if m and iso.match(m.group(2).strip()):
            n_iso += 1
            if n_iso <= 12:
                print(f"  p{i}: {ln[:90]}")
print("  total isomer lines:", n_iso)

print("\n== Index by Use (2628-2657): lines mentioning isomers ==")
c = 0
for i in range(2628, 2658):
    for ln in doc[i - 1].get_text().splitlines():
        if iso.search(ln):
            c += 1
            if c <= 12:
                print(f"  p{i}: {ln.strip()[:95]}")
print("  total:", c)

print("\n== Index by Class (2658-2670): lines mentioning isomers ==")
c = 0
for i in range(2658, 2671):
    for ln in doc[i - 1].get_text().splitlines():
        if iso.search(ln):
            c += 1
            if c <= 12:
                print(f"  p{i}: {ln.strip()[:95]}")
print("  total:", c)

cons = [json.loads(l) for l in
        (VD / "concepts.jsonl").read_text(encoding="utf-8").splitlines()
        if l.strip()]
al = {c["canonical"]: c["aliases"] for c in cons if c["aliases"]}
print("\nconcepts with aliases:", len(al))
for k in ("Amphetamine", "Methylphenidate", "Methylfolate",
          "Methylphenidate (D,L)", "Amphetamine (D,L)"):
    hits = {kk: v for kk, v in al.items() if k.lower() in kk.lower()}
    print(f"  {k!r} -> {hits}")
