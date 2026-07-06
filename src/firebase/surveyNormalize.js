import {
  BRANCH_ACTIONS,
  CONDITION_COMBINATORS,
  CONDITION_OPERATORS,
  NON_RESPONSE_QUESTION_TYPES,
  OTHER_OPTION_VALUE,
  QUESTION_TYPES,
  SCALE_QUESTION_TYPES,
  SELECTABLE_QUESTION_TYPES,
} from './surveyConstants';

const QUESTION_TYPE_ALIASES = {
  short_text: QUESTION_TYPES.SHORT_TEXT,
  short: QUESTION_TYPES.SHORT_TEXT,
  text: QUESTION_TYPES.SHORT_TEXT,
  input: QUESTION_TYPES.SHORT_TEXT,
  subjective_short: QUESTION_TYPES.SHORT_TEXT,
  long_text: QUESTION_TYPES.LONG_TEXT,
  long: QUESTION_TYPES.LONG_TEXT,
  textarea: QUESTION_TYPES.LONG_TEXT,
  paragraph: QUESTION_TYPES.LONG_TEXT,
  subjective: QUESTION_TYPES.LONG_TEXT,
  subjective_long: QUESTION_TYPES.LONG_TEXT,
  email: QUESTION_TYPES.EMAIL,
  phone: QUESTION_TYPES.PHONE,
  date: QUESTION_TYPES.DATE,
  time: QUESTION_TYPES.TIME,
  number: QUESTION_TYPES.NUMBER,
  linear_scale: QUESTION_TYPES.LINEAR_SCALE,
  scale: QUESTION_TYPES.LINEAR_SCALE,
  rating_scale: QUESTION_TYPES.RATING_SCALE,
  rating: QUESTION_TYPES.RATING_SCALE,
  nps_scale: QUESTION_TYPES.NPS_SCALE,
  nps: QUESTION_TYPES.NPS_SCALE,
  single_choice: QUESTION_TYPES.SINGLE_CHOICE,
  radio: QUESTION_TYPES.SINGLE_CHOICE,
  choice: QUESTION_TYPES.SINGLE_CHOICE,
  multiple_choice: QUESTION_TYPES.MULTIPLE_CHOICE,
  checkbox: QUESTION_TYPES.MULTIPLE_CHOICE,
  checkboxes: QUESTION_TYPES.MULTIPLE_CHOICE,
  dropdown: QUESTION_TYPES.DROPDOWN,
  select: QUESTION_TYPES.DROPDOWN,
  application_slot_choice: QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
  application_slot: QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
  slot: QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
  consent_checkbox: QUESTION_TYPES.CONSENT_CHECKBOX,
  consent: QUESTION_TYPES.CONSENT_CHECKBOX,
  privacy_consent: QUESTION_TYPES.CONSENT_CHECKBOX,
  description_block: QUESTION_TYPES.DESCRIPTION_BLOCK,
  description: QUESTION_TYPES.DESCRIPTION_BLOCK,
  안내문: QUESTION_TYPES.DESCRIPTION_BLOCK,
  section_title: QUESTION_TYPES.SECTION_TITLE,
  section: QUESTION_TYPES.SECTION_TITLE,
};

function createLocalId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createBranchRuleId() {
  return createLocalId('branch');
}

export function createSectionId() {
  return createLocalId('section');
}

export function createConditionId() {
  return createLocalId('condition');
}

export function createQuestionId() {
  return createLocalId('question');
}

export function normalizeQuestionType(type) {
  if (Object.values(QUESTION_TYPES).includes(type)) {
    return type;
  }

  if (typeof type === 'string' && QUESTION_TYPE_ALIASES[type]) {
    return QUESTION_TYPE_ALIASES[type];
  }

  return QUESTION_TYPES.SHORT_TEXT;
}

export function isSelectableQuestionType(type) {
  return SELECTABLE_QUESTION_TYPES.has(normalizeQuestionType(type));
}

export function isNonResponseQuestionType(type) {
  return NON_RESPONSE_QUESTION_TYPES.has(normalizeQuestionType(type));
}

