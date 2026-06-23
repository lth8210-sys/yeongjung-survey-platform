import {
  getScaleQuestionConfig,
  isNonResponseQuestionType,
  isScaleQuestionType,
  QUESTION_TYPES,
} from '../firebase/surveys';

export const PROGRAM_NAME_ALIAS_MAP = new Map(
  [
    ['요가교실', '요가'],
    ['발레교실', '발레'],
    ['스마트폰 교실', '스마트폰교실'],
    ['k pop', '케이팝'],
    ['k-pop', '케이팝'],
    ['kpop댄스', '케이팝'],
    ['kpop', '케이팝'],
    ['케이팝댄스', '케이팝'],
    ['k pop댄스', '케이팝'],
  ].map(([key, value]) => [key.toLowerCase(), value]),
);

export function normalizeProgramName(rawName) {
  const trimmed = String(rawName ?? '').trim();
  return PROGRAM_NAME_ALIAS_MAP.get(trimmed.toLowerCase()) ?? trimmed;
}

export function formatAverage(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

function getNumericScore(answer, question) {
  if (isScaleQuestionType(question?.type)) {
    const numericValue = Number(answer);
    return Number.isFinite(numericValue) ? numericValue : null;
  }
  if (question?.type === QUESTION_TYPES.SINGLE_CHOICE) {
    const matchedScore = String(answer ?? '').trim().match(/^([1-5])\./);
    return matchedScore ? Number(matchedScore[1]) : null;
  }
  return null;
}

export function buildSurveyAnalytics(survey, responses) {
  const questions =
    survey?.questions?.filter((question) => !isNonResponseQuestionType(question.type)) ?? [];
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const scoreQuestions = questions.filter((question) => {
    if (isScaleQuestionType(question.type)) return true;
    return (
      question.type === QUESTION_TYPES.SINGLE_CHOICE &&
      (question.options ?? []).some((option) => /^([1-5])\./.test(String(option)))
    );
  });
  const textQuestions = questions.filter(
    (question) => question.type === QUESTION_TYPES.LONG_TEXT,
  );

  const scoreRows = scoreQuestions.map((question) => ({
    question,
    values: [],
    distribution: new Map(),
  }));
  const scoreRowMap = new Map(scoreRows.map((row) => [row.question.id, row]));
  const textResponses = [];

  responses.forEach((response) => {
    (response.answers ?? []).forEach((answerItem) => {
      const question = questionMap.get(answerItem.questionId);
      if (!question) return;

      const score = getNumericScore(answerItem.answer, question);
      const scoreRow = scoreRowMap.get(question.id);

      if (scoreRow && score !== null) {
        scoreRow.values.push(score);
        scoreRow.distribution.set(score, (scoreRow.distribution.get(score) ?? 0) + 1);
      }

      if (
        textQuestions.some((item) => item.id === question.id) &&
        String(answerItem.answer ?? '').trim()
      ) {
        textResponses.push({
          questionTitle: question.title,
          answer: String(answerItem.answer).trim(),
        });
      }
    });
  });

  const scoredRows = scoreRows
    .map((row) => {
      const sum = row.values.reduce((total, value) => total + value, 0);
      const average = row.values.length > 0 ? sum / row.values.length : null;
      const scaleConfig = getScaleQuestionConfig(row.question);
      const max = row.question.meta?.scaleMax ?? scaleConfig?.max ?? 5;
      return {
        question: row.question,
        average,
        count: row.values.length,
        max,
        distribution: Array.from({ length: max }, (_, index) => {
          const score = index + 1;
          return { score, count: row.distribution.get(score) ?? 0 };
        }),
      };
    })
    .filter((row) => row.count > 0);

  const allScores = scoredRows.flatMap((row) =>
    row.distribution.flatMap((item) => Array(item.count).fill(item.score)),
  );
  const totalAverage =
    allScores.length > 0
      ? allScores.reduce((total, value) => total + value, 0) / allScores.length
      : null;

  const getQuestionByTitle = (pattern) =>
    questions.find((question) => String(question.title ?? '').includes(pattern));

  const buildGroupedAverages = (question, normalizer = null) => {
    if (!question) return [];
    const groups = new Map();
    responses.forEach((response) => {
      const answers = response.answers ?? [];
      const groupAnswer = answers.find((item) => item.questionId === question.id)?.answer;
      const rawKey = String(groupAnswer ?? '').trim();
      if (!rawKey) return;
      const displayKey = normalizer ? normalizer(rawKey) : rawKey;
      const responseScores = answers
        .map((item) => getNumericScore(item.answer, questionMap.get(item.questionId)))
        .filter((score) => score !== null);
      if (responseScores.length === 0) return;
      const current = groups.get(displayKey) ?? { label: displayKey, total: 0, count: 0 };
      current.total += responseScores.reduce((total, score) => total + score, 0) / responseScores.length;
      current.count += 1;
      groups.set(displayKey, current);
    });
    return Array.from(groups.values()).map((group) => ({
      label: group.label,
      average: group.total / group.count,
      count: group.count,
    }));
  };

  const buildGroupedCounts = (question, normalizer = null) => {
    if (!question) return [];
    const groups = new Map();
    const total = responses.length;
    responses.forEach((response) => {
      const groupAnswer = (response.answers ?? []).find(
        (item) => item.questionId === question.id,
      )?.answer;
      const rawKey = String(groupAnswer ?? '').trim();
      if (!rawKey) return;
      const displayKey = normalizer ? normalizer(rawKey) : rawKey;
      groups.set(displayKey, (groups.get(displayKey) ?? 0) + 1);
    });
    return Array.from(groups.entries())
      .map(([label, count]) => ({
        label,
        count,
        percent: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.count - a.count);
  };

  const keyAverages = scoredRows.reduce((result, row) => {
    if (row.question.meta?.analyticsKey && row.average !== null) {
      result[row.question.meta.analyticsKey] = row.average;
    }
    return result;
  }, {});

  const socialNetworkQuestions = questions.filter(
    (question) => question.meta?.analyticsGroup === 'social_network',
  );
  const socialNetworkValues = responses.flatMap((response) =>
    (response.answers ?? [])
      .filter((item) => socialNetworkQuestions.some((question) => question.id === item.questionId))
      .map((item) => Number(item.answer))
      .filter((value) => Number.isFinite(value)),
  );
  const socialNetworkAverage =
    socialNetworkValues.length > 0
      ? socialNetworkValues.reduce((total, value) => total + value, 0) / socialNetworkValues.length
      : null;

  const programNameQuestion = getQuestionByTitle('수강한 프로그램명');
  const areaQuestion = getQuestionByTitle('살고있는 곳');
  const usagePeriodQuestion = getQuestionByTitle('이용기간');

  return {
    scoredRows,
    totalAverage,
    topRows: [...scoredRows].sort((a, b) => b.average - a.average).slice(0, 3),
    lowRows: [...scoredRows].sort((a, b) => a.average - b.average).slice(0, 3),
    textResponses,
    keyAverages,
    groupAverages: {
      usagePeriod: buildGroupedAverages(usagePeriodQuestion),
      area: buildGroupedAverages(areaQuestion),
      gender: buildGroupedAverages(getQuestionByTitle('성별')),
      programName: buildGroupedAverages(programNameQuestion, normalizeProgramName),
    },
    groupCounts: {
      area: buildGroupedCounts(areaQuestion),
      usagePeriod: buildGroupedCounts(usagePeriodQuestion),
      programName: buildGroupedCounts(programNameQuestion, normalizeProgramName),
    },
    socialNetworkAverage,
  };
}
