# V9 — Liste d'exécution (mode autonome)

> Fichier de reprise. Si la session s'arrête, TOUT ce qu'il faut pour continuer est ici.
> Plan directeur : `.opencode/plans/v9-transformation-plan.md`.

**Dernière mise à jour : 2026-09-08, session « transformation V9 ».**

---

## ÉTAT GLOBAL

| Lot | Sujet | État |
|---|---|---|
| A | Consultation → cockpit à onglets | ✅ livré, vérifié navigateur |
| C | Rôle / session | ✅ livré, 9/9 E2E |
| F | Civilité + situation familiale | ✅ **complet** (088+089), 5/5 E2E, preuve sur documents réels |
| B | « Depuis la dernière fois » (onglet Résumé) | ✅ livré, O4 vérifie l'absence d'appel modèle |
| S | Passe sécurité adversariale sur les portes du lot A | ✅ 5/5, aucune faille |
| D | Alexa — lanceur + registre de réponse | 🟡 partiel (lanceur ✅, registre ✅, évals câblées ✅) |
| E | Graphiques — palette catégorielle | ✅ deux défauts réels corrigés |

**Vérification au dernier point de contrôle :** `typecheck` 0 (2 passes) · `lint` 0 ·
`vitest` **455 OK** / 54 skippés · `verifier-base` **87 migrations** · build OK ·
`pnpm eval:jarvis` **VERDICT VERT** · **suite E2E complète 103/103, aucun échec**
(passe non contendue, 9,6 min).

> La passe complète 91/91 confirme rétrospectivement que les 4 échecs constatés plus
> tôt étaient bien environnementaux (Docker tombé + séance restée ouverte), et non des
> régressions : mêmes tests, même code, base saine → tout vert.

---

## FAIT

### Lot A — Consultation
- Sous-navigation `Séance · Séances précédentes · Traitement · Documents · Rendez-vous`
  (`src/app/consultation/[id]/page.tsx`), réemploi de `Onglets`/`PanneauOnglet`.
- `src/components/consultation/PanneauHistorique.tsx` (NEUF) : cliquer une date passée
  déplie la note SOAP + l'analyse enregistrée, **sans changement d'URL**.
- Panneau « Séance » maintenu MONTÉ (`hidden`) : protège les `ref` des zones de texte
  dont dépend `insererDictee`. Verrouillé par O3.
- Lecture paresseuse par onglet : budget d'ouverture inchangé.
- `tests/e2e/consultation-onglets.spec.ts` **3/3**.

### Lot C — Rôle / session
- `useSessionEcran` : `reessayer()`, remontée de `hors-ligne` sur échec de profil.
- `/tableauDeBord` : `utilisateur === null` → ERREUR + réessayer, plus jamais le
  poste d'accueil composé par défaut.
- `tests/e2e/role-resolution.spec.ts` R7-R9 (NEUFS) **9/9**.

### Lot F — Civilité
- Migration `088_situation_familiale_et_civilite` appliquée.
- `app.marital_status`, `app.patients.marital_status`, `app.civilite()` (résolveur unique).
- Gabarits **v3** ; `issue_document` + `update_patient` redéfinis depuis leur signature vivante.
- Preuve : DOC-00007 (v2) imprimait « Mr/Mme/Mlle », DOC-00008 (v3) imprime « Mr ».
- `tests/e2e/civilite.spec.ts` **5/5**.

**Migration 089 — la seconde moitié.** 088 avait laissé deux trous visibles :
- `create_patient` a sa PROPRE allowlist et refuse toute clé inconnue : la
  situation ne pouvait pas être saisie À LA CRÉATION, seulement après coup.
- `get_patient_workspace` rend un CONTRAT jsonb explicite : une colonne absente
  du contrat n'existe pas pour l'écran, même si la base la porte. La fiche ne
  pouvait donc pas afficher ce qu'elle venait d'enregistrer.

Signatures vivantes trouvées **par nom de fonction** (leçon de 088) :
`create_patient` → **052** (ni 050), `get_patient_workspace` → **081** (ni 047,
048, 053, 056, 057, 076, 078, 080). Le bloc `DO` de 089 refuse la migration si
`can_see_clinical` a disparu de la recopie — la cloison ne peut pas se perdre
dans un copier-coller.

---

## À FAIRE — par valeur décroissante

1. **Lot D (reste)** : familles d'évaluation réclamées par la demande — suivi
   contextuel, « non, l'autre Karim », injection par note patient, mauvais patient,
   action non autorisée. (Le socle existe déjà et est vert : 120 contrôles de routage,
   injection, ADR-023.)
2. **Lot E — Graphiques** : sémantiser les six familles de `Graphes.tsx`.
3. **Familles d'évaluation Alexa** réclamées : suivi contextuel, « l'autre Karim »,
   mauvais patient, action non autorisée. (Le socle est vert : 120 contrôles de
   routage, injection, ADR-023.)

### Lot B — Résumé d'avant-séance (dans la Consultation)
- Onglet `Résumé` réemployant `PointDeSituation`, `SectionDepuisDerniere`, `ListeSignaux`
  — **zéro IA**, diff factuel sur les seules données du dossier.
