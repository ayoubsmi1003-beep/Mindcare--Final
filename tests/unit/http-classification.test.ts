/**
 * LM54.3 — la classification d'erreur de la frontière HTTP, éprouvée sur des
 * réponses RÉELLES (objets `Response` natifs), pas sur des simulacres
 * d'`AppError`.
 *
 * La panne qui a motivé ce fichier : une 503 du serveur (base manquante)
 * traversait `lireEnveloppe` avec un corps JSON `{ ok:false, code:
 * "indisponible" }` — correct — mais une 503 de MANDATAIRE (page HTML, corps
 * non-JSON) tombait dans le repli `toAppError({ status: 503 })` →
 * `inattendu`. Le praticien cherchait alors « une erreur à investiguer » là
 * où le statut disait déjà « le service de données manque ».
 *
 * ⚠️ RÈGLE DU DÉPÔT (vitest.config.ts) : un test qui n'éprouve que des
 * simulacres ne compte pas. Ici le sujet est la CLASSIFICATION d'objets
 * `Response` réels — c'est du code pur de `http.ts`, constructible sans
 * réseau. La boucle serveur complète (PostgreSQL réel) est couverte par
 * `tests/integration/demarrage-sante.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Result } from "@/services/result";
import type { AppError } from "@/services/errors";

/** Le module sous test, importé APRÈS la pose du `fetch` simulé. */
let httpDbPort: typeof import("@/services/db/http").httpDbPort;

type FetchMock = ReturnType<typeof vi.fn>;

/**
 * Pose un `fetch` global qui rend la réponse donnée — un vrai `Response`
 * natif, pour que `reponse.json()`, `reponse.ok` et `reponse.status` se
 * comportent exactement comme au navigateur.
 */
function repondre(corps: string, init: ResponseInit): FetchMock {
  const f = vi.fn(async () => new Response(corps, init));
  vi.stubGlobal("fetch", f);
  return f;
}

function reponse(corps: string, init: ResponseInit): Response {
  return new Response(corps, init);
}

/** Extrait l'erreur d'un `Result` — échec du test si c'est un succès. */
function erreur(r: Result<unknown>): AppError {
  if (r.ok) throw new Error("attendu un échec, reçu un succès");
  return r.error;
}

