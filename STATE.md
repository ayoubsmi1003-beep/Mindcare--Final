# STATE — MindCare OS
Dernière mise à jour : 2026-08-04 · **jalon S5 CLOS**, `checkpoint-s5` VERT 29,
**vérifié à l'écran (26 contrôles)** · **prochain jalon : S6 Jarvis**

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
- 1017734 **S4d** — vue semaine, 13 types de consultation (024), approbation (025)
- 8a63ac3 **S5a** — neuf portes séance/note en base (026), `checkpoint-s5`
- 7f81443 **S5b** — service `consultations.ts` sur `DbPort`
- e309246 **S5c** — espace de travail clinique, SOAP, signature, amendement

## Portes, toutes rejouées le 2026-08-04 après S5
`preflight` · `typecheck` · `lint` · `build` · **`checkpoint-s5` VERT 29** ·
**`checkpoint-s4` VERT 25** ·
**`checkpoint-adr019` VERT 24** · `checkpoint-j1a` VERT 14 · `checkpoint-s2` VERT 15 ·
`verify-migrations` VERT. **Aucune régression sur S1–S4.**

**La couche sécurité est gelée.** ADR-019 tient sur `app_gatekeeper` : sans `BYPASSRLS`, membre
de `authenticated` **avec `INHERIT TRUE`**, propriétaire des trois portes. Les policies de `004`
ne sont pas modifiées — c'est tout le design. Y toucher casse la cloison.

## Ce que S3 livre, et qui fonctionne
Connexion · routes protégées · gestion de session · écran de connexion · bouton de déconnexion ·
coquille `AppShell` · navigation composée par rôle · abstraction `DbPort` · `src/services/auth.ts` ·
liste Patients avec recherche · fiche patient · état hors ligne · audit des lectures (I4) ·
automatisation du compte de développement. ADR respectées, aucune réécrite.

## Ce que S4 livre, et qui fonctionne
**Vue semaine** (grille jour × heure, créneaux libres, chiffres d'en-tête, navigation, bascule
jour/semaine, légende) · vue jour · création · modification · annulation · **approbation** ·
détail · **13 types de consultation** · statuts · sélecteur de praticienne · **sept portes
Postgres** (ADR-021) · déclencheur de transitions · `useSessionEcran` extrait.
**Aucune ADR réécrite, aucune policy de 006 modifiée, `DbPort` inchangé.**

## Ce que S5 livre, et qui fonctionne
**Mode séance** (`/consultation/[id]`) · chronomètre · **notes brutes** enregistrées au fil de la
frappe · **éditeur SOAP** · **signature** · **fenêtre de correction de 15 minutes avec décompte** ·
**verrouillage** · **amendement visible sous la note** · fil de séance et aide à la décision posés
et honnêtement vides (I19) · entrée « Démarrer / Reprendre la séance » depuis la fiche rendez-vous.
**Aucune ADR réécrite, aucune policy de 004/007/008 modifiée, `DbPort` inchangé.**

Trois pièces ajoutées dans `src/components/ui/` — pas dans l'écran : `EspaceTravail`,
`SectionPliable`, `IndicateurEnregistrement`. `EspaceTravail` consomme enfin
`--grid-context-width`, déclaré à T1.2 et sans consommateur depuis. **La page est la disposition
DÉFINITIVE de l'espace clinique** : transcription (semaine 2), analyse de séance (S6), ordonnances
et documents (S7) s'ajoutent comme des `SectionPliable`, sans redécoupage.

### 🔴 La faille de S5, trouvée en RELECTURE et non par un contrôle
`start_consultation` acceptait un rendez-vous NULL avec un `p_patient_id` libre, pour couvrir le
patient reçu sans créneau. Or **le `WITH CHECK` de `consultations_clinical` (007) ne porte que sur
`practitioner_id`** — il ne dit rien de `patient_id`. Une praticienne pouvait donc ouvrir une
séance, **puis y écrire une note**, sur le dossier d'une patiente de sa consœur.

Aucune identité ne fuyait : `patients_clinical` (004) masque la ligne et la jointure de
`get_consultation` revenait vide. Mais **ADR-003 n'interdit pas seulement de LIRE** le dossier
d'une consœur — il n'y a pas de patient partagé, donc pas d'écriture non plus. Une note signée par
la mauvaise praticienne est un faux, et l'immuabilité de 008 la rendrait **ineffaçable**.

