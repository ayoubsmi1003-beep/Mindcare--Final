# STATE — MindCare OS
**V10-PATIENTS VERT (SQL 37/37) · le dossier patient est un espace de travail · V9-COCKPIT et V8-DOCUMENTS restent verts**
Dernière mise à jour : 2026-08-23

---

## ✅ 2026-08-23 — V10-PATIENTS : l'espace de travail clinique

### 0. Ce que le lot livre

`/patients` — annuaire clinique : avatar monogramme, nom, n° de dossier, date de
naissance, téléphone. Recherche DÉBOUNCÉE à 250 ms (elle ne l'était pas : chaque
frappe partait, et chaque appel écrit une trace `recherche`).

`/patients/[id]` — six onglets : Vue d'ensemble · Chronologie · Clinique ·
Traitements · Rendez-vous · Documents. Ouverture en UN appel de données
(`get_patient_workspace`), le reste À LA DEMANDE onglet par onglet — motif
`SectionDocumentsPatient` : ouvrir une fiche ne doit pas produire une lecture
que la praticienne n'a pas demandée (règle 6).

Modification du dossier sur `app.update_patient`, la porte existante. **Aucun
second chemin d'écriture, aucune création de patient** (elle n'a pas de porte et
`record_number` n'est généré par rien — reste à faire).

**QUATRE COLONNES DORMAIENT.** `sex`, `emergency_contact`, `id_document_number`,
`id_document_issuer` existent depuis 004 et `get_patient` les rendait déjà : seul
le mapping TypeScript les jetait. Elles sont exposées sans une seule migration.

### 1. Migrations 047 et 048 — appliquées et vérifiées

| Objet | Forme |
|---|---|
| `get_patient_workspace(uuid)` | DEFINER `app_gatekeeper`, **VOLATILE**, jsonb à contrat EXPLICITE (jamais `to_jsonb`), champ `contrat` versionné, UNE trace `fiche` avant lecture |
| `list_patient_timeline(uuid, timestamptz, uuid, int)` | DEFINER, VOLATILE, 8 sources en `UNION ALL`, **pagination KEYSET** `(occurred_at, event_id)`, bornée à 50 en base, UNE trace `liste` |
| 6 × `GRANT SELECT` | diagnoses, prescriptions, prescription_lines, scale_administrations, scales, medications — **le porteur n'en avait AUCUN** |
| `prescriptions_patient` | index `(patient_id, prescribed_at DESC)`, le seul manquant |

**047 est une FAÇADE DE LECTURE, pas le Digital Twin.** Aucune projection, aucune
vue matérialisée, aucun cache : une agrégation à la lecture, bornée. Le champ
`contrat` porte la version de forme pour qu'une implémentation canonique puisse
lui succéder sans rupture.

### 2. Les six GRANT — pourquoi ils n'ouvrent rien

`app_gatekeeper` n'avait jamais reçu `SELECT` sur les six tables cliniques.
Sans eux la porte n'aurait pas rendu « zéro ligne » : elle aurait échoué en
`42501`, à l'exécution. Quatre dispositifs, tous vérifiés au checkpoint (§A),
font que la RLS s'applique intégralement sous ce rôle :
non-propriétaire de toute table (§A3) · pas de BYPASSRLS (§A1) · FORCE RLS sur
les six (§A4) · héritage de `authenticated`, dont aucune policy clinique n'a de
clause assistante (§A2).

### 3. « Pas le droit » ≠ « rien à montrer »

La RLS seule NE DISTINGUE PAS les deux : dans les deux cas la sous-requête rend
zéro ligne. `clinique` et `traitements` valent donc JSON `null` quand
`app.can_see_clinical()` — le helper canonique de 003, déjà seconde barrière de
`get_document` — rend faux, et un OBJET aux listes vides sinon.

Ce n'est pas un test de rôle applicatif (règle 4) : il décide de la FORME, pas
de l'accès. S'il se trompait en rendant vrai, la RLS filtrerait quand même les
sous-requêtes. Le pire cas est un onglet inutile, jamais une divulgation.
Contrôles C1/C2 contre B4b : les deux situations sont distinguables.

### 4. Verdicts mesurés

```
checkpoint-patients-v2.sql ....... 37 verts · 0 ROUGE · 0 BLOQUÉ
                                   (fixtures ANNULÉES, impersonation a1/a2/a3)
  §A plateforme (9)  le porteur ne peut pas contourner la RLS
  §B cloison (7)     praticienne / consœur → NULL / assistante / inexistant
  §C forme (4)       « pas le droit » ≠ « rien à montrer » ; aucun champ interne
  §D chronologie (5) ordre, keyset sans doublon, bornage, ZÉRO fuite clinique
  §E audit (5)       1 trace par appel, y compris hors périmètre
  §F écriture (5)    allowlist, coalesce, format, effacement

tsc --noEmit ..................... 0 erreur
eslint ........................... 0 erreur
next build ....................... vert · /patients/[id] 8.02 kB · 222 kB First Load
preflight.sh ..................... vert

get_patient_workspace ............ 147 ms médiane · charge utile 1 233 octets
list_patient_timeline (20 év.) ... 78 ms médiane
                                   budget fiche patient : 2 appels, < 500 ms — tenu
```

### 5. Ce que le lot NE fait PAS

Aftercare sous toute forme · création de patient · e-mail, adresse structurée,
situation familiale, profession, allergies, antécédents (**aucune de ces
colonnes n'existe** — elles ne sont pas affichées « Non renseigné », elles ne
sont pas affichées du tout) · risque suicidaire · paiements du patient ·
communications · résumé IA · statut médicamenteux (`prescription_lines` n'a ni
`stopped_at` ni statut : l'écran dit « Dernière prescription », **jamais**
« traitement en cours ») · graphique de tendance sous deux mesures.

### 6. Trois pièges rencontrés, et ce qu'ils coûtent

**`consultations.kind` N'EXISTE PAS.** 024 n'a ajouté `kind` qu'à
`app.appointments` ; une consultation en hérite par son rendez-vous. 047 est
passée VERTE malgré la faute : Postgres ne résout pas les identifiants du corps
d'une fonction plpgsql à sa création, et la porte n'a échoué qu'au premier appel,
au checkpoint. **Vert statique ≠ vert intégré** — une migration appliquée sans
porte exercée ne prouve rien. Corrigé par 048, en `CREATE OR REPLACE` (un `DROP`
aurait réattribué le propriétaire à `postgres`, `rolbypassrls`, et la porte
aurait cessé silencieusement d'être filtrée).

**Le garde ADR-016 s'applique aux fixtures de checkpoint.** Toute table portant
`patient_id` refuse une insertion sans `is_synthetic = true` tant que le
déploiement est en `cloud-dev`.

**Une borne d'audit est un `max(id)`, pas un `count(*)`.** Les quatre contrôles
§E sont d'abord sortis ROUGE sur un instrument qui comparait `id > count(*)` :
les portes traçaient correctement depuis le début.

### 7. Reste ouvert

- **Création de patient** — aucune porte ; `app.next_number(cabinet,'patient_record',…)`
  existe (010) et l'attend.
- **Faille d'audit préexistante** — `diagnoses`, `prescriptions` et
  `scale_administrations` restent lisibles DIRECTEMENT sous RLS par
  `authenticated`, **sans trace de lecture**. V10 n'aggrave rien (elle lit par
  des portes qui tracent) mais ne la referme pas : c'est un lot à part.
- **Recherche phonétique** — les variantes algériennes (Mohamed / Mohammed /
  M'hamed, Belkacem / Bel Kacem) ne sont pas couvertes ; un patient introuvable
  devient un doublon de dossier.
- **`phone LIKE '%…%'`** reste un *seq scan* : non indexable en l'état.
- **Adresse structurée** — `address` est un `text` libre. Écart documenté.
- Vérification navigateur en 3 rôles réels : **non faite dans cette session.**

---

## ✅ 2026-08-22 — V9-COCKPIT : le poste d'accueil de l'assistante

### 0. Ce que le lot livre

`/tableauDeBord` — composition SÉPARÉE par rôle (I12) : cockpit complet pour
l'assistante, phrase honnête « livrée avec la session V4 » pour les praticiennes.
Racine `/` intouchée. Frise du jour multi-praticiennes avec ligne « maintenant »,
zone d'attention **plafonnée à 9 items** (priorité opérationnelle pure, `attention.ts`),
arrivées/absents, boîte de paiements + tiroir d'encaissement (montant LECTURE
SEULE, Espèces fixe, confirmation 400 ms, JAMAIS d'optimisme sur l'argent),
centre de notifications, préparation/clôture, recherche éclair, clavier gardé
(`N T / A P R` ; `Ctrl+K` reste Jarvis).

**LIVE = POLLING BORNÉ.** Board 120 s · notifications 30 s · rafraîchi après
chaque mutation · au retour sur l'onglet. AUCUN bouton Actualiser (contrôle au
navigateur). Realtime explicitement hors périmètre v1 — aucune extension de `DbPort`.

### 1. Migration 046_reception_gates.sql — appliquée et vérifiée

| Objet | Forme |
|---|---|
| `mark_appointment_arrived` / `mark_appointment_no_show` | INVOKER, transitions nommées, rejeu sans réécriture d'horodatage |
| `reception_board(date)` | DEFINER `app_gatekeeper` (sans BYPASSRLS), jsonb `{journee,demandes,paiements}`, UNE trace `liste`/appel |
| `mark_notification_read` | INVOKER trivial |
| policy `pay_assistant_encaissement` | ADDITIVE : UPDATE si cabinet+assistant+non encaissé+24 h ; WITH CHECK `collected_by=auth.uid()` |
| déclencheur `trg_pay_guard` | BEFORE UPDATE : sous rôle assistant, colonnes tarif/rattachement GELÉES (la RLS filtre des lignes, pas des colonnes — leçon ADR-017 transposée) |

La porte d'écriture reste `record_payment_collected` (029), inchangée.

### 2. Verdicts mesurés

```
checkpoint-reception.sql ......... 34 verts · 0 ROUGE (fixtures ANNULÉES,
                                   impersonation a1/a2/a3 via SET ROLE+jwt.sub)
mesure-reception.mjs (next start)  13 verts · 0 ROUGE
  RPC reception_board ............ 136 ms   (budget 500 ms)
  écran complet .................. 488 ms   (budget §2 tenu ; coquille incluse)
  appels de données de l'écran ... 2       (board + notifications ; coquille à part)
  1440×900 ....................... 0 px de défilement (doc ET <main>)
  attention ...................... ≤9 prouvé au DOM · aucun bouton refresh
  fraîcheur sans rechargement .... prouvée par injection réseau (visibilitychange)
preflight · typecheck · lint · pnpm build (/tableauDeBord 10,1 kB · 219 kB load)
```

Fenêtre …a3 ouverte pour la mesure via `scripts/compte-assistante.sh`
(même garde ADR-016 que compte-praticienne), **refermée après** (sentinelle
vérifiée). Le script bash existe pour les sessions suivantes ; cette session a
exécuté sa séquence via docker/PowerShell direct — WSL n'a pas Docker Desktop
en intégration.

### 3. Quatre pièges qui coûteront cher à quiconque les réapprend

- **La colonne de sortie d'une porte scalaire s'appelle comme la fonction.**
  `FROM app.reception_board(d)` expose une colonne `reception_board`, PAS
  `journee`. Passer par un accesseur (`pg_temp.board()`) et des `->'clé'`.
- **Postgres ne garantit pas l'ordre d'évaluation des arguments.** Une sonde
  « porte PUIS vérification » écrite en deux arguments d'un même appel peut
  lire l'état AVANT la mutation → faux ROUGE. Séquencer dans un helper plpgsql.
- **Les apostrophes de i18n sont DROITES.** Un sélecteur Playwright avec ’
  (U+2019) ne trouve jamais « En salle d'attente ».
- **RLS et instruments.** `notifications_mine` masque les notifications
  assistant à une praticienne ; `audit.log` lui est fermé : tout compte
  cross-rôle passe par un compteur SECURITY DEFINER dédié INSTRUMENT
  (motif v6, étendu aux notifications).

### 4. Restes ouverts

1. `checkpoint-v3.sh` NON rejoué cette session (AppShell touché d'une seule
   ligne : `ECRANS_CONSTRUITS += "tableauDeBord"`).
2. Plafond ≤9 observé à 0 item sur la donnée synthétique du jour ; la preuve
   de troncature tient dans `attention.ts` (slice(0,9)) + contrôle DOM.
3. Drag-drop, waiting list, paiements partiels, méthodes alternatives,
   Realtime, dashboard praticienne (V4) : hors périmètre, coutures documentées
   dans le plan du lot.

---

## ✅ 2026-08-22 (antérieur) — V8-DOCUMENTS : les 4 certificats, du modèle au papier

> ⚠️ **VERT AU CHECKPOINT N'EST PAS VERT TOUT COURT.** Deux contrôles ne
> s'automatisent pas et RESTENT OUVERTS : la saisie du profil réel sur
> l'instance, et le tirage papier approuvé. Détail au §7. Ne pas lire ce titre
> sans lire ce paragraphe.

### 0. Numérotation — pourquoi V8 et pas V7

`STATE.md` intitulait déjà « V7-CAISSE » le lot du 2026-08-21. Le module
Documents prend donc **V8**. Les migrations 042-044 portent « V7 » dans leurs
commentaires : elles ont été écrites et **appliquées** avant que la collision ne
soit vue, et la règle 9 interdit de retoucher une migration appliquée — même un
commentaire, puisque `COMMENT ON` est stocké en base et que le fichier doit
rester le miroir exact de ce qui a tourné. **Ne pas « corriger » ce V7-là.**

### 1. LE DÉFAUT PRINCIPAL — le seed et le moteur ne parlaient pas la même langue

`docs/031_seed_document_templates.sql` existait depuis le 2026-08-11, complet,
avec les dix arbitrages A1→A10 tranchés. Il n'a jamais été appliqué, **et c'est
heureux** : ses marqueurs sont en français (`{{patient.nom}}`,
`{{praticien.titre}}`, `{{vars.arret_jours}}`) alors que le contexte de rendu
construit par `030 §2` est en anglais (`patient.last_name`, `praticien.title`,
`vars.jours`).

