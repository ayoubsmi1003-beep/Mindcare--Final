/**
 * A question naming a drug should reach that drug's own monograph, not another drug's
 * monograph that merely mentions it. Measured: "effets indésirables de la mirtazapine"
 * filled its five places with the reboxetine, loxapine and sertraline monographs.
 *
 * This only reorders rows that already passed fusion, and it never changes a row's score.
 * Every publication gate still applies. It can change what gets shown: only five rows are kept,
 * and the byte budget cuts from the end, so a very long row from another book can be lost.
 */
const SLOTS_FOR_ONE_DRUG = 2;

const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’']/gu, " ");
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\/]/gu, "\\$&");

/** Exact root only: "Lithium toxicity › …" is about lithium but isn't its monograph. */
export function monographOwner(section: string | null | undefined, names: readonly string[]): string | null {
  if (!section || !section.includes("›")) return null;
  const root = fold(section).split("›")[0]?.trim() ?? "";
  return names.find(name => new RegExp(`^${escape(name)}(?: \\([^)]*\\))?$`, "u").test(root)) ?? null;
}

/** The last path segment says what a row is about: "Dosing and Use › Overdose" isn't about dosing. */
export function sectionOnAspect(section: string | null | undefined, rubrics: readonly string[]): boolean {
  const leaf = fold(section ?? "").split("›").at(-1)?.trim() ?? "";
  return rubrics.some(rubric => new RegExp(`(?:^|[^\\p{L}])${escape(fold(rubric))}(?:$|[^\\p{L}])`, "u").test(leaf));
}

const EXCLUDES_THE_DRUG = /\b(?:sans|sauf|hors|hormis|excepte|a part|en dehors|autres? que|autre chose|a la place|au lieu|plutot que|alternatives?|remplac\w*|echec|intolerance|inefficac\w*|ne supporte|eviter|pas|plus|jamais|contre[- ]indique\w*|en cas de contre[- ]indication|without|instead|except|not|other than|rather than)\b/u;

/**
 * Which drugs may take leading places. Only with a recognized aspect, because any other section
 * of a monograph doesn't answer the question just by being about the drug. None when the question
 * may be excluding the drug ("traitement sans lithium"): wrongly firing here only gives up the gain.
 */
export function monographPriorityNames(question: string, names: readonly string[], rubrics: readonly string[]): readonly string[] {
  if (EXCLUDES_THE_DRUG.test(fold(question))) return [];
  return rubrics.length ? names : [];
}

export interface MonographOrdering<T> {
  readonly sectionOf: (row: T) => string | null | undefined;
  readonly keyOf: (row: T) => string;
  readonly names: readonly string[];
  readonly rubrics: readonly string[];
  readonly eligible: (row: T) => boolean;
}

/** Give each named drug a bounded number of leading places. With an aspect, only sections on it lead. */
export function monographsFirst<T>(ordered: readonly T[], { sectionOf, keyOf, names, rubrics, eligible }: MonographOrdering<T>): readonly T[] {
  if (!names.length) return ordered;
  const slots = names.length === 1 ? SLOTS_FOR_ONE_DRUG : 1;
  const used = new Map<string, number>(), seen = new Set<string>(), leading: T[] = [];
  for (const row of ordered) {
    const owner = monographOwner(sectionOf(row), names), key = keyOf(row);
    if (owner === null || seen.has(key) || !eligible(row)) continue;
    if (rubrics.length && !sectionOnAspect(sectionOf(row), rubrics)) continue;
    const count = used.get(owner) ?? 0;
    if (count >= slots) continue;
    used.set(owner, count + 1);
    seen.add(key);
    leading.push(row);
  }
  return leading.length ? [...leading, ...ordered.filter(row => !leading.includes(row))] : ordered;
}
