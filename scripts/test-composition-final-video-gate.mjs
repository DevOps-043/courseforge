import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseFinalVideoGateArguments, runFinalVideoGate } from "./composition-final-video-gate.mjs";

const identifier = "12345678-1234-4234-8234-123456789abc";
const content = Buffer.from("controlled local video fixture");
const integrity = {
  status: "MATCH", assetId: identifier, checksum: createHash("sha256").update(content).digest("hex"),
  documentHash: "a".repeat(64), sizeBytes: content.length,
};
const comparison = {
  reportVersion: 2, status: "PASS", video: { sha256: integrity.checksum, sizeBytes: content.length },
  documentHash: integrity.documentHash,
  visual: { status: "PASS" },
};

async function withFixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "final-gate-test-"));
  const options = {
    organization: identifier, request: identifier, video: join(directory, "source.mp4"),
    contract: join(directory, "contract.json"), "preview-dir": directory,
    "preview-metadata": join(directory, "metadata.json"), output: join(directory, "report.json"),
  };
  await writeFile(options.video, content);
  try { await run(options); }
  finally {
    await rm(options.video, { force: true });
    await rm(options.output, { force: true });
    await rmdir(directory);
  }
}

test("argument parser rejects missing, duplicate, unknown, invalid identifiers and unapproved policies", () => {
  const values = ["--organization", identifier, "--request", identifier, "--contract", "contract",
    "--preview-dir", "preview", "--preview-metadata", "metadata", "--video", "video", "--output", "report"];
  assert.equal(parseFinalVideoGateArguments(values).request, identifier);
  for (const invalid of [values.slice(0, -2), [...values, "--video", "other"], [...values, "--shell", "cmd"],
    [...values, "--audio-policy", "unapproved"], ["--organization", "bad", ...values.slice(2)], [...values, "--audio-policy"]]) {
    assert.throws(() => parseFinalVideoGateArguments(invalid), /ARGUMENTS_INVALID/);
  }
});

test("gate generates receipt, isolates matching bytes, checks remote twice and preserves explicit limitations", async () => {
  await withFixture(async (options) => {
    const calls = [];
    let snapshotPath;
    const report = await runFinalVideoGate(options, {
      checkIntegrity: async (organization, request) => {
        assert.equal(organization, identifier); assert.equal(request, identifier);
        calls.push("integrity"); return { ...integrity, signedUrl: "must-not-be-persisted" };
      },
      compareVideo: async (input) => {
        calls.push("compare"); snapshotPath = input.videoPath;
        assert.notEqual(input.videoPath, options.video);
        assert.deepEqual(await readFile(input.videoPath), content);
        assert.deepEqual(JSON.parse(await readFile(input.renderReceiptPath, "utf8")),
          { documentHash: integrity.documentHash, videoSha256: integrity.checksum });
        await writeFile(options.video, "source changed after snapshot");
        assert.deepEqual(await readFile(input.videoPath), content);
        return comparison;
      },
    });
    assert.deepEqual(calls, ["integrity", "compare", "integrity"]);
    assert.equal(report.status, "PASS");
    assert.ok(report.limitations.includes("AUDIO_TIMING_NOT_VERIFIED"));
    assert.equal(report.integrity.signedUrl, undefined);
    assert.deepEqual(JSON.parse(await readFile(options.output, "utf8")), report);
    await assert.rejects(readFile(snapshotPath), { code: "ENOENT" });
  });
});

test("different local bytes or size fail before comparison with no report", async () => {
  for (const bytes of [Buffer.alloc(content.length, 1), Buffer.alloc(content.length + 1), Buffer.alloc(1)]) {
    await withFixture(async (options) => {
      await writeFile(options.video, bytes);
      await assert.rejects(runFinalVideoGate(options, {
        checkIntegrity: async () => integrity,
        compareVideo: async () => assert.fail("comparison must not run"),
      }), /LOCAL_(CONTENT|SIZE)_MISMATCH/);
      await assert.rejects(readFile(options.output), { code: "ENOENT" });
    });
  }
});

