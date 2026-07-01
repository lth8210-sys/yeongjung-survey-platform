import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  Timestamp,
  runTransaction,
  updateDoc,
  where,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  writeBatch,
} from 'firebase/firestore';
import { db, getFirebaseStatusMessage, isFirebaseConfigured } from './config';
import {
  BRANCH_ACTIONS,
  CONDITION_COMBINATORS,
  CONDITION_OPERATORS,
  FORM_TYPE_CONFIGS,
  FORM_TYPES,
  OTHER_OPTION_VALUE,
  QUESTION_TYPES,
  RESPONSE_PROCESSING_STATUSES,
  RESPONSE_STATUSES,
  SURVEY_STATUSES,
} from './surveyConstants';
import {
  createConditionId,
  createSectionId,
  getScaleQuestionConfig,
  isAnswerEmpty,
  isNonResponseQuestionType,
  isScaleQuestionType,
  isSelectableQuestionType,
  normalizeBranchAction,
  normalizeBranching,
  normalizeConditionCombinator,
  normalizeConditionOperator,
  normalizeQuestion,
  normalizeQuestions,
  normalizeQuestionType,
  sanitizeQuestionOptions,
  supportsPlaceholder,
} from './surveyNormalize';
import {
  canManageAllSurveys,
  normalizeSurveyVisibility,
  SURVEY_VISIBILITIES,
  USER_ROLES,
} from './users';
import { logger } from '../utils/logger';

export {
  BRANCH_ACTIONS,
  CONDITION_COMBINATORS,
  CONDITION_OPERATORS,
  FORM_TYPE_CONFIGS,
  FORM_TYPES,
  OTHER_OPTION_VALUE,
  QUESTION_TYPES,
  RESPONSE_PROCESSING_STATUSES,
  RESPONSE_STATUSES,
  SURVEY_STATUSES,
} from './surveyConstants';
export {
  createBranchRuleId,
  createConditionId,
  createQuestionId,
  createSectionId,
  getScaleQuestionConfig,
  isAnswerEmpty,
  isNonResponseQuestionType,
  isScaleQuestionType,
  isSelectableQuestionType,
  normalizeBranchAction,
  normalizeBranching,
  normalizeConditionCombinator,
  normalizeConditionOperator,
  normalizeQuestion,
  normalizeQuestions,
  normalizeQuestionType,
  sanitizeQuestionOptions,
  supportsPlaceholder,
} from './surveyNormalize';

function ensureFirestoreReady() {
  if (!isFirebaseConfigured || !db) {
    throw new Error(getFirebaseStatusMessage() || 'Firestore가 아직 설정되지 않았습니다.');
  }
}

const surveysCollection = db ? collection(db, 'surveys') : null;
const responsesCollection = db ? collection(db, 'responses') : null;
const draftResponsesCollection = db ? collection(db, 'draftResponses') : null;
const auditLogsCollection = db ? collection(db, 'audit_logs') : null;
const surveyReportsCollection = db ? collection(db, 'survey_reports') : null;
const warnedAuditLogFailures = new Set();

const LEGACY_PUBLISHED_STATUSES = ['active'];

function isPermissionDeniedError(error) {
  return (
    error?.code === 'permission-denied' ||
    String(error?.message ?? '').includes('Missing or insufficient permissions')
  );
}

function logFirestoreReadDenied(path, error) {
  if (!isPermissionDeniedError(error)) {
    return;
  }

  logger.error('[Firestore permission-denied]', {
    path,
    code: error?.code ?? '',
    message: error?.message ?? '',
  });
}

export const QUOTA_CLOSE_MODES = {
  BLOCK: 'block',
  ALLOW_OVER: 'allow_over',
  ADMIN_ONLY: 'admin_only',
};

export const DEFAULT_REGION_AGE_QUOTA_CONFIG = {
  enabled: false,
  totalTarget: 520,
  baseYear: 2026,
  regionMode: 'region_age',
  closeMode: QUOTA_CLOSE_MODES.BLOCK,
  ageGroups: [
    { id: 'age_0_19', label: '0~19세', minAge: 0, maxAge: 19 },
    { id: 'age_20_39', label: '20~39세', minAge: 20, maxAge: 39 },
    { id: 'age_40_64', label: '40~64세', minAge: 40, maxAge: 64 },
    { id: 'age_65_plus', label: '65세 이상', minAge: 65, maxAge: null },
  ],
  regions: [
    { id: 'region_1', label: '1권역', areas: ['영등포동2가', '영등포동5가', '영등포동7가'] },
    { id: 'region_2', label: '2권역', areas: ['영등포동1가', '영등포동3가', '영등포동4가', '영등포동6가', '영등포동8가'] },
    { id: 'region_3', label: '3권역', areas: ['영등포본동'] },
    { id: 'region_4', label: '4권역', areas: ['문래동', '당산1동', '당산2동'] },
    { id: 'region_5', label: '5권역', areas: ['여의동', '양평1동', '양평2동'] },
  ],
  matrix: {},
};

const TARGETED_FORM_TYPES = new Set([
  FORM_TYPES.TARGETED_SURVEY,
  FORM_TYPES.TARGETED_PARTICIPATION_APPLICATION,
]);

function createLocalId(prefix) {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildDraftResponseId(userId, surveyId) {
  return `${String(userId ?? '').trim()}_${String(surveyId ?? '').trim()}`;
}

function mapResponseDoc(item) {
  const data = item.data();

  return {
    id: item.id,
    ...data,
    deleted: Boolean(data.deleted),
    status: normalizeResponseStatus(data.status ?? data.applicationStatus),
    applicationStatus: normalizeResponseProcessingStatus(data.applicationStatus),
  };
}

function getIsoTimestamp() {
  return new Date().toISOString();
}

export function normalizeSurveyStatus(status) {
  if (status === SURVEY_STATUSES.DELETED) {
    return SURVEY_STATUSES.DELETED;
  }

  if (status === SURVEY_STATUSES.DRAFT) {
    return SURVEY_STATUSES.DRAFT;
  }

  if (status === SURVEY_STATUSES.PUBLISHED || LEGACY_PUBLISHED_STATUSES.includes(status)) {
    return SURVEY_STATUSES.PUBLISHED;
  }

  if (status === SURVEY_STATUSES.CLOSED) {
    return SURVEY_STATUSES.CLOSED;
  }

  return SURVEY_STATUSES.DRAFT;
}

export function normalizeFormType(formType) {
  if (Object.values(FORM_TYPES).includes(formType)) {
    return formType;
  }

  return FORM_TYPES.GENERAL_SURVEY;
}

export function supportsBranchingFormType(formType) {
  return Object.values(FORM_TYPES).includes(normalizeFormType(formType));
}

export function isApplicationFormType(formType) {
  const normalizedFormType = normalizeFormType(formType);
  return (
    normalizedFormType === FORM_TYPES.TARGETED_PARTICIPATION_APPLICATION ||
    normalizedFormType === FORM_TYPES.GENERAL_APPLICATION
  );
}

export function canPubliclyReadSurvey(status) {
  const normalizedStatus = normalizeSurveyStatus(status);
  return (
    normalizedStatus === SURVEY_STATUSES.PUBLISHED || normalizedStatus === SURVEY_STATUSES.CLOSED
  );
}

export function canSubmitSurveyResponse(status) {
  return normalizeSurveyStatus(status) === SURVEY_STATUSES.PUBLISHED;
}

export function getClosedSurveyMessage(formType) {
  return isApplicationFormType(formType)
    ? '접수가 마감되었습니다.'
    : '응답이 마감되었습니다.';
}

export function normalizeResponseProcessingStatus(status) {
  if (Object.values(RESPONSE_PROCESSING_STATUSES).includes(status)) {
    return status;
  }

  return RESPONSE_PROCESSING_STATUSES.RECEIVED;
}

export function getResponseProcessingStatusMeta(status) {
  switch (normalizeResponseProcessingStatus(status)) {
    case RESPONSE_PROCESSING_STATUSES.REVIEWING:
      return { label: '검토중', className: 'status-chip reviewing-chip' };
    case RESPONSE_PROCESSING_STATUSES.APPROVED:
      return { label: '승인', className: 'status-chip approved-chip' };
    case RESPONSE_PROCESSING_STATUSES.COMPLETED:
      return { label: '완료', className: 'status-chip completed-chip' };
    case RESPONSE_PROCESSING_STATUSES.REJECTED:
      return { label: '반려', className: 'status-chip rejected-chip' };
    case RESPONSE_PROCESSING_STATUSES.CANCELED:
      return { label: '취소', className: 'status-chip canceled-chip' };
    case RESPONSE_PROCESSING_STATUSES.RECEIVED:
    default:
      return { label: '접수됨', className: 'status-chip received-chip' };
  }
}

export function normalizeResponseStatus(status) {
  const legacyStatusMap = {
    [RESPONSE_PROCESSING_STATUSES.RECEIVED]: RESPONSE_STATUSES.SUBMITTED,
    [RESPONSE_PROCESSING_STATUSES.REVIEWING]: RESPONSE_STATUSES.IN_REVIEW,
    [RESPONSE_PROCESSING_STATUSES.APPROVED]: RESPONSE_STATUSES.APPROVED,
    [RESPONSE_PROCESSING_STATUSES.COMPLETED]: RESPONSE_STATUSES.COMPLETED,
    [RESPONSE_PROCESSING_STATUSES.REJECTED]: RESPONSE_STATUSES.REJECTED,
    [RESPONSE_PROCESSING_STATUSES.CANCELED]: RESPONSE_STATUSES.CANCELLED,
    canceled: RESPONSE_STATUSES.CANCELLED,
    cancelled: RESPONSE_STATUSES.CANCELLED,
  };
  const normalizedStatus = legacyStatusMap[status] ?? status;

  if (Object.values(RESPONSE_STATUSES).includes(normalizedStatus)) {
    return normalizedStatus;
  }

  return RESPONSE_STATUSES.SUBMITTED;
}

export function getResponseStatusMeta(status) {
  switch (normalizeResponseStatus(status)) {
    case RESPONSE_STATUSES.IN_REVIEW:
      return { label: '검토중', className: 'status-chip response-status-reviewing' };
    case RESPONSE_STATUSES.APPROVED:
      return { label: '승인', className: 'status-chip response-status-approved' };
    case RESPONSE_STATUSES.COMPLETED:
      return { label: '완료', className: 'status-chip response-status-completed' };
    case RESPONSE_STATUSES.REJECTED:
      return { label: '반려', className: 'status-chip response-status-rejected' };
    case RESPONSE_STATUSES.CANCELLED:
      return { label: '취소', className: 'status-chip response-status-cancelled' };
    case RESPONSE_STATUSES.FOLLOW_UP:
      return { label: '연계필요', className: 'status-chip response-status-follow-up' };
    case RESPONSE_STATUSES.SUBMITTED:
    default:
      return { label: '접수됨', className: 'status-chip response-status-submitted' };
  }
}

export function getDraftSurveyMessage(formType) {
  return isApplicationFormType(formType)
    ? '아직 공개되지 않은 신청서입니다.'
    : '공개되지 않은 설문입니다.';
}

export function getUnavailableSurveyMessage(formType, status) {
  const normalizedStatus = normalizeSurveyStatus(status);

  if (normalizedStatus === SURVEY_STATUSES.DELETED) {
    return '삭제되었거나 더 이상 공개되지 않는 설문입니다.';
  }

  if (normalizedStatus === SURVEY_STATUSES.CLOSED) {
    return getClosedSurveyMessage(formType);
  }

  return getDraftSurveyMessage(formType);
}

export function getFormTypeMeta(formType) {
  const normalizedFormType = normalizeFormType(formType);
  return {
    value: normalizedFormType,
    ...FORM_TYPE_CONFIGS[normalizedFormType],
  };
}

export function normalizeSurveyConfiguration(survey = {}) {
  const safeSurvey =
    survey && typeof survey === 'object' && !Array.isArray(survey) ? survey : {};
  const normalizedFormType = normalizeFormType(safeSurvey.formType);
  const defaults = FORM_TYPE_CONFIGS[normalizedFormType].defaults;
  const maxResponses =
    typeof safeSurvey.maxResponses === 'number' && Number.isFinite(safeSurvey.maxResponses)
      ? Math.max(1, Math.floor(safeSurvey.maxResponses))
      : null;
  const responseCount =
    typeof safeSurvey.responseCount === 'number' && Number.isFinite(safeSurvey.responseCount)
      ? Math.max(0, Math.floor(safeSurvey.responseCount))
      : 0;
  const normalizeDateTimeField = (value) =>
    typeof value === 'string' && value.trim() ? value.trim() : '';
  const normalizeTextField = (value) =>
    typeof value === 'string' && value.trim() ? value.trim() : '';

  return {
    formType: normalizedFormType,
    branchingEnabled:
      typeof safeSurvey.branchingEnabled === 'boolean'
        ? safeSurvey.branchingEnabled
        : defaults.branchingEnabled,
    quotaEnabled:
      typeof safeSurvey.quotaEnabled === 'boolean' ? safeSurvey.quotaEnabled : defaults.quotaEnabled,
    duplicateCheckEnabled:
      typeof safeSurvey.duplicateCheckEnabled === 'boolean'
        ? safeSurvey.duplicateCheckEnabled
        : defaults.duplicateCheckEnabled,
    slotDuplicateCheckEnabled:
      typeof safeSurvey.slotDuplicateCheckEnabled === 'boolean'
        ? safeSurvey.slotDuplicateCheckEnabled
        : defaults.slotDuplicateCheckEnabled,
    oneSlotPerPersonEnabled:
      typeof safeSurvey.oneSlotPerPersonEnabled === 'boolean'
        ? safeSurvey.oneSlotPerPersonEnabled
        : defaults.oneSlotPerPersonEnabled,
    applicantListView:
      typeof safeSurvey.applicantListView === 'boolean'
        ? safeSurvey.applicantListView
        : defaults.applicantListView,
    processingStatusEnabled:
      typeof safeSurvey.processingStatusEnabled === 'boolean'
        ? safeSurvey.processingStatusEnabled
        : defaults.processingStatusEnabled,
    maxResponses:
      typeof safeSurvey.maxResponses === 'number' && Number.isFinite(safeSurvey.maxResponses)
        ? maxResponses
        : null,
    responseCount,
    opensAt: normalizeDateTimeField(safeSurvey.opensAt),
    closesAt: normalizeDateTimeField(safeSurvey.closesAt),
    applicationGuide: normalizeTextField(safeSurvey.applicationGuide),
    scheduleSummary: normalizeTextField(safeSurvey.scheduleSummary),
    cautionText: normalizeTextField(safeSurvey.cautionText),
    allowResponseEdit:
      typeof safeSurvey.allowResponseEdit === 'boolean' ? safeSurvey.allowResponseEdit : false,
    completionMessage: normalizeTextField(safeSurvey.completionMessage),
    adminNotificationEnabled:
      typeof safeSurvey.adminNotificationEnabled === 'boolean'
        ? safeSurvey.adminNotificationEnabled
        : false,
  };
}

function normalizeSurveyTemplateMetadata(metadata = {}) {
  const safeMetadata =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {};
  const templateVersion = Number(safeMetadata.templateVersion);

  return {
    templateId:
      typeof safeMetadata.templateId === 'string' && safeMetadata.templateId.trim()
        ? safeMetadata.templateId.trim()
        : '',
    templateVersion: Number.isFinite(templateVersion) ? Math.max(1, Math.floor(templateVersion)) : null,
    templateCategory:
      typeof safeMetadata.templateCategory === 'string' ? safeMetadata.templateCategory.trim() : '',
    templateType:
      typeof safeMetadata.templateType === 'string' ? safeMetadata.templateType.trim() : '',
    organization:
      typeof safeMetadata.organization === 'string' ? safeMetadata.organization.trim() : '',
    programType:
      typeof safeMetadata.programType === 'string' ? safeMetadata.programType.trim() : '',
    supportsYearCompare: Boolean(safeMetadata.supportsYearCompare),
    supportsFollowUp: Boolean(safeMetadata.supportsFollowUp),
    supportsAssetMapping: Boolean(safeMetadata.supportsAssetMapping),
    defaultFormType:
      typeof safeMetadata.defaultFormType === 'string' ? safeMetadata.defaultFormType.trim() : '',
  };
}

function getPersistableTemplateMetadata(metadata = {}) {
  const normalizedMetadata = normalizeSurveyTemplateMetadata(metadata);

  return Object.entries(normalizedMetadata).reduce((result, [key, value]) => {
    if (value !== '' && value !== null) {
      result[key] = value;
    }

    return result;
  }, {});
}

export function normalizeMaxResponses(value) {
  if (value === '' || value === null || value === undefined) {
    return null;
  }

  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return null;
  }

  return Math.floor(numericValue);
}

function normalizeQuotaNumber(value, fallback = 0) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? Math.max(0, Math.floor(numericValue)) : fallback;
}

function normalizeQuotaId(value, fallback) {
  const normalizedValue = String(value ?? '').trim();
  return normalizedValue || fallback;
}

export function createDefaultRegionAgeQuotaConfig(overrides = {}) {
  const baseConfig = {
    ...DEFAULT_REGION_AGE_QUOTA_CONFIG,
    ageGroups: DEFAULT_REGION_AGE_QUOTA_CONFIG.ageGroups.map((group) => ({ ...group })),
    regions: DEFAULT_REGION_AGE_QUOTA_CONFIG.regions.map((region) => ({
      ...region,
      areas: [...region.areas],
    })),
  };

  const totalTarget = normalizeQuotaNumber(overrides.totalTarget ?? baseConfig.totalTarget, 520);
  const regions = Array.isArray(overrides.regions) ? overrides.regions : baseConfig.regions;
  const ageGroups = Array.isArray(overrides.ageGroups) ? overrides.ageGroups : baseConfig.ageGroups;
  const matrix = regions.reduce((result, region) => {
    const regionId = normalizeQuotaId(region.id, createLocalId('region'));
    result[regionId] = ageGroups.reduce((ageResult, ageGroup) => {
      const ageGroupId = normalizeQuotaId(ageGroup.id, createLocalId('age'));
      ageResult[ageGroupId] = 0;
      return ageResult;
    }, {});
    return result;
  }, {});

  return normalizeRegionAgeQuotaConfig({
    ...baseConfig,
    ...overrides,
    totalTarget,
    regions,
    ageGroups,
    matrix: overrides.matrix ?? matrix,
  });
}

