import { normaliserTexteIdentite } from "./normalisation";

export type ReferenceTemporelle =
  | { readonly type: "jour"; readonly jour: string }
  | { readonly type: "plage"; readonly du: string; readonly au: string }
  | { readonly type: "seance"; readonly rang: number | "debut" }
  | { readonly type: "evenement"; readonly repere: "changement" | "avant" | "apres" };
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"] as const;
function ajouter(jour: string, n: number): string {
  const d = new Date(jour + "T12:00:00Z");
  if (!Number.isFinite(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function resoudreReferenceTemporelle(texte: string, maintenant = new Date()): ReferenceTemporelle | null {
  if (!Number.isFinite(maintenant.getTime())) return null;
  const t = normaliserTexteIdentite(texte).replace(/[.!?]+$/u, "");
  const jour = maintenant.toLocaleDateString("sv-SE", { timeZone: "Africa/Algiers" });
  if (["aujourd'hui", "aujourd hui", "today", "اليوم", "lyoum"].includes(t)) return { type: "jour", jour };
  if (["demain", "tomorrow", "غدوة", "غدوه", "غدا", "ghodwa"].includes(t)) return { type: "jour", jour: ajouter(jour, 1) };
  if (["hier", "yesterday", "البارح", "lbareh"].includes(t)) return { type: "jour", jour: ajouter(jour, -1) };
  const index = JOURS.findIndex((j) => j === t);
  if (index !== -1) {
    const courant = new Date(jour + "T12:00:00Z").getUTCDay();
    return { type: "jour", jour: ajouter(jour, (index - courant + 7) % 7) };
  }
  if (/^(?:la |sa )?derniere seance$/.test(t)) return { type: "seance", rang: 0 };
  if (/^(?:(?:la |sa )?(?:seance )?precedente|et avant ca)$/.test(t)) return { type: "seance", rang: 1 };
  if (/^(?:au debut|le debut|premiere seance)$/.test(t)) return { type: "seance", rang: "debut" };
  if (t === "depuis le changement") return { type: "evenement", repere: "changement" };
  if (t === "avant" || t === "apres") return { type: "evenement", repere: t };
  const mois = t.match(/^il y a (un|deux|trois|\d{1,2}) mois$/);
  if (mois !== null) {
    const nombres: Readonly<Record<string, number>> = { un: 1, deux: 2, trois: 3 };
    const n = nombres[mois[1] ?? ""] ?? Number(mois[1]);
    const d = new Date(jour + "T12:00:00Z");
    const quantieme = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n);
    const dernier = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(quantieme, dernier));
    return { type: "jour", jour: d.toISOString().slice(0, 10) };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(t) && ajouter(t, 0) === t) return { type: "jour", jour: t };
  if (t === "cette semaine" || t === "recemment") return { type: "plage", du: ajouter(jour, -6), au: ajouter(jour, 1) };
  if (t === "depuis janvier") return { type: "plage", du: jour.slice(0, 4) + "-01-01", au: ajouter(jour, 1) };
  return null;
}
