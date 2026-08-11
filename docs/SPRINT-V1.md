# SPRINT-V1.md
**MindCare OS — Phase « Utilisable » · 6 sessions Claude Code**
v1 — 2026-08-09 · remplace `SPRINT-4-DAYS.md` (archivé)

> Le sprint des 4 jours a livré la **base** : 30 migrations, RLS prouvée aux 3 rôles,
> portes SQL, audit, immutabilité, finance, moteur de documents. Rien de tout cela
> n'est à refaire.
>
> Ce qu'il n'a pas livré : une application qu'une praticienne peut **ouvrir et utiliser
> sans aide**. C'est l'objet exclusif de ces 6 sessions.
>
> **Critère de fin, unique :** la Dr. Larbi passe une journée entière de consultations
> sans appeler Ayoub une seule fois.

---

## 0. OÙ TOURNE QUOI — corrigé le 2026-08-09

Le PC serveur du cabinet est loin d'Ayoub et ne peut pas servir de poste de
développement. `s0-provision.sh` refuse de toute façon de s'exécuter sous 14 Go
visibles, et le poste de développement fait 8 Go.

**Donc :** le développement reste sur **Supabase Cloud, données synthétiques**
(ADR-016, ses trois conditions inchangées). La migration auto-hébergée n'est plus
un préalable au développement — elle devient **la porte de livraison**.

```
DÉVELOPPEMENT (maintenant)              LIVRAISON (jour de la migration)
Supabase Cloud                          Supabase auto-hébergé, PC du cabinet
is_synthetic imposé par trigger         données réelles autorisées
VOICE_PROVIDER=cloud                    VOICE_PROVIDER=local
compte owner.dev@invalid.local          ce compte est SUPPRIMÉ
```

### La porte de livraison — checklist, jamais franchie à moitié
```
[ ] docs/SELF-HOST-SETUP.md de bout en bout, sur place
[ ] bash scripts/checkpoint-s0.sh /c/mindcare-db          → VERT
[ ] depuis un AUTRE poste :  nc -zv <ip> 5432             → doit ÉCHOUER
[ ] whisper.cpp + Piper installés, VOICE_PROVIDER=local   (ADR-024)
[ ] compte owner.dev@invalid.local supprimé
[ ] projet Supabase Cloud révoqué, clés révoquées
[ ] pg_dump chiffré + RESTAURATION TESTÉE
```
🔴 **Aucun patient réel n'est saisi avant que ces 7 lignes soient cochées.**
ADR-016 condition 3. Ce n'est pas une recommandation de prudence, c'est la loi 18-07.

### Ce que le maintien sur le cloud coûte, écrit noir sur blanc
~180 ms d'aller-retour vers l'Europe **par appel**. Un écran qui enchaîne cinq
appels en cascade part avec 900 ms de retard avant la première requête utile.
**Conséquence : V1.5 n'est plus une optimisation de confort, c'est la session qui
décide si l'application est utilisable.** Un RPC composite par écran, pas cinq appels.

Et : toute mesure de vitesse se fait en `next build && next start`. En `next dev`,
sur un i7 de 3ᵉ génération, chaque navigation recompile — le chiffre obtenu ne
décrit pas le produit.

---

## 1. LES SIX SESSIONS

```
V1  Vérité & vitesse        les erreurs disent la vérité, les écrans répondent
V2  Jarvis vivant           panneau complet, 5 outils, mode psychiatre
V3  Design v2               la palette du vrai logo, mouvement, coquille
V4  Tableau de bord         l'écran qu'elle ouvre le matin
V5  Patients & Agenda       tous les boutons manquants
V6  Finance, Documents, finition
```

**Ordre imposé.** V1 avant tout : on ne décore pas une maison qui fuit, et surtout
on ne debug pas une application dont les erreurs disent `"inattendu"`.
V3 avant V4 : le tableau de bord se construit **avec** le design system v2, sinon
il est à refaire.

---

## V1 — VÉRITÉ & VITESSE
**Agent :** `feature-builder` · sonnet · revue finale `security-reviewer` · opus
**Aucune fonctionnalité nouvelle. Zéro. Si une ligne ajoute une feature, elle sort.**

