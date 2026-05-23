import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

function AdminRoute({
  children,
  requireCreate = false,
  requireManageUsers = false,
  requireSuperAdmin = false,
}) {
  const {
    loading,
    user,
    canAccessAdmin,
    canCreateSurvey,
    canManageUsers,
    isSuperAdmin,
    isPendingApproval,
    isInactiveUser,
    isBlockedUser,
    isInternalUser,
    profileError,
  } = useAuth();

  if (loading) {
    return <div className="empty-state">로그인 상태를 확인하고 있습니다.</div>;
  }

  if (!user) {
    return <div className="empty-state">관리자 기능은 Google 로그인 후 이용할 수 있습니다.</div>;
  }

  if (!isInternalUser || !canAccessAdmin) {
    if (profileError) {
      return <div className="empty-state">{profileError}</div>;
    }

    if (isPendingApproval) {
      return <div className="empty-state">관리자 승인 대기 중입니다. 승인 후 관리자 기능을 이용할 수 있습니다.</div>;
    }

    if (isInactiveUser) {
      return <div className="empty-state">현재 비활성화된 계정입니다. 관리자에게 문의해주세요.</div>;
    }

    if (isBlockedUser) {
      return <div className="empty-state">접근이 차단된 계정입니다. 관리자에게 문의해주세요.</div>;
    }

    return (
      <div className="empty-state">
        영중종합사회복지관 내부 계정으로 로그인한 사용자만 관리자 영역을 이용할 수 있습니다.
      </div>
    );
  }

  if (requireCreate && !canCreateSurvey) {
    return <Navigate to="/admin" replace />;
  }

  if (requireManageUsers && !canManageUsers) {
    return <Navigate to="/admin" replace />;
  }

  if (requireSuperAdmin && !isSuperAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

export default AdminRoute;
