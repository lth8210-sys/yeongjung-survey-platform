import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { useAuth } from '../contexts/AuthContext';
import {
  formatPublicDateTime,
  getClosedSurveyMessage,
  getDraftSurveyMessage,
  getPublicSurveyState,
  getQuestionOptionItems,
  getPublicSurvey,
  getScaleQuestionConfig,
  getQuotaSummary,
  getReceptionPeriodText,
  isApplicationFormType,
  submitSurveyResponse,
} from '../firebase/surveys';
import { OTHER_OPTION_VALUE, QUESTION_TYPES } from '../firebase/surveyConstants';
import {
  isAnswerEmpty,
  isNonResponseQuestionType,
  isScaleQuestionType,
  normalizeQuestionType,
} from '../firebase/surveyNormalize';
import { buildQuestionDisplayMap } from '../utils/questionNumbering';
import {
  buildVisibleQuestionFlow,
  getResponseMode,
  normalizeQuestionsAndSections,
} from '../utils/responseFlow';
import { debounce } from '../utils/debounce';
import { cleanupOldDrafts } from '../utils/cleanupDrafts';

const responseChoiceRowStyle = {
  display: 'grid',
  gridTemplateColumns: '24px minmax(0, 1fr)',
  alignItems: 'start',
  columnGap: '12px',
  width: '100%',
  minWidth: 0,
  padding: '12px 14px',
  borderRadius: '16px',
  background: '#f7f9fc',
};

const responseChoiceInputStyle = {
  margin: '4px 0 0 0',
  flexShrink: 0,
};

const responseChoiceTextStyle = {
  display: 'block',
  width: '100%',
  minWidth: 0,
  whiteSpace: 'normal',
  wordBreak: 'keep-all',
  overflowWrap: 'break-word',
  writingMode: 'horizontal-tb',
  textOrientation: 'mixed',
  textAlign: 'left',
  lineHeight: 1.5,
};

function getNormalizedQuestionType(question = {}) {
  return normalizeQuestionType(question?.type);
}

