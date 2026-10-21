import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';

/** Technical codes only: no URLs, exception messages, tokens or clinical content. */
export function journalDesktop(dossier: string, evenement: string, valeur?: number | boolean): void {
  if (!/^[A-Z_]{1,64}$/.test(evenement)) return;
  try {
    mkdirSync(dossier, { recursive: true });
    const fichier = path.join(dossier, 'desktop-lifecycle.jsonl');
    if (existsSync(fichier) && statSync(fichier).size > 524288) {
      rmSync(`${fichier}.1`, { force: true });
      renameSync(fichier, `${fichier}.1`);
    }
    appendFileSync(fichier, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, evenement, ...(valeur === undefined ? {} : { valeur }) }) + '\n');
  } catch { /* Diagnostics must never block application access. */ }
}
