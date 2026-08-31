#!/usr/bin/env bash
# preflight — les règles de CLAUDE.md qui peuvent devenir un grep le sont devenues.
# Toute sortie non vide = ne pas commiter. C'est un fait, pas une opinion.
fail=0

# 1 — LE POINT DE SORTIE UNIQUE (ADR-001 / phase 5, remplace la version cloud)
#
# ═══ POURQUOI CE CONTRÔLE A CHANGÉ DE NATURE ══════════════════════════════
#
# L'ancienne version cherchait `fetch("https://` dans `src/` et `supabase/`,
# avec une exemption nommée pour `src/services/db/supabase.ts`. Elle reposait
# sur deux hypothèses qui ne tiennent plus :
#   · la passerelle vivait dans `supabase/functions/`, donc AUCUN appel réseau
#     n'était légitime dans `src/` ;
#   · une sortie s'écrivait forcément avec un littéral `https://`.
#
# La seconde était déjà fausse : `fetch(url)` où `url` est calculée passait
# sous le radar. La première ne l'est plus depuis que la passerelle a été
# portée dans `src/server/egress/`.
#
# Le mécanisme PRINCIPAL est désormais la règle ESLint
# `local/no-fetch-hors-passerelle`, qui ferme par le CHEMIN DU FICHIER — la
# seule chose qu'un contrôle statique puisse réellement décider — et couvre
# donc `fetch(url)` comme `fetch("https://…")`.
#
# Ce qui suit est le SECOND FILET, et il ajoute deux choses qu'ESLint ne fait
# pas : il vérifie que la passerelle EXISTE (on ne désarme pas un garde-fou en
# supprimant son sujet), et il ne peut pas être éteint par un fichier de
# configuration.

# 1a · la passerelle doit exister. Sans ce contrôle, supprimer le fichier
#      rendrait la règle ESLint sans objet et le préflight silencieux.
PASSERELLE="src/server/egress/external-call.ts"
[ -f "$PASSERELLE" ] || {
  echo "🔴 la passerelle de sortie a disparu : $PASSERELLE"
  echo "   Sans elle, plus rien ne borne les appels externes (règle 1)."; fail=1; }

# 1b · aucun littéral d'URL externe hors de la passerelle. Ce motif est plus
#      large que l'ancien : il attrape `fetch(`, mais AUSSI une URL externe
#      écrite n'importe où dans src/ (constante, tableau de fournisseurs).
#      `supabase/functions/` reste couvert tant que le dossier existe : il
#      disparaît en phase 6.
out=$(grep -rnE '"https?://' --include="*.ts" --include="*.tsx" src/ 2>/dev/null       | grep -v "^src/server/egress/external-call\.ts:"       | sed -e 's|//.*$||' | grep -E '"https?://'       | grep -viE 'invalid\.local|example\.(com|org)|schema|w3\.org|localhost')
[ -n "$out" ] && { echo "🔴 URL externe hors passerelle :"; echo "$out"; fail=1; }

# 1c · la règle ESLint est-elle toujours ARMÉE ? Elle a déjà été neutralisée
#      une fois par un doublon de clé `rules:` — en JavaScript, la seconde
#      écrase la première, sans erreur. Mesuré : une sonde `fetch("https://…")`
#      passait le lint sans un mot. On vérifie donc sa présence.
grep -q "local/no-fetch-hors-passerelle" eslint.config.js || {
  echo "🔴 la règle ESLint du point de sortie unique a disparu d'eslint.config.js."
  echo "   Le mécanisme principal est désarmé ; le grep seul ne suffit pas."; fail=1; }

# 2 — AUCUN SECRET CÔTÉ CLIENT (ADR-001 / phase 5, contrôle renforcé)
#
# ═══ POURQUOI CE CONTRÔLE A DÛ CHANGER, ET POURQUOI IL EST PLUS FORT ═══════
#
# L'ancienne version refusait tout nom de clé de fournisseur n'importe où dans
# `src/`. Elle reposait sur une prémisse devenue fausse : « `src/` est du code
# navigateur ». C'était vrai tant que la passerelle vivait dans
# `supabase/functions/` ; depuis le portage, elle est dans
# `src/server/egress/`, et `src/server/**` ne traverse JAMAIS vers le client.
#
# Assouplir en retirant simplement `src/server/` du grep aurait affaibli le
# contrôle. On le remplace donc par un contrôle en DEUX temps, dont le second
# est bien plus fort que tout ce qui existait :
#
#   2a · les noms de clés n'apparaissent QUE dans `src/server/**` ;
#   2b · le PAQUET NAVIGATEUR CONSTRUIT ne contient ni les noms, ni les
#        VALEURS des secrets. C'est la vérification qui compte vraiment : elle
#        ne raisonne pas sur l'intention du code, elle lit ce qui est livré.

SECRETS_NOMS="SERVICE_ROLE|GROQ_API_KEY|OPENROUTER_API_KEY|SEEKAI_API_KEY|NEW_API_KEY|ELEVENLABS_API_KEY|MINDCARE_DATABASE_URL"

