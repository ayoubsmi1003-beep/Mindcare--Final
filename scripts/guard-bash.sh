#!/usr/bin/env bash
# guard-bash — hook PreToolUse sur Bash.
# Un hook n'oublie pas, ne se fatigue pas, et ne négocie pas à 2h du matin.
# Sortie 2 = commande bloquée, le message stderr est rendu au modèle.

payload=$(cat)

if command -v jq >/dev/null 2>&1; then
  cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')
else
  cmd=$(printf '%s' "$payload" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
fi

# Si l'extraction échoue, on scanne la charge brute ponctuation neutralisée.
# Moins précis — jamais plus permissif. Un faux blocage se contourne à la main ;
# une commande destructrice qui passe, non.
[ -z "$cmd" ] && cmd=$(printf '%s' "$payload" | tr '"{},:' '     ')

block() { echo "🔴 BLOQUÉ par scripts/guard-bash.sh — $1" >&2; exit 2; }

# 1 — destruction de fichiers
printf '%s' "$cmd" | grep -Eq '(^|[;&|[:space:]])rm[[:space:]]+-[^[:space:]]*[rRfF]' \
  && block "rm avec -r ou -f. Supprime explicitement, fichier par fichier."

# 2 — réécriture d'historique publiée
printf '%s' "$cmd" | grep -Eq 'git[[:space:]]+push[[:space:]].*(--force|-f([[:space:]]|$))' \
  && block "git push --force. L'historique de ce dépôt est une pièce du dossier."

# 3 — destruction de schéma ou de données en base
printf '%s' "$cmd" | grep -Eiq 'drop[[:space:]]+(database|schema|table|policy|trigger)|truncate[[:space:]]+table|delete[[:space:]]+from[[:space:]]+app\.' \
  && block "DDL/DML destructif en base. Passe par une migration relue (db-migrator)."

printf '%s' "$cmd" | grep -Eiq 'supabase[[:space:]]+db[[:space:]]+reset' \
  && block "supabase db reset. Données patient réelles possibles."

# 4 — secrets exposés dans une sortie de terminal
printf '%s' "$cmd" | grep -Eq '(cat|less|more|head|tail|type)[[:space:]]+[^|;&]*\.env' \
  && block "lecture d'un fichier .env. Les secrets ne transitent pas par le terminal."

printf '%s' "$cmd" | grep -Eq 'echo[[:space:]]+.*\$(SERVICE_ROLE|GROQ_API_KEY|OPENROUTER_API_KEY)' \
  && block "affichage d'un secret. Une clé affichée est une clé compromise."

# 5 — audio écrit sur disque (un glob "*.wav" reste permis : c'est une recherche, pas une écriture)
printf '%s' "$cmd" | grep -Eq '[A-Za-z0-9_-]\.(webm|wav|ogg|mp3|m4a)([^A-Za-z0-9]|$)' \
  && block "fichier audio manipulé sur disque. RAM → Groq → texte → libéré. Règle 7."

# 6 — sortie réseau depuis le shell
printf '%s' "$cmd" | grep -Eq '(curl|wget|Invoke-WebRequest)[[:space:]]+[^|;&]*https?://' \
  && block "appel réseau depuis le shell. Une seule porte de sortie : _shared/external-call.ts."

# 7 — docs/archive : illisible et inaccessible, quel que soit le chemin d'accès.
# La deny-list de settings.json ne couvre que les outils qu'elle nomme ; ici on ferme
# la classe entière (cat, less, sed, awk, type, redirection, git show…).
# Le motif porte la barre oblique finale : `ls -d docs/*rchive*` et `git add docs/archive`
# passent, `cat docs/archive/x.md` est bloqué. C'est délibéré, et ça tient à un caractère.
# La majuscule est couverte aussi : sous Windows docs/Archive désigne le même dossier
# sur le disque, mais pas le même motif dans une deny-list.
printf '%s' "$cmd" | grep -Eq 'docs/[Aa]rchive/' \
  && block "docs/archive est interdit aux agents (DOC-AUTHORITY §2). L'archivage est une opération humaine."

exit 0
