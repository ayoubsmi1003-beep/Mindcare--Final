/**
 * `POST /api/auth/provisionner` — le premier lancement, une seule fois.
 *
 * Même famille que `/api/auth/sign-in` : pas de `/api/db/rpc`, parce que
 * `preparer()` y exige une session (`non-authentifie` sinon) — inutilisable
 * avant qu'un compte existe. Bornes de saisie EN MIROIR de celles posées côté
 * base (084) : la même longueur de mot de passe (10–72, la borne bcrypt), pour
 * que l'erreur se voie dans le formulaire plutôt qu'après un aller-retour.
 *
 * CE QU'ELLE NE REND JAMAIS : le mot de passe, le détail d'une exception
 * PostgreSQL. Voir l'en-tête de `provisioning.ts` pour pourquoi les refus de
 * la porte SQL sont tous rendus comme UN SEUL code (`conflit`).
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { provisionnerCompteReel } from "@/server/auth/provisioning";

const Entree = z.object({
  cabinetNom: z.string().trim().min(1).max(200),
  cabinetAdresse: z.string().trim().max(300),
  cabinetTelephone: z.string().trim().max(30),
  praticienNomComplet: z.string().trim().min(1).max(200),
  praticienTitre: z.string().trim().max(50),
  praticienNumeroOrdre: z.string().trim().max(50),
  praticienTelephone: z.string().trim().max(30),
  email: z.string().trim().min(1).max(320).email(),
  motDePasse: z.string().min(10).max(72),
});

export async function POST(requete: Request): Promise<NextResponse> {
  let corps: unknown;
  try {
    corps = await requete.json();
  } catch {
    return NextResponse.json({ ok: false, code: "regle-metier" }, { status: 400 });
  }

  const analyse = Entree.safeParse(corps);
  if (!analyse.success) {
    return NextResponse.json({ ok: false, code: "regle-metier" }, { status: 400 });
  }

  let userId: string | null;
  try {
    userId = await provisionnerCompteReel(analyse.data);
  } catch {
    // Base injoignable — voir l'en-tête de `provisioning.ts` pour la
    // distinction avec le refus métier ci-dessous.
    return NextResponse.json({ ok: false, code: "indisponible" }, { status: 503 });
  }

  if (userId === null) {
    // Environnement pas encore self-hosted, ou (le cas pratique le plus
    // probable une fois la validation Zod ci-dessus passée) un compte réel
    // existe déjà.
    return NextResponse.json({ ok: false, code: "conflit" }, { status: 409 });
  }

  return NextResponse.json({ ok: true, data: { userId } });
}
