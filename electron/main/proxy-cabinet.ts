import { request, type IncomingHttpHeaders } from "node:http";
import { createServer, type Server } from "node:https";
import { validerOrigineCabinet } from "./connexion-cabinet.js";
export function autoriserInitialisation(remote: string | undefined, local: string | undefined): boolean {
  const address = remote?.replace(/^::ffff:/, "");
  return Boolean(address && local && (address === local.replace(/^::ffff:/, "") || address === "127.0.0.1" || address === "::1"));
}

/** Boucle locale stricte — la machine hôte elle-même, jamais le LAN. */
export function adresseBoucleLocale(remote: string | undefined): boolean {
  const address = remote?.replace(/^::ffff:/, "");
  return address === "127.0.0.1" || address === "::1";
}

/** Les routes d'administration du cabinet : hôte physique uniquement. */
const ROUTES_HOTE = ["/api/cabinet/invitation", "/api/cabinet/appareils", "/api/cabinet/appareils/revoquer"];

function estRouteHote(pathname: string): boolean {
  const propre = pathname.replace(/\/+$/, "");
  return ROUTES_HOTE.some((route) => propre === route || propre.startsWith(`${route}/`));
}

export interface OptionsProxyCabinet {
  readonly origin: string;
  readonly pfx: Buffer;
  readonly passphrase: string;
  readonly upstreamPort: number;
  readonly listenHost?: "127.0.0.1" | "0.0.0.0" | "::";
  /**
   * Vérification du jeton de poste (178). Appelée pour toute requête NON
   * locale, sauf `/api/health`. Rendre `false` ferme la porte AVANT toute
   * session : un poste non appairé ne peut pas même tenter de se connecter.
   *
   * Absente en développement : le proxy reste alors dans son comportement
   * historique (session obligatoire, jeton non exigé).
   */
  readonly verifierAppareil?: (jeton: string | undefined, adresseDistante: string | undefined) => boolean;
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
    // Les routes qui écrivent dans le dossier privé (invitation, registre des
    // postes) ne sont atteignables que depuis la machine hôte. Le backend
    // tourne sous SYSTEM ; les exposer au LAN donnerait à un poste appairé le
    // droit de révoquer les autres.
    const local = adresseBoucleLocale(entrant.socket.remoteAddress);
    if (estRouteHote(pathname) && !local) { refuser(403); return; }
    // Jeton de poste : exigé pour tout le LAN, jamais pour la machine hôte (qui
    // EST l'autorité), jamais pour la sonde de santé (elle précède l'appairage
    // et ne rend aucune donnée).
    if (!local && pathname !== "/api/health" && options.verifierAppareil !== undefined) {
      const brut = entrant.headers["x-mindcare-device"];
      const jeton = Array.isArray(brut) ? brut[0] : brut;
      if (!options.verifierAppareil(jeton, entrant.socket.remoteAddress)) { refuser(403); return; }
    }
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
