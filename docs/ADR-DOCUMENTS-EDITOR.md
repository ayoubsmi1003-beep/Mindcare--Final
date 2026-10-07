# Décision Documents éditables — 7 octobre 2026

Conception et plan approuvés par la praticienne dans la session.
Source JSON contrôlée, brouillons et révisions append-only, snapshot émis immutable, RLS/portes/audit/numérotation SQL conservés. Les additions de schéma du plan sont explicitement autorisées ; les migrations précédentes restent intactes.
Migrations distinctes : 128 type, 129 brouillons, 130 rendu/émission, 131 identité contrôlée, 132 ordonnance. Validation préalable sur base isolée schema-only sans copie de données patient.
Les dates civiles DATE restent des chaînes YYYY-MM-DD ; aucun fuseau n'est appliqué. Ordonnance utilise prescriptions/prescription_lines et le catalogue existant ; elle n'active pas automatiquement un traitement.
Voir docs/superpowers/specs/2026-10-07-documents-editor-design.md et le plan correspondant.
