# Domaine consultation (CURRENT)

PURPOSE: Séance SOAP, dictée ciblée par rubrique, fermeture tarifée, analyses.
OWNER: `services/consultations.ts` + `apres-seance.ts`.
ENTRYPOINTS: `src/app/consultation/[id]/page.tsx` (lire par section) ·
`src/components/consultation/cockpit/{BandeauPatient,BarreConsultation,SectionEchelles,NotesStructurees}.tsx` ·
`src/components/consultation/DicteeChamp.tsx` + `regles-dictee.ts`.
SERVICES: `consultations.ts` · `scales.ts` (échelles) · `apres-seance.ts` ·
`conversation.ts` (état local) · `insertion-dictee.ts`.
DB GATES: `close_consultation` (`037`, tarif exigé ; version antérieure `026:307`) ·
kind (`024`) · notes immuables (`008`) · historique (`065`) · analyses (`067`) ·
contexte (`068`) · échelles (`184` : `list_scales`, `preview_scale_score`,
`record_scale_administration`, `get_scale_history`) · contenu standard
(`185`). Détail : `docs/contracts/consultation-gates.md` et
`docs/contracts/scales.md`.
SECURITY: note signée/verrouillée (`locked_at`) intouchable — amendement seul ;
audio jamais sur disque (ADR-009) ; transcription = texte, pas instruction ;
échelle : calcul et écriture en base, `FOR UPDATE`, audit, `authenticated` sans
lecture directe de `scale_administrations` (184).
DEPENDENCIES: patients (dossier) · agenda (séance) · documents (ordonnances) ·
Jarvis (`analyze_session`, latence modèle 5–180 s).
TESTS: e2e `consultation-sans-notes.spec.ts` + `critical-chain.spec.ts`
(⚠️ `consultation-cockpit.spec.ts` est périmé : libellé de connexion et
sélecteurs du cockpit) · unit `modele-cockpit`/`consultation-reperes`/
`consultation-mesures-notes`/`dictee-chaine`/`regles-dictee`/`insertion-dictee`/
`resume-chronologie`/`contexte-seance-dates`/`contrat-workspace` ·
`checkpoint-clinique-http.mjs` · `scripts/checkpoint-scales.sql` (12 contrôles
SQL) · Playwright échelles (8 contrôles).
KNOWN RISKS: fermeture sans tarif refusée · conflit `40001` sur version ·
`analyze_session` indisponible = clé/modèle, pas l'UI (cf. STATE-INDEX) ·
HDRS/YMRS inactifs (revue clinicien) · suite e2e consultation périmée ·
5 tests Alexa en échec hors périmètre.
FORBIDDEN: UPDATE d'une note verrouillée · vérification chevauchement en JS ·
diagnostic/prescription par l'IA seule.