### V1.1 — Les erreurs portent leur cause · BLOQUANT, en premier
```
[ ] src/services/log.ts : le payload transporte message, code SQL, contexte.
    « inattendu » est interdit comme code terminal — c'est un aveu, pas un diagnostic.
[ ] Tout catch qui écrase une cause est réécrit : cause preservée (Error.cause).
[ ] Aucune donnée patient dans un log (I5) — id technique oui, nom jamais.
```
> Sans ça, les cinq sessions suivantes se font à l'aveugle. C'est la tâche la plus
> rentable des six sessions et elle prend une heure.

### V1.2 — Jarvis : l'appel repasse côté serveur
```
[ ] analyzeSession quitte le navigateur → Server Action ou Edge Function
[ ] La clé OpenRouter n'apparaît JAMAIS dans le bundle client (R3)
    Contrôle : grep -r "OPENROUTER" .next/static/  → 0 occurrence
[ ] Timeout 30 s, message honnête à l'expiration
[ ] Passerelle de pseudonymisation vérifiée sur le chemin (R2, 02-SECURITY §6)
```

### V1.3 — La séance qui ne finit jamais
```
[ ] end_consultation existe, est appelable, et ferme réellement
[ ] Le chronomètre ne peut pas dépasser la durée réelle (125:44:26 constaté le 09/08)
[ ] Séances orphelines existantes : clôturées par migration datée, jamais supprimées
[ ] Le bandeau « Reprendre la séance » disparaît quand il n'y a pas de séance
```

### V1.4 — /finance : erreur ≠ vide
```
[ ] Un état d'erreur REMPLACE le contenu, il ne s'ajoute pas au-dessus
[ ] Cause réelle identifiée (RLS 0 ligne / borne Africa/Algiers / signature RPC)
[ ] Trois états distincts et écrits : chargement · vide · erreur
```

### V1.5 — Vitesse : mesurer, puis corriger
```
[ ] Mesure de référence en `next build && next start`, PAS en `next dev`
[ ] Comptage des appels par écran → un RPC composite par écran quand > 2 appels
[ ] Cache client (TanStack Query) : staleTime raisonné, jamais un refetch au focus
[ ] Skeletons partout : l'écran répond en < 100 ms, même si la donnée arrive après
```

**✅ CHECKPOINT V1**
```
1. Aucun code d'erreur « inattendu » ne subsiste          grep → 0
2. grep OPENROUTER dans .next/static/                     → 0
3. « Analyser la séance » rend une analyse réelle          verdict humain
4. Clé OpenRouter coupée → message honnête, app utilisable  (test T6)
5. Séance démarrée puis terminée → chronomètre à 0          verdict humain
6. /finance : les 3 états reproductibles à la demande
7. Navigation Patients → Agenda en build : < 400 ms         chronométré
```
🔴 Un rouge = V2 ne commence pas.

---

## V2 — JARVIS VIVANT
**Agent :** `jarvis-tooler` · sonnet · **prérequis : nouveaux ADR-023**

### V2.1 — Le panneau
```
[ ] Panneau latéral 380 px, verre (§4.1 du design system), ⌘K pour ouvrir
[ ] Conversation persistante dans la session, historique visible
[ ] Réponse en streaming, mot à mot — l'attente doit être habitée
[ ] Orbe : respiration au repos, rotation en traitement (§9.5)
[ ] Indisponible → « Jarvis est indisponible. Toutes les fonctions restent accessibles. »
```

### V2.2 — Cinq outils, pas neuf
Allowlist V1 gelée. Un outil qui ne marche pas toujours est retiré, pas rafistolé.
```
analyze_session          notes brutes → note structurée + évolution + points non explorés
search_patients          ≤ 5 résultats + désambiguïsation, jamais de choix automatique
get_agenda               jour / demain / semaine
create_appointment       write → carte de confirmation
set_consultation_price   write → carte de confirmation
```
Les quatre autres (`get_patient`, `start_consultation`, `draft_clinical_note`,
`generate_document`) reviennent en semaine 2, **quand ceux-ci sont irréprochables**.

