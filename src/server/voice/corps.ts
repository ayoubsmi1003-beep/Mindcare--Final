/** Bound actual bytes, including chunked bodies without Content-Length. Never persist content. */
export async function lireCorpsVoix(req: Request, maximum: number): Promise<unknown> {
  if (Number(req.headers.get("Content-Length") ?? 0) > maximum || !req.body) return null;
  const reader = req.body.getReader();
  const parts: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > maximum || req.signal.aborted) return null;
      parts.push(result.value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch { return null; }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
