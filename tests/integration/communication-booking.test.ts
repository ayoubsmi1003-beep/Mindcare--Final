/**
 * Booking agent — course au créneau, éprouvée contre une vraie base.
 *
 * DEUX demandes chevauchantes (10:00-10:30 et 10:15-10:45, même praticienne),
 * confirmées EN MÊME TEMPS via `confirmer_apres_reverification` (117) :
 * une seule gagne, l'autre lève « Créneau occupé », sans double booking.
 * Le gagnant reconfirmé (retry) rend true sans seconde écriture.
 *
 * Fixtures `requested` insérées directes (base de TEST synthétique, jamais
 * de prod), nettoyées par les portes d'annulation en fin de suite.
 *
 * Sans `MINDCARE_TEST_DATABASE_URL`, la suite s'IGNORE en le disant.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const URL_TEST = process.env.MINDCARE_TEST_DATABASE_URL;
const ACTIF = URL_TEST !== undefined && URL_TEST.trim() !== "";

const DR_A = "00000000-0000-0000-0000-0000000000a1";
const PATIENT_A = "00000000-0000-0000-0000-0000000000b1";
const CABINET = "00000000-0000-0000-0000-000000000001";

// Mercredi 3 février 2027, créneaux chevauchants de 30 minutes.
const DEBUT_1 = "2027-02-03T10:00:00+01:00";
const FIN_1 = "2027-02-03T10:30:00+01:00";
const DEBUT_2 = "2027-02-03T10:15:00+01:00";
const FIN_2 = "2027-02-03T10:45:00+01:00";

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

async function insererDemande(debut: string, fin: string): Promise<string> {
  const lignes = await withCaller(DR_A, (q) =>
    q.query<{ id: string }>(
      `INSERT INTO app.appointments
         (cabinet_id, practitioner_id, patient_id, starts_at, ends_at, status, created_by)
       VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, 'requested', $2)
       RETURNING id`,
      [CABINET, DR_A, PATIENT_A, debut, fin],
    ),
  );
  const id = lignes[0]?.id;
  if (id === undefined) throw new Error("fixture sans identifiant");
  return id;
}

async function confirmer(id: string): Promise<boolean> {
  const lignes = await withCaller(DR_A, (q) =>
    q.query<{ confirmer_apres_reverification: boolean }>(
      "SELECT app.confirmer_apres_reverification($1) AS confirmer_apres_reverification",
      [id],
    ),
  );
  return lignes[0]?.confirmer_apres_reverification ?? false;
}

async function lireStatut(id: string): Promise<string | null> {
  const lignes = await withCaller(DR_A, (q) =>
    q.query<{ status: string }>("SELECT status::text AS status FROM app.appointments WHERE id = $1", [
      id,
    ]),
  );
  return lignes[0]?.status ?? null;
}

async function annuler(id: string): Promise<void> {
  await withCaller(DR_A, (q) => q.query("SELECT app.cancel_appointment($1, $2)", [id, "nettoyage test course"]));
}

describe.skipIf(!ACTIF)("booking : deux demandes, un seul gagnant", () => {
  it("une seule confirmation passe, l'autre lève, le retry est idempotent", async () => {
    const premier = await insererDemande(DEBUT_1, FIN_1);
    const second = await insererDemande(DEBUT_2, FIN_2);

    try {
      const issues = await Promise.allSettled([confirmer(premier), confirmer(second)]);
      const reussites = issues.filter(
        (i): i is PromiseFulfilledResult<boolean> => i.status === "fulfilled" && i.value === true,
      );
      const echecs = issues.filter((i) => i.status === "rejected");
      expect(reussites).toHaveLength(1);
      expect(echecs).toHaveLength(1);
      const motif = echecs[0]?.status === "rejected" ? String(echecs[0].reason) : "";
      expect(motif).toMatch(/occupé/);

      const premierGagne =
        issues[0]?.status === "fulfilled" && issues[0].value === true;
      const gagnant = premierGagne ? premier : second;
      const perdant = gagnant === premier ? second : premier;
      expect(await lireStatut(gagnant)).toBe("confirmed");
      expect(await lireStatut(perdant)).toBe("requested");

      // Retry : reconfirmer le gagnant rend true, sans lever ni réécrire.
      await expect(confirmer(gagnant)).resolves.toBe(true);
      expect(await lireStatut(gagnant)).toBe("confirmed");
    } finally {
      await annuler(premier).catch(() => undefined);
      await annuler(second).catch(() => undefined);
    }
  });
});
