#!/usr/bin/env bash
# CHECKPOINT S0 — §3 de docs/SELF-HOST-SETUP.md.
# VERT ou ROUGE. Rien entre les deux. Si on ne peut pas prouver, c'est ROUGE.
#
#   bash scripts/checkpoint-s0.sh /c/mindcare-db
#
# Le test qui compte est le dernier : Postgres NE DOIT PAS répondre depuis un
# autre poste du réseau. S'il répond, on s'arrête — rien d'autre n'a de sens.

set -uo pipefail
fail=0
echo "CHECKPOINT S0"

red()   { printf 'S%-2s %-46s ROUGE  %s\n' "$1" "$2" "$3"; fail=1; }
green() { printf 'S%-2s %-46s VERT\n' "$1" "$2"; }

DIR="${1:-}"
if [ -z "$DIR" ] || [ ! -f "$DIR/.env" ]; then
  echo "ROUGE — usage : bash scripts/checkpoint-s0.sh <répertoire de la pile>"
  echo "        (doit contenir .env et docker-compose.yml)"
  echo "VERDICT : ROUGE — arrêt de la progression"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "ROUGE — démon docker injoignable. Aucun test n'a pu être exécuté."
  echo "VERDICT : ROUGE — arrêt de la progression"
  exit 1
fi

# --- S1 : 9 conteneurs, tous healthy -------------------------------------------
running=$(docker ps --format '{{.Names}}' 2>/dev/null | wc -l | tr -d ' ')
unhealthy=$(docker ps --format '{{.Names}}\t{{.Status}}' 2>/dev/null \
            | grep -ci 'unhealthy\|starting\|restarting' || true)
if [ "$running" -ge 9 ] && [ "$unhealthy" = "0" ]; then
  green 1 "$running conteneurs, tous healthy"
else
  red 1 "conteneurs healthy" "obtenu=$running en marche, $unhealthy non-healthy (attendu 9 / 0)"
  docker ps --format '  {{.Names}}\t{{.Status}}' 2>/dev/null
fi

# --- S2 : l'API REST répond ----------------------------------------------------
body=$(curl -s --max-time 10 http://localhost:8000/rest/v1/ 2>/dev/null | head -c 200)
printf '%s' "$body" | grep -q '{' \
  && green 2 "API REST sur 127.0.0.1:8000" \
  || red 2 "API REST sur 127.0.0.1:8000" "réponse non JSON : ${body:-vide}"

# --- S3 : locale du cluster — le point irréversible (§2.2) ---------------------
pgc=$(docker ps --format '{{.Names}}' | grep -m1 -i 'db\|postgres' || true)
if [ -n "$pgc" ]; then
  collate=$(docker exec "$pgc" psql -U postgres -qtAX -c "SHOW lc_collate;" 2>/dev/null | tr -d '[:space:]')
  if [ "$collate" = "fr-DZ" ]; then
    green 3 "lc_collate = fr-DZ"
  else
    red 3 "lc_collate = fr-DZ" "obtenu=« ${collate:-illisible} » — cluster à RECRÉER, pas à migrer"
  fi
else
  red 3 "lc_collate = fr-DZ" "conteneur Postgres introuvable — test non prouvable"
fi

# --- S4 : 5432 n'écoute QUE sur la boucle locale (§2.3) ------------------------
# Contrôle par la configuration publiée, indépendant du réseau : docker doit
# annoncer 127.0.0.1 comme interface hôte de chaque port publié.
exposed=$(docker ps --format '{{.Ports}}' 2>/dev/null \
          | tr ',' '\n' | grep -E '^\s*0\.0\.0\.0:|^\s*\[::\]:' || true)
if [ -z "$exposed" ]; then
  green 4 "aucun port publié sur 0.0.0.0"
else
  red 4 "aucun port publié sur 0.0.0.0" "ports exposés au réseau du cabinet :"
  printf '  %s\n' "$exposed"
fi

# --- S5 : le secret n'est pas dans le dépôt (I1) -------------------------------
repo_root=$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$repo_root" ]; then
  case "$(cd "$DIR" && pwd)/" in
    "$repo_root"/*) red 5 "pile hors dépôt" "la pile est DANS le dépôt — .env committable" ;;
    *)              green 5 "pile hors dépôt" ;;
  esac
else
  green 5 "pile hors dépôt"
fi

echo
echo "─── À FAIRE À LA MAIN, DEPUIS UN AUTRE POSTE DU RÉSEAU ───"
echo "  nc -zv <ip-serveur> 5432    # doit ÉCHOUER  ← le test qui compte"
echo "  curl http://<ip-serveur>:3000   # doit répondre (l'app, pas la base)"
echo "  Si Postgres répond depuis un autre poste : ROUGE, on s'arrête."
echo "  Aucun script local ne peut prouver ça à ta place."
echo

if [ $fail -eq 0 ]; then
  echo "VERDICT : VERT sur les contrôles locaux — le test réseau reste à faire."
else
  echo "VERDICT : ROUGE — arrêt de la progression"
fi
exit $fail
