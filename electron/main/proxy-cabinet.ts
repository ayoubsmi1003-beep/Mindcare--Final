import { request, type IncomingHttpHeaders } from "node:http";
import { createServer, type Server } from "node:https";
import { validerOrigineCabinet } from "./connexion-cabinet.js";
export function autoriserInitialisation(remote: string | undefined, local: string | undefined): boolean {
  const address = remote?.replace(/^::ffff:/, "");
  return Boolean(address && local && (address === local.replace(/^::ffff:/, "") || address === "127.0.0.1" || address === "::1"));
}

export interface OptionsProxyCabinet {
  readonly origin: string;
  readonly pfx: Buffer;
  readonly passphrase: string;
  readonly upstreamPort: number;
  readonly listenHost?: "127.0.0.1" | "0.0.0.0" | "::";
}

const SAUT = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"]);
function filtrerEntetes(entetes: IncomingHttpHeaders): IncomingHttpHeaders {
  const interdits = new Set([...SAUT, ...String(entetes.connection ?? "").toLowerCase().split(",").map(s => s.trim())]);
  return Object.fromEntries(Object.entries(entetes).filter(([nom]) => !interdits.has(nom) && !nom.startsWith("x-forwarded-") && nom !== "forwarded"));
}

/** Transport uniquement : l'authentification et les permissions restent dans Next/RLS. */
export async function demarrerProxyCabinet(options: OptionsProxyCabinet): Promise<Server> {
  const origin = validerOrigineCabinet(options.origin);
  const adresse = new URL(origin);
  if (!Number.isInteger(options.upstreamPort) || options.upstreamPort < 1 || options.upstreamPort > 65535) throw new Error("CONFIGURATION_CABINET: port interne invalide.");
  const serveur = createServer({ pfx: options.pfx, passphrase: options.passphrase, minVersion: "TLSv1.2" }, (entrant, sortant) => {
    const refuser = (status: number) => { sortant.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); sortant.end('{"ok":false,"error":"cabinet-indisponible"}'); };
    if (entrant.headers.host?.toLowerCase() !== adresse.host.toLowerCase()) { refuser(421); return; }
    const origineRequete = entrant.headers.origin;
    const lecture = entrant.method === "GET" || entrant.method === "HEAD" || entrant.method === "OPTIONS";
    if ((origineRequete !== undefined && origineRequete !== origin) || (!lecture && origineRequete !== origin)) { refuser(403); return; }
    const route = entrant.url ?? "/";
    if (!route.startsWith("/") || route.startsWith("//")) { refuser(400); return; }
    let pathname: string;
    try { pathname = decodeURIComponent(new URL(route, origin).pathname); } catch { refuser(400); return; }
    if (pathname.replace(/\/+$/, "") === "/api/auth/provisionner" && !autoriserInitialisation(entrant.socket.remoteAddress, entrant.socket.localAddress)) { refuser(403); return; }
    const entetes = {
      ...filtrerEntetes(entrant.headers),
      host: adresse.host,
      "x-forwarded-host": adresse.host,
      "x-forwarded-proto": "https",
      "x-forwarded-for": (entrant.socket.remoteAddress ?? "").replace(/^::ffff:/, ""),
    };
    const interne = request({ hostname: "127.0.0.1", port: options.upstreamPort, path: route, method: entrant.method, headers: entetes }, reponse => {
      sortant.writeHead(reponse.statusCode ?? 502, filtrerEntetes(reponse.headers));
      reponse.on("error", () => sortant.destroy());
      reponse.pipe(sortant);
    });
    // Un SSE actif renouvelle le délai d'inactivité. Aucun tampon de contenu.
    interne.setTimeout(120_000, () => interne.destroy(new Error("upstream-timeout")));
    interne.on("error", () => { if (!sortant.headersSent && !sortant.destroyed) refuser(503); else sortant.destroy(); });
    entrant.on("aborted", () => interne.destroy());
    entrant.on("error", () => interne.destroy());
    sortant.on("close", () => interne.destroy());
    entrant.pipe(interne);
  });
  serveur.headersTimeout = 15_000;
  serveur.requestTimeout = 120_000;
  // Les upgrades ne sont pas requis par les routes SSE actuelles; aucun tunnel arbitraire.
  serveur.on("upgrade", (_request, socket) => socket.end("HTTP/1.1 501 Not Implemented\r\nConnection: close\r\n\r\n"));
  await new Promise<void>((resolve, reject) => {
    serveur.once("error", reject);
    serveur.listen({ port: Number(adresse.port || 443), host: options.listenHost ?? "::", ipv6Only: false }, () => { serveur.removeListener("error", reject); resolve(); });
  });
  return serveur;
}
