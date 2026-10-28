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
| Lexical seul (livré) | 60 % | 75 % | 75 % | 0,675 | 100 % | 61 ms |
| **Hybride 768, plancher + plafond + diversité** | **65 %** | **80 %** | **85 %** | **0,738** | **100 %** | 0,35–2 s |

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
3. **diversité des sources** (livre non nommé) : si les 5 preuves viennent d'un
   seul ouvrage, la dernière est remplacée par la meilleure de l'autre ouvrage —
   seulement si elle atteint 60 % de la meilleure pertinence. Un plafond
   symétrique avait été essayé (Recall@5 90 %) mais il forçait des extraits hors
   sujet (DSM p. 730 dans une réponse clozapine) : 85 % sans extrait hors sujet
   vaut mieux que 90 % avec.

Résultat : DSM 9/10 au rang 1 (10/10 dans les 2 premiers), Taylor 8/10 dans les
5 premiers (4 au rang 1). Les deux questions Taylor restantes (syndrome
sérotoninergique, agitation aiguë) échouent pour une raison de DONNÉES : leurs
occurrences de bonne rubrique sont des listes de références (écartées à raison)
et le contenu clinique est dans des tableaux. Cela demande un autre découpage,
pas un réglage de classement.

Contrôle de bout en bout (chemin déterministe, sans modèle de rédaction) : la
question clozapine rend cinq passages Taylor pertinents (p. 237, 237, 778, 224)
avec la ligne de sources vérifiée — plus aucune page de références (DSM p. 1042)
ni doublon de chunk.

Le harnais reconnaît les deux noms de porte (`search_knowledge_vector_v2`,
`search_knowledge_vector_v2_768`) : le code de production garde des sites
d'appel littéraux, aucun nom calculé.

## 5. Construire un espace (bac à sable seulement)

```
node scripts/telecharger-modele-book.mjs --modele e5-base      # hors dépôt, manifeste SHA-256
node scripts/remplir-vecteurs-secondaires.mjs \
  --url-env MINDCARE_DATABASE_URL --slug e5-base --dimensions 768 \
  --modele intfloat/multilingual-e5-base --version d128750597153bb5987e10b1c3493a34e5a4502a
```

Le backfill est reprenable, idempotent, et vérifie le manifeste avant le premier
vecteur. Il n'écrit QUE la table secondaire. `--url-env` évite de mettre une
chaîne de connexion sur la ligne de commande.

### Base du cabinet : sans aucun secret

Le rôle applicatif n'a aucun accès direct au corpus (RLS) et le propriétaire est
protégé par une ACL. Le script dédié passe par la socket locale du conteneur :

```
node scripts/remplir-vecteurs-768-docker.mjs --dry-run     # inventaire, 0 écriture
node scripts/remplir-vecteurs-768-docker.mjs --batch 48    # ~2,2 chunks/s
```

Il lit les textes et charge les vecteurs par `COPY … FROM STDIN` via
`docker exec … psql`. Aucun mot de passe, aucun privilège accordé au rôle
applicatif, aucune écriture hors `app.knowledge_chunk_vectors_768`.

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

Pour l'espace 768 (mesuré, installé sur le cabinet le 2026-10-27, **pas encore
activé**) :

1. `191_knowledge_chunk_vectors_768.sql` sur la base du cabinet — **fait**
   (`app.knowledge_chunk_vectors_768` + `app.search_knowledge_vector_v2_768`) ;
2. backfill des 22 159 chunks actifs DSM + Maudsley — **fait** :
   22 159 / 22 159 vecteurs, 0 mauvaise dimension, 0 chunk inactif, 0 hors
   périmètre, 3 h 12 via `scripts/remplir-vecteurs-768-docker.mjs` (sans secret,
   sans privilège accordé) ;
3. dans `%ProgramData%\MindCare\private\runtime.env` (app installée) ou le
   `.env` de développement, ajouter :
   ```
   KNOWLEDGE_VECTOR=1
   KNOWLEDGE_VECTOR_RECETTE=e5-base
   ```
   Le fichier est protégé par une ACL : un **administrateur** doit le modifier.
   Le script `scripts/activer-vecteurs-cabinet.ps1` le fait sans risque —
   sauvegarde horodatée, ajout des deux lignes seulement si elles sont absentes,
   refus si une valeur différente existe déjà, relecture de confirmation, et
   aucun contenu affiché :
   ```
   powershell -ExecutionPolicy Bypass -File scripts\activer-vecteurs-cabinet.ps1
   ```
   Ces deux noms sont les SEULS admis par l'allowlist du serveur
   (`electron/main/serveur-cabinet.ts`) ; un nom inconnu fait échouer le
   démarrage, volontairement ;
4. redémarrer : le premier appel charge le modèle (~15–35 s selon la charge),
   les suivants sont à 0,3–3 s.

Mesure sur la BASE DU CABINET, chemin de production (mêmes chiffres que le bac à
sable) : Recall@1 65 %, Recall@3 80 %, Recall@5 85 %, MRR 0,738, abstention
100 %, page vérifiée sur 100 % des preuves trouvées, p50 506 ms.

Sans la migration, `KNOWLEDGE_VECTOR=1` ne dégrade pas la réponse (repli
lexical) mais paie le chargement du modèle pour rien.

Deux défauts corrigés au passage (dormants tant que la branche restait
éteinte) : le chargeur validait la recette secondaire contre le schéma BGE-M3
(`model.onnx_data`), et le nom de dossier modèle était figé sur `e5-small`.

## 8. Tester sur localhost

Le `.env` de développement (`G:\Final mindcare\.env`) pointe sur la base du
cabinet `mc-p3` (port 55441, 1 558 patients) — **pas** sur une copie
d'évaluation. L'index 768 y vit nativement (22 159 vecteurs) : aucun transfert
n'est nécessaire pour tester.

```
$env:KNOWLEDGE_VECTOR="1"; $env:KNOWLEDGE_VECTOR_RECETTE="e5-base"
node --env-file="G:\Final mindcare\.env" node_modules\next\dist\bin\next dev -p 3000
```

Ne pas passer par `pnpm dev` si le garde-fou de schéma refuse : il compare les
migrations du dépôt au journal de la base. Les 8 migrations 188–194 ont été
appliquées au cabinet le 2026-10-28 (additives, vérifiées sans ordre destructeur)
précisément pour lever ce refus ; si d'autres fichiers de migration apparaissent
sur le disque, il faudra les appliquer de la même façon (`docker exec … psql`,
jamais de rôle applicatif).

Ne pas passer par `pnpm dev` sur cette copie : son garde-fou de schéma refuse
car d'autres migrations (188–194, hors périmètre livres) n'y sont pas
appliquées. Le serveur Next seul sert l'interface et le chemin Alexa.

Vérification : ouvrir http://localhost:3000, se connecter, poser
« Quels sont les critères de durée du trouble panique ? » (attendu : DSM-5,
p. 260) puis « Quelle surveillance hématologique pour la clozapine ? »
(attendu : Taylor, p. 237). Le premier appel charge le modèle (~15–35 s).

## 9. Reranker (rejeté)

`cross-encoder/mmarco-mMiniLMv2-L12-H384-v1` — mesuré sur le même golden :
Recall@1 50 % → 30 %, p50 118 ms → 1 144 ms. Ne pas activer
(`knowledge/recette-rerank-secondaire.json`).
