import assert from "node:assert/strict";
import test from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {CompositionConformanceRenderReservationService} from "../qa/composition-conformance-render-reservation.service";
import {createReservedConformanceWorkerHost} from "../qa/composition-reserved-conformance-worker-host";
import {ConformanceStageFailure} from "../qa/composition-conformance-stage-failure";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const claim = {id: id(1), organization_id: id(2), request_id: id(3), revision_id: id(4), lease_token: id(5), attempts: 1};

function client(data: unknown, onRead = () => {}) {
  return {rpc: (name: string, args: Record<string, unknown>) => {
    onRead();
    assert.equal(name, "read_hyperframes_conformance_render_reservation");
    assert.deepEqual(args, {p_job_id: claim.id, p_organization_id: claim.organization_id,
      p_request_id: claim.request_id, p_revision_id: claim.revision_id, p_lease_token: claim.lease_token});
    const response = Promise.resolve({data, error: null});
    return Object.assign(response, {abortSignal: () => response});
  }} as unknown as SupabaseClient<any, any, any>;
}

test("durable reservation reader rejects absent, corrupted and malformed records", async () => {
  for (const data of [null, {}, {reservationText: "{}", sha256: "a".repeat(64)},
    {reservationText: "{}", sha256: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"}]) {
    await assert.rejects(new CompositionConformanceRenderReservationService(client(data)).read(claim));
  }
});

test("cancelled reservation read never queries the registry", async () => {
  let reads = 0;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new CompositionConformanceRenderReservationService(client(null, () => {reads++;}))
    .read(claim, controller.signal), /EXECUTION_CANCELLED/);
  assert.equal(reads, 0);
});

test("reserved host fails closed before ports, snapshot or legacy capture when reservation is unavailable", async () => {
  let ports = 0, snapshots = 0;
  const execute = createReservedConformanceWorkerHost({supabase: client(null),
    supabaseUrl: "https://project.supabase.co", ffmpegPath: "not-executed",
    resolveProcessPorts: () => {ports++; throw new Error("Unexpected port resolution");},
    integrity: {snapshot: async () => {snapshots++; throw new Error("Unexpected snapshot");},
      recheck: async () => {throw new Error("Unexpected recheck");}}});
  await assert.rejects(execute(claim, new AbortController().signal), error => error instanceof ConformanceStageFailure
    && error.stage === "RENDER_EVIDENCE_ADMISSION" && error.message === "CONFORMANCE_JOB_RESERVATION_UNAVAILABLE");
  assert.equal(ports, 0); assert.equal(snapshots, 0);
});
