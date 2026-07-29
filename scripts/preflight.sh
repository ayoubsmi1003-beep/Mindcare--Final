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
out=$(grep -rnE "#[0-9A-Fa-f]{6}" src/ --include="*.tsx" 2>/dev/null | grep -v "tokens.css")
[ -n "$out" ] && { echo "🟠 hex en dur hors tokens :"; echo "$out"; fail=1; }

# 5 — le piège de la colonne reason
out=$(grep -rn "from('appointments')" src/ 2>/dev/null | grep -i "assist\|admin\|reception")
[ -n "$out" ] && { echo "🔴 front assistante sur la TABLE appointments :"; echo "$out"; fail=1; }

[ $fail -eq 0 ] && echo "✅ preflight vert"
exit $fail
