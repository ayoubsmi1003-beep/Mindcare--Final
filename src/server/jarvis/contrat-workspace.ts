/**
 * `_shared/contrat-workspace.ts` — LA FRONTIÈRE ENTRE LA PORTE SQL ET LE RÉSUMÉ.
 *
 * ═══ LE DÉFAUT QUI JUSTIFIE CE FICHIER ═══
 *
 * `app.get_patient_workspace` émet du **snake_case** — `scale_name`,
 * `derniere_consultation`, `derniere_prescription`, `prochain_rendez_vous` — et
 * l'identifiant de la dernière passation d'échelle est NICHÉ dans `dernier.id`
 * depuis la migration 057. `_shared/resume-cas.ts` lisait du **camelCase** et
 * cherchait `e.id` à la racine de l'échelle.
 *
 * Rien ne plantait, et c'est tout le problème. `construireCandidats` rendait
 * une liste VIDE : aucun signal d'échelle, aucun signal de prescription, aucune
 * citation, un `sourceState` sans consultation ni prescription. Le résumé était
 * généré, affiché, persisté — et ne reposait presque sur rien. Les deux
 * fichiers étaient corrects séparément ; c'est leur RENCONTRE qui ne l'était
 * pas, et une relecture ne voit pas cela.
 *
 * ═══ POURQUOI UNE SEULE FRONTIÈRE, ET PAS DES CONVERSIONS DISPERSÉES ═══
 *
 * Un `?? charge.scale_name` posé au point d'usage aurait réparé CE symptôme et
 * laissé le contrat implicite. Le suivant se serait reperdu ailleurs. Ici, la
 * forme de la porte est ÉCRITE, vérifiée à l'entrée, et traduite en un seul
 * endroit. Ce que `resume-cas.ts` reçoit est désormais garanti par construction.
 *
 * ⚠️ AUCUNE DÉPENDANCE, DÉLIBÉRÉMENT. `resume-cas.ts` n'importe rien ; ce
 * module non plus. Les fonctions Edge tournent sous Deno avec `npm:zod@3`
 * tandis que le dépôt embarque zod 4 : valider avec zod ici ferait diverger le
 * test de l'exécution, c'est-à-dire fabriquer exactement le vert trompeur que
 * ce fichier existe pour empêcher. La validation est donc écrite à la main,
 * lisible, et identique des deux côtés.
 *
 * ⚠️ CE MODULE NE DÉCIDE D'AUCUN DROIT. `clinique` ou `traitements` à `null`
 * signifie « l'appelant n'a pas le droit clinique » — c'est la BASE qui l'a
 * décidé (`app.can_see_clinical`). On transporte ce `null`, on ne le comble
 * jamais.
 */

import type { EspacePourResume } from "./resume-cas";

