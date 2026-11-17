import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { z } from "zod";
import { isAftercareQualification, preparerAftercare } from "@/server/aftercare/context";
import { AftercareQualification } from "@/components/patients/AftercareQualification";
import { aftercare } from "@/i18n/aftercare";
import { withCaller } from "@/server/db/withCaller";
export const dynamic = "force-dynamic";
export default async function QualificationPage({ searchParams }: { searchParams: Promise<{ patientId?: string }> }): Promise<React.JSX.Element> {
  if (!isAftercareQualification()) notFound();
  const patientId = z.string().uuid().safeParse((await searchParams).patientId);
  if (!patientId.success) notFound();
  const ctx = await preparerAftercare();
  if (ctx instanceof NextResponse) return <p>{aftercare.loginRequired}</p>;
  try {
    const capability = await withCaller(ctx.userId, q => q.query<{ permitted: boolean }>("SELECT app.can_see_clinical(p.practitioner_id) AS permitted FROM app.get_patient($1::uuid) p", [patientId.data]));
    if (!capability[0]?.permitted) return <p role="status">{aftercare.error}</p>;
  } catch { return <p role="status">{aftercare.error}</p>; }
  return <AftercareQualification patientId={patientId.data} />;
}
