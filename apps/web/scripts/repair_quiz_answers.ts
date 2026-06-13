import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import {
  hasValidQuizCorrectAnswer,
  resolveQuizCorrectAnswer,
  stripQuizOptionPrefix,
} from '../src/domains/materials/lib/quiz-option-format';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

type QuizItem = {
  id?: string;
  question?: string;
  type?: string;
  options?: unknown;
  correct_answer?: unknown;
  explanation?: unknown;
};

type QuizContent = {
  items?: QuizItem[];
  passing_score?: number;
  [key: string]: unknown;
};

type QuizComponentRow = {
  id: string;
  content: QuizContent | null;
};

type RepairIssue = {
  componentId: string;
  questionId: string;
  issue:
    | 'missing_correct_answer'
    | 'normalized_correct_answer'
    | 'normalized_options_shape'
    | 'unresolved_correct_answer'
    | 'invalid_options_shape';
  inferredAnswer?: string;
};

const args = new Set(process.argv.slice(2));
const applyChanges = args.has('--apply');
const passingScoreArg = process.argv
  .slice(2)
  .find((arg) => arg.startsWith('--passing-score='));
const requestedPassingScore = passingScoreArg
  ? Number(passingScoreArg.split('=')[1])
  : undefined;

if (
  requestedPassingScore !== undefined &&
  (!Number.isInteger(requestedPassingScore) ||
    requestedPassingScore < 0 ||
    requestedPassingScore > 100)
) {
  throw new Error('--passing-score debe ser un entero entre 0 y 100');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en apps/web/.env.local',
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

function getStringOptions(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((option): option is string => typeof option === 'string');
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, option]) => option)
      .filter((option): option is string => typeof option === 'string');
  }

  return [];
}

function getExplanationText(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, explanation]) => `${key}: ${String(explanation)}`)
      .join(' ');
  }

  return '';
}

function getOptionByLetter(options: string[], letter: string) {
  const index = letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
  return index >= 0 && index < options.length ? options[index] : '';
}

function isTrueFalse(item: QuizItem) {
  return item.type === 'TRUE_FALSE' || item.type === 'true_false';
}

function inferAnswerFromExplanation(item: QuizItem, cleanOptions: string[]) {
  const explanation = getExplanationText(item.explanation);
  const text = explanation.toLowerCase();

  const letterMatch =
    explanation.match(/opci[oó]n\s+correcta\s*:?\s*([A-D])/i) ||
    explanation.match(/respuesta\s+correcta\s*:?\s*([A-D])/i) ||
    explanation.match(/\b([A-D])\s*[:.)-]\s*(?:correcto|correcta)\b/i);

  if (letterMatch?.[1]) {
    const option = getOptionByLetter(cleanOptions, letterMatch[1]);
    if (option) {
      return option;
    }
  }

  const explicitAnswerMatch =
    explanation.match(/(?:la\s+)?opci[oó]n\s+correcta\s+es\s+['"“”]?([^'".“”]+)['"“”]?/i) ||
    explanation.match(/(?:la\s+)?respuesta\s+correcta\s+es\s+['"“”]?([^'".“”]+)['"“”]?/i);

  if (explicitAnswerMatch?.[1]) {
    const explicitAnswer = explicitAnswerMatch[1].trim();
    const matchingOption = cleanOptions.find(
      (option) => option.trim().toLowerCase() === explicitAnswer.toLowerCase(),
    );

    if (matchingOption) {
      return matchingOption;
    }
  }

  if (isTrueFalse(item)) {
    const falseSignals = [
      'opción correcta: b. falso',
      'opcion correcta: b. falso',
      'respuesta correcta es falso',
      'respuesta correcta es falsa',
      'afirmación es falsa',
      'afirmacion es falsa',
    ];
    const trueSignals = [
      'opción correcta: a. verdadero',
      'opcion correcta: a. verdadero',
      'respuesta correcta es verdadero',
      'respuesta correcta es verdadera',
      'afirmación es verdadera',
      'afirmacion es verdadera',
    ];
    const hasFalseSignal = falseSignals.some((signal) => text.includes(signal));
    const hasTrueSignal = trueSignals.some((signal) => text.includes(signal));

    if (hasFalseSignal !== hasTrueSignal) {
      const target = hasTrueSignal ? 'verdadero' : 'falso';
      return (
        cleanOptions.find((option) => option.trim().toLowerCase() === target) ||
        (hasTrueSignal ? 'Verdadero' : 'Falso')
      );
    }
  }

  return '';
}

function normalizeOptionsForQuestionType(item: QuizItem, rawOptions: string[]) {
  const cleanOptions = rawOptions.map(stripQuizOptionPrefix);

  if (
    isTrueFalse(item) &&
    (cleanOptions.length === 0 ||
      cleanOptions.every((option) => ['a', 'b'].includes(option.toLowerCase())))
  ) {
    return ['Verdadero', 'Falso'];
  }

  return cleanOptions;
}

