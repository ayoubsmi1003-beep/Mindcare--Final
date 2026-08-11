# S7a — FINANCE

> **Statut : contrat d'implémentation APPROUVÉ ET GELÉ, en attente d'exécution.**
> Approuvé par l'utilisateur le 2026-08-05. Aucune ligne de code écrite à ce jour.
> **Ce document ne se réduit pas, ne se simplifie pas, ne se réinterprète pas** — il
> s'implémente exactement tel qu'écrit. Toute divergence constatée à l'implémentation
> se remonte avant d'être codée, pas après.
> Suite : `docs/S7B-DOCUMENTS.md`, à ouvrir une fois S7a clos.

## Contexte

S6 est clos (`analyze_session` prouvé de bout en bout, RLS vérifiée aux 3 rôles à chaque
couche). Le jalon suivant, selon `docs/SPRINT-4-DAYS.md` §S7, est **Finance + Documents**.

**Ce plan ne couvre que Finance.** Documents est reporté en S7b, décision de l'utilisateur,
parce que ses prérequis ne sont pas fournis et que le sprint doc les déclare lui-même
bloquants (§5) :

- le **scan de l'en-tête** et l'arbitrage « Pychiaterie » (ADR-011, questions ouvertes) ;
- le **logo SVG** (seul `lOGO.JPG.jpg` existe, en raster, à la racine) ;
- les **7 fontes `.woff2`** — aucune n'est dans le dépôt, `src/styles/tokens.css:137` le
  documente explicitement ; `--font-doc: Newsreader` retombe aujourd'hui sur Georgia ;
- les **4 `document_templates` n'ont jamais été semés** — `015_seed_data.sql:75` ne pose que
  le compteur `document`, aucune ligne de modèle.

Le checkpoint S7 est « imprimer un certificat sur papier et le poser à côté d'un vrai ».
Sans le scan ni les fontes, ce contrôle ne peut pas être signé honnêtement. Finance passe
donc en premier — ce qui est aussi l'ordre de la règle du sacrifice §2 (Finance est ⛔ D-09,
Documents est le n°2 de la liste des coupes).

**Résultat attendu de S7a :** la praticienne fixe un tarif en fin de séance, l'écran
`/finance` montre la recette du jour et les encaissements en attente, et le chiffre
d'affaires reste cloisonné par praticien.

---

## Décisions actées avec l'utilisateur (2026-08-05)

1. **Finance seul cette session.** Documents devient S7b, à lancer quand le scan, le logo et
   les fontes sont fournis.
2. **La praticienne encaisse, pas l'assistante.** `011` ne donne que `SELECT` à
   l'assistante, avec un commentaire signalant l'écart possible avec §10.1. **On n'élargit
   aucune permission** — D-08 reporte le front assistante en semaine 2 de toute façon.
   Le commentaire de 011 reste tel quel : un constat signalé, toujours pas comblé.
3. **Recette par périmètre.** `owner` → recette du cabinet, tous praticiens confondus.
   `practitioner` → sa recette à elle seule. `assistant` → aucun total. Une seule porte, le
   filtrage est décidé **en base** par le rôle, jamais en JavaScript (règle 4).
4. **Écran `/finance` dédié.** L'entrée de navigation `finances` existe déjà dans
   `AppShell.tsx:83,101` — elle est inerte, S7a l'active. Rien à ajouter à l'agenda : c'est
   le seul écran que l'assistante verra en semaine 2, le CA n'y a pas sa place.
5. **La notification est écrite dès maintenant** (`kind='payment_due'`, payload sans aucune
   donnée clinique — I5). Aucun abonnement Realtime côté client cette session ; le poste
   assistante de semaine 2 se branche dessus sans retoucher la base.

## Renforcements exigés, intégrés au contrat (2026-08-05)

Cinq clarifications demandées par l'utilisateur après acceptation du plan. Ce sont des
**levées d'ambiguïté**, pas des fonctionnalités : aucune n'ouvre une permission, aucune ne
touche un ADR, aucune ne modifie le périmètre. Chacune est écrite à l'endroit du plan où elle
s'applique, et **chacune est vérifiée par un contrôle du checkpoint** — sans quoi elle ne
serait qu'une intention.

