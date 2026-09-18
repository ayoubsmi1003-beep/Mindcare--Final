/**
 * En-tête patient — carte inline compacte (plus de 2e barre sticky).
 * Le nom du dossier reste nommé par le chrome (Topbar, sécurité) ; ici,
 * uniquement l'identité utile + actions, en carte simple qui défile avec
 * la page au lieu de redoubler la barre supérieure.
 */

import { Avatar } from "@/components/ui";
import { Badge } from "@/components/ui";
import { Bouton, LienBouton } from "@/components/ui";
import { SiriOrb } from "@/components/ui/siri-orb";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace } from "@/services/patients";

export interface ActionDominante {
  readonly libelle: string;
  /** Soit une navigation, soit un geste (démarrer la séance). */
  readonly href?: string;
  readonly onClick?: () => void;
  readonly enCours?: boolean;
}

export function EnTeteCollant({
  espace,
  dominante,
  onJarvis,
  onModifier,
}: {
  readonly espace: PatientWorkspace;
  readonly dominante: ActionDominante | null;
  readonly onJarvis: () => void;
  readonly onModifier: () => void;
}): React.JSX.Element {
  const i = espace.identite;

  return (
    <header className="rounded-xl border border-rule bg-card px-4 py-3 shadow-douce">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar prenom={i.firstName} nom={i.lastName} taille="grande" />

        <div className="min-w-0 grow">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="truncate font-ui text-title font-semibold tracking-title text-ink-900">
              {i.lastName.toUpperCase()} {i.firstName}
            </h1>
            {!i.isActive ? (
              <Badge ton="attention">{fr.patients.dossierInactif}</Badge>
            ) : null}
          </div>
          <p className="mt-0.5 font-ui text-label tracking-label tabular-nums text-ink-500">
            #{i.recordNumber}
            {i.age === null
              ? ""
              : ` · ${String(i.age)} ${fr.patients.ageAnnees}`}
            {i.sex === null ? "" : ` · ${i.sex === "M" ? fr.patients.sexeM : fr.patients.sexeF}`}
            {" · "}
            <a
              href={`tel:${espace.contact.phone.replace(/ /g, "")}`}
              className="text-action-600 underline decoration-rule underline-offset-2 hover:decoration-action-600"
            >
              {espace.contact.phone}
            </a>
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Action DOMINANTE — une seule, pleine. */}
          {dominante === null ? null : dominante.href !== undefined ? (
            <LienBouton href={dominante.href} rang="principal">
              {dominante.libelle}
            </LienBouton>
          ) : (
            <Bouton
              rang="principal"
              {...(dominante.onClick === undefined ? {} : { onClick: dominante.onClick })}
              disabled={dominante.enCours === true}
            >
              {dominante.libelle}
            </Bouton>
          )}

          {/* Secondaires : icône + libellé accessible (jamais icône muette). */}
          <Bouton rang="secondaire" onClick={onJarvis}>
            <span className="flex items-center gap-2">
              <span aria-hidden className="inline-flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded-full">
                <SiriOrb
                  size="20px"
                  animationDuration={18}
                />
              </span>
              {fr.jarvis.titre}
            </span>
          </Bouton>

          <Bouton rang="discret" onClick={onModifier}>
            {fr.patients.actions.modifier}
          </Bouton>
        </div>
      </div>
    </header>
  );
}
