# Phase 7 — runtime Windows, sauvegarde, hors-ligne

## Verdicts

| # | Propriété | Moyen | Verdict |
|---|---|---|---|
| 1 | Migration 072 et ses 3 assertions | psql | ✅ |
| 2 | Garde de démarrage : base joignable + schéma à jour | serveur réel | ✅ |
| 3 | **La garde MORD** : migration non appliquée → refus nommé | sonde | ✅ |
| 4 | Sur schéma partiel, `/api/db/*` répond 503 | HTTP | ✅ |
| 5 | `pg_dump` → 516 Kio | pg_dump 18 | ✅ |
| 6 | Chiffrement AES-256-GCM, clair effacé | node:crypto | ✅ |
| 7 | **Phrase de passe fausse → REFUS** (étiquette GCM) | sonde | ✅ |
| 8 | **Restauration RÉELLEMENT REJOUÉE** dans une base jetable | pg_restore | ✅ |
| 9 | 8 tables comptées identiques source ↔ restauration | psql | ✅ |
| 10 | Installateur : syntaxe PowerShell valide | Tokenize | ✅ |
| 11 | **L'installateur REFUSE une écoute non locale** | sonde | ✅ |
| 12 | Chaîne clinique complète, hors-ligne | HTTP | ✅ 15/15 |
| 13 | L'IA se dégrade en NOMMANT sa panne | HTTP | ✅ |
| 14 | 106 tests · typecheck · lint · build · preflight | outillage | ✅ |
| 15 | Frontière · Jarvis · Clinique · Écrans | 4 checkpoints | ✅ 24+22+15+31 |

## La sauvegarde est prouvée par sa RESTAURATION

« Un fichier créé ne prouve pas une sauvegarde. » `scripts/sauvegarde.mjs` ne
s'arrête donc pas au fichier : il le déchiffre, le restaure dans une base
jetable, compte huit tables et compare. Mesuré sur l'état final :

```
app.patients 15=15 · app.appointments 5=5 · app.consultations 3=3
app.clinical_notes 4=4 · app.payments 3=3 · app.documents 0=0
app.profiles 5=5 · audit.log 88=88
VERDICT : VERT — sauvegarde chiffrée ET restaurée, 8 tables identiques.
```

GCM plutôt que CBC parce qu'il AUTHENTIFIE : une phrase de passe fausse est
refusée au déchiffrement, ce qui est vérifié à chaque exécution. Sans phrase de
passe, le script refuse de sauvegarder plutôt que d'écrire en clair.

⚠️ Sans `MINDCARE_RESTORE_TEST_DB`, le script sort en **code 2** et affiche
« la sauvegarde n'a PAS été relue — VERDICT : INCOMPLET ». Il ne peut pas rendre
un vert sans avoir restauré.

## La garde de démarrage, éprouvée dans les deux sens

Un schéma partiellement migré est le pire état pour un dossier médical :
l'application s'affiche, une porte sur trois manque, et la praticienne ne le
découvre qu'à l'usage. Mesuré avec une migration déposée sur le disque et jamais
appliquée :

```
probleme : schema-partiel
1 migration(s) presente(s) sur le disque mais jamais appliquee(s).
    · 099_sonde_non_appliquee
frontiere /api/db/rpc → 503
```

**Choix assumé : le processus ne se tue pas.** Un `exit` transformerait une base
momentanément injoignable (service Windows qui démarre encore) en application
qui ne revient jamais. Ce qui protège les données est que `preparer()` refuse
CHAQUE requête tant que la vérification n'est pas verte : l'application peut se
lancer, elle ne peut pas SERVIR.

## Le défaut trouvé — la garde accusait le mauvais organe

Au premier essai, la garde rendait « base injoignable » sur une base
parfaitement saine. Cause : elle lit `app.schema_migrations` sous `anon`
(il n'y a pas d'identité au démarrage), or `001` n'accorde cette table qu'à
`authenticated`. Le « permission denied » était rapporté comme une panne de
connexion — un diagnostic qui envoie chercher très loin.