| # | Exigence | Où c'est écrit | Prouvé par |
|---|---|---|---|
| 1 | Frontière transactionnelle explicite, aucun état partiel, aucun numéro de reçu consommé sur rollback | §2, §3 | contrôles 19, 20 |
| 2 | Contrôle de concurrence explicite — `FOR UPDATE` sur la séance **puis** sur le paiement | §2, §3 | contrôles 4, 19, 21 |
| 3 | Trace financière immuable des modifications de montant, **sans mécanisme parallèle** | §2ter | contrôle 17 |
| 4 | Le temps est celui du serveur, jamais celui du poste | §2quater | contrôle 22 |
| 5 | Contrat de performance, index documentés, aucun balayage séquentiel | §1bis, §4, §5 | contrôle 18 |

**Hors périmètre, explicitement :** les outils Jarvis `set_consultation_price` /
`record_payment_collected` de `03-JARVIS-TOOLS.md` §4.6. La décision 3 de S6 gèle la boucle
proposer-confirmer et les 7-8 autres outils. S7a construit les **portes SQL et l'écran**, pas
des outils Jarvis. Les noms coïncident ; le chantier non.

---

## Ce qui existe déjà, à réutiliser sans le refaire

| Existant | Où | Usage en S7a |
|---|---|---|
| `app.payments` + les 3 policies ADR-005 | `011_payments_notifications.sql` | **non touché** |
| `app.notifications` + `notifications_mine` | `011` | **non touché** |
| `app.next_number(cabinet, scope, period)` | `010` | `receipt_number`, scope `'payment'` |
| compteur `payment` semé à 0 | `015_seed_data.sql:75` | rien à ajouter |
| `app.current_role()`, `app.current_cabinet()`, `app.is_cloud_dev()` | `003`, `023` | portes 029 |
| motif de porte + `OWNER TO app_gatekeeper` + `GRANT/REVOKE CREATE` symétriques | `026` §3/§8, `027` §0/§3 | à recopier **exactement** |
| couche service `rpc` uniquement, `Result<T>` | `src/services/consultations.ts` | modèle de `finance.ts` |
| `db()`, `RpcArgs` (scalaires seuls, ADR-020) | `src/services/db/port.ts` | idem |
| composants `ui/` + jetons | `src/components/ui/`, `src/styles/tokens.css` | écran `/finance` |
| états vide / erreur | `src/components/EtatsEcran.tsx` | écran `/finance` |

---

## 1 · Migration `029_payment_gates.sql`

**Additif pur.** Ne modifie ni `010`, ni `011`, ni aucune policy existante — même discipline
que `022`, `026`, `027`.

### §0 · `GRANT CREATE ON SCHEMA app TO app_gatekeeper`
Nécessaire au transfert de propriété, **retiré au §4 de ce même fichier**. C'est le défaut n°1
trouvé en S6 : `026` accorde puis retire ce privilège dans SA transaction, une migration
séparée hérite d'un rôle déjà refermé et échoue en 42501. Symétrie obligatoire, dans le
fichier, pas ailleurs.

### §1 · Privilèges nommés, pas hérités
```
GRANT SELECT ON app.consultations TO app_gatekeeper;  -- déjà posé en 026 §3, idempotent
GRANT SELECT ON app.payments      TO app_gatekeeper;
GRANT SELECT ON app.profiles      TO app_gatekeeper;  -- vérifier s'il est déjà posé
```
Aucun privilège d'écriture sur `app.payments` pour `app_gatekeeper` : les portes d'écriture
sont `SECURITY INVOKER` et écrivent sous l'appelante, sous ses policies.

### §1bis · Index requis par les portes de lecture (contrat de performance)

`011` ne pose que `app.payments (practitioner_id, created_at DESC)` — il sert
`list_day_payments` pour une praticienne, **pas** `day_revenue` pour l'owner, qui filtre sur
`cabinet_id` et une journée. Sans index, une année d'exploitation transforme la recette du
jour en balayage séquentiel, sur l'écran qui doit se lire en une demi-seconde.

