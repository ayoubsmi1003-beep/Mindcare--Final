#!/usr/bin/env bash
# deploy-edge — pose les secrets, déploie les Edge Functions, ET RELIT LE RÉSULTAT.
#
#   bash scripts/deploy-edge.sh              # secrets + toutes les fonctions
#   bash scripts/deploy-edge.sh --secrets    # secrets seulement
#   bash scripts/deploy-edge.sh --verifier   # ne déploie rien, affiche l'état déployé
#
# ═══ POURQUOI CE SCRIPT EXISTE — ET NE PAS L'AVOIR A COÛTÉ CHER ═══
#
# Jusqu'au 2026-08-27, AUCUN script du dépôt ne déployait une Edge Function ni ne
# posait un secret. Le déploiement se faisait à la main, donc irrégulièrement,
# donc pas du tout : `jarvis-voice-in` et `jarvis-voice-out` tournaient encore en
# v6 du 25 août pendant que le dépôt portait 1 228 lignes de corrections. Les
# vérifications hors ligne étaient VERTES — sur du code qui n'a jamais tourné.
#
# C'est pourquoi ce script ne se contente pas de déployer : il RELIT ensuite
# l'API Management et affiche la version réellement en ligne. Un déploiement
# qu'on ne revérifie pas est exactement ce qui a produit ce défaut.
#
# ⚠️ AUCUN SECRET N'EST AFFICHÉ, ni passé en ligne de commande (donc invisible
# dans `ps` et dans l'historique) : les valeurs transitent par un fichier
# temporaire en permissions 600, supprimé par `trap` quoi qu'il arrive.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

mode="tout"
case "${1:-}" in
  --secrets)  mode="secrets" ;;
  --verifier) mode="verifier" ;;
  "")         mode="tout" ;;
  *) echo "ROUGE — option inconnue : $1"; exit 1 ;;
esac

FONCTIONS="jarvis-chat jarvis-analyze-session jarvis-resume-cas jarvis-voice-in jarvis-voice-out"

# --- 1 · lecture ciblée de .env -------------------------------------------------
# `grep`+`cut`, jamais `source` : on n'exécute aucune ligne d'un fichier de
# secrets. `tr -d` retire le retour chariot d'un .env écrit sous Windows — piège
# déjà rencontré dans db-migrate.sh, et silencieux à chaque fois.
val() {
  grep -m1 "^$1=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r\n' \
    | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//'
}

[ -f .env ] || { echo "ROUGE — .env introuvable."; exit 1; }

# Le ref se DÉDUIT de l'URL du projet, jamais écrit en dur. C'est exactement la
# confusion qui a fait diagnostiquer « projet INACTIVE » sur un projet qui n'est
# pas celui de l'application — le connecteur MCP en expose un autre.
REF=$(val NEXT_PUBLIC_SUPABASE_URL | sed -E 's|https://([a-z0-9]+)\.supabase\.co.*|\1|')
if [ -z "$REF" ]; then
  echo "ROUGE — impossible de déduire le project-ref de NEXT_PUBLIC_SUPABASE_URL."
  exit 1
fi

TOKEN=$(val SUPABASE_ACCESS_TOKEN)
if [ -z "$TOKEN" ]; then
  echo "ROUGE — SUPABASE_ACCESS_TOKEN absent de .env."
  echo "  Dashboard Supabase → Account → Access Tokens."
  exit 1
fi
export SUPABASE_ACCESS_TOKEN="$TOKEN"

echo "PROJET : $REF"
echo

# --- 2 · l'état réellement en ligne ----------------------------------------------
etat_deploye() {
  curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    "https://api.supabase.com/v1/projects/$REF/functions" \
  | node -e '
    let d = "";
    process.stdin.on("data", (c) => (d += c)).on("end", () => {
      try {
        const j = JSON.parse(d);
        if (!Array.isArray(j)) { console.log("  (réponse inattendue de l API Management)"); return; }
        for (const f of j.sort((a, b) => a.slug.localeCompare(b.slug))) {
          console.log("  " + f.slug.padEnd(24) + " v" + String(f.version).padEnd(5) +
            String(f.status).padEnd(9) +
            new Date(f.updated_at).toISOString().slice(0, 16).replace("T", " "));
        }
      } catch (e) { console.log("  (état déployé illisible)"); }
    });'
}

echo "ÉTAT DÉPLOYÉ — AVANT"
etat_deploye
echo

if [ "$mode" = "verifier" ]; then
  echo "VERDICT : lecture seule, rien n'a été déployé."
  exit 0
fi

