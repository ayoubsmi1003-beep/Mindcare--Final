/**
 * En-tête patient COLLANT — le seul meuble en verre du dossier.
 *
 * ⚠️ LE VERRE DÉCORE LE MOBILIER, JAMAIS LA DONNÉE (04 §4.1/§4.2) : l'en-tête
 * collant est explicitement dans la liste des surfaces autorisées, mais le
 * NOM et toute valeur identitaire restent posés sur une surface OPAQUE à
 * l'intérieur — le flou ne doit jamais traverser un texte qu'on lit.
 *
 * UNE action visuellement dominante, calculée par la page (elle seule connaît
 * les RDV du jour) ; Jarvis et Modifier sont des actions secondaires. Pas un
 * mur de boutons.
 */

import { Avatar } from "@/components/ui";
import { Badge } from "@/components/ui";
import { Bouton, LienBouton } from "@/components/ui";
import { Icone } from "@/components/ui";
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
    <header
      className="sticky top-0 z-10 -mx-4 px-4 py-3 tablet:-mx-8 tablet:px-8"
      style={{
        background: "var(--glass-panel)",
        backdropFilter: "var(--glass-blur)",
      }}
    >
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-rule bg-card px-5 py-4 shadow-lift2">
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
              <Icone nom="jarvis" taille={20} className="text-ai-600" />
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
