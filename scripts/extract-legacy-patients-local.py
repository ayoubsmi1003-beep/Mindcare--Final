#!/usr/bin/env python3
"""Legacy patient extraction (syglab -> MindCare OS staging JSON).

READ-ONLY on source. LOCAL-ONLY (stdlib, no network, no external API).
Scope (user-confirmed): name, phone(s) view-only, Num_CDI, consultations-only
historique (antecedents baseline + ordonnances/lignes). document/fichier/
questionnaires/billing/fil_attente/rdv explicitly OUT. dem_consultation.csv is
ABSENT from this working copy -> reported, never invented.

Outputs (PII, git-ignored):
  legacy_patients_extracted.json
  legacy_patients_extraction_report.json
  legacy_patients_manual_review.json
"""
import argparse
import csv
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SOURCE_SYSTEM = "syglab"
SCHEMA_VERSION = "1.0"
REPLACEMENT_CHAR = "\ufffd"
CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
DIGITS_RE = re.compile(r"\D+")


def norm_key(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def pick(row, *candidates):
    """Exact header match first, then normalized fallback (header mojibake-proof).
    Never touches values."""
    for c in candidates:
        if c in row:
            return c
    index = {norm_key(k): k for k in row.keys()}
    for c in candidates:
        if norm_key(c) in index:
            return index[norm_key(c)]
    return None


def val(row, *candidates):
    k = pick(row, *candidates)
    if k is None:
        return ""
    v = row.get(k)
    return "" if v is None else v


def is_empty(v):
    return v is None or str(v).strip() == ""


def verbatim(v):
    """Preserve original; only strip storage-padding whitespace at the edges."""
    return str(v).strip() if v is not None else ""


def quality_flags(value):
    """Return list of quality flags without altering the value."""
    flags = []
    if REPLACEMENT_CHAR in value:
        flags.append("decode_replacement_char")
    if CTRL_RE.search(value):
        flags.append("control_characters")
    return flags


def read_csv(path):
    """Yield (row_dict, line_no). Decodes UTF-8-SIG, replaces undecodable bytes
    (flagged, never guessed). csv module handles multiline longtext."""
    with open(path, "r", encoding="utf-8-sig", errors="replace", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            return
        for i, row in enumerate(reader, start=2):
            yield {k: (v if v is not None else "") for k, v in row.items()}, i


def phone_digits(p):
    return DIGITS_RE.sub("", p or "")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="doctor_old_data",
                    help="Base dir containing 02_structured/csv + 00_metadata")
    ap.add_argument("--out", default="doctor_old_data/extract",
                    help="Output dir (must stay local + git-ignored)")
    args = ap.parse_args()

    base = Path(args.base)
    csvdir = base / "02_structured" / "csv"
    outdir = Path(args.out)
    outdir.mkdir(parents=True, exist_ok=True)

    errors = []
    review = []

    # ---- medicament catalog (display join only, raw fields kept verbatim) ----
    med_path = csvdir / "medicament.csv"
    meds = {}
    if not med_path.exists():
        errors.append({"file": "medicament.csv", "error": "file_absent"})
    else:
        for row, _ln in read_csv(med_path):
            mid = verbatim(val(row, "IDMedicament", "IDMédicament"))
            if mid:
                meds[mid] = row

    def med_display(mid, row):
        if row is None:
            return None
        parts = [verbatim(val(row, "NomCommerciale")),
                 verbatim(val(row, "NomDci")),
                 verbatim(val(row, "Forme")),
                 verbatim(val(row, "Dosage"))]
        parts = [p for p in parts if p]
        return " ".join(parts) if parts else None

    # ---- ligne_ordonnances grouped by ordonnance ----
    ligne_path = csvdir / "ligne_ordonnances.csv"
    lignes_by_ord = defaultdict(list)
    if not ligne_path.exists():
        errors.append({"file": "ligne_ordonnances.csv", "error": "file_absent"})
    else:
        for row, _ln in read_csv(ligne_path):
            oid = verbatim(val(row, "IDOrdonnances"))
            lignes_by_ord[oid].append(row)

    # ---- ordonnances grouped by patient ----
    ord_path = csvdir / "ordonnances.csv"
    ord_by_patient = defaultdict(list)
    ord_total = 0
    if not ord_path.exists():
        errors.append({"file": "ordonnances.csv", "error": "file_absent"})
    else:
        for row, _ln in read_csv(ord_path):
            ord_total += 1
            pid = verbatim(val(row, "IDPatient"))
            ord_by_patient[pid].append(row)

    # ---- dem_consultation: ABSENT in this copy (hash 6ADE... proves it existed
    # at 2026-09-30 extraction). Reported, never reconstructed. ----
    dem_path = csvdir / "dem_consultation.csv"
    dem_missing = not dem_path.exists()
    if dem_missing:
        errors.append({
            "file": "dem_consultation.csv",
            "error": "file_absent_in_working_copy",
            "expected_rows": 3213,
            "evidence": "00_metadata/csv_hashes.csv + csv_export_log.tsv list "
                        "dem_consultation.csv (3213 rows); file not present; "
                        "no raw dump available locally",
            "impact": "consultation historique (Motif/Observation/Diagnostique/ "
                      "ResultatExamen) NOT recoverable from this copy",
        })

    # ---- patients ----
    pat_path = csvdir / "patient.csv"
    if not pat_path.exists():
        print("FATAL: patient.csv absent", file=sys.stderr)
        return 2

    patients = []
    seen_ids = set()
    dup_id_rows = []
    cdi_index = defaultdict(list)
    phone_index = defaultdict(list)
    n_missing_name = n_missing_phone = n_missing_cdi = 0
    n_with_history = n_without_history = 0
    n_unreadable = 0

    for row, ln in read_csv(pat_path):
        pid = verbatim(val(row, "IDPatient"))
        if not pid:
            review.append({"source_patient_id": None, "patient_name": None,
                           "issue": "missing_legacy_id", "field": "IDPatient",
                           "original_value": "", "reason_manual_review_required":
                           "row without legacy PK at patient.csv line %d" % ln})
            continue
        if pid in seen_ids:
            dup_id_rows.append(pid)
        seen_ids.add(pid)

        nom = verbatim(val(row, "Pat_nom"))
        prenom = verbatim(val(row, "Pat_prenom"))
        # View-only phones: all_patient.Telephone1 == Telephone2 == Pat_Tel
        # (view def: both select patient.Pat_Tel). Dedupe, preserve verbatim.
        tel_raw = verbatim(val(row, "Pat_Tel"))
        phones = []
        if not is_empty(tel_raw):
            phones = [tel_raw]
        cdi = verbatim(val(row, "Num_CDI"))
        cdi_out = cdi if not is_empty(cdi) else None

        if is_empty(nom) and is_empty(prenom):
            name = None
            n_missing_name += 1
        else:
            name = (nom + " " + prenom).strip()

        if not phones:
            n_missing_phone += 1
        if cdi_out is None:
            n_missing_cdi += 1

        # quality flags over exported values only
        qflags = {}
        for label, v in (("name", name or ""), ("phone", tel_raw),
                         ("id_card_number", cdi)):
            fl = quality_flags(v)
            if fl:
                qflags[label] = fl
        if qflags:
            n_unreadable += 1
            review.append({"source_patient_id": pid, "patient_name": name,
                           "issue": "unreadable_or_suspicious_characters",
                           "field": ",".join(sorted(qflags)),
                           "original_value": "[withheld_in_review_entry_see_extracted_json]",
                           "reason_manual_review_required":
                           "decode replacement and/or control characters: %s" % qflags})

        # ---- historique: antecedents baseline + ordonnances (consultations) --
        historique = []
        ant_fields = [
            ("Antecedents_medicaux", verbatim(val(row, "Antecedents_medicaux",
                                                  "Antécédents_médicaux"))),
            ("Autre_Antecedents", verbatim(val(row, "Autre_Antecedents",
                                               "Autre_Antécédents"))),
            ("Antecedents_Familiales", verbatim(val(row, "Antecedents_Familiales",
                                                    "Antécédents_Familiales"))),
            ("Antecedents_chirurgicaux", verbatim(val(row, "Antecedents_chirurgicaux",
                                                      "Antécédents_chirurgicaux"))),
            ("Note", verbatim(val(row, "Note"))),
        ]
        ant_present = [(k, v) for k, v in ant_fields if not is_empty(v)]
        if ant_present:
            content = "\n".join("%s: %s" % (k, v) for k, v in ant_present)
            historique.append({"date": None, "content": content,
                               "source_record_reference":
                               "patient.IDPatient=%s" % pid})

        for ord_row in ord_by_patient.get(pid, []):
            oid = verbatim(val(ord_row, "IDOrdonnances"))
            odate = verbatim(val(ord_row, "Date")) or None
            if odate == "" or odate == "0000-00-00":
                odate = None
            numero = verbatim(val(ord_row, "Numero"))
            obs = verbatim(val(ord_row, "Observation"))
            lines = []
            line_refs = []
            for lrow in lignes_by_ord.get(oid, []):
                lid = verbatim(val(lrow, "IDLigne_Ordonnances"))
                line_refs.append(lid)
                mid = verbatim(val(lrow, "IDMedicament", "IDMédicament"))
                disp = med_display(mid, meds.get(mid))
                if mid and mid not in meds:
                    review.append({"source_patient_id": pid,
                                   "patient_name": name,
                                   "issue": "prescription_line_unmatched_medicament",
                                   "field": "ligne_ordonnances.IDMedicament",
                                   "original_value": mid,
                                   "reason_manual_review_required":
                                   "IDLigne_Ordonnances=%s IDOrdonnances=%s "
                                   "references unknown medicament" % (lid, oid)})
                detail = [("medicament", disp if disp else
                            ("[unmatched IDMedicament=%s]" % mid if mid else "")),
                          ("posologie", verbatim(val(lrow, "posologie"))),
                          ("texte_libre", verbatim(val(lrow, "texte_libre"))),
                          ("Quantite", verbatim(val(lrow, "Quantite", "Quantité"))),
                          ("Nbr_jour", verbatim(val(lrow, "Nbr_jour"))),
                          ("Nbr_fois", verbatim(val(lrow, "Nbr_fois"))),
                          ("qsp", verbatim(val(lrow, "qsp")))]
                detail = [(k, v) for k, v in detail if v]
                lines.append(" | ".join("%s=%s" % (k, v) for k, v in detail)
                             if detail else "[ligne IDLigne_Ordonnances=%s]" % lid)
            head = "Ordonnance%s%s" % ((" %s" % numero) if numero else "",
                                      (": %s" % obs) if obs else "")
            content = head + ("\n" + "\n".join("- " + l for l in lines) if lines else "")
            ref = "ordonnances.IDOrdonnances=%s" % oid
            if line_refs:
                ref += "; ligne_ordonnances.IDLigne_Ordonnances=%s" % ",".join(line_refs)
            historique.append({"date": odate, "content": content,
                               "source_record_reference": ref})

        # chronological order: baseline (date null from antecedents) first,
        # then dated ascending, then undated ordonnances in file order
        baseline = [h for h in historique
                    if h["date"] is None and h["source_record_reference"].startswith("patient.")]
        rest = [h for h in historique
                if not h["source_record_reference"].startswith("patient.")]
        rest.sort(key=lambda h: (h["date"] is None, h["date"] or ""))
        historique = baseline + rest

        if historique:
            n_with_history += 1
        else:
            n_without_history += 1
            review.append({"source_patient_id": pid, "patient_name": name,
                           "issue": "no_recoverable_historique",
                           "field": "historique",
                           "original_value": "",
                           "reason_manual_review_required":
                           "no antecedents/note/ordonnances in this copy; "
                           "dem_consultation.csv absent so consultation "
                           "history not recoverable"})

        if not phones and cdi_out is None:
            review.append({"source_patient_id": pid, "patient_name": name,
                           "issue": "weak_identity_no_phone_no_id_card",
                           "field": "phone_numbers,id_card_number",
                           "original_value": "",
                           "reason_manual_review_required":
                           "neither phone nor ID-card number present; "
                           "human identity check required before any import"})

        if name is None:
            review.append({"source_patient_id": pid, "patient_name": None,
                           "issue": "missing_name", "field": "name",
                           "original_value": "",
                           "reason_manual_review_required":
                           "Pat_nom and Pat_prenom both empty"})

        if cdi_out:
            cdi_index[cdi_out].append(pid)
        for p in phones:
            d = phone_digits(p)
            if d:
                phone_index[d].append(pid)

        patients.append({
            "source_system": SOURCE_SYSTEM,
            "source_patient_id": pid,
            "source_record_reference": "patient.IDPatient=%s" % pid,
            "name": name,
            "phone_numbers": phones,
            "id_card_number": cdi_out,
            "possible_duplicate": False,
            "historique": historique,
        })

    # ---- orphan ordonnances (IDPatient matches no patient) ----
    orphan_ord = sorted(set(ord_by_patient) - seen_ids)
    for opid in orphan_ord:
        review.append({"source_patient_id": opid, "patient_name": None,
                       "issue": "orphan_ordonnances_no_matching_patient",
                       "field": "ordonnances.IDPatient",
                       "original_value": opid,
                       "reason_manual_review_required":
                       "%d ordonnance(s) reference IDPatient=%s with no "
                       "patient.IDPatient; kept separate, not merged"
                       % (len(ord_by_patient[opid]), opid)})

    # ---- duplicate candidates (conservative, never merged) ----
    dup_groups = []
    for key, members in sorted(cdi_index.items()):
        uniq = sorted(set(members))
        if len(uniq) > 1:
            dup_groups.append({"match_on": "id_card_number",
                               "matched_key": key, "members": uniq})
    for key, members in sorted(phone_index.items()):
        uniq = sorted(set(members))
        if len(uniq) > 1:
            dup_groups.append({"match_on": "phone_digits",
                               "matched_key": key, "members": uniq})
    dup_ids = set()
    for g in dup_groups:
        dup_ids.update(g["members"])
    for p in patients:
        if p["source_patient_id"] in dup_ids:
            p["possible_duplicate"] = True

    # ---- write outputs ----
    extracted = {"migration_type": "legacy_patient_extraction",
                 "schema_version": SCHEMA_VERSION,
                 "source_system": SOURCE_SYSTEM,
                 "patients": patients}
    with open(outdir / "legacy_patients_extracted.json", "w",
              encoding="utf-8") as f:
        json.dump(extracted, f, ensure_ascii=False, indent=1)

    report = {
        "migration_type": "legacy_patient_extraction_report",
        "schema_version": SCHEMA_VERSION,
        "source_system": SOURCE_SYSTEM,
        "scope": {"historique": "consultations-only (antecedents baseline + "
                                "ordonnances/lignes); document/fichier/"
                                "questionnaires/billing/fil_attente/rdv OUT "
                                "per instruction",
                  "phones": "view-only: all_patient.Telephone1==Telephone2==patient.Pat_Tel "
                            "(view selects Pat_Tel twice) -> single deduped number",
                  "id_card": "patient.Num_CDI verbatim"},
        "source_files_used": ["02_structured/csv/patient.csv",
                              "02_structured/csv/ordonnances.csv",
                              "02_structured/csv/ligne_ordonnances.csv",
                              "02_structured/csv/medicament.csv (name lookup only)"],
        "patients_found": len(patients),
        "patients_extracted": len(patients),
        "patients_with_missing_name": n_missing_name,
        "patients_with_missing_phone": n_missing_phone,
        "patients_with_missing_id_card": n_missing_cdi,
        "patients_with_history": n_with_history,
        "patients_without_history": n_without_history,
        "ordonnances_total": ord_total,
        "ordonnances_matched": sum(1 for p in patients
                                   for h in p["historique"]
                                   if h["source_record_reference"].startswith("ordonnances.")),
        "orphan_ordonnance_patient_ids": orphan_ord,
        "possible_duplicate_groups": dup_groups,
        "possible_duplicate_patient_count": len(dup_ids),
        "duplicate_legacy_ids_in_patient_csv": sorted(set(dup_id_rows)),
        "unreadable_or_suspicious_value_count": n_unreadable,
        "extraction_errors": errors,
        "history_coverage": {"with_history": n_with_history,
                             "without_history": n_without_history,
                             "note": "dem_consultation.csv absent -> consultation "
                                     "Motif/Observation/Diagnostique history missing "
                                     "for all patients in this copy"},
        "manual_review_entries": len(review),
    }
    with open(outdir / "legacy_patients_extraction_report.json", "w",
              encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)

    with open(outdir / "legacy_patients_manual_review.json", "w",
              encoding="utf-8") as f:
        json.dump(review, f, ensure_ascii=False, indent=1)

    # stdout: counts only, never PII
    summary = {"patients_found": len(patients),
               "patients_extracted": len(patients),
               "missing_name": n_missing_name,
               "missing_phone": n_missing_phone,
               "missing_id_card": n_missing_cdi,
               "with_history": n_with_history,
               "without_history": n_without_history,
               "duplicate_groups": len(dup_groups),
               "orphan_ord_ids": len(orphan_ord),
               "unreadable": n_unreadable,
               "errors": len(errors),
               "review_entries": len(review)}
    print(json.dumps(summary))
    return 0


if __name__ == "__main__":
    sys.exit(main())
