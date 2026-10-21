#!/usr/bin/env node
/**
 * migrate-legacy-syglab — import IDENTITÉ Syglab → MindCare (migrations 126+127).
 *
 * Périmètre (décision 2026-10-06) : nom, téléphone, N° carte, naissance.
 * AUCUN historique, AUCUNE ordonnance, AUCUN médicament, AUCUN document.
 *
 * Source (lecture seule) : doctor_old_data/extract/*.json (identités,
 * revue) + 02_structured/csv/patient.csv (colonnes Pat_nom/Pat_prenom/
 * Pat_Tel/Num_CDI/Pat_Date_naissance séparées) — même lot, aucune autre
 * provenance. Naissance invraisemblable (< 1900 ou future) : stockée
 * verbatim + revue `implausible_date`, jamais corrigée ni devinée.
 * Naissance absente/illisible : NULL + valeur d'origine en preuve de revue.
 *
 * AUCUNE invention : pas de mapping médicament, pas de fusion de doublons,
 * pas de date fabriquée. Tout échec d'enregistrement devient un cas de revue.
 * Purge du clinique déjà importé : --purge-clinical (porte owner, auditée).
 *
 * PII : reste locale. L'URL de connexion vient de l'environnement
 * (MINDCARE_MIGRATION_DB sinon MINDCARE_DATABASE_URL) et n'est jamais affichée.
 *
 * Usage :
 *   node scripts/migrate-legacy-syglab.mjs --validate
 *   node scripts/migrate-legacy-syglab.mjs --dry-run --practitioner-id <uuid>
 *   node scripts/migrate-legacy-syglab.mjs --import --practitioner-id <uuid> --allow-write
 *   node scripts/migrate-legacy-syglab.mjs --purge-clinical --batch-id <uuid> --practitioner-id <uuid> --allow-write
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAUT_EXTRACT = path.join(RACINE, 'doctor_old_data', 'extract');
const DEFAUT_CSV = path.join(RACINE, 'doctor_old_data', '02_structured', 'csv');

/* .env lu par le script lui-même (jamais affiché) — même motif que
 * import-medicaments.mjs. Priorité : MINDCARE_MIGRATION_DB, sinon
 * MINDCARE_DATABASE_URL. */
function loadDotEnv() {
  const p = path.join(RACINE, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = (m[2] ?? '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}
loadDotEnv();

/* ---------- utilitaires purs (aucune PII sur stdout) ---------- */

function sha256Hex(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}
function sha256File(filePath) {
  return 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
function verbatim(v) {
  return String(v ?? '').trim();
}
function isEmpty(v) {
  return verbatim(v) === '';
}
function digitsOnly(v) {
  return String(v ?? '').replace(/\D+/g, '');
}
/** Miroir du CHECK 004 (126 : NULL autorisé). */
function isPhoneStorable(phone) {
  if (phone === null || phone === undefined) return true;
  const t = String(phone).trim();
  if (t === '') return true; // normalisé en NULL par l'appelant
  return /^[0-9+ ]{8,20}$/.test(t);
}
function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}
/** CSV minimaliste honnête : gère guillemets + retours ligne multilignes. */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  // Retire le BOM éventuel.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignoré, \n suit */ }
    else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  const header = rows.shift() ?? [];
  return rows.filter(r => r.length > 0 && !(r.length === 1 && r[0] === ''))
    .map(r => Object.fromEntries(header.map((h, k) => [h, r[k] ?? ''])));
}
function pick(row, ...cands) {
  for (const c of cands) if (c in row) return row[c];
  const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const index = {};
  for (const k of Object.keys(row)) index[norm(k)] = k;
  for (const c of cands) if (norm(c) in index) return row[index[norm(c)]];
  return '';
}

/** Naissance : { date: 'YYYY-MM-DD'|null, original: string, invraisemblable: bool }.
 *  Règle technique, jamais médicale : format calendaire strict ; hors
 *  [1900-01-01, aujourd'hui] → stockée verbatim + revue humaine. */
function parseNaissance(raw) {
  const v = verbatim(raw);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return { date: null, original: v, invraisemblable: v !== '' };
  const y = Number(m[1]);
  const d = new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
  const calendrier = d.getUTCFullYear() === y && d.getUTCMonth() === Number(m[2]) - 1
    && d.getUTCDate() === Number(m[3]);
  if (!calendrier) return { date: null, original: v, invraisemblable: true };
  const auj = new Date().toISOString().slice(0, 10);
  const invraisemblable = v < '1900-01-01' || v > auj;
  return { date: v, original: v, invraisemblable };
}
function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    mode: null, extractDir: DEFAUT_EXTRACT, csvDir: DEFAUT_CSV,
    cabinetId: null, practitionerId: null, label: null,
    allowWrite: false, reportOut: null, dbUrl: null,
    purgeClinical: false, purgeBatchId: null,
  };
  for (let i = 0; i < a.length; i++) {
    const k = a[i], nxt = a[i + 1];
    if (k === '--validate') o.mode = 'validate';
    else if (k === '--dry-run') o.mode = 'dryrun';
    else if (k === '--import') o.mode = 'import';
    else if (k === '--purge-clinical') o.mode = 'purge';
    else if (k === '--batch-id' && nxt) { o.purgeBatchId = nxt; i++; }
    else if (k === '--allow-write') o.allowWrite = true;
    else if (k === '--extract-dir' && nxt) { o.extractDir = nxt; i++; }
    else if (k === '--csv-dir' && nxt) { o.csvDir = nxt; i++; }
    else if (k === '--cabinet-id' && nxt) { o.cabinetId = nxt; i++; }
    else if (k === '--practitioner-id' && nxt) { o.practitionerId = nxt; i++; }
    else if (k === '--label' && nxt) { o.label = nxt; i++; }
    else if (k === '--report-out' && nxt) { o.reportOut = nxt; i++; }
    else if (k === '--db' && nxt) { o.dbUrl = nxt; i++; }
  }
  return o;
}

