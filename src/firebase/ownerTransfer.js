import { collection, doc, runTransaction, serverTimestamp } from 'firebase/firestore';
import { db, getFirebaseStatusMessage, isFirebaseConfigured } from './config';

const ready = () => {
  if (!isFirebaseConfigured || !db) {
    throw new Error(getFirebaseStatusMessage() || 'Firebase 설정이 필요합니다.');
  }
};

export function resolveSurveyOwnerUid(survey = {}) {
  return String(
    survey.ownerUid ?? survey.createdByUid ?? survey.createdBy?.uid ?? survey.ownerId ?? survey.userId ?? '',
  ).trim();
}

export function getOwnerTransferCandidates(staff = [], currentOwnerUid = '') {
  const excluded = new Set([String(currentOwnerUid ?? '').trim()]);
  return staff.filter((item) => item?.active && item.uid && !excluded.has(String(item.uid)));
}

export async function transferSurveyOwner({
  surveyId,
  nextOwnerUid,
  actor,
  keepPreviousOwnerAsViewer = false,
} = {}) {
  ready();

  const normalizedSurveyId = String(surveyId ?? '').trim();
  const normalizedNextOwnerUid = String(nextOwnerUid ?? '').trim();
  const actorUid = String(actor?.uid ?? '').trim();
  if (!normalizedSurveyId || !normalizedNextOwnerUid || !actorUid) {
    throw new Error('담당자 인계에 필요한 정보가 없습니다.');
  }

  const surveyRef = doc(db, 'surveys', normalizedSurveyId);
  const auditRef = doc(collection(db, 'audit_logs'));

  return runTransaction(db, async (transaction) => {
    const surveySnapshot = await transaction.get(surveyRef);
    if (!surveySnapshot.exists()) {
      throw new Error('설문을 찾을 수 없습니다.');
    }

    const survey = surveySnapshot.data();
    const previousOwnerUid = resolveSurveyOwnerUid(survey);
    if (!previousOwnerUid) {
      throw new Error('기존 담당자 UID를 확인할 수 없어 인계할 수 없습니다.');
    }
    if (previousOwnerUid === normalizedNextOwnerUid) {
      throw new Error('현재 담당자와 다른 활성 직원을 선택해주세요.');
    }

    const nextOwnerGrantRef = doc(
      db,
      'surveys',
      normalizedSurveyId,
      'viewerGrants',
      normalizedNextOwnerUid,
    );
    const previousOwnerGrantRef = doc(
      db,
      'surveys',
      normalizedSurveyId,
      'viewerGrants',
      previousOwnerUid,
    );
    const [nextOwnerGrant, previousOwnerGrant] = await Promise.all([
      transaction.get(nextOwnerGrantRef),
      transaction.get(previousOwnerGrantRef),
    ]);

    // ownerEmail and createdBy* intentionally remain untouched: ownerUid is
    // the only current-authorization source, while those fields are history.
    transaction.update(surveyRef, {
      ownerUid: normalizedNextOwnerUid,
      updatedAt: serverTimestamp(),
    });

    // A Viewer promoted to Owner must not retain a redundant self grant.
    if (nextOwnerGrant.exists()) {
      transaction.delete(nextOwnerGrantRef);
    }

    if (keepPreviousOwnerAsViewer) {
      transaction.set(previousOwnerGrantRef, {
        uid: previousOwnerUid,
        grantedByUid: actorUid,
        createdAt: serverTimestamp(),
      });
    } else if (previousOwnerGrant.exists()) {
      transaction.delete(previousOwnerGrantRef);
    }

    transaction.set(auditRef, {
      action: 'survey_owner_transferred',
      surveyId: normalizedSurveyId,
      responseId: null,
      actor: {
        uid: actorUid,
        email: String(actor?.email ?? ''),
        displayName: String(actor?.displayName ?? ''),
      },
      metadata: {
        previousOwnerUid,
        nextOwnerUid: normalizedNextOwnerUid,
        previousOwnerRetainedAsViewer: Boolean(keepPreviousOwnerAsViewer),
      },
      createdAt: serverTimestamp(),
    });

    return {
      previousOwnerUid,
      nextOwnerUid: normalizedNextOwnerUid,
      previousOwnerRetainedAsViewer: Boolean(keepPreviousOwnerAsViewer),
    };
  });
}
