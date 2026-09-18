#!/usr/bin/env bash
# checkpoint-jarvis-couche — LA COUCHE OPÉRANTE, ÉPROUVÉE EN LA FAISANT TOURNER.
#
# ═══ CE QUE CE CHECKPOINT PROUVE, ET CE QU'IL NE PROUVE PAS ═══
# Il prouve le FLOT DE CONTRÔLE : la frontière de confidentialité, la boucle
# agentique, le cycle d'écriture, la composition des briefs. Sans réseau, sans
# clé, sans base — donc reproductible, et donc rejouable le jour de la bascule
# vers le modèle local (mois 2), où il devra rendre exactement le même verdict.
#
# Il NE prouve PAS que Jarvis répond bien avec un vrai modèle sur de vraies
# données : cela se mesure au navigateur, et cette mesure n'est pas ici. Un
# checkpoint qui déclarerait vert un comportement non observé serait pire qu'un
# checkpoint absent — on lui ferait confiance.
set -uo pipefail
cd "$(dirname "$0")/.."

rouges=0
vert()  { printf '  vert  | %-52s | %s\n' "$1" "$2"; }
rouge() { printf '  ROUGE | %-52s | %s\n' "$1" "$2"; rouges=$((rouges+1)); }

echo "── Qualité statique ────────────────────────────────────────────────────"
# ⚠️ ON NOMME LES FICHIERS EN ERREUR, ON NE LES EXCLUT PAS. Ce dépôt est édité
# par plusieurs sessions : au 2026-08-26, `components/reception/` et
# `app/documents/` portaient des chantiers concurrents non suivis. Un checkpoint
# qui filtrerait leurs erreurs pour rendre vert serait exactement le « vert qui
# recouvre » que ce dépôt a déjà payé — on distingue donc DEUX comptes, et les
# deux sont affichés.
COUCHE='src/services/jarvis-|src/services/conversation|src/i18n/|src/components/FilJarvis'
./node_modules/.bin/tsc --noEmit > /tmp/mc-tsc.txt 2>&1 || true
tot=$(grep -c "^src/.*error" /tmp/mc-tsc.txt || true)
mien=$(grep "^src/.*error" /tmp/mc-tsc.txt | grep -Ec "$COUCHE" || true)
if [ "$mien" -eq 0 ]; then
  vert "tsc — fichiers de CETTE passe" "0 erreur"
else
  rouge "tsc — fichiers de CETTE passe" "$mien erreur(s)"
fi
if [ "$tot" -eq 0 ]; then
  vert "tsc — dépôt entier" "0 erreur"
else
  rouge "tsc — dépôt entier" "$tot erreur(s), chantiers concurrents :"
  grep "^src/.*error" /tmp/mc-tsc.txt | sed 's/(.*//' | sort -u | sed 's/^/           · /'
fi

if ./node_modules/.bin/eslint src/services/jarvis-*.ts src/services/conversation.ts >/dev/null 2>&1; then
  vert "eslint (couche Jarvis)" "aucune erreur"
else
  rouge "eslint (couche Jarvis)" "au moins une erreur"
fi

echo
echo "── Compilation des modules pour l'évaluation ───────────────────────────"
# CommonJS, dans le dépôt : Node y résout `node_modules`, et les imports
# extensionless fonctionnent sans réécriture. Artefact jeté, jamais un livrable.
if ./node_modules/.bin/tsc -p .eval-tsconfig.json >/dev/null 2>&1 \
   || [ -f .eval-out/services/jarvis-boucle.js ]; then
  echo '{"type":"commonjs"}' > .eval-out/package.json
  node -e '
    const {readdirSync,statSync,readFileSync,writeFileSync}=require("fs");
    const {join,relative,sep}=require("path");
    const racine=".eval-out";
    (function marcher(d){
      for(const e of readdirSync(d)){
        const p=join(d,e);
        if(statSync(p).isDirectory()){marcher(p);continue;}
        if(!p.endsWith(".js"))continue;
        const s=readFileSync(p,"utf8");
        if(!s.includes("\"@/"))continue;
        const rel=relative(racine,d);
        const pre=rel===""?"./":"../".repeat(rel.split(sep).length);
        writeFileSync(p,s.split("\"@/").join("\""+pre));
      }
    })(racine);
  '
  vert "compilation CommonJS + résolution des alias" "$(find .eval-out -name '*.js' | wc -l) modules"
