import { identite } from "@/app/api/jarvis/_commun";
import { getAlexaModelPolicy } from "@/server/alexa/model-gateway";

/** Single-model : la maintenance du pool `:free` n'existe plus — la route
 *  expose la politique du primary unique (décision humaine 2026-10-03). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (!(await identite())) return Response.json({ ok: false }, { status: 401 });
  return Response.json({ ok: true, data: getAlexaModelPolicy() });
}
