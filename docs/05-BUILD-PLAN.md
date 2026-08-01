# 05 — BUILD PLAN
**MindCare OS — J0 → J3, heure par heure**
Version 1.0 — 2026-07-28
Prérequis : `00-DECISIONS.md` → `04-DESIGN-SYSTEM.md`

> Un checkpoint rouge arrête la progression. Toujours. Sans négociation avec soi-même.
> Passer outre un rouge à J1 coûte une journée entière à J2.

---

## 0. LE PLAN EN UNE PAGE

```
J0  PRÉPARATION (3–5 h, la veille)      ← sans ça, les 2 jours n'existent pas
    Docker · Supabase · comptes Windows · dépôt · secrets

J1  matin  (4 h)   Schéma + RLS + audit + seed          → base prouvée par tests SQL
    aprèm  (5 h)   Auth · coquille · Patients · Agenda   → elle peut déjà saisir ses patients

J2  matin  (4 h)   Consultation · transcription · note   → le cœur du produit
    aprèm  (5 h)   Documents · Finance · Assistante · QR · Jarvis texte

J3  TAMPON         Tests réels · corrections · sauvegardes · formation
    ⚠️ J3 n'est pas optionnel. C'est là que le logiciel devient utilisable.
```

### 0.1 Ce que je te dois en honnêteté
Deux jours de construction, c'est **9 heures effectives par jour, sans interruption**.
Ce plan tient **si et seulement si** :
- J0 est terminé la veille
- les écrans Claude Design existent avant J1
- personne ne rajoute de fonctionnalité en cours de route

Si l'un des trois saute, c'est J3 qui absorbe — pas la qualité, pas la sécurité.
**Le périmètre est la seule variable d'ajustement.** Jamais les règles de fer.

---

## 1. J0 — PRÉPARATION

> À faire la veille au soir. C'est la journée la plus ingrate et la plus déterminante.

### J0.1 — Poste (60 min)
```
[ ] Windows : compte "Dr Larbi" (admin) + compte "Assistante" (standard)
[ ] BitLocker activé sur C:
[ ] Verrouillage automatique 5 min
[ ] Mises à jour Windows appliquées
[ ] Économiseur d'énergie : disque et veille DÉSACTIVÉS (c'est un serveur)
[ ] Espace disque libre relevé et noté
```

### J0.2 — Docker & Supabase (90 min)
```
[ ] WSL2 installé, redémarrage effectué
[ ] Docker Desktop, démarrage automatique activé
[ ] git clone supabase/docker
[ ] .env : mots de passe forts, JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY
[ ] ⚠️ ports liés à 127.0.0.1 UNIQUEMENT (§7.1 S5 de 02-SECURITY-BOUNDARY)
[ ] docker compose up -d
```

**✅ CHECKPOINT J0-A**
```bash
docker ps                                  # 9 conteneurs "healthy"
curl http://localhost:8000/rest/v1/         # réponse JSON
psql -h localhost -p 5432 -U postgres -c "SELECT version();"
```
🔴 **Rouge = on s'arrête ici.** Rien d'autre n'a de sens tant que la base ne tourne pas.

### J0.3 — Dépôt & secrets (45 min)
```
[ ] Dépôt Git, premier commit = .gitignore SEUL (§6.2)
[ ] .env.example sans aucune valeur réelle
[ ] Clés OpenRouter + Groq créées, plafonds posés (30 USD / 20 USD)
[ ] ⚠️ Journalisation des prompts DÉSACTIVÉE sur OpenRouter
[ ] Les 6 fichiers .md à la racine
[ ] Test : git log -p | grep -i "api_key" → aucun résultat
```

### J0.4 — Réseau (45 min)
```
[ ] IP locale du PC fixée (réservation DHCP sur le modem)
[ ] Wi-Fi invité activé et isolé pour la salle d'attente
[ ] Pare-feu : 5432 bloqué hors LAN, port applicatif ouvert sur LAN
[ ] Depuis un téléphone sur le Wi-Fi invité : http://<ip>:3000 accessible
[ ] Ethernet si le câble est là (RSK-2)
```

**✅ CHECKPOINT J0-B** — Un téléphone atteint l'application. Postgres n'est pas joignable de l'extérieur.

---

## 2. J1 MATIN — LA BASE (4 h)

> Aujourd'hui on ne code pas d'interface. On construit ce qui ne pourra plus être changé.

