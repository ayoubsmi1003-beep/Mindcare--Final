# 04 — DESIGN SYSTEM
**MindCare OS — Direction artistique, tokens, mouvement, composants**
Version 1.0 — 2026-07-28
Prérequis : `00-DECISIONS.md` → `03-JARVIS-TOOLS.md`

> À lire **avant** d'ouvrir Claude Design. Chaque écran découle de ce fichier.
> Aucune couleur, aucune taille, aucune durée d'animation n'est inventée dans un écran.

---

## 1. LE BRIEF, HONNÊTEMENT

**Sujet.** Le cabinet d'une psychiatre à Alger. Une praticienne, une assistante, une seconde
praticienne à venir. Interface française, contenu arabe.

**Utilisation réelle.** 6 à 8 heures par jour. Souvent **avec un patient assis en face**.
Beaucoup de lecture, peu de contemplation.

**La tâche unique de l'interface :** rendre à la praticienne le temps qu'elle passe à écrire,
sans jamais lui voler le regard qu'elle doit à son patient.

**Ce que ce n'est pas.** Une page marketing. Un tableau de bord de démonstration. Rien ici
n'existe pour impressionner sur une capture d'écran.

### 1.1 La référence fournie — ce qu'on garde, ce qu'on écarte
| Élément de la référence | Décision |
|---|---|
| Densité, cartes lisibles, hiérarchie claire | ✅ gardé |
| Colonne latérale calme, icônes discrètes | ✅ gardé |
| Ambition de finition, soin des détails | ✅ gardé |
| Dégradés violets, gauge décorative | ❌ écarté — décoratif, sans rapport avec son métier |
| Verre dépoli sur les données | ❌ écarté — voir §4.3, c'est une question de sécurité |
| Palette générique SaaS | ❌ remplacée par **sa** palette, celle de son logo |

> La référence montre le **niveau d'exigence**. Elle ne donne pas la direction.
> La direction vient de son cachet, de ses certificats, de son cabinet.

---

## 2. DIRECTION — « Papier clinique »

Trois matériaux de son monde réel, traduits en interface :

**Le papier.** Ses certificats sont en Times New Roman, sur papier blanc, avec un en-tête
bilingue. Les documents de l'application doivent **ressembler à du papier**, pas à une carte web.

**Le vert de son cachet.** Son logo — arbre/cerveau dans une main — est d'un teal profond.
C'est déjà son identité. On ne la remplace pas par du violet.

**Le calme d'un cabinet de psychiatrie.** Pas d'alerte rouge clignotante. Pas de badge de
gamification. Le registre est celui d'un lieu où l'on baisse la voix.

**Le risque assumé (§7) :** le **Mode Séance** — quand la consultation démarre, l'interface
entière se retire. C'est l'élément signature, et il est justifié par la clinique, pas par l'esthétique.

---

## 3. COULEUR

```css
:root {
  /* ── Encre ─────────────────────────────────────────────── */
  --ink-900: #0B1614;   /* titres, texte dense */
  --ink-700: #23342F;   /* corps */
  --ink-500: #566B65;   /* secondaire */
  --ink-300: #8FA39D;   /* tertiaire, placeholders */
  --ink-100: #D3DEDA;   /* bordures */

  /* ── Surfaces ──────────────────────────────────────────── */
  --paper:    #FBFCFB;  /* fond application — papier légèrement froid */
  --card:     #FFFFFF;  /* surfaces de données — blanc franc, opaque */
  --sunken:   #F2F5F4;  /* zones en retrait, tableaux zébrés */
  --rule:     #E4EAE8;  /* filets */

  /* ── Teal — repris du cachet ───────────────────────────── */
  --teal-900: #0D3833;
  --teal-700: #14544D;
  --teal-600: #1B6B63;  /* PRIMAIRE — couleur du logo */
  --teal-400: #4E958D;
  --teal-100: #DCEBE9;
  --teal-050: #F0F7F6;

  /* ── Sémantique clinique ───────────────────────────────── */
  --attention: #B8763A;  /* attention — ambre, jamais rouge */
  --attention-bg: #FBF2E9;
  --critical:  #A33A32;  /* réservé : disque plein, perte de données */
  --critical-bg: #FBEDEC;
  --positive:  #3E7A5E;  /* amélioration d'un score */
  --positive-bg: #EDF5F1;

  /* ── Nuit / Mode Séance ────────────────────────────────── */
  --night-bg:   #0A1413;
  --night-card: #132321;
  --night-rule: #22403C;
  --night-ink:  #DCE8E5;
}
```

