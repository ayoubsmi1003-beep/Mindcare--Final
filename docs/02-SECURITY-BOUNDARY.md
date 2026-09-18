# 02 — SECURITY BOUNDARY
**MindCare OS — Frontière des données, pseudonymisation, secrets**
Version 1.0 — 2026-07-28
Prérequis : `00-DECISIONS.md`, `01-SCHEMA.md`

> Ce document définit **la seule porte** par laquelle une donnée peut quitter le cabinet.
> S'il existe un second chemin quelque part dans le code, ce document a échoué.

---

## 1. LA FRONTIÈRE

```
┌──────────────────────────────── PC DU CABINET (Alger) ────────────────────────────────┐
│                                                                                        │
│   Navigateur Dr.        Navigateur Assistante         Téléphone patient (QR, LAN)      │
│         │                        │                              │                      │
│         └────────────────────────┴──────────────────────────────┘                      │
│                                  │  HTTP local uniquement                              │
│                     ┌────────────▼─────────────┐                                       │
│                     │   Application (Next.js)  │   ⚠️ ZÉRO clé API ici                 │
│                     └────────────┬─────────────┘                                       │
│                                  │                                                     │
│         ┌────────────────────────┼─────────────────────────┐                           │
│         │                        │                         │                           │
│  ┌──────▼──────┐        ┌────────▼────────┐      ┌─────────▼──────────┐                │
│  │  Supabase   │        │  Edge Functions │      │  PASSERELLE        │                │
│  │  Postgres   │◄───────┤  (Deno, local)  ├─────►│  PSEUDONYMISATION  │                │
│  │  RLS + audit│        │                 │      │  ⛔ POINT UNIQUE   │                │
│  └─────────────┘        └─────────────────┘      └─────────┬──────────┘                │
│         ▲                                                   │                          │
│    Tier 0 — ne sort JAMAIS                                  │  Tier 2 seulement        │
└─────────────────────────────────────────────────────────────┼──────────────────────────┘
                                                              │
                                    ══════════ FRONTIÈRE ═════╪══════════
                                                              ▼
                                              ┌───────────────────────────┐
                                              │  Groq (STT)               │
                                              │  OpenRouter (LLM)         │
                                              │  Aucune donnée identifiante│
                                              └───────────────────────────┘
```

**Une seule flèche traverse la frontière. Elle part de la passerelle. Il n'y en a pas d'autre.**

---

## 2. CLASSIFICATION DES DONNÉES

| Tier | Contenu | Sortie autorisée ? |
|---|---|---|
| **Tier 0 — Identifiant** | nom, prénom, date de naissance, téléphone, adresse, n° pièce d'identité, contact d'urgence, n° de dossier, `patient_id` | ❌ **JAMAIS**, sous aucun prétexte |
| **Tier 1 — Clinique identifiable** | note complète, transcription liée à un patient, diagnostic nominatif | ❌ jamais tel quel — uniquement après passage Tier 2 |
| **Tier 2 — Clinique pseudonymisé** | texte clinique dont tout Tier 0 a été retiré et remplacé par des jetons | ✅ via passerelle uniquement |
| **Tier 3 — Non personnel** | référentiel médicaments, échelles, modèles de documents, statistiques agrégées | ✅ libre |

### 2.1 La règle qui tranche tous les doutes
> **Si un tiers, en lisant la charge utile sortante, pouvait reconnaître la personne — même en la
> croisant avec une autre source — c'est du Tier 0 ou 1. Ça ne sort pas.**

Cas concrets souvent ratés :
- « Le patient qui habite à côté de la mosquée de Bab El Oued » → **Tier 0** (quasi-identifiant)
- « Homme, 34 ans, ingénieur chez Sonatrach, divorcé en mars » → **Tier 0** (ré-identification triviale)
- « Patient, 34 ans, trouble anxieux généralisé, sous sertraline » → **Tier 2** ✅
- Prénoms **cités dans le discours** du patient (« ma femme Amina… ») → **Tier 0**, à masquer

⚠️ **Ce dernier point est le piège principal du projet.** Une transcription psychiatrique est
saturée de prénoms de tiers. La pseudonymisation doit s'appliquer au **contenu**, pas seulement
aux métadonnées.

---

