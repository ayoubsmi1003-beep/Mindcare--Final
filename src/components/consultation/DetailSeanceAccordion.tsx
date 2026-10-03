/**
 * Le détail d'une séance passée — la pile LISIBLE partagée des deux écrans.
 *
 * La consultation en cours (`PanneauHistorique`) et la fiche patient
 * (`ChronologiePatient`) montrent EXACTEMENT la même pile : brut, quatre
 * rubriques SOAP, analyse, TOUTES visibles d'un coup. Une seule
 * implémentation, pour que les deux écrans ne puissent pas diverger.
 *
 * Un seul niveau de pli : la SÉANCE se déplie (chez le parent), son contenu
 * se lit en entier — aucune bascule par rubrique. La praticienne qui a un
 * patient en face clique UNE date et lit TOUT, sans chasser chaque note.
 *
 * ⚠️ TOUT EST EN LECTURE SEULE, SANS EXCEPTION. Aucun champ n'écrit, aucun
 * bouton ne reprend un fragment dans un éditeur. Une note signée est
 * immuable (`trg_note_immutable`, 008) et une note d'une AUTRE séance n'a
 * rien à faire dans celle-ci : la recopie, si elle a lieu, est un geste de
 * la praticienne, pas un raccourci de l'écran.
 *
 * ⚠️ CHAQUE OUVERTURE LAISSE UNE TRACE, ET C'EST VOULU (règle 6).
 * Le parent charge via `get_consultation`, qui journalise sa lecture.
 * Relire une séance passée est un accès au dossier, pas une navigation
 * gratuite — sur la fiche patient comme en consultation.
 */

"use client";

import { BlocErreur, EtatVide } from "@/components/ui";
import { Icone, type NomIcone } from "@/components/ui/Icones";
import { jourEtHeure } from "@/components/patients/format";
import { fr } from "@/i18n/fr";
import {
  CHAMPS_SOAP,
  type ChampSoap,
} from "@/services/consultations";
import type { AnalyseSeance } from "@/services/jarvis";
import type { Consultation } from "@/services/consultations";

/** Ce que le parent a chargé pour une séance : note + analyse, ou l'erreur. */
export interface DetailSeanceChargee {
  readonly seance: Consultation | null;
  readonly analyse: AnalyseSeance | null;
  readonly erreur: string | undefined;
}

/**
 * Les quatre intitulés SOAP, relus.
 *
 * `LIBELLES_SOAP` de la page de consultation porte AUSSI une `indication`
 * (« Ce que le patient rapporte »), qui guide une SAISIE. Ici on relit : une
 * consigne de rédaction n'aurait aucun sens sous une note signée il y a six
 * mois. Mêmes clés `fr`, donc aucune chaîne en dur (ADR-008).
 */
const TITRES_SOAP: Readonly<Record<ChampSoap, string>> = {
  subjective: fr.consultation.subjective,
  objective: fr.consultation.objective,
  assessment: fr.consultation.assessment,
  plan: fr.consultation.plan,
};

/**
 * Une section du détail — brut, une rubrique SOAP, ou l'analyse.
 * Chaque section s'affiche EN ENTIER, empilée avec les autres : un contenu
 * long se lit en pleine largeur, sans geste supplémentaire.
 */
export type SectionSeance = "brut" | ChampSoap | "analyse";

interface SectionDef {
  readonly id: SectionSeance;
  readonly icone: NomIcone;
  readonly teinte: string;
  readonly titre: string;
  /** `null` = vide, dit « Non renseigné » — jamais un tiret nu. */
  readonly texte: string | null;
}

const TEINTES_SECTION: Readonly<Record<SectionSeance, { icone: NomIcone; teinte: string }>> = {
  brut: {
    icone: "documents",
    teinte: "border-azure-100 bg-tuile-azur text-azure-700",
  },
  subjective: {
    icone: "messages",
    teinte: "border-emeraude-100 bg-tuile-menthe text-emeraude-700",
  },
  objective: {
    icone: "recherche",
    teinte: "border-ambre-100 bg-tuile-ambre text-ambre-700",
  },
  assessment: {
    icone: "suivi",
    teinte: "border-azure-100 bg-tuile-azur text-azure-700",
  },
  plan: {
    icone: "fleche",
    teinte: "border-emeraude-100 bg-tuile-menthe text-emeraude-700",
  },
  analyse: {
    icone: "jarvis",
    teinte: "border-ambre-100 bg-tuile-ambre text-ambre-700",
  },
};

