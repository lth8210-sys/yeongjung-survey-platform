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
    ['트니트니a', '트니트니'],
    ['트니트니b', '트니트니'],
    ['트니트니c', '트니트니'],
    ['트니트니A', '트니트니'],
    ['트니트니B', '트니트니'],
    ['트니트니C', '트니트니'],
    ['연필그로딩', '연필드로잉'],
    ['연필그로밍', '연필드로잉'],
    ['연필스케치', '연필드로잉'],
    ['k pop', '케이팝'],
    ['K POP', '케이팝'],
    ['k-pop', '케이팝'],
    ['kpop댄스', '케이팝'],
    ['kpop', '케이팝'],
    ['케이팝댄스', '케이팝'],
    ['k pop댄스', '케이팝'],
    ['케이팝 오전', '케이팝'],
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
    key: 'program_satisfaction',
    label: '프로그램 만족',
    keywords: ['프로그램', '수업', '교육', '강좌', '내용', '활동', '강의', '배움', '유익', '재밌', '재미', '좋았', '만족'],
  },
  {
    key: 'instructor_satisfaction',
    label: '강사 만족',
    keywords: ['강사', '선생님', '지도', '설명', '친절', '강의력', '진행', '알려', '가르쳐'],
  },
  {
    key: 'facility_environment_improvement',
    label: '시설 및 환경 개선',
    keywords: ['시설', '환경', '공간', '장소', '교실', '장비', '도구', '기자재', '카드리더기', '리더기', '출입카드', '출입', '고장', '작동', '깨끗', '소음', '온도', '책상', '의자', '주차', '냉난방'],
  },
  {
    key: 'schedule_improvement',
    label: '운영 및 일정 개선',
    keywords: ['시간', '일정', '요일', '기간', '횟수', '회기', '짧', '길', '오전', '오후', '주말', '평일', '방학'],
  },
  {
    key: 'new_program_request',
    label: '신규 프로그램 개설 요청',
    keywords: ['개설', '신설', '새로운', '신규', '만들어', '생겼', '있었으면', '있으면', 'ai', '인공지능', '외국어', '영어', '중국어', '일본어', '코딩', '컴퓨터', '디지털', '배우고 싶'],
  },
  {
    key: 'program_expansion_request',
    label: '프로그램 확대 요청',
    keywords: ['추가', '심화', '다음', '계속', '재참여', '다양화', '다양', '늘려', '늘었', '확대', '많이', '많았으면', '강좌도', '프로그램도'],
  },
  {
    key: 'promotion_participation_request',
    label: '홍보 및 참여 접근성 개선',
    keywords: ['홍보', '알림', '안내', '모집', '참여', '많은 사람', '공유', '접수', '신청', '접근', '방법', '온라인', '문자', '카톡', '카카오'],
  },
  {
    key: 'user_suggestion',
    label: '이용자 제안사항',
    keywords: ['제안', '건의', '바랍니다', '해주세요', '필요', '개선', '요청', '희망', '원합니다', '불편'],
  },
  {
    key: 'etc',
    label: '기타',
    keywords: [],
  },
];

const SIMPLE_FREE_TEXT_ANSWERS = new Set([
  '-',
  '없음',
  '없다',
  '없습니다',
  '무',
  'x',
  'X',
  '좋다',
  '좋음',
  '좋아요',
  '만족',
  '만족함',
  '만족합니다',
  '매우 만족',
  '네',
  '아니요',
]);

const REQUEST_OR_IMPROVEMENT_CATEGORY_KEYS = new Set([
  'facility_environment_improvement',
  'schedule_improvement',
  'new_program_request',
  'program_expansion_request',
  'promotion_participation_request',
  'user_suggestion',
]);

const EXPLICIT_POSITIVE_KEYWORDS = [
  '만족',
  '좋았',
  '좋아',
  '유익',
  '재밌',
  '재미',
  '도움',
  '감사',
  '훌륭',
];

function normalizeFreeTextAnswer(answer) {
  return String(answer ?? '')
    .trim()
    .replace(/[.!?。,\s]+$/g, '')
    .toLowerCase();
}

function isSimpleFreeTextAnswer(answer) {
  const normalizedAnswer = normalizeFreeTextAnswer(answer);
  return (
    SIMPLE_FREE_TEXT_ANSWERS.has(normalizedAnswer) ||
    /^[\s\-_.]+$/.test(String(answer ?? '')) ||
    normalizedAnswer.length <= 1
  );
}

function isRepresentativeFreeTextAnswer(answer) {
  if (isSimpleFreeTextAnswer(answer)) {
    return false;
  }

  const trimmedAnswer = String(answer ?? '').trim();
  const normalizedAnswer = normalizeFreeTextAnswer(trimmedAnswer);

  if (normalizedAnswer.length < 5) {
    return false;
  }

  const hasSentenceCue = /[\s~·,]|(하고|에도|에서|으로|으면|희망|개설|요청|개선|불편|필요|좋았|만족|바랍니다|주세요)/.test(
    trimmedAnswer,
  );

  return hasSentenceCue || normalizedAnswer.length >= 8;
}

export function classifyFreeTextAnswer(answer) {
  const normalizedAnswer = normalizeFreeTextAnswer(answer);

  if (!normalizedAnswer) {
    return [FREE_TEXT_CATEGORY_RULES[FREE_TEXT_CATEGORY_RULES.length - 1]];
  }

  if (isSimpleFreeTextAnswer(answer)) {
    return [FREE_TEXT_CATEGORY_RULES[FREE_TEXT_CATEGORY_RULES.length - 1]];
  }

  const matchedRules = FREE_TEXT_CATEGORY_RULES.filter((rule) =>
    rule.key !== 'etc' && rule.keywords.some((keyword) => normalizedAnswer.includes(keyword.toLowerCase())),
  );
  const hasRequestOrImprovement = matchedRules.some((rule) =>
    REQUEST_OR_IMPROVEMENT_CATEGORY_KEYS.has(rule.key),
  );
  const hasExplicitPositive = EXPLICIT_POSITIVE_KEYWORDS.some((keyword) =>
    normalizedAnswer.includes(keyword.toLowerCase()),
  );
  const refinedRules =
    hasRequestOrImprovement && !hasExplicitPositive
      ? matchedRules.filter((rule) => rule.key !== 'program_satisfaction')
      : matchedRules;

  return refinedRules.length > 0
    ? refinedRules
    : [FREE_TEXT_CATEGORY_RULES[FREE_TEXT_CATEGORY_RULES.length - 1]];
}

function getEtcCategory() {
  return FREE_TEXT_CATEGORY_RULES[FREE_TEXT_CATEGORY_RULES.length - 1];
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

    const categories = classifyFreeTextAnswer(answer);
    categories.forEach((category) => {
      const group = groups.get(category.key) ?? groups.get('etc');
      group.count += 1;
      if (group.examples.length < 3 && isRepresentativeFreeTextAnswer(answer)) {
        group.examples.push(answer);
      }
    });
  });

  const etcCategory = getEtcCategory();
  const visibleGroups = Array.from(groups.values())
    .filter((group) => group.count > 0 && group.examples.length > 0);

  return visibleGroups.sort((first, second) => {
    if (first.key === etcCategory.key) return 1;
    if (second.key === etcCategory.key) return -1;
    return second.count - first.count;
  });
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