### 08:30–10:00 · Migrations 001 → 008
```
001 extensions + schema_migrations
002 enums
003 cabinets, profiles, fonctions d'aide
004 patients + RLS
005 pending_patients + intake
006 appointments + vue appointments_admin
007 consultations, transcript_segments, live_insights
008 clinical_notes + triggers d'immuabilité
```
Une migration = un fichier = une transaction = une ligne dans `schema_migrations`.

### 10:00–11:00 · Migrations 009 → 014
```
009 diagnoses, scales, medications, prescriptions
010 counters, documents, templates
011 payments, notifications
012 jarvis_actions
013 schéma audit + triggers
014 storage_health + purges
```

### 11:00–11:45 · Seed (015)
```
[ ] Cabinet
[ ] Profil owner : Dr. Larbi N., N° d'Ordre 16/16780, signature_block complet
[ ] Profil assistant
[ ] 4 document_templates (en-tête FR + AR, Times New Roman 14)
[ ] ~60 medications
[ ] scales : PHQ-9, GAD-7, HDRS, YMRS
[ ] intake_form v1 — ⚠️ relue question par question : aucune suggestion d'effet secondaire
[ ] counters à 0
```

### 11:45–12:30 · **LE CHECKPOINT QUI COMPTE**

**✅ CHECKPOINT J1-A — les 8 tests du §15 de `01-SCHEMA.md`**
```
T1 assistante → clinical_notes                 = 0 lignes
T2 Dr#2 → patients d'autrui                    = 0 lignes
T3 UPDATE note verrouillée                     = exception
T4 DELETE note                                 = sans effet
T5 next_number ×100 concurrent                 = 1..100 sans trou
T6 jarvis_actions executed sans confirmed_at   = violation
T7 appointments_admin.reason                   = colonne inexistante
T8 audit.log après UPDATE patients             = {phone}
```

🔴 **Un seul rouge = on ne passe pas à l'interface.**
> Ces huit tests sont le contrat de sécurité entier. Ils sont impossibles à rattraper plus tard :
> à J2, il y aura des données réelles dessus.

---

## 3. J1 APRÈS-MIDI — COQUILLE & PATIENTS (5 h)

### 13:30–14:30 · Fondations applicatives
```
[ ] Next.js + Tailwind, tokens du §3–8 de 04-DESIGN-SYSTEM en variables CSS
[ ] Fontes EN LOCAL (Geist, Newsreader, IBM Plex Arabic, Geist Mono) — pas de CDN
[ ] Client Supabase (anon uniquement côté client)
[ ] i18n FR, zéro chaîne en dur
[ ] Layout : nav 248 / principal / contexte 340
```

### 14:30–15:15 · Authentification & rôles
```
[ ] Connexion e-mail + mot de passe
[ ] Chargement du profil → rôle
[ ] Garde de route par rôle
[ ] Nav filtrée selon le rôle
```

**✅ CHECKPOINT J1-B** — Connexion assistante : *Traitements* et *Statistiques* absents du menu.
Accès direct à l'URL → refusé.

### 15:15–16:45 · Patients
```
[ ] Liste : recherche trigram, tri, pagination
[ ] Fiche : identité, onglets Historique / Traitements / Échelles / Documents
[ ] Création, édition
[ ] Vue assistante : administratif uniquement
```

### 16:45–18:15 · Agenda
```
[ ] Vue jour + semaine, ligne du présent
[ ] Créer / déplacer / annuler
[ ] Statuts (§9.4 du design system)
[ ] Salle d'attente (arrivées)
[ ] ⚠️ Front assistante → appointments_admin, JAMAIS appointments
```

**✅ CHECKPOINT J1-C — fin de J1**
> La praticienne peut créer un patient, prendre un rendez-vous, le retrouver demain.
> **Même si tout s'arrêtait ce soir, elle aurait déjà un outil utile.**
> C'est le critère : chaque jour produit quelque chose d'utilisable seul.

Commit + sauvegarde `pg_dump`.

---

## 4. J2 MATIN — LA CONSULTATION (4 h)

> Le cœur. Si une seule chose doit être parfaite, c'est celle-ci.

### 08:30–09:15 · Mode Séance (§7 du design system)
```
[ ] start_consultation → bascule nuit 600 ms
[ ] Chronomètre en Geist Mono
[ ] Structure du fil de séance
[ ] Terminer la séance → retour jour
```
> Faire l'écran **avant** la transcription. Il doit être beau et calme même vide.

