#!/usr/bin/env node
/**
 * Seeds the isolated V9 synthetic fixture database.
 *
 * The fixture exists to cover the domains the 1,558-patient clone cannot cover:
 * known sex, active/resolved diagnoses, payments, signed notes, document drafts
 * and a small medication catalogue. It must never touch the 1,558-patient clone
 * or a cabinet database.
 *
 * Expected target: postgresql://...@127.0.0.1:55445/alexa_eval_v9_fixture_20261030
 */
import pg from "pg";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const { Client } = pg;
const FIXTURE_DATABASE = "alexa_eval_v9_fixture_20261030";
const CABINET = "00000000-0000-0000-0000-000000000001";
const OWNER = "00000000-0000-0000-0000-0000000000a1";
const PRACTITIONER = "00000000-0000-0000-0000-0000000000a2";
const ASSISTANT = "00000000-0000-0000-0000-0000000000a3";
const AS_OF = "2026-10-30T12:00:00+01:00";

export function validateFixtureTarget(raw) {
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("FIXTURE_DATABASE_URL_REQUIRED");
  let target;
  try {
    target = new URL(raw);
  } catch {
    throw new Error("FIXTURE_DATABASE_URL_INVALID");
  }
  if (!["postgres:", "postgresql:"].includes(target.protocol)) throw new Error("FIXTURE_DATABASE_URL_INVALID");
  if (!["127.0.0.1", "localhost", "::1"].includes(target.hostname)) throw new Error("FIXTURE_LOOPBACK_ONLY");
  const database = target.pathname.replace(/^\/+/u, "");
  if (database !== FIXTURE_DATABASE) throw new Error("FIXTURE_DATABASE_NAME_REQUIRED");
  return { database, host: target.hostname, port: target.port };
}

