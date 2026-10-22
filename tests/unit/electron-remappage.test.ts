import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, connect, type Server, type Socket } from "node:net";

import { demarrerRemappage, type Remappage } from "../../electron/main/remappage-cabinet";

/**
 * Le remappage ne change QUE l'adresse : le tunnel doit transporter les octets
 * tels quels, refuser toute autre cible, et échouer proprement quand aucune
 * adresse n'est connue.
 */
describe("remappage d'adresse du cabinet", () => {
  let echo: Server;
  let portEcho: number;

  beforeEach(async () => {
    echo = createServer((socket) => {
      socket.on("data", (donnees) => socket.write(donnees));
    });
    await new Promise<void>((resoudre) => echo.listen(0, "127.0.0.1", () => resoudre()));
    const adresse = echo.address();
    if (adresse === null || typeof adresse === "string") throw new Error("port echo");
    portEcho = adresse.port;
  });

  afterEach(async () => {
    await new Promise<void>((resoudre) => echo.close(() => resoudre()));
  });

  /** Établit un tunnel CONNECT et rend le socket prêt à échanger. */
  function tunnel(port: number, cible: string): Promise<{ socket: Socket; entete: string }> {
    return new Promise((resoudre, rejeter) => {
      const socket = connect(port, "127.0.0.1", () => {
        socket.write(`CONNECT ${cible} HTTP/1.1\r\nHost: ${cible}\r\n\r\n`);
      });
      let tampon = "";
      const surDonnees = (morceau: Buffer): void => {
        tampon += morceau.toString("latin1");
        if (tampon.includes("\r\n\r\n")) {
          socket.removeListener("data", surDonnees);
          resoudre({ socket, entete: tampon });
        }
      };
      socket.on("data", surDonnees);
      socket.on("error", rejeter);
      socket.setTimeout(3000, () => rejeter(new Error("timeout")));
    });
  }

  it("relaie vers l'adresse découverte en conservant les octets", async () => {
    let adresseCourante: string | null = "127.0.0.1";
    const remappage: Remappage = await demarrerRemappage({
      hostname: "doctor-pc",
      port: portEcho,
      resolve: () => adresseCourante,
    });

    try {
      const { socket, entete } = await tunnel(remappage.port, `doctor-pc:${portEcho}`);
      expect(entete).toContain("200 Connection Established");

      const reponse = await new Promise<string>((resoudre) => {
        socket.once("data", (d) => resoudre(d.toString("utf8")));
        socket.write("ping-tunnel");
      });
      expect(reponse).toBe("ping-tunnel");

      // L'adresse peut changer sans redémarrer le proxy : `resolve` est relu.
      adresseCourante = null;
      const second = await tunnel(remappage.port, `doctor-pc:${portEcho}`);
      expect(second.entete).toContain("503");
      second.socket.destroy();
      socket.destroy();
    } finally {
      await remappage.fermer();
    }
  });

  it("refuse un autre hôte ou un autre port (pas de proxy ouvert)", async () => {
    const remappage = await demarrerRemappage({
      hostname: "doctor-pc",
      port: portEcho,
      resolve: () => "127.0.0.1",
    });
    try {
      const mauvaisHote = await tunnel(remappage.port, `attaquant.example:${portEcho}`);
      expect(mauvaisHote.entete).toContain("403");
      mauvaisHote.socket.destroy();

      const mauvaisPort = await tunnel(remappage.port, "doctor-pc:443");
      expect(mauvaisPort.entete).toContain("403");
      mauvaisPort.socket.destroy();
    } finally {
      await remappage.fermer();
    }
  });
});
