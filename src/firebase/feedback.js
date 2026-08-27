import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, doc, where } from 'firebase/firestore';
import { db, getFirebaseStatusMessage, isFirebaseConfigured } from './config';

export const FEEDBACK_TYPES = { bug: '오류', suggestion: '개선 제안', question: '문의', other: '기타' };
export const FEEDBACK_STATUSES = { received: '접수', reviewing: '확인 중', completed: '완료' };
export const FEEDBACK_NEXT_STATUSES = { received: 'reviewing', reviewing: 'completed' };
export const FEEDBACK_MAX_LENGTH = 2000;
const ready = () => { if (!isFirebaseConfigured || !db) throw new Error(getFirebaseStatusMessage() || 'Firebase 설정이 필요합니다.'); };
export function getFeedbackContext(pathname = '') {
  const survey = pathname.match(/^\/(?:admin\/)?surveys\/([^/]+)/);
  const surveyId = survey?.[1] ?? null;
  if (pathname === '/') return { surveyId, pageName: '홈' };
  if (pathname === '/surveys') return { surveyId, pageName: '설문 목록' };
  if (/^\/admin\/surveys\/new/.test(pathname)) return { surveyId, pageName: '설문 제작' };
  if (/responses/.test(pathname)) return { surveyId, pageName: '응답 관리' };
  if (/report/.test(pathname)) return { surveyId, pageName: '통계' };
  if (/^\/admin/.test(pathname)) return { surveyId, pageName: '관리자' };
  return { surveyId, pageName: '기타' };
}
export function normalizeFeedbackContent(value) { return String(value ?? '').trim(); }
export async function createFeedback({ type, content, user, pathname }) {
  ready(); const normalized = normalizeFeedbackContent(content);
  if (!Object.hasOwn(FEEDBACK_TYPES, type)) throw new Error('의견 유형을 선택해주세요.');
  if (!normalized) throw new Error('내용을 입력해주세요.');
  if (normalized.length > FEEDBACK_MAX_LENGTH) throw new Error(`내용은 ${FEEDBACK_MAX_LENGTH}자까지 입력할 수 있습니다.`);
  const context = getFeedbackContext(pathname);
  return addDoc(collection(db, 'feedback'), { type, content: normalized, status: 'received', createdByUid: user.uid, createdByName: user.displayName ?? '', surveyId: context.surveyId, route: pathname, pageName: context.pageName, appVersion: '0.1.0', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), reviewedByUid: null, reviewedAt: null, completedAt: null });
}
export async function listMyFeedback(uid) { ready(); const snap = await getDocs(query(collection(db, 'feedback'), where('createdByUid', '==', uid), orderBy('createdAt', 'desc'), limit(25))); return snap.docs.map((d) => ({ id: d.id, ...d.data() })); }
export async function listAdminFeedback(status = '') { ready(); const clauses = status ? [where('status', '==', status), orderBy('createdAt', 'desc'), limit(25)] : [orderBy('createdAt', 'desc'), limit(25)]; const snap = await getDocs(query(collection(db, 'feedback'), ...clauses)); return snap.docs.map((d) => ({ id: d.id, ...d.data() })); }
export async function updateFeedbackStatus(id, currentStatus, nextStatus, uid) {
  ready();
  if (FEEDBACK_NEXT_STATUSES[currentStatus] !== nextStatus) {
    throw new Error('의견 상태는 접수 → 확인 중 → 완료 순서로만 변경할 수 있습니다.');
  }
  const patch = { status: nextStatus, updatedAt: serverTimestamp() };
  if (nextStatus === 'reviewing') {
    patch.reviewedByUid = uid;
    patch.reviewedAt = serverTimestamp();
  }
  if (nextStatus === 'completed') patch.completedAt = serverTimestamp();
  return updateDoc(doc(db, 'feedback', id), patch);
}
