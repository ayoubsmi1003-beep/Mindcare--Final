import { AftercarePublicationSchema, AftercareSubmissionSchema, type AftercareObject, type AftercarePublication } from "./aftercare-contracts";

export function editableAftercarePublication(object: Pick<AftercareObject, "source" | "kind" | "body" | "share_state">): AftercarePublication | null {
  if (object.source !== "mindcare" || object.share_state !== "shared" || !["mission", "carePlan", "doctorNote", "personalEvent"].includes(object.kind)) return null;
  const body = { ...object.body };
  delete body.approvedBy;
  delete body.publishedAt;
  const parsed = AftercarePublicationSchema.safeParse({ kind: object.kind, body });
  return parsed.success ? parsed.data : null;
}

export function withdrawAftercarePublication(publication: AftercarePublication): AftercarePublication | null {
  switch (publication.kind) {
    case "mission": return { kind: "mission", body: { ...publication.body, status: "withdrawn" } };
    case "carePlan": return { kind: "carePlan", body: { ...publication.body, status: "withdrawn" } };
    case "doctorNote": return { kind: "doctorNote", body: { ...publication.body, status: "withdrawn" } };
    default: return null;
  }
}

export function selectedAftercareSources(object: Pick<AftercareObject, "kind" | "body">): { recordId: string; version: number }[] {
  const parsed = AftercareSubmissionSchema.safeParse({ kind: object.kind, body: object.body });
  if (!parsed.success) return [];
  return parsed.data.kind === "report" ? parsed.data.body.selectedSources : parsed.data.kind === "preparation" ? parsed.data.body.selectedSources ?? [] : [];
}
