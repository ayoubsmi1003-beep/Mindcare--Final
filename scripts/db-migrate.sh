#!/usr/bin/env bash
# db-migrate — applique supabase/migrations/*.sql dans l'ordre, une transaction
# par fichier, et s'arrête au PREMIER échec.
#
#   bash scripts/db-migrate.sh              # cible DATABASE_URL lu dans .env
#   DATABASE_URL="postgresql://..." bash scripts/db-migrate.sh
#   bash scripts/db-migrate.sh --dry-run    # liste ce qui serait appliqué
#
# psql n'est pas installé sur ce poste : on passe par un conteneur jetable.
# LE SECRET N'EST JAMAIS AFFICHÉ. Il est lu depuis .env par ce script, passé au
# conteneur par variable d'environnement, et n'apparaît dans aucune trace.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
MIGDIR="supabase/migrations"
PGIMAGE="postgres:15"
dry=0
[ "${1:-}" = "--dry-run" ] && dry=1

echo "MIGRATIONS — $MIGDIR"

# --- 1 · cible ------------------------------------------------------------------
if [ -z "${DATABASE_URL:-}" ] && [ -f .env ]; then
  # `grep`+`cut` plutôt que `source .env` : on ne veut exécuter aucune ligne
  # d'un fichier de secrets, et on ne charge que la variable dont on a besoin.
  DATABASE_URL=$(grep -m1 '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2-)
  # `.env` écrit sous Windows est en CRLF : sans ce nettoyage, la valeur emporte
  # un retour chariot, psql reçoit une URL malformée et retombe silencieusement
  # sur la socket locale — l'erreur affichée parle alors d'un serveur local
  # absent, ce qui envoie chercher au mauvais endroit. Constaté à l'exécution.
  DATABASE_URL=$(printf '%s' "$DATABASE_URL" | tr -d '\r\n')
  DATABASE_URL="${DATABASE_URL%\"}"; DATABASE_URL="${DATABASE_URL#\"}"
fi

# Nettoyage systématique, que la valeur vienne de .env ou de l'environnement.
# Deux pièges rencontrés à l'exécution, tous deux SILENCIEUX :
#   - CRLF : `.env` écrit sous Windows emporte un retour chariot ;
#   - espace de tête (`DATABASE_URL= postgresql://…`) : psql cesse alors de
#     reconnaître une URI, la traite comme un nom de base, et retombe sur la
#     socket LOCALE. Le message d'erreur parle d'un serveur local absent et
#     envoie chercher au mauvais endroit pendant un moment.
# Un script qui échoue doit dire pourquoi ; ici il ne pouvait pas, donc on
# supprime la cause.
DATABASE_URL=$(printf '%s' "${DATABASE_URL:-}" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

# --- Encodage du mot de passe dans l'URI ---------------------------------------
# Les mots de passe générés par Supabase contiennent couramment `#`, `[`, `]`,
# `/`, `?`, `@` — tous RÉSERVÉS dans une URI. Non encodés, psql découpe l'URL au
# mauvais endroit : `#` ouvre un fragment, et le nom d'hôte devient un morceau du
# mot de passe (« could not translate host name "#2069]@db.…" »). Le message
# n'évoque jamais le mot de passe, donc on cherche ailleurs.
#
# On encode ici, sans jamais afficher la valeur. Découpage sur le DERNIER `@` :
# un mot de passe peut contenir `@`, un nom d'hôte non — donc c'est le seul
# point de coupe qui ne se trompe jamais.
if printf '%s' "$DATABASE_URL" | grep -q '^postgres\(ql\)\?://[^/]*@'; then
  scheme=${DATABASE_URL%%://*}
  rest=${DATABASE_URL#*://}
  creds=${rest%@*}          # user:password  (dernier @)
  tail_part=${rest##*@}     # hôte:port/base
  user=${creds%%:*}
  pass=${creds#*:}

  if [ "$user" != "$creds" ]; then      # il y a bien un mot de passe
    # Déjà encodé ? On n'y touche pas : ré-encoder un `%23` donnerait `%2523`.
    if printf '%s' "$pass" | grep -q '%[0-9A-Fa-f][0-9A-Fa-f]'; then
      enc="$pass"
    else
      enc=$(printf '%s' "$pass" | sed \
        -e 's/%/%25/g'  -e 's/#/%23/g'  -e 's/\[/%5B/g' -e 's/\]/%5D/g' \
        -e 's|/|%2F|g'  -e 's/?/%3F/g'  -e 's/&/%26/g'  -e 's/@/%40/g' \
        -e 's/:/%3A/g'  -e 's/ /%20/g')
    fi
    DATABASE_URL="$scheme://$user:$enc@$tail_part"
  fi
fi

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ROUGE — DATABASE_URL introuvable (ni dans l'environnement, ni dans .env)."
  echo
  echo "  Dashboard Supabase → Settings → Database → Connection string → URI."
  echo "  Ajouter dans .env (déjà couvert par .gitignore) :"
  echo "      DATABASE_URL=postgresql://postgres.<ref>:<mot-de-passe>@<hôte>:5432/postgres"
  echo
  echo "  La clé anon ne peut pas exécuter de DDL, et SERVICE_ROLE_KEY non plus :"
  echo "  c'est une clé d'API REST, pas un accès Postgres."
  echo "VERDICT : ROUGE"
  exit 1
fi

command -v docker >/dev/null 2>&1 || { echo "ROUGE — docker introuvable."; exit 1; }
docker info >/dev/null 2>&1 || { echo "ROUGE — démon docker injoignable."; exit 1; }

# --- Connexion directe = IPv6 seul ---------------------------------------------
# `db.<ref>.supabase.co` ne publie plus d'enregistrement A : Supabase a rendu les
# connexions directes IPv6-only. Le réseau Docker par défaut n'a pas d'IPv6, donc
# psql rend « could not translate host name … Name or service not known » — un
# message qui accuse le DNS et ne mentionne jamais IPv6. On le dit à sa place.
if printf '%s' "$DATABASE_URL" | grep -q '@db\.[a-z0-9]*\.supabase\.co'; then
  echo "ROUGE — DATABASE_URL utilise la connexion DIRECTE (db.<ref>.supabase.co)."
  echo "        Cet hôte est IPv6 uniquement, et le réseau Docker n'a pas d'IPv6."
  echo
  echo "  Prendre la chaîne du SESSION POOLER, compatible IPv4 :"
  echo "    Dashboard → Settings → Database → Connection string → onglet «Session pooler»"
  echo "  Elle a cette forme (noter le point dans l'utilisateur, et le host pooler) :"
  echo "    postgresql://postgres.<ref>:<mot-de-passe>@aws-0-<region>.pooler.supabase.com:5432/postgres"
  echo
  echo "  Le mot de passe peut être collé tel quel : ce script l'encode lui-même."
  echo "VERDICT : ROUGE — rien n'a été appliqué."
  exit 1
fi

# Cible affichée sans identifiants : hôte seulement, jamais le mot de passe.
host=$(printf '%s' "$DATABASE_URL" | sed -E 's|.*@([^:/?]+).*|\1|')
echo "Cible : ${host:-inconnue}"

# `$PGURL` est développé DANS le conteneur, jamais sur la ligne de commande de
# l'hôte : le mot de passe n'apparaît donc ni dans `ps`, ni dans l'historique.
#
# CHEMIN DE MONTAGE — sous Git Bash, `pwd` rend `/c/Users/…`, que Docker Desktop
# ne sait pas monter : il crée un volume vide, et psql rend « No such file or
# directory » en désignant un fichier qui EXISTE. Le message accuse la migration
# alors que le montage est vide. `pwd -W` rend la forme `C:/Users/…` attendue.
# MSYS_NO_PATHCONV empêche par ailleurs Git Bash de réécrire `/mig` en chemin
# Windows au passage de la ligne de commande.
HOSTDIR="$(pwd -W 2>/dev/null || pwd)/$MIGDIR"

psql_run() {
  MSYS_NO_PATHCONV=1 docker run --rm -i -e PGURL="$DATABASE_URL" \
    -v "$HOSTDIR:/mig:ro" "$PGIMAGE" \
    sh -c "psql \"\$PGURL\" $*" 2>&1
}

# --- 2 · migrations déjà appliquées ---------------------------------------------
applied=$(psql_run -qtAX -c "\"SELECT version FROM app.schema_migrations\"" 2>/dev/null \
          | grep -E '^[0-9]{3}_' || true)
if [ -n "$applied" ]; then
  echo "Déjà en base : $(printf '%s' "$applied" | wc -l | tr -d ' ') migration(s)"
fi

# --- 3 · application ------------------------------------------------------------
count=0; skipped=0
for f in $(ls "$MIGDIR"/*.sql 2>/dev/null | sort); do
  version=$(basename "$f" .sql)

  if printf '%s\n' "$applied" | grep -qx "$version"; then
    skipped=$((skipped + 1)); continue
  fi

  if [ $dry -eq 1 ]; then
    echo "  [à appliquer] $version"; count=$((count + 1)); continue
  fi

  printf '  %-50s ' "$version"
  # ON_ERROR_STOP + le BEGIN/COMMIT du fichier : un échec ne laisse rien à moitié
  # appliqué, et la ligne de schema_migrations n'est écrite que si tout a passé.
  out=$(psql_run -v ON_ERROR_STOP=1 -q -f "/mig/$(basename "$f")")
  rc=$?
  if [ $rc -ne 0 ]; then
    echo "ROUGE"
    echo "$out" | sed 's/^/      /'
    echo
    echo "VERDICT : ROUGE — arrêt au premier échec. Rien après $version n'a été appliqué."
    exit 1
  fi
  echo "vert"
  count=$((count + 1))
done

echo
if [ $dry -eq 1 ]; then
  echo "VERDICT : $count migration(s) à appliquer, $skipped déjà en base (rien n'a été écrit)."
  exit 0
fi
echo "VERDICT : VERT — $count appliquée(s), $skipped déjà en base."
echo "Suite : DATABASE_URL=… bash scripts/checkpoint-j1a.sh"
