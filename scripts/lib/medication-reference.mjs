import fs from 'node:fs';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';

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


export function prepareCatalogue(file) {
 const rawRows=readXlsxFirstColumn(file), seen=new Set(), rows=[];
 for(const raw of rawRows) {
  if(typeof raw!=='string'||!raw.trim())continue;
  const canonical=canonicalRaw(raw),fp=fingerprint(canonical);
  if(seen.has(fp))continue;
  seen.add(fp);rows.push({canonical,raw:canonical,fp,normalized:normalizedSearch(canonical),parsed:parseAdvisory(canonical)});
 }
 return {sourceRows:rawRows.filter(r=>typeof r==='string'&&r.trim()).length,sourceVersion:fileSha256(file),rows};
}
