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
    key: 'positive_evaluation',
    label: '긍정 평가',
  },
  {
    key: 'practice_application',
    label: '실천 적용 제안',
  },
  {
    key: 'education_expansion',
    label: '교육 확대 요청',
  },
  {
    key: 'operation_improvement',
    label: '운영 개선 의견',
  },
  {
    key: 'promotion_participation',
    label: '홍보 및 참여 확대',
  },
  {
    key: 'facility_environment',
    label: '시설 및 환경 의견',
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
  '감사합니다',
  '감사',
  'ai',
  '연극',
  '탁구',
  '탁구요',
  '테니스',
  '원예',
  '네',
  '아니요',
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
  '이해',
  '배울 수',
  '도움이',
  '유용',
  '효과',
];

const REQUEST_CONTEXT_KEYWORDS = [
  '희망',
  '필요',
  '개선',
  '확대',
  '추가',
  '더 듣',
  '더 배우',
  '더 있',
  '있었으면',
  '있으면 좋',
  '개설',
  '신설',
  '운영해',
  '운영되',
  '바랍니다',
  '해주세요',
  '원합니다',
  '요청',
  '늘려',
  '강화',
  '부족',
  '불편',
];

const PRACTICE_CONTEXT_KEYWORDS = [
  '실천',
  '현장 적용',
  '업무 적용',
  '적용 방법',
  '슈퍼비전',
  '사례 공유',
  '자산 발굴',
  '자산 연결',
  '지역사회 자산',
  '실습',
];

const EDUCATION_TOPIC_KEYWORDS = [
  '교육',
  '강의',
  '강좌',
  '수업',
  '과정',
  '프로그램',
  '사례',
  '실습',
  '슈퍼비전',
  '심화',
  '후속',
  '워크숍',
  '특강',
];

const OPERATION_KEYWORDS = [
  '시간',
  '일정',
  '요일',
  '기간',
  '횟수',
  '회기',
  '주말',
  '평일',
  '오전',
  '오후',
  '접수',
  '신청',
  '운영 방식',
  '진행 방식',
  '대기',
];

const PROMOTION_KEYWORDS = [
  '홍보',
  '알림',
  '안내',
  '모집',
  '참여 확대',
  '참여 기회',
  '접근성',
  '문자',
  '카톡',
  '카카오',
  '온라인 안내',
  '정보 제공',
];

const FACILITY_KEYWORDS = [
  '시설',
  '환경',
  '공간',
  '장소',
  '장비',
  '도구',
  '기자재',
  '카드리더기',
  '리더기',
  '출입카드',
  '출입 시스템',
  '매트',
  '왁스',
  '고장',
  '작동',
  '소음',
  '온도',
  '책상',
  '의자',
  '주차',
  '냉난방',
];

const CONCRETE_SUGGESTION_KEYWORDS = [
  '희망',
  '필요',
  '개선',
  '확대',
  '교육',
  '사례',
  '실천',
  '슈퍼비전',
];

