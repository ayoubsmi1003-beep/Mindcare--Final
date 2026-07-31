# STATE — MindCare OS
Dernière mise à jour : 2026-07-31 · Phase 1, tâche T1 (Fondations)

> 🟠 **LIRE EN PREMIER — dérogation active à ADR-001.**
> Un projet **Supabase Cloud** (`fnrcxlewbuqgpgykwfwg`) sert d'environnement de développement.
> Autorisé le 2026-07-31 **sous condition stricte : aucune donnée patient, jamais.**
> Le jour où une donnée réelle y entre, la dérogation tombe et l'infraction est caractérisée
> (ADR-001, I13, I4, Loi 18-07). Détail et condition de sortie : § Dérogation ADR-001.

## Fait & vert
- [x] Ingestion du corpus (16 documents, ~290 Ko) · 24 contradictions relevées, 11 divergences
      HTML ↔ documents. Trace complète dans le plan de session.
- [x] `WORKING-CONTEXT.md` — **9 994 octets** (plafond 10 Ko). 20/20 invariants, 25 tokens
      couleur, 3 litiges. Seul contexte reçu par les agents.
- [x] `.claude/agents/` — 5 agents : `services-builder`, `ui-builder` (Sonnet 5),
      `security-reviewer` (Opus 5), `checkpoint-runner`, `scribe` (Sonnet 5).
- [x] `.claude/commands/` — `/task`, `/checkpoint`, `/preflight`, `/handoff`. **Actives.**
- [x] `.claude/settings.json` — deny-list + hooks `guard-bash.sh` (PreToolUse Bash) et
      `preflight.sh` (PostToolUse Write|Edit).

## En cours
- **T1.1 — scaffold Next.js : VALIDÉ VERT et COMMITTÉ le 2026-07-31.**
  Les 4 portes sont vertes sur le lot : `pnpm typecheck` · `pnpm lint` · `next build` ·
  `bash scripts/preflight.sh`. `security-reviewer` a rendu **VERT** en 5ᵉ passe, après deux
  verdicts ROUGE successifs (3ᵉ et 4ᵉ). Aucune sonde résiduelle, arbre identique à l'avant-tests.
  Fichiers du lot, toujours non suivis par git : `package.json`, `tsconfig.json`, `next.config.ts`,
  `eslint.config.js`, `tailwind.config.ts`, `postcss.config.js`, `.env.example`,
  `src/app/layout.tsx`, `src/app/page.tsx`, `src/lib/env.ts`, `src/services/`, `src/types/`,
  `pnpm-lock.yaml`, `pnpm-workspace.yaml`.

### Ce qui a été corrigé pour obtenir ce vert (2026-07-31)
Les deux premiers rejets portaient sur un garde-fou I3 en liste noire syntaxique, contournable.
La 3ᵉ passe l'a remplacé par une **résolution réelle de module** (`createRequire().resolve` →
remontée au `package.json` le plus proche → comparaison du champ `name`) : vérité du disque, pas
motif de texte. Vérifié à l'exécution, pas par lecture — un import dynamique en template literal
est capté par ce mécanisme alors que le filet `no-restricted-imports` ne le voit pas.
Trois bloquants restaient, tous fermés **par interdiction du vecteur, jamais par rattrapage du
symptôme** :
1. **Bypass par extension de fichier.** I3/I9/I10 n'étaient attachés qu'à `.ts`/`.tsx` : un
   `src/**/*.js` important Supabase passait `pnpm lint` en silence. Règles étendues à tout le
   JavaScript, et **existence même** d'un fichier `.js/.jsx/.mjs/.cjs/.mts/.cts` interdite sous
   `src/` (sélecteur `Program`). `eslint.config.js` est exclu nominativement — il a un besoin
   légitime de `node:module` pour implémenter I3.
2. **Trous I10.** `style={{ padding: 17 }}` (React sérialise en px) et `rgb()/rgba()/hsl()/hsla()`
   passaient. Deux sélecteurs ajoutés.
