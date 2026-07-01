import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, getFirebaseStatusMessage, isFirebaseConfigured } from './config';
import {
  alignQuestionsToSections,
  normalizeSurveyConfiguration,
  normalizeSurveySections,
  sanitizeSurveyQuestions,
  sanitizeSurveySections,
} from './surveys';
import { createQuestionId, createSectionId } from './surveyNormalize';
import { logger } from '../utils/logger';

const surveyTemplatesCollection = db ? collection(db, 'survey_templates') : null;

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

  if (error && typeof error === 'object') {
    error.firestorePath = path;
  }

  logger.error('[Firestore permission-denied]', {
    path,
    code: error?.code ?? '',
    message: error?.message ?? '',
  });
}

export const SURVEY_TEMPLATE_CATEGORIES = [
  '만족도 조사',
  '욕구 조사',
  '신청·접수',
  '주민 의견',
  '교육·사업',
  '기타',
];

function ensureFirestoreReady() {
  if (!isFirebaseConfigured || !db) {
    throw new Error(getFirebaseStatusMessage() || 'Firestore가 아직 설정되지 않았습니다.');
  }
}

function getActorMeta(actor = {}) {
  return {
    uid: String(actor?.uid ?? ''),
    email: String(actor?.email ?? ''),
    displayName: String(actor?.displayName ?? actor?.name ?? ''),
  };
}

function cloneSerializable(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function mapTemplateDoc(snapshot) {
  const data = snapshot.data();
  return {
    id: snapshot.id,
    ...data,
    name: String(data.name ?? ''),
    description: String(data.description ?? ''),
    category: String(data.category ?? '기타'),
    usageCount: Math.max(0, Number(data.usageCount ?? 0)),
    active: data.active !== false,
  };
}

function getTimestampMillis(value) {
  if (typeof value?.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : 0;
}

export function buildSurveyTemplateData(survey = {}) {
  const normalizedSections = normalizeSurveySections(survey.sections, survey.questions);
  const normalizedQuestions = alignQuestionsToSections(
    sanitizeSurveyQuestions(survey.questions ?? [], { strict: false }),
    normalizedSections,
  );
  const validSections = sanitizeSurveySections(normalizedSections, normalizedQuestions);
  const configuration = normalizeSurveyConfiguration(survey);

  return cloneSerializable({
    description: String(survey.description ?? ''),
    descriptionFormat: String(survey.descriptionFormat ?? 'markdown'),
    tableBlocks: Array.isArray(survey.tableBlocks) ? survey.tableBlocks : [],
    sections: validSections,
    questions: normalizedQuestions,
    formType: configuration.formType,
    branchingEnabled: configuration.branchingEnabled,
    quotaEnabled: configuration.quotaEnabled,
    maxResponses: configuration.maxResponses,
    duplicateCheckEnabled: configuration.duplicateCheckEnabled,
    slotDuplicateCheckEnabled: configuration.slotDuplicateCheckEnabled,
    oneSlotPerPersonEnabled: configuration.oneSlotPerPersonEnabled,
    applicantListView: configuration.applicantListView,
    processingStatusEnabled: configuration.processingStatusEnabled,
    opensAt: configuration.opensAt,
    closesAt: configuration.closesAt,
    applicationGuide: configuration.applicationGuide,
    scheduleSummary: configuration.scheduleSummary,
    cautionText: configuration.cautionText,
    allowResponseEdit: configuration.allowResponseEdit,
    completionMessage: configuration.completionMessage,
    adminNotificationEnabled: configuration.adminNotificationEnabled,
  });
}

function remapStructureIds(value, idMap) {
  if (Array.isArray(value)) {
    return value.map((item) => remapStructureIds(item, idMap));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, remapStructureIds(item, idMap)]),
    );
  }

  if (typeof value === 'string' && idMap.has(value)) {
    return idMap.get(value);
  }

  return value;
}

export function instantiateSurveyTemplate(template = {}) {
  const surveyData = cloneSerializable(template.surveyData ?? {}) ?? {};
  const sourceSections = Array.isArray(surveyData.sections) ? surveyData.sections : [];
  const sourceQuestions = Array.isArray(surveyData.questions) ? surveyData.questions : [];
  const idMap = new Map();

  sourceSections.forEach((section) => {
    if (section?.id) idMap.set(section.id, createSectionId());
  });
  sourceQuestions.forEach((question) => {
    if (question?.id) idMap.set(question.id, createQuestionId());
  });

  const remappedData = remapStructureIds(surveyData, idMap);
  const normalizedSections = normalizeSurveySections(
    remappedData.sections,
    remappedData.questions,
  );
  const normalizedQuestions = alignQuestionsToSections(
    sanitizeSurveyQuestions(remappedData.questions ?? [], { strict: false }),
    normalizedSections,
  );
  const validSections = sanitizeSurveySections(normalizedSections, normalizedQuestions);
  const configuration = normalizeSurveyConfiguration(remappedData);

  return {
    description: String(remappedData.description ?? ''),
    descriptionFormat: String(remappedData.descriptionFormat ?? 'markdown'),
    tableBlocks: Array.isArray(remappedData.tableBlocks) ? remappedData.tableBlocks : [],
    sections: validSections,
    questions: normalizedQuestions,
    ...configuration,
    opensAt: String(remappedData.opensAt ?? ''),
    closesAt: String(remappedData.closesAt ?? ''),
    applicationGuide: String(remappedData.applicationGuide ?? ''),
    scheduleSummary: String(remappedData.scheduleSummary ?? ''),
    cautionText: String(remappedData.cautionText ?? ''),
    allowResponseEdit: Boolean(remappedData.allowResponseEdit),
    completionMessage: String(remappedData.completionMessage ?? ''),
    adminNotificationEnabled: Boolean(remappedData.adminNotificationEnabled),
  };
}