## 3. LA PASSERELLE DE PSEUDONYMISATION

### 3.1 Emplacement et forme
- **Un seul fichier :** `src/server/jarvis/pseudonymize.ts`
- **Un seul point de sortie :** `src/server/egress/external-call.ts`
- **Aucun** `fetch()` vers un domaine externe ailleurs dans le dépôt. Vérifié en CI (§8.3).

### 3.2 Contrat
```ts
type Tier0Map = Record<string, string>;   // 'PT_4471' -> 'Nassim'

interface Pseudonymized {
  text: string;         // texte sortant, nettoyé
  map: Tier0Map;        // reste EN MÉMOIRE LOCALE, ne sort jamais
  removed: number;      // nombre de substitutions
}

function pseudonymize(raw: string, ctx: PatientContext): Pseudonymized;
function rehydrate(response: string, map: Tier0Map): string;
```

### 3.3 Algorithme — deux passes, dans cet ordre
**Passe A — Retrait déterministe (à partir de la base).**
On connaît le patient : ses nom, prénom, téléphone, adresse, contact d'urgence sont chargés
depuis Postgres et retirés par correspondance exacte + variantes (accents, casse, translittération
arabe↔latin). C'est fiable à 100 % pour ce qu'on connaît.

**Passe B — Retrait probabiliste (contenu du discours).**
Pour les tiers cités spontanément :
- Liste de prénoms algériens FR/AR (~3 000 entrées, embarquée localement)
- Motifs : numéros de téléphone, dates complètes, n° de pièce d'identité, quartiers/communes d'Alger
- Titres suivis d'un nom propre : « Dr. X », « mon frère Y »

**Table de jetons :**
| Type | Jeton | Exemple |
|---|---|---|
| Patient | `PT_<4 chiffres>` | `PT_4471` |
| Tiers nommé | `PER_<n>` | `PER_1` |
| Lieu | `LOC_<n>` | `LOC_1` |
| Date précise | `DATE_<n>` | `DATE_1` |
| Téléphone | `PHONE_<n>` | `PHONE_1` |

Les jetons sont **stables au sein d'une consultation** (le modèle doit comprendre que `PER_1`
revient) et **régénérés à chaque consultation** (aucune corrélation entre séances côté fournisseur).

### 3.4 Ce qui est conservé volontairement
L'âge (tranche), le sexe, la classe médicamenteuse, les symptômes, la durée d'évolution.
Sans eux l'analyse clinique n'a aucune valeur. **La pseudonymisation ne doit pas rendre l'IA inutile** —
sinon on la contournera, et c'est là que naissent les fuites.

### 3.5 Garde-fou de sortie — obligatoire
```ts
function assertSafe(payload: string, ctx: PatientContext): void {
  const forbidden = [
    ctx.firstName, ctx.lastName, ctx.phone, ctx.phoneAlt,
    ctx.address, ctx.idDocumentNumber, ctx.patientId,
    ctx.emergencyContact?.name, ctx.emergencyContact?.phone,
  ].filter(Boolean).map(normalize);

  const hay = normalize(payload);
  for (const f of forbidden) {
    if (f.length >= 3 && hay.includes(f)) {
      throw new BoundaryViolation(`Tier 0 détecté dans la charge sortante`);
      // ⚠️ Ne JAMAIS journaliser la valeur fautive — cela recréerait la fuite dans les logs.
    }
  }
  if (/\b0[5-7]\d{8}\b/.test(payload)) throw new BoundaryViolation('Téléphone détecté');
}
```
> Cette fonction s'exécute **juste avant** chaque `fetch()` sortant. Elle échoue bruyamment.
> Une consultation qui échoue est un incident mineur. Une fuite est irréversible.

### 3.6 Journalisation des franchissements
```sql
CREATE TABLE audit.boundary_crossings (
    id              bigserial PRIMARY KEY,
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    purpose         text NOT NULL,      -- 'stt' | 'live_insight' | 'note_draft' | 'intake_triage'
    provider        text NOT NULL,      -- 'groq' | 'openrouter'
    model           text,
    session_token   uuid,               -- jamais patient_id
    chars_out       integer,
    tokens_in       integer,
    tokens_out      integer,
    cost_usd        numeric(10,6),
    tier0_removed   integer NOT NULL,
    latency_ms      integer,
    outcome         text NOT NULL       -- 'ok' | 'blocked' | 'error'
);
```
> ⚠️ **Aucun contenu n'est stocké ici** — ni l'entrée, ni la sortie. Uniquement des compteurs.
> Un journal qui contient les données qu'il surveille est lui-même une fuite.