3. **`.env.example` invérifiable.** Traité **sans affaiblir** la deny-list `Read(./.env.*)` ni le
   hook `guard-bash.sh` : `preflight.sh` porte un contrôle **aveugle** (#6) qui échoue si une
   variable de gabarit porte une valeur, en n'affichant jamais que le nom et la ligne. Trois
   évasions ont été prouvées contre sa 1ʳᵉ version et corrigées : `export KEY=…`, `# KEY=…`
   (ligne commentée — le vecteur dominant), et les gabarits **hors racine** (`!.env.example` est
   un motif sans slash, donc appliqué par git à tout niveau). Masquage passé de `sed` à
   `awk -F=` pour qu'un motif glouton ne puisse pas recracher un fragment de la valeur.
   Contrôles **#6 bis** (aucun répertoire caché sous `src/` — invisible à ESLint, résolu par
   webpack) et **#7** (aucun `.env` réel suivi par git) ajoutés.
   Corrigés au passage : grep #5 accepte les deux quotes (`from("appointments")` passait), et
   grep #4 est étiqueté 🔴 conformément au `fail=1` qu'il posait déjà.

Chaque correctif a été prouvé par sonde jetable puis la sonde supprimée. Aucun n'a été accepté
sur lecture seule.

## Environnement local — où vivent les valeurs
- **`.env`** (ignoré par git) porte les valeurs réelles : `NEXT_PUBLIC_SUPABASE_URL` et
  `NEXT_PUBLIC_SUPABASE_ANON_KEY` du projet de développement. C'est le fichier que Next lit.
- **`.env.example`** (committé) est un gabarit : noms de variables, **aucune valeur**. Il est
  régénérable depuis `.env` sans lire ni exposer quoi que ce soit :
  `sed -E 's/^([[:space:]]*#*[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*[[:space:]]*=).*/\1/' .env > .env.example`
- 2026-07-31 · Des valeurs réelles se sont retrouvées dans `.env.example` juste avant le commit.
  **Le contrôle #6 de `preflight.sh` les a interceptées**, le `&&` a coupé la chaîne, rien n'est
  parti dans l'historique. C'est le seul garde-fou qui protège ce fichier : la deny-list interdit
  de le lire, donc aucune relecture humaine ou agent n'est possible. Ne pas l'affaiblir.

## 🟠 Dérogation ADR-001 — tranchée le 2026-07-31
**Décision humaine, 2026-07-31 :** le projet Supabase Cloud `fnrcxlewbuqgpgykwfwg` existe, il est
**neuf**, ne contient **aucune donnée patient**, aucune donnée réelle n'y a été importée. Il sert
d'**environnement de développement et de test jusqu'au déploiement local**. Le commit T1.1 est
débloqué sur cette base.

**Portée exacte de la dérogation — ne pas l'élargir par habitude :**
- Autorisé : schéma, migrations, seeds synthétiques, tests, mise au point d'outillage.
- **Interdit, sans exception : toute donnée patient réelle, même « juste pour tester ».** Un nom,
  une date de naissance, un numéro de téléphone suffisent. Il n'y a pas de demi-import.
- ADR-001 n'est **pas** amendé. Ceci est une dérogation temporaire et datée, pas une décision
  nouvelle. La cible reste Supabase auto-hébergé sur le PC du cabinet.

**Condition de sortie :** au déploiement local (Mois 2, arrivée du GPU), le projet cloud est
**révoqué** et `.mcp.json` retiré. À vérifier explicitement à ce jalon, pas à supposer.

**Ce qui reste vrai malgré la dérogation :** `read_only=true` bloque l'écriture, jamais la
lecture. Le canal `database`/`storage` est ouvert hors `_shared/external-call.ts` (I13) et sans
audit (I4). Tant qu'aucune donnée patient n'y vit, c'est sans conséquence — c'est précisément
pourquoi la condition ci-dessus n'est pas négociable.

**`.mcp.json` reste dans `.gitignore`** : `fnrcxlewbuqgpgykwfwg` est un identifiant réel et
durable, il n'a rien à faire dans un historique public. Ignorer le fichier ne le débranche pas.