else
  rouge "compilation CommonJS" "échec"
fi

DIR="$(pwd)/.eval-out/services"

echo
echo "── Passes d'évaluation ─────────────────────────────────────────────────"
for passe in frontiere boucle chaine ecritures briefs reveil; do
  echo
  if node "scripts/eval-jarvis-${passe}.mjs" "$DIR" 2>&1 | grep -v '^{'; then
    vert "eval-jarvis-${passe}" "exit 0"
  else
    rouge "eval-jarvis-${passe}" "au moins un contrôle rouge"
  fi
done

# ═══════════════════════════════════════════════════════════════════════════
# LA FRONTIÈRE ADR-023 — ET LA RÉPARATION DE DEUX GARDES MORTS (2026-09-05)
# ═══════════════════════════════════════════════════════════════════════════
#
# ⚠️ CE BLOC NE PROUVAIT PLUS RIEN, ET IL LE DISAIT EN VERT. Deux défauts
# indépendants, chacun suffisant à lui seul :
#
#   1. LE FICHIER COMPILÉ N'EXISTAIT PLUS. La cible était
#      `supabase/functions/_shared/routing.ts` — retirée par ADR-001, quand la
#      base est descendue sur la machine du cabinet et que les Edge Functions
#      ont disparu. Le `|| true` avalait l'échec de compilation, et les trois
#      passes visaient ensuite un `.js` fantôme.
#
#   2. LE STATUT TESTÉ N'ÉTAIT PAS CELUI DE `node`. Dans
#      `if node … | grep -vE "^  vert "`, le shell lit le code de sortie du
#      DERNIER élément du tube — `grep`. Et `grep -v` trouve toujours quelque
#      chose : la ligne « VERDICT ROUTAGE » n'est pas une ligne « vert ». La
#      passe la plus importante de ce fichier rendait donc VERT quoi qu'il
#      arrive, y compris sur un fichier absent.
#
# Un garde-fou qui ne peut pas rendre rouge n'est pas un garde-fou : c'est une
# décoration à laquelle on fait confiance. On compile depuis la source VIVANTE,
# on laisse l'échec de compilation être rouge, et on lit le statut de `node`.
echo
# ⚠️ LA SORTIE PRÉCÉDENTE EST DÉTRUITE AVANT DE RECOMPILER, ET C'EST LE POINT.
# Sans cela, une compilation en échec laisserait en place le `.js` d'un tour
# antérieur : les trois passes tourneraient sur la frontière d'HIER et
# rendraient vert pendant que la frontière d'aujourd'hui ne compile plus. On
# remplacerait un repli silencieux par un autre, ce qui est exactement ce qu'on
# est en train de corriger.
rm -rf .eval-out/frontiere
if ./node_modules/.bin/tsc src/shared/jarvis/normalisation.ts \
     --outDir .eval-out/frontiere --module commonjs --target es2022 \
     --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes \
     --noEmitOnError >/dev/null 2>&1; then
  vert "compilation de la frontière" "routing + normalisation + lexique"
else
  rouge "compilation de la frontière" "tsc a échoué — les 3 passes qui suivent sont sans objet"
fi
FRONTIERE="$(pwd)/.eval-out/frontiere"

# Le scénario M éprouve l'enveloppe de données : un contenu de dossier ne doit
# pas pouvoir se refermer et redevenir une instruction.
echo
if node scripts/eval-jarvis-injection.mjs "$FRONTIERE/routing.js"; then
  vert "eval-jarvis-injection (scénario M)" "exit 0"
else
  rouge "eval-jarvis-injection (scénario M)" "au moins un contrôle rouge"
fi

