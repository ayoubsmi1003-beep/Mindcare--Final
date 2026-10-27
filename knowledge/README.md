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

Avec l'espace 768 (bac à sable) — chemin de PRODUCTION piloté par l'environnement
(le chargement réel du modèle et la porte 768 sont exercés) :

```
KNOWLEDGE_VECTOR=1 KNOWLEDGE_VECTOR_RECETTE=e5-base \
node scripts/eval-book-rag.mjs \
  --url "postgresql://…:55446/mindcare" \
  --golden tests/eval/knowledge.books-v3-2026-10-27.json
```

Résultats mesurés le 2026-10-27 :

| Configuration | R@1 | R@3 | R@5 | MRR | Abstention | p50 |
|---|---|---|---|---|---|---|
| Lexical seul (livré) | 60 % | 75 % | 75 % | 0,675 | 100 % | 118 ms |
| **Hybride 768, plancher + plafond + diversité** | **65 %** | **80 %** | **90 %** | **0,747** | **100 %** | 0,5–2 s |

> Le barème de section a été corrigé le 2026-10-27 : il ne regardait que les
> DEUX derniers segments du chemin, ce qui déclarait « hors chapitre » un
> passage situé sous `Chapter 3: Depression › Antidepressant withdrawal ›
> Background`. Les deux configurations ont été re-mesurées avec le même barème
> (segments réels, conteneur de tête écarté) — les chiffres ci-dessus sont
> comparables entre eux. Taylor : 7/10 dans les 5 premiers, dont 4 au rang 1.

Deux règles rendent le dense sûr :

1. **plancher de similarité** (`SEUIL_SIMILARITE_DENSE = 0,83`) : sans lui, deux
   questions non cliniques (prix, menu) recevaient une « preuve » et l'abstention
   tombait à 0 %.
2. **plafond lexical** : un voisin purement dense ne dépasse jamais la meilleure
   preuve trouvée par les mots. Sans lui, un chunk DSM hors sujet (cosinus 0,83,
   section « affections proposées pour des études supplémentaires ») prenait la
   1re place devant le passage clozapine trouvé lexicalement, et deux questions
   DSM perdaient leur rang 1.
3. **diversité des sources** (livre non nommé) : au plus 3 extraits par ouvrage,
   puis complément sans plafond si la liste n'est pas pleine. Sans elle, cinq
   chunks DSM remplissaient les 5 places alors que le passage Taylor était rang 1
   de sa propre reformulation.

Résultat : DSM 9/10 au rang 1 (10/10 dans les 2 premiers), Taylor 8/10 dans les
5 premiers (4 au rang 1). Les deux questions Taylor restantes (syndrome
sérotoninergique, agitation aiguë) échouent pour une raison de DONNÉES : leurs
occurrences de bonne rubrique sont des listes de références (écartées à raison)
et le contenu clinique est dans des tableaux. Cela demande un autre découpage,
pas un réglage de classement.

Le harnais reconnaît les deux noms de porte (`search_knowledge_vector_v2`,
`search_knowledge_vector_v2_768`) : le code de production garde des sites
d'appel littéraux, aucun nom calculé.

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

Pour l'espace 768 (mesuré, prêt, **non activé**) :

1. `191_knowledge_chunk_vectors_768.sql` sur la base du cabinet ;
2. backfill des 22 159 chunks actifs DSM + Maudsley (~4 h sur ce poste) ;
3. `KNOWLEDGE_VECTOR=1` et `KNOWLEDGE_VECTOR_RECETTE=e5-base` (serveur) ;
4. redémarrer : le premier appel charge le modèle (~15 s), les suivants sont
   à 200–800 ms.

Sans la migration, `KNOWLEDGE_VECTOR=1` ne dégrade pas la réponse (repli
lexical) mais paie le chargement du modèle pour rien : ne pas activer avant
l'étape 1.

Deux défauts corrigés au passage (dormants tant que la branche restait
éteinte) : le chargeur validait la recette secondaire contre le schéma BGE-M3
(`model.onnx_data`), et le nom de dossier modèle était figé sur `e5-small`.

## 8. Reranker (rejeté)

`cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` — mesuré sur le même golden :
Recall@1 50 % → 30 %, p50 118 ms → 1 144 ms. Ne pas activer
(`knowledge/recette-rerank-secondaire.json`).
