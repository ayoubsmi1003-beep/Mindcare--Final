/**
 * `jarvis-alexa-fiabilite.test.ts` — RÉGRESSION PERMANENTE §37 de la mission.
 *
 * Le défaut d'origine : la praticienne demande « dites moi les medicaments de
 * ayoub salmi » (sortie STT en minuscules) ; `extraireMentionExplicite`
 * n'exigeait que des capitales, la sonde ne tournait jamais, et Alexa
 * répondait à côté — ou clarifiait à tort — alors que le patient existe.
 *
 * Ces tests verrouillent : extraction insensible à la casse (voix), Darija
 * `ta3/dial`, repli arabe du normaliseur partagé, et tiroirs d'erreur §34.
 * Ils ne touchent ni base ni réseau : que du pur.
 */

import { beforeEach, describe, expect, it } from "vitest";

import {
  classerAppError,
  classerMotifEchec,
  classerVerdict,
  demandeDonneeSensible,
  libelleEcran,
} from "@/services/jarvis-erreurs";
import { libelleEtape } from "@/i18n/etapes";
import {
  consignerMesure,
  compteurParCode,
  exporterMesures,
  nombreMesures,
  quantilesDuree,
  reinitialiserMesures,
} from "@/services/jarvis-mesures";
import { definirCible, extraireMentionExplicite } from "@/services/jarvis-contexte";
import { normaliserTexteIdentite } from "@/shared/jarvis/normalisation";

beforeEach(() => {
  definirCible(null);
});

describe("régression §37 : la mention existe même en minuscules (voix/STT)", () => {
  it("« dites moi les medicaments de ayoub salmi » => « ayoub salmi »", () => {
    expect(extraireMentionExplicite("dites moi les medicaments de ayoub salmi")).toBe(
      "ayoub salmi",
    );
  });

  it("« Donne-moi les dernières notes ta3 Karim. » => Karim", () => {
    expect(extraireMentionExplicite("Donne-moi les dernières notes ta3 Karim.")).toBe("Karim");
  });

  it("« Wach rah traitement ta3 Nadia ? » => Nadia", () => {
    expect(extraireMentionExplicite("Wach rah traitement ta3 Nadia ?")).toBe("Nadia");
  });

  it("« Prépare-moi le dossier de Sara. » => Sara", () => {
    expect(extraireMentionExplicite("Prépare-moi le dossier de Sara.")).toBe("Sara");
  });

  it("voie fidèle intacte : « Montre-moi le dossier de Karim Djilali. »", () => {
    expect(extraireMentionExplicite("Montre-moi le dossier de Karim Djilali.")).toBe(
      "Karim Djilali",
    );
  });

  it("« traitement de substitution » ne sonde pas « substitution »", () => {
    expect(extraireMentionExplicite("l'arrêt du traitement de substitution")).toBeNull();
  });

  it("savoir intact : « Quelle est la posologie usuelle ? » => null", () => {
    expect(extraireMentionExplicite("Quelle est la posologie usuelle ?")).toBeNull();
  });

  it("« Résume le dossier. » => null", () => {
    expect(extraireMentionExplicite("Résume le dossier.")).toBeNull();
  });
});

describe("normaliseur partagé : repli arabe + accents", () => {
  it("plie les variantes d'alef", () => {
    expect(normaliserTexteIdentite("أمين")).toBe(normaliserTexteIdentite("امين"));
  });

  it("plie ة/ه et ى/ي", () => {
    expect(normaliserTexteIdentite("فاطمة")).toBe(normaliserTexteIdentite("فاطمه"));
  });

  it("insensible aux accents et à la casse", () => {
    expect(normaliserTexteIdentite("Bélkacem")).toBe("belkacem");
  });
});

