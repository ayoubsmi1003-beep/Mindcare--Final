/**
 * eval-endpointage — QUAND LA PRATICIENNE A FINI DE PARLER.
 *
 * ═══ LE DÉFAUT QUE CETTE PASSE GARDE ═══
 *
 * `cloturerCommande()` a longtemps existé SANS APPELANT, et le contrat du
 * détecteur ne porte aucun signal de fin de parole. Conséquence exacte : après
 * le mot de réveil, l'enregistrement démarrait et NE S'ARRÊTAIT JAMAIS. Toute
 * la boucle vocale était bloquée là, et aucune interface posée par-dessus
 * n'aurait pu la débloquer.
 *
 * Cette éval prouve les quatre sorties, et surtout qu'il en existe TOUJOURS une.
 *
 * ⚠️ HORLOGE VIRTUELLE. Le plafond dur est à 15 secondes ; l'éprouver en temps
 * réel coûterait 15 secondes par exécution et rendrait le checkpoint pénible au
 * point qu'on cesserait de le lancer. Les minuteurs sont donc pilotés, ce qui
 * rend aussi le résultat DÉTERMINISTE — une éval de timing qui dépend de la
 * charge de la machine finit par clignoter, et une éval qui clignote finit par
 * être ignorée.
 *
 *   node scripts/eval-endpointage.mjs <dir js compilé>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-endpointage.mjs <dir js compilé>");
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
// L'HORLOGE PILOTÉE
// ═══════════════════════════════════════════════════════════════════════════

let maintenant = 1_000_000;
let prochainId = 1;
const minuteurs = new Map();

Date.now = () => maintenant;

globalThis.setInterval = (fn, ms) => {
  const id = prochainId++;
  minuteurs.set(id, { fn, ms, echeance: maintenant + ms, repete: true });
  return id;
};
globalThis.setTimeout = (fn, ms) => {
  const id = prochainId++;
  minuteurs.set(id, { fn, ms: ms ?? 0, echeance: maintenant + (ms ?? 0), repete: false });
  return id;
};
globalThis.clearInterval = (id) => minuteurs.delete(id);
globalThis.clearTimeout = (id) => minuteurs.delete(id);

/** Avance le temps par pas de 10 ms et déclenche ce qui est dû. */
function avancer(ms) {
  const cible = maintenant + ms;
  while (maintenant < cible) {
    maintenant = Math.min(cible, maintenant + 10);
    for (const [id, t] of [...minuteurs]) {
      if (t.echeance > maintenant) continue;
      if (t.repete) t.echeance = maintenant + t.ms;
      else minuteurs.delete(id);
      t.fn();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LE MICRO SIMULÉ — une amplitude qu'on pilote
// ═══════════════════════════════════════════════════════════════════════════

/** RMS courant. 0 = silence ; 0.2 = parole franche (seuil du module : 0.02). */
let amplitude = 0;

function fabriquerFlux() {
  const pistes = [{ readyState: "live", stop() { this.readyState = "ended"; } }];
  return { getTracks: () => pistes, getAudioTracks: () => pistes };
}

Object.defineProperty(globalThis, "navigator", {
  value: { mediaDevices: { getUserMedia: async () => fabriquerFlux() } },
  configurable: true,
  writable: true,
});

globalThis.AudioContext = class {
  constructor(options) {
    this.sampleRate = options?.sampleRate ?? 48000;
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
        // Un signal constant d'amplitude `amplitude` : son RMS vaut exactement
        // `amplitude`, ce qui rend le seuil lisible dans l'éval.
        t.fill(amplitude);
      },
    };
  }
  async close() {}
};
globalThis.window = { localStorage: { getItem: () => null, setItem() {}, removeItem() {} } };

const { prendreMicro } = await import(url("micro-partage.js"));
const { creerEndpointeurEnergie } = await import(url("endpointage-voix.js"));

const prise = await prendreMicro();
if (!prise.ok) {
  console.error("micro simulé indisponible");
  process.exit(2);
}

/** Prépare un endpointeur et collecte les motifs de fin. */
function armer() {
  const motifs = [];
  const e = creerEndpointeurEnergie();
  const r = e.demarrer((m) => motifs.push(m));
  return { e, r, motifs };
}

// ═══════════════════════════════════════════════════════════════════════════
// E1 · LE CAS NORMAL — parole, puis silence
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE1 — elle parle, puis se tait");
{
  amplitude = 0.2;
  const { e, r, motifs } = armer();
  verdict("l'endpointeur démarre", r.ok === true, r.ok ? "ok" : r.error.code);

  avancer(1500); // 1,5 s de parole franche
  verdict("pendant la parole, rien ne conclut", motifs.length === 0, `${motifs.length} fin(s)`);
  verdict("le niveau remonte au-dessus de zéro", e.niveau() > 0, e.niveau().toFixed(3));

  amplitude = 0; // elle se tait
  avancer(1000); // moins que SILENCE_MS (1200)
  verdict("un silence COURT ne coupe pas la phrase", motifs.length === 0, "pause de réflexion");

  avancer(400); // on dépasse 1200 ms
  verdict("après 1200 ms de silence, la commande se clôt", motifs.length === 1, `${motifs.length} fin(s)`);
  verdict("le motif est « silence »", motifs[0] === "silence", String(motifs[0]));

  avancer(5000);
  // ⚠️ L'ENDPOINTEUR S'ARRÊTE LUI-MÊME AVANT DE RAPPELER. Sans cela, il
  // continuerait de mesurer et conclurait encore, encore, encore.
  verdict("il ne conclut QU'UNE FOIS", motifs.length === 1, `${motifs.length} fin(s)`);
  e.arreter();
}

// ═══════════════════════════════════════════════════════════════════════════
// E2 · LE PLAFOND DUR — le garde-fou qui ne dépend de rien
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE2 — elle parle sans s'arrêter");
{
  amplitude = 0.2;
  const { e, motifs } = armer();

  avancer(14_000);
  verdict("à 14 s, on écoute encore", motifs.length === 0, "pas de coupure prématurée");

  avancer(1500); // on franchit PLAFOND_MS = 15 s
  verdict("le plafond de 15 s coupe", motifs.length === 1, `${motifs.length} fin(s)`);
  verdict("le motif est « plafond »", motifs[0] === "plafond", String(motifs[0]));
  e.arreter();
}

// ═══════════════════════════════════════════════════════════════════════════
// E3 · LE FAUX RÉVEIL — une porte qui claque
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE3 — un bruit a réveillé, personne ne parle");
{
  amplitude = 0; // rien du tout
  const { e, motifs } = armer();

  avancer(2500);
  verdict("on laisse sa chance à une phrase tardive", motifs.length === 0, "patience de 3 s");

  avancer(1000);
  verdict("après 3 s sans parole, on rend la main", motifs.length === 1, `${motifs.length} fin(s)`);
  // ⚠️ « faux-reveil » N'EST PAS UNE ERREUR. Afficher un échec ferait croire à
  // une panne à chaque claquement de porte dans un cabinet.
  verdict("le motif est « faux-reveil », pas une erreur", motifs[0] === "faux-reveil", String(motifs[0]));
  e.arreter();
}

// ═══════════════════════════════════════════════════════════════════════════
// E4 · UN BRUIT CONTINU NE PIÈGE PAS LE MICRO
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE4 — bruit de fond continu, jamais de vraie parole");
{
  // Au-dessus du seuil de voix, donc indiscernable d'une parole pour l'énergie
  // seule : c'est exactement le cas où la détection de silence est impuissante,
  // et où le plafond doit prendre le relais.
  amplitude = 0.05;
  const { e, motifs } = armer();

  avancer(16_000);
  verdict("le micro finit TOUJOURS par se refermer", motifs.length === 1, `${motifs.length} fin(s)`);
  verdict("c'est le plafond qui a tranché", motifs[0] === "plafond", String(motifs[0]));
  e.arreter();
}

// ═══════════════════════════════════════════════════════════════════════════
// E5 · ARRÊT MANUEL — plus rien ne conclut après coup
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE5 — la praticienne coupe elle-même");
{
  amplitude = 0.2;
  const { e, motifs } = armer();
  avancer(600);
  e.arreter(); // clic sur l'orbe, ou interruption

  amplitude = 0;
  avancer(20_000);
  // ⚠️ UN ENDPOINTEUR ARRÊTÉ QUI CONCLURAIT ENCORE FERMERAIT LA CAPTURE
  // SUIVANTE. C'est précisément ce que le jeton de capture de `jarvis-reveil`
  // neutralise en second rempart — mais le premier rempart est ici.
  verdict("aucune conclusion après l'arrêt", motifs.length === 0, `${motifs.length} fin(s)`);
  verdict("le niveau est remis à zéro", e.niveau() === 0, String(e.niveau()));
}

// ═══════════════════════════════════════════════════════════════════════════
// E6 · REDÉMARRER NE LAISSE PAS DEUX MESURES EN VIE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nE6 — deux démarrages successifs sur le même endpointeur");
{
  amplitude = 0.2;
  const motifs = [];
  const e = creerEndpointeurEnergie();
  e.demarrer((m) => motifs.push(m));
  avancer(500);
  e.demarrer((m) => motifs.push(m)); // second démarrage sans arrêt explicite

  amplitude = 0;
  // Le second démarrage a REMIS LES COMPTEURS À ZÉRO : aucune parole n'a encore
  // été entendue par cette mesure-là, donc c'est la patience initiale (3 s) qui
  // tranche, pas le silence (1,2 s). On avance assez pour la franchir.
  avancer(3500);
  // Deux minuteurs vivants produiraient DEUX conclusions — donc deux
  // transcriptions envoyées pour une seule phrase.
  verdict("une seule mesure survit au redémarrage", motifs.length === 1, `${motifs.length} fin(s)`);
  e.arreter();
}

console.log(
  `\nVERDICT ENDPOINTAGE : ${rouges === 0 ? `VERT (${verts} vert(s))` : `ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