```sql
CREATE INDEX IF NOT EXISTS payments_cabinet_day
  ON app.payments (cabinet_id, created_at DESC);
```

Les portes filtrent la journée par **plage bornée** — `created_at >= p_day::timestamptz AND
created_at < (p_day + 1)::timestamptz` — jamais par `created_at::date = p_day`, qui écarte
l'index par transformation de la colonne. Écrit ici parce que c'est exactement le genre de
détail qui se perd à l'implémentation et ne se voit jamais sur un jeu de test.

### §2 · `app.set_consultation_price(p_consultation_id uuid, p_amount_dzd integer) RETURNS uuid`

`SECURITY INVOKER`. `authenticated` possède déjà INSERT sur `app.payments` (privilèges par
défaut de `001`), `pay_owner` / `pay_practitioner` portent le `USING` — la RLS décide.

**Transaction unique et verrou explicite.** Une fonction PL/pgSQL appelée par PostgREST
s'exécute dans une seule transaction implicite : validation, verrou, allocation du numéro de
reçu, écriture du paiement et écriture de la notification réussissent ensemble ou ne laissent
rien. Aucun état partiel n'est observable. Ce n'est pas seulement une propriété agréable :
`app.next_number` (010) incrémente un compteur, et un `ROLLBACK` doit rendre ce numéro —
c'est précisément ce qu'une `SEQUENCE` ne ferait pas, et la raison d'I17. Le trou dans une
numérotation médico-légale est une suspicion.

L'ordre est imposé, et le verrou vient **avant** la décision de créer ou de mettre à jour :

1. validation des arguments et du périmètre ;
2. `SELECT ... FROM app.consultations WHERE id = p_consultation_id FOR UPDATE` — verrouille
   la séance, ce qui **sérialise deux appelants même quand aucun paiement n'existe encore**.
   Verrouiller le paiement seul ne suffirait pas : deux transactions ne trouvant ni l'une ni
   l'autre de ligne insèreraient toutes deux ;
3. `SELECT ... FROM app.payments WHERE consultation_id = p_consultation_id FOR UPDATE` —
   verrouille le paiement existant, s'il y en a un ;
4. `INSERT` ou `UPDATE` selon le résultat de (3) ;
5. allocation du numéro de reçu par `app.next_number`, **uniquement sur le chemin `INSERT`** ;
6. écriture de la notification ;
7. `COMMIT` implicite au retour de la fonction.

L'index unique partiel du point suivant reste posé malgré ces verrous : il rend la règle vraie
pour **tout** chemin d'écriture, y compris un `INSERT` en SQL direct qui n'appelle pas cette
porte. Le verrou donne un comportement déterministe ; l'index donne la garantie. Les deux, pas
l'un ou l'autre — c'est la même discipline que la fenêtre de 15 minutes en 026, où l'écran
affiche et où la base décide.

Comportement attendu sous deux onglets, un double clic, un rejeu ou deux requêtes
concurrentes : **un seul paiement, aucune mise à jour perdue, aucun résultat dépendant de
l'ordonnancement.**

Garde métier, dans l'esprit de `start_consultation` :
- séance introuvable **ou hors périmètre** → `RETURN NULL`, jamais une erreur qui
  distinguerait les deux cas (cloison ADR-003, même principe que `get_consultation` 026 §6) ;
- `practitioner_id <> auth.uid()` → refus explicite. Le tarif d'une séance appartient à qui
  l'a conduite ; `can_see_clinical` rend `true` à l'owner en LECTURE, ce qui serait absurde
  ici, exactement comme pour l'ouverture d'une séance ;
- `p_amount_dzd IS NULL` ou `< 0` → exception. Le `CHECK` de `011` est la vraie barrière ;
  le test ici ne fait que rendre le message lisible ;
- **rejouable** : un paiement existe déjà pour cette séance → `UPDATE` du montant tant que
  `collected_at IS NULL`, refus si déjà encaissé. Même raisonnement que la reprise de
  `start_consultation` : un double clic ou un rechargement ne doit pas produire une violation
  d'unicité illisible, ni une seconde ligne de recette.
  → **un index unique partiel `ON app.payments (consultation_id) WHERE consultation_id IS NOT NULL`**
  rend cette règle vraie en base et pas seulement dans la porte (motif `one_note_per_consultation`, 026 §2).
  ⚠️ À vérifier avant de le poser : `015_seed_data.sql` ne doit contenir aucun paiement qui
  le violerait.
