import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Stahl 7e — invariants du pipeline de connaissance.
 *
 * Ces tests ne re-testent pas une bibliographic : ils verifient que les
 * artefacts produits restent COHERENTS entre eux (chunks <-> embeddings <->
 * unites canoniques). Un artefact desynchronise doit echouer ici, pas dans
 * une reponse d'Alexa.
 *
 * Les artefacts canoniques sont hors Git (`.gitignore`) : sur un poste ou le
 * paquet n'a pas ete produit, les tests sont ignores plutot que rouges.
 *
 * NOTE de performance : les verifications sont AGREGUEES (une seule
 * assertion par invariant, avec la liste des offenders) et non posees
 * element par element : 3 000 `expect()` unitaires font exploser le delai
 * de la suite vitest.
 */

const RACINE_FIXTURES = process.env.MINDCARE_KNOWLEDGE_FIXTURE_ROOT ?? process.cwd();
const DOSSIER = join(
  RACINE_FIXTURES,
  "knowledge",
  "canonical-v2",
  "stahl-prescribers-guide-7e-cup",
  "sha256-cf23ef7b70e7c6e099a5a43d994adb2f34ef06718643932611f5e91eeba180e3",
);
const CHEMIN_CHUNKS = join(DOSSIER, "chunks-v2.jsonl");
const CHEMIN_EMBEDDINGS = join(DOSSIER, "embeddings-v2.jsonl");
const CHEMIN_UNITES = join(DOSSIER, "units.jsonl");
const CHEMIN_MANIFESTE = join(DOSSIER, "chunks-v2.manifest.json");
const DISPONIBLE = existsSync(CHEMIN_CHUNKS) && existsSync(CHEMIN_UNITES);

const lire = (chemin: string) =>
  readFileSync(chemin, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));

const echantillon = (liste: string[], max = 5) =>
  liste.length === 0 ? "" : `${liste.slice(0, max).join(", ")}${liste.length > max ? ` (+${liste.length - max})` : ""}`;

