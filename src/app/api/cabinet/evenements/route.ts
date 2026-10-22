/**
 * `GET /api/cabinet/evenements` — le flux temps réel du cabinet.
 *
 * ═══ POURQUOI SSE ET PAS WEBSOCKET ══════════════════════════════════════════
 *
 * `electron/main/proxy-cabinet.ts` refuse explicitement les `Upgrade`
 * (`501 Not Implemented`) alors qu'il relaie déjà `text/event-stream` — et il
 * le prouve (`tests/unit/electron-cabinet-proxy.test.ts`, « delivers the first
 * SSE chunk before the response finishes »). Ajouter un serveur WebSocket
 * aurait exigé une dépendance, un second port et une seconde authentification.
 * Le flux est UNIDIRECTIONNEL par nature : le serveur pousse, le client écrit
 * par les portes `/api/db/rpc` déjà transactionnelles.
 *
 * ═══ POURQUOI UNE INTERROGATION BORNÉE, ET PAS `LISTEN` ═════════════════════
 *
 * `pg` (import de VALEUR) n'est autorisé QUE dans `src/server/db/pool.ts`
 * (`eslint.config.js` — `pgImportMessage`), et cette liste est NOMINATIVE à
 * dessein : une connexion empruntée hors de `withCaller()` porte encore
 * l'identité de la requête précédente. Ouvrir un second client `pg` ici pour un
 * `LISTEN` aurait donc élargi l'unique exception du dépôt.
 *
 * On interroge donc `app.list_cabinet_events_since` à cadence fixe, DANS
 * `withCaller` : l'identité est posée comme partout, la porte filtre par rôle,
 * et aucune connexion ne survit à l'appel. À l'échelle du cabinet (deux postes,
 * quelques écritures par minute), 600 ms de latence maximale tient la promesse
 * « sous la seconde » sans ajouter un mécanisme de cycle de vie.
 *
 * Le `pg_notify` posé par le déclencheur de `178` reste en place : il ne coûte
 * rien, et il est le point d'accroche d'un `LISTEN` le jour où l'exception
 * d'import sera rouverte pour de bon.
 *
 * ═══ CE QUE LE FLUX NE TRANSPORTE PAS ═══════════════════════════════════════
 *
 * Un kind, un numéro de séquence, un rôle cible et un identifiant d'entité.
 * Aucun nom de patient, aucun montant, aucune note. Le client rafraîchit une
 * zone qu'il est déjà autorisé à lire, par la porte habituelle — le flux ne
 * remplace jamais une autorisation, il ne fait que dire « quelque chose a
 * changé, redemande ».
 */

import { NextResponse } from "next/server";

import { preparer } from "@/app/api/db/_commun";
import { withCaller } from "@/server/db/withCaller";
import { faireePgPort } from "@/server/db/pgPort";
import { log } from "@/services/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Cadence d'interrogation : 600 ms ⇒ latence perçue < 1 s. */
const INTERVALLE_MS = 600;
/** Un commentaire SSE garde la connexion vivante (proxy : 120 s d'inactivité). */
const KEEPALIVE_MS = 20_000;
/** Trois échecs consécutifs ferment le flux : le client se reconnecte. */
const ECHECS_MAX = 3;

interface EvenementRow {
  readonly seq: number | string;
  readonly kind: string;
  readonly target_role: string | null;
  readonly entity_id: string | null;
  readonly occurred_at: string;
}

interface PayloadRow {
  readonly max_seq: number | string;
  readonly events: readonly EvenementRow[];
}

function nombre(valeur: number | string): number {
  const n = typeof valeur === "string" ? Number.parseInt(valeur, 10) : valeur;
  return Number.isFinite(n) ? n : 0;
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const minuteur = setTimeout(finir, ms);
    function finir(): void {
      clearTimeout(minuteur);
      signal.removeEventListener("abort", finir);
      resolve();
    }
    signal.addEventListener("abort", finir, { once: true });
  });
}

