#!/usr/bin/env bash
# preflight — les règles de CLAUDE.md qui peuvent devenir un grep le sont devenues.
# Toute sortie non vide = ne pas commiter. C'est un fait, pas une opinion.
fail=0

# 1 — aucune sortie réseau hors passerelle
#
# Exemption NOMMÉE (V-JARVIS-CORE) : `src/services/db/supabase.ts` appelle la
# passerelle Edge DU PROJET (`${NEXT_PUBLIC_SUPABASE_URL}/functions/v1/…`) en
# flux — le même unique chemin d'accès que ADR-019/020, pas une sortie externe.
# OpenRouter, Groq et ElevenLabs restent derrière `_shared/external-call.ts`,
# seul point de sortie du monde extérieur (règle 1). L'URL vient de
# l'environnement : le littéral `https://` ne peut donc pas s'y trouver —
# l'exemption ne désarme rien aujourd'hui ; elle documente l'intention et fait
# échouer immédiatement tout futur appel direct collé dans l'adaptateur.
out=$(grep -rn "fetch(['\"]https://" --include="*.ts" --include="*.tsx" src/ supabase/ 2>/dev/null \
      | grep -v "_shared/external-call.ts" \
      | grep -v "^src/services/db/supabase\.ts:")
[ -n "$out" ] && { echo "🔴 fetch externe hors passerelle :"; echo "$out"; fail=1; }

# 2 — aucun secret côté client
out=$(grep -rn "SERVICE_ROLE\|GROQ_API_KEY\|OPENROUTER_API_KEY\|SEEKAI_API_KEY\|NEW_API_KEY" src/ 2>/dev/null)
[ -n "$out" ] && { echo "🔴 secret côté client :"; echo "$out"; fail=1; }

# 3 — aucun audio sur disque
out=$(find . -name "*.webm" -o -name "*.wav" -o -name "*.ogg" 2>/dev/null | grep -v node_modules)
[ -n "$out" ] && { echo "🔴 audio sur disque :"; echo "$out"; fail=1; }

