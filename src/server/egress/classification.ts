/**
 * `classification.ts` — M05, LE CLASSIFIEUR D'EGRESS DETERMINISTE.
 *
 * Extension de `external-call.ts`, pas un second pare-feu : ce module ne fait
 * AUCUN appel reseau, ne lit AUCUNE base, n'ecrit AUCUN log. Il repond a une
 * seule question sur des OCTETS : cette charge peut-elle quitter le cabinet
 * pour une inference externe ?
 *
 * REGLE DE DECISION (liee a `docs/AI_EVOLUTION_AUDIT.md`, § AI DATA
 * CLASSIFICATION) :
 *   C1 (identifiable / recit clinique)       -> BLOQUER, local uniquement
 *   C2 (derive clinique sensible)            -> BLOQUER, local uniquement
 *   C3 (agregat approuve, recu + forme pure) -> AUTORISER avec recu, sinon BLOQUER
 *   C4 (generique, aucun signal)             -> AUTORISER
 *   INCONNU (lie a une personne, non prouve) -> BLOQUER
 *
 * PRINCIPES STRUCTURAUX :
 *   1. On classe les OCTETS serialises de la charge ENTIERE (contexte +
 *      resultats + message + historique), jamais le nom de l'outil ni l'avis
 *      du modele. Un nom dans le message et un diagnostic dans les resultats
 *      se voient ensemble, quel que soit le champ.
 *   2. La pseudonymisation NE declassifie JAMAIS : `{{PATIENT_001}}`,
 *      `PATIENT_001`, `P1` restent C1. Un jeton prouve que la charge derive
 *      d'un dossier.
 *   3. Le lexique clinique SEUL ne declenche jamais : les prompts systeme
 *      (`prompt.ts`) contiennent "patient", "dossier", "consultation" par
 *      construction. Seuls declenchent : les IDENTIFIANTS (motifs), les
 *      jetons, les NOMS (ancre personne), les references personne + clinique,
 *      et les marqueurs d'injection/exfiltration.
 *   4. Tout depassement presume fuit du cote BLOCAGE (fail-closed). Un
 *      sur-blocage refuse honnetement et se voit ; un sous-blocage fuit en
 *      silence. Le premier se corrige, le second ne se rattrape pas.
 *   5. Deterministe, synchrone, sans I/O : aucun LLM, aucun embedding, aucun
 *      appel distant dans la decision (§28 de la mission).
 */

export type ClasseDonnees = "C1" | "C2" | "C3" | "C4" | "INCONNU";

export type DecisionEgress = "AUTORISER" | "BLOQUER";

export interface VerdictEgress {
  readonly decision: DecisionEgress;
  readonly classe: ClasseDonnees;
  /** Motif SANS contenu patient : nom de regle + classe, jamais la valeur. */
  readonly motif: string;
}

/** Recu de transformation approuvee, exige pour C3. */
export interface RecuTransformation {
  readonly transformId: string;
}

/**
 * Registre FERME des transformations dont la sortie est requalifiee C3.
 * Aujourd'hui une seule entree, documentee, sans producteur en production :
 * aucun appelant ne presente ce recu, donc C3 reste bloque partout jusqu'a
 * ce qu'un producteur dedie (hors M05) l'adopte. Ajouter une entree exige une
 * decision humaine explicite.
 */
export const TRANSFORMATIONS_APPROUVEES: readonly string[] = ["agg-finance-v1"] as const;

/** Refus honnete, delivre quand le local est requis mais indisponible (M13). */
export const MESSAGE_REFUS_LOCAL =
  "Je ne peux pas traiter cette demande localement pour le moment.";

/** Refus honnete quand la frontiere bloque une inference externe sensible. */
export const MESSAGE_REFUS_FRONTIERE =
  "Je ne peux pas traiter cette demande : elle contient des donnees du cabinet qui ne quittent pas la machine.";

// ── Motifs directs : vrais sans connaitre aucun dossier ─────────────────────

