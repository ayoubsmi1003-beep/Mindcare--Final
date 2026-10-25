# Alexa mains-libres : orbe vert, vague d'écoute, réveil « Alexa », lecture auto

Date : 2026-10-24. Demande : docteur, en consultation, mains prises.
Statut : PROJET — rien n'est construit avant approbation.

## 1. Intent et pourquoi

La praticienne parle à Alexa sans toucher l'écran : elle dit « Alexa »,
l'orbe vert lève la vague d'écoute, elle dicte, le texte apparaît, la
réponse part seule puis se lit à voix haute. Aujourd'hui il faut cliquer
(parler, envoyer, relire chaque bulle) et l'orbe reste muet par défaut.

## 2. Objectifs

1. Orbe vert : le composant Avatar 21st.dev (preset `green` existant),
   porté SANS la dépendance `motion` (remplacée par CSS `:active`), remplace
   SiriOrb sur les surfaces vocales : `OrbeVoix`, `FilJarvis` (état vide),
   `AlexaLune` (héros), `BulleAlexa`. Tailles via ses variantes sm/md/lg.
2. Vague d'écoute : le shader `wave` de SiriWave 21st.dev, porté en
   `VagueAlexa` (fond transparent, taille bornée, `renderScale` bas,
   repli Avatar si WebGL absent ou `prefers-reduced-motion`). Affichée
   pendant `ecoute`/`traitement` à la place de l'orbe, jamais décorative :
   branchée sur l'état réel + niveau micro existant (`--niveau`).
3. Réveil permanent : un interrupteur « Mains-libres » (défaut : OFF).
   ON → détecteur openWakeWord local déjà livré (`reveil-openwakeword.ts`,
   assets `public/wakeword/`) armé en continu ; au mot « Alexa » →
   accusé « Oui docteur, je vous écoute. » (TTS cloud, phrase fixe, sans
   identité) + tour système visible « À l'écoute… » → capture VAD
   existante → STT → texte affiché dans le fil → envoi AUTO → lecture
   AUTO de chaque phrase (déjà le comportement de la boucle vocale).
4. Lecture auto du chat texte : toute réponse texte d'Alexa se lit à voix
   haute sauf texte à identité (règle existante conservée : refus, motif
   affiché) ; interrupteur muet persistant (pas clinique : `localStorage`
   OK) ; toute nouvelle demande coupe la lecture en cours.

## 3. Non-objectifs et anti-objectifs

- NON : confirmation auto des actions cliniques. Une proposition
  (ordonnance, acte, écriture dossier) exige TOUJOURS le tap de la
  praticienne sur la carte existante. « Exécuter directement » = envoyer
  le message, jamais signer/émettre/écrire.
- NON : nouvelle dépendance (`motion` interdit : port CSS), nouveau
  modèle, cloud pour le mot de réveil (openWakeWord local, contrat
  `DetecteurReveil` inchangé : aucun échantillon ne sort en veille).
- ANTI : un orbe qui s'anime sans état réel ; un micro allumé sans
  témoin visible et interrupteur OFF accessible ; lire à voix haute un
  texte à jeton via un TTS tiers ; écrire quoi que ce soit au dossier
  sans carte de confirmation.
- ÉCHEC même si ça marche : la praticienne ne sait plus si on l'écoute.

## 4. Contraintes (ne changent pas)

- Loi 18-07, CLAUDE.md §1, docs/00-DECISIONS.md ; audio jamais sur
  disque (blobs mémoire révoqués, règle tenue) ; micro : témoin + OFF.
- `context/alexa-v2.md` : ne pas toucher `fr.ts` (nouvelles chaînes dans
  `src/i18n/alexa.ts`), pas de migration, pas de changement RLS, Gemini
  voix uniquement via l'admission existante, jamais de texte patient
  libre hors portes.
- Couleurs : jetons `tokens.css` + preset vert du composant (pas de hex
  en TSX) ; FR uniquement ; `aria-live` conservés ; états jamais
  distingués par la seule couleur (OrbeVoix le garantit déjà).
- Deux machines vocales coexistent (`jarvis-reveil` 8 états,
  `alexa-local` boucle) : le builder unifie l'entrée (un seul
  interrupteur) sans réécrire les deux machines.

## 5. Comment décidé (par le docteur, 2026-10-24)

- Vert : preset `green` du composant, pas une teinte custom.
- Accusé : « Oui docteur, je vous écoute. » (appel builder : texte exact
  dans `src/i18n/alexa.ts`, ex. `alexa.reveilAccuse`).
- SiriWave : variante `wave` pendant écoute/traitement ; Avatar vert le
  reste du temps.
- Lecture auto : GLOBALE — chaque réponse texte se lit, mains-libres ON
  comme OFF. Première lecture après un geste (clic/frappe : l'activation
  sticky du navigateur suffit) ; jamais de lecture d'historique au
  chargement.
- Envoi : INSTANTANÉ après transcription, sans fenêtre d'annulation.
- Suivi : après chaque tour le détecteur reste armé (veille = écoute
  du mot) pour les questions enchaînées, jusqu'à 15 min d'inactivité ou
  arrêt manuel. (Pas d'état `ecoute` sans capture : ce serait un faux
  état, règle 8.)
- Témoin : l'orbe seul (OrbeVoix + vague), pas de bandeau global.
- Vérification : comme exigé en continu — screenshots réels sur
  localhost:3000 + tests vitest offline ; aucun test n'écrit au dossier.

## 5b. Appels du builder (à valider en relecture)

- Moteur mains-libres = boucle `alexa-local` (envoi/lecture auto déjà
  là) ; `jarvis-reveil` ne fournit que le détecteur + l'armement.
- Lisible = corps de réponse seul (preuves, sources, cartes, statuts,
  textes d'erreur/interruption exclus) + refus identité inchangé.
- Micro partagé via le courtier `micro-partage` (jamais deux
  `getUserMedia`).
- Interrupteur défaut OFF, sans persistance inter-rechargement (un
  interrupteur qui survivrait éteindrait la vérité de l'orbe : le micro
  exige un geste à chaque visite).
- Chaînes : `src/i18n/alexa.ts` uniquement (jamais `fr.ts`).

## 6. Laissé au builder

Fichiers exacts, mapping tailles Avatar↔usages, seuil VAD/budgets
inchangés ou ajustés avec mesure, libellés ARIA FR précis, strategie de
re-arm après chaque tour, ce que fait le bouton muet pendant `parole`,
plan de tests (harnais existant `jarvis-voix-harnais` étendu : réveil →
accusé → auto-envoi ; e2e lecture seule + un tour synthétique comme
J9.3), preuve PASS/FAIL.
