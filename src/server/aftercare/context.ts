import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { preparer, type Contexte } from "@/app/api/db/_commun";
import { NOM_COOKIE, resoudreSession } from "@/server/auth/session";
import { aftercareTransportConfig } from "./transport";

export function isAftercareSameOrigin(request: Request): boolean {
  return request.headers.get("origin") === `${new URL(request.url).protocol}//${request.headers.get("host")}`;
}

/** Disposable harness only; production database startup checks remain unchanged. */
export function isAftercareQualification(): boolean {
  try {
    if (process.env.AFTERCARE_NATIVE_QUALIFICATION !== "synthetic" || !aftercareTransportConfig()) return false;
    const database = new URL(process.env.MINDCARE_DATABASE_URL ?? "");
    return database.protocol === "postgresql:" && database.hostname === "127.0.0.1" && database.username === "mindcare_app" && database.pathname === "/mindcare_aftercare_synthetic";
  } catch { return false; }
}
export async function preparerAftercare(): Promise<Contexte | NextResponse> {
  if (!isAftercareQualification()) return preparer();
  try {
    const userId = await resoudreSession((await cookies()).get(NOM_COOKIE)?.value);
    return userId ? { userId } : NextResponse.json({ ok: false, code: "non-authentifie" }, { status: 401 });
  } catch { return NextResponse.json({ ok: false, code: "indisponible" }, { status: 503 }); }
}
