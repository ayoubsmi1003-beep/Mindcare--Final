import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";

/**
 * Immutable speech assets. The runtime never downloads a model: the packaged
 * installer carries these files, and a build-time preparation script fills
 * them from the recorded source. The hashes are the contract.
 */
export interface ModeleVocal {
  readonly id: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly source: string;
  readonly revision: string;
  readonly license: string;
}

export const MODELES_VOIX = {
  stt: {
    id: "whisper-large-v3-turbo-q5_0",
    file: "ggml-large-v3-turbo-q5_0.bin",
    bytes: 574_041_195,
    sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2",
    source: "https://huggingface.co/ggerganov/whisper.cpp",
    revision: "5359861c739e955e79d9a303bcbc70fb988958b1",
    license: "MIT",
  },
  ttsModel: {
    id: "kokoro-82m-v1.0",
    file: "kokoro-v1.0.fp16.onnx",
    bytes: 163_527_961,
    sha256: "f3a290d384fbb27966d462905c71a46cef9e5fd00516b40df32a0b4afe77ac96",
    source: "https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1",
    revision: "model-files-v1.1",
    license: "Apache-2.0 (weights), MIT (ONNX export)",
  },
  ttsVoices: {
    id: "kokoro-v1.0-voices",
    file: "voices-v1.0.bin",
    bytes: 28_214_398,
    sha256: "bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d",
    source: "https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1",
    revision: "model-files-v1.1",
    license: "CC-BY 4.0 (ff_siwis), Apache-2.0 (model)",
  },
  wake: {
    id: "vosk-fr-FR-small",
    file: "vosk-model-small-fr-0.22",
    bytes: 0,
    sha256: "",
    source: "https://alphacephei.com/vosk/models/vosk-model-small-fr-0.22.zip",
    revision: "vosk-model-small-fr-0.22",
    license: "Apache-2.0",
  },
} as const satisfies Record<string, ModeleVocal>;

export type NomModeleVocal = keyof typeof MODELES_VOIX;

async function empreinte(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

/**
 * Verify one immutable model file before the worker is allowed to load it.
 * Size is checked first so a truncated local copy fails quickly; the hash is
 * the authority. A missing or changed file is a configuration failure, never
 * a reason to download or fall back.
 */
export async function verifierFichierModele(
  path: string,
  modele: Pick<ModeleVocal, "bytes" | "sha256" | "id">,
): Promise<void> {
  try {
    const taille = (await stat(path)).size;
    if (taille !== modele.bytes) throw new Error("configuration: modele");
    if ((await empreinte(path)) !== modele.sha256) throw new Error("configuration: modele");
  } catch (cause) {
    if (cause instanceof Error && cause.message === "configuration: modele") throw cause;
    throw new Error("configuration: modele");
  }
}

/** Synchronous test seam. Production callers use the streaming verifier above. */
export function verifierFichierModeleSync(
  path: string,
  modele: Pick<ModeleVocal, "bytes" | "sha256" | "id">,
  contenu: Buffer,
): void {
  if (basename(path).length === 0 || contenu.length !== modele.bytes) throw new Error("configuration: modele");
  if (createHash("sha256").update(contenu).digest("hex") !== modele.sha256) throw new Error("configuration: modele");
}
