/**
 * Pseudonymisation — la première des deux passes de la frontière (02-SECURITY-
 * BOUNDARY.md §3). Rien de ce fichier n'appelle `fetch` : c'est le rôle
 * exclusif d'`external-call.ts`, à côté.
 *
 * CONTRAT RÉDUIT AU RÉEL, PAS AU DOCUMENTÉ. §3.2 du document décrit un
 * `PatientContext` complet (téléphone, adresse, contact d'urgence…) parce que
 * la frontière sert aussi le futur contrat STT et les futurs outils
 * d'écriture. `analyze_session` (S6, seul outil de cette passe) ne transporte
 * QUE des notes en texte libre (`Consultation.rawNotes`, les champs SOAP) —
 * aucun téléphone, aucune adresse, aucune date de naissance n'entre dans ce
 * flux, parce qu'ils ne font partie d'aucune des deux tables lues par
 * `get_consultation`/`get_previous_note`. `identites` se limite donc à ce qui
 * peut RÉELLEMENT apparaître dans une note écrite par une praticienne : le
 * prénom, le nom, le numéro de dossier de la patiente EN COURS. Élargir ce
 * contrat au jour où un outil transporte plus de champs est un changement
 * délibéré, pas un oubli à corriger en relisant ce fichier.
 *
 * POURQUOI DES JETONS STABLES PAR APPEL, PAS PAR CONSULTATION. Le document
 * (§3.3) demande une stabilité au sein d'une consultation et une régénération
 * entre deux — cette fonction, appelée une fois par appel à `analyze_session`,
 * satisfait les deux à la fois : la carte est reconstruite à chaque appel
 * (donc jamais réutilisée d'une séance à l'autre), et stable À L'INTÉRIEUR de
 * ce seul appel (le même prénom reçoit toujours le même jeton dans un texte
 * donné).
 */

export interface Tier0Map {
  readonly [pseudonyme: string]: string;
}

/** Lève sans jamais transporter la valeur fautive — voir `assertSafe`. */
export class BoundaryViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoundaryViolation";
  }
}

function normalize(value: string): string {
  // Insensible à la casse ET aux accents : « Nassim » et « nassím » sont la
  // même fuite. `NFD` + suppression des marques diacritiques évite une
  // dépendance externe pour un besoin aussi étroit.
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Remplace chaque identité fournie par un jeton stable (`P1`, `P2`…) dans
 * `texte`. Les identités les plus LONGUES d'abord : sans cet ordre, un nom de
 * famille court contenu dans un prénom plus long laisserait un résidu
 * partiel — « Ben Ali » pseudonymisé après « Ali » romprait « Ben P1 » en
 * « Ben P1 » incomplet si l'ordre était inverse.
 *
 * Les identités vides ou trop courtes (< 2 caractères) sont ignorées : un
 * jeton posé sur une seule lettre pseudonymiserait une bonne partie du texte
 * clinique sans protéger personne.
 */
export function pseudonymize(
  texte: string,
  identites: readonly string[],
): { readonly texte: string; readonly map: Tier0Map } {
  const uniques = Array.from(
    new Set(identites.map((i) => i.trim()).filter((i) => i.length >= 2)),
  ).sort((a, b) => b.length - a.length);

  let sortie = texte;
  const map: Record<string, string> = {};

  uniques.forEach((identite, index) => {
    const jeton = `P${index + 1}`;
    const motif = new RegExp(escapeRegExp(identite), "giu");
    if (motif.test(sortie)) {
      sortie = sortie.replace(motif, jeton);
      map[jeton] = identite;
    }
  });

  return { texte: sortie, map };
}

/** Remplace chaque jeton par la valeur d'origine. Inverse exact de `pseudonymize`. */
export function rehydrate(texte: string, map: Tier0Map): string {
  let sortie = texte;
  for (const [jeton, valeur] of Object.entries(map)) {
    sortie = sortie.replaceAll(jeton, valeur);
  }
  return sortie;
}

/**
 * Garde-fou de sortie — §3.5. S'exécute juste avant CHAQUE `fetch()` sortant,
 * sur le texte qui s'apprête à quitter la machine. Échoue bruyamment : une
 * consultation qui échoue est un incident mineur, une fuite est irréversible.
 *
 * ⚠️ NE JAMAIS journaliser `payload` ni l'identité qui a déclenché le refus —
 * ce serait recréer dans les logs la fuite que cette fonction existe pour
 * empêcher. Le message d'erreur ne porte que le FAIT, jamais la valeur.
 */
export function assertSafe(payload: string, identites: readonly string[]): void {
  const hay = normalize(payload);

  for (const identite of identites) {
    const valeur = identite.trim();
    if (valeur.length < 3) continue; // trop court pour être une identité fiable
    if (hay.includes(normalize(valeur))) {
      throw new BoundaryViolation(
        "Donnée identifiante détectée dans la charge sortante — appel annulé.",
      );
    }
  }

  // Numéro de téléphone algérien (mobile), quelle que soit son origine dans le
  // texte — y compris un numéro non déclaré dans `identites` (tiers cité).
  if (/\b0[5-7]\d{8}\b/.test(payload)) {
    throw new BoundaryViolation("Numéro de téléphone détecté dans la charge sortante — appel annulé.");
  }
}