# 4 — aucune valeur hex inventée dans le front
# (bloquant : la sortie pose fail=1, l'étiquette le dit maintenant.)
#
# Deux trous fermés en T1.2 :
#   a) le contrôle ne regardait que `*.tsx`. Un `.ts` ou un `.css` portant
#      `#ff0000` passait. Extensions élargies à tout ce qui vit sous src/.
#   b) l'exclusion `grep -v "tokens.css"` portait sur le NOM : n'importe quel
#      `src/components/panel.tokens.css` s'exonérait tout seul. Elle porte
#      désormais sur le CHEMIN EXACT du fichier de jetons, seul autorisé à
#      contenir une valeur littérale (I10).
#   c) `{3,8}` était glouton et tirait sur `// voir ticket #12345` : un
#      contrôle bruyant finit désactivé, donc protège moins. Le motif énumère
#      désormais les seules longueurs qu'une couleur CSS peut avoir (3, 4, 6, 8).
#   d) le contrôle ne regardait que `src/`. Or les fichiers où une valeur en dur
#      a le PLUS d'effet sont à la RACINE : `tailwind.config.ts` est le thème du
#      système entier, et les règles I10 d'ESLint étaient alors attachées à
#      `src/**/*.ts(x)` — la racine n'était couverte par rien. Un
#      `night: { bg: "#0A1413" }` rétabli en dur y passait les quatre portes.
#      → recherche sur tout le dépôt. `.json` inclus : `resolveJsonModule` est
#      actif, un `src/theme.json` est donc importable par un composant.
#      ATTENTION — la fermeture par ce contrôle est PARTIELLE, et l'avoir
#      présentée comme totale est exactement ce que la 5ᵉ passe a signalé
#      (ROUGE 6). Couverture réelle du motif ci-dessous, à la racine comme
#      ailleurs : hex 6 et 8 chiffres, sans condition ✅ ; hex 3 et 4 chiffres,
#      SEULEMENT avec un contexte de valeur immédiat ⚠️ ; `rgb()/rgba()/hsl()`,
#      JAMAIS ❌. Le reste est rattrapé par ESLint, dont les règles de COULEUR
#      couvrent désormais aussi les fichiers de configuration racine (cf. le
#      bloc `files: ["*.ts", …]` en fin d'`eslint.config.js`). Les deux
#      garde-fous sont complémentaires : ne pas en désarmer un en croyant que
#      l'autre couvre tout.
#   e) l'élargissement (d) portait sur les RÉPERTOIRES, pas sur les EXTENSIONS :
#      `./design.mjs` ou `./root.js` à la racine passaient encore, alors que
#      `postcss.config.js` est réellement chargé par la chaîne CSS et que les
#      règles I10 d'ESLint s'arrêtent à `src/**/*.ts(x)`. → liste complétée.
#   f) `--include` de grep est SENSIBLE À LA CASSE, le système de fichiers de
#      Windows ne l'est pas, et webpack résout `./mod` vers `mod.TS`. Un
#      `src/**/*.TS` portant des couleurs en dur était donc invisible aux
#      contrôles 4 et 6 quater ET à ESLint, tout en étant livré au navigateur.
#      → énumération par `find -iname`, insensible à la casse. Le vecteur
#      lui-même est fermé par le contrôle 6 quinquies plus bas.
#
# LIMITE ASSUMÉE du motif : les formes à 3 et 4 chiffres exigent un contexte de
# valeur (quote, parenthèse, ou `:` de propriété CSS) parce que `#1234` et `#42a`
# sont des références de ticket parfaitement légitimes en commentaire — et un
# contrôle qui crie sur du texte innocent finit désarmé. Conséquence acceptée :
# `border: 1px solid #fff` n'est pas vu, la classe de contexte ne contenant ni
# l'espace ni `[`. Les formes à 6 et 8 chiffres, elles, sont détectées sans
# condition, et `rgb()/rgba()/hsl()` ne sont pas regardés du tout par ce motif.
#
# Ce qui rattrape cette limite, et il faut le savoir avant de toucher au motif :
#   · sous `src/` — ESLint, règles I10 complètes (dimension + couleur), plus le
#     fait que le CSS libre y est interdit hors tokens.css (6 ter) et qu'en
#     TypeScript une couleur s'écrit entre quotes.
#   · à la RACINE — ESLint également, depuis la fermeture de ROUGE 6 : le volet
#     COULEUR de I10 est attaché aux fichiers de config racine. C'est là que
#     `rgba(11,22,20,.05)` dans `tailwind.config.ts` est vu ; pas ici.
# Raffiner ce motif n'est donc PAS le correctif de secours par défaut : élargir
# la classe de contexte ferait revenir le faux positif `#1234`, que la 4ᵉ passe
# a déjà payé une fois.
# `.claude` rejoint la liste d'élagage pour la MÊME raison que `.kilo` : ce sont
# des outils d'agent VENDORÉS, pas la source du produit. Une compétence installée
# le 2026-08-23 y a apporté quelques milliers de lignes de JS tiers truffées de
# `#ffffff`, et la 4ᵉ passe est devenue rouge sans qu'une seule ligne de l'écran
# ait changé. Le contrôle protège le design system du PRODUIT ; élargir son
# élagage aux outils n'affaiblit pas la règle, il lui rend son périmètre.
src_files=$(find . \( -path ./node_modules -o -path ./.git -o -path ./.next -o -path ./.kilo -o -path ./.claude \) -prune -o \
              -type f \( -iname "*.ts" -o -iname "*.tsx" -o -iname "*.css" -o -iname "*.json" \
                         -o -iname "*.js" -o -iname "*.jsx" -o -iname "*.mjs" -o -iname "*.cjs" \
                         -o -iname "*.mts" -o -iname "*.cts" \) -print 2>/dev/null \
            | grep -viE "^\./(pnpm-lock\.yaml|package-lock\.json)$" \
            | grep -viE "^\./src/styles/tokens\.css$")
out=$(printf '%s\n' "$src_files" | grep -v '^$' \
      | while IFS= read -r f; do
          grep -nE "#([0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b|[\"'\`(]#[0-9A-Fa-f]{3,4}\b|:[[:space:]]*#[0-9A-Fa-f]{3,4}\b" "$f" 2>/dev/null \
            | sed "s|^|$f:|"
        done)
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

