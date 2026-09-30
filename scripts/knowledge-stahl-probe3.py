# -*- coding: utf-8 -*-
"""Probe 3: structure.json schema + TOC titles, short units, see-coverage."""
import json, sys, io, collections, re
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")

def load(name):
    return [json.loads(l) for l in
            (VD / name).read_text(encoding="utf-8").splitlines() if l.strip()]

units, xrefs = load("units.jsonl"), load("xrefs.jsonl")
struct = json.loads((VD / "structure.json").read_text(encoding="utf-8"))
print("structure keys:", list(struct))
secs = struct.get("sections", [])
print("sections:", len(secs), "| depths:",
      collections.Counter(s.get("depth") for s in secs))
if "toc" in struct:
    toc = struct["toc"]
    print("toc entries:", len(toc), "sample:", toc[:3])
else:
    toc = []
# maybe toc elsewhere (book.json?)
book = json.loads((VD / "book.json").read_text(encoding="utf-8"))
print("book.json keys:", list(book))

# 1. L2 title distribution in TOC (if present) for cross-check
if toc and isinstance(toc[0], dict):
    lv2 = collections.Counter(t["title"] for t in toc if t.get("level") == 2)
    print("TOC L2 variants:", lv2.most_common(30))

# 2. short-evidence units
short = [r for r in units if len(r["evidence_wording"]) < 40]
print("units <40 chars evidence:", len(short))
print(collections.Counter((r["content_type"], r["evidence_wording"][:30])
                          for r in short).most_common(15))
print("short needs_review:", sum(1 for r in short
                                 if r["validation_status"] == "needs_review"))

# 3. capital 'see <X>' refs vs per-unit xref coverage
pat = re.compile(r"\bsee\s+([A-Z][A-Za-z ]{0,40})")
has_xref = collections.Counter(x["from_unit"] for x in xrefs)
gaps = []
for r in units:
    ms = pat.findall(r["evidence_wording"])
    if ms and has_xref[r["id"]] == 0:
        gaps.append((r["id"], [m.strip().rstrip(".,;:") for m in ms]))
print("units w/ capital see-phrase but 0 xref rows:", len(gaps))
for g in gaps[:12]:
    print("  ", g)

# 4. per-xref-row truncation check: rows whose phrase continues past newline
unr = [x for x in xrefs if x["status"] != "resolved"]
umap = {r["id"]: r for r in units}
cont = 0
for x in unr:
    r = umap[x["from_unit"]]
    i = r["evidence_wording"].find(x["target_text"])
    if i >= 0:
        after = r["evidence_wording"][i:i + 90].replace("\n", " | ")
        print(f"  {x['target_text']!r} => {after!r}")