Ceci répond directement à Loi 18-07 : registre des traitements et des transferts.

---

## 4. CONTRAT STT (Groq — ADR-002)

### 4.1 Ce qui part
```
POST https://api.groq.com/openai/v1/audio/transcriptions
Authorization: Bearer <GROQ_API_KEY>        ← serveur uniquement

file:            chunk.webm   (segment de 15–20 s, depuis la RAM)
model:           whisper-large-v3-turbo
language:        ar
response_format: verbose_json
prompt:          "Consultation psychiatrique. Arabe algérien (darija) mêlé de français."
```

**Ce qui ne part pas, jamais :** nom de fichier explicite, `patient_id`, nom, date de naissance,
`user` header, aucune métadonnée. Le nom du fichier est le `session_token` seul.

### 4.2 Cycle de vie de l'audio (ADR-009)
```
Micro → MediaRecorder → Blob RAM → POST Groq → texte → INSERT transcript_segments → Blob libéré
                          ▲
                    JAMAIS de disque, JAMAIS d'IndexedDB, JAMAIS de fichier temporaire
```
Contrôle : après une consultation de test, chercher tout `.webm`/`.wav`/`.ogg` sur le disque.
**Résultat attendu : zéro.**

### 4.3 Le `prompt` améliore réellement le darija
Whisper accepte un prompt de contexte. Y placer le vocabulaire du domaine augmente nettement
la qualité sur le mélange darija/français. À enrichir semaine après semaine avec les termes
qu'elle emploie réellement — c'est le levier gratuit le plus rentable du projet.

### 4.4 Résilience réseau (RSK-2)
Coupure Wi-Fi = perte de séance inacceptable.
- Les segments non transmis restent en file **mémoire** avec `seq`
- Rejeu automatique dès reconnexion, dans l'ordre
- Bandeau visible : *« Transcription en attente de réseau — 3 segments »*
- **Le chronomètre et la prise de notes manuelle continuent de fonctionner.**
  L'IA tombe, la consultation continue. Jamais l'inverse.

---

## 5. CONTRAT LLM (OpenRouter — ADR-007)

### 5.1 Passerelle unique
```ts
// src/server/egress/external-call.ts — SEUL endroit où un fournisseur externe est appelé
export async function llm(req: {
  purpose: 'live_insight' | 'note_draft' | 'intake_triage' | 'jarvis';
  messages: Message[];
  patientCtx: PatientContext;
  model?: string;
}): Promise<string> {
  const safe = pseudonymizeMessages(req.messages, req.patientCtx);
  assertSafe(JSON.stringify(safe), req.patientCtx);     // §3.5
  const res  = await callOpenRouter(safe, req.model ?? MODEL_FOR[req.purpose]);
  await logCrossing({ purpose: req.purpose, ... });      // §3.6
  return rehydrate(res, safe.map);
}
```

