# -*- coding: utf-8 -*-
"""Probe 2: hierarchy fidelity, 'see' phrase inventory, dup samples, isomers."""
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

# 1. L2 variants in units vs structure.json depth-2 titles
u_l2 = collections.Counter(r["structural_path"][1] for r in units)
s_l2 = collections.Counter()
for s in struct["sections"]:
    if s.get("depth") == 2:
        s_l2[s["title"]] += 1
print("== unit L2 not found in structure L2 titles ==")
for t, c in u_l2.most_common():
    if t not in s_l2:
        print(f"  {c:4d}  {t!r}  (closest struct: "
              f"{[k for k in s_l2 if k.lower()==t.lower()]})")
print("== structure L2 titles (all) ==")
print(sorted(s_l2))

# 2. 'see ' phrase inventory in evidence wording
pat = re.compile(r"\bsee\s+([A-Z][A-Za-z ]{0,40})")
phr = collections.Counter()
has_xref = set(x["from_unit"] for x in xrefs)
for r in units:
    for m in pat.finditer(r["evidence_wording"]):
        phr[m.group(1).strip().rstrip(".,;:")] += 1
print("== 'see <Phrase>' inventory (top 30) ==")
for p, c in phr.most_common(30):
    print(f"  {c:4d}  {p!r}")

# 3. units with 'see ' but no xref row: phrase classes
nocov = [r for r in units if "see " in r["evidence_wording"].lower()
         and r["id"] not in has_xref]
print("== units w/ 'see ' and NO xref:", len(nocov))
cls = collections.Counter()
for r in nocov:
    for m in pat.finditer(r["evidence_wording"]):
        t = m.group(1).strip().rstrip(".,;:")
        cls[t.split(" ")[0]] += 1
print(cls.most_common(15))

# 4. sample duplicate evidence groups: distinct structural paths?
dup = collections.defaultdict(list)
for r in units:
    dup[r["evidence_wording"]].append(r)
d2 = {k: v for k, v in dup.items() if len(v) > 1}
print("== dup groups:", len(d2))
for k, v in list(d2.items())[:4]:
    print("  len", len(k), "n=", len(v),
          [x["structural_path"][0] for x in v][:6])

# 5. the 54 unresolved: full phrase inside own evidence?
unr = [x for x in xrefs if x["status"] != "resolved"]
umap = {r["id"]: r for r in units}
print("== unresolved full-phrase check ==")
miss = 0
for x in unr:
    r = umap.get(x["from_unit"])
    frag = x["target_text"]
    if r and frag.lower() in r["evidence_wording"].lower():
        continue
    miss += 1
print("  target_text not literally in own evidence:", miss, "/", len(unr))
for x in unr[:6]:
    r = umap.get(x["from_unit"])
    mm = re.search(re.escape(x["target_text"]) + r"(.{0,30})",
                   r["evidence_wording"], re.S) if r else None
    print("   ", x["from_unit"], repr(x["target_text"]),
          "->", repr(mm.group(0)[-60:]) if mm else "NOT FOUND",
          "| monograph:", r["structural_path"][0] if r else "?")
