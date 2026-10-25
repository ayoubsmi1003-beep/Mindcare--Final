-- 185_seed_phq9_gad7 — le contenu de deux instruments validés, et seulement eux.
--
-- ⚠️ CE FICHIER N'INVENTE AUCUN ITEM NI AUCUN SEUIL. Les neuf items du PHQ-9
-- et les sept items du GAD-7 sont les versions françaises publiées des
-- instruments ; les bandes sont celles du barème d'origine (0–4 / 5–9 / 10–14
-- / 15–19 / 20–27 pour le PHQ-9 ; 0–4 / 5–9 / 10–14 / 15–21 pour le GAD-7).
-- Les sources sont portées dans `scoring.source` et dans
-- `docs/contracts/scales.md`.
--
-- HDRS et YMRS restent inactifs : ce sont des instruments cotés par le
-- clinicien, avec des items et des pondérations différents (0–2 / 0–4) qui ne
-- peuvent pas être semés sans une revue clinique dédiée. Le moteur les
-- acceptera le jour où leur contenu sera validé.

BEGIN;

UPDATE app.scales
   SET items = $json$
[
  {"id":"q1","texte":"Peu d’intérêt ou de plaisir à faire les choses","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié du temps"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q2","texte":"Être triste, déprimé(e) ou désespéré(e)","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié du temps"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q3","texte":"Difficultés à s’endormir ou à rester endormi(e), ou dormir trop","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié du temps"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q4","texte":"Se sentir fatigué(e) ou manquer d’énergie","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié du temps"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q5","texte":"Avoir peu d’appétit ou manger trop","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié du temps"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q6","texte":"Avoir une mauvaise opinion de soi-même, ou avoir le sentiment d’être nul(le), ou d’avoir déçu sa famille ou s’être déçu(e) soi-même","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié du temps"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q7","texte":"Avoir du mal à se concentrer, par exemple, pour lire le journal ou regarder la télévision","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié du temps"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q8","texte":"Bouger ou parler si lentement que les autres auraient pu le remarquer. Ou au contraire, être si agité(e) que vous avez eu du mal à tenir en place par rapport à d’habitude","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié du temps"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q9","texte":"Penser qu’il vaudrait mieux mourir ou envisager de vous faire du mal d’une manière ou d’une autre","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié du temps"},{"valeur":3,"libelle":"Presque tous les jours"}],
   "risque":true,"alerte":"Réponse positive à l’item 9 (idées de mort ou d’auto-agression) — à explorer cliniquement sans délai."}
]
$json$::jsonb,
       scoring = $json$
{
  "methode":"somme",
  "consigne":"Au cours des 2 dernières semaines, selon quelle fréquence avez-vous été gêné(e) par les problèmes suivants ?",
  "min":0,
  "max":27,
  "bandes":[
    {"min":0,"max":4,"interpretation":"minimal"},
    {"min":5,"max":9,"interpretation":"léger"},
    {"min":10,"max":14,"interpretation":"modéré"},
    {"min":15,"max":19,"interpretation":"modérément sévère"},
    {"min":20,"max":27,"interpretation":"sévère"}
  ],
  "source":"PHQ-9, Kroenke, Spitzer & Williams (2001). Version française : Prevention Depression Luxembourg, PHQ9_French_for_France.pdf. Aucune permission requise pour reproduire, traduire ou distribuer (Pfizer).",
  "note":"Le score est une aide à l’évaluation clinique ; il ne pose pas de diagnostic et ne remplace pas l’entretien."
}
$json$::jsonb,
       is_active = true
 WHERE code = 'PHQ9';

UPDATE app.scales
   SET items = $json$
[
  {"id":"q1","texte":"Sentiment de nervosité, d’anxiété ou de tension","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié des jours"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q2","texte":"Incapable d’arrêter de vous inquiéter ou de contrôler vos inquiétudes","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié des jours"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q3","texte":"Inquiétudes excessives à propos de tout et de rien","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié des jours"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q4","texte":"Difficulté à se détendre","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié des jours"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q5","texte":"Agitation telle qu’il est difficile de rester tranquille","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié des jours"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q6","texte":"Devenir facilement contrarié(e) ou irritable","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié des jours"},{"valeur":3,"libelle":"Presque tous les jours"}]},
  {"id":"q7","texte":"Avoir peur que quelque chose d’épouvantable puisse arriver","options":[
    {"valeur":0,"libelle":"Jamais"},{"valeur":1,"libelle":"Plusieurs jours"},
    {"valeur":2,"libelle":"Plus de la moitié des jours"},{"valeur":3,"libelle":"Presque tous les jours"}]}
]
$json$::jsonb,
       scoring = $json$
{
  "methode":"somme",
  "consigne":"Au cours des 14 derniers jours, à quelle fréquence avez-vous été dérangé(e) par les problèmes suivants ?",
  "min":0,
  "max":21,
  "bandes":[
    {"min":0,"max":4,"interpretation":"minimal"},
    {"min":5,"max":9,"interpretation":"léger"},
    {"min":10,"max":14,"interpretation":"modéré"},
    {"min":15,"max":21,"interpretation":"sévère"}
  ],
  "source":"GAD-7, Spitzer, Kroenke, Williams & Löwe (2006). Version française : Université de Montréal, GAD-7-français.pdf. Aucune permission requise pour reproduire, traduire ou distribuer.",
  "note":"Le score est une aide à l’évaluation clinique ; il ne pose pas de diagnostic et ne remplace pas l’entretien."
}
$json$::jsonb,
       is_active = true
 WHERE code = 'GAD7';

-- Explicite : les deux instruments cotés par le clinicien ne sont pas activés
-- par cette migration. Leur contenu reste vide jusqu'à validation.
UPDATE app.scales
   SET is_active = false
 WHERE code IN ('HDRS','YMRS');

INSERT INTO app.schema_migrations(version)
VALUES ('185_seed_phq9_gad7')
ON CONFLICT DO NOTHING;

COMMIT;
