import { expect, it } from 'vitest';
import { bindV8ScenarioOracle, patientCountOracles } from '../../scripts/lib/alexa-v8-oracle.mjs';

type OracleAssertion = { kind: string; reason?: string };
type TurnStage = { outcome: string };

const fixture = () => ({
  fixtureAsOf: '2026-10-27T12:00:00+01:00',
  source: { database: 'alexa_eval_v8_intelligence_20261027', patients: 2, nonSynthetic: 0, consultations: 3 },
  patientA: { id: 'patient-a', name: 'Exemple A', visits: 2 },
  patientB: { id: 'patient-b', name: 'Exemple B', visits: 1 },
  longPatients: [{ id: 'patient-long', name: 'Exemple Long', visits: 3 }],
  tables: {
    patients: [
      { id: 'patient-a', is_active: true, phone: '0550000001', id_document_number: 'A1', birth_date: '1990-01-01', first_name: 'Exemple', last_name: 'A' },
      { id: 'patient-b', is_active: true, phone: null, id_document_number: null, birth_date: null, first_name: 'Exemple', last_name: 'B' },
    ],
    consultations: [],
    selectedConsultations: [
      { id: 'long-1', patient_id: 'patient-long', started_at: '2024-01-01T10:00:00Z' },
      { id: 'long-2', patient_id: 'patient-long', started_at: '2024-02-01T10:00:00Z' },
      { id: 'long-3', patient_id: 'patient-long', started_at: '2024-03-01T10:00:00Z' },
    ],
    selectedNotes: [], selectedAmendments: [], selectedAnalyses: [], appointments: [], payments: [], charges: [] as Array<{
      id: string; actif: boolean; type: string; frequence: string | null; montant_dzd: number;
      categorie: string; date_charge: string; date_prochaine_echeance?: string;
    }>,
    treatments: [{ id: 'treatment-a', patient_id: 'patient-a', medication_id: 'med-a', status: 'active', dose: '50', dose_unit: 'mg', frequency: 'once_daily', timing: [], instructions: null }], treatmentHistory: [], diagnoses: [], scales: [], scaleAdministrations: [], documents: [],
    documentDrafts: [], documentDraftRevisions: [], prescriptions: [], prescriptionLines: [], documentTemplates: [],
    internalMessages: [], appointmentReasons: [], selectedCaseSummaries: [],
    medicationCatalog: [{ id: 'med-a', brand_name: 'Exemplex', inn: 'exemple', form: 'gélule', strength: '50 mg' }], profiles: [], cabinet: [],
  },
});

it('computes cabinet patient counts independently, including whitespace-only fields', () => {
  const rows = [
    { is_active: true, phone: '   ', id_document_number: null, birth_date: null },
    { is_active: true, phone: '0550000000', id_document_number: '123', birth_date: '1990-01-01' },
    { is_active: false, phone: null, id_document_number: null, birth_date: null },
  ];
  expect(patientCountOracles(rows)).toEqual({
    active_count: 2,
    archived_count: 1,
    all_count: 3,
    active_missing_phone_count: 1,
    active_present_phone_count: 1,
    active_missing_identity_count: 1,
    active_present_identity_count: 1,
    active_missing_birth_count: 1,
  });
});

it('binds each factual case to a private exact value derived from the snapshot', () => {
  const result = bindV8ScenarioOracle({
    id: 'v8-test-1', category: 'patients', oracleKey: 'patient_a_phone',
    turns: ['Quel est le téléphone de [PATIENT_A] ?'],
  }, fixture(), 'a'.repeat(64));

  expect(result.assertions).toContainEqual({ kind: 'exact_value', field: 'patients.phone', value: '0550000001' });
  expect(result.sourceSha256).toBe('a'.repeat(64));
});

it('records complete consultation coverage separately from summary facts', () => {
  const result = bindV8ScenarioOracle({
    id: 'v8-test-long', category: 'consultations', oracleKey: 'long_1_complete_history',
    turns: ['Résume tout l’historique de [PATIENT_LONG_1].'],
  }, fixture(), 'b'.repeat(64));

  expect(result.coverage).toEqual({ patientRef: 'PATIENT_LONG_1', consultationCount: 3, consultationIds: ['long-1', 'long-2', 'long-3'] });
  expect(result.assertions.some((assertion:OracleAssertion) => assertion.kind === 'clinical_facts')).toBe(true);
});

it('freezes explicit no-write expectations for hypothetical action language', () => {
  const result = bindV8ScenarioOracle({
    id: 'v8-test-action', category: 'actions', oracleKey: 'hypothetical_appointment_no_write',
    turns: ['Que se passerait-il si j’annulais ce rendez-vous ?'],
  }, fixture(), 'c'.repeat(64));

  expect(result.assertions.some((assertion:OracleAssertion) => assertion.kind === 'no_write' && assertion.reason === 'hypothetical_request')).toBe(true);
});

it('binds each follow-up turn to the exact inherited patient fact', () => {
  const source = fixture();
  const result = bindV8ScenarioOracle({
    id: 'v8-test-followup', category: 'followups', oracleKey: 'named_then_phone',
    turns: ['Cherche [PATIENT_A].', 'Quel est son téléphone ?'],
  }, source, 'd'.repeat(64));

  expect(result.turnScopes).toEqual([
    { index: 0, patientRef: 'PATIENT_A', explicitReference: 'PATIENT_A' },
    { index: 1, patientRef: 'PATIENT_A', explicitReference: null },
  ]);
  expect(result.assertions).toContainEqual({ kind: 'exact_value', turnIndex: 1, field: 'patients.phone', value: '0550000001' });
});

