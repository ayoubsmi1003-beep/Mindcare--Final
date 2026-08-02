# SPRINT-4-DAYS.md
**MindCare OS — 2 → 6 août 2026 · 8 sessions Claude Code**
v2 — révisé après décisions D-07 → D-10. Remplace `05-BUILD-PLAN.md` (archivé).

> Ta contrainte n'est pas l'heure, c'est **la session**. Deux par jour. Huit au total.
> C'est la seule unité qui compte.

---

## 0. LE PLAN EN UNE PAGE

```
DIM 2 août   S0  Supabase auto-hébergé sur le PC serveur   → base en Algérie, isolée
             S1  Schéma + RLS + seed                        → 8 tests SQL verts

LUN 3 août   S2  Auth + coquille (praticienne seule)        → elle se connecte
             S3  Patients                                   → ses vrais dossiers

MAR 4 août   S4  Agenda vue jour                            → ses vrais rendez-vous
             S5  Consultation + note + signature            → LE PRODUIT

MER 5 août   S6  Jarvis texte + analyse de séance           → LE WOW
             S7  Finance + Documents                        → recette du jour + certificats

JEU 6 août   DÉMO — et premier jour d'usage réel
             (S8 n'existe plus. Le tampon a payé S0. Voir §2.)
```

⚠️ **Il n'y a plus de session tampon.** C'est le prix de l'auto-hébergement, et il est justifié :
héberger en Algérie, c'est la différence entre une dette légale et une conformité.
Conséquence : **le périmètre de S7 est le premier à sauter.**

---

## 1. CE QUI A ÉTÉ ARBITRÉ — ne pas rouvrir

| # | Décision | Effet sur le sprint |
|---|---|---|
| **D-07** | **Supabase auto-hébergé** sur le PC serveur (i7 · 16 GB · Win 10 Pro) | +1 session (S0). Dette D-01 **supprimée**. |
| **D-08** | **Front assistante reporté en semaine 2** | −0,5 session. La praticienne saisit tout au mois 1. |
| **D-09** | **Finance dans le sprint** — encaissement + recette du jour | S7, moitié de session |
| **D-10** | **Analyse de séance sans micro** — notes brutes → note structurée | S6. Transcription en semaine 2, **même outil**. |

---

## 2. RÈGLE DU SACRIFICE

Si une session déborde, on coupe **dans cet ordre**, sans discussion :

```
1. Vue semaine de l'agenda        (la vue jour suffit)
2. Documents — 2 modèles sur 4    (les deux plus utilisés d'abord)
3. Jarvis : outils de lecture     (garder l'analyse de séance + la carte)
─────────── EN DESSOUS, ON NE COUPE PAS ───────────
4. Finance — recette du jour      ⛔ D-09
5. Consultation + note            ⛔ c'est le produit
6. Patients                       ⛔ c'est la base
7. Auth + rôles                   ⛔ sans ça rien n'est légal
8. Auto-hébergement + RLS + audit ⛔ jamais, sous aucune contrainte de temps
```

**Déjà coupé, acté, à ne pas rouvrir avant le 7 août :**
transcription · analyse en direct · accueil QR · front assistante · aftercare · voix · traitements imprimés.

---

## 3. LES HUIT SESSIONS

### S0 — AUTO-HÉBERGEMENT · pas d'agent, tu pilotes
Suis `docs/SELF-HOST-SETUP.md` de bout en bout.
⚠️ **Lance WSL2 + Docker Desktop en téléchargement AVANT la session.** C'est de l'attente, pas du travail.

**✅ CHECKPOINT S0**
```bash
docker ps --format '{{.Names}}\t{{.Status}}'     # 9 conteneurs healthy
psql -h localhost -U postgres -c "SHOW lc_collate;"   # fr-DZ
# depuis un AUTRE poste du réseau :
nc -zv <ip-serveur> 5432                         # doit ÉCHOUER
```
🔴 Si Postgres répond depuis un autre poste, on s'arrête. Ports liés à `127.0.0.1` uniquement.

---

