import { useEffect, useMemo, useState } from 'react';
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
  getResponseStatusMeta,
  getScaleQuestionConfig,
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

function formatAverage(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
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

function buildSurveyAnalytics(survey, responses) {
  const questions = survey?.questions?.filter((question) => !isNonResponseQuestionType(question.type)) ?? [];
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const scoreQuestions = questions.filter((question) => {
    if (isScaleQuestionType(question.type)) {
      return true;
    }

    return (
      question.type === QUESTION_TYPES.SINGLE_CHOICE &&
      (question.options ?? []).some((option) => /^([1-5])\./.test(String(option)))
    );
  });
  const textQuestions = questions.filter((question) => question.type === QUESTION_TYPES.LONG_TEXT);
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

      if (!question) {
        return;
      }

      const score = getNumericScore(answerItem.answer, question);
      const scoreRow = scoreRowMap.get(question.id);

      if (scoreRow && score !== null) {
        scoreRow.values.push(score);
        scoreRow.distribution.set(score, (scoreRow.distribution.get(score) ?? 0) + 1);
      }

      if (textQuestions.some((item) => item.id === question.id) && String(answerItem.answer ?? '').trim()) {
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
          return {
            score,
            count: row.distribution.get(score) ?? 0,
          };
        }),
      };
    })
    .filter((row) => row.count > 0);
  const allScores = scoredRows.flatMap((row) => row.distribution.flatMap((item) => Array(item.count).fill(item.score)));
  const totalAverage =
    allScores.length > 0 ? allScores.reduce((total, value) => total + value, 0) / allScores.length : null;
  const getQuestionByTitle = (pattern) =>
    questions.find((question) => String(question.title ?? '').includes(pattern));
  const buildGroupedAverages = (question) => {
    if (!question) {
      return [];
    }

    const groups = new Map();

    responses.forEach((response) => {
      const answers = response.answers ?? [];
      const groupAnswer = answers.find((item) => item.questionId === question.id)?.answer;
      const groupKey = String(groupAnswer ?? '').trim();

      if (!groupKey) {
        return;
      }

      const responseScores = answers
        .map((item) => getNumericScore(item.answer, questionMap.get(item.questionId)))
        .filter((score) => score !== null);

      if (responseScores.length === 0) {
        return;
      }

      const current = groups.get(groupKey) ?? { label: groupKey, total: 0, count: 0 };
      current.total += responseScores.reduce((total, score) => total + score, 0) / responseScores.length;
      current.count += 1;
      groups.set(groupKey, current);
    });

    return Array.from(groups.values()).map((group) => ({
      label: group.label,
      average: group.total / group.count,
      count: group.count,
    }));
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

  return {
    scoredRows,
    totalAverage,
    topRows: [...scoredRows].sort((first, second) => second.average - first.average).slice(0, 3),
    lowRows: [...scoredRows].sort((first, second) => first.average - second.average).slice(0, 3),
    textResponses,
    keyAverages,
    groupAverages: {
      usagePeriod: buildGroupedAverages(getQuestionByTitle('이용기간')),
      area: buildGroupedAverages(getQuestionByTitle('살고있는 곳')),
      gender: buildGroupedAverages(getQuestionByTitle('성별')),
      programName: buildGroupedAverages(getQuestionByTitle('수강한 프로그램명')),
    },
    socialNetworkAverage,
  };
}

function escapeCsvValue(value) {
  const normalizedValue = String(value ?? '');
  const escapedValue = normalizedValue.replaceAll('"', '""');
  return `"${escapedValue}"`;
}

function downloadCsv(filename, rows) {
  const csvContent = rows.map((row) => row.map((value) => escapeCsvValue(value)).join(',')).join('\n');
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

    const headerRow = [
      '제출일',
      '응답 ID',
      '처리 상태',
      '관리자 비고',
      ...orderedQuestions.map((question) => question.title || question.label || question.id),
    ];

    const dataRows = exportSource.map((response) => {
      const answerItems = getOrderedResponseAnswerItems(survey.questions, response.answers);
      const answerMap = new Map(
        answerItems.map((item) => [item.questionId, formatSurveyAnswer(item.answer, item)]),
      );

      return [
        formatFirestoreDate(response.submittedAt),
        response.id,
        getResponseStatusMeta(response.status).label,
        response.adminNote ?? '',
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
          summary.name,
          summary.phone,
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
          summary.name,
          summary.phone,
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

  if (loading) {
    return <div className="empty-state">응답 목록을 불러오는 중입니다.</div>;
  }

  if (error) {
    return <div className="empty-state">{error}</div>;
  }

  const normalizedStatus = normalizeSurveyStatus(survey?.status);
  const statusMeta = getSurveyStatusMeta(normalizedStatus);
  const formTypeMeta = getFormTypeMeta(survey?.formType);
  const quotaSummary = getQuotaSummary(survey);
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
            현재 {responses.length}건의 응답을 불러왔습니다. 설문 운영 현황과 제출 데이터를
            관리자 화면에서 바로 확인할 수 있습니다.
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
            <button className="secondary-button" onClick={handleRawCsvDownload} type="button">
              CSV 다운로드
            </button>
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
      </div>

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
                      <td>{row.name}</td>
                      <td>{row.phone}</td>
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
                      <td>{response.summary.name}</td>
                      <td>{response.summary.phone}</td>
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
                    <strong>응답 #{filteredResponses.length - index}</strong>
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
                {response.answerItems.map((answer) => (
                  <div className="response-answer-item" key={`${response.id}-${answer.questionId}`}>
                    <strong>
                      {questionDisplayMap[answer.questionId]?.shortLabel
                        ? `${questionDisplayMap[answer.questionId].shortLabel}. `
                        : ''}
                      {answer.questionTitle}
                    </strong>
                    {answer.questionDescription && <small>{answer.questionDescription}</small>}
                    <p>{formatSurveyAnswer(answer.answer, answer)}</p>
                  </div>
                ))}
              </div>
            </article>
            );
          })}
        </div>
      )}

      {hasMoreResponses && (
        <div className="pagination-bar">
          <button
            className="secondary-button"
            disabled={loadingMoreResponses}
            onClick={() => loadPageData({ append: true })}
            type="button"
          >
            {loadingMoreResponses ? '불러오는 중...' : '더 보기'}
          </button>
          <span>현재 {responses.length}건 표시 중</span>
        </div>
      )}

      <QrModal
        isOpen={qrOpen}
        onClose={() => setQrOpen(false)}
        title={`${survey?.title ?? '설문'} QR`}
        url={publicUrl}
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
