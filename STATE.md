# STATE — MindCare OS
Dernière mise à jour : 2026-08-03 · **jalon S4 LIVRÉ**, checkpoint VERT 21 · **pas encore
vérifié à l'écran** — voir §« Ce qui reste à faire sur S4 »

## Fait & vert
- 5cd3d3e T1.2 jetons CSS, i18n FR, durcissement I10 → VERT
- 7fcc34d S0 provision scripté `s0-provision.sh` → VERT
- 2fd1acb ADR-016 garde-fou synthétique, Postgres 15 jetable → VERT
- ff5f962 **S1 + ADR-019** — 21 migrations appliquées sur `ftxaseynjvjevwybdoii`
- 47b895d **S2** — couche `DbPort`, services patients/agenda (ADR-020)
- fe444f1 docs — Q-D tranchée
- b7ac4f9 **S3a** — session applicative, compte de développement connectable
- 2e432d8 **S3b** — connexion, coquille, liste et fiche Patients
- 074a306 **S4a** — portes RDV en base, audit de liste (ADR-021), migrations 022 + 023
- 0a695c9 **S4b** — service rendez-vous sur `DbPort`
- 63fadd1 **S4c** — agenda : vue jour, création, modification, annulation

## Portes, toutes rejouées le 2026-08-03 après S4
`preflight` · `typecheck` · `lint` · `build` · **`checkpoint-s4` VERT 21** ·
**`checkpoint-adr019` VERT 24** · `checkpoint-j1a` VERT 14 · `checkpoint-s2` VERT 15 ·
`verify-migrations` VERT 7. Aucune régression sur S1–S3.

**La couche sécurité est gelée.** ADR-019 tient sur `app_gatekeeper` : sans `BYPASSRLS`, membre
de `authenticated` **avec `INHERIT TRUE`**, propriétaire des trois portes. Les policies de `004`
ne sont pas modifiées — c'est tout le design. Y toucher casse la cloison.

## Ce que S3 livre, et qui fonctionne
Connexion · routes protégées · gestion de session · écran de connexion · bouton de déconnexion ·
coquille `AppShell` · navigation composée par rôle · abstraction `DbPort` · `src/services/auth.ts` ·
liste Patients avec recherche · fiche patient · état hors ligne · audit des lectures (I4) ·
automatisation du compte de développement. ADR respectées, aucune réécrite.

## Ce que S4 livre, et qui fonctionne
Agenda du jour et des trente jours suivants · création · modification · annulation · détail d'un
rendez-vous · statuts · sélecteur de praticienne · cinq portes Postgres (ADR-021) · déclencheur de
transitions · `useSessionEcran` extrait. **Aucune ADR réécrite, `DbPort` inchangé.**

## Ce qui reste à faire sur S4
- **Vérification à l'écran NON FAITE.** Le chemin de données est prouvé par 21 contrôles ; le
  rendu ne l'est pas. S3 a été validé à l'écran et c'est là qu'ont surgi quatre défauts que les
  portes n'avaient pas vus. **Ne pas clore S4 avant de l'avoir fait.**
- **Type de consultation absent** — colonne inexistante, liste réelle non fournie. Migration
  isolée d'une quinzaine de lignes le jour où la Dr. Larbi la donne ; colonne **nullable**, aucun
  écran à reconstruire. Même traitement que les ~60 molécules : un état vide est honnête.
- Vue **semaine** non construite (MODULE-MAP la nomme) · file d'attente · `mark_patient_arrived` ·
  validation des demandes web `requested`.

## Le défaut de S4, à ne pas réapprendre
**Dix-neuf contrôles VERTS pendant que `create_appointment` ne créait rien.** Elle butait sur le
garde-fou `is_synthetic` d'ADR-016 — qui faisait exactement son travail. Aucun des dix-neuf
n'exerçait le chemin nominal : les contrôles d'écriture vérifiaient tous un **refus**, et un refus
reste vert quand la fonction échoue pour une tout autre raison. Trouvé en sondant la base à la
main **après** un checkpoint vert, pas par le checkpoint.

**Un checkpoint qui ne teste que ce qui doit échouer ne prouve pas que le reste marche.** Les
contrôles 20 et 21 comblent le trou. À appliquer à tout checkpoint futur : pour chaque refus
vérifié, vérifier le succès correspondant.

Corollaire sur ADR-016, écrit parce qu'il est vrai : `create_appointment` dérive `is_synthetic` de
`app.is_cloud_dev()`, donc **le garde-fou ne bloque plus les écritures de RDV de l'application**
en phase cloud. Ce qui protège encore l'instance n'est pas ce trigger mais l'absence d'écran de
création de dossier patient et la condition 1 d'ADR-016. Ne pas présenter la couverture de 016
comme totale sur les tables où l'application écrit.

## Preuve I4, par le chemin réel de l'écran
Une fiche ouverte = **+1 ligne d'audit, exactement**. Décomposition mesurée : `recherche` 1 ligne
avec `patient_id` NULL (la recherche ne nomme personne), `fiche` 1 ligne par ouverture — y compris
pour un dossier inexistant, puisque `log_read` s'exécute AVANT la lecture et que la TENTATIVE est
ce qu'un audit doit savoir dire.

## Vérification visuelle — FAITE
Connexion fonctionnelle, barre latérale fonctionnelle, **2 patients synthétiques visibles**, liste
chargée correctement, application stable. Le rendu est constaté, plus seulement le chemin de
données.

