#!/usr/bin/env node
/**
 * import-medicaments — catalogue 15 645 lignes, idempotent, preservatif.
 *
 * Usage:
 *   node scripts/import-medicaments.mjs --file docs/Médicaments.xlsx
 *   node scripts/import-medicaments.mjs --file docs/Médicaments.xlsx --dry-run
 *
 * Environnement: lit DATABASE_URL (.env) si present, sinon Supabase cloud.
 * Respecte ADR-028: source_fingerprint = sha256(canonical_raw) où canonical = trim + collapse whitespace.
 * normalized_search = lower(unaccent(trim(raw))) JS mirror de app.immutable_unaccent.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import AdmZip from 'adm-zip';

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(){
  const p = path.join(RACINE, '.env');
  if(!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p,'utf8');
  for(const line of txt.split(/\r?\n/)){
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if(!m) continue;
    const k = m[1];
    let v = m[2] ?? '';
    // keep raw value (no trim of internal spaces), but strip surrounding quotes
    v = v.trim();
    if((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1,-1);
    if(v.startsWith(' ')) v = v.trimStart();
    if(process.env[k] === undefined) process.env[k]=v;
  }
}
loadDotEnv();

function parseArgs(){
  const a = process.argv.slice(2);
  let file = null;
  let dry = false;
  for(let i=0;i<a.length;i++){
    if(a[i]==='--file' && a[i+1]){ file=a[i+1]; i++; }
    else if(a[i].startsWith('--file=')){ file=a[i].slice('--file='.length); }
    else if(a[i]==='--dry-run'){ dry=true; }
  }
  if(!file) file = path.join(RACINE,'docs','Médicaments.xlsx');
  return {file,dry};
}

function canonicalRaw(v){
  // spec §3 : trim + collapse repeated whitespace (preserve meaningful text)
  return v.trim().replace(/\s+/g,' ');
}
function normalizedSearch(v){
  // mirror app.immutable_unaccent(lower(trim)) — JS NFD strip diacritics
  const t = v.trim().toLowerCase();
  // NFD decomposition + remove combining marks
  // also handle ligatures like \u0153\u00e6? Unaccent extension handles broader.
  return t.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
}
function fingerprint(canonical){
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}
function fileSha256(filePath){
  const buf = fs.readFileSync(filePath);
  return 'sha256:' + crypto.createHash('sha256').update(buf).digest('hex');
}

// Advisory parsing — heuristic, never fabricate.
function parseAdvisory(raw){
  // raw like "ACIDE FOLIQUE ARROW 5 mg cp" or "AERIUS 5 mg cp pellic"
  // Try to extract strength: \d[.,\d]*\s*(mg|µg|ug|g|%|UI|U|ml|mcg) possibly with /...
  // Form: list known forms
  const forms = ['cp pellic','cp enrobe','cp gastroresistant','cp orodispers','cp séc','cp LP','cp','gél','gelule','gélule','crème','gel','sol buv','sol inj','sol p perf','collyre','pdre','LP','séc','sirop','susp','amp','gran','suppo','caps','comprime','comprimé'];
  let form = null;
  const low = raw.toLowerCase();
  // longest match
  for(const f of forms.sort((a,b)=>b.length-a.length)){
    if(low.includes(f)){
      form = f;
      break;
    }
  }
  // strength regex
  const m = raw.match(/(\d[\d\s.,]*\s*(?:mg|µg|ug|mcg|g|%|UI|U|ml)\b(?:\s*\/\s*\d[\d\s.,]*\s*(?:mg|µg|ug|mcg|g|%|UI|ml))?)/i);
  let strength = m ? m[1].replace(/\s+/g,' ').trim() : null;
  // brand/inn advisory: first token(s) before strength or before form
  // Very rough: take substring up to strength index, trim.
  let brand = null;
  let inn = null;
  if(strength){
    const idx = raw.indexOf(m[1]);
    const prefix = raw.slice(0, idx).trim();
    // brand is prefix without dosage prefix? Keep as brand, inn null for now
    // If prefix contains space, first word could be inn? We keep whole prefix as brand.
    if(prefix) brand = prefix.replace(/\s+/g,' ').trim() || null;
  } else if(form){
    const idx = low.indexOf(form);
    if(idx>0){
      const prefix = raw.slice(0, idx).trim();
      if(prefix) brand = prefix.replace(/\s+/g,' ').trim() || null;
    }
  }
  // inn: not reliably extractable without ATC; leave null to avoid fabrication
  // If brand contains known pattern like "ACIDE FOLIQUE ..." keep brand there
  inn = null; // advisory only, never claim
  return {brand, inn, form, strength};
}

function readXlsxFirstColumn(filePath){
  const zip = new AdmZip(filePath);
  const entries = zip.getEntries();
  const sharedEntry = zip.getEntry('xl/sharedStrings.xml');
  const sheetEntry = zip.getEntry('xl/worksheets/sheet1.xml');
  if(!sharedEntry || !sheetEntry) throw new Error('XLSX invalide: sharedStrings ou sheet1 manquant');
  const ssXml = sharedEntry.getData().toString('utf8');
  const shXml = sheetEntry.getData().toString('utf8');
  // extract strings: <t>value</t>
  const vals = [];
  const re = /<t[^>]*>(.*?)<\/t>/g;
  let m;
  while((m=re.exec(ssXml))!==null){
    // decode XML entities minimal
    let v = m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
    vals.push(v);
  }
  // sheet maps <c ...><v>idx</v></c> in order; <row><c><v>idx</v>
  const reV = /<v>(\d+)<\/v>/g;
  const rows = [];
  while((m=reV.exec(shXml))!==null){
    const idx = parseInt(m[1],10);
    if(idx>=0 && idx<vals.length) rows.push(vals[idx]);
    else rows.push(null);
  }
  return rows; // each row = raw string or null, 1 col
}

async function main(){
  const {file,dry} = parseArgs();
  const absFile = path.isAbsolute(file) ? file : path.join(RACINE, file);
  if(!fs.existsSync(absFile)) throw new Error(`Fichier introuvable: ${absFile}`);
  const sourceVersion = fileSha256(absFile);
  const rawRows = readXlsxFirstColumn(absFile);
  // rawRows includes every row's first col; file has no header, A1 is data
  // filter out null/empty after trim
  let total = rawRows.length;
  let invalid = 0;
  let duplicates = 0;
  const seen = new Map(); // fingerprint -> canonical
  const toUpsert = []; // {canonical, raw, fp, normalized, parsed}
  for(const r of rawRows){
    if(r===null || r===undefined) { invalid++; continue; }
    const trimmed = r.trim();
    if(trimmed==='') { invalid++; continue; }
    const canon = canonicalRaw(trimmed);
    if(canon===''){ invalid++; continue; }
    const fp = fingerprint(canon);
    if(seen.has(fp)){
      duplicates++;
      continue;
    }
    seen.set(fp, canon);
    const norm = normalizedSearch(canon);
    const parsed = parseAdvisory(canon);
    toUpsert.push({canonical:canon, raw: canon, fp, normalized: norm, parsed});
  }
  // Now DB upsert
  let dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || '';
  // fallback: try to read .env already loaded; if still empty, use known pooler with encode
  if(!dbUrl){
    // Try to compose from .env fields? Already loaded env contains DATABASE_URL raw with spaces
    dbUrl = (fs.readFileSync(path.join(RACINE,'.env'),'utf8').match(/DATABASE_URL\s*=\s*(.+)/)?.[1]?.trim() || '').replace(/^"|"$/g,'');
  }
  if(!dbUrl){
    throw new Error('DATABASE_URL manquante — ne peut pas importer');
  }
  dbUrl = dbUrl.trim();

  console.log(`Import catalogue — source: ${path.relative(RACINE, absFile)}`);
  console.log(`  total rows in sheet: ${total}`);
  console.log(`  unique canonical: ${toUpsert.length}`);
  console.log(`  duplicates in file: ${duplicates}`);
  console.log(`  invalid (empty): ${invalid}`);
  console.log(`  sourceVersion: ${sourceVersion}`);
  if(dry){
    console.log('  DRY RUN — aucun INSERT');
    console.log(JSON.stringify({total, toUpsert: toUpsert.length, duplicates, invalid, sourceVersion}, null,2));
    return;
  }

  const client = new pg.Client({connectionString: dbUrl});
  await client.connect();
  const t0 = Date.now();
  let imported=0, updated=0, skipped=0;
  try{
    await client.query('BEGIN');
    // Batch upsert: use UNNEST for performance
    // We'll do single query with VALUES list batched 500 rows
    const batch = 500;
    for(let i=0;i<toUpsert.length;i+=batch){
      const slice = toUpsert.slice(i, i+batch);
      // Build query: INSERT INTO app.medications (inn, brand_name, form, strength, source, is_active, source_raw_value, normalized_search, source_fingerprint, source_version)
      // Advisory: inn -> parsed.inn (null), brand_name -> parsed.brand, form->parsed.form, strength->parsed.strength
      // inn NOT NULL in schema -> fallback to brand or raw first word
      const values = [];
      const params = [];
      let pIdx=1;
      for(const row of slice){
        // inn is NOT NULL -> use parsed.brand first word or raw first token as inn fallback, but never fabricate ATC
        // Use whole canonical as inn fallback? Better use canonical first word? Use parsed.brand || canonical
        let inn = row.parsed.inn;
        if(!inn){
          // Use first token of canonical as inn-ish placeholder? Better use canonical as inn? 009 requires inn NOT NULL.
          // We'll use canonical raw truncated as inn if brand present else canonical
          // But inn is molecule name; for advisory, store brand as inn if no better
          inn = row.parsed.brand || row.canonical;
          // Truncate to reasonable? Keep as is.
        }
        // brand_name = parsed.brand (advisory)
        values.push(`($${pIdx}, $${pIdx+1}, $${pIdx+2}, $${pIdx+3}, $${pIdx+4}, $${pIdx+5}, $${pIdx+6}, $${pIdx+7}, $${pIdx+8}, $${pIdx+9})`);
        params.push(inn);
        params.push(row.parsed.brand);
        params.push(row.parsed.form);
        params.push(row.parsed.strength);
        params.push('vidal'); // source
        params.push(true);
        params.push(row.raw);
        params.push(row.normalized);
        params.push(row.fp);
        params.push(sourceVersion);
        pIdx+=10;
      }
      const sql = `
        INSERT INTO app.medications (inn, brand_name, form, strength, source, is_active, source_raw_value, normalized_search, source_fingerprint, source_version)
        VALUES ${values.join(',')}
        ON CONFLICT (source_fingerprint) WHERE source_fingerprint IS NOT NULL
        DO UPDATE SET
          source_raw_value = EXCLUDED.source_raw_value,
          normalized_search = EXCLUDED.normalized_search,
          source_version = EXCLUDED.source_version,
          brand_name = COALESCE(EXCLUDED.brand_name, app.medications.brand_name),
          form = COALESCE(EXCLUDED.form, app.medications.form),
          strength = COALESCE(EXCLUDED.strength, app.medications.strength),
          is_active = true
        WHERE app.medications.source_raw_value IS DISTINCT FROM EXCLUDED.source_raw_value
           OR app.medications.normalized_search IS DISTINCT FROM EXCLUDED.normalized_search
           OR app.medications.source_version IS DISTINCT FROM EXCLUDED.source_version
           OR app.medications.brand_name IS DISTINCT FROM EXCLUDED.brand_name
        RETURNING (xmax = 0) AS inserted;
      `;
      const res = await client.query(sql, params);
      for(const r of res.rows){
        if(r.inserted) imported++; else updated++;
      }
      // For rows where ON CONFLICT happened but values identical, they still count as updated.
      // skipped = duplicate file entries already handled; no separate skipped for unchanged? We'll keep skipped=duplicates+invalid for now
    }
    await client.query('COMMIT');
  }catch(e){
    await client.query('ROLLBACK');
    throw e;
  }finally{
    await client.end();
  }
  const durationMs = Date.now()-t0;
  // Second query to count total active vidal?
  // For reporting, total = rawRows.length, imported/updated as above, skipped = duplicates (file) + maybe unchanged? Keep as duplicates count for now.
  const report = {total, imported, updated, skipped: duplicates, duplicates, invalid, durationMs, sourceVersion};
  console.log('Import terminé:');
  console.log(JSON.stringify(report, null, 2));
  // also write to file for CI
  fs.writeFileSync(path.join(RACINE,'scripts','import-medicaments.report.json'), JSON.stringify(report,null,2));
}

main().catch(e=>{
  console.error('Import échoué:', e.message);
  console.error(e.stack?.slice(0,3000));
  process.exit(1);
});
