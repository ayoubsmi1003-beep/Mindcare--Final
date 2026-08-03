/**
 * Environnement de déploiement — ADR-016.
 *
 * Sert le bandeau « données fictives ». La valeur est LUE EN BASE, jamais
 * déduite d'une variable d'environnement ni d'une constante : le bandeau doit
 * dire ce que la base FAIT, pas ce qu'on croit qu'elle fait. Un fichier `.env`
 * mal copié se trompe en silence ; `app.deployment` porte la valeur que le
 * déclencheur `assert_synthetic_when_cloud` consulte réellement.
 *
 * Lecture seule. La fonction de bascule de 016 n'est pas exposée et ne le
 * sera pas : basculer un déploiement depuis le navigateur n'est pas une
 * fonctionnalité, c'est une porte.
 */

import { db } from "./db";
import { log } from "./log";
import { ok, type Result } from "./result";

export type DeploymentEnvironment = "cloud-dev" | "self-hosted";

interface DeploymentRow {
  readonly environment: string;
}

/**
 * DÉFAUT SÛR, et c'est le point important de cette fonction : en cas d'échec de
 * lecture, on rend `cloud-dev`, c'est-à-dire la valeur qui FAIT APPARAÎTRE le
 * bandeau. Ne pas savoir dans quel environnement on est n'est pas une raison de
 * laisser croire que la base porte des dossiers réels. Le sens du défaut est
 * dicté par la conséquence de l'erreur, pas par la fréquence du cas.
 */
export async function getDeploymentEnvironment(): Promise<Result<DeploymentEnvironment>> {
  const result = await db().select<DeploymentRow>({
    relation: "deployment",
    columns: ["environment"],
    limit: 1,
  });

  if (!result.ok) {
    log.warn("deployment.lecture-impossible", { code: result.error.code });
    return ok("cloud-dev");
  }

  const row = result.data[0];
  if (row === undefined || row.environment !== "self-hosted") {
    return ok("cloud-dev");
  }
  return ok("self-hosted");
}
