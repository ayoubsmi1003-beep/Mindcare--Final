/**
 * Lecture des DLL importées par un exécutable/DLL Windows (format PE/COFF).
 *
 * ═══ POURQUOI CE PARSEUR, PLUTÔT QU'UNE LISTE ÉCRITE À LA MAIN ═════════════
 *
 * `scripts/elaguer-pgsql.mjs` doit décider quelles DLL du paquet PostgreSQL
 * emporter aux côtés de `postgres.exe`, `initdb.exe`, `psql.exe`,
 * `pg_dump.exe`, `pg_restore.exe`, `pg_ctl.exe` et des quatre extensions
 * utilisées (§C, §I du plan). Une liste de DLL établie « à l'œil » — en
 * lisant le nom des fichiers — se trompe dans les deux sens : elle oublie
 * une dépendance transitive (`libpq.dll` a besoin de `libssl-3-x64.dll`, qui
 * a besoin de `libcrypto-3-x64.dll`), et elle ne peut jamais PROUVER qu'une
 * DLL retirée n'était pas chargée. Ce module lit la table d'imports réelle
 * du binaire — le format que le chargeur Windows lui-même utilise pour
 * résoudre ses dépendances — ce qui rend la liste vérifiable plutôt que
 * plausible.
 *
 * ═══ CE QUE CE MODULE FAIT, ET RIEN DE PLUS ════════════════════════════════
 *
 * Il lit l'en-tête DOS, l'en-tête NT, la table des sections, puis la
 * DIRECTORY ENTRY IMPORT du Optional Header — la liste des DLL dont le nom
 * apparaît dans IMAGE_IMPORT_DESCRIPTOR. Il ne résout AUCUNE fonction
 * importée (inutile ici : on veut savoir QUELLES DLL, pas QUELLES
 * fonctions), et ne modifie jamais le fichier lu.
 */
import { readFileSync } from "node:fs";

/** RVA (Relative Virtual Address) → décalage dans le fichier, via la table des sections. */
function rvaVersDecalage(sections, rva) {
  for (const section of sections) {
    if (rva >= section.virtualAddress && rva < section.virtualAddress + section.tailleVirtuelle) {
      return section.pointeurDonneesBrutes + (rva - section.virtualAddress);
    }
  }
  return null;
}

function lireChaineAsciiNulle(buffer, decalage) {
  const fin = buffer.indexOf(0, decalage);
  return buffer.subarray(decalage, fin === -1 ? buffer.length : fin).toString("ascii");
}

/**
 * @param {string} cheminBinaire
 * @returns {string[]} noms de DLL importées (ex. `["KERNEL32.dll", "libpq.dll"]`), en minuscules.
 */
export function dllImportees(cheminBinaire) {
  const buf = readFileSync(cheminBinaire);

  if (buf.readUInt16LE(0) !== 0x5a4d) {
    throw new Error(`${cheminBinaire} : signature DOS 'MZ' absente — ce n'est pas un PE valide.`);
  }
  const decalagePE = buf.readUInt32LE(0x3c);
  if (buf.readUInt32LE(decalagePE) !== 0x00004550) {
    throw new Error(`${cheminBinaire} : signature 'PE\\0\\0' absente.`);
  }

  const decalageCOFF = decalagePE + 4;
  const nombreSections = buf.readUInt16LE(decalageCOFF + 2);
  const tailleEnTeteOptionnel = buf.readUInt16LE(decalageCOFF + 16);
  const decalageEnTeteOptionnel = decalageCOFF + 20;

  const magic = buf.readUInt16LE(decalageEnTeteOptionnel);
  // PE32 (0x10b) : la Data Directory commence à +96 dans l'en-tête optionnel.
  // PE32+ (0x20b, binaires 64 bits — le cas de tous les exécutables ici) : +112.
  const decalageDataDirectory = decalageEnTeteOptionnel + (magic === 0x20b ? 112 : 96);
  const INDEX_IMPORT = 1; // IMAGE_DIRECTORY_ENTRY_IMPORT
  const rvaImport = buf.readUInt32LE(decalageDataDirectory + INDEX_IMPORT * 8);
  const tailleImport = buf.readUInt32LE(decalageDataDirectory + INDEX_IMPORT * 8 + 4);

  const decalageSections = decalageEnTeteOptionnel + tailleEnTeteOptionnel;
  const sections = [];
  for (let i = 0; i < nombreSections; i++) {
    const o = decalageSections + i * 40;
    sections.push({
      virtualAddress: buf.readUInt32LE(o + 12),
      tailleVirtuelle: buf.readUInt32LE(o + 8),
      pointeurDonneesBrutes: buf.readUInt32LE(o + 20),
    });
  }

  if (rvaImport === 0 || tailleImport === 0) return []; // aucune dépendance externe

  const decalageImport = rvaVersDecalage(sections, rvaImport);
  if (decalageImport === null) {
    throw new Error(`${cheminBinaire} : RVA de la table d'imports hors de toute section.`);
  }

  const noms = [];
  // Chaque IMAGE_IMPORT_DESCRIPTOR fait 20 octets ; la table se termine par
  // une entrée entièrement à zéro.
  for (let o = decalageImport; ; o += 20) {
    const rvaNom = buf.readUInt32LE(o + 12);
    if (rvaNom === 0) break;
    const decalageNom = rvaVersDecalage(sections, rvaNom);
    if (decalageNom !== null) noms.push(lireChaineAsciiNulle(buf, decalageNom).toLowerCase());
  }
  return noms;
}
