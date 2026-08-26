/**
 * eval-machine-voix — AUCUN ÉTAT BLOQUÉ, ET JARVIS NE SE RÉVEILLE PAS TOUT SEUL.
 *
 * ═══ LES DEUX DÉFAUTS QUE CETTE PASSE GARDE ═══
 *
 * 1 · L'ÉTAT BLOQUÉ. Chaque chemin d'échec — micro refusé, transcription
 *     échouée, commande qui lève, lecture qui cale — doit ABOUTIR à un état
 *     dont la praticienne peut sortir. Un orbe coincé en « Un instant… » ne
 *     répond plus au mot de réveil, et rien à l'écran ne dit pourquoi.
 *
 * 2 · L'AUTO-RÉVEIL. Le détecteur doit se taire pendant que la praticienne
 *     dicte ET pendant que Jarvis parle. Sans cela, la commande se réveille
 *     elle-même, et la voix de synthèse déclenche une nouvelle écoute : une
 *     boucle qui s'entretient toute seule, micro ouvert, dans un cabinet.
 *
 *   node scripts/eval-machine-voix.mjs <dir js compilé>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-machine-voix.mjs <dir js compilé>");
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
// LE POSTE SIMULÉ
// ═══════════════════════════════════════════════════════════════════════════

let fragmentsARendre = 1;

function fabriquerFlux() {
  const pistes = [{ readyState: "live", stop() { this.readyState = "ended"; } }];
  return { getTracks: () => pistes, getAudioTracks: () => pistes };
}

Object.defineProperty(globalThis, "navigator", {
  value: { mediaDevices: { getUserMedia: async () => fabriquerFlux() } },
  configurable: true,
  writable: true,
});

globalThis.MediaRecorder = class {
  static isTypeSupported() {
    return true;
  }
  constructor() {
    this.mimeType = "audio/webm";
    this.ondataavailable = null;
    this.onstop = null;
  }
  start() {
    // Le fragment arrive AVANT `onstop` — c'est l'ordre réel du navigateur, et
    // tout le contrat de finalisation en dépend.
    setTimeout(() => {
      if (fragmentsARendre > 0) this.ondataavailable?.({ data: { size: 10 } });
    }, 0);
  }
  stop() {
    setTimeout(() => this.onstop?.(), 0);
  }
};

globalThis.Blob = class {
  constructor(parties) {
    this.size = parties.length * 10;
    this.type = "audio/webm";
  }
};
globalThis.FileReader = class {
  readAsDataURL() {
    this.result = "data:audio/webm;base64,AAAA";
    setTimeout(() => this.onloadend?.(), 0);
  }
};

globalThis.AudioContext = class {
  constructor(o) {
    this.sampleRate = o?.sampleRate ?? 48000;
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
      getFloatTimeDomainData(t) {
        t.fill(0);
      },
    };
  }
  async close() {}
};
globalThis.window = {
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  speechSynthesis: { cancel() {} },
};

const {
  armerReveil,
  desarmerReveil,
  installerDetecteur,
  etatVoix,
  abonnerVoix,
  declencherEcoute,
  cloturerCommande,
  interrompreVoix,
  acquitterErreur,
  signalerParole,
  signalerFinParole,
} = await import(url("jarvis-reveil.js"));

let vue = null;
abonnerVoix((v) => {
  vue = v;
});

/** Un détecteur conforme, instrumenté pour compter suspensions et reprises. */
function detecteurEspion() {
  const compte = { suspendu: 0, repris: 0, arrete: 0 };
  let rappel = null;
  installerDetecteur({
    nom: "espion",
    disponible: async () => true,
    demarrer: async (surReveil) => {
      rappel = surReveil;
      return { ok: true, data: true };
    },
    suspendre: () => {
      compte.suspendu += 1;
    },
    reprendre: () => {
      compte.repris += 1;
    },
    arreter: () => {
      compte.arrete += 1;
    },
  });
  return { compte, reveiller: () => rappel?.() };
}

const pause = () => new Promise((r) => setTimeout(r, 20));

