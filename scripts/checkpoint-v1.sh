#!/usr/bin/env bash
# CHECKPOINT V1 — VÉRITÉ & VITESSE. VERT, ROUGE ou BLOQUÉ.
#
#   bash scripts/checkpoint-v1.sh
#
# CE QUE CE SCRIPT PROUVE, ET CE QU'IL NE PROUVE PAS.
#
# V1 rend l'application VÉRIDIQUE (V1.1 erreurs, V1.4 états), DIAGNOSABLE
# (V1.1 cause préservée) et MESURABLE (V1.5). Les deux premiers tiers se
# vérifient statiquement : ce script les vérifie tous. Le dernier tiers — la
# vitesse — ne se vérifie qu'au navigateur, chronomètre en main, et AUCUN
# contrôle de ce fichier ne peut le remplacer. Il est donc déclaré BLOQUÉ, pas
# vert : voir le contrôle final et `06-PERF-BUDGET.md` §6.
#
# TROIS VERDICTS, même convention que checkpoint-s7 / s7b :
#   VERT   — tous les contrôles exécutés passent.
#   ROUGE  — au moins un contrôle exécuté a échoué (code 1).
#   BLOQUÉ — les contrôles exécutables passent, mais au moins un contrôle du
#            contrat n'a PAS pu s'exécuter. CE N'EST PAS UN VERT (code 2).
#
# ⚠️ AUCUN ACCÈS BASE, AUCUN DOCKER, AUCUNE ÉCRITURE. V1.5 et V1.2 n'ont touché
# ni au schéma ni aux données ; ce checkpoint est statique par nature, et le
# rendre dépendant d'un conteneur le rendrait injouable sans rien prouver de
# plus. La preuve base de V1.3 vit dans son propre rejeu (STATE.md, Step 12).

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
blocked=0
n=0
echo "CHECKPOINT V1 — VÉRITÉ & VITESSE"
echo

green() { n=$((n+1)); printf '%-2s %-62s VERT\n' "$n" "$1"; }
red()   { n=$((n+1)); printf '%-2s %-62s ROUGE  %s\n' "$n" "$1" "$2"; fail=1; }
skip()  { n=$((n+1)); printf '%-2s %-62s BLOQUÉ %s\n' "$n" "$1" "$2"; blocked=1; }

# ═══ V1.1 — LA CAUSE EXISTE ET VOYAGE ════════════════════════════════════════

# 1 · `"inattendu"` n'est plus un code TERMINAL.
#
# Le contrat de SPRINT-V1 §1 écrit « grep → 0 ». Un grep littéral à 0 est
# IMPOSSIBLE et le dire franchement vaut mieux que de le maquiller : le code
# existe par construction dans le type (`errors.ts`) et dans la traduction
# (`fr.ts`). Le contrôle exécutable est « 0 occurrence HORS de ces deux
# fichiers ». Les commentaires ne sont pas dépouillés ici, délibérément : une
# occurrence en commentaire ailleurs signale un chemin d'erreur qu'on s'apprête
# à rouvrir, et coûte moins cher à reformuler qu'à re-découvrir.
out=$(grep -rn '"inattendu"' src/ 2>/dev/null \
      | grep -v "src/services/errors.ts" \
      | grep -v "src/i18n/fr.ts")
[ -z "$out" ] && green "aucun \"inattendu\" hors errors.ts / fr.ts" \
              || red "\"inattendu\" hors des 2 fichiers autorisés" "$(printf '%s' "$out" | head -1)"

# 2 · `AppError` porte bien `context` et `cause` — sans quoi la cause est
# détruite à la source et tout V1.1 est décoratif.
if grep -qE 'readonly context\?: string' src/services/errors.ts \
   && grep -qE 'readonly cause\?: unknown' src/services/errors.ts; then
  green "AppError porte context + cause (V1.1)"
else
  red "AppError a perdu context ou cause" "src/services/errors.ts"
fi

