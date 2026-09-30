# SOURCE-VERSION-AUDIT

**Status:** reconciled / derived metadata overlay applied; canonical units unchanged  
**Approval record:** `STRUCT-V2-APPROVAL-RECORD.json`  
**Current state:** derived overlay repairs metadata references only; canonical `units.jsonl` remains unchanged.  
**Source:** `dsm5-fr-2015-elsevier`  
**Canonical source version:** `sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53`

## Finding

The 12,818 parent units split into:

| Unit metadata class | Count |
|---|---:|
| Full canonical source hash | 11,361 |
| Truncated hash value | 393 |
| Duplicated `sha256:` prefix | 1,064 |
| Malformed total | 1,457 |

All 14,079 emitted chunks carry the full canonical source version and the expected book ID, so the chunk-level identity is intact. The defect is in parent-unit provenance metadata, not in the emitted chunk source-version field.

## Safety decision

Do not mass-replace malformed unit metadata in place. A repair must:

1. identify the exact canonical source bytes behind each unit;
2. verify the full hash independently;
3. record the old value, new value, reason, reviewer, and timestamp;
4. preserve the old artifact and its digest;
5. emit a new artifact/revision rather than mutating `units.jsonl`;
6. rerun all chunk identity, text, page, duplicate, and review audits;
7. obtain human approval before embedding.

The current task therefore records the defect and blocks production compatibility. It does not correct medical wording, page labels, or source metadata.

## Evidence

- `STRUCT-V2-AUDIT.json`: classification, file hashes, and blocked gate.
- `units.jsonl`: read-only parent input.
- `chunks-v2.jsonl`: read-only emitted output.
- `book.json`: read-only source identity; status remains `discovered`.
- `APPROVALS.md`: absent; no approval inferred.
