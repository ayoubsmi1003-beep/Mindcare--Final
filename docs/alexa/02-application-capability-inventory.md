# 02 — Application capability inventory

Verified from code at `b4bd811`, not from product documents. "Live def" means the highest migration containing `CREATE OR REPLACE`.

**Classes:** A implemented and accessible to Alexa · B implemented, not accessible · C partial · D documented only · E absent. No domain is class D.

| Domain | Route | Service | Key gates (`app.`) | Alexa read | Alexa write | Class | Limits |
|---|---|---|---|---|---|---|---|
| Patients | /patients, /nouveau | `patients.ts` | `search_patients`, `get_patient`, `create/update_patient` | `query_patients`, profile section | None | C | Create, update, similar-patient search unreachable |
| Profile, timeline | /patients/[id] | `patients.ts` | `get_patient_workspace`, `list_patient_timeline` | sections profile, timeline | n/a | A | Timeline refuses date filters and client cursors |
| Consultations | /consultation/[id] | `consultations.ts` | `query_alexa_records`, `get_consultation`, `get_consultation_analysis` | `query_consultations` | `close_consultation` | C | "Oldest" refused; start unreachable |
| Clinical notes | consultation page | `consultations.ts` | `query_alexa_note_sections` | section notes, paged | None | C | Save, sign, amend unreachable |
| Treatments | /traitements | `patient-treatments.ts`, `medication-workspace.ts`, `medication-phase2.ts` | `get_alexa_clinical_context`, `get_patient_treatments`, `list_medication_workload` | Current and history; catalogue | update, pause, resume, stop | C | Allergies, adverse events, adherence, measurements, workload unread |
| Prescriptions | `OrdonnancesTraitements.tsx` | `documents.ts`, `document-drafts.ts` | `doc_type 'ordonnance'`, `link_prescription_renewal` | As document kind | Draft, print | C | Legacy `app.prescriptions` has no structured read |
| Documents, certificates | /documents | `documents.ts`, `document-drafts.ts` | `query_alexa_records`, `get_document`, `get_editable_document_draft` | List, paged text, open | Draft, print | A | Body search refused; issue and void unreachable |
| Agenda | /agenda | `appointments.ts` | `query_alexa_records`, `get_appointment`, `list_agenda` | `query_agenda` | create, reschedule, cancel | A | "Last appointment" and end-time axis refused |
| Reception | `RechercheEclair` | `reception.ts` | `reception_board`, `mark_appointment_arrived/no_show` | `query_app` reception, one day | `mark_patient_arrived` | C | No no-show action |
| Finance | /finances | `finance.ts`, `finance-cash.ts` | `get_finance_overview`, `get_charges_list`, `day_revenue` | 6 cabinet modes, list, totals | price, payment, charges | A | Cash only; no invoice table; patient summary caps at 10 consultations |
| Messages | /messages | `communication/*`, `cabinet-collaboration.ts` | `comm_*`, `send/list_internal_messages` | Draft only | `send_internal_message` | C | Inbox and internal messages unread |
| Aftercare | none; consultation and patient pages | `apres-seance.ts`, `resume-cas.ts` | `get_consultation_analysis`, `get_alexa_case_summary` | Analysis only | None | C | Case summary status unread |
| Statistics | /statistiques | `analyse.ts` | `get_analysis_overview`, `get_analysis_drilldown` | No | None | B | Not a tool |
| Settings | /parametres | `cabinet.ts`, `cabinet-postes.ts` | `get_my_cabinet`, `get_my_profile` | Views cabinet, practitioner | None | C | Read-only |
| Observability | /observabilite | `observabilite-lecture.ts` | `get_observability_stats` | No | None | B | Owner and practitioner only |
| Global search | none found | `patients.ts`, `medications.ts`, `connaissance-recherche.ts` | `search_patients`, `search_medications` | By patient, medication, knowledge | n/a | C | No cross-domain search |
| Dashboard | /tableauDeBord | `dashboard.ts` | `dashboard_today` | Partly, via adapters | None | C | No dedicated tool |
| Notifications | none found | `notifications.ts` | `get_alexa_office_status` | Counts by kind | None | C | Payloads unread, deliberately |

