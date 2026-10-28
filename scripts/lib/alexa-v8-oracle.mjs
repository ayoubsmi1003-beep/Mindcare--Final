import { createHash } from 'node:crypto';

/** Derive expected counts from the independently captured cabinet rows. */
export function patientCountOracles(rows) {
  if (!Array.isArray(rows)) throw new Error('Patient oracle rows required');
  const counts = {
    active_count: 0, archived_count: 0, all_count: 0,
    active_missing_phone_count: 0, active_present_phone_count: 0,
    active_missing_identity_count: 0, active_present_identity_count: 0,
    active_missing_birth_count: 0,
  };
  const missing = value => value == null || (typeof value === 'string' && !value.replace(/[\s\u00a0\u202f\ufeff]/gu, ''));
  for (const row of rows) {
    if (!row || typeof row.is_active !== 'boolean' ||
        ![row.phone, row.id_document_number, row.birth_date].every(value => value === null || typeof value === 'string')) {
      throw new Error('Malformed patient oracle row');
    }
    counts.all_count++;
    if (!row.is_active) { counts.archived_count++; continue; }
    counts.active_count++;
    counts[missing(row.phone) ? 'active_missing_phone_count' : 'active_present_phone_count']++;
    counts[missing(row.id_document_number) ? 'active_missing_identity_count' : 'active_present_identity_count']++;
    if (row.birth_date === null) counts.active_missing_birth_count++;
  }
  return counts;
}

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const sha256 = value => createHash('sha256').update(canonical(value)).digest('hex');
const tableDigestCache = new WeakMap();
const empty = value => value == null || (typeof value === 'string' && !value.trim());
const clinicalStatus = row => row.status === 'closed' || row.status === 'terminée' || row.status === 'terminee';
const localDate = value => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? null : new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Algiers', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
};
const shiftDate = (value, days) => {
  const date = new Date(`${value}T12:00:00+01:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return localDate(date.toISOString());
};
const ageAt = (birthDate, asOf) => {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`), current = new Date(`${asOf}T00:00:00Z`);
  if (Number.isNaN(birth.valueOf())) return null;
  let years = current.getUTCFullYear() - birth.getUTCFullYear();
  if (current.getUTCMonth() < birth.getUTCMonth() || (current.getUTCMonth() === birth.getUTCMonth() && current.getUTCDate() < birth.getUTCDate())) years--;
  return years;
};

function patientForKey(key, snapshot) {
  if (/(?:^|_)patient_b(?:_|$)/u.test(key)) return { ref: 'PATIENT_B', patient: snapshot.patientB };
  const long = /^long_([123])_/u.exec(key);
  if (long) return { ref: `PATIENT_LONG_${long[1]}`, patient: snapshot.longPatients[Number(long[1]) - 1] };
  if (key.includes('patient_a') || key.includes('current_patient') || key.includes('current_consultation') || key.includes('current_document')) {
    return { ref: 'PATIENT_A', patient: snapshot.patientA };
  }
  return null;
}

function patientAssertions(key, snapshot) {
  const rows = snapshot.tables.patients ?? [];
  const counts = patientCountOracles(rows);
  if (Object.hasOwn(counts, key)) return [{ kind: 'exact_count', subject: key, value: counts[key] }];
  const asOf = snapshot.fixtureAsOf?.slice(0, 10) ?? '2026-10-27';
  const active = rows.filter(row => row.is_active);
  const closedCounts = new Map();
  for (const visit of snapshot.tables.consultations ?? []) if (clinicalStatus(visit)) closedCounts.set(visit.patient_id, (closedCounts.get(visit.patient_id) ?? 0) + 1);
  const ages = new Map(rows.map(row => [row.id, ageAt(row.birth_date, asOf)]));
  const aggregate = {
    active_child_count: active.filter(row => (ages.get(row.id) ?? 99) < 18).length,
    active_adult_count: active.filter(row => ages.get(row.id) != null && ages.get(row.id) >= 18).length,
    active_incomplete_count: active.filter(row => empty(row.phone) || empty(row.id_document_number) || empty(row.birth_date)).length,
    active_adult_missing_phone_count: active.filter(row => ages.get(row.id) != null && ages.get(row.id) >= 18 && empty(row.phone)).length,
    active_child_missing_identity_count: active.filter(row => (ages.get(row.id) ?? 99) < 18 && empty(row.id_document_number)).length,
    active_three_closed_visits: active.filter(row => (closedCounts.get(row.id) ?? 0) >= 3).length,
    active_no_closed_visit: active.filter(row => (closedCounts.get(row.id) ?? 0) === 0).length,
    active_unknown_age_count: active.filter(row => ages.get(row.id) == null).length,
  };
  if (Object.hasOwn(aggregate, key)) return [{ kind: 'exact_count', subject: key, value: aggregate[key] }];
  const exactFields = {
    patient_a_phone: ['phone', 'patients.phone'], patient_a_birth: ['birth_date', 'patients.birth_date'],
    patient_a_record_number: ['record_number', 'patients.record_number'], patient_a_address: ['address', 'patients.address'],
  };
  if (exactFields[key]) {
    const [field, label] = exactFields[key];
    const row = rows.find(patient => patient.id === snapshot.patientA.id);
    return [{ kind: 'exact_value', field: label, value: row?.[field] ?? null }];
  }
  const filteredLists = {
    active_missing_phone_list: row => row.is_active && empty(row.phone),
    active_missing_identity_list: row => row.is_active && empty(row.id_document_number),
    archived_list: row => !row.is_active,
    active_missing_phone_and_identity: row => row.is_active && empty(row.phone) && empty(row.id_document_number),
  };
  if (filteredLists[key]) {
    const matched = rows.filter(filteredLists[key])
      .sort((a, b) => String(a.last_name ?? '').localeCompare(String(b.last_name ?? ''), 'fr') || String(a.first_name ?? '').localeCompare(String(b.first_name ?? ''), 'fr') || String(a.id).localeCompare(String(b.id)))
      .map(row => ({ id: row.id, name: [row.first_name, row.last_name].filter(Boolean).join(' ') }));
    return [{ kind: 'exact_patient_set', count: matched.length, values: matched, sha256: sha256(matched) }];
  }
  if (key === 'active_phone_partition') return [{ kind: 'exact_partition', withPhone: counts.active_present_phone_count, withoutPhone: counts.active_missing_phone_count }];
  if (key === 'active_missing_phone_and_identity') return [{ kind: 'exact_patient_set', count: rows.filter(row => row.is_active && empty(row.phone) && empty(row.id_document_number)).length }];
  if (key === 'active_adult_missing_phone_count' || key === 'active_child_missing_identity_count' || key === 'active_three_closed_visits' || key === 'active_no_closed_visit' || key === 'active_unknown_age_count' || key === 'active_child_count' || key === 'active_adult_count' || key === 'active_incomplete_count') {
    return [{ kind: 'exact_count', subject: key, value: aggregate[key] }];
  }
  const patientRef = patientForKey(key, snapshot);
  if (key === 'two_patient_phones') {
    const patientA = rows.find(row => row.id === snapshot.patientA.id);
    const patientB = rows.find(row => row.id === snapshot.patientB.id);
    return [{ kind: 'exact_values', values: [patientB?.phone ?? null, patientA?.phone ?? null] }];
  }
  if (key === 'exact_patient_a') {
    const row = rows.find(patient => patient.id === snapshot.patientA.id);
    return [{ kind: 'exact_patient', patient: row ?? null }];
  }
  if (patientRef) {
    const row = rows.find(patient => patient.id === patientRef.patient?.id);
    if (key.endsWith('_missing_fields')) {
      const fields = ['phone', 'phone_alt', 'birth_date', 'address', 'id_document_number', 'record_number'];
      return [{ kind: 'missing_fields', fields: fields.filter(field => empty(row?.[field])) }];
    }
    if (key === 'patient_b_birth_presence') return [{ kind: 'exact_presence', field: 'patients.birth_date', present: !empty(row?.birth_date) }];
    if (key === 'current_patient_full_name') return [{ kind: 'exact_value', field: 'patients.full_name', value: [row?.first_name, row?.last_name].filter(Boolean).join(' ') }];
  }
  return null;
}