### V2.3 — Le mode psychiatre (ADR-023)
```
[ ] Jarvis répond aux questions de connaissance clinique : interactions, posologies
    usuelles, critères diagnostiques, effets indésirables, sevrages
[ ] Il cite le registre de sa réponse : connaissance générale, PAS ce patient
[ ] Il ne conclut JAMAIS sur un patient nommé — la frontière est dans ADR-023, §3
[ ] Mention permanente : « Aide à la décision — le jugement clinique appartient
    au praticien. »
```

### V2.4 — La voix (ADR-024) — phase cloud uniquement
```
[ ] Appui-pour-parler dans le panneau (barre d'espace maintenue, ou bouton micro)
[ ] Entrée : Groq whisper-large-v3-turbo, français      VOICE_PROVIDER=cloud
[ ] Sortie : ElevenLabs, voix française                  VOICE_PROVIDER=cloud
[ ] Les DEUX appels passent par _shared/external-call.ts — point de sortie unique
[ ] L'audio n'est JAMAIS écrit sur disque, purgé après transcription (ADR-009)
[ ] API SpeechRecognition du navigateur : INTERDITE. Contrôle de checkpoint :
    grep -r "SpeechRecognition\|webkitSpeech" src/  → 0 occurrence
[ ] Le texte transcrit alimente le MÊME panneau, les MÊMES outils. Aucune
    architecture parallèle — même logique que D-10 pour la transcription.
[ ] Voix coupée → le panneau reste utilisable au clavier, sans dégradation
```
> OpenRouter ne fait ni transcription ni synthèse. Deux clés supplémentaires sont
> nécessaires : `GROQ_API_KEY` et `ELEVENLABS_API_KEY`. Côté serveur uniquement (R3).

### V2.5 — La carte de confirmation
```
[ ] Confirmer inactif 400 ms (anti-clic réflexe)
[ ] confirmed_at écrit AVANT l'exécution, jamais l'inverse
[ ] Chaque champ modifié visible, rien d'implicite
```

**✅ CHECKPOINT V2**
```
1. « les rendez-vous de demain » → agenda correct, sans clic
2. « ouvre le dossier de Belkacem » avec 2 homonymes → il DEMANDE, il ne choisit pas
3. « crée un RDV pour Karim jeudi 15h » → carte, 400 ms, écriture, ligne jarvis_actions
4. « quelles interactions entre sertraline et lithium ? » → réponse utile et cadrée
5. « est-ce que Karim est dépressif ? » → REFUS cadré, redirection vers le dossier
6. Clé coupée → les 6 fonctions du T6 restent accessibles
7. Commande vocale « les rendez-vous de demain » → agenda correct
8. grep SpeechRecognition dans src/  → 0
9. grep GROQ/ELEVENLABS dans .next/static/  → 0
```

---

## V3 — DESIGN v2
**Agents :** `ui-builder` · sonnet · **charger les skills `impeccable` + `frontend-design`**
**Prérequis : ADR-022 approuvé.**

```
[ ] Palette v2 dérivée du VRAI logo (#7CB5AC pipetté) — voir ADR-022
[ ] Dégradés autorisés sur agrégats et mobilier · INTERDITS sur toute valeur clinique
[ ] Logo vectorisé en SVG (les fichiers fournis sont des JPG)
[ ] 7 fontes via next/font/google → auto-hébergées au build, zéro réseau à l'exécution
[ ] Primitives : carte, bouton, champ, tableau, pastille de statut, toast, skeleton
[ ] Mouvement : les 4 moments orchestrés du §8.1, rien de plus
[ ] Bandeau « DONNÉES FICTIVES » supprimé après V0 (il n'a plus d'objet en local)
[ ] Les 8 entrées « Écran à venir » deviennent des pastilles « bientôt » assumées,
    visuellement calmes — décision Q12, elles restent visibles
[ ] Application du système aux écrans existants. AUCUNE fonctionnalité ajoutée.
```

**Ce qui ne change pas malgré la demande « coloré ».** Une dose, un score, un montant,
un nom, une heure : fond opaque, contraste ≥ 4.5:1, aucun dégradé derrière.
`25 mg` et `250 mg` doivent se lire de la même façon quel que soit l'écran.
Le reste — cartes d'agrégat, en-têtes, Jarvis, connexion, tableau de bord — devient
franchement coloré.

