#!/usr/bin/env bash
# compte-assistante — rend connectable le compte ASSISTANTE …a3 de `015`.
#
#   bash scripts/compte-assistante.sh          # ouvre
#   bash scripts/compte-assistante.sh --fermer # referme
#
# ═══ CE QUE CE SCRIPT EST, ET CE QU'IL N'EST PAS ═══
#
# Il N'INVENTE AUCUNE IDENTITÉ. `015` sème déjà le profil …a3 `assistant`
# (« Assistante (données de test) ») dans le cabinet synthétique, avec son
# cabinet et son rôle. Il lui manquait seulement un mot de passe utilisable.
#
# ⚠️ MÊME AMENDEMENT D'ADR-016 QUE `compte-praticienne.sh`, POUR LES MÊMES
# RAISONS. L'amendement du 2026-08-03 écrit que …a3 « reste inconnectable » ;
# l'ouvrir contredit ce texte. Ce qui reste vrai : …a3 porte une identité
# SYNTHÉTIQUE, pas celle d'une assistante réelle. La condition 1 protège la
# donnée réelle, pas le mécanisme d'authentification.
#
# POURQUOI CE COMPTE EST INDISPENSABLE AU LOT COCKPIT : les contrôles de
# cloison (l'assistante ne lit ni motif ni recette ; elle encaisse un tarif
# déjà fixé) se vérifient EN SESSION AUTHENTIFIÉE assistante. Sans fenêtre,
# ces contrôles resteraient théoriques — et le checkpoint du lot exige des
# mesures au navigateur sous ce compte (mesure-reception.mjs).
#
# Le mot de passe est lu depuis DOCTOR_ACCOUNT_PASSWORD (.env) — le même
# secret que les autres fenêtres dev : aucun nouveau secret n'est créé (I1).
#
# …a1 et …a2 ne sont PAS touchés : chaque fenêtre se pilote séparément.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PGIMAGE="postgres:15"
UID_A3="00000000-0000-0000-0000-0000000000a3"
EMAIL_A3="assistante.dev@invalid.local"
SENTINELLE="CONNEXION-IMPOSSIBLE"
FERMER=0
[ "${1:-}" = "--fermer" ] && FERMER=1

echo "COMPTE ASSISTANTE — $EMAIL_A3"

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

env_out=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"SELECT count(*) = 1 AND bool_and(environment = 'cloud-dev') FROM app.deployment\"")
rc=$?
deployment_env=$(printf '%s' "$env_out" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
if [ $rc -ne 0 ] || [ "$deployment_env" != "t" ]; then
  echo "ROUGE — garde-fou ADR-016 : environnement non confirmé « cloud-dev »."
  echo "  Une fenêtre assistante n'existe que sur données SYNTHÉTIQUES."
  printf '%s\n' "$env_out" | sed 's/^/      /'
  echo "VERDICT : ROUGE — rien n'a été écrit."
  exit 1
fi
echo "Garde-fou ADR-016 : environment = cloud-dev · vert"

if [ "$FERMER" = "1" ]; then
  out=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"UPDATE auth.users SET encrypted_password = '$SENTINELLE', updated_at = now() WHERE id = '$UID_A3'; SELECT encrypted_password = '$SENTINELLE' FROM auth.users WHERE id = '$UID_A3';\"")
  rc=$?
  etat=$(printf '%s' "$out" | tr -d '\r' | tail -1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  if [ $rc -ne 0 ] || [ "$etat" != "t" ]; then
    echo "ROUGE — fermeture non confirmée en base."; printf '%s\n' "$out" | sed 's/^/      /'
    echo "VERDICT : ROUGE"; exit 1
  fi
  echo; echo "VERT — …a3 est de nouveau inconnectable (sentinelle de 015)."
  echo "VERDICT : VERT"; exit 0
fi

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

if ! psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"SELECT crypt('x', gen_salt('bf')) IS NOT NULL\"" >/dev/null 2>&1; then
  echo "ROUGE — pgcrypto/crypt() injoignable. Rien n'a été envoyé."
  echo "VERDICT : ROUGE"; exit 1
fi

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
   WHERE id = '00000000-0000-0000-0000-0000000000a3'
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

prof=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"SELECT role || ' | ' || full_name || ' | cabinet ' || cabinet_id::text FROM app.profiles WHERE id = '$UID_A3'\"")
prof=$(printf '%s' "$prof" | tr -d '\r' | tail -1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
case "$prof" in
  assistant*) : ;;
  *) echo "ROUGE — profil …a3 absent ou role inattendu : ${prof:-vide}"
     echo "VERDICT : ROUGE"; exit 1 ;;
esac

echo
echo "VERT — compte assistante connectable"
echo "  Adresse : $EMAIL_A3"
echo "  Profil  : $prof"
echo "  Mot de passe : celui de DOCTOR_ACCOUNT_PASSWORD dans .env — jamais affiché."
echo "  …a1 et …a2 n'ont pas été touchés."
echo "  Refermer : bash scripts/compte-assistante.sh --fermer"
echo "VERDICT : VERT"