const CATEGORY_ANALYSIS_CONCEPTS = {
  positive_evaluation: [
    { pattern: /자산기반|강점 기반|강점관점/, label: '자산기반·강점관점에 대한 이해 향상' },
    { pattern: /현장|적용|실천/, label: '현장 적용 가능성' },
    { pattern: /강사|선생님|설명|진행/, label: '강사와 교육 진행에 대한 긍정적 평가' },
    { pattern: /내용|교육|강의|수업|사례/, label: '교육 내용에 대한 긍정적 평가' },
  ],
  practice_application: [
    { pattern: /실천 방법|적용 방법|현장 적용|업무 적용/, label: '현장 실천 방법 공유' },
    { pattern: /슈퍼비전/, label: '후속 슈퍼비전 운영' },
    { pattern: /사례 공유|사례 중심/, label: '실천 사례 공유' },
    { pattern: /자산 발굴|자산 연결|지역사회 자산/, label: '지역사회 자산 발굴·연결 실습' },
    { pattern: /실습/, label: '실습 기회 강화' },
  ],
  education_expansion: [
    { pattern: /사례 중심|사례 교육|사례를/, label: '사례 중심 교육' },
    { pattern: /심화|후속/, label: '후속 심화 교육' },
    { pattern: /실습/, label: '추가 실습 운영' },
    { pattern: /슈퍼비전/, label: '슈퍼비전 교육' },
    { pattern: /주말/, label: '주말 교육 운영' },
    { pattern: /ai|인공지능/, label: 'AI 활용 교육' },
  ],
  operation_improvement: [
    { pattern: /시간|오전|오후/, label: '운영 시간 조정' },
    { pattern: /일정|요일|주말|평일/, label: '교육 일정 다양화' },
    { pattern: /횟수|회기|기간/, label: '운영 횟수와 기간 보완' },
    { pattern: /접수|신청|대기/, label: '신청·접수 절차 개선' },
  ],
  promotion_participation: [
    { pattern: /홍보|알림|안내/, label: '교육 정보 안내 강화' },
    { pattern: /모집|참여 확대|참여 기회/, label: '참여 기회 확대' },
    { pattern: /문자|카톡|카카오|온라인/, label: '온라인 홍보 채널 활용' },
  ],
  facility_environment: [
    { pattern: /출입카드|카드리더기|리더기|출입 시스템/, label: '출입 시스템 개선' },
    { pattern: /기자재|장비|도구|매트|왁스/, label: '기자재와 교육 도구 관리' },
    { pattern: /공간|장소|시설|환경|냉난방|소음|온도/, label: '교육 환경 개선' },
    { pattern: /주차|책상|의자/, label: '이용 편의시설 개선' },
  ],
};

function normalizeFreeTextAnswer(answer) {
  return String(answer ?? '')
    .trim()
    .replace(/\uFFFC/g, '')
    .replace(/[.!?。,\s]+$/g, '')
    .toLowerCase();
}

function includesAny(text, keywords) {
  return keywords.some((keyword) => text.includes(keyword));
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

  if (normalizedAnswer.length < 10) {
    return false;
  }

  const compactAnswer = normalizedAnswer.replace(/\s+/g, '');
  if (!/\s/.test(normalizedAnswer) && /^[a-z0-9가-힣]+요?$/.test(compactAnswer)) {
    return false;
  }

  const isSimpleImpression =
    /^(정말\s*)?(좋았|좋다|좋아요|만족|만족한다|만족합니다|감사|감사합니다)[.! ]*$/.test(
      normalizedAnswer,
    );
  if (isSimpleImpression) {
    return false;
  }

  return normalizedAnswer.length >= 20 || includesAny(normalizedAnswer, CONCRETE_SUGGESTION_KEYWORDS);
}