/* ---------- chargement source ---------- */

function chargerSource(extractDir, csvDir) {
  const extracted = loadJson(path.join(extractDir, 'legacy_patients_extracted.json'));
  const rapport = loadJson(path.join(extractDir, 'legacy_patients_extraction_report.json'));
  const revue = loadJson(path.join(extractDir, 'legacy_patients_manual_review.json'));
  const patientCsv = parseCsv(fs.readFileSync(path.join(csvDir, 'patient.csv'), 'utf8'));
  const ordCsv = parseCsv(fs.readFileSync(path.join(csvDir, 'ordonnances.csv'), 'utf8'));
  const ligneCsv = parseCsv(fs.readFileSync(path.join(csvDir, 'ligne_ordonnances.csv'), 'utf8'));
  const medCsv = parseCsv(fs.readFileSync(path.join(csvDir, 'medicament.csv'), 'utf8'));

  const patientsCsv = new Map();
  for (const r of patientCsv) {
    patientsCsv.set(verbatim(pick(r, 'IDPatient')), {
      nom: verbatim(pick(r, 'Pat_nom')),
      prenom: verbatim(pick(r, 'Pat_prenom')),
      tel: verbatim(pick(r, 'Pat_Tel')),
      cdi: verbatim(pick(r, 'Num_CDI')),
      idUtilisateur: verbatim(pick(r, 'IDUtilisateur')),
      naissance: verbatim(pick(r, 'Pat_Date_naissance')),
    });
  }
  const meds = new Map();
  for (const r of medCsv) {
    const id = verbatim(pick(r, 'IDMedicament', 'IDMédicament'));
    if (id) meds.set(id, r);
  }
  const lignesParOrd = new Map();
  for (const r of ligneCsv) {
    const oid = verbatim(pick(r, 'IDOrdonnances'));
    if (!lignesParOrd.has(oid)) lignesParOrd.set(oid, []);
    lignesParOrd.get(oid).push(r);
  }
  return { extracted, rapport, revue, patientsCsv, ordCsv, ligneCsv, meds, lignesParOrd };
}

/* ---------- programme ---------- */

