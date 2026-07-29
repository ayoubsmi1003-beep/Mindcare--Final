#!/usr/bin/env bash
# backup — sauvegarde chiffrée de la base + vérification de restauration.
#
# Le livrable de J3 n'est pas la sauvegarde lancée, c'est la RESTAURATION TESTÉE.
# Ce script fait les deux : il dump, puis il restaure dans une base jetable et compte les lignes.
# Sans le second temps, une sauvegarde n'est qu'une intention.
#
#   DATABASE_URL="postgresql://..." BACKUP_DIR="D:/mindcare-backups" bash scripts/backup.sh
# Optionnel : BACKUP_PASSPHRASE (chiffrement GPG symétrique du dump)
#             VERIFY_URL       (base jetable pour la restauration de contrôle)

set -uo pipefail
: "${DATABASE_URL:?DATABASE_URL requis}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$BACKUP_DIR"
DUMP="$BACKUP_DIR/mindcare-$STAMP.dump"

echo "→ dump ($STAMP)"
pg_dump "$DATABASE_URL" --format=custom --no-owner --file="$DUMP" || { echo "🔴 pg_dump a échoué"; exit 1; }

# Empreinte : une sauvegarde dont on ne peut pas prouver l'intégrité ne vaut rien.
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$DUMP" > "$DUMP.sha256"
  echo "→ empreinte : $(cut -d' ' -f1 < "$DUMP.sha256")"
fi

# Chiffrement : le dump contient des dossiers psychiatriques. Il ne dort jamais en clair.
if [ -n "${BACKUP_PASSPHRASE:-}" ] && command -v gpg >/dev/null 2>&1; then
  gpg --batch --yes --symmetric --cipher-algo AES256 \
      --passphrase "$BACKUP_PASSPHRASE" -o "$DUMP.gpg" "$DUMP" \
    && rm -f "$DUMP" && DUMP="$DUMP.gpg" && echo "→ chiffré AES256"
else
  echo "🟠 dump NON chiffré — BACKUP_PASSPHRASE absent ou gpg introuvable."
  echo "   Acceptable seulement si le support est lui-même chiffré au repos."
fi

# --- restauration de contrôle --------------------------------------------------
if [ -n "${VERIFY_URL:-}" ]; then
  echo "→ restauration de contrôle"
  src="$DUMP"
  if [ "${DUMP##*.}" = "gpg" ]; then
    src="${DUMP%.gpg}.verify"
    gpg --batch --yes --passphrase "$BACKUP_PASSPHRASE" -o "$src" -d "$DUMP" || { echo "🔴 déchiffrement impossible"; exit 1; }
  fi
  pg_restore --clean --if-exists --no-owner -d "$VERIFY_URL" "$src" >/dev/null 2>&1
  for t in app.patients app.clinical_notes app.appointments app.payments; do
    a=$(psql "$DATABASE_URL" -qtAX -c "SELECT count(*) FROM $t;" 2>/dev/null | tail -1)
    b=$(psql "$VERIFY_URL"  -qtAX -c "SELECT count(*) FROM $t;" 2>/dev/null | tail -1)
    if [ "$a" = "$b" ] && [ -n "$a" ]; then
      printf '   %-24s VERT  %s lignes\n' "$t" "$a"
    else
      printf '   %-24s ROUGE source=%s restauré=%s\n' "$t" "$a" "$b"
      echo "🔴 RESTAURATION NON PROUVÉE — cette sauvegarde ne compte pas."
      [ "$src" != "$DUMP" ] && rm -f "$src"
      exit 1
    fi
  done
  [ "$src" != "$DUMP" ] && rm -f "$src"
  echo "✅ restauration vérifiée"
else
  echo "🟠 VERIFY_URL absent — sauvegarde écrite mais NON vérifiée."
  echo "   Tant que la restauration n'est pas testée, le checkpoint J3 reste ROUGE."
fi

# Rétention : 14 jours sur place. L'hors-site est une décision humaine, pas un cron.
find "$BACKUP_DIR" -name "mindcare-*.dump*" -mtime +14 -print -delete 2>/dev/null

echo "→ $DUMP"