# --- 3 · les secrets --------------------------------------------------------------
#
# ⚠️ LES NOMS DE .env ET CEUX QUE LE CODE LIT NE COÏNCIDENT PAS TOUS.
#
# Poser les secrets sous les noms de .env produirait des secrets IGNORÉS, et le
# symptôme serait MUET : `ALEXA_VOICE_ENABLED=false` ne couperait PAS la voix,
# puisque le code lit `JARVIS_VOICE_ENABLED` et que son absence vaut « activé ».
# Un interrupteur de sécurité qui ne coupe rien est pire qu'un interrupteur
# absent : on croit l'avoir actionné.
#
# La table est donc EXPLICITE, et c'est le seul endroit du dépôt où cette
# correspondance existe. Les fichiers restent nommés `jarvis-*` : renommer les
# variables dans le code exigerait un déploiement synchrone avec la rotation des
# secrets, ce que cette passe ne fait pas.
#
#   nom dans .env          →  nom lu par le code
#   ALEXA_ENABLED          →  JARVIS_ENABLED
#   ALEXA_VOICE_ENABLED    →  JARVIS_VOICE_ENABLED
#   ALEXA_STREAMING        →  JARVIS_STREAMING
#   GROQ_STT_MODEL         →  STT_MODEL
#   ELEVENLABS_TTS_MODEL   →  TTS_MODEL
#
# Les autres passent sous leur propre nom.
CORRESPONDANCES="
VOICE_PROVIDER:VOICE_PROVIDER
OPENROUTER_API_KEY:OPENROUTER_API_KEY
OPENROUTER_MODEL:OPENROUTER_MODEL
SEEKAI_API_KEY:SEEKAI_API_KEY
SEEKAI_MODEL:SEEKAI_MODEL
SEEKAI_BASE_URL:SEEKAI_BASE_URL
NEW_API_KEY:NEW_API_KEY
GROQ_API_KEY:GROQ_API_KEY
GROQ_STT_MODEL:STT_MODEL
ELEVENLABS_API_KEY:ELEVENLABS_API_KEY
ELEVENLABS_VOICE_ID:ELEVENLABS_VOICE_ID
ELEVENLABS_TTS_MODEL:TTS_MODEL
ALEXA_ENABLED:JARVIS_ENABLED
ALEXA_VOICE_ENABLED:JARVIS_VOICE_ENABLED
ALEXA_STREAMING:JARVIS_STREAMING
"

# Fichier temporaire en 600, supprimé quoi qu'il arrive — Ctrl-C compris.
umask 077
SECRETS=$(mktemp) || { echo "ROUGE — mktemp a échoué."; exit 1; }
trap 'rm -f "$SECRETS"' EXIT INT TERM

echo "SECRETS — depuis .env, valeurs jamais affichées"
poses=0
manquants=""
for paire in $CORRESPONDANCES; do
  source_nom="${paire%%:*}"
  cible_nom="${paire##*:}"
  v=$(val "$source_nom")
  if [ -z "$v" ]; then
    manquants="$manquants $source_nom"
    continue
  fi
  printf '%s=%s\n' "$cible_nom" "$v" >> "$SECRETS"
  if [ "$source_nom" = "$cible_nom" ]; then
    printf '  %-24s posé\n' "$cible_nom"
  else
    printf '  %-24s posé   (depuis %s)\n' "$cible_nom" "$source_nom"
  fi
  poses=$((poses + 1))
done

if [ -n "$manquants" ]; then
  echo
  echo "  ⚠️  absents de .env, donc NON POSÉS :$manquants"
  echo "      Un secret non posé GARDE sa valeur précédente en ligne, il n'est"
  echo "      pas effacé. Ce n'est donc pas une panne — mais l'état en ligne ne"
  echo "      reflète plus ce fichier, et c'est ainsi qu'on reperd la trace."
fi

if [ $poses -eq 0 ]; then
  echo "ROUGE — aucun secret lisible dans .env."
  exit 1
fi

if ! pnpm exec supabase secrets set --project-ref "$REF" --env-file "$SECRETS" >/dev/null 2>&1; then
  echo "ROUGE — la pose des secrets a échoué."
  # Rejoué pour capturer l'erreur SEULEMENT : le CLI n'imprime pas les valeurs.
  pnpm exec supabase secrets set --project-ref "$REF" --env-file "$SECRETS" 2>&1 \
    | tail -5 | sed 's/^/      /'
  exit 1
fi
echo "  → $poses secret(s) posé(s)."
rm -f "$SECRETS"
trap - EXIT INT TERM
echo

if [ "$mode" = "secrets" ]; then
  echo "VERDICT : VERT — secrets posés. Aucune fonction déployée (--secrets)."
  echo "Suite : bash scripts/deploy-edge.sh"
  exit 0
fi

# --- 4 · le déploiement -----------------------------------------------------------
# `--use-api` : bundling côté serveur, sans Docker. Le poste n'a pas de runtime
# Deno local, et Docker n'est ici que pour psql.
#
# ⚠️ ON NE PASSE PAS `--no-verify-jwt`. Les cinq fonctions sont en ligne avec
# `verify_jwt = true` ET revérifient l'identité elles-mêmes. La double barrière
# est voulue : la passerelle refuse l'anonyme, la fonction refuse un jeton que la
# passerelle aurait laissé passer. En retirer une ouvrirait un point de sortie
# payant à l'anonyme.
echo "DÉPLOIEMENT"
echec=0
for f in $FONCTIONS; do
  printf '  %-24s ' "$f"
  if sortie=$(pnpm exec supabase functions deploy "$f" --project-ref "$REF" --use-api 2>&1); then
    echo "vert"
  else
    echo "ROUGE"
    printf '%s\n' "$sortie" | tail -6 | sed 's/^/        /'
    echec=1
  fi
done
echo

# --- 5 · relire ce qui est RÉELLEMENT en ligne -----------------------------------
# Le contrôle qui manquait. Une version inchangée après un « vert » est le défaut
# de déploiement en train de se reproduire.
echo "ÉTAT DÉPLOYÉ — APRÈS"
etat_deploye
echo

if [ $echec -ne 0 ]; then
  echo "VERDICT : ROUGE — au moins une fonction n'a pas été déployée."
  exit 1
fi
echo "VERDICT : VERT — secrets posés, $(echo $FONCTIONS | wc -w) fonction(s) déployée(s)."
echo "Comparer les deux tableaux ci-dessus : toute version INCHANGÉE est suspecte."
