import { withCaller } from "@/server/db/withCaller";
import { faireePgPort } from "@/server/db/pgPort";
import type { DbPort } from "@/services/db/port";

/** Each gate gets its own authenticated transaction; no DB connection held over inference. */
export function alexaDb(actor: string): Pick<DbPort, "rpc"> {
  return { rpc: (name, args) => withCaller(actor, q => faireePgPort(q, "alexa").rpc(name, args)) };
}