export function distributeRegionAgeQuotaMatrix(config = {}) {
  const normalizedConfig = normalizeRegionAgeQuotaConfig(config);
  const totalTarget = normalizeQuotaNumber(normalizedConfig.totalTarget, 0);
  const cellCount = normalizedConfig.regions.length * normalizedConfig.ageGroups.length;
  const baseCellTarget = cellCount > 0 ? Math.floor(totalTarget / cellCount) : 0;
  let remainingTarget = totalTarget;

  const matrix = normalizedConfig.regions.reduce((result, region, regionIndex) => {
    result[region.id] = normalizedConfig.ageGroups.reduce((ageResult, ageGroup, ageIndex) => {
      const isLastCell =
        regionIndex === normalizedConfig.regions.length - 1 &&
        ageIndex === normalizedConfig.ageGroups.length - 1;
      const target = isLastCell ? remainingTarget : Math.min(baseCellTarget, remainingTarget);
      ageResult[ageGroup.id] = target;
      remainingTarget -= target;
      return ageResult;
    }, {});
    return result;
  }, {});

  return {
    ...normalizedConfig,
    matrix,
  };
}

export function normalizeRegionAgeQuotaConfig(config = {}) {
  const safeConfig = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  const fallback = DEFAULT_REGION_AGE_QUOTA_CONFIG;
  const ageGroupsSource = Array.isArray(safeConfig.ageGroups) && safeConfig.ageGroups.length > 0
    ? safeConfig.ageGroups
    : fallback.ageGroups;
  const regionsSource = Array.isArray(safeConfig.regions) && safeConfig.regions.length > 0
    ? safeConfig.regions
    : fallback.regions;
  const ageGroups = ageGroupsSource.map((group, index) => {
    const minAge = Number(group?.minAge);
    const rawMaxAge = group?.maxAge;
    const maxAge = rawMaxAge === null || rawMaxAge === undefined || rawMaxAge === ''
      ? null
      : Number(rawMaxAge);

    return {
      id: normalizeQuotaId(group?.id, `age_${index + 1}`),
      label: String(group?.label ?? `연령대 ${index + 1}`).trim() || `연령대 ${index + 1}`,
      minAge: Number.isFinite(minAge) ? Math.max(0, Math.floor(minAge)) : 0,
      maxAge: Number.isFinite(maxAge) ? Math.max(0, Math.floor(maxAge)) : null,
    };
  });
  const regions = regionsSource.map((region, index) => ({
    id: normalizeQuotaId(region?.id, `region_${index + 1}`),
    label: String(region?.label ?? `${index + 1}권역`).trim() || `${index + 1}권역`,
    areas: Array.isArray(region?.areas)
      ? region.areas.map((area) => String(area ?? '').trim()).filter(Boolean)
      : [],
  }));
  const sourceMatrix =
    safeConfig.matrix && typeof safeConfig.matrix === 'object' && !Array.isArray(safeConfig.matrix)
      ? safeConfig.matrix
      : {};
  const matrix = regions.reduce((result, region) => {
    result[region.id] = ageGroups.reduce((ageResult, ageGroup) => {
      ageResult[ageGroup.id] = normalizeQuotaNumber(sourceMatrix?.[region.id]?.[ageGroup.id], 0);
      return ageResult;
    }, {});
    return result;
  }, {});

  return {
    enabled: Boolean(safeConfig.enabled),
    totalTarget: normalizeQuotaNumber(safeConfig.totalTarget, 0),
    baseYear: normalizeQuotaNumber(safeConfig.baseYear, new Date().getFullYear()),
    regionMode: safeConfig.regionMode === 'region_age' ? 'region_age' : 'region_age',
    closeMode: Object.values(QUOTA_CLOSE_MODES).includes(safeConfig.closeMode)
      ? safeConfig.closeMode
      : QUOTA_CLOSE_MODES.BLOCK,
    ageGroups,
    regions,
    matrix,
  };
}

export function createEmptyQuotaCounts(config = {}) {
  const normalizedConfig = normalizeRegionAgeQuotaConfig(config);
  return {
    total: 0,
    cells: normalizedConfig.regions.reduce((result, region) => {
      result[region.id] = normalizedConfig.ageGroups.reduce((ageResult, ageGroup) => {
        ageResult[ageGroup.id] = 0;
        return ageResult;
      }, {});
      return result;
    }, {}),
  };
}

export function normalizeQuotaCounts(counts = {}, config = {}) {
  const emptyCounts = createEmptyQuotaCounts(config);
  const safeCounts = counts && typeof counts === 'object' && !Array.isArray(counts) ? counts : {};

  return {
    ...emptyCounts,
    total: normalizeQuotaNumber(safeCounts.total, emptyCounts.total),
    cells: Object.entries(emptyCounts.cells).reduce((result, [regionId, ageCells]) => {
      result[regionId] = Object.keys(ageCells).reduce((ageResult, ageGroupId) => {
        ageResult[ageGroupId] = normalizeQuotaNumber(safeCounts.cells?.[regionId]?.[ageGroupId], 0);
        return ageResult;
      }, {});
      return result;
    }, {}),
  };
}

export function normalizeQuotaAreaValue(value) {
  return String(value ?? '')
    .trim()
    .replace(/[·ㆍ・･∙⋅•]/g, '.')
    .replace(/\s+/g, '')
    .replace(/[.。．,，、/\\-]+/g, '')
    .toLowerCase();
}

function normalizeQuotaAreaComparable(value) {
  return normalizeQuotaAreaValue(value).replace(/가$/, '');
}

function getRegionAreaAliases(areas = []) {
  const aliases = new Set();
  const normalizedAreas = areas.map((area) => normalizeQuotaAreaValue(area)).filter(Boolean);

  normalizedAreas.forEach((area) => {
    aliases.add(area);
    aliases.add(normalizeQuotaAreaComparable(area));
  });

  const groupedByPrefixSuffix = normalizedAreas.reduce((result, area) => {
    const match = area.match(/^(.+?)(\d+)가$/);

    if (!match) {
      return result;
    }

    const [, prefix, numberText] = match;
    const key = `${prefix}::가`;
    result[key] = result[key] ?? { prefix, suffix: '가', numbers: [] };
    result[key].numbers.push(numberText);
    return result;
  }, {});

  Object.values(groupedByPrefixSuffix).forEach((group) => {
    if (group.numbers.length < 2) {
      return;
    }

    const combined = `${group.prefix}${group.numbers.join('')}${group.suffix}`;
    aliases.add(combined);
    aliases.add(normalizeQuotaAreaComparable(combined));
  });

  return aliases;
}

function findQuotaRegionByArea(regions = [], area = '') {
  const normalizedArea = normalizeQuotaAreaValue(area);
  const comparableArea = normalizeQuotaAreaComparable(area);

  return regions.find((region) => {
    const aliases = getRegionAreaAliases(region.areas);
    return aliases.has(normalizedArea) || aliases.has(comparableArea);
  }) ?? null;
}

export function buildQuotaAreaMappingDebugRows(config = {}, areaValues = []) {
  const normalizedConfig = normalizeRegionAgeQuotaConfig(config);

  return areaValues.map((areaValue) => {
    const region = findQuotaRegionByArea(normalizedConfig.regions, areaValue);

    return {
      rawArea: areaValue,
      normalizedArea: normalizeQuotaAreaValue(areaValue),
      mapped: Boolean(region),
      regionId: region?.id ?? '',
      regionLabel: region?.label ?? '',
    };
  });
}

export function resolveRegionAgeQuota(input = {}, config = {}) {
  const normalizedConfig = normalizeRegionAgeQuotaConfig(config);
  const area = String(input.area ?? '').trim();
  const normalizedArea = normalizeQuotaAreaValue(area);
  const birthYear = Number(input.birthYear);
  const age = Number.isFinite(birthYear) ? normalizedConfig.baseYear - Math.floor(birthYear) : null;
  const region = findQuotaRegionByArea(normalizedConfig.regions, area);
  const ageGroup = Number.isFinite(age)
    ? normalizedConfig.ageGroups.find((group) =>
        age >= group.minAge && (group.maxAge === null || age <= group.maxAge),
      ) ?? null
    : null;

  if (!area || !region || !ageGroup || !Number.isFinite(age) || age < 0) {
    return {
      valid: false,
      area,
      normalizedArea,
      birthYear: Number.isFinite(birthYear) ? Math.floor(birthYear) : null,
      age,
      region,
      ageGroup,
    };
  }

  return {
    valid: true,
    area,
    normalizedArea,
    birthYear: Math.floor(birthYear),
    age,
    region,
    ageGroup,
  };
}

export function buildRegionAgeQuotaDashboard(config = {}, counts = {}) {
  const normalizedConfig = normalizeRegionAgeQuotaConfig(config);
  const normalizedCounts = normalizeQuotaCounts(counts, normalizedConfig);
  const rows = normalizedConfig.regions.map((region) => {
    const cells = normalizedConfig.ageGroups.map((ageGroup) => {
      const regionIndex = normalizedConfig.regions.findIndex((item) => item.id === region.id);
      const ageGroupIndex = normalizedConfig.ageGroups.findIndex((item) => item.id === ageGroup.id);
      const target = normalizeQuotaNumber(normalizedConfig.matrix?.[region.id]?.[ageGroup.id], 0);
      const current = normalizeQuotaNumber(normalizedCounts.cells?.[region.id]?.[ageGroup.id], 0);
      const percent = target > 0 ? Math.round((current / target) * 100) : 0;
      const shortage = Math.max(0, target - current);
      const status =
        target > 0 && current > target
          ? '초과응답'
          : target > 0 && current >= target
            ? '마감'
            : percent >= 80
              ? '진행중'
              : '부족';

      return {
        regionId: region.id,
        regionLabel: region.label,
        regionIndex,
        ageGroupId: ageGroup.id,
        ageGroupLabel: ageGroup.label,
        ageGroupIndex,
        current,
        target,
        percent,
        shortage,
        status,
      };
    });

    return {
      region,
      cells,
      currentTotal: cells.reduce((sum, cell) => sum + cell.current, 0),
      targetTotal: cells.reduce((sum, cell) => sum + cell.target, 0),
    };
  });
  const ageTotals = normalizedConfig.ageGroups.map((ageGroup) => {
    const current = rows.reduce(
      (sum, row) => sum + (row.cells.find((cell) => cell.ageGroupId === ageGroup.id)?.current ?? 0),
      0,
    );
    const target = rows.reduce(
      (sum, row) => sum + (row.cells.find((cell) => cell.ageGroupId === ageGroup.id)?.target ?? 0),
      0,
    );
    return { ageGroup, current, target, percent: target > 0 ? Math.round((current / target) * 100) : 0 };
  });
  const targetTotal = rows.reduce((sum, row) => sum + row.targetTotal, 0);
  const currentTotal = normalizedCounts.total || rows.reduce((sum, row) => sum + row.currentTotal, 0);
  const allCells = rows.flatMap((row) => row.cells);
  const shortageCells = allCells
    .filter((cell) => cell.shortage > 0)
    .sort((first, second) => {
      if (second.shortage !== first.shortage) {
        return second.shortage - first.shortage;
      }

      if (first.percent !== second.percent) {
        return first.percent - second.percent;
      }

      if (first.regionIndex !== second.regionIndex) {
        return first.regionIndex - second.regionIndex;
      }

      return first.ageGroupIndex - second.ageGroupIndex;
    });

  return {
    config: normalizedConfig,
    counts: normalizedCounts,
    rows,
    ageTotals,
    currentTotal,
    targetTotal,
    percent: targetTotal > 0 ? Math.round((currentTotal / targetTotal) * 100) : 0,
    overQuotaCount: allCells.reduce((sum, cell) => sum + Math.max(0, cell.current - cell.target), 0),
    closedCellCount: allCells.filter((cell) => cell.target > 0 && cell.current >= cell.target).length,
    shortageCells,
    shortageTop: shortageCells.slice(0, 5),
  };
}

export function isQuotaReached(survey = {}) {
  const normalizedConfiguration = normalizeSurveyConfiguration(survey);

  if (!normalizedConfiguration.quotaEnabled || !normalizedConfiguration.maxResponses) {
    return false;
  }

  return normalizedConfiguration.responseCount >= normalizedConfiguration.maxResponses;
}

export function getEffectiveSurveyStatus(survey = {}) {
  const safeSurvey =
    survey && typeof survey === 'object' && !Array.isArray(survey) ? survey : {};

  if (safeSurvey.deleted || safeSurvey.status === SURVEY_STATUSES.DELETED) {
    return SURVEY_STATUSES.DELETED;
  }

  if (isQuotaReached(survey)) {
    return SURVEY_STATUSES.CLOSED;
  }

  return normalizeSurveyStatus(safeSurvey.status);
}

export function getQuotaSummary(survey = {}) {
  const normalizedConfiguration = normalizeSurveyConfiguration(survey);

  return {
    quotaEnabled: normalizedConfiguration.quotaEnabled,
    responseCount: normalizedConfiguration.responseCount,
    maxResponses: normalizedConfiguration.maxResponses,
    isFull: isQuotaReached({
      ...survey,
      ...normalizedConfiguration,
    }),
  };
}

function toComparableTime(value) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function formatPublicDateTime(value) {
  const comparableTime = toComparableTime(value);

  if (comparableTime === null) {
    return '';
  }

  return new Date(comparableTime).toLocaleString('ko-KR');
}

export function getReceptionPeriodText(survey = {}) {
  const { opensAt = '', closesAt = '' } = normalizeSurveyConfiguration(survey);

  if (opensAt && closesAt) {
    return `${formatPublicDateTime(opensAt)} ~ ${formatPublicDateTime(closesAt)}`;
  }

  if (opensAt) {
    return `${formatPublicDateTime(opensAt)}부터 접수`;
  }

  if (closesAt) {
    return `${formatPublicDateTime(closesAt)}까지 접수`;
  }

  return '별도 기간 안내 없음';
}

export function getPublicSurveyState(survey = {}, now = Date.now()) {
  const safeSurvey =
    survey && typeof survey === 'object' && !Array.isArray(survey) ? survey : {};
  const normalizedStatus = normalizeSurveyStatus(safeSurvey.status);
  const quotaSummary = getQuotaSummary(safeSurvey);
  const opensAt = toComparableTime(safeSurvey.opensAt);
  const closesAt = toComparableTime(safeSurvey.closesAt);

  if (normalizedStatus === SURVEY_STATUSES.DELETED || safeSurvey.deleted) {
    return {
      key: 'deleted',
      label: '삭제됨',
      message: '삭제되었거나 더 이상 공개되지 않는 설문입니다.',
      canViewForm: false,
      canSubmit: false,
    };
  }

  if (normalizedStatus === SURVEY_STATUSES.DRAFT) {
    return {
      key: 'draft',
      label: isApplicationFormType(safeSurvey.formType) ? '비공개' : '비공개',
      message: getDraftSurveyMessage(safeSurvey.formType),
      canViewForm: false,
      canSubmit: false,
    };
  }

  if (normalizedStatus === SURVEY_STATUSES.CLOSED || quotaSummary.isFull || (closesAt && now > closesAt)) {
    return {
      key: 'closed',
      label: isApplicationFormType(safeSurvey.formType) ? '접수 마감' : '응답 마감',
      message: getClosedSurveyMessage(safeSurvey.formType),
      canViewForm: false,
      canSubmit: false,
    };
  }

  if (opensAt && now < opensAt) {
    return {
      key: 'scheduled',
      label: isApplicationFormType(safeSurvey.formType) ? '접수 예정' : '응답 예정',
      message: isApplicationFormType(safeSurvey.formType)
        ? '접수 예정입니다.'
        : '응답 예정입니다.',
      canViewForm: false,
      canSubmit: false,
    };
  }

  return {
    key: 'open',
    label: isApplicationFormType(safeSurvey.formType) ? '접수 중' : '응답 진행 중',
    message: isApplicationFormType(safeSurvey.formType)
      ? '현재 접수 중입니다.'
      : '현재 응답을 받고 있습니다.',
    canViewForm: true,
    canSubmit: true,
  };
}