function consultationAssertions(key, snapshot) {
  const rows = snapshot.tables.selectedConsultations ?? [];
  const allRows = snapshot.tables.consultations ?? [];
  const patient = patientForKey(key, snapshot)?.patient ?? snapshot.patientA;
  const patientId = patient?.id;
  const visits = rows.filter(row => row.patient_id === patientId).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)) || String(a.id).localeCompare(String(b.id)));
  const notes = (snapshot.tables.selectedNotes ?? []).filter(row => row.patient_id === patientId);
  const noteByConsultation = new Map(notes.map(row => [row.consultation_id, row]));
  const selected = id => visits.find(row => row.id === id);
  const latest = visits.at(-1), previous = visits.at(-2), first = visits[0];
  const treatments = (snapshot.tables.treatments ?? []).filter(row => row.patient_id === patientId);
  const diagnoses = (snapshot.tables.diagnoses ?? []).filter(row => row.patient_id === patientId);
  const administrations = (snapshot.tables.scaleAdministrations ?? []).filter(row => row.patient_id === patientId);
  const asOf = snapshot.fixtureAsOf?.slice(0, 10) ?? '2026-10-27';
  const month = asOf.slice(0, 7);
  const closedForPatient = visits.filter(clinicalStatus);
  const sourceNotes = ids => ids.map(id => ({ kind: 'source_note', consultationId: id, note: noteByConsultation.get(id) ?? null }));
  const maps = {
    patient_a_active_treatments: () => [{ kind: 'exact_rows', rows: treatments.filter(row => row.status === 'active') }],
    patient_a_paused_treatments: () => [{ kind: 'exact_rows', rows: treatments.filter(row => row.status === 'paused') }],
    patient_a_stopped_treatments: () => [{ kind: 'exact_rows', rows: treatments.filter(row => row.status === 'stopped') }],
    patient_a_active_diagnoses: () => [{ kind: 'exact_rows', rows: diagnoses.filter(row => row.status === 'active') }],
    patient_a_resolved_diagnoses: () => [{ kind: 'exact_rows', rows: diagnoses.filter(row => row.status === 'resolved') }],
    patient_a_scales: () => [{ kind: 'exact_rows', rows: administrations }],
    patient_a_latest_scale_score: () => [{ kind: 'exact_rows', rows: administrations.sort((a, b) => String(b.administered_at ?? '').localeCompare(String(a.administered_at ?? ''))).slice(0, 1) }],
    patient_a_closed_count: () => [{ kind: 'exact_count', subject: 'closed_consultations', value: closedForPatient.length }],
    patient_a_open_count: () => [{ kind: 'exact_count', subject: 'open_consultations', value: visits.filter(row => !clinicalStatus(row)).length }],
    patient_a_october_visits: () => [{ kind: 'exact_rows', rows: visits.filter(row => localDate(row.started_at)?.startsWith(month)) }],
    patient_a_oldest_visit: () => [{ kind: 'exact_rows', rows: first ? [first] : [] }, ...sourceNotes(first ? [first.id] : [])],
    patient_a_latest_treatment_change: () => [{ kind: 'exact_rows', rows: (snapshot.tables.treatmentHistory ?? []).filter(row => treatments.some(treatment => treatment.id === row.treatment_id)).sort((a, b) => String(b.occurred_at ?? '').localeCompare(String(a.occurred_at ?? ''))).slice(0, 1) }],
    patient_a_latest_followup_plan: () => [{ kind: 'exact_value', field: 'clinical_notes.plan', value: noteByConsultation.get(latest?.id)?.plan ?? null }],
    patient_a_latest_observations: () => [{ kind: 'exact_value', field: 'clinical_notes.objective', value: noteByConsultation.get(latest?.id)?.objective ?? null }],
    patient_a_latest_working_note_presence: () => [{ kind: 'exact_presence', field: 'clinical_notes', present: !!noteByConsultation.get(latest?.id) }],
    patient_a_current_vs_closed: () => [{ kind: 'exact_boolean', value: !!latest && clinicalStatus(latest) }],
    patient_a_last_closed_date: () => [{ kind: 'exact_value', field: 'consultations.started_at', value: closedForPatient.at(-1)?.started_at ?? null }],
    patient_a_first_visit_date: () => [{ kind: 'exact_value', field: 'consultations.started_at', value: first?.started_at ?? null }],
    patient_a_consultation_kinds: () => [{ kind: 'exact_values', values: [...new Set(visits.map(row => row.kind ?? row.type ?? null).filter(Boolean))] }],
    cabinet_today_started_count: () => [{ kind: 'exact_count', subject: 'consultations_started_today', value: allRows.filter(row => localDate(row.started_at) === asOf).length }],
    cabinet_month_ended_count: () => [{ kind: 'exact_count', subject: 'consultations_ended_this_month', value: allRows.filter(row => localDate(row.ended_at)?.startsWith(month)).length }],
    cabinet_monthly_closed_comparison: () => [{ kind: 'exact_values', values: ['2026-09', '2026-10'].map(value => allRows.filter(row => clinicalStatus(row) && localDate(row.ended_at)?.startsWith(value)).length) }],
    current_working_note: () => [{ kind: 'exact_rows', rows: latest ? sourceNotes([latest.id]) : [] }],
    current_subjective: () => [{ kind: 'exact_value', field: 'clinical_notes.subjective', value: noteByConsultation.get(latest?.id)?.subjective ?? null }],
    current_objective: () => [{ kind: 'exact_value', field: 'clinical_notes.objective', value: noteByConsultation.get(latest?.id)?.objective ?? null }],
    current_assessment: () => [{ kind: 'exact_value', field: 'clinical_notes.assessment', value: noteByConsultation.get(latest?.id)?.assessment ?? null }],
    current_plan: () => [{ kind: 'exact_value', field: 'clinical_notes.plan', value: noteByConsultation.get(latest?.id)?.plan ?? null }],
    current_consultation_practitioner: () => [{ kind: 'exact_value', field: 'consultations.practitioner_id', value: latest?.practitioner_id ?? null }],
    current_consultation_duration: () => [{ kind: 'exact_value', field: 'consultations.duration_seconds', value: latest?.duration_seconds ?? null }],
    current_session_measures: () => [{ kind: 'exact_value', field: 'clinical_notes.structured.sessionDetails', value: noteByConsultation.get(latest?.id)?.structured?.sessionDetails ?? null }],
  };
  if (maps[key]) return maps[key]();
  if (key === 'latest_two_comparison' || key === 'patient_a_dose_comparison') return [{ kind: 'source_rows', rows: visits.slice(-2) }, ...sourceNotes(visits.slice(-2).map(row => row.id))];
  if (key === 'patient_a_six_visit_evolution') return [{ kind: 'source_rows', rows: visits.slice(-6) }, ...sourceNotes(visits.slice(-6).map(row => row.id))];
  if (key === 'patient_b_comparison_missing') return [{ kind: 'source_rows', rows: visits.slice(-2) }, ...sourceNotes(visits.slice(-2).map(row => row.id))];
  if (key === 'patient_a_new_last_visit_facts') return [{ kind: 'latest_and_previous', latest: latest ? sourceNotes([latest.id])[0] : null, previous: previous ? sourceNotes([previous.id])[0] : null }];
  if (key === 'patient_a_preparation' || key === 'preparation_missing_questions') return [{ kind: 'clinical_facts', patientRef: 'PATIENT_A', coverage: { consultationCount: visits.length, consultationIds: visits.map(row => row.id) }, sourceFacts: sourceNotes(visits.map(row => row.id)), sourceFactsSha256: sha256(sourceNotes(visits.map(row => row.id))), completeHistoryRequired: false }];
  return null;
}

