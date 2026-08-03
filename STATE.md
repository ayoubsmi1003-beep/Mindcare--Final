# STATE — MindCare OS
Dernière mise à jour : 2026-08-03 · **jalon S3 CLOS**, vérifié à l'écran

## Fait & vert
- 5cd3d3e T1.2 jetons CSS, i18n FR, durcissement I10 → VERT
- 7fcc34d S0 provision scripté `s0-provision.sh` → VERT
- 2fd1acb ADR-016 garde-fou synthétique, Postgres 15 jetable → VERT
- ff5f962 **S1 + ADR-019** — 21 migrations appliquées sur `ftxaseynjvjevwybdoii`
- 47b895d **S2** — couche `DbPort`, services patients/agenda (ADR-020)
- fe444f1 docs — Q-D tranchée
- b7ac4f9 **S3a** — session applicative, compte de développement connectable
- 2e432d8 **S3b** — connexion, coquille, liste et fiche Patients

## Portes, toutes rejouées le 2026-08-03 après la revue adversariale
`preflight` · `typecheck` · `lint` · `build` · **`checkpoint-adr019` VERT 24** ·
`checkpoint-j1a` VERT 14 · `checkpoint-s2` VERT 15 · `verify-migrations` VERT 7.

**La couche sécurité est gelée.** ADR-019 tient sur `app_gatekeeper` : sans `BYPASSRLS`, membre
de `authenticated` **avec `INHERIT TRUE`**, propriétaire des trois portes. Les policies de `004`
ne sont pas modifiées — c'est tout le design. Y toucher casse la cloison.

## Ce que S3 livre, et qui fonctionne
Connexion · routes protégées · gestion de session · écran de connexion · bouton de déconnexion ·
coquille `AppShell` · navigation composée par rôle · abstraction `DbPort` · `src/services/auth.ts` ·
liste Patients avec recherche · fiche patient · état hors ligne · audit des lectures (I4) ·
automatisation du compte de développement. ADR respectées, aucune réécrite.

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
**Tout ce qui vient après la consultation d'un dossier.** S3 s'arrête à la lecture : aucune
création de patient, aucune modification, aucun agenda, aucune consultation, aucune note, aucun
document, aucun paiement, aucun Jarvis. Onze des douze écrans du §5 ne sont pas construits — la
coquille les affiche inertes et marqués « Écran à venir » (I19), pas en liens morts.

## Prochain jalon — S4
**Agenda** : vues jour/semaine sur `src/services/appointments.ts`, déjà écrit et jamais consommé.
⚠️ Deux pièges à relire AVANT d'écrire une ligne :
- Le front assistante requête la vue `app.appointments_admin`, **jamais** la table.
- ADR-017 a sorti `reason` dans `app.appointment_reasons`, **sans aucune policy assistante** — la
  RLS filtre des lignes, pas des colonnes, et c'est pour ça que la vue seule ne protégeait rien.

Deux dettes d'écran ouvertes par S3, à traiter quand un besoin réel les justifie, pas avant :
le tableau de bord n'existe pas (la racine redirige vers Patients), et la troisième colonne de
contexte du §3 n'est pas posée — le jeton `--grid-context-width` attend l'écran qui en aura besoin.