export function formatScaleAnswer(answer, question = {}) {
  const scaleConfig = getScaleQuestionConfig(question);
  const normalizedAnswer = String(answer ?? '').trim();

  if (!scaleConfig || !normalizedAnswer) {
    return normalizedAnswer;
  }

  const numericValue = Number(normalizedAnswer);

  if (!Number.isFinite(numericValue)) {
    return normalizedAnswer;
  }

  if (numericValue === scaleConfig.min && scaleConfig.minLabel) {
    return `${numericValue} (${scaleConfig.minLabel})`;
  }

  if (numericValue === scaleConfig.max && scaleConfig.maxLabel) {
    return `${numericValue} (${scaleConfig.maxLabel})`;
  }

  if (scaleConfig.preset === 'nps10') {
    if (numericValue <= 6) {
      return `${numericValue} (추천 의향 낮음)`;
    }

    if (numericValue <= 8) {
      return `${numericValue} (추천 의향 보통)`;
    }

    return `${numericValue} (추천 의향 높음)`;
  }

  return normalizedAnswer;
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

export function buildOptionQuotaKey(questionId, optionValue) {
  return `${questionId}::${optionValue}`;
}

export function normalizeOptionQuotaCounts(optionQuotaCounts = {}) {
  if (!optionQuotaCounts || typeof optionQuotaCounts !== 'object' || Array.isArray(optionQuotaCounts)) {
    return {};
  }

  return Object.entries(optionQuotaCounts).reduce((result, [key, value]) => {
    const normalizedValue = Number(value);

    if (typeof key === 'string' && key.trim() && Number.isFinite(normalizedValue) && normalizedValue >= 0) {
      result[key] = Math.floor(normalizedValue);
    }

    return result;
  }, {});
}

export function getQuestionOptionItems(question = {}, optionQuotaCounts = {}) {
  const normalizedQuestion = normalizeQuestion(question);
  const normalizedCounts = normalizeOptionQuotaCounts(optionQuotaCounts);

  return normalizedQuestion.options.map((optionLabel) => {
    const optionSetting = normalizedQuestion.optionSettings?.[optionLabel] ?? {};
    const capacity = normalizeOptionCapacity(optionSetting.capacity);
    const currentCount = normalizedCounts[buildOptionQuotaKey(normalizedQuestion.id, optionLabel)] ?? 0;
    const remainingCount = capacity ? Math.max(0, capacity - currentCount) : null;
    const isClosed = Boolean(capacity) && currentCount >= capacity;

    return {
      label:
        normalizedQuestion.type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE
          ? optionSetting.title || optionLabel
          : optionLabel,
      value: optionLabel,
      capacity,
      currentCount,
      remainingCount,
      isClosed,
      title: optionSetting.title || optionLabel,
      date: optionSetting.date || '',
      time: optionSetting.time || '',
      place: optionSetting.place || '',
      ageGroup: optionSetting.ageGroup || '',
      sortOrder: normalizeSlotSortOrder(optionSetting.sortOrder, 1),
    };
  }).sort((first, second) => {
    if (normalizedQuestion.type !== QUESTION_TYPES.APPLICATION_SLOT_CHOICE) {
      return 0;
    }

    return first.sortOrder - second.sortOrder;
  });
}

export function isOptionQuotaQuestion(question = {}) {
  const normalizedQuestion = normalizeQuestion(question);

  if (
    normalizedQuestion.type !== QUESTION_TYPES.SINGLE_CHOICE &&
    normalizedQuestion.type !== QUESTION_TYPES.DROPDOWN &&
    normalizedQuestion.type !== QUESTION_TYPES.APPLICATION_SLOT_CHOICE
  ) {
    return false;
  }

  return Object.keys(normalizedQuestion.optionSettings ?? {}).length > 0;
}

export function normalizeBranchCondition(condition = {}) {
  return {
    id:
      typeof condition.id === 'string' && condition.id.trim()
        ? condition.id.trim()
        : createConditionId(),
    questionId: condition.questionId?.trim?.() ?? '',
    operator: normalizeConditionOperator(condition.operator),
    value:
      typeof condition.value === 'string' || typeof condition.value === 'number'
        ? String(condition.value)
        : '',
  };
}

function createDefaultSection(index = 0) {
  return {
    id: createSectionId(),
    title: `섹션 ${index + 1}`,
    description: '',
    pageEndAction: 'next',
    pageEndTargetSectionId: '',
    visibilityConditions: [],
    visibilityCombinator: CONDITION_COMBINATORS.AND,
    terminationEnabled: false,
    terminationConditions: [],
    terminationCombinator: CONDITION_COMBINATORS.AND,
    terminationMessage: '',
  };
}

export function normalizeSurveySection(section = {}, index = 0) {
  const fallbackSection = createDefaultSection(index);

  return {
    id:
      typeof section.id === 'string' && section.id.trim()
        ? section.id.trim()
        : fallbackSection.id,
    key: section.key?.trim?.() ?? '',
    pageId: section.pageId?.trim?.() ?? '',
    pageKey: section.pageKey?.trim?.() ?? '',
    title:
      typeof section.title === 'string'
        ? section.title.trim()
        : fallbackSection.title,
    description: section.description?.trim?.() ?? '',
    pageEndAction:
      typeof section.pageEndAction === 'string' && section.pageEndAction.trim()
        ? section.pageEndAction.trim()
        : fallbackSection.pageEndAction,
    pageEndTargetSectionId: section.pageEndTargetSectionId?.trim?.() ?? '',
    visibilityConditions: Array.isArray(section.visibilityConditions)
      ? section.visibilityConditions
          .map((condition) => normalizeBranchCondition(condition))
          .filter((condition) => condition.questionId)
      : [],
    visibilityCombinator: normalizeConditionCombinator(section.visibilityCombinator),
    terminationEnabled: Boolean(section.terminationEnabled),
    terminationConditions: Array.isArray(section.terminationConditions)
      ? section.terminationConditions
          .map((condition) => normalizeBranchCondition(condition))
          .filter((condition) => condition.questionId)
      : [],
    terminationCombinator: normalizeConditionCombinator(section.terminationCombinator),
    terminationMessage: section.terminationMessage?.trim?.() ?? '',
  };
}

export function normalizeSurveySections(sections = [], questions = []) {
  const normalizedSections =
    Array.isArray(sections) && sections.length > 0
      ? sections.map((section, index) => normalizeSurveySection(section, index))
      : [createDefaultSection(0)];

  const normalizedQuestions = normalizeQuestions(questions);

  if (normalizedQuestions.length === 0) {
    return normalizedSections;
  }

  const sectionIds = new Set(normalizedSections.map((section) => section.id));
  const hasAssignedQuestion = normalizedQuestions.some((question) => sectionIds.has(question.sectionId));

  if (!hasAssignedQuestion && normalizedSections.length === 1) {
    return normalizedSections;
  }

  return normalizedSections;
}

export function alignQuestionsToSections(questions = [], sections = []) {
  const normalizedQuestions = normalizeQuestions(questions);
  const normalizedSections = normalizeSurveySections(sections, normalizedQuestions);
  const validSectionIds = new Set(normalizedSections.map((section) => section.id));
  const sectionAliasToId = normalizedSections.reduce((result, section) => {
    [section.id, section.key, section.pageId, section.pageKey].forEach((alias) => {
      if (alias) {
        result.set(alias, section.id);
      }
    });

    return result;
  }, new Map());
  const defaultSectionId = normalizedSections[0]?.id ?? '';

  return normalizedQuestions.map((question) => {
    const resolvedSectionId =
      sectionAliasToId.get(question.sectionId) ??
      sectionAliasToId.get(question.pageId) ??
      sectionAliasToId.get(question.sectionKey) ??
      sectionAliasToId.get(question.pageKey) ??
      '';

    return {
      ...question,
      sectionId: validSectionIds.has(resolvedSectionId) ? resolvedSectionId : defaultSectionId,
    };
  });
}

// ─── 개인정보 탐지 ─────────────────────────────────────────────────────────
// EMAIL/PHONE 타입 또는 제목 키워드로 PII 수집 질문을 탐지합니다.
// DESCRIPTION_BLOCK, SECTION_TITLE은 응답 수집 질문이 아니므로 제외합니다.
const PRIVACY_PII_KEYWORDS = [
  '이름', '성명', '성함',
  '연락처', '전화', '휴대폰', '핸드폰', '전화번호', '휴대전화',
  '이메일', '메일',
  '생년월일', '생일', '출생일', '출생연도',
  '나이', '연령',
  '주소', '거주지',
  '보호자', '부모', '법정대리인', '긴급연락처',
  '주민등록', '계좌', '신분증', '여권',
];

const PRIVACY_CONSENT_KEYWORDS = ['개인정보', '동의', '정보 수집', '정보수집'];

const INHERENTLY_PII_TYPES = new Set([QUESTION_TYPES.EMAIL, QUESTION_TYPES.PHONE]);

const NON_RESPONSE_TYPE_SET = new Set([
  QUESTION_TYPES.DESCRIPTION_BLOCK,
  QUESTION_TYPES.SECTION_TITLE,
]);

/**
 * 질문 목록에서 PII 수집 질문과 개인정보 동의 문항을 탐지합니다.
 * @returns {{ hasPiiQuestions: boolean, piiQuestions: object[], hasConsentQuestion: boolean, consentQuestions: object[] }}
 */
export function detectPrivacyQuestions(questions = []) {
  const questionList = Array.isArray(questions) ? questions : [];

  const piiQuestions = questionList.filter((q) => {
    if (!q) return false;
    const type = normalizeQuestionType(q.type);
    if (NON_RESPONSE_TYPE_SET.has(type)) return false;
    if (INHERENTLY_PII_TYPES.has(type)) return true;
    const title = String(q.title ?? '').toLowerCase();
    return PRIVACY_PII_KEYWORDS.some((kw) => title.includes(kw.toLowerCase()));
  });

  const consentQuestions = questionList.filter((q) => {
    if (!q) return false;
    const type = normalizeQuestionType(q.type);
    if (type === QUESTION_TYPES.CONSENT_CHECKBOX) return true;
    const title = String(q.title ?? '').toLowerCase();
    return PRIVACY_CONSENT_KEYWORDS.some((kw) => title.includes(kw.toLowerCase()));
  });

  return {
    hasPiiQuestions: piiQuestions.length > 0,
    piiQuestions,
    hasConsentQuestion: consentQuestions.length > 0,
    consentQuestions,
  };
}

/**
 * 공개 전 개인정보 동의 문항 필수 검증.
 * PII 질문이 있는데 동의 문항이 없으면 invalid를 반환합니다.
 * @returns {{ valid: boolean, hasPii: boolean, hasConsent: boolean, warnings: string[] }}
 */
export function validatePrivacyConsent(questions = []) {
  const { hasPiiQuestions, piiQuestions, hasConsentQuestion } = detectPrivacyQuestions(questions);

  if (!hasPiiQuestions) {
    return { valid: true, hasPii: false, hasConsent: hasConsentQuestion, warnings: [] };
  }

  if (hasConsentQuestion) {
    return { valid: true, hasPii: true, hasConsent: true, warnings: [] };
  }

  const labelList = piiQuestions
    .slice(0, 3)
    .map((q) => `"${String(q.title ?? '').slice(0, 20) || '제목 없음'}"`)
    .join(', ');
  const overflow = piiQuestions.length > 3 ? ` 외 ${piiQuestions.length - 3}개` : '';

  return {
    valid: false,
    hasPii: true,
    hasConsent: false,
    warnings: [
      `개인정보 수집 질문(${labelList}${overflow})이 있지만 개인정보 동의 문항이 없습니다.`,
      '공개 전 질문 목록에 "개인정보 수집·이용 동의" 체크박스(CONSENT_CHECKBOX 타입) 문항을 추가해주세요.',
    ],
  };
}
// ─────────────────────────────────────────────────────────────────────────────

export function sanitizeSurveyQuestions(questions = [], { strict = true } = {}) {
  if (process.env.NODE_ENV !== 'production' && !strict) {
    const selectableWithFewOptions = (Array.isArray(questions) ? questions : []).filter((q) => {
      const type = normalizeQuestionType(q?.type);
      return (
        isSelectableQuestionType(type) &&
        sanitizeQuestionOptions(q?.options).length < 2
      );
    });

    if (selectableWithFewOptions.length > 0) {
      console.groupCollapsed('[Survey Sanitize] 선택형 질문 options 부족 (렌더링 단계 — 저장/공개 시 차단됨)');
      selectableWithFewOptions.forEach((q) => {
        console.warn({
          id: q?.id,
          type: q?.type,
          title: q?.title,
          options: q?.options,
          optionsAfterSanitize: sanitizeQuestionOptions(q?.options),
        });
      });
      console.groupEnd();
    }
  }

  const normalizedQuestions = normalizeQuestions(questions);
  const questionIds = new Set(normalizedQuestions.map((question) => question.id));
  const normalizedQuestionsWithSafeBranches = normalizedQuestions.map((question) => {
    const safeRules = (question.branching?.rules ?? []).map((rule) => {
      if (
        rule.action !== BRANCH_ACTIONS.GO_TO ||
        !rule.targetQuestionId ||
        rule.targetQuestionId === question.id ||
        !questionIds.has(rule.targetQuestionId)
      ) {
        return {
          ...rule,
          action: rule.action === BRANCH_ACTIONS.GO_TO ? BRANCH_ACTIONS.NEXT : rule.action,
          targetQuestionId: '',
          targetType: '',
        };
      }

      return rule;
    });
    const safeFallbackTargetQuestionId =
      question.branching?.fallbackAction === BRANCH_ACTIONS.GO_TO &&
      question.branching?.fallbackTargetQuestionId &&
      question.branching.fallbackTargetQuestionId !== question.id &&
      questionIds.has(question.branching.fallbackTargetQuestionId)
        ? question.branching.fallbackTargetQuestionId
        : '';

    return {
      ...question,
      branching: {
        enabled: Boolean(question.branching?.enabled) && safeRules.some((rule) => rule.action !== BRANCH_ACTIONS.NEXT),
        rules: safeRules,
        fallbackAction: safeFallbackTargetQuestionId
          ? question.branching?.fallbackAction
          : BRANCH_ACTIONS.NEXT,
        fallbackTargetQuestionId: safeFallbackTargetQuestionId,
      },
    };
  });

  return normalizedQuestionsWithSafeBranches.reduce((result, normalizedQuestion, index) => {
    const hasAnyContent =
      normalizedQuestion.title ||
      normalizedQuestion.description ||
      normalizedQuestion.options.length > 0;

    if (!hasAnyContent) {
      return result;
    }

    if (!normalizedQuestion.title && !normalizedQuestion.description) {
      if (strict) throw new Error(`질문 ${index + 1}의 제목 또는 설명을 입력해주세요.`);
      return result;
    }

    if (!isNonResponseQuestionType(normalizedQuestion.type) && !normalizedQuestion.title) {
      if (strict) throw new Error(`질문 ${index + 1}의 제목을 입력해주세요.`);
      return result;
    }

    if (
      isSelectableQuestionType(normalizedQuestion.type) &&
      normalizedQuestion.options.length < 2
    ) {
      if (strict) throw new Error(`질문 ${index + 1}의 선택지는 최소 2개 이상이어야 합니다.`);
      return result;
    }

    if (isScaleQuestionType(normalizedQuestion.type)) {
      const scaleConfig = getScaleQuestionConfig(normalizedQuestion);

      if (!scaleConfig || scaleConfig.max <= scaleConfig.min) {
        if (strict) throw new Error(`질문 ${index + 1}의 척도 범위를 다시 확인해주세요.`);
        return result;
      }
    }

    if (normalizedQuestion.type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE) {
      const hasInvalidSlot = normalizedQuestion.options.some((optionLabel) => {
        const slotSetting = normalizedQuestion.optionSettings?.[optionLabel] ?? {};
        return !slotSetting.title || !slotSetting.date || !slotSetting.time || !slotSetting.capacity;
      });

      if (hasInvalidSlot) {
        if (strict) throw new Error(
          `질문 ${index + 1}의 신청 슬롯은 제목, 날짜, 시간, 정원을 모두 입력해주세요.`,
        );
        return result;
      }
    }

    if (
      normalizedQuestion.type === QUESTION_TYPES.CONSENT_CHECKBOX &&
      !normalizedQuestion.title
    ) {
      if (strict) throw new Error(`질문 ${index + 1}의 동의 문구를 입력해주세요.`);
      return result;
    }

    result.push(normalizedQuestion);
    return result;
  }, []);
}

export function sanitizeSurveySections(sections = [], questions = []) {
  const normalizedQuestions = alignQuestionsToSections(questions, sections);
  const normalizedSections = normalizeSurveySections(sections, normalizedQuestions);

  return normalizedSections;
}

async function waitForSurveyDocument(surveyId, maxAttempts = 6, delayMs = 250) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let snapshot;

    try {
      snapshot = await getDoc(doc(db, 'surveys', surveyId));
    } catch (error) {
      logFirestoreReadDenied(`surveys/${surveyId}`, error);
      throw error;
    }

    if (snapshot.exists()) {
      return mapSurveyDoc(snapshot);
    }

    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  return null;
}

export async function waitForSurveyById(surveyId, maxAttempts = 6, delayMs = 250) {
  ensureFirestoreReady();
  const survey = await waitForSurveyDocument(surveyId, maxAttempts, delayMs);
  return hydrateSurveyQuotaData(survey);
}

function mapSurveyDoc(snapshot) {
  const data = snapshot.data();
  const normalizedConfiguration = normalizeSurveyConfiguration(data);
  const normalizedQuestions = alignQuestionsToSections(data.questions, data.sections);
  const normalizedSections = normalizeSurveySections(data.sections, normalizedQuestions);
  const optionQuotaCounts = normalizeOptionQuotaCounts(data.optionQuotaCounts);
  const ownerUid = data.ownerUid ?? data.createdByUid ?? data.ownerId ?? data.userId ?? data.createdBy?.uid ?? '';
  const createdByUid = data.createdByUid ?? data.createdBy?.uid ?? data.ownerUid ?? data.ownerId ?? data.userId ?? '';
  const ownerEmail = data.ownerEmail ?? data.createdByEmail ?? data.createdBy?.email ?? '';
  const createdByEmail = data.createdByEmail ?? data.createdBy?.email ?? data.ownerEmail ?? '';

  return {
    id: snapshot.id,
    ...data,
    storedStatus: normalizeSurveyStatus(data.status),
    status: getEffectiveSurveyStatus({
      ...data,
      ...normalizedConfiguration,
    }),
    ownerUid,
    createdByUid,
    ownerEmail,
    createdByEmail,
    createdBy: {
      ...(data.createdBy ?? {}),
      uid: data.createdBy?.uid ?? createdByUid,
      email: data.createdBy?.email ?? createdByEmail,
    },
    visibility: normalizeSurveyVisibility(data.visibility),
    questions: normalizedQuestions,
    sections: normalizedSections,
    optionQuotaCounts,
    ...normalizedConfiguration,
  };
}

async function fetchSurveyQuotaData(surveyId) {
  if (!surveyId) {
    return {
      quotaConfig: createDefaultRegionAgeQuotaConfig(),
      quotaCounts: createEmptyQuotaCounts(DEFAULT_REGION_AGE_QUOTA_CONFIG),
    };
  }

  const [configSnapshot, countsSnapshot] = await Promise.all([
    getDoc(doc(db, 'surveys', surveyId, 'quotaConfig', 'main')).catch((error) => {
      logFirestoreReadDenied(`surveys/${surveyId}/quotaConfig/main`, error);
      throw error;
    }),
    getDoc(doc(db, 'surveys', surveyId, 'quotaCounts', 'main')).catch((error) => {
      logFirestoreReadDenied(`surveys/${surveyId}/quotaCounts/main`, error);
      throw error;
    }),
  ]);
  const quotaConfig = normalizeRegionAgeQuotaConfig(
    configSnapshot.exists()
      ? configSnapshot.data()
      : createDefaultRegionAgeQuotaConfig(),
  );
  const quotaCounts = normalizeQuotaCounts(
    countsSnapshot.exists() ? countsSnapshot.data() : createEmptyQuotaCounts(quotaConfig),
    quotaConfig,
  );

  return {
    quotaConfig,
    quotaCounts,
  };
}

async function hydrateSurveyQuotaData(survey) {
  if (!survey?.id) {
    return survey;
  }

  const quotaData = await fetchSurveyQuotaData(survey.id);
  return {
    ...survey,
    ...quotaData,
  };
}

