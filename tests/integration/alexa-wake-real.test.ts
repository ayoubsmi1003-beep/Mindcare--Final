import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { resoudreCheminsVoix } from "@/server/voice/chemins";

/**
 * ⚠️ CE TEST LANCE LE VRAI WORKER VOSK. Il est donc gardé par
 * `MINDCARE_VOICE_REAL=1` : la suite par défaut ne doit pas charger le modèle
 * (ni ses ~50 Mo de RAM) pour chaque exécution.
 *
 * Les fixtures sont SYNTHÉTIQUES (voix Kokoro locale), jamais des enregistrements
 * de patientes. `alexa.wav` est la commande positive ; `bonjour.wav` vérifie
 * qu'une parole ordinaire ne réveille pas l'assistant.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const FIXTURES = join(ROOT, "tests", "fixtures", "voix");
const CHEMIN = resoudreCheminsVoix({ cwd: ROOT, env: process.env });
const BLOC = 16_000; // 500 ms de PCM16 mono à 16 kHz
const REFRACTORY_MS = 2_000;

interface Reponse {
  readonly id?: string;
  readonly ok?: boolean;
  readonly detected?: boolean;
  readonly ready?: boolean;
  readonly pong?: boolean;
  readonly code?: string;
}

class WorkerVosk {
  private readonly processus: ChildProcessWithoutNullStreams;
  private readonly attentes = new Map<string, (r: Reponse) => void>();
  private resoudrePret: (() => void) | null = null;
  private tampon = "";
  readonly pret: Promise<void>;
  readonly inattendus: Reponse[] = [];

  constructor() {
    this.processus = spawn(
      CHEMIN.python,
      ["-I", "-B", "-u", CHEMIN.wakeWorker, CHEMIN.packages, CHEMIN.assets],
      {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: {
          ...process.env,
          OMP_NUM_THREADS: "1",
          ALEXA_WAKE_MODEL: "vosk-model-small-fr-0.22",
        },
      },
    );
    this.pret = new Promise<void>((resolve) => {
      this.resoudrePret = resolve;
    });
    this.processus.stderr.resume();
    this.processus.stdout.setEncoding("utf8");
    this.processus.stdout.on("data", (fragment: string) => {
      this.tampon += fragment;
      for (;;) {
        const fin = this.tampon.indexOf("\n");
        if (fin < 0) break;
        const ligne = this.tampon.slice(0, fin);
        this.tampon = this.tampon.slice(fin + 1);
        let reponse: Reponse;
        try {
          reponse = JSON.parse(ligne) as Reponse;
        } catch {
          continue;
        }
        if (reponse.id === "ready") {
          this.resoudrePret?.();
          continue;
        }
        const attente = reponse.id === undefined ? undefined : this.attentes.get(reponse.id);
        if (attente !== undefined) {
          this.attentes.delete(reponse.id!);
          attente(reponse);
        } else {
          this.inattendus.push(reponse);
        }
      }
    });
  }

  async envoyer(action: string, extra: Record<string, unknown> = {}, delai = 20_000): Promise<Reponse> {
    const id = randomUUID();
    const reponse = new Promise<Reponse>((resolve, reject) => {
      const minuteur = setTimeout(() => {
        this.attentes.delete(id);
        reject(new Error(`timeout:${action}`));
      }, delai);
      this.attentes.set(id, (r) => {
        clearTimeout(minuteur);
        resolve(r);
      });
    });
    this.processus.stdin.write(`${JSON.stringify({ id, action, ...extra })}\n`);
    return reponse;
  }

  brut(ligne: string): void {
    this.processus.stdin.write(ligne);
  }

  vivant(): boolean {
    return this.processus.exitCode === null;
  }

  fermer(): void {
    try {
      this.processus.stdin.write(`${JSON.stringify({ id: randomUUID(), action: "stop" })}\n`);
    } catch {
      // already gone
    }
    this.processus.kill();
  }
}

function pcm16(path: string): Buffer {
  const wav = readFileSync(path);
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`WAKE FIXTURE FAIL: ${path} is not a RIFF/WAVE file`);
  }
  let offset = 12;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const taille = wav.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      const format = {
        canaux: wav.readUInt16LE(offset + 10),
        taux: wav.readUInt32LE(offset + 12),
        bits: wav.readUInt16LE(offset + 22),
      };
      expect(format, `WAKE FIXTURE FAIL: ${path} must be 16 kHz mono PCM16`).toEqual({
        canaux: 1,
        taux: 16_000,
        bits: 16,
      });
    }
    if (id === "data") return wav.subarray(offset + 8, offset + 8 + taille);
    offset += 8 + taille + (taille % 2);
  }
  throw new Error(`WAKE FIXTURE FAIL: ${path} has no data chunk`);
}

/** Returns the 1-based chunk index of the first detection, or -1. */
async function detecter(worker: WorkerVosk, pcm: Buffer, maximum = 5): Promise<number> {
  let bloc = 0;
  for (let offset = 0; offset < pcm.length && bloc < maximum; offset += BLOC) {
    bloc += 1;
    const morceau = pcm.subarray(offset, Math.min(offset + BLOC, pcm.length));
    const reponse = await worker.envoyer("audio", { pcmBase64: morceau.toString("base64") });
    expect(reponse.ok, `worker refused audio chunk ${bloc}: ${reponse.code ?? "runtime"}`).toBe(true);
    if (reponse.detected === true) return bloc;
  }
  return -1;
}

