# S7b — DOCUMENTS

> **Statut : contrat d'implémentation canonique, BLOQUÉ à l'exécution.**
> Rédigé au même standard que S7a. Ne commence pas tant que les dépendances
> bloquantes du §B1 ne sont pas levées. Ce document ne conçoit **aucun**
> contournement de ces dépendances : un actif manquant est enregistré comme
> bloquant, jamais remplacé par un substitut inventé.
> Approuvé et gelé par l'utilisateur le 2026-08-05, en même temps que S7a.
> **Prérequis d'ordonnancement : S7a (`docs/S7A-FINANCE.md`) doit être clos d'abord.**

## Défauts trouvés à l'implémentation — divergences par rapport au §B2 (2026-08-09)

Trois passes de revue adversariale sur `030_document_gates.sql` ont trouvé et fait
corriger 8 défauts réels, dont deux contredisent la lettre du §B2 tel qu'écrit
ci-dessous. Consigné ici pour que la relecture suivante ne prenne pas le texte
d'origine comme référence et ne « corrige » pas le code en le ramenant à un état
prouvé dangereux. Même discipline que S7A-FINANCE.md « Renforcements exigés » :
ce sont des levées d'ambiguïté trouvées à l'implémentation, pas une réouverture
du périmètre.

1. **`app.issue_document` est `SECURITY DEFINER`, pas `SECURITY INVOKER`** (§B2 §2
   l'annonçait INVOKER). Cause : `017 REVOKE SELECT ON app.patients FROM
   authenticated` ferme la lecture directe à TOUT rôle authentifié — une porte
   INVOKER qui lit `app.patients` échoue en « permission denied », y compris
   pour le propriétaire légitime du dossier. Le fix lit en DEUX TEMPS (clé
   technique sous verrou → `audit.log_read('fiche')` → lecture nominative),
   motif déjà utilisé par `get_document`/`list_patient_documents` ci-dessous.
2. **`app.documents` n'accorde plus INSERT/DELETE à `authenticated`** (§B2 §1
   affirmait « aucun privilège d'écriture » sans le poser explicitement — faux
   par défaut, puisque `authenticated` hérite d'INSERT/UPDATE/DELETE via 001).
   Mesuré avant correction : un `INSERT`/`UPDATE`/`DELETE` direct par
   PostgREST, sans passer par aucune porte, réussissait — exactement le risque
   que §B3 décrit. `issue_document` (désormais DEFINER) est la seule à
   détenir INSERT ; deux triggers (`assert_document_immutable`,
   `forbid_document_delete`) verrouillent la table elle-même, pas seulement
   les portes.
3. **La période du compteur et l'année du `doc_number` utilisent
   `AT TIME ZONE 'Africa/Algiers'`**, pas `to_char(now(),'YYYY')` (§B2 §5) —
   Postgres tourne en UTC, un certificat émis entre 00h et 01h heure d'Alger
   recevrait sinon l'année de la veille. Même correction que
   `029_payment_gates.sql §2quater` pour la caisse. `issued_at` reste
   inchangé : un `timestamptz` est un instant absolu, seule la lecture
   textuelle de l'année en dépend.

Les autres défauts trouvés (asymétrie owner/assistant, séance d'un autre
patient rattachable, valeurs `null`/vides acceptées, `is_synthetic` absent des
colonnes protégées par trigger) sont des corrections internes au fichier, sans
divergence avec le texte ci-dessous.

## Contexte

`docs/SPRINT-4-DAYS.md` §S7 prévoit Finance **et** Documents dans une même session, en
qualifiant lui-même ce point de « point de rupture du plan ». S7a a pris Finance ; S7b prend
Documents.

Le checkpoint de ce jalon n'est pas un contrôle d'écran : **imprimer réellement un certificat,
sur papier, et le poser à côté d'un vrai.** « Une différence de marge se voit sur le papier,
jamais à l'écran. » Ce contrôle est la raison d'être des dépendances du §B1 : sans l'en-tête
réel, la fonte réelle et le logo réel, il n'y a rien à comparer, et le déclarer vert serait un
mensonge sur la seule pièce du système qui sort du cabinet dans la main d'un patient.

**Résultat attendu :** la praticienne émet un certificat depuis le dossier ou la séance, lit
l'aperçu A4 intégral, l'imprime, et le document reste rigoureusement identique dix ans plus
tard.

---

## B1 · DÉPENDANCES BLOQUANTES — à fournir avant toute ligne de code

`docs/SPRINT-4-DAYS.md` §5 en liste déjà une partie et la marque explicitement
« **bloque S7** ». Vérifié sur disque, poste par poste :

| # | Actif requis | État constaté | Ce qu'il bloque | Peut-on contourner ? |
|---|---|---|---|---|
| B1.1 | **Scan de l'en-tête réel**, haute résolution | **absent** du dépôt | La fidélité de `header_html` des 4 modèles. Sans lui, aucune position de bloc, aucune marge, aucun rapport de taille n'est connu. | **Non.** Reconstruire l'en-tête « d'après ADR-011 » produirait un document qui ressemble au sien sans l'être — exactement l'erreur que le checkpoint papier existe pour attraper. |
| B1.2 | **Arbitrage « Pychiaterie »** | **non tranché** — ADR-011, question ouverte, avec celle de la numérotation visible des certificats | Le texte exact de l'en-tête. | **Non.** C'est une décision de la praticienne sur son propre titre professionnel. Ni corriger ni reproduire la faute n'est un choix qui m'appartient. |
| B1.3 | **Logo SVG** | seul `lOGO.JPG.jpg` existe, à la racine, en **raster** | Le rendu à l'impression. Un JPEG d'écran s'imprime crénelé et son fond blanc ne se détoure pas. | **Non.** Vectoriser un JPEG produit un tracé approximatif, pas le logo. |
| B1.4 | **Les 7 fontes `.woff2`** — Geist Sans 400/500/600 · Geist Mono 500 · **Newsreader 400** · IBM Plex Sans Arabic 400/500/600 | **aucune** dans le dépôt ; `src/styles/tokens.css:137-146` le documente : `next/font/local` n'est câblé nulle part | `--font-doc` retombe sur **Georgia**, `--font-ar` sur un fallback système. L'aperçu affiché n'est donc pas ce que l'imprimante produira — ce qui contredit §9.7 du design system. CLAUDE.md exige par ailleurs des fontes empaquetées localement (le Wi-Fi du cabinet tombe). | **Non.** Newsreader est l'écho de son Times New Roman ; une serif de substitution change la chasse, donc les retours à la ligne, donc les marges. |
| B1.5 | **Contenu des 4 modèles** — `bonne_sante_mentale`, `suivi_medical`, `certificat_medical`, `justification` | **jamais semés.** `015_seed_data.sql:75` ne pose que le compteur `document` ; **aucune ligne `document_templates` n'existe**, contrairement à ce qu'annoncent la liste S1 du sprint et le §15/3 de `01-SCHEMA.md` | Tout. Le moteur n'a rien à rendre. | **Non.** Le texte d'un certificat médical engage sa responsabilité ; l'inventer est hors de question. |
| B1.6 | **Modèle d'ordonnance** | ADR-011 le marque « ⚠️ MODÈLE MANQUANT — à fournir » | Rien en S7b : `ordonnance` **n'est pas** dans l'enum `app.doc_type` (002), et les traitements imprimés sont **déjà coupés** du mois 1 (§2 du sprint). | Sans objet — hors périmètre, pas bloquant. |

**Règle de ce document :** aucune de ces dépendances ne sera contournée par un actif
temporaire, un en-tête reconstruit, une fonte approchante ou un modèle rédigé par l'agent.
Si le temps manque, la règle du sacrifice §2 autorise à ne livrer que **2 modèles sur 4** —
les deux plus utilisés — mais **jamais** à livrer 4 modèles approximatifs.

### Ce qui reste implémentable **sans** ces actifs

À distinguer nettement de ce qui précède. Les dépendances du §B1 bloquent le **contenu** et le
**rendu fidèle** ; elles ne bloquent pas la **mécanique**. Peuvent être écrits et prouvés dès
maintenant, contre un modèle de test créé **dans la transaction du checkpoint** (fixture, pas
un seed livré — la règle 8 interdit la donnée fictive dans une fonctionnalité **livrée**, pas
dans un contrôle) :

- la migration `030` et ses portes (§B2) ;
- le moteur de substitution et son échappement (§B3) ;
- la couche service (§B4) ;
- les contrôles 1 à 19 du checkpoint (§B7).

Sont bloqués : le seed des modèles, le câblage des fontes, l'aperçu fidèle, l'écran d'émission
tel qu'il sera livré, et **le checkpoint papier** — c'est-à-dire la clôture du jalon.

---

## B2 · Migration `030_document_gates.sql`

**Additif pur.** Ne modifie ni `010`, ni la policy `documents_clinical`, ni `templates_read`.

### §0 / §6 · `GRANT CREATE ON SCHEMA app TO app_gatekeeper` puis `REVOKE`
Symétriques, **dans ce fichier**. C'est le défaut n°1 de S6 : une migration séparée hérite
d'un rôle déjà refermé par `026 §8` et échoue en 42501, migration verte jusque-là.

### §1 · Privilèges nommés, pas hérités
`GRANT SELECT ON app.documents, app.document_templates, app.patients, app.profiles TO
app_gatekeeper` — on nomme au lieu d'hériter (motif de `022`/`026 §3`). Aucun privilège
d'écriture : les portes d'écriture sont `SECURITY INVOKER`.

### §1bis · Index requis (contrat de performance)
`010` ne pose **aucun** index sur `app.documents` hors la contrainte `UNIQUE (cabinet_id,
doc_number)`. Lister les documents d'un patient balaierait donc la table.
```sql
CREATE INDEX IF NOT EXISTS documents_patient_issued
  ON app.documents (patient_id, issued_at DESC);
CREATE INDEX IF NOT EXISTS templates_active_lookup
  ON app.document_templates (cabinet_id, doc_type, version DESC) WHERE is_active;
```

### §2 · `app.issue_document(p_patient_id uuid, p_doc_type app.doc_type, p_variables text, p_consultation_id uuid DEFAULT NULL) RETURNS uuid`

`SECURITY INVOKER` — `authenticated` possède INSERT sur `app.documents` (001) et
`documents_clinical` porte un `WITH CHECK`. La RLS décide, la porte ne teste aucun rôle.

`p_variables` voyage **sérialisé** en `text` : `RpcArgs` (ADR-020) n'accepte que des
scalaires, exactement comme `save_note` en S5.

**Transaction unique, verrou explicite — mêmes exigences qu'en S7a §2 :**
1. validation des arguments et du périmètre ;
2. `SELECT ... FROM app.patients WHERE id = p_patient_id FOR UPDATE` — sérialise deux
   émissions concurrentes sur le même dossier ;
3. lecture du modèle actif (`is_active`, `version` la plus haute) ;
4. **rendu du HTML** (§B3) et **figeage** dans `rendered_html` ;
5. `doc_number` ← `app.next_number(app.current_cabinet(), 'document', to_char(now(),'YYYY'))`
   — **jamais** une `SEQUENCE` (I17) ; le numéro n'est **pas consommé** si la transaction
   échoue, ce que le contrôle 15 vérifie par `ROLLBACK` ;
6. `INSERT`, puis `COMMIT` implicite au retour de la fonction.

Aucun état partiel n'est observable : un document numéroté sans HTML figé, ou un numéro
consommé sans document, sont l'un et l'autre impossibles.

Gardes, dans l'esprit de `start_consultation` :
- patient introuvable **ou hors périmètre** → `RETURN NULL`. Jamais un message qui
  distinguerait les deux cas (ADR-003) ;
- aucun modèle actif pour ce type → exception explicite et lisible. **Ne pas** émettre un
  document sans modèle ;
- `cabinet_id` ← `app.current_cabinet()`, `practitioner_id` ← `auth.uid()` — **aucun des deux
  n'est choisi par l'appelant** (leçon de `023`) ;
- `p_consultation_id`, s'il est fourni, doit appartenir à l'appelante : même raisonnement que
  le rendez-vous obligatoire de `026`.

**⚠️ Un document émis ne se réémet pas et ne se corrige pas.** Il n'y a **aucune** porte
`update_document` ni `delete_document` dans ce fichier, aujourd'hui ni plus tard : un
certificat remis au patient existe hors du système, et le rattraper en base ne le rattrape pas
dans sa poche. Une erreur se corrige en émettant un **nouveau** document, numéroté à sa date.
Même principe qu'ADR-004 sur les notes signées. Contrôle 3.

### §3 · `app.get_document(p_id uuid)` et `app.list_patient_documents(p_patient_id uuid)`
`SECURITY DEFINER`, `OWNER TO app_gatekeeper` **posé explicitement**. Si un `DROP` est requis,
`OWNER TO` suit immédiatement : un `DROP` emporte le propriétaire et réattribue à `postgres`,
rôle `rolbypassrls` — la cloison tombe pendant que la migration reste **verte** (faute de
`018`, réapparue en `024`/`025`).

DEFINER pour la raison de `027` : `audit.log_read` n'a `EXECUTE` accordé qu'à
`app_gatekeeper` (`020 §2`). Ces deux portes **nomment un patient** → `audit.log_read` appelé
**avant** la lecture, comme `get_consultation`.

Filtrage par `app.can_see_clinical(practitioner_id)` : owner et praticienne propriétaire
voient ; **l'assistante rend 0 ligne**. Un document EST une pièce clinique (policy
`documents_clinical`, 010) — c'est le piège de la colonne `reason`, transposé aux documents.

**Contrat de performance :** `documents_patient_issued` sert `list_patient_documents` ; accès
par clé primaire pour `get_document`. Aucun `Seq Scan` sur `app.documents` — vérifié par
`EXPLAIN` au contrôle 13, pas par intuition.

### §4 · `app.mark_document_printed(p_id uuid) RETURNS integer`
`SECURITY INVOKER`. `UPDATE ... SET printed_count = printed_count + 1 WHERE id = p_id`, en
**une seule instruction** — l'incrément est atomique en SQL, et une lecture préalable suivie
d'une écriture introduirait une perte de mise à jour sur deux impressions simultanées. Rend la
nouvelle valeur ; `NULL` si introuvable ou hors périmètre. **Ne touche à rien d'autre** : ni
`rendered_html`, ni `variables`, ni `issued_at`. Contrôle 19.

### §5 · Le temps est celui du serveur, jamais celui du poste
`issued_at` vient du défaut de la table (`now()`, 010). La période du compteur vient de
`to_char(now(),'YYYY')`. **Aucune porte de `030` ne prend un `timestamptz` en paramètre** —
un certificat antidaté par l'horloge d'un poste est un faux dans un dossier médical.
Contrôle 14.

---

## B3 · Le moteur de rendu — et son unique vraie question de sécurité

`document_templates.body_html` porte des marqueurs `{{patient.first_name}}`, `{{vars.jours}}`.

**Décision : la substitution se fait en SQL, dans `issue_document`, pas en TypeScript.**
Raison : `rendered_html` est la pièce juridique. S'il était rendu côté client puis envoyé à la
base, un appelant pourrait poster n'importe quel HTML comme « le certificat émis » — le
document figé ne serait plus dérivé du modèle. La base rend, la base fige.

### 🔴 Échappement HTML — obligatoire, et c'est le point critique de S7b
Un nom de patient contenant `<`, `>`, `&` ou une apostrophe est **normal**, pas une attaque.
Toute valeur substituée est échappée avant insertion, **sans exception** :

- les marqueurs `{{...}}` sont résolus contre une **allowlist fermée** de chemins connus
  (`patient.*`, `vars.*`, `praticien.*`, `cabinet.*`) — un marqueur inconnu est laissé
  **littéral**, jamais résolu dynamiquement ;
- chaque valeur passe par un échappement HTML (`<`, `>`, `&`, `"`, `'`) ;
- **aucun `{{{ }}}`, aucun mode « HTML brut », aucune échappatoire.** Le seul HTML du document
  vient du modèle, écrit par un humain ; les données n'en produisent jamais.

Sans cette règle, `rendered_html` est un XSS **stocké dans une pièce médico-légale**, réaffiché
à chaque relecture du dossier — et figé pour dix ans par la garantie même qu'on cherche à
donner. Contrôles 9 et 10.

`variables` est validé contre le jeu de champs attendu par le `doc_type` (ADR-011) : n° de
pièce d'identité et mairie pour `bonne_sante_mentale`, jours d'arrêt et date de début pour
`suivi_medical`, etc. Une clé hors allowlist est **refusée**, comme `save_note` refuse une clé
hors SOAP.

---

## B4 · Couche service — `src/services/documents.ts`

Même discipline que `consultations.ts` et `finance.ts` : **ce fichier ne requête aucune
table**, uniquement `db().rpc(...)` sur les 4 portes de `030`. En-tête de fichier expliquant
pourquoi — une lecture de document par PostgREST serait une lecture de pièce clinique **sans
trace d'audit**, le chemin qu'ADR-019 a fermé.

`log.error` sans aucun identifiant patient (règle 1, I5). `Result<T>` partout. Types
`Document`, `ModeleDocument`, conversion `snake_case` → `camelCase` par des `toX()`, comme
`toConsultation`.

---

## B5 · Écrans — **bloqués sur B1.1 à B1.5**

Spécifiés ici, non implémentables tant que les actifs manquent.

- **Aperçu A4** (`src/components/ApercuDocument.tsx`) : `--font-doc`, proportions A4, fond
  `--card`, ombre `--lift-3`, en-tête fidèle au scan — bloc FR à gauche, arabe dessous
  (`dir="rtl"`, interligne 1.8, vraie fonte), logo centré, N° d'Ordre, téléphone, bloc
  Date/Nom/Prénom/Âge à droite (§9.7). **Ce que l'écran montre est exactement ce que
  l'imprimante produit** — d'où B1.4 : avec Georgia à l'écran et Newsreader nulle part, cette
  phrase est fausse et l'aperçu ment.
- **Aperçu intégral avant émission**, jamais un résumé (`03-JARVIS-TOOLS.md` §4.5, en rouge) :
  un certificat engage sa responsabilité médicale, elle lit le texte final.
- Boutons nommant leur action : `Émettre le document` → toast `Document émis.` ;
  `Imprimer` → `mark_document_printed`.
- Feuille de style d'impression dédiée : marges A4 réelles, `@page`, aucune chrome
  d'interface. **Le verre est interdit ici** — §4 du design system, règle de sécurité, pas de
  goût.
- Liste des documents au dossier patient, **état vide** honnête : « Aucun document émis. »
  Aucune donnée fictive (règle 8).
- Toutes les chaînes dans `src/i18n/fr.ts`, section `documents` — aucune chaîne en dur.
- Garde de rôle sur la route, à l'image de `/consultation/*` : **l'assistante n'entre pas.**

---

## B6 · Ordre d'implémentation

**Phase 0 — levée des bloquants** (hors agent, à fournir) : B1.1 → B1.5.
Tant que la phase 0 n'est pas close, S7b ne démarre pas. Il n'y a pas de « démarrer sur ce
qu'on a » : ce qu'on a produirait un faux certificat.

**Phase 1 — mécanique, testable dès maintenant** contre une fixture de checkpoint :
1. `030` — portes, index, moteur de rendu et échappement ;
2. `src/services/documents.ts` ;
3. contrôles 1 à 19 du checkpoint.

**Phase 2 — fidélité, après phase 0 :**
4. câblage `next/font/local` des 7 `.woff2`, repointage des 4 variables de `tokens.css` ;
5. seed des modèles (`031_seed_document_templates.sql`), **2 modèles d'abord** — les deux plus
   utilisés — puis les 2 autres si le temps le permet (règle du sacrifice §2) ;
6. `ApercuDocument.tsx` + feuille d'impression ;
7. écran d'émission et liste au dossier patient ;
8. **checkpoint papier.**

---

## B7 · Vérification

### Portes obligatoires avant tout commit
Les trois `grep`/`find` de CLAUDE.md, plus `pnpm typecheck && pnpm lint && pnpm build &&
bash scripts/preflight.sh`. Une seule sortie = pas de commit.

### `scripts/checkpoint-s7b.sh`
Rejouer `001→030` sur une base locale **neuve** d'abord : c'est ce qui a trouvé le défaut n°1
de S6, invisible en relecture.

| # | Contrôle | Attendu |
|---|---|---|
| 1 | `documents.ts` ne nomme aucune table (`grep` sur `.from(`) | 0 occurrence |
| 2 | `030` ne contient pas `CREATE SEQUENCE` (I17) | 0 occurrence |
| 3 | `030` ne contient ni `update_document` ni `delete_document` | 0 occurrence |
| 4 | owner a1 émet sur son patient b1 | `doc_number` rendu, `rendered_html` non vide |
| 5 | practitioner a2 émet sur le patient b1 de a1 | `NULL` — pas une erreur distinctive |
| 6 | assistant a3 idem | `NULL`, message **identique mot pour mot** à celui de a2 |
| 7 | `patient_id` inexistant, appelé par a1 | **même retour encore** — aucune fuite |
| 8 | `list_patient_documents` / `get_document` par a3 | 0 ligne |
| 9 | 🔴 patient nommé `<script>alert(1)</script>` | `rendered_html` contient `&lt;script&gt;`, **jamais** `<script>` |
| 10 | 🔴 marqueur inconnu `{{secret.token}}` dans le modèle de test | rendu **littéral**, aucune résolution |
| 11 | modèle modifié après émission | `rendered_html` du document déjà émis **inchangé** |
| 12 | `next_number('document')` ×100 concurrent | 1..100 sans trou (T5 du §15) |
| 13 | `EXPLAIN` sur `list_patient_documents` | **aucun `Seq Scan`** sur `app.documents` |
| 14 | aucune porte de `030` ne prend de `timestamptz` | 0 argument |
| 15 | `BEGIN` → `issue_document` → `ROLLBACK`, relire `app.counters` | `current_value` **inchangé** |
| 16 | deux sessions émettent simultanément sur le même patient | deux documents, **deux numéros distincts**, aucun trou |
| 17 | `get_document` par a1 → `audit.log` | ligne de lecture écrite |
| 18 | `proowner` de `get_document` et `list_patient_documents` | `app_gatekeeper`, **pas `postgres`** |
| 19 | `mark_document_printed` ×2 | `printed_count` = 2, `rendered_html` intact |

Les contrôles 5-6-7 sont le cœur, comme en S7a : les trois cas doivent être
**indiscernables**. Le contrôle 16 exige **deux sessions `psql` simultanées**, pas deux appels
successifs — une paire séquentielle passerait au vert sans rien prouver du verrou.

### 🔴 CHECKPOINT S7b — le contrôle papier
**Imprimer réellement les certificats. Sur papier. Les poser à côté des siens.**
Une différence de marge se voit sur le papier, jamais à l'écran.

Ce contrôle est **le seul qui clôt S7b**. Il ne peut pas être exécuté sans B1.1 → B1.5, et il
ne se remplace pas par un contrôle d'écran. Tant qu'il n'a pas eu lieu, S7b n'est pas clos —
quel que soit l'état du code.

⚠️ Même dette environnementale qu'en S7a : `checkpoint-s7b.sh` tourne par `docker exec` sur le
conteneur Postgres de `supabase start`, **pas** par le conteneur jetable `postgres:15` de
`scripts/lib/dburl.sh` (Docker Hub injoignable sur ce poste ; Docker, lui, fonctionne). Le
choix entre corriger `qfull()` et trouver un miroir reste une **décision de l'utilisateur**.

---

## B8 · Commits

1. `feat(documents): portes 030 — émission, lecture auditée, impression`
2. `feat(documents): moteur de rendu et échappement HTML`
3. `feat(documents): couche service sur les portes 030`
4. `chore(design): câblage next/font/local des 7 fontes` *(après B1.4)*
5. `feat(documents): seed des modèles` *(après B1.1, B1.2, B1.5)*
6. `feat(documents): aperçu A4 et feuille d'impression` *(après B1.3, B1.4)*
7. `feat(documents): écran d'émission et liste au dossier`
8. `test(documents): checkpoint-s7b`

Revue `security-reviewer` **obligatoire** avant les commits 1 et 2 — ils touchent la base, la
RLS, et le seul endroit du système où une donnée patient est transformée en HTML.

---

## B9 · Ce que S7b laisse ouvert

- **Ordonnances imprimées** — coupées du mois 1 (§2 du sprint), prévues semaine 3.
  `ordonnance` n'est pas dans `app.doc_type` ; l'ajouter est une migration d'enum, pas une
  retouche.
- **Numérotation visible des certificats** — ADR-011, question ouverte n°2, à trancher avec la
  praticienne. `doc_number` est stocké dans tous les cas ; l'afficher ou non sur le papier est
  une décision d'en-tête, donc dépendante de B1.1.
- **Consentements sur papier** — inchangé au mois 1.
- La dette S6 datée avant 2026-08-10 reste ouverte, indépendamment de S7.