// ═══════════════════════════════════════════════════════════════════════════
// S1 · LE DÉTECTEUR SE TAIT PENDANT LA DICTÉE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nS1 — pendant que la praticienne parle, le détecteur est sourd");
{
  const { compte } = detecteurEspion();
  await armerReveil({ onCommande: async () => {} });
  verdict("armé, en veille", etatVoix() === "veille", etatVoix());
  verdict("aucune suspension au repos", compte.suspendu === 0, String(compte.suspendu));

  await declencherEcoute();
  verdict("l'état passe à « ecoute »", etatVoix() === "ecoute", etatVoix());
  // ⚠️ LE CONTRÔLE ANTI-AUTO-RÉVEIL, PREMIÈRE MOITIÉ.
  verdict("le scoring est SUSPENDU pendant la capture", compte.suspendu === 1, String(compte.suspendu));
  verdict("il n'a pas encore repris", compte.repris === 0, String(compte.repris));

  desarmerReveil();
}

// ═══════════════════════════════════════════════════════════════════════════
// S2 · UNE ACTIVATION PENDANT L'ÉCOUTE NE LANCE PAS UNE SECONDE CAPTURE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nS2 — le mot de réveil prononcé pendant l'écoute");
{
  const { compte } = detecteurEspion();
  await armerReveil({ onCommande: async () => {} });

  await declencherEcoute();
  const avant = compte.suspendu;
  await declencherEcoute(); // la praticienne redit « Alexa » au milieu
  await declencherEcoute();

  verdict("aucune capture concurrente n'est ouverte", compte.suspendu === avant, `${compte.suspendu} suspension(s)`);
  verdict("l'état reste « ecoute »", etatVoix() === "ecoute", etatVoix());
  desarmerReveil();
}

// ═══════════════════════════════════════════════════════════════════════════
// S3 · `cloturerCommande` EST IDEMPOTENT
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nS3 — silence, plafond, clic et démontage concluent tous en même temps");
{
  let commandes = 0;
  const { compte } = detecteurEspion();
  await armerReveil({
    onCommande: async () => {
      commandes += 1;
    },
  });

  await declencherEcoute();
  // Les quatre déclencheurs réels, tirés dans le même tour de boucle.
  const tous = [cloturerCommande(), cloturerCommande(), cloturerCommande(), cloturerCommande()];
  await Promise.all(tous);
  await pause();

  // ⚠️ LE PREMIER APPELANT GAGNE. Sans cela : quatre `MediaRecorder.stop()`,
  // quatre transcriptions facturées, quatre appels à Jarvis, quatre traces
  // d'audit — pour une seule phrase.
  verdict("la commande n'est transmise QU'UNE FOIS", commandes <= 1, `${commandes} transmission(s)`);
  verdict("aucune reprise en double", compte.repris <= 1, `${compte.repris} reprise(s)`);
  verdict("l'état n'est pas resté « traitement »", etatVoix() !== "traitement", etatVoix());
  desarmerReveil();
}

// ═══════════════════════════════════════════════════════════════════════════
// S4 · UN JETON PÉRIMÉ NE CLÔT PAS LA CAPTURE SUIVANTE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nS4 — l'endpointeur de la capture précédente conclut en retard");
{
  detecteurEspion();
  await armerReveil({ onCommande: async () => {} });

  await declencherEcoute();
  await cloturerCommande(); // capture nº1 close
  await pause();

  await declencherEcoute(); // capture nº2 ouverte
  const etatAvant = etatVoix();
  // Le retardataire porte le jeton de la capture nº1.
  await cloturerCommande(1, "silence");

  verdict("la capture en cours n'est pas coupée", etatVoix() === etatAvant, `${etatAvant} → ${etatVoix()}`);
  desarmerReveil();
}