# 3 · `LogFields` reste FERMÉE et sans fuite.
#
# C'est le TYPE qui applique I5, pas la vigilance du relecteur : le nom du champ
# interdit d'écrire la fuite. `message` est proscrit (un message Postgres porte
# la valeur qui a déclenché l'erreur — « Key (phone)=(0554…) »), `patientId`
# aussi (retiré délibérément, il ne revient jamais), et tout champ libre
# (`Record<string, unknown>`, `[k: string]`) rouvrirait les deux d'un coup.
#
# ⚠️ LES COMMENTAIRES SONT DÉPOUILLÉS AVANT LE GREP, même méthode que
# `preflight.sh` §9d. Sans ça le contrôle rougit sur sa propre documentation :
# la ligne « Code d'erreur applicatif ou SQLSTATE. Jamais un message. » contient
# le mot interdit précisément parce qu'elle l'interdit. Un contrôle qui punit le
# commentaire qui le respecte apprend à supprimer les commentaires.
bloc=$(sed -n '/interface LogFields/,/^}/p' src/services/log.ts \
       | sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d')
out=$(printf '%s' "$bloc" | grep -nE 'message|patientId|nom|Record<string|\[key:|\[k:')
[ -z "$out" ] && green "LogFields fermée : ni message, ni patientId, ni champ libre" \
              || red "LogFields a rouvert une fuite" "$(printf '%s' "$out" | head -1)"

# ═══ RÈGLE 1 / RÈGLE 2 — LA FRONTIÈRE ET LES SECRETS ═════════════════════════

# 4 · UN SEUL point de sortie externe dans tout le dépôt (règle 1).
# Un `fetch('https://…')` ailleurs n'est pas une entorse de style : c'est
# l'architecture qui tombe.
out=$(grep -rn "fetch(\"https\|fetch('https" --include="*.ts" --include="*.tsx" src/ supabase/ 2>/dev/null \
      | grep -v "supabase/functions/_shared/external-call.ts")
[ -z "$out" ] && green "un seul fetch externe (external-call.ts), règle 1" \
              || red "fetch externe hors de la passerelle" "$(printf '%s' "$out" | head -1)"

# 5 · Aucune clé au bundle client (règle 2). Exige un build : sans `.next/`, le
# contrôle n'a rien mesuré et le dire est le seul comportement honnête.
if [ -d .next/static ]; then
  out=$(grep -rn "OPENROUTER\|GROQ\|ELEVENLABS\|SEEKAI" .next/static/ 2>/dev/null)
  [ -z "$out" ] && green "aucun secret dans .next/static (règle 2)" \
                || red "SECRET AU BUNDLE — arrêt immédiat" "$(printf '%s' "$out" | head -1)"
else
  skip "aucun secret dans .next/static (règle 2)" ".next/ absent — lancer pnpm build"
fi

# 6 · Aucune décision de rôle dans un écran (règle 4). La sécurité vit en base ;
# un `if (role === …)` dans une page est un bug de conception, pas une
# précaution supplémentaire.
#
# ⚠️ COMMENTAIRES DÉPOUILLÉS, même raison qu'au contrôle 3 et même méthode
# (`preflight.sh` §9d). Plusieurs écrans EXPLIQUENT en tête qu'ils ne portent
# aucun `if (role === …)` — `agenda/nouveau/page.tsx:5` le fait mot pour mot.
# Un grep brut rougit donc sur les fichiers les plus rigoureux du dépôt.
out=""
while IFS= read -r f; do
  hit=$(sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' "$f" 2>/dev/null \
        | grep -nE 'if[[:space:]]*\([^)]*\brole\b[[:space:]]*===' | sed "s|^|$f:|")
  [ -n "$hit" ] && out="$out$hit"$'\n'
done < <(find src/app -name "*.tsx" 2>/dev/null)
out=$(printf '%s' "$out" | grep -v '^$')
[ -z "$out" ] && green "aucun if (role === …) dans les écrans (règle 4)" \
              || red "décision de rôle en JavaScript" "$(printf '%s' "$out" | head -1)"

# ═══ V1.2 — LA FRONTIÈRE JARVIS ══════════════════════════════════════════════

# 7 · Le plafond CLIENT existe sur `invokeFunction`.
# Sans lui, une Edge Function muette laisse « Analyse en cours… » tourner sans
# fin — le défaut nommément interdit par 05-UX-CONTRACT.md §2.
if grep -q "PLAFOND_INVOKE_MS" src/services/db/supabase.ts \
   && grep -q "new AbortController()" src/services/db/supabase.ts; then
  green "plafond client sur invokeFunction (AbortController)"
else
  red "invokeFunction sans plafond client" "src/services/db/supabase.ts"
fi

# 8 · La passerelle garde SES 10 s, et le plafond client lui est SUPÉRIEUR.
#
# 10 s vient de `03-JARVIS-TOOLS.md` §10 (rang 4). `SPRINT-V1.md` §V1.2 écrit
# 30 s (rang 5) : par DOC-AUTHORITY §1 le rang 4 gagne — arbitrage utilisateur
# du 2026-08-11, aucun document d'autorité modifié. Ce contrôle rougit si
# quelqu'un applique le 30 s sans rejouer l'arbitrage.
passerelle=$(grep -oE 'TIMEOUT_MS_DEFAUT = [0-9_]+' supabase/functions/_shared/external-call.ts | grep -oE '[0-9_]+$' | tr -d '_')
client=$(grep -oE 'PLAFOND_INVOKE_MS = [0-9_]+' src/services/db/supabase.ts | grep -oE '[0-9_]+$' | tr -d '_')
if [ "$passerelle" = "10000" ] && [ -n "$client" ] && [ "$client" -gt "$passerelle" ]; then
  green "passerelle 10 s (rang 4) · plafond client supérieur (${client} ms)"
else
  red "timeouts incohérents avec l'arbitrage" "passerelle=${passerelle:-absent} client=${client:-absent}"
fi

# ═══ V1.4 / V1.5 — LES ÉTATS D'ÉCRAN ═════════════════════════════════════════

ECRANS="src/app/finances/page.tsx src/app/patients/page.tsx src/app/agenda/page.tsx src/app/consultation/[id]/page.tsx"

# 9 · AUCUNE ATTENTE INFINIE (05-UX-CONTRACT.md §2). Chacun des quatre écrans
# porte un plafond de 10 s qui bascule en ERREUR avec le mot « délai ».
manquants=""
for f in $ECRANS; do
  grep -qE 'DELAI_CHARGEMENT_MS|DELAI_LECTURE_MS' "$f" 2>/dev/null || manquants="$manquants $f"
done
[ -z "$manquants" ] && green "plafond de délai sur les 4 écrans (UX §2)" \
                    || red "écran sans plafond de délai" "$manquants"

# 10 · Le mot « délai » est bien celui que l'utilisatrice lit, et il vient du
# fichier de traduction (ADR-008), jamais d'une chaîne en dur.
if grep -qE '^\s*delaiDepasse:' src/i18n/fr.ts \
   && sed -n '/delaiDepasse:/,+3p' src/i18n/fr.ts | grep -qi 'délai'; then
  green "fr.delaiDepasse existe et porte le mot « délai »"
else
  red "le message de délai manque ou ne dit pas « délai »" "src/i18n/fr.ts"
fi

# 11 · SQUELETTE, jamais un mot d'attente (05-UX-CONTRACT.md §2) : un texte
# d'une ligne remplacé par le contenu réel décale l'écran à l'instant du clic.
manquants=""
for f in $ECRANS; do
  grep -q 'Squelette' "$f" 2>/dev/null || manquants="$manquants $f"
done
[ -z "$manquants" ] && green "squelette de chargement sur les 4 écrans" \
                    || red "écran sans squelette" "$manquants"

# 12 · La machine à états de /finances reste EXCLUSIVE (V1.4, UX §1) : c'est
# l'écran qui a fait écrire le document. `erreur` et `vide` ne coexistent jamais.
if grep -q 'type EtatFinances' src/app/finances/page.tsx; then
  green "/finances : machine à états exclusive (V1.4)"
else
  red "/finances a reperdu sa machine à états" "src/app/finances/page.tsx"
fi

# 13 · L'ÉCHEC DE LECTURE reste distinct de la SÉANCE INTROUVABLE (V1.4).
# Les confondre affichait « Cette séance est introuvable » sur une coupure
# réseau — un mensonge — et faisait disparaître une séance réellement ouverte.
if grep -q 'echecLecture' "src/app/consultation/[id]/page.tsx"; then
  green "/consultation : échec de lecture ≠ séance introuvable"
else
  red "/consultation a reperdu la distinction V1.4" "echecLecture absent"
fi

# ═══ LE CORPUS DE MIGRATIONS ═════════════════════════════════════════════════

# 14 · Le corpus est applicable. Contrôle DÉLÉGUÉ à verify-migrations.sh — le
# réécrire ici ferait deux vérités qui divergeraient.
#
# ⚠️ Ce contrôle a déjà rattrapé un état de dépôt que STATE.md décrivait à tort
# comme réglé (031 revenu dans supabase/migrations/, 2026-08-11). C'est la
# raison de le lancer par principe et non sur soupçon.
if bash scripts/verify-migrations.sh >/dev/null 2>&1; then
  green "verify-migrations.sh : corpus applicable"
else
  red "verify-migrations.sh ROUGE" "lancer bash scripts/verify-migrations.sh"
fi

# ═══ LA VITESSE — LE CONTRÔLE QUI NE PEUT PAS ÊTRE VERT ICI ══════════════════

# 15 · Les trois chiffres par écran (06-PERF-BUDGET.md §6).
#
# CE CONTRÔLE EST STRUCTURELLEMENT BLOQUÉ, ET C'EST VOULU. Les trois grandeurs —
# appels réseau au chargement, temps jusqu'au premier contenu, temps jusqu'à
# l'écran complet — se relèvent à l'onglet Réseau d'un navigateur authentifié,
# en `pnpm build && pnpm start`, 3 répétitions, médiane. Aucun script de shell
# ne les produit, et un TTFB `curl` ne les APPROCHE MÊME PAS : il mesure la
# coquille HTML, pas la donnée.
#
# Il aurait été facile de ne pas écrire ce contrôle du tout — le checkpoint
# serait « vert ». C'est exactement ce que 06-PERF-BUDGET §6 interdit : « une
# mesure absente n'est pas une mesure réussie ». Il est donc écrit, et il
# BLOQUE : le checkpoint V1 ne peut pas rendre VERT tant que les chiffres ne
# sont pas dans STATE.md.
#
# Dérogation utilisateur du 2026-08-11 : la mesure est DIFFÉRÉE (réactivité
# jugée acceptable à l'usage), sans qu'aucun chiffre soit affirmé. La dérogation
# autorise la session à continuer ; elle ne rend pas ce contrôle vert, et ce
# script n'en tient délibérément aucun compte — un waiver qui éteindrait son
# propre contrôle ne laisserait aucune trace exécutable de la dette.
skip "3 chiffres par écran (06-PERF-BUDGET §6)" "non mesuré — navigateur requis"

echo
if [ $fail -ne 0 ]; then
  echo "VERDICT : ROUGE — arrêt de la progression. Corriger la cause, pas le contrôle."
  exit 1
fi
if [ $blocked -ne 0 ]; then
  echo "VERDICT : BLOQUÉ — les contrôles exécutables passent ; au moins un contrôle"
  echo "          du contrat n'a pas pu s'exécuter. CE N'EST PAS UN VERT."
  echo
  echo "          Pour V1, l'état attendu à ce jour EST « BLOQUÉ » : la mesure de"
  echo "          performance est différée par dérogation (STATE.md, §V1.5), et la"
  echo "          dette reste ouverte. Un VERT exigerait les 15 relevés en"
  echo "          navigateur — pas une modification de ce script."
  exit 2
fi
echo "VERDICT : VERT — $n contrôles."
