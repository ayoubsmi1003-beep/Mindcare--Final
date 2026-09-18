import AdmZip from "adm-zip";

export function canoniqueBrut(v) { return v.trim().replace(/\s+/g, " "); }
export function lireXlsxPremiereColonne(fichier) {
  const zip = new AdmZip(fichier);
  const ss = zip.getEntry("xl/sharedStrings.xml");
  const sh = zip.getEntry("xl/worksheets/sheet1.xml");
  if (!ss || !sh) throw new Error("XLSX invalide : sharedStrings ou sheet1 manquant");
  const ssXml = ss.getData().toString("utf8");
  const shXml = sh.getData().toString("utf8");
  const vals = [];
  const re = /<t[^>]*>(.*?)<\/t>/g;
  let m;
  while ((m = re.exec(ssXml)) !== null) {
    vals.push(m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'"));
  }
  const lignes = [];
  const reV = /<v>(\d+)<\/v>/g;
  while ((m = reV.exec(shXml)) !== null) {
    const i = parseInt(m[1], 10);
    lignes.push(i >= 0 && i < vals.length ? vals[i] : null);
  }
  return lignes;
}
const FORMES = ["cp pellic", "cp enrobe", "cp gastroresistant", "cp orodispers", "cp LP", "cp", "gelule", "crème", "gel", "sol buv", "sol inj", "sirop", "susp", "amp", "suppo", "caps", "comprime", "comprimé"];
export function analyserEtiquette(brut) {
  const low = brut.toLowerCase();
  let forme = null;
  for (const f of [...FORMES].sort((a, b) => b.length - a.length)) {
    if (low.includes(f)) { forme = f; break; }
  }
  const dm = brut.match(/(\d[\d\s.,]*\s*(?:mg|µg|ug|mcg|g|%|UI|U|ml)\b)/i);
  const dosage = dm ? dm[1].replace(/\s+/g, " ").trim() : null;
  let marque = null;
  if (dm && dm.index !== undefined && dm.index > 0) {
    marque = brut.slice(0, dm.index).trim().replace(/\s+/g, " ") || null;
  } else if (forme) {
    const idx = low.indexOf(forme);
    if (idx > 0) marque = brut.slice(0, idx).trim().replace(/\s+/g, " ") || null;
  }
  if (marque === null) marque = brut;
  return { marque, forme, dosage };
}
