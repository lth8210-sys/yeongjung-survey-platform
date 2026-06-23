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

export const FREE_TEXT_CATEGORY_RULES = [
  {
    key: 'education_content_satisfaction',
    label: '교육 내용 만족',
    keywords: ['내용', '교육', '수업', '프로그램', '강의', '배움', '유익', '좋았', '만족', '재밌', '재미'],
  },
  {
    key: 'instructor_satisfaction',
    label: '강사/진행 만족',
    keywords: ['강사', '선생님', '진행', '설명', '친절', '강의력', '지도', '알려'],
  },
  {
    key: 'practice_intent',
    label: '실천 적용 욕구',
    keywords: ['실천', '적용', '활용', '써먹', '사용', '연습', '집에서', '생활', '도움'],
  },
  {
    key: 'additional_education_request',
    label: '추가 교육 요청',
    keywords: ['추가', '더', '심화', '다음', '계속', '또', '재참여', '개설', '배우고 싶', '교육 요청'],
  },
  {
    key: 'promotion_participation_request',
    label: '홍보/참여 확대 요청',
    keywords: ['홍보', '알림', '안내', '모집', '참여', '많은 사람', '확대', '공유'],
  },
  {
    key: 'facility_environment_improvement',
    label: '시설/환경 개선',
    keywords: ['시설', '환경', '공간', '장소', '교실', '장비', '도구', '깨끗', '소음', '온도', '책상', '의자'],
  },
  {
    key: 'schedule_improvement',
    label: '운영시간/일정 개선',
    keywords: ['시간', '일정', '요일', '기간', '횟수', '회기', '짧', '길', '오전', '오후', '주말'],
  },
  {
    key: 'etc',
    label: '기타',
    keywords: [],
  },
];

function classifyFreeTextAnswer(answer) {
  const normalizedAnswer = String(answer ?? '').trim().toLowerCase();

  if (!normalizedAnswer) {
    return FREE_TEXT_CATEGORY_RULES[FREE_TEXT_CATEGORY_RULES.length - 1];
  }

  return (
    FREE_TEXT_CATEGORY_RULES.find((rule) =>
      rule.key !== 'etc' && rule.keywords.some((keyword) => normalizedAnswer.includes(keyword.toLowerCase())),
    ) ?? FREE_TEXT_CATEGORY_RULES[FREE_TEXT_CATEGORY_RULES.length - 1]
  );
}

export function buildFreeTextCategorySummary(textResponses) {
  const groups = new Map(
    FREE_TEXT_CATEGORY_RULES.map((rule) => [
      rule.key,
      {
        key: rule.key,
        label: rule.label,
        count: 0,
        examples: [],
      },
    ]),
  );

  (textResponses ?? []).forEach((item) => {
    const answer = String(item?.answer ?? '').trim();
    if (!answer) return;

    const category = classifyFreeTextAnswer(answer);
    const group = groups.get(category.key) ?? groups.get('etc');
    group.count += 1;
    if (group.examples.length < 3) {
      group.examples.push(answer);
    }
  });

  return Array.from(groups.values())
    .filter((group) => group.count > 0)
    .sort((first, second) => second.count - first.count);
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
    freeTextCategories: buildFreeTextCategorySummary(textResponses),
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
