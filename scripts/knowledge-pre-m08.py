# -*- coding: utf-8 -*-
"""Pre-M08 Knowledge Integrity Package builder — Stahl Prescribers Guide 7e.

Deterministic (Rule 10): no clock, no randomness, sorted outputs, stable hashes.
Reads canonical-v2 READ-ONLY, writes knowledge/pre-m08/ artifacts (Phases A-J).
No activation, no DB writes, no canonical edits, no source rewriting.
Human-readable docs (AUDIT.md, ANSWERABILITY-CONTRACT.md) are generated here so
every published number is computed once and reconciled byte-for-byte.
"""
import json, re, sys, io, hashlib, collections
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = Path(__file__).resolve().parent.parent
VD = (ROOT / "knowledge" / "canonical-v2" / "stahl-prescribers-guide-7e-cup" /
      "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3")
OUT = ROOT / "knowledge" / "pre-m08"
BOOK_ID = "stahl-prescribers-guide-7e-cup"
SOURCE_HASH = "cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3"
RISK_RULES_VERSION = "pre-m08-risk-rules-v1"

def loadj(p):
    return json.loads(p.read_text(encoding="utf-8"))

def loadjl(p):
    return [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()]

def sha(s):
    return hashlib.sha256(s.encode("utf-8")).hexdigest()

def jline(o):
    return json.dumps(o, ensure_ascii=False) + "\n"

def jdump(o):
    return json.dumps(o, ensure_ascii=False, indent=2) + "\n"

def dir_manifest(d):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(d.iterdir()) if p.is_file()}

# ---------------- inputs (read-only) ----------------
units = loadjl(VD / "units.jsonl")
xrefs = loadjl(VD / "xrefs.jsonl")
meds = loadjl(VD / "meds.jsonl")
concepts = loadjl(VD / "concepts.jsonl")
book = loadj(VD / "book.json")
structure = loadj(VD / "structure.json")
pagesmap = loadj(VD / "pages.map.json")
qa = loadj(VD / "qa-report.json")
qaudit = loadj(VD / "review-queue-audit.json")
queue = loadj(VD / "review-queue.json")

umap = {u["id"]: u for u in units}
INPUT_FILES = ["units.jsonl", "xrefs.jsonl", "meds.jsonl", "concepts.jsonl", "book.json",
               "structure.json", "pages.map.json", "qa-report.json",
               "review-queue-audit.json", "review-queue.json"]
input_hashes = {f: hashlib.sha256((VD / f).read_bytes()).hexdigest() for f in INPUT_FILES}

EDITION = book["edition"]
SOURCE_VERSION_CANON = book["source_version"]            # colon form (canonical)
SOURCE_VERSION_DIR = "sha256-" + SOURCE_HASH             # dash form (directory token)
VERSION_RESOLUTION = (
    "colon form (sha256:...) is canonical in book.json/structure.json/pages.map.json/"
    "IDX units; dash form (sha256-...) appears in the 2563 content units and matches "
    "the canonical directory token. Both designate the identical sha256 "
    f"{SOURCE_HASH}. Equivalence documented here; no source unit was rewritten.")
map_by_page = {p["source_page_index"]: p for p in pagesmap["pages"]}
PAGE_LO, PAGE_HI = 13, 2682
# ---------------- PHASE A: provenance page-location model ----------------
FOLIO_PAT = re.compile(r",\s?\d{1,4}$")

