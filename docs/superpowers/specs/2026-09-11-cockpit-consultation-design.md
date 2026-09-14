# Cockpit consultation — design validé (2026-09-11)

> Spec architecturale issue du brainstorming (parcours architectural, approuvée par la praticienne).
> Prochaine étape : `writing-plans` → plan d'implémentation. Aucun code écrit par cette spec.

## 0. Cadre no-loop

- **TASK :** transformer l'écran consultation en cockpit clinique light, dense, longitudinal — 100× UX sans casser l'architecture.
- **SCOPE :** `src/app/consultation/[id]/page.tsx` + nouveaux `src/components/consultation/cockpit/*` + ajouts seuls dans `src/styles/tokens.css` et `src/i18n/fr.ts`. Rien d'autre.
- **ENTRYPOINT :** `src/app/consultation/[id]/page.tsx:333` (`PageConsultation`).
- **STOP :** cockpit rendu depuis les portes existantes, tests existants verts, captures 1920/1440/1366 relues. Aucun refactor opportuniste.

## 1. Décisions verrouillées

1. **Persistance état clinique : hybride progressif.** Phase 1 sans migration : presets = gabarits texte injectés via `saveNote` existant + longitudinal via `échelles`, notes précédentes, analyses. Phase 2 (dessinée, NON appliquée sans feu vert séparé) : table `seance_etat` + portes (§8).
2. **Full light.** Suppression du fond nuit `modeSeance` (`AppShell modeSeance`, `tokens.css:630-649`). La consultation reste claire même en séance ouverte. `ChronoSeance` / `CompteReboursVerrou` conservés comme feuilles isolées (`page.tsx:274-331`).

## 2. Réalité vérifiée (audit, pas prose)

- Écritures : `saveNote/saveRawNotes/signNote/amendNote/closeConsultation` via portes `026/037`, verrou `trg_note_immutable` + fenêtre 15 min `008:49-81` — seul décideur. UI affiche seulement (`consultations.ts:16-24,195-220`).
- Lecture : `app.get_consultation` (`026:618-641`) + `getPatientWorkspace` lazy (`page.tsx:1012-1036`) + `get_previous_note` (`027:59-70`) + `get_patient_notes_history` (`065:82-98`) + `get_consultation_analysis` / `get_recent_session_analyses` (`067:249-282`).
- **AUCUNE colonne `humeur/anxiété/sommeil/énergie/appétit/observance/focus/preset` en base.** `structured:jsonb` existe (`008:20`) mais sans porte d'écriture (`save_note` refuse hors 4 SOAP, `026:397-402`) et `get_consultation` ne le lit pas. Scores existants = `scale_administrations.total_score` via `workspace.clinique.echelles{dernier,precedent,delta}` (`patients.ts:346-358`). Const explicitement assumé côté briefs (`jarvis-briefs.ts:24,62-69`).
- Tarif : `consultations` sans colonne prix (`037:8-10`) ; `close_consultation` refuse sans ligne `payments` (`037:82-94`) ; `BlocTarif.tsx:53-78` signale `onEtatTarif`.
- Jarvis : `analyzeSession` `write:false`, brouillon lecture seule, reprise manuelle (I6), disclaimer avant+après (I7) (`page.tsx:36-44,896-965,1333-1445`). Après-séance : clôture d'abord, `enchainerApresSeance` en `void` après (`page.tsx:831-857`, `apres-seance.ts:7-11`), ne lève jamais.
- UI : déjà light BLUE (`tokens.css:22-62`, `voile-aurore:281-288`) ; le « dark » = seul `mode-seance`. Primitives : `ui/index.ts` point d'entrée unique, `Surfaces` (niveaux + `PastilleIcone`), `Champs` (`SOCLE_CHAMP`, micro sur ligne libellé), `Bouton` (3 rangs, principale à gauche dans `BarreActions`), `EspaceTravail` (travail fluide + contexte 340px non-sticky volontaire), `SectionPliable` (`aria-expanded`, contenu retiré du DOM replié), `Etats` (`Non renseigné`, jamais tiret), `Onglets` (roving tabindex, `aria-selected`), `Icones` (grille 24, trait 1.75). Couleurs : `tokens.css` seul, `darkMode` absent, `night.*` réservé à l'ancien mode séance.
- Scroll actuel : 5 textareas (`brut lignes=8` + 4×SOAP `lignes=5`, `page.tsx:1117-1187`), gaps `gap-10/gap-8`, tarif + signature sous le pli (`page.tsx:1582-1614`), pas de barre sticky.

