import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config';
import { logger } from './logger';

const DRAFT_PREFIX = 'draft_';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function getDraftTime(value) {
  if (!value) {
    return 0;
  }

  if (typeof value?.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanupLocalDrafts(userId) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  const now = Date.now();
  let removedCount = 0;

  Object.keys(window.localStorage)
    .filter((key) => key.startsWith(DRAFT_PREFIX) && (!userId || key.endsWith(`_${userId}`)))
    .forEach((key) => {
      try {
        const draft = JSON.parse(window.localStorage.getItem(key) ?? '{}');
        const updatedAt = getDraftTime(draft.updatedAt);

        if (updatedAt && now - updatedAt > SEVEN_DAYS_MS) {
          window.localStorage.removeItem(key);
          removedCount += 1;
          logger.debug('old draft removed', key);
        }
      } catch (error) {
        logger.error('local draft cleanup failed:', error);
      }
    });

  if (removedCount === 0) {
    logger.debug('no cleanup needed');
  }
}

export async function cleanupOldDrafts(userId) {
  cleanupLocalDrafts(userId);

  if (!userId || !isFirebaseConfigured || !db) {
    return;
  }

  try {
    const now = Date.now();
    const snapshot = await getDocs(
      query(collection(db, 'draftResponses'), where('userId', '==', userId)),
    );
    let removedCount = 0;

    await Promise.all(
      snapshot.docs.map(async (draftDoc) => {
        const updatedAt = getDraftTime(draftDoc.data().updatedAt);

        if (updatedAt && now - updatedAt > SEVEN_DAYS_MS) {
          await deleteDoc(doc(db, 'draftResponses', draftDoc.id));
          removedCount += 1;
          logger.debug('old draft removed', draftDoc.id);
        }
      }),
    );

    if (removedCount === 0) {
      logger.debug('no cleanup needed');
    }
  } catch (error) {
    logger.error('Firestore draft cleanup failed:', error);
  }
}
