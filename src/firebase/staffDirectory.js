import { collection, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db, getFirebaseStatusMessage, isFirebaseConfigured } from './config';

const directoryCollection = db ? collection(db, 'staff_directory') : null;
const ready = () => { if (!isFirebaseConfigured || !db) throw new Error(getFirebaseStatusMessage() || 'Firebase 설정이 필요합니다.'); };

export function buildStaffDirectoryProjection({ uid, displayName, status } = {}) {
  return {
    uid: String(uid ?? ''),
    displayName: String(displayName ?? '').trim() || '이름 없음',
    active: status === 'active',
  };
}

export function normalizeStaffDirectoryItem(item = {}) {
  const projection = buildStaffDirectoryProjection(item);
  return projection.uid ? projection : null;
}

export function sortStaffDirectory(items = []) {
  return items.map(normalizeStaffDirectoryItem).filter(Boolean).sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko'));
}

export async function listActiveStaffDirectory() {
  ready();
  // Equality query only: displayName is sorted locally so this does not require a composite index.
  const snapshot = await getDocs(query(directoryCollection, where('active', '==', true)));
  return sortStaffDirectory(snapshot.docs.map((item) => item.data()));
}

export async function syncStaffDirectoryProjection(profile = {}) {
  ready();
  const projection = buildStaffDirectoryProjection(profile);
  if (!projection.uid) return null;
  await setDoc(doc(db, 'staff_directory', projection.uid), { ...projection, updatedAt: serverTimestamp() });
  return projection;
}