export async function GET(requete: Request): Promise<Response> {
  const ctx = await preparer();
  if (ctx instanceof NextResponse) return ctx;

  const url = new URL(requete.url);
  const demande = Number.parseInt(url.searchParams.get("depuisSeq") ?? "0", 10);
  const depart = Number.isFinite(demande) && demande > 0 ? demande : 0;

  const encodeur = new TextEncoder();
  const annulation = new AbortController();
  let ferme = false;

  const flux = new ReadableStream<Uint8Array>({
    async start(controleur) {
      const ecrire = (bloc: string): void => {
        if (ferme) return;
        try {
          controleur.enqueue(encodeur.encode(bloc));
        } catch {
          ferme = true;
        }
      };

      const fermer = (): void => {
        if (ferme) return;
        ferme = true;
        annulation.abort();
        try {
          controleur.close();
        } catch {
          /* déjà fermé par l'appelant */
        }
      };

      requete.signal.addEventListener("abort", fermer, { once: true });

      // `retry` : cadence de reconnexion conseillée à EventSource. Le client
      // gère la sienne (il reconstruit l'URL avec son curseur), mais ce champ
      // couvre un client qui n'aurait pas notre hook.
      ecrire("retry: 3000\n: flux du cabinet ouvert\n\n");

      let curseur = depart;
      let echecs = 0;
      let dernierKeepalive = Date.now();
      let arretDemande = false;

      while (!ferme && !arretDemande) {
        try {
          const resultat = await withCaller(ctx.userId, async (q) =>
            faireePgPort(q, "api.cabinet.evenements").rpc<PayloadRow>("list_cabinet_events_since", {
              p_since_seq: curseur,
            }),
          );

          if (!resultat.ok) {
            echecs += 1;
            if (echecs >= ECHECS_MAX) {
              // Une base devenue injoignable ne doit pas laisser un flux muet :
              // on ferme, le client repasse en « reconnexion » et réessaie.
              log.error("cabinet.evenements", { code: resultat.error.code, count: echecs });
              fermer();
              break;
            }
          } else {
            echecs = 0;
            const charge = resultat.data[0];
            if (charge !== undefined) {
              const maxSeq = nombre(charge.max_seq);
              let dernierEmis = curseur;

              for (const e of charge.events ?? []) {
                const seq = nombre(e.seq);
                if (seq <= curseur) continue;
                dernierEmis = seq;
                ecrire(
                  `id: ${seq}\nevent: cabinet\ndata: ${JSON.stringify({
                    seq,
                    kind: e.kind,
                    target_role: e.target_role,
                    entity_id: e.entity_id,
                    occurred_at: e.occurred_at,
                  })}\n\n`,
                );
              }

              curseur = dernierEmis;

              // Plus de 200 événements en attente : la porte a tronqué. Le
              // client doit relire l'état complet plutôt que de croire qu'il
              // est à jour — on le lui dit explicitement.
              if (maxSeq > curseur) {
                ecrire(`event: resync\ndata: ${JSON.stringify({ max_seq: maxSeq })}\n\n`);
                curseur = maxSeq;
              }
            }
          }
        } catch (cause) {
          echecs += 1;
          // `causeName` seulement : jamais le message d'une exception, qui peut
          // porter une valeur de ligne (I5).
          log.error("cabinet.evenements.flux", {
            causeName: cause instanceof Error ? cause.name : "inconnu",
            count: echecs,
          });
          if (echecs >= ECHECS_MAX) {
            fermer();
            break;
          }
        }

        if (Date.now() - dernierKeepalive >= KEEPALIVE_MS) {
          ecrire(": keepalive\n\n");
          dernierKeepalive = Date.now();
        }

        await pause(INTERVALLE_MS, annulation.signal);
      }

      fermer();
    },
    cancel() {
      ferme = true;
      annulation.abort();
    },
  });

  return new Response(flux, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      // `no-transform` : un intermédiaire ne doit ni compresser ni bufferiser un
      // flux d'événements — le proxy du cabinet le relaie déjà sans tampon.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
