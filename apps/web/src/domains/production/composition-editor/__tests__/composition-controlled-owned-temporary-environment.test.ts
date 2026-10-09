import assert from "node:assert/strict";
import test from "node:test";
import {resolve} from "node:path";
import {createControlledProcessEnvironment} from "../qa/composition-controlled-process-environment";

test("owned environment replaces every temporary alias and never forwards secrets", () => {
  const source = {TEMP: "supervisor-temp", TMP: "shared-temp", TMPDIR: "another-temp", Temp: "case-temp",
    PATH: "system-path", SystemRoot: "system-root", SUPABASE_SERVICE_ROLE_KEY: "fixture-secret"};
  const directory = resolve("apps/web/.tmp/owned-operation");
  const environment = createControlledProcessEnvironment(source, directory);
  for (const name of ["TEMP", "TMP", "TMPDIR"]) assert.equal(environment[name], directory);
  assert.equal(environment.Temp, undefined);
  assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(environment.PATH, source.PATH);
  assert.equal(source.TEMP, "supervisor-temp");
});
test("invalid owned temp never falls back to supervisor temp", () => {
  for (const directory of ["relative-temp", "", "\\\\server\\share", resolve("apps/web/.tmp") + "\0"])
    assert.throws(() => createControlledProcessEnvironment({TEMP: "shared"}, directory), /TEMP_DIRECTORY_INVALID/);
});