function SurveyTableBlocks({ tableBlocks = [] }) {
  const visibleBlocks = Array.isArray(tableBlocks)
    ? tableBlocks.filter((block) => Array.isArray(block?.columns) && Array.isArray(block?.rows))
    : [];

  if (visibleBlocks.length === 0) {
    return null;
  }

  return (
    <div className="survey-table-blocks">
      {visibleBlocks.map((block, blockIndex) => (
        <div className="survey-table-block" key={block.id || `table-block-${blockIndex}`}>
          {block.title && <strong>{block.title}</strong>}
          <div className="markdown-table-scroll">
            <table className="markdown-table">
              <thead>
                <tr>
                  {block.columns.map((column, columnIndex) => (
                    <th key={`column-${columnIndex}`}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`row-${rowIndex}`}>
                    {block.columns.map((_, cellIndex) => (
                      <td key={`cell-${rowIndex}-${cellIndex}`}>{row[cellIndex] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

function SurveyDescription({ survey, fallback }) {
  const description = survey?.description?.trim?.();

  if (!description && (!Array.isArray(survey?.tableBlocks) || survey.tableBlocks.length === 0)) {
    return <p className="response-survey-description">{fallback}</p>;
  }

  return (
    <div className="response-description-card">
      {description && (
        <MarkdownRenderer
          className="response-survey-description"
          text={description}
        />
      )}
      <SurveyTableBlocks tableBlocks={survey?.tableBlocks} />
    </div>
  );
}

function SurveyResponsePage() {
  const { firebaseStatusMessage, isFirebaseConfigured, user } = useAuth();
  const { surveyId } = useParams();
  const [survey, setSurvey] = useState(null);
  const [answers, setAnswers] = useState({});
  const [otherInputs, setOtherInputs] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [message, setMessage] = useState('');
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [pendingDraft, setPendingDraft] = useState(null);
  const [draftChoiceVisible, setDraftChoiceVisible] = useState(false);
  const [draftInitialized, setDraftInitialized] = useState(false);
  const [lastQuestionId, setLastQuestionId] = useState('');
  const [renderedQuestionIds, setRenderedQuestionIds] = useState(() => new Set());
  const [autosaveState, setAutosaveState] = useState({
    status: 'idle',
    savedAt: null,
  });

  const publicState = getPublicSurveyState(survey);
  const isDraftSurvey = publicState.key === 'draft';
  const isClosedSurvey = publicState.key === 'closed';
  const isScheduledSurvey = publicState.key === 'scheduled';
  const isResponseBlocked = !publicState.canSubmit;
  const closedMessage = getClosedSurveyMessage(survey?.formType);
  const draftMessage = getDraftSurveyMessage(survey?.formType);
  const quotaSummary = getQuotaSummary(survey);
  const getQuestionKey = (question, index) => question?.id || `legacy-question-${index + 1}`;
  const applicationForm = isApplicationFormType(survey?.formType);
  const draftUserId = user?.uid ?? 'anonymous';
  const draftStorageKey = surveyId ? `draft_${surveyId}_${draftUserId}` : '';
  const questionDisplayMap = useMemo(
    () => buildQuestionDisplayMap(survey?.questions ?? [], survey?.sections ?? []),
    [survey?.questions, survey?.sections],
  );
  const submitLockedRef = useRef(false);
  const clientSubmitIdRef = useRef('');

  const createClientSubmitId = () => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `client-${crypto.randomUUID()}`;
    }

    return `client-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  };

  const getCurrentClientSubmitId = () => {
    if (!clientSubmitIdRef.current) {
      clientSubmitIdRef.current = createClientSubmitId();
    }

    return clientSubmitIdRef.current;
  };

  const getSubmitErrorMessage = (error) => {
    if (error?.code === 'already-exists') {
      return error.message || '이미 접수된 신청 정보가 있어 다시 신청할 수 없습니다.';
    }

    if (error?.code === 'resource-exhausted') {
      if (String(error?.message ?? '').includes('마감')) {
        return error.message;
      }

      return `${closedMessage} 정원이 모두 찼습니다.`;
    }

    if (error?.code === 'failed-precondition') {
      return error.message || '현재 응답을 받을 수 없는 폼입니다. 상태와 정원 정보를 확인해주세요.';
    }

    if (
      error?.code === 'permission-denied' ||
      String(error?.message ?? '').includes('Missing or insufficient permissions')
    ) {
      return '응답 저장 권한이 없습니다. Firestore 규칙과 설문 상태를 확인해주세요.';
    }

    return error.message || '응답 저장에 실패했습니다. 잠시 후 다시 시도해주세요.';
  };

  const readLocalDraft = useCallback(() => {
    if (!draftStorageKey || typeof window === 'undefined') {
      return null;
    }

    try {
      const rawDraft = window.localStorage.getItem(draftStorageKey);
      return rawDraft ? JSON.parse(rawDraft) : null;
    } catch (error) {
      console.error('로컬 임시저장 불러오기 실패:', error);
      return null;
    }
  }, [draftStorageKey]);

  const writeLocalDraft = useCallback((draft) => {
    if (!draftStorageKey || typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
  }, [draftStorageKey]);

  const removeLocalDraft = useCallback(() => {
    if (!draftStorageKey || typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch (error) {
      console.error('로컬 임시저장 삭제 실패:', error);
    }
  }, [draftStorageKey]);

  useEffect(() => {
    cleanupOldDrafts('');
  }, []);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setMessage(firebaseStatusMessage || 'Firebase 설정이 필요합니다.');
      setLoading(false);
      return;
    }

    async function loadSurvey() {
      try {
        const result = await getPublicSurvey(surveyId);
        setSurvey(result);

        if (getPublicSurveyState(result).key === 'draft') {
          setMessage(getDraftSurveyMessage(result?.formType));
        } else if (getPublicSurveyState(result).key === 'closed') {
          setMessage(getClosedSurveyMessage(result?.formType));
        } else if (getPublicSurveyState(result).key === 'scheduled') {
          setMessage(getPublicSurveyState(result).message);
        }
      } catch (error) {
        if (error?.code === 'permission-denied') {
          setMessage(getDraftSurveyMessage());
        } else {
          setMessage(error.message || '설문 정보를 불러오지 못했습니다.');
        }
      } finally {
        setLoading(false);
      }
    }

    loadSurvey();
  }, [firebaseStatusMessage, isFirebaseConfigured, surveyId]);

  useEffect(() => {
    if (!survey?.id || draftInitialized || isDraftSurvey || isClosedSurvey || isScheduledSurvey) {
      return;
    }

    function loadDraft() {
      const localDraft = readLocalDraft();

      if (localDraft?.answers && Object.keys(localDraft.answers).length > 0) {
        setPendingDraft(localDraft);
        setDraftChoiceVisible(true);
      }

      setDraftInitialized(true);
    }

    loadDraft();
  }, [
    draftInitialized,
    isClosedSurvey,
    isDraftSurvey,
    isScheduledSurvey,
    readLocalDraft,
    survey?.id,
  ]);

  const handleChange = (questionKey, value) => {
    setLastQuestionId(questionKey);
    setAnswers((current) => ({
      ...current,
      [questionKey]: value,
    }));
    setFieldErrors((current) => ({
      ...current,
      [questionKey]: '',
    }));
  };

  const handleOtherInputChange = (questionKey, value) => {
    setLastQuestionId(questionKey);
    setOtherInputs((current) => ({
      ...current,
      [questionKey]: value,
    }));
    setFieldErrors((current) => ({
      ...current,
      [questionKey]: '',
    }));
  };

  const handleMultipleChoiceChange = (questionKey, option, checked) => {
    setLastQuestionId(questionKey);
    setAnswers((current) => {
      const currentValues = Array.isArray(current[questionKey]) ? current[questionKey] : [];
      const nextValues = checked
        ? [...currentValues, option]
        : currentValues.filter((value) => value !== option);

      return {
        ...current,
        [questionKey]: nextValues,
      };
    });

    setFieldErrors((current) => ({
      ...current,
      [questionKey]: '',
    }));
  };

  const handleContinueDraft = () => {
    setAnswers(pendingDraft?.answers ?? {});
    setLastQuestionId(pendingDraft?.lastQuestionId ?? '');
    setDraftChoiceVisible(false);
    setPendingDraft(null);
    setAutosaveState({
      status: 'saved',
      savedAt: pendingDraft?.updatedAt?.toDate?.() ?? pendingDraft?.updatedAt ?? new Date(),
    });
  };

  const handleStartNewDraft = () => {
    setAnswers({});
    setOtherInputs({});
    setFieldErrors({});
    setLastQuestionId('');
    setDraftChoiceVisible(false);
    setPendingDraft(null);
    removeLocalDraft();
  };

  const getQuestionIndex = (question) => {
    const index = survey?.questions?.findIndex((item) => item.id === question?.id) ?? -1;
    return index >= 0 ? index : 0;
  };

  const resolveAnswer = (question, index) => {
    const questionKey = getQuestionKey(question, index);
    const normalizedType = getNormalizedQuestionType(question);
    const rawAnswer = answers[questionKey];
    const otherValue = otherInputs[questionKey]?.trim() ?? '';

    if (normalizedType === QUESTION_TYPES.CONSENT_CHECKBOX) {
      return Boolean(rawAnswer);
    }

    if (normalizedType === QUESTION_TYPES.MULTIPLE_CHOICE) {
      const selectedValues = Array.isArray(rawAnswer) ? rawAnswer : [];
      const valuesWithoutOther = selectedValues.filter((value) => value !== OTHER_OPTION_VALUE);

      if (selectedValues.includes(OTHER_OPTION_VALUE) && otherValue) {
        return [...valuesWithoutOther, otherValue];
      }

      return valuesWithoutOther;
    }

    if (
      (normalizedType === QUESTION_TYPES.SINGLE_CHOICE ||
        normalizedType === QUESTION_TYPES.DROPDOWN) &&
      rawAnswer === OTHER_OPTION_VALUE
    ) {
      return otherValue;
    }

    return rawAnswer ?? '';
  };

  const resolvedAnswersByQuestionId = useMemo(() => {
    if (!survey?.questions?.length) {
      return {};
    }

    return Object.fromEntries(
      survey.questions.map((question, index) => [getQuestionKey(question, index), resolveAnswer(question, index)]),
    );
  }, [answers, otherInputs, survey]);

  const responseMode = useMemo(() => getResponseMode(survey), [survey]);
  const normalizedSurveyStructure = useMemo(
    () => normalizeQuestionsAndSections(survey),
    [survey],
  );
  const visibleFlow = useMemo(
    () => buildVisibleQuestionFlow({ survey, answers: resolvedAnswersByQuestionId }),
    [resolvedAnswersByQuestionId, survey],
  );
  const activeQuestions = visibleFlow.visibleQuestions ?? [];
  const isRenderableQuestion = useCallback(
    (question) =>
      Boolean(question?.id) &&
      question.meta?.consentTemplate !== 'base' &&
      !isNonResponseQuestionType(getNormalizedQuestionType(question)),
    [],
  );
  const allRenderableQuestions = useMemo(
    () => (normalizedSurveyStructure.questions ?? []).filter((question) => isRenderableQuestion(question)),
    [isRenderableQuestion, normalizedSurveyStructure.questions],
  );
  const displayQuestions = useMemo(() => {
    const activeQuestionIds = new Set(activeQuestions.map((question) => question.id));
    return [
      ...activeQuestions,
      ...allRenderableQuestions.filter((question) => !activeQuestionIds.has(question.id)),
    ];
  }, [activeQuestions, allRenderableQuestions]);
  const visibleQuestions = displayQuestions.filter(
    (question) =>
      getNormalizedQuestionType(question) !== QUESTION_TYPES.CONSENT_CHECKBOX &&
      question.meta?.consentTemplate !== 'base',
  );
  const consentQuestions = displayQuestions.filter(
    (question) =>
      getNormalizedQuestionType(question) === QUESTION_TYPES.CONSENT_CHECKBOX &&
      question.meta?.consentTemplate !== 'base',
  );
  const consentInfoBlocks = displayQuestions.filter(
    (question) => question.meta?.consentTemplate === 'base',
  );
  const visibleSections = visibleFlow.visibleSections ?? [];
  const flowGroupedSections = visibleFlow.groupedSections ?? [];
  const questionById = useMemo(
    () => new Map(activeQuestions.map((question) => [question.id, question])),
    [activeQuestions],
  );
  const groupedSections = useMemo(() => {
    const appendUngroupedRenderableQuestions = (sectionsToCheck) => {
      const includedQuestionIds = new Set(
        sectionsToCheck.flatMap((section) => (section.questions ?? []).map((question) => question.id)),
      );
      const missingQuestions = allRenderableQuestions.filter(
        (question) => !includedQuestionIds.has(question.id),
      );

      if (missingQuestions.length === 0) {
        return sectionsToCheck;
      }

      return [
        ...sectionsToCheck,
        {
          id: 'unclassified-renderable-questions',
          title: '미분류 질문',
          description: '페이지 정보가 맞지 않아 자동으로 모은 질문입니다.',
          questions: missingQuestions,
          pageEndAction: 'next',
        },
      ];
    };

    if (responseMode !== 'paged') {
      return appendUngroupedRenderableQuestions(flowGroupedSections);
    }

    const sectionQuestionMap = visibleFlow.sectionToQuestionIdsMap;

    if (!sectionQuestionMap || visibleSections.length === 0) {
      return appendUngroupedRenderableQuestions(flowGroupedSections);
    }

    const sectionsByWholeOrder = visibleSections.map((section) => {
      const sectionQuestions = (sectionQuestionMap.get(section.id) ?? [])
        .map((questionId) => questionById.get(questionId))
        .filter(Boolean);

      return {
        ...section,
        questions: sectionQuestions,
      };
    }).filter((section) => section.questions.length > 0);

    return appendUngroupedRenderableQuestions(
      sectionsByWholeOrder.length > 0 ? sectionsByWholeOrder : flowGroupedSections,
    );
  }, [
    allRenderableQuestions,
    flowGroupedSections,
    questionById,
    responseMode,
    visibleFlow.sectionToQuestionIdsMap,
    visibleSections,
  ]);
  const currentSection = responseMode === 'paged'
    ? groupedSections[Math.min(currentSectionIndex, Math.max(groupedSections.length - 1, 0))]
    : null;
  const currentSectionSafeIndex =
    responseMode === 'paged' ? Math.min(currentSectionIndex, Math.max(groupedSections.length - 1, 0)) : 0;
  const nextSection = responseMode === 'paged'
    ? groupedSections[currentSectionSafeIndex + 1] ?? null
    : null;
  const remainingSections = responseMode === 'paged'
    ? groupedSections.slice(currentSectionSafeIndex + 1)
    : [];
  const remainingQuestionsAfterCurrentSection = remainingSections.flatMap((section) => section.questions ?? []);
  const nextQuestionSectionIndex = responseMode === 'paged'
    ? groupedSections.findIndex(
        (section, index) =>
          index > currentSectionSafeIndex &&
          (section.questions ?? []).some((question) => isRenderableQuestion(question)),
      )
    : -1;

  // activeQuestions 교차검증: groupedSections에 포함되지 않은 active 응답형 질문이 있으면
  // 아직 표시되지 않은 질문이 남은 것이므로 마지막 섹션으로 판단하지 않는다
  const groupedQuestionIds = useMemo(
    () => new Set(groupedSections.flatMap((s) => (s.questions ?? []).map((q) => q.id))),
    [groupedSections],
  );
  const shownQuestionIds = useMemo(
    () =>
      new Set(
        groupedSections
          .slice(0, currentSectionSafeIndex + 1)
          .flatMap((s) => (s.questions ?? []).map((q) => q.id)),
      ),
    [groupedSections, currentSectionSafeIndex],
  );
  const remainingActiveResponseQuestions = useMemo(
    () =>
      activeQuestions.filter(
        (q) =>
          isRenderableQuestion(q) &&
          !shownQuestionIds.has(q.id),
      ),
    [activeQuestions, isRenderableQuestion, shownQuestionIds],
  );
  // groupedSections에 없는 active 질문이 있으면 탐지
  const ungroupedActiveResponseQuestions = useMemo(
    () =>
      activeQuestions.filter(
        (q) =>
          isRenderableQuestion(q) &&
          !groupedQuestionIds.has(q.id),
      ),
    [activeQuestions, groupedQuestionIds, isRenderableQuestion],
  );

  const isLastReachableSection =
    responseMode !== 'paged' ||
    (nextQuestionSectionIndex === -1 && remainingActiveResponseQuestions.length === 0);
  const canSubmitCurrentPage =
    responseMode !== 'paged' || (isLastReachableSection && !visibleFlow.termination);
  const responseQuestions = responseMode === 'paged'
    ? groupedSections.flatMap((section) => section.questions ?? [])
    : displayQuestions;
  const responseQuestionKeys = useMemo(
    () =>
      new Set(
        responseQuestions.map((question) =>
          getQuestionKey(
            question,
            survey?.questions?.findIndex((item) => item.id === question.id) ?? 0,
          ),
        ),
      ),
    [responseQuestions, survey?.questions],
  );
  const currentSectionQuestions = currentSection?.questions ?? [];
  const currentVisibleQuestions = currentSectionQuestions.filter(
    (question) =>
      getNormalizedQuestionType(question) !== QUESTION_TYPES.CONSENT_CHECKBOX &&
      question.meta?.consentTemplate !== 'base',
  );
  const currentConsentQuestions = currentSectionQuestions.filter(
    (question) =>
      getNormalizedQuestionType(question) === QUESTION_TYPES.CONSENT_CHECKBOX &&
      question.meta?.consentTemplate !== 'base',
  );
  const currentConsentInfoBlocks = currentSectionQuestions.filter(
    (question) => question.meta?.consentTemplate === 'base',
  );
  const currentVisitedQuestionIds = useMemo(
    () => (responseMode === 'paged'
      ? currentSectionQuestions.filter((question) => isRenderableQuestion(question))
      : displayQuestions.filter((question) => isRenderableQuestion(question))
    ).map((question) => question.id),
    [currentSectionQuestions, displayQuestions, isRenderableQuestion, responseMode],
  );
  const currentVisitedQuestionIdsKey = currentVisitedQuestionIds.join('|');
  const unvisitedRenderableQuestions = allRenderableQuestions.filter(
    (question) => !renderedQuestionIds.has(question.id),
  );
  const progressPercent =
    responseMode === 'paged' && groupedSections.length > 0
      ? ((currentSectionSafeIndex + 1) / groupedSections.length) * 100
      : 0;

  useEffect(() => {
    if (currentVisitedQuestionIds.length === 0) {
      return;
    }

    setRenderedQuestionIds((current) => {
      const nextIds = new Set(current);
      currentVisitedQuestionIds.forEach((questionId) => nextIds.add(questionId));
      return nextIds.size === current.size ? current : nextIds;
    });
  }, [currentSectionSafeIndex, currentVisitedQuestionIds, currentVisitedQuestionIdsKey]);

  useEffect(() => {
    if (!import.meta.env.DEV || !survey?.id || submitted) {
      return;
    }

    const rawQuestions = (survey.questions ?? []).map((question, index) => ({
      index,
      id: question.id,
      title: question.title,
      type: question.type,
      normalizedType: getNormalizedQuestionType(question),
      required: Boolean(question.required),
      sectionId: question.sectionId,
      pageId: question.pageId,
      pageKey: question.pageKey,
      sectionKey: question.sectionKey,
      order: question.order ?? question.sortOrder ?? question.index ?? index,
    }));
    const rawSections = (survey.sections ?? []).map((section, index) => ({
      index,
      id: section.id,
      title: section.title,
      pageId: section.pageId,
      pageKey: section.pageKey,
      sectionKey: section.sectionKey ?? section.key,
      order: section.order ?? section.sortOrder ?? index,
    }));
    const normalizedQuestions = (normalizedSurveyStructure.questions ?? []).map((question, index) => ({
      index,
      id: question.id,
      title: question.title,
      type: question.type,
      required: Boolean(question.required),
      sectionId: question.sectionId,
      pageId: question.pageId,
      pageKey: question.pageKey,
      sectionKey: question.sectionKey,
      order: question.order ?? question.sortOrder ?? question.index ?? index,
    }));

    console.groupCollapsed(`[SurveyResponseDebug] ${survey.title || survey.id}`);
    console.log('survey', { id: survey.id, title: survey.title });
    console.table(rawQuestions);
    console.table(rawSections);
    console.table(normalizedQuestions);
    console.log('groupedSections', groupedSections.map((section, index) => ({
      index,
      id: section.id,
      title: section.title,
      questionIds: (section.questions ?? []).map((question) => question.id),
      questionTypes: (section.questions ?? []).map((question) => question.type),
    })));
    console.log('flow', {
      visibleQuestionIds: visibleFlow.visibleQuestionIds,
      currentSectionIndex,
      currentSectionSafeIndex,
      isLastSection: isLastReachableSection,
      nextSectionIndex: nextQuestionSectionIndex,
      allRenderableQuestionIds: allRenderableQuestions.map((question) => question.id),
      renderedQuestionIds: [...renderedQuestionIds],
      unvisitedQuestionIds: unvisitedRenderableQuestions.map((question) => question.id),
    });
    console.groupEnd();
  }, [
    allRenderableQuestions,
    currentSectionIndex,
    currentSectionSafeIndex,
    groupedSections,
    isLastReachableSection,
    nextQuestionSectionIndex,
    normalizedSurveyStructure.questions,
    renderedQuestionIds,
    submitted,
    survey,
    unvisitedRenderableQuestions,
    visibleFlow.visibleQuestionIds,
  ]);

  useEffect(() => {
    if (!import.meta.env.DEV || !survey?.id) {
      return;
    }

    // --- 원시 데이터 진단 ---
    console.debug('[SurveyResponsePage] raw sections', {
      surveyId: survey.id,
      sections: (survey.sections ?? []).map((s, i) => ({
        index: i,
        id: s.id,
        title: s.title,
        pageEndAction: s.pageEndAction ?? 'next',
        visibilityConditions: s.visibilityConditions ?? [],
      })),
    });
    console.debug('[SurveyResponsePage] raw questions (sectionId 검사)', {
      surveyId: survey.id,
      questions: (survey.questions ?? []).map((q, i) => ({
        index: i,
        id: q.id,
        title: String(q.title ?? '').slice(0, 40),
        type: q.type,
        required: Boolean(q.required),
        sectionId: q.sectionId,
      })),
    });
    const sectionQMap = visibleFlow.sectionToQuestionIdsMap;
    console.debug('[SurveyResponsePage] sectionToQuestionIdsMap', {
      surveyId: survey.id,
      map: sectionQMap
        ? [...sectionQMap.entries()].map(([sid, qids]) => ({ sectionId: sid, questionIds: qids }))
        : null,
    });

    // --- flow 진단 ---
    const responseQuestionIds = new Set(
      activeQuestions
        .filter((question) => !isNonResponseQuestionType(question.type))
        .map((question) => question.id),
    );
    const remainingQuestions = (survey.questions ?? [])
      .filter((question) => !isNonResponseQuestionType(question.type))
      .filter((question) => !responseQuestionIds.has(question.id));

    console.debug('[SurveyResponsePage] response flow', {
      surveyId: survey.id,
      responseMode,
      currentSectionIndex,
      currentSectionId: currentSection?.id ?? '',
      activeQuestions: activeQuestions.map((question) => ({
        id: question.id,
        title: String(question.title ?? '').slice(0, 40),
        type: question.type,
        required: Boolean(question.required),
        sectionId: question.sectionId,
      })),
      currentSectionQuestions: currentSectionQuestions.map((question) => ({
        id: question.id,
        title: String(question.title ?? '').slice(0, 40),
        type: question.type,
        required: Boolean(question.required),
        sectionId: question.sectionId,
      })),
      remainingQuestions: remainingQuestions.map((question) => ({
        id: question.id,
        title: String(question.title ?? '').slice(0, 40),
        type: question.type,
        required: Boolean(question.required),
        sectionId: question.sectionId,
      })),
      ungroupedActiveResponseQuestions: ungroupedActiveResponseQuestions.map((q) => ({
        id: q.id,
        title: String(q.title ?? '').slice(0, 40),
        type: q.type,
        sectionId: q.sectionId,
      })),
      remainingActiveResponseQuestions: remainingActiveResponseQuestions.map((q) => ({
        id: q.id,
        title: String(q.title ?? '').slice(0, 40),
        type: q.type,
        sectionId: q.sectionId,
      })),
      termination: visibleFlow.termination,
      sectionsOrder: groupedSections.map((section) => ({
        id: section.id,
        title: section.title,
        pageEndAction: section.pageEndAction ?? 'next',
        questionIds: (section.questions ?? []).map((question) => question.id),
      })),
      nextSectionId: nextSection?.id ?? '',
      remainingSections: remainingSections.map((section) => ({
        id: section.id,
        title: section.title,
        pageEndAction: section.pageEndAction ?? 'next',
      })),
      remainingQuestionsAfterCurrentSection: remainingQuestionsAfterCurrentSection.map((question) => ({
        id: question.id,
        title: String(question.title ?? '').slice(0, 40),
        type: question.type,
        required: Boolean(question.required),
        sectionId: question.sectionId,
      })),
      pageEndAction: currentSection?.pageEndAction ?? 'next',
      isLastReachableSection,
      canSubmit: canSubmitCurrentPage,
      groupedSectionIds: groupedSections.map((section) => section.id),
      visibleSectionIds: visibleFlow.visibleSectionIds,
      skippedQuestionIds: visibleFlow.skippedQuestionIds,
    });
  }, [
    activeQuestions,
    currentSection?.id,
    currentSectionIndex,
    currentSectionQuestions,
    canSubmitCurrentPage,
    groupedSections,
    isLastReachableSection,
    nextSection?.id,
    remainingActiveResponseQuestions,
    remainingQuestionsAfterCurrentSection,
    remainingSections,
    responseMode,
    survey?.id,
    survey?.questions,
    survey?.sections,
    ungroupedActiveResponseQuestions,
    visibleFlow.sectionToQuestionIdsMap,
    visibleFlow.skippedQuestionIds,
    visibleFlow.termination,
    visibleFlow.visibleSectionIds,
    visibleQuestions,
  ]);
  const debouncedSaveDraft = useMemo(
    () =>
      debounce((draft) => {
        try {
          writeLocalDraft(draft);
          setAutosaveState({ status: 'local_saved', savedAt: new Date() });
        } catch (error) {
          console.error('로컬 임시저장 실패:', error);
          setAutosaveState({ status: 'error', savedAt: null });
        }
      }, 2000),
    [writeLocalDraft],
  );

  const getAutosaveText = () => {
    if (autosaveState.status === 'saving') {
      return '저장중...';
    }

    if (autosaveState.status === 'error') {
      return '저장 실패';
    }

    if (autosaveState.status === 'local_saved') {
      return '이 기기에 임시 저장됨';
    }

    if (!autosaveState.savedAt) {
      return '자동 저장 대기';
    }

    const savedAt =
      autosaveState.savedAt instanceof Date
        ? autosaveState.savedAt
        : new Date(autosaveState.savedAt);
    const diffSeconds = Math.max(0, Math.floor((Date.now() - savedAt.getTime()) / 1000));
    const relativeText =
      diffSeconds < 5
        ? '방금 전'
        : diffSeconds < 60
          ? `${diffSeconds}초 전`
          : `${Math.floor(diffSeconds / 60)}분 전`;

    return `자동 저장됨 · ${relativeText}`;
  };

  useEffect(() => {
    setAnswers((current) => {
      const nextAnswers = Object.fromEntries(
        Object.entries(current).filter(([questionKey]) => responseQuestionKeys.has(questionKey)),
      );

      return Object.keys(nextAnswers).length === Object.keys(current).length ? current : nextAnswers;
    });
    setOtherInputs((current) => {
      const nextOtherInputs = Object.fromEntries(
        Object.entries(current).filter(([questionKey]) => responseQuestionKeys.has(questionKey)),
      );

      return Object.keys(nextOtherInputs).length === Object.keys(current).length ? current : nextOtherInputs;
    });
    setFieldErrors((current) => {
      const nextErrors = Object.fromEntries(
        Object.entries(current).filter(([questionKey]) => responseQuestionKeys.has(questionKey)),
      );

      return Object.keys(nextErrors).length === Object.keys(current).length ? current : nextErrors;
    });
  }, [responseQuestionKeys]);

  useEffect(() => {
    if (
      !survey?.id ||
      !draftInitialized ||
      draftChoiceVisible ||
      isResponseBlocked ||
      submitting
    ) {
      return;
    }

    const visibleIdSet = new Set(visibleFlow.visibleQuestionIds ?? []);
    const draftAnswers = Object.fromEntries(
      Object.entries(answers).filter(([questionId]) => visibleIdSet.has(questionId)),
    );
    const hasDraftContent = Object.values(draftAnswers).some((value) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }

      return Boolean(String(value ?? '').trim());
    });

    if (!hasDraftContent) {
      return;
    }

    setAutosaveState((current) => ({ ...current, status: 'saving' }));
    debouncedSaveDraft({
      userId: draftUserId,
      surveyId: survey.id,
      answers: draftAnswers,
      lastQuestionId,
      responseMode,
      visibleQuestionIds: visibleFlow.visibleQuestionIds,
      visibleSectionIds: visibleFlow.visibleSectionIds,
      updatedAt: new Date().toISOString(),
    });
  }, [
    answers,
    debouncedSaveDraft,
    draftChoiceVisible,
    draftInitialized,
    draftUserId,
    isResponseBlocked,
    lastQuestionId,
    responseMode,
    submitting,
    survey?.id,
    visibleFlow.visibleQuestionIds,
    visibleFlow.visibleSectionIds,
  ]);

  useEffect(() => {
    if (responseMode !== 'paged') {
      setCurrentSectionIndex(0);
      return;
    }

    setCurrentSectionIndex((current) =>
      Math.min(current, Math.max(groupedSections.length - 1, 0)),
    );
  }, [groupedSections.length, responseMode]);

  useEffect(() => {
    setRenderedQuestionIds(new Set());
  }, [survey?.id]);

  const renderTextBlocks = (value) =>
    String(value ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  const renderConsentInfoLines = (question) => {
    const settings = question?.settings ?? {};
    const settingsLines = [
      `수집항목: ${settings.collectionItems || '이름, 연락처, 생년월일 등'}`,
      `이용목적: ${settings.usagePurpose || '신청 접수 및 안내'}`,
      `보유기간: ${settings.retentionPeriod || '사업 종료 후 파기'}`,
      `동의 거부 시 안내: ${settings.restrictionNotice || '동의 거부 시 신청이 제한될 수 있습니다.'}`,
    ].filter(Boolean);

    if (settingsLines.length > 0) {
      return settingsLines;
    }

    const blocksFromDescription = renderTextBlocks(question?.description);
    return blocksFromDescription;
  };

  const validateAnswers = (questionsToValidate = responseQuestions) => {
    const nextErrors = {};

    questionsToValidate.forEach((question) => {
      const normalizedType = getNormalizedQuestionType(question);

      if (isNonResponseQuestionType(normalizedType) || question.meta?.consentTemplate === 'base') {
        return;
      }

      const questionIndex = survey.questions.findIndex((item) => item.id === question.id);
      const resolvedAnswer = resolveAnswer(question, questionIndex);
      const questionKey = getQuestionKey(question, questionIndex);

      if (question.required && isAnswerEmpty(question, resolvedAnswer)) {
        nextErrors[questionKey] = '필수 응답 항목입니다.';
        return;
      }

      if (normalizedType === QUESTION_TYPES.CONSENT_CHECKBOX && resolvedAnswer !== true) {
        nextErrors[questionKey] = '개인정보 수집 및 이용에 동의해야 제출할 수 있습니다.';
        return;
      }

      if (question.meta?.consentApproval && resolvedAnswer !== true && resolvedAnswer !== '동의합니다') {
        nextErrors[questionKey] = '개인정보 수집 및 이용에 동의해야 제출할 수 있습니다.';
        return;
      }

      if (
        normalizedType === QUESTION_TYPES.EMAIL &&
        String(resolvedAnswer ?? '').trim() &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(resolvedAnswer))
      ) {
        nextErrors[questionKey] = '이메일 형식으로 입력해주세요.';
      }

      if (
        normalizedType === QUESTION_TYPES.PHONE &&
        String(resolvedAnswer ?? '').trim() &&
        !/^[0-9+\-\s()]{8,20}$/.test(String(resolvedAnswer))
      ) {
        nextErrors[questionKey] = '전화번호 형식으로 입력해주세요.';
      }
    });

    setFieldErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const renderOtherInput = (question, index, shouldShow) => {
    if (!question.allowOther || !shouldShow) {
      return null;
    }

    const questionKey = getQuestionKey(question, index);

    return (
      <input
        type="text"
        value={otherInputs[questionKey] ?? ''}
        onChange={(event) => handleOtherInputChange(questionKey, event.target.value)}
        placeholder="기타 내용을 입력해주세요."
      />
    );
  };

  const renderQuestionInput = (question, index) => {
    const questionKey = getQuestionKey(question, index);
    const normalizedType = getNormalizedQuestionType(question);
    const value = answers[questionKey];
    const optionItems = getQuestionOptionItems(question, survey?.optionQuotaCounts);
    const legacyConsentQuestion = Boolean(question.meta?.consentApproval);

    if (normalizedType === QUESTION_TYPES.DESCRIPTION_BLOCK) {
      return <div className="inline-note">{question.description || '안내 내용을 입력해주세요.'}</div>;
    }

    if (normalizedType === QUESTION_TYPES.SECTION_TITLE) {
      return (
        <div className="section-block">
          <strong>{question.title}</strong>
          {question.description && <p>{question.description}</p>}
        </div>
      );
    }

    if (legacyConsentQuestion) {
      return (
        <label className="consent-check-item" style={responseChoiceRowStyle}>
          <input
            checked={value === '동의합니다' || value === true}
            disabled={isResponseBlocked}
            onChange={(event) =>
              handleChange(questionKey, event.target.checked ? '동의합니다' : '')
            }
            style={responseChoiceInputStyle}
            type="checkbox"
          />
          <span style={responseChoiceTextStyle}>위 내용에 동의합니다.</span>
        </label>
      );
    }

    switch (normalizedType) {
      case QUESTION_TYPES.LONG_TEXT:
        return (
          <textarea
            disabled={isResponseBlocked}
            rows="5"
            value={value ?? ''}
            onChange={(event) => handleChange(questionKey, event.target.value)}
            placeholder={question.placeholder || '응답을 입력해주세요.'}
          />
        );
      case QUESTION_TYPES.PHONE:
        return (
          <input
            disabled={isResponseBlocked}
            type="tel"
            value={value ?? ''}
            onChange={(event) => handleChange(questionKey, event.target.value)}
            placeholder={question.placeholder || '예: 010-1234-5678'}
          />
        );
      case QUESTION_TYPES.EMAIL:
        return (
          <input
            disabled={isResponseBlocked}
            type="email"
            value={value ?? ''}
            onChange={(event) => handleChange(questionKey, event.target.value)}
            placeholder={question.placeholder || '예: example@yeongjung.or.kr'}
          />
        );
      case QUESTION_TYPES.DATE:
        return (
          <input
            disabled={isResponseBlocked}
            type="date"
            value={value ?? ''}
            onChange={(event) => handleChange(questionKey, event.target.value)}
          />
        );
      case QUESTION_TYPES.TIME:
        return (
          <input
            disabled={isResponseBlocked}
            type="time"
            value={value ?? ''}
            onChange={(event) => handleChange(questionKey, event.target.value)}
          />
        );
      case QUESTION_TYPES.NUMBER:
        return (
          <input
            disabled={isResponseBlocked}
            type="number"
            value={value ?? ''}
            onChange={(event) => handleChange(questionKey, event.target.value)}
            placeholder={question.placeholder || '숫자를 입력해주세요.'}
          />
        );
      case QUESTION_TYPES.LINEAR_SCALE:
      case QUESTION_TYPES.RATING_SCALE:
      case QUESTION_TYPES.NPS_SCALE: {
        const scaleConfig = getScaleQuestionConfig(question);

        return (
          <div className="scale-choice-list">
            <div className="scale-choice-row">
              {scaleConfig.values.map((scaleValue) => (
                <label className="scale-choice-item" key={`${questionKey}-${scaleValue}`}>
                  <input
                    checked={String(value ?? '') === String(scaleValue)}
                    disabled={isResponseBlocked}
                    name={`question-${questionKey}`}
                    onChange={() => handleChange(questionKey, String(scaleValue))}
                    type="radio"
                  />
                  <span>{scaleValue}</span>
                </label>
              ))}
            </div>
            <div className="scale-label-row">
              <small>{scaleConfig.minLabel}</small>
              <small>{scaleConfig.maxLabel}</small>
            </div>
          </div>
        );
      }
      case QUESTION_TYPES.SINGLE_CHOICE:
        return (
          <>
            <div className="choice-list">
              {optionItems.map((option) => (
                <label
                  className="response-choice-item"
                  key={`${survey.id}-${questionKey}-${option.value}`}
                  style={responseChoiceRowStyle}
                >
                  <input
                    checked={value === option.value}
                    disabled={isResponseBlocked || option.isClosed}
                    name={`question-${questionKey}`}
                    onChange={() => handleChange(questionKey, option.value)}
                    style={responseChoiceInputStyle}
                    type="radio"
                  />
                  <span className="response-choice-text" style={responseChoiceTextStyle}>
                    {option.label}
                    {option.isClosed
                      ? ` / 현재 ${option.currentCount}명 / 총 ${option.capacity}명 / 마감`
                      : option.capacity
                        ? ` / 현재 ${option.currentCount}명 / 총 ${option.capacity}명 / 잔여 ${option.remainingCount}명`
                        : ''}
                  </span>
                </label>
              ))}
              {question.allowOther && (
                <label
                  className="response-choice-item"
                  key={`${survey.id}-${questionKey}-other`}
                  style={responseChoiceRowStyle}
                >
                  <input
                    checked={value === OTHER_OPTION_VALUE}
                    disabled={isResponseBlocked}
                    name={`question-${questionKey}`}
                    onChange={() => handleChange(questionKey, OTHER_OPTION_VALUE)}
                    style={responseChoiceInputStyle}
                    type="radio"
                  />
                  <span className="response-choice-text" style={responseChoiceTextStyle}>기타</span>
                </label>
              )}
            </div>
            {renderOtherInput(question, index, value === OTHER_OPTION_VALUE)}
          </>
        );
      case QUESTION_TYPES.MULTIPLE_CHOICE:
        return (
          <>
            <div className="choice-list">
              {optionItems.map((option) => {
                const checked = Array.isArray(value) ? value.includes(option.value) : false;

                return (
                  <label
                    className="response-choice-item"
                    key={`${survey.id}-${questionKey}-${option.value}`}
                    style={responseChoiceRowStyle}
                  >
                    <input
                      checked={checked}
                      disabled={isResponseBlocked || option.isClosed}
                      onChange={(event) =>
                        handleMultipleChoiceChange(questionKey, option.value, event.target.checked)
                      }
                      style={responseChoiceInputStyle}
                      type="checkbox"
                    />
                    <span className="response-choice-text" style={responseChoiceTextStyle}>
                      {option.label}
                      {option.isClosed
                        ? ` / 현재 ${option.currentCount}명 / 총 ${option.capacity}명 / 마감`
                        : option.capacity
                          ? ` / 현재 ${option.currentCount}명 / 총 ${option.capacity}명 / 잔여 ${option.remainingCount}명`
                          : ''}
                    </span>
                  </label>
                );
              })}
              {question.allowOther && (
                <label
                  className="response-choice-item"
                  key={`${survey.id}-${questionKey}-other`}
                  style={responseChoiceRowStyle}
                >
                  <input
                    checked={Array.isArray(value) ? value.includes(OTHER_OPTION_VALUE) : false}
                    disabled={isResponseBlocked}
                    onChange={(event) =>
                      handleMultipleChoiceChange(questionKey, OTHER_OPTION_VALUE, event.target.checked)
                    }
                    style={responseChoiceInputStyle}
                    type="checkbox"
                  />
                  <span className="response-choice-text" style={responseChoiceTextStyle}>기타</span>
                </label>
              )}
            </div>
            {renderOtherInput(
              question,
              index,
              Array.isArray(value) ? value.includes(OTHER_OPTION_VALUE) : false,
            )}
          </>
        );
      case QUESTION_TYPES.DROPDOWN:
        return (
          <>
            <select
              disabled={isResponseBlocked}
              value={value ?? ''}
              onChange={(event) => handleChange(questionKey, event.target.value)}
            >
              <option value="">선택해주세요</option>
              {optionItems.map((option) => (
                <option
                  disabled={option.isClosed}
                  key={`${survey.id}-${questionKey}-${option.value}`}
                  value={option.value}
                >
                  {option.label}
                  {option.isClosed
                    ? ' / 마감'
                    : option.capacity
                      ? ` / 현재 ${option.currentCount}명 / 총 ${option.capacity}명 / 잔여 ${option.remainingCount}명`
                      : ''}
                </option>
              ))}
              {question.allowOther && <option value={OTHER_OPTION_VALUE}>기타</option>}
            </select>
            {renderOtherInput(question, index, value === OTHER_OPTION_VALUE)}
          </>
        );
      case QUESTION_TYPES.APPLICATION_SLOT_CHOICE:
        return (
          <div className="slot-choice-list">
            {optionItems.map((option) => (
              <label
                className={`slot-choice-card ${value === option.value ? 'slot-choice-card-selected' : ''} ${option.isClosed ? 'slot-choice-card-closed' : ''}`}
                key={`${survey.id}-${questionKey}-${option.value}`}
              >
                <input
                  checked={value === option.value}
                  disabled={isResponseBlocked || option.isClosed}
                  name={`question-${questionKey}`}
                  onChange={() => handleChange(questionKey, option.value)}
                  type="radio"
                />
                <div className="slot-choice-body">
                  <div className="slot-choice-heading">
                    <strong>{option.ageGroup || option.title}</strong>
                    {option.isClosed && <span className="slot-choice-badge">마감</span>}
                  </div>
                  <p>{[option.date, option.time].filter(Boolean).join(' ') || '일시 미정'}</p>
                  <small>{option.place || '장소 추후 안내'}</small>
                  <div className="slot-choice-stats">
                    <span>현재 {option.currentCount}명</span>
                    {option.capacity ? <span>총 {option.capacity}명</span> : <span>정원 없음</span>}
                    {option.remainingCount !== null ? <span>잔여 {option.remainingCount}명</span> : null}
                  </div>
                </div>
              </label>
            ))}
          </div>
        );
      case QUESTION_TYPES.CONSENT_CHECKBOX:
        return (
          <label className="consent-check-item" style={responseChoiceRowStyle}>
            <input
              checked={Boolean(value)}
              disabled={isResponseBlocked}
              onChange={(event) => handleChange(questionKey, event.target.checked)}
              style={responseChoiceInputStyle}
              type="checkbox"
            />
            <span style={responseChoiceTextStyle}>위 내용에 동의합니다.</span>
          </label>
        );
      case QUESTION_TYPES.SHORT_TEXT:
      default:
        return (
          <input
            disabled={isResponseBlocked}
            type="text"
            value={value ?? ''}
            onChange={(event) => handleChange(questionKey, event.target.value)}
            placeholder={question.placeholder || '응답을 입력해주세요.'}
          />
        );
    }
  };

  const scrollToTop = () => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePreviousSection = () => {
    setCurrentSectionIndex((current) => Math.max(0, current - 1));
    scrollToTop();
  };

  const handleNextSection = () => {
    if (!validateAnswers(currentSectionQuestions)) {
      setMessage('현재 페이지의 필수 응답 항목을 확인해주세요.');
      return;
    }

    setMessage('');
    setCurrentSectionIndex((current) => {
      const nextIndex = groupedSections.findIndex(
        (section, index) =>
          index > current &&
          (section.questions ?? []).some((question) => isRenderableQuestion(question)),
      );

      return nextIndex === -1 ? current : nextIndex;
    });
    scrollToTop();
  };

  const moveToQuestionSection = (questionId) => {
    if (responseMode !== 'paged') {
      return false;
    }

    const targetSectionIndex = groupedSections.findIndex((section) =>
      (section.questions ?? []).some((question) => question.id === questionId),
    );

    if (targetSectionIndex >= 0) {
      setCurrentSectionIndex(targetSectionIndex);
      scrollToTop();
      return true;
    }

    return false;
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (submitLockedRef.current || submitting || submitted) {
      return;
    }

    submitLockedRef.current = true;
    setSubmitting(true);
    setMessage('');

    if (!isFirebaseConfigured) {
      setMessage(firebaseStatusMessage || 'Firebase 설정이 필요합니다.');
      setSubmitting(false);
      submitLockedRef.current = false;
      return;
    }

    if (!survey) {
      setSubmitting(false);
      submitLockedRef.current = false;
      return;
    }

    if (isResponseBlocked) {
      setMessage(publicState.message);
      setSubmitting(false);
      submitLockedRef.current = false;
      return;
    }

    if (visibleFlow.termination) {
      setMessage(visibleFlow.termination.message);
      setSubmitting(false);
      submitLockedRef.current = false;
      return;
    }

    const unvisitedQuestions = allRenderableQuestions.filter(
      (question) => !renderedQuestionIds.has(question.id),
    );

    if (unvisitedQuestions.length > 0) {
      if (import.meta.env.DEV) {
        console.warn('[BLOCK_SUBMIT_UNVISITED_QUESTIONS]', {
          surveyId: survey.id,
          currentSectionIndex,
          unvisitedQuestions: unvisitedQuestions.map((question) => ({
            id: question.id,
            title: question.title,
            type: question.type,
            normalizedType: getNormalizedQuestionType(question),
            required: Boolean(question.required),
            sectionId: question.sectionId,
            pageId: question.pageId,
            pageKey: question.pageKey,
            sectionKey: question.sectionKey,
          })),
          groupedSections: groupedSections.map((section, index) => ({
            index,
            id: section.id,
            title: section.title,
            questionIds: (section.questions ?? []).map((question) => question.id),
          })),
        });
      }

      moveToQuestionSection(unvisitedQuestions[0].id);
      setMessage('아직 표시되지 않은 문항이 있습니다. 다음 문항을 확인해주세요.');
      setSubmitting(false);
      submitLockedRef.current = false;
      return;
    }

    if (!canSubmitCurrentPage) {
      if (import.meta.env.DEV) {
        console.warn('[handleSubmit] canSubmitCurrentPage=false → 제출 차단', {
          isLastReachableSection,
          remainingSections: remainingSections.length,
          remainingActiveResponseQuestions: remainingActiveResponseQuestions.length,
          termination: visibleFlow.termination,
        });
      }

      setMessage('아직 남은 문항이 있습니다. 다음 문항을 계속 작성해주세요.');
      setSubmitting(false);
      submitLockedRef.current = false;
      return;
    }

    if (!validateAnswers()) {
      setMessage('필수 응답 항목을 확인해주세요.');
      setSubmitting(false);
      submitLockedRef.current = false;
      return;
    }

    const submitQuestions = responseQuestions.filter(
      (question) =>
        !isNonResponseQuestionType(question.type) &&
        question.meta?.consentTemplate !== 'base',
    );
    const requiredQuestions = submitQuestions.filter((question) => question.required);
    const payloadAnswers = submitQuestions.map((question) => {
      const questionIndex = getQuestionIndex(question);
      const normalizedType = getNormalizedQuestionType(question);

      return {
        questionId: question.id || getQuestionKey(question, questionIndex),
        questionTitle: question.title,
        questionDescription: question.description ?? '',
        questionType: normalizedType,
        answer: resolveAnswer(question, questionIndex),
      };
    });
    const payloadVisibleQuestionIds =
      responseMode === 'paged'
        ? responseQuestions.map((question) => question.id)
        : visibleFlow.visibleQuestionIds;
    const clientSubmitId = getCurrentClientSubmitId();
    const payload = {
      surveyId: survey.id,
      surveyTitle: survey.title,
      answers: payloadAnswers,
      respondent: {
        submittedFrom: 'web',
        clientSubmitId,
      },
      responseMode,
      visibleQuestionIds: payloadVisibleQuestionIds,
      visibleSectionIds: visibleFlow.visibleSectionIds,
      skippedQuestionIds: visibleFlow.skippedQuestionIds,
      clientSubmitId,
    };

    if (import.meta.env.DEV) {
      console.debug('[SurveyResponsePage] submit payload', {
        source: 'handleSubmit (type=submit 버튼)',
        surveyId: survey.id,
        currentSectionIndex,
        isLastReachableSection,
        canSubmitCurrentPage,
        visibleQuestions: submitQuestions.map((question) => ({
          id: question.id,
          title: String(question.title ?? '').slice(0, 40),
          type: question.type,
          required: Boolean(question.required),
        })),
        requiredQuestions: requiredQuestions.map((question) => ({
          id: question.id,
          title: String(question.title ?? '').slice(0, 40),
          type: question.type,
        })),
        answers: resolvedAnswersByQuestionId,
        payload,
      });
    }

    try {
      const responseId = await submitSurveyResponse(payload);

      debouncedSaveDraft.cancel?.();
      removeLocalDraft();

      const completionMessage = survey.completionMessage || '응답이 저장되었습니다. 참여해주셔서 감사합니다.';

      if (typeof window !== 'undefined') {
        const submittedSessionKey =
          survey.id && clientSubmitId && responseId
            ? `submitted_${survey.id}_${clientSubmitId}_${responseId}`
            : '';

        if (submittedSessionKey) {
          window.sessionStorage.setItem(
            submittedSessionKey,
            JSON.stringify({
              surveyId: survey.id,
              clientSubmitId,
              responseId,
              message: completionMessage,
              submittedAt: new Date().toISOString(),
            }),
          );
        }
      }

      setMessage(completionMessage);
      setSubmitted(true);
      setAnswers({});
      setOtherInputs({});
      setFieldErrors({});
      setLastQuestionId('');
      setAutosaveState({ status: 'idle', savedAt: null });
    } catch (error) {
      setMessage(getSubmitErrorMessage(error));
      setSubmitting(false);
      submitLockedRef.current = false;
    }
  };

  if (loading) {
    return <div className="empty-state">설문을 불러오는 중입니다.</div>;
  }

  if (!survey) {
    return <div className="empty-state">{message || '존재하지 않는 설문입니다.'}</div>;
  }

  if (isDraftSurvey) {
    return <div className="empty-state">{draftMessage}</div>;
  }

  const applicationSummaryCards = applicationForm
    ? [
        {
          label: '접수 기간',
          value: getReceptionPeriodText(survey),
        },
        {
          label: '현재 상태',
          value: publicState.label,
        },
        {
          label: '전체 접수 현황',
          value:
            quotaSummary.quotaEnabled && quotaSummary.maxResponses
              ? `${quotaSummary.responseCount} / ${quotaSummary.maxResponses}`
              : `${quotaSummary.responseCount}건 접수`,
        },
      ]
    : [];

  const renderQuestionField = (question) => {
    const index = survey.questions.findIndex((item) => item.id === question.id);
    const questionKey = getQuestionKey(question, index);
    const normalizedType = getNormalizedQuestionType(question);
    const displayInfo = questionDisplayMap[question.id] ?? null;
    const titleWithNumber = (
      <span className="response-question-title">
        {displayInfo && (
          <span className="response-question-number">{displayInfo.shortLabel}.</span>
        )}
        <span>{question.title}</span>
        {question.required && <small className="required-mark"> * 필수</small>}
      </span>
    );

    if (normalizedType === QUESTION_TYPES.CONSENT_CHECKBOX || question.meta?.consentApproval) {
      return (
        <div className="field consent-field" key={`${survey.id}-${questionKey}`}>
          {titleWithNumber}
          {question.description && <small>{question.description}</small>}
          {renderQuestionInput(question, index)}
          {fieldErrors[questionKey] && <small className="error-text">{fieldErrors[questionKey]}</small>}
        </div>
      );
    }

    if (isNonResponseQuestionType(normalizedType)) {
      return (
        <div className="field" key={`${survey.id}-${questionKey}`}>
          {renderQuestionInput(question, index)}
        </div>
      );
    }

    return (
      <div className="field" key={`${survey.id}-${questionKey}`}>
        {titleWithNumber}
        {question.description && (
          <small>{question.description}</small>
        )}
        {isScaleQuestionType(normalizedType) && (
          <small>
            {getScaleQuestionConfig(question)?.min}점부터 {getScaleQuestionConfig(question)?.max}점까지
            선택해주세요.
          </small>
        )}
        {renderQuestionInput(question, index)}
        {fieldErrors[questionKey] && <small className="error-text">{fieldErrors[questionKey]}</small>}
      </div>
    );
  };

  const renderConsentPanel = (questions, infoBlocks) => {
    if (questions.length === 0) {
      return null;
    }

    return (
      <div className="consent-panel">
        <div className="section-block consent-intro-block">
          <strong>개인정보 수집 및 이용 동의</strong>
          {infoBlocks.length > 0 ? (
            infoBlocks.map((question) => (
              <div className="consent-info-box" key={`consent-info-${question.id}`}>
                {renderTextBlocks(question.description).map((line, index) => (
                  <p key={`${question.id}-line-${index}`}>{line}</p>
                ))}
              </div>
            ))
          ) : questions[0] ? (
            <div className="consent-info-box">
              {renderConsentInfoLines(questions[0]).map((line, index) => (
                <p key={`consent-fallback-${index}`}>{line}</p>
              ))}
            </div>
          ) : (
            <div className="consent-info-box">
              <p>수집항목: 이름, 연락처</p>
              <p>이용목적: 신청 접수 및 안내</p>
              <p>보유기간: 사업 종료 후 파기</p>
            </div>
          )}
        </div>
        {questions.map((question) => renderQuestionField(question))}
      </div>
    );
  };

  if (isClosedSurvey || isScheduledSurvey) {
    return (
      <section className="response-layout">
        <div className={`panel response-panel ${applicationForm ? 'application-response-panel' : ''}`}>
          <span className="eyebrow">{applicationForm ? '신청 페이지' : '응답 페이지'}</span>
          <h1>{survey.title}</h1>
          <SurveyDescription survey={survey} fallback="현재 이 폼은 마감 상태입니다." />
          {applicationForm && (
            <div className="application-summary-grid">
              {applicationSummaryCards.map((item) => (
                <div className="application-summary-card" key={item.label}>
                  <small>{item.label}</small>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="form-message">
            {publicState.message}
            {quotaSummary.quotaEnabled && quotaSummary.maxResponses
              ? ` 현재 ${quotaSummary.responseCount}/${quotaSummary.maxResponses}건이 접수되었습니다.`
              : ''}
          </div>
        </div>
      </section>
    );
  }

  if (submitted) {
    return (
      <section className="response-layout">
        <div className={`panel response-panel ${applicationForm ? 'application-response-panel' : ''}`}>
          <span className="eyebrow">{applicationForm ? '신청 완료' : '응답 완료'}</span>
          <h1>{survey.title}</h1>
          <div className="form-message" role="status">
            {message || survey.completionMessage || '응답이 저장되었습니다. 참여해주셔서 감사합니다.'}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="response-layout">
      <div className={`panel response-panel ${applicationForm ? 'application-response-panel' : ''}`}>
        <span className="eyebrow">{applicationForm ? '신청 페이지' : '응답 페이지'}</span>
        <h1>{survey.title}</h1>
        <SurveyDescription survey={survey} fallback="아래 질문에 응답해주세요." />

        {draftChoiceVisible && (
          <div className="draft-resume-panel">
            <div>
              <strong>작성 중인 임시저장이 있습니다.</strong>
              <p>이전에 입력하던 내용으로 이어서 작성하거나 새로 시작할 수 있습니다.</p>
            </div>
            <div className="card-actions">
              <button className="primary-button" onClick={handleContinueDraft} type="button">
                이어서 작성하기
              </button>
              <button className="secondary-button" onClick={handleStartNewDraft} type="button">
                새로 작성하기
              </button>
            </div>
          </div>
        )}

        {!draftChoiceVisible && (
          <div className={`autosave-status autosave-status-${autosaveState.status}`} aria-live="polite">
            {getAutosaveText()}
          </div>
        )}

        {applicationForm && (
          <>
            <div className="application-summary-grid">
              {applicationSummaryCards.map((item) => (
                <div className="application-summary-card" key={item.label}>
                  <small>{item.label}</small>
                  <strong>{item.value}</strong>
                </div>
              ))}
            </div>

            {survey.opensAt || survey.closesAt ? (
              <div className="application-info-card">
                <strong>접수 일정</strong>
                <p>{getReceptionPeriodText(survey)}</p>
                {survey.opensAt && <small>접수 시작: {formatPublicDateTime(survey.opensAt)}</small>}
                {survey.closesAt && <small>접수 종료: {formatPublicDateTime(survey.closesAt)}</small>}
              </div>
            ) : null}

            {survey.scheduleSummary && (
              <div className="application-info-card">
                <strong>운영 시간표 / 회차 안내</strong>
                <div className="application-text-stack">
                  {renderTextBlocks(survey.scheduleSummary).map((line, index) => (
                    <p key={`schedule-${index}`}>{line}</p>
                  ))}
                </div>
              </div>
            )}

            {survey.applicationGuide && (
              <div className="application-info-card">
                <strong>신청 안내</strong>
                <div className="application-text-stack">
                  {renderTextBlocks(survey.applicationGuide).map((line, index) => (
                    <p key={`guide-${index}`}>{line}</p>
                  ))}
                </div>
              </div>
            )}

            {survey.cautionText && (
              <div className="application-info-card caution-card">
                <strong>유의사항</strong>
                <div className="application-text-stack">
                  {renderTextBlocks(survey.cautionText).map((line, index) => (
                    <p key={`caution-${index}`}>{line}</p>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <form className="response-form" onSubmit={handleSubmit}>
          {responseMode === 'paged' && currentSection ? (
            <>
              <div className="response-progress-panel paged-progress-panel">
                <div>
                  <span>진행률</span>
                  <strong>
                    {currentSectionSafeIndex + 1} / {groupedSections.length} 섹션
                  </strong>
                </div>
                <div className="response-progress-track" aria-hidden="true">
                  <div
                    className="response-progress-bar"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>

              <div className="field">
                <div className="section-block">
                  <strong>{currentSection.title}</strong>
                  {currentSection.description && <p>{currentSection.description}</p>}
                </div>
              </div>

              {currentVisibleQuestions.map((question) => renderQuestionField(question))}
              {renderConsentPanel(currentConsentQuestions, currentConsentInfoBlocks)}
            </>
          ) : (
            <>
              {visibleSections.length > 0 && (
                <div className="response-progress-panel">
                  <span>진행 섹션</span>
                  <strong>
                    {visibleSections.length}개 섹션 · {visibleQuestions.length}개 문항
                  </strong>
                </div>
              )}

              {visibleQuestions.map((question) => renderQuestionField(question))}
              {renderConsentPanel(consentQuestions, consentInfoBlocks)}
            </>
          )}

          {visibleFlow.termination && (
            <div className="form-message">{visibleFlow.termination.message}</div>
          )}

          {message && <div className="form-message">{message}</div>}

          {import.meta.env.DEV && (
            <div className="inline-note response-debug-panel">
              전체 질문 {survey.questions?.length ?? 0}개 · 표시 대상 {allRenderableQuestions.length}개 ·
              현재 페이지 {currentVisitedQuestionIds.length}개 · 남은 질문 {unvisitedRenderableQuestions.length}개 ·
              마지막 페이지 {isLastReachableSection ? '예' : '아니오'}
            </div>
          )}

          {responseMode === 'paged' ? (
            <div className="response-navigation-row">
              <button
                className="secondary-button"
                disabled={submitting || currentSectionIndex === 0}
                onClick={handlePreviousSection}
                type="button"
              >
                이전
              </button>
              {!isLastReachableSection ? (
                <button
                  className="primary-button"
                  disabled={submitting || !publicState.canSubmit || Boolean(visibleFlow.termination)}
                  onClick={handleNextSection}
                  type="button"
                >
                  다음
                </button>
              ) : (
                <button
                  className="primary-button"
                  disabled={submitting || !publicState.canSubmit || Boolean(visibleFlow.termination) || !canSubmitCurrentPage}
                  type="submit"
                >
                  {submitting ? '제출 중...' : applicationForm ? '제출 및 저장' : '제출하기'}
                </button>
              )}
            </div>
          ) : (
            <button
              className="primary-button"
              disabled={submitting || !publicState.canSubmit || Boolean(visibleFlow.termination)}
              type="submit"
            >
              {submitting ? '제출 중...' : applicationForm ? '제출 및 저장' : '제출하기'}
            </button>
          )}
        </form>
      </div>
    </section>
  );
}

export default SurveyResponsePage;