// ───────────────────────────────────────────────────────────────────────────
// 1 · Les petites briques de lecture
// ───────────────────────────────────────────────────────────────────────────

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function texte(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function nombre(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Le résultat d'une analyse — même forme que `safeParse`, sans la dépendance. */
export interface Analyse<T> {
  readonly success: boolean;
  readonly data?: T;
  /**
   * Le CHEMIN des clés fautives, jamais une valeur : citer les données reçues
   * ferait sortir un nom ou une date de naissance dans un journal (règle 1).
   */
  readonly chemins?: readonly string[];
}

// ───────────────────────────────────────────────────────────────────────────
// 2 · La forme réelle de la porte — relevée sur la base, pas supposée
// ───────────────────────────────────────────────────────────────────────────

/** Une mesure d'échelle telle que 057 la rend. */
interface EchellePorte {
  readonly scale_name: string;
  readonly dernier: Record<string, unknown>;
  readonly precedent: Record<string, unknown> | null;
  readonly delta: unknown;
}

export interface EspacePorte {
  readonly clinique: {
    readonly diagnostics: readonly unknown[];
    readonly echelles: readonly EchellePorte[];
    readonly derniere_consultation: Record<string, unknown> | null;
  } | null;
  readonly traitements: {
    readonly derniere_prescription: Record<string, unknown> | null;
  } | null;
  readonly agenda: Record<string, unknown>;
}

/**
 * Vérifie que la charge a bien la forme de la PORTE.
 *
 * Le refus d'une charge camelCase n'est pas un excès de zèle : c'est le seul
 * contrôle capable de faire tomber ce fichier le jour où la porte changerait de
 * convention. Sans lui, la régression redeviendrait silencieuse.
 */
export function analyserEspacePorte(charge: unknown): Analyse<EspacePorte> {
  const chemins: string[] = [];
  if (!estObjet(charge)) return { success: false, chemins: ["(racine)"] };

  const clinique = charge["clinique"];
  if (clinique !== null && clinique !== undefined) {
    if (!estObjet(clinique)) {
      chemins.push("clinique");
    } else {
      if (!Array.isArray(clinique["echelles"])) chemins.push("clinique.echelles");
      if (!Array.isArray(clinique["diagnostics"])) chemins.push("clinique.diagnostics");
      // La variante camelCase EST le défaut d'origine : on la nomme, pour que
      // l'erreur enseigne la cause au lieu de signaler une absence.
      if ("derniereConsultation" in clinique) {
        chemins.push("clinique.derniereConsultation(camelCase)");
      }
      const echelles = Array.isArray(clinique["echelles"]) ? clinique["echelles"] : [];
      for (const [i, e] of echelles.entries()) {
        if (!estObjet(e)) {
          chemins.push(`clinique.echelles.${String(i)}`);
          continue;
        }
        if (texte(e["scale_name"]) === null) {
          chemins.push(`clinique.echelles.${String(i)}.scale_name`);
        }
        if (!estObjet(e["dernier"])) chemins.push(`clinique.echelles.${String(i)}.dernier`);
      }
    }
  }

  const traitements = charge["traitements"];
  if (traitements !== null && traitements !== undefined) {
    if (!estObjet(traitements)) chemins.push("traitements");
    else if ("dernierePrescription" in traitements) {
      chemins.push("traitements.dernierePrescription(camelCase)");
    }
  }

  const agenda = charge["agenda"];
  if (!estObjet(agenda)) chemins.push("agenda");
  else if ("prochainRendezVous" in agenda) chemins.push("agenda.prochainRendezVous(camelCase)");

  if (chemins.length > 0) return { success: false, chemins };
  return { success: true, data: commeEspacePorte(charge) };
}

/**
 * L'unique endroit où la forme validée devient le type.
 *
 * ⚠️ ASSERTION SIMPLE, PAS DOUBLE. La rédaction d'origine écrivait
 * `charge as unknown as EspacePorte` — un motif que le dépôt interdit (I9),
 * parce qu'il fait taire le compilateur précisément là où on aurait besoin
 * qu'il parle. En passant par un paramètre `unknown`, la conversion redevient
 * une assertion unique, isolée, et NOMMÉE : on voit dans un diff qu'on
 * affirme quelque chose.
 *
 * Ce qui justifie l'affirmation est la validation champ par champ juste
 * au-dessus — c'est elle qui garantit la forme, pas ce transtypage.
 */
function commeEspacePorte(valide: unknown): EspacePorte {
  return valide as EspacePorte;
}

// ───────────────────────────────────────────────────────────────────────────
// 3 · La traduction — snake_case (porte) → camelCase (forme interne)
// ───────────────────────────────────────────────────────────────────────────

interface EchelleInterne {
  readonly scaleName: string;
  readonly dernier: { readonly score: number | null; readonly date: string };
  readonly precedent: { readonly score: number | null; readonly date: string } | null;
  readonly delta: number | null;
  readonly id?: string;
}

function adapterEchelle(e: Record<string, unknown>): EchelleInterne {
  const dernier = estObjet(e["dernier"]) ? e["dernier"] : {};
  const precedent = estObjet(e["precedent"]) ? e["precedent"] : null;
  // ⚠️ L'IDENTIFIANT EST DANS `dernier.id` (057), PAS À LA RACINE. C'est
  // précisément ce que l'ancien code cherchait au mauvais endroit — et sans id,
  // `construireCandidats` écarte le signal sans rien dire.
  const id = texte(dernier["id"]);
  return {
    scaleName: texte(e["scale_name"]) ?? "",
    dernier: { score: nombre(dernier["score"]), date: texte(dernier["date"]) ?? "" },
    precedent:
      precedent === null
        ? null
        : { score: nombre(precedent["score"]), date: texte(precedent["date"]) ?? "" },
    delta: nombre(e["delta"]),
    ...(id === null ? {} : { id }),
  };
}

/**
 * Traduit une charge de la porte vers la forme que `resume-cas.ts` consomme.
 *
 * Tout champ absent devient `null`. AUCUNE valeur n'est inventée pour combler
 * un trou : un résumé qui affirme sur une donnée fabriquée est pire qu'un
 * résumé qui se tait (règle 8).
 */
export function adapterEspace(charge: unknown): EspacePourResume {
  const c = estObjet(charge) ? charge : {};
  const cliniqueBrute = estObjet(c["clinique"]) ? c["clinique"] : null;
  const traitementsBruts = estObjet(c["traitements"]) ? c["traitements"] : null;
  const agendaBrut = estObjet(c["agenda"]) ? c["agenda"] : {};

  let clinique: EspacePourResume["clinique"] = null;
  if (cliniqueBrute !== null) {
    const echelles = Array.isArray(cliniqueBrute["echelles"]) ? cliniqueBrute["echelles"] : [];
    const diagnostics = Array.isArray(cliniqueBrute["diagnostics"])
      ? cliniqueBrute["diagnostics"]
      : [];
    const dc = estObjet(cliniqueBrute["derniere_consultation"])
      ? cliniqueBrute["derniere_consultation"]
      : null;
    const dcId = dc === null ? null : texte(dc["id"]);
    const dcDebut = dc === null ? null : texte(dc["started_at"]);
    clinique = {
      diagnostics: diagnostics.flatMap((d) => {
        if (!estObjet(d)) return [];
        const id = texte(d["id"]);
        const label = texte(d["label"]);
        return id === null || label === null ? [] : [{ id, label }];
      }),
      echelles: echelles.flatMap((e) =>
        estObjet(e) && texte(e["scale_name"]) !== null ? [adapterEchelle(e)] : [],
      ),
      derniereConsultation:
        dcId === null || dcDebut === null ? null : { id: dcId, startedAt: dcDebut },
    };
  }

  let traitements: EspacePourResume["traitements"] = null;
  if (traitementsBruts !== null) {
    const px = estObjet(traitementsBruts["derniere_prescription"])
      ? traitementsBruts["derniere_prescription"]
      : null;
    const pxId = px === null ? null : texte(px["id"]);
    const pxDate = px === null ? null : texte(px["prescribed_at"]);
    traitements = {
      dernierePrescription:
        pxId === null || pxDate === null ? null : { id: pxId, prescribedAt: pxDate },
    };
  }

  return {
    clinique,
    traitements,
    agenda: { prochainRendezVous: agendaBrut["prochain_rendez_vous"] ?? null },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 4 · Les deux autres lectures qui se trompaient de convention
// ───────────────────────────────────────────────────────────────────────────

/**
 * Les identités à pseudonymiser AVANT tout appel externe.
 *
 * ⚠️ CE DÉFAUT-CI ÉTAIT UNE FRONTIÈRE INERTE, PAS UN AFFICHAGE MANQUANT.
 * `jarvis-resume-cas` lisait `identite.firstName / lastName / recordNumber` ;
 * la porte émet `first_name / last_name / record_number`. La liste rendue était
 * donc TOUJOURS VIDE — `pseudonymize()` n'avait rien à masquer et surtout
 * `assertSafe()` n'avait rien à chercher. Le filet de la règle 1 était tendu
 * sur du vide : il ne pouvait plus rien attraper, et il rendait « conforme »
 * à chaque appel.
 *
 * Aucune valeur n'est journalisée par cette fonction, jamais.
 */
export function identitesDuDossier(charge: unknown): string[] {
  const c = estObjet(charge) ? charge : {};
  const identite = estObjet(c["identite"]) ? c["identite"] : {};
  return [identite["first_name"], identite["last_name"], identite["record_number"]].filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );
}

/** L'empreinte des faits couverts — ce sur quoi `a_jour` sera recalculé. */
export interface EtatSource {
  readonly diagnostics: number;
  readonly echelles: number;
  readonly consultations: number | null;
  readonly prescriptions: number | null;
  readonly dernierEvenement: string | null;
}

/**
 * ⚠️ MÊME CAUSE, TROISIÈME VICTIME. `nombreConsultations`,
 * `nombrePrescriptions` et `dernierRendezVous.startsAt` n'existent pas dans la
 * charge de la porte : les compteurs partaient à `null` et `dernierEvenement`
 * aussi. Un état de source vide rend la péremption du résumé INCALCULABLE —
 * `a_jour` ne pouvait plus rien détecter.
 */
export function etatSource(charge: unknown): EtatSource {
  const c = estObjet(charge) ? charge : {};
  const clinique = estObjet(c["clinique"]) ? c["clinique"] : null;
  const traitements = estObjet(c["traitements"]) ? c["traitements"] : null;
  const agenda = estObjet(c["agenda"]) ? c["agenda"] : {};

  // `estObjet()` rétrécit déjà vers `Record<string, unknown>` : les assertions
  // qui suivaient étaient sans effet, et le lint le signale à juste titre.
  const derniereConsultation = estObjet(clinique?.["derniere_consultation"])
    ? clinique["derniere_consultation"]
    : null;
  const dernierRdv = estObjet(agenda["dernier_rendez_vous"])
    ? agenda["dernier_rendez_vous"]
    : null;

  return {
    diagnostics: Array.isArray(clinique?.["diagnostics"]) ? clinique["diagnostics"].length : 0,
    echelles: Array.isArray(clinique?.["echelles"]) ? clinique["echelles"].length : 0,
    consultations: nombre(clinique?.["nombre_consultations"]),
    prescriptions: nombre(traitements?.["nombre_prescriptions"]),
    dernierEvenement:
      texte(derniereConsultation?.["started_at"]) ?? texte(dernierRdv?.["starts_at"]) ?? null,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 5 · La mémoire longitudinale — les analyses de séance déjà persistées (067)
// ───────────────────────────────────────────────────────────────────────────

/** Une analyse de séance, réduite à ce que le résumé a besoin d'en savoir. */
export interface AnalyseAnterieure {
  readonly consultationId: string;
  readonly date: string;
  readonly assessment: string;
  readonly plan: string;
  readonly evolution: readonly string[];
}

/**
 * Date calendaire lue sur une ligne `pg` — chaîne ISO ou `Date`.
 *
 * MÊME CAUSE que `dateCourte` de `contexte-seance.ts`, autre victime : ici
 * pas de levée (le garde `texte()` rendait null sur un `Date`), mais une
 * PERTE SILENCIEUSE — chaque analyse antérieure était écartée, et le résumé
 * longitudinal perdait sa mémoire sans un seul journal. Local et dupliqué à
 * dessein : les deux modules restent importables par les évals hors ligne
 * sans dépendance croisée.
 */
function dateLue(v: unknown): string | null {
  if (typeof v === "string") return v === "" ? null : v.slice(0, 10);
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  return null;
}

/**
 * Lit les lignes de `app.get_recent_session_analyses` (067).
 *
 * ═══ POURQUOI LE RÉSUMÉ PASSE PAR LÀ, ET NON PAR LES NOTES BRUTES ═══
 *
 * C'est la clé de la tenue dans le temps. Une patiente à 36 séances représente
 * des dizaines de milliers de caractères de notes ; les relire toutes à chaque
 * génération ferait exploser le contexte, coûterait cher, et le modèle noierait
 * l'essentiel dans le détail. Les analyses, elles, ont DÉJÀ été résumées séance
 * par séance, au moment où la séance était fraîche. Le résumé longitudinal lit
 * donc des résumés, jamais la matière brute — le coût reste borné par le NOMBRE
 * D'ANALYSES RELUES, pas par l'ancienneté du dossier.
 *
 * ⚠️ ON NE GARDE QUE `assessment`, `plan` ET `evolution`. Le `subjective` et
 * l'`objective` sont le récit de la séance : ils appartiennent à la note, pas à
 * une synthèse de trois ans. Les emporter gonflerait le contexte de ce qui se
 * périme le plus vite.
 */
export function analysesAnterieures(lignes: unknown): AnalyseAnterieure[] {
  if (!Array.isArray(lignes)) return [];
  const out: AnalyseAnterieure[] = [];
  for (const l of lignes) {
    if (!estObjet(l)) continue;
    const consultationId = texte(l["consultation_id"]);
    const date = dateLue(l["generated_at"]);
    const contenu = estObjet(l["content"]) ? l["content"] : null;
    if (consultationId === null || date === null || contenu === null) continue;
    const note = estObjet(contenu["noteStructuree"]) ? contenu["noteStructuree"] : {};
    const evolution = Array.isArray(contenu["evolution"])
      ? contenu["evolution"].filter((e): e is string => typeof e === "string")
      : [];
    out.push({
      consultationId,
      date: date.slice(0, 10),
      assessment: texte(note["assessment"]) ?? "",
      plan: texte(note["plan"]) ?? "",
      evolution,
    });
  }
  return out;
}