## 3. Invariants non négociables (rappel, canon : CLAUDE.md §1 + migrations)

1 écriture = 1 porte · `trg_note_immutable` seul décide · signature humaine explicite (`sign_clinical_note` interdit à Jarvis) · aucun DELETE clinique/financier (RULE) · sécurité en base jamais en JS · lecture dossier journalisée (`fiche`) · cloison ADR-003 (introuvable == hors périmètre, un seul message) · clôture exige tarif (offert = `0` explicite, jamais défaut) · Jarvis PROPOSE→CONFIRM→EXECUTE→VERIFY→AUDIT, pseudonymisation avant tout appel externe, audio jamais sur disque · `amount_dzd` entier, `timestamptz` + `Africa/Algiers` · zéro chaîne en dur (ADR-008, `fr.ts`) · couleurs `tokens.css` seul.

## 4. Architecture des composants (Phase 1, sans backend)

Nouveaux fichiers, tous sous `src/components/consultation/cockpit/` (réutilisent `ui/*`, jamais de SQL, jamais `@/server/*`) :

- `CockpitHeader.tsx` — remplace l'en-tête volumineux (`page.tsx:1498-1522`) : `← Agenda | Nom · type (`kind`) · date | 23:14 +3min (ChronoSeance existant) | pastille kind (tokens.css:295-306)`. Aucun numéro de séance affiché sauf s'il est dérivé d'une donnée réelle (`workspace.clinique.nombreConsultations`, ex. `12e séance du dossier`) — jamais de compteur inventé. Aucune lecture ajoutée. L'orbe Jarvis reste le lanceur flottant existant (`BulleAlexa`) ; l'en-tête n'en montre qu'un écho d'état quand une analyse court.
- `EtatClinique.tsx` — quick-check mixte, alimenté UNIQUEMENT par `dossier.clinique.echelles` + `diagnostics` + `traitementsV2` (observance/tolérance si présentes) + diff note précédente. Contrôles adaptés aux domaines réellement disponibles (aucune colonne humeur/sommeil/énergie n'existe — voir §2) : chaque échelle affiche dernier score + interprétation + badge Δ neutre (flèche + valeur signée + mot, ton info ; vert réservé à Stable) + provenance datée + bouton Inscrire ; chaque diagnostic affiche pastille + libellé + mention Principal le cas échéant + bouton Inscrire. Les contrôles segmentés par domaine (sommeil, énergie…) sont reportés à la Phase 2.
- `FocusSeance.tsx` — multi-sélection chips (Anxiété/Sommeil/Humeur/Traitement/Travail/Relations/Événement/+Ajouter) + libre optionnel. Phase 1 : la sélection préfixe un marqueur structuré dans `subjective` via `saveNote` (ex. `Focus : anxiété, sommeil — `), réversible, sans sémantique nouvelle.
- `DepuisDerniere.tsx` — réutilise `PointDeSituation` + `SectionDepuisDerniere` + `ListeSignaux` SANS COPIE (`page.tsx:1653-1656`) en bandeau interactif, clic = détail inline, jamais de navigation. Aucun bandeau synthétique ↑/↓/→/✓/⚠ : seules les sections déterministes existantes sont composées, sans item inventé.
- `NotesStructurees.tsx` — les 4 rubriques SOAP : 2–4 quick-picks (clés `fr.ts` additives) + `ChampZoneTexte lignes=3` par défaut (`clinique text-notes`), expansion au focus, dictée dans le slot `action` du libellé (contrat `Champs.tsx:60-69`), autosave 2 s + `viderLesAttentes()` avant signature inchangés (`page.tsx:597-741`). `brut lignes=8 → 4` replié + expansion.
- `RailContexte.tsx` — rail droit 340px (`--grid-context-width`), repliable à 0 (`aria-expanded`, préférence en `localStorage` non clinique). Sections compactes, sections vides = absentes : Dernière séance (preview `get_previous_note` + `[Voir la séance]` inline, URL inchangée) · Mini-timeline `●—●—○` (précédente/actuelle/prochain RDV `dossier.agenda`, nœuds cliquables) · Évolution (deltas échelles) · Traitement snapshot (lit `traitementsV2`, `[Modifier]` ouvre `PanneauTraitements` existant en tiroir, aucune logique dupliquée) · Jarvis (voir §6).
Interdit : mur de cartes (diviseurs + `Section` + `PastilleIcone` ; `Carte` réservée à la preuve de signature et aux amendements ADR-004), dégradés/lueurs derrière des valeurs cliniques, `dark:` variants, valeurs libres hors tokens.

- `BarreConsultation.tsx` — `position:sticky bottom-0 z-panneau` : puces `Notes ✓ · Évaluation · Conduite` + `IndicateurEnregistrement` + `4 000 DA [Modifier→popover BlocTarif]` + `[Enregistrer]` + `[Terminer la séance]` (masqué si `tarifPresent===false` + `PanneauInfo`, `page.tsx:1591-1612`). `[Enregistrer]` = flush explicite des minuteurs d'autosave via `viderLesAttentes()` existant (aucune sémantique nouvelle ; l'autosave reste le chemin normal). Réutilise `signer()/clore()` existants (`window.confirm`, `enchainerApresSeance` void-après-clôture).
- `page.tsx` (modifié, pas réécrit) — garde `charger` (générations + plafond `DELAI_LECTURE_MS`), états `echecLecture` vs `null` (ADR-003), montage `hidden` de la séance (protège `refs` dictée, `page.tsx:1569-1575`), sous-nav paresseuse (budget 06-PERF inchangé : aucun appel dossier tant que `seance` seul). `modeSeance={false}` toujours.

