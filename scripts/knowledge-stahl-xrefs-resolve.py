# -*- coding: utf-8 -*-
"""Resolve source-establishable intra-book xrefs in lettered xrefs-*.jsonl.

Rules are deterministic and evidence/unit-structure based (see WORKORDER).
Rows whose target cannot be established stay unresolved with a recorded
class: intra-unit | section-absent | table-in-same-unit | ambiguous.
Adds the single missing row for stahl7-u-1091-012 ('see Pearls').
"""
import json, re, sys, io, collections
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
VD = (Path(__file__).resolve().parent.parent / "knowledge" / "canonical-v2" /
      "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
DRY = "--apply" not in sys.argv

def load(p):
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines()
            if l.strip()]

units = load(VD / "units.jsonl")
umap = {u["id"]: u for u in units}
by_mono = collections.defaultdict(list)
for u in units:
    by_mono[u["structural_path"][0]].append(u)

SECT = {"see Pearls": ["pearl"], "see Warnings below": ["warn"],
        "see Children and": ["children"], "see What to": ["what to do"]}

def section_units(f, keys, require_after=False, exclude_self=True):
    mono = f["structural_path"][0]
    hits = [u for u in by_mono[mono]
            if any(k in e.lower() for e in u["structural_path"][1:]
                   for k in keys)
            and (not exclude_self or u["id"] != f["id"])]
    secs = {(u["structural_path"][1], u["structural_path"][2]) for u in hits}
    if len(secs) != 1:
        return None            # 0 or >1 distinct sections -> ambiguous
    if require_after and any(u["page_start"] < f["page_start"] for u in hits):
        return None
    return min(hits, key=lambda u: (u["page_start"], u["id"]))["id"]

def resolve(row):
    f = umap.get(row["from_unit"])
    assert f, row["from_unit"]
    t = row["target_text"]
    ev = f["evidence_wording"]
    i = ev.find(t)
    assert i >= 0, ("phrase not in own evidence", row)
    window = ev[i:i + 90].replace("\n", " ")
    if t in SECT:
        tgt = section_units(f, SECT[t],
                            require_after=(t == "see Warnings below"))
        if tgt:
            return tgt, None
        # disambiguate: distinct-section failure reasons
        mono = f["structural_path"][0]
        any_sec = any(any(k in e.lower()
                          for e in u["structural_path"][1:])
                      for u in by_mono[mono] for k in SECT[t])
        self_only = any(k in e.lower()
                        for e in f["structural_path"][1:]
                        for k in SECT[t])
        if self_only:
            return None, "intra-unit"
        if not any_sec:
            return None, "section-absent"
        return None, "ambiguous"
    if t == "see How to":
        key = ["how to dose"] if "Dose" in window[:24] else []
        tgt = section_units(f, key) if key else None
        if tgt:
            return tgt, None
        mono = f["structural_path"][0]
        has = any("how to dose" in e.lower()
                  for u in by_mono[mono] for e in u["structural_path"][1:])
        return None, ("section-absent" if not has else "ambiguous")
    if t.startswith("see Table"):
        m = re.search(re.escape(t) + r"\s*(\d+)", ev)
        assert m, ("table number not in evidence", row)
        n = m.group(1)
        mono = f["structural_path"][0]
        cap = re.compile(rf"Table {n}\. [A-Z]")
        in_self = bool(cap.search(ev))
        others = [u["id"] for u in by_mono[mono] if u["id"] != f["id"]
                  and cap.search(u["evidence_wording"])]
        if len(others) == 1:
            return others[0], None
        if in_self:
            return None, "table-in-same-unit"
        return None, ("ambiguous" if others else "table-not-atomized")
    # drug/formulation refs: extract phrase after 'see ', match section titles
    mono = f["structural_path"][0]
    STOP = {"after", "for", "section", "below", "see", ")", "the"}
    words = window.split()
    if words and words[0].lower() == "see":
        words = words[1:]
    phrase = []
    for w in words:
        wl = w.strip("(),.").lower()
        if wl in STOP:
            break
        phrase.append(wl)
    phrase = " ".join(phrase)      # e.g. 'olanzapine pamoate'
    cands = [u for u in by_mono[mono]
             if u["structural_path"][2].lower() in phrase]
    secs = {(u["structural_path"][1], u["structural_path"][2])
            for u in cands}
    if len(secs) == 1:
        return min(cands, key=lambda u: (u["page_start"], u["id"]))["id"], None
    return None, ("section-absent" if not secs else "ambiguous")

results, unresolved_class = [], collections.Counter()
for f in sorted(VD.glob("xrefs-*.jsonl")):
    if f.name == "xrefs-IDX.jsonl":
        continue
    rows, changed = load(f), False
    for r in rows:
        if r["status"] == "resolved":
            continue
        tgt, why = resolve(r)
        if tgt:
            r["target_unit"], r["status"] = tgt, "resolved"
            results.append((f.name, r["target_text"], tgt))
            changed = True
        else:
            unresolved_class[why] += 1
    if changed and not DRY:
        f.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n"
                             for r in rows), encoding="utf-8")

# missing row: Imipramine 'see Pearls'
gap = umap["stahl7-u-1091-012"]
tgt = section_units(gap, ["pearl"])
assert tgt, "gap Pearls target not establishable"
new_row = {"from_unit": "stahl7-u-1091-012", "target_text": "see Pearls",
           "target_unit": tgt, "status": "resolved"}
sfile = VD / "xrefs-S.jsonl"
srows = load(sfile)
if not any(r["from_unit"] == new_row["from_unit"] for r in srows):
    if not DRY:
        srows.append(new_row)
        sfile.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n"
                                 for r in srows), encoding="utf-8")
    results.append((sfile.name, "see Pearls (NEW ROW)", tgt))

print("MODE:", "DRY" if DRY else "APPLY")
print(f"resolved now: {len(results)}")
for src, tt, tg in results:
    print(f"  {src}: {tt!r} -> {tg}")
print("left unresolved by class:", dict(unresolved_class))