def provenance_row(u):
    ev = u.get("evidence_wording") or ""
    ps, pe = u["page_start"], u["page_end"]
    mps = str(u.get("printed_page_start"))
    mpe = str(u.get("printed_page_end"))
    in_map = ps in map_by_page and pe in map_by_page
    range_ok = isinstance(ps, int) and isinstance(pe, int) and PAGE_LO <= ps <= pe <= PAGE_HI
    label_pdf_ok = (mps == str(ps)) and (mpe == str(pe))
    map_ok = in_map and (map_by_page[ps]["printed_page_number"] == mps) and \
             (map_by_page[pe]["printed_page_number"] == mpe)
    if not in_map:
        map_status = "UNRESOLVED"
    elif range_ok and label_pdf_ok and map_ok:
        map_status = "CONFIRMED"
    else:
        map_status = "CONFLICT"
    sv_raw = u.get("source_version") or ""
    prov = u.get("provenance") or {}
    has_folio = bool(FOLIO_PAT.search(ev.strip()))
    return {
        "knowledge_unit_id": u["id"],
        "book_id": u["book_id"],
        "edition": EDITION,
        "source_version": SOURCE_VERSION_CANON,
        "source_version_raw": sv_raw,
        "source_version_form": "colon" if ":" in sv_raw else "dash",
        "source_version_resolution": VERSION_RESOLUTION,
        "source_hash": "sha256:" + SOURCE_HASH,
        "language": u.get("language"),
        "printed_page": {"start": int(ps), "end": int(pe)},
        "pdf_page": {"start": ps, "end": pe},
        "page_label": {"start": mps, "end": mpe},
        "page_offset": pagesmap.get("offset"),
        "mapping_status": map_status,
        "mapping_method": ("pages.map.json identity rule: printed = source_page_index "
                           "(file carries no printed folio labels; TOC L1 anchors verified); "
                           "unit printed_* equals str(pdf page) equals map label"),
        "mapping_evidence": {"range_valid": range_ok, "unit_label_matches_pdf": label_pdf_ok,
                             "map_label_matches": map_ok,
                             "unit_pages_certain": u.get("page_mapping_status") == "certain"},
        "unit_evidence": {"field": "evidence_wording", "sha256": sha(ev), "chars": len(ev),
                          "lines": (ev.count("\n") + 1) if ev else 0,
                          "extractor": prov.get("extractor"), "segment": prov.get("segment")},
        "unit_sha256": sha(json.dumps(u, ensure_ascii=False, sort_keys=True)),
        "folio_reference": {
            "kind": "in-text-printed-folio",
            "present": has_folio,
            "note": ("no in-text printed-folio reference detected; identity map governs"
                     if not has_folio else
                     "trailing numeric literal present in evidence; recorded verbatim, "
                     "not interpreted as a page mapping (no guessing)")},
    }

provenance_rows = [provenance_row(u) for u in units]   # source order = deterministic
prov_status_counts = collections.Counter(r["mapping_status"] for r in provenance_rows)

# ---------------- PHASE B: deterministic risk classification (metadata only) ----------------
CRIT_TITLE = re.compile(
    r"life-threatening|dangerous|overdose|toxicit|contraindicat|do not use|emergency|"
    r"maximum|titration|interaction|pregnan|breast feeding|lactat|warning|renal|hepatic|"
    r"cardiac impairment|children and adolescents|elderly", re.I)
HIGH_TITLE = re.compile(
    r"commonly prescribed|side effect|monitor|switch|discontinu|how to stop|stop the|"
    r"treatment duration|pearls|habit", re.I)

def clinical_risk(u):
    p = u["structural_path"]
    l2 = p[1].lower().strip()
    title = u["title"]
    dom = u.get("semantic_domain")
    if l2.startswith("dosing"):
        return "CRITICAL", "section:dosing-and-use"
    if dom in ("dosing", "interaction", "pregnancy-lactation", "precaution"):
        return "CRITICAL", f"domain:{dom}"
    if CRIT_TITLE.search(title):
        return "CRITICAL", "title-keyword"
    if l2.startswith("special population"):
        return "CRITICAL", "section:special-populations"
    if dom in ("art-of-psychopharmacology", "switching", "adverse-effect"):
        return "HIGH", f"domain:{dom}"
    if HIGH_TITLE.search(title):
        return "HIGH", "title-keyword"
    return "NORMAL", "default"

risk_of, risk_rule = {}, {}
for u in units:
    r, why = clinical_risk(u)
    risk_of[u["id"]] = r
    risk_rule[u["id"]] = why
