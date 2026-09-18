/**
 * Utilitaire `cn` — concaténation conditionnelle de classes.
 * Implémentation locale sans dépendance : le dépôt n'installe ni `clsx`
 * ni `tailwind-merge`, et la primitive `Anneau` n'a jamais eu besoin
 * d'une fusion de conflits Tailwind — le chart est le seul consommateur.
 */
export function cn(...classes: Array<string | undefined | null | false>): string {
  return classes.filter(Boolean).join(" ");
}
