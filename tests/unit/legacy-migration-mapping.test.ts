import { fixtureRows } from "../helpers/rpc-fixture";
/**
 * Migration legacy Syglab — correspondance déterministe (aucune invention).
 *
 * Ces tests verrouillent les règles de mapping extraction → MindCare :
 * - le nom est préservé verbatim (jamais deviné, jamais réordonné) ;
 * - le téléphone absent reste absent (NULL), jamais fabriqué ;
 * - les clés d'idempotence sont stables et dérivées des IDs legacy, jamais du nom ;
 * - les doublons possibles restent des paires à revoir, jamais fusionnées.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { setDbPort, type DbPort } from "../../src/services/db";
import { ok } from "../../src/services/result";
import {
  buildIdempotencyKey,
  buildPrescriptionNotes,
  isPhoneStorable,
  mergeMigrationReports,
  normalizePhoneDigits,
  shapePrescriptionLine,
  toPatientIdentity,
} from "../../src/services/legacy-migration";
import { afterEach } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toPatientIdentity — jamais deviner, jamais normaliser le sens clinique", () => {
  it("préserve nom et prénom legacy verbatim dans first/last", () => {
    const id = toPatientIdentity("BENALI", "Ahmed", null, null);
    expect(id).toEqual({
      firstName: "Ahmed",
      lastName: "BENALI",
      phone: null,
      idDocumentNumber: null,
    });
  });

  it("un nom vide des deux côtés donne une identité vide (quarantaine, pas d'invention)", () => {
    expect(toPatientIdentity("  ", "", null, null)).toBeNull();
  });

  it("un téléphone vide reste NULL, jamais une valeur de remplissage", () => {
    const id = toPatientIdentity("X", "Y", "   ", "123");
    expect(id?.phone).toBeNull();
  });
});

describe("normalizePhoneDigits — comparaisons sur chiffres uniquement", () => {
  it("ne garde que les chiffres pour l'appariement", () => {
    expect(normalizePhoneDigits("+213 555 12 34")).toBe("2135551234");
  });

  it("chaîne vide → chaîne vide (pas de zéro factice)", () => {
    expect(normalizePhoneDigits("")).toBe("");
  });
});

describe("isPhoneStorable — CHECK 004 conservé, NULL autorisé (126)", () => {
  it("accepte NULL (patients sans téléphone, décision D2)", () => {
    expect(isPhoneStorable(null)).toBe(true);
  });

  it("accepte un numéro au format historique", () => {
    expect(isPhoneStorable("0555 12 34 56")).toBe(true);
  });

  it("refuse un numéro hors format au lieu de le corriger silencieusement", () => {
    expect(isPhoneStorable("ABC")).toBe(false);
  });
});

describe("buildIdempotencyKey — stable, dérivée des IDs legacy", () => {
  it("patient : syglab:patient:<ID>", () => {
    expect(buildIdempotencyKey("patient", "42")).toBe("syglab:patient:42");
  });

  it("ordonnance : syglab:ordonnance:<ID>", () => {
    expect(buildIdempotencyKey("ordonnance", "7")).toBe("syglab:ordonnance:7");
  });

  it("deux patients de même nom ont des clés différentes (jamais le nom comme clé)", () => {
    expect(buildIdempotencyKey("patient", "1")).not.toBe(
      buildIdempotencyKey("patient", "2"),
    );
  });
});

describe("buildPrescriptionNotes — numéro legacy préservé, observation verbatim", () => {
  it("préfixe le numéro legacy sans le remplacer", () => {
    expect(buildPrescriptionNotes("ORD-12", "à renouveler")).toBe(
      "Syglab N°ORD-12 — à renouveler",
    );
  });

  it("sans observation, seul le numéro demeure (pas de texte inventé)", () => {
    expect(buildPrescriptionNotes("ORD-12", "")).toBe("Syglab N°ORD-12");
  });
});

describe("shapePrescriptionLine — aucun mapping automatique de médicament", () => {
  it("medication_id reste NULL même quand le nom ressemble au référentiel", () => {
    const line = shapePrescriptionLine({
      legacyLineId: "L1",
      legacyMedId: "1234",
      display: "Dogmatil 50 mg",
      posologie: "1 cp matin",
      texteLibre: "",
      quantite: "30",
      nbrJour: "30",
      nbrFois: "1",
      qsp: "",
      unresolved: false,
    });
    expect(line.medication_id).toBeNull();
    expect(line.display).toBe("Dogmatil 50 mg");
    expect(line.unresolved).toBe(false);
  });

  it("une ligne à ID inconnu garde son marqueur et l'ID legacy pour revue humaine", () => {
    const line = shapePrescriptionLine({
      legacyLineId: "L9",
      legacyMedId: "INCONNU-7",
      display: "[unmatched IDMedicament=INCONNU-7]",
      posologie: "1 cp soir",
      texteLibre: "",
      quantite: "",
      nbrJour: "",
      nbrFois: "",
      qsp: "",
      unresolved: true,
    });
    expect(line.medication_id).toBeNull();
    expect(line.unresolved).toBe(true);
  });
});

describe("mergeMigrationReports — la réconciliation vient des deux exécutions", () => {
  it("fusionne les comptes source (extraction) et importés (portes)", () => {
    const report = mergeMigrationReports(
      { patientsSource: 1558, prescriptionsSource: 139, orphansSource: 6 },
      {
        batch_id: "b",
        batch_status: "imported",
        patients_imported: 1558,
        histories_imported: 1558,
        prescriptions_imported: 139,
        orphans_quarantined: 6,
        reviews_open: 71,
        reviews_total: 71,
        duplicates_pending: 49,
        rtf_integrity_ok: true,
        status: "PASS_WITH_REVIEW",
      },
    );
    expect(report.patientsLost).toBe(0);
    expect(report.prescriptionsLost).toBe(0);
    expect(report.orphansLost).toBe(0);
    expect(report.status).toBe("PASS_WITH_REVIEW");
  });

  it("toute perte silencieuse devient BLOCKED, jamais PASS", () => {
    const report = mergeMigrationReports(
      { patientsSource: 1558, prescriptionsSource: 139, orphansSource: 6 },
      {
        batch_id: "b",
        batch_status: "imported",
        patients_imported: 1557,
        histories_imported: 1558,
        prescriptions_imported: 139,
        orphans_quarantined: 6,
        reviews_open: 0,
        reviews_total: 0,
        duplicates_pending: 0,
        rtf_integrity_ok: true,
        status: "PASS",
      },
    );
    expect(report.patientsLost).toBe(1);
    expect(report.status).toBe("BLOCKED");
  });
});

describe("legacy_get_report — le rapport vient de l'exécution, pas du code", () => {
  it("projette les comptes rendus par la porte, sans les recalculer côté JS", async () => {
    const LIGNE_PORTE = {
      batch_id: "batch-1",
      batch_status: "imported",
      patients_imported: 1558,
      histories_imported: 1558,
      prescriptions_imported: 139,
      orphans_quarantined: 6,
      reviews_open: 71,
      reviews_total: 71,
      duplicates_pending: 49,
      rtf_integrity_ok: true,
      status: "PASS_WITH_REVIEW",
    };
    const fauxPort: DbPort = {
      select: async () => ok([]),
      rpc: async <T>(name: string) => {
        expect(name).toBe("legacy_get_report");
        return fixtureRows<T>([LIGNE_PORTE]);
      },
      signIn: async () => ok({ userId: "x" }),
      signOut: async () => ok(undefined),
      getSession: async () => ok(null),
      getInstallationStatus: async () => ok({ environment: null, provisionne: false }),
      provisionOwnerAccount: async () => ok({ userId: "x" }),
      invokeFunction: async <T>() => ok(null as T),
      invokeFunctionStream: async () =>
        ok(new ReadableStream<Uint8Array>()),
    };
    setDbPort(fauxPort);
    const { getLegacyReport } = await import(
      "../../src/services/legacy-migration"
    );
    const res = await getLegacyReport("batch-1");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.status).toBe("PASS_WITH_REVIEW");
      expect(res.data.patients_imported).toBe(1558);
    }
  });
});

describe("legacy_list_reviews — file de revue paginée, jamais de clinique libre", () => {
  it("projette les cas sans exposer le contenu des notes", async () => {
    const LIGNE = {
      review_id: "aaaaaaaa-0000-4000-8000-000000000001",
      entity_type: "duplicate_group",
      source_ref: "1|2",
      issue_type: "possible_duplicate",
      status: "pending",
      proposed_action: "KEEP_SEPARATE",
      reviewer: null,
      reviewed_at: null,
      resolution: null,
      created_at: "2026-10-06T10:00:00Z",
      total_count: 49,
    };
    const fauxPort: DbPort = {
      select: async () => ok([]),
      rpc: async <T>(name: string, args: Readonly<Record<string, import("../../src/services/db/port").ScalarValue>>) => {
        expect(name).toBe("legacy_list_reviews");
        expect(args["p_status"]).toBe("pending");
        return fixtureRows<T>([LIGNE]);
      },
      signIn: async () => ok({ userId: "x" }),
      signOut: async () => ok(undefined),
      getSession: async () => ok(null),
      getInstallationStatus: async () => ok({ environment: null, provisionne: false }),
      provisionOwnerAccount: async () => ok({ userId: "x" }),
      invokeFunction: async <T>() => ok(null as T),
      invokeFunctionStream: async () =>
        ok(new ReadableStream<Uint8Array>()),
    };
    setDbPort(fauxPort);
    const { listLegacyReviews } = await import(
      "../../src/services/legacy-migration"
    );
    const res = await listLegacyReviews("batch-1", "pending", 25, 0);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.rows).toHaveLength(1);
      expect(res.data.rows[0]?.issueType).toBe("possible_duplicate");
      expect(res.data.total).toBe(49);
    }
  });
});

describe("legacy_resolve_review — seul un humain tranche", () => {
  it("transmet le statut et la résolution, jamais de contenu clinique", async () => {
    const fauxPort: DbPort = {
      select: async () => ok([]),
      rpc: async <T>(name: string, args: Readonly<Record<string, import("../../src/services/db/port").ScalarValue>>) => {
        expect(name).toBe("legacy_resolve_review");
        expect(args["p_status"]).toBe("confirmed");
        return ok([]);
      },
      signIn: async () => ok({ userId: "x" }),
      signOut: async () => ok(undefined),
      getSession: async () => ok(null),
      getInstallationStatus: async () => ok({ environment: null, provisionne: false }),
      provisionOwnerAccount: async () => ok({ userId: "x" }),
      invokeFunction: async <T>() => ok(null as T),
      invokeFunctionStream: async () =>
        ok(new ReadableStream<Uint8Array>()),
    };
    setDbPort(fauxPort);
    const { resolveLegacyReview } = await import(
      "../../src/services/legacy-migration"
    );
    const res = await resolveLegacyReview("aaaaaaaa-0000-4000-8000-000000000001", "confirmed", "KEEP_SEPARATE décidé.");
    expect(res.ok).toBe(true);
  });

  it("refuse un statut inconnu côté service, avant la porte", async () => {
    const { resolveLegacyReview } = await import(
      "../../src/services/legacy-migration"
    );
    const res = await resolveLegacyReview("aaaaaaaa-0000-4000-8000-000000000001", "fusionner", null);
    expect(res.ok).toBe(false);
  });
});