risk_counts = dict(sorted(collections.Counter(risk_of.values()).items()))
risk_rule_counts = dict(sorted(collections.Counter(risk_rule.values()).items()))
# ---------------- PHASE C: evidence completeness (CRITICAL/HIGH) ----------------
DANG = re.compile(r"\b(and|or|of|the|to|with|in|for|a|an|on|at|by|as|is|are|be|from)$", re.I)
CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")
FOOT = re.compile(r"copyright|all rights reserved|wolters kluwer", re.I)
DOSE_PAT = re.compile(r"\d+(\.\d+)?\s*(mg|mcg|µg|ug|g|ml|tabs?|tablets?|caps?)\b", re.I)
EVIDENCE_MIN = 40

def heading_ok(u):
    p = u["structural_path"]
    t = u["title"]
    return t in (f"{p[0]} - {p[2]}", f"{p[1]} - {p[2]}",
                 " - ".join(p), p[0], p[1])

def continuation_ok(ev):
    last = ev.strip().split("\n")[-1].strip(" .;:")
    terminal = ev.rstrip().endswith((".", "!", "?", ":", ";", ")"))
    return not (last and DANG.search(last) and not terminal)

def evidence_audit(u):
    """Returns (evidence_status, review_status, reasons[]). No repair, no guessing."""
    ev = u.get("evidence_wording") or ""
    reasons = []
    if not ev.strip():
        return "MISSING_EVIDENCE", "QUARANTINED", ["evidence-empty"]
    if "\ufffd" in ev or CTRL.search(ev):
        return "OCR_UNCERTAIN", "QUARANTINED", ["ocr-replacement-or-control-char"]
    if not heading_ok(u):
        reasons.append("heading-mismatch")
    ps, pe = u["page_start"], u["page_end"]
    if not (isinstance(ps, int) and PAGE_LO <= ps <= pe <= PAGE_HI
            and str(u.get("printed_page_start")) == str(ps)
            and str(u.get("printed_page_end")) == str(pe)
            and ps in map_by_page and pe in map_by_page
            and map_by_page[ps]["printed_page_number"] == str(u.get("printed_page_start"))):
        reasons.append("page-mismatch")
    if FOOT.search(ev):
        reasons.append("footer-header-leakage")
    short = len(ev.strip()) < EVIDENCE_MIN
    cont = not continuation_ok(ev)
    if reasons:
        return "EVIDENCE_CONFLICT", "QUARANTINED", reasons
    if short and risk_of[u["id"]] == "CRITICAL":
        return "EVIDENCE_TOO_SHORT", "QUARANTINED", ["evidence-lt40-chars-critical-claim"]
    out = []
    if short:
        out.append("evidence-lt40-chars-context-dependent")
    if cont:
        out.append("continuation-suspect")
    if cont and risk_of[u["id"]] == "CRITICAL":
        return "EVIDENCE_CONFLICT", "QUARANTINED", ["continuation-suspect-critical-claim"]
    return "EVIDENCE_OK", ("REVIEW_PENDING" if out else "VERIFIED_PRE_M08"), out

# ---------------- PHASE D: table & dose safety (dose-bearing units) ----------------
DOSE_BEARING = [u for u in units if u.get("semantic_domain") == "dosing"]

def table_status(u):
    ev = u.get("evidence_wording") or ""
    if len(ev.strip()) < EVIDENCE_MIN:
        return "TABLE_UNSAFE_FOR_RETRIEVAL", ["evidence-lt40-chars-on-dose-unit"]
    if "\n" not in ev:
        return "TABLE_NOT_APPLICABLE", ["prose-dosing-no-table-structure"]
    lines = [ln for ln in ev.split("\n")]
    reasons = []
    has_dose_line = any(DOSE_PAT.search(ln) for ln in lines)
    avg_len = sum(len(ln) for ln in lines) / max(len(lines), 1)
    if not continuation_ok(ev):
        reasons.append("dangling-line-end-possible-continuation-loss")
    if any(not ln.strip() for ln in lines):
        reasons.append("empty-line-row-break")
    if reasons:
        return "TABLE_PARTIAL", reasons
    if has_dose_line:
        return ("TABLE_RECONSTRUCTED_FROM_GEOMETRY",
                ["line-structure-preserved-by-pymupdf-geometry-v2; dose rows present; "
                 "no original table object exists (tables.jsonl empty)"])
    if avg_len >= 50:
        return "TABLE_NOT_APPLICABLE", ["wrapped-prose-not-table"]
    return "TABLE_PARTIAL", ["multiline-table-like-no-dose-line-row-structure-unproven"]