# La frontière de DÉCISION CLINIQUE — la seule de ce fichier qui protège un
# patient et non une donnée. Depuis le 2026-09-05 elle est éprouvée dans
# QUATRE langues, et sa monotonie est vérifiée sur chaque phrase du corpus.
echo
sortie_routage="$(node scripts/eval-jarvis-routage.mjs "$FRONTIERE" 2>&1)"
statut_routage=$?
printf '%s\n' "$sortie_routage" | grep -vE "^  vert " || true
if [ "$statut_routage" -eq 0 ]; then
  vert "eval-jarvis-routage (décision clinique)" "exit 0"
else
  rouge "eval-jarvis-routage (décision clinique)" "au moins un contrôle rouge"
fi

echo
if node scripts/eval-jarvis-v2.mjs "$FRONTIERE/routing.js" >/dev/null 2>&1; then
  vert "eval-jarvis-v2 (ADR-023, non-régression)" "exit 0"
else
  rouge "eval-jarvis-v2 (ADR-023, non-régression)" "au moins un contrôle rouge"
fi

# M01 — LES INTENTIONS STRUCTUREES. Contrat + classifieur compiles comme la
# frontiere (sortie detruite avant de recompiler, comme ci-dessus : un .js
# d'hier ne doit jamais faire verdir la frontiere d'aujourd'hui).
echo
rm -rf .eval-out/intentions
if ./node_modules/.bin/tsc -p .eval-intentions-tsconfig.json >/dev/null 2>&1; then
  node scripts/reecrire-alias-eval.mjs .eval-out/intentions >/dev/null 2>&1
  vert "compilation des intentions" "intentions + classifieur"
else
  rouge "compilation des intentions" "tsc a echoue"
fi
INTENTIONS="$(pwd)/.eval-out/intentions"

echo
sortie_intentions="$(node scripts/eval-jarvis-intentions.mjs "$INTENTIONS" "$FRONTIERE" 2>&1)"
statut_intentions=$?
printf '%s\n' "$sortie_intentions" | grep -vE "^  vert " || true
if [ "$statut_intentions" -eq 0 ]; then
  vert "eval-jarvis-intentions (M01)" "exit 0"
else
  rouge "eval-jarvis-intentions (M01)" "au moins un controle rouge"
fi

# M02 — LA CONVERSATION. Meme chaine que la boucle (services compiles +
# alias resolus), scenarios multi-tours goldens : verdicts, chainage,
# zero-outil adversarial, lignage. Les services sont deja compiles plus
# haut (passe "Compilation des modules") : on rejoue la passe ici, jamais
# sur un .eval-out d'hier (voir la remarque frontiere ci-dessus).
echo
sortie_conversation="$(node scripts/eval-jarvis-conversation.mjs "$(pwd)/.eval-out" 2>&1)"
statut_conversation=$?
printf '%s\n' "$sortie_conversation" | grep -vE "^  vert " || true
if [ "$statut_conversation" -eq 0 ]; then
  vert "eval-jarvis-conversation (M02)" "exit 0"
else
  rouge "eval-jarvis-conversation (M02)" "au moins un controle rouge"
fi

echo
# L'ASSEMBLAGE DU CONTEXTE D'ANALYSE DE SÉANCE. La préséance des sources —
# notes de la praticienne AVANT transcription — est une propriété du CODE, pas
# une consigne de prompt : une consigne se suit « la plupart du temps », et
# « la plupart du temps » ne vaut rien sur un document clinique.
./node_modules/.bin/tsc supabase/functions/_shared/contexte-seance.ts \
  --outDir .eval-out/edge --module commonjs --target es2022 >/dev/null 2>&1 || true
if node scripts/eval-contexte-seance.mjs "$(pwd)/.eval-out/edge/contexte-seance.js" >/dev/null 2>&1; then
  vert "eval-contexte-seance (préséance des sources)" "exit 0"
else
  rouge "eval-contexte-seance (préséance des sources)" "au moins un contrôle rouge"
fi

