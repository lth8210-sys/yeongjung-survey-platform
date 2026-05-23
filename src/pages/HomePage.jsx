import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchManagedRecentResponses,
  fetchManagedSurveys,
  hydrateSurveyResponseCounts,
  normalizeResponseProcessingStatus,
  RESPONSE_PROCESSING_STATUSES,
} from '../firebase/surveys';

function toSeoulDateKey(value) {
  const date = value?.toDate?.() ?? (value ? new Date(value) : null);

  if (!date || Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(date);
}

function HomePage() {
  const {
    user,
    canAccessAdmin,
    canCreateSurvey,
    canManageUsers,
    isInternalUser,
    isPendingApproval,
    isInactiveUser,
    isBlockedUser,
    isSuperAdmin,
    role,
    roleLabel,
    statusLabel,
    signInWithGoogle,
    isFirebaseConfigured,
    firebaseStatusMessage,
    profileError,
  } = useAuth();
  const [loginMessage, setLoginMessage] = useState('');
  const [summary, setSummary] = useState({
    todayResponses: 0,
    pendingResponses: 0,
    recentSurveys: [],
  });

  const handleAdminLogin = async () => {
    try {
      setLoginMessage('');
      await signInWithGoogle();
    } catch (error) {
      setLoginMessage(error.message || 'Google 로그인에 실패했습니다.');
    }
  };

  useEffect(() => {
    if (!canAccessAdmin || !isFirebaseConfigured) {
      return;
    }

    async function loadSummary() {
      try {
        const [responses, surveys] = await Promise.all([
          fetchManagedRecentResponses({ uid: user?.uid, email: user?.email ?? '', role }, 20),
          fetchManagedSurveys({ uid: user?.uid, email: user?.email ?? '', role }),
        ]);
        const hydratedSurveys = await hydrateSurveyResponseCounts(surveys);
        const todayKey = toSeoulDateKey(new Date());
        setSummary({
          todayResponses: responses.filter((response) => toSeoulDateKey(response.submittedAt) === todayKey).length,
          pendingResponses: responses.filter(
            (response) =>
              normalizeResponseProcessingStatus(response.applicationStatus) ===
              RESPONSE_PROCESSING_STATUSES.RECEIVED,
          ).length,
          recentSurveys: hydratedSurveys.slice(0, 3),
        });
      } catch (_error) {
        setSummary({
          todayResponses: 0,
          pendingResponses: 0,
          recentSurveys: [],
        });
      }
    }

    loadSummary();
  }, [canAccessAdmin, isFirebaseConfigured, role, user?.email, user?.uid]);

  const primaryAction = canCreateSurvey
    ? { label: '+ 새 폼 만들기', to: '/admin/surveys/new' }
    : canAccessAdmin
      ? { label: '설문 목록 보기', to: '/admin/surveys' }
      : null;

  const quickActions = useMemo(() => {
    const actions = [];

    if (canCreateSurvey) {
      actions.push({
        to: '/admin/surveys/new',
        title: '새 폼 만들기',
        description: '설문, 신청, 접수를 새로 만듭니다.',
      });
    }

    if (canAccessAdmin) {
      actions.push({
        to: '/admin/surveys',
        title: role === 'creator' ? '내 설문 목록' : '설문 목록',
        description:
          role === 'creator'
            ? '내가 만든 설문과 진행 중 설문을 봅니다.'
            : '진행 중인 설문과 전체 목록을 확인합니다.',
      });
      actions.push({
        to: '/admin/responses',
        title: '최근 응답 확인',
        description: `오늘 ${summary.todayResponses}건 / 미처리 ${summary.pendingResponses}건`,
      });
    }

    if (canManageUsers) {
      actions.push({
        to: '/admin/users',
        title: '사용자 관리',
        description: '직원 권한과 사전 등록을 관리합니다.',
      });
    }

    if (isSuperAdmin) {
      actions.push({
        to: '/admin/settings',
        title: '시스템 설정',
        description: '운영 도구와 관리자 설정을 확인합니다.',
      });
    }

    return actions;
  }, [canAccessAdmin, canCreateSurvey, canManageUsers, isSuperAdmin, role, summary.pendingResponses, summary.todayResponses]);

  return (
    <section className="hero-grid">
      <article className="hero-card">
        <span className="eyebrow">영중종합사회복지관</span>
        <h1>영중 폼</h1>
        <p>
          설문 · 신청 · 접수를 만들고
          <br />
          응답과 운영까지 한 곳에서 관리하세요.
        </p>
        {canAccessAdmin && <div className="dashboard-role-badge">현재 권한: {roleLabel}</div>}
        {!canAccessAdmin && user && isInternalUser && (
          <div className="inline-note">
            {profileError ||
              (isPendingApproval && '관리자 승인 대기 중입니다. 승인 후 설문 생성과 운영 기능을 이용할 수 있습니다.')}
            {isInactiveUser && '현재 비활성화된 계정입니다. 관리자에게 문의해주세요.'}
            {isBlockedUser && '기관 관리자에 의해 접근이 차단된 계정입니다.'}
            {!profileError && !isPendingApproval && !isInactiveUser && !isBlockedUser && `현재 상태: ${statusLabel}`}
          </div>
        )}
        {loginMessage && <div className="form-message">{loginMessage}</div>}
        <div className="hero-actions">
          {primaryAction ? (
            <Link className="primary-button" to={primaryAction.to}>
              {primaryAction.label}
            </Link>
          ) : (
            !user && (
              <button
                className="primary-button"
                disabled={!isFirebaseConfigured}
                onClick={handleAdminLogin}
                type="button"
              >
                관리자 로그인
              </button>
            )
          )}
          <Link className="secondary-button" to={canAccessAdmin ? '/admin/surveys' : '/surveys'}>
            설문 목록 보기
          </Link>
          {canAccessAdmin && (
            <Link className="secondary-button" to="/admin/responses">
              최근 응답 확인
            </Link>
          )}
        </div>
        {canAccessAdmin && (
          <div className="home-recent-panel">
            <div className="builder-header-row">
              <div>
                <strong>최근 작업</strong>
                <p className="meta-description">최근 설문과 응답 흐름을 바로 이어서 확인하세요.</p>
              </div>
            </div>
            {summary.recentSurveys.length === 0 ? (
              <div className="inline-note">
                {firebaseStatusMessage || '최근 작업이 없습니다. 새 폼을 만들어 시작해보세요.'}
              </div>
            ) : (
              <div className="admin-list compact-admin-list">
                {summary.recentSurveys.map((survey) => (
                  <Link className="admin-list-item admin-list-item-link" key={survey.id} to={`/admin/surveys/${survey.id}/edit`}>
                    <div>
                      <strong>{survey.title}</strong>
                      <p>{survey.responseCount ?? 0}건 응답 · {survey.status}</p>
                    </div>
                    <span>열기</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}
      </article>

      <aside className="info-panel">
        <h2>빠른 실행</h2>
        <div className="home-shortcut-grid">
          {quickActions.map((action) => (
            <Link className="home-shortcut-card home-shortcut-card-link" key={action.title} to={action.to}>
              <strong>{action.title}</strong>
              <p>{action.description}</p>
            </Link>
          ))}
        </div>
      </aside>
    </section>
  );
}

export default HomePage;
