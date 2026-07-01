import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, getFirebaseStatusMessage, isFirebaseConfigured } from './config';

export const INTERNAL_EMAIL_DOMAIN = 'yeongjung.or.kr';
// SYNC REQUIRED: 이 목록을 변경하면 firestore.rules의 isSuperAdminEmail()과
// protectedSuperAdminEmail() 두 함수도 반드시 함께 변경해야 합니다.
export const SUPER_ADMIN_EMAILS = [
  'lth8210@yeongjung.or.kr',
  'yj100@yeongjung.or.kr',
];

export const USER_ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  CREATOR: 'creator',
  VIEWER: 'viewer',
};

export const SURVEY_VISIBILITIES = {
  PRIVATE: 'private',
  ORGANIZATION: 'organization',
};

export const USER_STATUSES = {
  ACTIVE: 'active',
  PENDING: 'pending',
  INACTIVE: 'inactive',
  BLOCKED: 'blocked',
};

const ROLE_PRIORITY = {
  [USER_ROLES.VIEWER]: 1,
  [USER_ROLES.CREATOR]: 2,
  [USER_ROLES.ADMIN]: 3,
  [USER_ROLES.SUPER_ADMIN]: 4,
};

function ensureFirestoreReady() {
  if (!isFirebaseConfigured || !db) {
    throw new Error(getFirebaseStatusMessage() || 'Firestore가 아직 설정되지 않았습니다.');
  }
}

const usersCollection = db ? collection(db, 'users') : null;
const membershipsCollection = db ? collection(db, 'memberships') : null;

export function normalizeEmailKey(email = '') {
  return String(email).trim().toLowerCase();
}

export function isInternalEmail(email = '') {
  return String(email).trim().toLowerCase().endsWith(`@${INTERNAL_EMAIL_DOMAIN}`);
}

export function isSuperAdminEmail(email = '') {
  return SUPER_ADMIN_EMAILS.includes(String(email).trim().toLowerCase());
}

export function normalizeUserRole(role, email = '') {
  if (isSuperAdminEmail(email)) {
    return USER_ROLES.SUPER_ADMIN;
  }

  const normalizedRoleLabel = String(role ?? '').trim().toLowerCase();
  const legacyRoleMap = {
    '슈퍼관리자': USER_ROLES.SUPER_ADMIN,
    '관리자': USER_ROLES.ADMIN,
    '제작자': USER_ROLES.CREATOR,
    '조회자': USER_ROLES.VIEWER,
    '직원': USER_ROLES.VIEWER,
    superadmin: USER_ROLES.SUPER_ADMIN,
    super_admin: USER_ROLES.SUPER_ADMIN,
    'super admin': USER_ROLES.SUPER_ADMIN,
    staff: USER_ROLES.VIEWER,
  };

  if (legacyRoleMap[role]) {
    return legacyRoleMap[role];
  }

  if (legacyRoleMap[normalizedRoleLabel]) {
    return legacyRoleMap[normalizedRoleLabel];
  }

  if (Object.values(USER_ROLES).includes(role)) {
    return role;
  }

  return isInternalEmail(email) ? USER_ROLES.CREATOR : null;
}