### 3.1 Règles de couleur
1. **Le rouge est un budget.** Il ne sert qu'à deux choses : disque critique, perte de données.
   Un RDV annulé n'est pas rouge. Un score élevé n'est pas rouge. Si tout est rouge, rien ne l'est.
2. **Le teal appartient aux actions**, pas à la décoration. Un bloc teal signifie « ceci est cliquable
   ou ceci est actif ».
3. **Aucun dégradé sur une surface de données.** Un dégradé est autorisé sur : l'orbe Jarvis,
   l'écran de connexion. Nulle part ailleurs.
4. **Contraste minimum 4.5:1** sur tout texte. Vérifié, pas estimé.

---

## 4. TRANSPARENCE — LA RÈGLE

Tu as demandé des effets de transparence. Voici la version que je défends, et pourquoi elle est
plus belle **et** plus sûre que du verre partout.

### 4.1 Ce qui peut être en verre — le mobilier flottant
Éléments **au-dessus** de l'interface, temporaires, sans donnée clinique fine :
- panneau Jarvis
- carte de confirmation
- barre de commande (⌘K)
- en-tête collant au défilement
- fond de modale

```css
--glass-panel: rgba(255, 255, 255, 0.72);
--glass-blur:  saturate(180%) blur(20px);
--glass-edge:  1px solid rgba(255, 255, 255, 0.65);
--glass-shade: 0 1px 2px rgba(11,22,20,.04),
               0 8px 24px -8px rgba(11,22,20,.10),
               0 24px 48px -24px rgba(11,22,20,.14);
```

### 4.2 Ce qui ne l'est jamais — les surfaces de données
Opaque, sans exception :
posologie · dose · score d'échelle · note clinique · transcription · montant · date de RDV ·
nom de patient

### 4.3 Pourquoi — et ce n'est pas une question de goût
Du texte translucide au-dessus d'un contenu qui défile change de contraste **selon ce qui passe
derrière**. Sur « **25 mg** » contre « **250 mg** », le coût d'une lecture ambiguë n'est pas
esthétique.

> **La règle :** le verre décore le mobilier. Il ne touche jamais la donnée.
> Cela rend aussi le verre plus efficace — quand tout est translucide, plus rien ne flotte.

### 4.4 Profondeur sans transparence
```css
--lift-0: none;
--lift-1: 0 1px 2px rgba(11,22,20,.05), 0 1px 1px rgba(11,22,20,.03);
--lift-2: 0 2px 4px rgba(11,22,20,.05), 0 6px 12px -4px rgba(11,22,20,.07);
--lift-3: 0 4px 8px rgba(11,22,20,.06), 0 16px 32px -12px rgba(11,22,20,.12);
```
Ombres **froides et vertes**, jamais grises neutres. Détail invisible consciemment,
perceptible inconsciemment : c'est ce qui distingue une interface soignée d'une interface correcte.

---

## 5. TYPOGRAPHIE

Quatre rôles. Chacun a une raison d'exister tirée du contenu.

| Rôle | Fonte | Pourquoi |
|---|---|---|
| **Interface** | **Geist Sans** | Neutre, dense, excellent en petites tailles. Elle lit des tableaux toute la journée. |
| **Document** | **Newsreader** | Sérif transitionnelle. Apparaît **uniquement** dans les aperçus de certificats — écho direct de son Times New Roman. |
| **Arabe** | **IBM Plex Sans Arabic** | Transcriptions, étiquettes bilingues. Vraie fonte arabe, jamais un fallback. |
| **Données** | **Geist Mono** | Heures, doses, montants, chronomètre. Chiffres alignés verticalement. |

```css
--font-ui:  'Geist Sans', system-ui, sans-serif;
--font-doc: 'Newsreader', Georgia, serif;
--font-ar:  'IBM Plex Sans Arabic', 'Noto Sans Arabic', sans-serif;
--font-num: 'Geist Mono', ui-monospace, monospace;
```

> **Newsreader ne sort jamais du contexte document.** C'est ce qui lui donne son sens :
> quand elle apparaît, la praticienne sait qu'elle regarde quelque chose qui sera imprimé
> et signé. La typographie encode l'état juridique du contenu.

