import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import QuestionBlockPicker from '../components/QuestionBlockPicker';
import QuestionEditor from '../components/QuestionEditor';
import SectionEditor from '../components/SectionEditor';
import SurveyPreviewContent from '../components/SurveyPreviewContent';
import { useAuth } from '../contexts/AuthContext';
import { FORM_TEMPLATES } from '../data/formTemplates';
import {
  alignQuestionsToSections,
  createAuditLog,
  createSurvey,
  detectPrivacyQuestions,
  fetchResponseCountBySurveyId,
  fetchSurveyById,
  formatFirestoreDate,
  getFirestoreErrorMessage,
  isApplicationFormType,
  normalizeSurveyConfiguration,
  normalizeSurveySections,
  normalizeSurveyStatus,
  normalizeMaxResponses,
  sanitizeSurveyQuestions,
  sanitizeSurveySections,
  supportsBranchingFormType,
  updateSurvey,
  validatePrivacyConsent,
  waitForSurveyById,
} from '../firebase/surveys';
import {
  fetchSurveyTemplateById,
  fetchSurveyTemplates,
  incrementSurveyTemplateUsage,
  instantiateSurveyTemplate,
} from '../firebase/surveyTemplates';
import {
  BRANCH_ACTIONS,
  FORM_TYPE_CONFIGS,
  FORM_TYPES,
  QUESTION_TYPES,
  SURVEY_STATUSES,
} from '../firebase/surveyConstants';
import {
  createQuestionId,
  createSectionId,
  isSelectableQuestionType,
  normalizeQuestions,
} from '../firebase/surveyNormalize';
import { buildQuestionDisplayMap } from '../utils/questionNumbering';

const createEmptyQuestion = () => ({
  id: createQuestionId(),
  title: '',
  label: '',
  description: '',
  helpText: '',
  type: 'shortText',
  options: [],
  required: false,
  allowOther: false,
  placeholder: '',
  validation: {},
  sectionId: '',
  settings: {},
  meta: {},
  branching: {
    enabled: false,
    rules: [],
    fallbackAction: BRANCH_ACTIONS.NEXT,
    fallbackTargetQuestionId: '',
  },
});

const DESCRIPTION_TABLE_EXAMPLE = `\n\n[운영 시간표]\n| 층수 | 회기 | 운영시간 | 정원 |\n|---|---|---|---|\n| 4층(3세~5세) | 1회기 | 10:00~10:45 | 20명 |\n| 4층(3세~5세) | 2회기 | 11:00~11:45 | 20명 |`;

const createPresetQuestion = (type, sectionId = '') => {
  const baseQuestion = createEmptyQuestion();

  if (type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE) {
    return {
      ...baseQuestion,
      sectionId,
      type,
      title: '참여 신청 슬롯을 선택해주세요.',
      description: '원하는 회차 또는 반을 선택해주세요.',
      options: [],
    };
  }

  if (type === QUESTION_TYPES.LINEAR_SCALE) {
    return {
      ...baseQuestion,
      sectionId,
      type,
      title: '만족도는 어떠셨나요?',
      description: '가장 가까운 점수를 선택해주세요.',
      settings: {
        preset: 'satisfaction5',
        min: 1,
        max: 5,
        minLabel: '전혀 만족하지 않음',
        maxLabel: '매우 만족',
      },
    };
  }

  if (type === QUESTION_TYPES.DESCRIPTION_BLOCK) {
    return {
      ...baseQuestion,
      sectionId,
      type,
      title: '안내 문구',
      description: '참여 전에 꼭 확인해야 할 내용을 입력하세요.',
      required: false,
    };
  }

  const isSelectable = isSelectableQuestionType(type);

  return {
    ...baseQuestion,
    sectionId,
    type,
    options: isSelectable ? ['옵션 1', '옵션 2'] : [],
  };
};

const createConsentQuestion = (sectionId = '') => ({
  ...createEmptyQuestion(),
  id: createQuestionId(),
  sectionId,
  title: '개인정보 수집·이용에 동의합니다.',
  description: '동의하지 않으면 신청을 진행할 수 없습니다.',
  type: QUESTION_TYPES.CONSENT_CHECKBOX,
  options: [],
  required: true,
  settings: {
    collectionItems: '이름, 연락처, 생년월일 등',
    usagePurpose: '신청 접수 및 안내',
    retentionPeriod: '사업 종료 후 파기',
    restrictionNotice: '동의 거부 시 신청이 제한될 수 있음',
  },
  meta: {
    consentApproval: true,
  },
});

const createEmptySection = (index = 0) => ({
  id: createSectionId(),
  title: '',
  description: '',
  pageEndAction: 'next',
  pageEndTargetSectionId: '',
  visibilityConditions: [],
  visibilityCombinator: 'AND',
  terminationEnabled: false,
  terminationConditions: [],
  terminationCombinator: 'AND',
  terminationMessage: '',
});

const cloneQuestionForDuplicate = (question) => {
  const {
    displayNumber,
    number,
    orderNumber,
    orderLabel,
    parentNumber,
    childNumber,
    visibleIndex,
    displayIndex,
    nextQuestionId,
    targetQuestionId,
    optionBranches,
    branching,
    ...copyableQuestion
  } = question;

  return {
    ...copyableQuestion,
    id: createQuestionId(),
    title: question.title?.trim?.() ? `${question.title} (복사본)` : question.title,
    options: Array.isArray(question.options) ? [...question.options] : [],
    settings: question.settings ? { ...question.settings } : {},
    meta: question.meta ? { ...question.meta } : {},
    validation: question.validation ? { ...question.validation } : {},
    optionSettings: question.optionSettings
      ? Object.entries(question.optionSettings).reduce((result, [key, value]) => {
          result[key] = value && typeof value === 'object' ? { ...value } : value;
          return result;
        }, {})
      : {},
    branching: {
      enabled: false,
      rules: [],
      fallbackAction: BRANCH_ACTIONS.NEXT,
      fallbackTargetQuestionId: '',
    },
  };
};

const START_WIZARD_TYPES = [
  {
    id: 'blank',
    label: '일반 설문',
    description: '가장 단순한 설문부터 시작합니다.',
    formType: FORM_TYPES.GENERAL_SURVEY,
  },
  {
    id: 'satisfaction',
    label: '만족도 조사',
    description: '만족도, 의견, 개선점 중심으로 시작합니다.',
    formType: FORM_TYPES.GENERAL_SURVEY,
  },
  {
    id: 'program_application',
    label: '신청 접수',
    description: '기본 신청서 형태로 시작합니다.',
    formType: FORM_TYPES.GENERAL_APPLICATION,
  },
  {
    id: 'event_application',
    label: '행사 신청',
    description: '회차나 시간대를 받는 행사 신청에 적합합니다.',
    formType: FORM_TYPES.GENERAL_APPLICATION,
  },
  {
    id: 'needs_survey',
    label: '욕구 조사',
    description: '대상별 의견과 필요를 받는 설문에 적합합니다.',
    formType: FORM_TYPES.TARGETED_SURVEY,
  },
  {
    id: 'volunteer_application',
    label: '자원봉사 신청',
    description: '봉사 신청과 연락처 수집에 적합합니다.',
    formType: FORM_TYPES.GENERAL_APPLICATION,
  },
];

const START_WIZARD_AUDIENCES = [
  '지역주민',
  '영유아',
  '초등학생',
  '청소년',
  '청년',
  '중장년',
  '어르신',
];

const START_WIZARD_PERSONAL_FIELDS = [
  { key: 'name', label: '이름' },
  { key: 'phone', label: '연락처' },
  { key: 'email', label: '이메일' },
  { key: 'birthdate', label: '생년월일' },
];

function createStarterQuestionsFromWizard(startTypeId, sectionId, personalFields = {}) {
  const selectedFields = [];

  if (personalFields.name) {
    selectedFields.push({
      ...createEmptyQuestion(),
      sectionId,
      title: '이름',
      type: QUESTION_TYPES.SHORT_TEXT,
      required: true,
    });
  }

  if (personalFields.phone) {
    selectedFields.push({
      ...createEmptyQuestion(),
      sectionId,
      title: '연락처',
      type: QUESTION_TYPES.PHONE,
      required: true,
      placeholder: '예: 010-1234-5678',
    });
  }

  if (personalFields.email) {
    selectedFields.push({
      ...createEmptyQuestion(),
      sectionId,
      title: '이메일',
      type: QUESTION_TYPES.EMAIL,
      required: false,
      placeholder: '예: example@yeongjung.or.kr',
    });
  }

  if (personalFields.birthdate) {
    selectedFields.push({
      ...createEmptyQuestion(),
      sectionId,
      title: '생년월일',
      type: QUESTION_TYPES.DATE,
      required: false,
    });
  }

  if (startTypeId === 'satisfaction') {
    selectedFields.push(createPresetQuestion(QUESTION_TYPES.LINEAR_SCALE, sectionId));
  } else if (startTypeId === 'event_application') {
    selectedFields.push(createPresetQuestion(QUESTION_TYPES.APPLICATION_SLOT_CHOICE, sectionId));
  } else if (startTypeId === 'needs_survey') {
    selectedFields.push({
      ...createEmptyQuestion(),
      sectionId,
      title: '가장 필요한 지원이나 프로그램은 무엇인가요?',
      type: QUESTION_TYPES.LONG_TEXT,
      required: false,
    });
  } else if (startTypeId === 'program_application' || startTypeId === 'volunteer_application') {
    selectedFields.push({
      ...createEmptyQuestion(),
      sectionId,
      title: startTypeId === 'volunteer_application' ? '신청 이유 또는 하고 싶은 활동' : '신청 이유 또는 남기고 싶은 말씀',
      type: QUESTION_TYPES.LONG_TEXT,
      required: false,
    });
  }

  return selectedFields;
}

function SurveyBuilderPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { surveyId } = useParams();
  const [searchParams] = useSearchParams();
  const {
    user,
    role,
    status: accountStatus,
    loading: authLoading,
    canCreateSurvey,
    canEditSurvey,
    profileError,
    firebaseStatusMessage,
    isFirebaseConfigured,
  } = useAuth();
  const isEditMode = Boolean(surveyId);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tableBlocks, setTableBlocks] = useState([]);
  const [sections, setSections] = useState([createEmptySection(0)]);
  const [questions, setQuestions] = useState([
    {
      ...createEmptyQuestion(),
      sectionId: '',
    },
  ]);
  const [status, setStatus] = useState(SURVEY_STATUSES.DRAFT);
  const [formType, setFormType] = useState(FORM_TYPES.GENERAL_SURVEY);
  const [branchingEnabled, setBranchingEnabled] = useState(
    FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.branchingEnabled,
  );
  const [quotaEnabled, setQuotaEnabled] = useState(
    FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.quotaEnabled,
  );
  const [maxResponses, setMaxResponses] = useState('');
  const [duplicateCheckEnabled, setDuplicateCheckEnabled] = useState(
    FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.duplicateCheckEnabled,
  );
  const [slotDuplicateCheckEnabled, setSlotDuplicateCheckEnabled] = useState(
    FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.slotDuplicateCheckEnabled,
  );
  const [oneSlotPerPersonEnabled, setOneSlotPerPersonEnabled] = useState(
    FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.oneSlotPerPersonEnabled,
  );
  const [applicantListView, setApplicantListView] = useState(
    FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.applicantListView,
  );
  const [processingStatusEnabled, setProcessingStatusEnabled] = useState(
    FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.processingStatusEnabled,
  );
  const [opensAt, setOpensAt] = useState('');
  const [closesAt, setClosesAt] = useState('');
  const [applicationGuide, setApplicationGuide] = useState('');
  const [scheduleSummary, setScheduleSummary] = useState('');
  const [cautionText, setCautionText] = useState('');
  const [allowResponseEdit, setAllowResponseEdit] = useState(false);
  const [completionMessage, setCompletionMessage] = useState('');
  const [adminNotificationEnabled, setAdminNotificationEnabled] = useState(false);
  const [loading, setLoading] = useState(isEditMode);
  const [notFound, setNotFound] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [existingResponseCount, setExistingResponseCount] = useState(0);
  const [optionQuotaCounts, setOptionQuotaCounts] = useState({});
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [templateMetadata, setTemplateMetadata] = useState({});
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showBlockPicker, setShowBlockPicker] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showStartWizard, setShowStartWizard] = useState(!isEditMode);
  const [creationMode, setCreationMode] = useState(isEditMode ? 'builder' : '');
  const [storedTemplates, setStoredTemplates] = useState([]);
  const [storedTemplatesLoading, setStoredTemplatesLoading] = useState(!isEditMode);
  const [storedTemplatesError, setStoredTemplatesError] = useState('');
  const [selectedStoredTemplateId, setSelectedStoredTemplateId] = useState('');
  const [selectedStoredTemplateName, setSelectedStoredTemplateName] = useState('');
  const [selectedStoredTemplateSourceSurveyId, setSelectedStoredTemplateSourceSurveyId] =
    useState('');
  const [wizardStartType, setWizardStartType] = useState('blank');
  const [wizardAudience, setWizardAudience] = useState('지역주민');
  const [wizardOpensAt, setWizardOpensAt] = useState('');
  const [wizardClosesAt, setWizardClosesAt] = useState('');
  const [wizardUseQuota, setWizardUseQuota] = useState(false);
  const [wizardPersonalFields, setWizardPersonalFields] = useState({
    name: true,
    phone: true,
    email: false,
    birthdate: false,
  });
  const questionSectionRef = useRef(null);
  const blockPickerRef = useRef(null);
  const hasVisiblePages = sections.length > 1;
  const previewSurvey = useMemo(() => {
    let validQuestions = [];
    let validSections = [];

    try {
      validQuestions = alignQuestionsToSections(
        sanitizeSurveyQuestions(questions, { strict: false }),
        sections,
      );
      validSections = sanitizeSurveySections(sections, validQuestions);
    } catch (err) {
      console.groupCollapsed('[Survey Builder] 미리보기 계산 오류 (렌더링 무시)');
      console.error('오류:', err?.message);
      console.error('questions 상태:', questions.map((q) => ({
        id: q.id,
        type: q.type,
        title: q.title,
        optionsCount: Array.isArray(q.options) ? q.options.length : 'NOT_ARRAY',
        options: q.options,
      })));
      console.groupEnd();
    }

    return {
      id: surveyId || 'builder-preview',
      title: title.trim() || '제목 없는 설문',
      description: description.trim(),
      descriptionFormat: 'markdown',
      tableBlocks,
      questions: validQuestions,
      sections: validSections,
      status,
      formType,
      branchingEnabled,
      quotaEnabled,
      maxResponses: quotaEnabled ? normalizeMaxResponses(maxResponses) : null,
      duplicateCheckEnabled,
      slotDuplicateCheckEnabled,
      oneSlotPerPersonEnabled,
      applicantListView,
      processingStatusEnabled,
      opensAt,
      closesAt,
      applicationGuide,
      scheduleSummary,
      cautionText,
      allowResponseEdit,
      completionMessage,
      adminNotificationEnabled,
      optionQuotaCounts,
      ...templateMetadata,
    };
  }, [
    adminNotificationEnabled,
    allowResponseEdit,
    applicantListView,
    applicationGuide,
    branchingEnabled,
    cautionText,
    closesAt,
    completionMessage,
    description,
    duplicateCheckEnabled,
    formType,
    maxResponses,
    oneSlotPerPersonEnabled,
    opensAt,
    optionQuotaCounts,
    processingStatusEnabled,
    questions,
    quotaEnabled,
    scheduleSummary,
    sections,
    slotDuplicateCheckEnabled,
    status,
    surveyId,
    tableBlocks,
    templateMetadata,
    title,
  ]);

  const handleInsertDescriptionTableExample = () => {
    setDescription((current) => {
      if (current.includes('| 층수 | 회기 | 운영시간 | 정원 |')) {
        return current;
      }

      return `${current.trimEnd()}${DESCRIPTION_TABLE_EXAMPLE}`.trimStart();
    });
  };

  useEffect(() => {
    setQuestions((current) =>
      current.map((question, index) => {
        if (question.sectionId || sections.length === 0) {
          return question;
        }

        return {
          ...question,
          sectionId: sections[0]?.id ?? '',
        };
      }),
    );
  }, [sections]);

  useEffect(() => {
    if (!showBlockPicker) {
      return undefined;
    }

    const handlePointerDown = (event) => {
      if (!blockPickerRef.current?.contains(event.target)) {
        setShowBlockPicker(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowBlockPicker(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showBlockPicker]);

  useEffect(() => {
    if (!isEditMode) {
      return;
    }

    async function loadSurvey() {
      try {
        setNotFound(false);
        setFetchError('');
        const [survey, responseCount] = await Promise.all([
          waitForSurveyById(surveyId, 8, 250),
          fetchResponseCountBySurveyId(surveyId),
        ]);

        if (!survey) {
          setNotFound(true);
          return;
        }

        if (!canEditSurvey(survey)) {
          setFetchError('이 설문을 수정할 권한이 없습니다.');
          return;
        }

        setTitle(survey.title ?? '');
        setDescription(survey.description ?? '');
        setTableBlocks(Array.isArray(survey.tableBlocks) ? survey.tableBlocks : []);
        const normalizedSections = normalizeSurveySections(survey.sections, survey.questions);
        const normalizedQuestions = alignQuestionsToSections(survey.questions, normalizedSections);
        setSections(normalizedSections);
        setQuestions(
          normalizedQuestions.length
            ? normalizedQuestions
            : [
                {
                  ...createEmptyQuestion(),
                  sectionId: normalizedSections[0]?.id ?? '',
                },
              ],
        );
        setStatus(normalizeSurveyStatus(survey.status));
        const normalizedConfiguration = normalizeSurveyConfiguration(survey);
        setFormType(normalizedConfiguration.formType);
        setBranchingEnabled(normalizedConfiguration.branchingEnabled);
        setQuotaEnabled(normalizedConfiguration.quotaEnabled);
        setMaxResponses(normalizedConfiguration.maxResponses ? String(normalizedConfiguration.maxResponses) : '');
        setDuplicateCheckEnabled(normalizedConfiguration.duplicateCheckEnabled);
        setSlotDuplicateCheckEnabled(normalizedConfiguration.slotDuplicateCheckEnabled);
        setOneSlotPerPersonEnabled(normalizedConfiguration.oneSlotPerPersonEnabled);
        setApplicantListView(normalizedConfiguration.applicantListView);
        setProcessingStatusEnabled(normalizedConfiguration.processingStatusEnabled);
        setOpensAt(normalizedConfiguration.opensAt ?? '');
        setClosesAt(normalizedConfiguration.closesAt ?? '');
        setApplicationGuide(normalizedConfiguration.applicationGuide ?? '');
        setScheduleSummary(normalizedConfiguration.scheduleSummary ?? '');
        setCautionText(normalizedConfiguration.cautionText ?? '');
        setAllowResponseEdit(normalizedConfiguration.allowResponseEdit);
        setCompletionMessage(normalizedConfiguration.completionMessage ?? '');
        setAdminNotificationEnabled(normalizedConfiguration.adminNotificationEnabled);
        setSelectedTemplateId(survey.templateId ?? '');
        setTemplateMetadata({
          templateId: survey.templateId ?? '',
          templateVersion: survey.templateVersion ?? null,
          templateCategory: survey.templateCategory ?? '',
          templateType: survey.templateType ?? '',
          organization: survey.organization ?? '',
          programType: survey.programType ?? '',
          supportsYearCompare: Boolean(survey.supportsYearCompare),
          supportsFollowUp: Boolean(survey.supportsFollowUp),
          supportsAssetMapping: Boolean(survey.supportsAssetMapping),
          defaultFormType: survey.defaultFormType ?? '',
        });
        setExistingResponseCount(responseCount);
        setOptionQuotaCounts(survey.optionQuotaCounts ?? {});
      } catch (error) {
        setFetchError(error.message || '설문 정보를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    }

    loadSurvey();
  }, [canEditSurvey, isEditMode, surveyId]);

  useEffect(() => {
    if (location.state?.flashMessage) {
      setMessage(location.state.flashMessage);
    }
  }, [location.state]);

  const addQuestion = () => {
    setQuestions((current) => [
      ...current,
      {
        ...createEmptyQuestion(),
        sectionId: sections[sections.length - 1]?.id ?? sections[0]?.id ?? '',
      },
    ]);
  };

  const addQuestionToSection = (sectionId) => {
    setQuestions((current) => [
      ...current,
      {
        ...createEmptyQuestion(),
        sectionId: sectionId || sections[sections.length - 1]?.id || sections[0]?.id || '',
      },
    ]);
    requestAnimationFrame(() => {
      questionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const addQuestionWithType = (type) => {
    const targetSectionId = sections[sections.length - 1]?.id ?? sections[0]?.id ?? '';

    questionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setQuestions((current) => [...current, createPresetQuestion(type, targetSectionId)]);
  };

  const openCommonBlocks = () => {
    setShowBlockPicker((current) => !current);
  };

  const openSectionBuilder = () => {
    addSection();
    questionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const addConsentTemplate = () => {
    const targetSectionId = sections[sections.length - 1]?.id ?? sections[0]?.id ?? '';
    questionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setQuestions((current) => [...current, createConsentQuestion(targetSectionId)]);
    setShowBlockPicker(false);
    setMessage('개인정보 동의 질문을 추가했습니다. 안내 항목은 바로 수정해 사용할 수 있습니다.');
  };

  const addQuestionBlock = (blockQuestions) => {
    const targetSectionId = sections[sections.length - 1]?.id ?? sections[0]?.id ?? '';
    setQuestions((current) => [
      ...current,
      ...normalizeQuestions(blockQuestions).map((question) => ({
        ...question,
        sectionId: question.sectionId || targetSectionId,
      })),
    ]);
    setShowBlockPicker(false);
  };

  const updateQuestion = (index, nextQuestion) => {
    if (nextQuestion?.branching?.enabled) {
      setBranchingEnabled(true);
    }

    setQuestions((current) =>
      current.map((question, questionIndex) =>
        questionIndex === index ? nextQuestion : question,
      ),
    );
  };

  const removeQuestion = (index) => {
    setQuestions((current) => current.filter((_, questionIndex) => questionIndex !== index));
  };

  const moveQuestion = (index, direction) => {
    setQuestions((current) => {
      const nextQuestions = [...current];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= nextQuestions.length) {
        return current;
      }

      [nextQuestions[index], nextQuestions[targetIndex]] = [
        nextQuestions[targetIndex],
        nextQuestions[index],
      ];

      return nextQuestions;
    });
  };

  const duplicateQuestion = (index) => {
    const sourceQuestion = questions[index];

    if (!sourceQuestion) {
      return;
    }

    const duplicatedQuestion = cloneQuestionForDuplicate(sourceQuestion);

    setQuestions((current) => {
      const nextQuestions = [...current];
      nextQuestions.splice(index + 1, 0, duplicatedQuestion);
      return nextQuestions;
    });
  };

  const addSection = () => {
    setSections((current) => [...current, createEmptySection(current.length)]);
  };

  const updateSection = (index, nextSection) => {
    setSections((current) =>
      current.map((section, sectionIndex) => (sectionIndex === index ? nextSection : section)),
    );
  };

  const moveSection = (index, direction) => {
    setSections((current) => {
      const nextSections = [...current];
      const targetIndex = direction === 'up' ? index - 1 : index + 1;

      if (targetIndex < 0 || targetIndex >= nextSections.length) {
        return current;
      }

      [nextSections[index], nextSections[targetIndex]] = [
        nextSections[targetIndex],
        nextSections[index],
      ];

      return nextSections;
    });
  };

  const duplicateSection = (index) => {
    const sourceSection = sections[index];

    if (!sourceSection) {
      return;
    }

    const duplicatedSectionId = createSectionId();
    const sourceQuestions = questions.filter((question) => question.sectionId === sourceSection.id);
    const duplicatedQuestionIds = new Map(
      sourceQuestions.map((question) => [question.id, createQuestionId()]),
    );
    const duplicatedQuestions = sourceQuestions.map((question) => ({
      ...question,
      id: duplicatedQuestionIds.get(question.id),
      sectionId: duplicatedSectionId,
      branching: question.branching
        ? {
            ...question.branching,
            rules: (question.branching.rules ?? []).map((rule) => ({
              ...rule,
              targetQuestionId:
                duplicatedQuestionIds.get(rule.targetQuestionId) ?? rule.targetQuestionId,
            })),
            fallbackTargetQuestionId:
              duplicatedQuestionIds.get(question.branching.fallbackTargetQuestionId) ??
              question.branching.fallbackTargetQuestionId,
          }
        : question.branching,
    }));

    setSections((current) => {
      const nextSections = [...current];
      nextSections.splice(index + 1, 0, {
        ...sourceSection,
        id: duplicatedSectionId,
        title: sourceSection.title?.trim() ? `${sourceSection.title} 복사본` : '',
      });
      return nextSections;
    });

    setQuestions((current) => {
      const insertIndex = current.reduce((lastIndex, question, questionIndex) => {
        return question.sectionId === sourceSection.id ? questionIndex + 1 : lastIndex;
      }, 0);
      const nextQuestions = [...current];
      nextQuestions.splice(insertIndex, 0, ...duplicatedQuestions);
      return nextQuestions;
    });
  };

  const mergeSectionWithPrevious = (index) => {
    if (index <= 0) {
      return;
    }

    const currentSection = sections[index];
    const previousSection = sections[index - 1];

    if (!currentSection || !previousSection) {
      return;
    }

    setQuestions((current) =>
      current.map((question) =>
        question.sectionId === currentSection.id
          ? { ...question, sectionId: previousSection.id }
          : question,
      ),
    );
    removeSection(index);
  };

  const removeSection = (index) => {
    setSections((current) => {
      if (current.length === 1) {
        return current;
      }

      const nextSections = current.filter((_, sectionIndex) => sectionIndex !== index);
      const removedSectionId = current[index]?.id;
      const fallbackSectionId = nextSections[0]?.id ?? '';

      setQuestions((currentQuestions) =>
        currentQuestions.map((question) =>
          question.sectionId === removedSectionId
            ? { ...question, sectionId: fallbackSectionId }
            : question,
        ),
      );

      return nextSections;
    });
  };

  const splitSectionAfterQuestion = (questionIndex) => {
    const currentQuestion = questions[questionIndex];
    const currentSectionId = currentQuestion?.sectionId ?? sections[0]?.id ?? '';
    const currentSectionIndex = sections.findIndex((section) => section.id === currentSectionId);

    if (currentSectionIndex === -1 || questionIndex >= questions.length - 1) {
      return;
    }

    const nextSection = createEmptySection(sections.length);

    setSections((current) => {
      const nextSections = [...current];
      nextSections.splice(currentSectionIndex + 1, 0, nextSection);
      return nextSections;
    });

    setQuestions((current) =>
      current.map((question, index) =>
        index > questionIndex && question.sectionId === currentSectionId
          ? { ...question, sectionId: nextSection.id }
          : question,
      ),
    );
  };

  const handleFormTypeChange = (nextFormType) => {
    const normalizedConfiguration = normalizeSurveyConfiguration({ formType: nextFormType });
    setFormType(normalizedConfiguration.formType);
    setBranchingEnabled(normalizedConfiguration.branchingEnabled);
    setQuotaEnabled(normalizedConfiguration.quotaEnabled);
    setMaxResponses(
      normalizedConfiguration.maxResponses ? String(normalizedConfiguration.maxResponses) : '',
    );
    setDuplicateCheckEnabled(normalizedConfiguration.duplicateCheckEnabled);
    setSlotDuplicateCheckEnabled(normalizedConfiguration.slotDuplicateCheckEnabled);
    setOneSlotPerPersonEnabled(normalizedConfiguration.oneSlotPerPersonEnabled);
    setApplicantListView(normalizedConfiguration.applicantListView);
    setProcessingStatusEnabled(normalizedConfiguration.processingStatusEnabled);
    if (!isApplicationFormType(normalizedConfiguration.formType)) {
      setOpensAt('');
      setClosesAt('');
      setApplicationGuide('');
      setScheduleSummary('');
      setCautionText('');
    }
  };

  const handlePreview = () => {
    setShowPreviewModal(true);
  };

  const handleOpenPreviewWindow = () => {
    if (!surveyId) {
      setMessage('새 창 미리보기는 먼저 저장 후 확인하세요.');
      return;
    }

    if (typeof window !== 'undefined') {
      window.open(`/admin/surveys/${surveyId}/preview`, '_blank', 'noopener,noreferrer');
      return;
    }

    navigate(`/admin/surveys/${surveyId}/preview`);
  };

  const handleCopyShareLink = async () => {
    if (!isEditMode) {
      setMessage('공유 링크는 저장 후 복사할 수 있습니다.');
      return;
    }

    const shareUrl =
      typeof window === 'undefined'
        ? `/surveys/${surveyId}`
        : `${window.location.origin}/surveys/${surveyId}`;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setMessage('공유 링크를 복사했습니다.');
    } catch (error) {
      setMessage('공유 링크 복사에 실패했습니다. 브라우저 권한을 확인해주세요.');
    }
  };

  const applyStoredTemplate = (template) => {
    const instantiated = instantiateSurveyTemplate(template);
    const nextSections =
      instantiated.sections.length > 0 ? instantiated.sections : [createEmptySection(0)];
    const nextQuestions =
      instantiated.questions.length > 0
        ? instantiated.questions
        : [{ ...createEmptyQuestion(), sectionId: nextSections[0]?.id ?? '' }];

    setTitle('');
    setDescription(instantiated.description);
    setTableBlocks(instantiated.tableBlocks);
    setSections(nextSections);
    setQuestions(nextQuestions);
    setStatus(SURVEY_STATUSES.DRAFT);
    setFormType(instantiated.formType);
    setBranchingEnabled(instantiated.branchingEnabled);
    setQuotaEnabled(instantiated.quotaEnabled);
    setMaxResponses(instantiated.maxResponses ? String(instantiated.maxResponses) : '');
    setDuplicateCheckEnabled(instantiated.duplicateCheckEnabled);
    setSlotDuplicateCheckEnabled(instantiated.slotDuplicateCheckEnabled);
    setOneSlotPerPersonEnabled(instantiated.oneSlotPerPersonEnabled);
    setApplicantListView(instantiated.applicantListView);
    setProcessingStatusEnabled(instantiated.processingStatusEnabled);
    setOpensAt(instantiated.opensAt);
    setClosesAt(instantiated.closesAt);
    setApplicationGuide(instantiated.applicationGuide);
    setScheduleSummary(instantiated.scheduleSummary);
    setCautionText(instantiated.cautionText);
    setAllowResponseEdit(instantiated.allowResponseEdit);
    setCompletionMessage(instantiated.completionMessage);
    setAdminNotificationEnabled(instantiated.adminNotificationEnabled);
    setOptionQuotaCounts({});
    setSelectedStoredTemplateId(template.id);
    setSelectedStoredTemplateName(template.name);
    setSelectedStoredTemplateSourceSurveyId(template.sourceSurveyId ?? '');
    setSelectedTemplateId(template.id);
    setTemplateMetadata({
      templateId: template.id,
      templateCategory: template.category ?? '',
      templateType: 'firestore',
      templateVersion: 1,
    });
    setCreationMode('template');
    setShowStartWizard(false);
    setShowTemplatePicker(false);
    setMessage(`'${template.name}' 구조를 불러왔습니다. 새 설문 제목을 입력한 뒤 저장하세요.`);
  };

  useEffect(() => {
    if (isEditMode) return undefined;

    let cancelled = false;
    const requestedTemplateId = searchParams.get('templateId')?.trim() ?? '';

    async function loadStoredTemplates() {
      try {
        setStoredTemplatesLoading(true);
        setStoredTemplatesError('');
        const items = await fetchSurveyTemplates();
        if (cancelled) return;
        setStoredTemplates(items);

        if (requestedTemplateId) {
          const selected =
            items.find((template) => template.id === requestedTemplateId) ??
            (await fetchSurveyTemplateById(requestedTemplateId));
          if (cancelled) return;
          if (!selected || selected.active === false) {
            setStoredTemplatesError('선택한 템플릿을 찾을 수 없거나 비활성화되었습니다.');
            return;
          }
          applyStoredTemplate(selected);
        }
      } catch (templateError) {
        if (!cancelled) {
          console.error('[SurveyTemplates] builder load failed', templateError);
          setStoredTemplatesError(
            '설문 템플릿을 불러오지 못했습니다. 권한과 Firestore 규칙을 확인해주세요.',
          );
        }
      } finally {
        if (!cancelled) setStoredTemplatesLoading(false);
      }
    }

    loadStoredTemplates();
    return () => {
      cancelled = true;
    };
  }, [isEditMode, searchParams]);

  const applyTemplate = async (template) => {
    const disabledReason = getSaveDisabledReason();

    if (disabledReason) {
      setMessage(disabledReason);
      return;
    }

    const normalizedConfiguration = normalizeSurveyConfiguration({
      formType: template.formType,
      ...template.settings,
    });
    const nextTemplateMetadata = template.templateMetadata ?? { templateId: template.id, templateVersion: 1 };
    const rawTemplateSections =
      Array.isArray(template.sections) && template.sections.length > 0
        ? template.sections
        : [{ key: 'default', title: '섹션 1', description: '' }];
    const templateSections = rawTemplateSections.map((section, index) => ({
      ...createEmptySection(index),
      title: section.title || `섹션 ${index + 1}`,
      description: section.description || '',
    }));
    const sectionKeyToId = rawTemplateSections.reduce((result, section, index) => {
      if (section.key) {
        result.set(section.key, templateSections[index].id);
      }

      return result;
    }, new Map());
    const baseSectionId = templateSections[0].id;
    const normalizedTemplateQuestions = normalizeQuestions(template.questions ?? []);
    const duplicatedQuestionIds = normalizedTemplateQuestions.reduce((result, question) => {
      result.set(question.id, createQuestionId());
      return result;
    }, new Map());
    const templateQuestions = normalizedTemplateQuestions.map((question) => {
      const sourceQuestion = (template.questions ?? []).find(
        (item) => item.title === question.title && item.type === question.type,
      );

      return {
        ...question,
        id: duplicatedQuestionIds.get(question.id) ?? createQuestionId(),
        sectionId:
          sectionKeyToId.get(sourceQuestion?.sectionKey) ??
          (question.sectionId && sectionKeyToId.get(question.sectionId)) ??
          baseSectionId,
        branching: question.branching
          ? {
              ...question.branching,
              rules: (question.branching.rules ?? []).map((rule) => ({
                ...rule,
                targetQuestionId:
                  duplicatedQuestionIds.get(rule.targetQuestionId) ?? rule.targetQuestionId ?? '',
              })),
              fallbackTargetQuestionId:
                duplicatedQuestionIds.get(question.branching.fallbackTargetQuestionId) ??
                question.branching.fallbackTargetQuestionId ??
                '',
            }
          : question.branching,
      };
    });

    setSelectedTemplateId(template.id);
    setTemplateMetadata(nextTemplateMetadata);
    setTitle(template.survey.title ?? '');
    setDescription(template.survey.description ?? '');
    setSections(templateSections);
    setQuestions(
      templateQuestions.length
        ? templateQuestions
        : [
            {
              ...createEmptyQuestion(),
              sectionId: baseSectionId,
            },
          ],
    );
    setStatus(SURVEY_STATUSES.DRAFT);
    setFormType(normalizedConfiguration.formType);
    setBranchingEnabled(normalizedConfiguration.branchingEnabled);
    setQuotaEnabled(normalizedConfiguration.quotaEnabled);
    setMaxResponses(
      normalizedConfiguration.maxResponses ? String(normalizedConfiguration.maxResponses) : '',
    );
    setDuplicateCheckEnabled(normalizedConfiguration.duplicateCheckEnabled);
    setSlotDuplicateCheckEnabled(normalizedConfiguration.slotDuplicateCheckEnabled);
    setOneSlotPerPersonEnabled(normalizedConfiguration.oneSlotPerPersonEnabled);
    setApplicantListView(normalizedConfiguration.applicantListView);
    setProcessingStatusEnabled(normalizedConfiguration.processingStatusEnabled);
    setOpensAt(template.survey.opensAt ?? '');
    setClosesAt(template.survey.closesAt ?? '');
    setApplicationGuide(template.survey.applicationGuide ?? '');
    setScheduleSummary(template.survey.scheduleSummary ?? '');
    setCautionText(template.survey.cautionText ?? '');
    setAllowResponseEdit(Boolean(template.survey.allowResponseEdit));
    setCompletionMessage(template.survey.completionMessage ?? '');
    setAdminNotificationEnabled(Boolean(template.survey.adminNotificationEnabled));
    setOptionQuotaCounts({});
    setShowStartWizard(false);
    setShowTemplatePicker(false);

    if (isEditMode) {
      setMessage(`"${template.title}" 템플릿을 불러왔습니다. 필요한 내용을 수정한 뒤 저장하세요.`);
      return;
    }

    try {
      setSaving(true);
      const createdSurveyId = await createSurvey({
        title: template.survey.title ?? template.title,
        description: template.survey.description ?? '',
        questions: templateQuestions,
        sections: templateSections,
        status: SURVEY_STATUSES.DRAFT,
        formType: normalizedConfiguration.formType,
        branchingEnabled: normalizedConfiguration.branchingEnabled,
        quotaEnabled: normalizedConfiguration.quotaEnabled,
        maxResponses: normalizedConfiguration.maxResponses,
        duplicateCheckEnabled: normalizedConfiguration.duplicateCheckEnabled,
        slotDuplicateCheckEnabled: normalizedConfiguration.slotDuplicateCheckEnabled,
        oneSlotPerPersonEnabled: normalizedConfiguration.oneSlotPerPersonEnabled,
        applicantListView: normalizedConfiguration.applicantListView,
        processingStatusEnabled: normalizedConfiguration.processingStatusEnabled,
        opensAt: template.survey.opensAt ?? '',
        closesAt: template.survey.closesAt ?? '',
        applicationGuide: template.survey.applicationGuide ?? '',
        scheduleSummary: template.survey.scheduleSummary ?? '',
        cautionText: template.survey.cautionText ?? '',
        allowResponseEdit: Boolean(template.survey.allowResponseEdit),
        completionMessage: template.survey.completionMessage ?? '',
        adminNotificationEnabled: Boolean(template.survey.adminNotificationEnabled),
        templateMetadata: nextTemplateMetadata,
        createdBy: {
          uid: user?.uid ?? '',
          name: user?.displayName ?? '',
          email: user?.email ?? '',
          role,
        },
      });
      navigate(`/admin/surveys/${createdSurveyId}/edit`, {
        replace: true,
        state: {
          flashMessage: `"${template.title}" 템플릿 설문을 임시저장했습니다.`,
        },
      });
    } catch (error) {
      setMessage(
        getFirestoreErrorMessage(
          error,
          error.message || '템플릿 설문 저장에 실패했습니다. Firestore 권한과 환경변수를 확인해주세요.',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  const resetToBlankForm = () => {
    const blankSection = createEmptySection(0);
    setSelectedTemplateId('');
    setTemplateMetadata({});
    setTitle('');
    setDescription('');
    setTableBlocks([]);
    setSections([blankSection]);
    setQuestions([
      {
        ...createEmptyQuestion(),
        sectionId: blankSection.id,
      },
    ]);
    setStatus(SURVEY_STATUSES.DRAFT);
    setFormType(FORM_TYPES.GENERAL_SURVEY);
    setBranchingEnabled(FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.branchingEnabled);
    setQuotaEnabled(FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.quotaEnabled);
    setMaxResponses('');
    setDuplicateCheckEnabled(
      FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.duplicateCheckEnabled,
    );
    setSlotDuplicateCheckEnabled(
      FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.slotDuplicateCheckEnabled,
    );
    setOneSlotPerPersonEnabled(
      FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.oneSlotPerPersonEnabled,
    );
    setApplicantListView(FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.applicantListView);
    setProcessingStatusEnabled(
      FORM_TYPE_CONFIGS[FORM_TYPES.GENERAL_SURVEY].defaults.processingStatusEnabled,
    );
    setOpensAt('');
    setClosesAt('');
    setApplicationGuide('');
    setScheduleSummary('');
    setCautionText('');
    setAllowResponseEdit(false);
    setCompletionMessage('');
    setAdminNotificationEnabled(false);
    setOptionQuotaCounts({});
    setSelectedStoredTemplateId('');
    setSelectedStoredTemplateName('');
    setSelectedStoredTemplateSourceSurveyId('');
    setCreationMode('blank');
    setShowStartWizard(false);
    setMessage('빈 폼으로 초기화했습니다.');
  };

  const applyStartWizard = () => {
    const blankSection = createEmptySection(0);
    const startTypeMeta = START_WIZARD_TYPES.find((item) => item.id === wizardStartType) ?? START_WIZARD_TYPES[0];
    const defaultWizardPersonalFields = {
      name: wizardPersonalFields.name ?? isApplicationFormType(startTypeMeta.formType),
      phone: wizardPersonalFields.phone ?? isApplicationFormType(startTypeMeta.formType),
      email: Boolean(wizardPersonalFields.email),
      birthdate: Boolean(wizardPersonalFields.birthdate),
    };
    const nextFormType =
      ['program_application', 'event_application', 'volunteer_application'].includes(wizardStartType) &&
      ['영유아', '초등학생', '청소년'].includes(wizardAudience)
        ? FORM_TYPES.TARGETED_PARTICIPATION_APPLICATION
        : wizardStartType === 'needs_survey' && wizardAudience !== '지역주민'
          ? FORM_TYPES.TARGETED_SURVEY
          : startTypeMeta.formType;
    const normalizedConfiguration = normalizeSurveyConfiguration({ formType: nextFormType });
    const starterQuestions = createStarterQuestionsFromWizard(
      wizardStartType,
      blankSection.id,
      defaultWizardPersonalFields,
    );

    setSelectedTemplateId('');
    setTemplateMetadata({});
    setTitle('');
    setDescription(
      wizardAudience && wizardAudience !== '지역주민'
        ? `${wizardAudience} 대상 ${startTypeMeta.label}입니다.`
        : '',
    );
    setTableBlocks([]);
    setSections([blankSection]);
    setQuestions(
      starterQuestions.length
        ? starterQuestions
        : [
            {
              ...createEmptyQuestion(),
              sectionId: blankSection.id,
            },
          ],
    );
    setStatus(SURVEY_STATUSES.DRAFT);
    setFormType(normalizedConfiguration.formType);
    setBranchingEnabled(normalizedConfiguration.branchingEnabled);
    setQuotaEnabled(wizardUseQuota);
    setMaxResponses(wizardUseQuota ? '30' : '');
    setDuplicateCheckEnabled(normalizedConfiguration.duplicateCheckEnabled);
    setSlotDuplicateCheckEnabled(normalizedConfiguration.slotDuplicateCheckEnabled);
    setOneSlotPerPersonEnabled(normalizedConfiguration.oneSlotPerPersonEnabled);
    setApplicantListView(normalizedConfiguration.applicantListView);
    setProcessingStatusEnabled(normalizedConfiguration.processingStatusEnabled);
    setOpensAt(wizardOpensAt);
    setClosesAt(wizardClosesAt);
    setApplicationGuide('');
    setScheduleSummary('');
    setCautionText('');
    setAllowResponseEdit(false);
    setCompletionMessage('');
    setAdminNotificationEnabled(false);
    setSelectedStoredTemplateId('');
    setSelectedStoredTemplateName('');
    setSelectedStoredTemplateSourceSurveyId('');
    setCreationMode('blank');
    setShowStartWizard(false);
    setShowTemplatePicker(false);
    setMessage('기본 정보만 정리해두었습니다. 이제 질문을 바로 추가해보세요.');
    requestAnimationFrame(() => {
      questionSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    const disabledReason = getSaveDisabledReason();

    if (disabledReason) {
      setMessage(disabledReason);
      return;
    }

    if (!isFirebaseConfigured) {
      setMessage(firebaseStatusMessage || 'Firebase 설정이 필요합니다.');
      return;
    }

    if (!canCreateSurvey) {
      setMessage('설문을 생성하거나 수정할 권한이 없습니다.');
      return;
    }

    try {
      setSaving(true);
      setMessage('');
      const validQuestions = alignQuestionsToSections(sanitizeSurveyQuestions(questions), sections);

      if (!title.trim() || validQuestions.length === 0) {
        setMessage('설문 제목과 최소 1개의 질문을 입력해주세요.');
        return;
      }

      // 구조 검증: sectionId 누락/오류 질문, 빈 섹션 탐지
      if (sections.length > 1) {
        const validSectionIdSet = new Set(sections.map((s) => s.id));
        const invalidSectionQuestions = questions.filter(
          (q) => !validSectionIdSet.has(q.sectionId),
        );
        const sectionQuestionCounts = Object.fromEntries(sections.map((s) => [s.id, 0]));
        validQuestions.forEach((q) => {
          if (sectionQuestionCounts[q.sectionId] !== undefined) {
            sectionQuestionCounts[q.sectionId] += 1;
          }
        });
        const emptySections = sections.filter((s) => sectionQuestionCounts[s.id] === 0);

        if (invalidSectionQuestions.length > 0) {
          const titles = invalidSectionQuestions
            .map((q) => `"${String(q.title ?? '').slice(0, 20) || '제목 없음'}"`)
            .join(', ');
          console.warn(
            `[SurveyBuilder] sectionId 오류 질문 ${invalidSectionQuestions.length}개 → 첫 번째 섹션으로 자동 배정됨: ${titles}`,
          );
          setMessage(
            `⚠ 일부 질문(${invalidSectionQuestions.length}개)의 페이지 배정이 올바르지 않아 첫 번째 섹션으로 자동 배정되었습니다. 저장 후 질문 배치를 확인해주세요.`,
          );
        }

        if (emptySections.length > 0) {
          const names = emptySections.map((s) => `"${s.title || '제목 없음'}"`).join(', ');
          console.warn(`[SurveyBuilder] 빈 섹션 탐지: ${names}`);
          if (invalidSectionQuestions.length === 0) {
            setMessage(
              `⚠ 질문이 없는 빈 섹션이 있습니다: ${names}. 해당 섹션은 응답 흐름에서 건너뜁니다.`,
            );
          }
        }
      }

      const normalizedMaxResponses = quotaEnabled ? normalizeMaxResponses(maxResponses) : null;
      const validSections = sanitizeSurveySections(sections, validQuestions);
      const effectiveBranchingEnabled =
        validQuestions.some(
          (question) => Boolean(question.branching?.enabled) && (question.branching?.rules?.length ?? 0) > 0,
        ) ||
        validSections.some(
          (section) =>
            (section.visibilityConditions?.length ?? 0) > 0 ||
            (section.terminationEnabled && (section.terminationConditions?.length ?? 0) > 0),
        );

      if (quotaEnabled && !normalizedMaxResponses) {
        setMessage('정원 관리를 사용하는 경우 최대 응답 수를 1 이상으로 입력해주세요.');
        return;
      }

      // 개인정보 동의 검증: 공개(PUBLISHED) 상태에서만 강제 적용
      if (status === SURVEY_STATUSES.PUBLISHED) {
        const privacyResult = validatePrivacyConsent(validQuestions);
        if (!privacyResult.valid) {
          setMessage(privacyResult.warnings.join(' '));
          setSaving(false);
          return;
        }
      }

      if (isEditMode) {
        await updateSurvey(surveyId, {
          title: title.trim(),
          description: description.trim(),
          descriptionFormat: 'markdown',
          tableBlocks,
          questions: validQuestions,
          sections: validSections,
          status,
          formType,
          branchingEnabled: effectiveBranchingEnabled,
          quotaEnabled,
          maxResponses: normalizedMaxResponses,
          duplicateCheckEnabled,
          slotDuplicateCheckEnabled,
          oneSlotPerPersonEnabled,
          applicantListView,
          processingStatusEnabled,
          opensAt,
          closesAt,
          applicationGuide,
          scheduleSummary,
          cautionText,
          allowResponseEdit,
          completionMessage,
          adminNotificationEnabled,
          templateMetadata,
          updatedBy: {
            uid: user?.uid ?? '',
            name: user?.displayName ?? '',
            email: user?.email ?? '',
            role,
          },
        });
        if (validQuestions.length >= 500) {
          setMessage(`저장되었습니다. 문항이 ${validQuestions.length}개입니다. 응답 모드를 '페이지형'으로 설정하는 것을 권장합니다.`);
        } else if (validQuestions.length >= 300) {
          setMessage(`저장되었습니다. 문항이 ${validQuestions.length}개입니다. 섹션을 나눠 페이지형으로 운영하면 응답자 부담이 줄어듭니다.`);
        } else {
          setMessage('저장되었습니다.');
        }
        return;
      }

      const createdSurveyId = await createSurvey({
        title: title.trim(),
        description: description.trim(),
        descriptionFormat: 'markdown',
        tableBlocks,
        questions: validQuestions,
        sections: validSections,
        status,
        formType,
        branchingEnabled: effectiveBranchingEnabled,
        quotaEnabled,
        maxResponses: normalizedMaxResponses,
        duplicateCheckEnabled,
        slotDuplicateCheckEnabled,
        oneSlotPerPersonEnabled,
        applicantListView,
        processingStatusEnabled,
        opensAt,
        closesAt,
        applicationGuide,
        scheduleSummary,
        cautionText,
        allowResponseEdit,
        completionMessage,
        adminNotificationEnabled,
        templateMetadata,
        createdBy: {
          uid: user?.uid ?? '',
          name: user?.displayName ?? '',
          email: user?.email ?? '',
          role,
        },
      });
      if (selectedStoredTemplateId) {
        const actor = {
          uid: user?.uid ?? '',
          email: user?.email ?? '',
          displayName: user?.displayName ?? '',
        };
        try {
          await incrementSurveyTemplateUsage(selectedStoredTemplateId);
        } catch (templateUsageError) {
          console.warn('[SurveyTemplates] usage update failed', templateUsageError);
        }
        createAuditLog({
          action: 'survey_template_used',
          surveyId: createdSurveyId,
          surveyTitle: title.trim(),
          actor,
          metadata: {
            templateId: selectedStoredTemplateId,
            templateName: selectedStoredTemplateName,
            sourceSurveyId: selectedStoredTemplateSourceSurveyId,
          },
        });
      }
      navigate(`/admin/surveys/${createdSurveyId}/edit`, {
        replace: true,
        state: {
          flashMessage: '저장되었습니다.',
        },
      });
    } catch (error) {
      setMessage(
        getFirestoreErrorMessage(
          error,
          error.message || '설문 저장에 실패했습니다. Firestore 권한과 환경변수를 확인해주세요.',
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="empty-state">설문 정보를 불러오는 중입니다.</div>;
  }

  if (isEditMode && fetchError) {
    return <div className="empty-state">{fetchError}</div>;
  }

  if (isEditMode && notFound) {
    return <div className="empty-state">수정할 설문을 찾을 수 없습니다.</div>;
  }

  const showBranchingEditor = supportsBranchingFormType(formType) && branchingEnabled;
  const applicationForm = isApplicationFormType(formType);
  const getSaveDisabledReason = () => {
    if (saving) {
      return '';
    }

    if (!isFirebaseConfigured) {
      return firebaseStatusMessage || 'Firebase 설정이 필요합니다.';
    }

    if (authLoading) {
      return '사용자 권한 정보를 불러오는 중입니다.';
    }

    if (!user) {
      return '로그인이 필요합니다.';
    }

    if (profileError) {
      return profileError;
    }

    if (accountStatus === 'pending') {
      return '승인 대기 상태라 설문을 만들 수 없습니다.';
    }

    if (accountStatus === 'inactive' || accountStatus === 'blocked') {
      return '비활성화 또는 차단된 계정이라 설문을 저장할 수 없습니다.';
    }

    if (!canCreateSurvey) {
      return '제작자 권한이 없어 저장할 수 없습니다.';
    }

    if (isEditMode && !canEditSurvey({ ownerUid: user.uid, createdByUid: user.uid })) {
      return '이 설문을 수정할 권한이 없습니다.';
    }

    return '';
  };
  const saveDisabledReason = getSaveDisabledReason();
  const piiDetection = useMemo(() => detectPrivacyQuestions(questions), [questions]);
  const getTemplateBadges = (template) => {
    const badges = [];
    if (Array.isArray(template.tags) && template.tags.length > 0) {
      return template.tags;
    }
    const questionTypes = new Set((template.questions ?? []).map((question) => question.type));

    if (template.settings?.quotaEnabled) {
      badges.push('정원');
    }
    if (template.settings?.branchingEnabled) {
      badges.push('분기');
    }
    if (questionTypes.has(QUESTION_TYPES.APPLICATION_SLOT_CHOICE)) {
      badges.push('슬롯');
    }
    if (
      questionTypes.has(QUESTION_TYPES.LINEAR_SCALE) ||
      questionTypes.has(QUESTION_TYPES.RATING_SCALE) ||
      questionTypes.has(QUESTION_TYPES.NPS_SCALE)
    ) {
      badges.push('척도형');
    }
    if (
      questionTypes.has(QUESTION_TYPES.CONSENT_CHECKBOX) ||
      (template.questions ?? []).some((question) =>
        String(question.title ?? '').includes('개인정보'),
      )
    ) {
      badges.push('개인정보');
    }
    if (isApplicationFormType(template.formType)) {
      badges.push('신청형');
    }

    return badges;
  };
  const questionDisplayMap = buildQuestionDisplayMap(questions, sections);

  if (!isEditMode && !creationMode) {
    return (
      <section className="stack-section">
        <div className="section-heading">
          <div>
            <span className="eyebrow">새 폼 만들기</span>
            <h1>어떻게 시작할까요?</h1>
            <p>빈 설문을 직접 구성하거나 저장된 템플릿의 구조를 복사해 시작할 수 있습니다.</p>
          </div>
          <Link className="secondary-button" to="/admin/templates">
            설문 템플릿 관리
          </Link>
        </div>

        <div className="template-card-grid">
          <article className="template-start-card template-start-card-selected">
            <div>
              <span className="template-badge">직접 만들기</span>
              <h2>빈 설문 만들기</h2>
              <p>현재의 시작 도우미와 기본 문항 생성 방식을 그대로 사용합니다.</p>
            </div>
            <button
              className="primary-button"
              onClick={() => {
                setCreationMode('blank');
                setShowStartWizard(true);
              }}
              type="button"
            >
              빈 설문으로 시작
            </button>
          </article>

          {storedTemplatesLoading ? (
            <div className="empty-state">저장된 템플릿을 불러오는 중입니다.</div>
          ) : storedTemplatesError ? (
            <div className="empty-state">{storedTemplatesError}</div>
          ) : storedTemplates.length === 0 ? (
            <article className="template-start-card">
              <div>
                <span className="template-badge">템플릿</span>
                <h2>저장된 템플릿이 없습니다</h2>
                <p>설문 관리에서 기존 설문을 템플릿으로 저장할 수 있습니다.</p>
              </div>
              <Link className="secondary-button" to="/admin/surveys">
                설문 관리로 이동
              </Link>
            </article>
          ) : (
            storedTemplates.map((template) => (
              <article className="template-start-card" key={template.id}>
                <div>
                  <div className="template-badge-row">
                    <span className="template-badge">{template.category}</span>
                  </div>
                  <h2>{template.name}</h2>
                  <p>{template.description || '설명이 없습니다.'}</p>
                  <small>
                    사용 {template.usageCount}회 · 최근 수정 {formatFirestoreDate(template.updatedAt)}
                  </small>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => applyStoredTemplate(template)}
                  type="button"
                >
                  이 템플릿으로 시작
                </button>
              </article>
            ))
          )}
        </div>
      </section>
    );
  }

  const renderBuilderActionRow = () => (
    <div className="builder-direct-actions-wrap" ref={blockPickerRef}>
      <div className="builder-direct-actions">
        <button className="secondary-button" onClick={addQuestion} type="button">
          + 질문 추가
        </button>
        <button className="secondary-button" onClick={openSectionBuilder} type="button">
          + 여기서 페이지 나누기
        </button>
        <button className="secondary-button" onClick={openCommonBlocks} type="button">
          + 공통 항목 넣기
        </button>
      </div>
      {showBlockPicker && (
        <div className="builder-block-popover">
          <QuestionBlockPicker
            onAddBlock={addQuestionBlock}
            onAddConsentTemplate={addConsentTemplate}
            onClose={() => setShowBlockPicker(false)}
          />
        </div>
      )}
    </div>
  );

  return (
    <section className="builder-layout">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{isEditMode ? '폼 수정' : '새 폼 만들기'}</span>
          <h1>{isEditMode ? '폼 수정' : '새 폼 만들기'}</h1>
          <p>제목, 설명, 질문만 입력해도 바로 사용할 수 있습니다.</p>
        </div>
        <div className="card-actions">
          <button className="secondary-button" onClick={() => setShowSettingsPanel(true)} type="button">
            ⚙ 운영 설정
          </button>
          {isEditMode && (
            <Link className="secondary-button" to={`/admin/surveys/${surveyId}/responses`}>
              응답 보기
            </Link>
          )}
        </div>
      </div>

      {isEditMode && existingResponseCount > 0 && (
        <div className="inline-note">
          이미 {existingResponseCount}건의 응답이 있는 설문입니다. 질문 제목이나 보기 문구를 수정하면
          기존 응답 해석이 달라질 수 있습니다. 질문 ID는 유지되지만, 질문 삭제나 타입 변경은
          신중히 진행해주세요.
        </div>
      )}

      {!isEditMode && showStartWizard && (
        <div className="panel">
          <div className="builder-header-row">
            <div>
              <h2>시작 도우미</h2>
              <p className="meta-description">무엇을 만들지 가볍게 정한 뒤 바로 질문 작성을 시작하세요.</p>
            </div>
            <div className="card-actions">
              <button className="primary-button" onClick={applyStartWizard} type="button">
                바로 질문 만들기
              </button>
              <button
                className="secondary-button"
                onClick={() => setShowTemplatePicker((current) => !current)}
                type="button"
              >
                {showTemplatePicker ? '템플릿 닫기' : '템플릿 보기'}
              </button>
            </div>
          </div>

          <div className="inline-note">
            필요한 것만 고르고 바로 시작하세요. 대상은 나중에도 바꿀 수 있습니다.
          </div>

          <div className="builder-settings-group">
            <div className="field">
              <span>1. 무엇을 만들까요?</span>
              <div className="builder-chip-row">
                {START_WIZARD_TYPES.map((item) => (
                  <button
                    key={item.id}
                    className={`builder-chip-button ${wizardStartType === item.id ? 'builder-chip-button-selected' : ''}`}
                    onClick={() => setWizardStartType(item.id)}
                    title={item.description}
                    type="button"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="builder-subpanel">
              <div className="builder-header-row">
                <div>
                  <strong>템플릿으로 더 빠르게 시작하기</strong>
                  <p className="meta-description">이미 만들어진 구성으로 시작하고 싶을 때만 열어보세요.</p>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => setShowTemplatePicker((current) => !current)}
                  type="button"
                >
                  {showTemplatePicker ? '템플릿 접기' : '템플릿 보기'}
                </button>
              </div>

              {showTemplatePicker && (
                <div className="template-card-grid">
                  {FORM_TEMPLATES.map((template) => (
                    <article
                      className={`template-start-card ${
                        selectedTemplateId === template.id ? 'template-start-card-selected' : ''
                      }`}
                      key={template.id}
                    >
                      <div>
                        <strong>{template.title}</strong>
                        <p>{template.description}</p>
                        <div className="template-badge-row">
                          {getTemplateBadges(template).map((badge) => (
                            <span className="template-badge" key={`${template.id}-${badge}`}>
                              {badge}
                            </span>
                          ))}
                        </div>
                        <small>{template.preview}</small>
                      </div>
                      <button
                        className="secondary-button"
                        disabled={saving}
                        onClick={() => applyTemplate(template)}
                        type="button"
                      >
                        이 템플릿 사용하기
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </div>

            <label className="field">
              <span>2. 대상은 누구인가요?</span>
              <select value={wizardAudience} onChange={(event) => setWizardAudience(event.target.value)}>
                {START_WIZARD_AUDIENCES.map((audience) => (
                  <option key={audience} value={audience}>
                    {audience}
                  </option>
                ))}
              </select>
            </label>

            <div className="builder-inline-grid">
              <label className="field">
                <span>3. 시작일시</span>
                <input
                  type="datetime-local"
                  value={wizardOpensAt}
                  onChange={(event) => setWizardOpensAt(event.target.value)}
                />
              </label>

              <label className="field">
                <span>4. 종료일시</span>
                <input
                  type="datetime-local"
                  value={wizardClosesAt}
                  onChange={(event) => setWizardClosesAt(event.target.value)}
                />
              </label>
            </div>

            <div className="field">
              <span>5. 선착순으로 받을게요</span>
              <div className="builder-chip-row">
                <button
                  className={`builder-chip-button ${wizardUseQuota ? 'builder-chip-button-selected' : ''}`}
                  onClick={() => setWizardUseQuota(true)}
                  type="button"
                >
                  예
                </button>
                <button
                  className={`builder-chip-button ${!wizardUseQuota ? 'builder-chip-button-selected' : ''}`}
                  onClick={() => setWizardUseQuota(false)}
                  type="button"
                >
                  아니오
                </button>
              </div>
            </div>

            <div className="field">
              <span>6. 기본으로 받을 정보</span>
              <div className="builder-chip-row">
                {START_WIZARD_PERSONAL_FIELDS.map((item) => (
                  <label className="checkbox-field compact-checkbox-field" key={item.key}>
                    <input
                      checked={Boolean(wizardPersonalFields[item.key])}
                      onChange={(event) =>
                        setWizardPersonalFields((current) => ({
                          ...current,
                          [item.key]: event.target.checked,
                        }))
                      }
                      type="checkbox"
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      <form className="builder-form" onSubmit={handleSubmit}>
        <div className="panel">
          <div className="builder-header-row">
            <div>
              <h2>1. 폼 기본 정보</h2>
              <p className="meta-description">처음에는 제목과 설명만 입력하고 바로 질문을 만들면 됩니다.</p>
            </div>
          </div>
          <label className="field">
            <span>설문 제목</span>
            <input
              type="text"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="예: 2026년 프로그램 만족도 조사"
            />
          </label>

          <label className="field">
            <span>설문 설명</span>
            <textarea
              rows="7"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="설문 목적이나 참여 안내 문구를 입력하세요. 줄바꿈과 마크다운 표를 사용할 수 있습니다."
            />
          </label>
          <div className="field-helper-row">
            <p className="meta-description">
              줄바꿈은 응답자 화면에 그대로 반영됩니다. 운영시간표가 필요하면 표 예시를 넣어 수정하세요.
            </p>
            <button
              className="secondary-button"
              onClick={handleInsertDescriptionTableExample}
              type="button"
            >
              설명문에 표 예시 삽입
            </button>
          </div>

          {applicationForm && (
            <div className="builder-inline-grid">
              <label className="field">
                <span>시작일시</span>
                <input
                  type="datetime-local"
                  value={opensAt}
                  onChange={(event) => setOpensAt(event.target.value)}
                />
              </label>

              <label className="field">
                <span>종료일시</span>
                <input
                  type="datetime-local"
                  value={closesAt}
                  onChange={(event) => setClosesAt(event.target.value)}
                />
              </label>
            </div>
          )}
        </div>

        <div className="panel builder-focus-panel" ref={questionSectionRef}>
          <div className="builder-header-row">
            <div>
              <h2>2. 질문 작성</h2>
              <p className="meta-description">
                페이지를 나누면 응답자 화면에서도 단계별로 표시됩니다. 페이지를 나누지 않으면 모든 질문이 한 화면에 표시됩니다.
              </p>
            </div>
          </div>

        <div className="question-list">
          {sections.map((section, sectionIndex) => {
            const sectionQuestions = questions
              .map((question, questionIndex) => ({ question, questionIndex }))
              .filter(({ question }) => question.sectionId === section.id);

            return (
              <div className="builder-page-stack" key={section.id}>
                {hasVisiblePages && (
                  <SectionEditor
                    section={section}
                    index={sectionIndex}
                    sections={sections}
                    questions={questions}
                    questionDisplayMap={questionDisplayMap}
                    formType={formType}
                    isFirst={sectionIndex === 0}
                    isLast={sectionIndex === sections.length - 1}
                    onChange={(nextSection) => updateSection(sectionIndex, nextSection)}
                    onDuplicate={() => duplicateSection(sectionIndex)}
                    onMoveUp={() => moveSection(sectionIndex, 'up')}
                    onMoveDown={() => moveSection(sectionIndex, 'down')}
                    onMergeWithPrevious={() => mergeSectionWithPrevious(sectionIndex)}
                    onRemove={() => removeSection(sectionIndex)}
                  />
                )}

                {sectionQuestions.map(({ question, questionIndex }, localQuestionIndex) => (
                  <div className="builder-question-stack" key={`question-${question.id || questionIndex}`}>
                    <QuestionEditor
                      question={question}
                      index={questionIndex}
                      displayLabel={questionDisplayMap[question.id]?.shortLabel ?? ''}
                      questionDisplayMap={questionDisplayMap}
                      questions={questions}
                      sections={sections}
                      isFirst={questionIndex === 0}
                      isLast={questionIndex === questions.length - 1}
                      optionQuotaCounts={optionQuotaCounts}
                      showBranchingEditor={showBranchingEditor}
                      onChange={(nextQuestion) => updateQuestion(questionIndex, nextQuestion)}
                      onMoveUp={() => moveQuestion(questionIndex, 'up')}
                      onMoveDown={() => moveQuestion(questionIndex, 'down')}
                      onDuplicate={() => duplicateQuestion(questionIndex)}
                      onRemove={() => removeQuestion(questionIndex)}
                    />
                    {questionIndex < questions.length - 1 && (
                      <div className="builder-inline-actions">
                        <button
                          className="secondary-button"
                          onClick={() => splitSectionAfterQuestion(questionIndex)}
                          type="button"
                        >
                          + 여기서 페이지 나누기
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>

          <div className="builder-footer builder-footer-stacked">
            {renderBuilderActionRow()}
            <small className="muted-label">
              질문을 만든 뒤 응답 형식을 바꾸면 신청 슬롯형, 척도형, 개인정보 동의도 바로 만들 수 있습니다.
            </small>
        </div>
        </div>

        {showSettingsPanel && (
          <div
            className="settings-drawer-backdrop"
            onClick={() => setShowSettingsPanel(false)}
            role="presentation"
          >
            <aside
              aria-label="운영 설정"
              className="settings-drawer"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="settings-drawer-header">
                <div>
                  <span className="eyebrow">운영 설정</span>
                  <h2>필요할 때만 조정하세요</h2>
                  <p>답변별 이동은 질문카드에서만 설정됩니다.</p>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => setShowSettingsPanel(false)}
                  type="button"
                >
                  닫기
                </button>
              </div>

              <div className="settings-drawer-body">
                <label className="field">
                  <span>공개 상태</span>
                  <select value={status} onChange={(event) => setStatus(event.target.value)}>
                    <option value={SURVEY_STATUSES.DRAFT}>임시저장</option>
                    <option value={SURVEY_STATUSES.PUBLISHED}>게시중</option>
                    <option value={SURVEY_STATUSES.CLOSED}>마감</option>
                  </select>
                </label>

                <div className="toggle-grid">
                  <label className="checkbox-field">
                    <input
                      checked={duplicateCheckEnabled}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setDuplicateCheckEnabled(checked);
                        setSlotDuplicateCheckEnabled(checked && applicationForm);
                        setOneSlotPerPersonEnabled(checked && applicationForm);
                      }}
                      type="checkbox"
                    />
                    <span>중복 응답 방지</span>
                  </label>

                  <label className="checkbox-field">
                    <input
                      checked={allowResponseEdit}
                      onChange={(event) => setAllowResponseEdit(event.target.checked)}
                      type="checkbox"
                    />
                    <span>응답 수정 허용</span>
                  </label>

                  <label className="checkbox-field">
                    <input
                      checked={applicantListView}
                      onChange={(event) => setApplicantListView(event.target.checked)}
                      type="checkbox"
                    />
                    <span>신청자 목록 보기</span>
                  </label>

                  <label className="checkbox-field">
                    <input
                      checked={quotaEnabled}
                      onChange={(event) => {
                        setQuotaEnabled(event.target.checked);

                        if (!event.target.checked) {
                          setMaxResponses('');
                        }
                      }}
                      type="checkbox"
                    />
                    <span>전체 정원 제한</span>
                  </label>

                  <label className="checkbox-field">
                    <input
                      checked={adminNotificationEnabled}
                      onChange={(event) => setAdminNotificationEnabled(event.target.checked)}
                      type="checkbox"
                    />
                    <span>관리자 알림</span>
                  </label>
                </div>

                {quotaEnabled && (
                  <label className="field">
                    <span>전체 정원</span>
                    <input
                      min="1"
                      type="number"
                      value={maxResponses}
                      onChange={(event) => setMaxResponses(event.target.value)}
                      placeholder="예: 30"
                    />
                    <small>응답 수가 정원에 도달하면 자동으로 마감됩니다.</small>
                  </label>
                )}

                <label className="field">
                  <span>제출 완료 문구</span>
                  <textarea
                    rows="4"
                    value={completionMessage}
                    onChange={(event) => setCompletionMessage(event.target.value)}
                    placeholder="예: 참여해주셔서 감사합니다. 담당자가 확인 후 안내드리겠습니다."
                  />
                </label>

                <div className="inline-note">
                  답변별 이동은 객관식 또는 드롭다운 질문카드에서
                  <strong> 응답에 따라 다음 화면 다르게 하기</strong>를 체크하면 바로 사용할 수 있습니다.
                </div>
              </div>
            </aside>
          </div>
        )}

      {message && <div className="form-message">{message}</div>}
      {saveDisabledReason && <div className="inline-note">{saveDisabledReason}</div>}
      {questions.length >= 300 && (
        <div className="inline-note">
          {questions.length >= 500
            ? `문항이 ${questions.length}개입니다. 응답 모드를 '페이지형'으로 설정하면 응답자 부담을 줄일 수 있습니다.`
            : `문항이 ${questions.length}개입니다. 섹션을 나눠 페이지형으로 운영하면 응답자 부담이 줄어듭니다.`}
        </div>
      )}
      {piiDetection.hasPiiQuestions && (
        <div className="inline-note">
          개인정보 수집 가능 문항 {piiDetection.piiQuestions.length}개 포함
          {!piiDetection.hasConsentQuestion && ' · 개인정보 동의 문항이 없습니다.'}
        </div>
      )}

      <div className="builder-footer builder-save-bar">
          <div className="card-actions">
            <button className="secondary-button" onClick={handlePreview} type="button">
              미리보기
            </button>
          <button className="primary-button" disabled={saving || Boolean(saveDisabledReason)} type="submit">
            {saving ? '저장 중...' : isEditMode ? '설문 수정하기' : '설문 저장하기'}
          </button>
            <button className="secondary-button" onClick={handleCopyShareLink} type="button">
              공유 링크 복사
            </button>
          </div>
        </div>
      </form>

      {showPreviewModal && (
        <div
          className="preview-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setShowPreviewModal(false);
            }
          }}
          role="presentation"
        >
          <div className="preview-modal" role="dialog" aria-modal="true" aria-label="설문 미리보기">
            <div className="preview-modal-header">
              <div>
                <span className="eyebrow">빠른 미리보기</span>
                <h2>설문 전체 확인</h2>
              </div>
              <div className="card-actions">
                <button
                  className="primary-button"
                  onClick={() => setShowPreviewModal(false)}
                  type="button"
                >
                  수정 계속하기
                </button>
                <button
                  className="secondary-button"
                  onClick={handleOpenPreviewWindow}
                  type="button"
                >
                  새 창에서 보기
                </button>
              </div>
            </div>
            {!surveyId && (
              <div className="inline-note">
                현재 모달은 저장 전 내용으로 표시됩니다. 새 창 미리보기는 저장 후 사용할 수 있습니다.
              </div>
            )}
            <SurveyPreviewContent survey={previewSurvey} compact />
          </div>
        </div>
      )}
    </section>
  );
}

export default SurveyBuilderPage;
