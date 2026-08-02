# JARVIS-DEMO-SPEC.md
**Le Jarvis minimum qui fait dire « wow » — et rien de plus.**
v1 — 2026-08-02 · portée : session S6 uniquement

> Jarvis en entier, c'est trois semaines. Tu as **une session**.
> Ce document dit exactement où s'arrêter pour que ce soit impressionnant **et** honnête.

---

## 1. CE QUI IMPRESSIONNE RÉELLEMENT

Ce n'est pas le nombre d'outils. C'est **trois moments** :

1. **Elle écrit en français naturel et ça comprend.**
   « les rendez-vous de demain » · « ouvre le dossier de Belkacem » · « décale Karim à jeudi 15h »
2. **Ça propose, ça n'agit pas.** Une carte apparaît, elle clique, l'action se fait, c'est journalisé.
   C'est **ça** qui rassure une praticienne — pas la magie, le contrôle.
3. **Ça écrit son brouillon de note à partir de la consultation.**
   Le seul moment où l'IA lui fait gagner de vraies minutes.

Tout le reste est décoratif ce mois-ci.

---

## 2. LES 8 OUTILS — allowlist figée pour S6

| Outil | write | Retour | Confirmation |
|---|---|---|---|
| `analyze_session` | non | **note structurée + évolution + points non explorés** | — |
| `search_patients` | non | ≤ 5 résultats + désambiguïsation | — |
| `get_patient` | non | identité + 3 derniers actes | — |
| `get_agenda` | non | créneaux du jour/demain | — |
| `create_appointment` | **oui** | proposition | **carte** |
| `start_consultation` | **oui** | proposition | **carte** |
| `draft_clinical_note` | **oui** | brouillon SOAP en éditeur | **carte** |
| `set_consultation_price` | **oui** | proposition | **carte** |
| `generate_document` | **oui** | aperçu A4 | **carte** |

**Aucun dixième outil.** Si le besoin apparaît, il va en semaine 2.

---

---

## 2 bis. `analyze_session` — L'OUTIL QUI FAIT GAGNER DE VRAIES MINUTES

C'est **la priorité de S6**. Sans micro, et c'est un avantage : ça marche dès le premier jour.

### Entrée
Le champ « notes brutes » que la praticienne remplit au fil de la séance, en vrac, comme sur un carnet :
```
dort 3h · arrêt sertraline il y a 10j de lui-même · conflit avec la mère
pas d'idées noires · appétit ok · reprise du sport
```
Plus l'historique du patient, **relu depuis la base** — jamais depuis la mémoire de l'agent.

### Sortie — trois blocs, dans cet ordre
```
1. NOTE STRUCTURÉE          brouillon éditable. Elle corrige, elle ne réécrit pas.
2. ÉVOLUTION DEPUIS LA DERNIÈRE FOIS
   « Sommeil : 5 h le 12/07 → 3 h aujourd'hui. »
   « Sertraline : présente au 12/07, absente aujourd'hui — arrêt non documenté. »
3. POINTS NON EXPLORÉS      formulés en QUESTIONS, jamais en conclusions.
   « Le motif de l'arrêt du traitement n'apparaît pas dans les notes. »
```

### Les quatre garde-fous
1. **Jarvis ne se souvient d'aucun fait clinique.** Il **relit la base** à chaque appel.
   Un agent qui mémorise « Karim prend de la sertraline » affirmera un jour une posologie périmée.
2. **Le bloc 3 ne contient que des questions.** Une affirmation clinique non vérifiée dans un dossier
   psychiatrique est un risque, pas une aide.
3. **La note produite est un BROUILLON.** `status='brouillon'`. Seule une humaine signe.
4. **Rien d'identifiant ne sort.** Pseudonymisé avant la passerelle, re-hydraté au retour.

### Semaine 2 — pourquoi il n'y aura rien à réécrire
La transcription arrivera comme **une source d'entrée de plus** au même outil :
```
entrée = notes brutes  →  entrée = notes brutes + transcription
```
Même signature, même sortie, même écran. C'est exactement pour ça qu'on le construit dans cet ordre.

