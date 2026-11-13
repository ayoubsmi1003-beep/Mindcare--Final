/**
 * Single-word section roots of the Prescriber's Guide monographs, read from the indexed corpus
 * on 2026-11-07. Wider than the closed medication list, which omits most of them. This list only
 * orders retrieval and anchors retries. It is not an entity gate and grants nothing.
 */
export const MONOGRAPH_ROOTS: readonly string[] = [
  "acamprosate", "agomelatine", "alprazolam", "amisulpride", "amitriptyline", "amoxapine", "amphetamine", "aripiprazole", "armodafinil", "asenapine", "atomoxetine",
  "benztropine", "blonanserin", "bremelanotide", "brexanolone", "brexpiprazole", "buprenorphine", "bupropion", "buspirone",
  "caprylidene", "carbamazepine", "cariprazine", "chlordiazepoxide", "chlorpromazine", "citalopram", "clomipramine", "clonazepam", "clonidine", "clorazepate", "clozapine", "cyamemazine",
  "desipramine", "desvenlafaxine", "deutetrabenazine", "dextromethorphan", "diazepam", "diphenhydramine", "disulfiram", "donepezil", "dothiepin", "doxepin", "duloxetine",
  "escitalopram", "esketamine", "estazolam", "eszopiclone", "flibanserin", "flumazenil", "flunitrazepam", "fluoxetine", "flupenthixol", "fluphenazine", "flurazepam", "fluvoxamine",
  "gabapentin", "galantamine", "guanfacine", "haloperidol", "hydroxyzine", "iloperidone", "imipramine", "isocarboxazid", "ketamine",
  "lamotrigine", "lemborexant", "levetiracetam", "levomilnacipran", "lisdexamfetamine", "lithium", "lofepramine", "lofexidine", "loflazepate", "lorazepam", "loxapine", "lumateperone", "lurasidone",
  "maprotiline", "memantine", "methylfolate", "methylphenidate", "mianserin", "midazolam", "milnacipran", "mirtazapine", "moclobemide", "modafinil", "molindone",
  "nalmefene", "naltrexone", "nefazodone", "nortriptyline", "olanzapine", "oxazepam", "oxcarbazepine",
  "paliperidone", "paroxetine", "perospirone", "perphenazine", "phenelzine", "pimavanserin", "pimozide", "pipothiazine", "pitolisant", "prazosin", "pregabalin", "propranolol", "protriptyline",
  "quazepam", "quetiapine", "ramelteon", "reboxetine", "risperidone", "rivastigmine", "selegiline", "sertindole", "sertraline", "sildenafil", "solriamfetol", "sulpiride", "suvorexant",
  "tasimelteon", "temazepam", "thioridazine", "thiothixene", "tiagabine", "tianeptine", "topiramate", "tranylcypromine", "trazodone", "triazolam", "trifluoperazine", "trihexyphenidyl", "triiodothyronine", "trimipramine",
  "valbenazine", "valproate", "varenicline", "venlafaxine", "vilazodone", "vortioxetine", "zaleplon", "ziprasidone", "zolpidem", "zonisamide", "zopiclone", "zotepine", "zuclopenthixol",
];

const ROOTS: ReadonlySet<string> = new Set(MONOGRAPH_ROOTS);
/** The one monograph titled in two words ("Sodium oxybate", read from the corpus on 2026-11-13): its own word names it, in French order too. */
export const TWO_WORD_MONOGRAPHS: Readonly<Record<string, string>> = { oxybate: "sodium oxybate" };

/** French accents fold onto these names; a French ending such as "prégabaline" is matched through the English stem. */
export function requestedMonographNames(text: string): readonly string[] {
  const words = text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/\p{L}+/gu) ?? [];
  const names = words.flatMap(word => ROOTS.has(word) ? [word] : TWO_WORD_MONOGRAPHS[word] ? [TWO_WORD_MONOGRAPHS[word]!] : word.endsWith("e") && ROOTS.has(word.slice(0, -1)) ? [word.slice(0, -1)] : []);
  return [...new Set(names)];
}
