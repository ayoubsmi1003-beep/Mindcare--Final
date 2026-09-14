# Domaine authentification (CURRENT)

> ⚠️ UI/session ≠ autorisation. L'identité ouvre la porte ; RLS et les portes
> métier décident, à chaque requête, via le chemin serveur vérifié ci-dessous.

PURPOSE: Sessions locales httpOnly (pas de GoTrue) : ouverture, fermeture,
résolution d'identité par requête.
ENTRYPOINTS: `src/services/auth.ts` (57 l. : `signIn`/`signOut`/`getSession`,
RIEN d'autre — aucun `if (role)`) · routes `/api/auth/sign-in|sign-out|session|
provisionner|etat-installation` · `FormulaireConnexion.tsx`.
IDENTITÉ: `auth.verify_password` (`070:210`, bcrypt `crypt/gen_salt`) puis
`auth.create_session` (`070:257`, jeton SHA256 — jamais stocké en clair).
Transport : cookie (writer = route sign-in ; flags exacts : lire la route —
détail NON recopié ici). Chaque requête : `resolve_session` (`070:286`) dans
`withCaller` (`SET LOCAL ROLE` + identité) ; fermeture : `destroy_session` (`070:310`).
AUTORISATION (≠ authentification): `services/authz.ts` (`toRole`, garde null) ·
`practitioners.ts` (filtre d'affichage sur lignes RLS) · portes métier + RLS
(`app.current_role()`, `app_gatekeeper`). Débit : `server/auth/limite-debit.ts`.
PROVISIONNEMENT: `server/auth/provisioning.ts` + `084` (compte owner one-shot) +
`085` (état). Comptes dev : `scripts/compte-*.sh` / `dev-account*.sh` (base dev).
SECURITY: logs par CODE, jamais d'e-mail (type `LogFields` fermé, `auth.ts:26`) ·
secrets env serveur, jamais `NEXT_PUBLIC_*` · plafond bcrypt 72 octets (`070:237-239`,
borne basse exacte : lire la route / `084`).
TESTS: intégration `auth-locale.test.ts` (exige base, sinon NOT RUN) ·
e2e `connexion.spec.ts` · contrôles 11–12 `scripts/preflight.sh`.
UNKNOWN (lire le code, ne pas supposer): flags exacts du cookie · TTL/rotation
session · politique mot de passe complète → route sign-in + `070`.
FORBIDDEN: `if (role)` comme autorisation · JWT en localStorage · secret au
terminal · contourner `withCaller`.