Migration **072** ouvre la lecture de ce journal de version à `anon`, avec trois
assertions bornant l'élargissement : pas d'écriture, et aucun accès clinique.
La table ne contient que des noms de fichiers et des dates.

## L'installateur refuse plutôt que de réparer

`scripts/installer-windows.ps1` provisionne base, socle, migrations, rôle
applicatif et mot de passe **engendré sur la machine** (32 octets du générateur
Windows), écrit dans `%ProgramData%\MindCare\mindcare.env` avec ACL restreinte.

Il **refuse** si `listen_addresses` n'est pas local. Vérifié : appliqué à
l'instance d'épreuve (`listen_addresses = *`), il rend `REFUS`. Il ne réécrit ni
`postgresql.conf` ni `pg_hba.conf` — réécrire la configuration d'un service
qu'on n'a pas installé casse silencieusement autre chose.

⚠️ **Ce refus vaut pour ce poste.** L'instance PostgreSQL 18 native de cette
machine écoute sur `0.0.0.0:5432`. En l'état, l'installateur la refuserait — à
juste titre.

## Hors-ligne : ce qui est prouvé, et ce qui ne l'est pas

Le serveur a été lancé **sans aucune clé de fournisseur** (`env -u
OPENROUTER_API_KEY -u GROQ_API_KEY -u ELEVENLABS_API_KEY -u SEEKAI_API_KEY`).
La journée complète est verte : ouvrir un dossier → le retrouver par la porte
auditée → poser un rendez-vous → tenir la séance → écrire les 4 rubriques SOAP →
relire → tarifer → clore → encaisser → recette du jour → tableau de bord.

L'IA refuse en nommant sa cause (`configuration`), et jamais « le service de
données est indisponible ».

⚠️ **La carte réseau n'a PAS été désactivée.** C'est une modification du poste
qui aurait coupé la machine, et je ne l'ai pas faite de ma propre initiative.
Ce qui est prouvé est plus étroit mais réel : la chaîne clinique n'a besoin
d'aucune clé de fournisseur, la seule sortie possible est
`src/server/egress/external-call.ts` (règle ESLint éprouvée par sonde), et le
navigateur ne détient plus aucun identifiant. **L'épreuve carte coupée reste à
faire par une personne devant le poste.**

## Trois défauts de MES contrôles, corrigés

Le checkpoint clinique a d'abord rendu 7 rouges. Aucun n'était un défaut du
code :

1. `p_practitioner_id: null` — `022` RAISE « Rendez-vous incomplet ». La porte
   avait raison, et la frontière a correctement traduit la règle en 422 ;
2. `get_sessions_payments_list` prend une PÉRIODE (`p_period_start`,
   `p_period_end`), pas un jour ;
3. la même porte rend un COMPOSITE `{ total, lignes, … }` : mon contrôle comptait
   la ligne enveloppante et annonçait « 1 ligne » sur une liste **vide**. Un
   contrôle qui compte la mauvaise chose est pire qu'un contrôle absent, parce
   qu'il rassure.

## Non prouvé — ce qui exige le poste et une décision

* **Service Windows.** Aucun service n'a été installé ni reconfiguré. Je n'ai
  pas le mot de passe du superutilisateur de l'instance native, et modifier un
  service que je n'ai pas installé engage toute la machine.
* **Carte réseau coupée** — voir ci-dessus.
* **Sauvegarde PLANIFIÉE.** Le script est éprouvé ; sa planification (tâche
  Windows) n'est pas posée.
* **Impression.** Aucun document émis : le jeu doré n'installe pas les gabarits
  de rendu. `issue_document`, `mark_document_printed` et `verify_document_hash`
  restent non exercés.
* **Micro, dictée, voix, mot de réveil** — matériel absent, comme déjà noté dans
  STATE.md avant cette migration.
* **Rôle `assistant`** non éprouvé de bout en bout.
