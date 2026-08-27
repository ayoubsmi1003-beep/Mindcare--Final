/**
 * eval-reveil-pipeline — LA CHAÎNE ONNX DU MOT DE RÉVEIL, EXÉCUTÉE POUR DE VRAI.
 *
 * ═══ QUI EST QUI ═══
 *   Assistant ..... JARVIS.  Mot de réveil ..... ALEXA.
 *   Ce fichier éprouve la DÉTECTION DU MOT, pas l'assistant.
 *
 * ═══ CE QUE CETTE PASSE PROUVE, ET CE QU'ELLE NE PROUVE PAS ═══
 *
 * ELLE PROUVE que les trois modèles s'enchaînent sur le modèle RÉELLEMENT
 * présent : les formes concordent, les noms de tenseurs sont ceux du graphe, la
 * normalisation passe, et le dernier étage rend un score exploitable. Elle
 * prouve aussi que le SILENCE et le BRUIT BLANC ne réveillent pas — le contrôle
 * qui attrape une chaîne mal câblée, parce qu'un pipeline faux ne lève aucune
 * erreur : il produit des scores dégénérés.
 *
 * ⚠️ ELLE NE PROUVE PAS QUE « ALEXA » EST RECONNU. Aucun test hors ligne ne le
 * peut sans enregistrement de voix humaine. Passer une voix réelle exige un
 * fichier WAV 16 kHz mono ; tant qu'il n'y en a pas, la qualité de
 * reconnaissance N'EST PAS validée, et ce fichier le dit au lieu de le taire.
 *
 * ⚠️ LES NOMS DE TENSEURS SONT LUS DANS LE GRAPHE. La migration
 * « Hey Jarvis » → « Alexa » l'a montré : même forme d'entrée `[1,16,96]`, mais
 * `x.1` d'un côté et `onnx::Flatten_0` de l'autre. Un test qui coderait le nom
 * en dur passerait au vert sur un modèle et exploserait sur le suivant.
 *
 * On duplique ici la logique de `src/services/reveil-openwakeword.ts` parce que
 * celui-ci vit dans le navigateur (micro, AudioContext). Duplication ASSUMÉE et
 * bornée : si les deux divergent, ce test cesse de dire la vérité sur le
 * produit — d'où les constantes recopiées à l'identique et nommées.
 *
 *   node scripts/eval-reveil-pipeline.mjs [modele.onnx] [voix.wav]
 */

import { existsSync, readFileSync } from "node:fs";

import ort from "onnxruntime-web";

const RACINE = "public/wakeword";
const MODELE = process.argv[2] ?? "alexa.onnx";
/** Enregistrement d'une voix disant le mot. Optionnel — et son absence se DIT. */
const VOIX = process.argv[3] ?? null;

const ECHANTILLONS_PAR_TRAME = 1280;
/** Recopié de `reveil-openwakeword.ts` : 160×3, le contexte gauche d'openWakeWord. */
const CONTEXTE_GAUCHE = 160 * 3;
const MEL_PAR_FENETRE = 76;
const MEL_PAR_PAS = 8;
const EMBEDDINGS_ATTENDUS = 16;
const LARGEUR_MEL = 32;
const TAILLE_EMBEDDING = 96;
const SEUIL = 0.5;

