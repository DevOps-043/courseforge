import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

test("privileged Netlify handlers verify the internal signed envelope", () => {
  const functionsDir = join(process.cwd(), "netlify", "functions");
  const unguarded = readdirSync(functionsDir)
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => {
      const source = readFileSync(join(functionsDir, name), "utf8");
      const isPrivileged =
        source.includes("createServiceRoleClient") ||
        source.includes("getSupabaseServiceKey");
      return isPrivileged && !source.includes("parseVerifiedBackgroundBody");
    });

  assert.deepEqual(
    unguarded,
    [],
    `Privileged handlers without a signed-envelope guard: ${unguarded.join(", ")}`,
  );
});

test("application code does not replace the complete material assets document", () => {
  const sourceRoot = join(process.cwd(), "src");
  const sourceFiles: string[] = [];
  const visit = (directory: string) => {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) {
        if (name !== ".tmp") visit(path);
      } else if (/\.(?:ts|tsx)$/.test(name)) {
        sourceFiles.push(path);
      }
    }
  };
  visit(sourceRoot);

  const offenders = sourceFiles.filter((path) =>
    /\.update\(\s*\{\s*assets\s*:/.test(readFileSync(path, "utf8")),
  );
  assert.deepEqual(
    offenders,
    [],
    `Full assets replacements bypass the atomic RPC: ${offenders.join(", ")}`,
  );
});

test("the legacy Express application cannot expose mock authentication", () => {
  const legacyApiRoot = resolve(process.cwd(), "..", "api", "src");
  const serverSource = readFileSync(join(legacyApiRoot, "server.ts"), "utf8");
  const authServiceSource = readFileSync(
    join(legacyApiRoot, "features", "auth", "auth.service.ts"),
    "utf8",
  );

  assert.doesNotMatch(serverSource, /app\.use\([^\n]*authRoutes/);
  assert.doesNotMatch(authServiceSource, /mock-jwt-token|password\s*===?\s*["']123456["']/);
  assert.match(authServiceSource, /Legacy authentication is disabled/);
});
