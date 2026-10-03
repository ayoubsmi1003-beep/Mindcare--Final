/** Closed local vocabulary; it neither prescribes nor validates a recorded drug. */
export const medicationNames = ["sertraline", "escitalopram", "citalopram", "fluoxetine", "paroxetine", "fluvoxamine", "venlafaxine", "duloxetine",
  "mirtazapine", "amitriptyline", "clomipramine", "trazodone", "vortioxetine", "bupropion", "agomelatine", "quetiapine",
  "olanzapine", "risperidone", "aripiprazole", "haloperidol", "clozapine", "amisulpride", "lithium", "valproate", "lamotrigine",
  "carbamazepine", "diazepam", "lorazepam", "alprazolam", "clonazepam", "bromazepam", "hydroxyzine", "pregabalin",
  "gabapentin", "zolpidem", "zopiclone", "melatonine", "methylphenidate", "atomoxetine"] as const;

export function isMedicationName(text: string): boolean {
  return medicationNames.some(name => name === text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase());
}

export function mentionsMedication(text: string): boolean {
  return (text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/\p{L}+/gu) ?? [])
    .some(word => isMedicationName(word) || word === "سيرترالين" || word === "السيرترالين");
}
