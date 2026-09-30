import { alexa as a } from "@/i18n/alexa";
import type { NomIntention } from "@/shared/jarvis/intentions";
import type { ValeurSafe } from "./jarvis-capacites";

/** Display only data actually returned by existing authorized doors. */
export function formaterLectureLocale(intent: NomIntention, valeur: ValeurSafe, rang = 0): string {
  if ("creneaux" in valeur) {
    const creneaux = intent === "GET_NEXT_PATIENT" ? valeur.creneaux.slice(0, 1) : valeur.creneaux;
    return creneaux.length === 0 ? a.aucunRendezVous
      : creneaux.map((c) => a.rdv(c.patient ?? c.ref, c.debut, c.fin)).join("\n");
  }
  if ("nonLues" in valeur) return a.notifications(valeur.nonLues);
  if ("encaisseDzd" in valeur) return a.finance(valeur.encaisseDzd, valeur.enAttenteDzd);
  if ("totalEncaisseDzd" in valeur) return [a.finance(valeur.totalEncaisseDzd, valeur.totalEnAttenteDzd), ...(valeur.complet ? [] : [a.lectureTronquee])].join("\n");
  if ("enAttente" in valeur) return a.finance(0, valeur.totalDzd);
  if ("evenements" in valeur) return [
    ...valeur.evenements.map((e) => a.evenement(e.le, e.genre)), ...(valeur.provenance.some((p) => p.tronque) ? [a.lectureTronquee] : []),
  ].join("\n") || a.inconnu;
  if ("documents" in valeur && Array.isArray(valeur.documents)) return valeur.documents.map((d: { type: string; emisLe: string }) => a.document(d.type, d.emisLe)).join("\n") || a.inconnu;
  if ("seances" in valeur && Array.isArray(valeur.seances)) {
    const seance: unknown = valeur.seances[rang];
    if (typeof seance !== "object" || seance === null || !("le" in seance) || typeof seance.le !== "string") return a.aucuneSeance;
    const lignes = [a.seance(seance.le)];
    if ("note" in seance && seance.note !== null && typeof seance.note === "object" && "signee" in seance.note) {
      const note = seance.note;
      if (note.signee === true && "soap" in note && typeof note.soap === "object" && note.soap !== null) {
        lignes.push(a.noteSignee, ...Object.values(note.soap).filter((v): v is string => typeof v === "string" && v !== ""));
      } else lignes.push(a.noteNonSignee);
    }
    if ("tronque" in valeur && valeur.tronque) lignes.push(a.lectureTronquee);
    return lignes.join("\n");
  }
  if ("ref" in valeur && "clinique" in valeur && "traitements" in valeur) {
    const diagnostics = valeur.clinique?.diagnostics.map((d) => d.libelle) ?? [];
    const traitements = valeur.traitements?.lignes.map((l) => [l.designation, l.dose].filter(Boolean).join(" — ")) ?? [];
    return [a.dossier, a.diagnostics, ...diagnostics, a.traitement, ...traitements,
      ...(diagnostics.length === 0 || traitements.length === 0 ? [a.inconnu] : [])].join("\n");
  }
  if ("enCours" in valeur) {
    const lignes = valeur.enCours?.actifs.map((t) => [t.designation, t.dose].filter(Boolean).join(" — ")) ?? [];
    return [a.traitement, ...lignes, ...(lignes.length === 0 ? [a.inconnu] : [])].join("\n");
  }
  if ("environnement" in valeur) return valeur.aujourdHui + " — " + valeur.environnement;
  return a.lectureIndisponible;
}
