# Cockpit consultation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the consultation screen as a light, dense clinical cockpit without touching any backend gate, porte, or security rule.

**Architecture:** Seven new presentational components under `src/components/consultation/cockpit/` reuse `ui/*` primitives and existing service functions only; the page keeps all its state machines (`charger`, autosave, `signer`, `clore`, `analyserSeance`) and only swaps layout. All Phase 1 writes resolve to text injected through `saveNote`/`saveRawNotes`. dossier reads stay lazy and user-initiated so the opening-call budget (06-PERF, e2e O5) does not move.

**Tech Stack:** Next.js 15 + React 19, Tailwind tokens from `src/styles/tokens.css` only, vitest (node env, pure logic only), Playwright chromium.

**Spec:** `docs/superpowers/specs/2026-09-11-cockpit-consultation-design.md` — the plan argues from the spec; executors read both. Deviations from the spec are locked in Task 0 and nowhere else.

## Global Constraints

- Package manager is `pnpm` (`pnpm-lock.yaml`). Commands: `pnpm test`, `pnpm typecheck` (`tsc --noEmit && tsc -p tsconfig.test.json`), `pnpm lint` (`eslint .`), `pnpm exec playwright test <spec>`.
- vitest is `environment: node`, `include: tests/unit/**/*.test.ts` (`vitest.config.ts:34-45`). No DOM tests. Component correctness is proven by `tsc` + `eslint` + Playwright.
- Every task's requirements implicitly include the spec §3 invariants (one write = one porte, `trg_note_immutable` decides, human-only signature, no DELETE, cloison ADR-003 single message, tariff required to close, Jarvis write:false, `amount_dzd` int, `Africa/Algiers`, zero hard-coded strings, colors from `tokens.css` only).
- `src/i18n/fr.ts` is additive-only (god-file, Phase 6 split pending). `supabase/migrations/` applied files are never edited.
- Do NOT commit (repo rule: commits only on explicit order). Each task's last step is `git status` + `git diff --stat` review, no commit.
- No PII in tests: fixtures are hand-written (`vitest.config.ts:48-50`).
- Import order follows existing files: `react`/`next` first, then `@/components/*`, `@/services/*`, `@/i18n/fr`, relative last. `"use client"` on every component file (they all use state), never on the pure logic file.
- Only verified icon names (`ui/Icones.tsx:50-61` + `NomEcran` keys `fr.ts:40-53`): `patients`, `agenda`, `documents`, `traitements`, `suivi`, `finances`, `jarvis`, `horloge`, `alerte`, `plus`, `chevron`, `fleche`, `croix`, `recherche`, `audio`, `tableauDeBord`, `messages`, `statistiques`, `agents`, `journalActivite`, `parametres`, `deconnexion`.

---

## File structure

Created:

- `src/components/consultation/cockpit/modele-cockpit.ts` — pure logic: scale-delta sense, focus-marker application, quick-pick insertion. Zero imports except types. (Task 2)
- `src/components/consultation/cockpit/CockpitHeader.tsx` — compact header, presentational. (Task 3)
- `src/components/consultation/cockpit/EtatClinique.tsx` — echelles + diagnostics rows with delta badges and insert actions. (Task 4)
- `src/components/consultation/cockpit/FocusSeance.tsx` — controlled multi-select chips + free field + explicit apply. (Task 5)
- `src/components/consultation/cockpit/DepuisDerniere.tsx` — composition of the three deterministic sections. (Task 6)
- `src/components/consultation/cockpit/NotesStructurees.tsx` — 4 compact SOAP editors with quick-picks, favoris, dictee slot. (Task 7)
- `src/components/consultation/cockpit/RailContexte.tsx` — collapsible right rail: previous sessions, mini-timeline, treatment snapshot, Jarvis slot. (Task 8)
- `src/components/consultation/cockpit/BarreConsultation.tsx` — sticky bottom completion bar. (Task 9)
- `tests/unit/modele-cockpit.test.ts`, `tests/unit/cockpit-cles.test.ts` — unit tests on real modules. (Tasks 1-2)
- `tests/e2e/consultation-cockpit.spec.ts` — e2e + screenshots. (Task 11)
- `docs/superpowers/specs/0NN_etat_seance.DRAFT.sql` — Phase 2 draft, never under `supabase/migrations/`. (Task 12)

Modified:

- `src/i18n/fr.ts` — additive `consultation.cockpit` namespace only. (Task 1)
- `src/components/ui/Bouton.tsx` — additive `enfonce` prop only. (Task 5)
- `src/app/consultation/[id]/page.tsx` — layout rewire only, logic preserved. (Task 10)
- `docs/superpowers/specs/2026-09-11-cockpit-consultation-design.md` — Task 0 deviation patches. (Task 0)