## Quatre défauts trouvés à l'exécution — à ne pas réapprendre
- **`grep -m1` sur `.env` retient une affectation VIDE.** Le gabarit laissait
  `DEV_ACCOUNT_PASSWORD=` sans valeur ; le script criait « introuvable » alors que le secret était
  présent plus bas, et envoyait ajouter une variable qui existait déjà.
- **GoTrue tombe en HTTP 500 sur des colonnes de jetons à NULL.** `auth.users` porte
  `confirmation_token`, `recovery_token`, `email_change_token_new`, `email_change` ; GoTrue est
  écrit en Go et les lit dans des `string`. Le scan casse **avant** toute vérification du mot de
  passe, et le message ne dit rien. Normalisé dans `dev-account.sh`.
- **`AuthRetryableFetchError` porte `status = 0`, pas `undefined`.** Un garde écrit sur
  `status !== undefined` ne se déclenchait donc jamais — sur le seul chemin pour lequel il avait
  été écrit. Lire la bibliothèque installée, pas sa documentation.
- **`limit 1` sans `ORDER BY` élit une ligne au hasard.** La policy `profiles` rend l'annuaire du
  cabinet entier (3 lignes, mesuré) : `getCurrentUser()` pouvait afficher le nom d'une collègue
  comme compte connecté. Aucune donnée patient ne fuyait, mais l'écran affirmait une identité
  qu'il n'avait pas vérifiée.

## Leçon de fond, valable au-delà de ces quatre cas
**Trois commentaires de ce dépôt affirmaient une propriété que le code ne tenait pas** — dont un
en-tête garantissant qu'aucune sortie ne pouvait reconstituer un mot de passe, alors qu'un chemin
d'erreur l'imprimait en clair. Une affirmation rassurante et fausse est pire qu'un silence : c'est
elle qui empêche le relecteur suivant de regarder. Un commentaire qui déclare une garantie doit
nommer le mécanisme qui la tient, ou dire ce qui reste vrai malgré tout.

Corollaire mesuré ce jour : le lint I10 laisse passer `minmax(240px, 1fr)` (littéral composé) et
`100vh` (unité hors liste). **Un garde-fou est un filet, pas une preuve de conformité.**

## Dette assumée, datée
- D-01 RALLUMÉE — projet fnrcxlewbuqgpgykwfwg (clés compromises) → supprimer + nouveau
- D-04 Transcription Groq absent → 2026-08-13
- D-08 Front assistante absent → 2026-08-13 (la composition de nav existe, l'écran non)
- Sauvegarde non testée → 2026-08-06
- **Compte développeur `…a1` connectable** — ADR-016 amendée. Doit **disparaître** à la migration
  ADR-001 : un compte de développement survivant sur la machine du cabinet serait un accès `owner`
  sur des dossiers réels.
- `pgaudit` en SECOND FILET à la migration auto-hébergée, où le log ne quitte plus le cabinet
- **Limite écrite, à ne pas enjoliver :** un superutilisateur Postgres lit toujours `app.patients`
  en direct. *Effectivement* fermé pour l'application, PostgREST, les edge functions et Jarvis ;
  pas *inviolable*.
- `docker inspect` expose le mot de passe du compte dev pendant la vie du conteneur éphémère.
  Acceptable sur ce poste, inacceptable sur le serveur du cabinet.
- Ordonnances saisies non imprimées · consentements papier → mois 2

## Bloqué, attente humaine
- 7 fontes .woff2 (Geist Sans/Mono · Newsreader · Plex Arabic) — **ne bloque plus** : aucun
  `@font-face` n'est déclaré, les jetons retombent proprement sur `system-ui`. Les ajouter sera un
  changement CSS isolé.
- Logo SVG de cabinet
- Liste des ~60 molécules réellement prescrites → `015` n'en sème AUCUNE, exprès ; les échelles
  sont semées inactives et sans barème pour la même raison (I19)
- PC serveur cabinet (16–32 Go) → déclenche ADR-016 → ADR-001

## Reste à faire
**Tout le clinique.** S4 ajoute l'agenda ; il n'y a toujours aucune création de patient, aucune
consultation, aucune note, aucun document, aucun paiement, aucun Jarvis. Dix des douze écrans du
§5 ne sont pas construits — la coquille les affiche inertes et marqués « Écran à venir » (I19),
pas en liens morts.

## Prochain jalon — S5
**Consultation** (`/consultation/[id]`, tables `consultations` + `clinical_notes`), praticienne
seule. ⚠️ À relire AVANT d'écrire une ligne : I15 — note signée immuable, brouillon 15 min puis
verrou par déclencheur, correction = amendement visible. **Aucun bypass, jamais.** Et I7 : l'IA
décrit, elle ne conclut pas.

Ce que S4 a appris et qui vaut pour S5 : la première voie d'écriture d'une table Tier 0/1
rencontre le garde-fou `is_synthetic` d'ADR-016. Le prévoir, et **dériver** la valeur de
`app.is_cloud_dev()` — jamais l'écrire en dur.

Deux dettes d'écran ouvertes par S3, à traiter quand un besoin réel les justifie, pas avant :
le tableau de bord n'existe pas (la racine redirige vers Patients), et la troisième colonne de
contexte du §3 n'est pas posée — le jeton `--grid-context-width` attend l'écran qui en aura besoin.