describe.skipIf(!DISPONIBLE)("Stahl 7e — invariants du pipeline de connaissance", () => {
  const chunks = lire(CHEMIN_CHUNKS);
  const unites = lire(CHEMIN_UNITES);
  const manifeste = JSON.parse(readFileSync(CHEMIN_MANIFESTE, "utf8"));
  const parUnite = new Map(unites.map((u) => [u.id, u]));

  it("chaque chunk porte le chemin de titres et le marqueur de page", () => {
    const sansChemin: string[] = [];
    const sansMarqueur: string[] = [];
    for (const c of chunks) {
      if (!c.texte.includes("›")) sansChemin.push(c.chunk_id);
      if (!/\[stahl-prescribers-guide-7e-cup p\.\d+\|src:\d+\]/.test(c.texte)) sansMarqueur.push(c.chunk_id);
    }
    expect(`sans chemin de titres : ${echantillon(sansChemin)}`).toBe("sans chemin de titres : ");
    expect(`sans marqueur de page : ${echantillon(sansMarqueur)}`).toBe("sans marqueur de page : ");
  });

  it("chaque chunk cite la page source de son unite", () => {
    const fautifs: string[] = [];
    for (const c of chunks) {
      const u = parUnite.get(c.unit_id);
      if (!u) {
        fautifs.push(`${c.chunk_id}: unite ${c.unit_id} inconnue`);
        continue;
      }
      if (!c.texte.includes(`p.${u.printed_page_start}|src:${u.page_start}`)) {
        fautifs.push(`${c.chunk_id}: page attendue p.${u.printed_page_start}|src:${u.page_start}`);
      }
    }
    expect(`pages non concordantes : ${echantillon(fautifs)}`).toBe("pages non concordantes : ");
  });

  it("les identifiants de chunk sont uniques et normalises", () => {
    const ids = new Set(chunks.map((c) => c.chunk_id));
    expect(ids.size).toBe(chunks.length);
    const malformes = [...ids].filter((id) => !/^stahl-[0-9a-f]{12}$/.test(id));
    expect(`ids malformes : ${echantillon(malformes)}`).toBe("ids malformes : ");
  });

  it("aucun chunk vide, sans provenance ou sans titre", () => {
    const fautifs: string[] = [];
    for (const c of chunks) {
      if (c.texte.trim().length === 0) fautifs.push(`${c.chunk_id}: texte vide`);
      if (!c.unit_id) fautifs.push(`${c.chunk_id}: unit_id vide`);
      if (!c.titre_source) fautifs.push(`${c.chunk_id}: titre_source vide`);
      if (!c.page_start) fautifs.push(`${c.chunk_id}: page_start vide`);
    }
    expect(`chunks incomplets : ${echantillon(fautifs)}`).toBe("chunks incomplets : ");
  });

  it("la jointure des enfants restitue exactement le parent", () => {
    const groupes = new Map<string, typeof chunks>();
    for (const c of chunks) {
      const liste = groupes.get(c.unit_id) ?? [];
      liste.push(c);
      groupes.set(c.unit_id, liste);
    }
    const fautifs: string[] = [];
    for (const [unite, liste] of groupes) {
      if (liste.length < 2) continue;
      liste.sort((a, b) => a.enfant_index - b.enfant_index);
      const reconstitue = liste.map((c) => c.evidence_enfant).join(" ");
      if (reconstitue !== liste[0].evidence_parent) {
        fautifs.push(`${unite}: ${reconstitue.slice(0, 60)} != ${String(liste[0].evidence_parent).slice(0, 60)}`);
      }
    }
    expect(`jointures non verbatim : ${echantillon(fautifs)}`).toBe("jointures non verbatim : ");
  });

  it("le manifeste annonce ce que les chunks contiennent", () => {
    expect(manifeste.chunker_version).toBe("stahl-units-v1");
    expect(manifeste.chunks_emis).toBe(chunks.length);
    expect(manifeste.chunks_vides).toBe(0);
    expect(manifeste.chunks_sans_provenance).toBe(0);
    expect(manifeste.ids_uniques).toBe(true);
    expect(manifeste.determinisme_ids).toBe(true);
    expect(manifeste.jointures_verbatim_ko).toBe(0);
    expect(manifeste.statut).toBe("inactive");
  });

  it("chaque unite a une preuve a au moins un chunk, et aucun chunk sans unite", () => {
    const uniteIds = new Set(unites.map((u) => u.id));
    const couvertes = new Set(chunks.map((c) => c.unit_id));
    const orphelins = chunks.filter((c) => !uniteIds.has(c.unit_id)).map((c) => c.chunk_id);
    expect(`chunks sans unite : ${echantillon(orphelins)}`).toBe("chunks sans unite : ");
    const sansChunk: string[] = [];
    for (const u of unites) {
      if ((u.evidence_wording ?? "").trim() === "") continue;
      if (!couvertes.has(u.id)) sansChunk.push(u.id);
    }
    expect(`unites sans chunk : ${echantillon(sansChunk)}`).toBe("unites sans chunk : ");
  });

  it.skipIf(!existsSync(CHEMIN_EMBEDDINGS))(
    "chaque chunk eligible a exactement un vecteur de 1024 dimensions normalise",
    () => {
      // Le fichier fait ~65 Mo (3 076 vecteurs de 1 024 flottants) : on ne le
      // parse PAS integralement. L'identifiant est extrait par motif, et
      // seul un ECHANTILLON de vecteurs est verifie en profondeur.
      const brut = readFileSync(CHEMIN_EMBEDDINGS, "utf8");
      const lignes = brut.split("\n").filter(Boolean);
      const vus = new Set<string>();
      const doublons: string[] = [];
      const malformes: string[] = [];
      const echantillonIdx: number[] = [];
      lignes.forEach((ligne, i) => {
        const m = /^\{"chunk_id":"([^"]+)","chunker_version":"([^"]+)"/.exec(ligne);
        if (!m) {
          malformes.push(`ligne ${i + 1} : identifiant illisible`);
          return;
        }
        if (vus.has(m[1]!)) doublons.push(m[1]!);
        vus.add(m[1]!);
        if (m[2] !== "stahl-units-v1") malformes.push(`${m[1]} : chunker ${m[2]}`);
        if (echantillonIdx.length < 40) echantillonIdx.push(i);
      });
      expect(`identifiants en double : ${echantillon(doublons)}`).toBe("identifiants en double : ");
      expect(`lignes malformees : ${echantillon(malformes)}`).toBe("lignes malformees : ");
      expect(lignes.length).toBeGreaterThan(0);

      const fautifs: string[] = [];
      for (const i of echantillonIdx) {
        const o = JSON.parse(lignes[i]!);
        if (o.embedding.length !== 1024) {
          fautifs.push(`dimension ${o.chunk_id} : ${o.embedding.length}`);
          continue;
        }
        let somme = 0;
        for (const v of o.embedding) {
          if (!Number.isFinite(v)) {
            fautifs.push(`vecteur non fini : ${o.chunk_id}`);
            break;
          }
          somme += v * v;
        }
        if (fautifs.length === 0 && Math.abs(Math.sqrt(somme) - 1) > 1e-4) {
          fautifs.push(`norme ${o.chunk_id} : ${Math.sqrt(somme)}`);
        }
      }
      expect(`vecteurs fautifs : ${echantillon(fautifs)}`).toBe("vecteurs fautifs : ");

      const ids = new Set(chunks.map((c) => c.chunk_id));
      const nonVectorises = [...ids].filter((id) => !vus.has(id));
      expect(`chunks sans vecteur : ${echantillon(nonVectorises)}`).toBe("chunks sans vecteur : ");
    },
    120_000,
  );
});