- `receipt_number` ← `app.next_number(app.current_cabinet(), 'payment', to_char(now(),'YYYY'))`,
  jamais une SEQUENCE (I17) ;
- `cabinet_id` ← `app.current_cabinet()`, `practitioner_id` ← `auth.uid()`, `set_by` ←
  `auth.uid()`, `patient_id` ← lu sur la séance. **Aucun de ces champs n'est choisi par
  l'appelant** — leçon de `023`, rejouée ici ;
- insertion de la notification `payment_due`, payload `{receipt_number, amount_dzd}` et
  **rien d'autre** : ni nom, ni `patient_id`, ni motif (règle 1, I5).

### §2ter · La trace financière — l'infrastructure existante suffit, on ne double pas

Toute modification d'un montant non encaissé est un **événement financier** et doit laisser
une trace immuable : séance, paiement, montant précédent, montant nouveau, auteur, horodatage.

**Vérifié avant d'écrire ce plan : `app.payments` porte déjà `trg_audit`** — `013` l'attache
par liste explicite, et `payments` y figure. Un `UPDATE` du montant écrit donc déjà dans
`audit.log` : `row_id` (le paiement), `old_values`/`new_values` (dont `consultation_id` et
`amount_dzd`, avant et après), `actor_id`, `actor_role`, `occurred_at`, `changed_fields`.
Les six champs exigés sont couverts.

**Aucun mécanisme parallèle ne sera introduit**, et c'est un choix, pas une économie : une
seconde table d'audit financier créerait deux vérités sur le même événement, et le jour où
elles divergent, c'est la pièce comptable qui ment. `audit.log` est déjà en ajout seul —
`UPDATE` et `DELETE` révoqués à `PUBLIC`, `anon`, `authenticated`, `service_role` (013) —
donc l'immuabilité est déjà tenue, par le même dispositif que le reste du dossier.

Ce qui reste à faire est donc uniquement de **prouver** que la trace existe : contrôle 17 du
checkpoint. Pas de code.

Exposition : `audit.log` capte `patient_id` parce qu'il est colonne de `app.payments`. C'est
le comportement existant de l'infrastructure, sur une table déjà auditée, lisible par le seul
`audit_read_owner` (013) — pas un élargissement.

### §2quater · Le temps est celui du serveur, jamais celui du poste

Tout horodatage et toute décision de numérotation viennent de `now()` en base. Aucune porte de
`029` ne prend de timestamp en paramètre : `created_at` (défaut de la table, 011),
`collected_at`, la période du compteur (`to_char(now(),'YYYY')`) et l'ordre chronologique des
reçus sont décidés côté PostgreSQL.

Ni `Date`, ni le fuseau du navigateur, ni un horodatage transmis par l'appelant n'entrent dans
une écriture financière. C'est le même raisonnement qu'en `026` sur la fenêtre de 15 minutes :
si l'horloge du poste dérive de deux minutes, c'est la base qui a raison. Une différence ici :
un reçu daté de la veille par une horloge fausse est une pièce comptable fausse.

`p_day` de `day_revenue` / `list_day_payments` est un **argument de lecture**, pas une source
de temps — il choisit la journée à afficher, il n'horodate rien. L'écran l'envoie ; s'il se
trompe, il affiche la mauvaise journée et n'écrit rien de faux.

Seule exception admise côté client : `noteEstVerrouillee(note, maintenant)` en S5 prend
l'heure en paramètre pour rester testable, et ne décide que de ce qui est **affiché**. Aucune
porte financière ne fait de même.

### §3 · `app.record_payment_collected(p_payment_id uuid) RETURNS uuid`
`SECURITY INVOKER`. Pose `collected_by = auth.uid()`, `collected_at = now()`. Rejouée sur un
paiement déjà encaissé → `RETURN` l'id sans réécrire l'horodatage : réencaisser n'est pas un
geste, et réécrire `collected_at` effacerait l'heure réelle. Introuvable ou hors périmètre →
`NULL`.

