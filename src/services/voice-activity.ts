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

const abonnes = new Set<Abonne>();

function notifier(): void {
  for (const abonne of abonnes) abonne();
}

function changer(proprietaire: "reveil" | "boucle" | "champ", actif: boolean): void {
  const courant = proprietaire === "reveil" ? reveil : proprietaire === "boucle" ? boucle : champ;
  if (courant === actif) return;
  if (proprietaire === "reveil") reveil = actif;
  else if (proprietaire === "boucle") boucle = actif;
  else champ = actif;
  notifier();
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

/** Une capture est ouverte, quelle qu'en soit la machine. */
export function captureActive(): boolean {
  return reveil || boucle || champ;
}

/** Un son de synthèse ne doit pas démarrer pendant une capture. */
export function lectureInterdite(): boolean {
  return captureActive();
}

/** La boucle directe est-elle active ? (utile au lecteur automatique). */
export function boucleActive(): boolean {
  return boucle;
}

/** Le réveil possède-t-il une capture ? (diagnostic et tests). */
export function wakeBusy(): boolean {
  return reveil;
}

/** S'abonner aux changements de propriétaire — pour rafraîchir un bouton. */
export function abonnerActivite(abonne: Abonne): () => void {
  abonnes.add(abonne);
  return () => {
    abonnes.delete(abonne);
  };
}
