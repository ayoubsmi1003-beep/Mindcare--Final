/**
 * Racine — redirection, aucun contenu propre.
 *
 * Ce fichier rendait `null`, donc un écran BLANC : ouvrir l'application à son
 * adresse racine donnait une page vide, indiscernable d'une panne. Le tableau
 * de bord n'existe pas encore ; le seul écran construit est Patients, et c'est
 * lui qui décide quoi faire d'un visiteur sans session (il renvoie vers la
 * connexion). Une seule porte d'entrée, donc, plutôt qu'un test de session
 * dupliqué ici — qui divergerait le jour où l'un des deux changerait.
 */

import { redirect } from "next/navigation";

export default function Racine(): never {
  redirect("/patients");
}