export async function fetchSurveyTemplates({ includeInactive = false } = {}) {
  ensureFirestoreReady();
  let snapshot;

  try {
    snapshot = includeInactive
      ? await getDocs(surveyTemplatesCollection)
      : await getDocs(query(surveyTemplatesCollection, where('active', '==', true)));
  } catch (error) {
    logFirestoreReadDenied(
      includeInactive ? 'survey_templates' : 'survey_templates?active==true',
      error,
    );
    throw error;
  }

  return snapshot.docs
    .map(mapTemplateDoc)
    .filter((template) => includeInactive || template.active)
    .sort((first, second) => getTimestampMillis(second.updatedAt) - getTimestampMillis(first.updatedAt));
}

export async function fetchSurveyTemplateById(templateId) {
  ensureFirestoreReady();
  const normalizedTemplateId = String(templateId ?? '').trim();
  if (!normalizedTemplateId) return null;

  let snapshot;

  try {
    snapshot = await getDoc(doc(surveyTemplatesCollection, normalizedTemplateId));
  } catch (error) {
    logFirestoreReadDenied(`survey_templates/${normalizedTemplateId}`, error);
    throw error;
  }

  return snapshot.exists() ? mapTemplateDoc(snapshot) : null;
}

export async function createSurveyTemplate({
  name,
  description = '',
  category = '기타',
  survey,
  sourceSurveyId = '',
  copiedFromTemplateId = '',
  actor = {},
}) {
  ensureFirestoreReady();
  const actorMeta = getActorMeta(actor);
  const payload = {
    name: String(name ?? '').trim(),
    description: String(description ?? '').trim(),
    category: String(category ?? '기타').trim() || '기타',
    surveyData: buildSurveyTemplateData(survey),
    sourceSurveyId: String(sourceSurveyId ?? '').trim(),
    usageCount: 0,
    active: true,
    createdBy: actorMeta,
    updatedBy: actorMeta,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  if (copiedFromTemplateId) {
    payload.copiedFromTemplateId = String(copiedFromTemplateId);
  }

  if (!payload.name) {
    throw new Error('템플릿명을 입력해주세요.');
  }

  const created = await addDoc(surveyTemplatesCollection, payload);
  return { id: created.id, ...payload };
}

export async function updateSurveyTemplate(templateId, updates = {}, actor = {}) {
  ensureFirestoreReady();
  const templateRef = doc(surveyTemplatesCollection, String(templateId ?? '').trim());
  const payload = {
    name: String(updates.name ?? '').trim(),
    description: String(updates.description ?? '').trim(),
    category: String(updates.category ?? '기타').trim() || '기타',
    updatedBy: getActorMeta(actor),
    updatedAt: serverTimestamp(),
  };

  if (!payload.name) {
    throw new Error('템플릿명을 입력해주세요.');
  }

  await updateDoc(templateRef, payload);
}

export async function copySurveyTemplate(template, actor = {}) {
  if (!template?.id) {
    throw new Error('복제할 템플릿을 찾을 수 없습니다.');
  }

  return createSurveyTemplate({
    name: `(복사본) ${template.name || '설문 템플릿'}`,
    description: template.description ?? '',
    category: template.category ?? '기타',
    survey: template.surveyData ?? {},
    sourceSurveyId: template.sourceSurveyId ?? '',
    copiedFromTemplateId: template.id,
    actor,
  });
}

export async function disableSurveyTemplate(templateId, actor = {}) {
  ensureFirestoreReady();
  await updateDoc(doc(surveyTemplatesCollection, String(templateId ?? '').trim()), {
    active: false,
    updatedBy: getActorMeta(actor),
    updatedAt: serverTimestamp(),
  });
}

export async function incrementSurveyTemplateUsage(templateId) {
  ensureFirestoreReady();
  const templateRef = doc(surveyTemplatesCollection, String(templateId ?? '').trim());

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(templateRef);
    if (!snapshot.exists() || snapshot.data().active === false) {
      throw new Error('사용할 수 있는 템플릿을 찾을 수 없습니다.');
    }

    transaction.update(templateRef, {
      usageCount: Math.max(0, Number(snapshot.data().usageCount ?? 0)) + 1,
    });
  });
}
