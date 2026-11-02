# Domaine médicament — Phase 2

Statut : implémenté (migrations `212_medication_phase2_schema`, `213_medication_phase2_gates`).
Périmètre : compléter l'espace traitements avec les faits cliniques qui manquaient,
sans fabriquer de donnée ni ajouter de moteur d'interprétation.

## Principe

Tous les objets de la Phase 2 sont **append-only**. Une correction est un nouvel
événement, jamais une réécriture. Aucune ligne n'est supprimable. Chaque table
porte `cabinet_id`, `patient_id`, `practitioner_id`, `is_synthetic`, et la RLS
clinique existante (`app.can_see_clinical` sur le praticien du dossier).

L'assistante n'a **aucune** policy et aucune porte ne lui rend de ligne, même en
appel SQL direct.

## Les six faits

| Table | Ce qu'elle porte | Ce qu'elle ne dit pas |
|---|---|---|
| `app.patient_allergy_events` | substance, réaction, sévérité, événement `noted/resolved/refuted`, date | ne transforme pas une allergie en contre-indication automatique |
| `app.patient_adverse_events` | symptôme, sévérité, début/résolution, conduite, traitement lié | n'attribue pas l'effet à une molécule |
| `app.patient_measurements` | kind, valeur, unité, date, source, référence basse/haute | n'interprète pas la valeur ; « hors référence » est un simple écart aux bornes saisies |
| `app.treatment_adherence_reports` | période, statut rapporté (`observant/partiel/non_observant/inconnu`), source | ne calcule aucun pourcentage ni score |
| `app.treatment_interaction_reviews` + `interaction_review_treatments` | source consultée, conclusion, traitements revus, date | n'exécute aucun moteur d'interaction ; c'est une attestation humaine |
| `app.prescription_renewal_links` | lien entre deux ordonnances réellement émises | n'autorise pas un renouvellement et ne prolonge aucun traitement |

## Allergies courantes

Le dernier événement par `substance_key` décide. `resolved` et `refuted` ferment
l'allergie ; un nouvel événement `noted` la rouvre. Le calcul est fait dans
`src/components/traitements/modele-phase2.ts` et testé.

## Observance

Aucun pourcentage n'est calculé : la base enregistre un constat daté par période,
avec sa source. « Inconnu » reste une réponse valide.

## Renouvellement

Un renouvellement est un lien documenté entre une nouvelle ordonnance et une
ordonnance antérieure, toutes deux `issued`, pour le même dossier. Le lien est
créé manuellement après l'émission. Il ne crée ni ordonnance ni autorisation.

## Portes

Lectures (`SECURITY DEFINER`, `app_gatekeeper`, `audit.log_read`, cloison
clinique et cabinet) :

- `list_patient_allergies`
- `list_patient_adverse_events`
- `list_patient_measurements`
- `list_patient_adherence`
- `list_patient_interaction_reviews`
- `list_patient_renewal_links`

Écritures (`SECURITY DEFINER`, rôle clinique vérifié, patient/traitement/séance
dans le périmètre, `is_synthetic` pour le cloud-dev) :

- `record_patient_allergy`
- `record_adverse_event`
- `record_measurement`
- `record_adherence`
- `record_interaction_review`
- `link_prescription_renewal`

Aucune porte ne fait d'`UPDATE` ni de `DELETE`.

## Décision de périmètre — 2026-11-02

Aucune source d'interaction validée ne sera intégrée dans cette phase. La revue
reste une attestation humaine, avec sa source ; MindCare ne calcule, ne classe
et ne certifie aucune interaction.

## Limites assumées

- Pas de moteur d'interaction validé : la revue est une attestation avec source.
- Pas de check-in patient ni d'observance mesurée : seulement un rapport clinique.
- Pas d'interprétation biologique : les bornes sont celles saisies.
- Pas de workflow d'autorisation de renouvellement : seulement un lien entre
  ordonnances émises.