### 5.1 Échelle
```css
--t-display: 30px/1.15  600  -0.02em;   /* titre d'écran, un seul par vue */
--t-title:   21px/1.25  600  -0.01em;   /* titres de section */
--t-heading: 16px/1.35  600  -0.005em;  /* en-têtes de carte */
--t-body:    14px/1.55  400   0;        /* corps — le plus utilisé */
--t-notes:   15px/1.7   400   0;        /* notes cliniques : plus grand, plus aéré */
--t-label:   12px/1.3   500   0.02em;   /* étiquettes de champ */
--t-eyebrow: 11px/1.2   600   0.09em;   /* SECTIONS, majuscules */
--t-num:     14px/1.4   500   0;        /* tabular-nums obligatoire */
```

> ⚠️ **Les notes cliniques sont plus grandes que le reste** (15px/1.7). Elle les relit des mois
> plus tard, parfois en fin de journée. La densité est bonne pour un tableau, mauvaise pour un récit.

### 5.2 Bilingue
```css
[dir="rtl"], .ar { font-family: var(--font-ar); line-height: 1.8; }
```
L'arabe demande **plus d'interligne**. Une transcription arabe au line-height du français est
illisible. Les segments de transcription sont en `dir="rtl"` avec bascule FR au survol.

---

## 6. ESPACE, RAYONS, GRILLE

```css
/* Échelle 4px */
--s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px;
--s-6:24px; --s-8:32px; --s-10:40px; --s-12:48px; --s-16:64px;

--r-sm:6px; --r-md:10px; --r-lg:14px; --r-xl:20px; --r-full:999px;
```

**Grille applicative**
```
┌──────────┬───────────────────────────────────┬─────────────────┐
│ Nav      │  Zone principale                  │  Contexte       │
│ 248px    │  fluide, max 1120px               │  340px          │
│ fixe     │                                   │  repliable      │
└──────────┴───────────────────────────────────┴─────────────────┘
```
Sous 1280px, la colonne contexte devient un tiroir. Sous 1024px, la nav se réduit aux icônes.
Cible réelle : **1920×1080**, l'écran Dell du cabinet.

---

## 7. SIGNATURE — LE MODE SÉANCE

L'élément par lequel l'application sera reconnue. Il ne vient pas d'une tendance visuelle :
il vient d'une contrainte clinique réelle.

**Le problème.** Quand la patiente est assise en face, chaque seconde passée à regarder l'écran
est une seconde volée à l'alliance thérapeutique. Une interface riche est ici un défaut.

**La réponse.** `start_consultation` fait entrer toute l'application dans un autre état :

```
AVANT — mode cabinet                 PENDANT — mode séance
┌────┬──────────┬────────┐          ┌──────────────────────────────┐
│nav │ contenu  │contexte│          │      ●  00:14:32             │
│    │          │        │   ──►    │                              │
│    │          │        │          │   ‹ fil de séance ›          │
└────┴──────────┴────────┘          │                              │
plein jour, dense                    └──────────────────────────────┘
                                     nuit, une seule colonne, calme
```

**Ce qui se passe, en 600 ms :**
1. Le fond glisse vers `--night-bg` — la pièce baisse la lumière
2. La navigation et le contexte se retirent (`translateX`, non `display:none`)
3. Le chronomètre apparaît en `--font-num`, grand, calme, sans effet
4. Le **fil de séance** commence à descendre : segments de transcription à gauche,
   observations Jarvis à droite, sur une même ligne de temps

**Le fil de séance** est la trace visuelle de la consultation. Il descend lentement.
Chaque nouveau segment arrive en 240 ms, opacité et 4 px de translation. Rien ne clignote,
rien ne surgit, rien ne réclame le regard.

**Sortie** : `Terminer la séance` → retour au jour en 600 ms, avec le brouillon de note prêt.

> C'est là que je dépense toute l'audace du projet. Partout ailleurs : discipline et silence.

---

## 8. MOUVEMENT

```css
--e-out:   cubic-bezier(0.16, 1, 0.3, 1);      /* entrées — décidé */
--e-in:    cubic-bezier(0.4, 0, 1, 1);         /* sorties — net */
--e-soft:  cubic-bezier(0.4, 0, 0.2, 1);       /* transformations */
--e-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* orbe Jarvis UNIQUEMENT */

--d-instant: 90ms;    /* survol, focus */
--d-quick:   160ms;   /* boutons, bascules */
--d-normal:  240ms;   /* cartes, tiroirs */
--d-slow:    380ms;   /* modales, panneaux */
--d-scene:   600ms;   /* Mode Séance */
```

