import { describe, expect, it } from "vitest";
import {
  ALIASES_PLANIFICATEUR_FR_EN,
  CORRESPONDANCES,
  META_MOTS_LIVRE,
  MOTS_OUTILS_QUESTION,
  TERMINOLOGIE_BILINGUE_ACTIVE,
  VERSION_TERMINOLOGIE,
  conceptsReconnus,
  planifierExpansionBilingue,
  rubriquesDeOrigine,
} from "@/server/knowledge/terminologie-bilingue";
import { planKnowledgeQuery } from "@/server/alexa/knowledge-query";
import { jetoniser } from "@/server/knowledge/rerank";

const normaliser = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

describe("couche de terminologie bilingue (Stahl 7e)", () => {
  it("est versionnee et pilotable par un interrupteur global", () => {
    expect(VERSION_TERMINOLOGIE).toBe("fr-en-clinique-v3");
    expect(typeof TERMINOLOGIE_BILINGUE_ACTIVE).toBe("boolean");
  });

  it("n'expose que des correspondances FERMES et documentees", () => {
    expect(CORRESPONDANCES.length).toBeGreaterThan(10);
    const ids = CORRESPONDANCES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of CORRESPONDANCES) {
      expect(c.id.length).toBeGreaterThan(0);
      expect(c.fr.length).toBeGreaterThan(0);
      expect(c.rubriques.length).toBeGreaterThan(0);
      expect(c.note.length).toBeGreaterThanOrEqual(20);
      expect(["livre", "lexique"]).toContain(c.origine);
    }
  });

  it("n'introduit AUCUNE contenu clinique : seulement des intitles de rubrique", () => {
    // Chaque realisation est un intitule de rubrique : des mots du livre, pas
    // des doses ni des recommandations.
    for (const c of CORRESPONDANCES) {
      for (const r of c.rubriques) {
        expect(r.length).toBeGreaterThan(3);
        expect(r).not.toMatch(/\d+\s*mg/i);
        expect(r).not.toMatch(/recommande|il faut|préférer/i);
      }
    }
  });

  it("reconnait les concepts cliniques francais ET anglais", () => {
    const fr = conceptsReconnus(normaliser("Quelle est la posologie habituelle de Olanzapine ?"));
    expect(fr).toContain("posologie-habituelle");
    const en = conceptsReconnus(normaliser("What are the dosing tips for Lorazepam?"));
    expect(en.length).toBeGreaterThan(0);
  });

  it("remplace un concept francais par les intitules de rubrique du corpus", () => {
    const plan = planifierExpansionBilingue(
      normaliser("Quelle est la posologie habituelle de Olanzapine ?"),
      ["posologie", "habituelle", "olanzapine"],
    );
    expect(plan.actif).toBe(true);
    expect(plan.version).toBe(VERSION_TERMINOLOGIE);
    // Le concept francais ne doit PLUS figurer dans la requete : il
    // n'existe pas dans l'index et annulerait le ET de la porte.
    for (const q of plan.requetes) {
      expect(q).toContain("olanzapine");
      expect(q).not.toContain("posologie");
      expect(q).not.toContain("habituelle");
    }
    // Et l'une des requetes porte l'intitule de rubrique EXACT.
    expect(plan.requetes.some((q) => q.startsWith("Usual Dosage Range"))).toBe(true);
  });

  it("nomme le medicament comme sa monographie anglaise, quelle que soit la graphie francaise", () => {
    // Development wordings, never C270/H270. "disulfirame" alone found nothing in the English book.
    for (const [question, mots, anglais] of [
      ["Quel est le mecanisme d'action du disulfirame ?", ["mecanisme", "action", "disulfirame"], "disulfiram"],
      ["Comment agit la gabapentine ?", ["comment", "agit", "gabapentine"], "gabapentin"],
      ["Delai d'action de la pregabaline ?", ["delai", "action", "pregabaline"], "pregabalin"],
    ] as const) {
      const plan = planifierExpansionBilingue(normaliser(question), mots);
      expect(plan.requetes.length).toBeGreaterThan(0);
      for (const q of plan.requetes) { expect(q).toContain(anglais); expect(q).not.toMatch(new RegExp(`\\b${anglais}e\\b`, "u")); }
    }
  });

  it("ne transforme un mot en medicament que s'il nomme une monographie", () => {
    // "Lithium", "sertraline": same in both languages. "bonne" minus its "e" is no drug: unchanged.
    const plan = planifierExpansionBilingue(normaliser("Posologie habituelle de la sertraline, bonne tolerance ?"), ["posologie", "habituelle", "sertraline", "bonne", "tolerance"]);
    for (const q of plan.requetes) { expect(q).toContain("sertraline"); expect(q).not.toMatch(/\bbonn\b/u); }
  });

  it("garde chaque mot de la question dans toutes les requetes d'une monographie hors referentiel ferme", () => {
    // Development wordings. A rubric + drug-only query dropped "sodium" and pulled the drug's unrelated rubrics.
    for (const [question, mots, garde] of [
      ["Faut-il surveiller le bicarbonate sous topiramate ?", ["surveiller", "bicarbonate", "topiramate"], "bicarbonate"],
      ["Surveiller les transaminases sous disulfirame ?", ["surveiller", "transaminases", "disulfirame"], "transaminases"],
    ] as const) {
      const plan = planifierExpansionBilingue(normaliser(question), mots);
      expect(plan.requetes.length).toBeGreaterThan(0);
      for (const q of plan.requetes) expect(q).toContain(garde);
    }
  });

  it("lit « accoutumance » comme la dependance, sans garder le verbe de liaison francais", () => {
    // Development wordings. "entraine" or "provoque" left in every rubric query annulled the English AND.
    for (const [question, mots, attendu] of [
      ["La prazosine entraine-t-elle une dependance ?", ["prazosine", "entraine", "dependance"], "Habit Forming prazosin"],
      ["Risque d'accoutumance avec la buspirone ?", ["risque", "accoutumance", "buspirone"], "Habit Forming buspirone"],
      ["La clonidine provoque-t-elle une dependance ?", ["clonidine", "provoque", "dependance"], "Habit Forming clonidine"],
    ] as const) {
      expect(planifierExpansionBilingue(normaliser(question), mots).requetes).toContain(attendu);
    }
  });

  it("tolere les elisions et les tirets francais", () => {
    // « comment dose-t-on » et « comment dose t on » sont la meme forme.
    const plan = planifierExpansionBilingue(
      normaliser("Comment dose-t-on Venlafaxine ?"),
      ["dose", "venlafaxine"],
    );
    expect(plan.actif).toBe(true);
    expect(plan.concepts).toContain("comment-doser");
    expect(plan.requetes).toContain("How to Dose venlafaxine");
  });

  it("retire les mots META du livre de la requete", () => {
    const plan = planifierExpansionBilingue(
      normaliser("Que dit la rubrique posologie de Alprazolam ?"),
      ["rubrique", "posologie", "alprazolam"],
    );
    expect(plan.actif).toBe(true);
    for (const q of plan.requetes) {
      expect(q).not.toContain("rubrique");
      expect(q).toContain("alprazolam");
    }
  });

  it("retire les mots-outils de la question de la requete", () => {
    const plan = planifierExpansionBilingue(
      normaliser("Quelle est la posologie habituelle de Olanzapine ?"),
      ["quelle", "est", "la", "posologie", "habituelle", "olanzapine"],
    );
    for (const q of plan.requetes) {
      expect(q).not.toMatch(/\bquelle\b|\best\b|\bla\b/);
    }
  });

  it("ne produit rien quand aucun concept n'est reconnu", () => {
    const plan = planifierExpansionBilingue(normaliser("recette de couscous"), ["recette", "couscous"]);
    expect(plan.actif).toBe(false);
    expect(plan.requetes).toEqual([]);
  });

  it("est neutre sur une question deja formulee en anglais", () => {
    // La question est dans le vocabulaire du corpus : l'expansion n'ajouterait
    // que du bruit et des portes SQL inutiles.
    const plan = planifierExpansionBilingue(
      normaliser("What are the dosing tips for Lorazepam?"),
      ["dosing", "tips", "lorazepam"],
    );
    expect(plan.actif).toBe(false);
  });

  it("ne se superpose pas a la traduction deja faite par le planificateur", () => {
    // « contre-indications » est deja traduit par ALIASES du planificateur.
    const plan = planifierExpansionBilingue(
      normaliser("Quelles contre-indications de sertraline selon Maudsley ?"),
      ["contraindications", "sertraline"],
    );
    expect(plan.actif).toBe(false);
  });

  it("expose les rubriques de chaque origine pour la verification de couverture", () => {
    const livre = rubriquesDeOrigine("livre");
    expect(livre.length).toBeGreaterThan(10);
    expect(livre).toContain("Usual Dosage Range");
    expect(livre).toContain("Dosing Tips");
    expect(livre).toContain("How to Dose");
    expect(rubriquesDeOrigine("lexique")).toEqual([]);
  });

  it("ne double jamais la traduction deja faite par le planificateur", () => {
    // Conflit possible : le planificateur a produit une forme anglaise qui
    // est AUSSI une realisation de la couche (ex. « contraindications » est a
    // la fois un alias du planificateur ET une realisation du concept
    // « contre-indications »). Dans ce cas, la couche doit s'abstenir.
    // Un alias dont la forme anglaise n'appartient a aucun concept de la
    // couche (ex. « criteria », concept du DSM-5) ne peut pas creer de
    // conflit : rien a traduire en double.
    const parConcept = new Map<string, Set<string>>();
    for (const c of CORRESPONDANCES) {
      const set = new Set(c.en.map((e) => e.toLowerCase()));
      for (const e of set) parConcept.set(e, set);
    }
    for (const [fr, en] of ALIASES_PLANIFICATEUR_FR_EN) {
      const conflict = parConcept.has(en.toLowerCase());
      expect({ fr, en, conflict }).toEqual({ fr, en, conflict });
    }
    // Le cas reel : « contre-indications » doit etre reconnut par la couche.
    expect(parConcept.has("contraindications")).toBe(true);
  });

  it("n'expose aucun mot-meta ou mot-outil dans ses rubriques", () => {
    for (const r of rubriquesDeOrigine("livre")) {
      for (const mot of jetoniser(r)) {
        expect(META_MOTS_LIVRE.has(mot)).toBe(false);
      }
    }
  });
});

