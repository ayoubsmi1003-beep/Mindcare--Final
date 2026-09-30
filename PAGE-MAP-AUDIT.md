# PAGE-MAP-AUDIT

**Status:** reconciled / approved policy applied; unresolved printed values remain unresolved  
**Approval record:** `STRUCT-V2-APPROVAL-RECORD.json`  
**Current state:** approved policy preserves unresolved and Roman values without inference; see `STRUCT-V2-PAGE-PROVENANCE.json`.  
**Artifact:** `knowledge/canonical-v2/dsm5-fr-2015-elsevier/.../chunks-v2.jsonl`  
**Canonical files changed:** none

## Result

The frozen artifact has 14,079 chunks and 12,818 units. The current printed-page audit finds:

| Check | Count | Meaning |
|---|---:|---|
| Missing printed-page value | 8 | Printed start or end is null |
| Roman printed-page value | 43 | Printed value is Roman rather than Arabic |
| Printed-page order inversions | 99 | Numeric printed start decreases in artifact order |
| Source-page order inversions | 238 | Source start decreases in artifact order |
| Source multi-page ranges | 705 | `page_end` differs from `page_start` |
| Printed multi-page ranges | 72 | Numeric printed end differs from printed start |
| Prior reported multi-page count | 682 | Historical figure retained as unverified; not equal to the current recomputation |

The current artifact mixes page offsets: 11,237 rows have source-minus-printed offset 58, 2,711 have offset 59, with smaller groups at 60, 118, and 119. This is not treated as an automatic off-by-one correction.

## Interpretation

`pages.map.json` proposes a body rule equivalent to `printed = source_1based - 59` for source page 62 onward, plus anchors and exceptions. The chunk rows contain source page integers and printed values stored as strings, integers, Roman values, or null. The artifact order is not a reliable single page-order proof because structural units and extracted sections are interleaved.

Therefore:

1. No page value is rewritten by this task.
2. No Roman value is converted automatically.
3. No 58/59 offset is globally selected.
4. A human-approved page map must define the source coordinate system, printed coordinate system, exception ranges, and ordering rule before production citation use.
5. The eight null values and 99 printed-order inversions remain hard blockers.

## Required human decision

Approve one versioned page-map policy with: source index base, printed index base, body rule, front-matter rule, Roman-page handling, exception table, ordering key, and a review queue. A corrected artifact must use a new immutable source revision or a separately recorded correction map; it must not mutate the frozen source files in place.

## Evidence

- `STRUCT-V2-AUDIT.json`: exact counts, offset distribution, file hashes, and gate status.
- `pages.map.json`: existing proposed body rule and anchors; unchanged.
- `units.jsonl` and `chunks-v2.jsonl`: read-only inputs; unchanged.
- `APPROVALS.md`, `CORPUS-REPORT.md`, `CITRA-SPOTS.md`: absent; no approval inferred.
