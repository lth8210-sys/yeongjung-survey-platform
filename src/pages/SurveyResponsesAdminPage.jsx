import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ConfirmModal from '../components/ConfirmModal';
import QrModal from '../components/QrModal';
import { useAuth } from '../contexts/AuthContext';
import {
  anonymizeResponsePii,
  createAuditLog,
  detectPrivacyQuestions,
  changeSurveyStatus,
  deleteSurvey,
  deleteSurveyResponse,
  duplicateSurvey,
  extractApplicationResponseSummary,
  extractSlotSelections,
  fetchAllResponsesForSurveyExport,
  fetchResponseCountForSurvey,
  fetchResponsesBySurveyId,
  fetchResponsesForSurvey,
  fetchSurveyById,
  FORM_TYPES,
  formatFirestoreDate,
  formatSurveyAnswer,
  getClosedSurveyMessage,
  getDeletedSurveyResponseMeta,
  getDraftSurveyMessage,
  getFormTypeMeta,
  getFirestoreErrorMessage,
  getQuestionOptionItems,
  getOrderedResponseAnswerItems,
  getQuotaSummary,
  buildAgeQuotaDashboard,
  getResponseStatusMeta,
  getSurveyStatusMeta,
  isApplicationFormType,
  isDeletedSurvey,
  isNonResponseQuestionType,
  isOptionQuotaQuestion,
  isScaleQuestionType,
  normalizeSurveyStatus,
  QUESTION_TYPES,
  RESPONSE_STATUSES,
  SURVEY_STATUSES,
  updateResponseProcessing,
  updateResponseStatus,
} from '../firebase/surveys';
import { buildQuestionDisplayMap } from '../utils/questionNumbering';
import { buildSurveyAnalytics, formatAverage } from '../utils/surveyAnalytics';
import {
  maskAnswerByQuestion,
  maskName,
  maskPhone,
  maskResponsesForDownload,
} from '../utils/privacy';
import { sanitizeRow } from '../utils/csvSafeCell';
import { logger } from '../utils/logger';

const RESPONSE_PAGE_SIZE = 20;
const RESIDENT_ASSET_TEMPLATE_ID = 'resident_asset_interview_v1';
const RESIDENT_ASSET_SUMMARY_FIELDS = [
  { key: 'meeting_date', label: '만난 날짜' },
  { key: 'meeting_place', label: '만난 장소' },
  { key: 'contact_type', label: '접점유형' },
  { key: 'resident_name', label: '이름/닉네임' },
  { key: 'age_group', label: '연령대' },
  { key: 'frequent_location', label: '자주 있는 곳' },
  { key: 'strengths', label: '잘하는 것' },
  { key: 'shareable_assets', label: '나눌 수 있는 자산' },
  { key: 'desired_activity', label: '함께 하고 싶은 활동' },
  { key: 'role_preference', label: '역할 선호도' },
  { key: 'recommended_activity', label: '추천 활동/모임' },
  { key: 'follow_up_date', label: '후속예정일' },
  { key: 'staff', label: '담당자' },
];
const SHAREABLE_ASSET_KEYS = [
  'shareable_time',
  'shareable_items',
  'shareable_space',
  'shareable_info',
];
const FILTER_RESPONSE_STATUSES = [
  RESPONSE_STATUSES.SUBMITTED,
  RESPONSE_STATUSES.IN_REVIEW,
  RESPONSE_STATUSES.APPROVED,
  RESPONSE_STATUSES.COMPLETED,
  RESPONSE_STATUSES.REJECTED,
  RESPONSE_STATUSES.CANCELLED,
  RESPONSE_STATUSES.FOLLOW_UP,
];

const SHARE_TYPES = {
  PROGRESS: 'progress',
  SHORTAGE: 'shortage',
  SUMMARY: 'summary',
  TEAM: 'team',
  PROMOTION: 'promotion',
  REPORT: 'report',
};

const SHARE_TYPE_LABELS = {
  [SHARE_TYPES.PROGRESS]: '진행현황 공유',
  [SHARE_TYPES.SUMMARY]: '결과요약 공유',
  [SHARE_TYPES.TEAM]: '팀 공유',
  [SHARE_TYPES.PROMOTION]: '홍보용 공유',
  [SHARE_TYPES.REPORT]: '보고서 요약',
  [SHARE_TYPES.SHORTAGE]: '부족표본 공유',
};

const SHARE_TEMPLATE_TYPES = {
  GENERAL: 'general',
  SATISFACTION: 'satisfaction',
  NEEDS: 'needs',
  APPLICATION: 'application',
};

const SHARE_COPY_TEMPLATES = {
  [SHARE_TEMPLATE_TYPES.GENERAL]: {
    progressTitle: '📊 영중폼 설문 진행현황',
    summaryTitle: '📊 설문 결과 요약',
    reportTitle: '📄 결과보고서 공유 안내',
    shortageTitle: '⚠️ 부족 현황',
    shortageHeading: '부족 TOP 5',
    shortageEmptyText: '부족한 항목이 없습니다.',
    shortageCta: '필요한 대상에게 공유해 주세요.',
    countLabel: '응답수',
    actionNoun: '응답',
    participantNoun: '참여',
    askVerb: '참여',
    totalCountLabel: '총 응답수',
    resultEmptyText: '주요 객관식/평균 문항 집계가 아직 없습니다.',
    textResponseNote: '서술형 의견은 결과보고서 참고',
    reportReadyText: '결과보고서가 생성되었습니다.',
    teamRequestText: '아직 참여하지 않은 대상자가 있다면 조사기간 내 참여를 부탁드립니다.',
    promotionLeadText: '설문에 참여해주세요.',
    promotionTimeText: '3분 정도 소요됩니다.',
    promotionClosingText: '많은 참여 부탁드립니다.',
    resultOrder: 'choice-first',
  },
  [SHARE_TEMPLATE_TYPES.SATISFACTION]: {
    progressTitle: '📊 영중폼 만족도조사 진행현황',
    summaryTitle: '📊 만족도조사 결과 요약',
    reportTitle: '📄 만족도조사 결과보고서 공유 안내',
    shortageTitle: '⚠️ 부족 현황',
    shortageHeading: '부족 TOP 5',
    shortageEmptyText: '부족한 항목이 없습니다.',
    shortageCta: '필요한 대상에게 공유해 주세요.',
    countLabel: '응답수',
    actionNoun: '응답',
    participantNoun: '참여',
    askVerb: '참여',
    totalCountLabel: '총 응답수',
    resultEmptyText: '만족도 평균 또는 주요 응답 집계가 아직 없습니다.',
    textResponseNote: '서술형 의견은 결과보고서 참고',
    reportReadyText: '만족도조사 결과보고서가 생성되었습니다.',
    teamRequestText: '아직 참여하지 않은 이용자가 있다면 조사기간 내 참여를 부탁드립니다.',
    promotionLeadText: '만족도 조사에 참여해주세요.',
    promotionTimeText: '3분 정도 소요됩니다.',
    promotionClosingText: '많은 참여 부탁드립니다.',
    resultOrder: 'average-first',
  },
  [SHARE_TEMPLATE_TYPES.NEEDS]: {
    progressTitle: '📊 영중폼 욕구조사 진행현황',
    summaryTitle: '📊 욕구조사 결과 요약',
    reportTitle: '📄 욕구조사 결과보고서 공유 안내',
    shortageTitle: '⚠️ 할당표본 부족 현황',
    shortageHeading: '부족표본 TOP 5',
    shortageEmptyText: '부족한 할당표본 셀이 없습니다.',
    shortageCta: '부족 연령대 중심으로 적극 홍보 부탁드립니다.',
    countLabel: '응답수',
    actionNoun: '응답',
    participantNoun: '참여',
    askVerb: '참여',
    totalCountLabel: '총 응답수',
    resultEmptyText: '주요 욕구 문항 집계가 아직 없습니다.',
    textResponseNote: '서술형 의견은 결과보고서 참고',
    reportReadyText: '욕구조사 결과보고서가 생성되었습니다.',
    teamRequestText: '아직 참여하지 않은 지역주민이 있다면 조사기간 내 참여를 부탁드립니다.',
    promotionLeadText: '지역주민 욕구조사에 참여해주세요.',
    promotionTimeText: '5분 정도 소요됩니다.',
    promotionClosingText: '많은 참여 부탁드립니다.',
    resultOrder: 'choice-first',
  },
  [SHARE_TEMPLATE_TYPES.APPLICATION]: {
    progressTitle: '📊 영중폼 신청 현황',
    summaryTitle: '📊 신청 결과 요약',
    reportTitle: '📄 신청 결과 공유 안내',
    shortageTitle: '⚠️ 정원 부족 현황',
    shortageHeading: '부족 TOP 5',
    shortageEmptyText: '부족한 정원 항목이 없습니다.',
    shortageCta: '추가 모집이 필요한 대상에게 공유해 주세요.',
    countLabel: '신청수',
    actionNoun: '신청',
    participantNoun: '신청',
    askVerb: '신청',
    totalCountLabel: '총 신청수',
    resultEmptyText: '주요 신청 항목 집계가 아직 없습니다.',
    textResponseNote: '상세 신청 내용은 결과보고서 참고',
    reportReadyText: '신청 결과 요약이 생성되었습니다.',
    teamRequestText: '신청이 필요한 대상자가 있다면 기간 내 신청 안내를 부탁드립니다.',
    promotionLeadText: '신청을 받고 있습니다.',
    promotionTimeText: '간단한 정보 입력 후 신청할 수 있습니다.',
    promotionClosingText: '많은 신청 부탁드립니다.',
    resultOrder: 'choice-first',
  },
};

function includesKeyword(value, keywords) {
  const normalizedValue = String(value ?? '').toLowerCase();
  return keywords.some((keyword) => normalizedValue.includes(keyword));
}

function getShareTemplateType(survey, analytics) {
  const metadataValues = [
    survey?.surveyType,
    survey?.surveyCategory,
    survey?.category,
    survey?.templateCategory,
    survey?.templateType,
    survey?.templateId,
    survey?.defaultFormType,
    survey?.title,
    ...(Array.isArray(survey?.tags) ? survey.tags : []),
  ];

  if (
    metadataValues.some((value) =>
      includesKeyword(value, ['needs_survey', 'needs-survey', 'community_needs', '욕구조사', '욕구 조사']),
    )
  ) {
    return SHARE_TEMPLATE_TYPES.NEEDS;
  }

  if (isApplicationFormType(survey?.formType)) {
    return SHARE_TEMPLATE_TYPES.APPLICATION;
  }

  if (
    metadataValues.some((value) =>
      includesKeyword(value, ['satisfaction', '만족도', '만족도조사', '만족도 조사']),
    ) ||
    (analytics?.topRows ?? []).some((row) => row.average !== null)
  ) {
    return SHARE_TEMPLATE_TYPES.SATISFACTION;
  }

  return SHARE_TEMPLATE_TYPES.GENERAL;
}

function getShareCopyTemplate(survey, analytics) {
  const templateType = getShareTemplateType(survey, analytics);
  return SHARE_COPY_TEMPLATES[templateType] ?? SHARE_COPY_TEMPLATES[SHARE_TEMPLATE_TYPES.GENERAL];
}

