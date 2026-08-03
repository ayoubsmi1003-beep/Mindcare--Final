# WORKING-CONTEXT — MindCare OS · Phase 1

Cabinet Dr. Larbi N., Alger · Loi 18-07 · **vrais patients, vraies données médicales**.
Ton seul contexte, avec ton périmètre. Hors périmètre = travail jeté. Tu ne lis aucun autre
document sauf si ton brief nomme un fichier **et** une section.

## 0 · AUTORITÉ
`00-DECISIONS` > `01-SCHEMA` > `02-SECURITY` > `03`/`04`/`05`/`06` > `MindCare-Domain-*` >
`Constitution` > `Features.md` > HTML. « ADR-nnn » = registre de `00-DECISIONS` (§8).
**Le HTML fourni n'est pas la maquette de ce système. N'en tire jamais une valeur.**

## 1 · INVARIANTS
- **I1** Aucun secret dans le code ou le dépôt. `ANON_KEY` seule atteint le navigateur.
- **I2** RLS `ENABLE` **et** `FORCE` sur toute table portant de la donnée patient.
- **I3** Aucun composant n'appelle Supabase. Tout passe par `src/services/*`. Un import de
  `@supabase/supabase-js` ailleurs est un rejet.
- **I4** Lecture **et** écriture de dossier patient → audit (acteur, quand, quoi, avant/après),
  table en ajout seul.
- **I5** Zéro donnée patient dans un log, une erreur, une notification, une charge sortante.
- **I6** Toute écriture déclenchée par la voix ou l'IA passe par `<ConfirmationGate>`.
- **I7** L'IA ne diagnostique pas, ne prescrit pas, n'émet aucun document. Elle décrit, elle ne
  conclut jamais — formulations imposées : `03-JARVIS-TOOLS.md` §9.2.
- **I8** Interface intégralement en français. `timestamptz` partout, jamais `timestamp`.
- **I9** TS strict. Pas de `any`, `as any`, `@ts-ignore`, `@ts-expect-error`.
- **I10** Aucune couleur, espacement, rayon, durée ou taille en dur. Tokens uniquement.
- **I11** Chaque composant gère 5 états : **chargement · vide · erreur · hors-ligne · texte
  long ou absent**.
- **I12** Le tableau de bord assistante est une **composition séparée**, jamais des champs masqués.
- **I13** Une seule sortie réseau : `supabase/functions/_shared/external-call.ts`.
- **I14** L'audio n'est jamais écrit sur disque. RAM → Groq → texte → libéré.
- **I15** Note signée = immuable. Brouillon 15 min, puis verrou par déclencheur. Correction =
  amendement visible. Aucun bypass, aucun override admin, jamais.
- **I16** `jarvis_actions.state='executed'` sans `confirmed_at` = violation de contrainte.
- **I17** Numérotation sans trou par table compteur. **Jamais** de `SEQUENCE`.
- **I18** Aucune question d'accueil ou d'aftercare ne suggère un effet secondaire.
- **I19** Aucune donnée fictive dans une fonctionnalité livrée. Un état vide est honnête.
- **I20** Tout se dégrade : API coupée → consultation, note, agenda, documents utilisables.

## 2 · NE JAMAIS CONSTRUIRE
`execute_sql` · `delete_clinical_note` · `sign_clinical_note` · `send_message_to_patient` ·
`export_patient_data` · `modify_permissions` · `create_user` · `read_file` · `write_file` ·
`run_command`.

## 3 · TOKENS
```css
--ink-900:#0B1614; --ink-700:#23342F; --ink-500:#566B65; --ink-300:#8FA39D; --ink-100:#D3DEDA;
--paper:#FBFCFB; --card:#FFFFFF; --sunken:#F2F5F4; --rule:#E4EAE8;
--teal-900:#0D3833; --teal-700:#14544D; --teal-600:#1B6B63; /* PRIMAIRE */
--teal-400:#4E958D; --teal-100:#DCEBE9; --teal-050:#F0F7F6;
--attention:#B8763A; --attention-bg:#FBF2E9;
--critical:#A33A32;  --critical-bg:#FBEDEC;
--positive:#3E7A5E;  --positive-bg:#EDF5F1;
--night-bg:#0A1413; --night-card:#132321; --night-rule:#22403C; --night-ink:#DCE8E5;
--s-1:4px; --s-2:8px; --s-3:12px; --s-4:16px; --s-5:20px;
--s-6:24px; --s-8:32px; --s-10:40px; --s-12:48px; --s-16:64px;
--r-sm:6px; --r-md:10px; --r-lg:14px; --r-xl:20px; --r-full:999px;
--font-ui:'Geist Sans', system-ui, sans-serif;
--font-doc:'Newsreader', Georgia, serif;   /* documents SEULEMENT */
--font-ar:'IBM Plex Sans Arabic', 'Noto Sans Arabic', sans-serif;
--font-num:'Geist Mono', ui-monospace, monospace;
--e-out:cubic-bezier(.16,1,.3,1); --e-in:cubic-bezier(.4,0,1,1);
--e-soft:cubic-bezier(.4,0,.2,1); --e-spring:cubic-bezier(.34,1.56,.64,1); /* orbe Jarvis SEUL */
--d-instant:90ms; --d-quick:160ms; --d-normal:240ms; --d-slow:380ms; --d-scene:600ms;
```
Ombres (`--lift-0/1/2/3`) et verre (`--glass-*`) : valeurs exactes en `04-DESIGN-SYSTEM`
§4.1 et §4.4 — fournies en extrait dans le brief qui en a besoin. **Ne les recalcule pas.**