## Absent or not supported (capability-boundary tests only)

- Invoices: no table.
- Refunds and payment voiding: no column or enum.
- Financial goals: ruled absent by the practitioner (Q14).
- Payment aging: deferred by `DOC-AUTHORITY.md`.
- AI narration of finance figures: rejected, not deferred, by `DOC-AUTHORITY.md`.
- Medication interaction source: no validated source (commit `1f4daf2`).
- Autonomous prescribing, diagnosis, signature: forbidden by product rule.

## Agent tools (`src/shared/alexa/agent.ts`; 3 rounds, 6 calls)

| Tool | Kind | Scope |
|---|---|---|
| `declare_request`, `ask_doctor` | Control | Declare parts; one clarification |
| `query_patients` | Read | Search, filter, metrics, sort |
| `get_patient_context` | Read | summary, history, treatments, profile, diagnoses, scales, current, notes, timeline |
| `query_consultations` | Read | Period, axis, status, view |
| `query_agenda` | Read | Period, status, patient |
| `query_documents` | Read | Kind, status, period, paged text |
| `query_finance` | Read | Patient, period, state, mode |
| `query_app` | Read | cabinet, practitioner, notifications, system, message_draft, reception, medication_catalog |
| `search_knowledge`, `answer_general` | Read | Books; general |
| `navigate` | UI | Closed destinations |
| `prepare_action` | Write proposal | 18 actions; 17 through the DB allowlist in migration 190 |

The older `services/jarvis-capacites.ts` registry serves `jarvis-boucle.ts`, not this loop. Nothing today gives the planner a single machine-readable capability list; `src/shared/alexa/capabilities.ts` will.

## Roles

`owner`, `practitioner`, `assistant` (`app.user_role` also has `patient`). `authz.ts` is display-only and SQL decides. Finance rows for a practitioner are limited to their own. The assistant gets `query_alexa_records` for agenda only and is refused finance, charges, analysis, observability and medication phase 2.

## Likely bug

`server/alexa/patient-records.ts:10` allows only 4 document types, not `ordonnance`. The orchestrator's documents intent likely fails for a patient holding one. To reproduce in Phase 2.

## Cheap gaps over existing gates (Phase 5)

1. Allergies, adverse events, adherence, measurements (`medication-phase2.ts`). Highest clinical value: `get_alexa_clinical_context` carries none of them.
2. Treatment timeline and workload (`medication-workspace.ts`).
3. Statistics (`analyse.ts`).
4. Internal messages (`cabinet-collaboration.ts`).
5. Dashboard (`dashboard.ts`, `receipts-adapter.ts`).
6. Case summary and status (`resume-cas.ts`).
7. Observability (`observabilite-lecture.ts`).
8. The `ordonnance` fix.
9. No-show write: least cheap, as it needs an allowlist migration.

## Evaluation data

| Database | Use | Verified |
|---|---|---|
| `127.0.0.1:55445/alexa_eval_v8_intelligence_20261027` (container `mindcare-v8-intelligence-20261027`) | Main evaluation database. The user confirmed on 2026-11-06 that it holds test data, even though `purge-synthetic.sql` calls these records production records; `is_synthetic` alone proves nothing. Identities still stay out of commits, docs and reports | 1,558 patients, 8,143 consultations, `is_cloud_dev()=true` on 2026-11-06 |
| `alexa_eval_v9_fixture_20261030`, `alexa_eval_v9_actions_20261031` (same container) | Frozen fixture and action campaigns | Listed, not yet counted |
| `tests/eval/alexa-rich-patients-fixture.json` | 2 fictional patients, 3 actors, 17 oracle entries | Refuses anything but its own disposable target |
| `mc-p3` (55441) | Development database: 1,558 patients, 2 consultations | **Not an evaluation target** |
| Native 5432, packaged 54333 | Not identified | **Never touched** |