env_templates=$(find . \( -path ./node_modules -o -path ./.git -o -path ./.next -o -path ./.kilo \) -prune -o \
                -type f \( -name ".env.example" -o -name ".env.sample" -o -name ".env.template" \) -print 2>/dev/null)

# Itération par `read -r` et NON par `for f in $env_templates` : la forme non
# quotée découpe sur l'espace, et ce dépôt vit sous un chemin qui en contient un
# (« ABC Informatique »). Un `.env.example` dans un sous-répertoire à espace
# aurait fait chercher grep dans deux fichiers inexistants — contrôle vert, secret
# committé. Le mode de défaillance interdit : un garde-fou qui passe sans regarder.
#
# Le flux entre par `<<<` et NON par un pipe : un `while` en bout de pipe tourne
# dans un SOUS-SHELL, où `fail=1` serait affecté puis perdu à la sortie de la
# boucle. Le script rendrait alors « ✅ preflight vert » en ayant vu la violation.
while IFS= read -r f; do
  [ -n "$f" ] || continue
  # Valeur assignée, avec ou sans `export`, commentée ou non.
  out=$(grep -nE '^[[:space:]]*#*[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=[[:space:]]*[^[:space:]#]' "$f" 2>/dev/null \
        | mask_env_values)
  [ -n "$out" ] && { echo "🔴 valeur renseignée dans $f (gabarit attendu, aucune valeur, même en commentaire) :"; echo "$out"; fail=1; }
done <<< "$env_templates"

# 6 bis — aucun répertoire caché sous src/.
# ESLint saute les répertoires commençant par un point lors de l'expansion de `.`,
# alors que webpack, lui, résout parfaitement `@/lib/.internal/db`. Du code
# applicatif y vivrait hors de portée de I3, I9 et I10. Un lint qui ne voit pas
# un fichier ne le protège pas : on interdit le répertoire, pas le symptôme.
out=$(find src -type d -name ".*" 2>/dev/null)
[ -n "$out" ] && { echo "🔴 répertoire caché sous src/ (invisible au lint) :"; echo "$out"; fail=1; }

# 6 ter — une seule feuille de style dans TOUT le dépôt : src/styles/tokens.css.
# ESLint ne parse pas le CSS : aucune de ses règles I10 ne s'applique à un
# `.css`. T1.2 a créé le premier `.css` du dépôt et, ce faisant, ouvert un
# chemin où couleurs, espacements et durées en dur seraient invisibles au lint.
# Même traitement que les `.mjs/.cts` en T1.1 : on interdit le VECTEUR, on ne
# rattrape pas le symptôme. Un composant se style par classes Tailwind, qui ne
# consomment que des jetons ; il n'a aucun besoin légitime de son propre CSS.
#
# Deux évasions ont été PROUVÉES contre la 1ʳᵉ version de ce contrôle et sont
# fermées ici. Un garde-fou troué rend « preflight vert » plus dangereux
# qu'absent, puisqu'il fait croire à une preuve :
#   a) `styles-probe/theme.css`, HORS `src/` — la 1ʳᵉ version ne cherchait que
#      sous `src/`, alors qu'une feuille voisine s'importe parfaitement depuis
#      `src/app/layout.tsx` par un chemin relatif. Le trou I10 était juste
#      remonté d'un répertoire. → recherche sur tout le dépôt.
#   b) `src/components/panel.pcss` — `.pcss`, `.postcss`, `.styl` n'étaient pas
#      dans la liste. → liste élargie à tout ce que PostCSS/Next sait charger.
#   c) `-name` est sensible à la casse alors que le système de fichiers de
#      Windows ne l'est pas. → `-iname`.
out=$(find . \( -path ./node_modules -o -path ./.git -o -path ./.next -o -path ./.kilo \) -prune -o \
        -type f \( -iname "*.css" -o -iname "*.scss" -o -iname "*.sass" -o -iname "*.less" \
                   -o -iname "*.pcss" -o -iname "*.postcss" -o -iname "*.styl" -o -iname "*.stylus" \) -print 2>/dev/null \
      | grep -viE "^\./src/styles/tokens\.css$")
[ -n "$out" ] && { echo "🔴 feuille de style hors src/styles/tokens.css (hors de portée d'ESLint, I10) :"; echo "$out"; fail=1; }

