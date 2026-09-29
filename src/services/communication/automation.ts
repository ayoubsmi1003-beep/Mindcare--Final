/**
 * Automation — DÉTECTION pure (client + serveur).
 *
 * `detecterContenuClinique` ne diagnostique rien : il lève un drapeau qui
 * conduit à une escalade humaine + réponse prédéfinie
 * (`frCommunication.escaladeClinique`). L'IA ne donne jamais d'avis médical
 * ici — c'est le point de non-négociation de Phase 6.
 *
 * L'évaluation (TRIGGER → CONDITIONS → ACTION → VÉRIFICATION → AUDIT) vit
 * côté serveur : `src/server/communication/automation.ts`.
 */

export interface BilanAutomation {
  readonly rappels: number;
  readonly sansReponse: number;
  readonly escalades: number;
}

// Un seul littéral, alternance interne (jamais `/(a)/|(b)/`).
const LEXIQUE_CLINIQUE =
  /(suicid|suicide|automutil|overdose|tuer|mourir|mort|انتحار|قتل|ordonnance|وصفة|médicament|medicament|دواء|douleur|ألم|وجع|dépress|depress|اكتئاب|anxiété|anxiete|قلق|angoisse|insomnie|أرق|traitement|علاج|dose|جرعة|crise|نوبة|psychose|ذهان|hallucin|هلوس|manie|هوس|TOC|trouble|اضطراب)/;

export function detecterContenuClinique(texte: string): boolean {
  if (texte.trim() === "") return false;
  // NFKC + minuscules, SANS chasse aux diacritiques : la décomposition NFD
  // scinde ئ en ي + hamza-suscrit, qu'une plage latine ne retire pas — le
  // lexique ne matcherait plus l'arabe. Les formes accentuées françaises
  // figurent en double dans le lexique (anxiété|anxiete).
  const normalise = texte.normalize("NFKC").toLowerCase();
  return LEXIQUE_CLINIQUE.test(normalise);
}
