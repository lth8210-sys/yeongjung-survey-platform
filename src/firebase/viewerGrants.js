import { collection, doc, getDoc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db, getFirebaseStatusMessage, isFirebaseConfigured } from './config';

const MAX_VIEWER_GRANTS = 20;
const ready = () => {
  if (!isFirebaseConfigured || !db) throw new Error(getFirebaseStatusMessage() || 'Firebase 설정이 필요합니다.');
};

export function normalizeViewerGrantUids(value, ownerUid = '') {
  if (!Array.isArray(value) || value.length > MAX_VIEWER_GRANTS) return null;
  const uids = value.map((uid) => String(uid ?? '').trim());
  if (uids.some((uid) => !uid) || new Set(uids).size !== uids.length || uids.includes(String(ownerUid ?? ''))) return null;
  return uids;
}

export function diffViewerGrantUids(current = [], next = []) {
  const currentSet = new Set(current);
  const nextSet = new Set(next);
  return {
    added: next.filter((uid) => !currentSet.has(uid)),
    removed: current.filter((uid) => !nextSet.has(uid)),
  };
}

export function searchStaffDirectory(items = [], term = '') {
  const normalized = String(term ?? '').trim().toLocaleLowerCase('ko');
  return items.filter((item) => item?.active && item?.uid && item?.displayName &&
    (!normalized || item.displayName.toLocaleLowerCase('ko').includes(normalized)));
}

export async function fetchViewerGrantUids(surveyId) {
  ready();
  const snapshot = await getDocs(collection(db, 'surveys', String(surveyId), 'viewerGrants'));
  return snapshot.docs.map((item) => item.id);
}

export async function hasOwnActiveViewerGrant(surveyId, uid) {
  ready();
  if (!surveyId || !uid) return false;
  const snapshot = await getDoc(doc(db, 'surveys', String(surveyId), 'viewerGrants', String(uid)));
  return snapshot.exists() && snapshot.data()?.uid === uid;
}

export async function syncViewerGrants({ surveyId, ownerUid, currentUids, nextUids, actor }) {
  ready();
  const current = normalizeViewerGrantUids(currentUids, ownerUid);
  const next = normalizeViewerGrantUids(nextUids, ownerUid);
  if (!current || !next) throw new Error('공유 대상은 중복 없이 최대 20명의 활성 직원만 선택할 수 있습니다.');
  const { added, removed } = diffViewerGrantUids(current, next);
  const batch = writeBatch(db);
  const grants = collection(db, 'surveys', String(surveyId), 'viewerGrants');
  const audits = collection(db, 'audit_logs');
  for (const uid of added) {
    batch.set(doc(grants, uid), { uid, grantedByUid: String(actor?.uid ?? ''), createdAt: serverTimestamp() });
    batch.set(doc(audits), { action: 'survey_viewer_added', surveyId: String(surveyId), responseId: null, actor: { uid: String(actor?.uid ?? ''), email: String(actor?.email ?? ''), displayName: String(actor?.displayName ?? '') }, metadata: { targetUid: uid }, createdAt: serverTimestamp() });
  }
  for (const uid of removed) {
    batch.delete(doc(grants, uid));
    batch.set(doc(audits), { action: 'survey_viewer_removed', surveyId: String(surveyId), responseId: null, actor: { uid: String(actor?.uid ?? ''), email: String(actor?.email ?? ''), displayName: String(actor?.displayName ?? '') }, metadata: { targetUid: uid }, createdAt: serverTimestamp() });
  }
  if (added.length || removed.length) await batch.commit();
  return { added, removed };
}