export function isDeletedSurvey(survey = {}) {
  return Boolean(survey?.deleted) || normalizeSurveyStatus(survey?.status) === SURVEY_STATUSES.DELETED;
}

export function isPermanentlyDeletedSurvey(survey = {}) {
  return Boolean(survey?.permanentlyDeleted);
}

export function isDeletedSurveyResponse(response = {}, linkedSurvey = null) {
  if (
    response?.deleted ||
    response?.surveyPermanentlyDeleted ||
    response?.surveyDeleted ||
    response?.hiddenFromDefaultList
  ) {
    return true;
  }

  return linkedSurvey ? isDeletedSurvey(linkedSurvey) || isPermanentlyDeletedSurvey(linkedSurvey) : false;
}

export function getDeletedSurveyResponseMeta(response = {}, linkedSurvey = null) {
  const permanentlyDeleted =
    Boolean(response?.surveyPermanentlyDeleted) ||
    (linkedSurvey ? isPermanentlyDeletedSurvey(linkedSurvey) : false);
  const deleted = permanentlyDeleted || isDeletedSurveyResponse(response, linkedSurvey);

  if (response?.deleted) {
    return { deleted, label: '삭제된 응답', className: 'status-chip danger-chip' };
  }

  if (permanentlyDeleted) {
    return { deleted, label: '영구 삭제된 설문', className: 'status-chip danger-chip' };
  }

  if (deleted) {
    return { deleted, label: '삭제된 설문', className: 'status-chip closed-chip' };
  }

  return { deleted: false, label: '정상 설문', className: 'status-chip published-chip' };
}

function filterDeletedResponses(responses = [], includeDeleted = false) {
  const responseList = Array.isArray(responses) ? responses : [];
  return includeDeleted
    ? responseList
    : responseList.filter((response) => !isDeletedSurveyResponse(response));
}

function getSelectedQuotaValues(answer) {
  if (Array.isArray(answer)) {
    return answer.map((item) => String(item ?? '').trim()).filter(Boolean);
  }

  if (answer && typeof answer === 'object') {
    if (Array.isArray(answer.values)) {
      return getSelectedQuotaValues(answer.values);
    }

    if (Array.isArray(answer.selectedValues)) {
      return getSelectedQuotaValues(answer.selectedValues);
    }

    if (typeof answer.value === 'string') {
      return getSelectedQuotaValues(answer.value);
    }
  }

  const normalizedAnswer = String(answer ?? '').trim();
  return normalizedAnswer ? [normalizedAnswer] : [];
}

function decrementOptionQuotaCounts(optionQuotaCounts = {}, questionId, selectedValues = []) {
  const nextCounts = { ...optionQuotaCounts };

  selectedValues.forEach((selectedValue) => {
    const quotaKey = buildOptionQuotaKey(questionId, selectedValue);
    const currentCount = Number(nextCounts[quotaKey] ?? 0);

    nextCounts[quotaKey] = Number.isFinite(currentCount)
      ? Math.max(0, currentCount - 1)
      : 0;
  });

  return nextCounts;
}

function sortSurveysByCreatedAtDesc(items = []) {
  return [...items].sort((first, second) => {
    const firstTime = first.createdAt?.toMillis?.() || 0;
    const secondTime = second.createdAt?.toMillis?.() || 0;
    return secondTime - firstTime;
  });
}

function filterDeletedSurveys(items = [], includeDeleted = false) {
  const visibleItems = items.filter((item) => !isPermanentlyDeletedSurvey(item));

  if (includeDeleted) {
    return visibleItems;
  }

  return visibleItems.filter((item) => !isDeletedSurvey(item));
}

function normalizeSurveyTableBlocks(tableBlocks = []) {
  if (!Array.isArray(tableBlocks)) {
    return [];
  }

  return tableBlocks
    .map((block, index) => {
      const columns = Array.isArray(block?.columns)
        ? block.columns.map((column) => String(column ?? '').trim()).filter(Boolean)
        : [];
      const rows = Array.isArray(block?.rows)
        ? block.rows
            .filter((row) => Array.isArray(row))
            .map((row) => columns.map((_, columnIndex) => String(row[columnIndex] ?? '').trim()))
        : [];

      return {
        id:
          typeof block?.id === 'string' && block.id.trim()
            ? block.id.trim()
            : `table-block-${index + 1}`,
        title: typeof block?.title === 'string' ? block.title.trim() : '',
        columns,
        rows,
      };
    })
    .filter((block) => block.columns.length > 0 && block.rows.length > 0);
}

export function getSurveyStatusMeta(status) {
  switch (normalizeSurveyStatus(status)) {
    case SURVEY_STATUSES.DELETED:
      return { label: '삭제됨', className: 'status-chip closed-chip' };
    case SURVEY_STATUSES.DRAFT:
      return { label: '임시저장', className: 'status-chip draft-chip' };
    case SURVEY_STATUSES.CLOSED:
      return { label: '마감', className: 'status-chip closed-chip' };
    case SURVEY_STATUSES.PUBLISHED:
    default:
      return { label: '게시중', className: 'status-chip published-chip' };
  }
}

export async function fetchAdminSurveys(options = {}) {
  ensureFirestoreReady();
  const snapshot = await getDocs(surveysCollection);
  return filterDeletedSurveys(
    sortSurveysByCreatedAtDesc(snapshot.docs.map(mapSurveyDoc)),
    options.includeDeleted,
  );
}

function isSurveyOwnedByUser(survey = {}, userAccess = {}) {
  const uid = String(userAccess.uid ?? '').trim();
  const email = String(userAccess.email ?? '').trim().toLowerCase();

  return Boolean(
    uid &&
      (survey.ownerUid === uid ||
        survey.createdByUid === uid ||
        survey.ownerId === uid ||
        survey.userId === uid ||
        survey.createdBy?.uid === uid),
  ) || Boolean(
    email &&
      (String(survey.ownerEmail ?? '').trim().toLowerCase() === email ||
        String(survey.createdByEmail ?? '').trim().toLowerCase() === email ||
        String(survey.createdBy?.email ?? '').trim().toLowerCase() === email),
  );
}

function mergeUniqueSurveys(...surveyLists) {
  const surveyById = new Map();

  surveyLists.flat().filter(Boolean).forEach((survey) => {
    if (!surveyById.has(survey.id)) {
      surveyById.set(survey.id, survey);
    }
  });

  return [...surveyById.values()];
}

async function fetchSurveysByConstraint(pathLabel, ...constraints) {
  try {
    const snapshot = await getDocs(query(surveysCollection, ...constraints));
    return snapshot.docs.map(mapSurveyDoc);
  } catch (error) {
    logFirestoreReadDenied(pathLabel, error);
    throw error;
  }
}

export async function fetchManagedSurveys(userAccess = {}, options = {}) {
  ensureFirestoreReady();

  if (canManageAllSurveys(userAccess.role)) {
    return fetchAdminSurveys(options);
  }

  const normalizedEmail = String(userAccess.email ?? '').trim().toLowerCase();

  if (userAccess.role === USER_ROLES.CREATOR && (userAccess.uid || normalizedEmail)) {
    const queryTasks = [
      fetchSurveysByConstraint('surveys?visibility==organization', where('visibility', '==', SURVEY_VISIBILITIES.ORGANIZATION)),
    ];

    if (userAccess.uid) {
      queryTasks.push(
        fetchSurveysByConstraint('surveys?ownerUid==currentUser', where('ownerUid', '==', userAccess.uid)),
        fetchSurveysByConstraint('surveys?createdByUid==currentUser', where('createdByUid', '==', userAccess.uid)),
        fetchSurveysByConstraint('surveys?ownerId==currentUser', where('ownerId', '==', userAccess.uid)),
        fetchSurveysByConstraint('surveys?userId==currentUser', where('userId', '==', userAccess.uid)),
        fetchSurveysByConstraint('surveys?createdBy.uid==currentUser', where('createdBy.uid', '==', userAccess.uid)),
      );
    }

    if (normalizedEmail) {
      queryTasks.push(
        fetchSurveysByConstraint('surveys?ownerEmail==currentUser', where('ownerEmail', '==', normalizedEmail)),
        fetchSurveysByConstraint('surveys?createdByEmail==currentUser', where('createdByEmail', '==', normalizedEmail)),
        fetchSurveysByConstraint('surveys?createdBy.email==currentUser', where('createdBy.email', '==', normalizedEmail)),
      );
    }

    const settledResults = await Promise.allSettled(queryTasks);
    const rejectedResults = settledResults.filter((result) => result.status === 'rejected');
    const results = settledResults
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);

    if (results.length === 0 && rejectedResults.length > 0) {
      throw rejectedResults[0].reason;
    }

    const visibleSurveys = mergeUniqueSurveys(...results).filter(
      (survey) =>
        isSurveyOwnedByUser(survey, userAccess) ||
        normalizeSurveyVisibility(survey.visibility) === SURVEY_VISIBILITIES.ORGANIZATION,
    );

    return filterDeletedSurveys(
      sortSurveysByCreatedAtDesc(visibleSurveys),
      options.includeDeleted,
    );
  }

  if (userAccess.role) {
    try {
      const snapshot = await getDocs(
        query(surveysCollection, where('visibility', '==', SURVEY_VISIBILITIES.ORGANIZATION)),
      );

      return filterDeletedSurveys(
        sortSurveysByCreatedAtDesc(snapshot.docs.map(mapSurveyDoc)),
        options.includeDeleted,
      );
    } catch (error) {
      logFirestoreReadDenied('surveys?visibility==organization', error);
      throw error;
    }
  }

  return [];
}

export async function fetchPublishedSurveys(options = {}) {
  ensureFirestoreReady();
  const snapshot = await getDocs(
    query(surveysCollection, where('status', 'in', [
      SURVEY_STATUSES.PUBLISHED,
      SURVEY_STATUSES.CLOSED,
      ...LEGACY_PUBLISHED_STATUSES,
    ])),
  );

  return filterDeletedSurveys(
    sortSurveysByCreatedAtDesc(snapshot.docs.map(mapSurveyDoc)),
    options.includeDeleted,
  );
}

export async function fetchSurveyById(surveyId) {
  ensureFirestoreReady();
  let snapshot;

  try {
    snapshot = await getDoc(doc(db, 'surveys', surveyId));
  } catch (error) {
    logFirestoreReadDenied(`surveys/${surveyId}`, error);
    throw error;
  }

  if (!snapshot.exists()) {
    return null;
  }

  return hydrateSurveyQuotaData(mapSurveyDoc(snapshot));
}

export async function getPublicSurvey(surveyId) {
  const survey = await fetchSurveyById(surveyId);

  if (!survey) {
    return null;
  }

  const publicState = getPublicSurveyState(survey);

  if (
    publicState.key !== 'open' &&
    publicState.key !== 'closed' &&
    publicState.key !== 'scheduled'
  ) {
    const error = new Error(getDraftSurveyMessage(survey.formType));
    error.code = 'permission-denied';
    throw error;
  }

  return survey;
}

export function subscribePublicSurvey(surveyId, onNext, onError) {
  ensureFirestoreReady();

  if (!surveyId) {
    onNext?.(null);
    return () => {};
  }

  let sequence = 0;

  return onSnapshot(
    doc(db, 'surveys', surveyId),
    async (snapshot) => {
      const currentSequence = sequence + 1;
      sequence = currentSequence;

      try {
        if (!snapshot.exists()) {
          onNext?.(null);
          return;
        }

        const survey = await hydrateSurveyQuotaData(mapSurveyDoc(snapshot));

        if (currentSequence !== sequence) {
          return;
        }

        const publicState = getPublicSurveyState(survey);

        if (
          publicState.key !== 'open' &&
          publicState.key !== 'closed' &&
          publicState.key !== 'scheduled'
        ) {
          const error = new Error(getDraftSurveyMessage(survey.formType));
          error.code = 'permission-denied';
          onError?.(error);
          return;
        }

        onNext?.(survey);
      } catch (error) {
        onError?.(error);
      }
    },
    (error) => {
      logFirestoreReadDenied(`surveys/${surveyId}`, error);
      onError?.(error);
    },
  );
}

export async function getManageSurvey(surveyId, userAccess = {}) {
  const survey = await fetchSurveyById(surveyId);

  if (!survey) {
    return null;
  }

  const normalizedEmail = String(userAccess.email ?? '').trim().toLowerCase();
  const canManageAll = canManageAllSurveys(userAccess.role);
  const isOwner = Boolean(
    userAccess.uid &&
      (survey.ownerUid === userAccess.uid ||
        survey.createdByUid === userAccess.uid ||
        survey.ownerId === userAccess.uid ||
        survey.userId === userAccess.uid ||
        survey.createdBy?.uid === userAccess.uid),
  ) || Boolean(
    normalizedEmail &&
      (String(survey.ownerEmail ?? '').trim().toLowerCase() === normalizedEmail ||
        String(survey.createdByEmail ?? '').trim().toLowerCase() === normalizedEmail ||
        String(survey.createdBy?.email ?? '').trim().toLowerCase() === normalizedEmail),
  );

  if (!canManageAll && !isOwner) {
    const error = new Error('이 설문을 미리보기할 권한이 없습니다.');
    error.code = 'permission-denied';
    throw error;
  }

  return survey;
}

