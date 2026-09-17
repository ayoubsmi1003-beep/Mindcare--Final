# M10 — Gap audit + verrous (Task 0, 2026-09-17)

> Polish de l'existant, composition seule. Références `fichier:ligne` vérifiées
> par lecture/grep le 2026-09-17. Aucune porte nouvelle, aucun changement Jarvis.

## S1 — Tarif tri-state : VIOLATION TROUVÉE ET CORRIGÉE

- `src/components/BlocTarif.tsx:72` rend `undefined` pendant le chargement **et**
  en échec de lecture (ne prétend pas savoir) ; `src/app/consultation/[id]/page.tsx:369`
  documente `undefined` = on ne sait pas encore.
- Violation : `page.tsx:1761` (avant fix) `peutClore={!seanceClose && tarifPresent !== false}`
  autorisait `Terminer` sur `undefined` — une clôture proposée que `037` peut refuser,
  contre l'objet déclaré du flag (`:363-368`).
- Fix : `peutClore={!seanceClose && tarifPresent === true}` + commentaire tri-state
  (`:1739-1748`), commentaire `BlocTarif.tsx:69-73` réaligné.
- Règle verrouillée : `undefined` → badge masqué (`BarreConsultation.tsx:84`) +
  `Terminer` absent, jamais « sans tarif » ; seul `false` bloque (`:1744`) avec
  `PanneauInfo clotureSansTarif` ; seul `true` autorise.
- K1 insensible au changement : ses assertions attendent les états résolus
  (`Tarif à fixer` / `Tarif fixé`, `tests/e2e/consultation-cockpit.spec.ts:140-150`).

## S2 — Matrice d'états comportementale (composants/services existants)

| Section | Chargement (voit / geste) | Vide (voit / geste) | Erreur (voit / geste) | Hors-ligne | Texte long | Sans-IA | Ne doit JAMAIS |
|---|---|---|---|---|---|---|---|
| Colonne patient (`page.tsx:1188-1211`) | `Squelette` + `[Charger le contexte patient]` (`:1194-1200`) | sections sans contenu absentes (`ColonnePatient.tsx:61-116`) | `BlocErreur` + `Réessayer` (`:1189-1193`) | `BandeauHorsLigne` en tête (`:1640`) | nom `truncate`, notes `break-words` | N/A (zéro modèle) | photo ; inventer état civil |
| État clinique (`EtatClinique.tsx`, monté si dossier `:1214-1223`) | squelette parent | `EtatVide etatVide` (`:75-90`) | `BlocErreur` parent | bandeau + `IndicateurEnregistrement` échec | nom d'échelle `truncate`, valeur `tabular-nums` | N/A | juger polarité (hausse ≠ amélioration) ; couleur seule (badge flèche + mot) |
| DepuisDerniere / onglet Résumé (`DepuisDerniere.tsx`, `page.tsx:1796-1833`) | squelette dossier parent | phrases honnêtes (`SectionsDeterministes.tsx:5`, `signaux.vide :117`) | `BlocErreur` dossier + `Réessayer` | bandeau ; contenu déjà lu reste lisible | phrases factuelles, pas de troncature silencieuse | **zéro `/api/jarvis/` (O4)** — vrai passerelle tombée (I20) | bandeau synthétique ↑/↓ ; appeler un modèle |
| Rail contexte (`RailContexte.tsx:175-241`) | `Squelette` + `[Charger]` (`:182-190`) | sections vides absentes ; `sansPrecedente/sansProchain/traitementVide` en phrase | `BlocErreur` + `Réessayer` (`:177-181`) | bandeau + réessai explicite | dates courtes, doses `truncate` aperçu | slot Jarvis secondaire, `analyseIndisponible` + réessai | charger au montage (O5) ; carte Prochain-RDV redondante |
| Historique inline (`PanneauHistorique.tsx`) | `Squelette` (`:150`) | `historiqueVide` (`:152-154`) ; sans dossier `historiqueSansDossier` (`:142-144`) | `BlocErreur` + `Réessayer` (`:146-148`) | bandeau page ; réessai | SOAP relu tel quel, lecture seule | N/A (portes DB seules) | recopier un fragment vers la séance en cours ; `JSON.stringify(detail)` |
| Notes SOAP (`NotesStructurees` + page `:1283-1392`) | minuteurs autosave 2s, `IndicateurEnregistrement` | `notesPlaceholder` ; favoris `localStorage` parse gardé | `PanneauInfo nonEnregistre` + flush `Enregistrer` | `echec` + `Réessayer`, saisie préservée | `resize-y`, curseur replacé (`replacerCurseur`) | N/A | migrer brut→SOAP auto ; classer/dictée reformulée par modèle |
| Barre (`BarreConsultation.tsx`, `page.tsx:1750-1772`) | tarif `undefined` → badge + `Terminer` absents (S1) | puces `○` honnêtes | refus base → `signalerErreur` + relecture (`:594-599`), travail conservé | `BandeauHorsLigne`, flush explicite | montants jamais ici (vivent dans `BlocTarif`) | N/A | second chemin de clôture ; montant affiché hors `BlocTarif` |