**Transaction unique, verrou explicite.** `SELECT ... FROM app.payments WHERE id =
p_payment_id FOR UPDATE` **avant** de tester `collected_at`. Sans ce verrou, deux clics
simultanés lisent tous deux `collected_at IS NULL` et le second écrase l'horodatage du
premier — une perte de mise à jour sur l'heure réelle d'un encaissement. Le verrou rend le
test et l'écriture atomiques ; l'idempotence en découle au lieu d'être espérée.

### §4 · `app.day_revenue(p_day date) RETURNS TABLE(...)` — la cloison

`SECURITY DEFINER`, `OWNER TO app_gatekeeper`, posé **explicitement** (leçon de `018`, revue
en `024`/`025` : un `DROP` emporte le propriétaire et réattribue à `postgres`, qui est
`rolbypassrls` — la cloison tombe pendant que la migration reste verte). Si un `DROP` est
nécessaire, `OWNER TO app_gatekeeper` doit suivre immédiatement dans le même fichier.

DEFINER pour la même raison qu'en `027` : `audit.log_read` n'a `EXECUTE` accordé qu'à
`app_gatekeeper`. Vérifier dans `020` §2 avant d'écrire.

Le filtrage est **dans la fonction, en SQL**, décidé par `app.current_role()` :
- `owner` → toutes les lignes du cabinet ;
- `practitioner` → `practitioner_id = auth.uid()` seulement ;
- `assistant` → **0 ligne**. Pas une erreur : un écran vide, comme « premier passage, rien à
  comparer » en `027`.

Rend le total, le nombre de séances, le nombre et le total des encaissements en attente.
Pas d'audit de lecture ici : aucun nom de patient n'en sort.

**Contrat de performance.** Une ligne rendue, agrégée sur la journée, servie par
`payments_cabinet_day` (§1bis) avec la plage bornée décrite plus haut. Aucun balayage
séquentiel sur `app.payments` dans une charge normale. Budget : cet écran doit se lire en une
demi-seconde avec un patient qui parle, ce qui laisse la porte largement sous les 100 ms —
elle agrège les paiements d'**une** journée d'un cabinet solo, pas un historique.

### §5 · `app.list_day_payments(p_day date) RETURNS TABLE(...)`
Les lignes du jour : `payment_id`, `receipt_number`, `amount_dzd`, `collected_at`,
`patient_first_name`, `patient_last_name`, `record_number`, `practitioner_name`.
**Celle-ci nomme des patients** → `SECURITY DEFINER`, `OWNER TO app_gatekeeper`, et **appelle
`audit.log_read` AVANT la lecture**, comme `get_consultation`. Même filtrage par rôle qu'au
§4 ; l'assistante rend 0 ligne (elle n'a pas de front cette session, mais la porte est écrite
une fois pour toutes).

**Contrat de performance.** Accès indexé uniquement : `payments_cabinet_day` pour l'owner,
`payments (practitioner_id, created_at DESC)` (011) pour la praticienne, puis des jointures
par clé primaire sur `app.patients` et `app.profiles`. Volume borné par une journée de
cabinet — quelques dizaines de lignes. Aucun balayage séquentiel attendu ; le contrôle 18 du
checkpoint le vérifie par `EXPLAIN`, pas par intuition.

### §6 · `REVOKE CREATE ON SCHEMA app FROM app_gatekeeper` + `INSERT INTO app.schema_migrations`

---

## 2 · Couche service — `src/services/finance.ts`