Typo — `taille/interligne graisse interlettrage` : `display 30/1.15 600 -.02em` (un par vue) ·
`title 21/1.25 600 -.01em` · `heading 16/1.35 600 -.005em` · `body 14/1.55 400` ·
`notes 15/1.7 400` (notes cliniques, plus grandes exprès) · `label 12/1.3 500 .02em` ·
`eyebrow 11/1.2 600 .09em` (MAJUSCULES) · `num 14/1.4 500` + `tabular-nums` obligatoire.
Arabe : `[dir="rtl"], .ar { font-family: var(--font-ar); line-height: 1.8 }`.
Grille : nav `248px` fixe · principal fluide `max 1120px` · contexte `340px` repliable.
< 1280px contexte → tiroir · < 1024px nav → icônes · cible **1920×1080**.

## 4 · RÈGLES DURES DU DESIGN
1. **Le rouge est un budget** : `--critical` = disque critique et perte de données, rien d'autre.
   Un RDV annulé ou un score élevé prend `--attention`.
2. **Le verre décore le mobilier, jamais la donnée.** Autorisé : panneau Jarvis, carte de
   confirmation, barre ⌘K, en-tête collant, fond de modale. Interdit sur posologie, dose, score,
   note, transcription, montant, date de RDV, nom de patient.
3. Dégradé : orbe Jarvis et écran de connexion. Nulle part ailleurs.
4. **Plancher d'accessibilité** — contraste ≥ 4.5:1 texte et ≥ 3:1 interface, vérifié ; focus
   visible partout (`outline: 2px solid var(--teal-600); outline-offset: 2px`) ; cibles ≥ 36px
   (44px sur le formulaire QR) ; jamais la couleur seule, un statut porte une forme ou un texte ;
   `prefers-reduced-motion: reduce` respecté.
5. **Ne bouge jamais** : donnée clinique affichée, montant, carte de confirmation, aperçu de document.
6. Avatar patient = **monogramme** sur `--teal-100`. Jamais de photo.
7. État vide : **jamais d'illustration** — une phrase `--ink-500` + une action teal.
8. Erreur : ce qui s'est passé · ce qui a été préservé · quoi faire. Jamais de vague.

## 5 · LANGUE
Douze écrans : `Tableau de bord` · `Patients` · `Agenda` · `Messages` · `Documents` ·
`Traitements` · `Suivi` · `Finances` · `Statistiques` · `Agents` · `Journal d'activité` ·
`Paramètres`.
Pièges : *Accueil*, *Dossiers*, *Calendrier*, *Communications*, *Aftercare*, *Rapports*.
Groupes de nav : **MENU · CLINIQUE · GESTION · SYSTÈME** (en `eyebrow`).
Verbes : `Enregistrer` · `Signer la note` · `Démarrer la séance` · `Terminer la séance` ·
`Générer le certificat` · `Confirmer` · `Annuler` · `Fixer le tarif` · `Réessayer`.
**Jamais** `Soumettre`, `OK`, `Valider` seul.
Cohérence : `Signer la note` produit « Note signée. » Même verbe de bout en bout.
**Aucune chaîne en dur** : tout par `src/i18n/fr.ts`, dès le premier composant.