beforeEach(async () => {
  ({ httpDbPort } = await import("@/services/db/http"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("http.signIn — authentification, jamais 503 par erreur", () => {
  it("identifiants valides → succès, userId rendu", async () => {
    const f = repondre(JSON.stringify({ ok: true, data: { userId: "u1" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.userId).toBe("u1");
    expect(f).toHaveBeenCalledExactlyOnceWith(
      "/api/auth/sign-in",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });

  it("identifiants refusés (401 + code) → identifiants-refuses, PAS indisponible", async () => {
    repondre(JSON.stringify({ ok: false, code: "identifiants-refuses" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "faux" });
    expect(erreur(r).code).toBe("identifiants-refuses");
  });

  it("base manquante (503 + code) → indisponible", async () => {
    repondre(JSON.stringify({ ok: false, code: "indisponible" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "x" });
    expect(erreur(r).code).toBe("indisponible");
  });

  it("503 SANS corps JSON (page d'un mandataire) → indisponible, PAS inattendu", async () => {
    // LM54.3 : c'est le repli qui classait mal. Le statut seul doit suffire
    // à dire « dépendance de données absente » — le message reste celui
    // d'`fr.erreurs.indisponible`, jamais une « erreur inattendue ».
    repondre("<html>Bad Gateway</html>", {
      status: 503,
      headers: { "Content-Type": "text/html" },
    });
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "x" });
    const e = erreur(r);
    expect(e.code).toBe("indisponible");
    expect(e.context).toBe("http.signIn");
  });

  it("401 SANS corps exploitable → non-authentifie, PAS inattendu", async () => {
    repondre("", { status: 401, headers: { "Content-Type": "text/plain" } });
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "x" });
    expect(erreur(r).code).toBe("non-authentifie");
  });

  it("réseau coupé (fetch lève TypeError) → hors-ligne, PAS inattendu", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", f);
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "x" });
    const e = erreur(r);
    expect(e.code).toBe("hors-ligne");
    expect(e.context).toBe("http.signIn");
  });

  it("délai dépassé (AbortError) → hors-ligne", async () => {
    const f = vi.fn(async () => {
      const err = new DOMException("The operation was aborted", "AbortError");
      throw err;
    });
    vi.stubGlobal("fetch", f);
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "x" });
    expect(erreur(r).code).toBe("hors-ligne");
  });

  it("500 inconnu sans code → inattendu (on ne devine pas)", async () => {
    repondre(JSON.stringify({}), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "x" });
    expect(erreur(r).code).toBe("inattendu");
  });

  it("corps malformé 400 → regle-metier transportée telle quelle", async () => {
    repondre(JSON.stringify({ ok: false, code: "regle-metier" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
    const r = await httpDbPort.signIn({ email: "", password: "" });
    expect(erreur(r).code).toBe("regle-metier");
  });
});

describe("http.getInstallationStatus — la sonde de premier lancement", () => {
  it("état rendu correctement", async () => {
    repondre(
      JSON.stringify({ ok: true, data: { environment: "self-hosted", provisionne: true } }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
    const r = await httpDbPort.getInstallationStatus();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.environment).toBe("self-hosted");
      expect(r.data.provisionne).toBe(true);
    }
  });

  it("base manquante → indisponible (le symptôme LM54.3, côté client)", async () => {
    repondre(JSON.stringify({ ok: false, code: "indisponible" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
    const r = await httpDbPort.getInstallationStatus();
    expect(erreur(r).code).toBe("indisponible");
    expect(erreur(r).context).toBe("http.getInstallationStatus");
  });

  it("réseau coupé → hors-ligne, PAS indisponible", async () => {
    const f = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", f);
    const r = await httpDbPort.getInstallationStatus();
    expect(erreur(r).code).toBe("hors-ligne");
  });
});

describe("http.invokeFunction — enveloppe Jarvis imbriquée", () => {
  it("code imbriqué dans error est classé par la source de vérité Edge", async () => {
    repondre(
      JSON.stringify({ ok: false, error: { code: "transcription-indisponible" } }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
    const r = await httpDbPort.invokeFunction("x", {});
    // `classerCodeEdge` : transcription, et NON indisponible — c'est
    // exactement la distinction d'organe motivée dans errors.ts.
    expect(erreur(r).code).toBe("transcription");
  });
});

describe("le contrat de `lireEnveloppe` sur des réponses natives", () => {
  // Accès direct au comportement via les chemins publics du port : signIn
  // (POST), getInstallationStatus (GET). Ces tests éprouvent le repli de
  // statut sans dépendre d'un point d'entrée spécifique.
  it("une réponse 503 OK:false avec code inconnu reste honnête", async () => {
    repondre(JSON.stringify({ ok: false, code: "code-que-personne-connait" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
    // Le code inconnu n'est pas dans CODES_FRONTIERE : le repli par statut
    // s'applique (503 → indisponible), sans faire fuir le code inconnu.
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "x" });
    expect(erreur(r).code).toBe("indisponible");
  });

  it("une 502 de mandataire reste inattendu (on n'affirme pas une cause)", async () => {
    repondre("<html>502</html>", { status: 502, headers: { "Content-Type": "text/html" } });
    const r = await httpDbPort.signIn({ email: "a@b.c", password: "x" });
    expect(erreur(r).code).toBe("inattendu");
  });

  it("Response natif — construction et lecture OK (garde anti-simulacre)", () => {
    const r = reponse(JSON.stringify({ ok: true, data: 7 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
  });
});