# 2a · hors de `src/server/**`, ces noms n'ont rien à faire dans src/.
out=$(grep -rnE "$SECRETS_NOMS" src/ 2>/dev/null | grep -v "^src/server/")
[ -n "$out" ] && {
  echo "🔴 nom de secret hors de src/server/ :"; echo "$out"
  echo "   Seul src/server/** est garanti de ne pas traverser vers le navigateur."; fail=1; }

# 2b · le paquet livré. Ne s'exécute que si un build existe — sinon on le DIT,
#      au lieu de laisser croire que le contrôle a été fait.
if [ -d .next/static ]; then
  out=$(grep -rlE "$SECRETS_NOMS" .next/static/ 2>/dev/null)
  [ -n "$out" ] && {
    echo "🔴 nom de secret DANS LE PAQUET NAVIGATEUR :"; echo "$out"; fail=1; }

  # Les VALEURS, en aveugle : on ne les affiche jamais, on ne rend que le nom
  # de la variable dont la valeur a fuité. Personne n'a besoin de lire le
  # secret pour savoir qu'il est publié.
  if [ -f .env ]; then
    while IFS= read -r ligne; do
      nom=${ligne%%=*}
      valeur=${ligne#*=}
      # On ignore les valeurs courtes ou vides : elles produiraient des faux
      # positifs (« true », « cloud ») sans rien prouver.
      [ ${#valeur} -lt 16 ] && continue
      case "$nom" in
        *KEY|*SECRET|*PASSWORD|*TOKEN|*DATABASE_URL)
          if grep -rqF -- "$valeur" .next/static/ 2>/dev/null; then
            echo "🔴 la VALEUR de $nom se trouve dans le paquet navigateur."; fail=1
          fi ;;
      esac
    done < <(grep -vE "^\s*#|^\s*$" .env 2>/dev/null)
  fi
else
  echo "ℹ️  contrôle 2b non exécuté : aucun build dans .next/static (lancer pnpm build)."
fi

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

# 11 — ADR-001 / phase 2 : l'identité reste de portée TRANSACTION.
#
# ═══ POURQUOI CE CONTRÔLE EST STATIQUE ALORS QU'UN TEST SERAIT PLUS FORT ═════
#
# Il l'est parce que le test, lui, NE MORD PAS — mesuré, pas supposé.
# `tests/integration/identite-pool.test.ts` a été relancé après avoir remplacé
# `SET LOCAL ROLE` par `SET ROLE` et `set_config(…, true)` par `false` : les 7
# tests sont restés VERTS. La raison est le `DISCARD ALL` du `finally`, qui
# efface aussi les réglages de portée SESSION avant de rendre la connexion au
# pool. Le comportement observable est donc identique dans les deux cas, et
# aucun test de bout en bout ne peut distinguer le verrou 1 du verrou 3.
#
# La conséquence à retenir : la sécurité reposerait alors ENTIÈREMENT sur
# `DISCARD ALL`, sans que personne ne l'ait décidé ni ne s'en aperçoive. Le
# défaut ne se verrait qu'au premier chemin qui contourne le `finally`.
#
# D'où un contrôle de TEXTE, qui est le seul endroit où la différence existe.
# Il ne remplace pas les tests : il couvre exactement ce qu'ils ne peuvent pas
# voir. La propriété SQL elle-même (« l'identité ne survit pas à sa
# transaction ») reste prouvée EN BASE par scripts/checkpoint-pg-local.sh.
ENVELOPPE="src/server/db/withCaller.ts"
if [ -f "$ENVELOPPE" ]; then
  # a) les deux formes de portée transaction doivent être présentes.
  grep -q "SET LOCAL ROLE" "$ENVELOPPE" || {
    echo "🔴 phase 2 : $ENVELOPPE ne pose plus le rôle par SET LOCAL ROLE."
    echo "   Le rôle survivrait à la transaction et servirait la requête suivante."; fail=1; }
  grep -q "set_config('request.jwt.claim.sub', \$1, true)" "$ENVELOPPE" || {
    echo "🔴 phase 2 : $ENVELOPPE ne pose plus l'identité en portée transaction."
    echo "   Le 3ᵉ argument de set_config doit être 'true' (SET LOCAL)."; fail=1; }

  # b) et aucune forme de portée SESSION ne doit apparaître. On dépouille les
  #    commentaires : ce fichier PARLE abondamment de `SET` pour expliquer le
  #    danger, et un contrôle qui crie sur sa propre documentation finit
  #    désarmé (même motif que les contrôles 9d et 10).
  out=$(sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' "$ENVELOPPE" 2>/dev/null \
        | grep -nE '"SET ROLE|set_config\([^)]*, *false *\)')
  [ -n "$out" ] && {
    echo "🔴 phase 2 : réglage de portée SESSION dans $ENVELOPPE :"; echo "$out"
    echo "   Une identité de portée session fuit vers la requête suivante du pool."; fail=1; }

  # c) le pool ne s'emprunte que d'ici. ESLint le dit déjà ; on le redit en
  #    grep parce qu'une règle ESLint s'éteint par un fichier de configuration,
  #    et que ce chemin-là mérite deux serrures.
  #    `import type … from "pg"` est EXCLU, et ce n'est pas une complaisance :
  #    un import de type est effacé à la compilation, n'embarque rien dans le
  #    paquet et n'ouvre aucune connexion. `pgPort.ts` a besoin de
  #    `QueryResultRow` pour typer ses lignes. Ce qu'on traque est l'accès à une
  #    CONNEXION — donc `obtenirPool()` et les imports de VALEUR.
  out=$(grep -rn "obtenirPool()\|from \"pg\"\|from 'pg'" --include="*.ts" --include="*.tsx" src/ 2>/dev/null \
        | grep -v "^src/server/db/pool\.ts:" \
        | grep -v "^src/server/db/withCaller\.ts:" \
        | grep -vE ':[0-9]+:import type ')
  [ -n "$out" ] && {
    echo "🔴 phase 2 : le pool PostgreSQL est emprunté hors de withCaller :"; echo "$out"
    echo "   pg ne réinitialise pas une connexion : elle porterait l'identité précédente."; fail=1; }
fi

# 12 — ADR-001 / phase 3 : `withAuthGate` reste confinée au chemin d'authentification.
#
# `withAuthGate()` ouvre une transaction SANS endosser de rôle : elle reste sous
# `mindcare_app`, à qui 070 §5 accorde EXECUTE sur les quatre portes
# d'authentification. C'est légitime là, et seulement là — ces portes doivent
# tourner AVANT qu'une identité existe.
#
# Ailleurs, ce serait la fuite exacte que la phase 2 ferme : une requête de
# données passée par cette enveloppe ne poserait ni rôle ni identité, donc
# `auth.uid()` rendrait NULL et la RLS ne filtrerait sur RIEN. Aujourd'hui elle
# échouerait en `permission denied` (mindcare_app est NOINHERIT et n'a aucun
# privilège de table) — mais cette protection tient à un attribut de rôle, pas à
# l'intention. Si `mindcare_app` recevait un jour le moindre GRANT de table, le
# garde-fou tomberait sans bruit. On ferme donc aussi par le chemin d'appel.
GARDE="src/server/db/withCaller.ts"
if [ -f "$GARDE" ]; then
  # Commentaires dépouillés, même motif qu'aux contrôles 9d, 10 et 11b : ces
  # fichiers PARLENT de `withAuthGate` pour expliquer pourquoi ils ne s'en
  # servent pas, et un contrôle qui crie sur sa propre documentation finit
  # désarmé. Mesuré : sans ce dépouillement, `sign-in/route.ts` déclenchait le
  # rouge pour une phrase d'en-tête.
  out=$(find src -type f \( -iname "*.ts" -o -iname "*.tsx" \) 2>/dev/null         | grep -v "^src/server/db/withCaller\.ts$"         | grep -v "^src/server/auth/"         | while IFS= read -r f; do
            sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' "$f" 2>/dev/null               | grep -n "withAuthGate" | sed "s|^|$f:|"
          done)
  [ -n "$out" ] && {
    echo "🔴 phase 3 : withAuthGate appelée hors du chemin d'authentification :"; echo "$out"
    echo "   Cette enveloppe n'endosse aucun rôle : la RLS ne filtrerait sur rien."; fail=1; }

  # Le cookie de session ne doit jamais quitter le pot de cookies. `signIn` rend
  # `{ userId }` et rien d'autre — c'est ce qui permet à DbPort de garder la
  # signature qu'il avait du temps de Supabase.
  out=$(grep -rn "jeton" --include="route.ts" src/app/api/auth/ 2>/dev/null         | grep -E "NextResponse\.json|data:"         | grep -v "^[^:]*:[0-9]*: *//"         | grep -v "session\.jeton, optionsCookie")
  [ -n "$out" ] && {
    echo "🔴 phase 3 : un jeton de session apparaît dans un corps de réponse :"; echo "$out"
    echo "   Le jeton part en cookie httpOnly, jamais dans le JSON."; fail=1; }
fi

# 13 — ADR-001 / phase 4 : l'allowlist de la frontière est À JOUR et TOTALE.
#
# `/api/db/rpc` exécute une fonction SQL dont le nom vient du réseau. Sa borne
# est `src/server/db/allowlist.generated.ts`, DÉRIVÉE des appels réels de
# `src/services/**`. Une liste tenue à la main dérive dans les deux sens, et le
# sens dangereux ne produit aucun symptôme : un nom qui reste ouvert alors que
# plus personne ne l'appelle.
#
# Le générateur ÉCHOUE si un `db().rpc()` reçoit un nom non littéral — c'est ce
# qui rend l'extraction totale plutôt que « ce qu'on a su lire ». Ce contrôle
# relaie donc deux garanties d'un coup : la liste est à jour, ET elle est
# complète.
if [ -f scripts/gen-db-allowlist.mjs ]; then
  out=$(node scripts/gen-db-allowlist.mjs --check 2>&1) || {
    echo "🔴 phase 4 : allowlist de la frontière de données périmée ou incomplète :"
    printf '%s
' "$out" | sed 's/^/   /'
    fail=1; }
fi

[ $fail -eq 0 ] && echo "✅ preflight vert"
exit $fail
