import { db } from "./db";
import { logFieldsFor } from "./errors";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export interface Cabinet {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
}

interface CabinetRow {
  readonly id: string;
  readonly name: string;
  readonly address: string | null;
  readonly phone: string | null;
}

export async function getCabinet(): Promise<Result<Cabinet | null>> {
  const r = await db().rpc<CabinetRow>("get_my_cabinet", {});
  if (!r.ok) {
    log.error("cabinet.lecture", logFieldsFor(r.error));
    return err(r.error);
  }
  const row = r.data[0];
  if (!row) return ok(null);
  return ok({ id: row.id, name: row.name, address: row.address ?? null, phone: row.phone ?? null });
}

export async function updateCabinet(patch: {
  name?: string;
  address?: string | null;
  phone?: string | null;
}): Promise<Result<void>> {
  const r = await db().rpc<unknown>("update_cabinet", {
    p_patch: JSON.stringify(patch),
  });
  if (!r.ok) {
    log.error("cabinet.maj", logFieldsFor(r.error));
    return err(r.error);
  }
  log.info("cabinet.maj", { count: 1 });
  return ok(undefined);
}

export interface ProfilPraticienne {
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialityFr: string | null;
  readonly specialityAr: string | null;
  readonly orderNumber: string | null;
  readonly phone: string | null;
  readonly fullNameAr: string | null;
}

interface ProfilRow {
  readonly id: string;
  readonly full_name: string;
  readonly title: string | null;
  readonly speciality_fr: string | null;
  readonly speciality_ar: string | null;
  readonly order_number: string | null;
  readonly phone: string | null;
  readonly signature_block: unknown;
}

export async function getProfil(): Promise<Result<ProfilPraticienne | null>> {
  const r = await db().rpc<ProfilRow>("get_my_profile", {});
  if (!r.ok) {
    log.error("profil.lecture", logFieldsFor(r.error));
    return err(r.error);
  }
  const row = r.data[0];
  if (!row) return ok(null);
  let fullNameAr: string | null = null;
  if (row.signature_block !== null && typeof row.signature_block === "object") {
    const sb = row.signature_block as Record<string, unknown>;
    const v = sb["full_name_ar"];
    if (typeof v === "string") fullNameAr = v;
  }
  return ok({
    id: row.id,
    fullName: row.full_name,
    title: row.title,
    specialityFr: row.speciality_fr,
    specialityAr: row.speciality_ar,
    orderNumber: row.order_number,
    phone: row.phone,
    fullNameAr,
  });
}

export async function updateProfil(patch: {
  fullName?: string;
  title?: string | null;
  specialityFr?: string | null;
  specialityAr?: string | null;
  orderNumber?: string | null;
  phone?: string | null;
  fullNameAr?: string | null;
}): Promise<Result<void>> {
  const snake: Record<string, unknown> = {};
  if (patch.fullName !== undefined) snake["full_name"] = patch.fullName;
  if (patch.title !== undefined) snake["title"] = patch.title;
  if (patch.specialityFr !== undefined) snake["speciality_fr"] = patch.specialityFr;
  if (patch.specialityAr !== undefined) snake["speciality_ar"] = patch.specialityAr;
  if (patch.orderNumber !== undefined) snake["order_number"] = patch.orderNumber;
  if (patch.phone !== undefined) snake["phone"] = patch.phone;
  if (patch.fullNameAr !== undefined) snake["full_name_ar"] = patch.fullNameAr;
  const r = await db().rpc<unknown>("update_profile", {
    p_patch: JSON.stringify(snake),
  });
  if (!r.ok) {
    log.error("profil.maj", logFieldsFor(r.error));
    return err(r.error);
  }
  log.info("profil.maj", { count: 1 });
  return ok(undefined);
}