table_status_of, table_reasons_of = {}, {}
for u in DOSE_BEARING:
    st, rs = table_status(u)
    table_status_of[u["id"]] = st
    table_reasons_of[u["id"]] = rs
table_counts = dict(sorted(collections.Counter(table_status_of.values()).items()))
# TABLE_INTACT is reserved: requires a table object in tables.jsonl (0 exist by QA).

def retrieval_eligible(uid, evid_status, rev_status, tbl_status):
    if rev_status == "QUARANTINED":
        return False, "evidence-quarantined"
    if tbl_status in ("TABLE_PARTIAL", "TABLE_UNSAFE_FOR_RETRIEVAL"):
        return False, f"table-status:{tbl_status}"
    if evid_status not in ("EVIDENCE_OK",):
        return False, f"evidence-status:{evid_status}"
    return True, "eligible"

# ---- build evidence audits for review-scope units (CRITICAL + HIGH) ----
def head160(s):
    s = " ".join(s.split())
    return s[:160]

unit2meds = collections.defaultdict(list)
for m in sorted(meds, key=lambda m: m["med_id"]):
    for uid in (m.get("unit_ids") or []):
        unit2meds[uid].append(m["med_id"])

QUEUE_CATS = {  # semantic_domain -> existing 1100-queue category (reconciliation)
    "dosing": "unit/dose-therapeutic", "interaction": "unit/drug-interaction",
    "precaution": "unit/precaution-safety", "pregnancy-lactation": "unit/pregnancy-lactation"}

audits = {}
queue_rows = []
for u in units:                      # source order (deterministic)
    uid = u["id"]
    risk = risk_of[uid]
    if risk not in ("CRITICAL", "HIGH"):
        continue
    ev_status, rev_status, reasons = evidence_audit(u)
    tbl = table_status_of.get(uid)
    elig, elig_reason = retrieval_eligible(uid, ev_status, rev_status, tbl)
    audits[uid] = (ev_status, rev_status, tuple(reasons))
    p = u["structural_path"]
    row = {
        "knowledge_unit_id": uid, "kind": "unit",
        "clinical_risk": risk, "risk_rule": risk_rule[uid],
        "risk_rules_version": RISK_RULES_VERSION,
        "book_id": u["book_id"], "edition": EDITION,
        "source_version": SOURCE_VERSION_CANON, "source_hash": "sha256:" + SOURCE_HASH,
        "monograph": p[0], "section_path": p, "section_type": p[1],
        "semantic_domain": u.get("semantic_domain"),
        "population": u.get("population"), "age_group": u.get("age_group"),
        "printed_page": {"start": int(u["page_start"]), "end": int(u["page_end"])},
        "pdf_page": {"start": u["page_start"], "end": u["page_end"]},
        "evidence": {"field": "evidence_wording", "sha256": sha(u.get("evidence_wording") or ""),
                     "chars": len(u.get("evidence_wording") or ""),
                     "lines": ((u.get("evidence_wording") or "").count("\n") + 1),
                     "head": head160(u.get("evidence_wording") or "")},
        "evidence_status": ev_status,
        "extraction_status": u.get("extraction_status"),
        "validation_status": u.get("validation_status"),
        "review_status": rev_status,
        "reason_codes": list(reasons),
        "table_status": tbl,
        "table_reasons": table_reasons_of.get(uid),
        "retrieval_eligibility": {"eligible": elig, "reason": elig_reason},
        "med_ids": unit2meds.get(uid, []),
        "queue_category": QUEUE_CATS.get(u.get("semantic_domain")),
    }
    queue_rows.append(row)