function inferTrueFalseAnswer(item: QuizItem) {
  if (!isTrueFalse(item)) {
    return '';
  }

  const text = `${getExplanationText(item.explanation)} ${item.question || ''}`.toLowerCase();
  const falseSignals = [
    'afirmación es falsa',
    'afirmacion es falsa',
    'respuesta correcta es falso',
    'respuesta correcta es falsa',
    'es falso',
    'es falsa',
  ];
  const trueSignals = [
    'afirmación es verdadera',
    'afirmacion es verdadera',
    'respuesta correcta es verdadero',
    'respuesta correcta es verdadera',
    'es verdadero',
    'es verdadera',
  ];

  const hasFalseSignal = falseSignals.some((signal) => text.includes(signal));
  const hasTrueSignal = trueSignals.some((signal) => text.includes(signal));

  if (hasFalseSignal === hasTrueSignal) {
    return '';
  }

  const cleanOptions = normalizeOptionsForQuestionType(
    item,
    getStringOptions(item.options),
  );
  const target = hasTrueSignal ? 'verdadero' : 'falso';
  const optionMatch = cleanOptions.find(
    (option) => option.trim().toLowerCase() === target,
  );

  return optionMatch || (hasTrueSignal ? 'Verdadero' : 'Falso');
}

function normalizeItem(item: QuizItem) {
  const rawOptions = getStringOptions(item.options);
  const cleanOptions = normalizeOptionsForQuestionType(item, rawOptions);
  const explanationAnswer = inferAnswerFromExplanation(item, cleanOptions);

  if (explanationAnswer) {
    const normalized =
      item.correct_answer !== explanationAnswer ||
      item.options !== undefined && !Array.isArray(item.options);

    return {
      item: {
        ...item,
        options: cleanOptions,
        correct_answer: explanationAnswer,
      },
      fixed: !item.correct_answer,
      normalized,
      unresolved: false,
      inferredAnswer: explanationAnswer,
    };
  }

  const valid = hasValidQuizCorrectAnswer({
    rawCorrect: item.correct_answer,
    rawOptions,
    cleanOptions,
    questionType: item.type,
  });

  if (valid) {
    const resolvedAnswer = resolveQuizCorrectAnswer({
      rawCorrect: item.correct_answer,
      rawOptions,
      cleanOptions,
      questionType: item.type,
    });

    return {
      item: {
        ...item,
        options: cleanOptions,
        correct_answer: resolvedAnswer,
      },
      fixed: false,
      normalized:
        item.correct_answer !== resolvedAnswer ||
        item.options !== undefined && !Array.isArray(item.options),
      unresolved: false,
    };
  }

  const inferredAnswer = inferTrueFalseAnswer(item);
  if (!inferredAnswer) {
    return { item, fixed: false, normalized: false, unresolved: true };
  }

  return {
    item: { ...item, options: cleanOptions, correct_answer: inferredAnswer },
    fixed: true,
    normalized: true,
    unresolved: false,
    inferredAnswer,
  };
}

async function main() {
  const { data, error } = await supabase
    .from('material_components')
    .select('id, content')
    .eq('type', 'QUIZ');

  if (error) {
    throw error;
  }

  const rows = (data || []) as QuizComponentRow[];
  const issues: RepairIssue[] = [];
  let changedComponents = 0;
  let fixedAnswers = 0;
  let updatedPassingScores = 0;

  for (const row of rows) {
    const content = row.content;
    const items = Array.isArray(content?.items) ? content.items : [];
    let changed = false;

    const normalizedItems = items.map((item, index) => {
      const result = normalizeItem(item);
      const questionId = item.id || `question-${index + 1}`;

      if (
        item.options !== undefined &&
        !Array.isArray(item.options) &&
        getStringOptions(item.options).length === 0
      ) {
        issues.push({
          componentId: row.id,
          questionId,
          issue: 'invalid_options_shape',
        });
      } else if (item.options !== undefined && !Array.isArray(item.options)) {
        issues.push({
          componentId: row.id,
          questionId,
          issue: 'normalized_options_shape',
        });
      }

      if (result.fixed) {
        fixedAnswers += 1;
        changed = true;
        issues.push({
          componentId: row.id,
          questionId,
          issue: 'missing_correct_answer',
          inferredAnswer: result.inferredAnswer,
        });
      } else if (result.normalized) {
        changed = true;
        issues.push({
          componentId: row.id,
          questionId,
          issue: 'normalized_correct_answer',
          inferredAnswer: result.inferredAnswer,
        });
      } else if (result.unresolved) {
        issues.push({
          componentId: row.id,
          questionId,
          issue: 'unresolved_correct_answer',
        });
      }

      return result.item;
    });

    const nextContent: QuizContent = {
      ...content,
      items: normalizedItems,
    };

    if (
      requestedPassingScore !== undefined &&
      nextContent.passing_score !== requestedPassingScore
    ) {
      nextContent.passing_score = requestedPassingScore;
      updatedPassingScores += 1;
      changed = true;
    }

    if (!changed) {
      continue;
    }

    changedComponents += 1;

    if (applyChanges) {
      const { error: updateError } = await supabase
        .from('material_components')
        .update({ content: nextContent })
        .eq('id', row.id);

      if (updateError) {
        throw updateError;
      }
    }
  }

  console.log(
    JSON.stringify(
      {
        mode: applyChanges ? 'apply' : 'dry-run',
        scannedComponents: rows.length,
        changedComponents,
        fixedAnswers,
        updatedPassingScores,
        unresolvedIssues: issues.filter(
          (issue) => issue.issue === 'unresolved_correct_answer',
        ).length,
        issues,
      },
      null,
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
