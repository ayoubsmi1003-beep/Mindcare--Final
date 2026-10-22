/**
 * `/parametres` — le choix entre les réglages Documents et ceux du cabinet.
 *
 * Avant, cette route redirigeait directement vers `/parametres/documents`. Deux
 * familles de réglages coexistent maintenant : les modèles de documents
 * (métier) et le cabinet lui-même (compte de l'accueil, postes appairés). Une
 * redirection fixe rendrait la seconde inatteignable, et un lien ajouté dans le
 * rail aurait mélangé navigation et réglages.
 */

import Link from "next/link";

export default function ParametresIndex(): React.JSX.Element {
  return (
    <main className="mx-auto flex w-full max-w-form flex-col gap-4 p-8">
      <h1 className="m-0 font-ui text-title font-semibold text-ink-900">Paramètres</h1>

      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        <li>
          <Link
            href="/parametres/documents"
            className="flex flex-col gap-1 rounded-xl border border-rule bg-card px-5 py-4 no-underline shadow-douce transition duration-quick ease-out hover:border-action-600 hover:shadow-lift1 focus-visible:outline focus-visible:outline-action-600"
          >
            <span className="font-ui text-body font-semibold text-ink-900">Documents</span>
            <span className="font-ui text-label text-ink-500">
              Modèles, en-tête, numérotation et préférences d&apos;impression.
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/parametres/cabinet"
            className="flex flex-col gap-1 rounded-xl border border-rule bg-card px-5 py-4 no-underline shadow-douce transition duration-quick ease-out hover:border-action-600 hover:shadow-lift1 focus-visible:outline focus-visible:outline-action-600"
          >
            <span className="font-ui text-body font-semibold text-ink-900">Cabinet &amp; postes</span>
            <span className="font-ui text-label text-ink-500">
              Compte du poste d&apos;accueil et autorisation des ordinateurs du cabinet.
            </span>
          </Link>
        </li>
      </ul>
    </main>
  );
}