med_rows = []
for m in sorted(meds, key=lambda m: m["med_id"]):
    uids = m.get("unit_ids") or []
    dose_units = [i for i in uids if i in umap and umap[i].get("semantic_domain") == "dosing"]
    med_rows.append({
        "knowledge_unit_id": None, "kind": "med", "med_id": m["med_id"],
        "drug_name": m.get("drug_name"),
        "clinical_risk": "CRITICAL", "risk_rule": "med:dose-bearing",
        "risk_rules_version": RISK_RULES_VERSION,
        "book_id": BOOK_ID, "edition": EDITION,
        "source_version": SOURCE_VERSION_CANON, "source_hash": "sha256:" + SOURCE_HASH,
        "printed_page": {"start": int(m["page_start"]), "end": int(m["page_end"])},
        "pdf_page": {"start": m["page_start"], "end": m["page_end"]},
        "brand_names": m.get("brand_names") or [], "drug_class": m.get("drug_class"),
        "dose_field_presence": {f: bool((m.get(f) or "").strip())
                                for f in ("usual_dosage_range", "how_to_dose", "overdose",
                                          "pregnancy", "breast_feeding", "warnings_precautions",
                                          "drug_interactions", "special_populations")},
        "dose_unit_ids": dose_units, "linked_unit_count": len(uids),
        "dose_coverage_ok": len(dose_units) >= 1,
        "evidence_status": "MED_FIELDS_EXACT_OR_EMPTY",
        "review_status": "REVIEW_PENDING", "queue_category": "med/dose-bearing",
        "note": ("med enrichment fields are exact copies of unit evidence or empty by design; "
                 "dose facts live in dose_unit_ids (units are authoritative)")})
queue_out = queue_rows + med_rows

# ---------------- PHASE E: xref integrity (explicit status for all 1073) ----------------
by_mono = collections.defaultdict(list)
for u in units:
    by_mono[u["structural_path"][0]].append(u)
SECT = {"see Pearls": ["pearl"], "see Warnings below": ["warn"],
        "see Children and": ["children"], "see What to": ["what to do"]}

def section_units(f, keys, require_after=False):
    mono = f["structural_path"][0]
    hits = [u for u in by_mono[mono]
            if any(k in e.lower() for e in u["structural_path"][1:] for k in keys)
            and u["id"] != f["id"]]
    secs = {(u["structural_path"][1], u["structural_path"][2]) for u in hits}
    if len(secs) != 1:
        return None
    if require_after and any(u["page_start"] < f["page_start"] for u in hits):
        return None
    return min(hits, key=lambda u: (u["page_start"], u["id"]))["id"]

def resolve_class(row):
    """Read-only re-derivation of knowledge-stahl-xrefs-resolve.py classes."""
    f = umap[row["from_unit"]]
    t = row["target_text"]
    ev = f["evidence_wording"]
    i = ev.find(t)
    assert i >= 0, ("phrase not in own evidence", row)
    window = ev[i:i + 90].replace("\n", " ")
    if t in SECT:
        tgt = section_units(f, SECT[t], require_after=(t == "see Warnings below"))
        if tgt:
            return "would-resolve", None
        mono = f["structural_path"][0]
        any_sec = any(any(k in e.lower() for e in u["structural_path"][1:])
                      for u in by_mono[mono] for k in SECT[t])
        self_only = any(k in e.lower() for e in f["structural_path"][1:] for k in SECT[t])
        if self_only:
            return None, "intra-unit"
        if not any_sec:
            return None, "section-absent"
        return None, "ambiguous"
    if t == "see How to":
        key = ["how to dose"] if "Dose" in window[:24] else []
        tgt = section_units(f, key) if key else None
        if tgt:
            return "would-resolve", None
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
            return "would-resolve", None
        if in_self:
            return None, "table-in-same-unit"
        return None, ("ambiguous" if others else "table-not-atomized")
    return None, "ambiguous"

