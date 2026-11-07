#!/usr/bin/env node
// Fetches the memory recall model (MEM-13): all-MiniLM-L6-v2, int8 ONNX, Apache-2.0, from the pinned Hugging Face
// revision, and checks its sha256. The model is not in git (23 MB); vocab.txt beside it is. Usage:
//   node scripts/tessaya/fetch-memory-model.mjs [destination folder]   (default: apps/server/resources/memory-model)
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } = NodeFS;
const { dirname, join, resolve } = NodePath;

const REVISION = "751bff37182d3f1213fa05d7196b954e230abad9";
const URL_ = `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/${REVISION}/onnx/model_quantized.onnx`;
const SHA256 = "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1";

const root = resolve(dirname(NodeURL.fileURLToPath(import.meta.url)), "../..");
const dir = resolve(process.argv[2] ?? join(root, "apps/server/resources/memory-model"));
const target = join(dir, "model_quantized.onnx");
const sha = (bytes) => NodeCrypto.createHash("sha256").update(bytes).digest("hex");

if (existsSync(target) && sha(readFileSync(target)) === SHA256) {
  console.log(`memory model already at ${target}`);
  process.exit(0);
}
mkdirSync(dir, { recursive: true });
const response = await fetch(URL_, { redirect: "follow" });
if (!response.ok) throw new Error(`memory model download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
const got = sha(bytes);
if (got !== SHA256) throw new Error(`memory model sha256 is ${got}, expected ${SHA256}`);
writeFileSync(`${target}.part`, bytes);
renameSync(`${target}.part`, target);
if (!existsSync(join(dir, "vocab.txt"))) {
  writeFileSync(
    join(dir, "vocab.txt"),
    readFileSync(join(root, "apps/server/resources/memory-model/vocab.txt")),
  );
}
console.log(`memory model at ${target} (${bytes.length} bytes, sha256 ok)`);