### Trace du constat initial (2026-07-31, avant arbitrage)
- Apparu en cours de session, sans auteur identifié, hors lot T1.1. Contenu :
  `https://mcp.supabase.com/mcp?project_ref=fnrcxlewbuqgpgykwfwg&read_only=true&features=…database…storage`
  - **Aucun jeton dans le fichier** (auth hors fichier) — sur ce critère il est propre.
  - Mais `mcp.supabase.com` + `project_ref` = **Supabase Cloud**, qu'ADR-001 interdit
    explicitement (« auto-hébergé sur le PC du cabinet. Jamais Supabase Cloud »).
  - `read_only=true` bloque l'écriture, **pas la lecture** — et c'est la lecture qui fait fuir un
    dossier psychiatrique. Canal `database`/`storage` ouvert hors `_shared/external-call.ts`
    (I13) et sans audit (I4). Sous Loi 18-07, le scénario que l'architecture doit rendre impossible.
  - `fnrcxlewbuqgpgykwfwg` est un identifiant réel et durable : committé, il est public à jamais.
  - **Fait :** ajouté au `.gitignore`. **Ignorer un fichier ne le débranche pas** — ce n'est qu'un
    garde-fou contre un `git add -A` distrait.
  - **Attendu de l'humain, avant tout commit :** ce projet cloud existe-t-il ? que contient-il ?
    a-t-il vu de la donnée patient ? doit-il être révoqué ? Interrogé le 2026-07-31, première
    réponse : « je ne sais pas, à vérifier » → commit suspendu. Vérification faite le jour même,
    seconde réponse : projet neuf, aucune donnée patient, usage développement → **dérogation
    accordée** (ci-dessus), commit débloqué.

## Décisions prises (à reporter dans 00-DECISIONS.md)
- **D1 · Autorité** : `00-DECISIONS` > `01-SCHEMA` > `02-SECURITY` > `03`–`06` >
  `MindCare-Domain-*` > `Constitution` > `Features.md` > HTML. Tranche 16 contradictions.
- **D2 · Architecture** : navigateur → Supabase avec `ANON_KEY`, la RLS est la frontière.
  Pas de serveur REST. I3 tenu par une couche `src/services/*` obligatoire.
- **D3 · Périmètre** : T1 → T5, stop après Agenda. `05-BUILD-PLAN`/`06-EXECUTION` = référence,
  pas calendrier.
- **D4 · Non délégué** : migrations, RLS, auth, audit, `ConfirmationGate`, numérotation écrits
  à la main. Pas d'agent `db-migrator`. Modèles `haiku` relevés à Sonnet 5.
- Conséquences de D1 — hors Phase 1 : `invoices` (ADR-010) · `domain_events` ·
  `appointment_requests` · rôle `admin` · cycle d'émission d'ordonnance · consentements
  structurés · détection de risque (ADR-015). Auth = Supabase GoTrue.

## Points ouverts — bloquent T2
- **Q-A** Motif de consultation : la policy assistante accorde `FOR ALL` sur la table
  `app.appointments` ; `reason` n'est protégé que par une vue et une convention de code.
  Contradiction interne à `01-SCHEMA` (§0 contre §5.1). Le test T7 vérifie la vue, jamais la
  table. **La plus lourde du corpus.**
- **Q-B** Audit des lectures : exigé par R6 et I4, implémenté nulle part — un déclencheur
  Postgres ne voit pas les `SELECT`.
- **Q-C** Monnaie : `numeric(10,2) amount_dzd` contre « DZD sans décimales ».
- **Q-D** `01-SCHEMA` §10.1 : les 3 policies `payments` sont `FOR ALL` avec `USING` seul, sans
  `WITH CHECK`. Une praticienne peut insérer un paiement au nom d'une consœur. À corriger par
  moi en migration 011 + ADR-016. Pas d'arbitrage nécessaire.

