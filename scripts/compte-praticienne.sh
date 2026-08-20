#!/usr/bin/env bash
# compte-praticienne — rend connectable le compte PRATICIENNE …a2 de `015`.
#
#   bash scripts/compte-praticienne.sh          # ouvre
#   bash scripts/compte-praticienne.sh --fermer # referme
#
# ═══ CE QUE CE SCRIPT EST, ET CE QU'IL N'EST PAS ═══
#
# Il N'INVENTE AUCUNE IDENTITÉ. `015` sème déjà trois profils dans le cabinet
# synthétique : …a1 `owner`, …a2 `practitioner`, …a3 `assistant`. Le compte
# praticienne EXISTE — avec son `cabinet_id`, son rôle, son titre et sa
# spécialité. Il lui manquait seulement un mot de passe utilisable. Créer un
# `doctor@…` de plus aurait dupliqué une identité déjà là, et le doublon aurait
# divergé au premier changement de schéma.
#
# ⚠️ CE SCRIPT AMENDE ADR-016, IL NE LE CONTOURNE PAS.
# L'amendement du 2026-08-03 écrit en toutes lettres que …a2 et …a3
# « restent inconnectables ». Ouvrir …a2 CONTREDIT ce texte, et le dire
# autrement serait se mentir. Ce qui reste vrai, et qui est le fond de la
# condition 1 : …a2 porte une identité SYNTHÉTIQUE (« Praticienne 2 (données de
# test) »), pas celle de la Dr. Larbi — exactement le raisonnement qui a
# justifié …a1. La condition 1 protège la donnée réelle et la praticienne, pas
# le mécanisme d'authentification.
# L'amendement correspondant est écrit et daté dans `docs/00-DECISIONS.md`.
# Si tu lis ce script sans l'avoir lu, arrête-toi et va le lire.
#
# …a1 (`owner.dev@invalid.local`) n'est PAS touché par ce script, ni ouvert ni
# refermé : les deux fenêtres sont indépendantes et se pilotent séparément.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PGIMAGE="postgres:15"
UID_A2="00000000-0000-0000-0000-0000000000a2"
EMAIL_A2="praticien2.dev@invalid.local"
SENTINELLE="CONNEXION-IMPOSSIBLE"
FERMER=0
[ "${1:-}" = "--fermer" ] && FERMER=1

echo "COMPTE PRATICIENNE — $EMAIL_A2"

# --- 1 · cible ------------------------------------------------------------------
. scripts/lib/dburl.sh
DBURL=$(resolve_dburl)
[ -n "$DBURL" ] || { echo "ROUGE — DATABASE_URL introuvable."; echo "VERDICT : ROUGE"; exit 1; }
if dburl_is_direct "$DBURL"; then
  echo "ROUGE — DATABASE_URL utilise la connexion DIRECTE."; dburl_direct_advice
  echo "VERDICT : ROUGE"; exit 1
fi
command -v docker >/dev/null 2>&1 || { echo "ROUGE — docker introuvable."; exit 1; }
docker info >/dev/null 2>&1 || { echo "ROUGE — démon docker injoignable."; exit 1; }
echo "Cible : $(dburl_host "$DBURL")"

psql_run() {
  MSYS_NO_PATHCONV=1 docker run --rm -i \
    -e PGURL="$DBURL" -e DOCTOR_ACCOUNT_PASSWORD \
    "$PGIMAGE" sh -c "psql \"\$PGURL\" $*" 2>&1
}

# --- 2 · garde-fou ADR-016, AVANT toute écriture ---------------------------------
env_out=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"SELECT count(*) = 1 AND bool_and(environment = 'cloud-dev') FROM app.deployment\"")
rc=$?
deployment_env=$(printf '%s' "$env_out" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
if [ $rc -ne 0 ] || [ "$deployment_env" != "t" ]; then
  echo "ROUGE — garde-fou ADR-016 : environnement non confirmé « cloud-dev »."
  echo "  Un compte praticienne connectable n'existe que pendant la phase cloud"
  echo "  bornée d'ADR-016, sur des données SYNTHÉTIQUES. Sur une instance"
  echo "  auto-hébergée portant de vrais dossiers, ce script poserait un accès"
  echo "  praticien sur des données patient réelles. En cas de doute, on refuse."
  printf '%s\n' "$env_out" | sed 's/^/      /'
  echo "VERDICT : ROUGE — rien n'a été écrit."
  exit 1
fi
echo "Garde-fou ADR-016 : environment = cloud-dev · vert"

# --- 3 · fermeture ---------------------------------------------------------------
if [ "$FERMER" = "1" ]; then
  out=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"UPDATE auth.users SET encrypted_password = '$SENTINELLE', updated_at = now() WHERE id = '$UID_A2'; SELECT encrypted_password = '$SENTINELLE' FROM auth.users WHERE id = '$UID_A2';\"")
  rc=$?
  etat=$(printf '%s' "$out" | tr -d '\r' | tail -1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ $rc -ne 0 ] || [ "$etat" != "t" ]; then
    echo "ROUGE — fermeture non confirmée en base."; printf '%s\n' "$out" | sed 's/^/      /'
    echo "VERDICT : ROUGE"; exit 1
  fi
  echo; echo "VERT — …a2 est de nouveau inconnectable (sentinelle de 015:34)."
  echo "VERDICT : VERT"; exit 0