async function main() {
  const o = parseArgs();
  if (!o.mode) {
    console.error('Usage: --validate | --dry-run | --import | --purge-clinical (voir en-tête).');
    process.exit(2);
  }
  const { extracted, rapport, revue, patientsCsv, ordCsv, meds, lignesParOrd } =
    chargerSource(o.extractDir, o.csvDir);
  const patients = extracted.patients;

  // ---- validation sans base : réconciliation extraction ↔ CSV ----
  const problemes = [];
  let phonesInvalides = 0;
  for (const p of patients) {
    const csv = patientsCsv.get(String(p.source_patient_id));
    if (!csv) { problemes.push({ type: 'patient_sans_ligne_csv', id: p.source_patient_id }); continue; }
    for (const t of p.phone_numbers) if (!isPhoneStorable(t)) phonesInvalides++;
  }
  const orphelinsConnus = new Set((rapport.orphan_ordonnance_patient_ids ?? []).map(String));
  const ordNonOrphelines = ordCsv.filter(r => !orphelinsConnus.has(verbatim(pick(r, 'IDPatient'))));
  const validation = {
    patients_json: patients.length,
    patients_csv: patientsCsv.size,
    ordonnances_csv: ordCsv.length,
    ordonnances_non_orphelines: ordNonOrphelines.length,
    lignes_csv: (lignesParOrd.size > 0)
      ? [...lignesParOrd.values()].reduce((n, l) => n + l.length, 0) : 0,
    medicaments_csv: meds.size,
    telephones_hors_format: phonesInvalides,
    sans_ligne_csv: problemes.length,
  };
  console.log(JSON.stringify({ phase: 'validate', ...validation }));

  if (o.mode === 'validate') {
    const ok = validation.patients_json === 1558 && validation.patients_csv === 1558
      && validation.ordonnances_csv === 145 && validation.lignes_csv === 176
      && validation.medicaments_csv === 7974 && validation.sans_ligne_csv === 0;
    console.log(JSON.stringify({ verdict: ok ? 'VERT' : 'ROUGE' }));
    process.exit(ok ? 0 : 1);
  }

  // ---- connexion base (URl jamais affichée) ----
  const dbUrl = o.dbUrl ?? process.env.MINDCARE_MIGRATION_DB ?? process.env.MINDCARE_DATABASE_URL;
  if (!dbUrl) {
    console.error('Base requise : MINDCARE_MIGRATION_DB ou MINDCARE_DATABASE_URL.');
    process.exit(2);
  }
  if (o.mode === 'import' && !o.allowWrite) {
    console.error("Import réel : ajouter --allow-write (sauvegarde vérifiée au préalable, cf. §18).");
    process.exit(2);
  }
  if (o.mode === 'purge' && (!o.allowWrite || !o.purgeBatchId)) {
    console.error('Purge : --purge-clinical exige --batch-id <uuid> et --allow-write.');
    process.exit(2);
  }
  if (!o.practitionerId) {
    console.error('Praticien requis : --practitioner-id <uuid> (données Dr Larbi).');
    process.exit(2);
  }
  const client = new pg.Client({ connectionString: dbUrl });
  await client.connect();
  try {
    // Accès lecture sous rôle applicatif (mindcare_app est NOINHERIT) —
    // même motif que withCaller, jamais de lecture directe hors RLS.
    const lire = async (sql, params, identite) => {
      await client.query('BEGIN');
      try {
        await client.query('SET LOCAL ROLE authenticated');
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [identite]);
        const r = await client.query(sql, params);
        await client.query('ROLLBACK');
        return r.rows;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    };
    // ---- pré-contrôles : 126 appliquée, cabinet/praticien réels ----
    const v126 = await lire(
      "SELECT count(*)::int AS n FROM app.schema_migrations WHERE version='126_legacy_syglab_migration'",
      [], o.practitionerId);
    if (v126[0].n !== 1) throw new Error('Migration 126 non appliquée sur la base cible.');
    let cabinetId = o.cabinetId;
    const prof = await lire(
      'SELECT id, cabinet_id, role FROM app.profiles WHERE id = $1',
      [o.practitionerId], o.practitionerId);
    if (prof.length !== 1) throw new Error('Praticien introuvable.');
    if (!['owner', 'practitioner'].includes(prof[0].role)) throw new Error('Rôle praticien requis.');
    if (cabinetId && cabinetId !== prof[0].cabinet_id) throw new Error('Cabinet/praticien incohérents.');
    cabinetId = prof[0].cabinet_id;

    const sec = o.mode === 'dryrun';
    // Dry-run : une seule transaction englobante, annulée à la fin.
    // Les portes internes utilisent alors des SAVEPOINT (un COMMIT
    // intermédiaire validerait tout — jamais en dry-run).
    if (sec) await client.query('BEGIN');
    let sp = 0;
    const stats = {
      patients_nouveaux: 0, patients_rejoues: 0, patients_revues: 0,
      naissances_posees: 0, naissances_presentes: 0, naissances_absentes: 0,
      naissances_invraisemblables: 0,
      revues: 0, echecs: [],
    };
    const traites = new Set(); // source_patient_id comptabilisés (importé/rejoué/revue)
    const execGate = async (fn, params, identite) => {
      if (!/^[0-9a-fA-F-]{36}$/.test(identite)) throw new Error('Identité praticien invalide.');
      const prelude = sec ? `SAVEPOINT mig_sp_${++sp}` : 'BEGIN';
      const valide = sec ? `RELEASE SAVEPOINT mig_sp_${sp}` : 'COMMIT';
      const annule = sec ? `ROLLBACK TO SAVEPOINT mig_sp_${sp}` : 'ROLLBACK';
      await client.query(prelude);
      try {
        // Même motif que withCaller : SET LOCAL ROLE (identifiant fixe, jamais
        // concaténé) + identité liée via set_config.
        await client.query('SET LOCAL ROLE authenticated');
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [identite]);
        const names = params.map((_, i) => `$${i + 1}`).join(', ');
        const r = await client.query(`SELECT app.${fn}(${names}) AS v`, params);
        await client.query(valide);
        return r.rows[0].v;
      } catch (e) {
        await client.query(annule);
        throw e;
      }
    };

    // ---- purge du clinique d'un lot (périmètre identité, 127) ----
    // Owner uniquement (porte), bornée au lot + cabinet, DELETE journalisés.
    // Écriture réelle immédiate : aucun dry-run pour la purge (la porte
    // compte avant de détruire, et la source reste réimportable).
    if (o.mode === 'purge') {
      await client.query('BEGIN');
      let resultat;
      try {
        await client.query('SET LOCAL ROLE authenticated');
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [o.practitionerId]);
        const r = await client.query('SELECT app.legacy_purge_batch_clinical($1) AS v', [o.purgeBatchId]);
        await client.query('COMMIT');
        resultat = r.rows[0].v;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
      const rapportPurge = {
        migration: 'legacy_syglab_purge', batch_id: o.purgeBatchId,
        purge: resultat, status: 'PURGED',
      };
      const outDir = o.reportOut ?? o.extractDir;
      fs.writeFileSync(path.join(outDir, 'migration_purge_report.json'),
        JSON.stringify(rapportPurge, null, 1), 'utf8');
      console.log(JSON.stringify({ phase: 'purge', batch_id: o.purgeBatchId, ...resultat }));
      return;
    }

    const hashes = {
      extracted: sha256File(path.join(o.extractDir, 'legacy_patients_extracted.json')),
      rapport: sha256File(path.join(o.extractDir, 'legacy_patients_extraction_report.json')),
      revue: sha256File(path.join(o.extractDir, 'legacy_patients_manual_review.json')),
    };
    const label = o.label ?? `syglab-1558-${new Date().toISOString().slice(0, 10)}`;
    const batchId = await execGate('legacy_start_batch', [label, JSON.stringify(hashes)], o.practitionerId);
    console.log(JSON.stringify({ phase: 'batch', batch_id: batchId, dry_run: sec }));

    const revueFaite = async (entite, ref, motif, preuve, action) => {
      const id = await execGate('legacy_open_review',
        [batchId, entite, ref, motif, JSON.stringify(preuve), action ?? null], o.practitionerId);
      stats.revues++;
      return id;
    };

    // ---- patients : identité uniquement (nom, téléphone, carte, naissance) ----
    // Périmètre 127 : aucun historique, aucune ordonnance, aucun médicament.
    const dejaLa = async (kind, ref) =>
      execGate('legacy_map_lookup', [kind, ref], o.practitionerId);
    // Lecture ciblée via la porte (retourne la ligne, jamais de SELECT direct).
    const lireNaissance = async (mindcareId) => {
      const prelude = sec ? `SAVEPOINT mig_sp_${++sp}` : 'BEGIN';
      const valide = sec ? `RELEASE SAVEPOINT mig_sp_${sp}` : 'COMMIT';
      const annule = sec ? `ROLLBACK TO SAVEPOINT mig_sp_${sp}` : 'ROLLBACK';
      await client.query(prelude);
      try {
        await client.query('SET LOCAL ROLE authenticated');
        await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [o.practitionerId]);
        const r = await client.query('SELECT birth_date FROM app.get_patient($1)', [mindcareId]);
        await client.query(valide);
        return r.rows.length > 0 ? r.rows[0].birth_date : undefined;
      } catch (e) {
        await client.query(annule);
        throw e;
      }
    };
    for (const p of patients) {
      const sid = String(p.source_patient_id);
      const csv = patientsCsv.get(sid);
      if (!csv || (isEmpty(csv.nom) && isEmpty(csv.prenom))) {
        await revueFaite('patient', `patient:${sid}`, 'weak_identity',
          { source_patient_id: sid, raison: 'identité vide ou ligne CSV absente' },
          'Vérifier l\u2019identité source avant tout import.');
        stats.patients_revues++;
        traites.add(sid);
        continue;
      }
      const phones = (p.phone_numbers ?? []).map(verbatim).filter(s => s !== '');
      const phone = phones.length > 0 ? phones[0] : null;
      if (phone !== null && !isPhoneStorable(phone)) {
        // Importé SANS téléphone (D2) ; la valeur d'origine est préservée
        // dans la preuve de revue pour correction manuelle.
        await revueFaite('patient', `patient:${sid}`, 'weak_identity',
          { source_patient_id: sid, raison: 'téléphone hors format CHECK',
            valeur_originale: phone },
          'Corriger manuellement, jamais deviner.');
        stats.patients_revues++;
      }
      const phoneStocke = phone !== null && isPhoneStorable(phone) ? phone : null;
      const naissance = parseNaissance(csv.naissance);
      if (naissance.invraisemblable) {
        await revueFaite('patient', `patient:${sid}:naissance`, 'implausible_date',
          { source_patient_id: sid, valeur_originale: naissance.original },
          'Vérifier la date source ; stockée verbatim en attendant.');
        stats.naissances_invraisemblables++;
      }
      let mindcareId = await dejaLa('patient', sid);
      if (mindcareId) {
        stats.patients_rejoues++;
      } else {
        try {
          mindcareId = await execGate('legacy_import_patient',
            [batchId, sid, csv.prenom, csv.nom, phoneStocke,
              isEmpty(csv.cdi) ? null : csv.cdi, o.practitionerId,
              sha256Hex(`${sid}|${csv.nom}|${csv.prenom}`),
              naissance.date],
            o.practitionerId);
          stats.patients_nouveaux++;
        } catch (e) {
          stats.echecs.push({ patient: sid, porte: 'legacy_import_patient', code: e.code ?? null });
          await revueFaite('patient', `patient:${sid}`, 'weak_identity',
            { source_patient_id: sid, raison: 'porte import refusée', code: e.code ?? null },
            'Examiner puis réimporter ce seul dossier.');
          stats.patients_revues++;
          traites.add(sid);
          continue;
        }
      }
      // Idempotence visible : rejouer retourne l'existant (compté, pas dupliqué).
      traites.add(sid);

      // Backfill naissance : posée seulement si absente (jamais écrasée).
      // Porte existante update_patient (018), journalisée par trg_audit.
      try {
        const actuelle = await lireNaissance(mindcareId);
        if (actuelle === undefined) {
          stats.echecs.push({ patient: sid, porte: 'get_patient', code: 'introuvable' });
        } else if (actuelle === null) {
          if (naissance.date) {
            await execGate('update_patient',
              [mindcareId, JSON.stringify({ birth_date: naissance.date })],
              o.practitionerId);
            stats.naissances_posees++;
          } else {
            stats.naissances_absentes++;
          }
        } else {
          stats.naissances_presentes++;
        }
      } catch (e) {
        stats.echecs.push({ patient: sid, porte: 'naissance_backfill', code: e.code ?? null });
      }
    }

    // ---- revue : doublons + identités faibles (périmètre identité) ----
    // Contenu clinique (médicaments, orphelines, dates d'ordonnances) : hors
    // périmètre depuis 127 — aucune revue rouverte pour lui. Les revues du
    // lot purgé ont été closes par la porte de purge, audit à l'appui.
    const groupes = rapport.possible_duplicate_groups ?? [];
    for (const g of groupes) {
      const membres = [...new Set([...(g.membres ?? g.members ?? [])].map(String))];
      if (membres.length < 2) continue;
      const motif = String(g.match_on ?? g.matchOn ?? 'inconnu');
      // Le motif fait partie de la clé : une même paire appariée à la fois
      // par N° carte et par téléphone vaut DEUX faisceaux de preuve.
      await revueFaite('duplicate_group', `${membres.sort().join('|')}#${motif}`, 'possible_duplicate',
        { membres, appariement: motif, source: 'extraction' },
        'KEEP_SEPARATE sauf décision humaine tracée.');
    }
    for (const item of revue) {
      // Périmètre identité : seules les revues d'identité et de doublons
      // sont rouvertes. Le clinique purgé ne rouvre rien (déjà clos par
      // la porte de purge sur le lot source).
      if (item.issue === 'prescription_line_unmatched_medicament') continue;
      if (item.issue === 'orphan_ordonnances_no_matching_patient') continue;
      if (item.issue === 'no_recoverable_historique') continue;
      const sid = item.source_patient_id == null ? null : String(item.source_patient_id);
      const motif = { weak_identity_no_phone_no_id_card: 'weak_identity', missing_name: 'weak_identity', missing_legacy_id: 'weak_identity' }[item.issue] ?? 'weak_identity';
      await revueFaite('patient', `patient:${sid ?? item.field ?? item.issue}`, motif,
        { extraction_issue: item.issue, source_patient_id: sid, champ: item.field ?? null },
        'Revue humaine.');
    }

    // ---- clôture + rapport vivant (périmètre identité, 127) ----
    await execGate('legacy_finalize_batch', [batchId, stats.echecs.length === 0 ? 'imported' : 'failed'], o.practitionerId);
    const rep = await execGate('legacy_get_report', [batchId], o.practitionerId);
    const sourceCounts = {
      patientsSource: patients.length,
    };
    const gateCounts = {
      batch_id: rep.batch_id, batch_status: rep.batch_status,
      patients_imported: Number(rep.patients_imported),
      reviews_open: Number(rep.reviews_open),
      reviews_total: Number(rep.reviews_total),
      duplicates_pending: Number(rep.duplicates_pending),
      status: rep.status,
    };
    const patientsComptabilises = traites.size;
    const patientsPerdus = Math.max(0, patients.length - patientsComptabilises);
    const status = (patientsPerdus > 0)
      ? 'BLOCKED'
      : (stats.echecs.length > 0 ? 'BLOCKED' : gateCounts.status);
    const final = {
      migration: 'legacy_syglab_identity', scope: 'identity-only (nom, telephone, carte, naissance)',
      batch_id: batchId, dry_run: sec, label,
      source_hashes: hashes, validation, execution: stats,
      source_counts: sourceCounts, gate_counts: gateCounts,
      patients_comptabilises: patientsComptabilises,
      patients_perdus: patientsPerdus, failures: stats.echecs, status,
    };
    const outDir = o.reportOut ?? o.extractDir;
    fs.writeFileSync(path.join(outDir, sec ? 'migration_identity_dryrun_report.json' : 'migration_identity_report.json'),
      JSON.stringify(final, null, 1), 'utf8');
    console.log(JSON.stringify({
      phase: 'report', status, patients_imported: gateCounts.patients_imported,
      naissances_posees: stats.naissances_posees,
      naissances_invraisemblables: stats.naissances_invraisemblables,
      reviews_open: gateCounts.reviews_open,
      echecs: stats.echecs.length,
    }));
    if (sec) {
      await client.query('ROLLBACK');
      console.log(JSON.stringify({ phase: 'dryrun', persiste: false }));
    }
  } finally {
    await client.end();
  }
}

main().catch(e => {
  // Jamais de secret ni de PII : code d'erreur uniquement (message détaillé
  // seulement en mode debug local explicite, jamais commité dans un rapport).
  const debug = process.env.MINDCARE_MIGRATION_DEBUG === '1';
  console.error(JSON.stringify({ erreur: 'migration', code: e.code ?? null,
    detail: debug ? String(e.message ?? e).slice(0, 300) : undefined }));
  process.exit(1);
});