export async function createSurvey({
  title,
  description,
  descriptionFormat = 'markdown',
  tableBlocks = [],
  questions,
  sections,
  status = SURVEY_STATUSES.DRAFT,
  createdBy,
  formType,
  branchingEnabled,
  quotaEnabled,
  maxResponses,
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
  quotaConfig,
  visibility = SURVEY_VISIBILITIES.PRIVATE,
  templateMetadata,
}) {
  ensureFirestoreReady();
  const normalizedQuestions = alignQuestionsToSections(
    sanitizeSurveyQuestions(questions),
    sections,
  );
  const normalizedSections = sanitizeSurveySections(sections, normalizedQuestions);
  const normalizedConfiguration = normalizeSurveyConfiguration({
    formType,
    branchingEnabled,
    quotaEnabled,
    maxResponses,
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
  });
  const { responseCount, ...persistedConfiguration } = normalizedConfiguration;
  const persistedTemplateMetadata = getPersistableTemplateMetadata(templateMetadata);
  const payload = {
    title,
    description,
    descriptionFormat,
    tableBlocks: normalizeSurveyTableBlocks(tableBlocks),
    questions: normalizedQuestions,
    sections: normalizedSections,
    optionQuotaCounts: {},
    status,
    createdByUid: createdBy?.uid ?? '',
    createdByEmail: createdBy?.email ?? '',
    createdByRole: createdBy?.role ?? '',
    ownerUid: createdBy?.uid ?? '',
    ownerEmail: createdBy?.email ?? '',
    visibility: normalizeSurveyVisibility(visibility),
    createdBy,
    updatedBy: createdBy,
    ...persistedConfiguration,
    responseCount: 0,
    opensAt: normalizedConfiguration.opensAt,
    closesAt: normalizedConfiguration.closesAt,
    applicationGuide: normalizedConfiguration.applicationGuide,
    scheduleSummary: normalizedConfiguration.scheduleSummary,
    cautionText: normalizedConfiguration.cautionText,
    allowResponseEdit: normalizedConfiguration.allowResponseEdit,
    completionMessage: normalizedConfiguration.completionMessage,
    adminNotificationEnabled: normalizedConfiguration.adminNotificationEnabled,
    ...persistedTemplateMetadata,
    deleted: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  const normalizedQuotaConfig = normalizeRegionAgeQuotaConfig(
    quotaConfig ?? createDefaultRegionAgeQuotaConfig(),
  );
  const created = await addDoc(surveysCollection, payload);
  await setDoc(doc(db, 'surveys', created.id, 'quotaConfig', 'main'), {
    ...normalizedQuotaConfig,
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'surveys', created.id, 'quotaCounts', 'main'), {
    ...createEmptyQuotaCounts(normalizedQuotaConfig),
    updatedAt: serverTimestamp(),
  });
  return created.id;
}

export async function updateSurvey(
  surveyId,
  {
    title,
    description,
    descriptionFormat,
    tableBlocks,
    questions,
    sections,
    status,
    formType,
    branchingEnabled,
    quotaEnabled,
    maxResponses,
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
    quotaConfig,
    visibility,
    templateMetadata,
    updatedBy,
  },
) {
  ensureFirestoreReady();
  const normalizedQuestions = alignQuestionsToSections(
    sanitizeSurveyQuestions(questions),
    sections,
  );
  const normalizedSections = sanitizeSurveySections(sections, normalizedQuestions);
  const normalizedConfiguration = normalizeSurveyConfiguration({
    formType,
    branchingEnabled,
    quotaEnabled,
    maxResponses,
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
  });
  const { responseCount, ...persistedConfiguration } = normalizedConfiguration;
  const currentSnapshot = await getDoc(doc(db, 'surveys', surveyId));
  const currentData = currentSnapshot.exists() ? currentSnapshot.data() : {};
  const nextOwnerUid = currentData.ownerUid || updatedBy?.uid || currentData.createdBy?.uid || '';
  const nextOwnerEmail =
    currentData.ownerEmail || updatedBy?.email || currentData.createdBy?.email || '';
  const nextCreatedByUid =
    currentData.createdByUid || currentData.createdBy?.uid || updatedBy?.uid || '';
  const nextCreatedByEmail =
    currentData.createdByEmail || currentData.createdBy?.email || updatedBy?.email || '';
  const nextCreatedByRole = currentData.createdByRole || updatedBy?.role || '';
  const nextDescriptionFormat = descriptionFormat || currentData.descriptionFormat || 'markdown';
  const nextTableBlocks =
    tableBlocks === undefined ? currentData.tableBlocks ?? [] : tableBlocks;
  const persistedTemplateMetadata = getPersistableTemplateMetadata(
    templateMetadata ?? {
      templateId: currentData.templateId,
      templateVersion: currentData.templateVersion,
      templateCategory: currentData.templateCategory,
      templateType: currentData.templateType,
      organization: currentData.organization,
      programType: currentData.programType,
      supportsYearCompare: currentData.supportsYearCompare,
      supportsFollowUp: currentData.supportsFollowUp,
      supportsAssetMapping: currentData.supportsAssetMapping,
      defaultFormType: currentData.defaultFormType,
    },
  );

  await updateDoc(doc(db, 'surveys', surveyId), {
    title,
    description,
    descriptionFormat: nextDescriptionFormat,
    tableBlocks: normalizeSurveyTableBlocks(nextTableBlocks),
    questions: normalizedQuestions,
    sections: normalizedSections,
    status,
    ownerUid: nextOwnerUid,
    ownerEmail: nextOwnerEmail,
    visibility: normalizeSurveyVisibility(visibility ?? currentData.visibility),
    createdByUid: nextCreatedByUid,
    createdByEmail: nextCreatedByEmail,
    createdByRole: nextCreatedByRole,
    deleted: currentData.deleted === true,
    ...(currentData.createdBy
      ? {}
      : updatedBy && typeof updatedBy === 'object'
        ? {
            createdBy: {
              uid: updatedBy.uid ?? '',
              email: updatedBy.email ?? '',
              name: updatedBy.name ?? '',
            },
          }
        : {}),
    ...persistedConfiguration,
    ...persistedTemplateMetadata,
    ...(updatedBy && typeof updatedBy === 'object'
      ? {
          updatedBy: {
            uid: updatedBy.uid ?? '',
            email: updatedBy.email ?? '',
            name: updatedBy.name ?? '',
          },
        }
      : {}),
    updatedAt: serverTimestamp(),
  });

  if (quotaConfig) {
    const normalizedQuotaConfig = normalizeRegionAgeQuotaConfig(quotaConfig);
    const countsRef = doc(db, 'surveys', surveyId, 'quotaCounts', 'main');
    const countsSnapshot = await getDoc(countsRef);

    await setDoc(doc(db, 'surveys', surveyId, 'quotaConfig', 'main'), {
      ...normalizedQuotaConfig,
      updatedAt: serverTimestamp(),
    });

    if (!countsSnapshot.exists()) {
      await setDoc(countsRef, {
        ...createEmptyQuotaCounts(normalizedQuotaConfig),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(countsRef, {
        ...normalizeQuotaCounts(countsSnapshot.data(), normalizedQuotaConfig),
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }
  }
}

export async function duplicateSurvey(surveyId, createdBy) {
  ensureFirestoreReady();
  const survey = await fetchSurveyById(surveyId);

  if (!survey) {
    throw new Error('복제할 설문을 찾을 수 없습니다.');
  }

  const duplicatedId = await createSurvey({
    title: `(복사본) ${survey.title}`,
    description: survey.description ?? '',
    descriptionFormat: survey.descriptionFormat ?? 'markdown',
    tableBlocks: survey.tableBlocks ?? [],
    questions: survey.questions ?? [],
    sections: survey.sections ?? [],
    status: SURVEY_STATUSES.DRAFT,
    createdBy,
    formType: survey.formType,
    branchingEnabled: survey.branchingEnabled,
    quotaEnabled: survey.quotaEnabled,
    maxResponses: survey.maxResponses,
    duplicateCheckEnabled: survey.duplicateCheckEnabled,
    slotDuplicateCheckEnabled: survey.slotDuplicateCheckEnabled,
    oneSlotPerPersonEnabled: survey.oneSlotPerPersonEnabled,
    applicantListView: survey.applicantListView,
    processingStatusEnabled: survey.processingStatusEnabled,
    opensAt: survey.opensAt,
    closesAt: survey.closesAt,
    applicationGuide: survey.applicationGuide,
    scheduleSummary: survey.scheduleSummary,
    cautionText: survey.cautionText,
    allowResponseEdit: survey.allowResponseEdit,
    completionMessage: survey.completionMessage,
    adminNotificationEnabled: survey.adminNotificationEnabled,
    visibility: survey.visibility,
    quotaConfig: {
      ...createDefaultRegionAgeQuotaConfig(survey.quotaConfig),
      enabled: Boolean(survey.quotaConfig?.enabled),
    },
    templateMetadata: {
      templateId: survey.templateId,
      templateVersion: survey.templateVersion,
      templateCategory: survey.templateCategory,
      templateType: survey.templateType,
      organization: survey.organization,
      programType: survey.programType,
      supportsYearCompare: survey.supportsYearCompare,
      supportsFollowUp: survey.supportsFollowUp,
      supportsAssetMapping: survey.supportsAssetMapping,
      defaultFormType: survey.defaultFormType,
    },
  });

  const createdSurvey = await waitForSurveyDocument(duplicatedId);

  if (!createdSurvey) {
    throw new Error('복제된 설문 저장 확인에 실패했습니다. 잠시 후 다시 시도해주세요.');
  }

  return duplicatedId;
}

export async function changeSurveyStatus(surveyId, status) {
  ensureFirestoreReady();
  const normalizedStatus = normalizeSurveyStatus(status);

  await updateDoc(doc(db, 'surveys', surveyId), {
    status: normalizedStatus,
    updatedAt: serverTimestamp(),
  });
}

export async function fetchResponseCountBySurveyId(surveyId) {
  ensureFirestoreReady();

  try {
    const snapshot = await getDocs(query(responsesCollection, where('surveyId', '==', surveyId)));
    return snapshot.size;
  } catch (error) {
    logFirestoreReadDenied(`responses?surveyId==${surveyId}`, error);

    if (isPermissionDeniedError(error)) {
      return 0;
    }

    throw error;
  }
}

export async function deleteSurvey(surveyId, deletedBy = null) {
  ensureFirestoreReady();
  const surveyRef = doc(db, 'surveys', surveyId);
  const snapshot = await getDoc(surveyRef);
  const currentStatus = snapshot.exists() ? normalizeSurveyStatus(snapshot.data().status) : SURVEY_STATUSES.DRAFT;

  await updateDoc(surveyRef, {
    deleted: true,
    deletedAt: serverTimestamp(),
    deletedPreviousStatus:
      currentStatus !== SURVEY_STATUSES.DELETED ? currentStatus : SURVEY_STATUSES.DRAFT,
    deletedBy:
      deletedBy && typeof deletedBy === 'object'
        ? {
            uid: deletedBy.uid ?? '',
            email: deletedBy.email ?? '',
            name: deletedBy.name ?? '',
          }
        : null,
    status: SURVEY_STATUSES.DELETED,
    updatedAt: serverTimestamp(),
  });

  await markSurveyResponsesDeletedState(surveyId, {
    surveyDeleted: true,
    surveyPermanentlyDeleted: false,
    hiddenFromDefaultList: true,
  });
}

export async function restoreSurvey(surveyId) {
  ensureFirestoreReady();
  const surveyRef = doc(db, 'surveys', surveyId);
  const snapshot = await getDoc(surveyRef);
  const currentData = snapshot.exists() ? snapshot.data() : {};
  const restoredStatus = normalizeSurveyStatus(currentData.deletedPreviousStatus || SURVEY_STATUSES.DRAFT);

  await updateDoc(surveyRef, {
    deleted: false,
    deletedAt: null,
    deletedBy: null,
    deletedPreviousStatus: null,
    status: restoredStatus === SURVEY_STATUSES.DELETED ? SURVEY_STATUSES.DRAFT : restoredStatus,
    updatedAt: serverTimestamp(),
  });

  await markSurveyResponsesDeletedState(surveyId, {
    surveyDeleted: false,
    surveyPermanentlyDeleted: false,
    hiddenFromDefaultList: false,
  });
}

export async function permanentlyDeleteSurvey(surveyId, deletedBy = null) {
  ensureFirestoreReady();
  const surveyRef = doc(db, 'surveys', surveyId);

  await updateDoc(surveyRef, {
    permanentlyDeleted: true,
    permanentlyDeletedAt: serverTimestamp(),
    permanentlyDeletedBy:
      deletedBy && typeof deletedBy === 'object'
        ? {
            uid: deletedBy.uid ?? '',
            email: deletedBy.email ?? '',
            name: deletedBy.name ?? '',
          }
        : null,
    updatedAt: serverTimestamp(),
  });

  await markSurveyResponsesDeletedState(surveyId, {
    surveyDeleted: true,
    surveyPermanentlyDeleted: true,
    hiddenFromDefaultList: true,
  });
}

async function markSurveyResponsesDeletedState(surveyId, state) {
  const snapshot = await getDocs(query(responsesCollection, where('surveyId', '==', surveyId)));
  let batch = writeBatch(db);
  let operationCount = 0;

  for (const responseDoc of snapshot.docs) {
    batch.update(responseDoc.ref, {
      ...state,
      updatedAt: serverTimestamp(),
    });
    operationCount += 1;

    if (operationCount === 450) {
      await batch.commit();
      batch = writeBatch(db);
      operationCount = 0;
    }
  }

  if (operationCount > 0) {
    await batch.commit();
  }
}

export async function submitSurveyResponse({
  surveyId,
  surveyTitle,
  answers = [],
  respondent,
  responseMode,
  visibleQuestionIds,
  visibleSectionIds,
  skippedQuestionIds,
  clientSubmitId,
  quotaInput,
  currentUserAccess = {},
}) {
  ensureFirestoreReady();
  const surveyRef = doc(db, 'surveys', surveyId);
  const normalizedClientSubmitId =
    typeof clientSubmitId === 'string' && clientSubmitId.trim()
      ? clientSubmitId.trim()
      : createLocalId('client-submit');
  const responseRef = doc(responsesCollection, buildClientSubmitResponseDocumentId(surveyId, normalizedClientSubmitId));
  const clientSubmitLockRef = doc(
    db,
    'surveys',
    surveyId,
    'clientSubmitLocks',
    buildClientSubmitLockDocumentId(normalizedClientSubmitId),
  );
  const surveySnapshot = await getDoc(surveyRef);

  if (!surveySnapshot.exists()) {
    const error = new Error('설문 정보를 찾을 수 없습니다.');
    error.code = 'not-found';
    throw error;
  }

  const survey = mapSurveyDoc(surveySnapshot);
  const applicantIdentity = extractApplicantIdentity(survey.questions, answers);
  const slotSelections = extractSlotSelections(
    survey.questions,
    answers,
    survey.optionQuotaCounts,
  );

  if (
    survey.duplicateCheckEnabled ||
    survey.slotDuplicateCheckEnabled ||
    survey.oneSlotPerPersonEnabled
  ) {
    if (!applicantIdentity.key) {
      const error = new Error(
        '중복 신청 방지를 사용 중인 폼입니다. 연락처 또는 이름+생년월일 정보를 입력한 뒤 다시 신청해주세요.',
      );
      error.code = 'failed-precondition';
      throw error;
    }
  }

  return runTransaction(db, async (transaction) => {
    const clientSubmitLockSnapshot = await transaction.get(clientSubmitLockRef);

    if (clientSubmitLockSnapshot.exists()) {
      return responseRef.id;
    }

    const surveySnapshotInTransaction = await transaction.get(surveyRef);

    if (!surveySnapshotInTransaction.exists()) {
      const error = new Error('설문 정보를 찾을 수 없습니다.');
      error.code = 'not-found';
      throw error;
    }

    const survey = mapSurveyDoc(surveySnapshotInTransaction);
    const quotaConfigRef = doc(db, 'surveys', surveyId, 'quotaConfig', 'main');
    const quotaCountsRef = doc(db, 'surveys', surveyId, 'quotaCounts', 'main');
    const [quotaConfigSnapshot, quotaCountsSnapshot] = await Promise.all([
      transaction.get(quotaConfigRef),
      transaction.get(quotaCountsRef),
    ]);
    const quotaConfig = normalizeRegionAgeQuotaConfig(
      quotaConfigSnapshot.exists()
        ? quotaConfigSnapshot.data()
        : createDefaultRegionAgeQuotaConfig(),
    );
    const quotaCounts = normalizeQuotaCounts(
      quotaCountsSnapshot.exists() ? quotaCountsSnapshot.data() : createEmptyQuotaCounts(quotaConfig),
      quotaConfig,
    );

    if (getPublicSurveyState(survey).key !== 'open') {
      const error = new Error('현재 응답을 받을 수 없는 설문입니다.');
      error.code = 'failed-precondition';
      throw error;
    }

    const quotaSummary = getQuotaSummary(survey);

    if (quotaSummary.quotaEnabled && quotaSummary.maxResponses && quotaSummary.isFull) {
      const error = new Error('정원이 마감되어 더 이상 응답을 받을 수 없습니다.');
      error.code = 'resource-exhausted';
      throw error;
    }

    const nextOptionQuotaCounts = {
      ...normalizeOptionQuotaCounts(survey.optionQuotaCounts),
    };
    const applicantLockWrites = [];
    const slotLockWrites = [];

    if (
      applicantIdentity.key &&
      (survey.duplicateCheckEnabled || survey.oneSlotPerPersonEnabled)
    ) {
      const applicantLockRef = doc(
        db,
        'surveys',
        surveyId,
        'applicationApplicantLocks',
        buildApplicantLockDocumentId(applicantIdentity.key),
      );
      const applicantLockSnapshot = await transaction.get(applicantLockRef);

      if (applicantLockSnapshot.exists()) {
        const error = new Error(
          survey.duplicateCheckEnabled
            ? `이미 신청된 정보가 있습니다. ${applicantIdentity.keyLabel} 중복 신청은 허용되지 않습니다.`
            : '이 폼은 1인 1슬롯만 신청할 수 있습니다. 이미 신청된 정보가 있습니다.',
        );
        error.code = 'already-exists';
        throw error;
      }

      applicantLockWrites.push({
        ref: applicantLockRef,
        data: {
          surveyId,
          applicantHash: hashString(applicantIdentity.key),
          applicantKeyLabel: applicantIdentity.keyLabel,
          lockType: survey.duplicateCheckEnabled ? 'form_duplicate' : 'one_slot_per_person',
          responseId: responseRef.id,
          createdAt: serverTimestamp(),
        },
      });
    }

    if (survey.slotDuplicateCheckEnabled && applicantIdentity.key && slotSelections.length > 0) {
      for (const slotSelection of slotSelections) {
        const slotLockRef = doc(
          db,
          'surveys',
          surveyId,
          'applicationSlotLocks',
          buildApplicationSlotLockDocumentId(
            slotSelection.questionId,
            slotSelection.slotValue,
            applicantIdentity.key,
          ),
        );
        const slotLockSnapshot = await transaction.get(slotLockRef);

        if (slotLockSnapshot.exists()) {
          const error = new Error(
            `"${slotSelection.slotLabel ?? '선택한 슬롯'}"은 이미 같은 신청 정보로 접수되어 다시 신청할 수 없습니다.`,
          );
          error.code = 'already-exists';
          throw error;
        }

        slotLockWrites.push({
          ref: slotLockRef,
          data: {
            surveyId,
            questionId: slotSelection.questionId,
            slotValue: slotSelection.slotValue,
            slotLabel: slotSelection.slotLabel,
            applicantHash: hashString(applicantIdentity.key),
            responseId: responseRef.id,
            createdAt: serverTimestamp(),
          },
        });
      }
    }

    answers.forEach((answerItem) => {
      const matchedQuestion = (survey.questions ?? []).find(
        (question) => question.id === answerItem.questionId,
      );

      if (!matchedQuestion || !isOptionQuotaQuestion(matchedQuestion)) {
        return;
      }

      if (
        matchedQuestion.type !== QUESTION_TYPES.SINGLE_CHOICE &&
        matchedQuestion.type !== QUESTION_TYPES.DROPDOWN &&
        matchedQuestion.type !== QUESTION_TYPES.APPLICATION_SLOT_CHOICE
      ) {
        return;
      }

      const selectedOption = typeof answerItem.answer === 'string' ? answerItem.answer.trim() : '';

      if (!selectedOption || !matchedQuestion.options.includes(selectedOption)) {
        return;
      }

      const optionItems = getQuestionOptionItems(matchedQuestion, nextOptionQuotaCounts);
      const matchedOption = optionItems.find((option) => option.value === selectedOption);

      if (!matchedOption?.capacity) {
        return;
      }

      if (matchedOption.isClosed) {
        const error = new Error(`선택한 항목 "${matchedOption.label}"은 이미 마감되었습니다.`);
        error.code = 'resource-exhausted';
        throw error;
      }

        nextOptionQuotaCounts[buildOptionQuotaKey(matchedQuestion.id, selectedOption)] =
        matchedOption.currentCount + 1;
    });

    let responseQuota = null;
    let nextQuotaCounts = quotaCounts;

    if (quotaConfig.enabled) {
      const resolvedQuota = resolveRegionAgeQuota(quotaInput, quotaConfig);

      if (!resolvedQuota.valid) {
        const error = new Error('출생년도와 거주지역을 확인해주세요.');
        error.code = 'failed-precondition';
        throw error;
      }

      const target = normalizeQuotaNumber(
        quotaConfig.matrix?.[resolvedQuota.region.id]?.[resolvedQuota.ageGroup.id],
        0,
      );
      const currentCount = normalizeQuotaNumber(
        quotaCounts.cells?.[resolvedQuota.region.id]?.[resolvedQuota.ageGroup.id],
        0,
      );
      const isClosedCell = target > 0 && currentCount >= target;
      const canAdminOverride = canManageAllSurveys(currentUserAccess.role);

      if (
        isClosedCell &&
        (quotaConfig.closeMode === QUOTA_CLOSE_MODES.BLOCK ||
          (quotaConfig.closeMode === QUOTA_CLOSE_MODES.ADMIN_ONLY && !canAdminOverride))
      ) {
        const error = new Error('선택하신 거주지역과 연령대의 목표 응답이 마감되었습니다. 참여해 주셔서 감사합니다.');
        error.code = 'resource-exhausted';
        throw error;
      }

      responseQuota = {
        area: resolvedQuota.area,
        regionId: resolvedQuota.region.id,
        regionLabel: resolvedQuota.region.label,
        birthYear: resolvedQuota.birthYear,
        age: resolvedQuota.age,
        ageGroupId: resolvedQuota.ageGroup.id,
        ageGroupLabel: resolvedQuota.ageGroup.label,
        isOverQuota: isClosedCell,
      };
      nextQuotaCounts = {
        ...quotaCounts,
        total: normalizeQuotaNumber(quotaCounts.total, 0) + 1,
        cells: {
          ...quotaCounts.cells,
          [resolvedQuota.region.id]: {
            ...(quotaCounts.cells?.[resolvedQuota.region.id] ?? {}),
            [resolvedQuota.ageGroup.id]: currentCount + 1,
          },
        },
      };
    }

    const nextResponseCount = quotaSummary.responseCount + 1;
    const shouldCloseAfterSubmit =
      quotaSummary.quotaEnabled &&
      quotaSummary.maxResponses &&
      nextResponseCount >= quotaSummary.maxResponses;

    transaction.set(responseRef, {
      surveyId,
      surveyTitle,
      clientSubmitId: normalizedClientSubmitId,
      surveyType: survey.formType ?? '',
      surveyOwnerEmail: survey.ownerEmail ?? survey.createdBy?.email ?? '',
      surveyOwnerUid: survey.ownerUid ?? survey.createdBy?.uid ?? '',
      surveyCreatedByEmail: survey.createdByEmail ?? survey.createdBy?.email ?? '',
      surveyCreatedByUid: survey.createdByUid ?? survey.createdBy?.uid ?? '',
      surveyDeleted: false,
      surveyPermanentlyDeleted: false,
      hiddenFromDefaultList: false,
      answers,
      status: RESPONSE_STATUSES.SUBMITTED,
      responseMode: responseMode === 'paged' ? 'paged' : 'single',
      visibleQuestionIds: Array.isArray(visibleQuestionIds) ? visibleQuestionIds : [],
      visibleSectionIds: Array.isArray(visibleSectionIds) ? visibleSectionIds : [],
      skippedQuestionIds: Array.isArray(skippedQuestionIds) ? skippedQuestionIds : [],
      quota: responseQuota,
      respondent: {
        ...(respondent ?? {}),
        clientSubmitId: normalizedClientSubmitId,
        applicantName: applicantIdentity.name,
        applicantPhone: applicantIdentity.phone,
        applicantBirthDate: applicantIdentity.birthDate,
        applicantKey: applicantIdentity.key,
        applicantKeyLabel: applicantIdentity.keyLabel,
        slotSelections,
      },
      respondentName: applicantIdentity.name,
      respondentPhone: applicantIdentity.phone,
      selectedSlotLabel: slotSelections[0]?.slotLabel ?? '',
      adminNote: '',
      submittedAt: serverTimestamp(),
      updatedAt: getIsoTimestamp(),
    });

    transaction.set(clientSubmitLockRef, {
      surveyId,
      clientSubmitIdHash: hashString(normalizedClientSubmitId),
      createdAt: serverTimestamp(),
    });

    transaction.update(surveyRef, {
      optionQuotaCounts: nextOptionQuotaCounts,
      responseCount: nextResponseCount,
      status: shouldCloseAfterSubmit ? SURVEY_STATUSES.CLOSED : normalizeSurveyStatus(survey.storedStatus),
      updatedAt: serverTimestamp(),
    });

    if (quotaConfig.enabled) {
      transaction.set(quotaCountsRef, {
        ...nextQuotaCounts,
        updatedAt: serverTimestamp(),
      });
    }

    applicantLockWrites.forEach((lock) => {
      transaction.set(lock.ref, lock.data);
    });
    slotLockWrites.forEach((lock) => {
      transaction.set(lock.ref, lock.data);
    });

    return responseRef.id;
  });
}

export async function fetchRecentResponses(limitCount = 20) {
  ensureFirestoreReady();
  const snapshot = await getDocs(
    query(responsesCollection, orderBy('submittedAt', 'desc'), limit(limitCount)),
  );

  return filterDeletedResponses(snapshot.docs.map(mapResponseDoc));
}

export async function createAuditLog({
  action,
  surveyId,
  surveyTitle = '',
  responseId = null,
  actor = {},
  metadata = {},
}) {
  try {
    ensureFirestoreReady();
    const normalizedAction = String(action ?? '');
    const normalizedSurveyTitle = String(surveyTitle ?? '');
    const normalizedMetadata =
      typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
        ? Object.fromEntries(
            Object.entries(metadata)
              .filter(([, value]) => value !== undefined)
              .map(([key, value]) => [
                key,
                Array.isArray(value)
                  ? value.map((item) => String(item ?? ''))
                  : value === null || ['string', 'number', 'boolean'].includes(typeof value)
                    ? value
                    : String(value ?? ''),
              ]),
          )
        : {};

    if (normalizedSurveyTitle && !normalizedMetadata.surveyTitle) {
      normalizedMetadata.surveyTitle = normalizedSurveyTitle;
    }

    await addDoc(auditLogsCollection, {
      action: normalizedAction,
      surveyId: String(surveyId ?? ''),
      responseId: responseId ? String(responseId) : null,
      actor: {
        uid: String(actor?.uid ?? ''),
        email: String(actor?.email ?? ''),
        displayName: String(actor?.displayName ?? actor?.name ?? ''),
      },
      metadata: normalizedMetadata,
      createdAt: serverTimestamp(),
    });
  } catch (auditError) {
    const warningKey = `${String(action ?? '')}:${auditError?.code ?? auditError?.message ?? 'unknown'}`;
    if (!warnedAuditLogFailures.has(warningKey)) {
      warnedAuditLogFailures.add(warningKey);
      console.warn('[AuditLog] 감사로그 저장 실패:', auditError?.code ?? '', auditError?.message ?? auditError);
    }
  }
}

export async function fetchAuditLogs({
  limitCount = 30,
  lastDoc = null,
  action = '',
  surveyId = '',
} = {}) {
  ensureFirestoreReady();
  const normalizedLimit = Number.isFinite(limitCount) && limitCount > 0 ? limitCount : 30;
  const normalizedAction = String(action ?? '').trim();
  const normalizedSurveyId = String(surveyId ?? '').trim();
  const queryConstraints = [];

  if (normalizedAction) {
    queryConstraints.push(where('action', '==', normalizedAction));
  }

  if (normalizedSurveyId) {
    queryConstraints.push(where('surveyId', '==', normalizedSurveyId));
  }

  queryConstraints.push(orderBy('createdAt', 'desc'));

  if (lastDoc) {
    queryConstraints.push(startAfter(lastDoc));
  }

  queryConstraints.push(limit(normalizedLimit));

  const snapshot = await getDocs(query(auditLogsCollection, ...queryConstraints));

  return {
    logs: snapshot.docs.map((item) => ({
      id: item.id,
      ...item.data(),
    })),
    lastDoc: snapshot.docs[snapshot.docs.length - 1] ?? null,
    hasMore: snapshot.docs.length === normalizedLimit,
  };
}

function sanitizeReportSections(sections = {}) {
  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return {};
  }

  return {
    overviewText: String(sections.overviewText ?? ''),
    respondentProfileText: String(sections.respondentProfileText ?? ''),
    satisfactionAnalysisText: String(sections.satisfactionAnalysisText ?? ''),
    openEndedSummaryText: String(sections.openEndedSummaryText ?? ''),
    improvementPlanText: String(sections.improvementPlanText ?? ''),
    finalSummaryText: String(sections.finalSummaryText ?? ''),
  };
}

export async function fetchSurveyReport(surveyId, reportId = '') {
  ensureFirestoreReady();
  const normalizedSurveyId = String(surveyId ?? '').trim();
  const normalizedReportId = String(reportId ?? '').trim() || normalizedSurveyId;

  if (!normalizedSurveyId || !normalizedReportId) {
    return null;
  }

  let snapshot;

  try {
    snapshot = await getDoc(doc(surveyReportsCollection, normalizedReportId));
  } catch (error) {
    logFirestoreReadDenied(`survey_reports/${normalizedReportId}`, error);
    throw error;
  }

  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();
  if (String(data.surveyId ?? '') !== normalizedSurveyId || data.deleted === true) {
    return null;
  }

  return {
    id: snapshot.id,
    ...data,
  };
}

export async function saveSurveyReport(surveyId, report, actor = {}, reportId = '') {
  ensureFirestoreReady();
  const normalizedSurveyId = String(surveyId ?? '').trim();
  const normalizedReportId = String(reportId ?? '').trim() || normalizedSurveyId;

  if (!normalizedSurveyId || !normalizedReportId) {
    throw new Error('저장할 보고서의 설문 ID가 없습니다.');
  }

  const reportRef = doc(surveyReportsCollection, normalizedReportId);
  let currentSnapshot;

  try {
    currentSnapshot = await getDoc(reportRef);
  } catch (error) {
    logFirestoreReadDenied(`survey_reports/${normalizedReportId}`, error);
    throw error;
  }
  const actorMeta = {
    uid: String(actor?.uid ?? ''),
    email: String(actor?.email ?? ''),
    displayName: String(actor?.displayName ?? actor?.name ?? ''),
  };
  const payload = {
    surveyId: normalizedSurveyId,
    title: String(report?.title ?? ''),
    periodStart: String(report?.periodStart ?? ''),
    periodEnd: String(report?.periodEnd ?? ''),
    period: String(report?.period ?? ''),
    target: String(report?.target ?? ''),
    department: String(report?.department ?? ''),
    author: String(report?.author ?? ''),
    reportDate: String(report?.reportDate ?? ''),
    sections: sanitizeReportSections(report?.sections),
    status: report?.status === 'final' ? 'final' : 'draft',
    deleted: false,
    updatedBy: actorMeta,
    updatedAt: serverTimestamp(),
  };

  if (!currentSnapshot.exists()) {
    payload.createdBy = actorMeta;
    payload.createdAt = serverTimestamp();
  }

  try {
    await setDoc(reportRef, payload, { merge: true });
  } catch (error) {
    logFirestoreReadDenied(`survey_reports/${normalizedReportId}`, error);
    throw error;
  }

  return {
    id: normalizedReportId,
    ...payload,
  };
}

function normalizeSurveyReportDoc(snapshot, survey = null) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    ...data,
    surveyTitle: String(data.surveyTitle ?? survey?.title ?? ''),
    responseCount: Number.isFinite(data.responseCount)
      ? data.responseCount
      : Number(survey?.responseCount ?? 0),
    status: data.status === 'final' ? 'final' : 'draft',
    deleted: data.deleted === true,
  };
}

function getReportTimestampMillis(value) {
  if (typeof value?.toDate === 'function') {
    return value.toDate().getTime();
  }
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
}

export async function fetchManagedSurveyReports(userAccess = {}) {
  ensureFirestoreReady();
  const surveys = await fetchManagedSurveys(userAccess);
  const surveyMap = new Map(surveys.map((survey) => [survey.id, survey]));
  let reportDocs = [];

  if (canManageAllSurveys(userAccess.role)) {
    const snapshot = await getDocs(surveyReportsCollection).catch((error) => {
      logFirestoreReadDenied('survey_reports', error);
      throw error;
    });
    reportDocs = snapshot.docs;
  } else if (userAccess.role === USER_ROLES.CREATOR) {
    const reportQueries = surveys.map((survey) => ({
      path: `survey_reports?surveyId==${survey.id}`,
      read: () => getDocs(query(surveyReportsCollection, where('surveyId', '==', survey.id))),
    }));
    const snapshots = await Promise.all(
      reportQueries.map((item) =>
        item.read().catch((error) => {
          logFirestoreReadDenied(item.path, error);
          throw error;
        }),
      ),
    );
    reportDocs = snapshots.flatMap((snapshot) => snapshot.docs);
  }

  return reportDocs
    .map((snapshot) =>
      normalizeSurveyReportDoc(snapshot, surveyMap.get(snapshot.data().surveyId)),
    )
    .filter((report) => !report.deleted && surveyMap.has(report.surveyId))
    .sort((first, second) => {
      const firstTime = getReportTimestampMillis(first.updatedAt);
      const secondTime = getReportTimestampMillis(second.updatedAt);
      return secondTime - firstTime;
    });
}

export async function copySurveyReport(reportId, actor = {}) {
  ensureFirestoreReady();
  const normalizedReportId = String(reportId ?? '').trim();
  if (!normalizedReportId) {
    throw new Error('복제할 보고서 ID가 없습니다.');
  }

  let sourceSnapshot;

  try {
    sourceSnapshot = await getDoc(doc(surveyReportsCollection, normalizedReportId));
  } catch (error) {
    logFirestoreReadDenied(`survey_reports/${normalizedReportId}`, error);
    throw error;
  }
  if (!sourceSnapshot.exists() || sourceSnapshot.data().deleted === true) {
    throw new Error('복제할 보고서를 찾을 수 없습니다.');
  }

  const source = sourceSnapshot.data();
  const actorMeta = {
    uid: String(actor?.uid ?? ''),
    email: String(actor?.email ?? ''),
    displayName: String(actor?.displayName ?? actor?.name ?? ''),
  };
  const payload = {
    surveyId: String(source.surveyId ?? ''),
    title: `(복사본) ${String(source.title ?? '결과보고서')}`,
    periodStart: String(source.periodStart ?? ''),
    periodEnd: String(source.periodEnd ?? ''),
    period: String(source.period ?? ''),
    target: String(source.target ?? ''),
    department: String(source.department ?? ''),
    author: String(source.author ?? ''),
    reportDate: String(source.reportDate ?? ''),
    sections: sanitizeReportSections(source.sections),
    status: 'draft',
    copiedFromReportId: normalizedReportId,
    deleted: false,
    createdBy: actorMeta,
    updatedBy: actorMeta,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  let copiedRef;

  try {
    copiedRef = await addDoc(surveyReportsCollection, payload);
  } catch (error) {
    logFirestoreReadDenied('survey_reports', error);
    throw error;
  }
  return { id: copiedRef.id, ...payload };
}

export async function softDeleteSurveyReport(reportId, actor = {}) {
  ensureFirestoreReady();
  const normalizedReportId = String(reportId ?? '').trim();
  if (!normalizedReportId) {
    throw new Error('삭제할 보고서 ID가 없습니다.');
  }

  const actorMeta = {
    uid: String(actor?.uid ?? ''),
    email: String(actor?.email ?? ''),
    displayName: String(actor?.displayName ?? actor?.name ?? ''),
  };
  const reportRef = doc(surveyReportsCollection, normalizedReportId);
  let snapshot;

  try {
    snapshot = await getDoc(reportRef);
  } catch (error) {
    logFirestoreReadDenied(`survey_reports/${normalizedReportId}`, error);
    throw error;
  }
  if (!snapshot.exists()) {
    throw new Error('삭제할 보고서를 찾을 수 없습니다.');
  }
  try {
    await updateDoc(reportRef, {
      status: snapshot.data().status === 'final' ? 'final' : 'draft',
      deleted: true,
      deletedAt: serverTimestamp(),
      deletedBy: actorMeta,
      updatedAt: serverTimestamp(),
      updatedBy: actorMeta,
    });
  } catch (error) {
    logFirestoreReadDenied(`survey_reports/${normalizedReportId}`, error);
    throw error;
  }
}

export async function fetchManagedRecentResponses(userAccess = {}, limitCount = 20, options = {}) {
  ensureFirestoreReady();
  const normalizedEmail = String(userAccess.email ?? '').trim().toLowerCase();

  if (canManageAllSurveys(userAccess.role)) {
    return fetchRecentResponses(limitCount);
  }

  if (userAccess.role !== USER_ROLES.CREATOR || (!userAccess.uid && !normalizedEmail)) {
    return [];
  }

  const responseQueries = [];

  if (userAccess.uid) {
    responseQueries.push(
      getDocs(query(responsesCollection, where('surveyOwnerUid', '==', userAccess.uid))),
    );
  }

  if (normalizedEmail) {
    responseQueries.push(
      getDocs(query(responsesCollection, where('surveyOwnerEmail', '==', normalizedEmail))),
    );
  }

  const snapshots = (await Promise.allSettled(responseQueries))
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value);
  const mergedDocs = snapshots.flatMap((snapshot) => snapshot.docs).reduce((result, item) => {
    result.set(item.id, item);
    return result;
  }, new Map());

  return filterDeletedResponses([...mergedDocs.values()].map(mapResponseDoc))
    .sort((first, second) => {
      const firstTime =
        first.submittedAt instanceof Timestamp ? first.submittedAt.toMillis() : 0;
      const secondTime =
        second.submittedAt instanceof Timestamp ? second.submittedAt.toMillis() : 0;

      return secondTime - firstTime;
    })
    .slice(0, limitCount);
}

function buildResponsePage(snapshot, pageSize) {
  return {
    responses: filterDeletedResponses(snapshot.docs.map(mapResponseDoc)),
    lastDoc: snapshot.docs[snapshot.docs.length - 1] ?? null,
    hasMore: Number.isFinite(pageSize) && pageSize > 0
      ? snapshot.docs.length === pageSize
      : false,
  };
}

export async function fetchResponsesBySurveyId(surveyId, options = {}) {
  ensureFirestoreReady();
  const { pageSize, lastDoc, paginated = false } = options;
  const queryConstraints = [
    where('surveyId', '==', surveyId),
    orderBy('submittedAt', 'desc'),
  ];

  if (lastDoc) {
    queryConstraints.push(startAfter(lastDoc));
  }

  if (Number.isFinite(pageSize) && pageSize > 0) {
    queryConstraints.push(limit(pageSize));
  }

  let snapshot;

  try {
    snapshot = await getDocs(query(responsesCollection, ...queryConstraints));
  } catch (error) {
    logFirestoreReadDenied(`responses?surveyId==${surveyId}`, error);
    throw error;
  }

  if (paginated) {
    return {
      ...buildResponsePage(snapshot, pageSize),
      source: 'surveyId',
    };
  }

  return filterDeletedResponses(snapshot.docs.map(mapResponseDoc));
}

export async function fetchResponsesBySurveyTitle(surveyTitle, options = {}) {
  ensureFirestoreReady();

  if (!surveyTitle?.trim()) {
    return options.paginated
      ? { responses: [], lastDoc: null, hasMore: false, source: 'surveyTitle' }
      : [];
  }

  const { pageSize, lastDoc, paginated = false } = options;
  const queryConstraints = [
    where('surveyTitle', '==', surveyTitle),
    orderBy('submittedAt', 'desc'),
  ];

  if (lastDoc) {
    queryConstraints.push(startAfter(lastDoc));
  }

  if (Number.isFinite(pageSize) && pageSize > 0) {
    queryConstraints.push(limit(pageSize));
  }

  let snapshot;

  try {
    snapshot = await getDocs(query(responsesCollection, ...queryConstraints));
  } catch (error) {
    logFirestoreReadDenied(`responses?surveyTitle==${surveyTitle}`, error);
    throw error;
  }

  if (paginated) {
    return {
      ...buildResponsePage(snapshot, pageSize),
      source: 'surveyTitle',
    };
  }

  return filterDeletedResponses(snapshot.docs.map(mapResponseDoc));
}

export async function fetchResponsesForSurvey(survey, userAccess = {}, options = {}) {
  ensureFirestoreReady();

  if (!survey?.id) {
    return options.paginated
      ? { responses: [], lastDoc: null, hasMore: false, source: 'surveyId' }
      : [];
  }

  if (options.paginated) {
    const source = options.source ?? 'surveyId';

    if (source === 'surveyTitle') {
      return fetchResponsesBySurveyTitle(survey.title ?? '', options);
    }

    const directPage = await fetchResponsesBySurveyId(survey.id, options);

    if (directPage.responses.length > 0 || options.lastDoc) {
      return directPage;
    }

    if (survey.id && !isDeletedSurvey(survey)) {
      return directPage;
    }

    return fetchResponsesBySurveyTitle(survey.title ?? '', {
      ...options,
      lastDoc: null,
      source: 'surveyTitle',
    });
  }

  if (userAccess.role === USER_ROLES.CREATOR) {
    const normalizedEmail = String(userAccess.email ?? '').trim().toLowerCase();
    const responseQueries = [];

    if (userAccess.uid) {
      responseQueries.push(
        getDocs(query(responsesCollection, where('surveyOwnerUid', '==', userAccess.uid))),
      );
    }

    if (normalizedEmail) {
      responseQueries.push(
        getDocs(query(responsesCollection, where('surveyOwnerEmail', '==', normalizedEmail))),
      );
    }

    const snapshots = (await Promise.allSettled(responseQueries))
      .filter((result) => result.status === 'fulfilled')
      .map((result) => result.value);
    const mergedDocs = snapshots.flatMap((snapshot) => snapshot.docs).reduce((result, item) => {
      result.set(item.id, item);
      return result;
    }, new Map());

    return filterDeletedResponses([...mergedDocs.values()].map(mapResponseDoc))
      .filter((response) => response.surveyId === survey.id)
      .sort((first, second) => {
        const firstTime =
          first.submittedAt instanceof Timestamp ? first.submittedAt.toMillis() : 0;
        const secondTime =
          second.submittedAt instanceof Timestamp ? second.submittedAt.toMillis() : 0;

        return secondTime - firstTime;
      });
  }

  const directResponses = await fetchResponsesBySurveyId(survey.id);

  if (directResponses.length > 0 || !isDeletedSurvey(survey)) {
    return directResponses;
  }

  return fetchResponsesBySurveyTitle(survey.title ?? '');
}

export async function fetchResponseCountForSurvey(survey) {
  return Math.max(0, Number(survey?.responseCount) || 0);
}

export async function fetchAllResponsesForSurveyExport(survey) {
  ensureFirestoreReady();

  if (!survey?.id) {
    return [];
  }

  const direct = await fetchResponsesBySurveyId(survey.id);

  if (direct.length > 0) {
    return direct;
  }

  return fetchResponsesBySurveyTitle(survey.title ?? '');
}

export async function hydrateSurveyResponseCounts(surveys = []) {
  const normalizedSurveys = Array.isArray(surveys) ? surveys : [];
  return normalizedSurveys.map((survey) => ({
    ...survey,
    responseCount: Math.max(0, Number(survey?.responseCount) || 0),
  }));
}

export async function updateResponseProcessing(responseId, { adminNote }) {
  ensureFirestoreReady();

  await updateDoc(doc(db, 'responses', responseId), {
    adminNote: typeof adminNote === 'string' ? adminNote.trim() : '',
    updatedAt: getIsoTimestamp(),
  });
}

export async function updateResponseStatus(responseId, status, updatedBy = {}) {
  ensureFirestoreReady();
  const now = getIsoTimestamp();
  const updater =
    typeof updatedBy?.email === 'string' && updatedBy.email.trim()
      ? updatedBy.email.trim()
      : typeof updatedBy?.uid === 'string' && updatedBy.uid.trim()
        ? updatedBy.uid.trim()
        : '';

  const updates = {
    status: normalizeResponseStatus(status),
    statusUpdatedAt: now,
    updatedAt: now,
  };

  if (updater) {
    updates.statusUpdatedBy = updater;
  }

  await updateDoc(doc(db, 'responses', responseId), updates);
}

export async function deleteSurveyResponse(responseId, deletedBy = {}) {
  ensureFirestoreReady();
  const responseRef = doc(db, 'responses', responseId);
  const auditLogRef = doc(auditLogsCollection);
  const deletedByMeta = {
    uid: String(deletedBy?.uid ?? ''),
    email: String(deletedBy?.email ?? ''),
    displayName: String(deletedBy?.displayName ?? deletedBy?.name ?? ''),
  };

  await runTransaction(db, async (transaction) => {
    const responseSnapshot = await transaction.get(responseRef);

    if (!responseSnapshot.exists()) {
      const error = new Error('삭제할 응답을 찾을 수 없습니다.');
      error.code = 'not-found';
      throw error;
    }

    const response = mapResponseDoc(responseSnapshot);

    if (response.deleted) {
      return;
    }

    const surveyId = String(response.surveyId ?? '').trim();
    const surveyRef = surveyId ? doc(db, 'surveys', surveyId) : null;
    const surveySnapshot = surveyRef ? await transaction.get(surveyRef) : null;
    const quotaCountsRef = surveyId ? doc(db, 'surveys', surveyId, 'quotaCounts', 'main') : null;
    const quotaConfigRef = surveyId ? doc(db, 'surveys', surveyId, 'quotaConfig', 'main') : null;
    const quotaConfigSnapshot = quotaConfigRef ? await transaction.get(quotaConfigRef) : null;
    const quotaCountsSnapshot = quotaCountsRef ? await transaction.get(quotaCountsRef) : null;
    let nextOptionQuotaCounts = null;
    let nextResponseCount = null;
    let nextQuotaCounts = null;

    if (surveySnapshot?.exists()) {
      const survey = mapSurveyDoc(surveySnapshot);
      nextOptionQuotaCounts = { ...normalizeOptionQuotaCounts(survey.optionQuotaCounts) };

      (response.answers ?? []).forEach((answerItem) => {
        const matchedQuestion = (survey.questions ?? []).find(
          (question) => question.id === answerItem.questionId,
        );

        if (!matchedQuestion || !isOptionQuotaQuestion(matchedQuestion)) {
          return;
        }

        const selectedValues = getSelectedQuotaValues(answerItem.answer)
          .filter((selectedValue) => matchedQuestion.options.includes(selectedValue));

        if (selectedValues.length === 0) {
          return;
        }

        nextOptionQuotaCounts = decrementOptionQuotaCounts(
          nextOptionQuotaCounts,
          matchedQuestion.id,
          selectedValues,
        );
      });

      nextResponseCount = Math.max(0, Number(survey.responseCount ?? 0) - 1);
    }

    if (quotaCountsSnapshot?.exists() && response.quota?.regionId && response.quota?.ageGroupId) {
      const quotaConfig = normalizeRegionAgeQuotaConfig(
        quotaConfigSnapshot?.exists()
          ? quotaConfigSnapshot.data()
          : createDefaultRegionAgeQuotaConfig(),
      );
      const quotaCounts = normalizeQuotaCounts(quotaCountsSnapshot.data(), quotaConfig);
      const regionId = String(response.quota.regionId);
      const ageGroupId = String(response.quota.ageGroupId);
      const currentCellCount = normalizeQuotaNumber(quotaCounts.cells?.[regionId]?.[ageGroupId], 0);

      nextQuotaCounts = {
        ...quotaCounts,
        total: Math.max(0, normalizeQuotaNumber(quotaCounts.total, 0) - 1),
        cells: {
          ...quotaCounts.cells,
          [regionId]: {
            ...(quotaCounts.cells?.[regionId] ?? {}),
            [ageGroupId]: Math.max(0, currentCellCount - 1),
          },
        },
      };
    }

    transaction.update(responseRef, {
      deleted: true,
      hiddenFromDefaultList: true,
      deletedAt: serverTimestamp(),
      deletedBy: deletedByMeta,
      updatedAt: getIsoTimestamp(),
    });

    if (surveyRef && surveySnapshot?.exists()) {
      transaction.update(surveyRef, {
        responseCount: nextResponseCount,
        optionQuotaCounts: nextOptionQuotaCounts,
        updatedAt: serverTimestamp(),
      });
    }

    if (quotaCountsRef && nextQuotaCounts) {
      transaction.set(quotaCountsRef, {
        ...nextQuotaCounts,
        updatedAt: serverTimestamp(),
      });
    }

    transaction.set(auditLogRef, {
      action: 'response_delete',
      surveyId,
      responseId: String(responseId),
      actor: deletedByMeta,
      deletedBy: deletedByMeta,
      deletedAt: serverTimestamp(),
      metadata: {},
      createdAt: serverTimestamp(),
    });
  });
}

/**
 * 응답의 개인정보 질문 답변을 "[익명처리됨]"으로 덮어씁니다.
 * status, submittedAt, slot 집계 등 통계 관련 필드는 건드리지 않습니다.
 * Firestore rule: allow update if isAtLeastAdmin() — 관리자 전용.
 *
 * @param {string} responseId - 대상 응답 문서 ID
 * @param {string[]} targetQuestionIds - 익명 처리할 질문 ID 목록
 * @param {{ uid?: string, email?: string }} currentUser - 실행한 관리자 정보
 */
/**
 * 응답 문서의 개인정보를 "[익명처리됨]"으로 덮어씁니다.
 *
 * 처리 대상:
 *   - answers[].answer (targetQuestionIds에 해당하는 항목)
 *   - respondentName, respondentPhone (top-level 단축 필드)
 *   - respondent.applicantName, .applicantPhone, .applicantBirthDate
 *   - respondent.applicantKey (phone:xxx 또는 name-birth:xxx 형식의 식별키)
 *
 * 유지 대상 (통계/운영):
 *   - status, submittedAt, surveyId, adminNote
 *   - respondent.slotSelections, .clientSubmitId, .submittedFrom, .applicantKeyLabel
 *   - selectedSlotLabel
 */
export async function anonymizeResponsePii(responseId, targetQuestionIds = [], currentUser = {}) {
  ensureFirestoreReady();

  if (!responseId) {
    throw new Error('응답 ID가 없습니다.');
  }

  if (!Array.isArray(targetQuestionIds) || targetQuestionIds.length === 0) {
    throw new Error('익명 처리할 질문이 없습니다.');
  }

  const responseRef = doc(db, 'responses', responseId);
  const snapshot = await getDoc(responseRef);

  if (!snapshot.exists()) {
    throw new Error('응답을 찾을 수 없습니다.');
  }

  const data = snapshot.data();

  // 1. answers 배열: 대상 질문 답변만 교체
  const answers = Array.isArray(data.answers) ? data.answers : [];
  const targetIdSet = new Set(targetQuestionIds);
  const updatedAnswers = answers.map((answerItem) => {
    if (!targetIdSet.has(answerItem?.questionId)) {
      return answerItem;
    }
    return { ...answerItem, answer: '[익명처리됨]' };
  });

  // 2. respondent 객체: PII 필드만 교체, 슬롯·UUID 등 유지
  const existingRespondent = (typeof data.respondent === 'object' && data.respondent !== null)
    ? data.respondent
    : {};
  const updatedRespondent = {
    ...existingRespondent,
    applicantName: existingRespondent.applicantName ? '[익명처리됨]' : existingRespondent.applicantName,
    applicantPhone: existingRespondent.applicantPhone ? '[익명처리됨]' : existingRespondent.applicantPhone,
    applicantBirthDate: existingRespondent.applicantBirthDate ? '[익명처리됨]' : existingRespondent.applicantBirthDate,
    // applicantKey는 "phone:010-..." 또는 "name-birth:홍길동::..." 형식으로 원본 PII 포함
    applicantKey: existingRespondent.applicantKey ? '[익명처리됨]' : existingRespondent.applicantKey,
    // applicantKeyLabel("연락처 기준" 등), slotSelections, clientSubmitId, submittedFrom 유지
  };

  await updateDoc(responseRef, {
    answers: updatedAnswers,
    // top-level 단축 필드 (RecentResponsesPage 등에서 직접 읽음)
    respondentName: data.respondentName ? '[익명처리됨]' : (data.respondentName ?? ''),
    respondentPhone: data.respondentPhone ? '[익명처리됨]' : (data.respondentPhone ?? ''),
    respondent: updatedRespondent,
    anonymizedAt: serverTimestamp(),
    anonymizedBy: {
      uid: String(currentUser?.uid ?? ''),
      email: String(currentUser?.email ?? ''),
    },
  });
}

export async function fetchDraftResponse({ userId, surveyId }) {
  ensureFirestoreReady();

  if (!userId || !surveyId) {
    return null;
  }

  const snapshot = await getDoc(doc(db, 'draftResponses', buildDraftResponseId(userId, surveyId)));

  return snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null;
}

export async function saveDraftResponse({
  userId,
  surveyId,
  answers = {},
  lastQuestionId = '',
  responseMode = 'single',
  visibleQuestionIds = [],
  visibleSectionIds = [],
}) {
  ensureFirestoreReady();

  if (!userId || !surveyId) {
    return;
  }

  const draftRef = doc(draftResponsesCollection, buildDraftResponseId(userId, surveyId));
  const existingSnapshot = await getDoc(draftRef);

  await setDoc(
    draftRef,
    {
      userId,
      surveyId,
      answers,
      lastQuestionId,
      responseMode: responseMode === 'paged' ? 'paged' : 'single',
      visibleQuestionIds: Array.isArray(visibleQuestionIds) ? visibleQuestionIds : [],
      visibleSectionIds: Array.isArray(visibleSectionIds) ? visibleSectionIds : [],
      createdAt: existingSnapshot.exists() ? existingSnapshot.data().createdAt : getIsoTimestamp(),
      updatedAt: getIsoTimestamp(),
    },
    { merge: true },
  );
}

export async function deleteDraftResponse({ userId, surveyId }) {
  ensureFirestoreReady();

  if (!userId || !surveyId) {
    return;
  }

  await deleteDoc(doc(db, 'draftResponses', buildDraftResponseId(userId, surveyId)));
}

export function formatFirestoreDate(value) {
  if (value instanceof Timestamp) {
    return value.toDate().toLocaleString('ko-KR');
  }

  return '시간 정보 없음';
}

export function formatSurveyAnswer(answer, question = null) {
  if (question && isScaleQuestionType(question.questionType ?? question.type)) {
    const formattedScaleAnswer = formatScaleAnswer(answer, question);

    if (formattedScaleAnswer) {
      return formattedScaleAnswer;
    }
  }

  if (Array.isArray(answer)) {
    return answer.length > 0 ? answer.join(', ') : '응답 없음';
  }

  if (typeof answer === 'boolean') {
    return answer ? '동의함' : '미동의';
  }

  return answer || '응답 없음';
}

function normalizePhoneNumber(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits : '';
}

function normalizeApplicantName(value) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeApplicantBirthDate(value) {
  return String(value ?? '').trim();
}

// 32비트 다항 해시 (출력 공간 ~4.3B). lock document ID 생성 전용 — 암호학적 안전성 불필요.
// 충돌 시 정상 신청자를 중복으로 오탐할 수 있음. 신청자 수 증가(수만 명) 시 SHA-256 마이그레이션 검토.
// 주의: 알고리즘 변경 시 기존 lock 문서 ID가 달라져 진행 중인 폼 잠금이 무효화됨 — 폼 종료 후 마이그레이션 필요.
function hashString(value) {
  return String(value ?? '').split('').reduce((hash, character) => {
    const nextHash = (hash * 31 + character.charCodeAt(0)) >>> 0;
    return nextHash;
  }, 7).toString(36);
}

function buildApplicantLockDocumentId(applicantKey) {
  return hashString(applicantKey);
}

function buildApplicationSlotLockDocumentId(questionId, slotValue, applicantKey) {
  return `${questionId}__${hashString(`${slotValue}::${applicantKey}`)}`;
}

function buildClientSubmitLockDocumentId(clientSubmitId) {
  return sanitizeDocumentId(clientSubmitId);
}

function buildClientSubmitResponseDocumentId(surveyId, clientSubmitId) {
  return `${sanitizeDocumentId(surveyId)}__${sanitizeDocumentId(clientSubmitId)}`;
}

function sanitizeDocumentId(value) {
  const sanitizedValue = String(value ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
  return sanitizedValue || createLocalId('doc');
}

export function extractApplicantIdentity(questions = [], answers = []) {
  const answerItems = getOrderedResponseAnswerItems(questions, answers);

  const findByType = (type) =>
    answerItems.find((item) => normalizeQuestionType(item.questionType) === type);
  const findByTitle = (patterns) =>
    answerItems.find((item) =>
      patterns.some((pattern) =>
        String(item.questionTitle ?? '').toLowerCase().includes(pattern),
      ),
    );

  const nameAnswer =
    findByTitle(['이름', '성명', 'name']) ??
    answerItems.find(
      (item) => normalizeQuestionType(item.questionType) === QUESTION_TYPES.SHORT_TEXT,
    );
  const phoneAnswer =
    findByType(QUESTION_TYPES.PHONE) ??
    findByTitle(['연락처', '전화', '휴대폰', 'phone']);
  const birthAnswer =
    findByTitle(['생년월일', 'birth', '생일']) ??
    answerItems.find(
      (item) =>
        normalizeQuestionType(item.questionType) === QUESTION_TYPES.DATE &&
        String(item.questionTitle ?? '').includes('생'),
    );

  const name = String(nameAnswer?.answer ?? '').trim();
  const phone = normalizePhoneNumber(phoneAnswer?.answer);
  const birthDate = normalizeApplicantBirthDate(birthAnswer?.answer);

  let applicantKey = '';
  let applicantKeyLabel = '';

  if (phone) {
    applicantKey = `phone:${phone}`;
    applicantKeyLabel = '연락처 기준';
  } else if (name && birthDate) {
    applicantKey = `name-birth:${normalizeApplicantName(name)}::${birthDate}`;
    applicantKeyLabel = '이름+생년월일 기준';
  }

  return {
    key: applicantKey,
    keyLabel: applicantKeyLabel,
    name,
    phone,
    birthDate,
  };
}

export function extractSlotSelections(questions = [], answers = [], optionQuotaCounts = {}) {
  const normalizedQuestions = normalizeQuestions(questions);
  const answerItems = getOrderedResponseAnswerItems(normalizedQuestions, answers);

  return answerItems.reduce((result, answerItem) => {
    const matchedQuestion = normalizedQuestions.find((question) => question.id === answerItem.questionId);

    if (!matchedQuestion || matchedQuestion.type !== QUESTION_TYPES.APPLICATION_SLOT_CHOICE) {
      return result;
    }

    const selectedValue = typeof answerItem.answer === 'string' ? answerItem.answer.trim() : '';

    if (!selectedValue) {
      return result;
    }

    const optionItem = getQuestionOptionItems(matchedQuestion, optionQuotaCounts).find(
      (option) => option.value === selectedValue,
    );

    result.push({
      questionId: matchedQuestion.id,
      questionTitle: matchedQuestion.title,
      slotValue: selectedValue,
      slotLabel: optionItem?.title || optionItem?.label || selectedValue,
    });

    return result;
  }, []);
}

export function getOrderedResponseAnswerItems(questions = [], answers = []) {
  const normalizedQuestionItems = normalizeQuestions(questions);

  const questionMap = new Map(
    normalizedQuestionItems.map((question, index) => [
      question.id,
      {
        ...question,
        index,
      },
    ]),
  );

  const normalizedAnswers = Array.isArray(answers) ? answers : [];
  const consumedIds = new Set();
  const items = [];

  normalizedQuestionItems.forEach((question, index) => {
    if (isNonResponseQuestionType(question.type)) {
      return;
    }

    const matchedAnswer = normalizedAnswers.find((answer) => answer?.questionId === question.id);

    if (matchedAnswer) {
      consumedIds.add(matchedAnswer.questionId);
      items.push({
        questionId: question.id,
        questionType: question.type,
        questionTitle: question.title,
        questionDescription: question.description,
        questionSettings: question.settings ?? {},
        questionMeta: question.meta ?? {},
        answer: matchedAnswer.answer,
        order: index,
      });
      return;
    }

    items.push({
      questionId: question.id,
      questionType: question.type,
      questionTitle: question.title,
      questionDescription: question.description,
      questionSettings: question.settings ?? {},
      questionMeta: question.meta ?? {},
      answer: '',
      order: index,
    });
  });

  normalizedAnswers.forEach((answer, index) => {
    if (answer?.questionId && consumedIds.has(answer.questionId)) {
      return;
    }

    const matchedQuestion = answer?.questionId ? questionMap.get(answer.questionId) : null;

    if (matchedQuestion && isNonResponseQuestionType(matchedQuestion.type)) {
      return;
    }

    items.push({
      questionId: answer?.questionId ?? `legacy-answer-${index + 1}`,
      questionType: matchedQuestion?.type ?? answer?.questionType ?? QUESTION_TYPES.SHORT_TEXT,
      questionTitle: matchedQuestion?.title ?? answer?.questionTitle ?? `질문 ${index + 1}`,
      questionDescription:
        matchedQuestion?.description ?? answer?.questionDescription ?? '',
      questionSettings: matchedQuestion?.settings ?? answer?.questionSettings ?? {},
      questionMeta: matchedQuestion?.meta ?? answer?.questionMeta ?? {},
      answer: answer?.answer,
      order: matchedQuestion?.index ?? questions.length + index,
    });
  });

  return items.sort((first, second) => first.order - second.order);
}

export function extractApplicationResponseSummary(questions = [], response = {}) {
  const answerItems = getOrderedResponseAnswerItems(questions, response.answers);

  const findByType = (type) =>
    answerItems.find((item) => normalizeQuestionType(item.questionType) === type);
  const findByTitle = (patterns) =>
    answerItems.find((item) =>
      patterns.some((pattern) => String(item.questionTitle ?? '').toLowerCase().includes(pattern)),
    );

  const nameAnswer =
    findByTitle(['이름', '성명', 'name']) ??
    answerItems.find((item) => normalizeQuestionType(item.questionType) === QUESTION_TYPES.SHORT_TEXT);
  const phoneAnswer =
    findByType(QUESTION_TYPES.PHONE) ?? findByTitle(['연락처', '전화', '휴대폰', 'phone']);
  const primaryAnswer =
    answerItems.find((item) =>
      [
        QUESTION_TYPES.SINGLE_CHOICE,
        QUESTION_TYPES.DROPDOWN,
        QUESTION_TYPES.MULTIPLE_CHOICE,
        QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
      ].includes(normalizeQuestionType(item.questionType)),
    ) ?? answerItems[0];

  return {
    answerItems,
    name: formatSurveyAnswer(nameAnswer?.answer),
    phone: formatSurveyAnswer(phoneAnswer?.answer),
    primaryValue: formatSurveyAnswer(primaryAnswer?.answer),
  };
}

function normalizeComparableValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? '').trim());
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return String(value ?? '').trim();
}

