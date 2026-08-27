import { NON_RESPONSE_QUESTION_TYPES } from '../firebase/surveyConstants';

const LEGACY_COLUMN_PREFIX = '[이전 문항]';

function getQuestionTitle(question) {
  return String(question?.title ?? question?.label ?? '').trim();
}

function makeUniqueLabel(label, usedLabels) {
  if (!usedLabels.has(label)) {
    usedLabels.add(label);
    return label;
  }

  let suffix = 2;
  let candidate = `${label} (${suffix})`;
  while (usedLabels.has(candidate)) {
    suffix += 1;
    candidate = `${label} (${suffix})`;
  }
  usedLabels.add(candidate);
  return candidate;
}

/**
 * Builds the question columns used by raw Excel/CSV exports.
 *
 * Current questions stay first and retain their current order. Historical answers
 * whose questionId is no longer in the survey schema receive their own legacy
 * column instead of being silently omitted. Answers with no usable questionId are
 * deliberately not guessed or mapped to a current question.
 */
export function buildRawExportColumns(surveyQuestions = [], responses = []) {
  const currentColumns = (surveyQuestions ?? [])
    .filter((question) => question?.id && !NON_RESPONSE_QUESTION_TYPES.has(question.type))
    .map((question) => ({
      id: question.id,
      title: getQuestionTitle(question) || question.id,
      type: question.type,
      legacy: false,
    }));
  const currentIds = new Set(currentColumns.map((column) => column.id));
  const legacyColumns = [];
  const legacyIds = new Set();

  (responses ?? []).forEach((response) => {
    (response?.answers ?? []).forEach((answer) => {
      const questionId = typeof answer?.questionId === 'string' ? answer.questionId.trim() : '';
      if (!questionId || currentIds.has(questionId) || legacyIds.has(questionId)) return;

      legacyIds.add(questionId);
      const storedTitle = String(answer?.questionTitle ?? '').trim();
      legacyColumns.push({
        id: questionId,
        title: `${LEGACY_COLUMN_PREFIX} ${storedTitle || '제목 없는 문항'}`,
        type: answer?.questionType,
        legacy: true,
      });
    });
  });

  const usedLabels = new Set();
  return [...currentColumns, ...legacyColumns].map((column) => ({
    ...column,
    exportLabel: makeUniqueLabel(column.title, usedLabels),
  }));
}

// getOrderedResponseAnswerItems() includes placeholder rows for current questions
// that were not present in an older response. Raw exports must keep those cells
// blank, so retain only IDs that are actually stored in answers[].
export function keepStoredResponseAnswerItems(items = [], answers = []) {
  const storedIds = new Set(
    (answers ?? [])
      .map((answer) => (typeof answer?.questionId === 'string' ? answer.questionId.trim() : ''))
      .filter(Boolean),
  );
  return (items ?? []).filter((item) => storedIds.has(item.questionId));
}
