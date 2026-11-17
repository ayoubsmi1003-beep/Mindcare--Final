import { receiveAftercare } from "@/server/aftercare/transport";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> { return receiveAftercare(request); }
