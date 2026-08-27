import { addDoc, collection, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, doc, where } from 'firebase/firestore';
import { db, getFirebaseStatusMessage, isFirebaseConfigured } from './config';

export const FEEDBACK_TYPES = { bug: '오류', suggestion: '개선 제안', question: '문의', other: '기타' };
export const FEEDBACK_STATUSES = { received: '접수', reviewing: '확인 중', completed: '완료' };
export const FEEDBACK_NEXT_STATUSES = { received: 'reviewing', reviewing: 'completed' };
export const FEEDBACK_MAX_LENGTH = 2000;
export const ADMIN_REPLY_MAX_LENGTH = 2000;
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
export function normalizeAdminReply(value) { return String(value ?? '').trim(); }
export function getFeedbackReplyMessage(status, adminReply) { if (normalizeAdminReply(adminReply)) return ''; if (status === 'completed') return '이 의견은 기존 방식으로 처리 완료되어 별도의 관리자 답변이 기록되어 있지 않습니다.'; if (status === 'reviewing') return '관리자가 내용을 확인하고 있습니다.'; return '관리자 확인을 기다리고 있습니다.'; }
export function canCompleteFeedback(item) { return item?.status === 'reviewing' && Boolean(normalizeAdminReply(item.adminReply)); }
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
export async function saveFeedbackReply(id, reply, user, complete = false) {
  ready(); const adminReply = normalizeAdminReply(reply);
  if (!adminReply || adminReply.length > ADMIN_REPLY_MAX_LENGTH) throw new Error(`처리 내용은 1~${ADMIN_REPLY_MAX_LENGTH}자로 입력해주세요.`);
  const patch = { adminReply, repliedByUid: user.uid, repliedByName: user.displayName ?? '', repliedAt: serverTimestamp(), updatedAt: serverTimestamp() };
  if (complete) { patch.status = 'completed'; patch.completedAt = serverTimestamp(); }
  return updateDoc(doc(db, 'feedback', id), patch);
}
