#!/usr/bin/env bash
# S0 — PROVISIONNEMENT SUPABASE AUTO-HÉBERGÉ
# À exécuter SUR LE PC SERVEUR DU CABINET, jamais sur un poste de développement.
# Procédure de référence : docs/SELF-HOST-SETUP.md
#
#   bash scripts/s0-provision.sh /c/mindcare-db
#
# Ce script ne CRÉE aucune donnée patient et ne touche pas au dépôt.
# Il génère les secrets LOCALEMENT, sur la machine, et les écrit dans un `.env`
# situé HORS du dépôt. Aucun secret n'est affiché : une clé qui a transité par
# un terminal partagé ou un chat est compromise (CLAUDE.md, règle 3).

set -uo pipefail

TARGET="${1:-}"
fail=0
red()   { printf '  ROUGE  %s\n' "$1"; fail=1; }
green() { printf '  VERT   %s\n' "$1"; }
info()  { printf '  ····   %s\n' "$1"; }

echo "S0 — PROVISIONNEMENT"
echo

# --- 0 · garde-fous d'exécution -------------------------------------------------
if [ -z "$TARGET" ]; then
  echo "ROUGE — usage : bash scripts/s0-provision.sh <répertoire-cible-hors-dépôt>"
  echo "VERDICT : ROUGE"
  exit 1
fi

# Le `.env` porte SERVICE_ROLE_KEY et JWT_SECRET. S'il atterrit dans un dépôt
# git, il finit dans un commit. On refuse, on ne prévient pas.
probe="$TARGET"
[ -d "$probe" ] || probe=$(dirname "$TARGET")
if git -C "$probe" rev-parse --git-dir >/dev/null 2>&1; then
  echo "ROUGE — $TARGET est dans un dépôt git. Le .env y serait committable."
  echo "        Choisis un répertoire hors dépôt, ex. /c/mindcare-db."
  echo "VERDICT : ROUGE"
  exit 1
fi

echo "1 · PRÉREQUIS"

command -v docker >/dev/null 2>&1 && green "docker présent" || red "docker introuvable"
docker compose version >/dev/null 2>&1 && green "docker compose présent" || red "docker compose introuvable"
docker info >/dev/null 2>&1 && green "démon docker joignable" || red "démon docker injoignable (Docker Desktop démarré ?)"
command -v openssl >/dev/null 2>&1 && green "openssl présent" || red "openssl introuvable (génération des secrets impossible)"
command -v git >/dev/null 2>&1 && green "git présent" || red "git introuvable"

# --- RAM : la pile demande ~6 Go, Windows ~4 Go. Sous 16 Go, ça ne tient pas. ---
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null)
if [ -n "${mem_kb:-}" ]; then
  mem_gb=$(( mem_kb / 1024 / 1024 ))
  if [ "$mem_gb" -ge 14 ]; then
    green "RAM visible ${mem_gb} Go"
  else
    red "RAM visible ${mem_gb} Go — SELF-HOST-SETUP.md §1 dimensionne pour 16 Go."
    info "Sous 16 Go, le poste part en swap PENDANT une consultation. Ne pas forcer."
  fi
fi

# --- .wslconfig : sans lui WSL2 prend jusqu'à 50 % de la RAM (§1) --------------
wslconf="/c/Users/${USERNAME:-$USER}/.wslconfig"
if [ -f "$wslconf" ]; then
  green ".wslconfig présent"
else
  red ".wslconfig absent — $wslconf"
  info "Contenu attendu (§1) : [wsl2] / memory=8GB / processors=4 / swap=2GB"
  info "À créer AVANT le premier up, puis : wsl --shutdown"
fi

if [ $fail -ne 0 ]; then
  echo
  echo "VERDICT : ROUGE — prérequis non réunis, rien n'a été installé."
  exit 1
fi

# --- 2 · installation ----------------------------------------------------------
echo
echo "2 · INSTALLATION"

if [ -e "$TARGET" ]; then
  echo "  ROUGE  $TARGET existe déjà. Ce script ne réécrit jamais une install"
  echo "         existante : un second initdb sur un cluster peuplé le détruit."
  echo "VERDICT : ROUGE"
  exit 1
fi

tmp=$(mktemp -d) || { echo "ROUGE — mktemp"; exit 1; }
trap 'rm -rf "$tmp"' EXIT

git clone --depth 1 https://github.com/supabase/supabase "$tmp/supabase" >/dev/null 2>&1 \
  && green "dépôt supabase cloné" || { red "clone impossible (réseau ?)"; exit 1; }

cp -r "$tmp/supabase/docker" "$TARGET" && green "pile copiée dans $TARGET" || { red "copie impossible"; exit 1; }
cd "$TARGET" || exit 1

# --- 3 · secrets ---------------------------------------------------------------
# Générés ici, jamais affichés, jamais transmis. NE RÉUTILISE AUCUNE clé du
# projet Supabase Cloud : elles ont transité par un chat (§2.1).
echo
echo "3 · SECRETS"

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
jwt() { # $1 = rôle, $2 = secret
  local h p s
  h=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  p=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' \
        "$1" "$(date +%s)" "$(( $(date +%s) + 315360000 ))" | b64url)
  s=$(printf '%s.%s' "$h" "$p" \
      | openssl dgst -sha256 -hmac "$2" -binary | b64url)
  printf '%s.%s.%s' "$h" "$p" "$s"
}