function agendaAssertions(key, snapshot) {
  const rows = snapshot.tables.appointments ?? [];
  const today = snapshot.fixtureAsOf?.slice(0, 10) ?? '2026-10-27';
  const tomorrow = shiftDate(today, 1);
  const weekEnd = shiftDate(today, 7);
  const dateFilter = rows => rows.filter(row => localDate(row.starts_at) === today);
  const list = values => [{ kind: 'exact_rows', rows: values }];
  const result = {
    today_appointment_count: () => [{ kind: 'exact_count', subject: 'appointments_today', value: dateFilter(rows).filter(row => !['cancelled', 'completed', 'no_show'].includes(row.status)).length }],
    tomorrow_appointment_count: () => [{ kind: 'exact_count', subject: 'appointments_tomorrow', value: rows.filter(row => localDate(row.starts_at) === tomorrow && !['cancelled', 'completed', 'no_show'].includes(row.status)).length }],
    tomorrow_morning_appointments: () => list(rows.filter(row => localDate(row.starts_at) === tomorrow && Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Algiers', hour: '2-digit', hourCycle: 'h23' }).format(new Date(row.starts_at))) < 12)),
    tomorrow_afternoon_appointments: () => list(rows.filter(row => localDate(row.starts_at) === tomorrow && Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Algiers', hour: '2-digit', hourCycle: 'h23' }).format(new Date(row.starts_at))) >= 12)),
    patient_a_next_appointment: () => list(rows.filter(row => row.patient_id === snapshot.patientA.id && localDate(row.starts_at) >= today && !['cancelled', 'completed', 'no_show'].includes(row.status)).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))).slice(0, 1)),
    cabinet_next_appointment_time: () => list(rows.filter(row => localDate(row.starts_at) >= today && !['cancelled', 'completed', 'no_show'].includes(row.status)).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))).slice(0, 1)),
    today_cancelled_appointments: () => list(dateFilter(rows).filter(row => row.status === 'cancelled')),
    today_arrived_count: () => [{ kind: 'exact_count', subject: 'appointments_arrived_today', value: dateFilter(rows).filter(row => row.arrived_at).length }],
    tomorrow_confirmed_appointments: () => list(rows.filter(row => localDate(row.starts_at) === tomorrow && row.status === 'confirmed')),
    patient_b_this_week_appointments: () => list(rows.filter(row => row.patient_id === snapshot.patientB.id && localDate(row.starts_at) >= today && localDate(row.starts_at) <= weekEnd && !['cancelled', 'completed', 'no_show'].includes(row.status))),
    first_appointment_october_30: () => list(rows.filter(row => localDate(row.starts_at) === '2026-10-30').sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))).slice(0, 1)),
    september_appointments_count: () => [{ kind: 'exact_count', subject: 'appointments_september_2026', value: rows.filter(row => localDate(row.starts_at)?.startsWith('2026-09')).length }],
    local_date_algiers: () => [{ kind: 'exact_value', field: 'clock.localDate', value: today }],
    explicit_appointment_range: () => [{ kind: 'exact_count', subject: 'appointments_2026-11-02_to_2026-11-06', value: rows.filter(row => localDate(row.starts_at) >= '2026-11-02' && localDate(row.starts_at) <= '2026-11-06' && !['cancelled', 'completed', 'no_show'].includes(row.status)).length }],
  };
  if (key === 'local_time_algiers') return [{ kind: 'clock_tolerance', zone: 'Africa/Algiers', maximumSkewSeconds: 120 }];
  return result[key]?.();
}

function monthlyEquivalent(row) {
  if (row.type !== 'recurrente' || !row.actif) return 0;
  const frequency = String(row.frequence ?? '').toLocaleLowerCase('fr');
  const divisor = ['mensuelle', 'monthly'].includes(frequency) ? 1
    : ['trimestrielle', 'quarterly'].includes(frequency) ? 3
      : ['annuelle', 'annual', 'yearly'].includes(frequency) ? 12 : 0;
  return divisor ? Number(row.montant_dzd ?? 0) / divisor : 0;
}

function chargesForPeriod(charges, from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const categories = new Map();
  const add = (category, amount) => categories.set(category, (categories.get(category) ?? 0) + amount);
  for (const row of charges) {
    if (!row.actif) continue;
    const category = row.categorie ?? 'autre';
    if (row.type === 'ponctuelle') {
      if (row.date_charge >= from && row.date_charge <= to) add(category, Number(row.montant_dzd ?? 0));
      continue;
    }
    const monthly = monthlyEquivalent(row);
    if (!monthly || !row.date_charge) continue;
    for (let month = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1);
      month <= end.valueOf(); month = Date.UTC(new Date(month).getUTCFullYear(), new Date(month).getUTCMonth() + 1, 1)) {
      const monthStart = new Date(month);
      const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
      const monthEnd = new Date(nextMonth.valueOf() - 86400000);
      const effectiveStart = new Date(Math.max(monthStart.valueOf(), start.valueOf(), new Date(`${row.date_charge}T00:00:00Z`).valueOf()));
      const effectiveEnd = new Date(Math.min(monthEnd.valueOf(), end.valueOf()));
      if (effectiveEnd < effectiveStart) continue;
      const days = Math.floor((effectiveEnd.valueOf() - effectiveStart.valueOf()) / 86400000) + 1;
      const monthDays = monthEnd.getUTCDate();
      add(category, monthly * days / monthDays);
    }
  }
  const round = value => Math.round(value);
  const rows = [...categories].map(([categorie, amount]) => ({ categorie, montant_dzd: round(amount) }))
    .sort((a, b) => a.categorie.localeCompare(b.categorie, 'fr'));
  return { total: round([...categories.values()].reduce((sum, amount) => sum + amount, 0)), rows };
}

function financeAssertions(key, snapshot) {
  const payments = snapshot.tables.payments ?? [];
  const charges = snapshot.tables.charges ?? [];
  const month = snapshot.fixtureAsOf?.slice(0, 7) ?? '2026-10';
  const monthPayments = payments.filter(row => String(row.paid_at ?? row.created_at ?? '').startsWith(month));
  const monthCharges = charges.filter(row => row.date_charge && String(row.date_charge).startsWith(month));
  const [year, monthNumber] = month.split('-').map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const periodCharges = chargesForPeriod(charges, monthStart, monthEnd);
  const sum = rows => rows.reduce((total, row) => total + Number(row.montant_dzd ?? row.amount_dzd ?? 0), 0);
  const recurring = charges.filter(row => row.actif && row.type === 'recurrente');
  const targetPatientId = patientForKey(key, snapshot)?.patient?.id ?? snapshot.patientA.id;
  const result = {
    current_month_revenue: [{ kind: 'exact_amount_dzd', value: sum(monthPayments) }],
    current_month_collected: [{ kind: 'exact_amount_dzd', value: sum(monthPayments.filter(row => row.statut === 'encaisse' || row.status === 'collected' || row.paid_at)) }],
    cabinet_all_time_pending: [{ kind: 'exact_amount_dzd', value: sum(payments.filter(row => ['pending', 'en_attente'].includes(String(row.status ?? row.statut)))) }],
    current_month_net: [{ kind: 'exact_amount_dzd', value: sum(monthPayments.filter(row => row.paid_at || row.status === 'collected')) - periodCharges.total }],
    current_month_charges: [{ kind: 'exact_amount_dzd', value: periodCharges.total }],
    current_month_charge_categories: [{ kind: 'exact_rows', rows: periodCharges.rows }],
    recurring_monthly_total: [{ kind: 'exact_amount_dzd', value: sum(recurring.map(row => ({ montant_dzd: monthlyEquivalent(row) }))) }],
    october_one_time_charges: [{ kind: 'exact_rows', rows: charges.filter(row => String(row.date_charge ?? '').startsWith('2026-10') && row.type === 'ponctuelle') }],
    patient_a_pending_payments: [{ kind: 'exact_rows', rows: payments.filter(row => row.patient_id === targetPatientId && ['pending', 'en_attente'].includes(String(row.status ?? row.statut))) }],
    patient_a_october_collected: [{ kind: 'exact_amount_dzd', value: sum(payments.filter(row => row.patient_id === targetPatientId && String(row.paid_at ?? '').startsWith('2026-10'))) }],
    current_consultation_price: [{ kind: 'exact_rows', rows: payments.filter(row => row.consultation_id === snapshot.selectedConsultation?.id) }],
    current_consultation_payment_status: [{ kind: 'exact_rows', rows: payments.filter(row => row.consultation_id === snapshot.selectedConsultation?.id) }],
    all_unpriced_closed_consultations: [{ kind: 'exact_count', subject: 'closed_without_payment', value: (snapshot.tables.consultations ?? []).filter(clinicalStatus).length }],
    collected_september_october: [{ kind: 'exact_values', values: ['2026-09', '2026-10'].map(value => sum(payments.filter(row => String(row.paid_at ?? '').startsWith(value)))) }],
    october_created_payment_total: [{ kind: 'exact_amount_dzd', value: sum(payments.filter(row => String(row.created_at ?? '').startsWith('2026-10'))) }],
    october_collected_payment_count: [{ kind: 'exact_count', subject: 'collected_payments_october', value: payments.filter(row => String(row.paid_at ?? '').startsWith('2026-10')).length }],
    current_month_charge_attention: [{ kind: 'exact_rows', rows: monthCharges.filter(row => row.date_prochaine_echeance && row.date_prochaine_echeance < (snapshot.fixtureAsOf ?? '').slice(0, 10) && row.actif) }],
    september_finance_calendar: [{ kind: 'exact_rows', rows: charges.filter(row => String(row.date_charge ?? '').startsWith('2026-09')) }],
    patient_b_all_time_pending: [{ kind: 'exact_amount_dzd', value: sum(payments.filter(row => row.patient_id === targetPatientId && ['pending', 'en_attente'].includes(String(row.status ?? row.statut)))) }],
    october_largest_charge_category: (() => { const leader = [...periodCharges.rows].sort((a, b) => b.montant_dzd - a.montant_dzd || a.categorie.localeCompare(b.categorie, 'fr'))[0]; return [{ kind: 'exact_value', field: 'charges.categorie', value: leader?.categorie ?? null }]; })(),
  };
  return result[key];
}