export function supportsPlaceholder(type) {
  const normalizedType = normalizeQuestionType(type);
  return [
    QUESTION_TYPES.SHORT_TEXT,
    QUESTION_TYPES.LONG_TEXT,
    QUESTION_TYPES.EMAIL,
    QUESTION_TYPES.PHONE,
    QUESTION_TYPES.DATE,
    QUESTION_TYPES.TIME,
    QUESTION_TYPES.NUMBER,
  ].includes(normalizedType);
}

export function isScaleQuestionType(type) {
  return SCALE_QUESTION_TYPES.has(normalizeQuestionType(type));
}

export function normalizeBranchAction(action) {
  if (Object.values(BRANCH_ACTIONS).includes(action)) {
    return action;
  }

  return BRANCH_ACTIONS.NEXT;
}

export function normalizeConditionOperator(operator) {
  if (Object.values(CONDITION_OPERATORS).includes(operator)) {
    return operator;
  }

  return CONDITION_OPERATORS.EQUALS;
}

export function normalizeConditionCombinator(combinator) {
  if (Object.values(CONDITION_COMBINATORS).includes(combinator)) {
    return combinator;
  }

  return CONDITION_COMBINATORS.AND;
}

function normalizeQuestionId(id, index) {
  if (typeof id === 'string' && id.trim()) {
    return id.trim();
  }

  return `legacy-question-${index + 1}`;
}

export function sanitizeQuestionOptions(options) {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option) => {
      if (typeof option === 'string') {
        return option.trim();
      }

      if (option && typeof option === 'object') {
        return option.value?.trim?.() ?? option.label?.trim?.() ?? option.title?.trim?.() ?? '';
      }

      return '';
    })
    .filter(Boolean);
}

function normalizeQuestionTextField(primaryValue, secondaryValue) {
  return primaryValue?.trim?.() ?? secondaryValue?.trim?.() ?? '';
}

function normalizeScaleBoundary(value, fallbackValue) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallbackValue;
  }

  return Math.floor(numericValue);
}

function normalizeScaleLabel(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function getScalePresetDefaults(type) {
  const normalizedType = normalizeQuestionType(type);

  if (normalizedType === QUESTION_TYPES.NPS_SCALE) {
    return {
      preset: 'nps10',
      min: 0,
      max: 10,
      minLabel: '전혀 추천하지 않음',
      maxLabel: '매우 추천함',
    };
  }

  if (normalizedType === QUESTION_TYPES.RATING_SCALE) {
    return {
      preset: 'agreement7',
      min: 1,
      max: 7,
      minLabel: '전혀 그렇지 않다',
      maxLabel: '매우 그렇다',
    };
  }

  return {
    preset: 'satisfaction5',
    min: 1,
    max: 5,
    minLabel: '전혀 만족하지 않음',
    maxLabel: '매우 만족',
  };
}

function normalizeScaleSettings(question = {}, type) {
  const defaults = getScalePresetDefaults(type);
  const rawSettings =
    question.settings && typeof question.settings === 'object' && !Array.isArray(question.settings)
      ? question.settings
      : {};

  const nextSettings = {
    preset:
      typeof rawSettings.preset === 'string' && rawSettings.preset.trim()
        ? rawSettings.preset.trim()
        : defaults.preset,
    min: normalizeScaleBoundary(rawSettings.min, defaults.min),
    max: normalizeScaleBoundary(rawSettings.max, defaults.max),
    minLabel: normalizeScaleLabel(rawSettings.minLabel) || defaults.minLabel,
    maxLabel: normalizeScaleLabel(rawSettings.maxLabel) || defaults.maxLabel,
  };

  if (nextSettings.max <= nextSettings.min) {
    nextSettings.max = nextSettings.min + 1;
  }

  return nextSettings;
}

function normalizeOptionCapacity(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return Math.floor(numericValue);
}

function normalizeSlotText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeSlotSortOrder(value, fallbackOrder = 1) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallbackOrder;
  }

  return Math.floor(numericValue);
}