# 6 quinquies — aucune extension en casse haute sous src/.
# `src/probe/mod.TS` a été livré dans le bundle en passant les QUATRE portes :
# `--include`/`-name` sont sensibles à la casse, NTFS ne l'est pas, et webpack
# résout `./mod` vers `mod.TS`. Les greps de preflight sont désormais en
# `-iname`, mais ESLint, lui, ne matche toujours pas `**/*.TS` : I3, I9 et I10
# resteraient muets sur ce fichier. Élargir chaque glob d'ESLint à toutes les
# variantes de casse serait interminable et se retrouverait troué à la première
# extension oubliée. On interdit donc le vecteur : sous `src/`, une extension
# s'écrit en minuscules. C'est la convention de tout le dépôt, la contrainte ne
# coûte rien, et elle referme la classe entière plutôt qu'un cas.
out=$(find src -type f -name "*.*" 2>/dev/null \
      | while IFS= read -r f; do
          ext="${f##*.}"
          [ "$ext" = "$(printf '%s' "$ext" | tr '[:upper:]' '[:lower:]')" ] || echo "$f"
        done)
[ -n "$out" ] && { echo "🔴 extension en casse haute sous src/ (invisible à ESLint) :"; echo "$out"; fail=1; }

# 6 quater — aucun fichier source ne contient d'octet NUL.
# Le 2026-08-01, `src/app/page.tsx` s'est retrouvé à 50 octets NUL après
# l'interruption d'un agent. `git status` ne l'a PAS signalé : git compare
# taille et stat avant de hasher, et la taille était par coïncidence identique
# à celle de HEAD. Trois portes sur quatre tombaient, et un `git commit -a`
# aurait figé le fichier vide en croyant ne rien toucher.
# Leçon : `git status` n'est pas un contrôle d'intégrité. Celui-ci en est un.
#
# Restreint aux extensions de SOURCE : une image ou une fonte contient des NUL
# tout à fait légitimement. `grep -I` serait ici l'exact contraire du besoin —
# il saute les fichiers binaires, c'est-à-dire précisément ceux qu'on traque.
#
# La détection passe par `tr -d '\0'` et une comparaison de taille, PAS par
# `grep $'\x00'` : bash ne peut pas transporter un octet NUL dans un argument,
# `$'\x00'` s'y réduit à la chaîne VIDE, et grep matche alors TOUS les fichiers.
# La 1ʳᵉ version de ce contrôle faisait exactement cela — elle signalait les 43
# fichiers du dépôt. Un garde-fou qui crie sur tout est un garde-fou qu'on
# désactive : le faux positif total est un mode de défaillance, pas un détail.
#
# La 2ᵉ version énumérait `git ls-files`, donc les seuls fichiers SUIVIS. Faux
# négatif exact sur le cas qui compte : preflight tourne AVANT le commit, où un
# fichier neuf est par définition non suivi. `src/i18n/fr.ts` et
# `src/styles/tokens.css` — les deux livrables de ce lot — étaient hors de
# portée du contrôle censé les protéger, et `git status` repliait `src/i18n/`
# en une seule ligne, la cécité même qui avait produit la corruption de
# `page.tsx`. → énumération par `find`, suivis ET non suivis. `git ls-files`
# reste ajouté pour attraper un fichier suivi qui aurait disparu du disque.
out=$( { find . \( -path ./node_modules -o -path ./.git -o -path ./.next -o -path ./.kilo \) -prune -o \
           -type f \( -iname "*.ts" -o -iname "*.tsx" -o -iname "*.js" -o -iname "*.mjs" \
                      -o -iname "*.cjs" -o -iname "*.css" -o -iname "*.json" -o -iname "*.md" \
                      -o -iname "*.sh" -o -iname "*.yaml" -o -iname "*.yml" \) -print 2>/dev/null \
           | sed 's|^\./||'
         git ls-files -- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.css' '*.json' '*.md' '*.sh' '*.yaml' '*.yml' 2>/dev/null
       } | sort -u \
      | while IFS= read -r f; do
          [ -f "$f" ] || continue
          if [ "$(tr -d '\0' < "$f" | wc -c)" -ne "$(wc -c < "$f")" ]; then echo "$f"; fi
        done)
[ -n "$out" ] && { echo "🔴 fichier source contenant des octets NUL (écriture avortée ?) :"; echo "$out"; fail=1; }

