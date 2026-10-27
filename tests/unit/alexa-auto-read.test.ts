/**
 * LA LECTURE AUTOMATIQUE GLOBALE — LE PANNEAU FERMÉ N'EST PLUS UN SILENCE.
 *
 * `FilJarvis` n'est monté que dans le panneau / l'écran Jarvis. Une réponse
 * tapée alors que le panneau est fermé doit quand même être lue : le lecteur
 * vit donc dans `BootVoix`, qui dure autant que l'application.
 *
 * Ce fichier éprouve la DÉCISION pure du lecteur global (aucun DOM), puis
 * vérifie par lecture de source que le câblage est bien celui-là : lecteur
 * global dans `BootVoix`, plus d'auto-lecture dans `FilJarvis`.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { choisirActionLectureAuto } from "@/components/AlexaAutoRead";
import { choisirTourAuto } from "@/services/lecture-auto";

const BASE = { id: "t1", role: "jarvis" as const, texte: "Bonjour docteur." };
const OPTS = {
  lectureAuto: true,
  conversationChargee: true,
  etatConversation: "composition" as const,
  etatVoix: "veille" as const,
  boucleActive: false,
  captureActive: false,
  playbackBusy: false,
};

describe("le lecteur automatique global", () => {
  it("lit une nouvelle réponse Jarvis même quand le panneau du fil n'est pas monté", () => {
    const decision = choisirActionLectureAuto(
      [BASE, { ...BASE, id: "t2", texte: "Réponse arrivée panneau fermé." }],
      new Set(["t1"]),
      new Set(),
      OPTS,
    );
    expect(decision).toMatchObject({ action: "lire", tour: { id: "t2" } });
  });

  it("ne lit pas l'historique chargé ni un tour déjà lu", () => {
    expect(choisirActionLectureAuto([BASE], new Set(["t1"]), new Set(), OPTS)).toBeNull();
    expect(choisirActionLectureAuto([BASE], new Set(), new Set(["t1"]), OPTS)).toBeNull();
  });

  it("n'ouvre aucun TTS pendant une capture du réveil ou de la boucle directe", () => {
    expect(choisirActionLectureAuto([BASE], new Set(), new Set(), {
      ...OPTS,
      etatVoix: "ecoute",
      captureActive: true,
    })).toBeNull();
    expect(choisirActionLectureAuto([BASE], new Set(), new Set(), {
      ...OPTS,
      etatVoix: "parole",
      captureActive: true,
    })).toBeNull();
  });

  it("n'ouvre aucun TTS pendant une dictée de champ", () => {
    expect(choisirActionLectureAuto([BASE], new Set(), new Set(), {
      ...OPTS,
      captureActive: true,
    })).toBeNull();
  });

  it("n'ouvre aucun second TTS pendant qu'une synthèse tient déjà le haut-parleur", () => {
    expect(choisirActionLectureAuto([BASE], new Set(), new Set(), {
      ...OPTS,
      playbackBusy: true,
    })).toBeNull();
  });

  it("attend la fin du flux avant de lire une réponse encore partielle", () => {
    expect(choisirActionLectureAuto([BASE], new Set(), new Set(), {
      ...OPTS,
      etatConversation: "envoi",
    })).toBeNull();
    expect(choisirActionLectureAuto([BASE], new Set(), new Set(), {
      ...OPTS,
      etatConversation: "flux",
    })).toBeNull();
  });

  it("refuse un tour interrompu, partiel ou non terminé", () => {
    expect(choisirActionLectureAuto([{ ...BASE, interrompu: true }], new Set(), new Set(), OPTS)).toBeNull();
    for (const statut of ["partial", "needs_input", "needs_confirmation", "failed", "cancelled"] as const) {
      expect(choisirActionLectureAuto([{ ...BASE, alexaStatus: statut }], new Set(), new Set(), OPTS)).toBeNull();
    }
    expect(choisirActionLectureAuto([{ ...BASE, alexaStatus: "completed" }], new Set(), new Set(), OPTS))
      .toMatchObject({ action: "lire" });
  });

  it("lit une réponse de plus de 2000 caractères au lieu de la taire", () => {
    const long = { ...BASE, id: "long", texte: `${"Une phrase complète. ".repeat(150)}` };
    expect(long.texte.length).toBeGreaterThan(2_000);
    expect(choisirActionLectureAuto([long], new Set(), new Set(), OPTS))
      .toMatchObject({ action: "lire", tour: { id: "long" } });
  });

  it("marque la réponse de la boucle directe comme lue, sans la rejouer", () => {
    const decision = choisirActionLectureAuto([BASE], new Set(), new Set(), {
      ...OPTS,
      lectureAuto: false,
      etatVoix: "parole",
      boucleActive: true,
      captureActive: true,
    });
    expect(decision).toMatchObject({ action: "marquer", tour: { id: "t1" } });
  });

  it("ne marque pas un tour vide pendant que la boucle directe écoute encore", () => {
    expect(choisirActionLectureAuto([{ ...BASE, texte: "" }], new Set(), new Set(), {
      ...OPTS,
      etatVoix: "ecoute",
      boucleActive: true,
      captureActive: true,
    })).toBeNull();
  });
});

describe("le câblage du lecteur global", () => {
  const source = (chemin: string): string =>
    readFileSync(new URL(`../../${chemin}`, import.meta.url), "utf8");

  it("monte le lecteur dans BootVoix — pas dans le panneau Jarvis", () => {
    const boot = source("src/components/BootVoix.tsx");
    expect(boot).toContain("AlexaAutoRead");
    expect(boot).toMatch(/<AlexaAutoRead\s*\/>/);
  });

  it("retire l'auto-lecture de FilJarvis et garde la lecture manuelle longue", () => {
    const fil = source("src/components/FilJarvis.tsx");
    expect(fil).not.toContain("choisirTourAuto");
    expect(fil).toContain("lireTexteLong");
    expect(fil).not.toContain("lectureInterdite");
    expect(fil).toContain("abonnerCapture");
  });

  it("laisse remplacer une lecture par une autre bulle pendant un son, sans capture", () => {
    const fil = source("src/components/FilJarvis.tsx");
    // L'admission manuelle ne regarde que le micro, jamais le haut-parleur.
    expect(fil).toMatch(/if \(captureActive\(\)\) \{\s*setErreurLecture/);
    expect(fil).not.toMatch(/if \(lectureInterdite\(\)\)/);
    // Le prédicat entre morceaux reste lui aussi une garde de capture.
    expect(fil).toContain("lireTexteLong(texte, porteUneIdentite, () => captureActive())");
    // Le bouton reste visible pendant une lecture : sa visibilité ne dépend
    // que de la capture, jamais de `playbackBusy`.
    const lisible = fil.match(/const lisible = ([^;]+);/)?.[1] ?? "";
    expect(lisible).toContain("!capture");
    expect(lisible).not.toMatch(/playback|lectureInterdite/);
    expect(fil).toContain("abonnerActivite(() => setCapture(captureActive()))");
  });

  it("coupe la lecture globale quand une capture commence", () => {
    const global = source("src/components/AlexaAutoRead.tsx");
    expect(global).toContain("abonnerCapture");
    expect(global).toMatch(/abonnerCapture\(\(\) => \{[\s\S]*arreterLecture\(\)/);
    expect(global).toContain("captureActive()");
  });

  it("libère le mains-libres au démontage de BootVoix", () => {
    const boot = source("src/components/BootVoix.tsx");
    expect(boot).toContain("arreterMainsLibres");
  });
});

describe("le choix pur reste compatible", () => {
  it("choisirTourAuto continue de rendre le dernier tour Jarvis non lu", () => {
    const tours = [BASE, { ...BASE, id: "t2" }];
    expect(choisirTourAuto(tours, new Set(), new Set(), { lectureAuto: true, conversationChargee: true }))
      .toMatchObject({ id: "t2" });
  });
});
