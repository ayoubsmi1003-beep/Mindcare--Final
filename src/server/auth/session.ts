/**
 * La session locale — SERVEUR UNIQUEMENT.
 *
 * Remplace GoTrue. Trois différences de fond avec ce qu'on abandonne, et chacune
 * est un gain, pas un compromis :
 *
 * 1. LE JETON EST OPAQUE, PAS UN JWT. Un JWT se vérifie hors ligne, ce qui est
 *    exactement ce qui empêche de le révoquer : une déconnexion ne peut que
 *    l'oublier côté client, il reste valide jusqu'à son expiration. Ici, rien ne
 *    vérifie le jeton hors ligne — chaque requête consulte `auth.sessions`, donc
 *    `destroy_session` déconnecte VRAIMENT, dans la seconde.
 *
 * 2. LA BASE NE VOIT JAMAIS LE JETON. On lui envoie son SHA-256. Une sauvegarde
 *    de la base, ou une lecture de `auth.sessions`, ne permet de rejouer aucune
 *    session.
 *
 * 3. LE JETON NE TRAVERSE JAMAIS VERS LE NAVIGATEUR PAR JAVASCRIPT. Cookie
 *    `httpOnly` : ni `document.cookie`, ni une extension, ni un XSS ne peuvent
 *    le lire. C'est la raison pour laquelle `DbPort.signIn` continue de ne
 *    rendre que `{ userId }` — le jeton ne quitte pas le pot de cookies.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { withAuthGate } from "@/server/db/withCaller";

/**
 * 32 octets = 256 bits d'entropie, tirés du générateur cryptographique du
 * système. `Math.random()` serait ici une faille : il est prédictible à partir
 * de quelques sorties, et un jeton de session prédictible est une usurpation.
 *
 * `base64url` plutôt que `hex` : même entropie, une chaîne plus courte, et
 * aucun caractère qui demanderait un échappement dans un en-tête `Set-Cookie`.
 */
function engendrerJeton(): string {
  return randomBytes(32).toString("base64url");
}

/** Le SHA-256 du jeton, sous la forme `bytea` attendue par PostgreSQL. */
function hacher(jeton: string): Buffer {
  return createHash("sha256").update(jeton, "utf8").digest();
}

export const NOM_COOKIE = "mc_session";

/**
 * Les attributs du cookie, et la raison de chacun.
 *
 * `httpOnly` — voir §3 de l'en-tête.
 * `sameSite: "lax"` — bloque l'envoi du cookie sur une requête inter-site
 *   (donc la CSRF de base) tout en laissant fonctionner une navigation
 *   ordinaire. `strict` casserait un simple lien externe vers l'application.
 * `path: "/"` — la session vaut pour toute l'application.
 *
 * ⚠️ `secure` EST LE PIÈGE DE CETTE PHASE, et il coûte une session de
 * débogage à qui ne le connaît pas. Sur `http://localhost` — c'est-à-dire en
 * développement ET dans Electron — Chromium JETTE SILENCIEUSEMENT un cookie
 * `Secure`. Aucune erreur, aucun avertissement : la connexion « réussit », la
 * redirection a lieu, et l'écran suivant se comporte comme si personne n'était
 * connecté. Le symptôme (« ça me déconnecte aussitôt ») ne désigne jamais le
 * cookie.
 *
 * D'où le pilotage par `MC_HTTPS`, et l'assertion de `asserterCoherenceCookie()`
 * plus bas : un `secure` faux est LÉGITIME sur une boucle locale, et
 * INACCEPTABLE sur une écoute réseau.
 */
export function optionsCookie(maxAgeSecondes: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.MC_HTTPS === "1",
    maxAge: maxAgeSecondes,
  };
}

/**
 * Refuse de servir un cookie de session en clair sur autre chose qu'une boucle
 * locale.
 *
 * Sans cette vérification, la configuration qui rend le développement agréable
 * (`MC_HTTPS` absent) deviendrait, le jour où l'on ouvre l'écoute au réseau du
 * cabinet, un jeton de session circulant en clair sur le réseau — sans que rien
 * ne le signale. Le réglage ne changerait pas ; c'est son contexte qui
 * changerait. On vérifie donc le contexte.
 */
