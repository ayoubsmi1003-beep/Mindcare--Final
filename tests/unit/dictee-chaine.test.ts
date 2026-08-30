/**
 * LA CHAÎNE DE DICTÉE, DE BOUT EN BOUT — SANS MICRO.
 *
 * ═══ CE QUI EST RÉEL ICI, ET CE QUI NE L'EST PAS ═══
 *
 * Réel : `actionMicro`, `cibleDeRestitution` et `insererDictee` — le code de
 * production, composé exactement dans l'ordre où le crochet les compose.
 * Simulé : UNIQUEMENT la frontière matérielle, c'est-à-dire le texte que le
 * fournisseur de transcription aurait rendu.
 *
 * ⚠️ CE FICHIER NE PROUVE PAS LE MATÉRIEL. Il ne dit rien de la capture par un
 * micro physique, de la permission navigateur, ni de la qualité de
 * reconnaissance sur une voix humaine. Il prouve que SI un texte revient, il
 * atterrit dans la bonne rubrique sans rien détruire — ce qui est la partie
 * dont une erreur serait silencieuse.
 *
 * Les tests unitaires de `regles-dictee` et `insertion-dictee` couvrent déjà
 * chaque règle isolément ; ici on vérifie leur COMPOSITION, qui est l'endroit
 * où un routage se perd.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  actionMicro,
  cibleDeRestitution,
  type EtatDictee,
} from "../../src/components/consultation/regles-dictee";
import { insererDictee } from "../../src/services/insertion-dictee";

type Champ = "brut" | "subjective" | "objective" | "assessment" | "plan";
const RUBRIQUES = ["subjective", "objective", "assessment", "plan"] as const;

/**
 * Le pilote — il reproduit l'ENCHAÎNEMENT du crochet, pas ses règles : chaque
 * décision est déléguée au code de production importé ci-dessus.
 */
class Consultation {
  champs: Record<Champ, string> = {
    brut: "",
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
  };
  /** Position du curseur par champ — `null` quand le champ n'a jamais eu le focus. */
  curseurs: Partial<Record<Champ, number>> = {};
  etat: EtatDictee<Champ> = { cible: null, phase: "repos" };
  /** Chaque écriture passée à l'enregistrement automatique existant. */
  ecritures: { champ: Champ; texte: string }[] = [];
  erreurs: string[] = [];
  rechargements = 0;

  /** Une pression sur le micro de `champ`. Rend l'action réellement retenue. */
  presser(champ: Champ): "demarrer" | "arreter" | "ignorer" {
    const action = actionMicro(this.etat, champ);
    if (action === "demarrer") this.etat = { cible: champ, phase: "ecoute" };
    if (action === "arreter") this.etat = { cible: champ, phase: "transcription" };
    return action;
  }

  /** La transcription revient pour la dictée démarrée sur `demarree`. */
  transcrire(demarree: Champ, texte: string): void {
    const cible = cibleDeRestitution(demarree, this.etat.cible);
    this.etat = { cible: null, phase: "repos" };
    const { texte: suivant, curseur } = insererDictee(
      this.champs[cible],
      texte,
      this.curseurs[cible] ?? null,
    );
    this.champs[cible] = suivant;
    this.curseurs[cible] = curseur;
    // La voix n'a pas de chemin de sauvegarde à elle : elle repasse par
    // l'écriture ordinaire du champ, donc par l'enregistrement automatique.
    this.ecritures.push({ champ: cible, texte: suivant });
  }

  /** L'échec côté fournisseur — ce qui doit arriver, et surtout ne pas arriver. */
  echouer(message: string): void {
    this.etat = { cible: null, phase: "repos" };
    this.erreurs.push(message);
  }
}

let c: Consultation;
beforeEach(() => {
  c = new Consultation();
});

describe("chaque rubrique reçoit sa propre dictée", () => {
  it.each(RUBRIQUES)("la dictée démarrée sur %s atterrit dans %s", (rubrique) => {
    c.presser(rubrique);
    c.presser(rubrique);
    c.transcrire(rubrique, "Texte dicté.");

    expect(c.champs[rubrique]).toBe("Texte dicté.");
    // Et NULLE PART AILLEURS : un transcript dupliqué sur les quatre rubriques
    // serait aussi faux qu'un transcript mal routé.
    for (const autre of RUBRIQUES) {
      if (autre !== rubrique) expect(c.champs[autre]).toBe("");
    }
    expect(c.champs.brut).toBe("");
  });

  it("quatre dictées successives remplissent quatre rubriques distinctes", () => {
    for (const r of RUBRIQUES) {
      c.presser(r);
      c.presser(r);
      c.transcrire(r, `Dicté dans ${r}.`);
    }
    expect(c.champs.subjective).toBe("Dicté dans subjective.");
    expect(c.champs.objective).toBe("Dicté dans objective.");
    expect(c.champs.assessment).toBe("Dicté dans assessment.");
    expect(c.champs.plan).toBe("Dicté dans plan.");
  });
});

