/**
 * eval-jarvis-conversation — LE HARNESS GOLDEN M02 (étend M08-A).
 *
 * ═══ CE QUE CETTE PASSE PROUVE ═══
 * Sur transports et registre PINÉS (0 réseau, 0 modèle, 0 base) : chaque tour
 * de chaque scénario rend le verdict, la source, le patient, le chaînage, les
 * exécutions et la clarification attendus — avec lignage (conversationId
 * constant, clientTurnIds distincts) et sans UUID brut vers le transport.
 * Les scénarios adversariaux (non-résolu, ambigu, porte de fil, injection,
 * coupe-circuit, panne) prouvent le ZÉRO-OUTIL sur les journaux d'appels,
 * jamais sur le texte.
 *
 * ═══ CE QU'ELLE NE PROUVE PAS ═══
 * Ni la qualité live (classifieur/routeur réels), ni la RLS, ni l'UI. Le live
 * se mesure au navigateur ; cette passe garde la non-régression M02.
 *
 *   node scripts/eval-jarvis-conversation.mjs <dir services compilés> [golden.json]
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const dirServices = process.argv[2];
const cheminGolden =
  process.argv[3] ?? join(dirname(process.argv[1]), "..", "tests", "eval", "jarvis-conversation.golden.json");
if (dirServices === undefined) {
  console.error("usage : node scripts/eval-jarvis-conversation.mjs <dir services> [golden.json]");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(resolve(dirServices), f)).href;

const { executerTour } = await import(url("services/jarvis-boucle.js"));
const { definirCible, cibleValide } = await import(url("services/jarvis-contexte.js"));
const { fixerActivationResolutionM02 } = await import(
  url("shared/jarvis/resolution-references.js")
);

const golden = JSON.parse(readFileSync(resolve(cheminGolden), "utf8"));
const PATIENTS = golden.patients ?? {};
const scripts = golden.scripts ?? [];

// Registre faux fermé : seules les lectures du scénario existent. Une
// écriture (create_appointment, …) y est inconnue — la boucle la rend en
// proposition, jamais exécutée, comme en production.
const LECTURES_FAUSSES = new Set([
  "get_patient_context",
  "get_consultation_history",
  "get_current_medications",
]);

let verts = 0;
let rouges = 0;
const detailsRouges = [];

function verdict(ok, ligne, detail = "") {
  if (ok) verts += 1;
  else {
    rouges += 1;
    detailsRouges.push(`${ligne} :: ${detail}`);
  }
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${ligne}${detail === "" ? "" : ` | ${detail}`}`);
}

const okRes = (data) => ({ ok: true, data });
const errRes = (code) => ({ ok: false, error: { code, message: "panne-sonde" } });

// Annuaire fidèle (émule la porte 066) : chaque mot de la requête doit
// apparaître dans le libellé. La SONDE du scénario reste l'autorité des
// comptages ; ceci ne sert qu'aux recherches D'INITIATIVE MODÈLE.
function normaliserMots(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}
function annuaireRecherche(query) {
  const mots = normaliserMots(String(query ?? ""));
  if (mots.length === 0) return [];
  return Object.entries(PATIENTS)
    .filter(([, p]) => {
      const cible = new Set(normaliserMots(p.libelle));
      return mots.every((w) => cible.has(w));
    })
    .map(([cle]) => cle);
}

// Remplace "@N" par le N-ième jeton frappé du tour (0-based) ; le reste passe tel quel.
function substituerJetons(v, frappes) {
  if (typeof v === "string") {
    const m = /^@(\d+)$/.exec(v);
    if (m !== null) return frappes[Number(m[1])] ?? v;
    return v;
  }
  if (Array.isArray(v)) return v.map((x) => substituerJetons(x, frappes));
  if (typeof v === "object" && v !== null) {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substituerJetons(x, frappes)]));
  }
  return v;
}

for (const script of scripts) {
  console.log(`— ${script.id} : ${script.description ?? ""}`);
  definirCible(null);
  fixerActivationResolutionM02(true);
  if (script.resolutionOff === true) fixerActivationResolutionM02(false);
  try {
    if (script.setup?.cible != null) {
      const p = PATIENTS[script.setup.cible];
      definirCible({
        id: p.id,
        libelle: p.libelle,
        numeroDossier: "",
        origine: script.setup.origine ?? "recherche",
      });
    }
    let travail = null;
    let tourIndex = 0;
    for (const tour of script.tours ?? []) {
      tourIndex += 1;
      const tag = `${script.id}#T${tourIndex}`;
      const frappes = [];
      const queriesSonde = [];
      const executerPatients = [];
      let appelsSearchOk = 0;
      const fileRechercheModele = [...(tour.rechercheModele ?? [])];
      const transports = [];

      const registre = (nom) => {
        if (nom === "search_patients") {
          return {
            nom,
            description: "faux",
            budgetOctets: 10_000,
            champsAttendus: "query",
            lancer: async (argsBruts, ctx) => {
              const query = argsBruts?.query;
              if (tour.sondeErreur === true) return errRes("indisponible");
              if (transports.length === 0 && tour.sonde != null) {
                // La sonde : comptage imposé par le scénario.
                if (typeof tour.sondeQueries !== "undefined" && Array.isArray(tour.sondeQueries)) {
                  queriesSonde.push(query);
                } else {
                  queriesSonde.push(query);
                }
                const refs = (tour.sonde.patients ?? []).map((cle) => {
                  const p = PATIENTS[cle];
                  return ctx.carte.patient(p.id, p.libelle, [p.libelle]);
                });
                appelsSearchOk += 1;
                return okRes({ resultats: refs, ambigu: refs.length > 1, total: tour.sonde.total });
              }
              // Recherche modèle : file du scénario si fournie (adversarial),
              // sinon recherche fidèle sur la requête (comme en production).
              const cles =
                fileRechercheModele.length > 0 ? fileRechercheModele.shift() : annuaireRecherche(query);
              const refs = cles.map((cle) => {
                const p = PATIENTS[cle];
                const ref = ctx.carte.patient(p.id, p.libelle, [p.libelle]);
                frappes.push(ref);
                return ref;
              });
              appelsSearchOk += 1;
              return okRes({ resultats: refs, ambigu: refs.length > 1, total: cles.length });
            },
          };
        }
        // Lectures du scénario : faux témoin patient-spécifique. Tout le
        // reste (écritures, inconnus) est ABSENT — comme en production, où
        // la boucle ne connaît que le registre de lecture.
        if (!LECTURES_FAUSSES.has(nom)) return null;
        return {
          nom,
          description: "faux",
          budgetOctets: 10_000,
          champsAttendus: "patientId",
          lancer: async () => {
            executerPatients.push(nom);
            return okRes({ resultats: [], ambigu: false, total: 0 });
          },
        };
      };

      const transport = async (params) => {
        transports.push(params);
        const suivante = tour.reponses[transports.length - 1];
        if (suivante === undefined) throw new Error(`${tag} : plus de réponse scriptée`);
        if (suivante.proposition != null) {
          // "@N" = N-ième jeton frappé par une recherche du tour ; à défaut
          // (aucune recherche — le fil vient de l'amorce), repli sur la
          // première frappe du tour, qui est la cible de l'amorce quand il
          // y en a une. Un jeton inconnu échoue fermé côté boucle.
          const refs = frappes.length > 0 ? frappes : ["PATIENT_001"];
          const args = substituerJetons(suivante.proposition.args, refs);
          return okRes({
            chemin: "patient",
            texte: "",
            proposition: { nom: suivante.proposition.nom, args },
            conversationId: params.conversationId,
            persiste: false,
            interrompu: false,
          });
        }
        return okRes({
          chemin: "patient",
          texte: suivante.texte ?? "",
          proposition: null,
          conversationId: params.conversationId,
          persiste: false,
          interrompu: false,
        });
      };

      const r = await executerTour(
        {
          message: tour.input,
          conversationId: script.conversationId,
          ...(travail === null ? {} : { travail }),
        },
        {},
        new AbortController().signal,
        { transport, registre, description: () => "- faux" },
      );
      if (!r.ok) {
        verdict(false, `${tag} tour en échec`, r.error?.code ?? "?");
        continue;
      }
      const bilan = r.data;
      const a = tour.attendu ?? {};
      const res = bilan.resolution?.verdict;
      const idPatient = (cle) => (cle == null ? undefined : PATIENTS[cle]?.id);

      verdict(res?.etat === a.verdict, `${tag} verdict`, `attendu=${a.verdict} obtenu=${res?.etat}`);
      verdict(
        (res?.source ?? null) === (a.source ?? null),
        `${tag} source`,
        `attendu=${a.source} obtenu=${res?.source}`,
      );
      verdict(
        (res?.patient?.id ?? null) === (idPatient(a.patient) ?? null),
        `${tag} patient`,
        `attendu=${a.patient} obtenu=${res?.patient?.id}`,
      );
      verdict(
        (bilan.resolution?.intentionChainee ?? null) === (a.intentionChainee ?? null),
        `${tag} chaînée`,
        `attendu=${a.intentionChainee} obtenu=${bilan.resolution?.intentionChainee}`,
      );
      verdict(
        (bilan.resolution?.intentionRetenu ?? null) === (a.intentionRetenu ?? null),
        `${tag} legs`,
        `attendu=${a.intentionRetenu} obtenu=${bilan.resolution?.intentionRetenu}`,
      );
      verdict(
        appelsSearchOk === (a.sondes ?? 0),
        `${tag} sondes`,
        `attendu=${a.sondes} obtenu=${appelsSearchOk}`,
      );
      const execOk =
        executerPatients.length === (a.executesPatients ?? []).length &&
        (a.executesPatients ?? []).every((n, i) => executerPatients[i] === n);
      verdict(execOk, `${tag} exécutions`, `attendu=[${(a.executesPatients ?? []).join(",")}] obtenu=[${executerPatients.join(",")}]`);
      verdict(
        transports.length === (a.transports ?? 0),
        `${tag} transports`,
        `attendu=${a.transports} obtenu=${transports.length}`,
      );
      if (a.clarification != null) {
        const txt = bilan.texte ?? "";
        const contientOk = (a.clarification.contient ?? []).every((s) => txt.includes(s));
        const exclutOk = (a.clarification.exclut ?? []).every((s) => !txt.includes(s));
        verdict(contientOk && exclutOk, `${tag} clarification`, txt.slice(0, 120));
      } else {
        verdict(true, `${tag} clarification`, "aucune exigée");
      }
      if (tour.sondeQueries != null) {
        verdict(
          JSON.stringify(queriesSonde) === JSON.stringify(tour.sondeQueries),
          `${tag} requête de sonde`,
          `attendu=${JSON.stringify(tour.sondeQueries)} obtenu=${JSON.stringify(queriesSonde)}`,
        );
      }
      if (a.ciblePreservee != null) {
        verdict(
          cibleValide()?.id === PATIENTS[a.ciblePreservee]?.id,
          `${tag} cible préservée`,
          `cible=${cibleValide()?.id}`,
        );
      }
      if (a.porteDeFil === true) {
        verdict(
          bilan.appels.some((x) => x.code === "patient-hors-fil"),
          `${tag} porte de fil`,
          "motif patient-hors-fil exigé",
        );
      }
      if (a.propositionInconnue != null) {
        verdict(
          bilan.propositionInconnue?.nom === a.propositionInconnue,
          `${tag} proposition inconnue`,
          `obtenu=${bilan.propositionInconnue?.nom}`,
        );
      }
      // Lignage : conversation constante, turns distincts, zéro UUID brut.
      const convOk = transports.every((p) => p.conversationId === script.conversationId);
      verdict(convOk, `${tag} lignage conversation`, script.conversationId);
      const ids = transports.map((p) => p.clientTurnId).filter((x) => x != null);
      verdict(new Set(ids).size === ids.length && ids.length === transports.length, `${tag} turns distincts`, `${ids.length}/${transports.length}`);
      const fuitUuid = transports.some((p) => JSON.stringify(p).includes("uuid-"));
      verdict(!fuitUuid, `${tag} zéro UUID brut`, fuitUuid ? "FUITE" : "tokens seuls");

      // Legs vers le tour suivant (miroir de `conversation.ts`) : patient
      // prouvé + intent retenu, sinon oubli.
      const patientLegs = bilan.resolution?.verdict?.patient;
      travail =
        patientLegs === undefined
          ? null
          : {
              conversationId: script.conversationId,
              intentionPrecedente: bilan.resolution?.intentionRetenu ?? null,
              patientId: patientLegs.id,
            };
    }
  } finally {
    fixerActivationResolutionM02(true);
  }
}

console.log("");
console.log(`VERDICT CONVERSATION : ${rouges === 0 ? `VERT (${verts} vert(s))` : `ROUGE (${rouges} rouge(s))`}`);
if (detailsRouges.length > 0) {
  console.log("Détail des rouges :");
  for (const d of detailsRouges) console.log(`  - ${d}`);
}
process.exit(rouges === 0 ? 0 : 1);
