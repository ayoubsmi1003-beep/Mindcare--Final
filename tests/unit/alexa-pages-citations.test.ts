import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { readKnowledge } from "@/server/alexa/knowledge-adapter";
import { knowledgeSource } from "@/server/alexa/knowledge-response";
import { EDITIONS, editionDe } from "@/server/knowledge/editions";
import {
  carteDepuisJson,
  citationDepuisExtrait,
  formaterLocalisation,
  ligneCitation,
  localiserDepuisUnite,
  localiserExtrait,
  localisationDeLOuvrage,
} from "@/server/knowledge/pages";
import { mapLimite } from "@/server/knowledge/parallele";
import type { ArgsJarvis, ClientSql } from "@/server/jarvis/client-sql";

const DSM = "DSM-5 — Manuel diagnostique et statistique des troubles mentaux";
const MAUDSLEY = "The Maudsley Prescribing Guidelines in Psychiatry";
const DSM_VERSION = "sha256:be145e65aa8291dcb59e56ad61b86bcc41d4145ab2344a1c50f10582dcfa1d53";
const MAUDSLEY_VERSION = "sha256:14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0";
const SECTION = "Section II — Critères diagnostiques et codes › Troubles anxieux › Trouble panique › Critères diagnostiques";

function row(titre: string, texte: string, extra: Record<string, unknown> = {}) {
  return {
    chunk_id: titre === DSM ? "dsm-chunk" : "maudsley-chunk",
    source_id: titre,
    source_titre: titre,
    source_version: titre === DSM ? DSM_VERSION : MAUDSLEY_VERSION,
    section: SECTION,
    version_chunk: "struct-v2",
    langue: titre === DSM ? "fr" : "en",
    texte,
    score: 0.6,
    source_statut: "active",
    source_classification: "C4",
    source_approuvee_le: new Date("2026-09-01"),
    source_approuvee_par: "practitioner",
    source_revue_a_jour: true,
    source_remplacee_par: null,
    unit_id: "unit",
    parent_texte_hash: "parent-hash",
    enfant_index: 1,
    enfants_total: 2,
    ...extra,
  };
}

function clientAvec(rows: unknown[], options: { delai?: (args: ArgsJarvis) => number } = {}) {
  const calls: { gate: string; args: ArgsJarvis }[] = [];
  const client: ClientSql = {
    rpc: async <T,>(gate: string, args: ArgsJarvis = {}) => {
      calls.push({ gate, args });
      const attente = options.delai?.(args) ?? 0;
      if (attente > 0) await new Promise((resolve) => setTimeout(resolve, attente));
      return { data: rows as T, error: null };
    },
  };
  return { client, calls };
}