export function normalizeDepartment(value = '') {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeUserStatus(status) {
  if (status === true) {
    return USER_STATUSES.ACTIVE;
  }

  if (status === false) {
    return USER_STATUSES.INACTIVE;
  }

  switch (String(status ?? '').trim().toLowerCase()) {
    case USER_STATUSES.PENDING:
      return USER_STATUSES.PENDING;
    case USER_STATUSES.INACTIVE:
      return USER_STATUSES.INACTIVE;
    case USER_STATUSES.BLOCKED:
      return USER_STATUSES.BLOCKED;
    case USER_STATUSES.ACTIVE:
    default:
      return USER_STATUSES.ACTIVE;
  }
}

function resolveStoredUserStatus(data = {}, fallback = USER_STATUSES.ACTIVE) {
  if (data.status !== undefined && data.status !== null) {
    return normalizeUserStatus(data.status);
  }

  if (data.isActive !== undefined && data.isActive !== null) {
    return normalizeUserStatus(data.isActive);
  }

  if (data.active !== undefined && data.active !== null) {
    return normalizeUserStatus(data.active);
  }

  if (data.is_active !== undefined && data.is_active !== null) {
    return normalizeUserStatus(data.is_active);
  }

  return normalizeUserStatus(fallback);
}

export function getUserStatusLabel(status) {
  switch (normalizeUserStatus(status)) {
    case USER_STATUSES.PENDING:
      return '승인 대기';
    case USER_STATUSES.INACTIVE:
      return '비활성';
    case USER_STATUSES.BLOCKED:
      return '차단';
    case USER_STATUSES.ACTIVE:
    default:
      return '활성';
  }
}

async function findMembershipByEmail(normalizedEmail) {
  const directSnapshot = await getDoc(doc(db, 'memberships', normalizedEmail));
  if (directSnapshot.exists()) {
    return {
      id: directSnapshot.id,
      ...directSnapshot.data(),
    };
  }

  const querySnapshot = await getDocs(
    query(membershipsCollection, where('email', '==', normalizedEmail)),
  );

  if (querySnapshot.empty) {
    return null;
  }

  const [firstDoc] = querySnapshot.docs;
  return {
    id: firstDoc.id,
    ...firstDoc.data(),
  };
}

export function getRoleLabel(role) {
  switch (role) {
    case USER_ROLES.SUPER_ADMIN:
      return '슈퍼관리자';
    case USER_ROLES.ADMIN:
      return '관리자';
    case USER_ROLES.CREATOR:
      return '제작자';
    case USER_ROLES.VIEWER:
      return '조회자';
    default:
      return '미지정';
  }
}

export function hasRoleAtLeast(role, minimumRole) {
  return (ROLE_PRIORITY[role] ?? 0) >= (ROLE_PRIORITY[minimumRole] ?? 0);
}

export function canCreateSurveys(role) {
  return hasRoleAtLeast(role, USER_ROLES.CREATOR);
}

export function canManageAllSurveys(role) {
  return hasRoleAtLeast(role, USER_ROLES.ADMIN);
}

export function canManageUsers(role) {
  return hasRoleAtLeast(role, USER_ROLES.ADMIN);
}

export function canDeleteResponses(role) {
  return hasRoleAtLeast(role, USER_ROLES.ADMIN);
}

export function canManageSurveyResponses(role) {
  return hasRoleAtLeast(role, USER_ROLES.ADMIN);
}

export function canDownloadResponses(role) {
  return hasRoleAtLeast(role, USER_ROLES.CREATOR);
}

export function normalizeSurveyVisibility(visibility) {
  return visibility === SURVEY_VISIBILITIES.ORGANIZATION
    ? SURVEY_VISIBILITIES.ORGANIZATION
    : SURVEY_VISIBILITIES.PRIVATE;
}

export function isOrganizationSurvey(survey = {}) {
  return normalizeSurveyVisibility(survey?.visibility) === SURVEY_VISIBILITIES.ORGANIZATION;
}

export function canReadManagedSurvey(role, survey, user) {
  if (hasRoleAtLeast(role, USER_ROLES.ADMIN)) {
    return true;
  }

  if (role === USER_ROLES.CREATOR && isSurveyOwner(survey, user)) {
    return true;
  }

  return Boolean(role) && isOrganizationSurvey(survey);
}

export function isSurveyOwner(survey, user) {
  if (!survey || !user) {
    return false;
  }

  const normalizedUserEmail = normalizeEmailKey(user.email);

  return (
    survey.ownerUid === user.uid ||
    survey.createdByUid === user.uid ||
    survey.ownerId === user.uid ||
    survey.userId === user.uid ||
    survey.createdBy?.uid === user.uid ||
    normalizeEmailKey(survey.ownerEmail) === normalizedUserEmail ||
    normalizeEmailKey(survey.createdByEmail) === normalizedUserEmail ||
    normalizeEmailKey(survey.createdBy?.email) === normalizedUserEmail
  );
}

export function canEditSurvey(role, survey, user) {
  if (hasRoleAtLeast(role, USER_ROLES.ADMIN)) {
    return true;
  }

  if (role === USER_ROLES.CREATOR) {
    return isSurveyOwner(survey, user);
  }

  return false;
}

export function canViewSurveyResponses(role, survey, user) {
  return canReadManagedSurvey(role, survey, user);
}

export function canChangeSurveyStatus(role, survey, user) {
  return canEditSurvey(role, survey, user);
}

export async function fetchUserProfile(uid) {
  ensureFirestoreReady();
  const snapshot = await getDoc(doc(db, 'users', uid));

  if (!snapshot.exists()) {
    return null;
  }

  const data = snapshot.data();
  return {
    id: snapshot.id,
    ...data,
    role: normalizeUserRole(data.role, data.email),
    status: resolveStoredUserStatus(data),
  };
}

export async function upsertInternalUserProfile(firebaseUser) {
  ensureFirestoreReady();

  if (!firebaseUser?.uid || !isInternalEmail(firebaseUser.email)) {
    return null;
  }

  const normalizedEmail = normalizeEmailKey(firebaseUser.email);
  const membershipData = await findMembershipByEmail(normalizedEmail);
  const userRef = doc(db, 'users', firebaseUser.uid);
  const existing = await getDoc(userRef);
  const existingData = existing.exists() ? existing.data() : null;
  const membershipRole = membershipData?.role
    ? normalizeUserRole(membershipData.role, firebaseUser.email)
    : null;

  // Internal @yeongjung.or.kr users who logged in without a pre-registered membership
  // should be treated as creators (active) — consistent with Firestore rules' currentRole()/currentStatus()
  // defaults for users without a users/{uid} doc. This also upgrades existing users who were
  // auto-assigned the default viewer+pending values on first login before this fix,
  // and recovers active accounts whose role field is empty/null (role drift from manual admin edits).
  const isAutoAssignedInternalDefault =
    !membershipData &&
    (
      !existingData || // brand-new user
      (
        (existingData.source === 'google' || !existingData.source) &&
        !existingData.membershipId &&
        (resolveStoredUserStatus(existingData) === USER_STATUSES.PENDING || !existingData.role) &&
        (
          !existingData.role ||
          normalizeUserRole(existingData.role, firebaseUser.email) === USER_ROLES.VIEWER
        )
      )
    );

  const normalizedRole = isAutoAssignedInternalDefault
    ? USER_ROLES.CREATOR
    : existingData?.role
      ? normalizeUserRole(existingData.role, firebaseUser.email)
      : membershipRole ?? USER_ROLES.VIEWER;
  const normalizedStatus = isAutoAssignedInternalDefault
    ? USER_STATUSES.ACTIVE
    : resolveStoredUserStatus(existingData ?? {}, USER_STATUSES.ACTIVE);
  const department = normalizeDepartment(
    existingData?.department ?? membershipData?.department ?? '',
  );
  const team = normalizeDepartment(
    existingData?.team ?? membershipData?.team ?? membershipData?.department ?? '',
  );
  const displayName =
    existingData?.displayName ??
    existingData?.name ??
    firebaseUser.displayName ??
    membershipData?.displayName ??
    membershipData?.name ??
    '';
  const membershipId = membershipData?.id ?? existingData?.membershipId ?? '';
  const profileSource = membershipData ? 'preregistered' : existingData?.source ?? 'google';

  if (existing.exists()) {
    await updateDoc(userRef, {
      email: normalizedEmail,
      uid: firebaseUser.uid,
      displayName,
      name: displayName,
      department,
      team,
      role: normalizedRole,
      status: normalizedStatus,
      source: profileSource,
      membershipId,
      updatedAt: serverTimestamp(),
    });
  } else {
    await setDoc(userRef, {
      uid: firebaseUser.uid,
      email: normalizedEmail,
      displayName,
      name: displayName,
      department,
      team,
      role: normalizedRole,
      status: normalizedStatus,
      source: profileSource,
      membershipId,
      firstLoginAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  if (
    membershipData &&
    existing.exists() &&
    normalizedRole !== USER_ROLES.SUPER_ADMIN &&
    membershipRole &&
    existingData?.role == null
  ) {
    await updateDoc(userRef, {
      role: membershipRole,
      updatedAt: serverTimestamp(),
    });
  }

  return {
    uid: firebaseUser.uid,
    email: normalizedEmail,
    displayName,
    name: displayName,
    department,
    team,
    role: membershipRole && !existingData?.role ? membershipRole : normalizedRole,
    status: normalizedStatus,
    source: profileSource,
    membershipId,
  };
}

export async function ensureUserProfile(firebaseUser) {
  return upsertInternalUserProfile(firebaseUser);
}

export async function fetchAllUsers() {
  ensureFirestoreReady();
  const snapshot = await getDocs(usersCollection);

  return snapshot.docs
    .map((item) => ({
      id: item.id,
      ...item.data(),
      email: normalizeEmailKey(item.data().email),
      name: item.data().name ?? item.data().displayName ?? '',
      role: normalizeUserRole(item.data().role, item.data().email),
      department: normalizeDepartment(item.data().department),
      team: normalizeDepartment(item.data().team),
      status: resolveStoredUserStatus(item.data()),
    }))
    .sort((first, second) => {
      const firstTime = first.createdAt?.toMillis?.() || 0;
      const secondTime = second.createdAt?.toMillis?.() || 0;
      return secondTime - firstTime;
    });
}

export async function fetchAllMemberships() {
  ensureFirestoreReady();
  const [snapshot, usersSnapshot] = await Promise.all([
    getDocs(membershipsCollection),
    getDocs(usersCollection),
  ]);

  const usersByEmail = new Map(
    usersSnapshot.docs.map((item) => {
      const data = item.data();
      const email = normalizeEmailKey(data.email);
      return [
        email,
        {
          id: item.id,
          status: data.status === 'inactive' ? 'inactive' : 'active',
        },
      ];
    }),
  );

  return snapshot.docs
    .map((item) => {
      const data = item.data();
      const email = normalizeEmailKey(data.email);
      const linkedUser = usersByEmail.get(email);

      return {
        id: item.id,
        ...data,
        email,
        name: data.name ?? data.displayName ?? '',
        role: normalizeUserRole(data.role, data.email),
        department: normalizeDepartment(data.department),
        team: normalizeDepartment(data.team),
        status: normalizeUserStatus(data.status),
        linkedUserId: linkedUser?.id ?? '',
        linkedUserStatus: linkedUser?.status ?? '',
        isJoined: Boolean(linkedUser),
      };
    })
    .sort((first, second) => {
      const firstTime = first.createdAt?.toMillis?.() || 0;
      const secondTime = second.createdAt?.toMillis?.() || 0;
      return secondTime - firstTime;
    });
}

export async function upsertMembership({ email, displayName, role, department, team }) {
  ensureFirestoreReady();

  const normalizedEmail = normalizeEmailKey(email);

  if (!isInternalEmail(normalizedEmail)) {
    throw new Error('영중종합사회복지관 내부 이메일(@yeongjung.or.kr)만 등록할 수 있습니다.');
  }

  await setDoc(
    doc(db, 'memberships', normalizedEmail),
    {
      email: normalizedEmail,
      displayName: typeof displayName === 'string' ? displayName.trim() : '',
      name: typeof displayName === 'string' ? displayName.trim() : '',
      role: normalizeUserRole(role, normalizedEmail),
      department: normalizeDepartment(department),
      team: normalizeDepartment(team ?? department),
      status: USER_STATUSES.ACTIVE,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  const linkedUsers = await getDocs(query(usersCollection, where('email', '==', normalizedEmail)));
  await Promise.all(
    linkedUsers.docs.map((userDoc) =>
      updateDoc(doc(db, 'users', userDoc.id), {
        displayName: typeof displayName === 'string' ? displayName.trim() : userDoc.data().displayName ?? '',
        name: typeof displayName === 'string' ? displayName.trim() : userDoc.data().name ?? '',
        role: normalizeUserRole(role, normalizedEmail),
        department: normalizeDepartment(department),
        team: normalizeDepartment(team ?? department),
        status: USER_STATUSES.ACTIVE,
        updatedAt: serverTimestamp(),
      }),
    ),
  );
}

export async function updateMembership(membershipId, { email, displayName, role, department, team }) {
  ensureFirestoreReady();

  const previousSnapshot = await getDoc(doc(db, 'memberships', membershipId));
  if (!previousSnapshot.exists()) {
    throw new Error('사전 등록 정보를 찾을 수 없습니다.');
  }

  const previousData = previousSnapshot.data();
  const normalizedEmail = normalizeEmailKey(email);

  if (!isInternalEmail(normalizedEmail)) {
    throw new Error('영중종합사회복지관 내부 이메일(@yeongjung.or.kr)만 등록할 수 있습니다.');
  }

  await setDoc(
    doc(db, 'memberships', normalizedEmail),
    {
      email: normalizedEmail,
      displayName: typeof displayName === 'string' ? displayName.trim() : '',
      name: typeof displayName === 'string' ? displayName.trim() : '',
      role: normalizeUserRole(role, normalizedEmail),
      department: normalizeDepartment(department),
      team: normalizeDepartment(team ?? department),
      status: USER_STATUSES.ACTIVE,
      createdAt: previousData.createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );

  if (membershipId !== normalizedEmail) {
    await deleteDoc(doc(db, 'memberships', membershipId));
  }

  const linkedUsers = await getDocs(query(usersCollection, where('email', '==', normalizedEmail)));
  await Promise.all(
    linkedUsers.docs.map((userDoc) =>
      updateDoc(doc(db, 'users', userDoc.id), {
        email: normalizedEmail,
        displayName: typeof displayName === 'string' ? displayName.trim() : userDoc.data().displayName ?? '',
        name: typeof displayName === 'string' ? displayName.trim() : userDoc.data().name ?? '',
        role: normalizeUserRole(role, normalizedEmail),
        department: normalizeDepartment(department),
        team: normalizeDepartment(team ?? department),
        status: USER_STATUSES.ACTIVE,
        updatedAt: serverTimestamp(),
      }),
    ),
  );
}

export async function deleteMembershipById(membershipId) {
  ensureFirestoreReady();
  await deleteDoc(doc(db, 'memberships', membershipId));
}

export async function updateUserRole(userId, nextRole) {
  ensureFirestoreReady();

  const userSnapshot = await getDoc(doc(db, 'users', userId));

  if (!userSnapshot.exists()) {
    throw new Error('사용자 정보를 찾을 수 없습니다.');
  }

  const userData = userSnapshot.data();
  const normalizedRole = normalizeUserRole(nextRole, userData.email);

  await updateDoc(doc(db, 'users', userId), {
    role: normalizedRole,
    updatedAt: serverTimestamp(),
  });

  await upsertMembership({
    email: userData.email,
    displayName: userData.displayName,
    role: normalizedRole,
    department: userData.department,
    team: userData.team,
  });
}

export async function updateUserProfile(userId, { displayName, department, role, status, team }) {
  ensureFirestoreReady();

  const userSnapshot = await getDoc(doc(db, 'users', userId));
  if (!userSnapshot.exists()) {
    throw new Error('사용자 정보를 찾을 수 없습니다.');
  }

  const userData = userSnapshot.data();
  const normalizedEmail = normalizeEmailKey(userData.email);
  const nextRole = normalizeUserRole(role ?? userData.role, normalizedEmail);
  const nextStatus = normalizeUserStatus(status ?? userData.status);
  const nextTeam = normalizeDepartment(team ?? userData.team ?? department ?? userData.department);

  await updateDoc(doc(db, 'users', userId), {
    displayName: typeof displayName === 'string' ? displayName.trim() : userData.displayName ?? '',
    name: typeof displayName === 'string' ? displayName.trim() : userData.name ?? userData.displayName ?? '',
    department: normalizeDepartment(department ?? userData.department),
    team: nextTeam,
    role: nextRole,
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });

  if (nextStatus === 'active') {
    await upsertMembership({
      email: normalizedEmail,
      displayName: typeof displayName === 'string' ? displayName.trim() : userData.displayName ?? '',
      role: nextRole,
      department: normalizeDepartment(department ?? userData.department),
      team: nextTeam,
    });
  }
}

export async function deactivateUser(userId) {
  ensureFirestoreReady();
  await updateDoc(doc(db, 'users', userId), {
    status: USER_STATUSES.INACTIVE,
    updatedAt: serverTimestamp(),
  });
}
