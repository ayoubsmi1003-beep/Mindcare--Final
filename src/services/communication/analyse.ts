/**
 * Analyseur de demandes RDV — DÉTERMINISTE, sans appel externe.
 *
 * Le LLM comprendra un jour le langage libre ; l'Agenda, lui, décide
 * toujours. Ce module ne fait que structurer (intent/langue/jour/période/
 * heure) pour que le domaine Agenda tranche sur de vraies disponibilités.
 * Aucune donnée ne quitte la machine ici : c'est aussi pourquoi le parsing
 * des confirmations ne passe PAS par un modèle externe (les messages portent
 * des identités, que `classerCharge` bloquerait de toute façon).
 *
 * Fuseau : Alger = UTC+1 toute l'année (pas de DST) — l'arithmétique se fait
 * sur ce décalage fixe, jamais sur le fuseau du poste.
 */

export type LangueMsg = "fr" | "ar" | "darija" | "mixte";
export type IntentRdv =
  | "CONFIRMER"
  | "ANNULER"
  | "REPROGRAMMER"
  | "DEMANDER_RDV"
  | "QUESTION"
  | "INCONNU";
export type Periode = "matin" | "apres_midi" | "soir";

export interface AnalyseRdv {
  readonly intent: IntentRdv;
  readonly langue: LangueMsg;
  /** Date calendaire Alger `AAAA-MM-JJ`, null si non exprimée. */
  readonly jour: string | null;
  readonly periode: Periode | null;
  /** Heure explicite `HH:MM`, null sinon. */
  readonly heure: string | null;
}

const DECALAGE_ALGER_MS = 3_600_000;

/** Jour calendaire Alger de `instant`, en ISO date. */
function jourAlger(instant: Date): string {
  const local = new Date(instant.getTime() + DECALAGE_ALGER_MS);
  const a = local.getUTCFullYear();
  const m = String(local.getUTCMonth() + 1).padStart(2, "0");
  const j = String(local.getUTCDate()).padStart(2, "0");
  return `${a}-${m}-${j}`;
}

/** 0 = dimanche … 6 = samedi, lu à Alger. */
function jourSemaineAlger(instant: Date): number {
  return new Date(instant.getTime() + DECALAGE_ALGER_MS).getUTCDay();
}

function ajouterJoursIso(baseIso: string, n: number): string {
  const [a, m, j] = baseIso.split("-").map(Number);
  const d = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, j ?? 1) + n * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

const JOURS: ReadonlyArray<readonly string[]> = [
  ["dimanche", "dim", "الأحد", "al-ahad", "had", "lhad"],
  ["lundi", "lun", "الاثنين", "الإثنين", "al-ithnayn", "tnin", "tnine", "lethnin"],
  ["mardi", "mar", "الثلاثاء", "at-tulata", "tlat", "tlata"],
  ["mercredi", "mer", "الأربعاء", "al-arbi3a", "arb3a", "larb3a"],
  ["jeudi", "jeu", "الخميس", "al-khamis", "khmis", "lkhmis"],
  ["vendredi", "ven", "الجمعة", "al-jumu3a", "jem3a", "jemaa", "jomo3a", "ljema3a"],
  ["samedi", "sam", "السبت", "as-sabt", "sebt", "ssebt"],
];

