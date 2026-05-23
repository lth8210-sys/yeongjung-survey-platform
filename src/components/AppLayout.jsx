import { Link, NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

function AppLayout() {
  const {
    user,
    canAccessAdmin,
    canCreateSurvey,
    canManageUsers,
    isInternalUser,
    isSuperAdmin,
    roleLabel,
    statusLabel,
    signInWithGoogle,
    logout,
    isFirebaseConfigured,
    firebaseStatusMessage,
    profileError,
  } = useAuth();
  const [loginMessage, setLoginMessage] = useState('');

  const handleGoogleLogin = async () => {
    try {
      setLoginMessage('');
      await signInWithGoogle();
    } catch (error) {
      setLoginMessage(error.message || 'Google 로그인에 실패했습니다.');
    }
  };

  return (
    <div className="app-shell">
      {!isFirebaseConfigured && firebaseStatusMessage && (
        <div className="config-notice">
          <strong>Firebase 설정 필요</strong>
          <p>{firebaseStatusMessage}</p>
        </div>
      )}
      {(loginMessage || profileError) && (
        <div className="config-notice">
          <strong>로그인 확인 필요</strong>
          <p>{loginMessage || profileError}</p>
        </div>
      )}

      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-badge">YJ</span>
          <div>
            <strong>영중 폼</strong>
            <p>설문·신청·접수를 한 곳에서</p>
          </div>
        </Link>

        <nav className="topnav">
          <NavLink to="/">홈</NavLink>
          <NavLink to="/surveys">설문 목록</NavLink>
          {canCreateSurvey && <NavLink to="/admin/surveys/new">새 폼 만들기</NavLink>}
          {canAccessAdmin && <NavLink to="/admin/responses">응답 관리</NavLink>}
          {canManageUsers && <NavLink to="/admin/users">사용자 관리</NavLink>}
          {canManageUsers && <NavLink to="/admin/audit-logs">감사로그</NavLink>}
          {isSuperAdmin && <NavLink to="/admin/settings">관리자 설정</NavLink>}
        </nav>

        <div className="auth-box">
          {user ? (
            <>
              <div className="user-summary">
                <strong>{user.displayName ?? '로그인 사용자'}</strong>
                <span>{user.email}</span>
                {canAccessAdmin && <span>{roleLabel}</span>}
                {user && isInternalUser && !canAccessAdmin && <span>{statusLabel}</span>}
              </div>
              <button className="secondary-button" onClick={logout} type="button">
                로그아웃
              </button>
            </>
          ) : (
            <button className="primary-button" onClick={handleGoogleLogin} type="button">
              Google 로그인
            </button>
          )}
        </div>
      </header>

      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}

export default AppLayout;
