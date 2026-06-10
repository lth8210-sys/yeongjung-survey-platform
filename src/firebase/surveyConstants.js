export const SURVEY_STATUSES = {
  DRAFT: 'draft',
  PUBLISHED: 'published',
  CLOSED: 'closed',
  DELETED: 'deleted',
};

export const FORM_TYPES = {
  TARGETED_SURVEY: 'targeted_survey',
  GENERAL_SURVEY: 'general_survey',
  TARGETED_PARTICIPATION_APPLICATION: 'targeted_participation_application',
  GENERAL_APPLICATION: 'general_application',
};

export const FORM_TYPE_CONFIGS = {
  [FORM_TYPES.TARGETED_SURVEY]: {
    label: '특정 설문형',
    description: '특정 대상이나 상황에 맞춘 조사입니다. 분기 확장이 필요한 유형입니다.',
    defaults: {
      branchingEnabled: true,
      quotaEnabled: false,
      duplicateCheckEnabled: false,
      slotDuplicateCheckEnabled: false,
      oneSlotPerPersonEnabled: false,
      applicantListView: false,
      processingStatusEnabled: false,
    },
  },
  [FORM_TYPES.GENERAL_SURVEY]: {
    label: '일반 설문형',
    description: '만족도 조사, 의견수렴 등 분기 없는 보편형 설문입니다.',
    defaults: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: false,
      slotDuplicateCheckEnabled: false,
      oneSlotPerPersonEnabled: false,
      applicantListView: false,
      processingStatusEnabled: false,
    },
  },
  [FORM_TYPES.TARGETED_PARTICIPATION_APPLICATION]: {
    label: '특정 참여신청형',
    description: '대상에 따라 흐름이 달라질 수 있는 신청형입니다. 정원과 중복신청 방지가 중요합니다.',
    defaults: {
      branchingEnabled: true,
      quotaEnabled: true,
      duplicateCheckEnabled: true,
      slotDuplicateCheckEnabled: true,
      oneSlotPerPersonEnabled: true,
      applicantListView: true,
      processingStatusEnabled: true,
    },
  },
  [FORM_TYPES.GENERAL_APPLICATION]: {
    label: '일반 신청형',
    description: '일반적인 접수/신청서 형태입니다. 명단과 처리상태 관리가 중요합니다.',
    defaults: {
      branchingEnabled: false,
      quotaEnabled: false,
      duplicateCheckEnabled: true,
      slotDuplicateCheckEnabled: true,
      oneSlotPerPersonEnabled: true,
      applicantListView: true,
      processingStatusEnabled: true,
    },
  },
};

export const QUESTION_TYPES = {
  SHORT_TEXT: 'shortText',
  LONG_TEXT: 'longText',
  EMAIL: 'email',
  PHONE: 'phone',
  DATE: 'date',
  TIME: 'time',
  NUMBER: 'number',
  LINEAR_SCALE: 'linearScale',
  RATING_SCALE: 'ratingScale',
  NPS_SCALE: 'npsScale',
  SINGLE_CHOICE: 'singleChoice',
  MULTIPLE_CHOICE: 'multipleChoice',
  DROPDOWN: 'dropdown',
  APPLICATION_SLOT_CHOICE: 'applicationSlotChoice',
  CONSENT_CHECKBOX: 'consentCheckbox',
  DESCRIPTION_BLOCK: 'descriptionBlock',
  SECTION_TITLE: 'sectionTitle',
};

export const SELECTABLE_QUESTION_TYPES = new Set([
  QUESTION_TYPES.SINGLE_CHOICE,
  QUESTION_TYPES.MULTIPLE_CHOICE,
  QUESTION_TYPES.DROPDOWN,
  QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
]);

export const NON_RESPONSE_QUESTION_TYPES = new Set([
  QUESTION_TYPES.DESCRIPTION_BLOCK,
  QUESTION_TYPES.SECTION_TITLE,
]);

export const SCALE_QUESTION_TYPES = new Set([
  QUESTION_TYPES.LINEAR_SCALE,
  QUESTION_TYPES.RATING_SCALE,
  QUESTION_TYPES.NPS_SCALE,
]);

export const OTHER_OPTION_VALUE = '__other__';

export const BRANCH_ACTIONS = {
  NEXT: 'next',
  GO_TO: 'go_to',
  END: 'end',
};

export const CONDITION_OPERATORS = {
  EQUALS: 'equals',
  NOT_EQUALS: 'not_equals',
  INCLUDES: 'includes',
  NOT_INCLUDES: 'not_includes',
  IS_EMPTY: 'is_empty',
  IS_NOT_EMPTY: 'is_not_empty',
};

export const CONDITION_COMBINATORS = {
  AND: 'AND',
  OR: 'OR',
};

export const RESPONSE_PROCESSING_STATUSES = {
  RECEIVED: 'received',
  REVIEWING: 'reviewing',
  APPROVED: 'approved',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELED: 'canceled',
};

export const RESPONSE_STATUSES = {
  SUBMITTED: 'submitted',
  IN_REVIEW: 'in_review',
  APPROVED: 'approved',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
  CANCELLED: 'cancelled',
  FOLLOW_UP: 'follow_up',
};