const uuid = (prefix, number) => `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
const patientId = number => uuid("f1000000", number);
const appointmentId = number => uuid("f7000000", number);
const consultationId = number => uuid("f2000000", number);
const noteId = number => uuid("f3000000", number);
const diagnosisId = number => uuid("f4000000", number);
const treatmentId = number => uuid("f5000000", number);
const historyId = number => uuid("f6000000", number);
const paymentId = number => uuid("f8000000", number);
const chargeId = number => uuid("f9000000", number);
const scaleAdministrationId = number => uuid("fa000000", number);
const documentId = number => uuid("fb000000", number);
const draftId = number => uuid("fc000000", number);
const analysisId = number => uuid("fd000000", number);
const medicationId = number => uuid("f0000000", number);

const addDays = (date, days) => {
  const value = new Date(`${date}T12:00:00+01:00`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const at = (date, time) => new Date(`${date}T${time}:00+01:00`).toISOString();
const dateOnly = value => new Date(`${value}T12:00:00+01:00`).toISOString().slice(0, 10);

function insert(client, schema, table, row) {
  const columns = Object.keys(row).filter(key => row[key] !== undefined);
  if (columns.some(column => !/^[a-z_]+$/u.test(column))) throw new Error(`Invalid fixture column: ${table}`);
  const values = columns.map(column => {
    const value = row[column];
    return value !== null && typeof value === "object" ? JSON.stringify(value) : value;
  });
  return client.query(
    `INSERT INTO ${schema}.${table}(${columns.join(",")}) VALUES(${columns.map((_, index) => `$${index + 1}`).join(",")}) ON CONFLICT DO NOTHING`,
    values,
  );
}

async function seedActor(client, id, role, fullName) {
  await client.query(
    `INSERT INTO auth.users(id,email,encrypted_password,email_confirmed_at,created_at,updated_at,raw_user_meta_data,is_active)
     VALUES($1,$2,crypt($3,gen_salt('bf')),now(),now(),now(),$4,true)
     ON CONFLICT (id) DO NOTHING`,
    [id, `fictif-v9-${role}@fixture.invalid`, "AlexaV9Fixture-LocalOnly-2026", JSON.stringify({ full_name: fullName })],
  );
  await insert(client, "app", "profiles", {
    id,
    cabinet_id: CABINET,
    role,
    full_name: fullName,
    is_active: true,
  });
}

const medicationRows = [
  [1, "sertraline", "Zoloft", "comprimé", "25 mg"],
  [2, "sertraline", "Zoloft", "comprimé", "50 mg"],
  [3, "sertraline", "Zoloft", "comprimé", "100 mg"],
  [4, "quetiapine", "Xeroquel", "comprimé", "25 mg"],
  [5, "quetiapine", "Xeroquel", "comprimé", "100 mg"],
  [6, "lithium", "Téralithe", "comprimé", "250 mg"],
  [7, "escitalopram", "Seroplex", "comprimé", "10 mg"],
  [8, "olanzapine", "Zyprexa", "comprimé", "5 mg"],
  [9, "valproate", "Dépakine", "comprimé", "500 mg"],
  [10, "mirtazapine", "Norset", "comprimé", "15 mg"],
  [11, "lorazepam", "Temesta", "comprimé", "1 mg"],
  [12, "aripiprazole", "Abilify", "comprimé", "5 mg"],
  [13, "methylphenidate", "Ritaline", "comprimé", "10 mg"],
  [14, "atomoxetine", "Strattera", "gélule", "40 mg"],
  [15, "zolpidem", "Stilnox", "comprimé", "10 mg"],
  [16, "hydroxyzine", "Atarax", "comprimé", "25 mg"],
];

const patients = [
  ["Amina", "Fictifa", "F", "1980-01-15", "0550000101", "V9-ID-001", "Alger", "marie"],
  ["Karim", "Fictifb", "M", "1992-05-20", "0550000102", "V9-ID-002", "Alger", "celibataire"],
  ["Sofia", "Fictifc", "F", "2009-03-10", "0550000103", "V9-ID-003", "Blida", "celibataire"],
  ["Yacine", "Fictifd", "M", "1960-11-02", "0550000104", "V9-ID-004", "Alger", "marie"],
  ["Nadia", "Fictife", "F", "1988-07-07", "0550000105", "V9-ID-005", "Oran", "divorce"],
  ["Riad", "Fictiff", "M", "1995-12-30", "0550000106", "V9-ID-006", "Alger", "celibataire"],
  ["Leila", "Fictifg", "F", "1975-04-18", "0550000107", "V9-ID-007", "Constantine", "marie"],
  ["Samir", "Fictifh", "M", "2001-09-09", "0550000108", "V9-ID-008", "Alger", "celibataire"],
  ["Meriem", "Fictifi", "F", "1983-02-14", "0550000109", "V9-ID-009", "Alger", "en_couple"],
  ["Tarek", "Fictifk", "M", "1969-06-25", "0550000110", "V9-ID-010", "Tizi Ouzou", "marie"],
  ["Ines", "Fictifl", "F", "1998-08-08", "0550000111", "V9-ID-011", null, "celibataire"],
  ["Adel", "Fictifm", "M", "1990-10-10", "0550000112", null, "Alger", "celibataire"],
];

const themes = [
  "des inquiétudes professionnelles et un sommeil fragmenté",
  "une fatigue persistante et une perte d'intérêt",
  "une anxiété anticipatoire avant les rendez-vous",
  "une humeur basse avec réveils précoces",
  "des pensées obsédantes et des rituels de vérification",
  "une irritabilité et des difficultés de concentration",
  "un isolement progressif et une baisse d'élan",
  "des accès de panique au travail",
  "une adherence irrégulière au traitement",
  "des céphalées et une sensibilité au bruit",
  "une charge mentale familiale importante",
  "une reprise progressive des activités",
];

const diagnoses = [
  [1, "F32.1", "Épisode dépressif caractérisé, degré moyen", true, "2024-03-10", null],
  [2, "F41.1", "Trouble anxieux généralisé", false, "2024-03-10", null],
  [3, "F31.3", "Trouble affectif bipolaire, épisode actuel dépressif léger", true, "2024-06-01", null],
  [4, "F41.1", "Trouble anxieux généralisé", true, "2024-07-01", null],
  [5, "F20.0", "Schizophrénie paranoïde", true, "2023-01-15", null],
  [6, "F32.1", "Épisode dépressif caractérisé, degré moyen", false, "2023-01-15", "2025-06-01"],
  [7, "F33.1", "Trouble dépressif récurrent, épisode actuel moyen", true, "2024-02-01", null],
  [8, "F43.1", "État de stress post-traumatique", true, "2024-05-01", null],
  [9, "F90.0", "Trouble de l'activité et de l'attention", true, "2024-09-01", null],
  [10, "F32.1", "Épisode dépressif caractérisé, degré moyen", true, "2023-11-01", "2025-01-01"],
  [11, "F41.1", "Trouble anxieux généralisé", false, "2026-01-01", null],
];

const treatmentPlan = [
  [1, 2, "active", "50", "mg", "1 fois par jour", ["matin"], "2024-03-10", null],
  [1, 4, "active", "25", "mg", "le soir", ["soir"], "2024-03-10", null],
  [3, 6, "active", "250", "mg", "2 fois par jour", ["matin", "soir"], "2024-06-01", null],
  [4, 7, "active", "10", "mg", "1 fois par jour", ["matin"], "2024-07-01", null],
  [5, 8, "active", "5", "mg", "le soir", ["soir"], "2023-01-15", null],
  [5, 9, "paused", "500", "mg", "2 fois par jour", ["matin", "soir"], "2023-01-15", "2025-04-01"],
  [7, 3, "active", "100", "mg", "1 fois par jour", ["matin"], "2024-02-01", null],
  [8, 10, "active", "15", "mg", "le soir", ["soir"], "2024-05-01", null],
  [9, 12, "active", "5", "mg", "1 fois par jour", ["matin"], "2024-09-01", null],
  [10, 11, "paused", "1", "mg", "si besoin", ["soir"], "2023-11-01", "2025-01-01"],
  [11, 13, "active", "10", "mg", "1 fois par jour", ["matin"], "2026-01-01", null],
];

const scalePlan = [
  [1, 1, 14, "modéré", "2024-03-10", 0],
  [1, 2, 16, "sévère", "2024-03-10", 0],
  [2, 1, 18, "modérément sévère", "2024-03-11", 0],
  [2, 2, 19, "sévère", "2024-03-11", 0],
  [3, 1, 8, "léger", "2024-06-02", 0],
  [3, 2, 7, "léger", "2024-06-02", 0],
  [4, 1, 20, "sévère", "2024-07-02", 0],
  [4, 2, 18, "sévère", "2024-07-02", 0],
  [5, 1, 12, "modéré", "2024-09-03", 0],
  [5, 2, 10, "modéré", "2024-09-03", 0],
  [6, 1, 6, "léger", "2024-10-04", 0],
  [6, 2, 5, "léger", "2024-10-04", 0],
  [1, 3, 18, "modéré", "2024-03-10", 0],
  [2, 3, 14, "léger", "2024-03-11", 0],
  [4, 3, 22, "sévère", "2024-07-02", 0],
  [7, 3, 16, "modéré", "2024-02-02", 0],
  [10, 3, 12, "léger", "2023-11-02", 0],
  [3, 4, 12, "hypomanie légère", "2024-06-02", 0],
  [9, 4, 8, "symptômes légers", "2024-09-03", 0],
  [1, 1, 9, "léger", "2026-09-20", 2],
  [1, 2, 10, "modéré", "2026-09-20", 2],
  [2, 1, 14, "modéré", "2026-09-21", 2],
  [2, 2, 15, "modéré", "2026-09-21", 2],
  [3, 1, 5, "léger", "2026-09-22", 2],
  [3, 2, 4, "léger", "2026-09-22", 2],
  [4, 1, 22, "sévère", "2026-09-23", 2],
  [4, 2, 20, "sévère", "2026-09-23", 2],
];

export async function seedV9Fixture(client) {
  const target = validateFixtureTarget(process.env["MINDCARE_ALEXA_V9_FIXTURE_ADMIN_URL"]);
  const database = (await client.query("SELECT current_database() AS database")).rows[0]?.database;
  if (database !== target.database) throw new Error("FIXTURE_CONNECTED_DATABASE_MISMATCH");
  const nonSynthetic = Number((await client.query("SELECT count(*)::int n FROM app.patients WHERE is_synthetic IS DISTINCT FROM true")).rows[0]?.n ?? 0);
  if (nonSynthetic !== 0) throw new Error("FIXTURE_REFUSES_NON_SYNTHETIC_PATIENTS");
  const environment = (await client.query("SELECT environment FROM app.deployment WHERE singleton")).rows[0]?.environment;
  if (environment !== "cloud-dev") throw new Error("FIXTURE_DEPLOYMENT_NOT_CLOUD_DEV");
  const templates = Number((await client.query("SELECT count(*)::int n FROM app.document_templates")).rows[0]?.n ?? 0);
  if (templates === 0) throw new Error("FIXTURE_DOCUMENT_TEMPLATES_MISSING");
  const scales = Number((await client.query("SELECT count(*)::int n FROM app.scales")).rows[0]?.n ?? 0);
  if (scales === 0) throw new Error("FIXTURE_SCALES_MISSING");
  const registry = (await client.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE version IN ('201_record_missing_schema_versions','207_analysis_gates','208_analysis_charts','209_analysis_indexes'))::int AS requested,
      max(version) AS highest
    FROM app.schema_migrations`)).rows[0];
  if (Number(registry?.total) < 188 || Number(registry?.requested) !== 4 || registry?.highest !== "209_analysis_indexes") {
    throw new Error("FIXTURE_MIGRATION_REGISTRY_INCOMPLETE");
  }

  const startedAt = Date.now();
  const counts = {};
  await client.query("BEGIN");
  try {
    await insert(client, "app", "cabinets", {
      id: CABINET,
      name: "Cabinet synthétique V9 — fixture",
      address: "Alger (synthétique)",
      phone: "0000000000",
    }).catch(async error => {
      if (error?.code !== "23505") throw error;
    });
    await seedActor(client, OWNER, "owner", "FICTIF V9 Owner");
    await seedActor(client, PRACTITIONER, "practitioner", "FICTIF V9 Practitioner");
    await seedActor(client, ASSISTANT, "assistant", "FICTIF V9 Assistant");

    for (const [number, inn, brand, form, strength] of medicationRows) {
      const raw = `${brand} ${strength} — ${inn}`;
      await insert(client, "app", "medications", {
        id: medicationId(number),
        cabinet_id: null,
        inn,
        brand_name: brand,
        atc_class: null,
        form,
        strength,
        default_posology: null,
        notes: "Fixture synthétique V9 — aucune posologie clinique.",
        source: "fixture-v9",
        is_active: true,
        source_raw_value: raw,
        normalized_search: raw.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr"),
        source_fingerprint: createHash("sha256").update(`fixture-v9:${number}:${raw}`).digest("hex"),
        source_version: "fixture-v9",
      });
    }

    for (const [index, [firstName, lastName, sex, birth, phone, idDocument, address, marital]] of patients.entries()) {
      const number = index + 1;
      await insert(client, "app", "patients", {
        id: patientId(number),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        record_number: `V9-${String(number).padStart(3, "0")}`,
        first_name: firstName,
        last_name: lastName,
        birth_date: birth,
        sex,
        phone,
        phone_alt: null,
        address,
        id_document_number: idDocument,
        id_document_issuer: idDocument ? "Fixture V9" : null,
        emergency_contact: null,
        notes_admin: "Dossier entièrement fictif — fixture Alexa V9.",
        is_active: true,
        is_synthetic: true,
        created_by: OWNER,
        marital_status: marital,
      });
    }

    for (const [index] of patients.entries()) {
      const number = index + 1;
      const pastDate = addDays("2026-09-20", index);
      const futureDate = addDays("2026-11-03", index);
      await insert(client, "app", "appointments", {
        id: appointmentId(number * 10 + 1),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        patient_id: patientId(number),
        starts_at: at(pastDate, "09:00"),
        ends_at: at(pastDate, "09:30"),
        status: "completed",
        source: "doctor",
        notes_admin: "Rendez-vous fictif V9.",
        created_by: OWNER,
        kind: "suivi",
        is_synthetic: true,
      });
      await insert(client, "app", "appointments", {
        id: appointmentId(number * 10 + 2),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        patient_id: patientId(number),
        starts_at: at(futureDate, "10:00"),
        ends_at: at(futureDate, "10:30"),
        status: "confirmed",
        source: "doctor",
        notes_admin: "Rendez-vous fictif V9 à venir.",
        created_by: OWNER,
        kind: "suivi",
        is_synthetic: true,
      });
    }

    let consultationNumber = 1;
    for (const [index] of patients.entries()) {
      const number = index + 1;
      for (let visit = 0; visit < 3; visit += 1) {
        const identifier = consultationNumber++;
        const day = visit === 0 ? addDays("2024-03-10", index)
          : visit === 1 ? addDays("2025-02-20", index)
            : addDays("2026-09-20", index);
        const theme = themes[index] ?? themes[0];
        const rawNotes = `Séance fictive ${visit + 1} du dossier V9-${String(number).padStart(3, "0")}. La personne décrit ${theme}. L’entretien précise les facteurs de maintien et les ressources disponibles. Le plan de la séance est réévalué avec elle.`;
        await insert(client, "app", "consultations", {
          id: consultationId(identifier),
          cabinet_id: CABINET,
          practitioner_id: OWNER,
          patient_id: patientId(number),
          appointment_id: visit === 2 ? appointmentId(number * 10 + 1) : null,
          started_at: at(day, "09:00"),
          ended_at: at(day, "09:30"),
          status: "closed",
          raw_notes: rawNotes,
          is_synthetic: true,
        });
        const subjective = `La personne rapporte ${theme}. Elle décrit l’évolution depuis la séance précédente et ce qui lui semble le plus difficile en ce moment.`;
        const objective = `L’entretien est fluide. La personne répond aux questions, précise les situations et identifie un objectif concret pour la période à venir.`;
        const assessment = `Le tableau est documenté sans conclusion nouvelle. Les difficultés persistent sur le versant fonctionnel ; les ressources et les repères travaillés restent mobilisables.`;
        const plan = `Poursuivre le suivi, consolider les repères évoqués et réévaluer la tolérance au prochain rendez-vous. Aucun changement de traitement n’est décidé dans cette séance fictive.`;
        const signed = visit < 2;
        const signedAt = signed ? at(day, "09:20") : null;
        await insert(client, "app", "clinical_notes", {
          id: noteId(identifier),
          cabinet_id: CABINET,
          practitioner_id: OWNER,
          patient_id: patientId(number),
          consultation_id: consultationId(identifier),
          status: signed ? "signed" : "draft",
          subjective,
          objective,
          assessment,
          plan,
          structured: {
            focus: [theme.split(" ").slice(0, 2).join(" ")],
            mesures: { humeur: 1 + (index % 4), anxiete: 1 + ((index + visit) % 4), sommeil: 1 + ((index + 1) % 4) },
            focusLibre: "objectif fonctionnel fictif",
            fixture: "v9",
          },
          ai_draft: false,
          signed_at: signedAt,
          signed_by: signed ? OWNER : null,
          lock_after: signed ? at(day, "09:35") : null,
          created_at: at(day, "09:10"),
          updated_at: signed ? signedAt : at(day, "09:31"),
          is_synthetic: true,
        });
      }
    }

    for (const [index, [number, code, label, primary, onset, resolved]] of diagnoses.entries()) {
      await insert(client, "app", "diagnoses", {
        id: diagnosisId(index + 1),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        patient_id: patientId(number),
        code_system: "ICD-10",
        code,
        label,
        is_primary: primary,
        onset_date: onset,
        resolved_at: resolved,
        created_at: at(onset, "10:00"),
        is_synthetic: true,
      });
    }

    for (const [index, [number, medNumber, status, dose, unit, frequency, timing, start, end]] of treatmentPlan.entries()) {
      const identifier = index + 1;
      const treatment = {
        id: treatmentId(identifier),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        patient_id: patientId(number),
        medication_id: medicationId(medNumber),
        consultation_id: consultationId(number * 3 - 2),
        previous_treatment_id: null,
        status,
        dose,
        dose_unit: unit,
        frequency,
        timing,
        instructions: "Fixture V9 — consigne fictive.",
        start_date: start,
        end_date: end,
        stopped_at: status === "stopped" ? at(end ?? start, "10:00") : null,
        stopped_reason: status === "stopped" ? "decision_clinique" : null,
        current_version: 1,
        is_synthetic: true,
      };
      await insert(client, "app", "patient_treatments", treatment);
      await insert(client, "app", "patient_treatment_history", {
        id: historyId(identifier),
        treatment_id: treatmentId(identifier),
        version: 1,
        action: "started",
        previous_values: null,
        new_values: treatment,
        actor_id: OWNER,
        occurred_at: at(start, "10:00"),
        consultation_id: consultationId(number * 3 - 2),
        reason: null,
        notes: "Fixture V9.",
        is_synthetic: true,
      });
    }

    let paymentNumber = 1;
    for (const [index] of patients.slice(0, 8).entries()) {
      const number = index + 1;
      for (let visit = 0; visit < 2; visit += 1) {
        const identifier = paymentNumber++;
        const collected = visit === 0;
        await insert(client, "app", "payments", {
          id: paymentId(identifier),
          cabinet_id: CABINET,
          practitioner_id: OWNER,
          patient_id: patientId(number),
          consultation_id: consultationId(number * 3 - 2 + visit),
          receipt_number: `V9-R-${String(identifier).padStart(4, "0")}`,
          amount_dzd: 2000 + index * 250,
          method: "cash",
          set_by: OWNER,
          collected_by: collected ? OWNER : null,
          collected_at: collected ? at(addDays("2026-09-20", index), "09:40") : null,
          created_at: at(addDays("2026-09-20", index), "09:35"),
          is_synthetic: true,
        });
      }
    }

    const charges = [
      ["Loyer cabinet V9", 50000, "local", "recurrente", "mensuelle", "2026-01-01", "2026-11-01"],
      ["Logiciel V9", 5000, "outils", "recurrente", "mensuelle", "2026-01-01", "2026-11-01"],
      ["Assurance V9", 12000, "assurance", "recurrente", "annuelle", "2026-01-01", "2027-01-01"],
      ["Fournitures V9", 3000, "autre", "ponctuelle", null, "2026-10-01", null],
    ];
    for (const [index, [label, amount, category, type, frequency, date, next]] of charges.entries()) {
      await insert(client, "app", "charges", {
        id: chargeId(index + 1),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        intitule: label,
        montant_dzd: amount,
        categorie: category,
        type,
        frequence: frequency,
        date_charge: date,
        date_prochaine_echeance: next,
        actif: true,
        is_synthetic: true,
      });
    }

    const scalesByNumber = new Map([
      [1, { code: "PHQ9", id: "96ef797e-55c7-44e8-bb97-8a53e975d535", items: 9 }],
      [2, { code: "GAD7", id: "2e793f37-2080-4637-b09d-287c86f1a901", items: 7 }],
      [3, { code: "HDRS", id: "d6e184e1-4efa-4870-98f4-1627193302fd", items: 17 }],
      [4, { code: "YMRS", id: "827d5b42-d73a-442d-81d5-b7d678b0eba6", items: 11 }],
    ]);
    for (const [index, [number, scaleNumber, score, interpretation, day, visit]] of scalePlan.entries()) {
      const scale = scalesByNumber.get(scaleNumber);
      if (!scale) throw new Error(`Unknown fixture scale: ${scaleNumber}`);
      await insert(client, "app", "scale_administrations", {
        id: scaleAdministrationId(index + 1),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        patient_id: patientId(number),
        consultation_id: consultationId(number * 3 - 2 + visit),
        scale_id: scale.id,
        responses: { fixture: "v9", scale: scale.code, items: Array.from({ length: scale.items }, (_, item) => (item + index) % 4) },
        total_score: score,
        interpretation,
        administered_at: at(day, "09:15"),
        is_synthetic: true,
      });
    }

    for (let index = 0; index < 4; index += 1) {
      await insert(client, "app", "consultation_analyses", {
        id: analysisId(index + 1),
        cabinet_id: CABINET,
        patient_id: patientId(1),
        consultation_id: consultationId(index + 1),
        practitioner_id: OWNER,
        patient_practitioner_id: OWNER,
        version: 1,
        content: { resume: `Synthèse fictive V9 de la séance ${index + 1}. Les thèmes documentés sont repris sans nouvelle conclusion clinique.` },
        source_state: { fixture: "v9", note_areas: 4 },
        model: "fixture-v9",
        prompt_version: "v9-fixture",
        prompt_hash: createHash("sha256").update(`fixture-v9-analysis-${index}`).digest("hex"),
        generated_at: at(addDays("2026-09-20", index), "10:00"),
      });
    }

    const issued = [
      [1, 1, "certificat_medical", "V9-DOC-001", "7d2c43ab-5a74-4073-880e-c0204a442ed1", 4],
      [2, 2, "suivi_medical", "V9-DOC-002", "0f52cd87-eb66-4a1d-8a2d-899b288c3b98", 4],
    ];
    for (const [index, [number, docNumber, kind, numberLabel, templateId, templateVersion]] of issued.entries()) {
      const html = `<p>Document synthétique V9 ${numberLabel}. Aucune valeur clinique réelle.</p>`;
      await insert(client, "app", "documents", {
        id: documentId(index + 1),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        patient_id: patientId(number),
        consultation_id: consultationId(number * 3 - 2),
        doc_type: kind,
        doc_number: docNumber,
        variables: { fixture: "v9", patient_name: `${patients[number - 1][0]} ${patients[number - 1][1]}` },
        rendered_html: html,
        issued_at: at(addDays("2026-09-20", index), "10:30"),
        printed_count: 0,
        is_synthetic: true,
        status: "issued",
        template_id: templateId,
        template_version: templateVersion,
        schema_version: "v2",
        content_hash: createHash("sha256").update(html).digest("hex"),
        snapshot_header: null,
        content_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Document synthétique V9." }] }] },
        renderer_version: "v9-fixture",
        page_manifest: null,
        source_draft_id: null,
        prescription_id: null,
      });
    }

    const drafts = [
      [1, 3, "ordonnance", "53cae3af-4128-49d3-8aa1-bd8c6c6bc654", 1],
      [2, 4, "certificat_medical", "7d2c43ab-5a74-4073-880e-c0204a442ed1", 4],
    ];
    for (const [index, [number, docNumber, kind, templateId, templateVersion]] of drafts.entries()) {
      const content = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `Brouillon synthétique V9 ${docNumber}.` }] }] };
      await insert(client, "app", "document_drafts", {
        id: draftId(index + 1),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        patient_id: patientId(number),
        doc_type: kind,
        template_id: templateId,
        template_version: templateVersion,
        variables: { fixture: "v9", patient_name: `${patients[number - 1][0]} ${patients[number - 1][1]}` },
        content_json: content,
        revision: 1,
        document_date: addDays("2026-10-20", index),
        renderer_version: "v9-fixture",
        updated_at: at(addDays("2026-10-20", index), "11:00"),
      });
      await insert(client, "app", "document_draft_revisions", {
        id: uuid("fe000000", index + 1),
        draft_id: draftId(index + 1),
        patient_id: patientId(number),
        cabinet_id: CABINET,
        practitioner_id: OWNER,
        revision: 1,
        content_json: content,
        variables: { fixture: "v9" },
        document_date: addDays("2026-10-20", index),
      });
    }

    const tables = ["patients", "appointments", "consultations", "clinical_notes", "diagnoses", "medications", "patient_treatments", "patient_treatment_history", "payments", "charges", "scale_administrations", "consultation_analyses", "documents", "document_drafts", "document_draft_revisions"];
    for (const table of tables) {
      counts[table] = Number((await client.query(`SELECT count(*)::int n FROM app.${table}`)).rows[0]?.n ?? 0);
    }
    await client.query("COMMIT");
    const receipt = {
      version: 1,
      fixture: FIXTURE_DATABASE,
      asOf: AS_OF,
      cabinet: CABINET,
      actors: { owner: OWNER, practitioner: PRACTITIONER, assistant: ASSISTANT },
      counts,
      patientIds: patients.map((_, index) => patientId(index + 1)),
      fixtureHash: createHash("sha256").update(JSON.stringify({ patients, diagnoses, treatmentPlan, scalePlan, medicationRows, counts })).digest("hex"),
      elapsedMs: Date.now() - startedAt,
    };
    return receipt;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function main() {
  const rawUrl = process.env["MINDCARE_ALEXA_V9_FIXTURE_ADMIN_URL"];
  const target = validateFixtureTarget(rawUrl);
  const outPath = resolve(process.env["ALEXA_V9_FIXTURE_RECEIPT"] ?? ".eval-out/alexa-v9-fixture/seed-receipt.json");
  const client = new Client({ connectionString: rawUrl, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const receipt = await seedV9Fixture(client);
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({ status: "PASS", target, counts: receipt.counts, output: outPath }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: "FAIL", target, error: error instanceof Error ? error.message : "FIXTURE_SEED_FAILED" }, null, 2));
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
