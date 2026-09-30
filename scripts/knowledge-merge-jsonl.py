# -*- coding: utf-8 -*-
"""Deterministic merge of lettered worker JSONL files into canonical JSONL.
Usage: python scripts/knowledge-merge-jsonl.py <book_version_dir>
- Reads units-*.jsonl / tables-*.jsonl / concepts-*.jsonl / xrefs-*.jsonl
- Dedupes identical rows, ERRORs on id collision with different content
- Sorts by id, writes units.jsonl / tables.jsonl / concepts.jsonl / xrefs.jsonl
Exit 1 on any collision (fail-closed; never silently pick one).
"""
import json, sys, io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
KINDS = {"units": "id", "tables": "table_id", "concepts": "concept_id",
         "xrefs": None}
# NOTE: meds excluded — merged manually (solriamfetol boundary duplicate:
# meds-AH authoritative, meds-AI 1-page stub dropped) then enriched by
# knowledge-stahl-index.py. Never re-merge meds-* blindly.

def main(book_dir: Path) -> int:
    rc = 0
    for kind, key in KINDS.items():
        rows, seen = [], {}
        for f in sorted(book_dir.glob(f"{kind}-*.jsonl")):
            for ln, line in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
                if not line.strip():
                    continue
                obj = json.loads(line)
                rows.append(obj)
                if key:
                    oid = obj.get(key)
                    canon = json.dumps(obj, sort_keys=True, ensure_ascii=False)
                    if oid in seen and seen[oid] != canon:
                        print(f"COLLISION {kind} {oid}: {f.name}:{ln}")
                        rc = 1
                    seen.setdefault(oid, canon)
        if key:
            uniq = {}
            for o in rows:
                uniq.setdefault(o[key], o)
            out = [uniq[k] for k in sorted(uniq)]
        else:  # xrefs: no id; dedupe on full content, stable order
            seenx, out = set(), []
            for o in rows:
                c = json.dumps(o, sort_keys=True, ensure_ascii=False)
                if c not in seenx:
                    seenx.add(c)
                    out.append(o)
        if out or list(book_dir.glob(f"{kind}-*.jsonl")):
            (book_dir / f"{kind}.jsonl").write_text(
                "".join(json.dumps(o, ensure_ascii=False) + "\n" for o in out),
                encoding="utf-8")
        print(f"{kind}: {len(rows)} rows in -> {len(out)} merged")
    return rc

if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
