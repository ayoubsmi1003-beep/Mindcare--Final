import { databaseErrorCode } from "./boundary-diagnostic";

/** Retry acquisition once, before BEGIN. Never replay a query or transaction. */
export async function acquireConnection<T>(connect: () => Promise<T>): Promise<T> {
  try { return await connect(); }
  catch (cause) {
    if (!["CONNECTION_TIMEOUT", "ECONNRESET", "ECONNREFUSED"].includes(databaseErrorCode(cause))) throw cause;
    return connect();
  }
}
