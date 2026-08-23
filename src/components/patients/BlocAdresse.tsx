/**
 * L'adresse — un bloc, pas une ligne de grille parmi six.
 *
 * ⚠️ « NON RENSEIGNÉE », JAMAIS UN TIRET. La raison est déjà écrite dans
 * `ui/Etats.tsx` et elle vaut doublement ici : un tiret se confond avec une
 * valeur, et sur une coordonnée la confusion se paie au moment où on cherche à
 * joindre quelqu'un — ou à envoyer un courrier qui ne partira jamais.
 *
 * ⚠️ `address IS NULL` NE VEUT PAS DIRE « CE PATIENT N'A PAS D'ADRESSE ». Cela
 * veut dire que personne ne l'a saisie. L'écran dit donc ce qu'il sait — rien —
 * et surtout pas une affirmation sur le domicile de quelqu'un.
 *
 * ═══ POURQUOI UN SEUL CHAMP TEXTE, ET PAS RUE / VILLE / WILAYA ════════════
 *
 * La colonne `app.patients.address` est un `text` libre depuis 004, et elle n'a
 * jamais été altérée. Découper l'affichage en rue / ville / code postal /
 * wilaya supposerait une structure que la base ne porte pas : il faudrait
 * l'inventer en JavaScript, à coups d'expressions régulières sur du texte saisi
 * à la main. Une adresse mal découpée est pire qu'une adresse brute.
 *
 * Ce qu'on fait à la place : rendre les retours à la ligne DÉJÀ saisis
 * (`whitespace-pre-line`), pour qu'une adresse écrite sur trois lignes en
 * garde trois. L'adresse structurée reste un écart de données documenté, à
 * traiter par une migration du domaine Patients — pas par une devinette ici.
 */

import { fr } from "@/i18n/fr";

export function BlocAdresse({
  adresse,
}: {
  readonly adresse: string | null;
}): React.JSX.Element {
  const vide = adresse === null || adresse.trim() === "";

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-ui text-label font-medium tracking-label text-ink-500">
        {fr.patients.adresse}
      </span>
      <address
        className={[
          // `not-italic` : la balise `address` est en italique par défaut, et
          // une adresse en italique se lit comme une citation.
          "font-ui text-body not-italic",
          // Les trois protections d'un texte libre dans une grille : les sauts
          // de ligne saisis sont rendus, un mot très long se casse plutôt que
          // de déborder, et la colonne peut rétrécir (`min-w-0` du parent).
          "whitespace-pre-line break-words",
          vide ? "text-ink-500" : "text-ink-900",
        ].join(" ")}
      >
        {vide ? fr.patients.adresseAbsente : adresse}
      </address>
    </div>
  );
}
