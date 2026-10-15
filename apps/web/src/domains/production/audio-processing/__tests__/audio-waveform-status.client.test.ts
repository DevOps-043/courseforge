import assert from "node:assert/strict";
import test from "node:test";
import { waveformJobStatus, waveformReadFailure, waveformStatusNotices } from "../audio-waveform-status.client";

test("pending and running jobs have distinct messages even though both HTTP reads succeed", () => {
  const notices = waveformStatusNotices({ first: waveformJobStatus("PENDING"), second: waveformJobStatus("RUNNING"), third: waveformJobStatus("PENDING") });
  assert.equal(notices.length, 2);
  assert.equal(notices.find((notice) => notice.status === "WAITING_WORKER")?.count, 2);
  assert.match(notices.find((notice) => notice.status === "WAITING_WORKER")!.message, /aún no ha comenzado/);
  assert.equal(notices.find((notice) => notice.status === "ANALYZING")?.action, undefined);
});

test("polling deadline preserves the distinction between an unclaimed job and ongoing processing", () => {
  const error = new Error("WAVEFORM_WAIT_TIMEOUT");
  assert.equal(waveformReadFailure(error, "WAITING_WORKER"), "WAITING_TIMEOUT");
  assert.equal(waveformReadFailure(error, "ANALYZING"), "ANALYSIS_TIMEOUT");
  assert.equal(waveformReadFailure(error, "RETRYING"), "ANALYSIS_TIMEOUT");
  const [notice] = waveformStatusNotices({ asset: "WAITING_TIMEOUT" });
  assert.equal(notice.action, "Volver a consultar");
  assert.match(notice.message, /sigue en cola/);
});

test("only backend terminal failure is presented as processing failure", () => {
  assert.equal(waveformJobStatus("FAILED"), "ANALYSIS_FAILED");
  assert.equal(waveformJobStatus("CANCELLED"), "CANCELLED");
  assert.equal(waveformJobStatus("RETRY_SCHEDULED"), "RETRYING");
  assert.equal(waveformJobStatus("UNEXPECTED"), "REQUEST_FAILED");
  assert.equal(waveformReadFailure(new TypeError("fetch failed"), "ANALYZING"), "REQUEST_FAILED");
  assert.equal(waveformReadFailure(new DOMException("timeout", "TimeoutError"), "WAITING_WORKER"), "REQUEST_TIMEOUT");
  assert.equal(waveformReadFailure(new Error("WAVEFORM_QUEUE_FAILED"), "CHECKING"), "QUEUE_FAILED");
});

test("finished waves and sources without audio do not retain a pending or failure notice", () => {
  assert.deepEqual(waveformStatusNotices({ first: "READY", second: waveformJobStatus("NO_AUDIO") }), []);
  const [notice] = waveformStatusNotices({ asset: waveformJobStatus("FAILED") });
  assert.equal(notice.action, "Reintentar análisis");
});