function normalizeQuestionOptionSettings(question = {}, normalizedOptions = []) {
  const rawSettings =
    question.optionSettings && typeof question.optionSettings === 'object' && !Array.isArray(question.optionSettings)
      ? question.optionSettings
      : {};
  const questionType = normalizeQuestionType(question.type);

  return normalizedOptions.reduce((result, optionLabel, optionIndex) => {
    const legacyOptionObject = Array.isArray(question.options)
      ? question.options.find(
          (option) =>
            option &&
            typeof option === 'object' &&
            (option.value?.trim?.() ?? option.label?.trim?.() ?? option.title?.trim?.() ?? '') === optionLabel,
        )
      : null;
    const rawSetting = rawSettings[optionLabel] ?? legacyOptionObject ?? {};
    const capacity = normalizeOptionCapacity(rawSetting.capacity);

    const nextSetting = {};

    if (capacity) {
      nextSetting.capacity = capacity;
    }

    if (questionType === QUESTION_TYPES.APPLICATION_SLOT_CHOICE) {
      nextSetting.title = normalizeSlotText(rawSetting.title) || optionLabel;
      nextSetting.date = normalizeSlotText(rawSetting.date);
      nextSetting.time = normalizeSlotText(rawSetting.time);
      nextSetting.place = normalizeSlotText(rawSetting.place);
      nextSetting.ageGroup = normalizeSlotText(rawSetting.ageGroup);
      nextSetting.sortOrder = normalizeSlotSortOrder(rawSetting.sortOrder, optionIndex + 1);
    }

    if (Object.keys(nextSetting).length > 0) {
      result[optionLabel] = nextSetting;
    }

    return result;
  }, {});
}

export function normalizeBranching(branching = {}, question = {}, index = 0) {
  const selectableType = isSelectableQuestionType(question.type);
  const normalizedOptions = sanitizeQuestionOptions(question.options);
  const availableOptionValues = new Set(normalizedOptions);

  if (question.allowOther) {
    availableOptionValues.add(OTHER_OPTION_VALUE);
  }

  if (!selectableType) {
    return {
      enabled: false,
      rules: [],
      fallbackAction: BRANCH_ACTIONS.NEXT,
      fallbackTargetQuestionId: '',
    };
  }

  const normalizedRules = Array.isArray(branching.rules)
    ? branching.rules.reduce((result, rule) => {
        const whenOption = rule?.whenOption?.trim?.() ?? '';

        if (!availableOptionValues.has(whenOption)) {
          return result;
        }

        result.push({
          id:
            typeof rule?.id === 'string' && rule.id.trim() ? rule.id.trim() : createBranchRuleId(),
          whenOption,
          action: normalizeBranchAction(rule?.action),
          targetType:
            rule?.targetType === 'page' || rule?.targetType === 'question'
              ? rule.targetType
              : normalizeBranchAction(rule?.action) === BRANCH_ACTIONS.GO_TO
                ? 'question'
                : '',
          targetQuestionId:
            normalizeBranchAction(rule?.action) === BRANCH_ACTIONS.GO_TO &&
            typeof rule?.targetQuestionId === 'string'
              ? rule.targetQuestionId.trim()
              : '',
        });

        return result;
      }, [])
    : [];

  return {
    enabled: Boolean(branching.enabled) && normalizedRules.length > 0,
    rules: normalizedRules,
    fallbackAction: normalizeBranchAction(branching.fallbackAction),
    fallbackTargetQuestionId:
      normalizeBranchAction(branching.fallbackAction) === BRANCH_ACTIONS.GO_TO &&
      typeof branching.fallbackTargetQuestionId === 'string'
        ? branching.fallbackTargetQuestionId.trim()
        : '',
  };
}