### 8.1 Les moments orchestrés — quatre, pas plus
| Moment | Traitement |
|---|---|
| **Ouverture de session** | Nav en fondu-montée 240 ms, contenu décalé de 60 ms, colonnes de tableau en cascade de 30 ms. Une seule fois par connexion. |
| **Entrée en séance** | §7. Le moment le plus travaillé de l'application. |
| **Carte de confirmation Jarvis** | Apparition à 0.96 → 1 en 240 ms `--e-out`, fond assombri à 180 ms. Le bouton *Confirmer* ne devient actif qu'à 400 ms — **anti-clic réflexe**, délibéré. |
| **Note signée** | Le cadre passe au teal, un filet se trace de gauche à droite en 380 ms, l'horodatage apparaît. Le document se ferme. On sent le verrou (ADR-004). |

### 8.2 Micro-interactions
```css
.row:hover      { background: var(--teal-050); transition: background var(--d-instant); }
.card:hover     { box-shadow: var(--lift-2); transform: translateY(-1px); }
.btn:active     { transform: scale(0.985); }
:focus-visible  { outline: 2px solid var(--teal-600); outline-offset: 2px; }
```

### 8.3 Ce qui ne bouge jamais
- Une donnée clinique affichée (le texte ne fait pas de fondu à la mise à jour — il change)
- Un montant
- Le contenu d'une carte de confirmation
- Un aperçu de document

> Une valeur qui s'anime pendant qu'on la lit est une valeur qu'on lit mal.