it('requires a separate revision-bound identity check before medication resume', () => {
  const result = bindV8ScenarioOracle({
    id: 'v8-test-resume', category: 'actions', oracleKey: 'medication_resume',
    turns: ['Mets [MEDICATION_A] en pause.', '[EXACT_MEDICATION]', 'Reprends-le.', '[EXACT_MEDICATION]'],
  }, fixture(), 'e'.repeat(64));

  expect(result.turnStages.map((stage:TurnStage) => stage.outcome)).toEqual([
    'needs_input', 'completed', 'needs_input', 'completed',
  ]);
  expect(result.assertions.at(-1).effect.finalStatus).toBe('active');
});

it('privately binds patient and medicine placeholders to source records', () => {
  const result = bindV8ScenarioOracle({
    id: 'v8-test-token', category: 'actions', oracleKey: 'medication_increase_exact_identity',
    turns: ['Change [MEDICATION_A] pour [PATIENT_A].', '[EXACT_MEDICATION]'],
  }, fixture(), 'f'.repeat(64));

  expect(result.turnBindings[0].tokens).toEqual({ MEDICATION_A: 'Exemplex — DCI exemple — gélule — 50 mg', PATIENT_A: 'Exemple A' });
  expect(result.turnBindings[1].tokens.EXACT_MEDICATION).toBe('Exemplex — DCI exemple — gélule — 50 mg');
});

it('calculates monthly charges from active recurring charges and period-only one-time charges', () => {
  const source = fixture();
  source.fixtureAsOf = '2026-10-27';
  source.tables.charges = [
    { id: 'monthly', actif: true, type: 'recurrente', frequence: 'mensuelle', montant_dzd: 45000, categorie: 'local', date_charge: '2026-08-01' },
    { id: 'quarterly', actif: true, type: 'recurrente', frequence: 'trimestrielle', montant_dzd: 9300, categorie: 'outils', date_charge: '2026-08-01' },
    { id: 'annual', actif: true, type: 'recurrente', frequence: 'annuelle', montant_dzd: 12000, categorie: 'autre', date_charge: '2026-08-01' },
    { id: 'mid-month', actif: true, type: 'recurrente', frequence: 'mensuelle', montant_dzd: 3100, categorie: 'personnel', date_charge: '2026-10-16' },
    { id: 'one-time', actif: true, type: 'ponctuelle', frequence: null, montant_dzd: 10000, categorie: 'assurance', date_charge: '2026-10-10' },
    { id: 'inactive', actif: false, type: 'ponctuelle', frequence: null, montant_dzd: 99999, categorie: 'local', date_charge: '2026-10-10' },
    { id: 'future', actif: true, type: 'recurrente', frequence: 'mensuelle', montant_dzd: 5000, categorie: 'local', date_charge: '2026-11-01' },
  ];
  const bind = (id: string, category: string, oracleKey: string) => bindV8ScenarioOracle({
    id, category, oracleKey, turns: ['Quel est le total des charges de ce mois-ci ?'],
  }, source, '1'.repeat(64)).assertions;

  expect(bind('v8-test-charges', 'finance', 'current_month_charges')).toEqual([
    { kind: 'exact_amount_dzd', value: 60700 },
  ]);
  expect(bind('v8-test-net', 'finance', 'current_month_net')).toEqual([
    { kind: 'exact_amount_dzd', value: -60700 },
  ]);
  expect(bind('v8-test-categories', 'finance', 'current_month_charge_categories')).toEqual([
    { kind: 'exact_rows', rows: [
      { categorie: 'assurance', montant_dzd: 10000 },
      { categorie: 'autre', montant_dzd: 1000 },
      { categorie: 'local', montant_dzd: 45000 },
      { categorie: 'outils', montant_dzd: 3100 },
      { categorie: 'personnel', montant_dzd: 1600 },
    ] },
  ]);
  expect(bind('v8-test-recurring', 'finance', 'recurring_monthly_total')).toEqual([
    { kind: 'exact_amount_dzd', value: 57200 },
  ]);
});

it('expects recurring charges plus one-time charges dated in the requested month', () => {
  const source = fixture();
  source.fixtureAsOf = '2026-10-27';
  source.tables.charges = [
    { id: 'recurring', actif: true, type: 'recurrente', frequence: 'mensuelle', montant_dzd: 45000, categorie: 'local', date_charge: '2026-08-01' },
    { id: 'one-time', actif: true, type: 'ponctuelle', frequence: null, montant_dzd: 10000, categorie: 'autre', date_charge: '2026-10-10' },
    { id: 'outside', actif: true, type: 'ponctuelle', frequence: null, montant_dzd: 20000, categorie: 'autre', date_charge: '2026-09-30' },
    { id: 'inactive', actif: false, type: 'recurrente', frequence: 'mensuelle', montant_dzd: 5000, categorie: 'autre', date_charge: '2026-08-01' },
  ];

  const assertions = bindV8ScenarioOracle({
    id: 'v8-test-net-to-charges', category: 'followups', oracleKey: 'finance_net_to_charges',
    turns: ['Quel résultat net ?', 'Et le détail des charges ?'],
  }, source, '2'.repeat(64)).assertions;
  expect(assertions.slice(0, 2)).toEqual([
    { kind: 'exact_amount_dzd', value: -55000 },
    { kind: 'exact_amount_dzd', value: 55000 },
  ]);
  expect(assertions.at(-1)).toEqual({
    kind: 'exact_rows', turnIndex: 1,
    rows: [source.tables.charges[0], source.tables.charges[1]],
  });
});