fi

# --- 4 · le secret ---------------------------------------------------------------
# Jamais dans une migration ni dans un script : il vivrait dans le dépôt, donc
# partagé et irrévocable (I1). Lu depuis `.env`, couvert par `.gitignore`.
if [ -z "${DOCTOR_ACCOUNT_PASSWORD:-}" ] && [ -f .env ]; then
  DOCTOR_ACCOUNT_PASSWORD=$(grep -E '^DOCTOR_ACCOUNT_PASSWORD=' .env | head -1 | cut -d= -f2- | tr -d '\r')
fi
if [ -z "${DOCTOR_ACCOUNT_PASSWORD:-}" ]; then
  echo "ROUGE — DOCTOR_ACCOUNT_PASSWORD introuvable (ni environnement, ni .env)."
  echo "      Ajouter dans .env, sur une seule ligne :"
  echo "          DOCTOR_ACCOUNT_PASSWORD=<mot-de-passe>"
  echo "VERDICT : ROUGE — rien n'a été écrit."
  exit 1
fi
export DOCTOR_ACCOUNT_PASSWORD

# --- 4bis · pgcrypto joignable, AVANT d'envoyer le secret -------------------------
# Même précaution que `dev-account.sh` : si `crypt()` n'existe pas, l'erreur
# Postgres cite la LIGNE fautive — donc le mot de passe. On vérifie d'abord.
if ! psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"SELECT crypt('x', gen_salt('bf')) IS NOT NULL\"" >/dev/null 2>&1; then
  echo "ROUGE — pgcrypto/crypt() injoignable. Rien n'a été envoyé."
  echo "VERDICT : ROUGE"; exit 1
fi

# --- 5 · écriture, une transaction -------------------------------------------------
# `\getenv` fait lire la variable par psql lui-même. La sortie n'est JAMAIS
# réimprimée telle quelle : elle peut contenir le contexte `LINE n:` de
# Postgres, donc le mot de passe en clair. Seul le SQLSTATE en est extrait — il
# n'identifie rien. Même raisonnement que `dev-account.sh`.
out=$(psql_run -qtAX -v ON_ERROR_STOP=1 <<'SQL'
\getenv docpw DOCTOR_ACCOUNT_PASSWORD
WITH maj AS (
  UPDATE auth.users
     SET encrypted_password = crypt(:'docpw', gen_salt('bf')),
         email_confirmed_at = now(),
         updated_at         = now(),
         confirmation_token         = coalesce(confirmation_token, ''),
         recovery_token             = coalesce(recovery_token, ''),
         email_change_token_new     = coalesce(email_change_token_new, ''),
         email_change_token_current = coalesce(email_change_token_current, ''),
         email_change               = coalesce(email_change, ''),
         phone_change               = coalesce(phone_change, ''),
         phone_change_token         = coalesce(phone_change_token, ''),
         reauthentication_token     = coalesce(reauthentication_token, ''),
         raw_app_meta_data  = coalesce(raw_app_meta_data,
                                '{"provider":"email","providers":["email"]}'::jsonb),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
   WHERE id = '00000000-0000-0000-0000-0000000000a2'
  RETURNING 1
)
SELECT count(*) FROM maj;
SQL
)
rc=$?
touched=$(printf '%s' "$out" | tr -d '\r' | tail -n 1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
if [ $rc -ne 0 ] || [ "$touched" != "1" ]; then
  echo "ROUGE — le mot de passe n'a pas été posé."
  sqlstate=$(printf '%s' "$out" | grep -o 'SQLSTATE[: ]*[0-9A-Z]\{5\}' | head -n 1)
  echo "      ${sqlstate:-SQLSTATE non identifie}."
  echo "VERDICT : ROUGE"; exit 1
fi

# --- 6 · le profil est-il bien celui qu'on croit ? --------------------------------
# On ne CRÉE pas le profil : `015` l'a posé. On VÉRIFIE qu'il est là, avec le
# bon rôle et le bon cabinet — sans quoi la connexion réussirait sur un compte
# sans périmètre, et tous les écrans seraient vides sans dire pourquoi.
prof=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"SELECT role || ' | ' || full_name || ' | cabinet ' || cabinet_id::text FROM app.profiles WHERE id = '$UID_A2'\"")
prof=$(printf '%s' "$prof" | tr -d '\r' | tail -1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
case "$prof" in
  practitioner*) : ;;
  *) echo "ROUGE — profil …a2 absent ou role inattendu : ${prof:-vide}"
     echo "VERDICT : ROUGE"; exit 1 ;;
esac

echo
echo "VERT — compte praticienne connectable"
echo "  Adresse : $EMAIL_A2"
echo "  Profil  : $prof"
echo "  Mot de passe : celui de DOCTOR_ACCOUNT_PASSWORD dans .env — jamais affiché."
echo "  …a1 et …a3 n'ont pas été touchés."
echo "  Refermer : bash scripts/compte-praticienne.sh --fermer"
echo "VERDICT : VERT"
