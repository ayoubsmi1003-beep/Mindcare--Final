/**
 * Limitation de débit des tentatives de connexion — SERVEUR UNIQUEMENT.
 *
 * POURQUOI EN MÉMOIRE, ET POURQUOI C'EST SUFFISANT ICI. Un compteur en mémoire
 * est perdu au redémarrage et ne se partage pas entre processus. Dans le cas
 * général c'est disqualifiant ; ici, l'application est UN processus Node sur le
 * poste du cabinet, et le redémarrage n'est pas un levier pour l'attaquant :
 * il faudrait déjà pouvoir redémarrer le service, c'est-à-dire avoir la main
 * sur la machine — auquel cas la limitation de débit n'est plus le sujet.
 *
 * Introduire Redis pour cela ajouterait un service à installer, surveiller et
 * sauvegarder chez une médecin qui n'a pas d'informaticien. Le coût réel
 * dépasserait le gain réel.
 *
 * CE QUE ÇA PROTÈGE, ET CE QUE ÇA NE PROTÈGE PAS. Ça ralentit l'essai
 * systématique de mots de passe. Ça ne remplace pas un bon mot de passe, et ça
 * n'empêche pas un attaquant qui a déjà la base de la travailler hors ligne —
 * c'est le rôle de bcrypt.
 */

/**
 * La clé combine IP ET email. Chacune seule serait contournable :
 *   · par email seul, un attaquant bloquerait la praticienne en saturant son
 *     compte depuis n'importe où — un déni de service offert ;
 *   · par IP seule, il suffirait de balayer les comptes depuis une seule IP.
 * Les compter ensemble mesure ce qui compte : l'acharnement sur UN compte
 * depuis UNE origine.
 */
function cle(ip: string, email: string): string {
  return `${ip} ${email.trim().toLowerCase()}`;
}

const FENETRE_MS = 15 * 60 * 1000;
const MAX_ECHECS = 10;

interface Compteur {
  echecs: number;
  premierEchec: number;
}

const compteurs = new Map<string, Compteur>();

/**
 * Purge paresseuse : on ne programme pas de minuteur, on nettoie en passant.
 * Un `setInterval` empêcherait le processus de se terminer proprement et
 * n'apporterait rien — la carte ne grandit que sur des ÉCHECS, et un cabinet
 * de trois personnes n'en produit pas assez pour peser.
 */
function purger(maintenant: number): void {
  for (const [k, c] of compteurs) {
    if (maintenant - c.premierEchec > FENETRE_MS) compteurs.delete(k);
  }
}

/** `true` si la tentative doit être refusée sans même consulter la base. */
export function estBloque(ip: string, email: string): boolean {
  const maintenant = Date.now();
  purger(maintenant);
  const c = compteurs.get(cle(ip, email));
  if (c === undefined) return false;
  if (maintenant - c.premierEchec > FENETRE_MS) return false;
  return c.echecs >= MAX_ECHECS;
}

export function enregistrerEchec(ip: string, email: string): void {
  const maintenant = Date.now();
  const k = cle(ip, email);
  const c = compteurs.get(k);
  if (c === undefined || maintenant - c.premierEchec > FENETRE_MS) {
    compteurs.set(k, { echecs: 1, premierEchec: maintenant });
    return;
  }
  c.echecs += 1;
}

/**
 * Une connexion réussie efface le compteur : sinon, la praticienne qui se
 * trompe neuf fois puis réussit resterait à une frappe du blocage pendant un
 * quart d'heure.
 */
export function enregistrerSucces(ip: string, email: string): void {
  compteurs.delete(cle(ip, email));
}

/** Remise à zéro — réservée aux tests, pour qu'ils ne s'influencent pas. */
export function reinitialiserLimites(): void {
  compteurs.clear();
}