PG_PASS=$(openssl rand -base64 48 | tr -d '/+=' | cut -c1-40)
JWT_SECRET=$(openssl rand -base64 64 | tr -d '/+=' | cut -c1-48)
DASH_USER="mindcare_$(openssl rand -hex 3)"     # jamais "supabase" (§2.1)
DASH_PASS=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-28)
ANON=$(jwt anon "$JWT_SECRET")
SROLE=$(jwt service_role "$JWT_SECRET")

set_env() { # $1 = clé, $2 = valeur — remplace en place, sans jamais l'afficher
  if grep -q "^$1=" .env 2>/dev/null; then
    awk -v k="$1" -v v="$2" 'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' .env > .env.tmp \
      && mv .env.tmp .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

cp .env.example .env || { red "pas de .env.example dans la pile"; exit 1; }
set_env POSTGRES_PASSWORD  "$PG_PASS"
set_env JWT_SECRET         "$JWT_SECRET"
set_env ANON_KEY           "$ANON"
set_env SERVICE_ROLE_KEY   "$SROLE"
set_env DASHBOARD_USERNAME "$DASH_USER"
set_env DASHBOARD_PASSWORD "$DASH_PASS"
chmod 600 .env 2>/dev/null
green "secrets générés et écrits dans $TARGET/.env (jamais affichés)"
info "Identifiant du tableau de bord : $DASH_USER — le mot de passe est dans .env"

# --- 4 · liaison locale uniquement (§2.3) --------------------------------------
# Sans le préfixe 127.0.0.1, Postgres écoute sur tout le réseau du cabinet.
# C'est le défaut d'usine et la faille la plus courante de ces installations.
echo
echo "4 · PORTS — LIAISON LOCALE"
cp docker-compose.yml docker-compose.yml.orig
# n'ajoute le préfixe que sur les ports publiés non déjà liés à une interface
sed -i -E 's/^(\s*-\s*")([0-9]+:[0-9]+")/\1127.0.0.1:\2/' docker-compose.yml
reste=$(grep -nE '^\s*-\s*"[0-9]+:[0-9]+"' docker-compose.yml || true)
if [ -z "$reste" ]; then
  green "tous les ports publiés sont liés à 127.0.0.1"
else
  red "ports encore exposés sur toutes les interfaces :"
  printf '%s\n' "$reste"
fi

# --- 5 · locale ICU fr-DZ (§2.2) — IRRÉVERSIBLE --------------------------------
# Un cluster créé en locale par défaut puis migré corrompt les index B-tree sur
# les noms accentués. On PROUVE la locale sur un cluster jetable AVANT de créer
# le vrai : après le premier up, il est trop tard.
echo
echo "5 · LOCALE fr-DZ — vérification sur cluster jetable"
pgimg=$(grep -oE 'supabase/postgres:[^ "]*' docker-compose.yml | head -1)
pgimg="${pgimg:-supabase/postgres:15.1.0.147}"
INITDB="--locale-provider=icu --icu-locale=fr-DZ --lc-collate=fr-DZ --lc-ctype=fr-DZ --encoding=UTF8"

docker run --rm -d --name s0-locale-probe \
  -e POSTGRES_PASSWORD=probe \
  -e POSTGRES_INITDB_ARGS="$INITDB" \
  "$pgimg" >/dev/null 2>&1

for _ in $(seq 1 30); do
  docker exec s0-locale-probe pg_isready -U postgres >/dev/null 2>&1 && break
  sleep 2
done
collate=$(docker exec s0-locale-probe psql -U postgres -qtAX -c "SHOW lc_collate;" 2>/dev/null | tr -d '[:space:]')
docker rm -f s0-locale-probe >/dev/null 2>&1

if [ "$collate" = "fr-DZ" ]; then
  green "locale fr-DZ obtenue sur cluster jetable"
  set_env POSTGRES_INITDB_ARGS "$INITDB"
  green "POSTGRES_INITDB_ARGS écrit dans .env"
else
  red "locale obtenue : « ${collate:-aucune} » au lieu de fr-DZ."
  info "NE PAS lancer docker compose up : le cluster serait créé en locale par"
  info "défaut, et §2.2 dit que ça ne se rattrape pas. Corriger d'abord."
fi

echo
if [ $fail -ne 0 ]; then
  echo "VERDICT : ROUGE — pile préparée dans $TARGET mais PAS démarrée."
  exit 1
fi

echo "VERDICT : VERT — pile prête, non démarrée."
echo
echo "Étapes suivantes, à la main :"
echo "  cd $TARGET && docker compose up -d"
echo "  bash scripts/checkpoint-s0.sh $TARGET"
echo
echo "Puis §4 du document — le poste EST un serveur : veille désactivée,"
echo "BitLocker, réservation DHCP, 5432 bloqué au pare-feu, aucune redirection"
echo "de port sur le routeur."
