#!/usr/bin/env bash
# checkpoint-migrations-etat — LE REGISTRE DE CE DÉPÔT, COMPARÉ AUX FICHIERS.
#
# ═══ POURQUOI CE CONTRÔLE EXISTE ═══
#
# `supabase migration list` affiche `remote: ""` pour les 62 migrations et
# donne l'impression alarmante d'une base non provisionnée. C'EST UN FAUX
# SIGNAL : le CLI interroge `supabase_migrations.schema_migrations`, une table
# qui n'existe pas ici. Le registre de ce dépôt est `app.schema_migrations`,
# créée par 001 et tenue par `scripts/db-migrate.sh`.
#
# ⚠️ NE JAMAIS LANCER `supabase db push` SUR CETTE BASE. Le CLI, ne voyant
# aucune migration enregistrée dans SA table, tenterait de rejouer 001→064 sur
# une base déjà provisionnée. Créer sa table pour « réconcilier » serait pire
# encore : deux registres concurrents, dont un seul est tenu à jour.
#
# Ce script compare le VRAI registre au corpus de fichiers, et ne rend qu'un
# verdict. Lecture seule : aucune écriture, aucun DDL.
#
#   bash scripts/checkpoint-migrations-etat.sh
set -uo pipefail
cd "$(dirname "$0")/.."

DB=$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | tr -d '\r' | sed 's/^[[:space:]]*//')
if [ -z "$DB" ]; then
  echo "ROUGE — DATABASE_URL absent de .env"; exit 1
fi
# `connect_timeout` explicite : sans lui, une base injoignable fait pendre psql
# jusqu'au délai du conteneur, et le checkpoint paraît planté au lieu d'échouer.
DB="${DB}?connect_timeout=15&sslmode=require"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if ! docker run --rm -i postgres:17 psql "$DB" -t -A -v ON_ERROR_STOP=1 \
       -c "SELECT version FROM app.schema_migrations ORDER BY version;" \
       > "$tmp/base.txt" 2>"$tmp/err.txt"; then
  echo "ROUGE — lecture de app.schema_migrations impossible :"
  head -3 "$tmp/err.txt"
  exit 1
fi

sed -i '/^$/d' "$tmp/base.txt"
sort -o "$tmp/base.txt" "$tmp/base.txt"
ls supabase/migrations/*.sql | sed 's|.*/||; s|\.sql$||' | sort > "$tmp/fichiers.txt"

manquantes=$(comm -23 "$tmp/fichiers.txt" "$tmp/base.txt")
orphelines=$(comm -13 "$tmp/fichiers.txt" "$tmp/base.txt")
nf=$(wc -l < "$tmp/fichiers.txt"); nb=$(wc -l < "$tmp/base.txt")

echo "fichiers : $nf    enregistrées en base : $nb"
rouges=0
if [ -n "$manquantes" ]; then
  echo "ROUGE | migrations NON appliquées :"; echo "$manquantes" | sed 's/^/        · /'
  rouges=$((rouges+1))
else
  echo "vert  | toutes les migrations du dépôt sont appliquées"
fi
if [ -n "$orphelines" ]; then
  # Une ligne sans fichier signifie qu'une migration a été appliquée puis
  # supprimée du dépôt : la base porte alors un schéma que le code ne décrit
  # plus, et personne ne peut le rejouer ailleurs.
  echo "ROUGE | enregistrées en base SANS fichier :"; echo "$orphelines" | sed 's/^/        · /'
  rouges=$((rouges+1))
else
  echo "vert  | aucune migration orpheline"
fi

echo
[ "$rouges" -eq 0 ] && echo "VERDICT MIGRATIONS : VERT" || echo "VERDICT MIGRATIONS : ROUGE"
exit "$rouges"
