import {
  BRANCH_ACTIONS,
  CONDITION_COMBINATORS,
  CONDITION_OPERATORS,
} from '../firebase/surveyConstants';
import {
  isAnswerEmpty,
  isNonResponseQuestionType,
  normalizeQuestionType,
} from '../firebase/surveyNormalize';

const DEFAULT_SECTION_ID = 'default-section';

function normalizeQuestionId(question, index) {
  return question?.id || `legacy-question-${index + 1}`;
}

function normalizeSectionId(section, index) {
  return section?.id || section?.key || `section-${index + 1}`;
}

function getQuestionAnswer(question, answers = {}) {
  return answers?.[question.id] ?? answers?.[question.key] ?? '';
}

function normalizeBranchAction(action) {
  if (action === BRANCH_ACTIONS.GO_TO || action === 'goToQuestion' || action === 'go_to_question') {
    return BRANCH_ACTIONS.GO_TO;
  }

  if (action === BRANCH_ACTIONS.END || action === 'end' || action === '종료') {
    return BRANCH_ACTIONS.END;
  }

  return BRANCH_ACTIONS.NEXT;
}

function getBranchTargetQuestionId(branch = {}) {
  return (
    branch.targetQuestionId ||
    branch.targetId ||
    branch.goToQuestionId ||
    branch.nextQuestionId ||
    ''
  );
}

function answerMatchesRule(answer, rule = {}) {
  const expected = rule.whenOption ?? rule.value ?? rule.answer ?? '';

  if (Array.isArray(answer)) {
    return answer.includes(expected);
  }

  return String(answer ?? '') === String(expected ?? '');
}

function getQuestionBranchOutcome(question, answer) {
  if (!question?.branching?.enabled) {
    return { action: BRANCH_ACTIONS.NEXT, targetQuestionId: '' };
  }

  const matchedRule = (question.branching.rules ?? []).find((rule) =>
    answerMatchesRule(answer, rule),
  );

  if (matchedRule) {
    return {
      action: normalizeBranchAction(matchedRule.action),
      targetQuestionId: matchedRule.targetQuestionId ?? '',
    };
  }

  return {
    action: normalizeBranchAction(question.branching.fallbackAction),
    targetQuestionId: question.branching.fallbackTargetQuestionId ?? '',
  };
}

function collectBranchTargetIds(questions = []) {
  return questions.reduce((result, question) => {
    const targetIds = new Set();

    (question.branching?.rules ?? []).forEach((rule) => {
      const targetQuestionId = getBranchTargetQuestionId(rule);

      if (normalizeBranchAction(rule.action) === BRANCH_ACTIONS.GO_TO && targetQuestionId) {
        targetIds.add(targetQuestionId);
      }
    });

    if (question.branching?.fallbackTargetQuestionId) {
      targetIds.add(question.branching.fallbackTargetQuestionId);
    }

    [question.optionBranches, question.optionBranching, question.branches].forEach((source) => {
      if (Array.isArray(source)) {
        source.forEach((branch) => {
          const targetQuestionId = getBranchTargetQuestionId(branch);
          if (targetQuestionId) targetIds.add(targetQuestionId);
        });
      } else if (source && typeof source === 'object') {
        Object.values(source).forEach((branch) => {
          const targetQuestionId = getBranchTargetQuestionId(branch);
          if (targetQuestionId) targetIds.add(targetQuestionId);
        });
      }
    });

    if (targetIds.size > 0 && question.id) {
      result.set(question.id, targetIds);
    }

    return result;
  }, new Map());
}

