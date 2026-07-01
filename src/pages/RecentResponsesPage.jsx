import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { maskName, maskPhone } from '../utils/privacy';
import ResponseDetailModal from '../components/ResponseDetailModal';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchManagedRecentResponses,
  fetchManagedSurveys,
  formatFirestoreDate,
  getDeletedSurveyResponseMeta,
  getFirestoreErrorMessage,
  hydrateSurveyResponseCounts,
  normalizeResponseProcessingStatus,
  RESPONSE_PROCESSING_STATUSES,
} from '../firebase/surveys';

const ADMIN_ROLES = new Set(['super_admin', 'admin']);

function getMaskedRespondentDisplay(response) {
  const name = response.respondentName || response.respondent?.name;
  const phone = response.respondentPhone || response.respondent?.phone;
  if (name) return maskName(name);
  if (phone) return maskPhone(phone);
  return '응답자 정보 없음';
}

function toSeoulDateKey(value) {
  const date = value?.toDate?.() ?? (value ? new Date(value) : null);

  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(date);
}

function RecentResponsesPage() {
  const { user, role, firebaseStatusMessage, isFirebaseConfigured } = useAuth();
  const [responses, setResponses] = useState([]);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recordFilter, setRecordFilter] = useState('active');
  const [selectedResponse, setSelectedResponse] = useState(null);
  const canIncludeDeletedResponses = ADMIN_ROLES.has(role);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setError(firebaseStatusMessage || 'Firebase 설정이 필요합니다.');
      setLoading(false);
      return;
    }

    async function loadData() {
      try {
        setLoading(true);
        setError('');
        const [recentResponses, managedSurveys] = await Promise.all([
          fetchManagedRecentResponses({ uid: user?.uid, email: user?.email ?? '', role }, 30, {
            includeDeleted: true,
          }),
          fetchManagedSurveys({ uid: user?.uid, email: user?.email ?? '', role }, { includeDeleted: true }),
        ]);
        setResponses(recentResponses);
        setSurveys(await hydrateSurveyResponseCounts(managedSurveys));
      } catch (loadError) {
        console.error('최근 응답 조회 실패:', {
          code: loadError?.code,
          message: loadError?.message,
          role,
          uid: user?.uid,
          email: user?.email,
        });
        setError(
          getFirestoreErrorMessage(
            loadError,
            '현재 계정으로 조회 가능한 응답이 없거나 권한이 없습니다.',
          ),
        );
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [firebaseStatusMessage, isFirebaseConfigured, role, user?.email, user?.uid]);

  const surveyMap = useMemo(
    () => new Map(surveys.map((survey) => [survey.id, survey])),
    [surveys],
  );

  const policyVisibleResponses = useMemo(() => {
    const includeDeleted = canIncludeDeletedResponses && recordFilter === 'includeDeleted';

    return responses.filter((response) => {
      const linkedSurvey = response.surveyId ? surveyMap.get(response.surveyId) : null;
      const deletedMeta = getDeletedSurveyResponseMeta(response, linkedSurvey);

      return includeDeleted || !deletedMeta.deleted;
    });
  }, [canIncludeDeletedResponses, recordFilter, responses, surveyMap]);

  const metrics = useMemo(() => {
    const todayKey = toSeoulDateKey(new Date());
    const todayCount = policyVisibleResponses.filter((response) => toSeoulDateKey(response.submittedAt) === todayKey).length;
    const pendingCount = policyVisibleResponses.filter(
      (response) =>
        normalizeResponseProcessingStatus(response.applicationStatus) ===
        RESPONSE_PROCESSING_STATUSES.RECEIVED,
    ).length;

    return {
      todayCount,
      pendingCount,
    };
  }, [policyVisibleResponses]);

  const filteredResponses = useMemo(() => {
    return policyVisibleResponses.filter((response) => {
      const linkedSurvey = response.surveyId ? surveyMap.get(response.surveyId) : null;
      const processingStatus = normalizeResponseProcessingStatus(response.applicationStatus);

      switch (recordFilter) {
        case 'pending':
          return processingStatus === RESPONSE_PROCESSING_STATUSES.RECEIVED;
        case 'completed':
          return processingStatus === RESPONSE_PROCESSING_STATUSES.COMPLETED;
        case 'active':
        case 'includeDeleted':
        case 'all':
        default:
          return true;
      }
    });
  }, [policyVisibleResponses, recordFilter, surveyMap]);

  const selectedResponseSurvey = selectedResponse?.surveyId
    ? surveyMap.get(selectedResponse.surveyId) ?? null
    : null;

  return (
    <section className="stack-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">응답 관리</span>
          <h1>최근 응답 확인</h1>
          <p>최근 제출된 응답과 처리 대기 건을 빠르게 확인하세요.</p>
        </div>
        <div className="card-actions">
          <Link className="secondary-button" to="/admin/surveys">
            설문 목록 보기
          </Link>
          <Link className="primary-button" to="/admin/surveys/new">
            새 폼 만들기
          </Link>
        </div>
      </div>

      {error && <div className="empty-state">{error}</div>}

      <div className="dashboard-grid dashboard-metrics-grid">
        <article className="dashboard-card metric-card">
          <span className="status-chip published-chip">오늘 응답</span>
          <h2>오늘 들어온 응답</h2>
          <strong className="metric-value">{metrics.todayCount}건</strong>
          <p>오늘 제출된 최신 응답 수입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip draft-chip">미처리</span>
          <h2>처리 대기</h2>
          <strong className="metric-value">{metrics.pendingCount}건</strong>
          <p>아직 접수 확인이 필요한 신청 건수입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip published-chip">설문 수</span>
          <h2>관리 중인 폼</h2>
          <strong className="metric-value">{surveys.length}개</strong>
          <p>현재 권한 범위에서 조회 가능한 설문·신청 폼입니다.</p>
        </article>
      </div>

      <div className="panel">
        <div className="builder-header-row">
          <div>
            <h2>최근 제출 목록</h2>
            <p className="meta-description">가장 최근에 들어온 응답 30건을 표시합니다.</p>
          </div>
          <label className="field response-toolbar-filter">
            <span>기록 보기</span>
            <select value={recordFilter} onChange={(event) => setRecordFilter(event.target.value)}>
              <option value="active">정상 설문 응답</option>
              <option value="all">전체</option>
              {canIncludeDeletedResponses && (
                <option value="includeDeleted">삭제된 설문 응답 포함</option>
              )}
              <option value="pending">미처리</option>
              <option value="completed">처리완료</option>
            </select>
          </label>
        </div>
        {loading ? (
          <div className="empty-state compact-state">최근 응답을 불러오는 중입니다.</div>
        ) : filteredResponses.length === 0 ? (
          <div className="empty-state compact-state">최근 응답이 없습니다.</div>
        ) : (
          <div className="admin-list">
            {filteredResponses.map((response) => {
              const linkedSurvey = response.surveyId ? surveyMap.get(response.surveyId) : null;
              const deletedMeta = getDeletedSurveyResponseMeta(response, linkedSurvey);
              const title = linkedSurvey?.title ?? response.surveyTitle ?? '삭제된 설문';
              return (
                <div className="admin-list-item" key={response.id}>
                  <div>
                    <strong>{title}</strong>
                    <p>{formatFirestoreDate(response.submittedAt)}</p>
                    <p>
                      {deletedMeta.deleted ? `${deletedMeta.label} 응답 기록` : '정상 설문 응답 기록'} ·{' '}
                      {getMaskedRespondentDisplay(response)}
                    </p>
                  </div>
                  <div className="mini-actions">
                    <span className={deletedMeta.className}>
                      {deletedMeta.label}
                    </span>
                    <button
                      className="secondary-button"
                      onClick={() => setSelectedResponse(response)}
                      type="button"
                    >
                      상세 보기
                    </button>
                    {response.surveyId ? (
                      <Link className="secondary-button" to={`/admin/surveys/${response.surveyId}/responses`}>
                        응답 보기
                      </Link>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <ResponseDetailModal
        isOpen={Boolean(selectedResponse)}
        onClose={() => setSelectedResponse(null)}
        response={selectedResponse}
        survey={selectedResponseSurvey}
      />
    </section>
  );
}

export default RecentResponsesPage;