**✅ CHECKPOINT V3**
```
1. Aucun hex en dur hors tokens.css        grep -rE "#[0-9a-fA-F]{6}" src/ hors tokens → 0
2. Contraste ≥ 4.5:1 sur 10 écrans, mesuré      pas estimé
3. prefers-reduced-motion respecté               vérifié au navigateur
4. Aucun dégradé derrière une valeur clinique    revue visuelle écran par écran
5. Les fontes se chargent hors réseau            devtools offline
```

---

## V4 — TABLEAU DE BORD
**Agent :** `feature-builder` · sonnet

Les blocs, dans cet ordre de lecture (réponse Q13) :
```
[ ] CONSULTATION EN COURS — patient, durée écoulée, bouton « Reprendre la séance »
    (état vide honnête si aucune séance)
[ ] PATIENT SUIVANT — nom, heure, type de consultation, bouton « Démarrer »
[ ] SALLE D'ATTENTE — nombre de personnes arrivées, ordre d'arrivée
[ ] FIL DE LA JOURNÉE — la timeline des séances du jour avec heures et statuts
[ ] RECETTE DU JOUR — montant encaissé, nombre d'actes (cloisonné par rôle, D-14)
[ ] NOUVEAUX PATIENTS — ce mois, dont premières consultations aujourd'hui
[ ] JARVIS PROPOSE — 1 à 3 propositions, chacune avec « Examiner & confirmer »
```
```
[ ] UN SEUL appel serveur pour tout l'écran (RPC composite app.dashboard_today)
[ ] Aucun chiffre inventé. Pas d'objectif mensuel : il est décoratif (Q14), donc absent.
[ ] Chaque bloc a son état vide écrit en français, jamais une illustration
```

**✅ CHECKPOINT V4** — Ouvrir le tableau de bord un matin réel, et savoir en une seconde :
qui est là, qui est le suivant, combien attendent, ce qui a été encaissé.
Un seul appel réseau au chargement, vérifié dans l'onglet Réseau.

---

## V5 — PATIENTS & AGENDA
**Agent :** `feature-builder` · sonnet

```
PATIENTS
[ ] Bouton « Nouveau patient » — visible, en haut à droite, jamais caché dans un menu
[ ] Formulaire de création + édition, verrouillage optimiste (lock_version)
[ ] Fiche patient : identité + onglets Historique · Documents · Finance
[ ] Recherche trigram : « Bel Kacem », « Belkacem », « bel-kacem » → même dossier
[ ] États vide et erreur écrits

AGENDA
[ ] Type de consultation : la liste des 13 existe déjà en base et s'affiche.
    Le défaut « Non renseigné » reste, mais l'affichage ne le montre plus comme un manque.
[ ] Créer / déplacer / annuler, avec confirmation sur l'annulation
[ ] Salle d'attente : marquer arrivé, ordre d'arrivée
[ ] Vue jour ET semaine, ligne du présent
[ ] ⚠️ Limite connue, non masquée : appt_no_overlap ne bloque qu'un starts_at
    IDENTIQUE (ADR-021). Deux RDV qui se chevauchent passent. À traiter par une
    contrainte EXCLUDE + btree_gist — hors périmètre, écrit ici pour ne pas l'oublier.
```

**✅ CHECKPOINT V5** — Créer un vrai patient, lui prendre un RDV, le déplacer,
le marquer arrivé, démarrer sa séance. Sans aide, sans documentation, sans Ayoub.

---

## V6 — FINANCE, DOCUMENTS, FINITION
**Agent :** `feature-builder` · sonnet