Explicitly NOT touched: `src/styles/tokens.css` (no new token needed — verified palette covers all uses), migrations, Jarvis registry, `AppShell.tsx`, `BlocTarif.tsx`, `PanneauHistorique.tsx`, `PanneauTraitements.tsx`, `SectionsDeterministes.tsx`, finance/agenda/patients services.

---

### Task 0: Lock spec deviations (reality over decoration)

**Files:**
- Modify: `docs/superpowers/specs/2026-09-11-cockpit-consultation-design.md`

**Interfaces:**
- Consumes: nothing. Produces: corrected §4 wording every later task relies on.

Three deviations, all forced by verified reality (data integrity beats decoration):

1. Spec §4/§14 promised segmented sommeil/énergie controls. No such columns exist and `save_note` refuses non-SOAP keys (`026:397-402`). The quick-check is therefore echelle-driven (display + delta + insert), and sommeil-style segmented controls move to Phase 2.
2. Spec §4 promised green/amber delta badges. Scale polarity is unknown (a rising anxiety score shown green would be a clinical lie), so hausse/baisse badges use the neutral `info` tone with arrow + signed number + words; green (`text-positive`) is reserved for `Stable`, amber for nothing here.
3. Spec §16 promised a synthetic `↑/↓/→/✓/⚠` strip. The workspace exposes facts, not events, so `DepuisDerniere` reuses the three deterministic sections without inventing event items.

- [ ] **Step 1: Patch the EtatClinique bullet**

Replace the sentence starting `Contrôles variés : segmentés (sommeil` with: `Contrôles adaptés aux domaines réellement disponibles (aucune colonne humeur/sommeil/énergie n'existe — voir §2) : chaque échelle affiche dernier score + interprétation + badge Δ neutre (flèche + valeur signée + mot, ton info ; vert réservé à Stable) + provenance datée + bouton Inscrire ; chaque diagnostic affiche pastille + libellé + mention Principal le cas échéant + bouton Inscrire. Les contrôles segmentés par domaine (sommeil, énergie…) sont reportés à la Phase 2.`

- [ ] **Step 2: Patch the DepuisDerniere bullet**

Append to the `DepuisDerniere.tsx` bullet: `Aucun bandeau synthétique ↑/↓/→/✓/⚠ : seules les sections déterministes existantes sont composées, sans item inventé.`

- [ ] **Step 3: Verify**

Run: `rg -n "sommeil : Bon|vert /|bandeau interactif" docs/superpowers/specs/2026-09-11-cockpit-consultation-design.md`
Expected: no output.

- [ ] **Step 4: Stage review (DO NOT COMMIT)**

Run: `git status --short; if ($?) { git diff --stat }`
Expected: only the spec file modified.

---

### Task 1: i18n keys (additive) + key-guard test

**Files:**
- Modify: `src/i18n/fr.ts` (inside `consultation: { … }`, after `nonEnregistreIndication`, add a `cockpit: { … }` block; nothing else moves)
- Test: `tests/unit/cockpit-cles.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: `fr.consultation.cockpit.*` keys consumed by Tasks 3-10. Exact key names and French strings are locked here; later tasks must use these names verbatim.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Garde-fous du namespace cockpit — `fr.ts` est un god-file souvent édité,
 * ces clés portent tout le cockpit. Données écrites à la main, aucune PII.
 */
import { describe, expect, it } from "vitest";

import { fr } from "../../src/i18n/fr";

describe("cles cockpit", () => {
  it("expose les titres de section", () => {
    expect(fr.consultation.cockpit.etatTitre).toBe("État clinique");
    expect(fr.consultation.cockpit.focusTitre).toBe("Focus de la séance");
    expect(fr.consultation.cockpit.derniereTitre).toBe("Séance précédente");
    expect(fr.consultation.cockpit.traitementTitre).toBe("Traitement actuel");
  });

  it("expose sept options de focus, sans chaîne en dur dans les composants", () => {
    expect(fr.consultation.cockpit.focusOptions).toEqual([
      "Anxiété",
      "Sommeil",
      "Humeur",
      "Traitement",
      "Travail",
      "Relations",
      "Événement récent",
    ]);
  });

  it("expose au moins deux pistes sûres par rubrique SOAP", () => {
    const pistes = fr.consultation.cockpit.pistes;
    for (const champ of ["subjective", "objective", "assessment", "plan"] as const) {
      expect(pistes[champ].length).toBeGreaterThanOrEqual(2);
      for (const p of pistes[champ]) expect(p.trim().length).toBeGreaterThan(0);
    }
  });

  it("expose les libellés du rail et de la barre", () => {
    expect(fr.consultation.cockpit.railCharger).toBe("Charger le contexte patient");
    expect(fr.consultation.cockpit.tarifManquant).toBe("Tarif à fixer");
    expect(fr.consultation.cockpit.notesPlaceholder).toBe("Commencer à écrire ou dicter…");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/cockpit-cles.test.ts`
Expected: FAIL with `fr.consultation.cockpit` undefined (also proves `fr.ts` imports cleanly in node).

