#!/usr/bin/env bash
# dev-account-fermer — REFERME la fenêtre ouverte par `dev-account.sh`.
#
#   bash scripts/dev-account-fermer.sh
#
# ADR-016 condition 1 : aucun accès praticien sur l'instance cloud. Son
# amendement du 2026-08-03 autorise UN compte développeur connectable (…a1) —
# mais c'est une FENÊTRE, pas un état. Le 2026-08-14 elle a été refermée à la
# main, puis rouverte le 2026-08-20 pour la mesure de V3.
#
# ⚠️ CE SCRIPT EXISTE PARCE QUE LA FERMETURE N'ÉTAIT PAS REPRODUCTIBLE.
# `dev-account.sh` sait ouvrir et ne sait pas refermer : la fermeture se faisait
# donc de mémoire, en SQL improvisé, à un moment où l'on est pressé de finir.
# Une porte qu'on sait ouvrir mais pas refermer finit par rester ouverte.
#
# Ce qu'il fait, et rien d'autre : rendre à …a1 la sentinelle littérale
# `CONNEXION-IMPOSSIBLE` de `015:34` — 20 caractères, pas un hash. GoTrue échoue
# alors sur `hashedSecret too short to be a bcrypted password`, et le 500 qui en
# résulte est le comportement VOULU, pas une panne (voir STATE.md).
#
# Il ne touche NI …a2 NI …a3 : ils n'ont jamais été ouverts.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PGIMAGE="postgres:15"
DEV_UID="00000000-0000-0000-0000-0000000000a1"
DEV_EMAIL="owner.dev@invalid.local"
SENTINELLE="CONNEXION-IMPOSSIBLE"

echo "FERMETURE DU COMPTE DE DÉVELOPPEMENT — $DEV_EMAIL"

# --- 1 · cible — même résolution que dev-account.sh, jamais une seconde ---------
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
  MSYS_NO_PATHCONV=1 docker run --rm -i -e PGURL="$DBURL" "$PGIMAGE" \
    sh -c "psql \"\$PGURL\" $*" 2>&1
}

# --- 2 · garde-fou ADR-016 — MÊME EXIGENCE QU'À L'OUVERTURE ---------------------
# On pourrait croire qu'une fermeture n'a pas besoin de garde-fou : elle
# RESTREINT, elle n'ouvre rien. Mais elle écrit dans `auth.users`, et écrire
# dans `auth.users` d'une instance qu'on n'a pas identifiée reste une écriture
# à l'aveugle. Même exigence, même refus dans le doute.
env_out=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"SELECT count(*) = 1 AND bool_and(environment = 'cloud-dev') FROM app.deployment\"")
rc=$?
deployment_env=$(printf '%s' "$env_out" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
if [ $rc -ne 0 ] || [ "$deployment_env" != "t" ]; then
  echo "ROUGE — garde-fou ADR-016 : environnement non confirmé « cloud-dev »."
  printf '%s\n' "$env_out" | sed 's/^/      /'
  echo "VERDICT : ROUGE — rien n'a été écrit."
  exit 1
fi
echo "Garde-fou ADR-016 : environment = cloud-dev · vert"

# --- 3 · fermeture — une transaction, et une vérification APRÈS ------------------
# `WHERE id = …a1` et rien d'autre : pas de `WHERE email LIKE '%dev%'`, qui
# emporterait un jour un compte qu'on n'avait pas en tête.
out=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"
BEGIN;
UPDATE auth.users
   SET encrypted_password = '$SENTINELLE', updated_at = now()
 WHERE id = '$DEV_UID';
COMMIT;
SELECT encrypted_password = '$SENTINELLE' FROM auth.users WHERE id = '$DEV_UID';
\"")
rc=$?
etat=$(printf '%s' "$out" | tr -d '\r' | tr -s '\n' '\n' | tail -1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

if [ $rc -ne 0 ] || [ "$etat" != "t" ]; then
  echo "ROUGE — la fermeture n'est pas confirmée EN BASE."
  printf '%s\n' "$out" | sed 's/^/      /'
  echo "VERDICT : ROUGE"
  exit 1
fi

echo
echo "VERT — fenêtre ADR-016 REFERMÉE"
echo "  …a1 porte de nouveau la sentinelle de 015:34 : connexion impossible."
echo "  …a2 et …a3 n'ont pas été touchés — ils n'ont jamais été ouverts."
echo "  Rouvrir demande \`bash scripts/dev-account.sh\`, et c'est une décision"
echo "  à reprendre à ce moment-là."
echo "VERDICT : VERT"