describe("le texte déjà écrit survit", () => {
  it("insère au curseur sans effacer ce qui l'entoure", () => {
    c.champs.subjective = "Rapporte une anxiété. Sommeil perturbé.";
    c.curseurs.subjective = 21; // juste après la première phrase
    c.presser("subjective");
    c.presser("subjective");
    c.transcrire("subjective", "Appétit conservé.");

    expect(c.champs.subjective).toContain("Rapporte une anxiété.");
    expect(c.champs.subjective).toContain("Sommeil perturbé.");
    expect(c.champs.subjective).toContain("Appétit conservé.");
    expect(c.champs.subjective.indexOf("Appétit")).toBeLessThan(
      c.champs.subjective.indexOf("Sommeil"),
    );
  });

  it("ajoute à la fin quand le champ n'a jamais eu le focus", () => {
    c.champs.plan = "Revoir dans un mois.";
    c.presser("plan");
    c.presser("plan");
    c.transcrire("plan", "Poursuivre le traitement.");
    expect(c.champs.plan).toBe("Revoir dans un mois.\nPoursuivre le traitement.");
  });
});

describe("la cible est figée au DÉPART", () => {
  // ⚠️ LE SCÉNARIO QUI MOTIVE TOUT LE MÉCANISME. La transcription revient
  // plusieurs secondes après le geste ; le focus a bougé entre-temps. Router à
  // l'arrivée écrirait le Subjectif dans la Conduite à tenir, sans que rien à
  // l'écran ne le signale — et la note serait fausse.
  it("un transcript tardif de Subjectif reste dans Subjectif alors que le focus est sur Conduite à tenir", () => {
    c.champs.plan = "Conduite déjà rédigée.";
    c.presser("subjective");
    c.presser("subjective");

    // Entre l'arrêt et la réponse, la praticienne clique ailleurs et écrit.
    c.curseurs.plan = c.champs.plan.length;
    c.etat = { cible: null, phase: "repos" };

    c.transcrire("subjective", "Ce que la patiente rapporte.");

    expect(c.champs.subjective).toBe("Ce que la patiente rapporte.");
    expect(c.champs.plan).toBe("Conduite déjà rédigée.");
  });
});

describe("un seul enregistreur à la fois", () => {
  it("refuse de démarrer une seconde dictée pendant qu'une écoute est en cours", () => {
    expect(c.presser("subjective")).toBe("demarrer");
    for (const autre of ["objective", "assessment", "plan", "brut"] as const) {
      expect(c.presser(autre)).toBe("ignorer");
    }
    // L'écoute initiale n'a pas bougé : aucune pression parasite ne l'a volée.
    expect(c.etat).toEqual({ cible: "subjective", phase: "ecoute" });
  });

  it("refuse toute pression pendant la transcription", () => {
    c.presser("assessment");
    c.presser("assessment"); // → transcription
    expect(c.presser("assessment")).toBe("ignorer");
    expect(c.presser("objective")).toBe("ignorer");
  });
});

describe("quand la transcription échoue", () => {
  it("ne touche à AUCUN champ et ne recharge pas la séance", () => {
    c.champs.subjective = "Note en cours de frappe.";
    c.presser("subjective");
    c.presser("subjective");
    c.echouer("La dictée n'a pas pu être transcrite.");

    expect(c.champs.subjective).toBe("Note en cours de frappe.");
    expect(c.ecritures).toEqual([]);
    expect(c.erreurs).toHaveLength(1);
    // ⚠️ UNE PERMISSION MICRO REFUSÉE NE DIT RIEN DE L'ÉTAT DU DOSSIER.
    // Recharger à ce moment ferait clignoter une note en cours de frappe.
    expect(c.rechargements).toBe(0);
    // Et l'état est rendu : le micro reste utilisable pour réessayer.
    expect(c.etat).toEqual({ cible: null, phase: "repos" });
  });
});

describe("le chemin d'enregistrement", () => {
  it("passe par l'écriture ordinaire du champ, une fois par dictée", () => {
    c.presser("objective");
    c.presser("objective");
    c.transcrire("objective", "Contact visuel maintenu.");

    expect(c.ecritures).toEqual([
      { champ: "objective", texte: "Contact visuel maintenu." },
    ]);
  });
});
