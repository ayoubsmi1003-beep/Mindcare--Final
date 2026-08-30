/**
 * `_shared/resume-chronologie.ts` — LE RÉSUMÉ DU CAS, EN SCHÉMA 2.
 *
 * ═══ CE QUE CETTE FORME CHANGE ═══
 *
 * Le schéma 1 rangeait le dossier en cinq listes plates. Sur une patiente
 * suivie trois ans, les faits de 2024 et ceux de 2026 y tombaient côte à côte :
 * la praticienne lisait un inventaire, jamais un parcours. Le schéma 2 rend le
 * TEMPS explicite — un aperçu compact, puis une chronologie par période, puis
 * l'état documenté le plus récent.
 *
 * ═══ LA DÉCISION CENTRALE : L'APERÇU N'EST PAS ÉCRIT PAR LE MODÈLE ═══
 *
 * ⚠️ `construireApercu()` est DÉTERMINISTE. Nom, âge, résidence, diagnostics et
 * traitements documentés viennent de `app.build_case_context.socle` (068) et
 * sont recopiés tels quels. Aucun modèle ne rédige cette section, donc rien ne
 * peut s'y inventer — et c'est exactement la section qu'une praticienne lit en
 * premier et sur laquelle elle se fie sans relire le dossier.
 *
 * Demander ces champs à un LLM aurait été plus simple à écrire et
 * indéfendable : une posologie approximative ou un âge « plausible » dans
 * l'en-tête d'un dossier de psychiatrie n'est pas une imprécision, c'est une
 * donnée fictive dans une fonctionnalité livrée (règle 8).
 *
 * Le modèle ne rédige donc QUE le récit : `chronologie`, `anterieur`,
 * `etat_actuel` — et chaque affirmation y porte ses sources, filtrées ici puis
 * revérifiées en base (069).
 *
 * ⚠️ AUCUNE DÉPENDANCE, comme `resume-cas.ts` et `contrat-workspace.ts` :
 * ces modules tournent sous Deno et sont testés sous Node. Voir l'en-tête de
 * `contrat-workspace.ts` pour le motif complet.
 */

import { DOMAINES_SOURCE, type SourceRef } from "./resume-cas.ts";

const MAX_TEXTE = 320;
const MAX_ENTREES_PAR_PERIODE = 6;
const MAX_PERIODES = 8;
const MAX_ITEMS_SECTION = 8;

export interface ItemResume {
  readonly texte: string;
  readonly sources: readonly SourceRef[];
}

export interface Apercu {
  readonly nom: string;
  readonly age: number | null;
  readonly residence: string | null;
  readonly diagnostics: readonly ItemResume[];
  readonly traitements: readonly ItemResume[];
  readonly contexte: readonly ItemResume[];
}

export interface Periode {
  readonly periode: string;
  readonly entrees: readonly ItemResume[];
}