- [ ] **Step 3: Add the keys (additive block only)**

Insert after the `nonEnregistreIndication` entry of `consultation:` (file `src/i18n/fr.ts:1015-1016`):

```ts
    cockpit: {
      etatTitre: "État clinique",
      echellesTitre: "Échelles",
      diagnosticsTitre: "Diagnostics",
      etatVide: "Aucune échelle ni diagnostic à afficher pour l'instant.",
      premiereMesure: "Première mesure — sans comparaison.",
      hausse: "en hausse",
      baisse: "en baisse",
      stable: "Stable",
      inserer: "Inscrire dans la note",
      diagnosticPrincipal: "Principal",
      focusTitre: "Focus de la séance",
      focusOptions: [
        "Anxiété",
        "Sommeil",
        "Humeur",
        "Traitement",
        "Travail",
        "Relations",
        "Événement récent",
      ],
      focusLibre: "Autre (préciser…)",
      focusAppliquer: "Inscrire dans Subjectif",
      pistes: {
        subjective: ["Humeur stable, sans idée noire", "Sommeil conservé", "Anxiété contenue"],
        objective: ["Contact adapté", "Discours cohérent", "Aucun trouble du comportement"],
        assessment: ["État stable", "Amélioration partielle", "À réévaluer"],
        plan: ["Poursuivre le traitement", "Revoir dans un mois", "Bilan à prévoir"],
      },
      favorisTitre: "Mes formules",
      favoriMemoriser: "Mémoriser la formulation",
      favoriRetirer: "Retirer",
      notesPlaceholder: "Commencer à écrire ou dicter…",
      railTitre: "Contexte",
      railReplier: "Replier le contexte",
      railDeplier: "Afficher le contexte",
      railCharger: "Charger le contexte patient",
      contexteInaccessible: "Le contexte clinique n'est pas accessible avec ce rôle.",
      derniereTitre: "Séance précédente",
      sansPrecedente: "Aucune séance précédente disponible.",
      aujourdhui: "Aujourd'hui",
      sansProchain: "Aucun rendez-vous à venir.",
      traitementTitre: "Traitement actuel",
      traitementVide: "Aucun traitement actif",
      traitementModifier: "Modifier",
      tarifFixe: "Tarif fixé",
      tarifManquant: "Tarif à fixer",
      tarifVoir: "Voir",
    },
```

Presets are deliberately neutral/stable wordings: they are inserted only on explicit click and remain editable before signature.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/cockpit-cles.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Typecheck the touched file**

Run: `pnpm typecheck`
Expected: PASS (proves the literal block typechecks against `fr` consumers).

- [ ] **Step 6: Stage review (DO NOT COMMIT)**

Run: `git status --short; if ($?) { git diff --stat }`
Expected: `src/i18n/fr.ts` + new test only.

---

### Task 2: Pure cockpit logic + unit tests (TDD)

**Files:**
- Create: `src/components/consultation/cockpit/modele-cockpit.ts`
- Test: `tests/unit/modele-cockpit.test.ts`

**Interfaces:**
- Consumes: `import type { EchelleResume } from "@/services/patients"` (type-only) and `import type { ChampSoap } from "@/services/consultations"` (type-only). Produces: `sensDelta`, `texteDelta`, `appliquerFocus`, `ajouterPiste` consumed by Tasks 4, 5, 7, 10 with the exact signatures below.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * Logique pure du cockpit — sens d'un delta, marqueur de focus, insertion
 * d'une piste. Données écrites à la main, aucune PII.
 */
import { describe, expect, it } from "vitest";

import {
  ajouterPiste,
  appliquerFocus,
  sensDelta,
  texteDelta,
} from "../../src/components/consultation/cockpit/modele-cockpit";
import type { EchelleResume } from "../../src/services/patients";

function echelle(delta: number | null, avecPrecedent: boolean): EchelleResume {
  return {
    scaleCode: "PHQ9",
    scaleName: "PHQ-9",
    dernier: { score: 12, date: "2026-09-11T10:00:00+01:00", interpretation: "modéré" },
    precedent: avecPrecedent
      ? { score: 10, date: "2026-08-28T10:00:00+01:00" }
      : null,
    delta,
  };
}

describe("sensDelta", () => {
  it("ne dessine jamais de tendance sur une mesure unique", () => {
    expect(sensDelta(echelle(2, false))).toBe("aucune");
    expect(sensDelta(echelle(null, true))).toBe("aucune");
  });

  it("dit hausse, baisse ou stable sans juger cliniquement", () => {
    expect(sensDelta(echelle(2, true))).toBe("hausse");
    expect(sensDelta(echelle(-3, true))).toBe("baisse");
    expect(sensDelta(echelle(0, true))).toBe("stable");
  });
});