/**
 * Les sections dans l'ordre de lecture : le brut d'abord (la « première
 * note »), puis les quatre rubriques, puis l'analyse enregistrée.
 * Le brut vide et l'analyse absente ne font pas de section — une ligne
 * « vide » pour un brouillon qui n'a jamais existé serait du bruit.
 */
export function sectionsPour(detail: DetailSeanceChargee): readonly SectionDef[] {
  if (detail.seance === null) return [];
  const brut = (detail.seance.rawNotes ?? "").trim();
  const note = detail.seance.note;
  const sections: SectionDef[] = [];
  if (brut !== "") {
    sections.push({
      id: "brut",
      icone: TEINTES_SECTION.brut.icone,
      teinte: TEINTES_SECTION.brut.teinte,
      titre: fr.consultation.notesBrutes,
      texte: brut,
    });
  }
  if (note !== null) {
    for (const champ of CHAMPS_SOAP) {
      const valeur = (note.soap[champ] ?? "").trim();
      sections.push({
        id: champ,
        icone: TEINTES_SECTION[champ].icone,
        teinte: TEINTES_SECTION[champ].teinte,
        titre: TITRES_SOAP[champ],
        texte: valeur === "" ? null : valeur,
      });
    }
  }
  if (detail.analyse !== null) {
    sections.push({
      id: "analyse",
      icone: TEINTES_SECTION.analyse.icone,
      teinte: TEINTES_SECTION.analyse.teinte,
      titre: fr.consultation.historiqueAnalyse,
      texte: detail.analyse.evolution[0] ?? null,
    });
  }
  return sections;
}

export function DetailSeanceAccordion({
  detail,
}: {
  readonly detail: DetailSeanceChargee;
}): React.JSX.Element {
  if (detail.erreur !== undefined) {
    return <BlocErreur message={detail.erreur} />;
  }

  // `get_consultation` rend zéro ligne pour « introuvable » ET pour « hors
  // périmètre » : un seul message pour les deux, sinon l'écran devient un
  // oracle d'existence sur le dossier d'une consœur (ADR-003).
  if (detail.seance === null) {
    return <EtatVide message={fr.consultation.introuvable} />;
  }

  const note = detail.seance.note;
  const sections = sectionsPour(detail);

  if (sections.length === 0) {
    return <EtatVide message={fr.consultation.historiqueSansNote} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {note?.signedAt == null ? null : (
        <p className="font-ui text-label tabular-nums text-ink-500">
          {fr.consultation.signeePar} {note.signerName ?? fr.etats.texteAbsent} —{" "}
          {fr.consultation.signeeLe} {jourEtHeure(note.signedAt) ?? fr.etats.texteAbsent}
        </p>
      )}

      <div className="flex w-full flex-col gap-3">
        {sections.map((section) => {
          const vide = section.texte === null;
          return (
            <div
              key={section.id}
              className="rounded-xl border border-rule bg-card px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className={[
                    "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border shadow-douce",
                    section.teinte,
                  ].join(" ")}
                >
                  <Icone nom={section.icone} taille={20} />
                </span>
                <span className="font-ui text-body font-semibold text-ink-900">
                  {section.titre}
                </span>
              </div>

              <div className="ps-12 pt-2">
                {section.id === "analyse" && detail.analyse !== null ? (
                  <div className="flex flex-col gap-3">
                    {/* I7 — la mention accompagne toute surface d'aide à la
                        décision, y compris relue des mois plus tard. */}
                    <p className="font-ui text-label text-ink-500">{fr.disclaimer}</p>
                    {detail.analyse.evolution.length === 0 ? (
                      <EtatVide message={fr.consultation.evolutionAucune} />
                    ) : (
                      <ul className="flex list-disc flex-col gap-2 pl-5 font-ui text-body text-ink-900">
                        {detail.analyse.evolution.map((ligne) => (
                          <li key={ligne}>{ligne}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : vide ? (
                  <p className="font-ui text-body text-ink-500">{fr.etats.texteAbsent}</p>
                ) : (
                  <p className="whitespace-pre-wrap break-words font-ui text-body leading-relaxed text-ink-900">
                    {section.texte}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