# 7 — aucun fichier d'environnement réel suivi par git.
out=$(git ls-files 2>/dev/null | grep -E '(^|/)\.env' | grep -vE '\.env\.(example|sample|template)$')
[ -n "$out" ] && { echo "🔴 fichier .env suivi par git :"; echo "$out"; fail=1; }

# 8 — ADR-016 : le garde-fou de la phase cloud n'est ni absent, ni désarmé.
#
# CE QUE CE CONTRÔLE PROUVE, ET RIEN DE PLUS : que le dépôt ne contient pas de
# quoi désarmer le garde-fou, et que la migration qui le pose est bien là. Il ne
# regarde AUCUNE base de données. L'application réelle vit dans Postgres
# (trigger `assert_synthetic`), et c'est `checkpoint-j1a.sh` qui l'éprouve.
# Ne pas lire un vert ici comme « le cloud ne contient pas de donnée réelle » :
# ce contrôle-là ne peut pas être fait par un grep. Sur-déclarer une couverture
# est exactement la faute qui a produit ROUGE 6.
guard="supabase/migrations/016_deployment_guard.sql"

# 8a — l'URL cloud impose la présence de la migration de garde.
if [ -f .env ] && grep -qE '^NEXT_PUBLIC_SUPABASE_URL=https?://' .env 2>/dev/null \
   && ! grep -qE '^NEXT_PUBLIC_SUPABASE_URL=https?://(localhost|127\.0\.0\.1)' .env 2>/dev/null; then
  [ -f "$guard" ] || {
    echo "🔴 ADR-016 : URL Supabase distante, et $guard est absent."
    echo "   Aucune barrière ne s'oppose à l'écriture d'une donnée patient réelle."
    fail=1; }
fi

# 8b — personne ne bascule l'environnement depuis le code applicatif. La bascule
# appartient à la procédure de migration, et à elle seule (ADR-016 §3.1).
out=$(grep -rn "set_deployment_environment" --include="*.ts" --include="*.tsx" src/ 2>/dev/null)
[ -n "$out" ] && { echo "🔴 ADR-016 : bascule d'environnement depuis le front :"; echo "$out"; fail=1; }

# 8c — personne ne désarme le trigger ni ne relâche la RLS ailleurs que dans la
# migration qui les pose.
out=$(grep -rniE "DISABLE TRIGGER (assert_synthetic|deployment_no_direct_write)|DROP TRIGGER (IF EXISTS )?assert_synthetic|DISABLE ROW LEVEL SECURITY" \
        --include="*.sql" --include="*.ts" . 2>/dev/null \
      | grep -v node_modules | grep -v "^\./$guard:")
[ -n "$out" ] && { echo "🔴 ADR-016/I2 : garde-fou ou RLS désarmé hors migration 016 :"; echo "$out"; fail=1; }

# 9 — ADR-019 / ADR-020 : les chemins d'accès aux données restent uniques.
#
# Les trois contrôles ci-dessous doublent ce qu'ESLint applique déjà. Ce n'est
# pas de la redondance décorative : ESLint peut être désarmé par un fichier de
# configuration dans le même commit que la violation, et une revue lit rarement
# les deux. Un grep ne se désarme pas depuis le code qu'il inspecte.

# 9a — un seul fichier importe Supabase (ADR-020).
adapter="src/services/db/supabase.ts"
out=$(grep -rln "@supabase/supabase-js\|@supabase/ssr" --include="*.ts" --include="*.tsx" src/ 2>/dev/null \
      | grep -v "^$adapter$")
[ -n "$out" ] && { echo "🔴 ADR-020 : import Supabase hors de $adapter :"; echo "$out"; fail=1; }

# 9b — la table `patients` n'est jamais requêtée en direct (ADR-019).
# Depuis la migration 017, `SELECT` y est révoqué : un accès direct ne rend pas
# une liste vide, il rend 42501. Ce contrôle attrape l'erreur à l'écriture
# plutôt qu'en consultation.
out=$(grep -rnE "relation:[[:space:]]*[\"']patients[\"']|from\([\"']patients[\"']\)" \
        --include="*.ts" --include="*.tsx" src/ 2>/dev/null)