Tous passaient l'allowlist de `render_template` — **donc aucune erreur** — mais
aucun n'avait de valeur, et un marqueur sans valeur est laissé LITTÉRAL,
délibérément (030 §1quater : « un trou invisible dans un certificat est pire
qu'un marqueur visible »). Semé tel quel, un certificat destiné à un notaire
serait sorti avec `{{praticien.titre}}` imprimé dessus. Pire : les clés
`arret_*` auraient de toute façon été refusées par la validation d'ensemble
exact, rendant `suivi_medical` **inémettable**.

**031 reste dans `docs/`, intact** (règle 9, et il garde la genèse des dix
corrections). Le numéro 031 demeure vacant dans `supabase/migrations/`, sans
ligne `schema_migrations` : inscrire une migration jamais exécutée serait une
trace fausse. **031 et 035 : numéros brûlés.**

### 2. Trois migrations

| Migration | Objet | Contrôle qui la refuse si elle est fausse |
|---|---|---|
| `042_nombre_en_lettres` | `app.nombre_en_lettres(1..999)` | 16 cas dans la migration : 21, 71, 80, 81, 91, 100, 180, 200, 201… + les deux bornes |
| `043_document_render_context` | `issue_document` : +`civilite`, +`age`, +`birth_date_fr`, +`full_name_ar`, +`vars.date_affichee`, `jours_lettres` **recalculée** | bloc de cloison (propriétaire, DEFINER, GRANT, BYPASSRLS) + empreinte md5 de `render_template` inchangée |
| `044_seed_document_templates` | les 4 modèles v1, corrections A1→A10 annotées | liste blanche des 25 clés du contexte + jeu de `vars` par type |
| `045_document_templates_v2` | les 4 modèles **v2** (approuvés) ; `traitement_2` devient une clé FACULTATIVE de `certificat_medical` | liste blanche rejouée + jeu de `vars` par type + **`<li>` collé à ses balises** + bloc de cloison complet |

**Pourquoi `nombre_en_lettres` est EN BASE et pas en TypeScript.** `030` valide
`jours_lettres` comme simple clé d'entrée — présente, scalaire, non vide, rien
de plus. Une appelante pouvait donc soumettre
`{"jours":"30","jours_lettres":"trois"}` et **la base n'y voyait rien** : un
certificat d'arrêt de travail dont les chiffres et les lettres se contredisent
est un faux exploitable devant un employeur. `043` ÉCRASE la valeur reçue au
moment du rendu. La colonne `variables` continue de stocker la saisie — elle est
la trace du geste, `rendered_html` est la pièce. **Les confondre ferait mentir
l'une ou l'autre.**

**Pourquoi `render_template` n'est PAS touchée.** La tentation était d'ajouter un
préfixe `document.` à l'allowlist pour y loger la date. `030 §1quater` l'avait
écrit d'avance : « chaque capacité ajoutée ici serait une capacité offerte à qui
écrirait un modèle ». Passer par `vars` obtient le même résultat sans toucher
une ligne du moteur. **Aucun `DROP FUNCTION` dans les trois migrations** — un
DROP réattribue la fonction à `postgres` (`rolbypassrls`) et la cloison tombe
pendant que la migration reste verte (défaut de 018).

### 3. Le défaut de `030` qui n'en était pas un

La mémoire du projet signalait un `CASE` sans `ELSE` dans `issue_document`,
exploitable dès qu'une 5ᵉ valeur d'enum arriverait. **Il est déjà fermé**
(`030:423-426`, `IF v_attendues IS NULL THEN RAISE`). Aucune migration n'était
nécessaire. Le checkpoint le vérifie par lecture de `prosrc` — **contrôle
faible, et déclaré tel** : on ne peut pas ajouter une valeur à `app.doc_type`
pour l'éprouver sans violer la règle 9.

### 4. DEUX FAUX VERTS TROUVÉS DANS LES INSTRUMENTS, PAS DANS LE PRODUIT

C'est la leçon la plus coûteuse de la session, et elle s'est présentée **trois
fois sous la même forme** : un instrument qui prend une erreur pour une valeur.

**(a) `checkpoint-s7b.sh` — `q()` rendait le texte d'une erreur psql.**
`docker exec … psql … | tail -1` prenait la dernière ligne de la sortie, y
compris quand cette ligne appartenait à un message d'erreur. `doc1` valait alors
`HINT: …` au lieu d'un uuid, et le contrôle 1 — qui ne teste que « non vide » —
passait **VERT sur une émission qui venait d'échouer**. Les contrôles suivants
héritaient de la chaîne, la glissaient dans un `WHERE id='…'` et rougissaient
loin de la cause. Corrigé : `q()` rend `ERREUR`, qui ne vaut ni un uuid, ni
« NULL », ni « 0 ».

**(b) Le même `tail -1` sur une valeur MULTILIGNE.** `rendered_html` fait
plusieurs lignes ; le contrôle d'échappement n'inspectait donc que la dernière,
où la chaîne cherchée ne pouvait pas être. **ROUGE sur un produit sain.**
Corrigé par `replace(…, chr(10), ' ')`.

**(c) Le détecteur de mode de la mesure navigateur, faux DEUX FOIS.**
1ʳᵉ version : `script[src*="webpack"]` — Next émet `webpack-<hash>.js` **en
production aussi**, donc tout relevé était annoncé « next dev — NON OPPOSABLE ».
2ᵉ version : `react-refresh` — ce chunk n'existe pas comme `<script src>` séparé
en App Router, donc tout relevé était annoncé « next start » : **l'erreur
inverse, et la pire des deux**, elle aurait fait passer un chiffre de
développement pour un chiffre opposable. Les balises ont finalement été **lues**
sur les deux serveurs : `app-pages-internals.js` n'apparaît qu'en développement.
⚠️ `scripts/mesure-v6-finance.mjs` porte encore la 1ʳᵉ version de ce défaut —
**dette ouverte**, ses relevés sont étiquetés « next dev » à tort.

### 5. Le budget — MESURÉ, en `next start`, médiane de 3

`06-PERF-BUDGET.md:44` — Documents : **2 appels · 100 ms · 500 ms**.

| Chemin | Mesuré | Budget |
|---|---|---|
| `/documents?patient=…` — appels de l'écran | **2** (`list_patient_documents`, `get_patient`) | 2 ✅ |
| premier contenu (FCP) | **76 ms** (72 · 76 · 152) | 100 ms ✅ |
| écran complet | **391 ms** (329 · 391 · 622) | 500 ms ✅ |
| `/documents` sans dossier | **0 appel** de lecture de dossier | règle 6 ✅ |

⚠️ **RELEVÉ APRÈS LE PASSAGE EN A5 (2026-08-22), MÊME MÉTHODE : `next start`,
médiane de 3.** Le lot précédent relevait 80 ms / 344 ms (76·80·120 · 321·344·479).
L'écart sur l'écran complet — 344 → 391 ms — **n'est pas attribué au lot A5, et
ne doit pas l'être** : les deux séries ont une dispersion de 150 à 300 ms, dominée
par l'aller-retour vers la base hébergée, et les enveloppes se recouvrent
largement. Ce qui est VRAIMENT comparable est le poids du client, qui ne dépend
pas du réseau : `/documents` pèse **6,67 kB · 214 kB de premier chargement, avant
comme après**, à l'octet près. Le lot n'a ajouté aucune requête et aucun
JavaScript — il n'a touché que du CSS. Conclure « régression de 47 ms » sur trois
tirages serait exactement l'erreur de méthode que §4 (c) a déjà coûtée.

⚠️ **UN DÉPASSEMENT RÉEL A ÉTÉ TROUVÉ ET CORRIGÉ** : la 1ʳᵉ version attendait
`get_patient` avant de lancer `list_patient_documents` — deux allers-retours
**en série** vers Alger, **546 ms** relevés. Or la liste ne dépend pas du
dossier : elle ne veut que l'identifiant, qui vient de l'URL. C'était une
dépendance **imaginaire**, payée à chaque ouverture. Parallélisés : 546 → 344 ms.

Relevé, non corrigé : la **coquille** émet 3 à 4 appels par écran
(`deployment`, `profiles`, `get_open_consultation`). Dette PERF §3,
**antérieure à ce lot**, hors périmètre (règle 10).

### 6. Les cinq états — déclenchés, pas décrits

`?etat=chargement|vide|erreur|horsligne`, **inerte en production** (garde
`NODE_ENV`) : un paramètre d'URL qui vide l'écran serait, en cabinet, un moyen
de faire croire à une praticienne qu'un dossier n'a aucun certificat. Les quatre
sont **mesurés verts en `next dev`** et **déclarés NON MESURÉS en production** —
une première version les annonçait ROUGE, ce qui accusait le produit d'un défaut
qui était une précaution. Captures : `checkpoints/v8-preuves/`.

### 6bis. LE PASSAGE EN A5 (2026-08-22) — et les trois défauts qu'il a révélés

Le papier des quatre certificats est désormais **A5, 148 × 210 mm portrait**,
déclaré dans `@page` : sans `size:`, le navigateur compose pour le format PAR
DÉFAUT DE L'IMPRIMANTE — A4 partout — puis donne la page à un bac chargé en A5,
qui la sort rognée à droite et en bas **sans rien signaler**.

La mise en page n'a **pas** été réduite depuis l'A4 : elle a été recomposée.
`tokens.css` porte maintenant une typographie de document en **points**
(`--doc-texte: 10.5pt`), séparée des jetons `--text-*` de l'interface — ce qui
s'imprime sur une pièce médico-légale ne doit pas changer de taille parce qu'une
carte de l'agenda a été retouchée. Un **budget vertical** est écrit dans le
fichier (120 × 184 mm utiles, dépensés en-tête / titre / corps / signature) : le
modifier sans refaire l'addition est le chemin par lequel un certificat repart
sur deux pages.

Une **réserve de signature de 28 mm** (`--doc-signature`) est posée par la
feuille de style, jamais dans `rendered_html`. Sur A4 le blanc du bas était
acquis ; sur A5 il ne l'est plus, et un traitement un peu long mangeait la place
du stylo.

**Trois défauts trouvés en mesurant, pas en relisant :**

**(a) `.doc-corps p` écrasait `.doc-entete p`.** Même spécificité (0,1,1), et
`.doc-feuille` porte les deux classes : c'est l'ordre du fichier qui tranchait.
Chacune des dix lignes de l'en-tête traînait une marge basse non voulue —
**18 mm sur 184 mm de page utile**, assez pour envoyer deux des quatre
certificats sur une seconde feuille. **Le défaut existait déjà en A4**, où
297 mm de haut l'absorbaient sans qu'il se voie. Même piège sur
`.doc-traitement`, dont le retrait était annulé de la même façon.

**(b) `max-content` sur la colonne du bloc patient.** Elle laissait le bloc
Date/Nom/Prénom/Âge réclamer la largeur de sa plus longue ligne, prise sur la
colonne de gauche : avec un nom de patient long, l'en-tête du cabinet passait de
51 à **89 mm**. La longueur du nom d'un patient ne doit pas pouvoir déformer
l'en-tête de la praticienne — les proportions sont désormais fixées.

**(c) L'instrument de mesure mesurait la fenêtre, pas le papier.** En média
`print`, `.doc-feuille` passe en `width: auto` et prend la largeur de sa
fenêtre. Mesurée dans la fenêtre par défaut de 1280 px, la colonne faisait
339 mm : moins de lignes, hauteur flatteuse, et « tient sur une A5 » sortait
**VERT sur un certificat que le PDF paginait sur DEUX pages**. C'est le
désaccord entre les deux contrôles qui a révélé le défaut. **Quatrième
occurrence de la même leçon que §4 : l'instrument avant le produit.**

**Fidélité aux originaux**, relevée sur les photos du 14/07/2026 : nom et
spécialité **centrés**, bloc arabe centré entre ses deux filets, « N° d'Ordre »
et « Tel » au fer à gauche, bloc patient **aligné à gauche mais posé à droite**
(la version A4 confondait les deux avec `text-align: right`), logo à hauteur du
bloc arabe.

**Nouvel instrument : `scripts/mesure-a5-documents.mjs`.** Il met en page le
`rendered_html` **figé par la base** — jamais une substitution réécrite en
JavaScript, qui serait la seconde vérité que `FeuilleDocument.tsx` refuse — avec
la CSS du build et ses fontes auto-hébergées, sur **données hostiles** (nom
composé de 27 lettres, prénom de 33, arrêt de 365 jours, traitement de
4 lignes, 29 février). Il rend 22 contrôles, dont un **contrôle négatif** : on
vide `signature_block`, et il exige de VOIR le marqueur littéral apparaître.
Sans lui, un détecteur qui n'a jamais rien détecté serait indiscernable d'un
détecteur qui ne cherche pas.

| Certificat | Hauteur / 184 mm utiles | Pages PDF |
|---|---|---|
| bonne santé mentale | 172,8 mm | 1 ✅ |
| suivi médical | 136,0 mm | 1 ✅ |
| certificat médical | 166,8 mm | 1 ✅ |
| justification | 127,5 mm | 1 ✅ |

### 6ter. L'INVARIANT DE SORTIE — zéro marqueur sur le papier

`030 §1quater` laisse **littéral** tout marqueur sans valeur, délibérément :
« un trou invisible dans un certificat est pire qu'un marqueur visible ». Ce
raisonnement est juste **en base**, où le marqueur est un signal lu par
quelqu'un qui sait ce qu'il regarde. **Il ne l'est plus devant une imprimante** :
sur le papier remis à un notaire, `{{praticien.full_name_ar}}` n'est plus un
signal, c'est une pièce abîmée.

L'écran est donc le dernier poste de contrôle. `contientMarqueurNonResolu()`
garde **les trois chemins d'impression** — la colonne de droite, le portail vers
`<body>`, et `window.print()` lui-même. Un écran qui masquerait la feuille mais
laisserait le portail la poser dans `<body>` imprimerait quand même la pièce
trouée, sans que rien ne se voie.

⚠️ **CE N'EST PAS UNE RÉPARATION, ET IL NE FAUT PAS QUE ÇA LE DEVIENNE.**
Substituer ici la valeur manquante, ou effacer le marqueur du HTML affiché,
ferait diverger le papier de `rendered_html` : la pièce figée cesserait d'être
la pièce imprimée, ce que l'immuabilité de `030` protège. La ligne émise reste
**intacte** ; c'est le TIRAGE qui est refusé, et la seule sortie est d'émettre
un nouveau certificat une fois le profil complété.

Le test est volontairement grossier — la présence de `{{` — et non une liste des
25 clés du contexte : une liste devrait suivre 043 et 044, et le jour où elle
prendrait du retard elle laisserait passer justement le marqueur nouveau.
`app.html_escape` échappant déjà `{` et `}`, un `{{` dans le HTML figé **ne peut
pas** venir d'une donnée patiente — il vient forcément du modèle. La garde ne
peut donc pas se déclencher sur un certificat sain.

### 6quater. LES MODÈLES v2 (045) — le texte approuvé, et la clé facultative

> ✅ **045 EST APPLIQUÉE SUR L'INSTANCE** — `bash scripts/db-migrate.sh`, VERT le
> 2026-08-22 : 43 migrations en base, 0 en attente.
>
> ⚠️ **ET ELLE NE L'ÉTAIT PAS AU MOMENT DU COMMIT — L'ÉCRAN A CASSÉ POUR ÇA.**
> Le lot a été écrit, rejoué sur base jetable, mis au vert, puis COMMITÉ sans
> être appliqué à l'instance vivante. L'écran envoyait donc `traitement_1` /
> `traitement_2` à une porte qui attendait encore `traitement`, et
> `issue_document` refusait — un `P0001` que le journal rendait fidèlement mais
> qui ne dit rien de sa cause : « L'enregistrement a été refusé par une règle du
> dossier médical ». Rien n'était cassé dans le code.
>
> **C'est la quatrième fois que ce dépôt marche dans ce trou**, et la mémoire du
> projet le note déjà : « un écran buggé est souvent une migration jamais
> appliquée ». La règle qui en sort, et qui vaut pour tous les lots à venir :
> **un checkpoint vert sur base jetable ne dit RIEN de l'instance.** `db-migrate
> --dry-run` doit être joué AVANT de croire un écran cassé, et AVANT de commiter
> un lot qui change une porte.



`docs/DOCUMENT-TEMPLATES-v2.md`, **approuvé de la main de la praticienne**, avec
quatre maquettes (`docs/*.jpg`), est arrivé le 2026-08-22 et **supplante**
`docs/DOCUMENT-TEMPLATES.md`, retiré du dépôt le même jour. Les quatre corps ont
été réécrits ; la migration **045** sème la version 2 et désactive la version 1.

⚠️ **LES MODÈLES v1 NE SONT PAS SUPPRIMÉS, SEULEMENT DÉSACTIVÉS.**
`document_templates` porte l'historique des versions et `issue_document` prend
« le modèle actif le plus récent ». Les certificats déjà émis gardent leur
`rendered_html` figé : **un document de juillet ne devient pas rétroactivement un
document v2.** C'est tout l'objet de l'immuabilité de 010.

⚠️ **POURQUOI UNE MIGRATION A ÉTÉ NÉCESSAIRE — et elle l'était vraiment.**
v2 §3 veut deux lignes de traitement en puces, « la seconde sans forcer deux
lignes ». Or `issue_document` exige que **chaque** clé du jeu soit présente ET
non vide : `traitement_2` vide était **refusée**. Aucun réglage d'écran ne
contourne une porte SQL — et c'est bien son rôle. 045 introduit donc la notion
de **clé facultative**, et rien d'autre.

**Le corps de la fonction est repris mot pour mot de 043.** Diff des lignes de
code, commentaires exclus, vérifié avant écriture : **quatre changements**, tous
sur la validation des champs. Reprendre plutôt que retaper est délibéré — une
fonction de 400 lignes recopiée à la main est une fonction dont plus personne ne
peut prouver qu'elle n'a pas bougé ailleurs. Aucun `DROP FUNCTION`.

⚠️ **« FACULTATIF » VEUT DIRE VIDE, JAMAIS ABSENT**, et les deux se ressemblent
en JSON pour ne rien avoir à voir sur le papier :
- clé **absente** → `#>>` rend NULL → le marqueur reste **LITTÉRAL** →
  « {{vars.traitement_2}} » s'imprime sur un certificat médico-légal ;
- clé **présente et vide** → `#>>` rend `''` → substitution réelle → `<li></li>`,
  masqué par `li:empty`.

La garantie tient donc sur **trois fichiers qui doivent rester d'accord**, et
aucun ne suffit seul : 045 exige la clé et vérifie que le modèle écrit
`<li>{{vars.traitement_2}}</li>` **collé à ses balises** (contrôle §3(d)) ;
`tokens.css` masque `li:empty` ; `champs.ts` construit le payload **à partir du
contrat** et non des touches frappées, pour que l'absence soit impossible.
Le checkpoint éprouve **les deux faces** — vide accepté sans puce blanche,
absent refusé.

⚠️ **CE QUE v2 FAIT PERDRE, ET QUI N'EST PAS UN DÉTAIL.** `suivi_medical`
n'imprime plus la durée **en toutes lettres**. v1 portait « 30 Jours (trente
jours) », relevé sur le document Word d'origine. Les lettres étaient une
protection **anti-falsification** : un « 30 » se rature en « 90 » au stylo sur un
arrêt de travail présenté à un employeur ; « (trente jours) » à côté rend la
retouche visible. **Cette protection est perdue sur le papier.** C'est le choix
de la praticienne, appliqué tel quel — c'est son document et sa responsabilité
devant un tiers — mais il est écrit ici et dans 045 pour que personne ne le
redécouvre à ses dépens.

Elle n'est pas perdue **en base** : `jours_lettres` reste exigée, reste
recalculée et écrasée par `app.nombre_en_lettres` (043 §5bis), reste dans
`variables`. `042` n'est pas devenue du code mort, et **rétablir les lettres au
papier ne demandera qu'une ligne de modèle**. C'est pour cela que le jeu de clés
de `suivi_medical` n'a pas été allégé.

✅ **« Mlle » est revenue.** v1 dérivait `{{patient.civilite}}` du sexe, qui ne
connaît que Mr et Mme (`app.sex`) — « Mlle » avait disparu, perte acquittée le
2026-08-21. v2 revient au « Mr/Mme/Mlle » littéral de l'original. Le §7(4)
ci-dessous est donc **clos**.

⚠️ **UN CONTRÔLE DU CHECKPOINT A CHANGÉ DE NATURE, ET CE N'EST PAS UN
AFFAIBLISSEMENT DÉGUISÉ.** Il cherchait « trente jours » dans la pièce pour
prouver l'écrasement de 043 §5bis. v2 n'imprimant plus les lettres, cette
vérification **n'est plus possible** — et continuer à la chercher aurait fait
ROUGIR un produit sain. Il vérifie désormais ce qui reste vérifiable et qui est
la vraie garantie : la valeur absurde de l'appelante **n'atteint jamais le
papier**, et le nombre en chiffres imprimé est bien celui soumis. Le recalcul
lui-même reste prouvé par le contrôle 26, sur la fonction.

### 7. ⚠️ CE QUI RESTE OUVERT — V8 N'EST PAS CLOS

**(1) Le profil réel n'est pas saisi sur l'instance. BLOQUANT.** Mesuré le
2026-08-22 sur la base réelle : le profil `owner` a nom, titre, spécialités
FR/AR, n° d'ordre et téléphone, mais **`signature_block.full_name_ar` est vide**.
Le profil `practitioner` (…a2) est plus incomplet encore : ni spécialité arabe,
ni n° d'ordre, ni téléphone. **À saisir sur l'instance, jamais commité**
(ADR-016). C'est aussi là que se règle l'arbitrage **A1** (« Pychiaterie » →
« Psychiatrie »), qui n'est PAS dans 044 : la spécialité vient de `app.profiles`.

⚠️ **CE QUI A CHANGÉ LE 2026-08-22 : LA CONSÉQUENCE.** Avant, le certificat
sortait avec `{{praticien.full_name_ar}}` imprimé sur l'en-tête — « visible
plutôt que muet », et personne n'empêchait de l'imprimer. Depuis §6ter, l'écran
**REFUSE le tirage** et affiche pourquoi. Tant que ce champ est vide, le module
n'imprime rien du tout pour ce praticien. Ce n'est pas un durcissement gratuit :
c'est le seul moyen de tenir l'invariant « zéro marqueur sur le papier » sans
inventer un nom arabe, ce qui reste **interdit** (règle 8).

⚠️ **NON REVÉRIFIÉ LE 2026-08-22 EN SÉANCE DE CLÔTURE.** Le connecteur Supabase
était injoignable depuis le poste ; l'état ci-dessus est celui **relevé plus tôt
dans la journée**, pas une mesure fraîche. À reprendre avant le tirage. Le
contrôle négatif de `mesure-a5-documents.mjs` prouve en revanche, sur base
jetable, **exactement** ce qui se produit si le champ est encore vide.

**(2) Le tirage papier n'a pas eu lieu. BLOQUANT.** Les marges
(`--doc-marge-v: 13mm` / `--doc-marge-h: 14mm`, tokens.css) sont une
**hypothèse**, pas une mesure. Le contrôle est « poser le papier à côté du
sien ».

⚠️ **TROIS ÉTATS D'ACCEPTATION, QUI NE SE CONFONDENT PAS.**
· **Valide au navigateur** — l'aperçu d'impression est juste. **ATTEINT** :
  22/22 à `mesure-a5-documents.mjs`, PDF à 148 × 210 mm, une page par
  certificat, sur données hostiles.
· **Valide au papier** — le tirage A5 physique est juste. **NON ATTEINT.**
  Aucune feuille n'est sortie d'une imprimante. Chromium ne dit rien des marges
  non imprimables du bac ni de la mise à l'échelle du pilote.
· **Valide en production** — le parcours complet avec le profil réel ET le
  papier approuvé. **NON ATTEINT**, il dépend des deux précédents.

**À vérifier physiquement, une feuille A5 en main, à côté d'un certificat de la
praticienne :** que le bac soit bien réglé sur A5 et non sur « ajuster à la
page » (une mise à l'échelle du pilote fausserait tout le reste) · que rien ne
soit rogné à droite ni en bas · que les 13/14 mm de marge tombent comme sur son
document · que le corps du texte se lise sans effort à taille réelle (10,5 pt) ·
qu'il reste **assez de blanc en bas pour sa signature** · que l'en-tête arabe ne
touche pas ses filets · que le bloc Date/Nom/Prénom/Âge soit là où elle
l'attend. Chacun de ces points se corrige par **une ligne** de `tokens.css` :
les jetons existent pour ça.

**(3) Le logo n'est pas celui des certificats.** `public/marque-certificat.svg`
est employé sur décision de la praticienne du 2026-08-21, alors que
`DOCUMENT-TEMPLATES.md:41` établit que le logo d'origine est un autre dessin
(cercle plein, arbre/cerveau dans une main), jamais fourni en fichier source.
**Écart assumé, à redire de vive voix au contrôle papier** — un écart qu'on
cesse de mentionner devient un fait acquis.

✅ **BLOCAGE LEVÉ LE 2026-08-22 — PAR LA PRATICIENNE, PAS PAR UN ARBITRAGE
D'AGENT.** Les quatre maquettes v2 qu'elle a approuvées portent **exactement**
`public/marque-certificat.svg` — le cerveau de feuilles, dans son turquoise
`#7bb5ac`. Vérifié en rendant le SVG et en le comparant aux `docs/*.jpg`. C'est
donc elle qui a tranché, en composant ses modèles autour de ce fichier : il n'y a
plus d'« autre logo » à réclamer, et le §14 du contrat de session est satisfait.

Le côté a été porté à **18 mm** pour tenir la proportion des maquettes. **Ni le
dessin ni la couleur n'ont été retouchés**, et il ne faut pas le faire : foncer
le turquoise « pour que ça ressorte mieux » serait inventer une identité visuelle
qu'elle n'a pas validée. S'il sort trop pâle au tirage, c'est un constat à lui
rapporter — pas une valeur à corriger dans `tokens.css`.

**(4) « Mlle » a disparu. ✅ CLOS LE 2026-08-22 par les modèles v2.** `app.sex`
(002) est un enum à deux valeurs, donc `{{patient.civilite}}` ne pouvait rendre
que Mr ou Mme. v2 revient au « Mr/Mme/Mlle » littéral de l'original et rend les
trois. `patient.civilite` reste dans le contexte de rendu, simplement inutilisée
par les modèles — on n'enlève rien au moteur (voir §6quater).

**(5) `certificat_medical` demande toujours `date_naissance` en saisie** alors
que la base la connaît (contrat gelé de `030`, non modifié par 045 — qui ne
touche QUE ce que v2 rendait impossible). Le formulaire la **pré-remplit** depuis
le dossier ; le papier imprime `{{patient.birth_date_fr}}`, et la valeur soumise
reste dans `variables` comme confirmation explicite. Incohérence du contrat,
signalée, **pas corrigée en douce**.

**(6) Les reçus (`recu` dans `app.doc_type`) sont hors périmètre.** Décidé pour
la phase suivante. L'ajouter à l'enum exigera son propre jeu de champs dans
`issue_document`, faute de quoi le garde de `030` refusera d'émettre.

### 8. Gotchas rencontrés, pour la prochaine session

- **`preflight.sh` §6ter interdit TOUT `.css` hors `tokens.css`**, dans tout le
  dépôt. Ce lot a créé un `print.css` ; le preflight l'a attrapé. Ce n'est pas
  une convention d'organisation : ESLint ne parse pas le CSS, donc aucune règle
  I10 ne s'y applique. La feuille de document vit désormais **dans tokens.css**.
- **`next dev` et `next start` se disputent `.next/`.** Lancer un serveur de
  développement pendant qu'un serveur de production tourne corrompt le build de
  ce dernier : la mesure suivante échoue à l'hydratation, sans dire pourquoi.
- **`TaskStop` ne tue pas le processus Node** qui tient le port : le shell meurt,
  le serveur reste. `netstat -ano | grep :3000` puis `taskkill //PID … //F`.
- **`scripts/guard-bash.sh` bloque `curl`** depuis le shell (règle 1). Pour
  attendre qu'un serveur soit prêt, lire son journal, pas l'interroger.
- **Le seed 015 laisse `sex` et `birth_date` vides sur b1/b2.** Sans conséquence
  tant qu'aucun modèle n'en dérivait ; **bloquant depuis 043**. Les checkpoints
  les complètent dans leur propre transaction, jamais dans un seed livré.
- **Insérer un patient de fixture exige `is_synthetic = true`**
  (`assert_synthetic_when_cloud`, ADR-016) **et** `practitioner_id` + `phone`,
  tous deux `NOT NULL`. Le garde a bloqué la première version de la fixture A5 :
  il fonctionne.
- **Deux `pnpm build` simultanés se corrompent l'un l'autre.** Un lancé pendant
  qu'un autre tourne rend ROUGE sans message utile, et laisse un `.next` partiel
  qui casse aussi le serveur qui le servait. Bâtir **en série**, toujours.
- **`.next` est partagé par le serveur qui tourne.** Reconstruire pendant qu'un
  `next start` sert la même arborescence lui fait rendre des `MODULE_NOT_FOUND`
  en 500. Arrêter le serveur, bâtir, relancer.
- **`page.pdf({preferCSSPageSize:true})` est le SEUL contrôle qui lit `@page`.**
  Une mesure du DOM, si soignée soit-elle, ne pagine pas : une régression
  remettant `size: A4` passerait tous les contrôles DOM au vert.

---

## ✅ 2026-08-21 — V7-CAISSE : le défaut d'écriture, les charges, l'écran

### 1. LE DÉFAUT D'ÉCRITURE — pourquoi des séances n'atteignaient pas les Finances

**Cause racine, trouvée en base, pas devinée.** `app.consultations` NE PORTE AUCUNE
COLONNE DE PRIX. Une ligne de `app.payments` naît par UN SEUL chemin :
`app.set_consultation_price` (029), appelée depuis le bloc tarif. Or
`app.close_consultation` (026) ne regardait JAMAIS `app.payments` : **rien n'appariait
la clôture au tarif**. Une séance close avant la saisie du tarif n'avait donc pas de
paiement — et comme tout l'écran Finances lit `app.payments`, elle en était invisible
**définitivement, sans qu'aucun écran ne signale l'omission**.

Ce n'était donc pas aléatoire : ça dépendait de l'ordre des gestes.

**Correctif — `037_close_requires_tarif.sql`.** `close_consultation` refuse la clôture
sans ligne de paiement, en français, avec un renvoi au bloc tarif. On ne fabrique PAS
un tarif par défaut (règle 8) : une séance offerte se saisit explicitement à **0**
(ADR-018, `amount_dzd >= 0`).

**⚠️ DEUX PISTES ÉCARTÉES APRÈS VÉRIFICATION**, à ne pas rouvrir :
- `set_consultation_price` rend `NULL` hors périmètre — c'est **voulu** (ADR-003 : pas
  d'oracle d'existence), et `BlocTarif` traite déjà ce `null` comme un échec lisible.
  Y poser une exception FABRIQUERAIT la fuite que la porte évite.
- `app.close_stale_consultations` (032) clôt en lot sans regarder les paiements. Elle
  n'a **aucun appelant** dans le dépôt. Laissée telle quelle : la retoucher casserait
  le garde-fou `one_open_consult` qu'elle existe pour desserrer. **Si un jour on
  l'appelle, elle rouvrira le défaut.**

**Preuve** : `scripts/test-chemin-ecriture-finance.sql` — 9 contrôles, transaction
annulée. T1 clore sans tarif refusé · T2 refus atomique · T3 tarif puis clôture · T4a
tarifée non encaissée = impayé et NON recette · T4b visible dans Séances & paiements ·
T4c encaissée → recette du jour · T5 séance offerte à 0 clôturable · T6 séance inconnue
→ NULL · T7 aucune fixture rémanente.

### 2. COMPTABILITÉ DE CAISSE — un seul chiffre de recette

Le cabinet est **au comptant**. V6 modélisait `facturé / encaissé / en attente / taux
d'encaissement` sur deux fenêtres de dates : un cabinet qui facture puis se fait payer.
**Cet axe n'existe pas ici** et occupait la moitié de l'écran. La recette est désormais
`app.payments` fenêtrée sur `collected_at`, point. Les impayés restent des EXCEPTIONS :
panneau Attention et onglet Séances & paiements, jamais un second total en tête d'écran.

`app.finance_overview` et `app.list_period_payments` (036) sont **laissées en place et
intactes** — l'écran ne les appelle plus. Les retirer est un ménage ultérieur.

### 3. Migrations posées

| # | Objet |
|---|---|
| `037_close_requires_tarif` | clore exige un tarif (le correctif ci-dessus) |
| `038_charges` | table `app.charges`, 3 enums, RLS + audit, 3 portes CRUD, amorce **gated `is_cloud_dev()`** |
| `039_finance_cash` | `get_finance_overview` · `get_charges_list` · `get_sessions_payments_list` |
| `040_finance_cash_correctifs` | libellés de mois en français (`TMMon` suivait la locale serveur) ; `plus_ancien_impaye_jours` 0 au lieu de NULL |
| `041_charges_recurrentes_comptees` | `pulse.nb_charges_recurrentes` compté en SQL |

**Écarts assumés vs la commande, et pourquoi :**
- `montant_dzd integer`, pas `numeric(12,2)` — ADR-018/CLAUDE.md §4 : dinars entiers,
  aucun centime. La règle du dépôt prime sur la spec de la tâche.
- L'amorce des 7 charges est **conditionnée à `app.is_cloud_dev()`** (règle 8) : une base
  de production n'en reçoit aucune. Identité de la praticienne résolue par requête.
- `cabinet_id` + `is_synthetic` ajoutés au schéma demandé, pour rester alignés sur le
  reste de la base et le garde de 016.

**Règle d'imputation des charges** (en SQL, commentée dans `charge_equivalent_mensuel`) :
ponctuelle = entière sur la période de sa `date_charge` ; récurrente = part mensuelle
normalisée (mensuelle ×1, trimestrielle ÷3, annuelle ÷12), proratisée au jour sur chaque
mois traversé.

### 4. QUATRE PIÈGES MESURÉS, qui coûteront cher à quiconque les réapprend

**`tailwind.config.ts` REMPLACE les échelles du cœur, il ne les étend pas.** Une classe
absente ne produit **aucune erreur** : elle ne fait simplement rien.
- `grid-cols-1/2/3/5` n'existent pas → les cinq tuiles s'empilaient au lieu de former
  une rangée. Ajoutés comme gabarits nommés : `un · deux · trois · pouls · finance`.
- `h-px` / `w-px` n'existent pas → le masquage lecteur-d'écran ne masquait pas.

**L'échelle `spacing` est fermée : 0·1·2·3·4·5·6·8·10·12·16.** Toute classe
FRACTIONNAIRE — `h-1.5`, `gap-2.5`, `py-1.5`, `h-0.5` — ne produit **aucune
règle**, en silence. Symptôme mesuré : les barres du panneau Anatomie avaient
une hauteur nulle et étaient donc **totalement invisibles**, alors que le
composant, le typecheck et le lint étaient verts. 23 occurrences ont été
corrigées d'un coup dans le module Finances. **C'est la troisième fois que ce
même piège casse silencieusement du travail dans ce lot** — après
`grid-cols-*` et `h-px`. Avant d'écrire une classe d'espacement, vérifier
qu'elle existe dans `tailwind.config.ts`.

**`height` sur un `<table>` est un MINIMUM, pas un maximum.** Le tableau équivalent du
calendrier (31 lignes) mesurait 856 px et rallongeait `<html>` de **761 px** : la page
défilait alors que `<main>` tenait dans l'écran, et la cause était invisible puisque
l'élément fautif est caché par construction. `CACHE_VISUELLEMENT` est désormais une
**vraie classe CSS** (`.cache-visuellement`, tokens.css), à poser sur un `<div>` enveloppe.

**Le conteneur qui défile est `<main>`, pas `documentElement`.** Un instrument qui ne
mesure que le document rend vert sur un écran qui défile sous les yeux de la médecin.

### 5. Ce qui a été mesuré — `node scripts/mesure-finances-caisse.mjs`

```
9 verts · 0 ROUGE · 0 BLOQUÉ         (build de PRODUCTION, compte owner …a1)
  1440×900 ....... 0 px de débord vertical
  1280×720 ....... 0 px vertical, 0 px horizontal
  1 seul appel de données par onglet (3 onglets vérifiés)
  aucun « facturé / encaissé / objectif » à l'écran · aucun NaN
  période sans donnée → état vide propre
```

**Porte `get_finance_overview` mesurée en base : 59–94 ms** (round-trip pooler compris ;
~80 ms sur une période de 366 jours). Budget de 400 ms **tenu**.
Chargement complet de la page : ~1,0 s — session + coquille comprises, hors budget RPC.

Autres portes : `preflight` vert · `typecheck` · `lint` · `test-finance-calendrier` 26 verts ·
`checkpoint-v3` **16 verts, 0 rouge**.

⚠️ `checkpoint-v3.sh` attendait **4** familles de fontes ; le seuil est passé à **6**
(ajout d'**Inter** et **Fraunces**). C'est un **arbitrage explicite de la médecin qui
prime sur ADR-022** — le seuil a été relevé, pas le contrôle contourné. Coût réel
mesuré : 26 → **36 fichiers `.woff2`** auto-hébergés.

### 6. Non fait, et pourquoi

- **Les boutons « Reçu » et « Relancer »** de l'onglet Séances & paiements sont des
  gestes **sans porte en base** : aucune n'existe pour émettre un reçu ni tracer une
  relance. Ils sont câblés à vide plutôt que de simuler une action (règle 8). À ouvrir
  comme lot propre.
- **L'écran de séance n'empêche pas encore le geste** : c'est la BASE qui refuse la
  clôture sans tarif, avec un message lisible que le chemin d'erreur existant affiche.
  La barrière est au bon endroit (règle 4) ; l'ergonomie « bouton désactivé tant que le
  tarif manque » demanderait de remonter l'état du paiement dans la page — hors périmètre.

---

## ✅ ÉTAT AU 2026-08-21 — V6-FINANCE, VERT ET MESURÉ

**Périmètre : revenus seuls** (D-23). Ni charges, ni résultat net, ni objectifs —
les cinq dettes correspondantes sont datées dans `DOC-AUTHORITY.md` §4.

### Verdict brut — `bash scripts/checkpoint-v6-finance.sh`

```
VERDICT V6-FINANCE : 11 verts · 0 rouges · 0 bloqués critiques · 4 bloqués par décision
V6-FINANCE EST VERT — aux QUATRE réserves NOMMÉES, et à elles seules.       (exit 0)

  preflight · typecheck · lint
  calendrier financier ......... 26 assertions (fuseau, bornes, bissextiles)
  vérité en base ............... 54 contrôles, 3 rôles, fixtures ANNULÉES
  écran /finances .............. 18 contrôles au navigateur réel
  aucun test de rôle dans l'écran · aucun montant journalisé
  checkpoint-v3 ................ 16 verts — le design v2 n'a PAS régressé
  pnpm build ................... /finances 7.99 kB · 0 dépendance ajoutée
```

### LE DÉFAUT QUE CE LOT CORRIGE — un mot faux sur une caisse

L'écran affichait `day_revenue.total_dzd` — la somme de TOUS les tarifs du jour,
**encaissés ou non** — sous le titre **« Recette du jour »**, immédiatement au-dessus
d'une ligne « Encaissements en attente ». Une recette est de l'argent reçu.

Le chiffre était juste. Le mot était faux. Et un mot faux sur une caisse se recopie
dans un carnet. Il y a désormais quatre chiffres NOMMÉS : **Facturé · Encaissé ·
En attente · Taux d'encaissement**, et le contrôle au navigateur vérifie que
« Recette du jour » a bien disparu de l'écran.

### Deux « encaissé » coexistent, et les confondre était un second défaut

Trouvé en écrivant les cartes, corrigé avant toute mesure :

| | fenêtre | ce que ça répond |
|---|---|---|
| **Encaissé** (carte) | `collected_at` | ce qui est ENTRÉ en caisse, même pour des séances plus anciennes |
| **dont … encaissé** | `created_at` | de ce qui a été FACTURÉ sur la période, ce qui a été reçu |

Seul le second se soustrait du facturé (**I-1**). Il est donc affiché en
DÉCOMPOSITION sur la carte « Facturé » dont il est la ventilation — et non comme une
troisième carte voisine. Les poser côte à côte aurait donné trois grands chiffres qui
ne s'additionnent pas, sans que rien à l'écran ne dise pourquoi.

### Ce qui a été livré

| Lot | État |
|---|---|
| `036_finance_period_gates.sql` — 2 portes + 1 fonction pure + 1 index partiel | ✅ appliquée |
| `app.finance_overview(date,date)` — TOUT l'écran en UN appel (PERF §3) | ✅ |
| `app.list_period_payments(…)` — journal paginé, trace bornée à la page | ✅ |
| `app.finance_variation(…)` — `pourcentage` NULL quand le précédent est 0 | ✅ |
| `payments_cabinet_collected` — `collected_at` n'était indexé NULLE PART | ✅ |
| `finance-calendrier.ts` (pur, testable seul) + `finance-periode.ts` (Zod + invariants) | ✅ |
| 8 composants sous `src/components/finance/` | ✅ |
| Sélecteur de période — groupe radio, 5 options, URL synchronisée | ✅ |
| 3 visualisations, chacune doublée d'un `<table>` légendé dans le DOM | ✅ |
| `Bouton` gagne `deploye` → `aria-expanded` (primitive étendue, pas contournée) | ✅ |
| `--chart-min-width` — jeton de dimension, pas une valeur arbitraire | ✅ |

**Zéro dépendance ajoutée.** Aucune bibliothèque de graphiques : les barres sont des
`<rect>`, les répartitions des `div` en pourcentage. Aucun lanceur de tests installé —
le test unitaire compile avec le `tsc` déjà présent.

### 🔴 DÉFAUT RÉEL TROUVÉ EN MESURANT — contraste 2.32:1 sur le calendrier

`mesure-v3-navigateur.mjs` a relevé **« 13 » → 2.32:1**, blanc sur `--brand-400`.
Ma première rampe posait `text-on-brand` dès le palier 3. Or `--brand-400` est le teal
du LOGO, et `tokens.css` le disait déjà — « JAMAIS du texte sur blanc » ; la réciproque
valait tout autant. Seul `--brand-600` porte du blanc (5.10:1). Les trois paliers clairs
prennent `--ink-900` (~8:1).

**C'est exactement la leçon de `--ink-300` et de `--attention` en V3** : une couleur
« a l'air » lisible et ne l'est pas. Un contraste se calcule. L'instrument l'a attrapé,
pas la relecture.

### 🔴 TROIS FAUX VERDICTS FABRIQUÉS PAR MES PROPRES INSTRUMENTS

Aucun n'était un défaut du produit. Tous les trois sont écrits ici parce qu'ils se
refabriquent tout seuls à la session suivante.

**1 · Faux ROUGE — « 0 trace d'audit écrite ».** Le contrôle comptait
`SELECT count(*) FROM audit.log` **depuis le rôle testé**. Or `audit_read_owner` (013)
ne donne le SELECT qu'à l'owner : sous …a2, le compte rendait 0 — non pas parce que la
trace n'existait pas, mais parce que la praticienne **ne peut pas la lire**. La porte
traçait correctement (1 trace pour 4 lignes / 1 patiente distincte). Corrigé par un
compteur `SECURITY DEFINER` qui ne sert qu'à mesurer.
→ *Un faux rouge se débusque plus mal qu'un faux vert : il inspire confiance.*

**2 · Faux ROUGE — « la cloison a fuité en JavaScript ».** Le contrôle grepait
`role ===` sans ôter les commentaires. Il comptait la ligne où l'écran ÉNONCE la règle
qu'il respecte. La « correction » évidente aurait été d'effacer l'explication. Corrigé
par le motif `sans_commentaires` de `checkpoint-v3.sh`. Même cause pour le préflight, qui
comptait une valeur hexadécimale citée dans un commentaire expliquant un défaut de
contraste : le commentaire nomme désormais le JETON.

**3 · Faux ROUGE ET faux BLOQUÉ — deux exigences contradictoires dans `checkpoint-v3.sh`.**
Sa mesure au navigateur EXIGE un serveur de développement vivant ; son `pnpm build` final
EXIGE qu'aucun serveur n'écrive dans `.next`. V3 documente un seul sens (« le build casse
le serveur »). **L'autre n'était écrit nulle part : un serveur vivant CASSE LE BUILD**,
qui meurt sur `Cannot find module for page: /_not-found/page` — un message qui accuse une
page que personne n'a touchée.

```
serveur vivant  → mesure verte, build ROUGE   (faux : le même build passe seul)
serveur arrêté  → build vert, 6 écrans NON OBSERVÉS → exit 2  (faux aussi)
```

`checkpoint-v6-finance.sh` sépare donc les deux : **5a** lit les contrôles de V3 avec le
serveur vivant, **5b** arrête le serveur puis construit. Chacun est mesuré dans la
condition où sa mesure veut dire quelque chose. Ni l'un ni l'autre n'est « arrangé ».

### Ce que la donnée réelle NE permet PAS de conclure — n = 2

La base porte **deux paiements**, tous deux à …a1 (owner), 7 000 DZD, août 2026.
Les dix contrôles de qualité sont propres (0 trou de numérotation, 0 incohérence de
date, 0 ligne non synthétique). **Et ça ne prouve rien** :

- **« Non rattaché » à 0,0 % est un accident, pas un résultat.** Deux paiements dont les
  deux chaînes sont complètes ne disent rien de la troisième. La porte de décision du
  plan (> 40 % ⇒ arrêt) a été franchie **sans avoir été éprouvée**. Le seau existe quand
  même, et c'est lui qui fera tenir I-2 le jour où la chaîne cassera.
- **Toute comparaison rend « — »** : aucune période antérieure n'a de paiement.
- **`audit.log` ne porte aucune correction de montant** : le point d'attention
  correspondant est constructible mais **jamais exercé** en l'état.
- **La densité visuelle n'est pas jugeable.** « Est-ce lisible en cinq secondes ? »
  demande un mois réel (`MODULE-MAP.md` §2). Ce qui EST validé : la vérité des chiffres,
  la cloison, l'accessibilité, le budget. Pas l'esthétique d'une courbe à deux points.

C'est pourquoi les invariants sont prouvés par des **fixtures posées DANS la transaction
du checkpoint puis annulées** (règle 8) — mars 2025, cinq paiements, dont un couple qui
encadre minuit à Alger. Aucun paiement de démonstration n'entre dans `015`.

### Budget de performance — ce qui est MESURÉ, et ce qui reste ouvert

```
APPELS DE DONNÉES DE L'ÉCRAN ....... 1   (budget §2 : 1)   ✅ vert, contrôlé
  → /rest/v1/rpc/finance_overview, et rien d'autre
```

Le journal des paiements est un SECOND appel, mais §3 l'autorise nommément : il
« dépend d'un choix de l'utilisatrice ». Il est replié au chargement et son ouverture
écrit une trace d'audit — raison de plus pour qu'il ne parte jamais tout seul.

**⚠️ LES DEUX DURÉES SONT RELEVÉES, PAS ENCORE JUGÉES.** Premiers relevés en
`next start` : écran complet entre **549 et 1200 ms**, contre un budget §2 de 400 ms.
Le chiffre pose une vraie question — mais elle ne porte PAS sur cet écran, qui n'émet
qu'un appel. Elle porte sur la COQUILLE et sur la latence Alger↔UE que §5 nomme
explicitement (~180 ms par aller-retour depuis le cloud). En faire un contrôle PASS/FAIL
maintenant ferait échouer la porte sur une cause qu'elle n'expose pas, et pousserait le
prochain agent à corriger le mauvais endroit. **Décision : relever, écrire, trancher en V4.**

**DETTE ANTÉRIEURE RELEVÉE AU PASSAGE — la coquille émet 3 appels par écran**
(`deployment`, `profiles`, `get_open_consultation` ; 6 en `next dev`, StrictMode
doublant les effets). C'est exactement la cascade que `06-PERF-BUDGET.md` §3 décrit
comme le défaut à corriger. Antérieure à ce lot, non corrigeable ici sans toucher toute
l'application (règle 10). L'instrument SÉPARE les deux factures : un rouge global aurait
accusé les finances d'un coût qui n'est pas le leur, et masqué le seul chiffre qui l'est.
Sortie : `app.dashboard_today` (V4) + un contexte de session partagé.

### Les CINQ états, DÉCLENCHÉS — pas seulement écrits

`05-UX-CONTRACT.md` §1 : « un état qu'on ne sait pas déclencher est un état qu'on n'a pas
écrit. » Les cinq sont provoqués par l'instrument et capturés :

| État | Provoqué comment | Preuve |
|---|---|---|
| CHARGEMENT | premier rendu, avant la porte | squelette à la forme du contenu |
| CONTENU | session owner, période peuplée | `finances-1440.png` |
| VIDE | session praticienne — aucun paiement à elle | état vide honnête, jamais un refus |
| ERREUR | porte forcée à répondre 500 | `finances-etat-erreur.png` |
| HORS LIGNE | réseau coupé sous une page VIVANTE | `finances-etat-hors-ligne.png` |

⚠️ **HORS LIGNE ne se mesure pas en rechargeant.** Hors ligne, le document n'arrive pas :
React ne démarre jamais et le navigateur affiche SA page d'erreur — on ne mesurerait que
Chromium. Il faut couper le réseau sous une page déjà vivante, puis provoquer une lecture.
C'est aussi la situation réelle du cabinet, dont le Wi-Fi tombe **pendant** l'usage.

Et le contrôle qui compte : **ERREUR REMPLACE le contenu** — ni état vide, ni chiffres
périmés en dessous. C'est la capture d'écran de `/finance` qui a fait naître tout le
contrat `05-UX-CONTRACT.md`. Elle ne se reproduit plus, et c'est mesuré.

### La cloison, mesurée des deux côtés

Le même écran, le même jour, deux rôles :

```
…a2 praticienne → « Vos séances uniquement » · aucune séance · état vide honnête
…a1 owner       → « Toutes les séances du cabinet » · 7 000 DZD
                  I-1 lu À L'ÉCRAN : 7000 = 7000 + 0
…a3 assistante  → NULL, et AUCUNE exception (029 §4) — un écran vide, jamais un refus
```

### ADR-016 — fenêtre …a1 rouverte pour la mesure, puis REFERMÉE

Ouverte par `dev-account.sh` (garde-fou `cloud-dev` vert) le temps de mesurer l'écran
peuplé — les deux paiements lui appartiennent, une praticienne ne voit rien. Refermée par
`dev-account-fermer.sh` : `…a1` porte de nouveau la sentinelle de `015:34`.
**`…a2` reste OUVERT** — `checkpoint-v3.sh` mesure sous ce compte, le refermer bloquerait
la base de non-régression.

### Reste ouvert

1. **V4 (tableau de bord) et V5 (patients & agenda) restent dus, entiers** — D-23 ne les
   absorbe pas. `app.dashboard_today` lira la même vérité que `finance_overview`.
2. **`035` reste réservé** au correctif d'ordre de `app.search_patients`. Ce lot a pris `036`.
3. Le seau « Non rattaché » et les points d'attention attendent **un mois de données
   réelles** pour être autre chose que du code non exercé.

---

## ✅ ÉTAT AU 2026-08-20 — V3 « DESIGN v2 », VERT ET MESURÉ AU NAVIGATEUR

**HEAD `ff1303b`.** L'en-tête précédent de ce fichier décrivait un état ANTÉRIEUR à ce
commit (il annonçait le correctif de fuseau « non commité » alors qu'il l'est) : corrigé
ici. La section V2 ci-dessous reste valable pour tout le reste.

### Verdict brut — `bash scripts/checkpoint-v3.sh`

```
VERDICT V3 : 16 verts · 0 rouges · 0 bloqué critique · 3 bloqués par décision
V3 EST VERT — aux TROIS réserves NOMMÉES, et à elles seules.             (exit 0)
```

**Les deux derniers bloqués ont été levés par la MESURE, pas par décret.** La fenêtre
ADR-016 a été rouverte sur autorisation explicite (`bash scripts/dev-account.sh`,
garde-fou `cloud-dev` vert), et `mesure-v3-navigateur.mjs` pilote désormais un vrai
Chromium EN SESSION AUTHENTIFIÉE :

```
/connexion 7 · / 42 · /patients 42 · /agenda 164 · /finances 44 · /agenda/nouveau 43
337 textes mesurés · 0 sous le plancher · 0 écran NON OBSERVÉ
rail 248px · actif « Patients » avec lueur · orbe --grad-orb · héros --grad-brand
repli < 1024 : rail 72px · Geist réellement appliquée
prefers-reduced-motion : 0 animation vivante
clavier : 4 arrêts dans le rail, 0 sans focus visible, anneau rgb(255,255,255)
```

Preuves : `checkpoints/v3-preuves/` — captures des 6 écrans + `rapport.json`.

⚠️ **RIEN N'EST COMMITÉ.** L'arbre de travail porte V3 en entier.

Verts : preflight · typecheck · lint · build · aucun hex hors `tokens.css` · aucun
`teal-` résiduel · aucun blanc atténué · aucun 4ᵉ dégradé · exactement 3 dégradés
déclarés · union discriminée de `Carte` intacte · `prefers-reduced-motion` déclaré ·
**26 `.woff2` auto-hébergés** · 4 familles câblées · **0 URL Google dans le CSS émis**.

### Ce que V3 a livré

| Lot | État |
|---|---|
| Palette v2 ADR-022 (`--brand-*`, accents, 3 dégradés) | ✅ `teal-` → 0 occurrence |
| Jetons de RÔLE (`--action-*`, `--ai-*`, `--info-*`) au-dessus de la palette | ✅ |
| Fontes `next/font/google`, 4 familles, zéro réseau à l'exécution | ✅ mesuré |
| Rail de navigation signature (`--grad-auth`, état actif, repli en icônes < 1024px) | ✅ **observé** — 248px, repli à 72px |
| Jeu de 16 icônes dessinées à la main + mark du logo, **zéro dépendance** | ✅ |
| `EnTeteEcran` héros + `PastilleIcone` + famille `Carte` à `niveau` | ✅ |
| Orbe Jarvis (`--grad-orb`, `--glow-ai`), état vide composé | ✅ **observé** au navigateur |
| `scripts/checkpoint-v3.sh` + `scripts/mesure-v3-navigateur.mjs` | ✅ |

### 🔴 DÉFAUT RÉEL TROUVÉ EN MESURANT — `--attention` illisible, ANTÉRIEUR À V3

`--attention` (#b8763a) sur `--attention-bg` rend **3.34:1**, sous le plancher de 4.5:1.
Relevé au navigateur sur les cinq écrans à la fois : c'est le titre du bandeau
« Données fictives », **le texte chargé de dire que les dossiers ne sont pas réels**.
Sur blanc il ne fait pas mieux : **3.69:1**. Tous ses usages en TEXTE étaient donc sous
le plancher, depuis `04-DESIGN-SYSTEM`, sans que personne l'ait jamais calculé.

Les deux autres paires sémantiques ont été vérifiées dans la foulée et PASSENT :
`--positive` 4.56:1, `--critical` 5.74:1. L'ambre était seul en cause.

**Corrigé par ajout, pas par modification :** `--attention-ink: #8a5325` (5.67:1 sur
`--attention-bg`, 6.28:1 sur blanc) porte le TEXTE ; `--attention` reste l'ACCENT
(bordure, liseré, point de légende), donc la sémantique clinique d'ADR-022 est
inchangée. Même patron que `--ai-600` face à `--ai-500`.

### 🔴 `--ink-300` N'EST PAS UNE ENCRE DE TEXTE — 2.43:1, 84 fois sur `/agenda`

Trouvé **uniquement parce que la session authentifiée a enfin ouvert l'agenda**. Les
compteurs « 0 séance », le mot « libre » des créneaux vides, et **un nom de
praticienne**. Défaut ANTÉRIEUR à V3 (S4) : l'intention écrite dans le code (« un jour
vide s'efface », « un créneau libre doit se faire oublier ») était juste — mais
s'effacer et devenir illisible ne sont pas la même chose, et à 2.43:1 c'est le second.
Personne ne l'avait calculé, parce qu'un gris clair *a l'air* discret plutôt que cassé.

`--ink-500` (5.70:1) partout où le jeton portait du TEXTE. `--ink-300` garde tous ses
emplois non textuels : filets au survol, pastille de puce, bordure de case, invite de
champ vide. La hiérarchie se fait DANS la plage lisible.

### 🔴 `min-h-0` N'EXISTAIT PAS — une classe inerte, en silence

`tailwind.config.ts` REMPLACE l'échelle `minHeight` par les deux cibles
d'accessibilité. `min-h-0` ne produisait donc **aucune règle CSS** — sans avertissement
de build, sans erreur de type, sans rien. Or `min-height: auto` interdit à un enfant
flex ou grille de descendre sous la hauteur de son contenu : la grille de l'agenda
faisait grandir sa colonne, donc sa rangée, donc **le rail à 1359 px pour une fenêtre
de 1080**, et « Se déconnecter » se retrouvait à 1342 — hors de vue.

Trois correctifs plus naïfs ont échoué avant celui-ci (ancrer le bloc hors du
défilement, `max-h-screen`, `grid-rows-1`) : tous butaient sur la même cause, qu'aucun
ne touchait. **Une classe qui n'existe pas est plus dangereuse qu'une classe fausse :
rien ne la signale.** `0: "0px"` ajouté à l'échelle, avec la raison écrite sur place.

### 🔴 LE RENOMMAGE 1:1 CASSAIT UN CONTRASTE

`--teal-400` → `--brand-400` aurait mis le libellé blanc du bouton de connexion à
≈ 2.2:1 **pendant l'envoi** — lisible au repos, illisible exactement pendant qu'il
annonce « Connexion en cours… ». Deux rampes de clartés différentes ne se mappent pas
au numéro. Passé à `--brand-500`.

### 🔴 LE BLANC ATTÉNUÉ EST IMPOSSIBLE SUR LA MARQUE

Un jeton `--on-brand-muted` a existé le temps d'être mesuré le long de `--grad-brand` :
**4.50:1 à l'arrêt sombre, 2.11:1 au milieu**. Même à 0.85, l'arrêt clair échoue
(4.18:1). Jeton RETIRÉ. *Le contraste d'un texte sur un dégradé varie le long du
dégradé ; le mesurer en un seul point ne prouve rien.* Sur la marque : une seule encre,
le blanc pur — la hiérarchie se fait à la taille et à la graisse.

### ⚠️ DEUX DÉFAUTS DE L'INSTRUMENT, pas du produit

1. **« rail absent » sur un produit intact.** `waitForTimeout` au lieu d'attendre le
   rail : la sonde tombait sur le squelette de chargement, qui ne rend qu'un `<main>`
   nu. La capture prise 200 ms plus tard montrait le rail au complet.
2. **`EXIT=0` faux** en lisant `$?` derrière un `| tail` — c'est le code de `tail`.

### ⚠️ LES PASTILLES « BIENTÔT » CRIAIENT PLUS FORT QUE LES ÉCRANS QUI MARCHENT

Neuf mentions en majuscules grasses sur pastille dominaient la navigation : l'œil y
allait avant d'aller aux trois écrans utilisables. Contresens exact de la décision Q12,
qui les veut visibles et ASSUMÉES, pas hurlantes. Calmées par la TAILLE et la GRAISSE
(bas de casse, graisse normale, pas de pastille) — **jamais par le contraste**.

### QUATRIÈME DÉGRADÉ TROUVÉ — composé de jetons légitimes

`FormulaireConnexion` composait à la main un dégradé `--brand-050 → --card` sous la
carte de connexion. **Écrit avec des jetons, donc invisible au contrôle « aucun hex en
dur »** — et pourtant un 4ᵉ dégradé, là où ADR-022 ferme la liste à trois.
*Ce qui est fermé, c'est la LISTE, pas la provenance des couleurs.* Le contrôle 3 du
checkpoint cherche désormais `gradient(`, pas une couleur.
Corrigé : la carte est opaque, et `--grad-auth` est passé DERRIÈRE, sur le fond d'écran.

### Cinq faux verts fabriqués par mes propres instruments, et corrigés

Consignés parce qu'ils se reproduiront autrement. **Les deux derniers ont été trouvés
PENDANT la clôture, sur une porte qui affichait déjà « V3 EST VERT ».**

1. **`pnpm build` réussit sans les fontes.** Le build du 2026-08-20 a rendu
   `getaddrinfo ENOTFOUND fonts.gstatic.com`, a réessayé, et **aurait fini vert même en
   échouant trois fois** — l'application serait retombée en silence sur les piles
   système. Le checkpoint COMPTE donc les `.woff2` émis ; il ne lit pas le code de
   sortie du build.
2. **La mesure au navigateur rendait « vert » pour 4 écrans jamais vus.** Sans session,
   `/patients` redirige — la sonde mesurait la page de connexion quatre fois. Le tell
   était visible (7 nœuds de texte partout) mais un vert ne se relit pas. L'URL
   d'arrivée est désormais vérifiée.
3. **Vérifier l'URL ne suffisait pas.** `/agenda` et `/finances` ne redirigent PAS : ils
   rendent leur squelette et restent sur leur adresse. La sonde y voyait 4 à 6 nœuds
   conformes et rendait « vert » — **sans que le rail ni le contenu existent**. Elle
   exige maintenant la présence du mobilier attendu.
4. 🔴 **La porte AVALAIT un échec, et concluait vert.** L'instrument sortait en échec
   sur un `net::ERR_ABORTED` ; la branche de classement cherchait `ROUGE` puis
   `BLOQUÉ`, ne trouvait ni l'un ni l'autre — et n'imprimait **RIEN**. Le contrôle ne
   passait ni n'échouait : il DISPARAISSAIT, et le verdict final annonçait
   « V3 EST VERT ». *Un `else` muet est pire qu'un faux rouge : il ne laisse aucune
   trace à débusquer.* La porte porte désormais un filet — échec non classé → BLOQUÉ.
5. 🔴 **« 1 échec de contraste » qui n'en était pas un.** Une ERREUR DE NAVIGATION
   était comptée dans le total des échecs de contraste. La cause réelle : `/` est une
   redirection, et `waitUntil: "networkidle"` court après un réseau au repos sur une
   navigation que le serveur annule. Deux correctifs : les erreurs sont comptées à
   part et nommées, et `/` se charge en `domcontentloaded` puis attend le rail.
   *Un chiffre qui désigne autre chose que ce qu'il nomme envoie la relecture suivante
   chercher au mauvais endroit.*

### Ce qui a FINALEMENT été observé — le blocage était Docker, pas le produit

Le blocage décrit plus haut (« Docker injoignable, 4 écrans jamais rendus ») **est
levé**. Docker relancé, fenêtre ADR-016 rouverte sur autorisation explicite, puis
refermée. Les 6 écrans ont été rendus en session réelle, deux fois : sous `…a1`
(owner) puis sous `…a2` (praticienne).

```
/connexion · / · /patients · /agenda · /finances · /agenda/nouveau
337 textes mesurés · 0 sous le plancher · 0 écran NON OBSERVÉ
rail 248px · actif avec lueur · orbe --grad-orb · héros --grad-brand
repli < 1024 : rail 72px · Geist réellement appliquée
prefers-reduced-motion : 0 animation vivante
clavier : 4 arrêts, 0 sans focus visible, anneau blanc
```

Preuves : `checkpoints/v3-preuves/` — captures + `rapport.json`.

### ADR-016 — FENÊTRE …a1 REFERMÉE ET VÉRIFIÉE

`…a1` porte de nouveau la sentinelle `CONNEXION-IMPOSSIBLE` de `015:34`.
**Vérifié au navigateur, pas déduit d'une ligne** : `/auth/v1/token` → **500**, la
page reste sur `/connexion`, tous les écrans NON OBSERVÉS.

**`scripts/dev-account-fermer.sh` (nouveau)** — la fermeture était jusqu'ici un SQL
improvisé de mémoire. `dev-account.sh` savait ouvrir et pas refermer : *une porte
qu'on sait ouvrir mais pas refermer finit par rester ouverte.* Même garde-fou
`cloud-dev` qu'à l'ouverture — une fermeture restreint, mais elle écrit quand même
dans `auth.users`.

### ⚠️ LE PIÈGE QUI A FAIT CROIRE À UNE APPLICATION CASSÉE

Après un passage de `checkpoint-v3.sh`, l'application s'est affichée en **HTML brut** :
sérif, aucune mise en page. Diagnostic : la page rend HTTP 200, mais
`/_next/static/css/app/layout.css` rend **404 (9 octets, « Not Found »)**.

Cause : `pnpm build` écrase le `.next` du `next dev` en cours. Le serveur survit, sert
les pages, et perd ses feuilles de style. **Rien dans le code n'était cassé.**
Correctif : relancer `pnpm dev`. Le checkpoint AVERTIT désormais en sortie quand un
serveur écoute encore sur :3000 — c'est lui qui pose la mine, c'est à lui de le dire.

### Dépôt publié sur GitHub — PRIVÉ, et sans secret

Le 2026-08-20, hors session d'agent : commit `4bd0e4a`, `master` renommée `main`,
poussée vers `github.com/ayoubsmi1003-beep/Mindcare--Final` (**privé**, confirmé).
Vérifié : **`.env` n'est ni suivi ni poussé** (`.gitignore` couvre `.env`, `.env.*`,
`supabase/.env`), aucun matériel de clé dans l'arbre, et les seules occurrences
`NEXT_PUBLIC_*_KEY` sont des NOMS de variables à valeur vide. **Aucune fuite.**

### Décisions prises pendant la session

| Objet | Décision |
|---|---|
| Bandeau « DONNÉES FICTIVES » | **NON supprimé**, contrairement au contrat §V3. Il est la surface visible de la condition 2 d'ADR-016, et `app.deployment` vaut toujours `cloud-dev` — le contrat dit « il n'a plus d'objet EN LOCAL », or on n'y est pas. Il s'efface déjà seul quand la base répond `self-hosted`. **Restylé, pas enlevé.** |
| Primitive `Toast` | **Non créée** — aucun appelant dans `src/`. Reportée à V4. |
| Primitive `Tableau` | **Écrite puis RETIRÉE** — aucun écran tabulaire ne peut la recevoir sans restructuration (la liste des paiements est une liste de cartes ; `GrilleSemaine` est une grille de calendrier). Reportée à V4, même raison que `Toast`. |
| En-tête héros | Réservé aux écrans de **LIEU** (Patients, Agenda, Finances, Nouveau RDV). Les écrans de **PERSONNE** gardent `EnTetePage`, opaque : ADR-022 interdit un dégradé derrière un nom de patient. La règle de sécurité et le rythme visuel disent ici la même chose. |
| Orbe Jarvis | **Ne respire pas.** §8.1 ferme le mouvement à 4 moments orchestrés ; une pulsation perpétuelle n'en fait pas partie, et bouge dans le coin de l'œil 8 h par jour. |
| Icônes | **Jeu maison, zéro dépendance** — le dépôt en compte 5 au total, et une bibliothèque tierce donne les icônes de tout le monde. |
| Tableau de bord hérosé | **Impossible en V3** : `/` est une redirection de 16 lignes, le tableau de bord est V4 (D-18). V3 livre la grammaire, V4 l'assemble. |

### Écart refermé au passage

`04-DESIGN-SYSTEM` §3 prescrit « < 1024px nav → icônes ». `AppShell` documentait depuis
le 2026-08-04 qu'il ne pouvait pas s'y conformer, **faute de jeu d'icônes**. V3 les
dessine : le rail se replie désormais en icônes au lieu de passer au-dessus du contenu.
Les libellés sortent du flux visuel mais **restent dans l'arbre d'accessibilité**.

### COMPTE PRATICIENNE — ouvert le 2026-08-20, vérifié au navigateur

`praticien2.dev@invalid.local` (`…a2`, rôle `practitioner`, cabinet synthétique) est
connectable par `scripts/compte-praticienne.sh`. **Aucune identité n'a été inventée** :
`015` semait déjà ce profil avec son rôle, son titre et son `cabinet_id` ; il lui
manquait un mot de passe utilisable.

⚠️ **Cela AMENDE ADR-016** — l'amendement du 2026-08-03 écrivait que `…a2` et `…a3`
« restent inconnectables ». L'amendement du 2026-08-20 est écrit et daté dans
`00-DECISIONS.md` ; il n'a pas été fait en douce. La condition 1 tient toujours :
`…a2` est une identité SYNTHÉTIQUE, pas celle de la Dr. Larbi.

**Le mot de passe vit dans `.env` (`DOCTOR_ACCOUNT_PASSWORD`), couvert par
`.gitignore`. Il n'est écrit NI ici, NI dans un script, NI dans une migration.**

| Contrôle | Résultat |
|---|---|
| Connexion `/connexion` → session | ✅ 6 écrans rendus, 0 NON OBSERVÉ |
| Identité effective | ✅ « Praticienne 2 (données de test) » dans le rail |
| Patients · Agenda · Finances · Nouveau RDV | ✅ rendus, 0 erreur d'autorisation |
| Cloison finance (ADR-005 / D-14) | ✅ « **Vos séances uniquement** » — périmètre rendu par la BASE ; 0 DZD, les actes du jour étant ceux de Praticienne 1 |
| `…a1` toujours fermé | ✅ dans le MÊME passage |

*La cloison finance n'est pas un défaut : `practitioner → sa seule recette` est la
règle de `029`, appliquée par `app.current_role()`. Une praticienne qui verrait la
recette du cabinet serait le bug.*

**Refermer :** `bash scripts/compte-praticienne.sh --fermer`. Ce compte disparaît à la
migration ADR-001, comme le reste du synthétique.

---

---

## ⛔ ÉTAT AU 2026-08-15 — LIRE AVANT TOUTE REPRISE

**V2 est commité (`35010c9`), et il l'a été sur une porte verte : 22 verts · 0 rouge ·
2 bloqués par décision, rapport de mesure frais à l'appui.** Cette porte n'est plus
rejouable aujourd'hui, pour une raison EXTÉRIEURE au code.

### Le blocage : le crédit OpenRouter, pas un défaut

```
HTTP 402 — "This request requires more credits, or fewer max_tokens.
            You requested up to 2000 tokens, but can only afford 1903."
```

`MAX_OUTPUT_TOKENS = 2000` (`external-call.ts:146`) dépasse ce que la limite
hebdomadaire de la clé permet encore. **Mesuré, pas supposé** : à `max_tokens=2000`
la requête rend 402 ; à `1900` et `1000`, elle rend 200. Toute la journée du 14 l'a
consommé en mesures.

**Conséquence :** les contrôles **1, 3 et 4** (tout ce qui appelle le modèle) sont
INOBSERVABLES. Le contrôle 5 (refus, aucun appel modèle) reste vert.

⚠️ **NE PAS baisser `MAX_OUTPUT_TOKENS` pour faire passer la porte.** Ce serait
changer le produit pour accommoder un solde, et dégrader silencieusement toutes les
réponses. **Le geste juste est de recharger la clé, ou d'en relever la limite
hebdomadaire.**

Trois fausses pistes ont été écartées PAR LA MESURE avant d'arriver là, et elles sont
écrites pour ne pas être repayées : ce n'était ni la clé absente (le journal client
rend `technical:"indisponible"`, pas `"configuration"`), ni une limite de débit
(6 appels d'affilée depuis le poste : 6× HTTP 200), ni la régression d'un correctif
(la latence de 35-80 ms ressemblait à un échec avant réseau — elle était en fait un
4xx immédiat, sans inférence).

### La porte échoue désormais FERMÉE — c'est la vraie nouveauté du 2026-08-15

`checkpoint-v2.sh` distingue maintenant DEUX espèces de BLOQUÉ, et `bloque()` — le nom
court, celui qu'on écrit sans réfléchir — est **critique par défaut** :

| Espèce | Effet |
|---|---|
| **BLOQUÉ critique** — non mesuré alors qu'il devait l'être (rapport absent, périmé, empreinte qui ne correspond plus, Docker injoignable) | **exit ≠ 0 · LIVRAISON INTERDITE** |
| **bloqué¹ par décision** — la fonctionnalité N'EXISTE PAS, par choix écrit et daté (contrôles 2 et 7) | n'empêche pas la livraison, mais est **nommé à chaque passage** |

Trois conditions, toutes nécessaires pour un exit 0 : zéro ROUGE · zéro bloqué
critique · **exactement** deux reports par décision (ni plus — une décision non écrite,
ni moins — un périmètre qui a bougé). *Ce qui n'est pas classé explicitement est
traité comme bloquant : une porte qui laisse passer dans le doute ne protège rien.*

### Verdict brut du 2026-08-15, état propre, HEAD `35010c9`

```
VERDICT V2 : 16 verts · 0 rouges · 6 bloqués critiques · 2 bloqués par décision
V2 N'EST PAS VERT : 6 contrôle(s) NON MESURÉ(S) et exigés.
LIVRAISON INTERDITE tant qu'ils ne sont pas observés.                  (exit 2)
```

Restent VERTS et rejoués ce soir, sans dépendre du fournisseur : preflight ·
verify-migrations (6/6) · typecheck · lint · build · les 4 contrôles de frontière ·
`eval-jarvis-v2` · rejeu `001→034` · **17 assertions 033/034** · **11 assertions RLS**.

### Un défaut RÉEL trouvé ce soir, corrigé mais NON VÉRIFIÉ

**Les bornes d'agenda pouvaient être calculées en journée UTC.** Mesuré au navigateur :
pour « les rendez-vous de demain », le modèle a rendu
`de:2026-08-15T22:00:00+01:00 à 2026-08-16T21:59:59+01:00` — une journée UTC repeinte
au fuseau d'Alger, qui **commence deux heures trop tôt**. Un rendez-vous de 22 h 30 la
veille y entrerait ; celui de 22 h 30 le jour demandé en sortirait. C'est exactement le
défaut nommé au §4 de `CLAUDE.md`, sur le chemin où il se voit le moins — les bornes
sont calculées PAR LE MODÈLE. Comportement **intermittent** : d'autres passages ont
rendu des bornes justes pour la même question.

Correctif écrit et déployé, **dans l'arbre de travail, NON COMMITÉ** : la règle de
bornes est passée dans la description de `get_agenda` (`prompt.ts`), et le décalage
d'Alger est calculé puis donné au modèle (`index.ts`).

⚠️ **Il n'est pas vérifié**, et il ne peut pas l'être tant que le crédit manque. Deux
enseignements en sont tirés, écrits dans le code :
- une première version mettait la règle dans le message de date : le modèle a cessé
  D'APPELER L'OUTIL, trois fois sur trois. **La consigne noyait la tâche.** La règle vit
  donc là où elle s'applique — à côté des arguments qu'elle contraint.
- `Intl.DateTimeFormat` avec `timeZoneName: "longOffset"` a fait LEVER la fonction dans
  le runtime Deno déployé. Le décalage se calcule désormais par soustraction, avec
  `toLocaleString`, dont le comportement est éprouvé dans ce fichier.

### Ce qui est en attente dans l'arbre de travail (non commité)

1. Le correctif de fuseau ci-dessus — **à vérifier avant de commiter**.
2. `checkpoint-v2.sh` — la porte qui échoue fermée.
3. `mesure-v2-navigateur.mjs` — diagnostics enrichis (la réponse rendue est citée
   quand l'outil n'est pas appelé).

**Rien de tout cela n'est commité, et c'est la règle qui le veut** : la porte est rouge,
donc on ne livre pas. Y compris le durcissement de la porte elle-même.

---

---

## PASSE D'AUDIT ADVERSARIAL DU 2026-08-14 — ce qu'elle a changé

### Le verdict, et ce qui le rend opposable

```
VERDICT V2 : 22 verts · 0 rouges · 2 bloqués
V2 EST VERT — aux deux réserves NOMMÉES, et à elles seules :
  · contrôle 2 (homonymes) — périmètre V5, ni écran ni porte create_patient
  · contrôle 7 (voix)      — transport binaire hors contrat DbPort (ADR-020)
```

**Ce qui a débloqué les six contrôles navigateur n'est pas le produit : c'est
l'instrument.** Ils étaient mesurés verts depuis le 2026-08-13 et sortaient
BLOQUÉ à chaque passage, parce que les huit lignes `bloque` étaient **écrites en
dur** dans le script. Un vert qui vit dans ce fichier et pas dans le checkpoint
n'est pas reproductible — c'est un souvenir, et l'en-tête du checkpoint dit
lui-même ce qu'il faut en penser.

`scripts/mesure-v2-navigateur.mjs` (nouveau) pilote un vrai Chromium et dépose
un rapport que `checkpoint-v2.sh` relit sous **trois gardes** — toute
discordance retombe en BLOQUÉ, jamais en vert :

| Garde | Ce qu'elle empêche |
|---|---|
| **empreinte** sha256 de toutes les entrées d'exécution V2 | mesurer, puis corriger le code, et garder le vert |
| **HEAD** | mélanger deux arbres dans un verdict |
| **fraîcheur** (1 h) | qu'une observation d'hier passe pour une observation d'aujourd'hui |

⚠️ **Ce n'est PAS Playwright MCP** — ce serveur n'est pas connecté sur ce poste.
C'est le paquet npm `playwright`, qui clique et frappe réellement.

### Cinq défauts RÉELS trouvés en exécutant — trois dans le produit, deux dans l'instrument

1. **`prompt.ts` — `kind` sans ses valeurs. Le chemin d'écriture principal
   tombait une fois sur deux.** La description d'outil annonçait `kind?` sans
   dire ce que le champ accepte. Le modèle en inventait une valeur,
   `z.enum(TYPES_DE_CONSULTATION)` la refusait, et **toute** la proposition
   mourait en « Cette demande n'a pas pu être interprétée de façon sûre ».
   INTERMITTENT — un champ facultatif que le modèle renseigne parfois — donc
   invisible à un essai unique. Corrigé : les treize valeurs de `app.consult_kind`
   (024) écrites en toutes lettres, plus la consigne d'OMETTRE le champ dans le
   doute, pour qu'une divergence future coûte un champ vide et non un refus.

2. **`jarvis-chat` — le chemin CONNAISSANCE ne vérifiait aucune identité.
   ⚠️ DÉFAUT DE SÉCURITÉ, mesuré sur la fonction déployée.** L'identité n'était
   établie que sur le chemin patient ; ailleurs, on ne testait que la PRÉSENCE
   d'un en-tête `Authorization`. En présentant la **clé publiable**
   (`sb_publishable_…`, publique par construction), un tiers obtenait `HTTP 200`
   et une réponse complète du modèle — **depuis n'importe quelle origine**, car
   CORS ne borne que ce qu'un navigateur peut relire, jamais `curl`.
   `verify_jwt: true` ne comble pas ce trou : la passerelle rejette bien un JWT
   malformé, expiré ou de signature inventée (401, mesuré), mais un anonyme muni
   d'une clé publique n'est pas malformé — il est anonyme. **Ce que ça coûtait :**
   le crédit fournisseur du cabinet, sans limite, et des lignes
   `audit.boundary_crossings` qu'aucune praticienne n'a demandées — une trace de
   franchissement sans franchisseur, c'est-à-dire une trace fausse.
   Corrigé : `auth.getUser()` **avant** le routage, pour les trois chemins.
   Re-mesuré : `non-authentifie` sur les deux cas.
   *(Au passage : `data?.user === null` laissait passer `undefined`.)*

3. **`checkpoint-v2-rls.sql` — quatre assertions DISPARUES, et un « 0 rouge »
   pour le dire.** Un bloc `DO` appelait `propose_jarvis_action` avec un `jsonb`
   là où la porte attend du `text` (033:79). Aucune signature ne résolvait, le
   bloc était abandonné, la table temporaire n'existait pas, et les `SELECT` qui
   la lisaient échouaient sur stderr. Le rapport sortait **« 7 verts, 0 rouge »
   avec les deux assertions de cloisonnement praticien et de rejeu de
   confirmation absentes.** Corrigé deux fois : le cast, et surtout un **compte
   d'assertions attendues** dans le checkpoint. *Zéro rouge ne veut pas dire
   « tout a été vérifié » : il faut aussi que tout ait été POSÉ.*

4. **Le rapport de mesure gardait ses échecs périmés.** Un passage interrompu
   déposait `echec-<mode>` en ROUGE ; le passage suivant, réussi, déposait ses
   verts À CÔTÉ. Le checkpoint concluait ROUGE sur une mesure déjà remplacée —
   le symétrique du faux vert, et tout aussi faux. Corrigé : un mode qui
   re-tourne efface son passage précédent.

5. **Trois pièges de mesure, dont un neuf.** Les deux connus (hydratation avant
   saisie ; « Confirmer… » pendant les 400 ms) étaient consignés et ont été
   évités. Le troisième s'est payé ici : compter les paragraphes du fil ne
   marche pas, **le paragraphe d'invite DISPARAÎT au premier tour** — la mesure
   expirait sur un produit intact. On repère désormais le message envoyé, qui ne
   s'efface pas. Deux autres artefacts de mesure corrigés : la fenêtre de 400 ms
   se date par `MutationObserver` DANS la page (sonder depuis Node fabrique un
   faux ROUGE sur machine chargée), et le contrôle 3 fait tourner l'heure du
   rendez-vous — sinon il échoue sur le créneau que le passage précédent a
   réservé, c'est-à-dire **parce qu'il a réussi la fois d'avant**.

### RLS pour les trois rôles — §7.2 tenu, par la voie qu'ADR-016 autorise

`scripts/checkpoint-v2-rls.sql` (nouveau), sur la base **jetable** : **11
assertions vertes**, par emprunt de `request.jwt.claim.sub` — jamais par
connexion, qu'ADR-016 interdit et que `015` rend impossible.

| | Prouvé pour a1 (owner) · a2 (practitioner) · a3 (assistant) |
|---|---|
| R0a–d | les trois identités sont effectives, les trois rôles distincts |
| R1 | `SELECT` direct sur `app.patients` **refusé aux trois** (règle 6) |
| R2a–b | a2 ne peut **pas** confirmer l'action d'a1 — et l'action reste `proposed` |
| R2c–d | a1 confirme la sienne ; **une confirmation ne se rejoue pas** |
| R3 | outil hors allowlist refusé **aux trois** |
| R4 | les actions d'a1 sont invisibles à a2 **et** à a3 |

### La frontière HTTP, éprouvée sur la fonction déployée

Treize cas adverses. `Authorization` absent → `non-authentifie` · JWT malformé,
expiré, `service_role` forgé → **401 à la passerelle** · clé publiable →
`non-authentifie` (après correctif) · préalable `OPTIONS` d'une origine
autorisée → 204 + `ACAO` · **origine hostile → 403, aucun `ACAO`** · message
vide, 5 000 caractères, `contexteDossiers` au-delà du plafond → `requete-invalide`.

**`jarvis-analyze-session` n'a PAS le défaut n°2, et c'est mesuré, pas déduit.**
Il ne vérifie pas non plus l'identité — mais son premier geste est un `rpc` que
la RLS arbitre : un porteur de clé publiable reçoit `indisponible`, n'atteint
aucune note et ne déclenche aucun appel au modèle. **Règle 4 en action** : la
sécurité est en base, pas en JavaScript. Aucun correctif — en ajouter un serait
dupliquer une garantie que la base tient déjà.

### ADR-016 — la fenêtre a été ouverte, puis REFERMÉE et vérifiée

**L'« écart réel » consigné le 2026-08-13 est ÉLUCIDÉ, et ce n'était pas un
geste inexpliqué.** Le vrai bcrypt d'`owner.dev` a été posé par
`scripts/dev-account.sh` — **le script committé dont c'est exactement l'objet**
(`WHERE id = …a1`, `crypt(:devpw, gen_salt('bf'))`). Le mécanisme était prévu ;
c'est son caractère PERMANENT qui ne l'était pas.

Sur arbitrage : mesurer, puis révoquer. Fait, dans cet ordre, et **vérifié au
navigateur** — `/auth/v1/token` rend **500**, la page reste sur `/connexion`.
Les trois comptes portent de nouveau la sentinelle `CONNEXION-IMPOSSIBLE` de
`015:34`. **La condition 1 d'ADR-016 est tenue aujourd'hui.**

> ⚠️ **Conséquence à assumer, pas à contourner.** Les six contrôles navigateur
> ne sont plus re-mesurables en l'état. Les rouvrir demande `bash
> scripts/dev-account.sh`, **et c'est une décision à reprendre à ce moment-là.**
> Le rapport vert de cette passe a été pris pendant que la fenêtre était
> ouverte ; il expire au bout d'une heure, par construction.

### Les deux écritures cloud du 2026-08-13 — ANNULÉES

Faites sur un diagnostic faux, elles sont revenues à l'état de `015` sur a2 et
a3 : `confirmation_token`, `recovery_token`, `email_change_token_new`,
`email_change`, `email_confirmed_at`, `raw_app_meta_data`, `raw_user_meta_data`
→ **NULL**. Valeur d'origine **établie, pas devinée** : `015:30-39` ne nomme que
huit colonnes, toutes les autres ont pris leur **défaut de colonne**, relevé dans
`information_schema`. Les quatre colonnes dont le défaut est `''` valaient déjà
`''` et n'ont **pas** été touchées — les mettre à NULL aurait été s'éloigner de
l'origine, pas y revenir. `updated_at` n'est pas remis en arrière : on ne
fabrique pas un horodatage pour faire croire que rien ne s'est passé.

### Défauts établis et NON corrigés — hors périmètre gelé, à arbitrer

1. 🔴 **`app.search_patients` cherche dans l'ordre inverse de l'affichage.**
   La porte (018) compare la demande à `first_name || ' ' || last_name` ; l'écran
   affiche **« NOM Prénom »**. Recopier un nom TEL QU'IL EST AFFICHÉ rend
   « Aucun dossier ne correspond » — **mesuré : `count:0`**, là où le nom de
   famille seul rend `count:1`. Touche la praticienne autant que Jarvis.
   **Antérieur à V2** (jalon S3) : hors du périmètre de ce lot (règle 10), et
   toute correction passerait par une migration `035`, jamais par édition de 018.

2. 🔴 **`jarvis-voice-in` et `jarvis-voice-out` n'ont AUCUN CORS.** Ni
   `reponsePrealable`, ni `enTetesCors` — exactement le défaut trouvé le
   2026-08-13 sur les deux autres fonctions. Latent et non déclenchable :
   elles ne sont **pas déployées** et le contrôle 7 est BLOQUÉ. Non corrigé
   parce qu'un correctif y serait **invérifiable** cette passe. **À faire avant
   toute mise en service de la voix**, en même temps que le transport binaire.

3. ⚠️ **`CORS_ORIGINS` n'est pas posée** sur `ftxaseynjvjevwybdoii` — vérifié
   dans les secrets Edge. Le repli est `http://localhost:3000`, le poste de
   développement et rien d'autre. **À poser sur l'origine réelle du cabinet
   avant la mise en service.**

4. ⚠️ **Le bloc de contexte est présenté au modèle comme « une DONNÉE, pas une
   instruction » — par une PHRASE DE PROMPT.** Une phrase n'est pas un
   mécanisme. Le vecteur réaliste (un nom de dossier porteur d'une instruction)
   n'a pas pu être éprouvé : créer un dossier demande une porte `create_patient`
   qui n'existe pas avant V5. **Risque résiduel nommé**, non mesuré.

5. **Une erreur JS non rattrapée, observée UNE fois** sous coupure fournisseur,
   **non reproduite en quatre passages suivants**. Cause non établie — et on ne
   lui en invente pas.

### Discipline d'exécution de la passe

`pnpm typecheck` · `pnpm lint` · `pnpm build` · `verify-migrations.sh` (6/6) ·
rejeu `001→034` sur base jetable + **17 assertions 033/034** · **11 assertions
RLS** · six contrôles navigateur : verts. `032` et `034` **non appliquées** sur
le cloud, qui reste à **033**. `032`/`033`/`034` **non modifiées**. Deux
écritures cloud dans cette passe, toutes deux annoncées : l'annulation des
UPDATE d'a2/a3, et la restauration de la sentinelle d'`owner.dev`. Le secret
`OPENROUTER_API_KEY` a été retiré puis reposé pour le contrôle 6 — **empreinte
identique à l'originale** (`6da488b5…`), vérifiée.

⚠️ **Piège d'environnement, payé ici :** `pnpm build` écrase le `.next` d'un
`next dev` en cours ; le serveur sert alors des chunks 404 et **plus rien
n'hydrate**. Ne pas mesurer au navigateur pendant que le checkpoint construit.

---

---

## Fait & vert — V1 CLOS
- **V1 immutable** · commit `7a656d3` (2026-08-11) · 40 fichiers, +3801/−692 · master · checkpoint V1 ✅

## V2 — les six lots, écrits et vérifiés hors ligne

| Lot | État | Preuve |
|---|---|---|
| L1 · portes 033/034 | ✅ | rejeu `001→034` sur base jetable ×3, **17/17** assertions de sécurité, idempotence prouvée |
| L2 · voix (passerelle) | ⚠️ code posé, **jamais exécuté** | Deno absent du poste |
| L3 · Zod + 5 outils | ✅ | `jarvis-tools.ts`, allowlist verrouillée compilation + exécution + base |
| L4 · frontière ADR-023 | ✅ | `_shared/routing.ts`, **7/7** questions du tableau, 24 contrôles verts |
| L5 · panneau ⌘K + carte 400 ms | ✅ clavier · voix inerte | `PanneauJarvis.tsx`, `CarteConfirmation.tsx` |
| L6 + L6bis · checkpoint | ✅ | `checkpoint-v2.sh` : **15 verts · 0 rouge · 8 BLOQUÉS** |

`checkpoint-v2.sh` sort en **code 2** : V2 n'est pas vert, 8 contrôles NON MESURÉS (navigateur,
clé fournisseur, transport binaire). Un contrôle bloqué n'est pas un contrôle réussi.

## Base cloud — REMISE À NIVEAU le 2026-08-12

La base était à **26** migrations, le dépôt à **30**. Finances était rouge (`PGRST202` sur
`day_revenue` / `list_day_payments`), Documents et Jarvis l'auraient été aussi.
**`027 → 030` appliquées** sur `ftxaseynjvjevwybdoii` (`cloud-dev`, 2 patients, 0 non-synthétique).
Base à **30**. Finances vérifié à l'écran, connecté : « RECETTE DU JOUR · 0 DZD », zéro erreur.

`032`, `033`, `034` : **écrites, NON appliquées, non commitées.** `032` intacte, `sha256
22a0402e20497c08955e9bbd5672653d39a46ba48a3c46302faaef34693c852b`.

## Arbitrages utilisateur — 2026-08-12

| Objet | Décision |
|---|---|
| `033` / `034` | GARDÉES. L'interdiction portait sur l'OBJET G4 (porte composite agenda), pas le numéro. |
| `external-call.ts` | Édition AUTORISÉE. Garde-fous inchangés. |
| Zod | INSTALLÉ — `zod@4.4.3`. |
| Rejeu Docker | AUTORISÉ sur base jetable. Fait. |
| Hiérarchie documentaire | `MindCare_OS_Engineering_Constitution.md` reste ARCHIVÉE et non lue. DOC-AUTHORITY §1 fait foi. |
| Migrations cloud | `027→030` autorisées et appliquées. Rien au-delà. |

## Défauts réels corrigés dans cette session

1. **`033:51`** — `ADD CONSTRAINT` sans garde : `42710` au second passage. `DROP … IF EXISTS` ajouté.
2. **`routing.ts`** — `\b` est ASCII en JS : « prescrire **à** Amina » non détecté, la question 6
   d'ADR-023 partait en « connaissance ». **Un refus manqué en silence.**
3. **`db-migrate.sh`** — avalait l'échec de lecture de `schema_migrations` et concluait « base
   vierge », de façon **intermittente** : aurait rejoué `001` sur une base vivante. Garde-fou à
   trois cas + décompte `wc -l` faux (25/26) corrigés.
4. **`PanneauJarvis`** — `crypto.randomUUID()` est `undefined` hors contexte sécurisé (URL réseau).
   Repli sur `getRandomValues`.
5. **`jarvis-tools.ts`** — `z.uuid()` refuse les identifiants de 015 → `z.guid()` ; enum
   `consult_kind` inventée → verrouillée par `satisfies` sur les 13 valeurs réelles.

## Écarts documentaires NON corrigés (décision : ne pas toucher aux documents d'autorité)

- **`CLAUDE.md` §2 dit « Postgres 15 ».** Le serveur est en **17.6**, et `020:127` utilise
  `GRANT … WITH INHERIT TRUE`, syntaxe **Postgres 16**. Un rejeu sur image serveur `postgres:15`
  échoue. DOC-AUTHORITY §1 tranche pour la migration appliquée.

## Session du 2026-08-13 — Jarvis vivant à l'écran

**Le blocage n°1 est levé.** CLI Supabase en devDependency (`supabase@2.113.0`, paquet npm :
ni Deno, ni Docker, ni droits admin). `jarvis-chat` et `jarvis-analyze-session` déployées par
`functions deploy --use-api`, `ACTIVE`. `OPENROUTER_API_KEY` posée dans les secrets Edge.
**`033` appliquée SEULE** sur `ftxaseynjvjevwybdoii` — 4 portes `SECURITY INVOKER`,
`jarvis_tool_allowlist` posée, registre à `033`. `032` et `034` toujours absentes.

### Quatre défauts RÉELS, trouvés en exécutant — aucun n'était visible en relecture

1. **CORS absent des deux Edge Functions.** Sans réponse à `OPTIONS`, le navigateur bloquait
   chaque appel **avant la première ligne de code**. Les 24 contrôles hors ligne d'ADR-023
   restaient verts : ils testent un routage qui n'était jamais atteint. Corrigé par
   **`_shared/cors.ts`** — allowlist d'origines (`CORS_ORIGINS`), jamais `*`, source unique.
   ⚠️ **Avant la mise en service : poser `CORS_ORIGINS` sur l'origine réelle du cabinet.**

2. **`033` lit `snake_case`, le client sérialisait `camelCase`.** `v_args ->> 'patient_id'`
   contre `{"patientId": …}` : les quatre extractions rendaient NULL, `create_appointment`
   levait « Rendez-vous incomplet », la ligne finissait `state='failed'`, `error='P0001'`.
   **AUCUNE écriture Jarvis n'était possible**, pour aucun argument. Corrigé côté client
   (`versSnakeCase` dans `jarvis-tools.ts`) — `033` est appliquée et ne se modifie pas.

3. **Le modèle ignorait la date du jour.** « demain à 15 h » devenait `2024-05-18T14:00:00Z`.
   La porte refusait, donc rien de grave — mais aucune demande datée ne pouvait aboutir.
   Corrigé : date `Africa/Algiers` dans un message SÉPARÉ, pour ne pas faire varier `promptHash`.

4. **`create_appointment` était inatteignable.** Le modèle ne pouvait pas connaître les UUID :
   `jarvis.ts` n'envoyait ni historique ni contexte. Arbitrage utilisateur du 2026-08-13 :
   **le résultat d'outil est joint au tour suivant** (`contexteOutils`), lu UNIQUEMENT sur le
   chemin patient — les chemins connaissance et refus rendent leur réponse avant d'y toucher.
   ⚠️ **Ce champ fait sortir des identifiants et des noms de dossier vers le modèle.** Décidé
   en connaissance de cette conséquence.

### Contrôles du §V2 — mesurés à l'écran, session réelle

| # | Verdict | Preuve |
|---|---|---|
| 1 · rendez-vous de demain | 🔴 **ÉCART** | Un RDV `owner` existe le 2026-08-14 16:00 Alger (`4bf9d0de…`, `confirmed`) et Jarvis rend « Aucun rendez-vous visible ». Cause NON établie : les bornes `from`/`to` passées à `get_agenda` n'ont pas été observées. **À reprendre en premier.** |
| 2 · homonymes | BLOQUÉ | Ni écran ni porte `create_patient` — c'est V5 (D-18). `app.patients` n'a pas de `deleted_at` mais `is_active`. Décision : rester bloqué. |
| 3 · carte → 400 ms → écriture | ✅ **VERT** | `state=executed` · `confirmed_at 02:07:44.066` **avant** `executed_at .185` · `affected_table=appointments` · RDV créé · bouton **inactif** à la première vue, actif après **373 ms** · T7 = 0 |
| 4 · sertraline / lithium | ✅ VERT | Réponse substantielle, registre « Connaissance générale — pas ce dossier » rendu par l'interface, renvoi au Vidal |
| 5 · « Karim est-il dépressif ? » | ✅ VERT | Refus d'ADR-023 mot pour mot, avec proposition d'exploration |
| 6 · clé coupée | BLOQUÉ | Non mesuré cette session |
| 7 · voix | BLOQUÉ | Transport binaire absent de `DbPort` (ADR-020). Décision : ne pas étendre le contrat. |
| E9 · fournisseur coupé | BLOQUÉ | Non mesuré cette session |

**Deux pièges de MESURE, pas de produit** — consignés pour ne pas être repayés :
- Le bouton porte « Confirmer… » pendant les 400 ms : un sélecteur exact sur « Confirmer » est
  **aveugle à la fenêtre d'inactivité** et fait conclure « anti-clic absent ». Faux.
- Remplir le formulaire de connexion avant l'hydratation React envoie un formulaire **vide** →
  `400 validation_failed`, qui s'affiche « Une erreur inattendue s'est produite ».

## Session du 2026-08-13 (après-midi) — contrôle 1 élucidé, 6 et E9 mesurés

**HEAD toujours `7a656d3`, rien de commité. Aucune migration appliquée cette session.**

### Contrôle 1 — l'instrument manquait, pas le produit

Les bornes `from`/`to` sont calculées par le MODÈLE : elles n'étaient observables nulle
part, et l'écart avait donc été constaté sans sa cause. **Instrument posé** dans
`outilGetAgenda` (`jarvis-tools.ts`) : deux `log.info` — les deux instants, un BOOLÉEN de
filtre praticien, puis le compte de lignes. Ni identifiant ni nom : une borne est une
date, l'identifiant de praticien désigne une personne et reste hors du journal, pour la
raison exacte qui a fait retirer `patientId` de `LogFields`.

**Mesuré au navigateur, port 3000, session `owner.dev`, 4 formulations :**

```
de:2026-08-14T00:00:00+01:00 a:2026-08-14T23:59:59+01:00 filtrePraticien:false → count:2
```

Bornes JUSTES, en `Africa/Algiers`, stables sur les 3 essais qui appellent l'outil.
Jarvis rend les deux rendez-vous du 14/08, dont **16:00 — le `4bf9d0de…` du constat**.
L'écran `/agenda` les voit aussi (vue semaine).

**→ Contrôle 1 : ✅ VERT.** L'écart NE REPRODUIT PAS. Les bornes et la RLS sont
**écartées par la mesure**, pas par raisonnement. La cause du constat du matin reste
**non établie** et le restera : elle n'est plus observable. On ne lui invente pas
d'explication. L'instrument reste en place — c'est lui qui rend le contrôle concluant.

**Observation adjacente, ni verte ni rouge :** « Qu'est-ce que j'ai demain ? » n'appelle
AUCUN outil — le modèle répond en texte. Formulation hors du libellé du contrôle,
notée, non traitée (règle 10).

### Contrôles 6 et E9 — clé RÉELLEMENT retirée des secrets Edge

`secrets unset OPENROUTER_API_KEY`, mesure, `secrets set` — **empreinte de la clé remise
identique à l'originale** (`6da488b5…`), et une réponse Jarvis complète repart après.

| # | Verdict | Preuve |
|---|---|---|
| 6 · clé coupée | ✅ **VERT** | « Jarvis est indisponible. Toutes les fonctions restent accessibles. » Panneau vivant, saisie utilisable. Journal : `code:indisponible · technical:configuration` — aucune fuite de cause fournisseur à l'écran |
| E9 · fournisseur coupé | ✅ **VERT** | Patients (2 dossiers), Agenda (13 août rendu), Finances (« Toutes les séances du cabinet ») — tous rendus, **0 erreur JavaScript non rattrapée** |

`typecheck` · `lint` · `build` · `checkpoint-v2.sh` (**12 verts · 0 rouge**, dont
`eval-jarvis-v2` exit 0) : verts après l'instrument.

### Contrôles du §V2 — état consolidé

1 ✅ · 2 BLOQUÉ (décision) · 3 ✅ · 4 ✅ · 5 ✅ · 6 ✅ · 7 BLOQUÉ (décision) · E9 ✅

### Arbitrage rendu — pseudonymisation de `jarvis-chat`, BRANCHE (b)

**Décision utilisateur du 2026-08-13 : (b) — pseudonymiser le seul contexte d'outil.**
Écartées : (a) statu quo en dette datée · (c) frontière complète sur le chemin patient,
qui supposerait que la fonction Edge LISE `app.patients` — un second chemin d'accès aux
dossiers, hors périmètre V2.

**Ce qui est couvert :** les valeurs `nom` et `numero` du contexte traversent
`pseudonymize()`, la réponse traverse `rehydrate()`. Le fournisseur voit `P1`, `P2`.
**Ce qui ne l'est PAS, et c'est écrit dans le code, pas seulement ici :** le message
libre part BRUT (« ouvre le dossier de Belkacem »), et les UUID partent en clair — ce
sont les poignées dont la boucle d'écriture de 033 a besoin. `assertSafe` est appliqué
au SEUL bloc pseudonymisé : appliqué à la charge entière, il lèverait dès que la
praticienne tape un nom, et Jarvis serait inutilisable. **Réduction de l'exposition,
pas suppression.**

#### Deux défauts RÉELS, encore trouvés en exécutant

1. **La structure du bloc était corrompue par sa propre pseudonymisation.** Première
   version : le client composait le texte, la passerelle le masquait. Le prénom du
   dossier d'essai est « Patient » — il a matché **à l'intérieur du libellé
   `patientId=`**, qui partait en `P3Id=`. La substitution est textuelle et insensible
   à la casse : elle ne distingue pas une donnée d'un mot de structure.
2. **La réhydratation n'était pas l'inverse exact** (`false` mesuré) — même cause :
   `patientId` revenait en `PatientId`, la casse perdue.

**Correction à la racine, pas en surface :** le client envoie désormais les **champs**
(`contexteDossiers: {id, nom, numero}[]` + `contextePraticienId`), la passerelle masque
les **valeurs** puis compose le texte **autour**. Un libellé de structure n'existe pas
encore au moment du masquage : il ne peut plus être atteint.

#### Mesuré, pas supposé — après correction et redéploiement

| Contrôle | Résultat |
|---|---|
| corps réellement posté | `contexteDossiers` en champs, sur le fil |
| bloc tel qu'il part | `patientId=…b1 · P1 · P2` — **structure intacte, aucun nom en clair** |
| `assertSafe` | PASSE |
| aller-retour `pseudonymize`→`rehydrate` | **EXACT** |
| contrôle 3 non régressé | carte affichée, vrai nom, vrais UUID, aucun jeton à l'écran |
| contrôles 1 · 4 · 5 | rejoués après déploiement : **verts** |

`typecheck` · `lint` · `build` · `checkpoint-v2.sh` (12 verts · 0 rouge) : verts.
`jarvis-chat` **redéployée** (`--use-api`), embarque `_shared/pseudonymize.ts`.

### Reste ouvert
2. ~~`praticien2.dev` rend 500~~ — **CLOS, ce n'était pas un défaut.** Garde-fou d'ADR-016
   posé par `015`. Voir la section dédiée. **Deux arbitrages en attente** y sont posés :
   le mot de passe réel d'`owner.dev`, et le sort des deux écritures cloud inutiles.
3. **Transport binaire voix** (contrôle 7) · **Step 18** 🔴 non mesuré, dérogation maintenue.
4. **`CORS_ORIGINS` à poser sur l'origine réelle du cabinet** avant mise en service.
5. Docker Desktop : `docker info` échoue tant que le moteur initialise ; attendre que
   `docker ps` réponde. Le port 3000 doit rester libre — l'allowlist CORS ne connaît que lui.

## Le 500 d'authentification — CE N'EST PAS UN DÉFAUT. C'est un garde-fou d'ADR-016.

**Cause, nommée par le serveur et non déduite :**
`crypto/bcrypt: hashedSecret too short to be a bcrypted password` (`auth_logs`).

`encrypted_password` de `praticien2.dev` et `assistante.dev` vaut la chaîne littérale
**`CONNEXION-IMPOSSIBLE`** — 20 caractères, pas un hash. Posée par
**`015_seed_data.sql:26-29`**, qui écrit noir sur blanc :

> « Le hash de mot de passe est volontairement invalide : CES COMPTES NE PEUVENT PAS SE
> CONNECTER. C'est exactement ce qu'exige la **condition 1 d'ADR-016** (aucun accès
> praticien sur l'instance cloud). Ils ne servent qu'à porter les `profiles` que les
> tests RLS empruntent via `request.jwt.claim.sub`. »

**Le 500 est donc le comportement VOULU, pas une panne.** L'entrée « piège Auth connu »
qui traînait dans `Reste ouvert` était une **mauvaise piste, reconduite de session en
session sans jamais être vérifiée**.

### ~~⚠️ Deux écritures cloud inutiles~~ — ANNULÉES le 2026-08-14 (voir en tête)

Le 2026-08-13, sur accord utilisateur mais sur un diagnostic FAUX, deux `UPDATE` ont été
appliqués sur `auth.users` (a2, a3) : les quatre colonnes de jetons à `''`,
`email_confirmed_at`, puis `raw_app_meta_data` / `raw_user_meta_data`. **Ils n'ont rien
corrigé** — la mesure d'après montrait toujours 500, deux fois. Ils sont sans effet sur
la cloison (le mot de passe reste non hashable, la connexion reste impossible) mais ils
ne sont pas annulés. **Décision à prendre : les laisser ou revenir à l'état d'origine.**

### ~~🔴 Écart réel, découvert au passage~~ — CLOS le 2026-08-14

**Élucidé, puis refermé.** Le vrai bcrypt d'`owner.dev` venait de
`scripts/dev-account.sh`, le script committé dont c'est l'objet — pas d'un geste
inexpliqué. La sentinelle de `015:34` est rétablie et **l'échec de connexion est vérifié
au navigateur**. Voir la passe du 2026-08-14 en tête de fichier. La condition 1 d'ADR-016
**est tenue**.

### Conséquence sur « RLS vérifiée pour les 3 rôles » (§7.2 de CLAUDE.md)

Ce contrôle ne se mesure **pas** en se connectant à trois comptes — ADR-016 l'interdit.
Il se mesure comme `015` le prévoit : en **empruntant** `request.jwt.claim.sub` dans des
tests SQL. C'est la voie à prendre, et elle ne demande aucun mot de passe.
**Ne pas « réparer » les deux comptes : ce serait défaire un garde-fou d'ADR gelé.**

## Prochaine tâche

V2 est commité. Ce qui attend, dans l'ordre où ça coûtera le moins cher :

1. **Poser `CORS_ORIGINS`** sur l'origine réelle du cabinet — avant toute mise en service.
2. **Arbitrer `app.search_patients`** (défaut n°1 ci-dessus) : l'ordre de recherche
   contredit l'ordre d'affichage. Correction par migration `035`, jamais par édition de 018.
3. **La voix** : transport binaire (contrat `DbPort`, ADR-020) **et** CORS des deux
   fonctions — les deux, ou aucune.
4. **Le contrôle 2** (homonymes) reste BLOQUÉ jusqu'à V5 : il demande `create_patient`.

---

## 9 passes de revue de la migration `032` — HISTORIQUE UNIQUE, source d'autorité

⚠️ **Ce document est la SEULE source de l'historique de revue de `032`, jamais exécutée ni persistée en base. Chaque passe corrige des erreurs et peut en introduire de nouvelles. Le détail conservé ici prévient un silence trompeur dans le prochain audit.**

- **v1** (5 ROUGE) : pas de plancher `p_threshold` · transition `appointments` manquante · fenêtre `now() - 12h` au lieu d'id épinglé · commentaire sur-déclarant attribution NULL · numérotation non documentée.
  
- **v2** (5 + 2 ROUGE) : 5 antérieurs corrigés. Nouveaux : `GRANT EXECUTE TO authenticated` exposé au navigateur · garde « introuvable »/« close » silencieuse (même branche, risque id absent).

- **v3** (GRANT retiré, mais nouveau risque 3 ROUGE) : GRANT ôté. `RAISE NOTICE` → `RAISE WARNING`. MAIS comment vérifier post-application hors transaction? Jamais fait (affirmation fausse). Et sous `FORCE ROW LEVEL SECURITY`, si `postgres` n'a pas `BYPASSRLS`, silence total (jamais mesuré).

- **v4 — RÉÉCRITURE** : bloc `DO` ad hoc (id production) retiré. Migration devient rejouable. UUID sortirait d'ici et du geste manuel ci-dessous.

- **v4 → 4ᵉ revue (4 ROUGE documentaires)** : (1) affirmation `rolsuper` FAUSSE — 019 mesure `rolsuper=f, rolbypassrls=t` · (2) UUID encore 3× dans le fichier · (3) commentaire décrivait scoping par RLS qui n'existe PAS sous `BYPASSRLS` · (4) renvois cassés après retrait `DO`.

- **v4 → 5ᵉ revue (4 ROUGE, 2 de correction précédente)** : (1) « SUPERUSER ou BYPASSRLS » = hypothèse, 019 réfute · (2) commentaire FONCTION affirme « appelée via » procédure manuelle = FAUX · (3) affirmation « script retiré » = FAUX (5 refs subsistent légitimement) · (4) post-check oubliait `app.appointments` (irréversible).

- **v4 → 6ᵉ revue (5 ROUGE, copier-coller résiduels)** : mot « superutilisateur » persiste 2× · décompte de ROUGE en en-tête ne correspond plus · section GESTE MANUEL contredit elle-même (« NON EXÉCUTÉ » vs confirmation ✅).

- **v4 → 7ᵉ revue (6 ROUGE, bookkeeping)** : décompte encore listé après retrait · « superutilisateur » 2× · titre section contradicts texte · renvoi 026 §4 orphelin · ligne ✅ sur-déclare par omission (pas la réserve `app.appointments`).

- **v4 → 8ᵉ revue (4 ROUGE, 1 RÉEL SQL)** : `REVOKE ALL FROM PUBLIC` ne touche pas GRANT déjà à authenticated; rejeu ne le retirerait pas · `CREATE OR REPLACE` préserve GRANT ancien. **Corrigé** : cible `PUBLIC, authenticated`. Documentaire : décompte de ROUGE faux, en-tête cite conformité inexacte, saut labels v4→v6.

- **v4 → 9ᵉ revue (3 ROUGE, 1 créé par correction v8)** : paragraphe v8 affirme « équivalent rempli checklist » FAUX (geste = 0 ligne). Deux citations `REVOKE` non mises à jour suite ajout `authenticated`, une persistée dans COMMENT.
  
**Arrêt après v9** : SQL exécutable VERT depuis v4. Passes 5-9 trouvaient QUE documentaire. Prochaine relecture = humaine.

---

## Section GESTE MANUEL — fermeture orphelin (exécuté, 2026-08-10)

✅ **EXÉCUTÉ SUR `app.consultations` · ⚠️ `app.appointments` NON RECONTRÔLÉ** (lecture seule).

Consultation `1c4ea86f-e432-4693-b615-130af53d665d` (orpheline, `started_at` 6 jours antérieur). Rôle: `postgres` (`DATABASE_URL`), `rolsuper=f, rolbypassrls=t` (019:13-14).

**Procédure** (ICI SEULEMENT, jamais en `032`):

1. Pré-read : `SELECT status FROM app.consultations WHERE id = '1c4ea86f…'` → doit être `'open'`.

2. Écriture :
```sql
BEGIN;
UPDATE app.consultations SET status='closed' WHERE id='1c4ea86f…' AND status='open';
UPDATE app.appointments a SET status='completed', updated_at=now()
  FROM app.consultations c WHERE c.id='1c4ea86f…' AND a.id=c.appointment_id
  AND a.status NOT IN ('completed','cancelled');
COMMIT;
```

3. Post-vérif : `SELECT c.status, c.ended_at, a.status FROM app.consultations c LEFT JOIN app.appointments a ON a.id=c.appointment_id WHERE c.id='1c4ea86f…'`
   → Attendu : `status='closed', ended_at NULL, a.status='completed'`.

**Résultat** : ✅ consultation confirmée `status='closed'`, `ended_at` NULL, 0 ligne modifiée (déjà clos). **`app.appointments` non vérifié depuis** — plausible déjà `'completed'` par chemin antérieur, non certifié.

---

## Jarvis — clé OpenRouter à zéro crédit, modèle gratuit en test (2026-08-16)

**Panne diagnostiquée** : `jarvis-chat` répondait `indisponible` sur tout appel. Mesuré dans
`audit.boundary_crossings` (projet `ftxaseynjvjevwybdoii`) : 25 franchissements consécutifs,
tous `outcome='error'`, latence 26–336 ms — trop court pour une génération, signature d'un
refus HTTP immédiat d'OpenRouter (402, crédits épuisés). Clé remplacée par l'utilisatrice
et reposée en secret Supabase (`OPENROUTER_API_KEY`), hors dépôt.

**Décision produit** : le cabinet ne rechargera le compte OpenRouter qu'à la fin de la
construction — la doctoresse achètera les crédits une fois l'app finie. En attendant, la
phase de test tourne sur un **modèle gratuit** (`openai/gpt-oss-20b:free` sur OpenRouter),
fixé par le secret `OPENROUTER_MODEL` — **aucun changement de code** : `resolveModel()`
([external-call.ts:121](supabase/functions/_shared/external-call.ts#L121)) lit déjà cette
variable avant `DEFAULT_MODEL`.

⚠️ **À faire avant toute démo/livraison à la doctoresse** : une fois les crédits achetés,
retirer (`supabase secrets unset OPENROUTER_MODEL`) ou repointer ce secret vers
`google/gemini-2.5-flash` — le modèle payant déjà décidé en production
(`02-SECURITY-BOUNDARY.md` §5.2, arbitrage 2026-08-05). Un modèle `:free` est rate-limité
(quelques dizaines d'appels/jour selon le compte) : suffisant pour tester, pas pour un
usage clinique réel.
