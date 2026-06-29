import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  validateBaseGate,
  validateCurationGate,
  validateMaterialsGate,
  validatePublicationGate,
  validateSyllabusGate,
  type PipelineValidationInput,
} from "../pipeline-validation";

const completeInput: PipelineValidationInput = {
  artifact: {
    generation_metadata: { assets_complete: true },
    idea_central: "Taller de IA",
    nombres: ["Taller de IA aplicada"],
    objetivos: ["Aplicar IA en procesos internos"],
    production_complete: true,
    state: "READY_FOR_QA",
  },
  curation: {
    qa_decision: { decision: "APPROVED" },
    state: "PHASE2_APPROVED",
  },
  curationRows: [
    {
      apta: true,
      cobertura_completa: true,
      url_status: "OK",
    },
  ],
  materialComponents: [
    {
      assets: {
        final_video_url: "https://cdn.example.com/final.mp4",
      },
      type: "VIDEO_THEORETICAL",
      validation_status: "PASS",
    },
  ],
  materialLessons: [
    {
      expected_components: ["READING", "QUIZ"],
      state: "APPROVABLE",
    },
  ],
  materials: {
    global_blockers: [],
    package: { files: [] },
    qa_decision: { decision: "APPROVED" },
    state: "PHASE3_APPROVED",
  },
  plan: {
    approvals: { architect_status: "APPROVED" },
    blockers: [],
    final_status: "APPROVED_PHASE_1",
    lesson_plans: [{ lesson_id: "les-1", components: [{ type: "READING" }] }],
    state: "STEP_APPROVED",
    validation: { estado: "PASS" },
  },
  publicationRequest: {
    category: "Negocios",
    instructor_email: "instructor@example.com",
    lesson_videos: {},
    level: "beginner",
    slug: "taller-ia",
    status: "READY",
  },
  syllabus: {
    modules: [
      {
        lessons: [{ title: "Leccion 1" }],
        title: "Modulo 1",
      },
    ],
    qa: { status: "APPROVED" },
    state: "STEP_APPROVED",
    validation: {
      automatic_pass: true,
      checks: [{ pass: true }],
    },
  },
};

describe("pipeline validation gates", () => {
  it("blocks BASE when generated objectives and names are missing", () => {
    const validation = validateBaseGate({
      artifact: {
        idea_central: "Taller incompleto",
        nombres: [],
        objetivos: [],
        state: "READY_FOR_QA",
      },
    });

    assert.equal(validation.allowed, false);
    assert.deepEqual(
      validation.errors.map((error) => error.code),
      ["BASE_OBJECTIVES_REQUIRED", "BASE_NAMES_REQUIRED"],
    );
  });

  it("allows SYLLABUS when base and syllabus contracts are complete", () => {
    const validation = validateSyllabusGate(completeInput);

    assert.equal(validation.allowed, true);
    assert.equal(validation.errors.length, 0);
  });

  it("blocks CURATION approval until the plan is approved", () => {
    const validation = validateCurationGate({
      ...completeInput,
      plan: {
        ...completeInput.plan,
        approvals: { architect_status: "PENDING" },
        final_status: null,
        state: "STEP_READY_FOR_REVIEW",
      },
    });

    assert.equal(validation.allowed, false);
    assert.equal(
      validation.errors.some((error) => error.code === "PLAN_QA_REQUIRED"),
      true,
    );
  });

  it("blocks MATERIALS approval when any lesson is not approvable", () => {
    const validation = validateMaterialsGate({
      ...completeInput,
      materialLessons: [{ state: "NEEDS_FIX" }],
    });

    assert.equal(validation.allowed, false);
    assert.equal(
      validation.errors.some(
        (error) => error.code === "MATERIAL_LESSONS_NOT_APPROVABLE",
      ),
      true,
    );
  });

  it("allows PUBLICATION only when production and publication metadata are ready", () => {
    const validation = validatePublicationGate(completeInput);

    assert.equal(validation.allowed, true);
  });

  it("blocks PUBLICATION when production has not been completed", () => {
    const validation = validatePublicationGate({
      ...completeInput,
      artifact: {
        ...completeInput.artifact,
        generation_metadata: { assets_complete: false },
        production_complete: false,
      },
    });

    assert.equal(validation.allowed, false);
    assert.equal(
      validation.errors.some(
        (error) => error.code === "PRODUCTION_NOT_MARKED_COMPLETE",
      ),
      true,
    );
  });
});
