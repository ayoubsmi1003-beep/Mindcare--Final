import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResumeEtat } from "@/components/patients/CarteResumeCas";

const { hooks, services, route } = vi.hoisted(() => ({
  hooks: {
    cursor: 0, slots: [] as unknown[], pending: [] as (() => void)[],
    effects: new Map<number, { deps: readonly unknown[] | undefined; cleanup: (() => void) | undefined }>(),
  },
  services: { workspace: vi.fn(), freshness: vi.fn(), generate: vi.fn(), load: vi.fn() },
  route: { id: "patient-a", router: { replace: vi.fn(), push: vi.fn() } },
}));
vi.mock("react", async importOriginal => {
  const actual = await importOriginal<typeof import("react")>();
  vi.stubGlobal("React", actual);
  return { ...actual,
    useState: (initial: unknown) => {
      const index = hooks.cursor++;
      if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
      return [hooks.slots[index], (next: unknown) => { hooks.slots[index] = typeof next === "function" ? next(hooks.slots[index]) : next; }];
    },
    useRef: (initial: unknown) => {
      const index = hooks.cursor++; if (!(index in hooks.slots)) hooks.slots[index] = { current: initial }; return hooks.slots[index];
    },
    useCallback: (callback: unknown) => callback,
    useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => {
      const index = hooks.cursor++, previous = hooks.effects.get(index);
      if (previous && deps && previous.deps && deps.length === previous.deps.length && deps.every((value, i) => value === previous.deps?.[i])) return;
      hooks.pending.push(() => { previous?.cleanup?.(); const cleanup = effect(); hooks.effects.set(index, { deps, cleanup: typeof cleanup === "function" ? cleanup : undefined }); });
    },
  };
});
vi.mock("next/navigation", () => ({ useParams: () => ({ id: route.id }), useRouter: () => route.router, usePathname: () => `/patients/${route.id}`, useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/AppShell", () => ({ AppShell: () => null }));
vi.mock("@/services/conversation", () => ({ purgerContexteSession: () => {} }));
vi.mock("@/services/patient-actif", () => ({ definirPatientActif: () => {}, effacerPatientActif: () => {} }));
vi.mock("@/services/auth", () => ({ getSession: async () => ({ ok: true, data: {} }), signOut: async () => ({ ok: true }) }));
vi.mock("@/services/authz", () => ({ getCurrentUser: async () => ({ ok: true, data: { id: "doctor", role: "practitioner", fullName: "", cabinetId: "cabinet" } }) }));
vi.mock("@/services/patients", async importOriginal => ({ ...(await importOriginal<typeof import("@/services/patients")>()), getPatientWorkspace: services.workspace }));
vi.mock("@/services/resume-cas", () => ({ verifierFraicheurResume: services.freshness, genererResumeCas: services.generate, chargerResumeCas: services.load }));
import * as React from "react";
import PageFichePatient from "@/app/patients/[id]/page";

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const summary = (id: string, version = 1) => ({ id, version, aJour: true, contenu: { schema: 1 }, genereLe: "2026-01-01", generePar: null });
const workspace = (patientId: string, summaryId: string) => ({ identite: { id: patientId, firstName: "", lastName: "", recordNumber: "" }, clinique: null, traitements: null, traitementsV2: null, rendezVousDuJour: [], agenda: [], documents: [], resume: summary(summaryId) });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function effects() { for (const effect of hooks.pending.splice(0)) effect(); }
function render(id = route.id, flushEffects = true) { route.id = id; hooks.cursor = 0; const tree = PageFichePatient(); if (flushEffects) effects(); return tree; }
function card(node: unknown): { etat: ResumeEtat; onGenerer: () => void } | undefined {
  if (Array.isArray(node)) { for (const child of node) { const found = card(child); if (found) return found; } return undefined; }
  if (!node || typeof node !== "object") return undefined;
  const props = (node as { props?: { children?: unknown; etat?: ResumeEtat; onGenerer?: () => void } }).props;
  if (props?.etat && props.onGenerer) return { etat: props.etat, onGenerer: props.onGenerer };
  return card(props?.children);
}
beforeEach(() => { hooks.cursor = 0; hooks.slots = []; hooks.pending = []; hooks.effects.clear(); vi.clearAllMocks(); services.load.mockImplementation(() => new Promise(() => {})); vi.stubGlobal("React", React); });
afterEach(() => { for (const effect of hooks.effects.values()) effect.cleanup?.(); vi.unstubAllGlobals(); });

describe("patient page async summary scope", () => {
  it("loads the persisted summary after rendering a workspace that omits it", async () => {
    const saved = deferred<unknown>();
    services.workspace.mockResolvedValue({ ok: true, data: { ...workspace("patient-a", "unused"), resume: null } });
    services.load.mockReturnValue(saved.promise);
    render("patient-a"); await flush();
    expect(card(render())?.etat.resume).toBeNull();
    expect(services.load).toHaveBeenCalledWith("patient-a");
    saved.resolve({ ok: true, data: { resume: summary("persisted-summary", 2) } }); await flush();
    expect(card(render())?.etat.resume?.id).toBe("persisted-summary");
  });
  it("discards a saved-summary read from the previous patient", async () => {
    const old = deferred<unknown>();
    services.workspace.mockImplementation(async id => ({ ok: true, data: { ...workspace(id, "unused"), resume: null } }));
    services.load.mockImplementation(id => id === "patient-a" ? old.promise : Promise.resolve({ ok: true, data: { resume: summary("patient-b-saved") } }));
    render("patient-a"); await flush(); render("patient-b"); await flush();
    old.resolve({ ok: true, data: { resume: summary("patient-a-saved") } }); await flush();
    expect(card(render())?.etat.resume?.id).toBe("patient-b-saved");
  });
  it("does not overwrite a new generation with an earlier saved-summary read", async () => {
    const saved = deferred<unknown>();
    services.workspace.mockResolvedValue({ ok: true, data: workspace("patient-a", "old") });
    services.freshness.mockResolvedValue({ ok: true, data: { aJour: true } });
    services.load.mockReturnValue(saved.promise);
    services.generate.mockResolvedValue({ ok: true, data: { resume: summary("new-generated", 3) } });
    render("patient-a"); await flush(); card(render())?.onGenerer(); await flush();
    saved.resolve({ ok: true, data: { resume: summary("older-saved", 2) } }); await flush();
    expect(card(render())?.etat.resume?.id).toBe("new-generated");
  });
  it("clears an existing summary when the authorized saved-summary gate returns no content", async () => {
    services.workspace.mockResolvedValue({ ok: true, data: workspace("patient-a", "old") });
    services.freshness.mockResolvedValue({ ok: true, data: { aJour: true } });
    services.load.mockResolvedValue({ ok: true, data: { resume: null } });
    render("patient-a"); await flush();
    expect(card(render())?.etat.resume).toBeNull();
  });
  it("ignores a freshness check for the old summary after a newer generation completes", async () => {
    const status = deferred<{ ok: true; data: { aJour: boolean } }>(), generated = deferred<unknown>();
    services.workspace.mockResolvedValue({ ok: true, data: workspace("patient-a", "old-summary") });
    services.freshness.mockReturnValue(status.promise); services.generate.mockReturnValue(generated.promise);
    render("patient-a"); await flush(); const current = card(render()); expect(current).toBeDefined(); current?.onGenerer();
    generated.resolve({ ok: true, data: { resume: summary("new-summary", 2) } }); await flush();
    status.resolve({ ok: true, data: { aJour: false } }); await flush();
    expect(card(render())?.etat.resume).toMatchObject({ id: "new-summary", aJour: true });
  });
  it("does not replace the current patient summary with a completed generation from the prior patient", async () => {
    const generated = deferred<unknown>();
    services.workspace.mockImplementation(async id => ({ ok: true, data: workspace(id, `${id}-summary`) }));
    services.freshness.mockResolvedValue({ ok: true, data: { aJour: true } }); services.generate.mockReturnValue(generated.promise);
    render("patient-a"); await flush(); card(render())?.onGenerer();
    render("patient-b"); await flush(); render();
    generated.resolve({ ok: true, data: { resume: summary("patient-a-generated", 2) } }); await flush();
    expect(card(render())?.etat.resume?.id).toBe("patient-b-summary");
  });
  it("rejects a prior workspace result immediately after the route scope changes", async () => {
    const old = deferred<unknown>(), next = deferred<unknown>();
    services.workspace.mockImplementation(id => id === "patient-a" ? old.promise : next.promise);
    services.freshness.mockResolvedValue({ ok: true, data: { aJour: true } });
    render("patient-a"); await flush(); render("patient-b", false);
    old.resolve({ ok: true, data: workspace("patient-a", "old-summary") }); await flush();
    expect(card(render("patient-b", false))?.etat.resume?.id).not.toBe("old-summary");
    effects(); next.resolve({ ok: true, data: workspace("patient-b", "new-summary") }); await flush();
    expect(card(render())?.etat.resume?.id).toBe("new-summary");
  });
});