export function evaluateBranchCondition(condition, answersByQuestionId = {}) {
  const answer = answersByQuestionId[condition.questionId];
  const normalizedAnswer = normalizeComparableValue(answer);
  const normalizedValue = normalizeComparableValue(condition.value);

  switch (normalizeConditionOperator(condition.operator)) {
    case CONDITION_OPERATORS.NOT_EQUALS:
      return Array.isArray(normalizedAnswer)
        ? !normalizedAnswer.includes(String(normalizedValue))
        : normalizedAnswer !== normalizedValue;
    case CONDITION_OPERATORS.INCLUDES:
      return Array.isArray(normalizedAnswer)
        ? normalizedAnswer.includes(String(normalizedValue))
        : String(normalizedAnswer).includes(String(normalizedValue));
    case CONDITION_OPERATORS.NOT_INCLUDES:
      return Array.isArray(normalizedAnswer)
        ? !normalizedAnswer.includes(String(normalizedValue))
        : !String(normalizedAnswer).includes(String(normalizedValue));
    case CONDITION_OPERATORS.IS_EMPTY:
      return Array.isArray(normalizedAnswer)
        ? normalizedAnswer.length === 0
        : !String(normalizedAnswer ?? '').trim();
    case CONDITION_OPERATORS.IS_NOT_EMPTY:
      return Array.isArray(normalizedAnswer)
        ? normalizedAnswer.length > 0
        : Boolean(String(normalizedAnswer ?? '').trim());
    case CONDITION_OPERATORS.EQUALS:
    default:
      return Array.isArray(normalizedAnswer)
        ? normalizedAnswer.includes(String(normalizedValue))
        : normalizedAnswer === normalizedValue;
  }
}

