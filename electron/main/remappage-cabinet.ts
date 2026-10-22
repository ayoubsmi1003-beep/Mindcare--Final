/**
 * Le remappage d'adresse du cabinet — côté POSTE CLIENT.
 *
 * ═══ LE PROBLÈME MESURÉ ═════════════════════════════════════════════════════
 *
 * Le certificat du cabinet est émis pour `<nom-du-pc-médecin>` : c'est cette
 * identité que le poste d'accueil épingle, et c'est elle qui garantit qu'il
 * parle au bon cabinet. Le nom est résolu par Windows (LLMNR / DNS local), qui
 * rend l'adresse COURANTE — sauf quand le routeur ne fournit pas de DNS local,
 * quand LLMNR est désactivé par stratégie, ou quand le cache de résolution est
 * périmé après un changement de bail DHCP. Le poste est alors injoignable
 * alors que la découverte UDP, elle, connaît la bonne adresse IPv4.
 *
 * ═══ LA SOLUTION, ET POURQUOI CE N'EST PAS UN CONTOURNEMENT DE TLS ══════════
 *
 * Un proxy CONNECT local, en boucle locale, qui relaie `nom:43118` vers
 * l'adresse découverte. Il ne déchiffre RIEN : il recopie des octets. Le
 * navigateur continue donc d'ouvrir sa session TLS avec `SNI = nom`, de
 * vérifier le certificat épinglé et son SAN — exactement comme avant. Seule la
 * résolution de l'adresse change.
 *
 *   · il n'accepte QUE le nom et le port du cabinet ; toute autre cible reçoit
 *     `403`, donc il ne devient pas un proxy ouvert sur le poste ;
 *   · il n'écoute que sur `127.0.0.1`, sur un port éphémère ;
 *   · il n'est activé qu'après DEUX échecs de sonde consécutifs, quand la
 *     découverte a effectivement trouvé une adresse.
 */

import { createServer, type Server } from "node:http";
import { connect, type Socket } from "node:net";

export interface OptionsRemappage {
  /** Nom d'hôte épinglé dans le certificat (`doctor-pc`). */
  readonly hostname: string;
  /** Port HTTPS du cabinet (`43118`). */
  readonly port: number;
  /** Adresse IPv4 courante, relue à chaque connexion (elle peut changer). */
  readonly resolve: () => string | null;
}

export interface Remappage {
  readonly port: number;
  readonly fermer: () => Promise<void>;
}

export async function demarrerRemappage(options: OptionsRemappage): Promise<Remappage> {
  // `node:http` et non `node:net` : l'événement `connect` (CONNECT) appartient
  // au serveur HTTP. Sur un `net.Server`, il n'existe pas et le proxy ne
  // relayerait jamais rien.
  const serveur: Server = createServer((_requete, reponse) => {
    // Aucune requête HTTP en clair n'a de raison d'arriver ici.
    reponse.writeHead(405, { Connection: "close" });
    reponse.end();
  });

  serveur.on("connect", (requete, socket: Socket, tete) => {
    const parties = (requete.url ?? "").split(":");
    const hote = (parties[0] ?? "").toLowerCase();
    const portCible = Number(parties[1]);

    if (hote !== options.hostname.toLowerCase() || portCible !== options.port) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }

    const adresse = options.resolve();
    if (adresse === null || !/^\d{1,3}(\.\d{1,3}){3}$/.test(adresse)) {
      socket.end("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      return;
    }

    const amont = connect(portCible, adresse, () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (tete.length > 0) amont.write(tete);
      socket.pipe(amont);
      amont.pipe(socket);
    });

    amont.on("error", () => socket.destroy());
    socket.on("error", () => amont.destroy());
    socket.on("close", () => amont.destroy());
  });

  await new Promise<void>((resoudre, rejeter) => {
    serveur.once("error", rejeter);
    serveur.listen(0, "127.0.0.1", () => {
      serveur.removeListener("error", rejeter);
      resoudre();
    });
  });

  const adresse = serveur.address();
  if (adresse === null || typeof adresse === "string") {
    serveur.close();
    throw new Error("REMAPPAGE_PORT_INCONNU");
  }

  return {
    port: adresse.port,
    fermer: () =>
      new Promise<void>((resoudre) => {
        serveur.close(() => resoudre());
      }),
  };
}