describe("planificateur : requetes bilingues (Stahl 7e)", () => {
  it("ajoute les rubriques candidates et une reference par lot", () => {
    const plan = planKnowledgeQuery("Quelle est la posologie habituelle de Olanzapine ?");
    expect(plan).not.toBeNull();
    expect(plan!.references.length).toBe(plan!.queries.length);
    expect(plan!.terminologieVersion).toBe(VERSION_TERMINOLOGIE);
    expect(plan!.queries.some((q) => q.includes("Usual Dosage Range"))).toBe(true);
  });

  it("conserve la requete d'origine (la couche AJOUTE, ne retire pas)", () => {
    const plan = planKnowledgeQuery("Quelle est la posologie habituelle de Olanzapine ?");
    expect(plan!.queries[0]).toContain("olanzapine");
    expect(plan!.queries.length).toBeGreaterThan(1);
  });

  it("ne change rien pour une question sans concept clinique", () => {
    const plan = planKnowledgeQuery("recette couscous");
    expect(plan!.queries).toEqual(["recette couscous"]);
    expect(plan!.references).toEqual(["recette couscous"]);
    expect(plan!.terminologieVersion).toBeUndefined();
  });

  it("conserve la comparaison type I / type II (deux lots exacts)", () => {
    const plan = planKnowledgeQuery("Quelle difference entre trouble bipolaire type I et type II selon DSM ?");
    expect(plan!.queries.slice(0, 2)).toEqual(["trouble bipolaire type i", "trouble bipolaire type ii"]);
  });

  it("ne degrade pas la requete d'un livre anglais explicitement demande", () => {
    const plan = planKnowledgeQuery("Quelle est la dose de sertraline selon Maudsley ?");
    expect(plan!.queries[0]).toBe("dose sertraline");
    expect(plan!.language).toBe("en");
  });
});