export function normalizeQuestion(question = {}) {
  const type = normalizeQuestionType(question.type);
  const normalizedOptions = isSelectableQuestionType(type)
    ? sanitizeQuestionOptions(question.options)
    : [];
  const id = normalizeQuestionId(question.id, question.index ?? 0);
  const allowOther = isSelectableQuestionType(type) ? Boolean(question.allowOther) : false;
  const title = normalizeQuestionTextField(question.title, question.label);
  const description = normalizeQuestionTextField(question.description, question.helpText);
  const placeholder = supportsPlaceholder(type) ? question.placeholder?.trim?.() ?? '' : '';
  const optionSettings =
    type === QUESTION_TYPES.SINGLE_CHOICE ||
    type === QUESTION_TYPES.DROPDOWN ||
    type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE
      ? normalizeQuestionOptionSettings(question, normalizedOptions)
      : {};
  const sortedOptions =
    type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE
      ? [...normalizedOptions].sort((first, second) => {
          const firstOrder = normalizeSlotSortOrder(optionSettings?.[first]?.sortOrder, 1);
          const secondOrder = normalizeSlotSortOrder(optionSettings?.[second]?.sortOrder, 1);
          return firstOrder - secondOrder;
        })
      : normalizedOptions;

  return {
    id,
    title,
    label: title,
    description,
    helpText: description,
    type,
    options: sortedOptions,
    optionSettings,
    required: isNonResponseQuestionType(type) ? false : Boolean(question.required),
    allowOther,
    placeholder,
    validation:
      question.validation && typeof question.validation === 'object' ? question.validation : {},
    sectionId: question.sectionId?.trim?.() ?? '',
    sectionKey: question.sectionKey?.trim?.() ?? '',
    pageId: question.pageId?.trim?.() ?? '',
    pageKey: question.pageKey?.trim?.() ?? '',
    settings: isScaleQuestionType(type)
      ? normalizeScaleSettings(question, type)
      : question.settings && typeof question.settings === 'object'
        ? question.settings
        : {},
    meta: question.meta && typeof question.meta === 'object' ? question.meta : {},
    branching: normalizeBranching(
      question.branching,
      {
        ...question,
        id,
        type,
        options: sortedOptions,
        allowOther,
      },
      question.index ?? 0,
    ),
  };
}

export function normalizeQuestions(questions = []) {
  if (!Array.isArray(questions)) {
    return [];
  }

  return questions.map((question, index) => normalizeQuestion({ ...question, index }));
}

export function getScaleQuestionConfig(question = {}) {
  const normalizedQuestion = normalizeQuestion(question);

  if (!isScaleQuestionType(normalizedQuestion.type)) {
    return null;
  }

  const { min, max, minLabel, maxLabel, preset } = normalizedQuestion.settings ?? {};

  return {
    preset,
    min,
    max,
    minLabel,
    maxLabel,
    values: Array.from({ length: max - min + 1 }, (_, index) => min + index),
  };
}

/**
 * 다중선택 문항의 최대 선택 개수를 판정한다.
 * 1순위: 명시적으로 설정된 값(question.validation.maxSelections 등 — 빌더 UI에서
 * 설정). normalizeQuestion()이 top-level 필드는 화이트리스트로 걸러내므로
 * validation/settings/meta 하위에 저장된 값만 저장 후에도 살아남는다.
 * 2순위(하위호환): "2개까지 선택", "최대 2개", "2개까지 고르" 등 문항 제목/설명/
 * 옵션에 적힌 텍스트에서 개수를 추출한다. 이미 만들어진 설문(예: 욕구조사
 * 템플릿)이 텍스트로만 제한을 표시하고 실제 데이터에는 값이 없는 경우를 위한
 * 안전망이며, 명시적 값이 있으면 텍스트보다 항상 우선한다.
 */
export function getMaxSelections(question = {}) {
  const candidates = [
    question.maxSelections,
    question.settings?.maxSelections,
    question.validation?.maxSelections,
    question.validation?.max,
    question.meta?.maxSelections,
  ];
  const configuredValue = candidates.find((value) => Number.isFinite(Number(value)) && Number(value) > 0);

  if (configuredValue !== undefined) {
    return Math.floor(Number(configuredValue));
  }

  const searchableText = [
    question.title,
    question.label,
    question.description,
    question.helpText,
    ...(Array.isArray(question.options) ? question.options : []),
  ].filter(Boolean).join(' ');
  const match = searchableText.match(/(?:최대\s*(\d+)\s*개)|(?:(\d+)\s*개\s*까지\s*(?:선택|고르|체크|선정))/);
  const matchedValue = match ? (match[1] ?? match[2]) : null;

  return matchedValue ? Math.floor(Number(matchedValue)) : null;
}

export function isAnswerEmpty(question, answer) {
  const normalizedType = normalizeQuestionType(question?.type);

  if (isNonResponseQuestionType(normalizedType)) {
    return false;
  }

  if (!question?.required) {
    return false;
  }

  if (normalizedType === QUESTION_TYPES.CONSENT_CHECKBOX) {
    return answer !== true;
  }

  if (normalizedType === QUESTION_TYPES.MULTIPLE_CHOICE) {
    return !Array.isArray(answer) || answer.length === 0;
  }

  return !String(answer ?? '').trim();
}