export interface ContenuSchema2 {
  readonly schema: 2;
  readonly apercu: Apercu;
  readonly chronologie: readonly Periode[];
  readonly anterieur: readonly ItemResume[];
  readonly etat_actuel: readonly ItemResume[];
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function texte(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

// ───────────────────────────────────────────────────────────────────────────
// 1 · L'aperçu — recopié du socle, jamais rédigé
// ───────────────────────────────────────────────────────────────────────────

/**
 * Construit l'aperçu à partir de `build_case_context.socle`.
 *
 * Un champ absent reste absent : `age` à `null` s'affiche comme inconnu, il ne
 * se déduit pas. Un dossier sans ordonnance rend une liste de traitements
 * VIDE, jamais une phrase disant qu'il n'y en a pas — l'absence se montre par
 * le vide, pas par une affirmation qu'il faudrait ensuite sourcer.
 */
export function construireApercu(socle: unknown): Apercu | null {
  if (!estObjet(socle)) return null;
  const identite = estObjet(socle["identite"]) ? socle["identite"] : null;
  if (identite === null) return null;

  const prenom = texte(identite["first_name"]) ?? "";
  const nom = texte(identite["last_name"]) ?? "";
  const complet = `${prenom} ${nom}`.trim();
  if (complet === "") return null;

  const age = typeof identite["age"] === "number" ? identite["age"] : null;

  const diagnostics: ItemResume[] = [];
  if (Array.isArray(socle["diagnostics"])) {
    for (const d of socle["diagnostics"]) {
      if (!estObjet(d)) continue;
      const id = texte(d["id"]);
      const label = texte(d["label"]);
      if (id === null || label === null) continue;
      // La date de début et la résolution sont des FAITS du dossier : les
      // porter ici évite que le modèle ait à les recopier, donc à les altérer.
      const debut = texte(d["onset_date"]);
      const resolu = texte(d["resolved_at"]);
      const suffixe = resolu !== null
        ? ` (résolu le ${resolu.slice(0, 10)})`
        : debut !== null
          ? ` (depuis le ${debut.slice(0, 10)})`
          : "";
      diagnostics.push({
        texte: `${label}${suffixe}`.slice(0, MAX_TEXTE),
        sources: [{ t: "diagnostic", id }],
      });
    }
  }

  const traitements: ItemResume[] = [];
  const traitement = estObjet(socle["traitement_documente"]) ? socle["traitement_documente"] : null;
  if (traitement !== null) {
    const prescriptionId = texte(traitement["prescription_id"]);
    const date = texte(traitement["prescribed_at"]);
    const lignes = Array.isArray(traitement["lignes"]) ? traitement["lignes"] : [];
    for (const l of lignes) {
      if (!estObjet(l)) continue;
      const medicament = texte(l["medicament"]);
      if (medicament === null) continue;
      const dose = texte(l["dose"]);
      const frequence = typeof l["frequence"] === "number" ? l["frequence"] : null;
      const details = [dose, frequence === null ? null : `${String(frequence)}×/j`]
        .filter((x): x is string => x !== null)
        .join(", ");
      traitements.push({
        texte: `${medicament}${details === "" ? "" : ` — ${details}`}`.slice(0, MAX_TEXTE),
        sources: prescriptionId === null ? [] : [{ t: "prescription", id: prescriptionId }],
      });
    }
    // La DATE de l'ordonnance compte autant que son contenu : « documenté »
    // ne veut pas dire « en cours », et une ordonnance de 2024 se lit
    // autrement qu'une ordonnance de la semaine dernière.
    if (traitements.length > 0 && prescriptionId !== null && date !== null) {
      traitements.push({
        texte: `Ordonnance documentée le ${date.slice(0, 10)}.`,
        sources: [{ t: "prescription", id: prescriptionId }],
      });
    }
  }

  const contexte: ItemResume[] = [];
  if (Array.isArray(socle["echelles"])) {
    for (const e of socle["echelles"]) {
      if (!estObjet(e)) continue;
      const nomEchelle = texte(e["scale_name"]);
      const points = Array.isArray(e["points"]) ? e["points"] : [];
      if (nomEchelle === null || points.length === 0) continue;
      // Trajectoire en CHIFFRES NEUTRES, du plus ancien au plus récent. Aucun
      // mot de valence : l'orientation des échelles n'est pas exposée
      // canoniquement, donc « amélioration » serait une conclusion, pas un fait.
      const lisibles = [...points].reverse().flatMap((p) => {
        if (!estObjet(p)) return [];
        const score = typeof p["score"] === "number" ? p["score"] : null;
        const date = texte(p["date"]);
        return score === null || date === null
          ? []
          : [`${String(score)} (${date.slice(0, 10)})`];
      });
      if (lisibles.length === 0) continue;
      const dernier = points[0];
      const idDernier = estObjet(dernier) ? texte(dernier["id"]) : null;
      contexte.push({
        texte: `${nomEchelle} : ${lisibles.join(" → ")}`.slice(0, MAX_TEXTE),
        sources: idDernier === null ? [] : [{ t: "echelle", id: idDernier }],
      });
    }
  }

  return {
    nom: complet,
    age,
    residence: texte(socle["residence"]),
    diagnostics: diagnostics.slice(0, MAX_ITEMS_SECTION),
    traitements: traitements.slice(0, MAX_ITEMS_SECTION),
    contexte: contexte.slice(0, MAX_ITEMS_SECTION),
  };
}

// ───────────────────────────────────────────────────────────────────────────
// 2 · Le récit — rédigé par le modèle, filtré ici
// ───────────────────────────────────────────────────────────────────────────

function estDomaineConnu(t: string): t is SourceRef["t"] {
  return (DOMAINES_SOURCE as readonly string[]).includes(t);
}

/**
 * Nettoie un item du modèle : texte borné, sources typées ET ancrées.
 *
 * Une source dont le domaine est inventé ou dont l'identifiant n'appartient
 * pas au dossier est ÉCARTÉE — l'item survit sans elle. Refuser l'item entier
 * priverait la praticienne d'un fait souvent juste ; refuser tout le résumé,
 * comme le faisait la passerelle avant le 2026-08-30, la privait de tout.
 */
function nettoyerItem(brut: unknown, idsAutorises: ReadonlySet<string>): ItemResume | null {
  if (!estObjet(brut)) return null;
  const t = texte(brut["texte"]);
  if (t === null || t.length > MAX_TEXTE) return null;

  const sources: SourceRef[] = [];
  if (Array.isArray(brut["sources"])) {
    for (const s of brut["sources"]) {
      if (!estObjet(s)) continue;
      const type = s["t"];
      const id = s["id"];
      if (typeof type !== "string" || typeof id !== "string") continue;
      if (!estDomaineConnu(type)) continue;
      if (!idsAutorises.has(id)) continue;
      sources.push({ t: type, id });
    }
  }
  return { texte: t, sources };
}

function nettoyerSection(
  brut: unknown,
  idsAutorises: ReadonlySet<string>,
  plafond: number,
): ItemResume[] {
  if (!Array.isArray(brut)) return [];
  const out: ItemResume[] = [];
  for (const b of brut) {
    const item = nettoyerItem(b, idsAutorises);
    if (item !== null) out.push(item);
    if (out.length >= plafond) break;
  }
  return out;
}

/**
 * Valide et assemble le contenu complet.
 *
 * Rend `null` si le modèle n'a produit AUCUN récit exploitable : mieux vaut
 * refuser et laisser la version précédente en place qu'enregistrer une
 * chronologie vide qui s'afficherait comme la plus récente.
 */
export function assemblerSchema2(
  apercu: Apercu,
  brut: unknown,
  idsAutorises: ReadonlySet<string>,
): ContenuSchema2 | null {
  if (!estObjet(brut)) return null;

  const chronologie: Periode[] = [];
  if (Array.isArray(brut["chronologie"])) {
    for (const p of brut["chronologie"]) {
      if (!estObjet(p)) continue;
      const periode = texte(p["periode"]);
      if (periode === null) continue;
      const entrees = nettoyerSection(p["entrees"], idsAutorises, MAX_ENTREES_PAR_PERIODE);
      if (entrees.length === 0) continue;
      chronologie.push({ periode, entrees });
      if (chronologie.length >= MAX_PERIODES) break;
    }
  }

  const anterieur = nettoyerSection(brut["anterieur"], idsAutorises, MAX_ITEMS_SECTION);
  const etatActuel = nettoyerSection(brut["etat_actuel"], idsAutorises, MAX_ITEMS_SECTION);

  // L'aperçu seul ne fait pas un résumé : il est déterministe, il aurait été
  // identique sans aucun appel au modèle. Sans récit, il n'y a rien de neuf à
  // enregistrer.
  if (chronologie.length === 0 && anterieur.length === 0 && etatActuel.length === 0) {
    return null;
  }

  // Les périodes se lisent de la plus récente à la plus ancienne. L'ordre est
  // imposé ICI et non demandé au modèle : une consigne de prompt se respecte
  // « la plupart du temps », un tri se respecte toujours.
  chronologie.sort((a, b) => (a.periode < b.periode ? 1 : a.periode > b.periode ? -1 : 0));

  return { schema: 2, apercu, chronologie, anterieur, etat_actuel: etatActuel };
}

/** Les identifiants citables, tels que la porte 068 les a listés. */
export function idsAutorisesDuContexte(contexte: unknown): Set<string> {
  const c = estObjet(contexte) ? contexte : {};
  const liste = Array.isArray(c["ids_autorises"]) ? c["ids_autorises"] : [];
  return new Set(liste.filter((x): x is string => typeof x === "string"));
}