## Dette assumée, datée
- 2026-07-31 · **I10, objet de styles déclaré hors JSX.** `const s = { padding: 17 };
  <div style={s} />` échappe au sélecteur numérique, scopé à `JSXAttribute[name.name='style']`.
  Scope étroit **délibéré** : un sélecteur large signalerait `{ maxRetries: 3 }` et
  `{ status: 200 }`, et un garde-fou bruyant finit désactivé — ce qui protège moins.
  Arbitré non bloquant pour un lot de fondation (ne peut faire fuir aucune donnée patient).
  **À rouvrir au premier composant qui manipule des objets de style.**
- 2026-07-31 · **Limite structurelle du contrôle #6 de `preflight.sh`.** Un contrôle aveugle en
  forme d'assignation ne peut pas voir un secret en **prose** (`# Clé de service : eyJ…`), ni
  précédé de `;`, `-` ou `//`, ni sous forme `KEY: valeur`. Aucune réécriture du motif n'y
  changera rien. Complément identifié, **non implémenté** : appliquer le contrôle #2
  (`SERVICE_ROLE|GROQ_API_KEY|OPENROUTER_API_KEY`) aussi aux gabarits et non au seul `src/` — il
  ne rend que des noms, donc reste compatible avec la contrainte aveugle.
- 2026-07-31 · **`.mts`/`.cts` ne sont matchés par aucun `files` ESLint ni par l'`include` de
  `tsconfig.json`.** Fermé sous `src/` par interdiction d'existence, sans vérifier si Next les
  bundle : une extension muette sous `src/` ne doit pas exister, qu'elle survive au build ou non.
  **Hors `src/`, la zone reste muette** — à revoir au premier lot qui touche au bundling.
- 2026-07-31 · **STATE.md renvoyait à une décision « D5 » qui n'existe nulle part** (la section
  Décisions ne liste que D1→D4). Référence orpheline, non résolue : soit D5 est à écrire, soit la
  mention est à retirer. Laissée en l'état faute de savoir ce qu'elle désignait.
- 2026-07-31 · **Dérogation à ADR-001** — projet Supabase Cloud en environnement de développement.
  Section dédiée plus haut. Condition de sortie : révocation au déploiement local (Mois 2).
- 2026-07-29 · `Features.md` (module 01 seulement) et la `Constitution` sont en anglais.
  Neutralisé par D1 : aucun agent ne les reçoit en brief. Non corrigé.
- 2026-07-29 · Le mockup `Mindcare OS HTML` n'est pas conforme au design system (palette,
  violet, fontes Google, rouge sur score clinique, scores de risque calculés). Traité comme
  référence de niveau d'exigence, jamais de valeur.
- 2026-07-29 · Checkpoints J0-A / J0-B de `05-BUILD-PLAN` §1 non exécutés (Docker, Supabase,
  réseau, comptes Windows). Requis avant T2.

## Prochaine tâche
~~1. Commit `chore(exec): rétablit l'outillage d'agents et le contexte de travail`~~ → fait, `6606119`
~~2. Redémarrer Claude Code~~ → fait, les 5 agents sont visibles
~~3. `/task T1.1 — scaffold Next.js`~~ → livré et **validé VERT** le 2026-07-31

~~1. Trancher `.mcp.json`~~ → fait le 2026-07-31, dérogation accordée sous condition
~~2. Commit T1.1~~ → voir ci-dessous

1. Commit séparé pour `docs/` (13 documents), puis pour `Mindcare OS HTML.html` et `lOGO.JPG.jpg`.
   Un lot, un commit — décision explicite du 2026-07-31, ne pas les mélanger à T1.1.
2. T1.2 — `src/styles/tokens.css` et `src/i18n/fr.ts`, tous deux annoncés par les commentaires de
   `tailwind.config.ts`, plus les fontes bundlées localement. **`tailwind.config.ts` ne définit
   aucune valeur** : il ne fait que consommer des variables CSS qui n'existent pas encore.
5. Checkpoints J0-A / J0-B (`05-BUILD-PLAN` §1) — Docker, Supabase, réseau, comptes Windows.
   Requis avant T2, toujours non exécutés.
