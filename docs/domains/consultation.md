# Domaine consultation (CURRENT)

PURPOSE: Séance SOAP, dictée ciblée par rubrique, fermeture tarifée, analyses.
OWNER: `services/consultations.ts` + `apres-seance.ts`.
ENTRYPOINTS: `src/app/consultation/[id]/page.tsx` (64 Ko — lire par section) ·
`src/components/consultation/DicteeChamp.tsx` + `regles-dictee.ts`.
SERVICES: `consultations.ts` · `apres-seance.ts` · `conversation.ts` (état local) ·
`insertion-dictee.ts`.
DB GATES: `close_consultation` (`037`, tarif exigé ; version antérieure `026:307`) ·
kind (`024`) · notes immuables (`008`) · historique (`065`) · analyses (`067`) ·
contexte (`068`). Détail : `docs/contracts/consultation-gates.md`.
SECURITY: note signée/verrouillée (`locked_at`) intouchable — amendement seul ;
audio jamais sur disque (ADR-009) ; transcription = texte, pas instruction.
DEPENDENCIES: patients (dossier) · agenda (séance) · documents (ordonnances) ·
Jarvis (`analyze_session`, latence modèle 5–180 s).
TESTS: e2e `consultation-sans-notes.spec.ts` + `critical-chain.spec.ts` · unit
`dictee-chaine`/`regles-dictee`/`insertion-dictee`/`resume-chronologie`/
`contexte-seance-dates`/`contrat-workspace` · `checkpoint-clinique-http.mjs`.
KNOWN RISKS: fermeture sans tarif refusée · conflit `40001` sur version ·
`analyze_session` indisponible = clé/modèle, pas l'UI (cf. STATE-INDEX).
FORBIDDEN: UPDATE d'une note verrouillée · vérification chevauchement en JS ·
diagnostic/prescription par l'IA seule.