const MOTIF_MOBILE = /\b0[5-7]\d{8}\b/;
const MOTIF_FIXE = /\b0[1-4]\d{7,8}\b/;
const MOTIF_INTERNATIONAL = /(?:\+|00)213\s?\d[\d\s.\-]{7,}/;
const MOTIF_COURRIEL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/;
const MOTIF_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MOTIF_UUID_SANS_TIRETS = /\b[0-9a-f]{32}\b/i;
/** `D-301`, `D-2026-0417` : le numero de dossier, jamais une prose. */
const MOTIF_NUMERO_DOSSIER = /\bD-\d[\d.\-_/]*\d\b/;
/** Jetons stables : la preuve que la charge derive d'un dossier. */
const MOTIF_JETON = /\{\{[^}]*\}\}|[A-Z]{2,12}_\d{2,}|(?<![A-Za-z])P\d{1,3}(?![0-9])/;

// ── Ancrage personne : noms et references ───────────────────────────────────

/** Deux mots capitalises consecutifs : jamais un verbe en debut de phrase. */
const MOTIF_NOM_COMPLET = /[A-ZÀ-Þ][a-zà-ÿ'’\-]{1,30}\s+[A-ZÀ-Þ][a-zà-ÿ'’\-]{1,30}/;
/**
 * Nom de famille en capitales + prenom (forme des dossiers : "DJILALI Karim").
 * SENS UNIQUE : capitales PUIS capitalise. L'inverse ("Dans CETTE") est la
 * typographie d'insistance des prompts systeme, pas un nom. `sansInterjections`
 * retire au prealable les faux amis ("OK Merci").
 */
