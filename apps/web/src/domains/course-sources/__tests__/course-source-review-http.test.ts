import assert from "node:assert/strict";
import test from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { CourseSourceError } from "../course-source-error";
import * as contract from "../../../lib/server/api-contract";
import * as responses from "../../../lib/server/api-response";
import { sourceReviewCommandSchema } from "../course-source-review.schema";
import { COURSE_SOURCE_LIMITS } from "../course-source-policy";
const id = "10000000-0000-4000-8000-000000000001";
function fixture(role = "CONSTRUCTOR", denied?: number) {
  const effects: string[] = [];
  const route = load<{
    POST: (
      request: Request,
      context: { params: Promise<{ artifactId: string }> },
    ) => Promise<Response>;
  }>("src/app/api/artifacts/[artifactId]/sources/review/route.ts", {
    "@/domains/course-sources/course-source-access": {
      requireCourseSourceAccess: async () => {
        if (denied) throw new CourseSourceError(denied, "No autorizado.");
        return {
          tenant: { userId: id, organizationId: id, platformRole: role },
          admin: {},
        };
      },
    },
    "@/domains/course-sources/course-source-review.service": {
      changeSourceReview: async (
        _admin: unknown,
        artifact: string,
        organization: string,
        actor: string,
        reviewer: boolean,
      ) => {
        assert.equal(artifact, id);
        assert.equal(organization, id);
        assert.equal(actor, id);
        if (!reviewer) throw new CourseSourceError(403, "Solo revisores.");
        effects.push("approve");
        return { revision: 1 };
      },
    },
    "@/domains/course-sources/course-source-review.schema": {
      sourceReviewCommandSchema,
    },
    "@/domains/course-sources/course-source-error": { CourseSourceError },
      "@/domains/course-sources/course-source-policy": { COURSE_SOURCE_LIMITS },
    "@/lib/server/api-contract": contract,
    "@/lib/server/api-response": responses,
    "@/lib/server/authorization-unavailable-response": {
      authorizationUnavailableResponse: () => null,
    },
    "@/lib/server/operational-logger": { resolveCorrelationId: () => "prueba" },
  });
  return {
    effects,
    call: (body: object) =>
      route.POST(
        new Request("https://example.invalid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ artifactId: id }) },
      ),
  };
}
const approval = {
  action: "approve",
  expectedRevision: 1,
  curriculumHash: "a".repeat(32),
};
test("identidad y rol se derivan del servidor; el payload no puede convertirse en revisor", async () => {
  const constructor = fixture();
  assert.equal((await constructor.call(approval)).status, 403);
  assert.deepEqual(constructor.effects, []);
  const forged = fixture();
  assert.equal(
    (await forged.call({ ...approval, reviewer: true })).status,
    400,
  );
  assert.deepEqual(forged.effects, []);
  const reviewer = fixture("ARQUITECTO");
  assert.equal((await reviewer.call(approval)).status, 200);
  assert.deepEqual(reviewer.effects, ["approve"]);
});
test("sesión ausente y curso ajeno no ejecutan revisión", async () => {
  for (const status of [401, 404]) {
    const f = fixture("ADMIN", status);
    assert.equal((await f.call(approval)).status, status);
    assert.deepEqual(f.effects, []);
  }
});