## S3 — Single visual owner (pas de vérité clinique dupliquée)

| Donnée | Lieu canonique | Seconde apparition | Justification (contextuelle + utile) ou action |
|---|---|---|---|
| Prochain RDV | `ColonnePatient` (date + heure + type) | `MiniChronologie` (nœud date courte) | contextuelle : ancre d'orientation précédent/aujourd'hui/prochain, pas un doublon de détail |
| Échelles | `EtatClinique` (tuiles + valeurs + `Inscrire`) | `CourbeEchelles` (courbe de tendance) | contextuelle : valeur actuelle vs preuve longitudinale, même source `echelles`, deux lectures différentes |
| Séances précédentes | `PanneauHistorique` rail (aperçu inline, URL inchangée) | onglet `historique` (même composant, 12 items) | même composant, jamais visibles simultanément (séance `hidden`, `page.tsx:1720`) ; aucune divergence possible |
| Depuis-dernière-fois | `DepuisDerniere` (carte centrale, dossier chargé) | onglet `Résumé` (mêmes 3 composants) | même règle de calcul partagée, jamais visibles simultanément ; O4 couvre les deux |
| Traitement | `AppercuTraitement` rail (1er actif + `+N`) | onglet `traitement` (`PanneauTraitements` complet) | aperçu vs gestion ; tiroir `Modifier` = le même composant, zéro logique dupliquée |
| Diagnostics | `ColonnePatient` (pastilles + Principal) | nulle part ailleurs (`EtatClinique` : échelles seules) | aucune duplication |
| SOAP / brut | éditeurs centraux | nulle part ailleurs (historique en lecture seule) | aucune recopie |
| Documents | onglet `documents` (`SectionDocumentsPatient`) | non repris dans le cockpit | aucune duplication |
| Tarif | `BlocTarif` (montant + saisie) | barre : présence seule (`tarifFixe/tarifManquant`) | présence vs valeur, jamais le montant hors `BlocTarif` |

## Assertions (preuves grep/lecture 2026-09-17)

- [x] aucune porte API/DB nouvelle : `cockpit/*` ne contient aucun `rpc(`/porte/service
  (grep `rpc\(|getPatientWorkspace|listPatientTimeline|saveNote|saveRawNotes` → 2 hits =
  commentaires `FocusSeance.tsx:12`, `EtatClinique.tsx:62`) ; diff M10 = `page.tsx` +
  `BlocTarif.tsx` (commentaires + 1 condition) + cet artefact.