### 5.2 Table de routage des modèles
```ts
const MODEL_FOR = {
  live_insight:  'anthropic/claude-3.5-haiku',   // latence prioritaire
  note_draft:    'anthropic/claude-sonnet-4.5',  // qualité prioritaire
  intake_triage: 'anthropic/claude-3.5-haiku',
  jarvis:        'google/gemini-2.5-flash',      // décision S6, 2026-08-05
};
```
> **Config, pas code.** Le jour du GPU, cette table pointe vers un endpoint local. Rien d'autre ne bouge.
> C'est exactement la promesse « thin client, fat server ».
>
> **`jarvis` (le seul purpose implémenté à ce jour, S6) tourne sur
> `google/gemini-2.5-flash`**, pas Sonnet 4.5 — décision de produit actée avec
> l'utilisateur le 2026-08-05, après un appel réel à `analyze_session` vérifié
> en local (sortie JSON conforme, coût de l'ordre de 0,0002 USD par appel).
> `live_insight`, `note_draft` et `intake_triage` restent non implémentés :
> leurs entrées ci-dessus sont toujours indicatives, pas des décisions prises.

### 5.3 En-têtes de confidentialité OpenRouter
```
HTTP-Referer: http://localhost
X-Title: MindCare
```
Et dans le tableau de bord OpenRouter : **désactiver la journalisation des prompts**, refuser
tout entraînement sur les données. À vérifier avant le premier appel réel, et à re-vérifier
après tout changement de compte.

### 5.4 Plafonds de dépense
| Garde-fou | Valeur |
|---|---|
| Plafond mensuel OpenRouter | 30 USD (dur, côté fournisseur) |
| Alerte à | 20 USD |
| Plafond par consultation | 0,50 USD → au-delà, l'analyse live s'arrête, la transcription continue |
| Requêtes/min par session | 20 |

---

## 6. SECRETS (R3)

### 6.1 Où vivent les clés
| Secret | Emplacement | Jamais |
|---|---|---|
| `GROQ_API_KEY` | env Edge Function | client, dépôt, chat |
| `OPENROUTER_API_KEY` | env Edge Function | client, dépôt, chat |
| `SUPABASE_SERVICE_ROLE_KEY` | env serveur | **client, absolument** |
| `SUPABASE_ANON_KEY` | client — c'est son rôle | — |
| Mot de passe Postgres | env Docker + gestionnaire hors ligne | dépôt |

### 6.2 `.gitignore` — premier commit, avant tout
```
.env
.env.*
!.env.example
supabase/.env
*.key
*.pem
backups/
volumes/
```

### 6.3 Règles de rotation
- Toute clé apparue dans un chat, une capture d'écran ou un commit est **compromise** :
  révocation immédiate, pas de débat, pas de délai.
- Rotation planifiée : tous les 90 jours.
- Une clé distincte par usage (Groq ≠ OpenRouter) → révocation ciblée sans tout casser.

---

## 7. SÉCURITÉ DU POSTE (Windows 10 Pro)

### 7.1 Obligatoire — semaine 1
| # | Mesure | Pourquoi |
|---|---|---|
| S1 | **BitLocker** sur le disque système | PC volé = dossiers psychiatriques dans la nature |
| S2 | Comptes Windows séparés (ADR-013) | RLS inutile si l'assistante lit le conteneur Docker |
| S3 | Verrouillage auto à 5 min + mot de passe | La praticienne quitte son bureau |
| S4 | Pare-feu : Postgres (5432) **jamais** exposé au-delà du LAN | Base directement accessible sinon |
| S5 | Docker lié à `127.0.0.1` uniquement | Erreur de configuration la plus courante |
| S6 | Wi-Fi cabinet WPA2/3, mot de passe fort, réseau invité séparé | Salle d'attente = réseau hostile |
| S7 | Mises à jour Windows activées | EOL, mais les correctifs restants comptent |

### 7.2 Le QR et le réseau
Le téléphone du patient doit atteindre le formulaire. Trois options :

| Option | Sécurité | Verdict |
|---|---|---|
| Wi-Fi invité → serveur local | 🟢 rien ne sort | ✅ **recommandé** |
| Tunnel Tailscale/Cloudflare | 🟡 sort mais chiffré | acceptable |
| Port ouvert sur le modem | 🔴 base médicale sur Internet public | ❌ **jamais** |

> **Choix retenu : réseau invité isolé.** Le formulaire d'accueil est servi sur le LAN uniquement.
> Le patient n'a même pas besoin d'Internet. C'est plus simple **et** plus sûr — cas rare, on le prend.

### 7.3 Isolement du formulaire d'accueil
Le formulaire QR est accessible sans authentification. Il doit donc être **une application
distincte, en écriture seule**, avec une clé Supabase limitée à `INSERT` sur `pending_patients`.
```sql
CREATE ROLE intake_writer NOLOGIN;
GRANT INSERT ON app.pending_patients TO intake_writer;
GRANT SELECT ON app.intake_forms, app.intake_questions TO intake_writer;
-- Aucun accès à app.patients. Aucun SELECT sur pending_patients.
```
> ⚠️ Sans `SELECT`, une injection sur ce formulaire ne peut **rien lire**. C'est le point le plus
> exposé du système et il ne doit donner accès à rien.

---

## 8. VÉRIFICATIONS AUTOMATIQUES

### 8.1 Interdiction de sortie sauvage
```bash
# CI — échoue si un fetch externe existe hors passerelle
grep -rn "fetch(['\"]https://" --include="*.ts" --include="*.tsx" src/ supabase/ \
  | grep -v "src/server/egress/external-call.ts" \
  && echo "❌ APPEL EXTERNE HORS PASSERELLE" && exit 1
```

### 8.2 Interdiction de secrets côté client
```bash
grep -rn "SERVICE_ROLE\|GROQ_API_KEY\|OPENROUTER_API_KEY" src/ \
  && echo "❌ SECRET CÔTÉ CLIENT" && exit 1
```

### 8.3 Vérification de la frontière — test unitaire obligatoire
```ts
test('aucune donnée Tier 0 ne franchit la frontière', () => {
  const ctx = { firstName:'Nassim', lastName:'Belkacem', phone:'0555123456', ... };
  const raw = "Nassim Belkacem, 0555123456, dit que sa femme Amina l'a quitté";
  const out = pseudonymize(raw, ctx);
  expect(out.text).not.toContain('Nassim');
  expect(out.text).not.toContain('Belkacem');
  expect(out.text).not.toContain('0555123456');
  expect(out.text).not.toContain('Amina');       // ← le cas difficile, celui qui compte
  expect(() => assertSafe(out.text, ctx)).not.toThrow();
});
```

---

## 9. CONSENTEMENT (Mois 1 — papier)

Deux formulaires à faire signer, à conserver et à scanner :

**C1 — Consentement à la transcription assistée**
> « Vos échanges avec le médecin sont transcrits automatiquement afin d'établir le compte rendu
> de consultation. **Aucun enregistrement audio n'est conservé.** Le texte est traité par un
> prestataire technique après suppression de toute donnée permettant de vous identifier
> (nom, téléphone, adresse). Vous pouvez refuser sans aucune conséquence sur votre prise en charge. »

**C2 — Consentement au traitement des données**
Finalité, durée de conservation, droits d'accès et de rectification, coordonnées de la responsable
de traitement (Dr. Larbi N.).

> 🔴 **Le refus doit être réellement possible.** Un bouton « Transcription désactivée » dans
> l'écran de consultation, qui fonctionne vraiment. Un consentement qu'on ne peut pas refuser
> n'est pas un consentement — juridiquement, il ne vaut rien.

---

## 10. EN CAS D'INCIDENT

| Événement | Action immédiate |
|---|---|
| Clé exposée | Révoquer, régénérer, redéployer. < 15 min. |
| `BoundaryViolation` déclenchée | Bloquer la fonctionnalité, examiner, corriger le pseudonymiseur. **Ne pas contourner.** |
| PC volé | BitLocker protège. Révoquer toutes les clés. Restaurer sur nouveau poste. |
| Ransomware | Sauvegarde externe débranchée (ADR-014) = seule défense réelle. |
| Fuite Tier 0 avérée | Consigner, notifier la praticienne, évaluer l'obligation d'information des personnes (Loi 18-07). |

---

## 11. CE QUE CE DOCUMENT N'AFFIRME PAS

Honnêteté nécessaire, à transmettre telle quelle à la praticienne :

1. **La pseudonymisation n'est pas l'anonymisation.** Un récit clinique suffisamment détaillé
   reste théoriquement ré-identifiable. Nous réduisons fortement le risque ; nous ne l'annulons pas.
2. **La Passe B est probabiliste.** Un prénom rare ou mal orthographié peut passer. C'est pourquoi
   la Passe A (déterministe) porte l'essentiel, et pourquoi le garde-fou §3.5 existe.
3. **Le Mois 1 est un compromis assumé**, imposé par le matériel. Il est documenté, borné,
   consenti, et prend fin à l'arrivée du GPU.
4. **Windows 10 est en fin de support.** Aucune mesure logicielle ne compense entièrement cela.

> Ces limites sont écrites ici pour être **dites au client**, pas pour être découvertes plus tard.

---

*Fin du document. Prochain livrable : `03-JARVIS-TOOLS.md` — allowlist d'outils, contrat propose→confirme→exécute→journalise, schémas d'arguments.*
