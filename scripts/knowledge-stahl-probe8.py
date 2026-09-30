# -*- coding: utf-8 -*-
"""Probe 8: by-use/by-class isomer formats, index-vs-PDF page check, xref file."""
import json, sys, io, re, glob
from pathlib import Path
import pymupdf
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "Books" / "prescribers-guide-stahls-essential-psychopharmacology.pdf"
VD = (ROOT / "knowledge" / "canonical-v2" / "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
doc = pymupdf.open(SRC)

loose = re.compile(r"amphet|methylphenid|methylfolate", re.I)
print("== by-use/by-class lines with isomer-ish words ==")
for a, b in ((2628, 2657), (2658, 2670)):
    for i in range(a, b + 1):
        for ln in doc[i - 1].get_text().splitlines():
            if loose.search(ln):
                print(f"  p{i}: {ln.strip()[:95]}")

print("\n== TOC pages for isomer titles vs index refs ==")
for lv, t, p in doc.get_toc(simple=True):
    if t in ("Amphetamine (D)", "Amphetamine (D,L)", "Methylfolate (L)",
             "Methylphenidate (D)", "Methylphenidate (D,L)"):
        print(f"  TOC {t!r} -> pdf page {p}")

print("\n== monographs at pdf p45, p39, p477, p487 ==")
for probe in (39, 45, 477, 487):
    heads = [t for lv, t, p in doc.get_toc(simple=True) if lv == 1
             and p <= probe]
    print(f"  p{probe}: last L1 heading before = {heads[-1] if heads else None!r}")

print("\n== which lettered xrefs file holds rows near page 1091 ==")
for f in sorted(VD.glob("xrefs-*.jsonl")):
    if f.name == "xrefs-IDX.jsonl":
        continue
    pages = []
    for ln in f.read_text(encoding="utf-8").splitlines():
        if ln.strip():
            r = json.loads(ln)
            m = re.match(r"stahl7-u-(\d+)-", r["from_unit"])
            pages.append(int(m.group(1)))
    if pages and min(pages) <= 1091 <= max(pages):
        print(f"  {f.name}: pages {min(pages)}-{max(pages)} -> CONTAINS 1091")
    elif pages and 1050 <= min(pages) <= 1150:
        print(f"  {f.name}: pages {min(pages)}-{max(pages)} (neighbor)")
