/**
 * Le pont preload — TOUTE la surface que le renderer (non fiable, §22 de la
 * mission) peut atteindre du processus principal. Rien d'autre n'existe.
 *
 * ⚠️ Ce fichier tourne avec `contextIsolation: true` : `contextBridge` est le
 * SEUL passage. Aucun `require`, aucun `ipcRenderer` brut n'est exposé — le
 * renderer continue de se comporter comme un client non fiable, exactement
 * comme dans le navigateur aujourd'hui (§5 de la mission).
 *
 * Les canaux `ouvrirJournaux` et `lancerSauvegarde` sont ajoutés aux étapes
 * ultérieures du plan (I, J) ; ils sont déclarés ici pour fixer la forme
 * définitive de la surface IPC dès l'étape 1, mais renvoient un refus
 * explicite tant que le processus principal ne les implémente pas.
 *
 * ⚠️ EXTENSION `.cts`, PAS `.ts` — TROUVÉ PAR ÉCHEC RÉEL À L'INSTALLATION.
 * `package.json` du dépôt porte `"type": "module"`, et ce fichier est
 * empaqueté seul (aucun `package.json` propre à `dist-electron/preload/`).
 * Electron charge pourtant TOUJOURS un script de preload avec le chargeur
 * CommonJS de Node, quel que soit le type de module ailleurs dans l'app —
 * contrairement au processus principal, qui accepte l'ESM. Compilé en `.js`
 * ordinaire, ce fichier héritait du `"type": "module"` du dépôt et sortait
 * en `import …` : Electron le rejetait avec `Cannot use import statement
 * outside a module`, avant même que la fenêtre ne s'affiche — un écran
 * blanc au premier lancement du paquet installé, jamais vu en développement
 * (`pnpm dev:electron` ne charge pas ce fichier compilé de la même façon).
 * `.cts` fait émettre TypeScript en CommonJS PENDANT que le reste du dossier
 * `electron/` continue en ESM (`tsconfig.json` racine et `electron/
 * tsconfig.json` n'ont pas changé) — le source garde sa syntaxe `import`,
 * seule l'extension change.
 */
import { contextBridge, ipcRenderer } from "electron";

const API_MINDCARE = {
  getVersion(): Promise<string> {
    return ipcRenderer.invoke("mindcare:version");
  },
  onStartupState(cb: (etat: string) => void): () => void {
    const ecouteur = (_evt: unknown, etat: unknown) => {
      if (typeof etat === "string") cb(etat);
    };
    ipcRenderer.on("mindcare:etat-demarrage", ecouteur);
    return () => ipcRenderer.removeListener("mindcare:etat-demarrage", ecouteur);
  },
  openLogsFolder(): Promise<void> {
    return ipcRenderer.invoke("mindcare:ouvrir-journaux");
  },
  runBackup(): Promise<void> {
    return ipcRenderer.invoke("mindcare:lancer-sauvegarde");
  },
} as const;

contextBridge.exposeInMainWorld("mindcare", API_MINDCARE);

export type ApiMindcare = typeof API_MINDCARE;
