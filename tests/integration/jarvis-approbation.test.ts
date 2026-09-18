/**
 * M06 — intégrité de l'approbation, éprouvée contre une vraie base.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Les portes RÉELLES (`withCaller`, RLS, machine d'état), sans simulacre :
 *   · NEG-1 : propose → reject → confirm LÈVE → execute LÈVE, état `rejected`,
 *     aucun affecté, zéro ligne métier ;
 *   · exécution sans confirmation LÈVE ;
 *   · second `execute` sur le même `actionId` LÈVE (suppression de doublon
 *     par état — pas une idempotence d'affaires) ;
 *   · confirmée par un AUTRE acteur : invisible (NULL, ADR-003), état
 *     inchangé, zéro exécution ;
 *   · `execute/confirm/reject` ne prennent que `p_id` : aucun canal pour
 *     substituer outil, arguments ou conversation au moment d'exécuter
 *     (la liaison conversation/outil/args vit dans la ligne, lue sous RLS).
 *
 * Les actions utilisent des identifiants métier fictifs : aucune ligne métier
 * n'est créée, seule `app.jarvis_actions` reçoit des lignes de test.
 *
 * Sans `MINDCARE_TEST_DATABASE_URL`, la suite s'IGNORE en le disant — jamais
 * verte en silence (même exigence que `checkpoint-v2.sql`).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_TEST = process.env.MINDCARE_TEST_DATABASE_URL;
const ACTIF = URL_TEST !== undefined && URL_TEST.trim() !== "";

const DR_A = "00000000-0000-0000-0000-0000000000a1";
const DR_B = "00000000-0000-0000-0000-0000000000a2";
const FAUX_PATIENT = "00000000-0000-0000-0000-0000000000b9";

let withCaller: typeof import("@/server/db/withCaller").withCaller;
let fermerPool: typeof import("@/server/db/pool").fermerPool;

beforeAll(async () => {
  if (!ACTIF) return;
  process.env.MINDCARE_DATABASE_URL = URL_TEST;
  const modPool = await import("@/server/db/pool");
  fermerPool = modPool.fermerPool;
  withCaller = (await import("@/server/db/withCaller")).withCaller;
});

afterAll(async () => {
  if (!ACTIF) return;
  await fermerPool();
});

async function proposer(acteur: string, outil: string, args: string): Promise<string> {
  const lignes = await withCaller(acteur, (q) =>
    q.query<{ propose_jarvis_action: string }>(
      "SELECT app.propose_jarvis_action(gen_random_uuid(), $1, $2, $3) AS propose_jarvis_action",
      ["demande de test M06", outil, args],
    ),
  );
  const id = lignes[0]?.propose_jarvis_action;
  if (id === undefined) throw new Error("propose sans identifiant");
  return id;
}

async function lireEtat(
  acteur: string,
  id: string,
): Promise<{ state: string; affected: string | null }> {
  const lignes = await withCaller(acteur, (q) =>
    q.query<{ state: string; affected_id: string | null }>(
      "SELECT state::text AS state, affected_id FROM app.jarvis_actions WHERE id = $1",
      [id],
    ),
  );
  const ligne = lignes[0];
  if (ligne === undefined) throw new Error("action illisible par son acteur");
  return { state: ligne.state, affected: ligne.affected_id };
}

describe.skipIf(!ACTIF)("NEG-1 : rejet terminal", () => {
  it("propose → reject → confirm lève → execute lève, zéro mutation", async () => {
    const id = await proposer(
      DR_A,
      "create_appointment",
      JSON.stringify({ patient_id: FAUX_PATIENT }),
    );
    await withCaller(DR_A, (q) => q.query("SELECT app.reject_jarvis_action($1)", [id]));
    expect((await lireEtat(DR_A, id)).state).toBe("rejected");

    await expect(
      withCaller(DR_A, (q) => q.query("SELECT app.confirm_jarvis_action($1)", [id])),
    ).rejects.toThrow();

    await expect(
      withCaller(DR_A, (q) => q.query("SELECT app.execute_jarvis_action($1)", [id])),
    ).rejects.toThrow();

    const fin = await lireEtat(DR_A, id);
    expect(fin.state).toBe("rejected");
    expect(fin.affected).toBeNull();
  });

  it("exécuter sans confirmer lève", async () => {
    const id = await proposer(
      DR_A,
      "create_appointment",
      JSON.stringify({ patient_id: FAUX_PATIENT }),
    );
    await expect(
      withCaller(DR_A, (q) => q.query("SELECT app.execute_jarvis_action($1)", [id])),
    ).rejects.toThrow();
    expect((await lireEtat(DR_A, id)).state).toBe("proposed");
  });
});

describe.skipIf(!ACTIF)("doublon d'exécution", () => {
  it("second execute sur le même actionId lève, aucun affecté", async () => {
    const id = await proposer(
      DR_A,
      "create_appointment",
      JSON.stringify({ patient_id: FAUX_PATIENT }),
    );
    await withCaller(DR_A, (q) => q.query("SELECT app.confirm_jarvis_action($1)", [id]));
    // Cible fictive : la porte bascule en `failed` et rend NULL — PAS une
    // exécution métier. C'est exactement ce qu'il faut ici : prouver que le
    // second appel lève sans dépendre de graines métier.
    const premiere = await withCaller(DR_A, (q) =>
      q.query<{ execute_jarvis_action: string | null }>(
        "SELECT app.execute_jarvis_action($1) AS execute_jarvis_action",
        [id],
      ),
    );
    expect(premiere[0]?.execute_jarvis_action).toBeNull();

    await expect(
      withCaller(DR_A, (q) => q.query("SELECT app.execute_jarvis_action($1)", [id])),
    ).rejects.toThrow();

    const fin = await lireEtat(DR_A, id);
    expect(fin.state).toBe("failed");
    expect(fin.affected).toBeNull();
  });
});

describe.skipIf(!ACTIF)("confirmation invalide", () => {
  it("confirmer deux fois lève, état confirmed, zéro exécution", async () => {
    const id = await proposer(
      DR_A,
      "create_appointment",
      JSON.stringify({ patient_id: FAUX_PATIENT }),
    );
    await withCaller(DR_A, (q) => q.query("SELECT app.confirm_jarvis_action($1)", [id]));
    await expect(
      withCaller(DR_A, (q) => q.query("SELECT app.confirm_jarvis_action($1)", [id])),
    ).rejects.toThrow();
    const fin = await lireEtat(DR_A, id);
    expect(fin.state).toBe("confirmed");
    expect(fin.affected).toBeNull();
  });

  it("confirmer après échec lève, état failed inchangé", async () => {
    const id = await proposer(
      DR_A,
      "create_appointment",
      JSON.stringify({ patient_id: FAUX_PATIENT }),
    );
    await withCaller(DR_A, (q) => q.query("SELECT app.confirm_jarvis_action($1)", [id]));
    // Cible fictive : execute bascule en `failed` et rend NULL.
    await withCaller(DR_A, (q) => q.query("SELECT app.execute_jarvis_action($1)", [id]));
    expect((await lireEtat(DR_A, id)).state).toBe("failed");
    await expect(
      withCaller(DR_A, (q) => q.query("SELECT app.confirm_jarvis_action($1)", [id])),
    ).rejects.toThrow();
    expect((await lireEtat(DR_A, id)).state).toBe("failed");
  });
});

describe.skipIf(!ACTIF)("cloisonnement acteur", () => {
  it("confirmer l'action d'autrui : invisible, état inchangé, zéro exécution", async () => {
    const id = await proposer(
      DR_A,
      "create_appointment",
      JSON.stringify({ patient_id: FAUX_PATIENT }),
    );
    // Masquée par la RLS → la porte rend NULL (ADR-003), elle ne lève pas et
    // surtout ne confirme rien.
    const confirmation = await withCaller(DR_B, (q) =>
      q.query<{ confirm_jarvis_action: string | null }>(
        "SELECT app.confirm_jarvis_action($1) AS confirm_jarvis_action",
        [id],
      ),
    );
    expect(confirmation[0]?.confirm_jarvis_action).toBeNull();

    // L'action est intacte vue par son acteur — et inexécutable par l'autre.
    // Masquée par la RLS → la porte rend NULL (ADR-003), comme confirm
    // ci-dessus : exiger un throw distinguerait l'invisible de l'inexistant,
    // exactement la fuite que la règle 5 de CLAUDE.md interdit.
    const execution = await withCaller(DR_B, (q) =>
      q.query<{ execute_jarvis_action: string | null }>(
        "SELECT app.execute_jarvis_action($1) AS execute_jarvis_action",
        [id],
      ),
    );
    expect(execution[0]?.execute_jarvis_action).toBeNull();
    expect((await lireEtat(DR_A, id)).state).toBe("proposed");
  });
});

describe.skipIf(!ACTIF)("exécution pilotée par ID seul", () => {
  it.each([["execute_jarvis_action"], ["confirm_jarvis_action"], ["reject_jarvis_action"]])(
    "%s ne prend que p_id : aucun canal outil/args/conversation",
    async (porte) => {
      // S'il existait un paramètre d'outil, d'arguments ou de conversation au
      // moment d'exécuter, une substitution A→B y passerait. Un seul `p_id`
      // rend cette classe d'attaque inexprimable — la liaison vit dans la
      // ligne, lue sous RLS par la porte elle-même.
      const lignes = await withCaller(DR_A, (q) =>
        q.query<{ params: string }>(
          `SELECT array_to_string(p.proargnames, ',') AS params
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'app' AND p.proname = $1`,
          [porte],
        ),
      );
      expect(lignes[0]?.params).toBe("p_id");
    },
  );
});