// ═══════════════════════════════════════════════════════════════════════════
// S5 · AUCUN CHEMIN D'ÉCHEC NE LAISSE UN ÉTAT BLOQUÉ
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nS5 — la commande lève une exception");
{
  const { compte } = detecteurEspion();
  await armerReveil({
    onCommande: async () => {
      throw new Error("la boucle Jarvis a explosé");
    },
  });

  await declencherEcoute();
  await cloturerCommande();
  await pause();

  // ⚠️ SANS LE `try` DE `cloturerCommande`, LA MACHINE RESTAIT EN «traitement»
  // POUR TOUJOURS : le rejet remontait dans un `void` et personne ne le voyait.
  verdict("l'état n'est pas bloqué en « traitement »", etatVoix() !== "traitement", etatVoix());
  verdict("une raison est publiée", vue?.raison !== null, String(vue?.raison).slice(0, 40));
  verdict("le détecteur a repris la main", compte.repris >= 1, `${compte.repris} reprise(s)`);

  acquitterErreur();
  verdict("acquitter ramène en veille", etatVoix() === "veille", etatVoix());
  verdict("le mot de réveil refonctionne", vue?.reveilArme === true, `reveilArme=${vue?.reveilArme}`);
  desarmerReveil();
}

// ═══════════════════════════════════════════════════════════════════════════
// S6 · JARVIS NE SE RÉVEILLE PAS EN S'ENTENDANT PARLER
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nS6 — Jarvis parle : le détecteur doit rester sourd");
{
  const { compte } = detecteurEspion();
  await armerReveil({ onCommande: async () => {} });

  const suspendusAvant = compte.suspendu;
  signalerParole();
  verdict("l'état montre la parole", etatVoix() === "parole", etatVoix());
  // ⚠️ LE CONTRÔLE ANTI-AUTO-RÉVEIL, SECONDE MOITIÉ. L'annulation d'écho du
  // navigateur ne couvre pas un haut-parleur externe, courant sur un poste de
  // cabinet : c'est la suspension, et elle seule, qui empêche la boucle.
  verdict("le scoring est suspendu pendant la parole", compte.suspendu === suspendusAvant + 1, String(compte.suspendu));

  signalerFinParole();
  verdict("la parole finie, retour en veille", etatVoix() === "veille", etatVoix());
  verdict("le détecteur reprend APRÈS la parole", compte.repris >= 1, `${compte.repris} reprise(s)`);
  desarmerReveil();
}

// ═══════════════════════════════════════════════════════════════════════════
// S7 · « STOP » COUPE TOUT, ET L'ÉTAT LE MONTRE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nS7 — la praticienne interrompt");
{
  const { compte } = detecteurEspion();
  await armerReveil({ onCommande: async () => {} });

  await declencherEcoute();
  interrompreVoix();
  verdict("« interrompu » est un état VISIBLE", etatVoix() === "interrompu", etatVoix());
  verdict("le détecteur a repris la main", compte.repris >= 1, `${compte.repris} reprise(s)`);

  // Une clôture arrivant après l'interruption ne doit rien relancer.
  await cloturerCommande();
  verdict("aucune clôture ne survit à l'interruption", etatVoix() === "interrompu", etatVoix());
  desarmerReveil();
}

// ═══════════════════════════════════════════════════════════════════════════
// S8 · DÉSARMER REND TOUT, ET NE PRÉTEND PLUS ÉCOUTER
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nS8 — la voix est éteinte pendant une écoute");
{
  const { compte } = detecteurEspion();
  await armerReveil({ onCommande: async () => {} });
  await declencherEcoute();

  desarmerReveil();
  verdict("le moteur est arrêté", compte.arrete >= 1, `${compte.arrete} arrêt(s)`);
  verdict("l'état retombe en « desactive »", etatVoix() === "desactive", etatVoix());
  verdict("l'orbe ne prétend plus écouter", vue?.reveilArme === false, `reveilArme=${vue?.reveilArme}`);

  // ⚠️ RÈGLE 8 : une raison NOMMÉE, jamais un état muet.
  verdict("une raison est affichable", typeof vue?.raison === "string", String(vue?.raison).slice(0, 40));

  await cloturerCommande();
  verdict("rien ne redémarre après extinction", etatVoix() === "desactive", etatVoix());
}

console.log(
  `\nVERDICT MACHINE VOIX : ${rouges === 0 ? `VERT (${verts} vert(s))` : `ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
