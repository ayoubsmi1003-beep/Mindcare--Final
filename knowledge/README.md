# Knowledge — index vectoriels et recette de mesure

État au 2026-10-27. Ce fichier décrit CE QUI EXISTE, pas ce qui est souhaité.
La vérité exécutable reste `supabase/migrations/` + `tests/`.

## 1. Périmètre des livres (Alexa)

Alexa ne lit que deux ouvrages, par titre exact (`src/server/alexa/knowledge-query.ts`,
`BOOKS`) :

| Ouvrage | Édition | Langue |
|---|---|---|
| DSM-5 — Manuel diagnostique et statistique des troubles mentaux | 5e éd. (2015) | fr |
| The Maudsley Prescribing Guidelines in Psychiatry | 14e éd. (2021) | en |

`Stahl's Essential Psychopharmacology` est **exclu du chemin Alexa** : la porte
d'autorisation SQL le laisse actif, mais `matchesRequestedBook` n'admet que les
deux titres ci-dessus, et une question qui nomme Stahl est refusée
(`planKnowledgeQuery` → `null`). Son index et ses approbations restent intacts
hors périmètre.

## 2. Trois espaces vectoriels, jamais mélangés

| Espace | Table | Dimensions | Modèle | Statut |
|---|---|---|---|---|
| Production | `app.knowledge_chunks.embedding` | 1024 | BGE-M3 | **actif**, intact |
| Secondaire 384 | `app.knowledge_chunk_vectors` (migration 188) | 384 | multilingual-e5-small | mesuré, **rejeté**, table vide en production |
| Évaluation 768 | `app.knowledge_chunk_vectors_768` (migration 191) | 768 | multilingual-e5-base | **en évaluation** |

Chaque table porte `modele` + `version` (révision Hugging Face) et un `CHECK` de
dimension. Une porte `SECURITY DEFINER` (jamais un accès direct) applique
`C4 + active + approved + revue à jour + non remplacée` **après** le KNN, pour
que l'index HNSW reste utilisable.

## 3. Modèles autorisés (< 300 M paramètres)

| Modèle | Paramètres | Dim. | Licence | Recette |
|---|---|---|---|---|
| `intfloat/multilingual-e5-small` | 118 M | 384 | MIT | `knowledge/recette-embedding-secondaire.json` |
| `intfloat/multilingual-e5-base` | 278 M | 768 | MIT | `knowledge/recette-embedding-secondaire-768.json` |

Le reranker `cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` (117 M) est **rejeté**
sur mesure réelle : Recall@1 50 % → 30 %, p50 118 ms → 1 144 ms
(`knowledge/recette-rerank-secondaire.json`). Ne pas l'activer.

## 4. Mesure (golden réel, 22 questions, 20 réponses attendues)

```
node scripts/eval-book-rag.mjs --golden tests/eval/knowledge.books-v3-2026-10-27.json
```

Avec l'espace 768 (sandbox uniquement) :

```
node scripts/eval-book-rag.mjs --golden tests/eval/knowledge.books-v3-2026-10-27.json \
  --vector --slug e5-base --modele intfloat/multilingual-e5-base \
  --version d128750597153bb5987e10b1c3493a34e5a4502a --dimensions 768
```

Le harnais route `search_knowledge_vector_v2` vers la porte 768 quand
`--dimensions 768` est passé. Le code de production, lui, garde son site d'appel
littéral : aucun nom de porte calculé.

## 5. Construire un espace (bac à sable seulement)

```
node scripts/telecharger-modele-book.mjs --modele e5-base      # hors dépôt, manifeste SHA-256
node scripts/remplir-vecteurs-secondaires.mjs \
  --url "postgresql://…" --slug e5-base --dimensions 768 \
  --modele intfloat/multilingual-e5-base --version d128750597153bb5987e10b1c3493a34e5a4502a
```

Le backfill est reprenable, idempotent, et vérifie le manifeste avant le premier
vecteur. Il n'écrit QUE la table secondaire.

## 6. Pages et éditions

- Le folio imprimé est lu dans le marqueur `[livre p.N|src:M]` écrit à
  l'ingestion ; jamais calculé par offset.
- Si un découpage a perdu le marqueur, la page de l'**unité canonique**
  (`unit_id`) est utilisée via `src/server/knowledge/pages-unites.json`
  (généré par `scripts/generer-pages-unites.mjs`). Jamais un voisin.
- Un marqueur d'un autre livre, un folio `?` ou deux pages divergentes
  produisent **aucune page** plutôt qu'un nombre approximatif.
- La ligne de sources est assemblée par le serveur à partir de ces métadonnées ;
  le modèle ne rédige jamais une page ni une édition.

## 7. Activation

`KNOWLEDGE_VECTOR` et `KNOWLEDGE_RERANK` sont absents par défaut : le chemin
livré est lexical. Toute promotion d'un espace vectoriel exige (a) la migration
appliquée sur la base du cabinet, (b) la recette épinglée dans le runtime,
(c) une mesure qui dépasse la baseline lexicale sur le golden ci-dessus.