function buildAdminUrl(path) {
  if (typeof window === 'undefined') {
    return path;
  }

  return `${window.location.origin}${path}`;
}

function getPositiveNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function getShareTarget(survey, quotaSummary, quotaDashboard) {
  const current = Number(quotaSummary?.responseCount ?? survey?.responseCount ?? 0);
  const quotaEnabled = Boolean(survey?.quotaConfig?.enabled);

  if (quotaEnabled && quotaDashboard?.targetTotal > 0) {
    return {
      hasTarget: true,
      type: 'quota',
      current: quotaDashboard.currentTotal,
      target: quotaDashboard.targetTotal,
      percent: quotaDashboard.percent,
    };
  }

  const target = getPositiveNumber(survey?.maxResponses ?? quotaSummary?.maxResponses);
  return {
    hasTarget: target > 0,
    type: target > 0 ? 'maxResponses' : 'unlimited',
    current,
    target,
    percent: target > 0 ? Math.round((current / target) * 100) : 0,
  };
}

function getShareRemainder(target) {
  return target.hasTarget ? Math.max(0, target.target - target.current) : null;
}

function formatShareCount(template, target, responseCount) {
  if (!target.hasTarget) {
    return `${template.countLabel}: ${responseCount}명`;
  }

  if (template.actionNoun === '신청') {
    return `신청: ${target.current} / ${target.target}명`;
  }

  return `${template.countLabel}: ${target.current} / ${target.target}`;
}

function formatShareLimitLine(template, target) {
  if (!target.hasTarget) {
    return '정원: 제한 없음';
  }

  const remainder = getShareRemainder(target);

  if (template.actionNoun === '신청') {
    return `잔여: ${remainder}명`;
  }

  return `정원: 최대 ${target.target}명`;
}

function getAverageOverview(analytics) {
  const rows = (analytics?.topRows ?? []).filter((row) => row.average !== null);

  if (rows.length === 0) {
    return '';
  }

  const firstMax = rows[0]?.max;
  const sameMax = rows.every((row) => row.max === firstMax);
  const average = rows.reduce((sum, row) => sum + row.average, 0) / rows.length;
  return sameMax
    ? `평균 만족도: ${formatAverage(average)} / ${firstMax}`
    : `평균 만족도: ${formatAverage(average)}`;
}

function getTopChoiceSummaries(survey, responses, limit = 3) {
  const optionQuestionTypes = new Set([
    QUESTION_TYPES.SINGLE_CHOICE,
    QUESTION_TYPES.MULTIPLE_CHOICE,
    QUESTION_TYPES.DROPDOWN,
  ]);
  const questions = (survey?.questions ?? []).filter((question) =>
    optionQuestionTypes.has(question.type),
  );
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const rows = new Map();

  responses.forEach((response) => {
    (response.answers ?? []).forEach((answerItem) => {
      const question = questionMap.get(answerItem.questionId);
      if (!question) return;

      const answers = Array.isArray(answerItem.answer)
        ? answerItem.answer
        : [answerItem.answer];

      answers
        .map((answer) => String(answer ?? '').trim())
        .filter(Boolean)
        .forEach((answer) => {
          const key = `${question.id}::${answer}`;
          const current = rows.get(key) ?? {
            questionTitle: question.title || '객관식 문항',
            answer,
            count: 0,
          };
          current.count += 1;
          rows.set(key, current);
        });
    });
  });

  return [...rows.values()]
    .sort((first, second) => second.count - first.count)
    .slice(0, limit)
    .map((row) => `${row.questionTitle}: ${row.answer} (${row.count}명)`);
}

function buildShareText({
  type,
  survey,
  responses,
  analytics,
  quotaSummary,
  quotaDashboard,
  responseUrl,
  reportUrl,
}) {
  const title = survey?.title || '제목 없는 설문';
  const shareTemplate = getShareCopyTemplate(survey, analytics);
  const shareTemplateType = getShareTemplateType(survey, analytics);
  const responseCount = Number(quotaSummary?.responseCount ?? responses.length ?? 0);
  const target = getShareTarget(survey, quotaSummary, quotaDashboard);
  const countLine = formatShareCount(shareTemplate, target, responseCount);
  const limitLine = formatShareLimitLine(shareTemplate, target);
  const averageOverview = getAverageOverview(analytics);

  if (type === SHARE_TYPES.SHORTAGE) {
    const shortageLines = (quotaDashboard?.shortageTop ?? [])
      .slice(0, 5)
      .map((row, index) =>
        `${index + 1}. ${row.ageGroupLabel}: ${row.current}/${row.target}, ${row.shortage}명 부족`,
      );

    return [
      shareTemplate.shortageTitle,
      '',
      `설문명: ${title}`,
      '현재 확보 현황',
      countLine,
      target.hasTarget ? `진행률: ${target.percent}%` : limitLine,
      '',
      shareTemplate.shortageHeading,
      ...(shortageLines.length > 0 ? shortageLines : [shareTemplate.shortageEmptyText]),
      '',
      shareTemplate.shortageCta,
    ].join('\n');
  }

  if (type === SHARE_TYPES.SUMMARY) {
    if (responseCount === 0) {
      return [
        shareTemplate.summaryTitle,
        '',
        `설문명: ${title}`,
        '',
        '응답 데이터가 아직 없습니다.',
      ].join('\n');
    }

    const choiceSummaries = getTopChoiceSummaries(survey, responses, 3);
    const averageSummaries = (analytics?.topRows ?? [])
      .filter((row) => row.average !== null)
      .slice(0, 3)
      .map((row) => `${row.question.title}: 평균 ${formatAverage(row.average)} / ${row.max}`);
    const prioritizedRows =
      shareTemplate.resultOrder === 'average-first'
        ? [...averageSummaries, ...choiceSummaries]
        : [...choiceSummaries, ...averageSummaries];
    const resultLines = prioritizedRows.slice(0, 5);
    const summaryHeaderLines =
      shareTemplate.resultOrder === 'average-first'
        ? [
            averageOverview || '평균 만족도: 집계 준비 중',
            `${shareTemplate.totalCountLabel}: ${responseCount}명`,
          ]
        : shareTemplate.actionNoun === '신청'
          ? [
              `${shareTemplate.totalCountLabel}: ${responseCount}명`,
              limitLine,
            ]
          : shareTemplateType === SHARE_TEMPLATE_TYPES.NEEDS
            ? [
                `${shareTemplate.totalCountLabel}: ${responseCount}명`,
                target.hasTarget ? `진행률: ${target.percent}%` : null,
              ].filter(Boolean)
            : [`${shareTemplate.totalCountLabel}: ${responseCount}명`];

    return [
      shareTemplate.summaryTitle,
      '',
      `설문명: ${title}`,
      ...summaryHeaderLines,
      '',
      shareTemplateType === SHARE_TEMPLATE_TYPES.NEEDS
        ? '주요 욕구:'
        : shareTemplate.actionNoun === '신청'
          ? '대표 신청 항목:'
          : '대표 결과:',
      ...(resultLines.length > 0
        ? resultLines.map((line) => `- ${line}`)
        : [`- ${shareTemplate.resultEmptyText}`]),
      `- ${shareTemplate.textResponseNote}`,
    ].join('\n');
  }

  if (type === SHARE_TYPES.REPORT) {
    return [
      `${shareTemplate.reportTitle}: ${title}은 현재 ${responseCount}명의 ${shareTemplate.actionNoun} 데이터가 집계되었습니다. 주요 결과와 상세 의견은 결과보고서에서 확인할 수 있습니다. 관리자 결과 화면: ${reportUrl || responseUrl}`,
    ].join('\n');
  }

  if (type === SHARE_TYPES.TEAM) {
    const targetStatus = target.hasTarget
      ? `현재 ${target.current} / ${target.target}명이 ${shareTemplate.participantNoun}했습니다.`
      : `현재 ${responseCount}명이 ${shareTemplate.participantNoun}했습니다.`;

    return [
      `[${title}]`,
      '',
      targetStatus,
      target.hasTarget && shareTemplate.actionNoun === '신청' ? `잔여 ${getShareRemainder(target)}명입니다.` : null,
      '',
      shareTemplate.teamRequestText,
      '',
      '감사합니다.',
    ].filter(Boolean).join('\n');
  }

  if (type === SHARE_TYPES.PROMOTION) {
    return [
      shareTemplate.actionNoun === '신청'
        ? `${title} ${shareTemplate.promotionLeadText}`
        : `${title}에 ${shareTemplate.askVerb}해주세요.`,
      '',
      shareTemplate.promotionTimeText,
      '',
      shareTemplate.promotionClosingText,
    ].join('\n');
  }

  const progressLines =
    shareTemplate.actionNoun === '신청'
      ? [
          countLine,
          target.hasTarget ? `잔여 ${getShareRemainder(target)}명` : '정원: 제한 없음',
        ]
      : [
          countLine,
          target.hasTarget && target.type === 'quota' ? `진행률: ${target.percent}%` : limitLine,
        ];

  return [
    shareTemplate.progressTitle,
    '',
    `설문명: ${title}`,
    ...progressLines,
    '',
    '관리자 결과 화면:',
    responseUrl,
  ].join('\n');
}