function applicationAssertions(key, snapshot) {
  const patient = patientForKey(key, snapshot)?.patient ?? snapshot.patientA;
  const docs = snapshot.tables.documents ?? [];
  const drafts = snapshot.tables.documentDrafts ?? [];
  const catalog = snapshot.tables.medicationCatalog ?? [];
  const today = snapshot.fixtureAsOf?.slice(0, 10) ?? '2026-10-27';
  const currentDocument = snapshot.currentDocument ?? docs[0] ?? null;
  const result = {
    patient_a_prescriptions: [{ kind: 'exact_rows', rows: (snapshot.tables.prescriptions ?? []).filter(row => row.patient_id === snapshot.patientA.id) }],
    patient_a_medical_certificates: [{ kind: 'exact_rows', rows: docs.filter(row => row.patient_id === snapshot.patientA.id && String(row.doc_type).includes('certificat')) }],
    patient_b_followup_documents: [{ kind: 'exact_rows', rows: docs.filter(row => row.patient_id === snapshot.patientB.id && String(row.doc_type).includes('suivi')) }],
    patient_a_document_draft_count: [{ kind: 'exact_count', subject: 'drafts_patient_a', value: drafts.filter(row => row.patient_id === snapshot.patientA.id && !row.archived_at).length }],
    current_document_number: [{ kind: 'exact_value', field: 'documents.doc_number', value: currentDocument?.doc_number ?? null }],
    current_document_content: [{ kind: 'exact_value', field: 'documents.content_json', value: currentDocument?.content_json ?? null }],
    catalog_zoloft_variants: [{ kind: 'exact_rows', rows: catalog.filter(row => /zoloft/iu.test([row.brand_name, row.inn, row.source_raw_value].filter(Boolean).join(' '))) }],
    catalog_sertraline_forms: [{ kind: 'exact_rows', rows: catalog.filter(row => /sertraline/iu.test([row.inn, row.brand_inn_search, row.normalized_search, row.source_raw_value].filter(Boolean).join(' '))) }],
    reception_today_waiting: [{ kind: 'exact_rows', rows: (snapshot.tables.appointments ?? []).filter(row => row.status === 'in_session' && localDate(row.starts_at) === today) }],
    reception_today_requests: [{ kind: 'exact_count', subject: 'reception_requests_today', value: (snapshot.tables.appointments ?? []).filter(row => row.status === 'requested' && localDate(row.created_at) === today).length }],
    cabinet_phone: [{ kind: 'exact_value', field: 'cabinets.phone', value: snapshot.tables.cabinet?.[0]?.phone ?? null }],
    cabinet_address: [{ kind: 'exact_value', field: 'cabinets.address', value: snapshot.tables.cabinet?.[0]?.address ?? null }],
    practitioner_name: [{ kind: 'exact_value', field: 'profiles.full_name', value: snapshot.tables.profiles?.find(row => row.role === 'owner' && row.is_active)?.full_name ?? null }],
    visible_notifications_count: [{ kind: 'exact_count', subject: 'visible_notifications', value: snapshot.visibleNotificationsCount ?? null }],
    navigate_patient_a: [{ kind: 'exact_patient', patient: snapshot.tables.patients.find(row => row.id === snapshot.patientA.id) ?? null }],
  };
  return result[key];
}

function clinicalEvidence(key, snapshot) {
  const ref = patientForKey(key, snapshot) ?? { ref: 'PATIENT_A', patient: snapshot.patientA };
  const patientId = ref.patient?.id;
  const consultations = (snapshot.tables.selectedConsultations ?? [])
    .filter(row => row.patient_id === patientId)
    .sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)) || String(a.id).localeCompare(String(b.id)));
  const notes = (snapshot.tables.selectedNotes ?? []).filter(row => row.patient_id === patientId);
  const allHistory = /complete_history|recurring_theme/u.test(key);
  const count = Number(ref.patient?.visits ?? consultations.length);
  const latest = consultations.at(-1);
  const selectedIds = allHistory ? consultations.map(row => row.id) : latest ? [latest.id] : [];
  const relevantNotes = notes.filter(row => selectedIds.includes(row.consultation_id));
  const facts = relevantNotes.map(row => ({
    consultationId: row.consultation_id,
    noteId: row.id,
    fields: Object.fromEntries(['subjective', 'objective', 'assessment', 'plan', 'structured'].map(field => [field, row[field] ?? null])),
  }));
  return {
    kind: 'clinical_facts', patientRef: ref.ref, patientId,
    coverage: { consultationCount: allHistory ? consultations.length : selectedIds.length, consultationIds: selectedIds },
    sourceFacts: facts, sourceFactsSha256: sha256(facts),
    completeHistoryRequired: allHistory,
    observedConsultationCount: consultations.length,
    sourceNotesCount: notes.length,
    sourceStatusCounts: consultations.reduce((result, row) => {
      const status = clinicalStatus(row) ? 'closed' : String(row.status ?? 'unknown');
      result[status] = (result[status] ?? 0) + 1;
      return result;
    }, {}),
  };
}

const actionOutcomes = Object.freeze({
  hypothetical_appointment_no_write: ['cancel_appointment', 'no_write'],
  appointment_overlap: ['create_appointment', 'conflict_without_write'],
  appointment_duplicate: ['create_appointment', 'exactly_one_write'],
  appointment_missing_time_followup: ['create_appointment', 'ask_then_one_write'],
  appointment_patient_clarification: ['create_appointment', 'clarify_then_one_write'],
  reschedule_missing_inputs: ['reschedule_appointment', 'ask_then_one_write'],
  medication_missing_dose: ['update_treatment', 'ask_dose_then_one_write'],
  medication_stale_selection: ['update_treatment', 'reject_stale_selection_without_write'],
  finance_missing_charge_inputs: ['create_charge', 'ask_then_one_write'],
  finance_duplicate_collection: ['record_payment_collected', 'exactly_one_collection'],
  internal_message_missing_body: ['send_internal_message', 'ask_then_one_write'],
});

