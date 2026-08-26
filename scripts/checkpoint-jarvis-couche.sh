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

# Le scénario M ne consomme pas les services : il éprouve l'enveloppe de
# données de la PASSERELLE (`_shared/routing.ts`), qui tourne sous Deno. Elle
# est sans import, donc compilable seule — on la compile ici plutôt que de la
# retranscrire dans le test, parce qu'un test qui réécrit son sujet ne teste
# que la réécriture.
echo
./node_modules/.bin/tsc supabase/functions/_shared/routing.ts   --outDir .eval-out/edge --module commonjs --target es2022 >/dev/null 2>&1 || true
if node scripts/eval-jarvis-injection.mjs "$(pwd)/.eval-out/edge/routing.js" 2>&1; then
  vert "eval-jarvis-injection (scénario M)" "exit 0"
else
  rouge "eval-jarvis-injection (scénario M)" "au moins un contrôle rouge"
fi

# La frontière de DÉCISION CLINIQUE. Elle vit dans la même fonction pure, elle
# se teste au même endroit — et elle est plus importante que tout le reste de
# ce fichier : c'est la seule qui protège un patient, pas une donnée.
echo
if node scripts/eval-jarvis-routage.mjs "$(pwd)/.eval-out/edge/routing.js" 2>&1 | grep -vE "^  vert "; then
  vert "eval-jarvis-routage (décision clinique)" "exit 0"
else
  rouge "eval-jarvis-routage (décision clinique)" "au moins un contrôle rouge"
fi

echo
if node scripts/eval-jarvis-v2.mjs "$(pwd)/.eval-out/edge/routing.js" >/dev/null 2>&1; then
  vert "eval-jarvis-v2 (ADR-023, non-régression)" "exit 0"
else
  rouge "eval-jarvis-v2 (ADR-023, non-régression)" "au moins un contrôle rouge"
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
# Règle 2 : aucune clé de fournisseur dans le bundle client.
if [ -d .next/static ]; then
  if grep -rq "OPENROUTER\|GROQ\|ELEVENLABS" .next/static/ 2>/dev/null; then
    rouge "aucun secret fournisseur dans .next/static" "OCCURRENCE TROUVÉE"
  else
    vert "aucun secret fournisseur dans .next/static" "0 occurrence"
  fi
else
  printf '  (n/a)  | %-52s | %s\n' "secrets dans .next/static" "pas de build — contrôle non exécuté"
fi

# Le modèle n'est nommé QUE dans la passerelle (couture du mois 2).
if grep -rq "nemotron\|gemini-2.5\|gpt-4\|claude-3" src/ 2>/dev/null; then
  rouge "aucun nom de modèle dans src/" "couplage fournisseur hors passerelle"
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

echo
if [ "$rouges" -eq 0 ]; then
  echo "VERDICT CHECKPOINT : VERT"
else
  echo "VERDICT CHECKPOINT : ROUGE — $rouges contrôle(s)"
fi
exit $([ "$rouges" -eq 0 ] && echo 0 || echo 1)
