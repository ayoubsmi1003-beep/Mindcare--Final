import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stageKnowledgeAssets, verifyKnowledgeAssets } from "../../scripts/lib/stage-knowledge-assets.mjs";

describe("packaged knowledge models", () => {
  let dir = "";
  afterEach(async () => { if (dir) await rm(dir, { recursive: true, force: true }); });
  it("copies the pinned models and rejects altered weights", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "mindcare-model-"));
    const cache = path.join(dir, "cache"), dest = path.join(dir, "dest");
    const slug = "fixture-model", recipe = "recette-fixture.json";
    await mkdir(path.join(cache, slug), { recursive: true });
    await mkdir(path.join(dir, "knowledge"));
    const model = "fixture", tokenizer = "{}", sha = (s: string) => createHash("sha256").update(s).digest("hex");
    await writeFile(path.join(cache, slug, "model.onnx"), model);
    await writeFile(path.join(cache, slug, "tokenizer.json"), tokenizer);
    await writeFile(path.join(cache, slug, "tokenizer_config.json"), "{}");
    await writeFile(path.join(dir, "knowledge", recipe), JSON.stringify({ artifact_sha256: { model_onnx: sha(model), tokenizer_json: sha(tokenizer) } }));
    expect(await stageKnowledgeAssets(dir, cache, dest, [{ slug, recipe }])).toBe(1);
    expect(await verifyKnowledgeAssets(dir, dest, [{ slug, recipe }])).toBe(1);
    expect(await readFile(path.join(dest, "resources", "models", slug, "model.onnx"), "utf8")).toBe(model);
    await writeFile(path.join(cache, slug, "model.onnx"), "changed");
    await expect(stageKnowledgeAssets(dir, cache, path.join(dir, "bad"), [{ slug, recipe }])).rejects.toThrow("KNOWLEDGE_ASSET_HASH_MISMATCH");
    await writeFile(path.join(dest, "resources", "models", slug, "model.onnx"), "changed");
    await expect(verifyKnowledgeAssets(dir, dest, [{ slug, recipe }])).rejects.toThrow("KNOWLEDGE_ASSET_HASH_MISMATCH");
  });
});
