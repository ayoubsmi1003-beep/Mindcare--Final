/**
 * eval-micro-partage — UN SEUL MICRO, QUOI QU'IL ARRIVE.
 *
 * ═══ CE QUE CETTE PASSE PROUVE ═══
 *
 * Que le détecteur de mot de réveil, l'endpointeur de fin de parole et
 * l'enregistreur de la commande se partagent UNE SEULE acquisition physique.
 *
 * ⚠️ CE N'EST PAS UNE OPTIMISATION. Avant le courtier, chacun appelait son
 * `getUserMedia` : Firefox redemande la permission à chaque appel, Safari peut
 * échouer la seconde acquisition, et deux captures du même périphérique sous
 * WASAPI se désynchronisent ou rendent du silence. Le défaut est invisible au
 * développement — sur un poste, il se manifeste au moment où la praticienne
 * vient de dire « Alexa » et attend d'être entendue.
 *
 * Cette éval ÉCHOUE si deux acquisitions physiques se produisent.
 *
 *   node scripts/eval-micro-partage.mjs <dir js compilé>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-micro-partage.mjs <dir js compilé>");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(repertoire, f)).href;

let rouges = 0;
let verts = 0;
function verdict(nom, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(56)} | ${detail}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LE POSTE SIMULÉ — on compte ce qui est RÉELLEMENT demandé au navigateur
// ═══════════════════════════════════════════════════════════════════════════

let acquisitions = 0;
let pistesVivantes = 0;

function fabriquerFlux() {
  const pistes = [
    {
      readyState: "live",
      stop() {
        if (this.readyState === "live") {
          this.readyState = "ended";
          pistesVivantes -= 1;
        }
      },
    },
  ];
  pistesVivantes += 1;
  return { getTracks: () => pistes, getAudioTracks: () => pistes };
}

// Node 22 expose un `navigator` en lecture seule : on le REDÉFINIT au lieu de
// l'affecter, sinon l'éval meurt avant d'avoir rien mesuré.
const micro = {
  mediaDevices: {
    getUserMedia: async () => {
      acquisitions += 1;
      return fabriquerFlux();
    },
  },
};
Object.defineProperty(globalThis, "navigator", {
  value: micro,
  configurable: true,
  writable: true,
});

let contextesOuverts = 0;
globalThis.AudioContext = class {
  constructor(options) {
    this.sampleRate = options?.sampleRate ?? 48000;
    contextesOuverts += 1;
  }
  createMediaStreamSource() {
    return { context: this, connect() {}, disconnect() {} };
  }
  createAnalyser() {
    return {
      fftSize: 512,
      smoothingTimeConstant: 0,
      connect() {},
      disconnect() {},
      getFloatTimeDomainData() {},
    };
  }
  async close() {
    contextesOuverts -= 1;
  }
};
globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };

const { prendreMicro, prisesActives, microOuvert, sourcePartagee, contexteAudioPartage } =
  await import(url("micro-partage.js"));

// ═══════════════════════════════════════════════════════════════════════════
// M1 · TROIS CONSOMMATEURS, UNE ACQUISITION
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nM1 — détecteur + endpointeur + enregistreur sur un seul micro");
{
  const a = await prendreMicro();
  const b = await prendreMicro();
  const c = await prendreMicro();

  verdict("les trois prises réussissent", a.ok && b.ok && c.ok, `ok=${a.ok && b.ok && c.ok}`);
  // ⚠️ LE CONTRÔLE CENTRAL DE CETTE ÉVAL.
  verdict("UNE SEULE acquisition physique", acquisitions === 1, `${acquisitions} getUserMedia`);
  verdict(
    "les trois partagent le MÊME flux",
    a.data.flux === b.data.flux && b.data.flux === c.data.flux,
    "identité",
  );
  verdict("le compteur voit trois prises", prisesActives() === 3, String(prisesActives()));

  const s1 = sourcePartagee();
  const s2 = sourcePartagee();
  verdict("un SEUL nœud source pour tout le graphe", s1 === s2 && s1 !== null, "source unique");
  verdict(
    "le contexte impose 16 kHz",
    contexteAudioPartage()?.sampleRate === 16000,
    String(contexteAudioPartage()?.sampleRate),
  );

  a.data.rendre();
  verdict("après un relâchement, le micro reste OUVERT", microOuvert() === true, `vivantes=${pistesVivantes}`);
  b.data.rendre();
  verdict("après deux relâchements, toujours ouvert", microOuvert() === true, `vivantes=${pistesVivantes}`);

  c.data.rendre();
  // ⚠️ LE VOYANT MICRO DU NAVIGATEUR. Une piste non arrêtée le laisse ALLUMÉ :
  // la praticienne verrait son micro actif alors que plus rien n'écoute.
  verdict("au DERNIER relâchement, les pistes s'arrêtent", pistesVivantes === 0, `${pistesVivantes} vivante(s)`);
  verdict("le contexte audio est refermé", contextesOuverts === 0, `${contextesOuverts} ouvert(s)`);
  verdict("le compteur est retombé à zéro", prisesActives() === 0, String(prisesActives()));
}

// ═══════════════════════════════════════════════════════════════════════════
// M2 · UN RELÂCHEMENT EN DOUBLE NE COUPE PAS LE MICRO DES AUTRES
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nM2 — relâcher deux fois est inoffensif");
{
  acquisitions = 0;
  const a = await prendreMicro();
  const b = await prendreMicro();

  a.data.rendre();
  a.data.rendre(); // ⚠️ le geste maladroit qu'on doit absorber
  a.data.rendre();

  verdict("le compteur ne passe pas sous le réel", prisesActives() === 1, String(prisesActives()));
  verdict("le micro de l'autre consommateur VIT toujours", microOuvert() === true, `pistes=${pistesVivantes}`);

  b.data.rendre();
  verdict("le dernier relâchement ferme bien", microOuvert() === false, `pistes=${pistesVivantes}`);
  verdict("aucun compteur négatif", prisesActives() === 0, String(prisesActives()));
}

// ═══════════════════════════════════════════════════════════════════════════
// M3 · DEUX APPELS SIMULTANÉS PARTAGENT LA MÊME ACQUISITION
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nM3 — démarrage simultané détecteur + enregistreur");
{
  acquisitions = 0;
  // Le cas réel : le détecteur s'arme pendant que la dictée démarre. Sans la
  // promesse partagée, les deux appellent `getUserMedia` avant que le premier
  // n'ait posé l'état.
  const [a, b] = await Promise.all([prendreMicro(), prendreMicro()]);
  verdict("une seule acquisition malgré la concurrence", acquisitions === 1, `${acquisitions} getUserMedia`);
  verdict("les deux obtiennent le même flux", a.data.flux === b.data.flux, "identité");
  a.data.rendre();
  b.data.rendre();
  verdict("tout est rendu", prisesActives() === 0 && pistesVivantes === 0, "propre");
}

// ═══════════════════════════════════════════════════════════════════════════
// M4 · MICRO PERDU EN COURS DE ROUTE — ON RÉACQUIERT, ON NE MENT PAS
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nM4 — le périphérique disparaît sous nos pieds");
{
  acquisitions = 0;
  const a = await prendreMicro();
  // Micro débranché, ou pris par une autre application.
  for (const p of a.data.flux.getTracks()) p.stop();

  const b = await prendreMicro();
  verdict("un flux MORT n'est pas recyclé", acquisitions === 2, `${acquisitions} acquisitions`);
  verdict(
    "la nouvelle prise est vivante",
    b.ok && b.data.flux.getAudioTracks()[0].readyState === "live",
    "live",
  );
  b.data.rendre();
}

// ═══════════════════════════════════════════════════════════════════════════
// M5 · REFUS DE PERMISSION — UN REFUS, PAS UNE PANNE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nM5 — la praticienne refuse le micro");
{
  micro.mediaDevices.getUserMedia = async () => {
    throw new Error("NotAllowedError");
  };
  const r = await prendreMicro();
  verdict("la prise échoue explicitement", r.ok === false, r.ok ? "ok" : r.error.code);
  verdict("c'est un REFUS, pas une indisponibilité", !r.ok && r.error.code === "interdit", r.ok ? "" : r.error.code);
  verdict("aucune prise fantôme n'est comptée", prisesActives() === 0, String(prisesActives()));
  verdict("aucun micro n'est déclaré ouvert", microOuvert() === false, "fermé");
}

console.log(
  `\nVERDICT MICRO PARTAGÉ : ${rouges === 0 ? `VERT (${verts} vert(s))` : `ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
