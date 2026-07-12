/**
 * 역할 판정 — 서버(Cloud Functions) 사본.
 * SYNC REQUIRED: ../../src/firebase/users.js (normalizeUserRole, SUPER_ADMIN_EMAILS) 및
 * ../../firestore.rules (resolvedRole, isSuperAdminEmail)와 동일한 규칙을 유지해야 한다.
 * 이 프로젝트가 이미 SUPER_ADMIN_EMAILS를 위 두 곳에서 "SYNC REQUIRED" 주석과 함께 중복
 * 관리해온 기존 관례를 그대로 따른다 — 세 번째 위치가 추가된 것뿐이다.
 */

export const SUPER_ADMIN_EMAILS = ['lth8210@yeongjung.or.kr', 'yj100@yeongjung.or.kr'];

const LEGACY_ROLE_MAP = {
  슈퍼관리자: 'super_admin',
  관리자: 'admin',
  제작자: 'creator',
  조회자: 'viewer',
  직원: 'viewer',
  staff: 'viewer',
  superadmin: 'super_admin',
  super_admin: 'super_admin',
  'super admin': 'super_admin',
};

const VALID_ROLES = new Set(['super_admin', 'admin', 'creator', 'viewer']);

function isInternalEmail(email) {
  return /@yeongjung\.or\.kr$/i.test(String(email ?? '').trim());
}

export function isSuperAdminEmail(email) {
  return SUPER_ADMIN_EMAILS.includes(String(email ?? '').trim().toLowerCase());
}

export function normalizeRole(role, email) {
  if (isSuperAdminEmail(email)) return 'super_admin';
  const raw = role;
  const lowered = String(role ?? '').trim().toLowerCase();
  if (LEGACY_ROLE_MAP[raw]) return LEGACY_ROLE_MAP[raw];
  if (LEGACY_ROLE_MAP[lowered]) return LEGACY_ROLE_MAP[lowered];
  if (VALID_ROLES.has(raw)) return raw;
  return isInternalEmail(email) ? 'creator' : null;
}

/**
 * Firebase Auth 컨텍스트 + users/{uid} 문서를 근거로 호출자의 role/status를 판정한다.
 * firestore.rules의 resolvedRole()/resolvedStatus()와 동일한 우선순위를 따른다.
 */
export async function resolveCallerRole(db, auth) {
  const uid = auth.uid;
  const email = auth.token?.email ?? '';
  const userSnap = await db.collection('users').doc(uid).get();
  const hasDoc = userSnap.exists;
  const data = hasDoc ? userSnap.data() ?? {} : {};

  const role = normalizeRole(data.role, email);
  const status = role === 'super_admin' ? 'active' : hasDoc ? data.status ?? 'active' : isInternalEmail(email) ? 'active' : '';

  return {
    uid,
    email,
    displayName: data.displayName ?? auth.token?.name ?? '',
    role,
    status,
  };
}

function normalizeEmailKey(email) {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * responses 문서 자신에 저장된 surveyOwnerUid/surveyOwnerEmail/surveyCreatedByUid/surveyCreatedByEmail로
 * 소유자 여부를 판정한다 — firestore.rules의 isResponseOwner(data)와 동일 로직.
 */
export function isResponseOwner(responseData, caller) {
  if (!responseData || !caller) return false;
  const email = normalizeEmailKey(caller.email);
  return (
    responseData.surveyOwnerUid === caller.uid ||
    responseData.surveyCreatedByUid === caller.uid ||
    normalizeEmailKey(responseData.surveyOwnerEmail) === email ||
    normalizeEmailKey(responseData.surveyCreatedByEmail) === email
  );
}

/**
 * canReadManagedResponse(firestore.rules)와 동일한 권한 판정.
 * super_admin/admin은 전체, creator는 자신이 소유한 설문 응답만.
 */
export function canRevealResponsePii(caller, responseData) {
  if (!caller || caller.status !== 'active') return false;
  if (caller.role === 'super_admin' || caller.role === 'admin') return true;
  if (caller.role === 'creator' && isResponseOwner(responseData, caller)) return true;
  return false;
}