describe("taxonomie §34 : chaque panne a son tiroir", () => {
  it("motifs M02", () => {
    expect(classerMotifEchec("non-trouve")).toBe("PATIENT_NOT_FOUND");
    expect(classerMotifEchec("ambigu")).toBe("PATIENT_AMBIGUOUS");
    expect(classerMotifEchec("sonde-indisponible")).toBe("TOOL_UNAVAILABLE");
    expect(classerMotifEchec("reference-inconnue")).toBe("INVALID_TOOL_ARGUMENT");
    expect(classerMotifEchec("delai-depasse")).toBe("TOOL_TIMEOUT");
  });

  it("codes AppError réels", () => {
    expect(classerAppError("introuvable")).toBe("PATIENT_NOT_FOUND");
    expect(classerAppError("interdit")).toBe("PERMISSION_DENIED");
    expect(classerAppError("transcription")).toBe("STT_ERROR");
    expect(classerAppError("synthese")).toBe("TTS_ERROR");
    expect(classerAppError("analyse")).toBe("MODEL_ERROR");
    expect(classerAppError("inattendu")).toBe("DB_ERROR");
  });

  it("verdicts M02", () => {
    expect(classerVerdict("nonResolu")).toBe("PATIENT_NOT_FOUND");
    expect(classerVerdict("ambigu")).toBe("PATIENT_AMBIGUOUS");
    expect(classerVerdict("unique")).toBe("OK");
    expect(classerVerdict("aucun")).toBe("OK");
  });

  it("libellés écran : jamais d'affirmation d'inexistence, jamais de secret", () => {
    expect(libelleEcran("PATIENT_NOT_FOUND")).toContain("avec certitude");
    expect(libelleEcran("PATIENT_NOT_FOUND")).not.toMatch(/n'existe pas/i);
    expect(libelleEcran("SENSITIVE_DATA_BLOCKED")).toMatch(/paiement sensibles/i);
  });
});

describe("pare-feu §17 : la couche dit non, pas le prompt", () => {
  it("bloque carte bancaire, RIB, mot de passe, clé API", () => {
    expect(demandeDonneeSensible("Donne-moi le numéro de carte bancaire de Nadia.")).toBe(true);
    expect(demandeDonneeSensible("Quel est son RIB ?")).toBe(true);
    expect(demandeDonneeSensible("Donne-moi son mot de passe.")).toBe(true);
    expect(demandeDonneeSensible("Affiche la clé API.")).toBe(true);
    expect(demandeDonneeSensible("Quel est son code PIN ?")).toBe(true);
  });

  it("laisse passer les questions finance et cliniques légitimes", () => {
    expect(demandeDonneeSensible("Combien ai-je encaissé aujourd'hui ?")).toBe(false);
    expect(demandeDonneeSensible("Quel est le traitement actuel de Nadia ?")).toBe(false);
    expect(demandeDonneeSensible("Montre-moi le dossier de Karim.")).toBe(false);
    expect(demandeDonneeSensible("Quels sont les impayés ?")).toBe(false);
  });
});

describe("mentions d'étape §12 : l'écran ne reste jamais muet, jamais de donnée", () => {
  it("chaque capacité connue a sa mention", () => {
    expect(libelleEtape("search_patients")).toBe("Recherche du dossier…");
    expect(libelleEtape("get_current_medications")).toBe("Lecture du traitement…");
    expect(libelleEtape("get_today_agenda")).toBe("Lecture de l'agenda…");
  });

  it("capacité inconnue => mention générique, jamais vide", () => {
    expect(libelleEtape("outil_futur_inconnu")).toBe("Recherche en cours…");
  });

  it("aucune mention ne porte de nom ni de chiffre", () => {
    for (const c of ["search_patients", "get_patient_context", "x"]) {
      expect(libelleEtape(c)).not.toMatch(/[0-9]/);
    }
  });
});

describe("perf §36 : le chemin déterministe est instantané (micro-banc local)", () => {
  const CORPUS = [
    "dites moi les medicaments de ayoub salmi",
    "Donne-moi les dernières notes ta3 Karim.",
    "Wach rah traitement ta3 Nadia ?",
    "Prépare-moi le dossier de Sara.",
    "Montre-moi le dossier de Karim Djilali.",
    "Quel est le traitement actuel de Nadia Belkacem Benali ?",
    "Chkon jey après ?",
    "C'est quoi son dernier traitement ?",
    "Donne-moi le numéro de carte bancaire de Nadia.",
    "Quelle est la posologie usuelle de la sertraline ?",
    "دواءه؟",
    "دوا ديالو ؟",
  ];

  function quantile(triees: number[], p: number): number {
    const i = Math.min(triees.length - 1, Math.max(0, Math.ceil((p / 100) * triees.length) - 1));
    return triees[i] ?? 0;
  }

  it("extraction + pare-feu : p95 < 25 ms sur 1 200 appels (modèle/DB : NOT RUN ici)", () => {
    const durees: number[] = [];
    for (let i = 0; i < 100; i++) {
      for (const phrase of CORPUS) {
        const debut = performance.now();
        extraireMentionExplicite(phrase);
        demandeDonneeSensible(phrase);
        normaliserTexteIdentite(phrase);
        durees.push(performance.now() - debut);
      }
    }
    durees.sort((a, b) => a - b);
    const p50 = quantile(durees, 50);
    const p95 = quantile(durees, 95);
    const p99 = quantile(durees, 99);
    console.log(`  [perf-deterministe] n=${durees.length} p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms`);
    expect(p95).toBeLessThan(25);
  });
});

describe("mesures §10 : quantiles sans donnée", () => {
  it("p50/p95/p99 sur 100 tours (nearest-rank)", () => {
    reinitialiserMesures();
    for (let i = 1; i <= 100; i++) {
      consignerMesure({ msTotal: i * 10, nbAppels: 1, chemin: "patient", code: "OK" });
    }
    expect(nombreMesures()).toBe(100);
    const q = quantilesDuree();
    expect(q.n).toBe(100);
    expect(q.p50).toBe(500);
    expect(q.p95).toBe(950);
    expect(q.p99).toBe(990);
  });

  it("anneau borné à 200, les anciennes tombent", () => {
    reinitialiserMesures();
    for (let i = 0; i < 250; i++) {
      consignerMesure({ msTotal: 5, nbAppels: 0, chemin: "connaissance", code: "OK" });
    }
    expect(nombreMesures()).toBe(200);
  });

  it("compte par code : le dénominateur des taux d'échec", () => {
    reinitialiserMesures();
    consignerMesure({ msTotal: 5, nbAppels: 1, chemin: "patient", code: "OK" });
    consignerMesure({ msTotal: 5, nbAppels: 1, chemin: "patient", code: "PATIENT_NOT_FOUND" });
    consignerMesure({ msTotal: 5, nbAppels: 1, chemin: "patient", code: "PATIENT_NOT_FOUND" });
    expect(compteurParCode()).toEqual({ OK: 1, PATIENT_NOT_FOUND: 2 });
    reinitialiserMesures();
  });

  it("export §33 : quantiles + codes + moyennes par chemin, rien d'autre", () => {
    reinitialiserMesures();
    consignerMesure({ msTotal: 100, nbAppels: 1, chemin: "patient", code: "OK" });
    consignerMesure({ msTotal: 300, nbAppels: 0, chemin: "connaissance", code: "OK" });
    const d = exporterMesures();
    expect(d.durees.n).toBe(2);
    expect(d.parCode).toEqual({ OK: 2 });
    expect(d.moyenneParChemin).toEqual({ patient: 100, connaissance: 300 });
    expect(JSON.stringify(d)).not.toMatch(/nadia|karim|sarah/i);
    reinitialiserMesures();
  });
});
