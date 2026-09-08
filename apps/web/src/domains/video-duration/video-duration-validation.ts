import {
  VIDEO_NARRATION_CHARACTERS_PER_MINUTE,
  type VideoDurationContract,
} from "./video-duration-policy";

export type VideoDurationValidationCode =
  | "INSUFFICIENT_BROLL_COVERAGE"
  | "DECLARED_DURATION_MISMATCH"
  | "INSUFFICIENT_NARRATION"
  | "INSUFFICIENT_SLIDE_COVERAGE"
  | "INVALID_SCRIPT_TIMECODES"
  | "INVALID_STORYBOARD_TIMECODES"
  | "SCRIPT_DURATION_OUT_OF_RANGE"
  | "STORYBOARD_COVERAGE_MISMATCH"
  | "STORYBOARD_TOO_SHORT";

export interface VideoDurationValidationIssue {
  code: VideoDurationValidationCode;
  message: string;
}

export interface VideoDurationValidationResult {
  estimatedNarrationDurationSeconds: number;
  issues: VideoDurationValidationIssue[];
  narrationCharacterCount: number;
  narrationWordCount: number;
  scriptDurationSeconds: number;
  valid: boolean;
}

interface TimedNarrationItem {
  duration_seconds?: unknown;
  narration_text?: unknown;
  timecode_end?: unknown;
  timecode_start?: unknown;
}

export function validateVideoDurationContent(
  content: unknown,
  contract: VideoDurationContract,
): VideoDurationValidationResult {
  const record = asRecord(content);
  const script = asRecord(record?.script ?? record?.video_script);
  const sections = asRecordArray(script?.sections);
  const storyboard = asRecordArray(record?.storyboard);
  const scriptDurationSeconds = sumDurations(sections);
  const scriptNarration = joinNarration(sections);
  const storyboardNarration = joinNarration(storyboard);
  const narrationCharacterCount = countEditorialCharacters(scriptNarration);
  const narrationWordCount = countWords(scriptNarration);
  const estimatedNarrationDurationSeconds = estimateNarrationDuration(
    narrationCharacterCount,
  );
  const issues: VideoDurationValidationIssue[] = [];

  if (
    scriptDurationSeconds < contract.minimumDurationSeconds ||
    scriptDurationSeconds > contract.maximumDurationSeconds
  ) {
    issues.push({
      code: "SCRIPT_DURATION_OUT_OF_RANGE",
      message: `El guion declara ${scriptDurationSeconds}s; debe quedar entre ${contract.minimumDurationSeconds}s y ${contract.maximumDurationSeconds}s.`,
    });
  }

  const declaredMinutes = readPositiveNumber(record?.duration_estimate_minutes);
  if (declaredMinutes > 0 && Math.abs(declaredMinutes * 60 - scriptDurationSeconds) > 5) {
    issues.push({
      code: "DECLARED_DURATION_MISMATCH",
      message: `duration_estimate_minutes declara ${Math.round(declaredMinutes * 60)}s, pero las secciones suman ${scriptDurationSeconds}s.`,
    });
  }

  const minimumCharacterCount = charactersForDuration(contract.minimumDurationSeconds);
  if (narrationCharacterCount < minimumCharacterCount) {
    issues.push({
      code: "INSUFFICIENT_NARRATION",
      message: `La narración contiene ${narrationCharacterCount} caracteres editoriales (${narrationWordCount} palabras) y equivale a aproximadamente ${estimatedNarrationDurationSeconds}s a ${VIDEO_NARRATION_CHARACTERS_PER_MINUTE} caracteres por minuto; requiere al menos ${minimumCharacterCount} caracteres (${contract.minimumDurationSeconds}s). Hace falta información sustantiva, ejemplos o desarrollo pedagógico para alcanzar la duración sin repeticiones.`,
    });
  }

  const scriptTimelineIssue = findTimelineIssue(sections, scriptDurationSeconds);
  if (scriptTimelineIssue) {
    issues.push({
      code: "INVALID_SCRIPT_TIMECODES",
      message: `Timecodes inválidos en el guion: ${scriptTimelineIssue}`,
    });
  }

  if (storyboard.length < contract.minimumStoryboardTakes) {
    issues.push({
      code: "STORYBOARD_TOO_SHORT",
      message: `El storyboard tiene ${storyboard.length} tomas; requiere al menos ${contract.minimumStoryboardTakes} para la cadencia configurada.`,
    });
  }

  const brollTakes = storyboard.filter((item) => normalizeVisualType(item.visual_type).includes("B_ROLL")).length;
  if (brollTakes < contract.minimumBrollTakes) {
    issues.push({
      code: "INSUFFICIENT_BROLL_COVERAGE",
      message: `El storyboard contiene ${brollTakes} tomas de B-roll; requiere al menos ${contract.minimumBrollTakes} para este tipo y duración.`,
    });
  }

  const plannedSlideCount = 1 + sections.reduce(
    (total, section) => total + Math.min(3, Math.max(1, visibleBeatCount(section))),
    0,
  );
  if (plannedSlideCount < contract.minimumSlideCount) {
    issues.push({
      code: "INSUFFICIENT_SLIDE_COVERAGE",
      message: `El guion permite planear aproximadamente ${plannedSlideCount} diapositivas; requiere al menos ${contract.minimumSlideCount}. Agrega beats visuales distintos en on_screen_text.`,
    });
  }

  const storyboardTimelineIssue = findTimelineIssue(storyboard, scriptDurationSeconds, false);
  if (storyboardTimelineIssue) {
    issues.push({
      code: "INVALID_STORYBOARD_TIMECODES",
      message: `Timecodes inválidos en el storyboard: ${storyboardTimelineIssue}`,
    });
  }

  if (normalizeNarration(scriptNarration) !== normalizeNarration(storyboardNarration)) {
    issues.push({
      code: "STORYBOARD_COVERAGE_MISMATCH",
      message: "La narración del storyboard no reproduce íntegramente el guion en el mismo orden.",
    });
  }

  return {
    estimatedNarrationDurationSeconds,
    issues,
    narrationCharacterCount,
    narrationWordCount,
    scriptDurationSeconds,
    valid: issues.length === 0,
  };
}

