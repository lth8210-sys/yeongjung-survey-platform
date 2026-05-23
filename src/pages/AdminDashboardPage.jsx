import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  extractApplicationResponseSummary,
  fetchManagedSurveys,
  fetchResponsesForSurvey,
  formatFirestoreDate,
  getFormTypeMeta,
  getPublicSurveyState,
  getQuestionOptionItems,
  getQuotaSummary,
  getResponseProcessingStatusMeta,
  getSurveyStatusMeta,
  hydrateSurveyResponseCounts,
  isApplicationFormType,
  normalizeResponseProcessingStatus,
  normalizeSurveyStatus,
  QUESTION_TYPES,
  RESPONSE_PROCESSING_STATUSES,
  SURVEY_STATUSES,
} from '../firebase/surveys';

const CLOSE_SOON_MS = 1000 * 60 * 60 * 24 * 3;

function toMillis(value) {
  if (value?.toDate) {
    return value.toDate().getTime();
  }

  if (!value) {
    return null;
  }

  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function isTodayInSeoul(value) {
  const millis = toMillis(value);

  if (!millis) {
    return false;
  }

  const formatter = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' });
  return formatter.format(new Date(millis)) === formatter.format(new Date());
}

function formatSlotLabel(slot) {
  const title = slot.title || slot.label || '제목 없는 슬롯';
  const detail = [slot.date, slot.time, slot.place, slot.ageGroup].filter(Boolean).join(' / ');
  return detail ? `${title} · ${detail}` : title;
}

function AdminDashboardPage() {
  const { user, roleLabel, role, canCreateSurvey, firebaseStatusMessage, isFirebaseConfigured } = useAuth();
  const [surveys, setSurveys] = useState([]);
  const [responses, setResponses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setError(firebaseStatusMessage || 'Firebase 설정이 필요합니다.');
      setLoading(false);
      return;
    }

    async function loadDashboardData() {
      try {
        const surveyResult = await fetchManagedSurveys({ uid: user?.uid, email: user?.email ?? '', role });
        const hydratedSurveys = await hydrateSurveyResponseCounts(surveyResult);
        const userAccess = { uid: user?.uid ?? '', email: user?.email ?? '', role };
        const responseGroups = await Promise.all(
          hydratedSurveys.map((survey) => fetchResponsesForSurvey(survey, userAccess)),
        );
        const allResponses = responseGroups
          .flat()
          .sort((first, second) => (toMillis(second.submittedAt) ?? 0) - (toMillis(first.submittedAt) ?? 0));

        setSurveys(hydratedSurveys);
        setResponses(allResponses);
      } catch (loadError) {
        setError(loadError.message || '대시보드 데이터를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    }

    loadDashboardData();
  }, [firebaseStatusMessage, isFirebaseConfigured, role, user?.email, user?.uid]);

  const dashboardMetrics = useMemo(() => {
    const openSurveys = surveys.filter((survey) => getPublicSurveyState(survey).key === 'open');
    const totalResponses = surveys.reduce(
      (count, survey) => count + getQuotaSummary(survey).responseCount,
      0,
    );
    const applicationSurveys = surveys.filter((survey) => isApplicationFormType(survey.formType));
    const closingSoonSurveys = applicationSurveys
      .filter((survey) => {
        const publicState = getPublicSurveyState(survey);
        const closesAt = toMillis(survey.closesAt);

        return publicState.key === 'open' && closesAt && closesAt - Date.now() <= CLOSE_SOON_MS;
      })
      .sort((first, second) => (toMillis(first.closesAt) ?? 0) - (toMillis(second.closesAt) ?? 0));
    const applicationQuota = applicationSurveys.reduce(
      (summary, survey) => {
        const quotaSummary = getQuotaSummary(survey);
        return {
          used: summary.used + quotaSummary.responseCount,
          max:
            summary.max +
            (quotaSummary.quotaEnabled && quotaSummary.maxResponses ? quotaSummary.maxResponses : 0),
        };
      },
      { used: 0, max: 0 },
    );
    const slotItems = applicationSurveys.flatMap((survey) =>
      (survey.questions ?? [])
        .filter((question) => question.type === QUESTION_TYPES.APPLICATION_SLOT_CHOICE)
        .flatMap((question) =>
          getQuestionOptionItems(question, survey.optionQuotaCounts).map((option) => ({
            surveyId: survey.id,
            surveyTitle: survey.title,
            questionId: question.id,
            questionTitle: question.title,
            ...option,
          })),
        ),
    );
    const closedSlots = slotItems.filter((slot) => slot.isClosed);
    const topSlots = [...slotItems]
      .sort((first, second) => second.currentCount - first.currentCount)
      .slice(0, 5);
    const roomySlots = [...slotItems]
      .filter((slot) => typeof slot.remainingCount === 'number' && slot.remainingCount > 0)
      .sort((first, second) => second.remainingCount - first.remainingCount)
      .slice(0, 5);
    const pendingProcessingCount = responses.filter(
      (response) =>
        normalizeResponseProcessingStatus(response.applicationStatus) ===
        RESPONSE_PROCESSING_STATUSES.RECEIVED,
    ).length;
    const todayNewApplications = responses.filter((response) => isTodayInSeoul(response.submittedAt)).length;
    const recentResponses = responses.slice(0, 8).map((response) => {
      const matchedSurvey = surveys.find((survey) => survey.id === response.surveyId);
      const summary =
        matchedSurvey && isApplicationFormType(matchedSurvey.formType)
          ? extractApplicationResponseSummary(matchedSurvey.questions, response)
          : null;

      return {
        ...response,
        surveyTitle: matchedSurvey?.title ?? response.surveyTitle,
        summary,
      };
    });

    return {
      openSurveys,
      totalResponses,
      applicationSurveys,
      closingSoonSurveys,
      applicationQuota,
      slotItems,
      closedSlots,
      topSlots,
      roomySlots,
      pendingProcessingCount,
      todayNewApplications,
      recentResponses,
    };
  }, [responses, surveys]);

  const {
    openSurveys,
    totalResponses,
    applicationSurveys,
    closingSoonSurveys,
    applicationQuota,
    slotItems,
    closedSlots,
    topSlots,
    roomySlots,
    pendingProcessingCount,
    todayNewApplications,
    recentResponses,
  } = dashboardMetrics;

  return (
    <section className="stack-section">
      <div className="section-heading">
        <div>
          <span className="eyebrow">운영형 대시보드</span>
          <h1>영중 폼 운영 현황을 한눈에 확인하세요.</h1>
          <p>{user?.email} 계정으로 로그인되어 있으며 현재 역할은 {roleLabel}입니다.</p>
        </div>
        {canCreateSurvey && (
          <Link className="primary-button" to="/admin/surveys/new">
            새 설문 만들기
          </Link>
        )}
      </div>

      {error && <div className="form-message">{error}</div>}

      <div className="dashboard-grid dashboard-metrics-grid">
        <article className="dashboard-card metric-card">
          <span className="status-chip published-chip">진행 중</span>
          <h2>진행 중 폼 수</h2>
          <strong className="metric-value">{openSurveys.length}개</strong>
          <p>현재 공개 중이며 응답 또는 신청을 받고 있는 폼입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip draft-chip">마감 임박</span>
          <h2>접수 마감 임박 폼</h2>
          <strong className="metric-value">{closingSoonSurveys.length}개</strong>
          <p>3일 이내 접수가 종료되는 신청형 폼입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip published-chip">누적 응답</span>
          <h2>총 응답 수</h2>
          <strong className="metric-value">{totalResponses}건</strong>
          <p>관리 중인 모든 설문과 신청서의 전체 제출 건수입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip published-chip">정원 현황</span>
          <h2>신청형 전체 정원</h2>
          <strong className="metric-value">
            {applicationQuota.used} / {applicationQuota.max || '제한 없음'}
          </strong>
          <p>신청형 폼 전체 응답 수와 설정된 최대 정원을 합산한 값입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip closed-chip">슬롯 운영</span>
          <h2>마감된 슬롯 수</h2>
          <strong className="metric-value">
            {closedSlots.length} / {slotItems.length || 0}
          </strong>
          <p>신청 슬롯형 질문에서 이미 마감된 회차와 전체 슬롯 수입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip draft-chip">처리 대기</span>
          <h2>처리 상태 대기 건수</h2>
          <strong className="metric-value">{pendingProcessingCount}건</strong>
          <p>아직 `접수됨` 상태로 남아 있어 후속 확인이 필요한 신청 건입니다.</p>
        </article>
        <article className="dashboard-card metric-card">
          <span className="status-chip published-chip">오늘 신청</span>
          <h2>오늘 새 신청 건수</h2>
          <strong className="metric-value">{todayNewApplications}건</strong>
          <p>오늘 접수된 최신 신청·응답 건수를 기준으로 집계합니다.</p>
        </article>
      </div>

      <div className="dashboard-split">
        <article className="panel">
          <div className="builder-header-row">
            <div>
              <h2>운영 중 폼</h2>
              <p className="meta-description">
                공개 여부, 응답 수, 정원 상태를 함께 확인할 수 있습니다.
              </p>
            </div>
            <Link className="secondary-button" to="/surveys">
              전체 보기
            </Link>
          </div>
          {loading ? (
            <div className="empty-state compact-state">설문 현황을 불러오는 중입니다.</div>
          ) : surveys.length === 0 ? (
            <div className="empty-state compact-state">등록된 설문이 없습니다.</div>
          ) : (
            <div className="admin-list">
              {surveys.map((survey) => {
                const quotaSummary = getQuotaSummary(survey);
                const publicState = getPublicSurveyState(survey);

                return (
                  <div className="admin-list-item" key={survey.id}>
                    <div>
                      <strong>{survey.title}</strong>
                      <p>
                        {getFormTypeMeta(survey.formType).label} ·{' '}
                        {getSurveyStatusMeta(survey.status).label} · 질문 수 {survey.questions?.length ?? 0}개
                      </p>
                      <p>
                        {publicState.label} · 응답 {quotaSummary.responseCount}건
                        {quotaSummary.quotaEnabled && quotaSummary.maxResponses
                          ? ` / 최대 ${quotaSummary.maxResponses}건`
                          : ' / 제한 없음'}
                      </p>
                    </div>
                    <div className="mini-actions">
                      <Link className="secondary-button" to={`/admin/surveys/${survey.id}/edit`}>
                        수정
                      </Link>
                      {normalizeSurveyStatus(survey.status) === SURVEY_STATUSES.DRAFT ? (
                        <Link className="secondary-button" to={`/admin/surveys/${survey.id}/edit`}>
                          수정 계속하기
                        </Link>
                      ) : (
                        <Link className="secondary-button" to={`/admin/surveys/${survey.id}/responses`}>
                          응답 보기
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="builder-header-row">
            <div>
              <h2>최근 제출 목록</h2>
              <p className="meta-description">최근 들어온 응답과 신청을 시간순으로 보여줍니다.</p>
            </div>
          </div>
          {loading ? (
            <div className="empty-state compact-state">최근 응답을 불러오는 중입니다.</div>
          ) : recentResponses.length === 0 ? (
            <div className="empty-state compact-state">아직 수집된 응답이 없습니다.</div>
          ) : (
            <div className="admin-list">
              {recentResponses.map((response) => (
                <div className="admin-list-item" key={response.id}>
                  <div>
                    <strong>{response.surveyTitle}</strong>
                    <p>{formatFirestoreDate(response.submittedAt)}</p>
                    {response.summary && (
                      <p>
                        {response.summary.name} · {response.summary.phone} · {response.summary.primaryValue}
                      </p>
                    )}
                  </div>
                  <span className={getResponseProcessingStatusMeta(response.applicationStatus).className}>
                    {getResponseProcessingStatusMeta(response.applicationStatus).label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <div className="dashboard-split">
        <article className="panel">
          <div className="builder-header-row">
            <div>
              <h2>회차별 신청 현황</h2>
              <p className="meta-description">현재 신청이 많이 몰린 슬롯 순으로 보여줍니다.</p>
            </div>
          </div>
          {loading ? (
            <div className="empty-state compact-state">신청 현황을 불러오는 중입니다.</div>
          ) : topSlots.length === 0 ? (
            <div className="empty-state compact-state">신청 슬롯형 질문이 아직 없습니다.</div>
          ) : (
            <div className="admin-list">
              {topSlots.map((slot) => (
                <div className="admin-list-item" key={`top-slot-${slot.surveyId}-${slot.questionId}-${slot.value}`}>
                  <div>
                    <strong>{slot.surveyTitle}</strong>
                    <p>{formatSlotLabel(slot)}</p>
                  </div>
                  <div className="dashboard-metric-inline">
                    <strong>{slot.currentCount}명</strong>
                    <p>{slot.capacity ? `총 ${slot.capacity}명` : '정원 미설정'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="builder-header-row">
            <div>
              <h2>잔여 인원 많은 슬롯</h2>
              <p className="meta-description">아직 여유가 큰 회차를 바로 확인할 수 있습니다.</p>
            </div>
          </div>
          {loading ? (
            <div className="empty-state compact-state">슬롯 잔여 현황을 불러오는 중입니다.</div>
          ) : roomySlots.length === 0 ? (
            <div className="empty-state compact-state">잔여 인원이 표시되는 슬롯이 없습니다.</div>
          ) : (
            <div className="admin-list">
              {roomySlots.map((slot) => (
                <div className="admin-list-item" key={`roomy-slot-${slot.surveyId}-${slot.questionId}-${slot.value}`}>
                  <div>
                    <strong>{slot.surveyTitle}</strong>
                    <p>{formatSlotLabel(slot)}</p>
                  </div>
                  <div className="dashboard-metric-inline">
                    <strong>잔여 {slot.remainingCount}명</strong>
                    <p>{slot.capacity ? `현재 ${slot.currentCount} / ${slot.capacity}` : '정원 미설정'}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      {closingSoonSurveys.length > 0 && (
        <article className="panel">
          <div className="builder-header-row">
            <div>
              <h2>접수 마감 임박 폼</h2>
              <p className="meta-description">곧 마감되는 신청형 폼을 미리 확인해 안내에 활용하세요.</p>
            </div>
          </div>
          <div className="admin-list">
            {closingSoonSurveys.map((survey) => (
              <div className="admin-list-item" key={`closing-${survey.id}`}>
                <div>
                  <strong>{survey.title}</strong>
                  <p>
                    {getFormTypeMeta(survey.formType).label} · 종료 예정{' '}
                    {survey.closesAt ? formatFirestoreDate(survey.closesAt) : '미설정'}
                  </p>
                </div>
                <Link className="secondary-button" to={`/admin/surveys/${survey.id}/responses`}>
                  응답 보기
                </Link>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}

export default AdminDashboardPage;