export function evaluateConditionGroup(
  conditions = [],
  combinator = CONDITION_COMBINATORS.AND,
  answersByQuestionId = {},
) {
  if (!Array.isArray(conditions) || conditions.length === 0) {
    return true;
  }

  const results = conditions.map((condition) =>
    evaluateBranchCondition(condition, answersByQuestionId),
  );

  return normalizeConditionCombinator(combinator) === CONDITION_COMBINATORS.OR
    ? results.some(Boolean)
    : results.every(Boolean);
}

function getAnswerForBranching(question, rawAnswer) {
  if (question.type === QUESTION_TYPES.MULTIPLE_CHOICE) {
    return Array.isArray(rawAnswer) ? rawAnswer : [];
  }

  return rawAnswer ?? '';
}

function normalizeRuntimeBranchAction(action) {
  if (action === 'goToQuestion' || action === 'go_to_question' || action === 'goTo') {
    return BRANCH_ACTIONS.GO_TO;
  }

  return normalizeBranchAction(action);
}

function getCompatibleOptionBranch(question = {}, answer) {
  const branchSources = [
    question.optionBranches,
    question.optionBranching,
    question.branches,
  ].filter(Boolean);
  const answerValues = Array.isArray(answer) ? answer : [answer];

  for (const source of branchSources) {
    if (Array.isArray(source)) {
      const matchedBranch = source.find((branch) => {
        const branchOption =
          branch?.whenOption ?? branch?.option ?? branch?.value ?? branch?.optionValue ?? '';
        return answerValues.includes(branchOption);
      });

      if (matchedBranch) {
        return matchedBranch;
      }
    } else if (source && typeof source === 'object') {
      const matchedKey = answerValues.find((value) => source[value]);

      if (matchedKey) {
        return source[matchedKey];
      }
    }
  }

  const optionItems = Array.isArray(question.options) ? question.options : [];

  if (optionItems.some((option) => option && typeof option === 'object')) {
    return optionItems.find((option) => {
      const optionValue = option?.value ?? option?.label ?? option?.title ?? '';
      return answerValues.includes(optionValue);
    });
  }

  return null;
}

