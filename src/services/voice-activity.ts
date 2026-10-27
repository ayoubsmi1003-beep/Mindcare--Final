/**
 * LE REGISTRE PARTAGÉ DES CAPTURES — un seul propriétaire du microphone.
 *
 * Trois machines ouvrent le même périphérique : le réveil (`jarvis-reveil`),
 * la boucle vocale directe (`alexa-local`) et la dictée d'un champ
 * (`DicteeChamp`). `jarvis-voix` ne tient qu'un `MediaRecorder` : deux prises
 * concurrentes produisent soit un conflit, soit — pire — la voix de Jarvis
 * enregistrée dans une note clinique.
 *
 * Ce module ne connaît AUCUNE des trois machines. Il porte seulement le fait
 * « une capture est ouverte », que chacune publie et que les lecteurs
 * consultent avant de demander un son. Il n'importe rien : aucun cycle, et le
 * registre reste éprouvable sans navigateur.
 */

type Abonne = () => void;

let reveil = false;
let boucle = false;
let champ = false;
/** Une synthèse sort réellement du haut-parleur (premier son → fin/arrêt). */
let lecture = false;

const abonnes = new Set<Abonne>();
/** Notifiés uniquement quand une CAPTURE commence (jamais pour la lecture). */
const abonnesCapture = new Set<Abonne>();

function notifier(): void {
  for (const abonne of abonnes) abonne();
}

function notifierCapture(): void {
  for (const abonne of abonnesCapture) abonne();
}

function changer(proprietaire: "reveil" | "boucle" | "champ", actif: boolean): void {
  const courant = proprietaire === "reveil" ? reveil : proprietaire === "boucle" ? boucle : champ;
  if (courant === actif) return;
  const avant = captureActive();
  if (proprietaire === "reveil") reveil = actif;
  else if (proprietaire === "boucle") boucle = actif;
  else champ = actif;
  notifier();
  // Une capture qui COMMENCE doit arrêter une lecture en cours ; passer d'un
  // propriétaire à un autre ne recommence pas une capture.
  if (!avant && captureActive()) notifierCapture();
}

/** La machine du réveil possède une capture de commande (accusé inclus). */
export function setWakeBusy(actif: boolean): void {
  changer("reveil", actif);
}

/** La boucle vocale directe possède le microphone (préparation, écoute, lecture). */
export function setLoopBusy(actif: boolean): void {
  changer("boucle", actif);
}

/** Une dictée de champ possède le microphone. */
export function setFieldBusy(actif: boolean): void {
  changer("champ", actif);
}

/**
 * La synthèse sort du haut-parleur. Ce n'est PAS une capture : le micro peut
 * être fermé. Mais une nouvelle capture doit être refusée tant que le son
 * sort, sinon elle enregistrerait la réponse d'Alexa.
 */
export function setPlaybackBusy(actif: boolean): void {
  if (lecture === actif) return;
  lecture = actif;
  // La lecture ne déclenche jamais `abonnerCapture` : sinon le lecteur global
  // s'arrêterait lui-même en commençant à parler.
  notifier();
}

/** Une capture est ouverte, quelle qu'en soit la machine. */
export function captureActive(): boolean {
  return reveil || boucle || champ;
}

/** Une synthèse est-elle réellement en train de sortir ? */
export function playbackBusy(): boolean {
  return lecture;
}

/** Aucun son ne doit démarrer pendant une capture — ni une capture pendant un son. */
export function lectureInterdite(): boolean {
  return captureActive() || playbackBusy();
}

/** La boucle directe est-elle active ? (utile au lecteur automatique). */
export function boucleActive(): boolean {
  return boucle;
}

/** Le réveil possède-t-il une capture de commande ? (diagnostic et tests). */
export function wakeBusy(): boolean {
  return reveil;
}

/** Une dictée de champ possède-t-elle le micro ? (garde C2). */
export function fieldBusy(): boolean {
  return champ;
}

/** S'abonner aux changements de propriétaire — pour rafraîchir un bouton. */
export function abonnerActivite(abonne: Abonne): () => void {
  abonnes.add(abonne);
  return () => {
    abonnes.delete(abonne);
  };
}

/**
 * S'abonner AU DÉBUT d'une capture seulement. Le lecteur global s'en sert pour
 * couper sa propre lecture quand une dictée ou un réveil prend le micro.
 */
export function abonnerCapture(abonne: Abonne): () => void {
  abonnesCapture.add(abonne);
  return () => {
    abonnesCapture.delete(abonne);
  };
}