export function classifyFreeTextAnswer(answer) {
  const normalizedAnswer = normalizeFreeTextAnswer(answer);

  if (!normalizedAnswer) {
    return [FREE_TEXT_CATEGORY_RULES[FREE_TEXT_CATEGORY_RULES.length - 1]];
  }

  if (isSimpleFreeTextAnswer(answer)) {
    return [FREE_TEXT_CATEGORY_RULES[FREE_TEXT_CATEGORY_RULES.length - 1]];
  }

  const ruleMap = new Map(FREE_TEXT_CATEGORY_RULES.map((rule) => [rule.key, rule]));
  const hasPositiveContext = includesAny(normalizedAnswer, EXPLICIT_POSITIVE_KEYWORDS);
  const hasRequestContext = includesAny(normalizedAnswer, REQUEST_CONTEXT_KEYWORDS);
  const hasPracticeContext = includesAny(normalizedAnswer, PRACTICE_CONTEXT_KEYWORDS);
  const hasEducationTopic = includesAny(normalizedAnswer, EDUCATION_TOPIC_KEYWORDS);
  const matches = [];

  if (includesAny(normalizedAnswer, FACILITY_KEYWORDS)) {
    matches.push(ruleMap.get('facility_environment'));
  }
  if (includesAny(normalizedAnswer, OPERATION_KEYWORDS) && hasRequestContext) {
    matches.push(ruleMap.get('operation_improvement'));
  }
  if (includesAny(normalizedAnswer, PROMOTION_KEYWORDS) && hasRequestContext) {
    matches.push(ruleMap.get('promotion_participation'));
  }
  if (hasEducationTopic && hasRequestContext) {
    matches.push(ruleMap.get('education_expansion'));
  }
  if (hasPracticeContext && hasRequestContext) {
    matches.push(ruleMap.get('practice_application'));
  }
  if (hasPositiveContext) {
    matches.push(ruleMap.get('positive_evaluation'));
  }

  const uniqueMatches = matches.filter(
    (rule, index, list) => rule && list.findIndex((item) => item?.key === rule.key) === index,
  );

  return uniqueMatches.length > 0
    ? uniqueMatches.slice(0, 2)
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

  const representativeCandidates = [];

  (textResponses ?? []).forEach((item, sourceIndex) => {
    const answer = String(item?.answer ?? '').trim();
    if (!answer) return;

    const categories = classifyFreeTextAnswer(answer);
    categories.forEach((category) => {
      const group = groups.get(category.key) ?? groups.get('etc');
      group.count += 1;
      if (isRepresentativeFreeTextAnswer(answer)) {
        representativeCandidates.push({
          answer,
          categoryKey: group.key,
          sourceIndex,
          isLong: normalizeFreeTextAnswer(answer).length >= 20,
          isConcrete: includesAny(normalizeFreeTextAnswer(answer), CONCRETE_SUGGESTION_KEYWORDS),
        });
      }
    });
  });

  const etcCategory = getEtcCategory();
  const sortedGroups = Array.from(groups.values())
    .filter((group) => group.count > 0)
    .sort((first, second) => {
    if (first.key === etcCategory.key) return 1;
    if (second.key === etcCategory.key) return -1;
    return second.count - first.count;
  });

  const usedAnswers = new Set();
  sortedGroups.forEach((group) => {
    const candidates = representativeCandidates
      .filter((candidate) => candidate.categoryKey === group.key)
      .sort((first, second) => {
        if (first.isLong !== second.isLong) return first.isLong ? -1 : 1;
        if (first.isConcrete !== second.isConcrete) return first.isConcrete ? -1 : 1;
        if (first.answer.length !== second.answer.length) {
          return second.answer.length - first.answer.length;
        }
        return first.sourceIndex - second.sourceIndex;
      });

    candidates.forEach((candidate) => {
      const normalized = normalizeFreeTextAnswer(candidate.answer);
      if (group.examples.length < 3 && !usedAnswers.has(normalized)) {
        group.examples.push(candidate.answer);
        usedAnswers.add(normalized);
      }
    });

    const fullText = (textResponses ?? [])
      .filter((item) =>
        classifyFreeTextAnswer(item?.answer).some((category) => category.key === group.key),
      )
      .map((item) => String(item?.answer ?? ''))
      .join(' ')
      .toLowerCase();
    const concepts = (CATEGORY_ANALYSIS_CONCEPTS[group.key] ?? [])
      .filter((concept) => concept.pattern.test(fullText))
      .map((concept) => concept.label)
      .slice(0, 3);
    group.analysisText = buildCategoryAnalysisText(group.label, concepts);
  });

  return sortedGroups.filter(
    (group) => group.key !== etcCategory.key || group.examples.length > 0,
  );
}

function buildCategoryAnalysisText(label, concepts) {
  if (concepts.length > 0) {
    const key = FREE_TEXT_CATEGORY_RULES.find((rule) => rule.label === label)?.key;
    if (key === 'positive_evaluation') {
      return `${concepts.join(', ')} 등이 확인되었다.`;
    }
    if (key === 'education_expansion') {
      return `${concepts.join(', ')}에 대한 요구가 확인되었다.`;
    }
    if (key === 'practice_application') {
      return `${concepts.join(', ')}에 대한 제안이 확인되었다.`;
    }
    return `${concepts.join(', ')}에 대한 의견이 확인되었다.`;
  }

  const fallback = {
    positive_evaluation: '교육 내용과 참여 경험에 대한 긍정적 의견이 확인되었다.',
    practice_application: '교육 내용을 현장에 적용하기 위한 방법과 지원에 대한 제안이 확인되었다.',
    education_expansion: '후속 교육과 교육 내용 확대에 대한 요구가 확인되었다.',
    operation_improvement: '교육 일정과 운영 방식에 대한 개선 의견이 제시되었다.',
    promotion_participation: '교육 안내와 참여 기회 확대에 대한 의견이 확인되었다.',
    facility_environment: '시설, 기자재 및 교육 환경에 대한 의견이 제시되었다.',
    etc: '기타 다양한 의견이 확인되었다.',
  };
  return fallback[
    FREE_TEXT_CATEGORY_RULES.find((rule) => rule.label === label)?.key ?? 'etc'
  ];
}

