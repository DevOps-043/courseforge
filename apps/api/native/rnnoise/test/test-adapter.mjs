import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const adapterDirectory = resolve(testDirectory, "..");
const compiler = process.env.CC || "cc";
const workspace = mkdtempSync(join(tmpdir(), "courseforge-rnnoise-adapter-"));

try {
  const executable = join(workspace, "rnnoise-pcm");
  const build = spawnSync(compiler, [
    "-std=c11", "-Wall", "-Wextra", "-Werror", "-pedantic",
    `-I${join(testDirectory, "mock")}`,
    join(adapterDirectory, "rnnoise-pcm.c"),
    join(testDirectory, "mock", "rnnoise-mock.c"),
    "-lm", "-o", executable,
  ], { encoding: "utf8" });
  if (build.error) throw build.error;
  assert.equal(build.status, 0, build.stderr);

  const model = join(workspace, "mock-model.bin");
  writeFileSync(model, "mock");

  for (const sampleCount of [1, 479, 480, 481, 960, 961]) {
    const input = join(workspace, `input-${sampleCount}.pcm`);
    const output = join(workspace, `output-${sampleCount}.pcm`);
    const samples = Buffer.alloc(sampleCount * 2);
    for (let index = 0; index < sampleCount; index++) {
      samples.writeInt16LE(index % 2 === 0 ? 32767 - (index % 128) : -32768 + (index % 128), index * 2);
    }
    writeFileSync(input, samples);
    const run = spawnSync(executable, [model, input, output], { encoding: "utf8" });
    assert.equal(run.status, 0, `samples=${sampleCount}: ${run.stderr}`);
    assert.deepEqual(readFileSync(output), samples, `samples=${sampleCount}`);
  }

  for (const [name, bytes] of [
    ["empty", Buffer.alloc(0)],
    ["odd", Buffer.from([1, 2, 3])],
  ]) {
    const input = join(workspace, `${name}.pcm`);
    const output = join(workspace, `${name}-output.pcm`);
    writeFileSync(input, bytes);
    const run = spawnSync(executable, [model, input, output], { encoding: "utf8" });
    assert.equal(run.status, 3, name);
    assert.equal(existsSync(output), false, name);
  }

  const input = join(workspace, "missing-model-input.pcm");
  writeFileSync(input, Buffer.from([0, 0]));
  const missingModel = spawnSync(executable, [join(workspace, "missing.bin"), input, join(workspace, "missing-output.pcm")]);
  assert.equal(missingModel.status, 4);
  const samePath = spawnSync(executable, [model, input, input]);
  assert.equal(samePath.status, 2);
  assert.deepEqual(readFileSync(input), Buffer.from([0, 0]));

  process.stdout.write("RNNoise PCM adapter tests passed (mock inference; no model weights).\n");
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
