import { createContext, useContext, useEffect, useState } from 'react';
import {
  auth,
  getFirebaseStatusMessage,
  googleProvider,
  isFirebaseConfigured,
} from '../firebase/config';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  canCreateSurveys,
  canDownloadResponses,
  canManageUsers,
  canViewSurveyResponses,
  canEditSurvey,
  canChangeSurveyStatus,
  getRoleLabel,
  getUserStatusLabel,
  isInternalEmail,
  isSuperAdminEmail,
  isSurveyOwner,
  normalizeUserRole,
  normalizeUserStatus,
  ensureUserProfile,
  USER_ROLES,
  USER_STATUSES,
} from '../firebase/users';

const AuthContext = createContext(null);

function getFriendlyAuthErrorMessage(error) {
  const code = error?.code ?? '';
  const message = String(error?.message ?? '');

  if (code === 'auth/unauthorized-domain' || message.includes('auth/unauthorized-domain')) {
    return '현재 접속 주소가 Firebase 승인 도메인에 등록되어 있지 않아 Google 로그인이 차단되었습니다. 개발 중에는 http://localhost:5173 으로 접속하거나 Firebase Authentication 승인 도메인에 127.0.0.1을 추가해주세요.';
  }

  if (code === 'auth/cancelled-popup-request' || message.includes('auth/cancelled-popup-request')) {
    return 'Google 로그인 창이 중복으로 열렸거나 이전 로그인 요청이 취소되었습니다. 잠시 후 Google 로그인을 한 번만 눌러 다시 시도해주세요.';
  }

  if (code === 'auth/popup-closed-by-user' || message.includes('auth/popup-closed-by-user')) {
    return 'Google 로그인 창이 닫혀 로그인이 완료되지 않았습니다. 다시 로그인해주세요.';
  }

  if (code === 'permission-denied' || message.includes('Missing or insufficient permissions')) {
    return '로그인은 되었지만 사용자 권한 정보를 Firestore에 저장하지 못했습니다. 사전등록 정보와 Firestore 보안 규칙을 확인해주세요.';
  }

  return message || 'Google 로그인 처리 중 오류가 발생했습니다.';
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  useEffect(() => {
    if (!auth) {
      setLoading(false);
      return undefined;
    }

    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setLoading(true);
      setUser(nextUser);

      if (!nextUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      if (!isInternalEmail(nextUser.email)) {
        setProfile(null);
        setLoading(false);
        return;
      }

      try {
        const nextProfile = await ensureUserProfile(nextUser);
        setProfile(nextProfile);
      } catch (error) {
        console.error('사용자 프로필 동기화 실패:', error);
        setProfile({
          uid: nextUser.uid,
          email: nextUser.email ?? '',
          displayName: nextUser.displayName ?? '',
          role: null,
          status: USER_STATUSES.PENDING,
          profileError: getFriendlyAuthErrorMessage(error),
        });
      } finally {
        setLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  const role = normalizeUserRole(profile?.role, user?.email);
  const status = normalizeUserStatus(
    isSuperAdminEmail(user?.email) ? USER_STATUSES.ACTIVE : profile?.status,
  );
  const isInternalUser = isInternalEmail(user?.email);
  const isActiveAccount =
    Boolean(user) &&
    isInternalUser &&
    (status === USER_STATUSES.ACTIVE || role === USER_ROLES.SUPER_ADMIN);
  const canAccessAdmin = isActiveAccount && Boolean(role);
  const value = {
    user,
    profile,
    role,
    roleLabel: getRoleLabel(role),
    status,
    statusLabel: getUserStatusLabel(status),
    loading,
    isAdmin: canAccessAdmin,
    isInternalUser,
    canAccessAdmin,
    isPendingApproval: Boolean(user) && isInternalUser && status === USER_STATUSES.PENDING,
    isBlockedUser: Boolean(user) && isInternalUser && status === USER_STATUSES.BLOCKED,
    profileError: profile?.profileError ?? '',
    isInactiveUser: Boolean(user) && isInternalUser && status === USER_STATUSES.INACTIVE,
    canCreateSurvey: canAccessAdmin && canCreateSurveys(role),
    canDownloadResponses: canAccessAdmin && canDownloadResponses(role),
    canManageUsers: canAccessAdmin && canManageUsers(role),
    canEditSurvey: (survey) => canAccessAdmin && canEditSurvey(role, survey, user),
    canViewSurveyResponses: (survey) => canAccessAdmin && canViewSurveyResponses(role, survey, user),
    canChangeSurveyStatus: (survey) => canAccessAdmin && canChangeSurveyStatus(role, survey, user),
    isSurveyOwner: (survey) => isSurveyOwner(survey, user),
    isSuperAdmin: role === USER_ROLES.SUPER_ADMIN,
    isFirebaseConfigured,
    firebaseStatusMessage: getFirebaseStatusMessage(),
    signInWithGoogle: async () => {
      if (!auth || !googleProvider) {
        throw new Error(getFirebaseStatusMessage() || 'Google 로그인을 사용할 수 없습니다.');
      }

      try {
        const result = await signInWithPopup(auth, googleProvider);

        if (result.user && isInternalEmail(result.user.email)) {
          const nextProfile = await ensureUserProfile(result.user);
          setProfile(nextProfile);
        }

        return result;
      } catch (error) {
        console.error('Google 로그인 실패:', error);
        throw new Error(getFriendlyAuthErrorMessage(error));
      }
    },
    logout: async () => {
      if (!auth) {
        return;
      }

      return signOut(auth);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