> Règle d'écriture Phase 1 (sans exception) : AUCUNE interaction du quick-check, du focus ou des quick-picks ne crée d'état persistant nouveau. Tout geste (segmenté, échelle, chip, preset) se résout en injection de texte via les portes existantes (`saveNote`/`saveRawNotes`, autosave 2 s + `viderLesAttentes()`), exactement comme une frappe. L'affichage longitudinal (badges Δ, tendances) ne lit que des données réelles (échelles, notes précédentes, analyses). Seule la Phase 2 (§8) persiste un état structuré, sur feu vert séparé.

## 5. Flux de données

Ouverture → `getConsultation(id)` (trace `fiche`) → saisies locales (`brut`, `soap`, jamais dans `seance`) → autosave 2 s (`saveRawNotes` refusé si `closed` ; `saveNote` clé absente = inchangé, vide = effacé, `026:431-445`) → `viderLesAttentes()` → `signNote` (draft→signed, refuse vide) → `set_consultation_price` (montant manuel ADR-010) → `closeConsultation` → `enchainerApresSeance` (analyse→résumé séquentiel, échecs IA = `ignoree`, jamais d'échec de clôture). Contexte (workspace, historique, timeline, documents, traitements) : lecture paresseuse au premier onglet/expansion, une fois, servie aux trois usages. Dictée : `useDicteeChamps<CibleDictee>` → `insererDictee` + `replacerCurseur(rAF)` → même chemin autosave ; échec voix = `setMessageErreur` seul, jamais `charger()`.

## 6. Jarvis (intégré, optionnel)

Orbe flottant conservé (`BulleAlexa`/`siri-orb`, états IDLE/LISTENING/THINKING/SPEAKING, animation subtile, `reduced-motion` respecté). Carte rail : suggestion contextuelle + `[Afficher]`, `disclaimer` permanent avant ET après, contenu visuellement distinct (`ia bg-ai-50`, jamais confondu avec la note signée). `analyserSeance` : bouton désactivé dès le 1er clic (`enAnalyse`), `AbortController` + compteur de génération (runs supersédés jetés), `Réessayer` = nouveau run. EMR 100 % utilisable Jarvis en panne (`analyseIndisponible` + réessai, zéro appel modèle dans l'onglet résumé — O4).

## 7. États : chargement / vide / erreur

Chargement : `Squelette` borné (`aria-busy`), jamais de squelette perpétuel (bascule ERREUR avec le mot « délai », `DELAI_LECTURE_MS=10 s`). Vide : utile (`Aucun traitement actif + Ajouter un traitement`, `Aucune séance précédente disponible`), jamais de carte décorative. Erreur : `BlocErreur role=alert` + `[Réessayer]` ; erreur d'action ne fait jamais disparaître le travail visible ; texte saisi préservé quand c'est sûr ; jamais d'échec silencieux. Enregistrement : `repos/encours/enregistré ✓/échec — Réessayer` via `IndicateurEnregistrement`.

## 8. Phase 2 — migration dessinée, NON appliquée (exige décision humaine, AGENTS.md §5)

`supabase/migrations/0NN_etat_seance.sql` : table `app.seance_etat(consultation_id FK→consultations, domaine TEXT, valeur_num NUMERIC NULL, valeur_txt TEXT NULL, created_by UUID, created_at TIMESTAMPTZ)` + portes `app.save_etat_seance / app.get_etat_seance` (SECURITY DEFINER OWNER `app_gatekeeper`, `FOR UPDATE` anti-double-clic, `trg_audit`, `GRANT authenticated`, `REVOKE PUBLIC/service_role`) + contrat versionné. Idempotence par `(consultation_id, domaine)` (upsert). Cette spec ne l'applique pas ; le build la rédige en fichier `0NN` non exécuté sans feu vert séparé.

## 9. i18n / RTL / a11y / responsive / perf

- i18n : toute chaîne via `fr.ts` (clés additives sous `consultation.cockpit.*`), verbes `actions.*`, `Non renseigné` jamais tiret, erreurs 3 temps + mot « délai ».
- RTL : `ms-/me-/ps-/pe-`, `start/end`, `dir=auto` sur champs libres, chiffres `font-num tabular-nums`, `.ar leading 1.8` (`tokens.css:610-628`).
- a11y : `focus-visible` global, `min-h-target 36 / lg 44`, roving tabindex onglets, `aria-expanded/controls/selected`, `role=status` vs `alert`, icônes `aria-hidden`, sens jamais couleur seule, `prefers-reduced-motion`.
- Responsive : 1920/1440/1366 cibles (1440×900 prioritaire) ; <1280 rail → tiroir, centre préservé, sticky bar intacte, aucun empilement géant.
- Perf : `ChronoSeance`/`CompteReboursVerrou` isolés (0 re-render parent/s), pas de fetch répété, pas d'attente IA pour le soin, frappe jamais bloquée. Typographie : hiérarchie `display/title/heading/body/notes/label`, valeurs `num/metric`, jamais de micro-labels.

## 10. Sécurité / intégrité

Aucun SQL depuis l'UI, aucune porte contournée, aucune PII vers un modèle sans pseudonymisation, aucun analytics externe recevant du clinique, aucun log de contenu clinique, aucun `NEXT_PUBLIC_*` secret, `.env` jamais au terminal. Aucune valeur fabriquée : scores, tendances, RDV, paiements affichés seulement s'ils existent (preuve : porte citée en §2).

## 11. Tests (préserver puis étendre, jamais affaiblir)

Préserver : `checkpoint-s5.sh` (18+8), `cloison-consultation.spec.ts`, `role-resolution.spec.ts:141-167`, `consultation-sans-notes.spec.ts`, `critical-chain.spec.ts`, `consultation-onglets.spec.ts` O3/O4/O5, `regles-dictee` + `insertion-dictee` + `dictee-chaine`, `apres-seance` + `analyse-session-run`. Étendre : presets→SOAP, badges Δ, marqueur focus, collapse rail, sticky bar, tarif popover, timeline, états Jarvis off. Playwright : ouverture, contexte patient, navigation sans URL, valeurs structurées, chips, focus, presets, notes+dictée, session précédente inline, traitement, tarif, save, reload persistance, clôture, Jarvis on/off, focus clair, clavier, chargements/vides/erreurs, rôles non autorisés, RTL, 3 viewports. Distinguer `PASS / FAIL / NOT RUN`.

## 12. Fichiers

Créer : `cockpit/{CockpitHeader,EtatClinique,FocusSeance,DepuisDerniere,NotesStructurees,RailContexte,BarreConsultation}.tsx` (+ tests unitaires co-localisés), cette spec. Modifier : `consultation/[id]/page.tsx` (rewire seul), `tokens.css` (ajouts), `fr.ts` (clés additives). Ne pas toucher : `STATE.md`, `docs/archive/`, migrations appliquées, registre Jarvis, `.env`, god-files (hors clés), autres domaines.

## 13. Hors périmètre (OUT-OF-SCOPE)

Nettoyage unrelated, réécriture autres modules, suppression de fonctionnalité existante parce que non visible, transcription live, analytics complexes, settings géant de presets, nouveaux rôles, changement de routing (sauf nécessité prouvée), fusion registre Jarvis Phase 5, découpe `fr.ts` Phase 6.
