# Contrat des échelles cliniques

**Version :** 1 — 2026-10-25
**Portée :** `app.scales`, `app.scale_administrations`, portes 184, écran
Consultation.

> ⚠️ Ce document décrit un **outil d'aide à l'évaluation**, pas un diagnostic.
> Un score orienté ne remplace ni l'entretien, ni l'examen clinique, ni le
> jugement de la praticienne. Aucun diagnostic n'est posé automatiquement.

## 1. Instruments activés

Seuls deux instruments sont activés dans cette version :

| Code | Nom | Items | Total | Bandes |
|---|---|---:|---:|---|
| `PHQ9` | PHQ-9 — dépression | 9 | 0–27 | 0–4 minimal · 5–9 léger · 10–14 modéré · 15–19 modérément sévère · 20–27 sévère |
| `GAD7` | GAD-7 — anxiété | 7 | 0–21 | 0–4 minimal · 5–9 léger · 10–14 modéré · 15–21 sévère |

`HDRS` et `YMRS` restent **inactifs** : instruments cotés par le clinicien, avec
des items et des pondérations (0–2 / 0–4) qui exigent une revue dédiée. Le
moteur les acceptera quand leur contenu sera validé.

## 2. Sources

- PHQ-9 : Kroenke K, Spitzer RL, Williams JBW. *The PHQ-9: validity of a brief
  depression severity measure.* J Gen Intern Med. 2001;16(9):606-613.
  Version française utilisée : *Questionnaire sur la santé du patient – 9
  (PHQ-9)*, Prevention Depression Luxembourg
  (`PHQ9_French_for_France.pdf`), avec la mention « aucune permission requise
  pour reproduire, traduire, afficher ou distribuer ».
- GAD-7 : Spitzer RL, Kroenke K, Williams JBW, Löwe B. *A brief measure for
  assessing generalized anxiety disorder: the GAD-7.* Arch Intern Med.
  2006;166(10):1092-1097.
  Version française utilisée : *GAD-7*, Université de Montréal
  (`GAD-7-français.pdf`), avec la même mention de reproduction libre.

Les textes exacts sont dans `supabase/migrations/185_seed_phq9_gad7.sql` et
`scoring.source` les cite à l'écran.

## 3. Contrat JSON

### `app.scales.items`

Tableau non vide d'objets :

```json
{
  "id": "q1",
  "texte": "…",
  "options": [
    { "valeur": 0, "libelle": "Jamais" },
    { "valeur": 1, "libelle": "Plusieurs jours" }
  ],
  "risque": true,
  "alerte": "…"
}
```

- `id` : unique dans l'instrument.
- `options[].valeur` : entier, unique dans l'item. Le total est la somme des
  valeurs choisies.
- `risque` / `alerte` : facultatifs. Un item marqué `risque` qui reçoit une
  valeur > 0 produit une **alerte factuelle** dans l'aperçu et dans le résultat
  enregistré. Aucun diagnostic n'est ajouté.

### `app.scales.scoring`

```json
{
  "methode": "somme",
  "consigne": "Au cours des 2 dernières semaines…",
  "min": 0,
  "max": 27,
  "bandes": [{ "min": 0, "max": 4, "interpretation": "minimal" }],
  "source": "…",
  "note": "Le score est une aide à l'évaluation clinique…"
}
```

Le barème doit couvrir tout l'intervalle `[min, max]` sans trou. Le calcul est
en base (`app.score_scale`), jamais en JavaScript.

### `app.scale_administrations.responses`

Objet `{ "<item_id>": <valeur> }`, avec **exactement** les items de
l'instrument, tous répondus. Une valeur hors des options, un item manquant ou
une clé inconnue est refusé (`22023`).

## 4. Portes SQL (migration 184)

| Porte | Rôle | Écriture |
|---|---|---|
| `app.list_scales()` | référentiel actif, items + scoring | non |
| `app.preview_scale_score(code, responses)` | calcul + alertes | non |
| `app.record_scale_administration(patient, consultation, code, responses)` | validation, calcul, insertion, audit | **oui** |
| `app.get_scale_history(patient, code?)` | historique limité à 100, lecture journalisée | non |

Garanties :

- `SECURITY DEFINER`, propriétaire `app_gatekeeper`, `REVOKE PUBLIC`,
  `GRANT authenticated` ;
- `record` vérifie le périmètre par `app.get_patient` (lecture journalisée),
  exige une consultation **ouverte** de ce patient, `FOR UPDATE`, puis insère ;
- `cabinet_id`, `practitioner_id`, `is_synthetic` sont dérivés (jamais fournis
  par l'appelant) ;
- trigger `trg_audit` sur `scale_administrations` ;
- une séance close rend `NULL`, jamais une écriture partielle ;
- l'historique d'un dossier hors périmètre rend `[]` (pas d'oracle).

## 5. États d'écran

- **Référentiel indisponible** : erreur + réessayer, aucun bouton de saisie.
- **Aucune échelle active** : message d'activation, historique consultable.
- **Disponible** : boutons `Compléter PHQ-9` / `GAD-7`, résultats datés,
  `Séance en cours` vs `Dernier résultat au dossier`.
- **Saisie** : tous les items, aucune réponse pré-cochée, progression n/N.
- **Validation** : un item manquant est signalé et le premier item manquant
  reçoit le focus. Le bouton « Vérifier » n'enregistre rien.
- **Revue** : réponses, score calculé par la base, interprétation, note, alertes.
- **Enregistrement** : erreur visible, réponses conservées, réessai possible.
- **Après enregistrement** : confirmation, résultat marqué « Séance en cours »,
  historique mis à jour, courbe du rail rafraîchie.
- **Séance close** : lecture seule, aucun bouton de saisie.

## 6. Limites assumées

- HDRS/YMRS ne sont pas activés.
- Le score est une somme non pondérée ; le contrat `methode: "somme"` le dit.
- L'item 9 du PHQ-9 est une alerte factuelle à explorer, pas un diagnostic ni
  une décision automatique.
- Aucune échelle n'est envoyée à un modèle : le calcul et la persistance sont
  locaux.