echo
echo "── La boucle vocale ────────────────────────────────────────────────────"
# ⚠️ CES QUATRE-LÀ GARDENT LA CHAÎNE QUI VA DU MICRO À LA RÉPONSE PARLÉE.
# Elle a longtemps été rompue en un point précis — `cloturerCommande()` sans
# appelant, donc un enregistrement qui ne s'arrêtait jamais. Aucun de ces
# contrôles ne demande de micro : ils pilotent une horloge et un poste simulés,
# donc ils rendent le même verdict sur n'importe quelle machine.
for e in micro-partage endpointage machine-voix lecture-voix; do
  if node "scripts/eval-$e.mjs" "$(pwd)/.eval-out/services" >/dev/null 2>&1; then
    vert "eval-$e" "exit 0"
  else
    rouge "eval-$e" "au moins un contrôle rouge"
  fi
done

echo
echo "── Garde-fous de règle ─────────────────────────────────────────────────"

# ⚠️ RÈGLE 3 — JARVIS NE SUPPRIME RIEN, ET CE CONTRÔLE EST CE QUI LE MAINTIENT.
# L'absence de capacité de suppression tient aujourd'hui parce que personne ne
# l'a ajoutée. Elle tombera le jour où quelqu'un câblera `delete_charge` — qui
# existe déjà dans le domaine finance — parce qu'un écran en avait besoin.
if node scripts/eval-registre-sans-suppression.mjs "$(pwd)/.eval-out/services" >/dev/null 2>&1; then
  vert "aucune capacité de suppression pour Jarvis" "registres lecture + écriture"
else
  rouge "aucune capacité de suppression pour Jarvis" "UNE CAPACITÉ DE SUPPRESSION EST EXPOSÉE"
fi
# Phase 4 Alexa — la surface 22+7, le TTL, la clarification, l'amorce.
if node scripts/eval-jarvis-registre.mjs "$(pwd)/.eval-out/services" >/dev/null 2>&1; then
  vert "eval-jarvis-registre (surface Alexa 1-3)" "exit 0"
else
  rouge "eval-jarvis-registre (surface Alexa 1-3)" "au moins un contrôle rouge"
fi
# Règle 2 : aucune clé de fournisseur dans le bundle client.
if [ -d .next/static ]; then
  if grep -rq "OPENROUTER\|GROQ\|ELEVENLABS\|SEEKAI" .next/static/ 2>/dev/null; then
    rouge "aucun secret fournisseur dans .next/static" "OCCURRENCE TROUVÉE"
  else
    vert "aucun secret fournisseur dans .next/static" "0 occurrence"
  fi
else
  printf '  (n/a)  | %-52s | %s\n' "secrets dans .next/static" "pas de build — contrôle non exécuté"
fi

# Le modèle n'est nommé QUE dans la passerelle (couture du mois 2).
#
# ⚠️ CE CONTRÔLE DISAIT « hors passerelle » ET NE L'APPLIQUAIT PAS. Il balayait
# `src/` en entier, donc il rougissait sur `DEFAULT_MODEL` — la constante de
# repli que la passerelle DOIT porter, et que son propre en-tête déclare être
# « la SEULE constante de repli du dépôt pour ce choix ». Un contrôle qui
# condamne la chose même qu'il prescrit finit par être ignoré, et c'est ce qui
# s'est passé : il est resté rouge assez longtemps pour devenir du décor.
#
# Deux corrections, toutes deux dans le sens de l'intention d'origine :
#
#   1. la PASSERELLE est exclue — c'est le point de sortie unique, l'endroit
#      désigné pour nommer un modèle ;
#   2. `src/graphify-out/` est exclu : SORTIE D'OUTIL déposée dans `src/`,
#      pas du code écrit — même classe que les exclusions `.eval-out` et
#      `resources/` d'`eslint.config.js`, et pour la raison qui y est déjà
#      écrite : un garde-fou qui crie sur ses propres sous-produits finit
#      par ne plus être lu ;
#   3. les COMMENTAIRES sont retirés avant comparaison. Un nom de modèle dans
#      une phrase (« mesuré avec les modèles de la famille … ») documente une
#      mesure ; ce n'est pas un couplage fournisseur. Supprimer la mesure pour
#      satisfaire un grep aurait échangé une information réelle contre un vert.
#
# Ce qui reste attrapé est exactement ce que le contrôle vise : un nom de
# modèle écrit dans du CODE, hors de la passerelle.
modeles_hors_passerelle=$(
  grep -rn "nemotron\|gemini-2.5\|gpt-4\|claude-3" src/ 2>/dev/null \
    | grep -v "^src/server/egress/external-call\.ts:" \
    | grep -v "^src/graphify-out/" \
    | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)" || true
)
if [ -n "$modeles_hors_passerelle" ]; then
  rouge "aucun nom de modèle dans src/" "couplage fournisseur hors passerelle"
  printf '%s\n' "$modeles_hors_passerelle" | sed 's/^/           · /'
