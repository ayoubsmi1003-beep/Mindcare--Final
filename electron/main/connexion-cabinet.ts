import { existsSync, readFileSync, statSync } from "node:fs";
import { isIP } from "node:net";
import { setTimeout as pause } from "node:timers/promises";

export type ConnexionCabinet = { mode: "standalone" | "auto" } | { mode: "client" | "host"; origin: string };

export type SondeOptions = { redirect: "error"; signal: AbortSignal; headers: Record<string, string>; credentials: "omit" };
export type SondeFetch = (input: string, init: SondeOptions) => Promise<{ ok: boolean; text: () => Promise<string> }>;

/** Une connexion déjà approuvée est testée sur son origine épinglée sans attendre UDP. */
export async function essayerConnexionCabinetConnu(
  confiance: { origin: string } | undefined,
  connecter: (origin: string) => Promise<unknown>,
): Promise<boolean> {
  if (!confiance) return false;
  try {
    await connecter(confiance.origin);
    return true;
  } catch {
    return false;
  }
}

/** Les sondes Electron ont une session non persistante séparée du trafic du renderer. */
export function creerSessionSondeCabinet<T extends { fetch: SondeFetch }>(
  fromPartition: (partition: string, options: { cache: false }) => T,
): T {
  return fromPartition("mindcare-clinic-health", { cache: false });
}

/** A single transient timeout must not bounce the application to its reconnect window. */
export function creerStabiliteSondeCabinet(): { echec(): boolean; succes(): boolean } {
  let echecs = 0;
  let succes = 0;
  let interrompu = false;
  return {
    echec() {
      succes = 0;
      if (++echecs < 2 || interrompu) return false;
      interrompu = true;
      return true;
    },
    succes() {
      echecs = 0;
      if (!interrompu || ++succes < 2) return false;
      interrompu = false;
      succes = 0;
      return true;
    },
  };
}

/** L'adresse partagée est une origine HTTPS du réseau du cabinet. */
export function validerOrigineCabinet(input: string): string {
  if (!/^https:\/\/[a-zA-Z0-9.[\]:-]+\/?$/.test(input)) throw new Error("CONFIGURATION_CABINET: origine HTTPS invalide.");
  const url = new URL(input);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const versionIp = isIP(host);
  let local = false;
  if (versionIp === 4) {
    const [a, b] = host.split(".").map(Number);
    local = a === 10 || a === 127 || (a === 192 && b === 168) || (a === 172 && b! >= 16 && b! <= 31);
  } else if (versionIp === 6) {
    local = host === "::1" || /^f[cd][0-9a-f]{2}:/.test(host);
  } else {
    local = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(host)
      || /^(?:[a-z0-9-]+\.)+(?:lan|local|internal)$/.test(host)
      || /^(?:[a-z0-9-]+\.)+home\.arpa$/.test(host);
  }
  if (!local || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("CONFIGURATION_CABINET: une adresse HTTPS locale est obligatoire.");
  }
  return url.origin;
}

/** Un client sans configuration ne doit jamais provisionner une autre base. */
export function chargerConnexionCabinet(fichier: string, artefact: "clinic-auto" | "clinic-client" | "clinic-host" | "standalone"): ConnexionCabinet {
  // Le paquet unique ne dépend plus d'une adresse saisie par l'utilisateur.
  if (artefact === "clinic-auto") return { mode: "auto" };
  if (!existsSync(fichier)) {
    if (artefact !== "standalone") throw new Error("CONFIGURATION_CABINET: configurer ce poste avec l'adresse HTTPS du cabinet.");
    return { mode: "standalone" };
  }
  try {
    if (statSync(fichier).size > 4096) throw new Error("taille");
    const data: unknown = JSON.parse(readFileSync(fichier, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("format");
    const config = data as Record<string, unknown>;
    if (config.version !== 1 || (config.mode !== "client" && config.mode !== "host") || typeof config.origin !== "string"
      || Object.keys(config).some(key => !["version", "mode", "origin"].includes(key))
      || (artefact === "clinic-host" && config.mode !== "host")) throw new Error("format");
    // Sur le poste Médecin, un Assistant de qualification reste un client.
    // Il utilise la même origine et ne provisionne jamais de base.
    return { mode: artefact === "clinic-client" ? "client" : config.mode, origin: validerOrigineCabinet(config.origin) };
  } catch {
    throw new Error("CONFIGURATION_CABINET: desktop.json invalide. Faire vérifier la configuration du cabinet.");
  }
}

/** Un échec entre découverte et chargement revient à la connexion automatique. */
export async function chargerAvecReconnexion(charger: () => Promise<unknown>, reconnecter: () => Promise<unknown>, fermee: () => boolean): Promise<void> {
  while (!fermee()) {
    try { await charger(); return; }
    catch { if (fermee()) return; await reconnecter(); }
  }
}

/** Sonde HTTPS bornée, avec la validation TLS normale de l'appelant. */
export async function attendreCabinet(origin: string, effectuer: SondeFetch, delaiMs = 45_000): Promise<void> {
  const fin = Date.now() + delaiMs;
  while (Date.now() < fin) {
    try {
      const reponse = await effectuer(`${origin}/api/health`, { redirect: "error", credentials: "omit", headers: { "Cache-Control": "no-store" }, signal: AbortSignal.timeout(Math.min(4000, Math.max(1, fin - Date.now()))) });
      if (reponse.ok && (await reponse.text()) === '{"ok":true}') return;
    } catch { /* réseau ou certificat indisponible : aucune désactivation TLS */ }
    await pause(Math.min(500, Math.max(0, fin - Date.now())));
  }
  throw new Error("CABINET_INJOIGNABLE: vérifier que le poste Médecin est allumé, le Wi-Fi du cabinet et le certificat installé.");
}