- O4 vérifie qu'**aucun appel `/api/jarvis/`** ne part de cet onglet : le résumé
  reste vrai quand la passerelle est tombée (I20, règle 8).
- `CarteIdentite` ajoutée en BAS de l'onglet (§13) : la praticienne atteint âge,
  sexe, situation familiale et téléphone sans quitter la séance. Placée en
  dernier délibérément — ce qu'on cherche avant de recevoir, c'est ce qui a
  CHANGÉ ; l'âge se consulte, il ne s'annonce pas. C'est la SEULE carte
  d'identité de l'écran : l'en-tête porte déjà le nom.
- Corrigé au passage : `" â€” "` (tiret UTF-8 relu en Latin-1) s'affichait
  littéralement au milieu du nom d'une échelle clinique.

### Lot D — Alexa (partiel)
- `src/components/BulleAlexa.tsx` (NEUF) : lanceur flottant bas-droite, **unique**.
  Le champ de commande de la Topbar est retiré (prop `onOuvrirCommande` supprimée,
  remplacée par `avecAlexa` qui ne gouverne plus que l'orbe d'état). `⌘K` inchangé.
- ⚠️ **La vraie raison du changement, que V7 n'avait pas vue** : `AppShell` ne rend
  pas la barre supérieure en mode séance. Le lanceur unique de V7 disparaissait donc
  PENDANT une consultation — là où l'assistante sert le plus — ne laissant que `⌘K`,
  qu'aucun élément d'écran n'annonce.
- **Registre de réponse** ajouté aux DEUX prompts (`prompt.ts`, v3.0 → **v3.1**) :
  réponse d'abord, détails ensuite, pas de mur de texte, aucun terme de base de
  données, phrases prononçables. `PROMPT_VERSION` bougé car il est écrit dans la
  trace d'audit. Aucune frontière touchée (routage, pseudonymisation, outils).
- `pnpm eval:jarvis` câblé dans `package.json` — les 18 évals ne tournaient
  jusqu'ici que via un script shell que rien n'annonçait.
- **Pastille d'attente sur la bulle** (revue de mon propre travail) : Alexa ne
  fait que PROPOSER, une écriture attend une décision humaine (règle 7). Le champ
  de commande de V7 était toujours visible dans la barre ; la bulle, elle, est
  muette par nature — une proposition oubliée derrière un lanceur silencieux est
  une décision clinique jamais prise. La pastille dit qu'il y en a une, **jamais
  son contenu** : un lanceur n'est pas une surface de donnée patient. Jeton
  `--attention`, pas `--critical` (le rouge reste réservé à la perte de données).
- Tests : `alexa-lanceur.spec.ts` **5/5** · `jarvis-prompt-style.test.ts` **9/9**.

### Défaut visuel réel trouvé et corrigé — « Envoyer » hors de l'écran
Le `<footer>` du panneau Alexa est une GRILLE ; un élément de grille vaut
`min-width: auto` et refuse de descendre sous la largeur de son contenu. La ligne
saisie + voix + envoi dépassait les 380 px : **bord droit du bouton « Envoyer »
mesuré à 1520 px pour une fenêtre de 1440**. Le bouton principal de l'assistante
était hors cadre, invisible et incliquable.

⚠️ **Aucun test ne pouvait le voir** : `toBeVisible()` reste VRAI pour un élément
simplement débordé. Seule la géométrie le révèle. D'où
`tests/e2e/aucun-controle-hors-cadre.spec.ts` (**6/6**), qui mesure écran par
écran que toute commande tient dans la fenêtre. Mesuré ensuite : aucun autre
écran n'a ce défaut — la correction `min-w-0` était bien locale.

C'est le même piège que `min-h-0` documenté dans `AppShell`, sur l'autre axe.

### Lot E — les graphiques redeviennent lisibles (DEUX défauts réels)

**1 · Une série SANS COULEUR.** `--ambre-600/400` et `--corail-600/400` étaient
**référencés** par `tailwind.config.ts` et `Graphes.tsx`, mais **définis nulle
part**. Une variable CSS absente ne colore rien : la série « Charges » de
l'écran Finances sortait sans couleur, pastille de légende comprise. Ni la
compilation, ni le lint, ni un test ne le signalaient — une couleur manquante
est silencieuse.

**2 · Six familles, une seule couleur.** `tokens.css` portait le commentaire
« *conserver noms, valeurs bleutées* » : `emeraude` et `azure` valaient tous
deux `--chart-2`, et `--chart-1..5` est un dégradé d'UNE teinte (252→266, tout
bleu). C'est exactement la plainte « les graphiques sont trop uniformément
bleus » — elle était écrite dans les jetons.

**Corrigé** : les six familles reçoivent une teinte distincte à luminosité
comparable ; `azure` — le bleu de la marque — **n'est pas touché** et reste la
couleur des séries principales. `PanneauxV8` demandait déjà `familleA="emeraude"`
(recette) et `familleB="ambre"` (charges) : l'intention **vert l'argent qui
entre, ambre celui qui sort** était écrite depuis toujours, elle n'était jamais
rendue.