test("changed asset, revision, checksum or size after comparison fail without publishing report", async () => {
  for (const change of [{ assetId: "22345678-1234-4234-8234-123456789abc" }, { documentHash: "b".repeat(64) },
    { checksum: "b".repeat(64) }, { sizeBytes: content.length + 1 }]) {
    await withFixture(async (options) => {
      let reads = 0;
      await assert.rejects(runFinalVideoGate(options, {
        checkIntegrity: async () => ++reads === 1 ? integrity : { ...integrity, ...change },
        compareVideo: async () => comparison,
      }), /REMOTE_CHANGED/);
      await assert.rejects(readFile(options.output), { code: "ENOENT" });
    });
  }
});

test("unverified remote result and wrongly bound comparison cannot emit evidence", async () => {
  await withFixture(async (options) => {
    await assert.rejects(runFinalVideoGate(options, {
      checkIntegrity: async () => ({ ...integrity, status: "UNVERIFIED" }), compareVideo: async () => comparison,
    }), /INTEGRITY_INVALID/);
    for (const invalid of [{ ...comparison, documentHash: "b".repeat(64) },
      { ...comparison, video: { sha256: "b".repeat(64), sizeBytes: content.length } }, { ...comparison, status: "UNKNOWN" }]) {
      await assert.rejects(runFinalVideoGate(options, {
        checkIntegrity: async () => integrity, compareVideo: async () => invalid,
      }), /REPORT_BINDING_INVALID/);
    }
    await assert.rejects(readFile(options.output), { code: "ENOENT" });
  });
});

test("FAIL and INCOMPLETE remain non-passing even with valid integrity", async () => {
  for (const status of ["FAIL", "INCOMPLETE"]) await withFixture(async (options) => {
    const report = await runFinalVideoGate(options, {
      checkIntegrity: async () => integrity, compareVideo: async () => ({ ...comparison, status }),
    });
    assert.equal(report.status, status);
  });
});

test("comparison failure cleans private snapshot and never overwrites existing evidence", async () => {
  await withFixture(async (options) => {
    let snapshotPath;
    await assert.rejects(runFinalVideoGate(options, {
      checkIntegrity: async () => integrity,
      compareVideo: async (input) => { snapshotPath = input.videoPath; throw new Error("controlled comparator failure"); },
    }), /controlled comparator failure/);
    await assert.rejects(readFile(snapshotPath), { code: "ENOENT" });
    await writeFile(options.output, "existing evidence");
    await assert.rejects(runFinalVideoGate(options, {
      checkIntegrity: async () => integrity, compareVideo: async () => comparison,
    }), { code: "EEXIST" });
    assert.equal(await readFile(options.output, "utf8"), "existing evidence");
  });
});

test("audio reference options are paired, forwarded and cannot silently skip timing", async () => {
  const values = ["--organization", identifier, "--request", identifier, "--contract", "contract",
    "--preview-dir", "preview", "--preview-metadata", "metadata", "--video", "video", "--output", "report"];
  assert.throws(() => parseFinalVideoGateArguments([...values, "--audio-reference", "audio.wav"]));
  assert.equal(parseFinalVideoGateArguments([...values, "--audio-reference", "audio.wav", "--audio-reference-metadata", "audio.json"])["audio-reference"], "audio.wav");
  await withFixture(async (options) => {
    const requested = { ...options, "audio-reference": "audio.wav", "audio-reference-metadata": "audio.json" };
    await assert.rejects(runFinalVideoGate(requested, {
      checkIntegrity: async () => integrity, compareVideo: async () => comparison,
    }), /REPORT_BINDING_INVALID/);
    for (const rms of [undefined, { status: "NOT_REQUESTED" }, { status: "FAIL" }, { status: "INCOMPLETE" }]) {
      await assert.rejects(runFinalVideoGate(requested, {
        checkIntegrity: async () => integrity,
        compareVideo: async () => ({ ...comparison, audioTiming: { status: "PASS", rms } }),
      }), /REPORT_BINDING_INVALID/);
    }
    const report = await runFinalVideoGate(requested, {
      checkIntegrity: async () => integrity,
      compareVideo: async (input) => {
        assert.equal(input.audioReferencePath, "audio.wav"); assert.equal(input.audioReferenceMetadataPath, "audio.json");
        return { ...comparison, audioTiming: { status: "PASS", rms: { status: "PASS" } } };
      },
    });
    assert.ok(report.limitations.includes("AUDIO_ENVELOPE_ONLY_NOT_CONTENT_IDENTITY"));
  });
});
