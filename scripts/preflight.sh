#!/usr/bin/env bash
# preflight — les règles de CLAUDE.md qui peuvent devenir un grep le sont devenues.
# Toute sortie non vide = ne pas commiter. C'est un fait, pas une opinion.
fail=0

# 1 — aucune sortie réseau hors passerelle
out=$(grep -rn "fetch(['\"]https://" --include="*.ts" --include="*.tsx" src/ supabase/ 2>/dev/null \
      | grep -v "_shared/external-call.ts")
[ -n "$out" ] && { echo "🔴 fetch externe hors passerelle :"; echo "$out"; fail=1; }

# 2 — aucun secret côté client
out=$(grep -rn "SERVICE_ROLE\|GROQ_API_KEY\|OPENROUTER_API_KEY" src/ 2>/dev/null)
[ -n "$out" ] && { echo "🔴 secret côté client :"; echo "$out"; fail=1; }

# 3 — aucun audio sur disque
out=$(find . -name "*.webm" -o -name "*.wav" -o -name "*.ogg" 2>/dev/null | grep -v node_modules)
[ -n "$out" ] && { echo "🔴 audio sur disque :"; echo "$out"; fail=1; }

# 4 — aucune valeur hex inventée dans le front
# (bloquant : la sortie pose fail=1, l'étiquette le dit maintenant.)
out=$(grep -rnE "#[0-9A-Fa-f]{6}" src/ --include="*.tsx" 2>/dev/null | grep -v "tokens.css")
[ -n "$out" ] && { echo "🔴 hex en dur hors tokens :"; echo "$out"; fail=1; }

# 5 — le piège de la colonne reason
# Les deux quotes, sinon from("appointments") passe sous le radar.
out=$(grep -rnE "from\(['\"]appointments['\"]\)" src/ 2>/dev/null | grep -i "assist\|admin\|reception")
[ -n "$out" ] && { echo "🔴 front assistante sur la TABLE appointments :"; echo "$out"; fail=1; }

# 6 — aucun gabarit d'environnement ne porte de valeur.
# Contrôle AVEUGLE : on ne rend jamais la valeur, seulement le nom de la variable
# et sa ligne. Un secret collé « juste pour que ça marche » dans .env.example —
# dé-ignoré par .gitignore — partirait sinon au commit sans que rien ne le voie.
# Personne n'a besoin de LIRE le fichier pour le savoir.
#
# Trois évasions ont été prouvées contre la 1ʳᵉ version de ce contrôle, chacune
# corrigée ici. Un contrôle aveugle ne vaut que par son exhaustivité : s'il est
# troué, « preflight vert » ne prouve rien du tout et devient pire qu'absent.
#   a) `export KEY=valeur` — forme historique, supportée par dotenv, direnv et
#      `source .env`. Le motif ancré ne la voyait pas. → préfixe `export` optionnel.
#   b) `# KEY=valeur` — le vrai vecteur : on colle la ligne réelle « pour
#      référence » et on la commente. Le secret est intégralement committé.
#      → les lignes commentées portant une valeur sont contrôlées aussi.
#   c) `.gitignore` contient `!.env.example` — motif SANS slash, donc appliqué
#      par git à TOUT niveau : `supabase/.env.example` est committable. La boucle
#      ne regardait que la racine. → découverte récursive.
#
# Le masquage passe par awk et non par sed : `awk -F=` coupe au PREMIER `=`, donc
# le nom affiché ne peut jamais provenir de l'intérieur de la valeur. Un sed
# glouton aurait pu recracher un morceau du secret — l'inverse du but recherché.
mask_env_values() {
  awk -F= '{
    head = $1                       # tout ce qui précède le PREMIER "=" : "12:  export FOO"
    line = head
    sub(/:.*$/, "", line)           # numéro de ligne, préfixé par grep -n
    sub(/^[0-9]+:/, "", head)       # on retire ce préfixe avant de lire le nom
    gsub(/[[:space:]]/, "", head)
    sub(/^#+/, "", head)
    sub(/^export/, "", head)
    printf "  %s: %s = <valeur présente, non affichée>\n", line, head
  }'
}

env_templates=$(find . \( -path ./node_modules -o -path ./.git -o -path ./.next \) -prune -o \
                -type f \( -name ".env.example" -o -name ".env.sample" -o -name ".env.template" \) -print 2>/dev/null)

for f in $env_templates; do
  # Valeur assignée, avec ou sans `export`, commentée ou non.
  out=$(grep -nE '^[[:space:]]*#*[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=[[:space:]]*[^[:space:]#]' "$f" 2>/dev/null \
        | mask_env_values)
  [ -n "$out" ] && { echo "🔴 valeur renseignée dans $f (gabarit attendu, aucune valeur, même en commentaire) :"; echo "$out"; fail=1; }
done

# 6 bis — aucun répertoire caché sous src/.
# ESLint saute les répertoires commençant par un point lors de l'expansion de `.`,
# alors que webpack, lui, résout parfaitement `@/lib/.internal/db`. Du code
# applicatif y vivrait hors de portée de I3, I9 et I10. Un lint qui ne voit pas
# un fichier ne le protège pas : on interdit le répertoire, pas le symptôme.
out=$(find src -type d -name ".*" 2>/dev/null)
[ -n "$out" ] && { echo "🔴 répertoire caché sous src/ (invisible au lint) :"; echo "$out"; fail=1; }

# 7 — aucun fichier d'environnement réel suivi par git.
out=$(git ls-files 2>/dev/null | grep -E '(^|/)\.env' | grep -vE '\.env\.(example|sample|template)$')
[ -n "$out" ] && { echo "🔴 fichier .env suivi par git :"; echo "$out"; fail=1; }

[ $fail -eq 0 ] && echo "✅ preflight vert"
exit $fail
