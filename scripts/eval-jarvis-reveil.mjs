/**
 * eval-jarvis-reveil — LA MACHINE À ÉTATS DE LA VOIX, SANS MOTEUR.
 *
 * ═══ CE QUE CETTE PASSE PROUVE ═══
 *
 * Qu'en l'ABSENCE de détecteur de mot de réveil — la situation réelle de ce
 * dépôt aujourd'hui — le produit le DIT au lieu de le mimer.
 *
 * ⚠️ C'EST LE CONTRÔLE ANTI-CAPACITÉ-FICTIVE. Un orbe qui afficherait « à
 * l'écoute » sans détecteur installé serait une donnée fictive dans une
 * fonctionnalité livrée (règle 8) — et la pire espèce, parce qu'une praticienne
 * croirait pouvoir appeler Jarvis à la voix pendant une consultation et
 * n'obtiendrait rien, sans jamais savoir pourquoi. Un micro qu'on croit ouvert
 * et qui ne l'est pas est une erreur ; un micro qu'on croit fermé et qui ne
 * l'est pas en est une autre, plus grave. La machine doit être exacte dans les
 * deux sens.
 *
 * Elle prouve aussi que la couture d'intégration est COMPLÈTE : un détecteur
 * conforme au contrat s'installe, s'arme, et fait basculer les états — de sorte
 * que le jour où un moteur sera retenu, il n'y aura qu'un objet à fournir.
 *
 *   node scripts/eval-jarvis-reveil.mjs <dir js compilé>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-jarvis-reveil.mjs <dir js compilé>");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(repertoire, f)).href;

const {
  armerReveil,
  desarmerReveil,
  installerDetecteur,
  detecteurInstalle,
  etatVoix,
  abonnerVoix,
  interrompreVoix,
  acquitterErreur,
} = await import(url("jarvis-reveil.js"));

let rouges = 0;
let verts = 0;
function verdict(nom, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(56)} | ${detail}`);
}

/** Dernière vue publiée — c'est ce que l'orbe afficherait. */
let vue = null;
abonnerVoix((v) => {
  vue = v;
});

// ═══════════════════════════════════════════════════════════════════════════
// V1 · AUCUN DÉTECTEUR — l'état de ce dépôt aujourd'hui
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nV1 — aucun détecteur installé : le produit le DIT");
{
  installerDetecteur(null);
  verdict("aucun moteur n'est installé", detecteurInstalle() === null, "null");
  verdict("l'état est « desactive »", etatVoix() === "desactive", etatVoix());
  verdict("l'orbe ne prétend PAS écouter", vue?.reveilArme === false, `reveilArme=${vue?.reveilArme}`);
  verdict(
    "une raison NOMMÉE est publiée",
    typeof vue?.raison === "string" && vue.raison.length > 0,
    String(vue?.raison).slice(0, 60),
  );

  const r = await armerReveil({ onCommande: async () => {} });
  verdict("armer ÉCHOUE explicitement", r.ok === false, r.ok ? "ok" : r.error.code);
  verdict("l'échec est un refus métier, pas une panne", !r.ok && r.error.code === "regle-metier", r.ok ? "" : r.error.code);
  verdict("l'état reste « desactive » après l'échec", etatVoix() === "desactive", etatVoix());
}

