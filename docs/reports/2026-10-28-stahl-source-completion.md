# Rapport d'achèvement — Prescriber's Guide 7e (Stahl)

**Date.** 2026-10-28. **Branche.** `v8-alexa-final` (worktree `C:\MindCare\alexa-v8-final`).
**Périmètre.** Intégration Alexa du troisième livre approuvé (ADR-041), reprise de l'index
vectoriel 768, évaluation réelle et réconciliation documentaire. Aucune réactivation, aucune
suppression, aucun autre livre modifié.

**Statut final : `PASS_WITH_REVIEW`.** Les portes techniques passent ; six points de revue
restent ouverts et sont détaillés en §G.

---

## A. Identité de la source

| Attribut | Valeur vérifiée |
|---|---|
| `book_id` canonique | `stahl-prescribers-guide-7e-cup` |
| UUID en base | `d71587f1-3bf3-5d82-81cf-e40d77dbcfa0` |
| Titre stocké | `Prescriber's Guide (Stahl's Essential Psychopharmacology)` |
| Édition | 7ᵉ édition, Cambridge University Press, 2021 |
| Auteurs | Stephen M. Stahl ; assistanat éditorial Meghan M. Grady ; illustrations Nancy Muntner |
| ISBN | 978-1-108-92601-0 (broché) ; 978-1-108-92602-7 (spirale) |
| Fichier | `Books/prescribers-guide-stahls-essential-psychopharmacology.pdf` |
| SHA-256 | `cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3` (recalculé, identique) |
| Taille | 16 943 707 octets |
| Pages physiques | 2 697 |
| Pagination imprimée | **aucun folio imprimé** ; carte identité `imprimé = PDF`, offset 0 sur 3 076/3 076 chunks |
| État en base | `active`, `C4`, approuvée par `…a1` le 2026-10-20 19:51:07 UTC, 3 076 chunks actifs |