describe("localisation : le marqueur du chunk est la seule autorité", () => {
  it("lit le folio imprimé et la page PDF sans calculer d'offset", () => {
    const loc = localiserExtrait("Texte synthétique. [maudsley-prescribing-guidelines-2021-taylor-14e p.248|src:269]");
    expect(loc).toEqual({ bookId: "maudsley-prescribing-guidelines-2021-taylor-14e",
      pageImprimee: 248, pageImprimeeBrute: null, pagePdf: 269, motif: "ok" });
    expect(formaterLocalisation(loc)).toBe("p. 248");
  });

  it("n'invente pas un folio quand l'ingestion a écrit ?", () => {
    const loc = localiserExtrait("Texte. [dsm5-fr-2015-elsevier p.?|src:91]");
    expect(loc?.pageImprimee).toBeNull();
    expect(loc?.pageImprimeeBrute).toBe("?");
    expect(loc?.pagePdf).toBe(91);
    expect(loc?.motif).toBe("page-imprimee-inconnue");
    expect(formaterLocalisation(loc)).toBe("PDF p. 91");
  });

  it("refuse de choisir quand deux marqueurs divergent dans le même chunk", () => {
    const loc = localiserExtrait("A [dsm5-fr-2015-elsevier p.37|src:96] B [dsm5-fr-2015-elsevier p.38|src:97]");
    expect(loc?.motif).toBe("marqueurs-divergents");
    expect(formaterLocalisation(loc)).toBeNull();
  });

  it("ne localise rien sans marqueur", () => {
    expect(localiserExtrait("Passage sans marqueur.")).toBeNull();
    expect(formaterLocalisation(null)).toBeNull();
  });

  it("rejette une page rattachée à un autre ouvrage", () => {
    const loc = localiserExtrait("[stahl-prescribers-guide-7e-cup p.1029|src:1029]");
    expect(localisationDeLOuvrage(loc, "dsm5-fr-2015-elsevier")).toBeNull();
    expect(localisationDeLOuvrage(loc, null)).toBeNull();
    expect(localisationDeLOuvrage(loc, "stahl-prescribers-guide-7e-cup")?.pageImprimee).toBe(1029);
  });

  it("rétablit la page de l'UNITÉ quand le marqueur a disparu au découpage", () => {
    const carte = {
      "maudsley-prescribing-guidelines-2021-taylor-14e": { "tu-abc": [248, 269] as const },
    };
    const loc = localiserDepuisUnite("tu-abc", "maudsley-prescribing-guidelines-2021-taylor-14e", carte);
    expect(loc?.pageImprimee).toBe(248);
    expect(loc?.pagePdf).toBe(269);
    // Mauvais livre ou unité inconnue → aucune page, jamais celle d'un autre.
    expect(localiserDepuisUnite("tu-abc", "dsm5-fr-2015-elsevier", carte)).toBeNull();
    expect(localiserDepuisUnite("tu-inconnu", "maudsley-prescribing-guidelines-2021-taylor-14e", carte)).toBeNull();
    expect(localiserDepuisUnite(null, "maudsley-prescribing-guidelines-2021-taylor-14e", carte)).toBeNull();
  });
});

describe("édition : vérifiée contre les paquets canoniques", () => {
  it("résout les deux ouvrages qualifiés et refuse une version dérivée", () => {
    expect(editionDe(DSM, DSM_VERSION)?.edition).toBe("5e éd.");
    expect(editionDe(MAUDSLEY, MAUDSLEY_VERSION)?.edition).toBe("14e éd.");
    expect(editionDe(DSM, "sha256:0000")).toBeNull();
    expect(editionDe("Un autre livre", DSM_VERSION)).toBeNull();
  });

  it("ne diverge pas des book.json du dépôt", () => {
    for (const ouvrage of EDITIONS) {
      const racine = join(process.cwd(), "knowledge", "canonical-v2", ouvrage.bookId);
      const dossier = readdirSync(racine).find((nom) => nom.startsWith("sha256-"));
      expect(dossier, `${ouvrage.bookId} : paquet canonique absent`).toBeDefined();
      const book = JSON.parse(readFileSync(join(racine, dossier as string, "book.json"), "utf8")) as {
        title: string; edition: string; language: string; source_version: string;
      };
      expect(book.title).toBe(ouvrage.titre);
      expect(book.edition).toBe(ouvrage.editionCle);
      expect(book.language).toBe(ouvrage.langue);
      expect(book.source_version).toBe(ouvrage.version);
    }
  });
});

