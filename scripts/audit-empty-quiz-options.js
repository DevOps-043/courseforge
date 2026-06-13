#!/usr/bin/env node

const path = require("path");
const dotenv = require("dotenv");
const { createClient } = require("@supabase/supabase-js");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const apply = process.argv.includes("--apply");
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const BARE_OPTION_LABEL = /^\s*(?:[A-Da-d]|\d{1,2})\s*[\.)\-:]?\s*$/;
const OPTION_PREFIX = /^\s*(?:[A-Da-d]|\d{1,2})\s*[\.)\-:]\s*/;

function stripOptionPrefix(option) {
  return String(option || "").replace(OPTION_PREFIX, "").trim();
}

function hasSubstantiveOptionText(option) {
  if (typeof option !== "string") {
    return false;
  }

  const trimmed = option.trim();
  return Boolean(trimmed) && !BARE_OPTION_LABEL.test(trimmed) && stripOptionPrefix(trimmed).length > 0;
}

function getInvalidQuizOptions(content) {
  const items = Array.isArray(content?.items) ? content.items : [];
  const invalid = [];

  items.forEach((item, questionIndex) => {
    const options = Array.isArray(item?.options) ? item.options : [];
    options.forEach((option, optionIndex) => {
      if (!hasSubstantiveOptionText(option)) {
        invalid.push({
          questionId: item?.id || `question-${questionIndex + 1}`,
          questionIndex,
          optionIndex,
          option,
        });
      }
    });
  });

  return invalid;
}

function mergeDodError(dod, errorMessage) {
  const currentDod = dod && typeof dod === "object" && !Array.isArray(dod) ? dod : {};
  const errors = Array.isArray(currentDod.errors) ? currentDod.errors : [];

  return {
    ...currentDod,
    control5_quiz: "FAIL",
    errors: errors.includes(errorMessage) ? errors : [...errors, errorMessage],
  };
}

async function main() {
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: components, error } = await supabase
    .from("material_components")
    .select("id, material_lesson_id, content, iteration_number, generated_at")
    .eq("type", "QUIZ");

  if (error) {
    throw error;
  }

  const affected = [];
  for (const component of components || []) {
    const invalidOptions = getInvalidQuizOptions(component.content);
    if (invalidOptions.length > 0) {
      affected.push({ component, invalidOptions });
    }
  }

  if (affected.length === 0) {
    console.log("No quizzes with empty/bare-label options were found.");
    return;
  }

  const lessonIds = [...new Set(affected.map((entry) => entry.component.material_lesson_id))];
  const { data: lessons, error: lessonsError } = await supabase
    .from("material_lessons")
    .select("id, lesson_title, module_title, state, dod")
    .in("id", lessonIds);

  if (lessonsError) {
    throw lessonsError;
  }

  const lessonsById = new Map((lessons || []).map((lesson) => [lesson.id, lesson]));

  console.log(`Found ${affected.length} affected quiz component(s). Mode: ${apply ? "apply" : "dry-run"}`);

  for (const { component, invalidOptions } of affected) {
    const lesson = lessonsById.get(component.material_lesson_id);
    const summary = invalidOptions
      .map((entry) => `${entry.questionId}[${entry.optionIndex + 1}]="${String(entry.option)}"`)
      .join(", ");
    const message = `QUIZ tiene ${invalidOptions.length} opcion(es) sin contenido real: ${summary}`;

    console.log(`- ${lesson?.module_title || "Sin modulo"} / ${lesson?.lesson_title || component.material_lesson_id}`);
    console.log(`  component_id=${component.id}`);
    console.log(`  ${message}`);

    if (!apply) {
      continue;
    }

    const { error: componentError } = await supabase
      .from("material_components")
      .update({
        validation_status: "FAILED",
        validation_errors: [message],
      })
      .eq("id", component.id);

    if (componentError) {
      throw componentError;
    }

    const { error: lessonError } = await supabase
      .from("material_lessons")
      .update({
        state: "NEEDS_FIX",
        dod: mergeDodError(lesson?.dod, message),
        updated_at: new Date().toISOString(),
      })
      .eq("id", component.material_lesson_id);

    if (lessonError) {
      throw lessonError;
    }
  }

  if (!apply) {
    console.log("Run with --apply to mark affected lessons as NEEDS_FIX.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
