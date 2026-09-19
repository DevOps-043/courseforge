import assert from "node:assert/strict";
import { test } from "node:test";
import { getModuleTitle } from "../module-title";
import { syllabusModulesSchema } from "../../syllabus-management-request.schema";

test("removes repeated legacy numbering without changing the topic", () => {
  assert.equal(
    getModuleTitle("Módulo 5: Módulo 5: Mezcla final"),
    "Mezcla final",
  );
  assert.equal(getModuleTitle(" Modulo 6 - Práctica "), "Práctica");
  assert.equal(getModuleTitle("MÓDULO 12. Accesibilidad"), "Accesibilidad");
  assert.equal(
    getModuleTitle("Módulo de audio: nivel 5"),
    "Módulo de audio: nivel 5",
  );
  assert.equal(
    getModuleTitle("Diseñar el módulo 5: práctica"),
    "Diseñar el módulo 5: práctica",
  );
  assert.equal(getModuleTitle("5 técnicas de mezcla"), "5 técnicas de mezcla");
});

test("manual drafts require objectives before saving and preserve stable IDs", () => {
  const module = {
    id: "module-existing",
    title: "Práctica",
    objective_general_ref: "",
    lessons: [
      {
        id: "lesson-existing",
        title: "Crear",
        objective_specific: "",
        estimated_minutes: 30,
      },
    ],
  };
  const incomplete = syllabusModulesSchema.safeParse([module]);
  assert.equal(incomplete.success, false);
  if (!incomplete.success) {
    assert.deepEqual(
      incomplete.error.issues.map((issue) => issue.path),
      [
        [0, "objective_general_ref"],
        [0, "lessons", 0, "objective_specific"],
      ],
    );
  }
  module.objective_general_ref = "Aplicar las técnicas de mezcla";
  module.lessons[0].objective_specific = "Crear una mezcla de audio accesible";
  assert.deepEqual(syllabusModulesSchema.parse([module]), [module]);
  assert.equal(syllabusModulesSchema.safeParse([]).success, false);
  module.lessons[0].estimated_minutes = NaN;
  assert.equal(syllabusModulesSchema.safeParse([module]).success, false);
});
