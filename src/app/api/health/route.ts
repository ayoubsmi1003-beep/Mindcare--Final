/**
 * `GET /api/health` — la sonde de vivacité du BACKEND, pour la coquille Electron.
 *
 * ⚠️ CE N'EST PAS le contrôle de démarrage (`verifierDemarrage`). Celui-ci
 * reste sur `/api/db/*` et `/api/jarvis/*`, à chaque requête, et vérifie la
 * base et les migrations. Ici, on répond à une seule question : le processus
 * Next.js sert-il des requêtes ? La machine à états d'Electron (§H du plan)
 * sonde la base SÉPARÉMENT, par sa propre connexion `pg.Client` — mélanger les
 * deux ferait dépendre la sonde HTTP d'une ressource qu'Electron a déjà, et
 * masquerait laquelle des deux causes explique un échec.
 *
 * Aucune authentification, aucune donnée : rien ici ne peut identifier un
 * cabinet ni une patiente. C'est délibéré — cette route doit rester
 * interrogeable AVANT toute session, par un processus local non authentifié.
 */
import { NextResponse } from "next/server";

export function GET(): NextResponse {
  return NextResponse.json({ ok: true });
}
