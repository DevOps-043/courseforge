import {spawn} from "node:child_process";
import {open, writeFile, lstat} from "node:fs/promises";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createRequire} from "node:module";
const require = createRequire(new URL("../../package.json", import.meta.url));
const compiled = "./dist/composition-worker/domains/production/composition-editor/qa/";
const {OWNED_MEASUREMENT_POLICY: policy, ownedMeasurementRequestSchema, ownedMeasurementReceiptSchema,
  decodeOwnedMeasurementReference} = require(`${compiled}composition-owned-measurement-contract.js`);
const {pinConformanceFile, assertConformanceFileUnchanged} = require(`${compiled}composition-conformance-file-integrity.js`);
const {createControlledProcessEnvironment} = require(`${compiled}composition-controlled-process-environment.js`);
const {readOwnedMeasurementFile} = require(`${compiled}composition-owned-measurement-files.js`);

async function readRequest(reference) {
  if (reference.path !== join(dirname(reference.path), policy.requestFile)) throw new Error();
  const {bytes, pin} = await readOwnedMeasurementFile(reference.path, policy.maximumRequestBytes);
  if (pin.sha256 !== reference.sha256 || pin.sizeBytes !== reference.sizeBytes) throw new Error();
  return {request: ownedMeasurementRequestSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes))), pin};
}

/** Launched only as a root inside OwnedRenderJob; does not create a sandbox or claim tree closure. */
export async function runOwnedMeasurement(encodedReference, ports = {}) {
  let child, closed, timer, stdout, stderr;
  let drains = [];
  const stop = () => {
    try {child?.kill("SIGKILL");} catch { /* Enclosing job still owns descendants. */ }
    child?.stdout.destroy(new Error("CONTROLLED_RENDER_MEASUREMENT_FAILED"));
    child?.stderr.destroy(new Error("CONTROLLED_RENDER_MEASUREMENT_FAILED"));
  };
  const signal = ports.signal;
  signal?.addEventListener("abort", stop, {once: true});
  try {
    signal?.throwIfAborted();
    const reference = decodeOwnedMeasurementReference(encodedReference);
    const {request, pin: requestPin} = await readRequest(reference);
    signal?.throwIfAborted();
    const directory = dirname(reference.path);
    const binaryPin = await pinConformanceFile(request.binary, 1024 ** 3);
    signal?.throwIfAborted();
    if (binaryPin.sha256 !== request.binarySha256) throw new Error();
    if ((await lstat(request.binary)).nlink !== 1) throw new Error();
    stdout = await open(join(directory, policy.stdoutFile), "wx", 0o600);
    stderr = await open(join(directory, policy.stderrFile), "wx", 0o600);
    signal?.throwIfAborted();
    child = (ports.spawn ?? spawn)(request.binary, request.arguments,
      {cwd: directory, env: createControlledProcessEnvironment(process.env, directory), shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]});
    let spawnFailed = false;
    closed = new Promise(resolveClose => {
      child.once("error", () => {spawnFailed = true; stop();});
      child.once("close", code => resolveClose({code, spawnFailed}));
    });
    let expired = false;
    timer = setTimeout(() => {expired = true; stop();}, request.timeoutMilliseconds);
    const spool = async (stream, handle, maximumBytes) => {
      let count = 0;
      for await (const chunk of stream) {
        if (!Buffer.isBuffer(chunk)) throw new Error();
        count += chunk.length;
        if (count > maximumBytes || expired) throw new Error();
        signal?.throwIfAborted();
        let offset = 0;
        while (offset < chunk.length) {
          const written = await handle.write(chunk, offset, chunk.length - offset);
          if (written.bytesWritten <= 0) throw new Error();
          offset += written.bytesWritten;
        }
      }
      await handle.sync();
    };
    drains = [spool(child.stdout, stdout, request.maximumStdoutBytes),
      spool(child.stderr, stderr, request.maximumStderrBytes)];
    await Promise.all([...drains, closed.then(result => {
        if (result.code !== 0 || result.spawnFailed || expired) throw new Error();
      })]);
    await stdout.close(); stdout = undefined; await stderr.close(); stderr = undefined;
    const [outPin, errPin] = await Promise.all([
      pinConformanceFile(join(directory, policy.stdoutFile), request.maximumStdoutBytes, true),
      pinConformanceFile(join(directory, policy.stderrFile), request.maximumStderrBytes, true),
    ]);
    await assertConformanceFileUnchanged(request.binary, binaryPin, 1024 ** 3);
    await assertConformanceFileUnchanged(reference.path, requestPin, policy.maximumRequestBytes);
    signal?.throwIfAborted(); if (expired) throw new Error();
    const digest = pin => ({sha256: pin.sha256, sizeBytes: pin.sizeBytes});
    const receipt = ownedMeasurementReceiptSchema.parse({policy: policy.id, executionId: request.executionId,
      operationId: request.operationId, requestSha256: requestPin.sha256,
      scope: "LOCAL_PROCESS_OUTPUT_NOT_CONFORMANCE_OR_ATTESTATION", stdout: digest(outPin), stderr: digest(errPin)});
    await writeFile(join(directory, policy.receiptFile), JSON.stringify(receipt), {flag: "wx", mode: 0o600});
    signal?.throwIfAborted(); if (expired) throw new Error();
    return receipt;
  } catch {
    stop();
    await Promise.allSettled([...drains, ...(closed ? [closed] : [])]);
    throw new Error("CONTROLLED_RENDER_MEASUREMENT_FAILED");
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
    await stdout?.close(); await stderr?.close();
    // Do not delete work files. Only the outer owner can confirm that descendants stopped.
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4 || process.argv[2] !== "--measurement-request") process.exitCode = 1;
  else await runOwnedMeasurement(process.argv[3]).catch(() => {process.exitCode = 1;});
}