### S1 — SCHÉMA · `db-migrator` · opus
Migrations 001→015 selon `01-SCHEMA.md`, puis seed :
cabinet · profil owner (Dr. Larbi N., N° d'Ordre 16/16780, bloc signature) · 4 modèles de documents ·
~60 médicaments · échelles PHQ-9 / GAD-7 / HDRS / YMRS · compteurs à 0.

**✅ CHECKPOINT S1 — les 8 tests du §15 de `01-SCHEMA.md`**
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
🔴 **Un seul rouge = S2 ne commence pas.** Irrattrapable : à S3 il y aura de vraies données dessus.

> Les rôles `assistant` et les vues admin sont créés **en base** dès S1, même si le front assistante
> attend la semaine 2. La sécurité s'installe maintenant ou jamais.

---

### S2 — AUTH & COQUILLE · `feature-builder` · sonnet
```
[ ] 7 fontes .woff2 en local — BLOQUANT, à fournir avant la session
[ ] Connexion e-mail + mot de passe
[ ] Profil → rôle → garde de route côté serveur (middleware)
[ ] Layout : nav 248 / principal / contexte 340
[ ] i18n FR, zéro chaîne en dur
```
**✅ CHECKPOINT S2** — Un compte `assistant` créé en base : URL directe `/consultation/x` refusée
**côté serveur**, pas côté React.

---

### S3 — PATIENTS · `feature-builder` · sonnet
```
[ ] Liste : recherche trigram sur search_key, tri, pagination
[ ] Fiche : identité + onglets Historique / Documents / Finance
[ ] Création, édition, verrouillage optimiste (lock_version)
[ ] États vide et erreur écrits
```
**✅ CHECKPOINT S3** — Un patient réel retrouvé par `Bel Kacem`, `Belkacem` **et** `bel-kacem`.
Un échec de recherche crée un doublon, et un doublon en psychiatrie est un risque de sécurité.

---

### S4 — AGENDA · `feature-builder` · sonnet
```
[ ] Vue jour + ligne du présent (vue semaine sacrifiable)
[ ] Créer / déplacer / annuler
[ ] Statuts §9.4 du design system
[ ] Salle d'attente (arrivées)
```
**✅ CHECKPOINT S4** — Prendre un vrai rendez-vous, le déplacer, le retrouver le lendemain.

---

### S5 — CONSULTATION & NOTE · `feature-builder` · sonnet
> **Le cœur. Si une seule session doit être parfaite, c'est celle-ci.**
```
[ ] start_consultation → Mode Séance, bascule 600 ms
[ ] Chronomètre en Geist Mono
[ ] Zone « notes brutes » — champ libre, saisie au fil de la séance
[ ] Éditeur de note structurée, texte libre, 15px/1.7
[ ] Signature → animation de verrouillage §8.1
[ ] Amendement après verrouillage
[ ] Fil de séance : structure vide, prête pour la transcription en semaine 2
```
**✅ CHECKPOINT S5** — Signer, attendre 16 min, tenter une modification → refus **par la base**
+ proposition d'amendement.

---

### S6 — JARVIS · `jarvis-tooler` · sonnet
Périmètre exact : `docs/JARVIS-DEMO-SPEC.md`. **9 outils, pas un de plus.**
La priorité absolue de cette session est `analyze_session` — c'est le seul outil qui lui fait
gagner de vraies minutes ce mois-ci.

**✅ CHECKPOINT S6 — les 8 tests du §11 de `03-JARVIS-TOOLS.md`**
Dont **T6 : couper la clé OpenRouter → l'application reste entièrement utilisable.**

---

### S7 — FINANCE + DOCUMENTS · `feature-builder` · sonnet
> Deux modules en une session. **C'est le point de rupture du plan.** Finance d'abord.
```
FINANCE (priorité)
[ ] set_consultation_price
[ ] Journal des paiements, mode + montant DZD
[ ] Recette du jour — lisible en une demi-seconde
[ ] Cloison RLS : le chiffre d'affaires reste au owner

DOCUMENTS (sacrifiable à 2 modèles)
[ ] Aperçu A4 en Newsreader, en-tête bilingue fidèle au scan
[ ] Numérotation via next_number — jamais une SEQUENCE
[ ] rendered_html figé à l'émission
```
**✅ CHECKPOINT S7** — Imprimer réellement les certificats. Sur papier. Les poser à côté des siens.
Une différence de marge se voit sur le papier, jamais à l'écran.

---

## 4. LE 6 AOÛT — CE QUI DOIT ÊTRE FAIT AVANT DE LUI MONTRER

Ce n'est pas une session, c'est une checklist. 90 minutes.
```
[ ] pg_dump chiffré quotidien + copie USB + RESTAURATION TESTÉE
[ ] Procédure de secours écrite en français, une page, imprimée, posée près du PC
[ ] Ses vrais patients existants saisis
[ ] Formation 45 min : consultation, notes brutes → analyse, signature, encaissement, certificats
[ ] Dire clairement ce qui NE marche pas encore
```
> Annoncer les manques soi-même. Une limite annoncée est une décision ;
> une limite découverte est une faute.

**Ce que tu lui dis, mot pour mot :**
*« Ce mois-ci : pas de transcription automatique, pas de poste assistante, pas d'ordonnance imprimée.
Tout le reste fonctionne, et vos données ne quittent pas ce PC. »*

---

## 5. À FOURNIR AVANT S2 — sinon la session est perdue

- [ ] **Les 7 fontes `.woff2`** : Geist Sans 400/500/600 · Geist Mono 500 · Newsreader 400 · IBM Plex Sans Arabic 400/500/600
- [ ] **Logo SVG**
- [ ] **Liste des ~60 médicaments** (texte brut) → bloque le seed de S1
- [ ] **Scan de l'en-tête** + arbitrage « Pychiaterie » → bloque S7
- [ ] WSL2 + Docker Desktop téléchargés → bloque S0

---

## 6. DÉFINITION DE « TERMINÉ »

```
1. Fonctionne avec des données réelles, pas un jeu d'essai
2. RLS vérifiée pour les 3 rôles (même ceux dont le front n'existe pas encore)
3. Se dégrade proprement si le réseau tombe
4. État vide et état d'erreur écrits
5. Jetons du design system respectés — aucun hex inventé
6. Checkpoint vert reproductible par script
```

---

## 7. SEMAINE 2 — l'ordre, déjà décidé

```
J+1  Transcription Groq → alimente analyze_session, ZÉRO changement d'architecture
J+2  Front assistante : agenda, arrivées, encaissement (vue appointments_admin)
J+3  Analyse en direct pendant la séance
J+4  Accueil QR tablette
J+5  Corrections issues de l'usage réel — les seules qui comptent
S3   Ordonnances imprimées · échelles psychométriques
S4   Enveloppe Tauri · préparation GPU (Whisper + LLM locaux)
```

---

*Le périmètre est la seule variable d'ajustement. Jamais les règles de fer.*
