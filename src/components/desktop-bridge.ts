/**
 * Le pont vers le processus principal Electron — usage RENDERER uniquement.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═════════════════════════════════════════════
 *
 * Le renderer est un client NON FIABLE (`contextIsolation`, `sandbox`,
 * `nodeIntegration: false`). Il ne peut donc pas afficher une notification
 * Windows native ni faire clignoter la barre des tâches : ces gestes
 * appartiennent au processus principal, exposés par un canal IPC nommé dans
 * `electron/preload/index.cts`.
 *
 * La gestion des postes appairés, elle, NE passe PAS par ce pont : elle est
 * servie par des routes `/api/cabinet/*` (le processus backend tourne sous le
 * compte SYSTEM de l'hôte et peut lire le dossier privé). Moins de surface
 * exposée au renderer, et une seule autorisation — celle de la session.
 *
 * ═══ CE QUE CE MODULE NE FAIT PAS ═══════════════════════════════════════════
 *
 * Il ne suppose JAMAIS que le pont existe. Dans un navigateur (développement
 * web, tests), `window.mindcare` est absent : chaque fonction rend `false` et
 * l'appelant retombe sur le comportement web (bandeau + son Web Audio). Une
 * fonctionnalité qui exigerait Electron pour ne pas planter serait une
 * régression du mode navigateur, pas une avancée.
 */

export interface AlerteAppel {
  readonly callId: string;
  readonly callerName: string;
}

interface PontMindcare {
  readonly notifyDoctorCall?: (alerte: AlerteAppel) => Promise<boolean>;
  readonly stopDoctorCall?: () => Promise<boolean>;
}

declare global {
  interface Window {
    readonly mindcare?: PontMindcare;
    /**
     * Safari/anciens Chromium exposent le constructeur sous ce nom. Déclaré ici
     * plutôt que forcé par une double assertion — le dépôt interdit `as unknown
     * as T`, et une assertion en deux temps masquerait exactement le contrôle
     * qu'on veut garder.
     */
    readonly webkitAudioContext?: typeof AudioContext;
  }
}

function pont(): PontMindcare | undefined {
  if (typeof window === "undefined") return undefined;
  return window.mindcare;
}

/** Vrai quand l'application tourne dans la coquille Electron installée. */
export function pontDisponible(): boolean {
  const p = pont();
  return p !== undefined && typeof p.notifyDoctorCall === "function";
}

/**
 * Demande au processus principal d'afficher la notification Windows et de
 * faire clignoter la barre des tâches. Rend `false` si le pont est absent ou
 * si l'appel échoue — l'appelant ne doit pas annoncer une remise sur la foi
 * d'un échec silencieux.
 */
export async function notifierAppelDoctor(alerte: AlerteAppel): Promise<boolean> {
  const p = pont();
  if (p?.notifyDoctorCall === undefined) return false;
  try {
    return (await p.notifyDoctorCall(alerte)) === true;
  } catch {
    return false;
  }
}

/** Arrête le clignotement de la barre des tâches (accusé ou expiration). */
export async function arreterClignotement(): Promise<void> {
  const p = pont();
  if (p?.stopDoctorCall === undefined) return;
  try {
    await p.stopDoctorCall();
  } catch {
    /* un clignotement qui s'arrête mal n'est pas un incident */
  }
}

/**
 * Un court carillon à deux tons, synthétisé localement (aucun fichier, aucun
 * réseau). Il ne prouve rien : `AudioContext` peut être suspendu, le volume
 * système coupé, les haut-parleurs débranchés. C'est pourquoi l'interface ne
 * dit jamais « la secrétaire a entendu », seulement « notification affichée ».
 */
export function jouerCarillon(): void {
  try {
    const Contexte = window.AudioContext ?? window.webkitAudioContext;
    if (Contexte === undefined) return;

    const contexte = new Contexte({ latencyHint: "interactive" });
    const maintenant = contexte.currentTime;

    const note = (frequence: number, debut: number, duree: number, gain: number): void => {
      const oscillateur = contexte.createOscillator();
      const enveloppe = contexte.createGain();
      oscillateur.type = "sine";
      oscillateur.frequency.value = frequence;
      enveloppe.gain.setValueAtTime(0, maintenant + debut);
      enveloppe.gain.linearRampToValueAtTime(gain, maintenant + debut + 0.02);
      enveloppe.gain.exponentialRampToValueAtTime(0.0001, maintenant + debut + duree);
      oscillateur.connect(enveloppe);
      enveloppe.connect(contexte.destination);
      oscillateur.start(maintenant + debut);
      oscillateur.stop(maintenant + debut + duree + 0.05);
    };

    // Do5 puis mi5 : un intervalle montant, court, reconnaissable sans être
    // strident. Deux notes suffisent à distinguer l'alerte d'un autre son du
    // système.
    note(523.25, 0, 0.22, 0.16);
    note(659.25, 0.24, 0.34, 0.14);

    const fermer = (): void => {
      void contexte.close().catch(() => {});
    };
    setTimeout(fermer, 1_200);
  } catch {
    /* pas de son : le bandeau reste, c'est lui qui porte l'information */
  }
}
