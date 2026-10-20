/** Next may reconstruct request.url with its bind host rather than HTTP Host. */
export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    const expected = host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
    return new URL(origin).origin === expected && origin === new URL(origin).origin;
  } catch { return false; }
}
