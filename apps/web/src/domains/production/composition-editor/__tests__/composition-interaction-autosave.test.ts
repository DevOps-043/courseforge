import assert from "node:assert/strict";
import test from "node:test";
import { CompositionAutosaveCoordinator, CompositionInteractionAutosave } from "../composition-interaction-autosave";
import { readCompositionPendingEdits, settleCompositionPendingEdit, writeCompositionPendingEdits, type CompositionPendingEdit } from "../composition-pending-edits";
import { CompositionSaveQueue } from "../composition-save-queue";

test("un gesto conserva sólo su último valor y no repite pointerup más blur", async () => {
  const sent: number[] = [], session = new CompositionInteractionAutosave("0");
  for (let value = 1; value <= 100; value++) session.stage(String(value), async () => { sent.push(value); return true; });
  await Promise.all([session.flush(), session.flush()]);
  assert.deepEqual(sent, [100]);
  session.stage("100", async () => { throw new Error("No debe enviar un valor ya confirmado"); });
  assert.equal(session.dirty, false);
});

test("una respuesta tardía no descarta un gesto posterior ni sustituye su callback", async () => {
  let finish!: (saved: boolean) => void;
  const session = new CompositionInteractionAutosave("inicial");
  session.stage("primero", () => new Promise<boolean>(resolve => { finish = resolve; }));
  const first = session.flush(); await Promise.resolve();
  let secondSent = false;
  session.stage("segundo", async () => { secondSent = true; return true; });
  session.observe("respuesta remota anterior");
  finish(true); await first;
  assert.equal(session.dirty, true);
  await session.flush(); assert.equal(secondSent, true); assert.equal(session.dirty, false);
});

test("un error conserva el borrador y exige recuperación explícita", async () => {
  let attempts = 0;
  const session = new CompositionInteractionAutosave("original");
  session.stage("cambio", async () => { attempts++; return false; });
  assert.equal(await session.flush(), false); assert.equal(session.state, "ERROR");
  session.stage("otro cambio", async () => { attempts++; return true; });
  assert.equal(await session.flush(), false); assert.equal(attempts, 1);
  assert.equal(await session.flush(true), true); assert.equal(attempts, 2);
});

test("un campo inválido conserva su edición y no bloquea una corrección posterior", async () => {
  const session = new CompositionInteractionAutosave("1");
  session.stage("-", () => undefined);
  assert.equal(await session.flush(), false); assert.equal(session.state, "INVALID");
  session.stage("2", () => true); assert.equal(await session.flush(), true);
});

test("el coordinador vacía los controles en orden sin recursión al persistir", async () => {
  const owner = new CompositionAutosaveCoordinator(), calls: string[] = [];
  const first = new CompositionInteractionAutosave("a"), second = new CompositionInteractionAutosave("b");
  owner.register(first); owner.register(second);
  first.stage("a2", async () => { assert.equal(await owner.flush(), true); calls.push("primero"); return true; });
  second.stage("b2", async () => { calls.push("segundo"); return true; });
  assert.equal(await owner.flush(), true); assert.deepEqual(calls, ["primero", "segundo"]); assert.equal(owner.pending, false);
});

test("cerrar un panel no descarta su borrador fallido", async () => {
  const owner = new CompositionAutosaveCoordinator(), session = new CompositionInteractionAutosave("antes");
  const close = owner.register(session);
  session.stage("después", () => false); await owner.flush(); close();
  assert.equal(owner.pending, true);
  session.stage("corregido", () => true);
  assert.equal(await owner.flush(true), true); assert.equal(owner.pending, false);
});

const draftId = "10000000-0000-4000-8000-000000000001";
const entry = (id: string): CompositionPendingEdit => ({
  id, baseHash: "a".repeat(64), createdAt: Date.now(), source: "USER", summary: "Movió un clip.",
  operations: [{ type: "clip.move", clipId: "clip-1", startSeconds: 1 }],
});
const storage = () => {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
};

test("la cola puede cancelar envíos sin perder los comandos todavía no enviados", async () => {
  const local = storage(), first = entry("20000000-0000-4000-8000-000000000001"), second = entry("20000000-0000-4000-8000-000000000002");
  writeCompositionPendingEdits(local, draftId, [first, second]);
  const sent: string[] = [], queue = new CompositionSaveQueue<CompositionPendingEdit>(async command => { sent.push(command.id); return false; });
  assert.deepEqual(await Promise.all([queue.enqueue(first), queue.enqueue(second)]), [false, false]);
  assert.deepEqual(sent, [first.id]);
  assert.deepEqual(readCompositionPendingEdits(local, draftId).map(command => command.id), [first.id, second.id]);
  settleCompositionPendingEdit(local, draftId, first.id, "b".repeat(64));
  assert.equal(readCompositionPendingEdits(local, draftId)[0]?.baseHash, "b".repeat(64));
  assert.equal(readCompositionPendingEdits(local, "10000000-0000-4000-8000-000000000002").length, 0);
});

test("la copia local valida comandos, tamaño, vigencia y fallos de almacenamiento", () => {
  const local = storage(), edit = entry("20000000-0000-4000-8000-000000000001");
  writeCompositionPendingEdits(local, draftId, [edit]);
  assert.equal(readCompositionPendingEdits(local, draftId, Date.now() + 25 * 60 * 60 * 1000).length, 0);
  assert.throws(() => writeCompositionPendingEdits({ ...local, setItem: () => { throw new Error("quota"); } }, draftId, [edit]), /quota/);
  assert.throws(() => writeCompositionPendingEdits(local, "otro tenant", [edit]));
});

test("confirmar una edición nueva no rebasa pendientes de otra base o sesión", () => {
  const local = storage(), old = entry("20000000-0000-4000-8000-000000000001"), newer = { ...entry("20000000-0000-4000-8000-000000000002"), baseHash: "b".repeat(64) };
  writeCompositionPendingEdits(local, draftId, [old, newer]);
  settleCompositionPendingEdit(local, draftId, newer.id, "c".repeat(64));
  assert.equal(readCompositionPendingEdits(local, draftId)[0]?.baseHash, old.baseHash);
});

test("una confirmación remota conocida limpia sólo su borrador y los commits se serializan", async () => {
  const owner = new CompositionAutosaveCoordinator(), first = new CompositionInteractionAutosave("a"), second = new CompositionInteractionAutosave("b");
  owner.register(first); owner.register(second);
  let active = 0, maximum = 0;
  const commit = async () => { active++; maximum = Math.max(maximum, active); await new Promise(resolve => setImmediate(resolve)); active--; return true; };
  first.stage("a2", commit); second.stage("b2", commit);
  await Promise.all([owner.commit(first), owner.commit(second)]);
  assert.equal(maximum, 1);
  first.stage("a3", () => false); await owner.commit(first);
  second.stage("b3", () => undefined);
  first.confirmPersisted(); assert.equal(first.dirty, false); assert.equal(second.dirty, true);
});