CLASS_TO_STATUS = {
    "intra-unit": ("POINTER_WITHIN_UNIT",
                   "pointer text resolves inside the referring unit itself"),
    "table-in-same-unit": ("TABLE_CAPTION_WITHIN_UNIT",
                           "referenced table caption lives in the referring unit"),
    "section-absent": ("TARGET_NOT_ATOMIZED",
                       "target section was never atomized; target cannot be proven"),
    "table-not-atomized": ("TARGET_NOT_ATOMIZED",
                           "target table was never atomized; target cannot be proven"),
}
RETRIEVAL_ACTION = {
    "RESOLVED": "link-to-target-unit",
    "POINTER_WITHIN_UNIT": "restrict-hint-to-referring-unit",
    "TABLE_CAPTION_WITHIN_UNIT": "restrict-hint-to-referring-unit",
    "TARGET_NOT_ATOMIZED": "suppress-link-phrase-index-only",
    "UNRESOLVED": "suppress-link-phrase-index-only",
    "CONFLICT": "suppress-link-phrase-index-only",
}
xref_status_counts = collections.Counter()
xref_nonresolved = []
for r in sorted(xrefs, key=lambda r: (r["from_unit"], r["target_text"])):
    if r["status"] == "resolved":
        assert r.get("target_unit") in umap, r
        xref_status_counts["RESOLVED"] += 1
        continue
    derived, why = resolve_class(r)
    if derived == "would-resolve":
        raise SystemExit(f"UNEXPECTED: unresolved row would now resolve: {r}")
    status, reason = CLASS_TO_STATUS.get(why, ("UNRESOLVED", why))
    xref_status_counts[status] += 1
    xref_nonresolved.append({
        "from_unit": r["from_unit"], "target_text": r["target_text"],
        "target_unit": r.get("target_unit"),
        "xref_status": status, "class": why, "reason": reason,
        "retrieval_action": RETRIEVAL_ACTION[status],
        "source_status": "unresolved"})
assert sum(xref_status_counts.values()) == 1073, xref_status_counts
assert xref_status_counts["UNRESOLVED"] == 0 and xref_status_counts["CONFLICT"] == 0

# ---------------- PHASE F: derived retrieval record specification ----------------
xref_by_unit = collections.defaultdict(list)
for r in sorted(xrefs, key=lambda r: (r["from_unit"], r["target_text"])):
    if r["status"] == "resolved":
        st = "RESOLVED"
    else:
        _, why = resolve_class(r)
        st = CLASS_TO_STATUS.get(why, ("UNRESOLVED", why))[0]
    xref_by_unit[r["from_unit"]].append(
        {"xref_key": "xref:" + sha(r["from_unit"] + "|" + r["target_text"])[:12],
         "target_text": r["target_text"], "target_unit": r.get("target_unit"),
         "xref_status": st, "retrieval_action": RETRIEVAL_ACTION[st]})

RISK_RULE_TABLE = [
    {"priority": 1, "if": "structural_path[1] starts with 'dosing'",
     "then": "CRITICAL", "rule": "section:dosing-and-use"},
    {"priority": 2, "if": "semantic_domain in dosing|interaction|pregnancy-lactation|precaution",
     "then": "CRITICAL", "rule": "domain:*"},
    {"priority": 3, "if": "title matches CRIT_TITLE (life-threatening|overdose|toxicity|"
                          "contraindication|do not use|emergency|maximum|titration|interaction|"
                          "pregnancy|breast feeding|lactation|warning|renal|hepatic|cardiac "
                          "impairment|children and adolescents|elderly)",
     "then": "CRITICAL", "rule": "title-keyword"},
    {"priority": 4, "if": "structural_path[1] starts with 'special population'",
     "then": "CRITICAL", "rule": "section:special-populations"},
    {"priority": 5, "if": "semantic_domain in art-of-psychopharmacology|switching|adverse-effect",
     "then": "HIGH", "rule": "domain:*"},
    {"priority": 6, "if": "title matches HIGH_TITLE (commonly prescribed|side effect|monitor|"
                          "switch|discontinuation|treatment duration|pearls|habit)",
     "then": "HIGH", "rule": "title-keyword"},
    {"priority": 7, "if": "otherwise", "then": "NORMAL", "rule": "default"}]