[ -n "$out" ] && {
  echo "🔴 ADR-019 : lecture directe de app.patients (audit contourné) :"; echo "$out"
  echo "   Passer par app.get_patient / app.search_patients (src/services/patients.ts)."; fail=1; }

# 9c — l'agenda passe par la vue, jamais par la table brute.
# La vue n'est PAS le garde-fou (c'est ADR-017 qui protège le motif), mais
# requêter la table brute signale un développeur qui n'a pas lu pourquoi la vue
# existe — et c'est là que les erreurs de colonne clinique commencent.
out=$(grep -rnE "relation:[[:space:]]*[\"']appointments[\"']|from\([\"']appointments[\"']\)" \
        --include="*.ts" --include="*.tsx" src/ 2>/dev/null)
[ -n "$out" ] && { echo "🔴 ADR-017 : app.appointments requêtée au lieu de appointments_admin :"; echo "$out"; fail=1; }

# 9d — aucun identifiant patient dans le journal applicatif (règle 1, I5).
# `LogFields` est une interface FERMÉE : rajouter `patientId` compile, et c'est
# précisément le problème — la faute redevient possible d'une seule ligne. La
# règle 1 nomme `patient_id` parmi les données qui ne quittent jamais la
# machine, « pas vers un log ». Un UUID qui désigne une personne dans un cabinet
# de quelques centaines de dossiers EST identifiant, recoupé avec un agenda.
# La trace nominative légale a son endroit : `audit.log`, en base, en ajout seul.
#
# ⚠️ ON DÉPOUILLE LES COMMENTAIRES. Sans ça, ce contrôle mord sur le paragraphe
# de `log.ts` qui explique justement pourquoi le champ a été retiré — quatrième
# garde-fou de ce dépôt à tomber dans ce piège. Un garde-fou qui crie à tort
# finit désactivé, donc protège moins. (Le contrôle 2, les secrets, reste
# volontairement NON dépouillé : qu'il morde dans un commentaire est une
# qualité, c'est ce qui attrape une clé collée « juste pour tester ».)
out=$(sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' \
          src/services/log.ts 2>/dev/null | grep -nE "patientId")
[ -n "$out" ] && {
  echo "🔴 I5 : patientId réintroduit dans le journal applicatif :"; echo "$out"
  echo "   La trace nominative va dans audit.log, jamais dans un log applicatif."; fail=1; }

out=$(grep -rnE "log\.(info|warn|error)\([^)]*patientId" --include="*.ts" --include="*.tsx" src/ 2>/dev/null)
[ -n "$out" ] && { echo "🔴 I5 : patientId passé à un appel de journalisation :"; echo "$out"; fail=1; }

# 10 — V1.1 : "inattendu" n'est un code terminal nulle part hors de sa
# déclaration. Il vit légitimement dans `src/services/errors.ts` (le type
# `AppErrorCode` et le dernier recours interne de `toAppError`) et dans
# `src/i18n/fr.ts` (la traduction). Ailleurs, c'est un aveu, pas un
# diagnostic — SPRINT-V1 §V1.1.
#
# Un grep littéral à zéro occurrence est impossible : le mot existe dans les
# deux fichiers autorisés. Le contrôle exécutable est donc « zéro occurrence
# EN CODE hors des deux fichiers autorisés » — dépouillé des commentaires,
# même raison qu'au contrôle 9d : deux commentaires de prose (`finance.ts`,
# `db/supabase.ts`) mentionnent le mot sans jamais l'utiliser comme valeur.
out=$(find src -type f \( -iname "*.ts" -o -iname "*.tsx" \) 2>/dev/null \
      | grep -v "^src/services/errors\.ts$" \
      | grep -v "^src/i18n/fr\.ts$" \
      | while IFS= read -r f; do
          sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' "$f" 2>/dev/null \
            | grep -nE '"inattendu"' | sed "s|^|$f:|"
        done)
[ -n "$out" ] && {
  echo "🔴 V1.1 : \"inattendu\" utilisé comme code hors de errors.ts/fr.ts :"; echo "$out"
  echo "   Chaque échec porte sa cause réelle (technical + context), jamais un aveu générique."; fail=1; }

[ $fail -eq 0 ] && echo "✅ preflight vert"
exit $fail
