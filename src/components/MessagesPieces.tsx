/**
 * Pièces de l'écran Messages — passé les primitives `ui`, rien de propre.
 *
 * `filtrerConversations` est un FILTRE DE VUE, jamais une protection : ce qui
 * est visible est décidé par la RLS, ce filtre choisit seulement ce qu'on
 * regarde (même discipline que `STATUTS_AGENDA`).
 */
import { Badge } from "@/components/ui/Badge";
import { frMessages } from "@/i18n/communication";
import type {
  EtatHandoff,
  ItemMessage,
  ResumeConversation,
} from "@/services/communication/types";

export type FiltreMessages = "tous" | "whatsapp" | "facebook" | "non_traites" | "humain_requis";

export function filtrerConversations(
  conversations: readonly ResumeConversation[],
  filtre: FiltreMessages,
): readonly ResumeConversation[] {
  switch (filtre) {
    case "whatsapp":
      return conversations.filter((c) => c.canal === "whatsapp");
    case "facebook":
      return conversations.filter((c) => c.canal === "facebook");
    case "non_traites":
      return conversations.filter((c) => c.etatHandoff === "HUMAN_REQUIRED");
    case "humain_requis":
      return conversations.filter(
        (c) => c.etatHandoff === "HUMAN_REQUIRED" || c.etatHandoff === "HUMAN_HANDLING",
      );
    case "tous":
      return conversations;
  }
}

export function BadgeCanal({ canal }: { readonly canal: string }): React.JSX.Element {
  return <Badge ton={canal === "whatsapp" ? "positif" : "information"}>{canal}</Badge>;
}

export function BadgeHandoff({ etat }: { readonly etat: EtatHandoff }): React.JSX.Element {
  const ton =
    etat === "HUMAN_REQUIRED" ? "attention" : etat === "RESOLVED" ? "positif" : "neutre";
  return (
    <Badge ton={ton}>
      {frMessages.handoff[etat] ?? etat}
    </Badge>
  );
}

export function LigneConversation({
  conversation,
  selectionnee,
  onChoisir,
}: {
  readonly conversation: ResumeConversation;
  readonly selectionnee: boolean;
  readonly onChoisir: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onChoisir}
      aria-pressed={selectionnee}
      className={[
        "flex w-full min-h-target flex-col gap-1 rounded-md border px-4 py-3 text-left",
        "transition duration-quick ease-soft",
        "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
        selectionnee ? "border-action-600 bg-card shadow-lift2" : "border-rule bg-card hover:shadow-lift1",
      ].join(" ")}
    >
      <span className="flex items-center gap-2">
        <BadgeCanal canal={conversation.canal} />
        <BadgeHandoff etat={conversation.etatHandoff} />
      </span>
      <span className="font-ui text-body text-ink-900">
        {conversation.patientId === null ? frMessages.prospect : frMessages.actions.voirDossier}
      </span>
    </button>
  );
}

export function BulleMessage({ message }: { readonly message: ItemMessage }): React.JSX.Element {
  const entrant = message.direction === "entrant";
  return (
    <div className={["flex", entrant ? "justify-start" : "justify-end"].join(" ")}>
      <div
        className={[
          // `max-w-prose` : une bulle ne s'étire jamais en pleine largeur —
          // une ligne de 65 chasse se relit, une ligne d'écran non.
          "max-w-prose rounded-xl border px-4 py-2",
          entrant ? "border-rule bg-sunken text-ink-900" : "border-action-600 bg-card text-ink-900",
        ].join(" ")}
      >
        <p className="m-0 font-ui text-body break-words">{message.contenu}</p>
        <p className="m-0 mt-1 font-ui text-label text-ink-500">{message.etat}</p>
      </div>
    </div>
  );
}