// ═══════════════════════════════════════════════════════════════════════════
// V2 · DÉTECTEUR DÉCLARÉ MAIS INDISPONIBLE
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nV2 — un moteur déclaré dont les assets manquent");
{
  // ⚠️ « DISPONIBLE » SE CONSTATE. Un moteur annoncé mais sans modèle échouerait
  // au premier mot prononcé, en consultation. Le constater à l'armement est la
  // seule façon de ne pas découvrir la panne au pire moment.
  let demarre = false;
  installerDetecteur({
    nom: "faux-moteur-sans-assets",
    disponible: async () => false,
    demarrer: async () => {
      demarre = true;
      return { ok: true, data: true };
    },
    suspendre: () => {},
    reprendre: () => {},
    arreter: () => {},
  });

  const r = await armerReveil({ onCommande: async () => {} });
  verdict("armer échoue", r.ok === false, r.ok ? "ok" : r.error.code);
  verdict("le code dit « indisponible »", !r.ok && r.error.code === "indisponible", r.ok ? "" : r.error.code);
  verdict("le moteur n'a JAMAIS été démarré", demarre === false, "aucun micro ouvert");
  verdict("l'orbe ne prétend pas écouter", vue?.reveilArme === false, `reveilArme=${vue?.reveilArme}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// V3 · LA COUTURE FONCTIONNE — un détecteur conforme s'arme
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nV3 — un détecteur conforme au contrat s'installe et s'arme");
{
  let arrete = 0;
  let suspendu = 0;
  let repris = 0;
  let rappelReveil = null;
  installerDetecteur({
    nom: "detecteur-de-test",
    disponible: async () => true,
    demarrer: async (surReveil) => {
      rappelReveil = surReveil;
      return { ok: true, data: true };
    },
    suspendre: () => {
      suspendu += 1;
    },
    reprendre: () => {
      repris += 1;
    },
    arreter: () => {
      arrete += 1;
    },
  });

  const r = await armerReveil({ onCommande: async () => {} });
  verdict("armer réussit", r.ok === true, r.ok ? "ok" : r.error.code);
  verdict("l'état passe en « veille »", etatVoix() === "veille", etatVoix());
  verdict("l'orbe déclare le réveil armé", vue?.reveilArme === true, `reveilArme=${vue?.reveilArme}`);
  verdict("aucune raison d'erreur ne subsiste", vue?.raison === null, String(vue?.raison));
  verdict("le détecteur a reçu son rappel de réveil", typeof rappelReveil === "function", "rappel branché");

  // ⚠️ LE CONTRAT NE REND AUCUN ÉCHANTILLON. C'est la garantie structurelle que
  // l'audio de VEILLE ne peut pas fuir : il n'y a pas de canal par lequel il
  // remonterait. On le vérifie sur la forme du contrat, pas sur un usage.
  const d = detecteurInstalle();
  const cles = Object.keys(d);
  verdict(
    "le contrat n'expose aucun canal audio",
    !cles.some((k) => /audio|buffer|sample|flux|stream|pcm/i.test(k)),
    cles.join(", "),
  );

  // ⚠️ SANS CES DEUX-LÀ, JARVIS SE RÉVEILLE EN S'ENTENDANT PARLER. Le contrat
  // doit les porter : c'est le seul moyen de faire taire le scoring pendant la
  // dictée et pendant la réponse sans lâcher le micro.
  verdict(
    "le contrat porte la suspension du scoring",
    typeof d.suspendre === "function" && typeof d.reprendre === "function",
    "suspendre + reprendre",
  );

  interrompreVoix();
  verdict("« stop » produit un état VISIBLE", etatVoix() === "interrompu", etatVoix());

  desarmerReveil();
  verdict("désarmer arrête le moteur", arrete >= 1, `${arrete} arrêt(s)`);
  verdict("l'état retombe en « desactive »", etatVoix() === "desactive", etatVoix());
  verdict("l'orbe cesse de déclarer le réveil", vue?.reveilArme === false, `reveilArme=${vue?.reveilArme}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// V4 · REMISE À ZÉRO APRÈS ERREUR
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nV4 — acquitter une erreur sans détecteur ne fait pas croire à une écoute");
{
  installerDetecteur(null);
  acquitterErreur();
  verdict("l'état reste « desactive »", etatVoix() === "desactive", etatVoix());
  verdict("le réveil reste déclaré non armé", vue?.reveilArme === false, `reveilArme=${vue?.reveilArme}`);
}

console.log(
  `\nVERDICT RÉVEIL : ${rouges === 0 ? "VERT" : `ROUGE — ${rouges} contrôle(s)`} (${verts} vert(s))`,
);
process.exit(rouges === 0 ? 0 : 1);
