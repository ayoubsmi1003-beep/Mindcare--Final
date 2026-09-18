/**
 * eval-jarvis-boucle — LA BOUCLE, ÉPROUVÉE EN LA FAISANT TOURNER.
 *
 * ═══ POURQUOI CE FICHIER EXISTE ═══
 * `tsc` et `eslint` verts ne disent RIEN d'une boucle. Un budget, une
 * déduplication, un fail-closed ne se prouvent qu'en les faisant SE DÉCLENCHER.
 * La leçon est déjà payée dans ce dépôt : quinze contrôles verts recouvraient
 * une chaîne qui n'avait jamais tourné.
 *
 * Transport et registre sont INJECTÉS (`DependancesBoucle`) : aucune clé, aucun
 * réseau, aucune base. Ce qui est éprouvé ici, c'est le FLOT DE CONTRÔLE — la
 * partie qui doit survivre au changement de modèle du mois 2.
 *
 *   node scripts/eval-jarvis-boucle.mjs <répertoire-des-modules-compilés>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-jarvis-boucle.mjs <dir js compilé>");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(repertoire, f)).href;

const { executerTour } = await import(url("jarvis-boucle.js"));
const { BUDGETS, definirCible, effacerCible } = await import(url("jarvis-contexte.js"));
const { carte, reinitialiserCarte } = await import(url("jarvis-identite.js"));

let rouges = 0;
function verdict(nom, ok, detail) {
  if (!ok) rouges++;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(56)} | ${detail}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// OUTILLAGE — un transport et un registre scriptés
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Rejoue une liste de réponses de modèle, dans l'ordre, et ENREGISTRE ce que la
 * boucle lui a envoyé. C'est ce journal qui prouve le rebouclage : sans lui, on
 * ne saurait pas si le résultat de capacité est réellement reparti vers le
 * modèle ou s'il a été perdu comme avant.
 */
function transportScripte(reponses) {
  const vus = [];
  const transport = async (params, rappels) => {
    vus.push(params);
    const suivante = reponses[vus.length - 1];
    if (suivante === undefined) throw new Error("transport : plus de réponse scriptée");
    if (suivante.deltas !== undefined) {
      for (const d of suivante.deltas) rappels.onDelta?.(d);
    }
    rappels.onChemin?.("patient");
    return {
      ok: true,
      data: {
        chemin: "patient",
        texte: suivante.texte ?? "",
        proposition: suivante.proposition ?? null,
        conversationId: params.conversationId,
        persiste: true,
        interrompu: suivante.interrompu === true,
      },
    };
  };
  return { transport, vus };
}

/** Un registre d'une seule capacité, scriptée, qui compte ses appels. */
function registreScripte(nom, reponse, { lent = false } = {}) {
  const appels = [];
  const registre = (n) =>
    n === nom
      ? {
          nom,
          description: "capacité de test",
          budgetOctets: 10_000,
          // ⚠️ CE CHAMP N'EST PAS DÉCORATIF. `estPatientSpecifique` le lit pour
          // savoir si la porte d'ambiguïté doit couvrir la capacité. Il
          // manquait ici, et la première version de cette porte levait une
          // `TypeError` qui rompait le tour entier — un faux incomplet a donc
          // trouvé un vrai défaut. La fonction répond désormais « oui » en
          // l'absence de déclaration (repli sûr), et ce faux déclare ce que le
          // vrai registre déclare.
          champsAttendus: "query",
          lancer: async (args, ctx) => {
            appels.push(args);
            if (lent) {
              await new Promise((resoudre) => {
                const t = setTimeout(resoudre, 60_000);
                ctx.signal.addEventListener("abort", () => {
                  clearTimeout(t);
                  resoudre();
                }, { once: true });
              });
              if (ctx.signal.aborted) throw new Error("annulée");
            }
            return typeof reponse === "function" ? reponse(args) : reponse;
          },
        }
      : null;
  return { registre, appels };
}

const deps = (transport, registre) => ({
  transport,
  registre,
  description: () => "- capacite_test : une capacité de test",
});

const AGENDA_SAFE = {
  ok: true,
  data: {
    creneaux: [{ ref: "RDV_001", patient: "PATIENT_001", debut: "2026-08-26T14:00:00+01:00", fin: "2026-08-26T14:30:00+01:00", dureeMinutes: 30, statut: "scheduled", type: "suivi", arriveA: null }],
    provenance: [{ porte: "app.dashboard_today", luA: "2026-08-25T10:00:00Z", tronque: false }],
  },
};

const params = { message: "Qui est le prochain patient ?", conversationId: "conv-1" };
const sansSignal = () => new AbortController().signal;

