/** Conservative route for health questions. Ambiguous clinical terms go to books. */
const LATIN = /\b(?:medic(?:ament|ine|al)|sante|health|clinical|clinique|psychiatr|psycholog|psychotherap|therap|traitement|treatment|diagnos|symptom|trouble|disorder|depress|anxi|bipol|schizophren|psychos|suicid|insomn|sommeil|sleep|dose|dosage|dosing|posolog|mg|microgram|contre.indication|contraindication|effet.secondaire|side.effect|adverse|interaction|risqu|risk|safe|prescri|ordonnance|drug|dwa|sertralin|lithium|antidepresseur|antidepressant|antipsychot|neurolept|benzodiazep|sevrage|withdrawal|hospitalis|patient|malade|maladie|disease|tension|pression.arterielle|heart|cardiac|grossesse|pregnan)\w*\b/i;
const ARABIC = /(?:طب|طبي|دواء|ادوية|أدوية|علاج|تشخيص|اكتئاب|قلق|جرعة|مريض|مريضة|نفسي|انتحار|نوم)/u;
// The default is book-only. Only explicit, nonclinical intents use general
// knowledge; an unfamiliar drug name must not become a false negative.
const NON_MEDICAL = /\b(?:bonjour|bonsoir|salut|hello|hi|merci|thank|traduis|translate|reformule|corrige|orthograph|courriel|email|message.professionnel|document.administratif|budget|performance|finance|comptabilit|agenda|rendez.vous|code|programm|logiciel|interface|architecture|math|calcul|relativit|physique|histoire|geograph|capital|pays|voyage|meteo|weather)\w*\b/i;

export function estQuestionMedicale(text: string): boolean {
  const normalized = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (LATIN.test(normalized) || ARABIC.test(text)) return true;
  return !NON_MEDICAL.test(normalized);
}
