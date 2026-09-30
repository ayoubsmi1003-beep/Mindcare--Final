# -*- coding: utf-8 -*-
"""Probe 10: TOC combination titles + raw context of bogus header lines."""
import sys, io, re
from pathlib import Path
import pymupdf
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Books" / "prescribers-guide-stahls-essential-psychopharmacology.pdf"
BACK = ("Index by Drug Name", "Index by Use", "Index by Class",
        "Abbreviations", "Endmatter")
doc = pymupdf.open(SRC)
titles = [t for lv, t, p in doc.get_toc(simple=True)
          if lv == 1 and p >= 24 and t not in BACK]
print("combination-ish titles:", [t for t in titles
                                  if "combination" in t.lower() or "/" in t])
print("memantine/donepezil:", [t for t in titles
                               if "memantine" in t.lower()
                               or "donepezil" in t.lower()])
print("methylfolate titles:", [t for t in titles
                               if "folate" in t.lower()])
print("nalmefene in titles:", any("nalmefene" in t.lower() for t in titles))
print("total L1 titles:", len(titles))

def show(page, pat, ctx=3):
    lines = [l.strip() for l in doc[page - 1].get_text().splitlines()]
    for i, l in enumerate(lines):
        if re.search(pat, l, re.I):
            lo, hi = max(0, i - ctx), min(len(lines), i + ctx + 1)
            print(f"  -- p{page} line {i} --")
            for j in range(lo, hi):
                print(("  > " if j == i else "    ") + repr(lines[j]))

print("\n== p2631 by-use: amphetamine (d,l) context ==")
show(2631, r"amphetamine \(d,l\)")
print("\n== p2631: what use header precedes? first lines ==")
print([l.strip() for l in doc[2630].get_text().splitlines()[:26]])
print("\n== p2659: l-methylfolate context ==")
show(2659, r"l-methylfolate", 4)
print("\n== p2663 by-class: context ==")
show(2663, r"amphetamine \(d\)", 5)
print("\n== p255-ish Alcohol dependence in by-use: search 2628-2636 ==")
for p in range(2628, 2637):
    show(p, r"^Alcohol dependence", 2)