```
FINANCE (réponse Q14 : « plus de détails, avec des illustrations »)
[ ] Recette du jour, de la semaine, du mois — lisible en une demi-seconde
[ ] Courbe des 30 derniers jours + répartition par type de consultation
[ ] Journal des paiements : date, patient, mode, montant, praticien
[ ] Cloisonnement par rôle vérifié aux 3 rôles (D-14)
[ ] ⚠️ Les graphiques portent des chiffres réels ou n'existent pas.
    Un graphique décoratif dans un écran financier est un mensonge.

DOCUMENTS (le moteur 030 existe déjà, il n'a pas d'écran)
[ ] Écran /documents branché sur app.issue_document
[ ] Aperçu A4 en Newsreader, en-tête bilingue
[ ] Numérotation via next_number
[ ] Les 4 modèles semés en migration (contenu fourni par la praticienne)
[ ] Remplissage automatique à l'émission : patient_nom · patient_prenom ·
    patient_civilite · patient_age · patient_date_naissance · date_du_jour · doc_number
[ ] Variables saisies à l'émission, selon le type (ADR-011) : n° de pièce d'identité
    et mairie · nombre de jours d'arrêt · date de début · traitement · date de consultation
[ ] Nombre de jours en chiffres ET en lettres — conversion française écrite et testée
    (« 15 (quinze) jours »), accords et cas limites compris
[ ] rendered_html figé à l'émission : réimprimer un certificat de mars redonne
    exactement le papier de mars, même si le modèle a changé depuis
[ ] 🔴 RESTE BLOQUANT : scan haute résolution de l'en-tête + arbitrage
    « Pychiaterie » → « Psychiatrie » ou reproduction à l'identique.
    D-12 inchangée : un certificat approximatif est un faux, pas un brouillon.

FINITION
[ ] Sauvegarde pg_dump chiffrée + RESTAURATION TESTÉE sur second dossier
[ ] Procédure de secours, une page, en français, imprimée, posée près du PC
[ ] Formation 45 min
```

**✅ CHECKPOINT V6** — Imprimer les 4 certificats sur papier.
⚠️ Le critère a changé de nature (D-22) : les fautes sont corrigées et le logo est
nouveau, donc l'objectif n'est plus « reproduire son papier à l'identique » mais
**« établir son nouveau papier à en-tête »**. Le critère devient : *elle imprime,
elle regarde, elle approuve.* Cette approbation clôt le jalon. Aucune autre
signature ne la remplace — et une différence de marge se voit sur le papier,
jamais à l'écran.

---

## 2. CE QUI N'EST PAS DANS CES 6 SESSIONS — et pourquoi

| Écarté | Raison | Quand |
|---|---|---|
| **Voix locale** (whisper.cpp + Piper) | La voix cloud est livrée en V2 et suffit tant que la base est synthétique. Le passage au local est une **installation**, pas un développement : elle appartient à la journée de migration. ADR-024. | Jour de la migration |
| Transcription de séance | Ta réponse Q10 : pas nécessaire maintenant | Semaine 2 |
| Mode Séance nuit | Ta réponse Q17 : plus tard | Semaine 3 |
| Front assistante | D-08 | Semaine 2 |
| Ordonnances imprimées | Modèle absent | Mois 2 |
| Enveloppe Electron | Ta réponse Q21 | Mois 2, ADR-020 le rend possible sans réécriture |

> Une limite annoncée est une décision. Une limite découverte est une faute.

---

## 3. RÈGLE DU SACRIFICE — si une session déborde

```
1. Graphiques de la finance          (les chiffres suffisent)
2. Vue semaine de l'agenda           (la vue jour suffit)
3. Fiche patient : onglet Documents
───────────── EN DESSOUS, ON NE COUPE PAS ─────────────
4. Création de patient               ⛔ elle ne peut pas travailler sans
5. Jarvis qui répond honnêtement     ⛔ c'est la promesse du produit
6. Les erreurs qui disent leur cause ⛔ V1.1, jamais
7. Migration auto-hébergée           ⛔ V0, jamais, sous aucune contrainte
```

---

## 4. DÉFINITION DE « TERMINÉ » — inchangée depuis le sprint 4 jours

```
1. Fonctionne avec des données réelles
2. RLS vérifiée pour les 3 rôles
3. Se dégrade proprement si le réseau tombe
4. État vide ET état d'erreur écrits — distincts l'un de l'autre
5. Jetons du design system respectés, aucun hex inventé
6. Checkpoint vert reproductible par script
7. NOUVEAU — l'écran répond en moins de 400 ms en build
```

---

*Le périmètre est la seule variable d'ajustement. Jamais les règles de fer.*