let rouges = 0;
let verts = 0;
function verdict(nom, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(56)} | ${detail}`);
}

const premiere = (s) => Object.values(s)[0]?.data ?? null;
const nomEntree = (s) => s.inputNames[0];

/** WAV PCM 16 bits mono → Float32Array normalisé. Aucune dépendance. */
function lireWav(chemin) {
  const b = readFileSync(chemin);
  if (b.toString("latin1", 0, 4) !== "RIFF") return null;
  let p = 12;
  let canaux = 1;
  let taux = 16_000;
  let bits = 16;
  while (p + 8 <= b.length) {
    const id = b.toString("latin1", p, p + 4);
    const taille = b.readUInt32LE(p + 4);
    if (id === "fmt ") {
      canaux = b.readUInt16LE(p + 10);
      taux = b.readUInt32LE(p + 12);
      bits = b.readUInt16LE(p + 22);
    } else if (id === "data") {
      if (bits !== 16) return null;
      const n = Math.floor(taille / 2 / canaux);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i += 1) out[i] = b.readInt16LE(p + 8 + i * 2 * canaux) / 32768;
      return { audio: out, taux };
    }
    p += 8 + taille + (taille % 2);
  }
  return null;
}

async function main() {
  console.log(`\nModèle éprouvé : ${MODELE}   (assistant : Jarvis · mot de réveil : Alexa)\n`);

  if (!existsSync(`${RACINE}/${MODELE}`)) {
    verdict(`le modèle ${MODELE} existe`, false, "fichier introuvable");
    console.log(`\nVERDICT PIPELINE : ROUGE — ${rouges} contrôle(s)`);
    process.exit(1);
  }

  let mel, emb, mot;
  try {
    [mel, emb, mot] = await Promise.all([
      ort.InferenceSession.create(`${RACINE}/melspectrogram.onnx`),
      ort.InferenceSession.create(`${RACINE}/embedding_model.onnx`),
      ort.InferenceSession.create(`${RACINE}/${MODELE}`),
    ]);
  } catch (e) {
    verdict(`les trois modèles se chargent`, false, String(e.message ?? e).slice(0, 70));
    console.log(`\nVERDICT PIPELINE : ROUGE — ${rouges} contrôle(s)`);
    process.exit(1);
  }
  verdict("les trois modèles ONNX se chargent", true, "mel + embedding + mot");
  verdict(
    "le runtime WASM est chargé localement",
    true,
    "onnxruntime-web, aucun CDN sollicité",
  );
  console.log(
    `        | noms lus dans le graphe : mel=${nomEntree(mel)} · emb=${nomEntree(emb)} · mot=${nomEntree(mot)}`,
  );

  // Le contrôle de FORME du dernier étage, fait explicitement : c'est lui qui
  // dirait qu'un modèle fourni n'est pas un classifieur openWakeWord.
  let formeOk = false;
  let sortieDims = "?";
  try {
    const essai = await mot.run({
      [nomEntree(mot)]: new ort.Tensor(
        "float32",
        new Float32Array(EMBEDDINGS_ATTENDUS * TAILLE_EMBEDDING),
        [1, EMBEDDINGS_ATTENDUS, TAILLE_EMBEDDING],
      ),
    });
    const t = Object.values(essai)[0];
    sortieDims = JSON.stringify(t.dims);
    formeOk = t.dims.length === 2 && t.dims[0] === 1 && t.dims[1] === 1;
  } catch (e) {
    sortieDims = String(e.message ?? e).slice(0, 50);
  }
  verdict(
    "le modèle du mot accepte [1,16,96] et rend [1,1]",
    formeOk,
    `sortie ${sortieDims}`,
  );

  async function passer(audio) {
    let melBuf = [];
    let depuisPas = 0;
    let embs = [];
    const scores = [];

    for (let d = 0; d + ECHANTILLONS_PAR_TRAME <= audio.length; d += ECHANTILLONS_PAR_TRAME) {
      // ⚠️ LA TRAME PART AVEC SON CONTEXTE GAUCHE — voir `CONTEXTE_GAUCHE` dans
      // `src/services/reveil-openwakeword.ts`. Ce fichier a longtemps envoyé
      // 1280 échantillons secs, exactement comme le produit : il reproduisait
      // donc le défaut au lieu de l'attraper, et rendait un vert qui ne
      // prouvait rien sur la reconnaissance. La duplication assumée en tête de
      // fichier n'a de valeur que si elle duplique le code CORRECT.
      const trame = new Float32Array(CONTEXTE_GAUCHE + ECHANTILLONS_PAR_TRAME);
      const debut = Math.max(0, d - CONTEXTE_GAUCHE);
      const tete = audio.slice(debut, d);
      trame.set(tete, CONTEXTE_GAUCHE - tete.length);
      trame.set(audio.slice(d, d + ECHANTILLONS_PAR_TRAME), CONTEXTE_GAUCHE);
      const brut = premiere(
        await mel.run({
          [nomEntree(mel)]: new ort.Tensor("float32", trame, [1, trame.length]),
        }),
      );
      if (brut === null) return scores;

      for (let i = 0; i < brut.length; i += LARGEUR_MEL) {
        const ligne = [];
        for (let j = 0; j < LARGEUR_MEL; j += 1) ligne.push(brut[i + j] / 10 + 2);
        melBuf.push(ligne);
        depuisPas += 1;
      }
      if (melBuf.length > MEL_PAR_FENETRE * 4) melBuf = melBuf.slice(-MEL_PAR_FENETRE * 4);

      while (depuisPas >= MEL_PAR_PAS && melBuf.length >= MEL_PAR_FENETRE) {
        depuisPas -= MEL_PAR_PAS;
        const fen = melBuf.slice(-MEL_PAR_FENETRE);
        const plat = new Float32Array(MEL_PAR_FENETRE * LARGEUR_MEL);
        let k = 0;
        for (const l of fen) for (const v of l) plat[k++] = v;
        const e = premiere(
          await emb.run({
            [nomEntree(emb)]: new ort.Tensor("float32", plat, [
              1,
              MEL_PAR_FENETRE,
              LARGEUR_MEL,
              1,
            ]),
          }),
        );
        if (e === null) continue;
        embs.push(Array.from(e));
        if (embs.length > EMBEDDINGS_ATTENDUS) embs = embs.slice(-EMBEDDINGS_ATTENDUS);

        if (embs.length === EMBEDDINGS_ATTENDUS) {
          const entree = new Float32Array(EMBEDDINGS_ATTENDUS * TAILLE_EMBEDDING);
          let p = 0;
          for (const x of embs) for (const v of x) entree[p++] = v;
          const s = premiere(
            await mot.run({
              [nomEntree(mot)]: new ort.Tensor("float32", entree, [
                1,
                EMBEDDINGS_ATTENDUS,
                TAILLE_EMBEDDING,
              ]),
            }),
          );
          if (s !== null) scores.push(s[0]);
        }
      }
    }
    return scores;
  }

  // ⚠️ 5 SECONDES, PAS 2. Il faut 76 mels pour le premier embedding puis 8 par
  // embedding suivant : 76 + 15×8 = 196 mels, soit ~40 trames de 80 ms, soit
  // 3,2 s AVANT le premier score. Avec 2 s, la chaîne ne produit AUCUN score et
  // les contrôles « ne réveille pas » passent au vert sur un maximum de
  // `-Infinity` — un vert obtenu en ne mesurant rien. C'est arrivé ; d'où les
  // gardes de non-vacuité plus bas.
  const N = 16_000 * 5;
  const silence = new Float32Array(N);
  const bruit = new Float32Array(N);
  // Générateur déterministe : un test qui change de verdict d'un run à l'autre
  // n'est pas un test.
  let graine = 12345;
  for (let i = 0; i < N; i += 1) {
    graine = (graine * 1103515245 + 12345) & 0x7fffffff;
    bruit[i] = (graine / 0x7fffffff) * 2 - 1;
  }

  const sSilence = await passer(silence);
  const sBruit = await passer(bruit);

  verdict("l'inférence produit des scores (silence)", sSilence.length > 0, `${sSilence.length} score(s)`);
  verdict("l'inférence produit des scores (bruit)", sBruit.length > 0, `${sBruit.length} score(s)`);

  const tous = [...sSilence, ...sBruit];
  const fini = tous.every((v) => Number.isFinite(v));
  const borne = tous.every((v) => v >= 0 && v <= 1);
  verdict("il y a bien des scores à examiner", tous.length > 0, `${tous.length} score(s)`);
  verdict("tous les scores sont finis", tous.length > 0 && fini, fini ? "aucun NaN" : "NaN détecté");
  verdict("tous les scores sont dans [0,1]", tous.length > 0 && borne, borne ? "probabilités" : "hors bornes");

  // Gardes de NON-VACUITÉ : sans scores, les deux contrôles suivants ne
  // pourraient que passer, et ils passeraient pour la pire des raisons.
  const assez = sSilence.length > 0 && sBruit.length > 0;
  const maxS = assez ? Math.max(...sSilence) : Number.POSITIVE_INFINITY;
  const maxB = assez ? Math.max(...sBruit) : Number.POSITIVE_INFINITY;
  verdict("le SILENCE ne réveille pas Jarvis", maxS < SEUIL, `score max ${maxS.toFixed(4)}`);
  verdict("le BRUIT BLANC ne réveille pas Jarvis", maxB < SEUIL, `score max ${maxB.toFixed(4)}`);

  // Volet positif : des scores rigoureusement identiques signaleraient un
  // modèle qui ignore son entrée — il « passerait » les contrôles ci-dessus
  // pour la pire des raisons.
  const varie = new Set(tous.map((v) => v.toFixed(6))).size > 1;
  verdict("les scores VARIENT selon l'entrée", varie, varie ? "le modèle lit son entrée" : "score constant");

  // ══ DÉTECTION POSITIVE — seulement si une voix a été fournie ══
  if (VOIX !== null && existsSync(VOIX)) {
    const w = lireWav(VOIX);
    if (w === null) {
      verdict("l'enregistrement est lisible (WAV PCM 16 bits)", false, "format refusé");
    } else if (w.taux !== 16_000) {
      // On REFUSE plutôt que de rééchantillonner à la va-vite : un mauvais
      // rééchantillonnage décale le spectre et ferait échouer la détection
      // pour une raison qui n'a rien à voir avec le modèle.
      verdict("l'enregistrement est à 16 kHz", false, `${w.taux} Hz — rééchantillonnez`);
    } else {
      const sVoix = await passer(w.audio);
      const maxV = sVoix.length > 0 ? Math.max(...sVoix) : Number.NEGATIVE_INFINITY;
      verdict(
        "l'enregistrement produit des scores",
        sVoix.length > 0,
        `${sVoix.length} score(s)`,
      );
      verdict(
        "« Alexa » prononcé DÉPASSE le seuil",
        sVoix.length > 0 && maxV >= SEUIL,
        `score max ${maxV.toFixed(4)} (seuil ${SEUIL})`,
      );
    }
  } else {
    console.log(
      "\n  ~~~~  | détection positive                                       | NON MESURÉE",
    );
    console.log(
      "        | aucun enregistrement fourni. La PLOMBERIE est validée ;",
    );
    console.log(
      "        | la qualité de reconnaissance d'« Alexa » ne l'est PAS.",
    );
    console.log(
      "        | Pour la mesurer : node scripts/eval-reveil-pipeline.mjs alexa.onnx voix.wav",
    );
  }

  console.log(
    `\nVERDICT PIPELINE : ${rouges === 0 ? "VERT" : `ROUGE — ${rouges} contrôle(s)`} (${verts} vert(s))`,
  );
  process.exit(rouges === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("ÉCHEC INSTRUMENT :", e);
  process.exit(2);
});
