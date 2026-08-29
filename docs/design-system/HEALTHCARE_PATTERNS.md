# HEALTHCARE_PATTERNS — MindCare V2

## 1. Identité patient — bloc clinique

**Composants :** `CarteIdentite`, `EnTetePatient`, `LignePatient`

```
┌ monogram grad-avatar 40 | Nom Prénom 16 600 | P-0003 12 mono | ● actif ┐
│ Tel 0554… 14 num tabular | Naissance 14 num | Sexe M/F badge    │
│ Adresse | Contact urgence jsonb | Pièce | Notes admin           │
└─────────────────────────────────────────────────────────────────┘
```

- Monogramme `grad-avatar #DCEDE9→#B4D8D1` + ink `brand-900` 5.70:1, jamais photo.
- `record_number` `P-0003` monospace tabular, zéro oval, pas de trou (compteur `next_number`).
- Tel format `^[0-9+ ]{8,20}`, pas unique (enfants même numéro mère).
- Pas de colonnes inexistantes affichées "Non renseigné" — absentes = non rendues.

## 2. Chronologie longitudinale

`ChronologiePatient` — 8 sources `UNION ALL` (`diagnoses`, `prescriptions`, `scale_administrations`…), tri `occurred_at DESC`, keyset `(occurred_at, event_id)` 50 max base. Tag type + liseré `kind-*` 3px + libellé complet (couleur jamais seule).

## 3. Traitement en cours vs dernière prescription

`prescription_lines` n'a ni `stopped_at` ni statut → écran dit **"Dernière prescription"**, jamais "traitement en cours". Ne pas inventer statut.

## 4. Bandeau « Aujourd'hui »

`BandeauAujourdhui` — dominante `Démarrer séance` si RDV du jour sans consultation open, sinon `Nouveau rendez-vous`. Bornes `Africa/Algiers`.

## 5. Risque & sévérité (sans couleur seule)

Indicator `ZoneAttention` : icône + libellé + `attention-ink` fond `attention-bg`, jamais rouge budget (`critical` = disque). Sévérité doublée par texte.

## 6. Médication — ligne

```
Molécule INN (Gras 14) — brand, ATC, forme, force "50 mg" — dose tabular — fréquence/j — timing jsonb — durée
```

Recherche `gin_trgm unaccent lower` sur marques psychotropes (~60 INN V1). Source `manual|vidal`.

## 7. Note clinique — append-only

`clinical_notes` `draft → signed` → 15min fenêtre → `locked_at` → amendement visible. UI : zone `notes 15 1.7 400` plus grande exprès, bouton `Signer` demande confirmation (irréversible ADR-004), viole pas `trg_note_immutable`.

## 8. Document — feuille A5 148×210 14mm marges

`FeuilleDocument` preview écran = papier mm/pt (`doc-texte 10.5pt`, `doc-entete 9pt`). Newsreader seulement ici, pas OS. `rendered_html` figé. Logo `doc-marque 18mm` (proportion A5, pas 22 A4). Réserve signature `28mm` blanche bas.

## 9. Paiement — DZD entier

`amount_dzd integer ≥0`, `receipt_number` sans trou, `method cash` seul (ADR-010), `collected_at` vs `created_at`. Assistante voit 24h window (`pay_assistant` RLS), pas CA global.

## 10. Sécurité & confidentialité

- Lecture identité = `search/get_patient` porte + audit — `SELECT direct 42501` révoqué.
- 6 colonnes `sex/emergency_contact/id_doc…` existaient 004 mais jetées mapping — exposées sans migration (fix mapping).
- RLS : `patients_clinical` + `assistant_read` ; clinique (`clinical_notes` etc.) **aucune** policy assistante.
- Jarvis jamais auto-envoi message : `canal null, envoye false` type littéral.
- Après minuit `Africa/Algiers`, RDV "aujourd'hui" bascule — normal (preuve bornes).

## 11. Vide clinique (honnête, pas décoratif)

"Salles d'attente vide : Personne n'attend" — pas illustration 3D, pas chiffre inventé. Finance vide : "Aucun encaissement aujourd'hui — tarifs fin séance apparaissent ici."