export function normalizeQuestionsAndSections(survey = {}) {
  const safeSurvey = survey && typeof survey === 'object' ? survey : {};
  const rawQuestions = Array.isArray(safeSurvey.questions) ? safeSurvey.questions : [];
  const questions = rawQuestions.map((question, index) => ({
    ...question,
    id: normalizeQuestionId(question, index),
    type: normalizeQuestionType(question?.type),
  }));
  const pageBreaks = Array.isArray(safeSurvey.pageBreaks) ? safeSurvey.pageBreaks : [];
  const rawSections = Array.isArray(safeSurvey.sections) ? safeSurvey.sections : [];
  const pageBreakSections =
    rawSections.length === 0 && pageBreaks.length > 0
      ? pageBreaks.reduce(
          (result, pageBreak, index) => {
            const currentSection = result[result.length - 1];
            currentSection.title = currentSection.title || `섹션 ${index + 1}`;

            if (pageBreak.afterQuestionId) {
              const breakIndex = questions.findIndex((question) => question.id === pageBreak.afterQuestionId);
              currentSection.questionIds = questions
                .slice(result.consumedIndex ?? 0, breakIndex + 1)
                .map((question) => question.id);
              result.consumedIndex = breakIndex + 1;
            }

            result.push({
              id: pageBreak.id || `page-break-section-${index + 2}`,
              title: pageBreak.title || `섹션 ${index + 2}`,
              description: pageBreak.description ?? '',
              questionIds: [],
            });

            return result;
          },
          [{ id: DEFAULT_SECTION_ID, title: '섹션 1', description: '', questionIds: [] }],
        )
      : [];
  const normalizedRawSections = rawSections.length > 0 ? rawSections : pageBreakSections;
  const hasSections = normalizedRawSections.length > 0;
  const sections = hasSections
    ? normalizedRawSections.map((section, index) => ({
        id: normalizeSectionId(section, index),
        key: section.key ?? '',
        pageId: section.pageId ?? '',
        pageKey: section.pageKey ?? '',
        title: section.title || `섹션 ${index + 1}`,
        description: section.description ?? '',
        questionIds: Array.isArray(section.questionIds) ? section.questionIds : [],
        pageEndAction: section.pageEndAction ?? 'next',
        pageEndTargetSectionId: section.pageEndTargetSectionId ?? '',
        visibilityConditions: Array.isArray(section.visibilityConditions)
          ? section.visibilityConditions
          : [],
        visibilityCombinator: section.visibilityCombinator ?? CONDITION_COMBINATORS.AND,
      }))
    : [{ id: DEFAULT_SECTION_ID, title: '섹션 1', description: '', questionIds: [] }];

  if (rawSections.length === 0 && pageBreakSections.length > 0) {
    const lastSection = sections[sections.length - 1];
    const assignedQuestionIds = new Set(sections.flatMap((section) => section.questionIds));
    lastSection.questionIds = [
      ...(lastSection.questionIds ?? []),
      ...questions.filter((question) => !assignedQuestionIds.has(question.id)).map((question) => question.id),
    ];
  }

  const fallbackSectionId = sections[0]?.id ?? DEFAULT_SECTION_ID;
  const sectionIds = new Set(sections.map((section) => section.id));
  const sectionAliasToId = sections.reduce((result, section) => {
    [section.id, section.key, section.pageId, section.pageKey].forEach((alias) => {
      if (alias) {
        result.set(alias, section.id);
      }
    });

    return result;
  }, new Map());
  const sectionOrder = sections.map((section) => section.id);

  // 1차: valid sectionId면 유지, invalid이면 null 표시
  const questionsWithNullFallback = questions.map((question) => {
    const resolvedSectionId =
      sectionAliasToId.get(question.sectionId) ??
      sectionAliasToId.get(question.pageId) ??
      sectionAliasToId.get(question.sectionKey) ??
      sectionAliasToId.get(question.pageKey) ??
      null;

    return {
      ...question,
      sectionId: sectionIds.has(resolvedSectionId) ? resolvedSectionId : null,
    };
  });

  // 2차: null인 질문 → 순서 기반 fallback (앞 질문의 section 이후 빈 section에 배정)
  const assignedSectionIds = new Set(
    questionsWithNullFallback.filter((q) => q.sectionId !== null).map((q) => q.sectionId),
  );

  const questionsWithSections = questionsWithNullFallback.map((question, qIndex) => {
    if (question.sectionId !== null) {
      return question;
    }

    // 앞쪽에서 가장 가까운 유효 sectionId 탐색
    let prevSectionId = fallbackSectionId;
    for (let i = qIndex - 1; i >= 0; i -= 1) {
      if (questionsWithNullFallback[i].sectionId !== null) {
        prevSectionId = questionsWithNullFallback[i].sectionId;
        break;
      }
    }

    // 해당 section 이후 아직 질문이 없는 빈 section 탐색
    const prevIdx = sectionOrder.indexOf(prevSectionId);
    for (let si = prevIdx + 1; si < sectionOrder.length; si += 1) {
      const candidateId = sectionOrder[si];
      if (!assignedSectionIds.has(candidateId)) {
        return { ...question, sectionId: candidateId };
      }
    }

    // 빈 section을 찾지 못한 경우 앞 section에 그대로 배정
    return { ...question, sectionId: prevSectionId };
  });
  const questionById = new Map(questionsWithSections.map((question) => [question.id, question]));
  const assignedIds = new Set();
  const sectionToQuestionIdsMap = new Map();

  sections.forEach((section) => {
    const orderedIds = [];

    section.questionIds.forEach((questionId) => {
      if (questionById.has(questionId) && !assignedIds.has(questionId)) {
        orderedIds.push(questionId);
        assignedIds.add(questionId);
      }
    });

    questionsWithSections.forEach((question) => {
      if (question.sectionId === section.id && !assignedIds.has(question.id)) {
        orderedIds.push(question.id);
        assignedIds.add(question.id);
      }
    });

    sectionToQuestionIdsMap.set(section.id, orderedIds);
  });

  const orderedQuestions = sections.flatMap((section) =>
    (sectionToQuestionIdsMap.get(section.id) ?? []).map((questionId) => questionById.get(questionId)),
  ).filter(Boolean);

  return { sections, questions: orderedQuestions, questionById, sectionToQuestionIdsMap };
}

function normalizeComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim());
  }

  return String(value ?? '').trim();
}

function evaluateCondition(condition = {}, answers = {}) {
  const answer = normalizeComparableValue(answers[condition.questionId]);
  const expected = String(condition.value ?? '').trim();

  switch (condition.operator) {
    case CONDITION_OPERATORS.NOT_EQUALS:
      return Array.isArray(answer) ? !answer.includes(expected) : answer !== expected;
    case CONDITION_OPERATORS.INCLUDES:
      return Array.isArray(answer) ? answer.includes(expected) : answer.includes(expected);
    case CONDITION_OPERATORS.NOT_INCLUDES:
      return Array.isArray(answer) ? !answer.includes(expected) : !answer.includes(expected);
    case CONDITION_OPERATORS.IS_EMPTY:
      return Array.isArray(answer) ? answer.length === 0 : !answer;
    case CONDITION_OPERATORS.IS_NOT_EMPTY:
      return Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
    case CONDITION_OPERATORS.EQUALS:
    default:
      return Array.isArray(answer) ? answer.includes(expected) : answer === expected;
  }
}

function evaluateConditions(conditions = [], combinator = CONDITION_COMBINATORS.AND, answers = {}) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return true;
  }

  return combinator === CONDITION_COMBINATORS.OR
    ? conditions.some((condition) => evaluateCondition(condition, answers))
    : conditions.every((condition) => evaluateCondition(condition, answers));
}

function createNextSectionMap(sections = []) {
  return sections.reduce((result, section, index) => {
    if (section.pageEndAction === 'end') {
      result.set(section.id, '');
      return result;
    }

    if (section.pageEndAction === 'go_to_section' && section.pageEndTargetSectionId) {
      result.set(section.id, section.pageEndTargetSectionId);
      return result;
    }

    result.set(section.id, sections[index + 1]?.id ?? '');
    return result;
  }, new Map());
}

export function getResponseMode(survey = {}) {
  const safeSurvey = survey && typeof survey === 'object' ? survey : {};
  const sectionCount = Array.isArray(safeSurvey.sections) ? safeSurvey.sections.length : 0;
  const pageBreakCount = Array.isArray(safeSurvey.pageBreaks) ? safeSurvey.pageBreaks.length : 0;

  return sectionCount > 1 || pageBreakCount > 0 ? 'paged' : 'single';
}