function sansDiacritiques(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

const MARQUEURS_DARIJA_LATIN =
  /\b(salam|salut|wakha|n3am|3la|bghit|nhar|rani|man9dar|manقدر|kifach|labess|saha|svp|inchallah|inchaalah|hamdoullah)\b/;

const MARQUEURS_CONFIRMER =
  /\b(oui|ouais|ok|d['’]accord|daccord|confirmer|confirme|je viens|parfait|c['’]est bon|ca marche|ça marche)\b|^(n3am|wakha|ok|oui)\b|\b(n3am|wakha)\b|(نعم|أجل|أكيد|تمام|موافق|واخا|نحضر|حاضر|نكون حاضر)/;

const MARQUEURS_ANNULER =
  /(annuler|annulation|annule|annulé|annulée|ne peux pas|ne pourrai pas|peux pas|pourrai pas|ne viendr|viendr(ai|a) pas|empêche|impossible de venir|désolé|desole|désist|إلغاء|لا أستطيع|لن أحضر|مستحيل|اعتذر|مانقدرش|مانجيش|man9dar|manjich|ne9derch)/;

const MARQUEURS_REPROGRAMMER =
  /(reporter|reporte|déplacer|deplacer|décaler|decaler|changer|un autre jour|une autre heure|un autre créneau|un autre creneau|plutôt|plutot|un autre moment|تأجيل|أجل|نبدل|نحول|يوم آخر|يوم اخر|وقت آخر|وقت اخر|موعد آخر|موعد اخر|nbedel|nbeddel)/;

const MARQUEURS_RDV =
  /\b(rdv|rendez-vous|rendez vous|consultation|موعد|موا?عد|mou3ad|maw3id|rendez|rdvs)\b/;

const MARQUEURS_MATIN = /(matin|matinée|matinee|صباح|صباحا|sabah|sbah|matin)/;
const MARQUEURS_APRES_MIDI =
  /(après-midi|apres-midi|aprem|après midi|aprèsmidi|midi|عشية|العشية|l3chiya|achiya|apres midi)/;
const MARQUEURS_SOIR = /(soir|soirée|soiree|مساء|ليل|lil|evening)/;

const MOTIF_HEURE = /(\d{1,2})[:hH](\d{2})?|الساعة\s+(\d{1,2})/;

function detecterLangue(texte: string, abaisse: string): LangueMsg {
  const arabe = /[؀-ۿ]/.test(texte);
  const latin = /[a-zA-Z]/.test(texte);
  if (arabe && latin) return "mixte";
  if (arabe) return "ar";
  if (MARQUEURS_DARIJA_LATIN.test(abaisse)) return "darija";
  return "fr";
}

function detecterJours(abaisse: string, maintenant: Date): readonly string[] {
  // Ordre TEXTUEL des mentions (pas l'ordre des weekdays) : pour une
  // reprogrammation (« pas mercredi, plutôt jeudi »), c'est la DERNIÈRE
  // mention qui porte le nouveau créneau.
  const trouves: { iso: string; index: number }[] = [];
  const ajoute = (iso: string, index: number): void => {
    if (!trouves.some((t) => t.iso === iso)) trouves.push({ iso, index });
  };
  const relatif = (motif: RegExp, decalage: number): void => {
    const m = motif.exec(abaisse);
    if (m !== null && m.index !== undefined) {
      ajoute(ajouterJoursIso(jourAlger(maintenant), decalage), m.index);
    }
  };
  relatif(/\baujourd['’]?hui\b|اليوم/, 0);
  relatif(/\bdemain\b|غدا|غداً|غدوة/, 1);
  relatif(/\baprès-demain\b|apres-demain|بعد غد/, 2);
  for (let cible = 0; cible < 7; cible++) {
    const noms = JOURS[cible];
    if (noms === undefined) continue;
    for (const nom of noms) {
      const echappe = nom.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = new RegExp(`(^|[^\\p{L}])${echappe}([^\\p{L}]|$)`, "u").exec(abaisse);
      if (m !== null && m.index !== undefined) {
        // Prochaine occurrence EN COMPRIS aujourd'hui : même weekday du jour
        // même = aujourd'hui (l'Agenda refuse le passé honnêtement).
        const ecart = (cible - jourSemaineAlger(maintenant) + 7) % 7;
        ajoute(ajouterJoursIso(jourAlger(maintenant), ecart), m.index);
        break;
      }
    }
  }
  return trouves.sort((a, b) => a.index - b.index).map((t) => t.iso);
}

function detecterPeriode(abaisse: string): Periode | null {
  if (MARQUEURS_SOIR.test(abaisse)) return "soir";
  if (MARQUEURS_APRES_MIDI.test(abaisse)) return "apres_midi";
  if (MARQUEURS_MATIN.test(abaisse)) return "matin";
  return null;
}

function detecterHeure(abaisse: string): string | null {
  const m = MOTIF_HEURE.exec(abaisse);
  if (m === null) return null;
  const hBrut = m[1] ?? m[3] ?? "";
  const minutes = m[2] ?? "00";
  const h = Number.parseInt(hBrut, 10);
  const min = Number.parseInt(minutes, 10);
  if (!Number.isFinite(h) || h > 23 || !Number.isFinite(min) || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function analyserDemandeRdv(texte: string, maintenant: Date): AnalyseRdv {
  const nettoye = texte.trim();
  if (nettoye === "") {
    return { intent: "INCONNU", langue: "fr", jour: null, periode: null, heure: null };
  }
  const abaisse = sansDiacritiques(nettoye);
  const langue = detecterLangue(nettoye, abaisse);
  const jours = detecterJours(abaisse, maintenant);
  const periode = detecterPeriode(abaisse);
  const heure = detecterHeure(abaisse);

  // Priorité : reprogrammer (même mêlée d'annulation) > annuler >
  // confirmer > nouveau > question > inconnu. La reprogrammation vise la
  // DERNIÈRE mention (« pas mercredi, plutôt jeudi ») ; les autres la première.
  const jourPremier = jours[0] ?? null;
  const jourDernier = jours[jours.length - 1] ?? null;

  if (MARQUEURS_REPROGRAMMER.test(abaisse)) {
    return { intent: "REPROGRAMMER", langue, jour: jourDernier, periode, heure };
  }
  if (MARQUEURS_ANNULER.test(abaisse)) {
    return { intent: "ANNULER", langue, jour: jourPremier, periode, heure };
  }
  if (MARQUEURS_CONFIRMER.test(abaisse)) {
    return { intent: "CONFIRMER", langue, jour: jourPremier, periode, heure };
  }
  if (MARQUEURS_RDV.test(abaisse)) {
    return { intent: "DEMANDER_RDV", langue, jour: jourPremier, periode, heure };
  }
  if (nettoye.includes("?")) {
    return { intent: "QUESTION", langue, jour: jourPremier, periode, heure };
  }
  return { intent: "INCONNU", langue, jour: jourPremier, periode, heure };
}
