/**
 * Les pièces communes aux trois écrans de l'agenda — présentation seule.
 *
 * FUSEAU HORAIRE : celui du poste, délibérément. `Intl` sans `timeZone` formate
 * dans le fuseau de la machine, qui est celle du cabinet à Alger. Figer
 * « Africa/Algiers » dans le code inscrirait une donnée de déploiement dans une
 * fonction d'affichage, et donnerait une heure fausse à la première session
 * ouverte ailleurs — pendant une astreinte, par exemple. La base stocke des
 * `timestamptz` (I8) : l'instant est absolu, seule sa présentation est locale.
 */

import { fr } from "@/i18n/fr";
import type { AppointmentStatus } from "@/services/appointments";

const FORMAT_HEURE = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});

const FORMAT_JOUR = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const FORMAT_JOUR_COMPLET = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/**
 * Une date illisible rend `null`, jamais « Invalid Date ». L'appelant affiche
 * alors `fr.etats.texteAbsent` — dire « non renseigné » est honnête, afficher
 * un message d'erreur anglais du moteur JavaScript ne l'est pas.
 */
function versDate(iso: string): Date | null {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

export function heure(iso: string): string | null {
  const d = versDate(iso);
  return d === null ? null : FORMAT_HEURE.format(d);
}

export function jour(iso: string): string | null {
  const d = versDate(iso);
  return d === null ? null : FORMAT_JOUR.format(d);
}

export function jourComplet(iso: string): string | null {
  const d = versDate(iso);
  return d === null ? null : FORMAT_JOUR_COMPLET.format(d);
}

/** `2026-08-03T14:30` pour un `<input type="datetime-local">`, en heure locale. */
export function versSaisieLocale(iso: string): string {
  const d = versDate(iso);
  if (d === null) return "";
  const p = (v: number): string => String(v).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Saisie locale → ISO 8601 avec fuseau. Rend `null` si la saisie n'est pas une
 * date : l'appelant refuse d'envoyer plutôt que d'envoyer n'importe quoi.
 */
export function versIso(saisieLocale: string): string | null {
  const t = Date.parse(saisieLocale);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

/**
 * Nom affiché d'un patient. Rend `null` quand l'identité n'est pas rendue par
 * la porte — dossier hors périmètre, ou rendez-vous sans dossier rattaché. Ce
 * n'est pas une erreur : c'est un LEFT JOIN honnête (`appointments.ts`).
 */
export function nomPatient(
  lastName: string | null,
  firstName: string | null,
): string | null {
  const nom = `${lastName ?? ""} ${firstName ?? ""}`.trim();
  return nom === "" ? null : nom;
}

/**
 * Pastille de statut.
 *
 * LE ROUGE EST UN BUDGET (§4 règle 1) : `--critical` est réservé au disque
 * critique et à la perte de données. Un rendez-vous annulé ou non honoré prend
 * `--attention`. Un statut ne repose JAMAIS sur la couleur seule (§4 règle 4) —
 * le libellé est toujours écrit, la couleur ne fait que le doubler.
 */
export function Statut({ statut }: { readonly statut: AppointmentStatus }): React.JSX.Element {
  const libelle = fr.agenda.statuts[statut];

  const teintes: Readonly<Record<AppointmentStatus, readonly [string, string]>> = {
    requested: ["var(--sunken)", "var(--ink-700)"],
    confirmed: ["var(--teal-100)", "var(--teal-900)"],
    arrived: ["var(--positive-bg)", "var(--positive)"],
    in_session: ["var(--positive-bg)", "var(--positive)"],
    completed: ["var(--sunken)", "var(--ink-500)"],
    no_show: ["var(--attention-bg)", "var(--attention)"],
    cancelled: ["var(--attention-bg)", "var(--attention)"],
  };
  const [fond, encre] = teintes[statut];

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "var(--s-1) var(--s-3)",
        borderRadius: "var(--r-full)",
        background: fond,
        color: encre,
        fontSize: "var(--text-label-size)",
        lineHeight: "var(--text-label-leading)",
        letterSpacing: "var(--text-label-tracking)",
        fontWeight: "var(--weight-medium)",
        whiteSpace: "nowrap",
      }}
    >
      {libelle}
    </span>
  );
}