export function asserterCoherenceCookie(hote: string | undefined): void {
  if (process.env.MC_HTTPS === "1") return;
  const h = (hote ?? "").trim().toLowerCase();
  const boucleLocale =
    h === "" || h.startsWith("127.0.0.1") || h.startsWith("localhost") || h.startsWith("[::1]");
  if (!boucleLocale) {
    throw new Error(
      "Cookie de session non chiffré sur une écoute non locale. " +
        "Poser MC_HTTPS=1 derrière TLS, ou n'écouter que sur 127.0.0.1.",
    );
  }
}

export interface SessionOuverte {
  readonly userId: string;
  readonly jeton: string;
  readonly expiresAt: Date;
}

/**
 * Vérifie les identifiants et ouvre une session.
 *
 * Rend `null` pour TOUS les refus — mot de passe faux, compte inconnu, compte
 * désactivé, hachage hérité. La distinction existe en base (070 §4a) et n'en
 * sort pas : un appelant qui pourrait distinguer « compte inconnu » de « mot de
 * passe faux » disposerait d'un annuaire du personnel du cabinet.
 */
export async function ouvrirSession(
  email: string,
  motDePasse: string,
): Promise<SessionOuverte | null> {
  return withAuthGate(async (q) => {
    const verif = await q.query<{ id: string | null }>(
      "SELECT auth.verify_password($1, $2) AS id",
      [email, motDePasse],
    );
    const userId = verif[0]?.id ?? null;
    if (userId === null) return null;

    // Le jeton est engendré APRÈS la vérification : sur un échec, aucune ligne
    // n'est écrite et aucun secret n'a été fabriqué pour rien.
    const jeton = engendrerJeton();
    const ouverture = await q.query<{ expire: Date }>(
      "SELECT auth.create_session($1, $2) AS expire",
      [userId, hacher(jeton)],
    );
    const expiresAt = ouverture[0]?.expire;
    if (expiresAt === undefined) {
      // Ne peut pas arriver : la fonction rend toujours une valeur ou lève. On
      // le traite quand même, parce qu'un `undefined` silencieux ici produirait
      // un cookie sans expiration.
      throw new Error("Ouverture de session sans horizon d'expiration.");
    }
    return { userId, jeton, expiresAt };
  });
}

/**
 * Rend l'identité portée par un jeton, ou `null`.
 *
 * C'est la fonction que la frontière HTTP appellera à chaque requête (phase 4)
 * pour alimenter `withCaller`. Elle fait glisser la fenêtre d'inactivité, donc
 * elle ÉCRIT : ce n'est pas une lecture pure, et elle ne doit pas être mise en
 * cache.
 */
export async function resoudreSession(jeton: string | undefined): Promise<string | null> {
  if (jeton === undefined || jeton.trim() === "") return null;
  return withAuthGate(async (q) => {
    const r = await q.query<{ id: string | null }>(
      "SELECT auth.resolve_session($1) AS id",
      [hacher(jeton)],
    );
    return r[0]?.id ?? null;
  });
}

/** Révoque une session. Idempotent : fermer deux fois n'est pas une erreur. */
export async function fermerSession(jeton: string | undefined): Promise<void> {
  if (jeton === undefined || jeton.trim() === "") return;
  await withAuthGate(async (q) => {
    await q.query("SELECT auth.destroy_session($1)", [hacher(jeton)]);
    return null;
  });
}

/**
 * Comparaison de jetons à temps constant.
 *
 * Pas utilisée par le chemin de session — la base compare des SHA-256 par
 * égalité d'index, ce qui ne fuit rien d'exploitable. Exportée pour le jour où
 * un jeton devra être comparé EN JAVASCRIPT (une invitation, un lien de
 * réinitialisation) : `===` sur une chaîne s'arrête au premier octet différent,
 * et cette différence de durée se mesure.
 */
export function jetonsEgaux(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