function attendre(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe.skipIf(process.env["MINDCARE_VOICE_REAL"] !== "1")("real Vosk wake worker", () => {
  let worker: WorkerVosk;

  beforeAll(async () => {
    worker = new WorkerVosk();
    await worker.pret;
  }, 120_000);

  afterAll(() => {
    worker?.fermer();
  });

  it("detects five synthetic 'Alexa' utterances across resets and stays alive", async () => {
    const alexa = pcm16(join(FIXTURES, "alexa.wav"));
    const blocs: number[] = [];
    for (let tour = 0; tour < 5; tour += 1) {
      if (tour > 0) {
        // The worker deliberately ignores a second detection inside its 2 s
        // refractory window; the test respects it instead of weakening it.
        await attendre(REFRACTORY_MS + 100);
      }
      const bloc = await detecter(worker, alexa);
      expect(
        bloc,
        `WAKE FIXTURE FAIL: alexa.wav was not detected in five 500 ms chunks on round ${tour + 1} ` +
          `(grammar '["alexa", "eh lexa", "[unk]"]')`,
      ).toBeGreaterThan(0);
      blocs.push(bloc);
      expect(await worker.envoyer("reset")).toMatchObject({ ok: true, detected: false });
    }
    expect(blocs).toHaveLength(5);
    expect(blocs.every((bloc) => bloc > 0 && bloc <= 5)).toBe(true);
    expect(worker.vivant()).toBe(true);
  }, 120_000);

  it("does not detect a generic 'Bonjour' and survives malformed JSON", async () => {
    await attendre(REFRACTORY_MS + 100);
    const bonjour = pcm16(join(FIXTURES, "bonjour.wav"));
    for (let offset = 0; offset < bonjour.length; offset += BLOC) {
      const morceau = bonjour.subarray(offset, Math.min(offset + BLOC, bonjour.length));
      const reponse = await worker.envoyer("audio", { pcmBase64: morceau.toString("base64") });
      expect(reponse).toMatchObject({ ok: true, detected: false });
    }

    worker.brut("{ceci n'est pas du json\n");
    await vi.waitFor(() => expect(worker.inattendus.length).toBeGreaterThan(0), { timeout: 5_000 });
    expect(worker.inattendus[0]).toMatchObject({ ok: false, code: "json" });

    // Still alive, and the recognizer state was not disturbed by the error.
    expect(await worker.envoyer("ping")).toMatchObject({ ok: true, pong: true });
    expect(worker.vivant()).toBe(true);
  }, 120_000);
});