La source est **active et approuvée** dans PostgreSQL (trace d'audit `activation-permanente`).
Le paquet canonique JSON reste, par conception, l'artefact d'ingestion immuable
(`book.json.statut = discovered`, `chunks-v2.manifest.json.statut = inactive`) : l'activation
est portée par la projection PostgreSQL, pas par le JSON.

## B. Intégrité de l'extraction

| Contrôle | Résultat |
|---|---:|
| Pages examinées | 2 697 |
| Pages extraites (couche texte) | 2 697 / 2 697 |
| Pages blanches | 2 (p. 1–2) |
| Pages à texte court | 1 (p. 2691) |
| Pages OCR | **0** (PDF texte natif) |
| U+FFFD dans les unités | 0 |
| Pages couvertes par ≥ 1 chunk | **2 434** |
| Pages non couvertes | **263** |
| Tables reconstruites | 15 (`tables.jsonl`) |
| Figures / icônes | 39 figures, 2 059 icônes |
| Réparations tracées (sauts de ligne intra-mot) | 2 274, texte brut conservé + `repairs.jsonl` |
| Sections structurelles | 154 (2 racines + 152 monographies) |
| Unités canoniques | 2 662 |
| Renvois | 1 073 (1 049 résolus, 24 non résolus documentés) |

### Les 263 pages sans chunk — exceptions explicites

| Groupe | Pages | Nature | Statut |
|---|---:|---|---|
| Liminaires | 1–12 | couverture, titre, copyright, table des matières | exclusion légitime |
| « Suggested Reading » / bibliographies | 170 pages réparties sur 46–2548 | références bibliographiques de fin de monographie | exclusion légitime |
| Index par nom de médicament + fin de bibliographies | 2566–2627 | index consommé uniquement pour les alias | exclusion légitime |
| Back matter | 2683–2697 | colophon, historique de la collection | exclusion légitime |
| **Encadrés « The Art of Switching »** | **941, 1352, 1704, 1705** | **contenu clinique** | **omission réelle** |

- **941** : « Switching from Oral Antipsychotics to Fluphenazine Decanoate » (752 car.) —
  absent des unités et des chunks ; aucun doublon ailleurs.
- **1704–1705** : « Switching … to Paliperidone Palmitate (1-Month) » et « … to Paliperidone ER »
  (558 + 1 288 car.) — absents ; aucun doublon ailleurs.
- **1352** : « The Art of Switching » (1 144 car.) — absent, mais le même texte de base
  (« Not approved for mania, but almost all atypical antipsychotics… ») est présent
  p. 330 (Brexpiprazole).
- Cause : le découpage en unités s'arrête à la dernière rubrique reconnue avant le bloc de
  références ; un encadré isolé en fin de monographie n'est pas atomisé.
- **Non réparé dans cette passe** : ajouter ces pages crée de nouveaux chunks, donc une nouvelle
  révision de l'artefact et une nouvelle revue clinique. C'est une décision humaine, au même
  titre que R1.

## C. Intégrité des chunks

| Contrôle | Résultat |
|---|---:|
| Chunks | **3 076** |
| Unités sources | 2 662 |
| Unités découpées en plusieurs chunks | 311 |
| Rejointures verbatim | 311 / 311 |
| IDs uniques | 3 076 / 3 076 |
| Hash de texte dupliqués | 0 |
| Chunks vides | 0 |
| Chunks sans marqueur de page | 0 |
| Taille min / max | 86 / 1 337 caractères |
| Chunks multi-pages | **875** |
| Marqueurs de page par chunk multi-pages | **1** (la première page) |
| Pages non adressables par leur numéro | **3 639** |
| File de revue | 1 100 éléments (`review-queue.json`) |

Le découpage est déterministe (`stahl-units-v1`, seuil 1 200 caractères, IDs stables) ; le
manifeste prouve l'unicité et les rejointures. La répétition de texte est celle du livre
(boilerplate partagé entre monographies), pas une duplication d'ingestion.

**R2 mesuré.** Un chunk multi-pages ne porte que le marqueur de sa première page : son contenu
reste atteignable par son sujet, pas par le numéro des pages suivantes. La correction exige
d'ajouter les marqueurs de fin, donc de changer le texte, de re-embedder et de créer une
nouvelle révision.

## D. Intégrité des embeddings

### Espace de production 1024d

| Attribut | Valeur |
|---|---|
| Modèle | `BAAI/bge-m3`, révision `5617a9f61b028005a4858fdac845db406aefb181` |
| Dimensions | 1024, cosinus, normalisation L2 native |
| Chunks Stahl vectorisés | **3 076 / 3 076** |
| Modèle au moment de la requête | **absent** des deux chemins de résolution (`MINDCARE_BGE_M3_DIR`, `resources/models/bge-m3/<revision>`) |
| Conséquence | `vecteurRequeteProduction` → `null`, recherche **lexicale seule**, dégradation nommée |

### Espace secondaire 768d (candidat, non activé)

| Attribut | Valeur |
|---|---|
| Modèle | `intfloat/multilingual-e5-base`, révision `d128750597153bb5987e10b1c3493a34e5a4502a` |
| Dimensions | 768, cosinus, préfixes `query: ` / `passage: `, troncature 128 |
| Artefacts | SHA-256 vérifiés (`84a4d426…`, `62c24cdc…`) |
| Stahl avant le 2026-10-28 | **0** vecteur |
| Stahl après backfill | **3 076** vecteurs |
| Total de l'index | **25 235** (DSM-5 12 815 + Maudsley 9 344 + Stahl 3 076) |
| Contrôles | 0 mauvaise dimension, 0 chunk inactif, 0 hors périmètre |
| Idempotence | seconde exécution : `restants: 0`, aucune duplication |
| Durée | 4 475 s (3 076 vecteurs, CPU 2 threads) |

Aucun vecteur de remplacement, aucun mock : le modèle réel a produit les 3 076 vecteurs.

## E. Reranker et intégration Alexa

### Reranker réel

- **Production par défaut** : `HeuristiqueBaseline` (`local-v1`) — couverture lexicale 55 %,
  similarité 45 %, bonus de titre. C'est le reranker effectivement invoqué par le chemin
  `readKnowledge` quand aucun cross-encoder n'est configuré.
- **Cross-encoder** : `mmarco-mMiniLMv2` (`revision-epinglee`), opt-in
  (`KNOWLEDGE_RERANK=mmarco`). Chargement réel vérifié : 19,3 s à froid, scores discriminants
  (0,634 vs 0,414 sur une paire mécanisme/posologie ; 0,854 vs 0,414 sur la paire inverse).
- **Effet mesuré** : sur le golden v4, l'activation du cross-encoder **dégrade** le rappel@5
  (0,613 contre 0,742 sans lui) et coûte 2,2 s de p50 (10,8 s de p95). Il reste désactivé ;
  aucun reranker externe.

### Chemin de retrieval

`planKnowledgeQuery` (plan + expansion bilingue + `sourceLabel`) → `readKnowledge` →
`app.search_knowledge_lexical` (+ `app.search_knowledge_vector_v2_768` si activé) → fusion par
rang → rerank → `preuveAffichable` (page + édition) → orchestrateur Alexa.

- `BOOKS` porte **trois** titres approuvés ; le garde `stahl → null` est retiré.
- `matchesRequestedBook` refuse toujours toute source hors liste.
- `requetePourLivreRequis` réinjecte le libellé du livre requis (`DSM-5`, `Taylor`, `Stahl`) ;
  plus aucun préfixe `Taylor` codé en dur dans `agent-tools.ts`.
- `EDITIONS` porte Stahl : sans cette identité, `preuveAffichable` supprimait la page alors que
  le marqueur est présent dans 3 076/3 076 chunks.

### Citations

- Page et édition Stahl résolues : `p. 2073` (Sertraline, Dosing Tips), `p. 2375` (Valproate).
- `pageQuandTrouve = 1,0000` en lexical comme en 768 : **toute preuve trouvée porte une page**.
- La ligne de sources est assemblée par le serveur, jamais par le modèle
  (`Source : Prescriber's Guide (Stahl's Essential Psychopharmacology) (7e éd., 2021), p. 2073.`).

## F. Résultats d'évaluation

Golden `tests/eval/knowledge.books-v4-2026-10-28.json` : 34 cas (21 v3 + 11 Stahl + 2 abstentions
supplémentaires), attendus vérifiés dans le corpus avant écriture.

| Mode | Rappel@5 | Rappel@1 | MRR | Page | Abstention | p50 | p95 |
|---|---:|---:|---:|---:|---:|---:|---:|
| Lexical (production actuelle) | 0,710 | 0,452 | 0,565 | 0,710 | 1,000 | 80 ms | 1 001 ms |
| 768 hybride + heuristique | **0,742** | **0,581** | **0,651** | **0,742** | 1,000 | 1 382 ms | 8 254 ms |
| 768 hybride + mmarco | 0,613 | 0,387 | 0,489 | 0,613 | 1,000 | 2 159 ms | 10 815 ms |

### Par classe

| Classe | n | Lexical r5 / r1 | 768 r5 / r1 | 768+mmarco r5 / r1 |
|---|---:|---:|---:|---:|
| DSM-5 | 10 | 1,000 / 1,000 | 1,000 / 0,900 | 0,700 / 0,500 |
| Maudsley | 10 | 0,500 / 0,200 | 0,500 / 0,300 | 0,500 / 0,200 |
| Stahl | 11 | 0,636 / 0,182 | **0,727 / 0,545** | 0,636 / 0,455 |
| Abstentions | 3 | 1,000 | 1,000 | 1,000 |

### Non-régression sur les 22 cas v3 (2 livres → 3 livres)

- **Lexical** : 21/22 rangs identiques ; `TAY-QT` passe du rang 2 au rang 3 (toujours dans le
  top 5). Rappel@5 identique : **15/20 = 0,75**.
- **768** : 20/22 rangs identiques ; deux cas Taylor sont déplacés par la concurrence du
  troisième livre — `TAY-OLANZAPINE-METAB` (rang 4 → absent) et `TAY-RISPERIDONE-DOSE`
  (rang 1 → absent). Rappel@5 **15/20** contre **17/20** pour la mesure 2 livres
  (`hybride-cabinet-final.json`). Ces deux cas manquaient **déjà** en lexical ; la régression
  ne touche donc que l'espace 768, qui n'est pas activé.

### Sélection par nom

La source est sélectionnable par son nom : `planKnowledgeQuery` renvoie `sourceTitle` et
`sourceLabel` (« Stahl »), et `requetePourLivreRequis` réinjecte ce libellé sans préfixe codé en
dur. Un essai hors golden (questions préfixées « Selon Stahl ») retrouve le bon livre, mais la
sélection de la rubrique interne reste perfectible (R1 + concurrence inter-livres) ; il n'est
donc pas présenté comme une mesure de qualité.

## G. Disposition finale

**`PASS_WITH_REVIEW`.**

### Ce qui est prouvé

- Source identifiée, hash recalculé, 2 697 pages extraites, 0 OCR, 0 U+FFFD.
- 3 076 chunks, IDs uniques, 0 doublon, 3 076 marqueurs de page, offset 0 vérifié.
- 3 076 vecteurs 1024d et 3 076 vecteurs 768d réels ; index 768 complet et idempotent.
- Stahl adressable par Alexa (planner, `EDITIONS`, `agent-tools`), page et édition citées.
- Aucune régression lexicale sur DSM-5/Maudsley ; aucune autre source modifiée.
- Reranker réel vérifié ; cross-encoder mesuré et volontairement laissé inactif.

### Revue ouverte (aucune n'est un échec d'activation)

1. **R1 — ordre de lecture** : 1 859/2 697 pages (68,9 %) diffèrent de l'ordre humain
   (mesure du 2026-10-20, non rejouée dans cette passe) ; le libellé d'une rubrique peut
   désigner la voisine. Contenu verbatim complet, folio exact.
   Remédiation = reconstruction du paquet canonique + nouvelle revue clinique.
2. **Omission clinique** : 4 pages « The Art of Switching » (941, 1352, 1704, 1705) sans unité
   ni chunk. Même remédiation que R1.
3. **R2 — pages multi-pages** : 875 chunks ne portent qu'un marqueur ; 3 639 pages non
   adressables par leur numéro.
4. **Espace 768 non activé** : qualité mesurée (rappel@5 0,742 contre 0,710 en lexical), mais
   deux déplacements Taylor et aucune activation dans `%ProgramData%\MindCare\private\runtime.env`
   (acte humain, non exécuté par cette passe).
5. **Modèle BGE-M3 absent** : la production reste lexicale tant que l'artefact 1024d n'est pas
   restauré ou que l'index 768 n'est pas activé.
6. **Revue clinique** : 1 100 éléments `needs_review` (doses, précautions, grossesse,
   interactions) restent ouverts ; 24 renvois intra-livre non résolus.

### Fichiers modifiés

`src/server/alexa/knowledge-query.ts`, `src/server/alexa/agent-tools.ts`,
`src/server/knowledge/editions.ts`, `src/i18n/alexa-knowledge.ts`,
`tests/unit/alexa-final-two-books.test.ts`, `tests/unit/alexa-pages-citations.test.ts`,
`tests/unit/alexa-knowledge-source-qualification.test.ts` (ex-`alexa-unfinished-source.test.ts`),
`scripts/remplir-vecteurs-768-docker.mjs`, `scripts/eval-book-rag.mjs`,
`tests/eval/knowledge.books-v4-2026-10-28.json`, `ARCHITECTURE.md`,
`docs/00-DECISIONS.md`, `docs/RUNTIME-CONFIGURATION.md`.

### Données

Une seule écriture : 3 076 lignes ajoutées à `app.knowledge_chunk_vectors_768` (clé primaire
`(chunk_id, modele, version)`, aucun update, aucun delete). Aucune migration, aucun changement
de `knowledge_chunks` ou `knowledge_sources`.

### Portes exécutées

| Porte | Résultat |
|---|---|
| `pnpm typecheck` | PASS — 0 erreur |
| `npx eslint` (fichiers touchés) | PASS — 0 erreur |
| `pnpm vitest run` (ciblé connaissance/Alexa) | PASS — 354/354 |
| `pnpm test` (suite complète) | **5 351 tests PASS**, 109 sautés, 0 échec d'assertion — 407 fichiers |
| Backfill 768 + contrôle | PASS — 25 235 présents, 0 mauvaise dimension, 0 inactif, 0 hors périmètre |
| Golden v4, trois modes | PASS — voir §F |

La commande `pnpm test` sort en code 1 uniquement à cause d'un
`[vitest-worker]: Timeout calling "onTaskUpdate"` (RPC interne à Vitest, sur un poste à 2 cœurs
pendant une passe de ~10 min) : **aucun test n'échoue**. Les deux fichiers précédemment rouges
— `alexa-v8-adversarial-manifest.test.ts` et `verifier-base.test.ts` — passent désormais
(`22/22`) après l'application des migrations 195–200 par la session concurrente ; aucun de ces
deux fichiers ne touche la connaissance, l'index 768 ou Stahl.

### Reproductibilité

Les mesures sont reproductibles avec le golden versionné :

```bash
node scripts/eval-book-rag.mjs --golden tests/eval/knowledge.books-v4-2026-10-28.json --json
node scripts/eval-book-rag.mjs --golden tests/eval/knowledge.books-v4-2026-10-28.json --json \
  --vector --slug e5-base --modele intfloat/multilingual-e5-base \
  --version d128750597153bb5987e10b1c3493a34e5a4502a --dimensions 768 --truncature 128
KNOWLEDGE_RERANK=mmarco node scripts/eval-book-rag.mjs --golden tests/eval/knowledge.books-v4-2026-10-28.json --json \
  --vector --slug e5-base --modele intfloat/multilingual-e5-base \
  --version d128750597153bb5987e10b1c3493a34e5a4502a --dimensions 768 --truncature 128
```

Le premier passage à froid après un redémarrage du conteneur peut produire des `panne` de porte
(charge HNSW) : la mesure retenue est celle du passage à chaud, sans aucune `panne`.