**3 · Légende illisible.** Le libellé était `truncate` et le montant `shrink-0` :
dans une carte étroite, « Psychothérapie individuelle » tombait à « P » et
« Thérapie groupe » à « T » — deux catégories indiscernables sur le panneau
censé dire d'où vient l'argent. Le montant passe désormais à la ligne.

Garde : `tests/unit/jetons-graphes.test.ts` (**8/8**) lit `tokens.css` et exige
que chaque famille EXISTE, que les six soient distinctes, et que les TEINTES
s'écartent d'au moins 120° — une différence de clarté seule ne survit ni à une
impression noir et blanc, ni à un écran mal réglé.

### Montants tronqués sur l'écran Finances
Les tuiles affichaient « 165 500 D… » et « 106 500 D… » — la valeur était
`truncate` avec la valeur complète en infobulle. Mais une tuile de recette se lit
au COUP D'ŒIL, et une infobulle ne se survole pas au coup d'œil. Le corps se
RÉDUIT désormais (28 px jusqu'à 9 caractères, 22 px au-delà) au lieu de couper.
Guard : mesure du débordement réel (`scrollWidth > clientWidth`), pas de
l'apparence.

### Passe sécurité — `tests/e2e/cloison-consultation.spec.ts` (5/5)
**Aucune faille trouvée.** Deux fausses alertes instructives, conservées en
commentaire dans le fichier :
- `get_patient_workspace` rend **200** à l'assistante, et c'est correct : c'est la
  porte d'identité de l'accueil. Elle ne FILTRE pas le clinique, elle ne le PORTE
  pas — `can_see_clinical` en base (081 §35) sort `clinique` et `traitements_v2`
  à `null`. S1 vérifie le CONTENU, pas le statut.
- `list_patient_timeline` et `get_consultation` rendent **200** sans `if` de rôle :
  `SECURITY DEFINER` chez `app_gatekeeper`, **sans BYPASSRLS**, donc la RLS filtre
  en évaluant `auth.uid()` de l'appelant. Mesuré : assistante → `rdv` seulement ;
  owner → `rdv`, `consultation`, `note`.

**Leçon de test :** vérifier la PROPRIÉTÉ (« aucune ligne clinique ne parvient à
l'assistante »), jamais le MÉCANISME (404 vs 200 vide) — deux couches refusent, et
un test sur le code de statut casse quand la défense se déplace alors que la
garantie tient.

---

## PROBLÈMES D'ENVIRONNEMENT (pas le produit)

### ⚠️ Docker Desktop s'arrête tout seul — TROIS fois dans la session
Sans commande d'arrêt : conteneurs debout, puis `npipe dockerDesktopLinuxEngine`
introuvable et `/api/health` à `000`. **C'est la cause des échecs de suite E2E complète**
(échecs à `0ms` en cascade, code de sortie 4). Relance :
`Start-Process 'C:\Users\<user>\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe'`
puis attendre `docker ps`.

### ⚠️ Résidu de test qui bloque `consultation-sans-notes`
Une passe E2E tuée en vol a laissé une séance OUVERTE ; `app.start_consultation`
(026 §175-214) refuse alors — « Une séance est déjà ouverte. » Le spec reste ROUGE
tant qu'elle vit. Données synthétiques (`is_synthetic = true`).
Diagnostic : `SELECT id, started_at FROM app.consultations WHERE status='open';`

---

## PIÈGES RENCONTRÉS — à ne pas refaire

0. **Ne JAMAIS lancer un autre travail lourd pendant la suite E2E.** Une passe
   complète lancée en même temps que `lint` + `eval:jarvis` est passée de 5 min à
   **18,6 min** et a rendu **3 échecs** (`alexa-lanceur` L3/L5,
   `consultation-onglets` O1) — les trois repassent au vert en isolation, tout de
   suite après. Un seul poste, un seul Postgres : la contention se lit comme une
   régression.
1bis. **`commande | tail` masque le code de sortie** : `$?` est celui de `tail`,
   pas de Playwright. Toujours lire la LIGNE DE RÉSUMÉ (« N passed », et surtout
   l'absence d'une ligne « N failed »), ou rediriger vers un fichier et lire `$?`
   avant le tuyau.

1. **Signature vivante par NOM DE FONCTION, jamais par un mot du corps.**
   J'ai cherché `civilite` → 061. Mais **064** avait changé le `search_path` par un
   `ALTER FUNCTION` sans toucher au corps. Recopier 061 a annulé 064 en silence :
   `function digest(text, unknown) does not exist`, plus aucun certificat émis.
   `CREATE OR REPLACE` réécrit TOUS les attributs, pas seulement le corps.
2. **`getByRole("alert")` résout aussi le `__next-route-announcer__`** (vide) de Next :
   filtrer sur le texte.
3. **« Séance » est un préfixe de « Séances précédentes »** : `exact: true` obligatoire.
4. **Un test qui `skip` n'est pas un test vert** : O2 cherche un dossier à DEUX
   consultations, sinon il passait sans jamais exercer le geste.
5. **Les heredocs bash cassent** sur les gros contenus français : passer par un fichier.