Le garde ne pouvait pas être « vérifier que le patient est visible » : `SELECT` sur `app.patients`
est révoqué à `authenticated` depuis 017, et la porte est `SECURITY INVOKER`. **Le rendez-vous est
donc devenu obligatoire** — c'est lui qui prouve l'appartenance du dossier. Contrôle 16.

**Leçon : une policy qui protège une colonne ne protège pas les colonnes voisines.** Chercher, pour
chaque nouvelle table écrite, ce que le `WITH CHECK` ne dit PAS.

### Deux pièges de MESURE payés dans `checkpoint-s5.sh`
Aucun des deux n'était un défaut du code — et c'est ce qui les rend coûteux : **un checkpoint qui
rougit à tort envoie corriger ce qui marche**, ce qui est aussi nuisible qu'un checkpoint qui
verdit à tort.
- **Une écriture faite par une fonction appelée DANS une instruction n'est pas visible du `SELECT`
  qui l'englobe** — ni depuis un CTE, dont toutes les branches partagent le même instantané.
  Quatre contrôles rendaient 0 sur des portes parfaitement fonctionnelles. L'identifiant transite
  désormais par une table temporaire, et l'appel est toujours une instruction séparée de sa
  relecture.
- **Un checkpoint ne doit pas dépendre de l'état ambiant.** `one_open_consult` n'autorise qu'une
  séance ouverte par praticienne : une séance laissée ouverte par un essai à l'écran faisait
  échouer SEPT contrôles d'un coup. Chaque transaction referme maintenant les séances ouvertes au
  départ — et elle est annulée, donc rien ne persiste.

### Un DROP de plus, et pourquoi celui-là est sans danger
Retirer un défaut de paramètre impose un `DROP FUNCTION` : `CREATE OR REPLACE` répond « cannot
remove parameter defaults ». `start_consultation` est `SECURITY INVOKER`, donc son propriétaire
n'a **aucun effet de sécurité** — contrairement à 018 et 024/025, où le DROP d'une porte
`SECURITY DEFINER` la réattribuait à `postgres` (`rolbypassrls`) et faisait tomber la cloison avec
une migration VERTE. **Ne pas recopier ce motif sur `app.get_consultation`.**

## S5 — vérification à l'écran : FAITE le 2026-08-04, 26 contrôles VERTS
**Constaté, non déduit** : ouverture de séance depuis l'agenda · notes brutes survivant à un
rechargement · quatre champs SOAP · signature · décompte des 15 minutes · **`lock_after` reculé en
base, puis refus constaté À L'ÉCRAN** avec passage en lecture seule et disparition du bouton
Signer · amendement enregistré, visible, **note d'origine intacte mot pour mot** · « 1 amendement »
au singulier · 1920 · 1280 · **390 sans défilement horizontal, page de 3740px** (contre 7458px en
S4) · **coupure réseau en pleine rédaction : le texte survit verbatim, aucune éjection vers la
connexion** · aucune exception JavaScript.

## Reste ouvert sur S5, non bloquant
- **Pas de séance sans rendez-vous.** Décision de sécurité assumée (ci-dessus) : le patient reçu
  sans créneau demande d'abord un rendez-vous, soit un clic dans l'agenda. Si le cabinet veut la
  séance directe, il faudra une policy `consultations` qui contraigne `patient_id` — pas un
  assouplissement de la porte.