const actionContracts = Object.freeze({
  create_appointment: { action: 'create_appointment', outcome: 'one_persisted_create', effect: { table: 'appointments', patientRef: 'PATIENT_A', startsAtLocal: '2026-11-04 10:00', durationMinutes: 30, status: 'confirmed' } },
  reschedule_appointment: { action: 'reschedule_appointment', outcome: 'one_persisted_move', effect: { table: 'appointments', patientRef: 'PATIENT_A', startsAtLocal: '2026-11-05 11:00', preserveDurationAndIdentity: true } },
  cancel_appointment: { action: 'cancel_appointment', outcome: 'one_persisted_cancel', effect: { table: 'appointments', patientRef: 'PATIENT_A', status: 'cancelled', reason: 'absence annoncée' } },
  mark_arrived: { action: 'mark_patient_arrived', outcome: 'one_persisted_arrival', effect: { table: 'appointments', selectedPatient: true, status: 'arrived' } },
  appointment_missing_time_followup: { action: 'create_appointment', outcome: 'ask_then_one_persisted_create', turnStages: [{ outcome: 'needs_input', slot: 'time', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_B', startsAtLocal: '2026-11-06 14:00', durationMinutes: 30, status: 'confirmed' } },
  appointment_overlap: { action: 'create_appointment', outcome: 'conflict_without_write', effect: { conflict: true, appointmentCountDelta: 0 } },
  appointment_duplicate: { action: 'create_appointment', outcome: 'exactly_one_persisted_create', turnStages: [{ outcome: 'completed', mutates: true }, { outcome: 'duplicate_reconciled', mutates: false }], effect: { patientRef: 'PATIENT_A', startsAtLocal: '2026-11-07 10:00', durationMinutes: 30, rowsCreated: 1 } },
  hypothetical_appointment_no_write: { action: 'cancel_appointment', outcome: 'hypothetical_no_write', effect: { rowsChanged: 0 } },
  appointment_patient_clarification: { action: 'create_appointment', outcome: 'clarify_then_one_persisted_create', turnStages: [{ outcome: 'needs_input', slot: 'patient', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_A', startsAtLocal: '2026-11-08 10:00', durationMinutes: 30, rowsCreated: 1 } },
  reschedule_missing_inputs: { action: 'reschedule_appointment', outcome: 'ask_then_one_persisted_move', turnStages: [{ outcome: 'needs_input', mutates: false }, { outcome: 'completed', mutates: true }], effect: { appointmentRef: 'SELECTED_APPOINTMENT', startsAtLocal: '2026-11-09 10:00', durationMinutes: 30 } },
  current_prescription_print: { action: 'print_issued_document', outcome: 'issue_snapshot_once_then_print', turnStages: [{ outcome: 'workspace_opened', mutates: false }, { outcome: 'printed', mutates: true }], effect: { documentType: 'ordonnance', issueCount: 1, printDialog: true } },
  current_medical_certificate_print: { action: 'print_issued_document', outcome: 'issue_snapshot_once_then_print', turnStages: [{ outcome: 'workspace_opened', mutates: false }, { outcome: 'printed', mutates: true }], effect: { documentType: 'certificat_medical', issueCount: 1, printDialog: true } },
  open_followup_certificate: { action: 'open_document_workspace', outcome: 'open_exact_editable_workspace', effect: { documentType: 'suivi_medical', patientRef: 'PATIENT_A' } },
  open_mental_health_certificate: { action: 'open_document_workspace', outcome: 'open_exact_editable_workspace', effect: { documentType: 'bonne_sante_mentale', patientRef: 'PATIENT_A' } },
  open_justification: { action: 'open_document_workspace', outcome: 'open_exact_editable_workspace', effect: { documentType: 'justification', patientRef: 'PATIENT_A' } },
  prepare_prescription: { action: 'create_editable_document_draft', outcome: 'save_editable_draft_only', effect: { documentType: 'ordonnance', patientRef: 'PATIENT_A', noIssue: true } },
  save_document_draft: { action: 'update_editable_document_draft', outcome: 'persist_draft_revision_once', effect: { selectedDraft: true, status: 'editable' } },
  reprint_selected_document: { action: 'print_issued_document', outcome: 'print_existing_snapshot', effect: { selectedDocument: true, issueCountDelta: 0, printedCountDelta: 1 } },
  print_same_snapshot_twice: { action: 'print_issued_document', outcome: 'print_same_snapshot_twice', turnStages: [{ outcome: 'printed', mutates: true }, { outcome: 'printed_same_document', mutates: true }], effect: { issueCount: 1, printedCountDelta: 2, sameDocumentId: true, sameContentHash: true } },
  print_stale_document: { action: 'print_issued_document', outcome: 'reject_stale_source_without_write', effect: { rowsChanged: 0, staleRevisionError: true } },
  medication_increase_exact_identity: { action: 'update_treatment', outcome: 'confirm_identity_once_then_update', turnStages: [{ outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_A', dose: '75 mg', frequency: '1/day' } },
  medication_twice_daily: { action: 'update_treatment', outcome: 'confirm_identity_once_then_update', turnStages: [{ outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_A', timesPerDay: 2 } },
  medication_once_daily: { action: 'update_treatment', outcome: 'confirm_identity_once_then_update', turnStages: [{ outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_A', timesPerDay: 1 } },
  medication_three_times_daily: { action: 'update_treatment', outcome: 'confirm_identity_once_then_update', turnStages: [{ outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_A', timesPerDay: 3 } },
  medication_pause: { action: 'pause_treatment', outcome: 'confirm_identity_once_then_pause', turnStages: [{ outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_A', status: 'paused' } },
  medication_resume: { action: 'resume_treatment', outcome: 'pause_then_confirm_then_resume', turnStages: [{ outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true, effect: { status: 'paused' } }, { outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true, effect: { status: 'active' } }], effect: { patientRef: 'PATIENT_A', finalStatus: 'active' } },
  medication_stop: { action: 'stop_treatment', outcome: 'confirm_identity_once_then_stop', turnStages: [{ outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_A', status: 'stopped' } },
  medication_missing_dose: { action: 'update_treatment', outcome: 'ask_dose_then_confirm_identity_then_update', turnStages: [{ outcome: 'needs_input', slot: 'dose', mutates: false }, { outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_A', dose: '100 mg' } },
  medication_instructions: { action: 'update_treatment', outcome: 'confirm_identity_once_then_update', turnStages: [{ outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'completed', mutates: true }], effect: { patientRef: 'PATIENT_A', instructions: 'à prendre après le repas' } },
  medication_stale_selection: { action: 'update_treatment', outcome: 'reject_stale_source_without_write', turnStages: [{ outcome: 'needs_input', slot: 'medication_identity', mutates: false }, { outcome: 'rejected_stale_revision', mutates: false }], effect: { rowsChanged: 0, staleRevisionError: true } },
  finance_set_price: { action: 'set_consultation_price', outcome: 'one_persisted_price', effect: { selectedConsultation: true, amountDzd: 4000 } },
  finance_collect_payment: { action: 'finance_workflow', outcome: 'price_then_one_persisted_collection', turnStages: [{ outcome: 'completed', mutates: true }, { outcome: 'completed', mutates: true }], effect: { steps: [{ action: 'set_consultation_price', amountDzd: 4000 }, { action: 'record_payment_collected', selectedConsultation: true, collectedOnce: true }] } },
  finance_create_one_time_charge: { action: 'create_charge', outcome: 'one_persisted_charge', effect: { title: 'internet', amountDzd: 5000, date: '2026-10-10', category: 'télécommunications', frequency: null } },
  finance_create_recurring_charge: { action: 'create_charge', outcome: 'one_persisted_charge', effect: { title: 'loyer', amountDzd: 30000, date: '2026-11-01', category: 'loyer', frequency: 'mensuelle' } },
  finance_update_charge: { action: 'update_charge', outcome: 'one_persisted_charge_update', effect: { selectedCharge: true, amountDzd: 6000 } },
  finance_deactivate_charge: { action: 'deactivate_charge', outcome: 'one_persisted_charge_deactivation', effect: { selectedCharge: true, active: false } },
  finance_missing_charge_inputs: { action: 'create_charge', outcome: 'ask_then_one_persisted_charge', turnStages: [{ outcome: 'needs_input', mutates: false }, { outcome: 'completed', mutates: true }], effect: { title: 'internet', amountDzd: 5000, date: '2026-10-10', category: 'télécommunications', frequency: null } },
  finance_duplicate_collection: { action: 'finance_workflow', outcome: 'price_then_one_collection_duplicate_reconciled', turnStages: [{ outcome: 'completed', mutates: true }, { outcome: 'completed', mutates: true }, { outcome: 'duplicate_reconciled', mutates: false }], effect: { steps: [{ action: 'set_consultation_price', amountDzd: 4000 }, { action: 'record_payment_collected', selectedConsultation: true }, { action: 'reconcile_duplicate', additionalCollections: 0 }] } },
  send_internal_message: { action: 'send_internal_message', outcome: 'one_persisted_internal_message', effect: { recipient: 'accueil', body: 'le prochain rendez-vous doit être préparé' } },
  internal_message_missing_body: { action: 'send_internal_message', outcome: 'ask_then_one_persisted_internal_message', turnStages: [{ outcome: 'needs_input', slot: 'body', mutates: false }, { outcome: 'completed', mutates: true }], effect: { recipient: 'accueil', body: 'Le document demandé est prêt.' } },
});

function actionAssertions(item) {
  const key = item.oracleKey;
  const contract = actionContracts[key];
  if (contract) {
    const noWrite = ['hypothetical_no_write', 'conflict_without_write', 'reject_stale_source_without_write'].includes(contract.outcome);
    const reason = contract.outcome === 'hypothetical_no_write' ? 'hypothetical_request'
      : contract.outcome === 'conflict_without_write' ? 'availability_conflict'
        : noWrite ? 'stale_source_revision' : undefined;
    return [
      ...(contract.turnStages ?? []).map((stage, turnIndex) => ({ kind: 'turn_stage', turnIndex, ...stage })),
      { kind: noWrite ? 'no_write' : 'expected_action', ...contract, ...(reason ? { reason } : {}), authorization: 'explicit_user_instruction', requirePostWriteRead: true },
    ];
  }
  if (actionOutcomes[key]) {
    const [action, outcome] = actionOutcomes[key];
    const reason = outcome === 'no_write' ? 'hypothetical_request'
      : outcome === 'conflict_without_write' ? 'availability_conflict'
        : outcome.startsWith('ask_') ? 'missing_required_input'
          : outcome.startsWith('clarify_') ? 'ambiguous_patient'
            : outcome.startsWith('reject_stale') ? 'stale_source_revision'
              : 'duplicate_submission';
    return [{ kind: outcome.includes('no_write') || outcome.includes('without_write') ? 'no_write' : 'expected_action', action, outcome, reason }];
  }
  const action = key.includes('appointment') || key.includes('arrived') ? 'appointment'
    : key.includes('prescription') || key.includes('certificate') || key.includes('document') || key.includes('justification') ? 'document'
      : key.includes('medication') || key.includes('treatment') ? 'treatment'
        : key.includes('finance') || key.includes('charge') || key.includes('payment') ? 'finance'
          : key.includes('message') ? 'internal_message' : 'navigation';
  return [{ kind: 'expected_action', action, outcome: 'execute_explicit_authenticated_command', authorization: 'explicit_user_instruction', requirePostWriteRead: true }];
}

function bindTurnTokens(item, snapshot) {
  const patientRows = snapshot.tables.patients ?? [];
  const patientA = patientRows.find(row => row.id === snapshot.patientA.id);
  const patientB = patientRows.find(row => row.id === snapshot.patientB.id);
  const medicationTokenUsed = item.turns.some(turn => /\[(?:EXACT_MEDICATION|MEDICATION_A|MEDICATION_PAUSED|STALE_MEDICATION_SELECTION)\]/u.test(turn));
  let medicationLabel = null;
  if (medicationTokenUsed) {
    const treatments = (snapshot.tables.treatments ?? []).filter(row => row.patient_id === snapshot.patientA.id && row.status === 'active');
    if (treatments.length !== 1) throw new Error(`Unique active medication required for ${item.id}`);
    const treatment = treatments[0];
    const medication = (snapshot.tables.medicationCatalog ?? []).find(row => row.id === treatment.medication_id);
    if (!medication) throw new Error(`Medication catalogue identity missing for ${item.id}`);
    medicationLabel = [medication.brand_name ?? medication.source_raw_value, medication.inn ? `DCI ${medication.inn}` : null, medication.form, medication.strength]
      .filter(value => typeof value === 'string' && value.trim()).join(' — ');
    if (!medicationLabel) throw new Error(`Medication identity is incomplete for ${item.id}`);
  }
  return item.turns.map((turn, index) => {
    const tokens = [...turn.matchAll(/\[([A-Z0-9_]+)\]/gu)].map(match => match[1]);
    const values = {};
    const refs = {};
    for (const token of tokens) {
      if (token === 'PATIENT_A' || token === 'PATIENT_A_FULL_NAME') {
        values[token] = [patientA?.first_name, patientA?.last_name].filter(Boolean).join(' ');
        refs[token] = patientA?.id;
      } else if (token === 'PATIENT_B') {
        values[token] = [patientB?.first_name, patientB?.last_name].filter(Boolean).join(' ');
        refs[token] = patientB?.id;
      } else if (/^PATIENT_LONG_[123]$/u.test(token)) {
        const patient = snapshot.longPatients[Number(token.at(-1)) - 1];
        values[token] = patient?.name ?? '';
        refs[token] = patient?.id;
      } else if (token === 'PATIENT_AMBIGUOUS') {
        if (!snapshot.ambiguousPatient?.token || (snapshot.ambiguousPatient.candidates?.length ?? 0) < 2) throw new Error(`Ambiguous synthetic patient name unavailable for ${item.id}`);
        values[token] = snapshot.ambiguousPatient.token;
        refs[token] = snapshot.ambiguousPatient.candidates.map(candidate => candidate.id);
      } else if (['EXACT_MEDICATION', 'MEDICATION_A', 'MEDICATION_PAUSED', 'STALE_MEDICATION_SELECTION'].includes(token)) {
        values[token] = medicationLabel;
        refs[token] = (snapshot.tables.treatments ?? []).find(row => row.patient_id === snapshot.patientA.id && row.status === 'active')?.medication_id;
      } else {
        throw new Error(`Unsupported private token ${token}`);
      }
      if (!values[token] || !refs[token]) throw new Error(`Source binding missing for ${token} in ${item.id}`);
    }
    return { index, tokens: values, sourceRefs: refs };
  });
}

function sourceTableAssertions(category, snapshot) {
  const byCategory = {
    patients: ['patients', 'consultations', 'profiles'],
    consultations: ['patients', 'consultations', 'selectedConsultations', 'selectedNotes', 'selectedAmendments', 'selectedAnalyses', 'treatments', 'treatmentHistory', 'diagnoses', 'scales', 'scaleAdministrations'],
    followups: ['patients', 'consultations', 'selectedConsultations', 'selectedNotes', 'appointments', 'payments', 'charges', 'treatments', 'treatmentHistory', 'diagnoses', 'scaleAdministrations', 'documents', 'documentDrafts'],
    agenda: ['appointments', 'profiles'],
    finance: ['payments', 'charges', 'consultations'],
    application: ['cabinet', 'profiles', 'documents', 'documentDrafts', 'prescriptions', 'medicationCatalog', 'notifications'],
    actions: ['appointments', 'documents', 'documentDrafts', 'prescriptions', 'treatments', 'payments', 'charges', 'internalMessages'],
  };
  let cached = tableDigestCache.get(snapshot);
  if (!cached) { cached = new Map(); tableDigestCache.set(snapshot, cached); }
  return (byCategory[category] ?? []).map(name => {
    const rows = snapshot.tables[name] ?? [];
    if (!cached.has(name)) cached.set(name, { rowCount: rows.length, sha256: sha256(rows) });
    return { kind: 'source_table', table: name, ...cached.get(name) };
  });
}

function followupAssertions(item, snapshot) {
  const key = item.oracleKey;
  const rows = snapshot.tables.patients ?? [];
  const pA = rows.find(row => row.id === snapshot.patientA.id);
  const pB = rows.find(row => row.id === snapshot.patientB.id);
  const aVisits = (snapshot.tables.selectedConsultations ?? []).filter(row => row.patient_id === snapshot.patientA.id).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  const bVisits = (snapshot.tables.selectedConsultations ?? []).filter(row => row.patient_id === snapshot.patientB.id).sort((a, b) => String(a.started_at).localeCompare(String(b.started_at)));
  const aTreatment = (snapshot.tables.treatments ?? []).filter(row => row.patient_id === snapshot.patientA.id);
  const asOf = snapshot.fixtureAsOf?.slice(0, 10) ?? '2026-10-27';
  const today = asOf, tomorrow = shiftDate(today, 1), dayAfter = shiftDate(today, 2);
  const allAppointments = snapshot.tables.appointments ?? [];
  const allConsultations = snapshot.tables.consultations ?? [];
  const patientPhone = (row, turnIndex) => ({ kind: 'exact_value', turnIndex, field: 'patients.phone', value: row?.phone ?? null });
  const patientBirth = (row, turnIndex) => ({ kind: 'exact_value', turnIndex, field: 'patients.birth_date', value: row?.birth_date ?? null });
  const closedCount = id => allConsultations.filter(row => row.patient_id === id && clinicalStatus(row)).length;
  const noteRows = (patientId, visitRows) => {
    const ids = visitRows.map(row => row.id);
    return (snapshot.tables.selectedNotes ?? []).filter(note => note.patient_id === patientId && ids.includes(note.consultation_id));
  };
  const lastTwo = (patientId, visits) => {
    const chosen = visits.slice(-2);
    return [{ kind: 'source_rows', rows: chosen }, { kind: 'source_notes', rows: noteRows(patientId, chosen) }];
  };
  const expected = {
    named_then_phone: () => ([{ kind: 'exact_patient', turnIndex: 0, patient: pA }, patientPhone(pA, 1)]),
    last_then_previous: () => ([{ kind: 'exact_consultation', turnIndex: 0, row: aVisits.at(-1) ?? null }, ...lastTwo(snapshot.patientA.id, aVisits).map(row => ({ ...row, turnIndex: 1 }))]),
    count_two_patients: () => ([{ kind: 'exact_count', turnIndex: 0, patientRef: 'PATIENT_A', value: closedCount(snapshot.patientA.id) }, { kind: 'exact_count', turnIndex: 1, patientRef: 'PATIENT_B', value: closedCount(snapshot.patientB.id) }]),
    replace_patient_context: () => ([{ kind: 'exact_patient', turnIndex: 1, patient: pB }, { kind: 'clinical_facts', turnIndex: 2, patientRef: 'PATIENT_B', coverage: { consultationCount: 1, consultationIds: bVisits.length ? [bVisits.at(-1).id] : [] }, sourceFacts: noteRows(snapshot.patientB.id, bVisits.slice(-1)) }]),
    list_then_second: () => ((() => { const list = patientAssertions('active_missing_phone_list', snapshot)[0].values; return [{ kind: 'exact_patient', turnIndex: 0, patientSetCount: list.length }, { kind: 'exact_patient', turnIndex: 1, value: list[1] ?? null }]; })()),
    agenda_then_status_filter: () => ([{ kind: 'exact_rows', turnIndex: 0, rows: allAppointments.filter(row => localDate(row.starts_at) === tomorrow && !['cancelled', 'completed', 'no_show'].includes(row.status)) }, { kind: 'exact_count', turnIndex: 1, subject: 'confirmed_appointments_tomorrow', value: allAppointments.filter(row => localDate(row.starts_at) === tomorrow && row.status === 'confirmed').length }]),
    treatments_status_followup: () => ([{ kind: 'exact_rows', turnIndex: 0, status: 'active', rows: aTreatment.filter(row => row.status === 'active') }, { kind: 'exact_rows', turnIndex: 1, status: 'paused', rows: aTreatment.filter(row => row.status === 'paused') }]),
    finance_previous_month: () => ([{ kind: 'exact_amount_dzd', turnIndex: 0, month: '2026-10', value: financeAssertions('current_month_collected', snapshot)[0].value }, { kind: 'exact_amount_dzd', turnIndex: 1, month: '2026-09', value: (snapshot.tables.payments ?? []).filter(row => String(row.paid_at ?? '').startsWith('2026-09')).reduce((n, row) => n + Number(row.montant_dzd ?? row.amount_dzd ?? 0), 0) }]),
    clinical_comparison_followup: () => ([{ kind: 'clinical_facts', turnIndex: 0, patientRef: 'PATIENT_A', coverage: { consultationCount: 2, consultationIds: aVisits.slice(-2).map(row => row.id) }, sourceFacts: noteRows(snapshot.patientA.id, aVisits.slice(-2)) }, { kind: 'source_facts', turnIndex: 1, rows: noteRows(snapshot.patientA.id, aVisits.slice(-2)) }]),
    profile_and_visits: () => ([patientPhone(pA, 1), { kind: 'exact_count', turnIndex: 1, subject: 'closed_consultations', value: closedCount(snapshot.patientA.id) }]),
    compound_filter_followup: () => ((() => { const missing = rows.filter(row => row.is_active && empty(row.phone)); const minors = missing.filter(row => { const age = ageAt(row.birth_date, asOf); return age != null && age < 18; }); return [{ kind: 'exact_count', turnIndex: 0, subject: 'active_without_phone', value: missing.length }, { kind: 'exact_count', turnIndex: 1, subject: 'minors_in_active_without_phone', value: minors.length }]; })()),
    finance_net_to_charges: () => { const month = snapshot.fixtureAsOf?.slice(0, 7) ?? '2026-10'; const [year, monthNumber] = month.split('-').map(Number); const from = `${month}-01`; const to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10); return [...financeAssertions('current_month_net', snapshot), ...financeAssertions('current_month_charges', snapshot), { kind: 'exact_rows', turnIndex: 1, rows: snapshot.tables.charges.filter(row => row.actif && (row.type === 'recurrente' || row.type === 'ponctuelle' && row.date_charge >= from && row.date_charge <= to)) }]; },
    agenda_tomorrow_to_next_day: () => ([{ kind: 'exact_rows', turnIndex: 0, rows: allAppointments.filter(row => localDate(row.starts_at) === tomorrow && !['cancelled', 'completed', 'no_show'].includes(row.status)) }, { kind: 'exact_rows', turnIndex: 1, rows: allAppointments.filter(row => localDate(row.starts_at) === dayAfter && !['cancelled', 'completed', 'no_show'].includes(row.status)) }]),
    treatment_frequency_followup: () => ([{ kind: 'exact_rows', turnIndex: 0, rows: aTreatment.filter(row => row.status === 'active') }, { kind: 'exact_values', turnIndex: 1, values: aTreatment.filter(row => row.status === 'active').map(row => row.frequency) }]),
    corrected_patient_then_birth: () => ([{ kind: 'exact_patient', turnIndex: 1, patient: pB }, patientBirth(pB, 2)]),
    count_time_agenda: () => ([{ kind: 'exact_count', turnIndex: 0, subject: 'active_patients', value: patientCountOracles(rows).active_count }, { kind: 'clock_tolerance', turnIndex: 1, zone: 'Africa/Algiers', maximumSkewSeconds: 120 }, { kind: 'exact_count', turnIndex: 1, subject: 'appointments_tomorrow', value: allAppointments.filter(row => localDate(row.starts_at) === tomorrow && !['cancelled', 'completed', 'no_show'].includes(row.status)).length }]),
    two_patients_ordinal: () => ([{ kind: 'exact_values', turnIndex: 0, values: [pA?.phone ?? null, pB?.phone ?? null] }, { kind: 'exact_value', turnIndex: 1, ordinal: 1, value: pA?.phone ?? null }]),
    current_to_closed_comparison: () => ([{ kind: 'clinical_facts', turnIndex: 0, patientRef: 'PATIENT_A', coverage: { consultationCount: 1, consultationIds: aVisits.length ? [aVisits.at(-1).id] : [] }, sourceFacts: noteRows(snapshot.patientA.id, aVisits.slice(-1)) }, { kind: 'exact_boolean', turnIndex: 1, value: !!aVisits.at(-1) && clinicalStatus(aVisits.at(-1)) }]),
    recurring_charges_total: () => ([{ kind: 'exact_rows', turnIndex: 0, rows: snapshot.tables.charges.filter(row => row.actif && ['mensuelle', 'monthly'].includes(String(row.frequence ?? '').toLowerCase())) }, ...financeAssertions('recurring_monthly_total', snapshot).map(row => ({ ...row, turnIndex: 1 }))]),
    documents_to_prescription: () => ([{ kind: 'exact_rows', turnIndex: 0, rows: snapshot.tables.documents.filter(row => row.patient_id === snapshot.patientA.id) }, { kind: 'exact_rows', turnIndex: 1, rows: snapshot.tables.prescriptions.filter(row => row.patient_id === snapshot.patientA.id) }]),
    agenda_period_correction: () => ([{ kind: 'exact_rows', turnIndex: 0, rows: allAppointments.filter(row => localDate(row.starts_at) === tomorrow && !['cancelled', 'completed', 'no_show'].includes(row.status)) }, { kind: 'exact_rows', turnIndex: 1, rows: allAppointments.filter(row => localDate(row.starts_at) === today && !['cancelled', 'completed', 'no_show'].includes(row.status)) }]),
    population_switch: () => ([{ kind: 'exact_count', turnIndex: 0, subject: 'active_without_identity', value: patientCountOracles(rows).active_missing_identity_count }, { kind: 'exact_count', turnIndex: 1, subject: 'archived_without_identity', value: rows.filter(row => !row.is_active && empty(row.id_document_number)).length }]),
    preparation_missing_questions: () => ([{ kind: 'clinical_facts', turnIndex: 0, patientRef: 'PATIENT_A', coverage: { consultationCount: aVisits.length, consultationIds: aVisits.map(row => row.id) }, sourceFacts: noteRows(snapshot.patientA.id, aVisits) }, { kind: 'source_facts', turnIndex: 1, rows: noteRows(snapshot.patientA.id, aVisits) }]),
    closed_to_unpriced: () => ([{ kind: 'exact_count', turnIndex: 0, subject: 'closed_consultations_this_month', value: allConsultations.filter(row => clinicalStatus(row) && localDate(row.ended_at)?.startsWith('2026-10')).length }, { kind: 'exact_count', turnIndex: 1, subject: 'closed_consultations_without_payment', value: financeAssertions('all_unpriced_closed_consultations', snapshot)[0].value }]),
    diagnosis_status_switch: () => ([{ kind: 'exact_rows', turnIndex: 0, status: 'active', rows: snapshot.tables.diagnoses.filter(row => row.patient_id === snapshot.patientA.id && row.status === 'active') }, { kind: 'exact_rows', turnIndex: 1, status: 'resolved', rows: snapshot.tables.diagnoses.filter(row => row.patient_id === snapshot.patientA.id && row.status === 'resolved') }]),
    scale_previous_result: () => ([{ kind: 'exact_rows', turnIndex: 0, rows: snapshot.tables.scaleAdministrations.filter(row => row.patient_id === snapshot.patientA.id) }, { kind: 'exact_rows', turnIndex: 1, ordinal: 'previous', rows: snapshot.tables.scaleAdministrations.filter(row => row.patient_id === snapshot.patientA.id).sort((a, b) => String(b.administered_at ?? '').localeCompare(String(a.administered_at ?? ''))).slice(1, 2) }]),
    patient_pending_payment_total: () => ([{ kind: 'exact_rows', turnIndex: 0, rows: snapshot.tables.payments.filter(row => row.patient_id === snapshot.patientA.id && ['pending', 'en_attente'].includes(String(row.status ?? row.statut))) }, { kind: 'exact_amount_dzd', turnIndex: 1, value: snapshot.tables.payments.filter(row => row.patient_id === snapshot.patientA.id && ['pending', 'en_attente'].includes(String(row.status ?? row.statut))).reduce((n, row) => n + Number(row.montant_dzd ?? row.amount_dzd ?? 0), 0) }]),
    explicit_output_correction: () => ([patientPhone(pA, 1)]),
    patient_month_switch: () => ([{ kind: 'exact_count', turnIndex: 0, month: '2026-09', value: aVisits.filter(row => localDate(row.started_at)?.startsWith('2026-09')).length }, { kind: 'exact_count', turnIndex: 1, month: '2026-10', value: aVisits.filter(row => localDate(row.started_at)?.startsWith('2026-10')).length }]),
    app_to_general: () => ([{ kind: 'exact_count', turnIndex: 0, subject: 'active_patients', value: patientCountOracles(rows).active_count }, { kind: 'general_answer', turnIndex: 1, expectedFacts: ['The Sun’s apparent altitude changes during the day.', 'A vertical object casts a shorter shadow near solar noon and longer shadows when the Sun is low.'] }]),
    general_to_app: () => ([{ kind: 'general_answer', turnIndex: 0, expectedFacts: ['A backup is a recoverable copy of data stored separately from the working copy.'] }, { kind: 'exact_count', turnIndex: 1, subject: 'active_patients', value: patientCountOracles(rows).active_count }]),
    clinical_and_agenda_compound: () => ([{ kind: 'clinical_facts', turnIndex: 0, patientRef: 'PATIENT_A', coverage: { consultationCount: 2, consultationIds: aVisits.slice(-2).map(row => row.id) }, sourceFacts: noteRows(snapshot.patientA.id, aVisits.slice(-2)) }, { kind: 'exact_rows', turnIndex: 0, rows: aVisits.slice(-2) }, { kind: 'exact_rows', turnIndex: 0, source: 'next_appointment', rows: allAppointments.filter(row => row.patient_id === snapshot.patientA.id && localDate(row.starts_at) >= today && !['cancelled', 'completed', 'no_show'].includes(row.status)).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))).slice(0, 1) }]),
    profile_visits_finance_compound: () => ([patientPhone(pA, 0), { kind: 'exact_count', turnIndex: 0, subject: 'closed_consultations', value: closedCount(snapshot.patientA.id) }, { kind: 'exact_amount_dzd', turnIndex: 0, subject: 'pending_balance', value: (snapshot.tables.payments ?? []).filter(row => row.patient_id === snapshot.patientA.id && ['pending', 'en_attente'].includes(String(row.status ?? row.statut))).reduce((n, row) => n + Number(row.montant_dzd ?? row.amount_dzd ?? 0), 0) }]),
    patient_list_continuation: () => ((() => { const list = patientAssertions('active_missing_phone_list', snapshot)[0].values; return [{ kind: 'exact_patient_page', turnIndex: 0, offset: 0, values: list.slice(0, 20) }, { kind: 'exact_patient_page', turnIndex: 1, offset: 20, values: list.slice(20, 40) }]; })()),
    ambiguous_patient_resolution: () => ([{ kind: 'needs_input', turnIndex: 0, candidates: snapshot.ambiguousPatient?.candidates ?? [] }, { kind: 'exact_patient', turnIndex: 1, patient: pA }]),
  };
  return expected[key]?.() ?? sourceTableAssertions('followups', snapshot);
}

/** Bind a scenario to exact source-backed expectations without publishing synthetic identity data. */
export function bindV8ScenarioOracle(item, snapshot, sourceSha256) {
  if (!item || typeof item.id !== 'string' || !Array.isArray(item.turns) || !item.turns.length ||
      !snapshot?.tables || !/^[a-f0-9]{64}$/u.test(sourceSha256 ?? '')) throw new Error('Scenario and frozen source snapshot required');
  const assertions = item.category === 'actions' ? actionAssertions(item)
    : item.category === 'patients' ? patientAssertions(item.oracleKey, snapshot)
      : item.category === 'consultations' ? consultationAssertions(item.oracleKey, snapshot) ?? [clinicalEvidence(item.oracleKey, snapshot)]
      : item.category === 'followups' ? followupAssertions(item, snapshot)
          : item.category === 'agenda' ? agendaAssertions(item.oracleKey, snapshot) ?? sourceTableAssertions(item.category, snapshot)
            : item.category === 'finance' ? financeAssertions(item.oracleKey, snapshot) ?? sourceTableAssertions(item.category, snapshot)
              : item.category === 'application' ? applicationAssertions(item.oracleKey, snapshot) ?? sourceTableAssertions(item.category, snapshot)
                : null;
  if (!assertions || !assertions.length || assertions.some(assertion => assertion == null)) throw new Error(`No independent oracle for ${item.id}`);
  const clinical = assertions.find(assertion => assertion.kind === 'clinical_facts');
  const action = item.category === 'actions' ? assertions : [];
  const turnBindings = bindTurnTokens(item, snapshot);
  let inheritedRef = null;
  const turnScopes = item.turns.map((turn, index) => {
    const token = /\[(PATIENT_LONG_[123]|PATIENT_A_FULL_NAME|PATIENT_[A-Z_]+)\]/u.exec(turn)?.[1];
    if (token === 'PATIENT_A' || token === 'PATIENT_A_FULL_NAME') inheritedRef = 'PATIENT_A';
    else if (token === 'PATIENT_B') inheritedRef = 'PATIENT_B';
    else if (/^PATIENT_LONG_[123]$/u.test(token ?? '')) inheritedRef = token;
    else if (token === 'PATIENT_AMBIGUOUS') inheritedRef = 'AMBIGUOUS_PATIENT_SET';
    const patientRef = inheritedRef ?? patientForKey(item.oracleKey, snapshot)?.ref ?? null;
    return { index, patientRef, explicitReference: token ?? null };
  });
  return {
    id: item.id,
    category: item.category,
    oracleKey: item.oracleKey,
    sourceSha256,
    turnCount: item.turns.length,
    turnScopes,
    turnBindings,
    ...(action.some(assertion => assertion.kind === 'turn_stage') ? { turnStages: action.filter(assertion => assertion.kind === 'turn_stage') } : {}),
    ...(clinical ? { coverage: { patientRef: clinical.patientRef, ...clinical.coverage } } : {}),
    assertions,
  };
}