---

## 3. LA CARTE DE CONFIRMATION — le composant le plus important du produit

```
┌──────────────────────────────────────────┐
│  Créer un rendez-vous                    │
│                                          │
│  Patient   Karim Belkacem                │
│  Date      jeudi 7 août, 15:00           │
│  Durée     45 min                        │
│                                          │
│         [ Annuler ]   [ Confirmer ]      │
└──────────────────────────────────────────┘
```

**Règles :**
- Le bouton `Confirmer` reste inactif **400 ms**. Une action médicale ne se clique pas par réflexe.
- Chaque champ modifié est visible. Rien d'implicite.
- Au clic : `confirmed_at` est écrit **avant** l'exécution. Jamais l'inverse.
- Après exécution : ligne dans `jarvis_actions` avec l'acteur humain, pas l'agent.

`state='executed'` sans `confirmed_at` est une **violation de contrainte par conception**.
Ce n'est pas une vérification applicative. C'est la base qui refuse.

---

## 4. LA DÉSAMBIGUÏSATION — le détail qui fait pro

Si `search_patients("belkacem")` rend 3 résultats, Jarvis ne choisit **jamais**.

```
Trois patients correspondent :
  · Karim Belkacem — 34 ans — vu le 12 juillet
  · Amina Bel Kacem — 28 ans — vue le 3 mai
  · Yacine Belkacem — 41 ans — jamais vu
Lequel ?
```

Un Jarvis qui devine et se trompe sur un dossier psychiatrique détruit la confiance en une fois.
Un Jarvis qui demande la construit.

---

## 5. LA DÉGRADATION — le test T6, celui qui compte

Coupe la clé OpenRouter. Puis vérifie que la doctoresse peut, **sans Jarvis** :
```
✅ ouvrir un dossier      ✅ prendre un rendez-vous
✅ lancer une consultation ✅ écrire et signer une note
✅ imprimer un certificat  ✅ encaisser
```
Message affiché, honnête : *« Jarvis est indisponible. Toutes les fonctions restent accessibles. »*

**Jarvis est un accélérateur, jamais une dépendance.** Si un seul de ces six échoue, S6 est rouge.

---

## 6. CE QUI SORT DU SYSTÈME — la pseudonymisation

Ce qui part vers OpenRouter :
```
Patient P-4A2 · 34 ans · M · dernier acte 12/07
Transcription : [texte de la séance]
```
Ce qui ne part **jamais** : nom, date de naissance exacte, téléphone, adresse, `patient_id` réel.
Une table de correspondance en mémoire serveur re-hydrate au retour.

Un seul point de sortie : `_shared/external-call.ts`.
Un `fetch('https://…')` ailleurs n'est pas une entorse de style — c'est l'architecture qui tombe.

---

## 7. LE LANGAGE — Jarvis décrit, il ne conclut jamais

| ❌ | ✅ |
|---|---|
| « Le patient est dépressif. » | « Éléments évoquant une symptomatologie dépressive — à évaluer. » |
| « Prescrire de la sertraline. » | « Aucun ISRS dans l'historique. » |
| « Risque suicidaire élevé. » | « Mention d'idées noires à 12:34 — exploration suggérée. » |

Mention permanente : *« Aide à la décision — le jugement clinique appartient au praticien. »*

---

## 8. INTERDITS — ne pas écrire, même en commentaire

```
execute_sql · delete_clinical_note · sign_clinical_note · send_message_to_patient
export_patient_data · modify_permissions · read_file · write_file · run_command
```

**Seule une humaine signe.** Sa signature porte sa responsabilité médicale devant un juge.

---

## 9. SEMAINE 2 — l'ordre d'ajout, déjà décidé

```
1. Transcription live (l'outil existe déjà, il ne manque que le micro)
2. Analyse en direct pendant la séance
3. Brief du matin
4. Recherche dans l'historique du patient
5. Voix (wake word local + STT + TTS)
```
Chaque ajout = un outil de plus dans l'allowlist. **Zéro changement d'architecture.**
C'est le but de tout ce qui précède.