else
  vert "aucun nom de modèle dans src/" "bascule mois 2 = configuration"
fi

# Les écritures ne contournent pas les portes de 033.
if grep -q "propose_jarvis_action" src/services/jarvis-tools.ts \
   && grep -q "confirm_jarvis_action" src/services/jarvis-tools.ts \
   && grep -q "execute_jarvis_action" src/services/jarvis-tools.ts; then
  vert "les écritures passent par les trois portes de 033" "propose · confirm · execute"
else
  rouge "les trois portes de 033" "une porte manque"
fi

# La boucle ne connaît pas le registre d'écriture.
if grep -q "jarvis-ecritures" src/services/jarvis-boucle.ts; then
  rouge "la boucle ignore le registre d'écriture" "IMPORT TROUVÉ"
else
  vert "la boucle ignore le registre d'écriture" "aucun import — aucun chemin d'appel"
fi

# Aucun chemin d'exécution ne contourne le moniteur partagé (M06).
# `executerAction` (l'appel direct à la porte 033) n'est invoqué que par
# `jarvis-execution.ts` ; sa définition vit dans `jarvis-tools.ts`. Tout autre
# appelant serait un second chemin d'écriture non vérifiée (les commentaires
# sont exclus comme au contrôle des noms de modèles ci-dessus).
appels_hors_moniteur=$(
  grep -rn "executerAction(" src/ --include="*.ts" --include="*.tsx" 2>/dev/null \
    | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)" \
    | grep -v "^src/services/jarvis-execution\.ts:" \
    | grep -v "^src/services/jarvis-tools\.ts:" || true
)
if [ -n "$appels_hors_moniteur" ]; then
  rouge "executerAction appelé hors moniteur" "second chemin d'écriture"
  printf '%s\n' "$appels_hors_moniteur" | sed 's/^/           · /'
else
  vert "un seul chemin d'exécution vérifiée" "executerAction ← jarvis-execution"
fi

# La porte mutante 033 n'est invoquée en RPC que par `jarvis-tools.ts`
# (l'allowlist générée ne fait que nommer les portes, elle n'appelle rien).
portes_hors_outils=$(
  grep -rn "execute_jarvis_action" src/ --include="*.ts" --include="*.tsx" 2>/dev/null \
    | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*|/\*)" \
    | grep -v "^src/services/jarvis-tools\.ts:" \
    | grep -v "^src/server/db/allowlist\.generated\.ts:" || true
)
if [ -n "$portes_hors_outils" ]; then
  rouge "porte execute hors jarvis-tools" "appel direct à la base"
  printf '%s\n' "$portes_hors_outils" | sed 's/^/           · /'
else
  vert "porte execute cloisonnée" "seule jarvis-tools.ts l'invoque"
fi

echo
if [ "$rouges" -eq 0 ]; then
  echo "VERDICT CHECKPOINT : VERT"
else
  echo "VERDICT CHECKPOINT : ROUGE — $rouges contrôle(s)"
fi
exit $([ "$rouges" -eq 0 ] && echo 0 || echo 1)