describe("texteDelta", () => {
  it("signe la valeur, null quand il n'y a rien à comparer", () => {
    expect(texteDelta(2)).toBe("+2");
    expect(texteDelta(-3)).toBe("−3");
    expect(texteDelta(0)).toBe("0");
    expect(texteDelta(null)).toBeNull();
  });
});

describe("appliquerFocus", () => {
  it("ne touche à rien quand la sélection est vide", () => {
    expect(appliquerFocus("Texte libre.", [])).toBe("Texte libre.");
  });

  it("préfixe le marqueur devant le subjectif existant", () => {
    expect(appliquerFocus("Texte libre.", ["Anxiété", "Sommeil"])).toBe(
      "Focus : Anxiété, Sommeil — Texte libre.",
    );
  });

  it("remplace le marqueur au lieu de l'empiler (idempotent)", () => {
    const une = appliquerFocus("Texte.", ["Anxiété"]);
    const deux = appliquerFocus(une, ["Sommeil"]);
    expect(deux).toBe("Focus : Sommeil — Texte.");
  });
});

describe("ajouterPiste", () => {
  it("pose la piste seule sur un champ vide", () => {
    expect(ajouterPiste("", "Contact adapté")).toBe("Contact adapté");
  });

  it("ajoute à la ligne sans dupliquer au second clic", () => {
    const un = ajouterPiste("Début.", "Contact adapté");
    expect(un).toBe("Début.\n• Contact adapté");
    expect(ajouterPiste(un, "Contact adapté")).toBe(un);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/modele-cockpit.test.ts`
Expected: FAIL with "Failed to resolve import" (module does not exist).

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Logique pure du cockpit — aucune écriture, aucun appel, aucun DOM.
 *
 * Ce module ne connaît ni les portes ni les composants : il calcule le sens
 * d'un delta d'échelle, applique un marqueur de focus et insère une piste de
 * texte. L'écriture passe ensuite par `saveNote`, jamais par ici.
 */

import type { EchelleResume } from "@/services/patients";

/**
 * Sens FACTUEL d'un delta, sans jugement clinique : la polarité d'une
 * échelle (haut = mieux ou pire) n'est pas connue ici, donc `hausse` ne
 * veut jamais dire « amélioration ».
 */
export type SensDelta = "hausse" | "baisse" | "stable" | "aucune";

export function sensDelta(echelle: EchelleResume): SensDelta {
  if (echelle.precedent === null || echelle.delta === null) return "aucune";
  if (echelle.delta > 0) return "hausse";
  if (echelle.delta < 0) return "baisse";
  return "stable";
}

/** Valeur signée (`+2`, `−3`, `0`), `null` quand rien n'est comparable. */
export function texteDelta(delta: number | null): string | null {
  if (delta === null) return null;
  if (delta > 0) return `+${String(delta)}`;
  // Moins typographique U+2212, pas le trait d'union : un score négatif se
  // lit, il ne se devine pas.
  if (delta < 0) return `−${String(Math.abs(delta))}`;
  return "0";
}

/**
 * Préfixe `Focus : a, b — ` au subjectif. Idempotent : un marqueur existant
 * est remplacé, jamais empilé. Sélection vide = texte inchangé (on ne
 * retire jamais une formulation du médecin par effet de bord).
 */
export function appliquerFocus(texte: string, selection: readonly string[]): string {
  if (selection.length === 0) return texte;
  const marqueur = `Focus : ${selection.join(", ")} — `;
  if (/^Focus\s*:/.test(texte)) return texte.replace(/^Focus\s*:[^\n]*—\s?/, marqueur);
  return marqueur + texte;
}

/**
 * Ajoute une piste à la ligne sous le texte existant. Second clic sans
 * effet : pas de doublon au double-clic.
 */
export function ajouterPiste(texte: string, piste: string): string {
  if (texte.trim() === "") return piste;
  if (texte.includes(piste)) return texte;
  return `${texte.trimEnd()}\n• ${piste}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/modele-cockpit.test.ts`
Expected: PASS (all suites). If the `−` (U+2212) assertion fails on encoding, keep U+2212 in both test and implementation (already the case).

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Stage review (DO NOT COMMIT)**

Run: `git status --short; if ($?) { git diff --stat }`
Expected: two new files only.

---

### Task 3: CockpitHeader (compact header, presentational)

**Files:**
- Create: `src/components/consultation/cockpit/CockpitHeader.tsx`

**Interfaces:**
- Consumes: `fr` (no new keys), `React.ReactNode` slots. Produces: `CockpitHeader` consumed by Task 10 as `<CockpitHeader titre={…} meta={…} chrono={…} retour={…} />`.

- [ ] **Step 1: Create the component (no unit test possible — node env has no DOM; covered by Task 11 e2e)**

```tsx
"use client";

/**
 * En-tête compact du cockpit — le nom, son contexte, le chrono, la sortie.
 *
 * Le chrono arrive en `ReactNode` (`ChronoSeance` reste propriétaire de son
 * tick dans la page) et le retour aussi (`LienBouton` garde sa sémantique
 * de lien). `meta` est déjà composée par l'appelant (`type · date`) ou
 * `null` : aucun formatage ici, donc aucune décision ici.
 */
export function CockpitHeader({
  titre,
  meta,
  chrono,
  retour,
}: {
  readonly titre: string;
  readonly meta: string | null;
  readonly chrono: React.ReactNode;
  readonly retour: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-rule pb-4">
      <div className="flex min-w-0 items-center gap-3">
        {retour}
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-rule" />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate font-ui text-heading font-bold text-ink-900">{titre}</h1>
          {meta === null ? null : (
            <p className="truncate font-ui text-label text-ink-500">{meta}</p>
          )}
        </div>
      </div>
      <p className="flex shrink-0 items-center gap-2 font-num text-num font-semibold tabular-nums text-ink-900">
        {chrono}
      </p>
    </header>
  );
}
```

- [ ] **Step 2: Typecheck + lint the new file**

Run: `pnpm exec tsc --noEmit; if ($?) { pnpx eslint src/components/consultation/cockpit/CockpitHeader.tsx }`
Expected: PASS, no warnings. (Use `pnpm exec eslint` if `pnpx` is unavailable.)

- [ ] **Step 3: Stage review (DO NOT COMMIT)**

Run: `git status --short`
Expected: one new file.

---

### Task 4: EtatClinique (echelle-driven quick-check)

**Files:**
- Create: `src/components/consultation/cockpit/EtatClinique.tsx`

**Interfaces:**
- Consumes: `sensDelta`, `texteDelta` (Task 2, exact names); `EchelleResume`, `Diagnostic` types (`@/services/patients`); `fr.consultation.cockpit.*` (Task 1); `Section`, `PastilleIcone`, `Bouton`, `EtatVide` (`@/components/ui`); `jourComplet` (`@/components/AgendaPieces`); `ChampSoap` type (`@/services/consultations`). Produces: `EtatClinique` consumed by Task 10 as `<EtatClinique echelles={…} diagnostics={…} modifiable={…} onInserer={…} />` where `onInserer: (champ: ChampSoap, texte: string) => void`.

Rules: every row shows icon + words + number (never color alone); hausse/baisse badges use `text-azure-700`, stable uses `text-positive`, `aucune` shows `premiereMesure` in `text-ink-500`; insert buttons render only when `modifiable` is true; empty lists render one honest `EtatVide` (no decorative card).

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { jourComplet } from "@/components/AgendaPieces";
import { Bouton, EtatVide, PastilleIcone, Section } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { ChampSoap } from "@/services/consultations";
import type { Diagnostic, EchelleResume } from "@/services/patients";

import { sensDelta, texteDelta, type SensDelta } from "./modele-cockpit";

const ENCRE_SENS: Record<SensDelta, string> = {
  hausse: "text-azure-700",
  baisse: "text-azure-700",
  stable: "text-positive",
  aucune: "text-ink-500",
};

function BadgeEchelle({ echelle }: { readonly echelle: EchelleResume }): React.JSX.Element {
  const sens = sensDelta(echelle);
  const cockpit = fr.consultation.cockpit;
  if (sens === "aucune") {
    return (
      <span className="font-ui text-label text-ink-500">{cockpit.premiereMesure}</span>
    );
  }
  const mot = sens === "hausse" ? cockpit.hausse : sens === "baisse" ? cockpit.baisse : cockpit.stable;
  const fleche = sens === "hausse" ? "↑" : sens === "baisse" ? "↓" : "→";
  const valeur = texteDelta(echelle.delta);
  return (
    <span className={["font-ui text-label font-semibold tabular-nums", ENCRE_SENS[sens]].join(" ")}>
      <span aria-hidden="true">{fleche} </span>
      {valeur === null ? mot : `${valeur} ${mot}`}
    </span>
  );
}

/**
 * Le quick-check clinique — échelles et diagnostics RÉELS, rien d'autre.
 *
 * Chaque ligne se lit (icône + nom + score + badge + date) et agit
 * (`Inscrire dans la note` recopie une phrase factuelle dans la rubrique
 * Objectif via `onInserer`, donc via `saveNote`). Aucune persistance
 * nouvelle : l'écriture reste du texte.
 */
export function EtatClinique({
  echelles,
  diagnostics,
  modifiable,
  onInserer,
}: {
  readonly echelles: readonly EchelleResume[];
  readonly diagnostics: readonly Diagnostic[];
  readonly modifiable: boolean;
  readonly onInserer: (champ: ChampSoap, texte: string) => void;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;
  const vide = echelles.length === 0 && diagnostics.length === 0;

  function phraseEchelle(echelle: EchelleResume): string {
    const score = echelle.dernier.score === null ? "" : ` ${String(echelle.dernier.score)}`;
    const lecture =
      echelle.dernier.interpretation === null ? "" : ` (${echelle.dernier.interpretation})`;
    return `${echelle.scaleName} :${score}${lecture}`;
  }

  return (
    <Section titre={cockpit.etatTitre} icone="suivi">
      {vide ? (
        <EtatVide message={cockpit.etatVide} icone="suivi" />
      ) : (
        <div className="flex flex-col gap-6">
          {echelles.length === 0 ? null : (
            <div className="flex flex-col">
              <p className="font-ui text-label font-medium uppercase tracking-label text-ink-500">
                {cockpit.echellesTitre}
              </p>
              <ul className="m-0 flex list-none flex-col p-0">
                {echelles.map((e) => (
                  <li
                    key={e.scaleCode}
                    className="flex flex-wrap items-center gap-3 border-b border-rule py-3 last:border-0"
                  >
                    <PastilleIcone nom="suivi" ton="info" />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-ui text-body font-semibold text-ink-900">
                        {e.scaleName}
                        <span className="ml-2 font-num text-body font-semibold tabular-nums">
                          {e.dernier.score === null ? fr.etats.texteAbsent : String(e.dernier.score)}
                        </span>
                      </span>
                      <span className="font-ui text-label tabular-nums text-ink-500">
                        {jourComplet(e.dernier.date) ?? e.dernier.date}
                        {e.dernier.interpretation === null ? "" : ` · ${e.dernier.interpretation}`}
                      </span>
                    </span>
                    <BadgeEchelle echelle={e} />
                    {modifiable ? (
                      <Bouton rang="discret" onClick={() => onInserer("objective", phraseEchelle(e))}>
                        {cockpit.inserer}
                      </Bouton>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diagnostics.length === 0 ? null : (
            <div className="flex flex-col">
              <p className="font-ui text-label font-medium uppercase tracking-label text-ink-500">
                {cockpit.diagnosticsTitre}
              </p>
              <ul className="m-0 flex list-none flex-col p-0">
                {diagnostics.map((d) => (
                  <li
                    key={d.id}
                    className="flex flex-wrap items-center gap-3 border-b border-rule py-3 last:border-0"
                  >
                    <PastilleIcone nom="patients" ton="neutre" />
                    <span className="min-w-0 flex-1 font-ui text-body font-medium text-ink-900">
                      {d.label}
                      {d.isPrimary ? (
                        <span className="ml-2 font-ui text-label text-ink-500">
                          {cockpit.diagnosticPrincipal}
                        </span>
                      ) : null}
                    </span>
                    {modifiable ? (
                      <Bouton
                        rang="discret"
                        onClick={() => onInserer("assessment", d.label)}
                      >
                        {cockpit.inserer}
                      </Bouton>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm exec tsc --noEmit; if ($?) { pnpm exec eslint src/components/consultation/cockpit/EtatClinique.tsx }`
Expected: PASS. If `fr.etats.texteAbsent` fails typecheck, read the `etats` block of `fr.ts` and use the exact key (do not invent one).

- [ ] **Step 3: Stage review (DO NOT COMMIT)**

Run: `git status --short`
Expected: one new file.

---

### Task 5: Bouton `enfonce` + FocusSeance

**Files:**
- Modify: `src/components/ui/Bouton.tsx` (additive `enfonce` prop only)
- Create: `src/components/consultation/cockpit/FocusSeance.tsx`

**Interfaces:**
- Consumes: `fr.consultation.cockpit.focusOptions` (readonly string[]), `focusLibre`, `focusAppliquer`, `focusTitre`. Produces: `FocusSeance` consumed by Task 10 as `<FocusSeance options={…} selection={…} onChanger={…} libre={…} onLibre={…} onAppliquer={…} peutAppliquer={…} />`.

- [ ] **Step 1: Add `enfonce` to Bouton (additive, no existing behavior changes)**

In `BoutonProps` add:

```ts
  /**
   * Le bouton est un interrupteur ENFONCÉ (chip multi-sélection).
   * Rend `aria-pressed` : sans lui, un lecteur d'écran annonce « bouton »
   * sans dire si le choix est actif. Laisser `undefined` pour un bouton
   * ordinaire — un `aria-pressed="false"` sur une commande ment tout autant.
   */
  readonly enfonce?: boolean;
```

Destructure `enfonce` (default `undefined`) and pass `aria-pressed={enfonce}`, appending the selected style when `enfonce === true`:

```ts
enfonce === true ? "border-action-600 bg-action-50 text-ink-900" : "",
```

to the button `className` array. Tokens `border-action-600`, `bg-action-50` exist (`Champs.tsx` focus uses `outline-action-600`; `BlocTarif`/chips use `bg-action-50`).

- [ ] **Step 2: Create FocusSeance**

```tsx
"use client";

import { Bouton, ChampTexte } from "@/components/ui";
import { fr } from "@/i18n/fr";

/**
 * Le focus de la séance — choix multiples explicites + champ libre.
 *
 * Contrôlé par la page (`selection`, `libre`). Rien ne s'écrit tout seul :
 * `onAppliquer` recopie le marqueur dans Subjectif via `appliquerFocus`
 * (modele-cockpit) puis `saveNote`. Cocher ne réécrit jamais la note.
 */
export function FocusSeance({
  options,
  selection,
  onChanger,
  libre,
  onLibre,
  onAppliquer,
  peutAppliquer,
}: {
  readonly options: readonly string[];
  readonly selection: readonly string[];
  readonly onChanger: (suivant: readonly string[]) => void;
  readonly libre: string;
  readonly onLibre: (v: string) => void;
  readonly onAppliquer: () => void;
  readonly peutAppliquer: boolean;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;

  function basculer(option: string): void {
    onChanger(
      selection.includes(option)
        ? selection.filter((s) => s !== option)
        : [...selection, option],
    );
  }

  return (
    <section aria-label={cockpit.focusTitre} className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Bouton
            key={option}
            rang="secondaire"
            enfonce={selection.includes(option)}
            onClick={() => basculer(option)}
          >
            {option}
          </Bouton>
        ))}
      </div>
      <ChampTexte libelle={cockpit.focusLibre} valeur={libre} onChange={onLibre} />
      <div>
        <Bouton rang="secondaire" onClick={onAppliquer} disabled={!peutAppliquer}>
          {cockpit.focusAppliquer}
        </Bouton>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Typecheck + lint both files**

Run: `pnpm exec tsc --noEmit; if ($?) { pnpm exec eslint src/components/ui/Bouton.tsx src/components/consultation/cockpit/FocusSeance.tsx }`
Expected: PASS (proves no existing `Bouton` caller broke — the prop is optional).

- [ ] **Step 4: Stage review (DO NOT COMMIT)**

Run: `git status --short; if ($?) { git diff --stat }`
Expected: one modified + one new file.

---

### Task 6: DepuisDerniere (deterministic composition)

**Files:**
- Create: `src/components/consultation/cockpit/DepuisDerniere.tsx`

**Interfaces:**
- Consumes: `PointDeSituation`, `SectionDepuisDerniere`, `ListeSignaux` (`@/components/patients/SectionsDeterministes`, exact names verified `SectionsDeterministes.tsx:21,91` + `PointDeSituation` in same file); `PatientWorkspace` type. Produces: `DepuisDerniere` consumed by Task 10 as `<DepuisDerniere espace={dossier} />`.

- [ ] **Step 1: Create the component**

```tsx
/**
 * « Depuis la dernière séance » — les trois sections déterministes, sans
 * copie et sans invention.
 *
 * Mêmes composants que l'onglet Résumé (`page.tsx:1653-1656`), donc mêmes
 * chiffres : deux écrans ne peuvent pas diverger puisqu'ils partagent la
 * règle de calcul. Aucun bandeau synthétique : ce qui n'est pas dans le
 * dossier ne s'affiche pas.
 */
import {
  ListeSignaux,
  PointDeSituation,
  SectionDepuisDerniere,
} from "@/components/patients/SectionsDeterministes";
import type { PatientWorkspace } from "@/services/patients";

export function DepuisDerniere({
  espace,
}: {
  readonly espace: PatientWorkspace;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6 divide-y divide-rule [&>*:not(:first-child)]:pt-6">
      <PointDeSituation espace={espace} />
      <SectionDepuisDerniere espace={espace} />
      <ListeSignaux espace={espace} />
    </div>
  );
}
```

No `"use client"`: verify whether `SectionsDeterministes.tsx` has it — the file starts with a comment then imports, no `"use client"` seen in lines 1-120. If any child uses state, Next will require the boundary from an ancestor client component (the page is `"use client"`, so this server-renderable pass-through is fine either way). If `tsc`/lint complains, add `"use client"`.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm exec tsc --noEmit; if ($?) { pnpm exec eslint src/components/consultation/cockpit/DepuisDerniere.tsx }`
Expected: PASS.

- [ ] **Step 3: Stage review (DO NOT COMMIT)**

Run: `git status --short`
Expected: one new file.

---

### Task 7: NotesStructurees (structured-first SOAP)

**Files:**
- Create: `src/components/consultation/cockpit/NotesStructurees.tsx`

**Interfaces:**
- Consumes: `ajouterPiste` (Task 2); `CHAMPS_SOAP`, `ChampSoap` (`@/services/consultations`); `ChampZoneTexte`, `ChampTexte`, `Bouton` (`@/components/ui`); `fr.consultation.cockpit.pistes/favoris*`; `LIBELLES` passed as prop `{ titre, indication }` per champ (the page owns `LIBELLES_SOAP`). Produces: `NotesStructurees` consumed by Task 10 for the editable state only (locked notes keep the existing read-only `Champ` list in the page):

```tsx
<NotesStructurees
  soap={soap}
  onChanger={enregistrerSoap}
  refs={refsSoap}
  micro={(champ) => (
    <BoutonDictee champ={champ} libelleChamp={LIBELLES_SOAP[champ].titre} dictee={dictee} />
  )}
  modifiable={noteModifiable}
  libelles={LIBELLES_SOAP}
/>
```

`micro` is a render-prop so the page keeps its `CibleDictee = ChampSoap | "brut"` type local — no generic variance fight. Favoris live in `localStorage` under `mindcare.cockpit.favoris` (JSON `Partial<Record<ChampSoap, string[]>>`, guarded parse, `typeof window` guard for SSR).

- [ ] **Step 1: Create the component**

```tsx
"use client";

import { useState } from "react";

import { Bouton, ChampTexte, ChampZoneTexte } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { CHAMPS_SOAP, type ChampSoap } from "@/services/consultations";

import { ajouterPiste } from "./modele-cockpit";

const CLE_FAVORIS = "mindcare.cockpit.favoris";
const LONGUEUR_MAX_FAVORI = 140;

type Favoris = Partial<Record<ChampSoap, readonly string[]>>;

function lireFavoris(): Favoris {
  if (typeof window === "undefined") return {};
  try {
    const brut = window.localStorage.getItem(CLE_FAVORIS);
    if (brut === null) return {};
    const parsed: unknown = JSON.parse(brut);
    if (typeof parsed !== "object" || parsed === null) return {};
    const sortie: Record<string, readonly string[]> = {};
    for (const champ of CHAMPS_SOAP) {
      const v: unknown = (parsed as Record<string, unknown>)[champ];
      if (Array.isArray(v)) {
        sortie[champ] = v.filter((e): e is string => typeof e === "string").slice(0, 20);
      }
    }
    return sortie;
  } catch {
    return {};
  }
}

/**
 * Les quatre rubriques SOAP en capture structurée d'abord.
 *
 * Chaque rubrique : pistes cliquables (clés `fr`, jamais de chaîne en dur)
 * + `Mes formules` personnalisables (localStorage, non clinique, aucune
 * migration) + zone compacte (`lignes=3`, expansion au focus via `resize-y`
 * natif) + dictée dans le slot `action` du libellé (contrat `Champs.tsx` :
 * la place du micro EST son sens). Tout clic insère via `onChanger`, donc
 * via l'autosave existant — aucune écriture propre.
 */
export function NotesStructurees({
  soap,
  onChanger,
  refs,
  micro,
  modifiable,
  libelles,
}: {
  readonly soap: Record<ChampSoap, string>;
  readonly onChanger: (champ: ChampSoap, v: string) => void;
  readonly refs: Readonly<Record<ChampSoap, React.RefObject<HTMLTextAreaElement | null>>>;
  readonly micro: (champ: ChampSoap) => React.ReactNode;
  readonly modifiable: boolean;
  readonly libelles: Readonly<Record<ChampSoap, { titre: string; indication: string }>>;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;
  const [favoris, setFavoris] = useState<Favoris>(lireFavoris);
  const [saisieFavori, setSaisieFavori] = useState<Record<ChampSoap, string>>({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
  });

  function memoriser(champ: ChampSoap, texte: string): void {
    const propre = texte.trim().slice(0, LONGUEUR_MAX_FAVORI);
    if (propre === "") return;
    const suivants = [...(favoris[champ] ?? []), propre];
    const etat: Favoris = { ...favoris, [champ]: suivants };
    setFavoris(etat);
    try {
      window.localStorage.setItem(CLE_FAVORIS, JSON.stringify(etat));
    } catch {
      // Stockage indisponible : les favoris vivent en mémoire de session.
    }
    setSaisieFavori((p) => ({ ...p, [champ]: "" }));
  }

  function retirer(champ: ChampSoap, texte: string): void {
    const suivants = (favoris[champ] ?? []).filter((f) => f !== texte);
    const etat: Favoris = { ...favoris, [champ]: suivants };
    setFavoris(etat);
    try {
      window.localStorage.setItem(CLE_FAVORIS, JSON.stringify(etat));
    } catch {
      // Stockage indisponible : voir `memoriser`.
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {CHAMPS_SOAP.map((champ) => (
        <div key={champ} className="flex flex-col gap-2">
          <ChampZoneTexte
            libelle={libelles[champ].titre}
            indication={libelles[champ].indication}
            valeur={soap[champ]}
            onChange={(v) => onChanger(champ, v)}
            zoneRef={refs[champ]}
            lignes={3}
            clinique
            action={modifiable ? micro(champ) : undefined}
          />
          {modifiable ? (
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {cockpit.pistes[champ].map((piste) => (
                  <Bouton
                    key={piste}
                    rang="discret"
                    onClick={() => onChanger(champ, ajouterPiste(soap[ch
...[truncated 15821 chars]