### 09:15–10:45 · Transcription
```
[ ] MediaRecorder, segments de 15–20 s, EN MÉMOIRE
[ ] Edge Function → Groq (session_token seul)
[ ] Insertion transcript_segments, affichage RTL arabe
[ ] File de rejeu si coupure réseau
[ ] Bouton « Transcription désactivée » — FONCTIONNEL (§9 de 02-SECURITY-BOUNDARY)
```

**✅ CHECKPOINT J2-A — le plus important de la journée**
```
1. Consultation de 3 min, darija + français mélangés
2. Texte arabe cohérent affiché en direct
3. Wi-Fi coupé 30 s → l'app tient, rejeu au retour
4. Chercher *.webm / *.wav sur tout le disque → ZÉRO fichier
5. boundary_crossings : aucune donnée Tier 0
```
🔴 Le point 4 est non négociable (ADR-009).

### 10:45–11:45 · Analyse en direct
```
[ ] Insights toutes les ~3 min via passerelle LLM
[ ] Colonne droite du fil, discrète (§9.1 de 03-JARVIS-TOOLS)
[ ] Mention permanente « Aide à la décision »
[ ] Pouce haut/bas → was_useful
[ ] Plafond 0,50 USD / consultation
```

### 11:45–12:30 · Note clinique
```
[ ] draft_clinical_note → SOAP depuis la transcription
[ ] Éditeur, 15px/1.7 (§5.1)
[ ] Signature → animation de verrouillage (§8.1)
[ ] Amendement après verrouillage
```

**✅ CHECKPOINT J2-B** — Signer, attendre 16 min, tenter une modification → refus + proposition d'amendement.

---

## 5. J2 APRÈS-MIDI — LE RESTE (5 h)

### 13:30–14:30 · Documents
```
[ ] 4 modèles, aperçu A4 en Newsreader
[ ] En-tête bilingue fidèle au scan
[ ] Numérotation via next_number
[ ] rendered_html figé
[ ] Impression : ce qui sort = ce qui s'affiche
```
> Imprimer réellement les 4 certificats. Sur du papier. Les poser à côté des siens.
> Une différence de marge se voit sur le papier, jamais à l'écran.

### 14:30–15:15 · Finance
```
[ ] set_consultation_price
[ ] Notification Realtime → poste assistante
[ ] Journal des paiements, cloison RLS
[ ] Total du jour
```

**✅ CHECKPOINT J2-C** — Deux navigateurs côte à côte. Le prix saisi apparaît chez l'assistante
en moins de 2 s. Elle ne voit pas le chiffre d'affaires du mois.

### 15:15–16:00 · Accueil QR
```
[ ] Application distincte, rôle intake_writer (INSERT seul)
[ ] Formulaire FR / AR / Darija
[ ] Téléphone = clé, correspondance ou pending
[ ] File de validation
[ ] Limite 3 / 24 h
```

**✅ CHECKPOINT J2-D** — Depuis un vrai téléphone sur le Wi-Fi invité : scanner, répondre, voir
la fiche arriver dans la file. Puis vérifier que ce rôle ne peut lire aucun patient.

### 16:00–17:30 · Jarvis texte
```
[ ] Boucle : intention → Zod → résolution → proposition → carte → exécution → journal
[ ] Les 8 outils prioritaires :
    search_patients · get_patient · get_agenda · create_appointment
    start_consultation · draft_clinical_note · set_consultation_price · generate_document
[ ] Carte de confirmation (§6 de 03-JARVIS-TOOLS), délai 400 ms
[ ] Désambiguïsation
```

**✅ CHECKPOINT J2-E — les 8 tests du §11 de `03-JARVIS-TOOLS.md`**
Dont T6 : couper OpenRouter → l'application reste entièrement utilisable.

### 17:30–18:30 · Journal & finitions
```
[ ] Écran Journal d'activité (audit lisible)
[ ] Coquilles honnêtes : Messages, Suivi, Statistiques, Agents
    → « Disponible prochainement », aucune fausse donnée
[ ] Alarme disque (§13 de 01-SCHEMA)
```

---

## 6. J3 — RÉEL, SAUVEGARDES, FORMATION

> Cette journée n'est pas du confort. C'est elle qui transforme un logiciel en outil de travail.

### Matin · Répétition générale
```
[ ] 3 consultations complètes simulées, de bout en bout
[ ] Les 4 certificats imprimés et comparés au papier
[ ] Assistante et praticienne travaillant en parallèle, 1 h
[ ] Grille d'anomalies remplie et corrigée
```