def example_record(row):
    u = umap[row["knowledge_unit_id"]]
    p = u["structural_path"]
    return {
        "knowledge_unit_id": u["id"], "book_id": u["book_id"], "edition_id": "7e",
        "source_version": SOURCE_VERSION_CANON, "language": u.get("language"),
        "topic": p[0], "monograph": p[0], "section_path": p, "section_type": p[1],
        "population": u.get("population"),
        "medication_ids": row["med_ids"], "entity_ids": u.get("entity_ids") or [],
        "concept_ids": u.get("concept_ids") or [],
        "knowledge_type": u.get("semantic_domain"),
        "clinical_risk": row["clinical_risk"], "evidence_status": row["evidence_status"],
        "review_status": row["review_status"],
        "printed_page": row["printed_page"], "pdf_page": row["pdf_page"],
        "source_hash": row["source_hash"],
        "parent_unit_id": u.get("parent_unit"),
        "related_unit_ids": u.get("related_units") or [],
        "xref_ids": [x["xref_key"] for x in xref_by_unit.get(u["id"], [])],
        "retrieval_eligibility": row["retrieval_eligibility"]}

elig_example = next(r for r in queue_rows if r["retrieval_eligibility"]["eligible"])
inelig_example = next(r for r in queue_rows if not r["retrieval_eligibility"]["eligible"])