## 6 · RÔLES
- `owner` (Dr. Larbi) — tout le cabinet, tous praticiens, finances globales.
- `practitioner` (Dr #2) — ses patients, ses notes, ses ordonnances, **ses seuls revenus**.
  Jamais les patients ni les revenus des autres.
- `assistant` — identité, contact, RDV, statut et montant de paiement, tous praticiens.
  **Jamais** : notes, transcriptions, diagnostics, ordonnances, motif de consultation.
- `patient` — ses données via portail aftercare (hors Phase 1).

**Pas de rôle `admin`.** Cloison stricte : aucun patient partagé entre praticiens.
Appliqué par **RLS Postgres**, jamais par le front.

> ⚠️ **Piège `reason`.** La RLS filtre des **lignes**, pas des **colonnes**. Le front assistante
> requête la vue `app.appointments_admin`, **jamais** la table `app.appointments`.
> **EN LITIGE (§7, Q-A) — ne code rien qui en dépende.**

## 7 · EN LITIGE — NE PAS CODER, DEMANDER
Q-A → ADR-017 · Q-B → ADR-019 · Q-C → ADR-018, résumés au §8. Le §5.1 de `01-SCHEMA` est
périmé (ADR-017). Une question nouvelle s'inscrit ICI avant d'être codée, jamais l'inverse.

**Q-D — OUVERTE au 2026-08-03. ADR-019 est INAPPLICABLE en l'état.** Prouvé en base, pas déduit.
- `SECURITY INVOKER` + `SELECT` révoqué = les deux portes butent sur leur propre révocation.
  `app.patients` n'a aujourd'hui **aucun chemin de lecture ni d'écriture applicatif.**
- `SECURITY DEFINER` **ne répare pas** : le propriétaire `postgres` a `rolbypassrls = t`, donc les
  portes ne voient plus aucune policy. Essayé en 018, **la cloison praticiennes est tombée**
  (Dr #2 lisant la patiente de la Dr Larbi) — annulé par 019. `FORCE ROW LEVEL SECURITY` et
  `rolsuper = f` ne suffisent pas : c'est `rolbypassrls` qu'il faut lire.
- Piste non codée : propriétaire de fonction dédié **sans** `BYPASSRLS`, et policies de `004`
  rendues applicables à ce rôle (`TO PUBLIC` au lieu de `TO authenticated`, prédicats inchangés).
  **Touche le fichier le plus sensible du corpus — ne rien écrire sans arbitrage humain.**
- Tant que Q-D est ouverte : `checkpoint-j1a` T2/T8 et `checkpoint-s2` contrôles base ne peuvent
  pas être verts. **Aucun commit ne doit prétendre le contraire.**

## 8 · DÉCISIONS GELÉES non couvertes par les invariants
- **ADR-001** Supabase auto-hébergé sur le PC du cabinet. **SUSPENDUE par ADR-016** le temps du
  développement : cloud autorisé, **données synthétiques uniquement**, appliqué par la base
  (migration `016` : `is_synthetic` + trigger sur toute table Tier 0/1). Aucun accès Dr. Larbi.
  Migration à l'achat du serveur **ou** avant le premier patient réel — le premier des deux.
  Si ta tâche fait entrer une donnée patient réelle, **arrête-toi et demande.**
- **ADR-003** `cabinet_id` + `practitioner_id` dès le schéma initial (2ᵉ praticienne annoncée).
- **ADR-008** Transcription en arabe · intake FR/AR/Darija.
- **ADR-010** Cash uniquement, **aucune facture légale**.
- **ADR-015** Aftercare = chat simple. **Aucune détection de risque automatisée en Mois 1.**
- **ADR-019** Dossier patient lisible **uniquement** par `app.get_patient` et
  `app.search_patients` : `SELECT` révoqué sur `app.patients`. Une lecture non auditée n'est plus
  une négligence possible, c'est un `permission denied`. `pgaudit` rejeté en cloud (il ferait
  fuiter le `patient_id` dans un log sortant), réévalué en auto-hébergé.
- **ADR-020** `src/services/*` ne connaît qu'un `DbPort`. Seul `src/services/db/supabase.ts`
  importe `@supabase/supabase-js` — vérifié par ESLint et le préflight, pas par la relecture.
Les autres (004 notes, 005 rôles, 009 audio, 014 sauvegardes) sont déjà en §1 et §6.

## 9 · SCHÉMA
Schémas `app` et `audit`. Extensions : `pgcrypto`, `uuid-ossp`, `pg_trgm`, `unaccent`.
Pas de `pgvector` (Mois 2, avec le GPU).
Principes : PK `uuid` · `timestamptz` partout · `cabinet_id` + `practitioner_id` sur tout le
clinique · **append-only sur le clinique**, pas de `deleted_at` · migrations tracées dans
`app.schema_migrations` · compteur jamais `SEQUENCE` · `snake_case`, pluriel, FK `<singulier>_id`.

Tables, fonctions d'aide et déclencheurs : `01-SCHEMA.md` §2–§12, extrait fourni dans le brief
qui en a besoin. **N'invente aucune table.** N'existent **pas** en Phase 1 : `invoices` · `domain_events` ·
`appointment_requests` · `consents` · `settings` · `waiting_list` · rôle `admin` · colonnes
`lock_version`, `search_key`, `clinic_id`. Aucune infrastructure d'événements ; les noms
canoniques attendront `MindCare-Domain-Events.md` le jour où on émettra.

## 10 · GARDE-FOUS
`bash scripts/preflight.sh` — 5 greps. Toute sortie non vide = ne pas commiter.

Si ta tâche contredit une règle de ce fichier, ou touche un point du §7,
**dis-le avant d'écrire du code.** Être arrêté coûte moins cher qu'être corrigé.