const MOTIF_NOM_COMPLET_MAJ =
  /[A-ZÀ-Þ]{2,}(?:['’\-][A-ZÀ-Þ]+)?\s+[A-ZÀ-Þ][a-zà-ÿ'’\-]{1,30}/;
/** Un mot capitalise isole (hors tete de phrase, traitee par l'appelant). */
const MOTIF_NOM_SIMPLE = /[A-ZÀ-Þ][a-zà-ÿ'’\-]{2,}/;
/** Nom simple tout en capitales ("DJILALI consulte"), 3 lettres minimum. */
const MOTIF_NOM_SIMPLE_MAJ = /(?<![A-Za-zÀ-Þ])[A-ZÀ-Þ]{3,}(?![A-Za-zÀ-Þ])/;
/** Verbes cliniques : "Karim consulte" est une personne, meme en tete. */
const MOTIF_VERBE_CLINIQUE =
  /\b(consulte|presente|souffre|prend|declare|rapporte|dit|plaint|vient|revient|appelle|paie|dort|va)\b/;
/** Suite de lettres espacees ("K a r i m") : jamais de la prose legitime. */
const MOTIF_OBFUSCATION = /(?:[A-Za-zÀ-Þ]\s){5,}[A-Za-zÀ-Þ]/;

/**
 * Ancre clinique / metier : ne declenche qu'AVEC un nom simple. Le lexique
 * seul ne prouve rien (les prompts systeme en sont pleins). "vient" est borne
 * en mot entier : "parvient"/"devient" ne sont pas des rendez-vous.
 */
const ANCRE_CLINIQUE =
  /(consult|patient|dossier|traitement|ordonnance|diagnostic|symptome|anxiete|depress|seance|rendez|agenda|suivi|bilan|prescri|medicament|sertraline|therapie|trouble|apres|prochain|paye|paiement|recette|facture|cas|note|analyse|resume|evolution)\w*|\b(viens?|viennent)\b/;

/**
 * Reference a une personne SANS identite etablie : pronom ou demonstratif +
 * nom clinique. `son dossier` est EXCLU : le prompt connaissance l'emploie
 * ("tu ne vois pas son dossier ici") et le scanner bloquerait tout le C4.
 */
const MOTIF_REFERENCE_INCONNUE =
  /\b(mon|ma|mes|ce|cette)\s+(patient|patiente|dossier|cas|suivi|etat)\b|\b(sa|son|ses)\s+(consultation|seance|traitement|ordonnance|posologie|analyse|resume|angoisse|anxiete|depression|symptome|douleur|suivi|cas|etat)\b|\b(ouvre|ouvre[rz]?|prepare\w*|montre\w*|resume\w*)\s+(son|sa|leur)\b/i;

// ── Injection / exfiltration : le contenu reste DONNEE ──────────────────────

const MOTIF_INJECTION =
  /ignore\s+(toutes?\s+)?les\s+(regles|instructions|consignes)|envoie?\s+\S*\s*(dossier|donnees)\s+(complet|entiers?)?|transmets?\s+.*dossier|copie\s+.*dossier/i;
const MOTIF_DESTINATION_EXTERNE = /openrouter|openai|gemini|groq|elevenlabs|api\s+externe/i;

// ── C3 : forme d'agregat pur ────────────────────────────────────────────────

/** Cles autorisees dans un agregat C3. Tout le reste disqualifie la forme. */
const CLES_AGREGAT = new Set([
  "total",
  "devise",
  "nombre",
  "montant",
  "porte",
  "date",
  "jour",
  "semaine",
  "mois",
  "count",
  "especes",
  "virement",
]);

function estAgregatPur(valeur: unknown): boolean {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) return false;
  const entrees = Object.entries(valeur as Record<string, unknown>);
  if (entrees.length === 0 || entrees.length > 12) return false;
  for (const [cle, v] of entrees) {
    if (!CLES_AGREGAT.has(cle)) return false;
    if (typeof v === "number" && Number.isFinite(v)) continue;
    if (typeof v === "string") {
      if (/^(DZD|[\d\s.,:+\-_{}/]+|\d{4}-\d{2}-\d{2}[T\d:+-]*|app\.[a-z_]+)$/.test(v.trim())) continue;
      return false;
    }
    return false;
  }
  return true;
}

// ── Normalisation : une seule passe, bornee ─────────────────────────────────

function normaliserBase(texte: string): string {
  // NFKC rabat les variantes pleine largeur (attaque unicode) vers l'ASCII.
  return texte.normalize("NFKC");
}

function sansDiacritiques(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** "K a r i m" -> "Karim" : une passe, pas de recursion. */
function recollerEspaces(texte: string): string {
  return texte.replace(/\b(?:[A-Za-zÀ-Þ] ){2,}[A-Za-zÀ-Þ]\b/g, (m) => m.replaceAll(" ", ""));
}

function decoderBase64(texte: string): string {
  const candidats = texte.match(/[A-Za-z0-9+/]{12,}={0,2}/g) ?? [];
  const morceaux: string[] = [];
  for (const c of candidats.slice(0, 8)) {
    if (c.length % 4 !== 0) continue;
    try {
      const dec = Buffer.from(c, "base64").toString("utf8");
      if (/^[\p{L}\p{N}\s.,'’\-:;!?()]{8,}$/u.test(dec)) morceaux.push(dec);
    } catch {
      // Candidat non-base64 : ignore, jamais fatal.
    }
  }
  return morceaux.join("\n");
}

// ── Feuilles : les valeurs, jamais les cles de notre schema ─────────────────

function feuillesTextuelles(valeur: unknown, acc: string[]): string[] {
  if (typeof valeur === "string") {
    acc.push(valeur);
  } else if (Array.isArray(valeur)) {
    for (const v of valeur) feuillesTextuelles(v, acc);
  } else if (typeof valeur === "object" && valeur !== null) {
    for (const v of Object.values(valeur as Record<string, unknown>)) feuillesTextuelles(v, acc);
  }
  return acc;
}

function serialiser(charge: unknown): string {
  try {
    const s = JSON.stringify(charge ?? null);
    return typeof s === "string" ? s : String(charge ?? "");
  } catch {
    return "[charge non serialisable]";
  }
}

/** Marqueurs de derive clinique : distinguent C2 de C1, a personne egale. */
const MARQUEUR_C2 =
  /(resume|analyse|bilan|synthese|evolution|plan\s+de\s+traitement|compte.?rendu|^s\s*:|^o\s*:|^a\s*:|^p\s*:|soap)/;

function classePersonne(texteAbaisse: string): ClasseDonnees {
  return MARQUEUR_C2.test(texteAbaisse) ? "C2" : "C1";
}

/**
 * Verdict sur la charge ENTIERE. `recu` ne peut qu'autoriser un agregat pur
 * sans aucun autre signal : les octets gagnent toujours contre le recu.
 */
export function classerCharge(charge: unknown, recu: RecuTransformation | null): VerdictEgress {
  const brut = serialiser(charge);
  const base = normaliserBase(brut);
  // Variantes : base64 decode, espaces interlettres recolles, "+" de query.
  // Chaque variante AJOUTE du texte a scanner, sans jamais en retirer.
  const scan = `${base}\n${decoderBase64(base)}\n${recollerEspaces(base)}\n${base.replace(/\+/g, " ")}`;
  const abaisse = sansDiacritiques(scan);

  // R1 : identifiants directs — globaux, jamais dans les gabarits systeme.
  if (
    MOTIF_MOBILE.test(scan) ||
    MOTIF_FIXE.test(scan) ||
    MOTIF_INTERNATIONAL.test(scan) ||
    MOTIF_COURRIEL.test(scan) ||
    MOTIF_UUID.test(scan) ||
    MOTIF_UUID_SANS_TIRETS.test(scan) ||
    MOTIF_NUMERO_DOSSIER.test(scan)
  ) {
    return { decision: "BLOQUER", classe: classePersonne(abaisse), motif: "c1:identifiant-direct" };
  }

  // R2 : jetons — pseudonymise reste patient, global pour la meme raison.
  if (MOTIF_JETON.test(base)) {
    return { decision: "BLOQUER", classe: classePersonne(abaisse), motif: "c1:jeton-stable" };
  }

  // R6 : injection / exfiltration explicite, meme sans identifiant visible.
  if (MOTIF_INJECTION.test(abaisse) || MOTIF_DESTINATION_EXTERNE.test(abaisse)) {
    return { decision: "BLOQUER", classe: "INCONNU", motif: "inconnu:injection-ou-exfiltration" };
  }

  // Pour les heuristiques de PERSONNE (noms, references), on ne regarde que
  // le texte CONTROLE par l'utilisatrice : les gabarits systeme
  // (PROMPT_CONNAISSANCE etc.) contiennent "Dans CETTE reponse" + "dossier"
  // et declencheraient sinon chaque C4. Les identifiants ci-dessus restent
  // globaux : un UUID dans une feuille systeme ne doit jamais partir non plus.
  const { scanUtilisateur, abaisseUtilisateur } = extraireScanUtilisateur(charge, base, scan, abaisse);

  // R3 : nom complet, n'importe ou (y compris "NOM Prenom" des dossiers).
  if (
    MOTIF_NOM_COMPLET.test(scanUtilisateur) ||
    MOTIF_NOM_COMPLET_MAJ.test(sansInterjections(scanUtilisateur))
  ) {
    return { decision: "BLOQUER", classe: classePersonne(abaisseUtilisateur), motif: "c1:nom-complet" };
  }

  // R4 : nom simple hors tete de phrase + ancre metier, ou nom + verbe clinique.
  if (nomSimpleAncre(scanUtilisateur, abaisseUtilisateur) || nomPlusVerbe(scanUtilisateur)) {
    return { decision: "BLOQUER", classe: classePersonne(abaisseUtilisateur), motif: "c1:nom-ancre" };
  }

  // R-obfuscation : lettres espacees une a une, jamais de la prose.
  if (MOTIF_OBFUSCATION.test(scanUtilisateur)) {
    return { decision: "BLOQUER", classe: "INCONNU", motif: "inconnu:obfuscation" };
  }

  // R5 : reference personne sans identite -> INCONNU -> BLOQUER.
  if (MOTIF_REFERENCE_INCONNUE.test(scanUtilisateur)) {
    return { decision: "BLOQUER", classe: "INCONNU", motif: "inconnu:reference-personne" };
  }

  // R7 : agregat C3, recu exige.
  if (contientAgregat(charge)) {
    if (recu !== null && TRANSFORMATIONS_APPROUVEES.includes(recu.transformId)) {
      return { decision: "AUTORISER", classe: "C3", motif: "c3:transform-approuvee" };
    }
    return { decision: "BLOQUER", classe: "C3", motif: "c3:sans-recu-approuve" };
  }

  return { decision: "AUTORISER", classe: "C4", motif: "c4:generique" };
}

/**
 * Isole le texte controle par l'utilisatrice pour les heuristiques de
 * personne (R3/R4/R5, obfuscation). Deux formes de charge a messages :
 * le tableau brut (tous les appelants de production : `llm()`,
 * `llmStream()`, `chargeBloqueeParEgress`) et l'objet qui le porte sous
 * `messages` (tests, harnesses). Dans les deux cas, seules les voix
 * NON-système comptent : `user` (demande directe) ET `assistant`
 * (historique rejoué, qui porte du texte affiché à l'écran, donc
 * potentiellement réhydraté — l'exclure laisserait passer des noms réels).
 * Le système est écrit par nous, jamais par l'utilisatrice : son
 * vocabulaire clinique ne doit pas déclencher à sa place.
 * Sinon (tests `{message:...}`, `{textes:...}` d'embeddings, chaînes,
 * malformés, aucun texte non-système trouvé) : tout le scan est
 * utilisateur — repli fail-closed, jamais un allow silencieux.
 * R1/R2/R6 (identifiants, jetons, injection) restent GLOBAUX, au-dessus.
 */
function messagesDe(charge: unknown): readonly unknown[] | null {
  // `Array.isArray` retrecit `unknown` vers `any[]` : l'assertion explicite
  // vers `readonly unknown[]` est le seul point de confiance, borne ici.
  if (Array.isArray(charge)) return charge as readonly unknown[];
  if (typeof charge === "object" && charge !== null && "messages" in charge) {
    const msgs = (charge as { messages?: unknown }).messages;
    if (Array.isArray(msgs)) return msgs as readonly unknown[];
  }
  return null;
}

function extraireScanUtilisateur(
  charge: unknown,
  baseGlobale: string,
  scanGlobal: string,
  abaisseGlobale: string,
): { scanUtilisateur: string; abaisseUtilisateur: string } {
  const msgs = messagesDe(charge);
  if (msgs !== null) {
    const textes = msgs
      .filter(
        (m): m is { role: string; content: string } =>
          typeof m === "object" && m !== null && typeof (m as { role?: unknown }).role === "string" && (m as { role: string }).role !== "system" && typeof (m as { content?: unknown }).content === "string",
      )
      .map((m) => m.content);
    if (textes.length > 0) {
      const joint = textes.join("\n");
      const baseU = normaliserBase(joint);
      const scanU = `${baseU}\n${decoderBase64(baseU)}\n${recollerEspaces(baseU)}\n${baseU.replace(/\+/g, " ")}`;
      return { scanUtilisateur: scanU, abaisseUtilisateur: sansDiacritiques(scanU) };
    }
  }
  // Pas une charge a messages, ou aucun texte non-système : tout est utilisateur.
  return { scanUtilisateur: scanGlobal, abaisseUtilisateur: abaisseGlobale };
}

/**
 * Nom simple capitalise HORS tete de phrase, avec ancre metier quelque part
 * dans la charge. La tete de phrase ("Explique-moi...", "Bonjour...") porte
 * un verbe ou une salutation, jamais un nom de patient.
 */
function nomSimpleAncre(base: string, abaisse: string): boolean {
  if (!ANCRE_CLINIQUE.test(abaisse)) return false;
  const phrases = base.split(/[.!?\n]+/);
  for (const phrase of phrases) {
    const mots = phrase.trim().split(/\s+/);
    // Premier MOT (pas premier token) exclu : tete de phrase ("Explique-moi...",
    // "Bonjour..."), meme derriere une puce "-", un guillemet ou une accolade
    // JSON. Seule la tete est exclue : "Qui vient apres Karim ?" garde "Karim".
    let premier = 0;
    while (
      premier < mots.length &&
      !/[\p{L}]/u.test((mots[premier] ?? "").replace(/^[^A-Za-zÀ-Þ]+/, "").charAt(0) ?? "")
    ) {
      premier++;
    }
    for (let i = 0; i < mots.length; i++) {
      if (i === premier) continue;
      const mot = mots[i] ?? "";
      if (MOTIF_NOM_SIMPLE.test(mot)) return true;
    }
  }
  return false;
}

/** "Karim consulte" : nom (meme en tete) colle a un verbe clinique. */
function nomPlusVerbe(scan: string): boolean {
  const phrases = scan.split(/[.!?\n;:,]+/);
  for (const phrase of phrases) {
    const mots = phrase.trim().split(/\s+/);
    for (let i = 0; i + 1 < mots.length; i++) {
      const courant = (mots[i] ?? "").replace(/["'«»()[\]{}]+/g, "");
      const suivant = sansDiacritiques(mots[i + 1] ?? "");
      if (
        (MOTIF_NOM_SIMPLE.test(courant) || MOTIF_NOM_SIMPLE_MAJ.test(courant)) &&
        MOTIF_VERBE_CLINIQUE.test(suivant)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Retire les faux amis tout-capitales avant la regle des noms en capitales. */
function sansInterjections(texte: string): string {
  return texte.replace(/\b(OK|KO|SOS|DZD|HT|TTC)\b/g, "");
}

/** Un agregat pur quelque part dans les feuilles disqualifie le C4. */
function contientAgregat(charge: unknown): boolean {
  if (estAgregatPur(charge)) return true;
  const feuilles = feuillesTextuelles(charge, []);
  for (const feuille of feuilles) {
    // Feuille JSON textuelle : un resultat d'outil serialise arrive ainsi.
    if (feuille.length <= 2000 && feuille.trimStart().startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(feuille);
        if (estAgregatPur(parsed)) return true;
      } catch {
        // Pas du JSON : les autres regles tranchent.
      }
    }
  }
  if (typeof charge === "object" && charge !== null && !Array.isArray(charge)) {
    for (const v of Object.values(charge as Record<string, unknown>)) {
      if (estAgregatPur(v)) return true;
      if (Array.isArray(v) && v.some((e) => estAgregatPur(e))) return true;
    }
  }
  return false;
}

/**
 * Pre-filtre leger pour UN message (classifieur NLU, garde de route) : vrai
 * des qu'un signal patient est present. Meme source de verite que le verdict
 * complet, sans la logique C3 (une question n'est jamais un agregat).
 */
export function messagePorteUnSignalPatient(message: string): boolean {
  const base = normaliserBase(message);
  const scan = `${base}\n${recollerEspaces(base)}\n${base.replace(/\+/g, " ")}`;
  const abaisse = sansDiacritiques(scan);
  // Meme decoupe que `classerCharge` cote utilisateur : le pre-filtre ne voit
  // que le message libre, jamais un gabarit systeme.
  return (
    MOTIF_MOBILE.test(scan) ||
    MOTIF_FIXE.test(scan) ||
    MOTIF_INTERNATIONAL.test(scan) ||
    MOTIF_COURRIEL.test(scan) ||
    MOTIF_UUID.test(scan) ||
    MOTIF_UUID_SANS_TIRETS.test(scan) ||
    MOTIF_NUMERO_DOSSIER.test(scan) ||
    MOTIF_JETON.test(base) ||
    MOTIF_INJECTION.test(abaisse) ||
    MOTIF_DESTINATION_EXTERNE.test(abaisse) ||
    MOTIF_NOM_COMPLET.test(scan) ||
    MOTIF_NOM_COMPLET_MAJ.test(sansInterjections(scan)) ||
    nomSimpleAncre(scan, abaisse) ||
    nomPlusVerbe(scan) ||
    MOTIF_OBFUSCATION.test(scan) ||
    MOTIF_REFERENCE_INCONNUE.test(scan)
  );
}
