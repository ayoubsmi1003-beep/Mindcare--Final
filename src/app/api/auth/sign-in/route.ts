/**
 * `POST /api/auth/sign-in` — la seule porte d'entrée de l'application.
 *
 * ⚠️ CE FICHIER NE PARLE PAS À `pgPort`. La frontière de données générique
 * (`/api/db/rpc`) est la phase 4 et n'existe pas encore. Cette route-ci
 * n'appelle que les quatre portes d'authentification de 070, par
 * `withAuthGate()` — aucun accès aux données du cabinet ne passe par ici.
 *
 * CE QU'ELLE NE REND JAMAIS :
 *   · le jeton de session (il part en cookie `httpOnly`, jamais dans le corps) ;
 *   · la raison du refus (voir plus bas) ;
 *   · le moindre détail d'une erreur PostgreSQL.
 */

import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  NOM_COOKIE,
  asserterCoherenceCookie,
  optionsCookie,
  ouvrirSession,
} from "@/server/auth/session";
import {
  enregistrerEchec,
  enregistrerSucces,
  estBloque,
} from "@/server/auth/limite-debit";

/**
 * Bornes de saisie. `max(72)` sur le mot de passe n'est pas une limite de
 * confort : bcrypt ignore silencieusement ce qui dépasse 72 octets (070 §4a
 * pose la même borne en base). Refuser est plus honnête que tronquer.
 */
const Entree = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(72),
});

/**
 * L'IP d'origine. En local, `x-forwarded-for` n'existe pas et on retombe sur une
 * constante — ce qui est correct : sur un poste unique, la limitation par
 * couple IP+email dégénère en limitation par email, et c'est le comportement
 * voulu.
 *
 * On ne fait PAS confiance à `x-forwarded-for` pour autre chose que ce
 * compteur. Un en-tête falsifiable ne doit jamais porter une décision
 * d'autorisation ; ici il ne porte qu'un seau de jetons.
 */
async function origine(): Promise<string> {
  const h = await headers();
  const xff = h.get("x-forwarded-for");
  if (xff !== null && xff.trim() !== "") {
    return xff.split(",")[0]?.trim() ?? "local";
  }
  return "local";
}

export async function POST(requete: Request): Promise<NextResponse> {
  let corps: unknown;
  try {
    corps = await requete.json();
  } catch {
    return NextResponse.json({ ok: false, code: "regle-metier" }, { status: 400 });
  }

  const analyse = Entree.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ ok: false, code: "regle-metier" }, { status: 400 });
  }
  const { email, password } = analyse.data;

  const ip = await origine();

  if (estBloque(ip, email)) {
    // 429 plutôt que 401 : c'est le seul cas où l'on dit quelque chose de plus,
    // et ce quelque chose ne renseigne pas sur l'existence du compte — il
    // renseigne sur le comportement de l'appelant, qui le connaît déjà.
    return NextResponse.json({ ok: false, code: "regle-metier" }, { status: 429 });
  }

  let session: Awaited<ReturnType<typeof ouvrirSession>>;
  try {
    const h = await headers();
    // Avant de POSER un cookie, on vérifie qu'on a le droit de le poser en
    // clair. Mieux vaut une panne au premier essai qu'un jeton de session
    // circulant sur le réseau du cabinet sans que personne ne l'ait décidé.
    asserterCoherenceCookie(h.get("host") ?? undefined);
    session = await ouvrirSession(email, password);
  } catch (e) {
    // La base est injoignable, ou la configuration du cookie est incohérente.
    //
    // ═══ POURQUOI ON JOURNALISE L'ORGANE, PAS SEULEMENT LE CODE ═══════════
    //
    // LM54.3 : des sessions entières ont cherché la cause côté client
    // (`http.ts`, extensions navigateur) parce que le serveur rendait
    // « indisponible » sans rien dire d'autre. Le 503 au client reste
    // correct — il ne doit porter AUCUN détail, le message de PostgreSQL
    // peut citer l'URL de connexion, donc le mot de passe. Mais le JOURNAL
    // du serveur, lui, doit permettre de distinguer en une ligne :
    //   · `ECONNREFUSED`/`ETIMEDOUT` → la dépendance de données manque
    //     (Docker/conteneur/mc-p3) — la panne qu'on vient de rendre
    //     impossible au DÉMARRAGE, mais qui peut frapper EN COURS de
    //     session ;
    //   · une erreur de cohérence de cookie → la configuration, pas la base ;
    //   · tout le reste (rôle, migration) → la base a répondu « non ».
    //
    // On ne journalise que `.name`/`.code` — jamais `.message` (V1.1, I5).
    const nom = e instanceof Error ? e.name : undefined;
    const codeErreur = e instanceof Error ? (e as { code?: string }).code : undefined;
    console.error(
      `[sign-in] 503 indisponible — cause technique: ${codeErreur ?? nom ?? "inconnue"} ` +
        `(contexte: ouverture de session / cohérence cookie)`,
    );
    return NextResponse.json({ ok: false, code: "indisponible" }, { status: 503 });
  }

  if (session === null) {
    enregistrerEchec(ip, email);
    // UN SEUL CODE POUR TOUS LES REFUS. « Compte inconnu », « mot de passe
    // faux », « compte désactivé » et « hachage hérité » sont indistinguables
    // ici comme ils le sont en base (070 §4a). Les séparer donnerait un
    // annuaire du personnel à qui sait lire un code de statut.
    return NextResponse.json({ ok: false, code: "identifiants-refuses" }, { status: 401 });
  }

  enregistrerSucces(ip, email);

  const magasin = await cookies();
  const dureeSecondes = Math.max(
    0,
    Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
  );
  magasin.set(NOM_COOKIE, session.jeton, optionsCookie(dureeSecondes));

  // `userId` SEUL. Le jeton reste dans le pot de cookies : c'est ce qui permet
  // à `DbPort.signIn` de garder exactement la signature qu'il avait du temps de
  // Supabase (`Result<SessionInfo>` avec `{ userId }`), donc à `auth.ts` et à
  // l'écran de connexion de ne pas changer d'une ligne.
  return NextResponse.json({ ok: true, data: { userId: session.userId } });
}