function getTopMeaning(row) {
  const title = String(row?.question?.title ?? '').trim();
  if (!title) return '';
  if (/중요|인식|관점|이해/.test(title)) {
    return `'${title}' 문항이 상대적으로 높게 나타나 해당 내용의 중요성과 이해에 대한 긍정적 인식을 확인할 수 있었다.`;
  }
  if (/효과|도움|변화/.test(title)) {
    return `'${title}' 문항이 상대적으로 높게 나타나 교육 효과와 유용성에 대한 긍정적 평가를 확인할 수 있었다.`;
  }
  if (/지속|재참여|추천|의향/.test(title)) {
    return `'${title}' 문항이 상대적으로 높게 나타나 향후 참여와 프로그램 지속에 대한 긍정적 의향을 확인할 수 있었다.`;
  }
  return `'${title}' 영역이 상대적으로 높게 평가되어 해당 영역이 본 사업의 주요 강점으로 확인되었다.`;
}

function getLowMeaning(row) {
  const title = String(row?.question?.title ?? '').trim();
  if (!title) return '';
  if (/실천|적용|활용|발굴|연결/.test(title)) {
    return `반면 '${title}' 문항은 상대적으로 낮게 나타나 교육 내용을 현장에 적용할 수 있도록 실천 지원을 강화할 필요가 있다.`;
  }
  if (/시설|환경|기자재|공간/.test(title)) {
    return `반면 '${title}' 문항은 상대적으로 낮게 나타나 시설과 교육 환경에 대한 개선 검토가 필요하다.`;
  }
  if (/시간|일정|운영|접근/.test(title)) {
    return `반면 '${title}' 문항은 상대적으로 낮게 나타나 운영 방식과 이용 접근성을 보완할 필요가 있다.`;
  }
  return `반면 '${title}' 영역은 상대적으로 낮게 평가되어 향후 운영 개선 시 우선적으로 검토할 필요가 있다.`;
}

function getAverageLevelSentence(totalAverage) {
  const average = formatAverage(totalAverage);
  if (totalAverage >= 4.7) {
    return `전체 평균 만족도는 ${average}점으로 매우 높은 만족 수준을 보였다.`;
  }
  if (totalAverage >= 4) {
    return `전체 평균 만족도는 ${average}점으로 전반적으로 높은 만족 수준을 보였다.`;
  }
  if (totalAverage >= 3) {
    return `전체 평균 만족도는 ${average}점으로 보통 이상의 만족 수준을 보였다.`;
  }
  return `전체 평균 만족도는 ${average}점으로 나타나 전반적인 운영 개선 검토가 필요한 수준으로 확인되었다.`;
}

export function generateFreeTextAnalysisSummary(analytics) {
  const textCount = analytics?.textResponses?.length ?? 0;
  const categories = (analytics?.freeTextCategories ?? [])
    .filter((category) => category.key !== 'etc')
    .slice(0, 4);

  if (textCount === 0) {
    return '수집된 자유의견이 없거나 분석 가능한 주관식 응답이 제한적이다.';
  }
  if (categories.length === 0) {
    return `자유의견은 총 ${textCount}건이 수집되었으며, 구체적인 유형으로 분류하기 어려운 기타 의견이 확인되었다.`;
  }

  const categorySentences = categories.map(
    (category) => `${category.label}(${category.count}건)에서는 ${category.analysisText}`,
  );
  return `자유의견은 총 ${textCount}건이 수집되었다. ${categorySentences.join(' ')}`;
}

