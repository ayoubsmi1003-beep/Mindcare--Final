import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";

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

/** One file inside a multi-file model directory. */
export interface ModeleFichier {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** A model distributed as a directory of pinned files (CTranslate2 layout). */
export interface ModeleDossier {
  readonly id: string;
  readonly dir: string;
  readonly files: readonly ModeleFichier[];
  readonly source: string;
  readonly revision: string;
  readonly license: string;
}

export const MODELES_VOIX = {
  stt: {
    id: "faster-whisper-small-int8",
    dir: "faster-whisper-small",
    files: [
      { path: "config.json", bytes: 2_370, sha256: "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828" },
      { path: "model.bin", bytes: 483_546_902, sha256: "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671" },
      { path: "tokenizer.json", bytes: 2_203_239, sha256: "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab" },
      { path: "vocabulary.txt", bytes: 459_861, sha256: "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913" },
    ],
    source: "https://huggingface.co/Systran/faster-whisper-small",
    revision: "536b0662742c02347bc0e980a01041f333bce120",
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
} as const satisfies Record<string, ModeleVocal | ModeleDossier>;

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

/**
 * Verify a multi-file model directory before the worker loads it. Every pinned
 * relative path must stay inside the directory: traversal, absolute paths and
 * empty segments are configuration failures, never a reason to read elsewhere.
 * Size is checked before the hash, and any mismatch fails closed.
 */
export async function verifierDossierModele(path: string, modele: ModeleDossier): Promise<void> {
  try {
    for (const fichier of modele.files) {
      const relatif = fichier.path.replaceAll("\\", "/");
      const segments = relatif.split("/");
      if (
        relatif.length === 0 ||
        isAbsolute(relatif) ||
        /^[a-zA-Z]:/u.test(relatif) ||
        segments.some((segment) => segment === "" || segment === "." || segment === "..")
      ) {
        throw new Error("configuration: modele");
      }
      const complet = join(path, ...segments);
      if ((await stat(complet)).size !== fichier.bytes) throw new Error("configuration: modele");
      if ((await empreinte(complet)) !== fichier.sha256) throw new Error("configuration: modele");
    }
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