describe("ligne de sources : assemblée par le serveur, jamais par le modèle", () => {
  it("déduplique et ordonne les sources réellement citées", () => {
    const ligne = ligneCitation([
      { titre: DSM, edition: "5e éd.", annee: 2015, pageImprimee: 205, pagePdf: 264 },
      { titre: DSM, edition: "5e éd.", annee: 2015, pageImprimee: 205, pagePdf: 264 },
      { titre: MAUDSLEY, edition: "14e éd.", annee: 2021, pageImprimee: 248, pagePdf: 269 },
    ]);
    expect(ligne).toBe(`Sources : ${DSM} (5e éd., 2015), p. 205 ; ${MAUDSLEY} (14e éd., 2021), p. 248.`);
  });

  it("nomme une source unique et omet la page non vérifiée", () => {
    expect(ligneCitation([{ titre: DSM, edition: "5e éd.", annee: 2015, pageImprimee: null, pagePdf: null }]))
      .toBe(`Source : ${DSM} (5e éd., 2015).`);
    expect(ligneCitation([])).toBeNull();
  });

  it("ne cite pas une page si l'extrait n'en porte pas", () => {
    const citation = citationDepuisExtrait("Passage sans marqueur.", {
      titre: DSM, edition: "5e éd.", annee: 2015, bookId: "dsm5-fr-2015-elsevier",
    });
    expect(citation.pageImprimee).toBeNull();
    expect(ligneCitation([citation])).toBe(`Source : ${DSM} (5e éd., 2015).`);
  });
});

describe("readKnowledge : page et édition vérifiées dans la preuve d'affichage", () => {
  it("attache la page du chunk et l'édition canonique au bon ouvrage", async () => {
    const { client } = clientAvec([row(DSM, "Critères du trouble panique. [dsm5-fr-2015-elsevier p.205|src:264]")]);
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?");
    expect(result.etat).toBe("ok");
    const preuve = result.preuves[0]!;
    expect(preuve.edition).toEqual({ edition: "5e éd.", annee: 2015,
      editionCle: "5e édition, traduction française (DSM-5, Fifth Edition 1-1276)" });
    expect(preuve.page).toEqual({ pageImprimee: 205, pagePdf: 264, libelle: "p. 205" });
    const source = knowledgeSource(preuve);
    expect(source.label).toBe(`${DSM} · ${SECTION} · 5e éd. · p. 205`);
    expect(source.provenance).toMatchObject({ edition: "5e éd.", annee: 2015, pageImprimee: 205, pagePdf: 264 });
    expect(source.provenance).not.toHaveProperty("page");
  });

  it("n'attache aucune page quand le marqueur vient d'un autre livre", async () => {
    const { client } = clientAvec([row(DSM, "Critères. [maudsley-prescribing-guidelines-2021-taylor-14e p.248|src:269]")]);
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?");
    expect(result.preuves[0]?.page).toBeUndefined();
    const source = knowledgeSource(result.preuves[0]!);
    expect(source.label).not.toContain("p. 248");
    expect(source.provenance).not.toHaveProperty("pageImprimee");
  });

  it("laisse la preuve inchangée (édition seule, pas de page) sans marqueur", async () => {
    const { client } = clientAvec([row(MAUDSLEY, "Criteria. No marker here.")]);
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon Maudsley ?");
    const preuve = result.preuves[0]!;
    expect(preuve.edition?.edition).toBe("14e éd.");
    expect(preuve.page).toBeUndefined();
    expect(knowledgeSource(preuve).label).toBe(`${MAUDSLEY} · ${SECTION} · 14e éd.`);
  });
});

describe("repli de page : carte des unités canoniques", () => {
  it("rétablit la page de l'unité quand un fragment a perdu son marqueur", async () => {
    // Unité RÉELLE du paquet DSM (folio 1, page PDF 60), marqueur absent du texte.
    const { client } = clientAvec([row(DSM, "Critères diagnostiques du trouble panique : attaques de panique récurrentes et inattendues, sans marqueur de page.", { unit_id: "dsm5fr-u-1-COVER2" })]);
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?");
    const preuve = result.preuves[0]!;
    expect(preuve.page).toEqual({ pageImprimee: 1, pagePdf: 60, libelle: "p. 1" });
  });

  it("ignore une unité inconnue plutôt que d'inventer une page", async () => {
    const { client } = clientAvec([row(DSM, "Fragment sans page.", { unit_id: "unite-inexistante" })]);
    const result = await readKnowledge(client, "Quels sont les critères du trouble panique selon le DSM-5 ?");
    expect(result.preuves[0]?.page).toBeUndefined();
  });

  it("normalise le JSON brut et écarte les entrées mal formées", () => {
    const carte = carteDepuisJson({
      "livre-a": { u1: [12, 30], u2: [null, null], u3: [0, -4], u4: "pas-un-tableau", u5: [12] },
      "livre-b": null,
    });
    expect(carte["livre-a"]).toEqual({ u1: [12, 30], u2: [null, null], u3: [null, null] });
    expect(carte["livre-b"]).toBeUndefined();
    expect(carteDepuisJson(null)).toEqual({});
  });
});