function toValidDate(value) {
  if (!value) {
    return null;
  }

  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateInputValue(date) {
  if (!date) {
    return '';
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function getResponseDateBounds(responses) {
  const dates = responses
    .map((response) => toValidDate(response.submittedAt))
    .filter(Boolean);

  if (!dates.length) {
    return { startDate: '', endDate: '' };
  }

  return {
    startDate: formatDateInputValue(new Date(Math.min(...dates.map((date) => date.getTime())))),
    endDate: formatDateInputValue(new Date(Math.max(...dates.map((date) => date.getTime())))),
  };
}

function buildReportSettingsDefaults({ survey, responses, user }) {
  const { startDate, endDate } = getResponseDateBounds(responses);

  return {
    title: survey?.title ? `${survey.title} 결과보고서` : '결과보고서',
    startDate,
    endDate,
    target: '해당 설문 응답자',
    department: '영중종합사회복지관',
    writtenDate: formatDateInputValue(new Date()),
    author: user?.displayName ?? '',
  };
}

function getReportPeriodLabel({ startDate, endDate }) {
  if (startDate && endDate) {
    return startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
  }

  return startDate || endDate || '';
}

function getReportAuditMetadata(settings, survey) {
  return {
    surveyTitle: survey?.title ?? '',
    reportTitle: String(settings?.title ?? '').trim(),
    reportPeriod: getReportPeriodLabel(settings ?? {}),
    target: String(settings?.target ?? '').trim(),
    department: String(settings?.department ?? '').trim(),
  };
}

function ReportSettingsModal({ isOpen, values, onChange, onClose, onSubmit }) {
  if (!isOpen) {
    return null;
  }

  const updateField = (field) => (event) => {
    onChange({
      ...values,
      [field]: event.target.value,
    });
  };

  return (
    <div className="modal-backdrop report-settings-backdrop" onClick={onClose} role="presentation">
      <form
        className="modal-panel report-settings-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-settings-title"
      >
        <div className="report-settings-header">
          <div>
            <h2 id="report-settings-title">결과보고서 생성 설정</h2>
            <p>보고서 표지와 조사 개요에 표시될 기본 정보를 확인해주세요.</p>
          </div>
          <button className="icon-button" onClick={onClose} type="button" aria-label="닫기">
            ×
          </button>
        </div>

        <div className="report-settings-grid">
          <label className="field-row report-settings-full">
            <span>보고서 제목</span>
            <input
              onChange={updateField('title')}
              placeholder="보고서 제목"
              type="text"
              value={values.title}
            />
          </label>

          <div className="report-settings-date-row">
            <label className="field-row">
              <span>조사 시작일</span>
              <input onChange={updateField('startDate')} type="date" value={values.startDate} />
            </label>
            <label className="field-row">
              <span>조사 종료일</span>
              <input onChange={updateField('endDate')} type="date" value={values.endDate} />
            </label>
          </div>

          <label className="field-row report-settings-full">
            <span>조사대상</span>
            <input
              onChange={updateField('target')}
              placeholder="조사대상"
              type="text"
              value={values.target}
            />
          </label>

          <label className="field-row">
            <span>작성부서</span>
            <input
              onChange={updateField('department')}
              placeholder="작성부서"
              type="text"
              value={values.department}
            />
          </label>

          <label className="field-row">
            <span>작성일</span>
            <input onChange={updateField('writtenDate')} type="date" value={values.writtenDate} />
          </label>

          <label className="field-row report-settings-full">
            <span>작성자</span>
            <input
              onChange={updateField('author')}
              placeholder="작성자"
              type="text"
              value={values.author}
            />
          </label>
        </div>

        <div className="report-settings-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            취소
          </button>
          <button className="primary-button" type="submit">
            보고서 열기
          </button>
        </div>
      </form>
    </div>
  );
}

function buildResidentAssetSummaryRows(responses) {
  return responses.map((response) => {
    const answerByKey = new Map();

    response.answerItems.forEach((item) => {
      const analyticsKey = item.questionMeta?.analyticsKey;

      if (!analyticsKey) {
        return;
      }

      answerByKey.set(analyticsKey, formatSurveyAnswer(item.answer, item));
    });

    const shareableAssets = SHAREABLE_ASSET_KEYS.map((key) => answerByKey.get(key))
      .filter((value) => value && value !== '-')
      .join(' / ');

    return {
      id: response.id,
      submittedAt: response.submittedAt,
      values: {
        meeting_date: answerByKey.get('meeting_date') ?? '-',
        meeting_place: answerByKey.get('meeting_place') ?? '-',
        contact_type: answerByKey.get('contact_type') ?? '-',
        resident_name: answerByKey.get('resident_name') ?? '-',
        age_group: answerByKey.get('age_group') ?? '-',
        frequent_location: answerByKey.get('frequent_location') ?? '-',
        strengths: answerByKey.get('strengths') ?? '-',
        shareable_assets: shareableAssets || '-',
        desired_activity: answerByKey.get('desired_activity') ?? '-',
        role_preference: answerByKey.get('role_preference') ?? '-',
        recommended_activity: answerByKey.get('recommended_activity') ?? '-',
        follow_up_date: answerByKey.get('follow_up_date') ?? '-',
        staff: answerByKey.get('staff') ?? '-',
      },
    };
  });
}

function escapeCsvValue(value) {
  const normalizedValue = String(value ?? '');
  const escapedValue = normalizedValue.replaceAll('"', '""');
  return `"${escapedValue}"`;
}

function downloadCsv(filename, rows) {
  const csvContent = rows
    .map((row) => sanitizeRow(row).map((value) => escapeCsvValue(value)).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csvContent}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function SurveyResponsesAdminPage() {
  const navigate = useNavigate();
  const {
    user,
    role,
    canDownloadResponses,
    canDeleteResponses,
    canManageUsers,
    canEditSurvey,
    canViewSurveyResponses,
    canChangeSurveyStatus,
    isSurveyOwner,
  } = useAuth();
  const { surveyId } = useParams();
  const [survey, setSurvey] = useState(null);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [viewMode, setViewMode] = useState('raw');
  const [activeTab, setActiveTab] = useState('responses');
  const [editingStates, setEditingStates] = useState({});
  const [selectedSlotFilter, setSelectedSlotFilter] = useState(null);
  const [missingSurveyNotice, setMissingSurveyNotice] = useState('');
  const [pendingDownload, setPendingDownload] = useState(null);
  const [pendingAnonymize, setPendingAnonymize] = useState(null);
  const [pendingDeleteResponse, setPendingDeleteResponse] = useState(null);
  const [responseLastDoc, setResponseLastDoc] = useState(null);
  const [hasMoreResponses, setHasMoreResponses] = useState(false);
  const [loadingMoreResponses, setLoadingMoreResponses] = useState(false);
  const [responsePageSource, setResponsePageSource] = useState('surveyId');
  const [allResponses, setAllResponses] = useState([]);
  const [analyticsStatus, setAnalyticsStatus] = useState('loading');
  const [freeTextExpanded, setFreeTextExpanded] = useState(false);
  const [showAllQuotaShortages, setShowAllQuotaShortages] = useState(false);
  const [statisticsExcelLoading, setStatisticsExcelLoading] = useState(false);
  const [statisticsExcelMessage, setStatisticsExcelMessage] = useState('');
  const [reportSettingsOpen, setReportSettingsOpen] = useState(false);
  const [reportSettings, setReportSettings] = useState(() =>
    buildReportSettingsDefaults({ survey: null, responses: [], user: null }),
  );
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareType, setShareType] = useState(SHARE_TYPES.PROGRESS);
  const [shareText, setShareText] = useState('');
  const [shareCopyMessage, setShareCopyMessage] = useState('');
  const reportSettingsHistoryPushedRef = useRef(false);
  const auditActor = {
    uid: user?.uid ?? '',
    email: user?.email ?? '',
    displayName: user?.displayName ?? '',
  };

  const loadPageData = async ({ append = false } = {}) => {
    try {
      if (append) {
        setLoadingMoreResponses(true);
      } else {
        setLoading(true);
        setResponseLastDoc(null);
        setHasMoreResponses(false);
        setResponsePageSource('surveyId');
      }
      setError('');
      setMissingSurveyNotice('');
      const surveyResult = await fetchSurveyById(surveyId);

      if (surveyResult && !canViewSurveyResponses(surveyResult)) {
        setError('이 설문의 응답을 조회할 권한이 없습니다.');
        return;
      }

      const responsePage = surveyResult
        ? await fetchResponsesForSurvey(surveyResult, {
            uid: user?.uid ?? '',
            email: user?.email ?? '',
            role,
          }, {
            paginated: true,
            pageSize: RESPONSE_PAGE_SIZE,
            lastDoc: append ? responseLastDoc : null,
            source: append ? responsePageSource : undefined,
          })
        : await fetchResponsesBySurveyId(surveyId, {
            paginated: true,
            pageSize: RESPONSE_PAGE_SIZE,
            lastDoc: append ? responseLastDoc : null,
          });
      const responseResult = responsePage.responses;
      const nextLoadedResponseCount = append
        ? responses.length + responseResult.filter(
            (response) => !responses.some((current) => current.id === response.id),
          ).length
        : responseResult.length;

      if (!surveyResult) {
        if (append && responseResult.length === 0) {
          setResponseLastDoc(responsePage.lastDoc);
          setHasMoreResponses(false);
          return;
        }

        if (!append && responseResult.length === 0) {
          setError('설문 정보와 응답을 찾을 수 없습니다.');
          return;
        }

        const responseOwnerUid = responseResult[0]?.surveyOwnerUid ?? '';
        const responseOwnerEmail = responseResult[0]?.surveyOwnerEmail ?? '';
        const fallbackSurvey = {
          id: surveyId,
          title: responseResult[0]?.surveyTitle || '삭제된 설문',
          description: '',
          formType: responseResult[0]?.surveyType || FORM_TYPES.GENERAL_SURVEY,
          status: SURVEY_STATUSES.DELETED,
          storedStatus: SURVEY_STATUSES.DELETED,
          deleted: true,
          ownerUid: responseOwnerUid,
          ownerEmail: responseOwnerEmail,
          createdBy: {
            uid: responseOwnerUid,
            email: responseOwnerEmail,
          },
          questions: [],
          sections: [],
          optionQuotaCounts: {},
          responseCount: nextLoadedResponseCount,
          processingStatusEnabled: false,
        };

        if (!canViewSurveyResponses(fallbackSurvey)) {
          setError('이 설문의 응답을 조회할 권한이 없습니다.');
          return;
        }

        setSurvey(fallbackSurvey);
        setMissingSurveyNotice('삭제되었거나 찾을 수 없는 설문입니다. 기존 응답 기록만 표시합니다.');
      } else {
        setSurvey({
          ...surveyResult,
          responseCount: Math.max(surveyResult.responseCount ?? 0, nextLoadedResponseCount),
        });
        if (isDeletedSurvey(surveyResult)) {
          setMissingSurveyNotice('삭제된 설문입니다. 기존 응답 기록만 표시합니다.');
        }
      }

      setResponseLastDoc(responsePage.lastDoc);
      setHasMoreResponses(responsePage.hasMore);
      setResponsePageSource(responsePage.source ?? 'surveyId');

      if (!append) {
        const exportSurvey = surveyResult ?? {
          id: surveyId,
          title: responseResult[0]?.surveyTitle ?? '',
        };
        setAnalyticsStatus('loading');
        fetchAllResponsesForSurveyExport(exportSurvey)
          .then((all) => {
            setAllResponses(all);
            setAnalyticsStatus('ready');
          })
          .catch((err) => {
            console.warn('[allResponses] 전체 응답 조회 실패 — 분석/CSV는 로드된 목록 기준으로 표시됩니다.', err);
            setAnalyticsStatus('partial');
          });
      }

      setResponses((current) => {
        if (!append) {
          return responseResult;
        }

        const existingIds = new Set(current.map((response) => response.id));
        return [
          ...current,
          ...responseResult.filter((response) => !existingIds.has(response.id)),
        ];
      });
      setEditingStates((current) => ({
        ...(append ? current : {}),
        ...Object.fromEntries(
          responseResult.map((response) => [
            response.id,
            {
              responseStatus: response.status ?? RESPONSE_STATUSES.SUBMITTED,
              adminNote: response.adminNote ?? '',
            },
          ]),
        ),
      }));
    } catch (loadError) {
      logger.error('[SurveyResponsesAdminPage] load failed', {
        code: loadError?.code,
        message: loadError?.message,
        path: loadError?.firestorePath ?? '',
        role,
        uid: user?.uid,
        email: user?.email,
      });
      setError(
        getFirestoreErrorMessage(
          loadError,
          '응답 목록을 불러오지 못했습니다. Firestore 권한과 설정을 확인해주세요.',
        ),
      );
    } finally {
      if (append) {
        setLoadingMoreResponses(false);
      } else {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadPageData();
  }, [canViewSurveyResponses, role, surveyId, user?.email, user?.uid]);

  useEffect(() => {
    const handlePopState = () => {
      if (!reportSettingsHistoryPushedRef.current) {
        return;
      }

      reportSettingsHistoryPushedRef.current = false;
      setReportSettingsOpen(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!reportSettingsOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleReportSettingsClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [reportSettingsOpen]);

  const handleDuplicate = async () => {
    try {
      setActionLoading(true);
      const duplicatedId = await duplicateSurvey(surveyId, {
        uid: user?.uid ?? '',
        name: user?.displayName ?? '',
        email: user?.email ?? '',
      });
      await loadPageData();
      navigate(`/admin/surveys/${duplicatedId}/edit`);
    } catch (actionError) {
      setError(actionError.message || '설문 복제에 실패했습니다.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      setActionLoading(true);
      const responseCount = survey ? await fetchResponseCountForSurvey(survey) : 0;
      const warningMessage =
        responseCount > 0
          ? `이미 ${responseCount}개의 응답이 있습니다. 정말 삭제하시겠습니까?`
          : '정말 이 설문을 삭제하시겠습니까?';

      if (!window.confirm(warningMessage)) {
        return;
      }

      await deleteSurvey(surveyId, {
        uid: user?.uid ?? '',
        email: user?.email ?? '',
        name: user?.displayName ?? '',
      });
      navigate('/admin');
    } catch (actionError) {
      setError(actionError.message || '설문 삭제에 실패했습니다.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleStatusChange = async (nextStatus) => {
    const previousStatus = survey?.status;

    try {
      setActionLoading(true);
      setSurvey((current) =>
        current
          ? {
              ...current,
              status: normalizeSurveyStatus(nextStatus),
            }
          : current,
      );
      await changeSurveyStatus(surveyId, nextStatus);
      await loadPageData();
    } catch (actionError) {
      setError(actionError.message || '설문 상태 변경에 실패했습니다.');
      setSurvey((current) =>
        current
          ? {
              ...current,
              status: normalizeSurveyStatus(previousStatus),
            }
          : current,
      );
    } finally {
      setActionLoading(false);
    }
  };

  const handleProcessingDraftChange = (responseId, key, value) => {
    setEditingStates((current) => ({
      ...current,
      [responseId]: {
        responseStatus: current[responseId]?.responseStatus ?? RESPONSE_STATUSES.SUBMITTED,
        adminNote: current[responseId]?.adminNote ?? '',
        ...current[responseId],
        [key]: value,
      },
    }));
  };

  const handleResponseStatusChange = async (responseId, nextStatus) => {
    const previousStatus =
      responses.find((response) => response.id === responseId)?.status ?? RESPONSE_STATUSES.SUBMITTED;

    try {
      setActionLoading(true);
      handleProcessingDraftChange(responseId, 'responseStatus', nextStatus);
      await updateResponseStatus(responseId, nextStatus, {
        email: user?.email ?? '',
        uid: user?.uid ?? '',
      });
      setResponses((current) =>
        current.map((response) =>
          response.id === responseId
            ? { ...response, status: nextStatus, applicationStatus: nextStatus }
            : response,
        ),
      );
      createAuditLog({
        action: 'response_status_updated',
        surveyId,
        responseId,
        actor: auditActor,
        metadata: {
          fromStatus: previousStatus,
          toStatus: nextStatus,
        },
      });
    } catch (actionError) {
      setError(actionError.message || '응답 처리 상태 저장에 실패했습니다.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAdminNoteSave = async (responseId) => {
    try {
      setActionLoading(true);
      const draftState = editingStates[responseId] ?? {
        adminNote: '',
      };
      await updateResponseProcessing(responseId, {
        adminNote: draftState.adminNote,
      });
      setResponses((current) =>
        current.map((response) =>
          response.id === responseId
            ? { ...response, adminNote: typeof draftState.adminNote === 'string' ? draftState.adminNote.trim() : '' }
            : response,
        ),
      );
      createAuditLog({
        action: 'response_admin_note_updated',
        surveyId,
        responseId,
        actor: auditActor,
        metadata: {},
      });
    } catch (actionError) {
      setError(actionError.message || '관리 메모 저장에 실패했습니다.');
    } finally {
      setActionLoading(false);
    }
  };

  const handleResponseDelete = async (responseId) => {
    if (!responseId || !canDeleteResponses) {
      return;
    }

    try {
      setActionLoading(true);
      await deleteSurveyResponse(responseId, auditActor);
      setResponses((current) => current.filter((response) => response.id !== responseId));
      setAllResponses((current) => current.filter((response) => response.id !== responseId));
      setEditingStates((current) => {
        const { [responseId]: _removed, ...nextState } = current;
        return nextState;
      });
      setSurvey((current) =>
        current
          ? {
              ...current,
              responseCount: Math.max(0, Number(current.responseCount ?? 0) - 1),
            }
          : current,
      );
    } catch (actionError) {
      setError(actionError.message || '응답 삭제에 실패했습니다.');
    } finally {
      setActionLoading(false);
    }
  };

  // 개인정보 포함 여부를 확인하고, PII 질문이 있으면 다운로드 전 확인 모달을 띄웁니다.
  // canDownloadResponses 권한 게이팅은 UI 조건에서 별도 적용됩니다.
  const withPrivacyCheck = (downloadFn) => {
    const { hasPiiQuestions } = detectPrivacyQuestions(survey?.questions ?? []);
    if (hasPiiQuestions) {
      setPendingDownload(() => downloadFn);
    } else {
      downloadFn();
    }
  };

  const surveyPiiQuestions = detectPrivacyQuestions(survey?.questions ?? []).piiQuestions;
  const surveyHasPii = surveyPiiQuestions.length > 0;
  const piiQuestionIds = useMemo(
    () => new Set(surveyPiiQuestions.map((q) => q.id)),
    [surveyPiiQuestions],
  );
  const shouldMaskDownload =
    !['super_admin', 'admin'].includes(role) && !isSurveyOwner(survey);

  const handleAnonymize = async (responseId) => {
    if (!responseId || !surveyHasPii) return;
    try {
      setActionLoading(true);
      await anonymizeResponsePii(
        responseId,
        surveyPiiQuestions.map((q) => q.id),
        { uid: user?.uid, email: user?.email },
      );
      const targetQuestionIds = new Set(surveyPiiQuestions.map((q) => q.id));
      setResponses((current) =>
        current.map((response) => {
          if (response.id !== responseId) {
            return response;
          }

          return {
            ...response,
            answers: Array.isArray(response.answers)
              ? response.answers.map((answerItem) =>
                  targetQuestionIds.has(answerItem?.questionId)
                    ? { ...answerItem, answer: '[익명처리됨]' }
                    : answerItem,
                )
              : response.answers,
            respondentName: response.respondentName ? '[익명처리됨]' : response.respondentName,
            respondentPhone: response.respondentPhone ? '[익명처리됨]' : response.respondentPhone,
            respondent: response.respondent
              ? {
                  ...response.respondent,
                  applicantName: response.respondent.applicantName ? '[익명처리됨]' : response.respondent.applicantName,
                  applicantPhone: response.respondent.applicantPhone ? '[익명처리됨]' : response.respondent.applicantPhone,
                  applicantBirthDate: response.respondent.applicantBirthDate ? '[익명처리됨]' : response.respondent.applicantBirthDate,
                  applicantKey: response.respondent.applicantKey ? '[익명처리됨]' : response.respondent.applicantKey,
                }
              : response.respondent,
            anonymizedAt: new Date().toISOString(),
          };
        }),
      );
      createAuditLog({
        action: 'response_anonymized',
        surveyId,
        responseId,
        actor: auditActor,
        metadata: {
          anonymizedQuestionCount: surveyPiiQuestions.length,
        },
      });
    } catch (err) {
      console.error('[Anonymize] 익명화 실패:', err?.message);
      throw err;
    } finally {
      setActionLoading(false);
    }
  };

  const handleRawCsvDownload = () => {
    if (!survey) {
      return;
    }

    const exportSource = allResponses.length > 0 ? allResponses : responses;
    const orderedQuestions =
      survey.questions.length > 0
        ? survey.questions.filter((question) => !isNonResponseQuestionType(question.type))
        : exportSource.flatMap((response) =>
            getOrderedResponseAnswerItems(survey.questions, response.answers),
          ).reduce((result, item) => {
            if (!result.some((existing) => existing.id === item.questionId)) {
              result.push({ id: item.questionId, title: item.questionTitle });
            }
            return result;
          }, []);
    const addressQuestionId = survey.questions.find((question) => question.meta?.addressField)?.id ?? '';

    const headerRow = [
      '제출일',
      '응답 ID',
      '처리 상태',
      '관리자 비고',
      '주소',
      '연령대',
      '출생년도',
      '나이',
      '초과응답',
      ...orderedQuestions.map((question) => question.title || question.label || question.id),
    ];

    const dataRows = exportSource.map((response) => {
      const answerItems = getOrderedResponseAnswerItems(survey.questions, response.answers);
      const answerMap = new Map(
        answerItems.map((item) => {
          const formatted = formatSurveyAnswer(item.answer, item);
          const masked =
            shouldMaskDownload && piiQuestionIds.has(item.questionId)
              ? maskAnswerByQuestion(formatted, item.questionTitle, item.questionType)
              : formatted;
          return [item.questionId, masked];
        }),
      );

      return [
        formatFirestoreDate(response.submittedAt),
        response.id,
        getResponseStatusMeta(response.status).label,
        response.adminNote ?? '',
        addressQuestionId ? (answerMap.get(addressQuestionId) ?? '') : '',
        response.quota?.ageGroupLabel ?? '',
        response.quota?.birthYear ?? '',
        response.quota?.age ?? '',
        response.quota?.isOverQuota ? 'Y' : '',
        ...orderedQuestions.map((question) => answerMap.get(question.id) ?? ''),
      ];
    });

    withPrivacyCheck(() => {
      downloadCsv(`${survey.title}-응답원본.csv`, [headerRow, ...dataRows]);
      createAuditLog({
        action: 'responses_csv_downloaded',
        surveyId,
        responseId: null,
        actor: auditActor,
        metadata: {
          downloadType: 'raw',
          totalCount: exportSource.length,
        },
      });
    });
  };

  const handleStatisticsExcelDownload = () => {
    if (!survey) {
      return;
    }

    const exportSource = allResponses.length > 0 ? allResponses : responses;
    withPrivacyCheck(async () => {
      try {
        setStatisticsExcelLoading(true);
        setStatisticsExcelMessage('통계 Excel 파일을 생성하는 중입니다...');
        const { downloadStatisticsExcel } = await import('../utils/statisticsExcel');
        const excelResponses = shouldMaskDownload
          ? maskResponsesForDownload(exportSource, piiQuestionIds)
          : exportSource;
        const result = await downloadStatisticsExcel({
          survey,
          responses: excelResponses,
        });
        setStatisticsExcelMessage(
          `통계 Excel 다운로드가 완료되었습니다. (${Math.max(1, Math.round(result.size / 1024))}KB)`,
        );
        createAuditLog({
          action: 'statistics_excel_downloaded',
          surveyId,
          surveyTitle: survey.title ?? '',
          responseId: null,
          actor: auditActor,
          metadata: {
            surveyId,
            surveyTitle: survey.title ?? '',
            responseCount: exportSource.length,
          },
        });
      } catch (excelError) {
        console.error('[StatisticsExcel] download failed', excelError);
        setStatisticsExcelMessage('통계 Excel 파일 생성에 실패했습니다.');
      } finally {
        setStatisticsExcelLoading(false);
      }
    });
  };

  const handleApplicantCsvDownload = () => {
    if (!survey) {
      return;
    }

    const exportSource = allResponses.length > 0 ? allResponses : responses;
    const rows = [
      ['제출일', '이름', '연락처', '주요 항목', '처리 상태', '비고'],
      ...exportSource.map((response) => {
        const summary = extractApplicationResponseSummary(survey.questions, response);
        return [
          formatFirestoreDate(response.submittedAt),
          shouldMaskDownload ? maskName(summary.name) : summary.name,
          shouldMaskDownload ? maskPhone(summary.phone) : summary.phone,
          summary.primaryValue,
          getResponseStatusMeta(response.status).label,
          response.adminNote ?? '',
        ];
      }),
    ];

    withPrivacyCheck(() => {
      downloadCsv(`${survey.title}-명단형.csv`, rows);
      createAuditLog({
        action: 'responses_csv_downloaded',
        surveyId,
        responseId: null,
        actor: auditActor,
        metadata: {
          downloadType: 'applicant',
          totalCount: exportSource.length,
        },
      });
    });
  };

  const handleSlotCsvDownload = () => {
    if (!survey || !selectedSlotFilter) {
      return;
    }

    const exportSource = allResponses.length > 0 ? allResponses : responses;
    const slotExport = exportSource.filter((response) => {
      const slotSels =
        Array.isArray(response.respondent?.slotSelections) && response.respondent.slotSelections.length > 0
          ? response.respondent.slotSelections
          : extractSlotSelections(survey.questions, response.answers, survey.optionQuotaCounts);
      return slotSels.some(
        (sel) =>
          sel.questionId === selectedSlotFilter.questionId &&
          sel.slotValue === selectedSlotFilter.slotValue,
      );
    });

    const rows = [
      ['제출일', '이름', '연락처', '슬롯', '처리 상태', '비고'],
      ...slotExport.map((response) => {
        const summary = extractApplicationResponseSummary(survey.questions, response);
        return [
          formatFirestoreDate(response.submittedAt),
          shouldMaskDownload ? maskName(summary.name) : summary.name,
          shouldMaskDownload ? maskPhone(summary.phone) : summary.phone,
          selectedSlotFilter.title,
          getResponseStatusMeta(response.status).label,
          response.adminNote ?? '',
        ];
      }),
    ];

    withPrivacyCheck(() => {
      downloadCsv(`${survey.title}-${selectedSlotFilter.title}-명단.csv`, rows);
      createAuditLog({
        action: 'responses_csv_downloaded',
        surveyId,
        responseId: null,
        actor: auditActor,
        metadata: {
          downloadType: 'slot',
          totalCount: slotExport.length,
        },
      });
    });
  };

  const handleAnalyticsRefresh = () => {
    const exportSurvey = survey ?? { id: surveyId, title: '' };
    if (!exportSurvey.id) return;
    setAnalyticsStatus('loading');
    fetchAllResponsesForSurveyExport(exportSurvey)
      .then((all) => {
        setAllResponses(all);
        setAnalyticsStatus('ready');
      })
      .catch((err) => {
        console.warn('[allResponses] 새로고침 실패:', err);
        setAnalyticsStatus('partial');
      });
  };

  const handleReportSettingsOpen = () => {
    const nextSettings = buildReportSettingsDefaults({
      survey,
      responses: analyticsSource,
      user,
    });

    setReportSettings(nextSettings);
    createAuditLog({
      action: 'report_settings_opened',
      surveyId,
      surveyTitle: survey?.title ?? '',
      actor: auditActor,
      metadata: getReportAuditMetadata(nextSettings, survey),
    });
    if (!reportSettingsHistoryPushedRef.current) {
      window.history.pushState(
        { reportSettingsModal: true },
        '',
        `${window.location.pathname}${window.location.search}${window.location.hash}`,
      );
      reportSettingsHistoryPushedRef.current = true;
    }
    setReportSettingsOpen(true);
  };

  const handleReportSettingsClose = () => {
    if (reportSettingsHistoryPushedRef.current) {
      window.history.back();
      return;
    }

    setReportSettingsOpen(false);
  };

  const handleReportOpen = () => {
    const params = new URLSearchParams();
    Object.entries(reportSettings).forEach(([key, value]) => {
      const normalizedValue = String(value ?? '').trim();
      if (normalizedValue) {
        params.set(key, normalizedValue);
      }
    });

    const queryString = params.toString();
    const reportUrl = `/admin/surveys/${surveyId}/report${queryString ? `?${queryString}` : ''}`;
    window.open(reportUrl, '_blank', 'noopener,noreferrer');
    handleReportSettingsClose();
  };

  const isApplicationForm = isApplicationFormType(survey?.formType);

  const responseItems = useMemo(() => {
    if (!survey) {
      return [];
    }

    return responses.map((response) => {
      const answerItems = getOrderedResponseAnswerItems(survey.questions, response.answers);
      const summary = extractApplicationResponseSummary(survey.questions, response);
      const searchableText = [
        response.id,
        summary.name,
        summary.phone,
        summary.primaryValue,
        response.adminNote ?? '',
        ...answerItems.map((item) => `${item.questionTitle} ${formatSurveyAnswer(item.answer, item)}`),
      ]
        .join(' ')
        .toLowerCase();

      return {
        ...response,
        answerItems,
        summary,
        slotSelections:
          Array.isArray(response.respondent?.slotSelections) && response.respondent.slotSelections.length > 0
            ? response.respondent.slotSelections
            : extractSlotSelections(survey.questions, response.answers, survey.optionQuotaCounts),
        searchableText,
        normalizedResponseStatus: response.status ?? RESPONSE_STATUSES.SUBMITTED,
      };
    });
  }, [responses, survey]);

  const filteredResponses = useMemo(() => {
    return responseItems.filter((response) => {
      const matchesSearch =
        !searchTerm.trim() || response.searchableText.includes(searchTerm.trim().toLowerCase());
      const matchesStatus =
        !statusFilter || response.normalizedResponseStatus === statusFilter;
      const matchesSlot =
        !selectedSlotFilter ||
        response.slotSelections.some(
          (slotSelection) =>
            slotSelection.questionId === selectedSlotFilter.questionId &&
            slotSelection.slotValue === selectedSlotFilter.slotValue,
        );

      return matchesSearch && matchesStatus && matchesSlot;
    });
  }, [responseItems, searchTerm, selectedSlotFilter, statusFilter]);

  const visibleResponses = filteredResponses;
  const optionQuotaQuestions = useMemo(() => {
    if (!survey?.questions?.length) {
      return [];
    }

    return survey.questions
      .filter((question) => isOptionQuotaQuestion(question))
      .map((question) => ({
        ...question,
        optionItems: getQuestionOptionItems(question, survey.optionQuotaCounts),
      }));
  }, [survey]);

  const slotQuotaQuestions = useMemo(
    () =>
      optionQuotaQuestions.filter(
        (question) => question.type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE,
      ),
    [optionQuotaQuestions],
  );

  const slotRosterRows = useMemo(() => {
    if (!selectedSlotFilter) {
      return [];
    }

    return filteredResponses.map((response) => ({
      id: response.id,
      submittedAt: response.submittedAt,
      name: response.summary.name,
      phone: response.summary.phone,
      status: response.normalizedResponseStatus,
      adminNote: response.adminNote ?? '',
    }));
  }, [filteredResponses, selectedSlotFilter]);
  const analyticsSource = useMemo(
    () => (allResponses.length > 0 ? allResponses : responses),
    [allResponses, responses],
  );
  const surveyAnalytics = useMemo(
    () => buildSurveyAnalytics(survey, analyticsSource),
    [analyticsSource, survey],
  );
  const questionDisplayMap = useMemo(
    () => buildQuestionDisplayMap(survey?.questions ?? [], survey?.sections ?? []),
    [survey?.questions, survey?.sections],
  );
  const residentAssetSummaryRows = useMemo(
    () =>
      survey?.templateId === RESIDENT_ASSET_TEMPLATE_ID
        ? buildResidentAssetSummaryRows(filteredResponses)
        : [],
    [filteredResponses, survey?.templateId],
  );
  const responseNumberMap = useMemo(() => {
    const totalCount = getQuotaSummary(survey).responseCount ?? responses.length;
    return new Map(responses.map((r, i) => [r.id, totalCount - i]));
  }, [responses, survey]);
  const ageQuotaDashboard = useMemo(
    () => buildAgeQuotaDashboard(survey?.quotaConfig, survey?.quotaCounts),
    [survey?.quotaConfig, survey?.quotaCounts],
  );
  const quotaDashboardEnabled = Boolean(survey?.quotaConfig?.enabled);
  const shareQuotaSummary = useMemo(() => getQuotaSummary(survey), [survey]);
  const shareResponseUrl = useMemo(
    () => buildAdminUrl(`/admin/surveys/${surveyId}/responses`),
    [surveyId],
  );
  const shareReportUrl = useMemo(
    () => buildAdminUrl(`/admin/surveys/${surveyId}/report`),
    [surveyId],
  );
  const shareTypeOptions = useMemo(
    () =>
      [
        SHARE_TYPES.PROGRESS,
        SHARE_TYPES.SUMMARY,
        SHARE_TYPES.TEAM,
        SHARE_TYPES.PROMOTION,
        SHARE_TYPES.REPORT,
        quotaDashboardEnabled ? SHARE_TYPES.SHORTAGE : null,
      ].filter(Boolean),
    [quotaDashboardEnabled],
  );

  useEffect(() => {
    if (activeTab === 'quota' && !quotaDashboardEnabled) {
      setActiveTab('responses');
    }
  }, [activeTab, quotaDashboardEnabled]);

  useEffect(() => {
    if (!quotaDashboardEnabled && shareType === SHARE_TYPES.SHORTAGE) {
      setShareType(SHARE_TYPES.PROGRESS);
    }
  }, [quotaDashboardEnabled, shareType]);

  useEffect(() => {
    setShareText(
      buildShareText({
        type: shareType,
        survey,
        responses: analyticsSource,
        analytics: surveyAnalytics,
        quotaSummary: shareQuotaSummary,
        quotaDashboard: ageQuotaDashboard,
        responseUrl: shareResponseUrl,
        reportUrl: shareReportUrl,
      }),
    );
    setShareCopyMessage('');
  }, [
    analyticsSource,
    ageQuotaDashboard,
    shareQuotaSummary,
    shareReportUrl,
    shareResponseUrl,
    shareType,
    survey,
    surveyAnalytics,
  ]);

  const handleOpenShareModal = () => {
    setShareModalOpen(true);
    setShareCopyMessage('');
  };

  const handleCopyShareText = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareText);
      } else if (typeof document !== 'undefined') {
        const textarea = document.createElement('textarea');
        textarea.value = shareText;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      } else {
        throw new Error('clipboard unavailable');
      }

      setShareCopyMessage('공유 문구가 복사되었습니다. Google Chat, 이메일, 카카오톡 등에 붙여넣어 사용하세요.');
    } catch {
      setShareCopyMessage('복사에 실패했습니다. 문구를 직접 선택해 복사해주세요.');
    }
  };

  if (loading) {
    return <div className="empty-state">응답 목록을 불러오는 중입니다.</div>;
  }

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  const normalizedStatus = normalizeSurveyStatus(survey?.status);
  const statusMeta = getSurveyStatusMeta(normalizedStatus);
  const formTypeMeta = getFormTypeMeta(survey?.formType);
  const quotaSummary = shareQuotaSummary;
  const publicUrl =
    typeof window === 'undefined'
      ? `/surveys/${surveyId}`
      : `${window.location.origin}/surveys/${surveyId}`;

  return (
    <section className="stack-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">응답 결과</span>
          <h1>{survey?.title}</h1>
          <p>
            {searchTerm || statusFilter
              ? `전체 ${quotaSummary.responseCount}건 중 ${responses.length}건 불러옴 · 검색 결과 ${filteredResponses.length}건 표시 중`
              : `전체 ${quotaSummary.responseCount}건 중 ${responses.length}건 표시 중`}
          </p>
        </div>
        <div className="card-actions">
          {canEditSurvey(survey) && (
            <Link className="secondary-button" to={`/admin/surveys/${surveyId}/edit`}>
              수정
            </Link>
          )}
          {canEditSurvey(survey) && (
            <button
              className="secondary-button"
              disabled={actionLoading}
              onClick={handleDuplicate}
              type="button"
            >
              복제
            </button>
          )}
          {canEditSurvey(survey) && (
            <button
              className="secondary-button"
              disabled={actionLoading}
              onClick={handleDelete}
              type="button"
            >
              삭제
            </button>
          )}
          {normalizedStatus !== SURVEY_STATUSES.DRAFT &&
            normalizedStatus !== SURVEY_STATUSES.DELETED &&
            canDownloadResponses && (
            <button className="secondary-button" onClick={() => setQrOpen(true)} type="button">
              QR 보기
            </button>
          )}
          <Link className="secondary-button" to="/admin">
            관리자 홈
          </Link>
        </div>
      </div>

      {missingSurveyNotice && <div className="inline-note">{missingSurveyNotice}</div>}

      <div className="panel survey-meta-panel">
        <div>
          <span className={statusMeta.className}>{statusMeta.label}</span>
          {getDeletedSurveyResponseMeta({}, survey).deleted && (
            <span className={getDeletedSurveyResponseMeta({}, survey).className}>
              {getDeletedSurveyResponseMeta({}, survey).label}
            </span>
          )}
          <p className="meta-description">폼 유형: {formTypeMeta.label}</p>
          <p className="meta-description">
            응답 {quotaSummary.responseCount}건
            {quotaSummary.quotaEnabled && quotaSummary.maxResponses
              ? ` / 최대 ${quotaSummary.maxResponses}건`
              : ' / 제한 없음'}
          </p>
          <p className="meta-description">
            {normalizedStatus === SURVEY_STATUSES.DRAFT &&
              `임시저장 상태입니다. ${getDraftSurveyMessage(survey?.formType)} 관리자만 수정·검토할 수 있습니다.`}
            {normalizedStatus === SURVEY_STATUSES.PUBLISHED &&
              '일반 사용자에게 공개되어 정상적으로 응답 또는 신청을 받을 수 있습니다.'}
            {normalizedStatus === SURVEY_STATUSES.CLOSED &&
              `${getClosedSurveyMessage(survey?.formType)} 공개 페이지에서는 안내만 보이고 제출은 막힌 상태입니다.`}
          </p>
        </div>
        {normalizedStatus !== SURVEY_STATUSES.DELETED && canChangeSurveyStatus(survey) && (
          <label className="field inline-field">
            <span>상태 변경</span>
            <select
              disabled={actionLoading}
              value={normalizedStatus}
              onChange={(event) => handleStatusChange(event.target.value)}
            >
              <option value={SURVEY_STATUSES.DRAFT}>임시저장</option>
              <option value={SURVEY_STATUSES.PUBLISHED}>게시중</option>
              <option value={SURVEY_STATUSES.CLOSED}>마감</option>
            </select>
          </label>
        )}
      </div>

      <div className="response-admin-tabs" role="tablist" aria-label="응답 관리 보기">
        <button
          aria-selected={activeTab === 'responses'}
          className={activeTab === 'responses' ? 'primary-button' : 'secondary-button'}
          onClick={() => setActiveTab('responses')}
          role="tab"
          type="button"
        >
          응답목록
        </button>
        {quotaDashboardEnabled && (
          <button
            aria-selected={activeTab === 'quota'}
            className={activeTab === 'quota' ? 'primary-button' : 'secondary-button'}
            onClick={() => setActiveTab('quota')}
            role="tab"
            type="button"
          >
            Quota 대시보드
          </button>
        )}
        <button
          aria-selected={activeTab === 'analytics'}
          className={activeTab === 'analytics' ? 'primary-button' : 'secondary-button'}
          onClick={() => setActiveTab('analytics')}
          role="tab"
          type="button"
        >
          통계/분석
        </button>
      </div>

      <div className="panel response-share-panel">
        <div>
          <strong>공유 문구</strong>
          <p className="meta-description">
            진행현황, 결과요약, 팀 공유, 홍보용 문구를 복사해 Google Chat, 이메일, 카카오톡 등에 붙여넣을 수 있습니다.
          </p>
        </div>
        <button className="secondary-button" onClick={handleOpenShareModal} type="button">
          공유하기
        </button>
      </div>

      {activeTab === 'responses' && (
      <div className="panel response-toolbar">
        <div className="response-toolbar-main">
          <label className="field response-toolbar-search">
            <span>검색</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={isApplicationForm ? '이름, 연락처, 주요 항목 검색' : '응답 내용 검색'}
            />
          </label>

          <label className="field response-toolbar-filter">
            <span>처리 상태</span>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="">전체</option>
              {FILTER_RESPONSE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {getResponseStatusMeta(status).label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="card-actions">
          {isApplicationForm && (
            <>
              <button
                className={viewMode === 'list' ? 'primary-button' : 'secondary-button'}
                onClick={() => setViewMode('list')}
                type="button"
              >
                명단형 보기
              </button>
              <button
                className={viewMode === 'raw' ? 'primary-button' : 'secondary-button'}
                onClick={() => setViewMode('raw')}
                type="button"
              >
                원본형 보기
              </button>
            </>
          )}
          {selectedSlotFilter && (
            <button
              className="secondary-button"
              onClick={() => setSelectedSlotFilter(null)}
              type="button"
            >
              슬롯 필터 해제
            </button>
          )}

          {canDownloadResponses && (
            <>
              <button className="secondary-button" onClick={handleRawCsvDownload} type="button">
                CSV 다운로드
              </button>
              <button
                className="secondary-button"
                disabled={statisticsExcelLoading}
                onClick={handleStatisticsExcelDownload}
                type="button"
              >
                {statisticsExcelLoading ? 'Excel 생성 중...' : '통계 Excel 다운로드'}
              </button>
            </>
          )}
          {isApplicationForm && canDownloadResponses && (
            <button className="secondary-button" onClick={handleApplicantCsvDownload} type="button">
              명단 CSV
            </button>
          )}
          {selectedSlotFilter && canDownloadResponses && (
            <button className="secondary-button" onClick={handleSlotCsvDownload} type="button">
              슬롯 CSV
            </button>
          )}
        </div>
        {statisticsExcelMessage && (
          <p className="response-download-status">{statisticsExcelMessage}</p>
        )}
      </div>
      )}

      {activeTab === 'quota' && quotaDashboardEnabled && (
        <div className="panel quota-dashboard-panel">
          <div className="builder-header-row">
            <div>
              <h2>연령대별 할당표본 현황</h2>
              <p className="meta-description">
                quotaCounts 누적 문서 기준입니다. 응답 원본 전체를 다시 읽지 않습니다.
              </p>
            </div>
          </div>

          <div className="analytics-summary-grid">
            <div className="application-summary-card">
              <small>전체 목표 대비 현재</small>
              <strong>{ageQuotaDashboard.currentTotal} / {ageQuotaDashboard.targetTotal}</strong>
            </div>
            <div className="application-summary-card">
              <small>전체 달성률</small>
              <strong>{ageQuotaDashboard.percent}%</strong>
            </div>
            <div className="application-summary-card">
              <small>초과응답 수</small>
              <strong>{ageQuotaDashboard.overQuotaCount}건</strong>
            </div>
            <div className="application-summary-card">
              <small>마감된 연령대</small>
              <strong>{ageQuotaDashboard.closedCellCount}개</strong>
            </div>
          </div>

          {ageQuotaDashboard.shortageTop.length > 0 && (
            <div className="option-status-list">
              <div className="builder-header-row">
                <div>
                  <h3>부족 표본 TOP 5</h3>
                  <p className="meta-description">
                    부족 인원 많은 순, 달성률 낮은 순으로 정렬합니다.
                  </p>
                </div>
                {ageQuotaDashboard.shortageRows.length > ageQuotaDashboard.shortageTop.length && (
                  <button
                    className="secondary-button"
                    onClick={() => setShowAllQuotaShortages((current) => !current)}
                    type="button"
                  >
                    {showAllQuotaShortages ? 'TOP 5만 보기' : '전체 부족 현황 보기'}
                  </button>
                )}
              </div>
              {(showAllQuotaShortages
                ? ageQuotaDashboard.shortageRows
                : ageQuotaDashboard.shortageTop
              ).map((row, index) => (
                <div className="inline-note" key={`shortage-${row.ageGroupId}`}>
                  <strong>{index + 1}. {row.ageGroupLabel}</strong>
                  {' '}
                  {row.shortage}명 부족 ({row.current}/{row.target})
                </div>
              ))}
            </div>
          )}

          <div className="response-table-wrapper">
            <table className="response-table quota-dashboard-table">
              <thead>
                <tr>
                  <th>연령대</th>
                  <th>목표</th>
                  <th>응답수</th>
                  <th>남은 인원</th>
                  <th>달성률</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {ageQuotaDashboard.rows.map((row) => (
                  <tr key={`quota-dashboard-row-${row.ageGroupId}`}>
                    <th>{row.ageGroupLabel}</th>
                    <td>{row.target}</td>
                    <td>{row.current}</td>
                    <td>{Math.max(0, row.target - row.current)}</td>
                    <td>{row.percent}%</td>
                    <td>{row.status}</td>
                  </tr>
                ))}
                <tr>
                  <th>계</th>
                  <td>{ageQuotaDashboard.targetTotal}</td>
                  <td>{ageQuotaDashboard.currentTotal}</td>
                  <td>{Math.max(0, ageQuotaDashboard.targetTotal - ageQuotaDashboard.currentTotal)}</td>
                  <td>{ageQuotaDashboard.percent}%</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'analytics' && (
      <>
      {optionQuotaQuestions.length > 0 && (
        <div className="panel">
          <div className="builder-header-row">
            <div>
              <h2>선택지별 정원 현황</h2>
              {slotQuotaQuestions.length > 0 && (
                <p className="meta-description">
                  신청 슬롯 카드를 누르면 해당 회차 또는 연령대 신청자 명단을 바로 볼 수 있습니다.
                </p>
              )}
            </div>
          </div>

          <div className="question-list">
            {optionQuotaQuestions.map((question) => (
              <div className="question-card" key={`quota-${question.id}`}>
                <strong>{question.title || '제목 없는 질문'}</strong>
                {question.description && <p className="meta-description">{question.description}</p>}

                <div className="option-status-list">
                  {question.optionItems.map((option) => (
                    <button
                      className={`inline-note option-status-card ${
                        selectedSlotFilter?.questionId === question.id &&
                        selectedSlotFilter?.slotValue === option.value
                          ? 'option-status-card-active'
                          : ''
                      }`}
                      key={`${question.id}-${option.value}`}
                      onClick={() => {
                        if (question.type !== QUESTION_TYPES.APPLICATION_SLOT_CHOICE) {
                          return;
                        }

                        setSelectedSlotFilter((current) =>
                          current?.questionId === question.id && current?.slotValue === option.value
                            ? null
                            : {
                                questionId: question.id,
                                slotValue: option.value,
                                title: option.title || option.label,
                              },
                        );
                        setViewMode('list');
                      }}
                      type="button"
                    >
                      <strong>{option.title || option.label}</strong>
                      {(option.ageGroup || option.date || option.time || option.place) && (
                        <span>
                          {' '}
                          / {[option.ageGroup, option.date, option.time, option.place]
                            .filter(Boolean)
                            .join(' / ')}
                        </span>
                      )}
                      : {option.currentCount}
                      {option.capacity ? ` / ${option.capacity}` : ''}
                      {option.isClosed
                        ? ' (마감)'
                        : option.remainingCount !== null
                          ? `, 잔여 ${option.remainingCount}`
                          : ''}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {survey?.templateId === RESIDENT_ASSET_TEMPLATE_ID && residentAssetSummaryRows.length > 0 && (
        <div className="panel">
          <div className="builder-header-row">
            <div>
              <h2>주민 인터뷰 주요 항목</h2>
              <p className="meta-description">
                만남 정보, 주민 강점, 나눌 수 있는 자산, 연결 가능성과 후속 계획을 빠르게 확인합니다.
              </p>
            </div>
          </div>

          <div className="response-table-wrapper">
            <table className="response-table">
              <thead>
                <tr>
                  <th>제출일</th>
                  {RESIDENT_ASSET_SUMMARY_FIELDS.map((field) => (
                    <th key={`resident-heading-${field.key}`}>{field.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {residentAssetSummaryRows.map((row) => (
                  <tr key={`resident-summary-${row.id}`}>
                    <td>{formatFirestoreDate(row.submittedAt)}</td>
                    {RESIDENT_ASSET_SUMMARY_FIELDS.map((field) => (
                      <td key={`${row.id}-${field.key}`}>{row.values[field.key]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {surveyAnalytics.scoredRows.length > 0 && (
        <div className="panel analytics-panel">
          <div className="builder-header-row">
            <div>
              <h2>만족도 분석</h2>
              <p className="meta-description">
                전체 평균 {formatAverage(surveyAnalytics.totalAverage)}점 · 문항별 평균과 응답 분포를 확인합니다.
              </p>
              <small className="muted-label">
                {analyticsStatus === 'loading' && '집계 중...'}
                {analyticsStatus === 'ready' && `전체 ${allResponses.length}건 기준`}
                {analyticsStatus === 'partial' && `로드된 ${responses.length}건 기준 (전체 조회 실패)`}
              </small>
            </div>
            <div className="card-actions">
              <button
                className="secondary-button"
                disabled={analyticsStatus === 'loading'}
                onClick={handleReportSettingsOpen}
                type="button"
              >
                {analyticsStatus === 'loading' ? '집계 중...' : '결과보고서 생성'}
              </button>
              <button
                className="secondary-button"
                disabled={analyticsStatus === 'loading'}
                onClick={handleAnalyticsRefresh}
                type="button"
              >
                {analyticsStatus === 'loading' ? '집계 중...' : '분석 새로고침'}
              </button>
            </div>
          </div>

          <div className="analytics-summary-grid">
            <div className="application-summary-card">
              <small>전체 응답 수</small>
              <strong>{analyticsSource.length}건</strong>
            </div>
            <div className="application-summary-card">
              <small>전체 평균 만족도</small>
              <strong>{formatAverage(surveyAnalytics.totalAverage)}점</strong>
            </div>
            <div className="application-summary-card">
              <small>상위 문항</small>
              <strong>{surveyAnalytics.topRows[0]?.question.title ?? '-'}</strong>
            </div>
            <div className="application-summary-card">
              <small>하위 문항</small>
              <strong>{surveyAnalytics.lowRows[0]?.question.title ?? '-'}</strong>
            </div>
          </div>

          <div className="analytics-rank-grid">
            <div>
              <h3>만족도 상위 문항</h3>
              <div className="option-status-list">
                {surveyAnalytics.topRows.map((row) => (
                  <div className="inline-note" key={`top-${row.question.id}`}>
                    <strong>{formatAverage(row.average)}점</strong> {row.question.title}
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3>만족도 하위 문항</h3>
              <div className="option-status-list">
                {surveyAnalytics.lowRows.map((row) => (
                  <div className="inline-note" key={`low-${row.question.id}`}>
                    <strong>{formatAverage(row.average)}점</strong> {row.question.title}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {(survey?.templateId === 'yeongjung_user_satisfaction_v1' ||
            survey?.templateId === 'education_lifelong_satisfaction_v1') && (
            <div className="analytics-rank-grid">
              {survey.templateId === 'yeongjung_user_satisfaction_v1' && (
                <>
                  <div>
                    <h3>이용기간별 만족도</h3>
                    <div className="option-status-list">
                      {surveyAnalytics.groupAverages.usagePeriod.map((group) => (
                        <div className="inline-note" key={`usage-${group.label}`}>
                          <strong>{group.label}</strong> {formatAverage(group.average)}점 · {group.count}건
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3>지역·성별 만족도</h3>
                    <div className="option-status-list">
                      {[...surveyAnalytics.groupAverages.area, ...surveyAnalytics.groupAverages.gender].map((group) => (
                        <div className="inline-note" key={`group-${group.label}`}>
                          <strong>{group.label}</strong> {formatAverage(group.average)}점 · {group.count}건
                        </div>
                      ))}
                      <div className="inline-note">
                        <strong>사회적 관계망 평균</strong> {formatAverage(surveyAnalytics.socialNetworkAverage)}명
                      </div>
                    </div>
                  </div>
                </>
              )}

              {survey.templateId === 'education_lifelong_satisfaction_v1' && (
                <>
                  <div>
                    <h3>프로그램명별 평균 만족도</h3>
                    <div className="option-status-list">
                      {surveyAnalytics.groupAverages.programName.map((group) => (
                        <div className="inline-note" key={`program-${group.label}`}>
                          <strong>{group.label}</strong> {formatAverage(group.average)}점 · {group.count}건
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3>프로그램 효과 지표</h3>
                    <div className="option-status-list">
                      <div className="inline-note">정서 안정 {formatAverage(surveyAnalytics.keyAverages.emotional_stability)}점</div>
                      <div className="inline-note">건강 증진 {formatAverage(surveyAnalytics.keyAverages.health_improved)}점</div>
                      <div className="inline-note">관계 형성 {formatAverage(surveyAnalytics.keyAverages.relationship_growth)}점</div>
                      <div className="inline-note">재참여 의향 {formatAverage(surveyAnalytics.keyAverages.rejoin_intent)}점</div>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {(surveyAnalytics.groupCounts.area.length > 0 ||
            surveyAnalytics.groupCounts.usagePeriod.length > 0 ||
            surveyAnalytics.groupCounts.programName.length > 0) && (
            <div>
              <h3>응답 현황 집계</h3>
              <p className="meta-description">
                정규화된 프로그램명 기준으로 집계합니다. 원본 응답 데이터와 CSV는 변경되지 않습니다.
              </p>
              <div className="analytics-rank-grid">
                {surveyAnalytics.groupCounts.programName.length > 0 && (
                  <div>
                    <h4>프로그램별 응답 현황</h4>
                    <div className="response-table-wrapper">
                      <table className="response-table">
                        <thead>
                          <tr>
                            <th>프로그램명</th>
                            <th>응답 수</th>
                            <th>비율</th>
                          </tr>
                        </thead>
                        <tbody>
                          {surveyAnalytics.groupCounts.programName.map((row) => (
                            <tr key={`pgcount-${row.label}`}>
                              <td>{row.label}</td>
                              <td>{row.count}건</td>
                              <td>{row.percent}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
                {surveyAnalytics.groupCounts.area.length > 0 && (
                  <div>
                    <h4>지역별 응답 현황</h4>
                    <div className="response-table-wrapper">
                      <table className="response-table">
                        <thead>
                          <tr>
                            <th>지역</th>
                            <th>응답 수</th>
                            <th>비율</th>
                          </tr>
                        </thead>
                        <tbody>
                          {surveyAnalytics.groupCounts.area.map((row) => (
                            <tr key={`areacount-${row.label}`}>
                              <td>{row.label}</td>
                              <td>{row.count}건</td>
                              <td>{row.percent}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
              {surveyAnalytics.groupCounts.usagePeriod.length > 0 && (
                <div>
                  <h4>참여기간별 응답 현황</h4>
                  <div className="response-table-wrapper">
                    <table className="response-table">
                      <thead>
                        <tr>
                          <th>참여기간</th>
                          <th>응답 수</th>
                          <th>비율</th>
                        </tr>
                      </thead>
                      <tbody>
                        {surveyAnalytics.groupCounts.usagePeriod.map((row) => (
                          <tr key={`usagecount-${row.label}`}>
                            <td>{row.label}</td>
                            <td>{row.count}건</td>
                            <td>{row.percent}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="response-table-wrapper">
            <table className="response-table">
              <thead>
                <tr>
                  <th>문항</th>
                  <th>평균</th>
                  <th>응답 분포</th>
                </tr>
              </thead>
              <tbody>
                {surveyAnalytics.scoredRows.map((row) => (
                  <tr key={`analytics-${row.question.id}`}>
                    <td>{row.question.title}</td>
                    <td>{formatAverage(row.average)}점</td>
                    <td>
                      <div className="analytics-distribution">
                        {row.distribution.map((item) => (
                          <span key={`${row.question.id}-${item.score}`}>
                            {item.score}점 {item.count}건
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {surveyAnalytics.textResponses.length > 0 && (
            <div>
              <h3>자유의견 목록</h3>
              <div className="response-answer-list">
                {surveyAnalytics.textResponses
                  .slice(0, freeTextExpanded ? undefined : 20)
                  .map((item, index) => (
                    <div className="response-answer-item" key={`free-${index}`}>
                      <strong>{item.questionTitle}</strong>
                      <p>{item.answer}</p>
                    </div>
                  ))}
              </div>
              {surveyAnalytics.textResponses.length > 20 && (
                <button
                  className="secondary-button"
                  onClick={() => setFreeTextExpanded((prev) => !prev)}
                  type="button"
                >
                  {freeTextExpanded
                    ? '접기'
                    : `더 보기 (+${surveyAnalytics.textResponses.length - 20}건)`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {selectedSlotFilter && (
        <div className="panel">
          <div className="builder-header-row">
            <div>
              <h2>슬롯별 신청자 명단</h2>
              <p className="meta-description">
                <strong>{selectedSlotFilter.title}</strong> 슬롯 신청자만 바로 보고 있습니다.
              </p>
            </div>
            <div className="card-actions">
              {canDownloadResponses && (
                <button className="secondary-button" onClick={handleSlotCsvDownload} type="button">
                  슬롯 CSV
                </button>
              )}
              <button
                className="secondary-button"
                onClick={() => setSelectedSlotFilter(null)}
                type="button"
              >
                전체 명단으로 돌아가기
              </button>
            </div>
          </div>

          {slotRosterRows.length === 0 ? (
            <div className="empty-state compact-state">이 슬롯에 신청한 명단이 아직 없습니다.</div>
          ) : (
            <div className="response-table-wrapper">
              <table className="response-table">
                <thead>
                  <tr>
                    <th>제출일</th>
                    <th>이름</th>
                    <th>연락처</th>
                    <th>상태</th>
                    <th>비고</th>
                  </tr>
                </thead>
                <tbody>
                  {slotRosterRows.map((row) => (
                    <tr key={`slot-roster-${row.id}`}>
                      <td>{formatFirestoreDate(row.submittedAt)}</td>
                      <td>{maskName(row.name)}</td>
                      <td>{maskPhone(row.phone)}</td>
                      <td>
                        <span className={getResponseStatusMeta(row.status).className}>
                          {getResponseStatusMeta(row.status).label}
                        </span>
                      </td>
                      <td>{row.adminNote || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      </>
      )}

      {activeTab === 'responses' && (
      <>
      {filteredResponses.length === 0 ? (
        <div className="empty-state">
          {responses.length === 0
            ? normalizedStatus === SURVEY_STATUSES.DRAFT
              ? `임시저장 폼은 아직 공개 전입니다. ${getDraftSurveyMessage(survey?.formType)} 게시중으로 변경한 뒤 링크나 QR을 배포하면 응답을 받을 수 있습니다.`
              : '아직 등록된 응답이 없습니다.'
            : '검색 또는 필터 조건에 맞는 응답이 없습니다.'}
        </div>
      ) : viewMode === 'list' && isApplicationForm ? (
        <div className="panel">
          <div className="response-table-wrapper">
            <table className="response-table">
              <thead>
                <tr>
                  <th>제출일</th>
                  <th>이름</th>
                  <th>연락처</th>
                  <th>주요 항목</th>
                  <th>처리 상태</th>
                  <th>비고</th>
                  <th>관리</th>
                </tr>
              </thead>
              <tbody>
                {visibleResponses.map((response) => {
                  const draftState = editingStates[response.id] ?? {
                    responseStatus: response.normalizedResponseStatus,
                    adminNote: response.adminNote ?? '',
                  };

                  return (
                    <tr key={response.id}>
                      <td>{formatFirestoreDate(response.submittedAt)}</td>
                      <td>{maskName(response.summary.name)}</td>
                      <td>{maskPhone(response.summary.phone)}</td>
                      <td>{response.summary.primaryValue}</td>
                      <td>
                        <div className="response-status-panel response-status-panel-compact">
                          <label className="field response-status-select-field response-status-select-field-inline">
                            <select
                              className="response-status-select"
                              disabled={actionLoading}
                              value={draftState.responseStatus}
                              onChange={(event) =>
                                handleResponseStatusChange(response.id, event.target.value)
                              }
                            >
                              {FILTER_RESPONSE_STATUSES.map((status) => (
                                <option key={`${response.id}-${status}`} value={status}>
                                  {getResponseStatusMeta(status).label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={draftState.adminNote}
                          onChange={(event) =>
                            handleProcessingDraftChange(
                              response.id,
                              'adminNote',
                              event.target.value,
                            )
                          }
                          placeholder="관리 메모"
                        />
                      </td>
                      <td>
                        <div className="card-actions">
                          <button
                            className="secondary-button"
                            disabled={actionLoading}
                            onClick={() => handleAdminNoteSave(response.id)}
                            type="button"
                          >
                            메모 저장
                          </button>
                          {canDeleteResponses && (
                            <button
                              className="secondary-button danger-button"
                              disabled={actionLoading}
                              onClick={() => setPendingDeleteResponse(response.id)}
                              type="button"
                            >
                              응답 삭제
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="response-admin-list">
          {visibleResponses.map((response, index) => {
            const draftState = editingStates[response.id] ?? {
              responseStatus: response.normalizedResponseStatus,
              adminNote: response.adminNote ?? '',
            };

            return (
              <article className="panel" key={response.id}>
                <div className="response-admin-header">
                  <div>
                    <strong>응답 #{responseNumberMap.get(response.id) ?? (quotaSummary.responseCount - index)}</strong>
                    <p>{formatFirestoreDate(response.submittedAt)}</p>
                  </div>
                  <div className="response-admin-meta response-status-controls">
                    <div className="response-status-panel">
                      <label className="field response-status-select-field">
                        <span>응답 처리 상태</span>
                        <select
                          className="response-status-select"
                          disabled={actionLoading}
                          value={draftState.responseStatus}
                          onChange={(event) =>
                            handleResponseStatusChange(response.id, event.target.value)
                          }
                        >
                          {FILTER_RESPONSE_STATUSES.map((status) => (
                            <option key={`${response.id}-raw-${status}`} value={status}>
                              {getResponseStatusMeta(status).label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <label className="field response-admin-note-field">
                      <span>관리 메모</span>
                      <input
                        type="text"
                        value={draftState.adminNote}
                        onChange={(event) =>
                          handleProcessingDraftChange(response.id, 'adminNote', event.target.value)
                        }
                        placeholder="관리 메모"
                      />
                    </label>
                    <div className="card-actions">
                      <button
                        className="secondary-button"
                        disabled={actionLoading}
                        onClick={() => handleAdminNoteSave(response.id)}
                        type="button"
                      >
                        메모 저장
                      </button>
                      {canManageUsers && surveyHasPii && (
                        <button
                          className="secondary-button"
                          disabled={actionLoading || Boolean(response.anonymizedAt)}
                          onClick={() => setPendingAnonymize(response.id)}
                          type="button"
                        >
                          {response.anonymizedAt ? '익명화 완료' : '개인정보 익명화'}
                        </button>
                      )}
                      {canDeleteResponses && (
                        <button
                          className="secondary-button danger-button"
                          disabled={actionLoading}
                          onClick={() => setPendingDeleteResponse(response.id)}
                          type="button"
                        >
                          응답 삭제
                        </button>
                      )}
                    </div>
                  </div>
                </div>

              <div className="response-answer-list">
                {response.answerItems.map((answer) => {
                  const displayValue = formatSurveyAnswer(answer.answer, answer);
                  const maskedValue = piiQuestionIds.has(answer.questionId)
                    ? maskAnswerByQuestion(displayValue, answer.questionTitle, answer.questionType)
                    : displayValue;
                  return (
                    <div className="response-answer-item" key={`${response.id}-${answer.questionId}`}>
                      <strong>
                        {questionDisplayMap[answer.questionId]?.shortLabel
                          ? `${questionDisplayMap[answer.questionId].shortLabel}. `
                          : ''}
                        {answer.questionTitle}
                      </strong>
                      {answer.questionDescription && <small>{answer.questionDescription}</small>}
                      <p>{maskedValue}</p>
                    </div>
                  );
                })}
              </div>
            </article>
            );
          })}
        </div>
      )}

      {hasMoreResponses ? (
        <div className="pagination-bar">
          <button
            className="secondary-button"
            disabled={loadingMoreResponses}
            onClick={() => loadPageData({ append: true })}
            type="button"
          >
            {loadingMoreResponses ? '불러오는 중...' : '더 보기'}
          </button>
          <span>전체 {quotaSummary.responseCount}건 중 {responses.length}건 표시 중</span>
        </div>
      ) : responses.length > 0 && (
        <div className="pagination-bar">
          <span>전체 {quotaSummary.responseCount}건을 모두 표시 중입니다.</span>
        </div>
      )}
      </>
      )}

      {shareModalOpen && (
        <div
          className="modal-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setShareModalOpen(false);
            }
          }}
          role="presentation"
        >
          <div aria-modal="true" className="modal-panel share-copy-modal" role="dialog">
            <div className="report-settings-header">
              <div>
                <h2>공유하기</h2>
                <p>자동 생성된 문구를 필요에 맞게 수정한 뒤 복사할 수 있습니다.</p>
              </div>
              <button className="secondary-button" onClick={() => setShareModalOpen(false)} type="button">
                닫기
              </button>
            </div>

            <label className="field">
              <span>공유 유형</span>
              <select
                value={shareType}
                onChange={(event) => setShareType(event.target.value)}
              >
                {shareTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {SHARE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
              {!quotaDashboardEnabled && (
                <small>quota를 사용하지 않는 설문에서는 부족표본 공유가 숨겨집니다.</small>
              )}
            </label>

            <label className="field share-copy-textarea-field">
              <span>공유 문구</span>
              <textarea
                onChange={(event) => setShareText(event.target.value)}
                rows="14"
                value={shareText}
              />
            </label>

            {shareCopyMessage && <p className="inline-note">{shareCopyMessage}</p>}

            <div className="report-settings-actions">
              <button className="secondary-button" onClick={() => setShareModalOpen(false)} type="button">
                취소
              </button>
              <button className="primary-button" onClick={handleCopyShareText} type="button">
                복사
              </button>
            </div>
          </div>
        </div>
      )}

      <QrModal
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`${survey?.title ?? '설문'} QR`}
        url={publicUrl}
      />
      <ReportSettingsModal
        isOpen={reportSettingsOpen}
        onChange={setReportSettings}
        onClose={handleReportSettingsClose}
        onSubmit={handleReportOpen}
        values={reportSettings}
      />
      <ConfirmModal
        isOpen={pendingDownload !== null}
        title="개인정보 포함 파일 다운로드"
        message="이 파일에는 개인정보가 포함될 수 있습니다. 업무 목적 외 사용을 금지하며, 저장·전송·공유 시 유출되지 않도록 주의해주세요. 다운로드하시겠습니까?"
        confirmLabel="다운로드"
        cancelLabel="취소"
        onConfirm={() => {
          if (pendingDownload) pendingDownload();
          setPendingDownload(null);
        }}
        onCancel={() => setPendingDownload(null)}
      />
      <ConfirmModal
        isOpen={pendingAnonymize !== null}
        title="개인정보 익명화"
        message="익명화 후에는 개인정보를 복구할 수 없습니다. 계속하시겠습니까?"
        confirmLabel="익명화"
        cancelLabel="취소"
        onConfirm={() => {
          const responseId = pendingAnonymize;
          setPendingAnonymize(null);
          handleAnonymize(responseId);
        }}
        onCancel={() => setPendingAnonymize(null)}
      />
      <ConfirmModal
        isOpen={pendingDeleteResponse !== null}
        title="이 응답을 삭제하시겠습니까?"
        message="삭제된 응답은 복구할 수 없습니다."
        confirmLabel="응답 삭제"
        cancelLabel="취소"
        onConfirm={() => {
          const responseId = pendingDeleteResponse;
          setPendingDeleteResponse(null);
          handleResponseDelete(responseId);
        }}
        onCancel={() => setPendingDeleteResponse(null)}
      />
    </section>
  );
}

export default SurveyResponsesAdminPage;