- [x] aucun `/api/jarvis/*` dans Résumé : refs Jarvis de `page.tsx` = `import :119`,
  relecture analyse `:518/:857`, `analyzeSession` sur clic `:928` (section assistance du
  rail, pas l'onglet Résumé `:1796-1833` = `PointDeSituation/SectionDepuisDerniere/
  ListeSignaux/CarteIdentite`) ; O4 (`consultation-onglets.spec.ts:119-139`) reste l'autorité.
- [x] aucun fetch dossier eager : 2 seuls sites `getPatientWorkspace` (`page.tsx:1019`
  effet `ongletContexte`, `:1087` geste `chargerContexte`), tous deux gardés par
  `dossier !== undefined` (`:1017/:1085`) ; jamais au montage (O5 `:142-190`).
- [x] aucun second chemin d'écriture : cockpit écrit via callbacks page
  (`onInserer/onChanger/onAppliquer` → `enregistrerSoap`/`saveNote`, autosave 2s +
  `viderLesAttentes`) ; `modele-cockpit.ts` pur, zéro I/O.
- [x] aucune duplication de convenance : table S3 ci-dessus, chaque doublon apparent
  justifié ou inexistant.
- [x] O3/O4/O5 autoritaires : O3 séance `hidden` (`:1720`, `consultation-onglets.spec.ts:192`) ;
  O4 zéro-jarvis (`:119`) ; O5 budget ouverture (`:142`, `06-PERF-BUDGET.md:46`
  Consultation 2 appels / 100 ms / 500 ms).

## Vérification (exécutée 2026-09-17, session build M10)

- Relecture ciblée : FAIT (S1 trouvé par lecture, corrigé).
- `pnpm typecheck` (2 passes) : PASS ×2 (avant et après correctif test), 0 erreur.
- `eslint` scope (`page.tsx`, `BlocTarif.tsx`, `BarreConsultation.tsx`,
  `critical-chain.spec.ts`) : PASS.
- `vitest` cockpit (`modele-cockpit` 8 + `cockpit-cles` 4) : 12/12 PASS.
- Garde tri-state : seul `!== false` restant = `page.tsx:1747` (panneau rappel,
  correct : affiché sur `false` seul) ; `Terminer` sur `=== true` seul (`:1764`).
- Env : base locale `mc-p3` verte (`verifier-base`, 97 migrations, `mindcare_app` OK) ;
  `pnpm build` OK (consultation 14,3 kB / 240 kB) ; Playwright 1.62.1, `workers:1`,
  suites séquentielles, rien en parallèle (contention).
- E2E (exécuté, par spec isolée sauf mention) :
  - `consultation-onglets` O1-O5 : 5/5 PASS (O4 zéro `/api/jarvis/`, O5 lazy, O3 hidden).
  - `consultation-cockpit` : 1re passe 0/3 (sign-in 503 transient, base restée saine ;
    rate-limit exclu par lecture `limite-debit.ts:33-34,81-83` + process frais) ;
    rejoués un par un : K2 PASS, K1 PASS (tri-state de bout en bout : `Terminer` 0 →
    `Tarif fixé` → 1 → `Séance terminée`), K3 PASS (captures 1920/1440/1366 + rail
    replié, `checkpoints/cockpit-2026-09-11/`).
  - `alexa-lanceur` L1-L5 : 5/5 PASS (L4 orb sur consultation).
  - `aucun-controle-hors-cadre` : 7/8, consultation tous-onglets PASS ; ÉCHEC
    « montant tronqué Finances −106 500 DZD » — écran Finances non touché par M10
    (valeur d'agrégat, dépend des données) → OUT-OF-SCOPE, non corrigé (règle 10).
  - `cloison-consultation` : S2-S4/S6/S7 PASS ; S1/S8 NOT RUN (skip by design :
    dossier `b1` absent de cette base, `cloison-consultation.spec.ts:66`) ; portes
    M10 inchangées, contrat 081 intact.
  - `consultation-sans-notes` : FAIL initial (`start_consultation` refusé — résidu
    K3 laissé ouvert, `one_open_consult`), puis PASS après clôture du résidu PAR
    LES PORTES (`set_consultation_price 0` + `close_consultation`, base dev
    synthétique-only, sondes TEMP supprimées). Fragilité d'ordre pré-existante.
  - `critical-chain` : FAIL initial (sélecteur `textbox "Subjectif"` ambigu depuis
    l'ajout cockpit « Mes formules — Subjectif », `NotesStructurees.tsx:237`) ;
    corrigé côté TEST (`exact: true` ×4, intention inchangée, produit intact),
    puis PASS (chaîne complète, `typecheck`+`lint` après correctif PASS).
- Captures : produites par K3. **STOP humain obligatoire (S5)** — M10 non DONE sans
  relecture/approbation praticienne (hiérarchie, densité, alignement, typo,
  whitespace, overflow, qualité d'états, duplication).
- Nettoyage final (2026-09-17) : `critical-chain` laisse sa séance ouverte par
  construction (clôture douce, `critical-chain.spec.ts:183-191`) — résidu
  `9ea14fd4` clos par les portes (`set_consultation_price 0` + `close_consultation`,
  recontrôle `get_open_consultation` nul), sondes TEMP supprimées. Base sans
  séance ouverte pour …a1 ; diff toujours limité aux 4 fichiers M10.

## Passe redesign 6/10 → critique 22/40 → P1+P2 (2026-09-17, approuvée)

- Audit dual-agent : A revue design + B `detect.mjs` exit 0 (0 findings).
  Snapshot : `.impeccable/critique/2026-09-17T12-53-38Z__src-app-consultation-id-page-tsx.md`.
- Livré (présentation/logique clinique/portes intacts) :
  - P1-1 distill : CTA unique (colonne), rail à vide = message `railAttente`
    (clé `fr` additive), squelette+CTA dupliqués supprimés (`RailContexte.tsx`) ;
    K1 verrouille `toHaveCount(1)`.
  - P1-2 clarify : `Enregistrer` rang discret, `Signer` seul principal
    (`BarreConsultation.tsx`).
  - P1-3 bolder : `enfonce` = `border-action-600 bg-action-100 font-semibold`
    (`Bouton.tsx`, jetons seuls, sans décalage ni glyphe).
  - P2-4 layout : rail réordonné (dernière séance → traitement → courbe → Jarvis) ;
    repli de la courbe REFUSÉ (cartes imbriquées interdites — priorité par ordre).
  - P2-5 chevauchements : bumper `h-16` anti-orbe en fin de rail ;
    `CockpitHeader` réduit à une ligne calme (même props, coquille inchangée).
- Vérifié : `typecheck` PASS · `eslint` scope PASS · `vitest` 12/12 ·
  `consultation-cockpit` K1-K3 3/3 (captures fraîches) · `consultation-onglets`
  O1-O5 5/5 · `alexa-lanceur` L1-L5 5/5 · hors-cadre consultation PASS ; seul rouge
  = montant Finances (inchangé, OUT-OF-SCOPE).
- Résidu K3 (`11e34bee`) clos par portes (1re sonde : timeout RPC transient ;
  rejouée verte), recontrôle nul, TEMP supprimées. Base propre.
- Captures `checkpoints/cockpit-2026-09-11/` (frais-1920 vérifiée à la lecture :
  CTA unique, message d'attente rail, en-tête une ligne, `Enregistrer` discret,
  orbe dégagé). **STOP S5** : approbation humaine requise avant DONE.
- Diff M10 : `page.tsx` (1 condition + 1 commentaire), `BlocTarif.tsx`
  (1 commentaire), `critical-chain.spec.ts` (4 sélecteurs `exact` + note),
  `artifacts/m10-gap.md` (NEW). Rien d'autre. Aucun commit (non demandé).