describe("diversité des sources : un seul livre ne remplit pas toutes les places", () => {
  it("réserve au moins une place à l'autre ouvrage quand aucun livre n'est nommé", async () => {
    const dsmRows = Array.from({ length: 5 }, (_, i) =>
      row(DSM, `Prise en charge de l'agitation aiguë, extrait ${i + 1}. [dsm5-fr-2015-elsevier p.${200 + i}|src:${260 + i}]`,
        { chunk_id: `dsm-chunk-${i}`, section: `Section II — Critères diagnostiques et codes › Troubles anxieux › Trouble panique › Critères diagnostiques` }));
    const taylor = row(MAUDSLEY, "Management of acute agitation: antipsychotics and benzodiazepines. [maudsley-prescribing-guidelines-2021-taylor-14e p.42|src:60]",
      { chunk_id: "taylor-chunk", section: "Part 1: Drug treatment of major psychiatric conditions › Chapter 1: Schizophrenia and related psychoses › Acute agitation" });
    const { client } = clientAvec([...dsmRows, taylor]);
    const result = await readKnowledge(client, "Quelle est la prise en charge de l'agitation aiguë ?");
    expect(result.etat).toBe("ok");
    expect(result.preuves).toHaveLength(5);
    const titres = result.preuves.map((p) => p.titre);
    // Le plafond de 3 s'applique à la première passe ; le complément remplit
    // ensuite les places restantes. Le contrat observable est donc : jamais
    // cinq extraits du même livre quand l'autre en a un, et l'autre est présent.
    expect(titres.filter((t) => t === DSM).length).toBeLessThanOrEqual(4);
    expect(titres).toContain(MAUDSLEY);
  });
});

describe("portes lexicales : parallèles, bornées, ordre préservé", () => {
  it("démarre la seconde porte avant la fin de la première et restitue l'ordre du plan", async () => {
    let premiereFinie = false;
    let secondeDemarreeAvant = false;
    const { client } = clientAvec([row(DSM, "Trouble bipolaire type I et type II.")], {
      delai: (args) => {
        const requete = String(args["p_requete"] ?? "");
        if (requete.endsWith("type i")) return 25;
        secondeDemarreeAvant = !premiereFinie;
        return 0;
      },
    });
    const rpcOriginal = client.rpc;
    const instrumente: ClientSql = { rpc: async <T,>(gate: string, args: ArgsJarvis = {}) => {
      const reponse = await rpcOriginal<T>(gate, args);
      if (String(args["p_requete"] ?? "").endsWith("type i")) premiereFinie = true;
      return reponse;
    } };
    const result = await readKnowledge(instrumente, "Quelle différence entre trouble bipolaire type I et type II selon DSM ?");
    expect(secondeDemarreeAvant).toBe(true);
    expect(result.etat).toBe("ok");
  });

  it("mapLimite borne la concurrence et preserve l'ordre des résultats", async () => {
    let actifs = 0;
    let pic = 0;
    const resultats = await mapLimite([30, 10, 20, 5, 15], 2, async (ms, index) => {
      actifs += 1;
      pic = Math.max(pic, actifs);
      await new Promise((resolve) => setTimeout(resolve, ms));
      actifs -= 1;
      return index;
    });
    expect(pic).toBeLessThanOrEqual(2);
    expect(resultats).toEqual([0, 1, 2, 3, 4]);
  });
});