Copie stricte de la discipline de `src/services/consultations.ts` : **ce fichier ne requête
aucune table**, uniquement `db().rpc(...)` sur les 4 portes de `029`. En-tête de fichier
expliquant pourquoi (lecture non auditée = le chemin qu'ADR-019 a fermé).

- types `Paiement`, `RecetteDuJour` ; lignes `snake_case` → objets `camelCase` via des
  `toX()`, comme `toConsultation` ;
- `setConsultationPrice`, `recordPaymentCollected`, `getDayRevenue`, `listDayPayments`,
  chacune rendant `Result<T>` ;
- `log.error` **sans aucun identifiant patient** (règle 1) ;
- une fonction de formatage `formaterDzd(montant: number): string` — **une seule**, lue par
  l'écran de séance ET par `/finance`. C'est la leçon de `repartition()` en S4 : deux calculs
  pour une même vérité finissent par diverger, et ici ils divergeraient sur un montant.

---

## 3 · Écran — saisie du tarif en fin de séance

Dans `src/app/consultation/[id]/page.tsx` (977 lignes — **ne pas le grossir** : le bloc part
dans `src/components/BlocTarif.tsx`, importé par la page).

ADR-010 : « le médecin saisit le prix manuellement en fin de séance ». Le bloc apparaît près
de l'action « Clore la séance ».

- champ montant en `--font-num` (tabular-nums), suffixe `DZD`, entiers seuls (ADR-018 : pas
  de centimes à stocker) ;
- bouton nommant son action — `Fixer le tarif` → toast `Tarif fixé.` ;
- si un tarif existe déjà : montant affiché, modifiable **tant que non encaissé**, en lecture
  seule ensuite, avec la raison écrite à l'écran ;
- rien de rouge ici. Le rouge est un budget : disque critique et perte de données.

---

## 4 · Écran — `src/app/finance/page.tsx`

- **Recette du jour** en gros chiffre, `--font-num`, lisible en une demi-seconde avec un
  patient qui parle (le test n°2 de CLAUDE.md) ;
- sous-titre honnête sur le périmètre : « cabinet » pour l'owner, « vos séances » pour la
  praticienne — ce que la base a réellement filtré, pas une étiquette générique ;
- liste des paiements du jour, un bouton `Encaisser` par ligne non encaissée →
  toast `Encaissement enregistré.` ;
- **état vide** : « Aucun encaissement aujourd'hui. » Pas de donnée fictive (règle 8) ;
- **état d'erreur** via `EtatsEcran.tsx`, dégradation propre si la base ne répond pas ;
- garde de rôle sur la route, à l'image de celle de `/consultation/*` posée en S5 ;
- activer l'entrée `finances` de `AppShell.tsx` (elle existe, inerte, lignes 83 et 101) ;
- toutes les chaînes dans `src/i18n/fr.ts`, nouvelle section `finance` — aucune chaîne en dur.

---

## 5 · Vérification

### Portes (obligatoire, avant tout commit)
```bash
grep -rn "fetch(['\"]https://" --include="*.ts" --include="*.tsx" src/ supabase/ | grep -v "_shared/external-call.ts"
grep -rn "SERVICE_ROLE\|GROQ_API_KEY\|OPENROUTER_API_KEY" src/
find . -name "*.webm" -o -name "*.wav" -o -name "*.ogg"
pnpm typecheck && pnpm lint && pnpm build && bash scripts/preflight.sh
```
Les trois `grep`/`find` ne rendent rien. Une seule sortie = pas de commit.

### `scripts/checkpoint-s7.sh` — paires succès/échec, sur base réelle
Rejouer `001→029` sur une base locale neuve d'abord : c'est ce qui a trouvé le défaut n°1 de
S6, invisible en relecture.

| # | Contrôle | Attendu |
|---|---|---|
| 1 | `finance.ts` ne nomme aucune table (`grep` sur `.from(`) | 0 occurrence |
| 2 | `029` ne contient pas `CREATE SEQUENCE` (I17) | 0 occurrence |
| 3 | owner a1 fixe un tarif sur sa séance | `receipt_number` rendu |
| 4 | **rejeu** de la même porte, même séance | même paiement, pas de 2ᵉ ligne |
| 5 | practitioner a2 fixe un tarif sur la séance de a1 | `NULL` — pas une erreur distinctive |
| 6 | assistant a3 idem | `NULL`, message **identique mot pour mot** à celui de a2 |
| 7 | `consultation_id` inexistant, appelé par a1 | **même retour encore** — aucune fuite |
| 8 | `day_revenue` owner | total cabinet, a1 + a2 |
| 9 | `day_revenue` practitioner a2 | **son seul total**, jamais celui de a1 (ADR-005) |
| 10 | `day_revenue` assistant a3 | 0 ligne, pas d'exception |
| 11 | `list_day_payments` a3 | 0 ligne |
| 12 | `list_day_payments` a1 → `audit.log` | ligne de lecture écrite |
| 13 | `next_number('payment')` ×100 concurrent | 1..100 sans trou (T5 du §15) |
| 14 | `amount_dzd = -1` | violation du `CHECK` |
| 15 | encaisser deux fois | `collected_at` **inchangé** |
| 16 | `proowner` de `day_revenue` et `list_day_payments` | `app_gatekeeper`, pas `postgres` |
| 17 | **trace financière** — modifier un montant non encaissé, puis lire `audit.log` | 1 ligne `update` sur `payments`, `changed_fields` contient `amount_dzd`, `old_values`/`new_values` portent l'ancien et le nouveau montant, `actor_id` et `occurred_at` renseignés |
| 18 | `EXPLAIN` sur `day_revenue` et `list_day_payments` | **aucun `Seq Scan` sur `app.payments`** — index utilisé |
| 19 | **concurrence réelle** : deux sessions `psql` fixent un tarif sur la même séance, la seconde démarre avant le `COMMIT` de la première | **un seul paiement**, un seul numéro de reçu, la seconde attend le verrou puis met à jour |
| 20 | **rollback du compteur** : `BEGIN` → `set_consultation_price` → `ROLLBACK`, puis relire `app.counters` | `current_value` **inchangé** — aucun numéro consommé (I17) |
| 21 | deux sessions encaissent le même paiement simultanément | `collected_at` écrit **une seule fois**, valeur de la première |
| 22 | aucune porte de `029` ne prend de timestamp en paramètre | `grep` sur les signatures : 0 argument `timestamptz` |

Les contrôles 19, 20 et 21 exigent **deux sessions `psql` simultanées**, pas deux appels
successifs : une paire séquentielle passerait au vert sans rien prouver du verrou. Le script
ouvre donc deux connexions, laisse la première ouverte sur sa transaction, lance la seconde,
et vérifie qu'elle attend au lieu d'insérer. C'est le seul moyen de distinguer « idempotent »
de « idempotent tant que personne ne clique deux fois vite ».

Les contrôles 5-6-7 sont le cœur : les trois cas doivent être **indiscernables**. C'est le
principe déjà tenu par `get_consultation` et prouvé sur `analyze_session` en S6.

⚠️ **Dette environnementale connue.** `checkpoint-s7.sh` doit tourner par `docker exec` sur le
conteneur Postgres déjà démarré par `supabase start`, **pas** par le conteneur jetable
`postgres:15` de `scripts/lib/dburl.sh` — Docker Hub reste injoignable sur ce poste (Docker,
lui, fonctionne). Le choix entre corriger `qfull()` et trouver un miroir d'image reste une
**décision de l'utilisateur**, notée dans STATE.md : ce sont des scripts de vérification,
leur fiabilité est ce qu'on leur demande.

### Contrôle d'écran
Reste sans navigateur dans cet environnement — même blocage que S5 §7 et S6. À noter comme
dette datée, pas à déclarer vert.

---

## 6 · Commits

Un commit par tâche :
1. `feat(finance): portes 029 — tarif, encaissement, recette cloisonnée`
2. `feat(finance): couche service sur les portes 029`
3. `feat(finance): saisie du tarif en fin de séance`
4. `feat(finance): écran recette du jour`
5. `test(finance): checkpoint-s7`

Revue `security-reviewer` avant le commit 1 (il touche base + RLS).

---

## 7 · Ce que S7a laisse ouvert

- **S7b — Documents**, bloqué sur le scan de l'en-tête, l'arbitrage « Pychiaterie », le logo
  SVG, les 7 fontes et le seed des 4 modèles. À relancer dès que ces éléments sont fournis.
- **Dette S6**, datée avant 2026-08-10, inchangée : `audit.boundary_crossings` non confirmé
  en écriture, `checkpoint-s5`/`adr019`/`jarvis` injouables, contrôles d'écran sans
  navigateur.
- L'assistante ne peut toujours pas encaisser (décision 2). Le constat de `011` reste
  signalé, non comblé.