### Après-midi · Sauvegardes (ADR-014) — **le vrai livrable**
```
[ ] pg_dump chiffré toutes les 4 h → tâche planifiée
[ ] Copie quotidienne → disque USB, débranché ensuite
[ ] WAL archiving activé
[ ] ⚠️ RESTAURATION TESTÉE sur un second dossier — pas seulement lancée
[ ] Procédure écrite, en français, une page, imprimée et posée près du PC
```
> **Une sauvegarde jamais restaurée n'est pas une sauvegarde.** Cette ligne se vérifie aujourd'hui,
> pas le jour où le disque lâche.

### Fin de journée · Formation (90 min)
```
[ ] Praticienne : consultation, note, signature, certificats, Jarvis
[ ] Assistante : agenda, arrivées, encaissement, validation d'accueil
[ ] Consentements C1 et C2 imprimés, expliqués, en place
[ ] Numéro de contact en cas de problème
[ ] Ce qui NE marche pas encore, dit clairement
```
> Annoncer les manques soi-même. Une limite annoncée est une décision ;
> une limite découverte est une faute.

---

## 7. RÈGLES DE CONSTRUCTION

### 7.1 Discipline Claude Code
1. **Plan mode d'abord.** Lire le plan avant d'accepter.
2. **Une tâche = un commit.** Message : `feat(patients): liste + recherche trigram`.
3. **Checkpoint = commande copiable-collable**, résultat vert ou rouge, jamais « ça a l'air bon ».
4. **Rouge = on s'arrête.** On corrige. On ne contourne pas.
5. **Nouvelle session = relire `CLAUDE.md` + le .md du domaine concerné.**
6. **Aucune donnée fictive dans une fonctionnalité livrée.** Un écran vide est honnête.

### 7.2 Ce qu'on ne fait pas pendant ces 2 jours
| Tentation | Réponse |
|---|---|
| « J'ajoute vite l'aftercare » | Non. Mois 2. |
| « Le vocal, c'est presque pareil » | Non. §4.4 de `00-DECISIONS`. |
| « On testera les sauvegardes plus tard » | Non. J3 après-midi. |
| « La RLS, on la mettra à la fin » | Impossible. Elle est J1 matin ou jamais. |
| « Un dégradé sur cette carte serait joli » | §3 du design system. |

### 7.3 Si le retard s'installe
Ordre de sacrifice, du premier au dernier :
```
1. Analyse en direct       (transcription + note suffisent)
2. Accueil QR              (l'assistante saisit à la main)
3. Jarvis texte            (l'interface fait tout)
4. Journal d'activité      (l'audit tourne, l'écran attendra)
─────────── EN DESSOUS, ON NE COUPE PAS ───────────
5. Documents               ⛔ elle en imprime tous les jours
6. Consultation + note     ⛔ c'est le produit
7. Patients + Agenda       ⛔ c'est la base
8. RLS + audit + backups   ⛔ jamais, sous aucune contrainte de temps
```

---

## 8. APRÈS J3 — SEMAINE 1

| Jour | Action |
|---|---|
| J+4 | Observation à distance. Noter, ne pas corriger tout de suite. |
| J+5 | Corrections issues de l'usage réel — les seules qui comptent |
| J+6 | Enrichir le prompt Whisper de son vocabulaire réel (§4.3 de `02-SECURITY-BOUNDARY`) |
| J+7 | **Premier test de restauration hebdomadaire** |
| S2 | Extraction Vidal · Windows 11 · NVMe |
| S3–4 | Statistiques · Suivi · préparation du GPU |

---

## 9. DÉFINITION DE « TERMINÉ »

Une fonctionnalité est terminée quand les six sont vrais :
```
1. Elle fonctionne avec des données réelles, pas un jeu d'essai
2. La RLS est vérifiée pour les trois rôles
3. Elle se dégrade proprement si le réseau tombe
4. Son état vide et son état d'erreur sont écrits
5. Elle respecte les tokens du design system
6. Un checkpoint vert existe, reproductible
```

---

## 10. CE DONT J'AI BESOIN AVANT J1

- [ ] **Écrans Claude Design** — Mode Séance en premier
- [ ] **Logo SVG**
- [ ] **Liste des ~60 médicaments**
- [ ] Arbitrage sur « Pychiaterie » dans l'en-tête
- [ ] Confirmation : J0 terminé

> Sans les écrans, J1 après-midi devient du design improvisé sous pression.
> C'est exactement ainsi qu'on perd une demi-journée.

---

*Fin du document. Dernier livrable : `CLAUDE.md` — les règles permanentes pour chaque session Claude Code.*