- **Aucune persistance locale.** Une coupure réseau conserve le texte À L'ÉCRAN et le dit
  (`IndicateurEnregistrement` en état d'échec), mais fermer l'onglet perd la saisie non envoyée.
  Ne jamais écrire dans l'interface qu'une saisie est « conservée localement » tant que ce n'est
  pas vrai.
- `transcript_segments` et `live_insights` : tables prêtes, aucune écriture, panneaux vides.
- La base de développement porte désormais des séances et des notes de vérification synthétiques.

## S4 — vérification à l'écran : FAITE le 2026-08-04 (commits 3dfaf0d, 3ce96bc)
Playwright est désormais en `devDependency` et fait partie du processus : les portes prouvent un
chemin de données, jamais un rendu. **Constaté, non déduit** : semaine · jour · création · fiche ·
nom très long · deux séances au même créneau · 1920 · 1280 · 390 · vide · hors ligne · erreur.

Empilement au même créneau : aucune séance masquée. Créneau sans dossier : « Aucun dossier
rattaché ». **Coupure réseau en pleine saisie : la session TIENT, le texte déjà tapé survit
verbatim, aucune éjection vers la connexion.**

### 🔴 Le défaut de S4, celui que 25 contrôles ne pouvaient pas voir
**La grille MASQUAIT des séances.** Elle rangeait chaque entrée dans une case `jour-heure` puis ne
rendait que les heures de la journée de travail (08–19). Un rendez-vous à 21:47 ne trouvait aucune
cellule et DISPARAISSAIT : pas d'erreur, pas de compteur, et un en-tête de colonne affichant
« 0 séances » sur un lundi qui en portait deux. Mesuré : **six séances annoncées, quatre rendues.**
Masquer une séance, c'est manquer un patient ou provoquer un double booking.

Les compteurs se calculaient à part, **sous un commentaire affirmant qu'ils montraient « ce que la
grille montre réellement »** — la garantie fausse en commentaire, encore. Placement, bornes et
comptage sortent maintenant d'UNE fonction, `repartition()`, lue par la grille ET par l'écran.

### Trois autres défauts trouvés à l'écran, aucun visible au lint
- **`1 séances`** — le français accorde à partir de deux ; « 0 séance » reste au singulier.
- **Mobile inutilisable** — nav à 248px FIXES à toute largeur : sur 390px la grille se brisait à
  une lettre par ligne, page de 7458px. Coquille à une colonne sous 1024px + grille défilante
  (2739px après). ⚠️ **Écart assumé** avec §3 « nav → icônes » : aucun jeu d'icônes n'existe.
- **Le nom sur trois lignes** — le monogramme mangeait un quart d'une colonne de 140px pour une
  lettre déjà présente à côté. Retiré de la grille, gardé sur la fiche.

### 🔴 Troisième occurrence du piège « lire la bibliothèque, pas la doc »
**Une coupure réseau s'annonçait « Une erreur inattendue s'est produite ».**
`postgrest-js@2.110.9` `src/PostgrestBuilder.ts:443-455` retourne `code: ""` — la **chaîne vide**,
pas `undefined` — et **aucun champ `name`** (le transport est préfixé dans `message`). La sortie
`raw.code !== undefined` rendait la branche hors-ligne **inatteignable pour tout appel de
données**, c'est-à-dire tous les écrans métier. Après `status = 0` sur auth-js, c'est le même piège
sur un autre champ. **Toute nouvelle détection d'erreur se vérifie dans `node_modules`.**

## Design system — posé, l'Agenda est l'implémentation de référence
`src/components/ui/` : `Bouton`/`LienBouton`/`BarreActions` · `Carte`/`Section`/`EnTetePage`/
`PanneauInfo`/`GrilleChamps` · `Badge`/`Chiffre` · `ChampTexte`/`ChampSelection`/`ChampZoneTexte` ·
`BandeauHorsLigne`/`BlocErreur`/`EtatVide`/`Squelette`/`Champ`. Import unique `@/components/ui`.

**S5 et la suite COMPOSENT à partir de ces pièces.** Une pièce qui manque s'ajoute LÀ, jamais dans
l'écran qui en a besoin. `ChampZoneTexte` porte déjà `clinique` (échelle `notes`, 15/1.7) pour les
champs SOAP.

**Classes Tailwind, pas styles en ligne** : survol, focus et transition n'existent pas en style en
ligne, et **le préflight 6 ter n'admet qu'UNE feuille CSS dans tout le dépôt** (`tokens.css`) —
ne pas en créer une seconde. Jetons ajoutés : `--grid-day-min`, `min-w-card`, `border-kind`,
`grid-cols-app`/`grid-cols-fiche`, animation `respire`. **Aucune valeur littérale** : le lint
refuse les valeurs arbitraires Tailwind (`transition-[…]` a été rejeté, `transition` l'a remplacé).

⚠️ **Un changement de `tailwind.config.ts` exige un redémarrage du serveur de dev** — sans quoi une
nouvelle clé de thème n'est pas générée et le correctif paraît sans effet à l'écran.

## Reste ouvert sur S4, non bloquant
- La grille place à l'heure PLEINE : une séance de 14:30 n'occupe pas deux lignes et ne s'étale pas
  sur sa durée. La carte affiche la plage `14:30 – 15:00`, donc rien n'est faux ni caché — mais le
  placement à la minute reste à faire le jour où le cabinet le demandera.
- `.env` porte **DEUX** lignes `DEV_ACCOUNT_PASSWORD` (12 et 32 caractères). `dev-account.sh`
  prend délibérément la DERNIÈRE non vide (`tail -n 1`). Tout outil qui prend la première se voit
  refuser la connexion sans que rien ne dise pourquoi. À élaguer.
- **La file « Demandes en attente » est VIDE, et c'est exact.** `create_appointment` écrit
  `confirmed` : un rendez-vous saisi au cabinet est approuvé par le geste qui le crée. L'état
  `requested` vient de l'accueil QR, non construit. **Décision d'organisation en attente :** si le
  cabinet veut qu'un RDV saisi par l'assistante attende l'aval de la praticienne, c'est UNE ligne
  dans `create_appointment` — mais personne ne l'a tranché.
- `mark_patient_arrived` · file d'attente · validation des demandes web.

## Le défaut de S4, à ne pas réapprendre
**Dix-neuf contrôles VERTS pendant que `create_appointment` ne créait rien.** Elle butait sur le
garde-fou `is_synthetic` d'ADR-016 — qui faisait exactement son travail. Aucun des dix-neuf
n'exerçait le chemin nominal : les contrôles d'écriture vérifiaient tous un **refus**, et un refus
reste vert quand la fonction échoue pour une tout autre raison. Trouvé en sondant la base à la
main **après** un checkpoint vert, pas par le checkpoint.

**Un checkpoint qui ne teste que ce qui doit échouer ne prouve pas que le reste marche.** Les
contrôles 20 et 21 comblent le trou. À appliquer à tout checkpoint futur : pour chaque refus
vérifié, vérifier le succès correspondant.

**Second piège, trouvé en 024/025 :** `CREATE OR REPLACE FUNCTION` ne peut pas changer un type de
retour. Ajouter une colonne à un `RETURNS TABLE` impose un `DROP` — et **un DROP emporte le
propriétaire avec lui**. Réattribuée à `postgres`, une porte `SECURITY DEFINER` s'exécute sous un
rôle `rolbypassrls` : la cloison entre praticiennes tombe, exactement comme en 018, et la
migration reste VERTE. La propriété est reposée explicitement dans les deux fichiers, et le
contrôle 25 la vérifie désormais à chaque exécution.

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

## Prochain jalon — S6
**Jarvis texte + analyse de séance** — périmètre exact : `docs/JARVIS-DEMO-SPEC.md`, **9 outils,
pas un de plus**. Priorité absolue : `analyze_session`, le seul outil qui fait gagner de vraies
minutes ce mois-ci.

Ce que S5 lui laisse, et qui doit être utilisé tel quel :
- **`app.consultations.raw_notes`** est la source de lecture d'`analyze_session`. Elle ÉCRIT dans
  `app.clinical_notes` par `app.save_note` — jamais dans `raw_notes`, sinon elle écrase la source
  qu'elle vient de lire. C'est la raison de la séparation.
- **`app.sign_note` n'entre dans AUCUNE allowlist Jarvis**, aujourd'hui ni plus tard.
  `sign_clinical_note` est un outil interdit : seule une humaine signe, la signature porte sa
  responsabilité médicale. Le contrôle 2 de `checkpoint-s5` le vérifie déjà.
- **Le panneau « Aide à la décision » existe** dans la colonne de contexte, avec le disclaimer
  d'I7 déjà affiché. S6 le remplit, il ne redessine pas la page.
- I7 : l'IA décrit, elle ne conclut pas. Toute sortie reste une SUGGESTION et n'entre au dossier
  que si la praticienne la reprend dans sa note (I6).

Deux dettes d'écran ouvertes par S3, à traiter quand un besoin réel les justifie, pas avant :
le tableau de bord n'existe pas (la racine redirige vers Patients), et la troisième colonne de
contexte du §3 n'est pas posée — le jeton `--grid-context-width` attend l'écran qui en aura besoin.