export function buildVisibleQuestionFlow({ survey, answers = {} }) {
  const { sections, questions, questionById, sectionToQuestionIdsMap } =
    normalizeQuestionsAndSections(survey);
  const visibleSectionsByCondition = sections.filter((section) =>
    evaluateConditions(section.visibilityConditions, section.visibilityCombinator, answers),
  );
  const visibleSectionIdSet = new Set(visibleSectionsByCondition.map((section) => section.id));
  const orderedQuestions = questions.filter((question) => visibleSectionIdSet.has(question.sectionId));
  const questionToSectionMap = new Map(orderedQuestions.map((question) => [question.id, question.sectionId]));
  const questionIndexMap = new Map(orderedQuestions.map((question, index) => [question.id, index]));
  const branchTargetGroups = collectBranchTargetIds(orderedQuestions);
  const branchSourceByTargetId = new Map();

  branchTargetGroups.forEach((targetIds, sourceQuestionId) => {
    targetIds.forEach((targetQuestionId) => {
      if (!branchSourceByTargetId.has(targetQuestionId)) {
        branchSourceByTargetId.set(targetQuestionId, sourceQuestionId);
      }
    });
  });

  const visibleQuestionIds = [];
  const visibleSectionIds = [];
  const visitedQuestionIds = new Set();
  const visibleQuestionIdSet = new Set();
  const visibleSectionIdSetForFlow = new Set();
  const nextSectionMap = createNextSectionMap(visibleSectionsByCondition);
  let termination = null;
  let activeBranchSourceId = '';
  let currentQuestion = orderedQuestions[0] ?? null;

  while (currentQuestion && !visitedQuestionIds.has(currentQuestion.id)) {
    const currentIndex = questionIndexMap.get(currentQuestion.id) ?? -1;
    const currentSection = visibleSectionsByCondition.find(
      (section) => section.id === currentQuestion.sectionId,
    );
    const currentSectionQuestionIds = sectionToQuestionIdsMap.get(currentQuestion.sectionId) ?? [];
    const currentSectionVisibleQuestionIds = currentSectionQuestionIds.filter((questionId) =>
      questionIndexMap.has(questionId),
    );
    const currentSectionQuestionIndex = currentSectionVisibleQuestionIds.indexOf(currentQuestion.id);
    const isLastQuestionInSection =
      currentSectionQuestionIndex >= 0 &&
      currentSectionQuestionIndex === currentSectionVisibleQuestionIds.length - 1;
    const currentBranchSourceId = branchSourceByTargetId.get(currentQuestion.id);
    let fallbackNextQuestion = orderedQuestions[currentIndex + 1] ?? null;

    if (activeBranchSourceId && currentBranchSourceId === activeBranchSourceId) {
      const branchTargetIds = branchTargetGroups.get(activeBranchSourceId) ?? new Set();
      let nextIndex = currentIndex + 1;

      while (nextIndex < orderedQuestions.length && branchTargetIds.has(orderedQuestions[nextIndex]?.id)) {
        nextIndex += 1;
      }

      fallbackNextQuestion = orderedQuestions[nextIndex] ?? null;
    }

    visitedQuestionIds.add(currentQuestion.id);
    visibleQuestionIds.push(currentQuestion.id);
    visibleQuestionIdSet.add(currentQuestion.id);

    if (currentSection && !visibleSectionIdSetForFlow.has(currentSection.id)) {
      visibleSectionIdSetForFlow.add(currentSection.id);
      visibleSectionIds.push(currentSection.id);
    }

    const currentAnswer = getQuestionAnswer(currentQuestion, answers);

    if (!isNonResponseQuestionType(currentQuestion.type)) {
      if (
        isAnswerEmpty({ ...currentQuestion, required: true }, currentAnswer) &&
        (currentQuestion.branching?.enabled || branchTargetGroups.has(currentQuestion.id))
      ) {
        break;
      }

      const branchOutcome = getQuestionBranchOutcome(currentQuestion, currentAnswer);

      if (branchOutcome.action === BRANCH_ACTIONS.END) {
        termination = {
          sectionId: currentQuestion.sectionId,
          questionId: currentQuestion.id,
          message: currentQuestion.description || '조건에 따라 응답이 종료되었습니다.',
        };
        break;
      }

      if (
        branchOutcome.action === BRANCH_ACTIONS.GO_TO &&
        branchOutcome.targetQuestionId &&
        questionById.has(branchOutcome.targetQuestionId) &&
        questionIndexMap.has(branchOutcome.targetQuestionId)
      ) {
        activeBranchSourceId = currentQuestion.id;
        currentQuestion = questionById.get(branchOutcome.targetQuestionId);
        continue;
      }
    }

    if (!currentBranchSourceId || currentBranchSourceId !== activeBranchSourceId) {
      activeBranchSourceId = '';
    }

    if (isLastQuestionInSection && currentSection) {
      if (currentSection.pageEndAction === 'end') {
        termination = {
          sectionId: currentSection.id,
          questionId: currentQuestion.id,
          message: currentSection.terminationMessage || '여기서 응답이 종료되었습니다.',
        };
        break;
      }

      if (
        currentSection.pageEndAction === 'go_to_section' &&
        currentSection.pageEndTargetSectionId &&
        currentSection.pageEndTargetSectionId !== currentSection.id
      ) {
        const targetQuestionId = (sectionToQuestionIdsMap.get(currentSection.pageEndTargetSectionId) ?? [])
          .find((questionId) => questionIndexMap.has(questionId));

        if (targetQuestionId && questionById.has(targetQuestionId)) {
          currentQuestion = questionById.get(targetQuestionId);
          continue;
        }
      }

      // fallbackNextQuestion이 없어도 다음 visible section에 질문이 있으면 복구
      // (pageEndAction === 'submit'이거나 sectionId 오염으로 orderedQuestions에 누락된 경우 대비)
      if (!fallbackNextQuestion) {
        const currentVisibleSectionIdx = visibleSectionsByCondition.findIndex(
          (s) => s.id === currentSection.id,
        );
        let recovered = null;

        for (let si = currentVisibleSectionIdx + 1; si < visibleSectionsByCondition.length; si += 1) {
          const nextSec = visibleSectionsByCondition[si];
          const nextSecQuestionId = (sectionToQuestionIdsMap.get(nextSec.id) ?? [])
            .find((qId) => questionById.has(qId) && !visitedQuestionIds.has(qId));

          if (nextSecQuestionId) {
            recovered = questionById.get(nextSecQuestionId);
            break;
          }
        }

        if (recovered) {
          currentQuestion = recovered;
          continue;
        }

        // 진짜 마지막 section이면 종료
        if (currentSection.pageEndAction === 'submit') {
          break;
        }
      }
    }

    currentQuestion = fallbackNextQuestion;
  }

  const allQuestionIds = orderedQuestions
    .filter((question) => !isNonResponseQuestionType(question.type))
    .map((question) => question.id);
  const skippedQuestionIds = allQuestionIds.filter((questionId) => !visibleQuestionIdSet.has(questionId));
  const visibleQuestions = visibleQuestionIds.map((questionId) => questionById.get(questionId)).filter(Boolean);
  const groupedSections = visibleSectionIds.map((sectionId) => {
    const section = visibleSectionsByCondition.find((item) => item.id === sectionId);
    return {
      ...section,
      questions: visibleQuestions.filter((question) => question.sectionId === sectionId),
    };
  }).filter((section) => section.questions.length > 0);

  return {
    visibleQuestionIds,
    visibleSectionIds,
    questionToSectionMap,
    sectionToQuestionIdsMap,
    nextSectionMap,
    skippedQuestionIds,
    visibleQuestions,
    visibleSections: visibleSectionsByCondition.filter((section) => visibleSectionIds.includes(section.id)),
    groupedSections,
    termination,
    responseMode: getResponseMode(survey),
  };
}