// ═══════════════════════════════════════════════════════════════════════════
// B1 · LE REBOUCLAGE — le défaut central de V-JARVIS-CORE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB1 — le résultat de capacité repart-il VERS le modèle ?");
{
  effacerCible();
  reinitialiserCarte();
  const { transport, vus } = transportScripte([
    { proposition: { nom: "capacite_test", args: {} } },
    { texte: "Votre prochain patient est {{PATIENT_001}} à 14h." },
  ]);
  const { registre, appels } = registreScripte("capacite_test", AGENDA_SAFE);
  const r = await executerTour(params, {}, sansSignal(), deps(transport, registre));

  verdict("le tour aboutit", r.ok, r.ok ? "ok" : JSON.stringify(r.error));
  verdict("la capacité a été appelée", appels.length === 1, `${appels.length} appel(s)`);
  verdict("il y a bien EU deux allers au modèle", vus.length === 2, `${vus.length} appel(s) transport`);
  const second = vus[1];
  verdict(
    "le 2ᵉ appel porte le résultat de la capacité",
    second?.resultatsOutils?.length === 1 && second.resultatsOutils[0].ok === true,
    JSON.stringify(second?.resultatsOutils?.[0]?.capacite ?? "aucun"),
  );
  verdict(
    "le résultat rebouclé porte les données projetées",
    JSON.stringify(second?.resultatsOutils ?? "").includes("RDV_001"),
    "créneau présent",
  );
  verdict(
    "la réponse finale est rendue",
    r.ok && r.data.texte.includes("{{PATIENT_001}}"),
    r.ok ? r.data.texte : "-",
  );
  verdict(
    "le contexte d'amorçage part dès le 1er appel",
    vus[0]?.contexte !== undefined && typeof vus[0].contexte.temps?.aujourdHui === "string",
    `aujourdHui=${vus[0]?.contexte?.temps?.aujourdHui}`,
  );
  verdict(
    "la description des capacités accompagne chaque appel",
    vus.every((v) => typeof v.capacites === "string" && v.capacites.length > 0),
    "présente",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// B2 · PERSISTANCE — la question n'est écrite qu'une fois
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB2 — persist-first, sans doublon de la demande");
{
  reinitialiserCarte();
  const { transport, vus } = transportScripte([
    { proposition: { nom: "capacite_test", args: {} } },
    { texte: "fini" },
  ]);
  const { registre } = registreScripte("capacite_test", AGENDA_SAFE);
  await executerTour(params, {}, sansSignal(), deps(transport, registre));
  verdict(
    "la 1ʳᵉ itération écrit la demande",
    vus[0]?.persisterDemande === true,
    String(vus[0]?.persisterDemande),
  );
  verdict(
    "les itérations suivantes ne la réécrivent pas",
    vus[1]?.persisterDemande === false,
    String(vus[1]?.persisterDemande),
  );
  verdict(
    "chaque itération porte un clientTurnId DISTINCT",
    vus[0]?.clientTurnId !== vus[1]?.clientTurnId,
    "distincts (UNIQUE(client_turn_id, role) de 058)",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// B3 · BUDGETS — ils doivent SE DÉCLENCHER, pas exister
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB3 — les budgets se déclenchent et Jarvis AVOUE");
{
  reinitialiserCarte();
  // Le modèle propose indéfiniment une capacité, avec des arguments DIFFÉRENTS
  // à chaque fois pour échapper à la déduplication : seul le plafond
  // d'itérations peut l'arrêter.
  const reponses = Array.from({ length: 10 }, (_, i) => ({
    proposition: { nom: "capacite_test", args: { n: i } },
  }));
  const { transport, vus } = transportScripte(reponses);
  const { registre, appels } = registreScripte("capacite_test", AGENDA_SAFE);
  const r = await executerTour(params, {}, sansSignal(), deps(transport, registre));

  verdict(
    "le tour se termine malgré un modèle qui boucle",
    r.ok,
    r.ok ? "terminé" : "ERREUR",
  );
  verdict(
    `les EXÉCUTIONS sont bornées à MAX_TOURS_OUTIL (${BUDGETS.MAX_TOURS_OUTIL})`,
    appels.length === BUDGETS.MAX_TOURS_OUTIL,
    `${appels.length} exécution(s)`,
  );
  verdict(
    "UN seul appel final de verbalisation au plus",
    vus.length === BUDGETS.MAX_TOURS_OUTIL + 1,
    `${vus.length} appels transport`,
  );
  verdict(
    "l'appel final porte tous les résultats au modèle",
    vus[BUDGETS.MAX_TOURS_OUTIL]?.resultatsOutils?.length === BUDGETS.MAX_TOURS_OUTIL,
    `${vus[BUDGETS.MAX_TOURS_OUTIL]?.resultatsOutils?.length ?? 0} résultat(s)`,
  );
  verdict(
    "l'appel final ne réécrit pas la demande",
    vus[BUDGETS.MAX_TOURS_OUTIL]?.persisterDemande === false,
    String(vus[BUDGETS.MAX_TOURS_OUTIL]?.persisterDemande),
  );
  verdict(
    "Jarvis AVOUE au lieu d'inventer",
    r.ok && /pas réussi à aboutir|trop de consultations/i.test(r.data.texte),
    r.ok ? r.data.texte.slice(0, 48) : "-",
  );
  verdict(
    "l'aveu dit que rien n'a été modifié",
    r.ok && /rien n'a été modifié/i.test(r.data.texte),
    "mention présente",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// B4 · DÉDUPLICATION — la boucle stérile est rompue
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB4 — le même appel répété ne repart pas en base");
{
  reinitialiserCarte();
  const { transport } = transportScripte([
    { proposition: { nom: "capacite_test", args: { a: 1, b: 2 } } },
    // Mêmes arguments, ORDRE DES CLÉS INVERSÉ : la canonisation doit voir le
    // même appel. Les modèles réordonnent leurs champs entre deux itérations.
    { proposition: { nom: "capacite_test", args: { b: 2, a: 1 } } },
    { proposition: { nom: "capacite_test", args: { a: 1, b: 2 } } },
  ]);
  const { registre, appels } = registreScripte("capacite_test", AGENDA_SAFE);
  const r = await executerTour(params, {}, sansSignal(), deps(transport, registre));

  verdict(
    "la capacité n'est exécutée QU'UNE fois",
    appels.length === 1,
    `${appels.length} exécution(s) réelle(s)`,
  );
  verdict(
    "la répétition est tracée comme dédupliquée",
    r.ok && r.data.appels.some((a) => a.deduplique === true),
    r.ok ? JSON.stringify(r.data.appels.map((a) => a.deduplique)) : "-",
  );
  verdict(
    "la 3ᵉ répétition rompt le tour",
    r.ok && /tourne en rond/i.test(r.data.texte),
    r.ok ? r.data.texte.slice(0, 40) : "-",
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// B5 · ÉCHEC DE CAPACITÉ — le modèle doit le SAVOIR
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB5 — un échec de capacité remonte au modèle, jamais avalé");
{
  reinitialiserCarte();
  const { transport, vus } = transportScripte([
    { proposition: { nom: "capacite_test", args: {} } },
    { texte: "Je n'ai pas pu consulter l'agenda." },
  ]);
  const { registre } = registreScripte("capacite_test", {
    ok: false,
    error: { code: "interdit", message: "refusé" },
  });
  const r = await executerTour(params, {}, sansSignal(), deps(transport, registre));
  const rebouclé = vus[1]?.resultatsOutils?.[0];
  verdict("l'échec est rebouclé", rebouclé !== undefined && rebouclé.ok === false, JSON.stringify(rebouclé ?? null));
  verdict(
    "le motif est un code CLASSÉ, pas un message de base",
    rebouclé?.motifEchec === "interdit",
    String(rebouclé?.motifEchec),
  );
  verdict("aucune donnée n'accompagne l'échec", rebouclé?.donnees === null, "donnees:null");
  verdict("le tour aboutit quand même", r.ok, "ok");
}

// ═══════════════════════════════════════════════════════════════════════════
// B6 · CAPACITÉ INCONNUE — la boucle ne l'exécute jamais
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB6 — une capacité hors registre de LECTURE n'est pas exécutée");
{
  reinitialiserCarte();
  const { transport, vus } = transportScripte([
    { proposition: { nom: "create_appointment", args: { patientId: "x" } } },
  ]);
  const { registre, appels } = registreScripte("capacite_test", AGENDA_SAFE);
  const r = await executerTour(params, {}, sansSignal(), deps(transport, registre));
  verdict(
    "elle est rendue à l'appelant, pas exécutée",
    r.ok && r.data.propositionInconnue?.nom === "create_appointment",
    r.ok ? String(r.data.propositionInconnue?.nom) : "-",
  );
  verdict("aucune capacité de lecture n'a tourné", appels.length === 0, "0 exécution");
  verdict("la boucle s'arrête là", vus.length === 1, `${vus.length} appel transport`);
}

// ═══════════════════════════════════════════════════════════════════════════
// B7 · RÉFÉRENCE INCONNUE — refus TOTAL, jamais partiel
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB7 — un jeton non résolu invalide l'appel entier");
{
  reinitialiserCarte();
  const { transport, vus } = transportScripte([
    { proposition: { nom: "capacite_test", args: { patientId: "{{PATIENT_404}}" } } },
    { texte: "je n'ai pas trouvé ce dossier" },
  ]);
  const { registre, appels } = registreScripte("capacite_test", AGENDA_SAFE);
  await executerTour(params, {}, sansSignal(), deps(transport, registre));
  verdict("la capacité n'est jamais atteinte", appels.length === 0, "0 exécution");
  verdict(
    "le modèle apprend que la référence est inconnue",
    vus[1]?.resultatsOutils?.[0]?.motifEchec === "reference-inconnue",
    String(vus[1]?.resultatsOutils?.[0]?.motifEchec),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// B8 · INTERRUPTION — le Stop reste ce qu'il était
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB8 — interruption : ce qui est reçu reste, marqué honnêtement");
{
  reinitialiserCarte();
  const { transport } = transportScripte([{ texte: "partiel", interrompu: true }]);
  const { registre } = registreScripte("capacite_test", AGENDA_SAFE);
  const r = await executerTour(params, {}, sansSignal(), deps(transport, registre));
  verdict("le tour est un SUCCÈS partiel, pas une erreur", r.ok, "ok");
  verdict("il est marqué interrompu", r.ok && r.data.interrompu === true, "interrompu:true");
  verdict("le texte reçu est conservé", r.ok && r.data.texte === "partiel", r.ok ? r.data.texte : "-");
  verdict("rien n'est déclaré persisté", r.ok && r.data.persiste === false, "persiste:false");
}

// ═══════════════════════════════════════════════════════════════════════════
// B9 · ISOLATION — changer de cible purge la carte (scénario K)
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB9 — cible unique : changer de patient jette le contexte précédent");
{
  reinitialiserCarte();
  definirCible({ id: "uuid-mahmoud-saidi-djilali", libelle: "DJILALI Karim", numeroDossier: "D-1", origine: "ecran" });
  const refA = carte().patient("uuid-mahmoud-saidi-djilali", "DJILALI Karim");
  const changeA = definirCible({ id: "uuid-mahmoud-saidi", libelle: "SAIDI Mahmoud", numeroDossier: "D-2", origine: "ecran" });
  verdict("changer de patient est signalé comme un CHANGEMENT", changeA === true, "true");
  verdict(
    "l'ancien jeton ne résout plus rien après purge",
    carte().resoudre(refA) === null,
    "carte purgée",
  );
  const refB = carte().patient("uuid-mahmoud-saidi", "SAIDI Mahmoud");
  verdict(
    "aucun nom du patient précédent ne subsiste dans la carte",
    !carte().identites().some((i) => /nadia|belkacem/i.test(i)),
    JSON.stringify(carte().identites()),
  );
  verdict(
    "le rendu du nouveau jeton donne le NOUVEAU patient",
    carte().rendre(`{{${refB}}}`) === "SAIDI Mahmoud",
    carte().rendre(`{{${refB}}}`),
  );
  const rappel = definirCible({ id: "uuid-mahmoud-saidi", libelle: "SAIDI Mahmoud", numeroDossier: "D-2", origine: "ecran" });
  verdict("redéfinir la MÊME cible ne purge pas inutilement", rappel === false, "false");
  effacerCible();
}

// ═══════════════════════════════════════════════════════════════════════════
// B10 · ANNULATION — une capacité qui pend ne pend pas Jarvis
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nB10 — le Stop coupe la capacité en cours");
{
  reinitialiserCarte();
  const { transport, vus } = transportScripte([
    { proposition: { nom: "capacite_test", args: {} } },
    { texte: "arrêté" },
  ]);
  const { registre } = registreScripte("capacite_test", AGENDA_SAFE, { lent: true });
  const controleur = new AbortController();
  const promesse = executerTour(params, {}, controleur.signal, deps(transport, registre));
  setTimeout(() => controleur.abort(), 150);
  const debut = Date.now();
  const r = await promesse;
  const ecoule = Date.now() - debut;
  verdict("le tour ne reste pas bloqué 60 s", ecoule < 10_000, `${ecoule} ms`);
  verdict("le tour rend un résultat", r.ok, r.ok ? "ok" : JSON.stringify(r.error));
  verdict(
    "le modèle apprend que la capacité a été coupée",
    vus[1] === undefined || vus[1]?.resultatsOutils?.[0]?.ok === false,
    JSON.stringify(vus[1]?.resultatsOutils?.[0]?.motifEchec ?? "tour arrêté"),
  );
}

console.log(
  `\n${rouges === 0 ? "VERDICT BOUCLE : VERT" : `VERDICT BOUCLE : ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