function getBranchTargetQuestionId(branch = {}) {
  return (
    branch.targetQuestionId ??
    branch.nextQuestionId ??
    branch.targetId ??
    branch.questionId ??
    ''
  );
}

function getQuestionBranchOutcome(question, answer) {
  const compatibleBranch = getCompatibleOptionBranch(question, answer);

  if (compatibleBranch) {
    const action = normalizeRuntimeBranchAction(
      compatibleBranch.branchAction ?? compatibleBranch.action,
    );
    const targetQuestionId = getBranchTargetQuestionId(compatibleBranch);

    if (action === BRANCH_ACTIONS.END || targetQuestionId) {
      return {
        action: action === BRANCH_ACTIONS.END ? BRANCH_ACTIONS.END : BRANCH_ACTIONS.GO_TO,
        targetQuestionId,
      };
    }
  }

  if (!question?.branching?.enabled) {
    return {
      action: BRANCH_ACTIONS.NEXT,
      targetQuestionId: '',
    };
  }

  const branchRules = Array.isArray(question.branching.rules) ? question.branching.rules : [];
  const matchedRule = branchRules.find((rule) => {
    if (Array.isArray(answer)) {
      return answer.includes(rule.whenOption);
    }

    return answer === rule.whenOption;
  });

  if (matchedRule) {
    return {
      action: normalizeRuntimeBranchAction(matchedRule.action),
      targetQuestionId: matchedRule.targetQuestionId ?? '',
    };
  }

  return {
    action: normalizeRuntimeBranchAction(question.branching.fallbackAction),
    targetQuestionId: question.branching.fallbackTargetQuestionId ?? '',
  };
}

function buildBranchTargetGroups(questions = []) {
  return questions.reduce((result, question) => {
    const targetIds = new Set();

    (question.branching?.rules ?? []).forEach((rule) => {
      if (normalizeRuntimeBranchAction(rule.action) === BRANCH_ACTIONS.GO_TO && rule.targetQuestionId) {
        targetIds.add(rule.targetQuestionId);
      }
    });

    if (question.branching?.fallbackTargetQuestionId) {
      targetIds.add(question.branching.fallbackTargetQuestionId);
    }

    [question.optionBranches, question.optionBranching, question.branches].forEach((source) => {
      if (Array.isArray(source)) {
        source.forEach((branch) => {
          const targetQuestionId = getBranchTargetQuestionId(branch);
          if (targetQuestionId) {
            targetIds.add(targetQuestionId);
          }
        });
      } else if (source && typeof source === 'object') {
        Object.values(source).forEach((branch) => {
          const targetQuestionId = getBranchTargetQuestionId(branch);
          if (targetQuestionId) {
            targetIds.add(targetQuestionId);
          }
        });
      }
    });

    (question.options ?? []).forEach((option) => {
      if (option && typeof option === 'object') {
        const targetQuestionId = getBranchTargetQuestionId(option);
        if (targetQuestionId) {
          targetIds.add(targetQuestionId);
        }
      }
    });

    if (targetIds.size > 0) {
      result.set(question.id, targetIds);
    }

    return result;
  }, new Map());
}

export function computeBranchingProgress({
  survey,
  answersByQuestionId = {},
}) {
  const normalizedQuestions = alignQuestionsToSections(survey?.questions ?? [], survey?.sections ?? []);
  const normalizedSections = normalizeSurveySections(survey?.sections ?? [], normalizedQuestions);
  const visibleSections = normalizedSections.filter((section) =>
    evaluateConditionGroup(
      section.visibilityConditions,
      section.visibilityCombinator,
      answersByQuestionId,
    ),
  );

  const questionsBySectionId = new Map(
    visibleSections.map((section) => [
      section.id,
      normalizedQuestions.filter((question) => question.sectionId === section.id),
    ]),
  );

  const flattenedQuestions = visibleSections.flatMap((section) =>
    questionsBySectionId.get(section.id) ?? [],
  );
  const questionMap = new Map(flattenedQuestions.map((question) => [question.id, question]));
  const branchTargetGroups = buildBranchTargetGroups(flattenedQuestions);
  const branchSourceByTargetId = new Map();

  branchTargetGroups.forEach((targetIds, sourceQuestionId) => {
    targetIds.forEach((targetQuestionId) => {
      if (!branchSourceByTargetId.has(targetQuestionId)) {
        branchSourceByTargetId.set(targetQuestionId, sourceQuestionId);
      }
    });
  });

  const orderedVisibleQuestions = [];
  const groupedSections = [];
  const visitedQuestionIds = new Set();
  let termination = null;
  let activeBranchSourceId = '';

  if (flattenedQuestions.length === 0) {
    return {
      visibleSections,
      groupedSections: [],
      visibleQuestions: [],
      termination: null,
    };
  }

  let currentQuestion = flattenedQuestions[0];

  while (currentQuestion && !visitedQuestionIds.has(currentQuestion.id)) {
    const currentQuestionIndex = flattenedQuestions.findIndex(
      (item) => item.id === currentQuestion.id,
    );
    const currentSection = visibleSections.find((section) => section.id === currentQuestion.sectionId);
    const currentSectionQuestions = questionsBySectionId.get(currentQuestion.sectionId) ?? [];
    const currentSectionQuestionIndex = currentSectionQuestions.findIndex(
      (item) => item.id === currentQuestion.id,
    );
    const isLastQuestionInSection =
      currentSectionQuestionIndex >= 0 &&
      currentSectionQuestionIndex === currentSectionQuestions.length - 1;
    let fallbackNextQuestion = flattenedQuestions[currentQuestionIndex + 1];
    const currentBranchSourceId = branchSourceByTargetId.get(currentQuestion.id);

    if (activeBranchSourceId && currentBranchSourceId === activeBranchSourceId) {
      const activeTargetIds = branchTargetGroups.get(activeBranchSourceId) ?? new Set();
      let nextIndex = currentQuestionIndex + 1;

      while (
        nextIndex < flattenedQuestions.length &&
        activeTargetIds.has(flattenedQuestions[nextIndex]?.id)
      ) {
        nextIndex += 1;
      }

      fallbackNextQuestion = flattenedQuestions[nextIndex];
    }

    if (
      currentSection?.terminationEnabled &&
      evaluateConditionGroup(
        currentSection.terminationConditions,
        currentSection.terminationCombinator,
        answersByQuestionId,
      )
    ) {
      termination = {
        sectionId: currentSection.id,
        message: currentSection.terminationMessage || '조건에 따라 응답이 종료되었습니다.',
      };
      break;
    }

    visitedQuestionIds.add(currentQuestion.id);
    orderedVisibleQuestions.push(currentQuestion);

    const currentAnswer = getAnswerForBranching(
      currentQuestion,
      answersByQuestionId[currentQuestion.id],
    );

    if (isNonResponseQuestionType(currentQuestion.type)) {
      currentQuestion = fallbackNextQuestion;
      continue;
    }

    if (isAnswerEmpty({ ...currentQuestion, required: true }, currentAnswer)) {
      if (
        currentQuestion.branching?.enabled ||
        branchTargetGroups.has(currentQuestion.id) ||
        (activeBranchSourceId && currentBranchSourceId === activeBranchSourceId)
      ) {
        currentQuestion = null;
        continue;
      }

      currentQuestion = fallbackNextQuestion;
      continue;
    }

    const branchOutcome = getQuestionBranchOutcome(currentQuestion, currentAnswer);

    if (branchOutcome.action === BRANCH_ACTIONS.END) {
      termination = {
        sectionId: currentQuestion.sectionId,
        message: currentQuestion.description || '조건에 따라 응답이 종료되었습니다.',
      };
      break;
    }

    if (
      branchOutcome.action === BRANCH_ACTIONS.GO_TO &&
      branchOutcome.targetQuestionId &&
      questionMap.has(branchOutcome.targetQuestionId)
    ) {
      activeBranchSourceId = currentQuestion.id;
      currentQuestion = questionMap.get(branchOutcome.targetQuestionId);
      continue;
    }

    if (!currentBranchSourceId || currentBranchSourceId !== activeBranchSourceId) {
      activeBranchSourceId = '';
    }

    if (isLastQuestionInSection && currentSection) {
      const pageEndAction = currentSection.pageEndAction ?? 'next';

      if (pageEndAction === 'submit' && !fallbackNextQuestion) {
        currentQuestion = null;
        continue;
      }

      if (pageEndAction === 'end') {
        termination = {
          sectionId: currentSection.id,
          message: currentSection.terminationMessage || '여기서 응답이 종료되었습니다.',
        };
        break;
      }

      if (
        pageEndAction === 'go_to_section' &&
        currentSection.pageEndTargetSectionId &&
        currentSection.pageEndTargetSectionId !== currentSection.id
      ) {
        const targetSectionQuestions =
          questionsBySectionId.get(currentSection.pageEndTargetSectionId) ?? [];

        if (targetSectionQuestions[0]) {
          currentQuestion = targetSectionQuestions[0];
          continue;
        }
      }
    }

    currentQuestion = fallbackNextQuestion;
  }

  visibleSections.forEach((section) => {
    const sectionQuestions = orderedVisibleQuestions.filter(
      (question) => question.sectionId === section.id,
    );

    if (sectionQuestions.length > 0) {
      groupedSections.push({
        ...section,
        questions: sectionQuestions,
      });
    }
  });

  return {
    visibleSections,
    groupedSections,
    visibleQuestions: orderedVisibleQuestions,
    termination,
  };
}

export function getFirestoreErrorMessage(error, fallbackMessage) {
  const errorCode = error?.code ?? '';
  const rawMessage = error?.message ?? '';

  if (errorCode === 'permission-denied' || rawMessage.includes('Missing or insufficient permissions')) {
    return '이 작업을 할 권한이 없습니다. 계정 권한과 Firestore 규칙을 확인해주세요.';
  }

  if (errorCode === 'failed-precondition') {
    return 'Firestore 인덱스가 필요합니다. firestore.indexes.json 배포 상태를 확인해주세요.';
  }

  return fallbackMessage;
}