export function generateRuleBasedReportSummary(analytics, responseCount) {
  const parts = [`본 조사에는 총 ${responseCount}명이 참여하였다.`];
  const totalAverage = analytics?.totalAverage;

  if (Number.isFinite(totalAverage)) {
    parts.push(getAverageLevelSentence(totalAverage));
    const top = analytics?.topRows?.[0];
    const low = analytics?.lowRows?.[0];
    if (top) parts.push(getTopMeaning(top));
    if (low && (!top || low.question.id !== top.question.id)) {
      parts.push(getLowMeaning(low));
    }
  }

  const topCategories = (analytics?.freeTextCategories ?? [])
    .filter((category) => category.key !== 'etc')
    .slice(0, 3);
  if (topCategories.length > 0) {
    const labels = topCategories.map((category) => category.label).join(', ');
    parts.push(`자유의견에서는 ${labels} 등이 주요 흐름으로 확인되었다.`);
    parts.push(topCategories.map((category) => category.analysisText).join(' '));
  }

  if (Number.isFinite(totalAverage) && totalAverage >= 4) {
    parts.push('종합적으로 본 사업은 참여자의 이해와 만족을 높이는 데 긍정적으로 기여한 것으로 평가되며, 상대적으로 낮게 나타난 영역과 자유의견의 개선 요구를 향후 운영에 반영할 필요가 있다.');
  } else {
    parts.push('종합적으로 조사 결과에서 확인된 강점은 유지하고, 상대적으로 낮게 나타난 영역과 자유의견의 개선 요구를 중심으로 후속 운영 계획을 구체화할 필요가 있다.');
  }

  return parts.join(' ');
}

export function generateRuleBasedImprovementPlan(analytics) {
  const items = [];
  const addItem = (item) => {
    if (item && !items.includes(item) && items.length < 5) items.push(item);
  };
  const categories = analytics?.freeTextCategories ?? [];
  const categoryKeys = new Set(categories.map((category) => category.key));
  const categoryText = (analytics?.textResponses ?? [])
    .map((item) => String(item?.answer ?? ''))
    .join(' ')
    .toLowerCase();
  const lowTitle = String(analytics?.lowRows?.[0]?.question?.title ?? '');

  if (categoryKeys.has('education_expansion')) {
    addItem(/사례/.test(categoryText) ? '사례 중심 교육 확대' : '참여자 요구 기반 심화교육 검토');
  }
  if (categoryKeys.has('practice_application')) {
    addItem('실천 적용 사례 공유 강화');
    if (/슈퍼비전/.test(categoryText)) addItem('후속 슈퍼비전 운영 검토');
  }
  if (/자산|발굴|연결/.test(lowTitle) || /자산 발굴|자산 연결/.test(categoryText)) {
    addItem('지역사회 자산 발굴 및 연결 실습 강화');
  } else if (/실천|적용|활용/.test(lowTitle)) {
    addItem('교육 내용의 현장 적용 지원 강화');
  }
  if (categoryKeys.has('operation_improvement')) {
    addItem('참여 접근성을 고려한 운영 시간 및 일정 조정');
  }
  if (categoryKeys.has('promotion_participation')) {
    addItem('홍보 채널 다각화 및 참여 기회 확대');
  }
  if (categoryKeys.has('facility_environment')) {
    addItem('시설 및 기자재 점검과 교육 환경 개선');
  }
  if (items.length < 3) {
    addItem('만족도 하위 문항을 반영한 세부 운영 보완');
    addItem('참여자 요구 기반 후속 교육 검토');
    addItem('조사 결과의 차기 사업계획 반영');
  }

  return items.map((item, index) => `${index + 1}. ${item}`).join('\n');
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
      // singleChoice 숫자형 옵션(예: "1. 전혀 그렇지 않다")은 getNumericScore()의
      // `^([1-5])\.` 정규식으로만 점수화되므로 min이 항상 1이다. 실제 척도형 문항
      // (linearScale 등)은 settings.min을 따른다(0~10점 척도의 min=0 포함).
      const min = scaleConfig?.min ?? 1;
      const max = row.question.meta?.scaleMax ?? scaleConfig?.max ?? 5;
      const bucketCount = Math.max(0, max - min + 1);
      return {
        question: row.question,
        average,
        count: row.values.length,
        max,
        min,
        distribution: Array.from({ length: bucketCount }, (_, index) => {
          const score = min + index;
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
