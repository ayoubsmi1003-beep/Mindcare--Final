# Alexa mains-libres Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Green bot orb, listening wave, always-on "Alexa → oui docteur → auto-send", and auto-read answers — one plan, four tasks, each independently testable.

**Architecture:** Port the two user-supplied 21st.dev components dependency-free; wire the existing (today unwired) wake-word machine to the conversation via a small bridge; auto-read hooks into the shared `FilJarvis` so all three surfaces inherit it.

**Tech Stack:** React 19, Next.js 15, TypeScript, raw WebGL (no new deps), vitest, Playwright e2e on localhost:3000.

**Spec:** `docs/superpowers/specs/2026-10-24-alexa-voice-design.md`

## Global Constraints

- No `motion`/`framer-motion` dependency: port Avatar with CSS `:active` instead of `whileTap`.
- New UI strings in `src/i18n/alexa.ts` ONLY, never `src/i18n/fr.ts`.
- No migration, no new table/column/enum, no RLS change.
- No hex colors in TSX (design tokens + component presets only); French UI only.
- Audio stays memory-only (blobs revoked); wake-word stays local (openWakeWord, no new transport).
- Confirmation cards for clinical actions are untouched: auto-send sends messages, never confirms.
- Mic always has a visible witness + reachable OFF; default OFF.
- Tests never write clinical data (max one synthetic turn per e2e run, J9.3 precedent).
- E2E auth via `MINDCARE_E2E_USER` / `MINDCARE_E2E_PASS` env only, `test.skip()` when absent; never commit credentials (existing specs' stale E-mail helper is out of scope).

## Review Focus

- Autoplay-blocked first read (no prior gesture): expect silent skip, text unaffected — test in Task 4.
- Identity-bearing reply: expect never cloud-read, no error banner — test in Task 4.
- Wake arriving during `parole`: expect ignored per existing rule, no double ack — test in Task 3.
- Loop + reveil sharing the mic: expect broker shares it, no re-prompt — existing broker contract, no code change; Firefox manual check marked NOT RUN in Task 3.
- Answer over 2000 chars: expect skipped read, text stays — test in Task 4.

---

### Task 1: AvatarAlexa port + orb swap

**Files:**
- Create: `src/components/ui/avatar-alexa.tsx`
- Modify: `src/components/OrbeVoix.tsx:154-160`, `src/components/FilJarvis.tsx:76-79`, `src/components/FilJarvis.tsx:130-133`, `src/components/AlexaLune.tsx:33-37`, `src/components/BulleAlexa.tsx:93-96`
- Test: `tests/e2e/alexa-orbe-vert.spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AvatarAlexa(props: { blinking?: boolean; size?: "sm" | "md" | "lg"; className?: string; style?: React.CSSProperties })` — color fixed green, shape fixed circle. Size map: OrbeVoix `taille` → `style={{width: taille, height: taille}}` + `size="sm"`; FilJarvis 132px → `size="lg" style 132px`; registre badge 16px → `size="sm" style 16px`; hero 112px → `size="lg" style 112px`; BulleAlexa 56px → `size="md" style 56px`. Drop `motion.div` → plain `div` + `active:scale` CSS; keep `useId`, noise SVGs, blink keyframes, eyes. Keep `aria-label="Avatar Alexa"` `role="img"`.

- [ ] **Step 1: Write failing e2e `tests/e2e/alexa-orbe-vert.spec.ts`**

```ts
test("orb Alexa vert sur /jarvis", async ({ page }) => {
  await page.goto("/jarvis");
  const orb = page.getByRole("img", { name: /Avatar Alexa/i }).first();
  await expect(orb).toBeVisible({ timeout: 15000 });
  const bg = await orb.evaluate((el) => getComputedStyle(el).backgroundImage);
  expect(bg).toContain("radial-gradient");
});
```
(login helper: reuse `tests/e2e/jarvis.spec.ts` login with `drlarbi` username field — note J9 helper uses stale E-mail label; write fresh helper with `Nom d'utilisateur`.)

- [ ] **Step 2: Run it, verify FAIL** (`Avatar Alexa` missing)

Run: `npx playwright test tests/e2e/alexa-orbe-vert.spec.ts`
Expected: FAIL, reused server on :3000 must be running.

- [ ] **Step 3: Create `avatar-alexa.tsx`** (port per Interfaces; green preset verbatim from user code)

- [ ] **Step 4: Swap the 5 call sites** per size map; remove `SiriOrb` imports where unused.

- [ ] **Step 5: Run e2e + typecheck + lint, verify PASS + screenshot**

Run: `npx playwright test tests/e2e/alexa-orbe-vert.spec.ts`, `npx tsc --noEmit`, `npx eslint src/components/ui/avatar-alexa.tsx src/components/OrbeVoix.tsx src/components/FilJarvis.tsx src/components/AlexaLune.tsx src/components/BulleAlexa.tsx`
Expected: PASS; screenshot reviewed (green orb, eyes blink).

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/avatar-alexa.tsx src/components/OrbeVoix.tsx src/components/FilJarvis.tsx src/components/AlexaLune.tsx src/components/BulleAlexa.tsx tests/e2e/alexa-orbe-vert.spec.ts
git commit -m "feat(alexa): green Avatar orb on voice surfaces"
```

### Task 2: VagueAlexa + listening display

**Files:**
- Create: `src/components/ui/vague-alexa.tsx`
- Modify: `src/components/OrbeVoix.tsx:154-160`
- Test: `tests/unit/alexa-vague.test.ts`

**Interfaces:**
- Consumes: Task 1 `AvatarAlexa` (fallback).
- Produces: `VagueAlexa(props: { size: number; className?: string })` — `wave` shader only (drop `fluid-dots`), transparent background (remove `bg-black`), square canvas; renders `null` when `vagueDisponible()` is false. Pure helper `vagueDisponible(nav?: { webgl: boolean; reducedMotion: boolean }): boolean` — false when no WebGL or reduced motion. OrbeVoix: `etat === "ecoute" || etat === "traitement"` → `VagueAlexa size={taille}`, else `AvatarAlexa`.

- [ ] **Step 1: Write failing unit test**

```ts
import { describe, expect, it } from "vitest";
import { vagueDisponible } from "@/components/ui/vague-alexa";
describe("vagueDisponible", () => {
  it("refuse sans WebGL", () => expect(vagueDisponible({ webgl: false, reducedMotion: false })).toBe(false));
  it("refuse en reduced-motion", () => expect(vagueDisponible({ webgl: true, reducedMotion: true })).toBe(false));
  it("accepte sinon", () => expect(vagueDisponible({ webgl: true, reducedMotion: false })).toBe(true));
});
```

- [ ] **Step 2: Run, verify FAIL** (module missing)

Run: `npx vitest run tests/unit/alexa-vague.test.ts`
Expected: FAIL.

- [ ] **Step 3: Create `vague-alexa.tsx`** (wave port per Interfaces; runtime `vagueDisponible()` reads `canvas.getContext("webgl")` + `matchMedia("(prefers-reduced-motion: reduce)")`, guarded for SSR).

- [ ] **Step 4: Wire OrbeVoix** per Interfaces.

- [ ] **Step 5: Run unit + typecheck + lint, verify PASS; screenshot idle orb (e2e Task 1 spec still green)**

- [ ] **Step 6: Commit** (`feat(alexa): Siri wave while listening`)

### Task 3: Hands-free wiring (wake → ack → auto-send → follow-ups)

**Files:**
- Modify: `src/services/jarvis-reveil.ts` (append `abonnerEtatReveil`), `src/i18n/alexa.ts` (add `reveilAccuse`, `mainsLibresActiver`, `mainsLibresArreter`), `src/components/SaisieAlexaLune.tsx`, `src/components/SaisieJarvis.tsx` (switch button), `src/components/OrbeVoix.tsx`, `src/components/AlexaLune.tsx` (unified view)
- Create: `src/services/voix-mains-libres.ts`, `src/components/voix-unifiee.ts`, `tests/unit/voix-mains-libres.test.ts`
- Test: `tests/unit/voix-mains-libres.test.ts`

**Interfaces:**
- Consumes: `retenirVoix`, `desarmerReveil` (reveil), `envoyer` (conversation), `lireTexte` (jarvis-voix), existing `CLE_SOUHAIT` untouched (new key `mindcare.mains-libres`).
- Produces:
  - `abonnerEtatReveil(ab: (etat: EtatVoix) => void): () => void` in `jarvis-reveil.ts` (mirror existing subscriber pattern).
  - Bridge `voix-mains-libres.ts`: `demarrerMainsLibres(deps?: { retenir?: typeof retenirVoix }): Promise<Result<true>>`, `arreterMainsLibres(): void`, `abonnerMainsLibres(ab: (actif: boolean) => void): () => void`, `mainsLibresActif(): boolean`. Behavior: start → `retenir({ onCommande: async (texte) => { toucherInactivite(); await envoyer(texte); } })` (instant send, spec §5); subscribe reveil state → on `reveille`: `void lireTexte(alexa.reveilAccuse)` then warn-only on failure (never error UI); 15-min inactivity timer (reset on commande + on parole end via `abonnerLecture`) → auto `arreterMainsLibres()`. Detector suspend/resume stays inside reveil (unchanged).
  - `useVueVoixUnifiee(): { etat: "desactive"|"reveille"|"ecoute"|"traitement"|"parole"|"interrompu"|"erreur"; raison: string|null }` in `voix-unifiee.ts`: loop view wins when loop `etat` not `desactive`; else reveil state mapped 1:1 (same names). OrbeVoix/Saisies/AlexaLune replace `abonnerVoixLocale` with it (same fields consumed).
  - Strings: `reveilAccuse: "Oui docteur, je vous écoute."`, `mainsLibresActiver: "Mains-libres"`, `mainsLibresArreter: "Couper le mains-libres"`. Switch: toggle button beside voice button in both saisies, `aria-pressed`, persisted key.
- Wake-during-parole: ignored by reveil rule (no double ack) — test pins it.

- [ ] **Step 1: Write failing unit tests**

```ts
// abonnerEtatReveil fires on aller("desactive") via desarmerReveil
// bridge with fake retenir: demarrer → actif true; arreter → actif false + release called once
// ack guard: reveille-handler with etat "parole" does NOT call lireTexte
// bridge onCommande path is NOT unit-called (it would send); covered by harnais simulerTranscription (existing)
```

- [ ] **Step 2: Run, verify FAIL** (exports missing)

- [ ] **Step 3: Implement reveil export + alexa.ts strings + bridge + hook + UI swaps** per Interfaces.

- [ ] **Step 4: Run unit + typecheck + lint; e2e read-only: switch renders, toggles, persists across reload, arming failure shows named reason without crash** (extend `tests/e2e/alexa-orbe-vert.spec.ts` or new spec `alexa-mains-libres.spec.ts` — read-only, no mic in CI).

- [ ] **Step 5: Commit** (`feat(alexa): hands-free wake-word loop`)

### Task 4: Global auto-read + mute

**Files:**
- Create: `src/components/use-lecture-auto.ts`, `tests/unit/lecture-auto.test.ts`
- Modify: `src/components/FilJarvis.tsx` (call hook), `src/components/SaisieAlexaLune.tsx`, `src/components/SaisieJarvis.tsx` (mute toggle), `src/i18n/alexa.ts` (`lectureAutoCouper`, `lectureAutoActiver`), `tests/e2e/alexa-mains-libres.spec.ts` (mute persistence)

**Interfaces:**
- Consumes: `abonnerConversation` (conversation), `lireTexte`/`arreterLecture` (jarvis-voix).
- Produces: `texteLisible(tour: { role: string; texte: string; interrompu?: boolean; porteUneIdentite?: boolean }): string | null` — returns trimmed texte iff `role === "jarvis"`, not `interrompu`, `porteUneIdentite !== true`, length 1..2000; else null (identity/length cases: silent skip, warn-level log only, no UI). `useLectureAutoReponses(etat: EtatConversationPublique): void` — tracks seen tour ids (ref); on new lisible jarvis tour with mute OFF → `void lireTexte(texte)`; on new humain tour → `arreterLecture()`. Mute: `localStorage "mindcare.lecture-auto"` default ON; toggle in both saisies beside voice button (`aria-pressed`, stops playback when muted). FilJarvis covers /jarvis + panel + palette (sole consumer of the hook).

- [ ] **Step 1: Write failing unit tests**

```ts
expect(texteLisible({ role: "jarvis", texte: "Bonjour" })).toBe("Bonjour");
expect(texteLisible({ role: "jarvis", texte: "x", porteUneIdentite: true })).toBe(null);
expect(texteLisible({ role: "jarvis", texte: "x", interrompu: true })).toBe(null);
expect(texteLisible({ role: "humain", texte: "x" })).toBe(null);
expect(texteLisible({ role: "jarvis", texte: "  " })).toBe(null);
expect(texteLisible({ role: "jarvis", texte: "y".repeat(2001) })).toBe(null);
```

- [ ] **Step 2: Run, verify FAIL**

- [ ] **Step 3: Implement hook + FilJarvis call + mute toggles + strings** per Interfaces.

- [ ] **Step 4: Run unit + typecheck + lint + e2e (mute persists; one synthetic turn reads: speaker `aria-pressed` flips)** — live-backend step, localhost:3000 running.

- [ ] **Step 5: Commit** (`feat(alexa): auto-read answers with mute`)