function findTimelineIssue(
  items: Record<string, unknown>[],
  expectedEndSeconds: number,
  requireDeclaredDuration = true,
): string | null {
  if (items.length === 0) return "no contiene secciones o tomas";
  if (expectedEndSeconds <= 0) return "la duración total esperada no es válida";

  let cursor = 0;
  for (const [index, rawItem] of items.entries()) {
    const item = rawItem as TimedNarrationItem;
    const start = parseTimecode(item.timecode_start);
    const end = parseTimecode(item.timecode_end);
    const position = index + 1;
    if (start === null || end === null) {
      return `elemento ${position} contiene un timecode ausente o con formato distinto de MM:SS`;
    }
    if (end <= start) return `elemento ${position} termina en ${end}s y comienza en ${start}s`;
    if (Math.abs(start - cursor) > 1) {
      return `elemento ${position} comienza en ${start}s; debía comenzar en ${cursor}s`;
    }

    if (requireDeclaredDuration) {
      const duration = readPositiveNumber(item.duration_seconds);
      if (duration <= 0) return `elemento ${position} no declara duration_seconds válido`;
      if (Math.abs(end - start - duration) > 1) {
        return `elemento ${position} cubre ${end - start}s, pero declara duration_seconds=${duration}`;
      }
    }
    cursor = end;
  }

  return Math.abs(cursor - expectedEndSeconds) <= 1
    ? null
    : `finaliza en ${cursor}s; debía finalizar en ${expectedEndSeconds}s`;
}

function parseTimecode(value: unknown) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,3}):(\d{2})$/);
  if (!match) return null;
  const minutes = Number(match[1]);
  const seconds = Number(match[2]);
  if (!Number.isInteger(minutes) || !Number.isInteger(seconds) || seconds > 59) return null;
  return minutes * 60 + seconds;
}

function countWords(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

function countEditorialCharacters(text: string) {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .length;
}

function charactersForDuration(seconds: number) {
  return Math.round((seconds / 60) * VIDEO_NARRATION_CHARACTERS_PER_MINUTE);
}

function estimateNarrationDuration(characterCount: number) {
  return Math.round(
    (characterCount / VIDEO_NARRATION_CHARACTERS_PER_MINUTE) * 60,
  );
}

function joinNarration(items: Record<string, unknown>[]) {
  return items
    .map((item) => typeof item.narration_text === "string" ? item.narration_text.trim() : "")
    .filter(Boolean)
    .join(" ");
}

function normalizeNarration(value: string) {
  return value.toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVisualType(value: unknown) {
  return typeof value === "string"
    ? value.trim().toUpperCase().replace(/[\s-]+/g, "_")
    : "";
}

function visibleBeatCount(section: Record<string, unknown>) {
  const onScreenText = typeof section.on_screen_text === "string" ? section.on_screen_text : "";
  const explicitBeats = onScreenText
    .split(/\n|•|- /)
    .map((line) => line.trim())
    .filter(Boolean).length;
  return explicitBeats + Number(typeof section.success_criteria === "string" && section.success_criteria.trim().length > 0);
}

function sumDurations(items: Record<string, unknown>[]) {
  return Math.round(items.reduce(
    (total, item) => total + readPositiveNumber(item.duration_seconds),
    0,
  ));
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => asRecord(item) !== null)
    : [];
}