### 8.4 Mouvement réduit — obligatoire
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .01ms !important;
    transition-duration: .01ms !important;
  }
  .session-mode { transition: background-color 120ms linear; }
}
```

---

## 9. COMPOSANTS

### 9.1 Navigation
Fond `--paper`, filet à droite. Groupes en `--t-eyebrow` : **MENU · CLINIQUE · GESTION · SYSTÈME**
(comme ta maquette). Élément actif : fond `--teal-050`, barre teal 3 px à gauche, texte `--teal-900`.
Icônes 18 px, trait 1.5 px, jamais pleines.
Compteurs : pastille `--attention`, jamais rouge — un message en attente n'est pas une urgence médicale.

### 9.2 Carte
```css
.card {
  background: var(--card);        /* opaque, §4.2 */
  border: 1px solid var(--rule);
  border-radius: var(--r-lg);
  box-shadow: var(--lift-1);
  padding: var(--s-6);
}
```
En-tête : titre `--t-heading` à gauche, actions à droite. Un filet `--rule` sous l'en-tête,
uniquement si la carte contient un tableau.

### 9.3 Fiche patient
```
┌────────────────────────────────────────────────────┐
│ ⬤  Nassim Belkacem                    #P-0147      │
│    34 ans · M · 0555 12 34 56                      │
│    Dernière consultation : 14 juillet 2026         │
├────────────────────────────────────────────────────┤
│ [Historique] [Traitements] [Échelles] [Documents]  │
└────────────────────────────────────────────────────┘
```
L'avatar est un **monogramme** sur `--teal-100`, jamais une photo. Un cabinet de psychiatrie
ne photographie pas ses patients.

### 9.4 Agenda
Colonnes = journée. Une ligne d'heure toutes les 30 min en `--rule`. **Ligne du présent** en
`--teal-600`, 2 px, avec l'heure en pastille — la seule chose qui bouge dans l'écran (une fois
par minute).

Statuts, par le fond, sans jamais de rouge :
`requested` contour pointillé · `confirmed` `--teal-050` · `arrived` `--teal-100` + point
· `in_session` `--teal-600` plein, texte blanc · `completed` `--sunken` · `no_show` rayé
· `cancelled` opacité 0.4

### 9.5 Panneau Jarvis
Le seul endroit avec du verre (§4.1). Ancré à droite, largeur 380 px.
**L'orbe** : cercle de 40 px, dégradé teal, respiration lente en repos (scale 1 → 1.03, 3 s,
`--e-soft`). En écoute : anneau réactif au niveau du micro. En traitement : rotation lente du dégradé.
`--e-spring` n'est utilisé **que** par l'orbe.

### 9.6 Carte de confirmation
Le composant le plus important de l'application (§6 de `03-JARVIS-TOOLS.md`).
Verre, `--lift-3`, 420 px. Valeurs en `--font-num`, étiquettes en `--t-label`.
Bandeau `--attention-bg` pour les actions destructives.
`Confirmer` en `--teal-600` plein · `Annuler` en fantôme.
**Aucun bouton par défaut. Délai de 400 ms avant activation.**

### 9.7 Aperçu de document
Fond `--card`, proportions **A4**, ombre `--lift-3`, `--font-doc`.
Reproduction fidèle de son en-tête : bloc FR à gauche, arabe dessous, logo centré,
N° d'Ordre, téléphone, bloc Date/Nom/Prénom/Âge à droite.
> Ce que l'écran montre est **exactement** ce que l'imprimante produira. Aucune surprise papier.

### 9.8 États vides
Jamais d'illustration. Une phrase en `--ink-500`, une action en teal.
> *« Aucune consultation aujourd'hui. »* + `Démarrer une consultation`

### 9.9 Erreurs
```
Impossible d'enregistrer la note. La connexion à la base a été interrompue.
Vos modifications sont conservées localement.        [ Réessayer ]
```
Ce qui s'est passé · ce qui a été préservé · quoi faire. Jamais d'excuse, jamais de vague.

---

## 10. LANGUE DE L'INTERFACE

| Écran | Terme retenu | Refusé |
|---|---|---|
| Dashboard | **Tableau de bord** | Accueil |
| Patients | **Patients** | Dossiers |
| Diary | **Agenda** | Calendrier, Journal |
| Communications | **Messages** | Communications |
| Files & Notes | **Documents** | Fichiers |
| Treatments | **Traitements** | Prescriptions |
| Aftercare | **Suivi** | Aftercare |
| Finance | **Finances** | Comptabilité |
| Reports | **Statistiques** | Rapports & Analyses |
| AI Agents | **Agents** | Agents IA |
| Activity log | **Journal d'activité** | Logs |
| Settings | **Paramètres** | Réglages |

**Verbes de boutons** — l'action est nommée par ce qu'elle fait :
`Enregistrer` · `Signer la note` · `Démarrer la séance` · `Terminer la séance` ·
`Générer le certificat` · `Confirmer` · `Fixer le tarif`
Jamais : `Soumettre`, `OK`, `Valider` seul.

**Cohérence :** le bouton `Signer la note` produit le message *« Note signée. »* Toujours le même
verbe du début à la fin.

---

## 11. ACCESSIBILITÉ — LE PLANCHER

- Contraste ≥ 4.5:1 partout, ≥ 3:1 sur les éléments d'interface
- Focus visible sur **tout** élément interactif — elle travaillera au clavier plus qu'on ne le croit
- Cibles ≥ 36 px (44 px sur le formulaire QR, téléphone)
- Jamais la couleur seule : un statut a toujours une forme ou un texte
- `prefers-reduced-motion` respecté (§8.4)
- `lang` et `dir` corrects sur chaque bloc arabe

---

## 12. À FAIRE AVANT CLAUDE DESIGN

- [ ] Logo vectorisé (SVG) — actuellement seulement en scan
- [ ] Valeur exacte du teal du cachet (pipette sur le logo) → ajuster `--teal-600`
- [ ] Confirmer les fontes disponibles hors ligne (le cabinet n'aura pas toujours de réseau)
- [ ] Ordre de conception : **Mode Séance** → Tableau de bord → Fiche patient → Agenda → Aperçu document

> Commencer par le Mode Séance. C'est l'écran le plus difficile et le plus déterminant.
> S'il est juste, le reste suit. S'il est raté, le reste ne sauvera rien.

---

## 13. LE TEST DU MIROIR

Avant de livrer un écran, trois questions :

1. **Cet élément aide-t-elle à soigner, ou à impressionner ?** Le second se retire.
2. **Peut-on lire cette valeur en une demi-seconde, avec un patient qui parle ?**
3. **Si on enlève une chose, l'écran est-il meilleur ?** Généralement oui.

> Chanel : avant de sortir, retirer un accessoire.
> Ici : avant de livrer, retirer un composant.

---

*Fin du document. Prochain livrable : `05-BUILD-PLAN.md` — J0 à J3, heure par heure, avec checkpoints verts/rouges. Puis `CLAUDE.md`.*