retrieval_schema = {
    "artifact": "STHAL7-RETRIEVAL-SCHEMA",
    "version": "pre-m08.1",
    "status": "DESIGN_ONLY_NO_EMBEDDING_NO_ACTIVATION",
    "authority": ("canonical units.jsonl (2662) remain the source of truth; this schema "
                  "describes a DERIVED view only (RULE 5). No canonical unit may be "
                  "destroyed, flattened or rewritten to satisfy this schema."),
    "hierarchy": ["Book", "Edition", "Monograph/Topic", "Section", "Knowledge Unit", "Evidence"],
    "field_spec": [
        {"name": "knowledge_unit_id", "type": "string", "required": True,
         "source": "unit.id", "note": "stable stahl7-u-* identifier"},
        {"name": "book_id", "type": "string", "required": True, "source": "unit.book_id"},
        {"name": "edition_id", "type": "string", "required": True,
         "source": "derived: '7e' from book.edition (Seventh edition)"},
        {"name": "source_version", "type": "string", "required": True,
         "source": "book.source_version (colon form; dash/colon resolution in PROVENANCE-MAP)"},
        {"name": "language", "type": "string", "required": True,
         "source": "unit.language (source verbatim, never translated)"},
        {"name": "topic", "type": "string", "required": True,
         "source": "structural_path[0] (monograph or matter topic)"},
        {"name": "monograph", "type": "string", "required": True,
         "source": "structural_path[0] for drug monographs"},
        {"name": "section_path", "type": "array[string]", "required": True,
         "source": "unit.structural_path (depth 3, never flattened)"},
        {"name": "section_type", "type": "string", "required": True,
         "source": "structural_path[1] (verbatim, casing variants preserved)"},
        {"name": "population", "type": "string|null", "required": False,
         "source": "unit.population / unit.age_group"},
        {"name": "medication_ids", "type": "array[string]", "required": False,
         "source": "inverse index of meds[].unit_ids"},
        {"name": "entity_ids", "type": "array[string]", "required": False,
         "source": "unit.entity_ids"},
        {"name": "concept_ids", "type": "array[string]", "required": False,
         "source": "unit.concept_ids"},
        {"name": "knowledge_type", "type": "string", "required": True,
         "source": "unit.semantic_domain"},
        {"name": "clinical_risk", "type": "enum", "required": True,
         "values": ["CRITICAL", "HIGH", "NORMAL"],
         "source": f"deterministic rule table {RISK_RULES_VERSION} (metadata only)"},
        {"name": "evidence_status", "type": "enum", "required": True,
         "values": ["EVIDENCE_OK", "EVIDENCE_TOO_SHORT", "EVIDENCE_CONFLICT",
                    "OCR_UNCERTAIN", "MISSING_EVIDENCE"],
         "source": "pre-m08 evidence audit"},
        {"name": "review_status", "type": "enum", "required": True,
         "values": ["VERIFIED_PRE_M08", "REVIEW_PENDING", "QUARANTINED"],
         "source": "pre-m08 evidence audit"},
        {"name": "printed_page", "type": "object{start,end}", "required": True,
         "source": "int(printed_page_*) — identity rule, see PROVENANCE-MAP"},
        {"name": "pdf_page", "type": "object{start,end}", "required": True,
         "source": "unit.page_start/page_end"},
        {"name": "source_hash", "type": "string", "required": True,
         "source": "'sha256:' + book.local_sha256 (lowercase)"},
        {"name": "parent_unit_id", "type": "string|null", "required": False,
         "source": "unit.parent_unit"},
        {"name": "related_unit_ids", "type": "array[string]", "required": False,
         "source": "unit.related_units"},
        {"name": "xref_ids", "type": "array[string]", "required": False,
         "source": "derived xref keys from xrefs.jsonl (xref:sha12)"},
        {"name": "table_status", "type": "enum", "required": False,
         "values": ["TABLE_INTACT", "TABLE_RECONSTRUCTED_FROM_GEOMETRY", "TABLE_PARTIAL",
                    "TABLE_UNSAFE_FOR_RETRIEVAL", "TABLE_NOT_APPLICABLE"],
         "source": "pre-m08 table audit (dose-bearing units)"},
        {"name": "retrieval_eligibility", "type": "object{eligible,reason}",
         "required": True, "source": "eligibility matrix below"},
        {"name": "evidence", "type": "object", "required": True,
         "source": "unit.evidence_wording + sha256 + page/segment location (RULE 4)"}],
    "chunking_rules": [
        "canonical 2662 units are NEVER destroyed to form chunks (RULE 5)",
        "a retrieval chunk MAY group multiple tightly related canonical units for clinical "
        "completeness; it MUST list every underlying knowledge_unit_id (no orphan chunks)",
        "hierarchy (monograph/section/subsection/table) is preserved via section_path (RULE 6)",
        "chunk eligibility = weakest eligibility among member units",
        "quarantined units may not be chunked into clinically answerable material"],
    "eligibility_matrix": {
        "eligible": {"evidence_status": ["EVIDENCE_OK"],
                     "review_status": ["VERIFIED_PRE_M08", "REVIEW_PENDING"],
                     "table_status": ["TABLE_NOT_APPLICABLE",
                                      "TABLE_RECONSTRUCTED_FROM_GEOMETRY", None],
                     "clinical_risk": ["CRITICAL", "HIGH", "NORMAL"]},
        "not_eligible": {"evidence_status": ["EVIDENCE_TOO_SHORT", "EVIDENCE_CONFLICT",
                                             "OCR_UNCERTAIN", "MISSING_EVIDENCE"],
                         "review_status": ["QUARANTINED"],
                         "table_status": ["TABLE_PARTIAL", "TABLE_UNSAFE_FOR_RETRIEVAL"]},
        "note": "TABLE_INTACT is reserved (0 table objects exist in tables.jsonl)"},
    "xref_retrieval_actions": RETRIEVAL_ACTION,
    "clinical_risk_rules": {"version": RISK_RULES_VERSION, "priority_table": RISK_RULE_TABLE,
                            "layer": "metadata-only, source untouched"},
    "answerability_contract": "STHAL7-ANSWERABILITY-CONTRACT.md",
    "prohibitions": [
        "no embedding or vector write in this phase (M08 gate closed)",
        "no production retrieval activation",
        "no clinical authority implied by any field of this schema",
        "no cross-book xrefs (future phase, separate decision)"],
    "examples": {"eligible": example_record(elig_example),
                 "not_eligible": example_record(inelig_example)}}
#__APPEND__







