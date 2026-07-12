/**
 * encryptRespondentPii / revealResponsePii의 순수 로직.
 * index.js(onCall 래퍼)에서 분리한 이유: firebase-functions의 onCall은 CloudFunction 객체를 반환해
 * 단위 테스트에서 핸들러 로직만 직접 호출하기 어렵다 — 여기 함수들은 db/kms를 인자로 주입받아
 * 테스트에서 모킹할 수 있게 한다(신규 아키텍처가 아니라 테스트 가능성을 위한 최소 분리).
 */

import { HttpsError } from 'firebase-functions/v2/https';
import { encryptField, decryptField } from './kms.js';
import { resolveCallerRole, canRevealResponsePii } from './roles.js';

export async function handleEncryptRespondentPii({ data, keyName }) {
  const { name, phone, birthDate } = data ?? {};

  if (!name && !phone && !birthDate) {
    throw new HttpsError('invalid-argument', 'name, phone, birthDate 중 최소 하나가 필요합니다.');
  }

  try {
    const [nameCt, phoneCt, birthDateCt] = await Promise.all([
      name ? encryptField(String(name), keyName) : null,
      phone ? encryptField(String(phone), keyName) : null,
      birthDate ? encryptField(String(birthDate), keyName) : null,
    ]);

    return {
      encrypted: {
        name: nameCt,
        phone: phoneCt,
        birthDate: birthDateCt,
        keyVersion: keyName,
        encryptedAt: new Date().toISOString(),
      },
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('[encryptRespondentPii] failed', { message: error?.message ?? String(error) });
    throw new HttpsError('internal', 'PII 암호화에 실패했습니다.');
  }
}

export async function handleEncryptAnswerFields({ data, keyName }) {
  const fields = data?.fields;
  const entries =
    fields && typeof fields === 'object' && !Array.isArray(fields)
      ? Object.entries(fields).filter(([, value]) => Boolean(value))
      : [];

  if (entries.length === 0) {
    throw new HttpsError('invalid-argument', 'fields에 최소 하나의 값이 필요합니다.');
  }

  try {
    const ciphertexts = await Promise.all(
      entries.map(([, value]) => encryptField(String(value), keyName)),
    );
    const values = {};
    entries.forEach(([questionId], index) => {
      values[questionId] = ciphertexts[index];
    });

    return {
      encrypted: {
        values,
        keyVersion: keyName,
        encryptedAt: new Date().toISOString(),
        schemaVersion: 1,
      },
    };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('[encryptAnswerFields] failed', { message: error?.message ?? String(error) });
    throw new HttpsError('internal', 'PII 암호화에 실패했습니다.');
  }
}

export async function handleRevealResponsePii({ data, auth, db, keyName }) {
  if (!auth) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { responseId } = data ?? {};
  if (!responseId || typeof responseId !== 'string') {
    throw new HttpsError('invalid-argument', 'responseId가 필요합니다.');
  }

  const responseRef = db.collection('responses').doc(responseId);
  const responseSnap = await responseRef.get();
  if (!responseSnap.exists) {
    throw new HttpsError('not-found', '응답을 찾을 수 없습니다.');
  }
  const response = responseSnap.data();

  const caller = await resolveCallerRole(db, auth);
  if (!canRevealResponsePii(caller, response)) {
    throw new HttpsError('permission-denied', 'PII 열람 권한이 없습니다.');
  }

  const pii = response?.respondent?.applicantPii;
  const answersPii = response?.respondent?.answersPii;
  const answerEntries = answersPii?.values ? Object.entries(answersPii.values) : [];

  if (!pii && answerEntries.length === 0) {
    return { name: '', phone: '', birthDate: '', answers: {}, piiProtected: false };
  }

  try {
    const [name, phone, birthDate] = await Promise.all([
      pii?.name ? decryptField(pii.name, keyName) : '',
      pii?.phone ? decryptField(pii.phone, keyName) : '',
      pii?.birthDate ? decryptField(pii.birthDate, keyName) : '',
    ]);

    const decryptedAnswerValues = await Promise.all(
      answerEntries.map(([, ciphertext]) => decryptField(ciphertext, keyName)),
    );
    const answers = {};
    answerEntries.forEach(([questionId], index) => {
      answers[questionId] = decryptedAnswerValues[index];
    });

    const revealedIdentityFields = pii
      ? ['name', 'phone', 'birthDate'].filter((field) => Boolean(pii[field]))
      : [];
    const revealedAnswerFields = answerEntries.map(([questionId]) => `answer:${questionId}`);

    await db
      .collection('audit_logs')
      .add({
        action: 'pii_reveal',
        surveyId: response.surveyId ?? '',
        responseId,
        actor: {
          uid: caller.uid,
          email: caller.email,
          displayName: caller.displayName || '',
        },
        deletedBy: null,
        deletedAt: null,
        metadata: {
          fields: [...revealedIdentityFields, ...revealedAnswerFields],
        },
        createdAt: new Date(),
      });

    return { name, phone, birthDate, answers, piiProtected: true };
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    console.error('[revealResponsePii] failed', { message: error?.message ?? String(error), responseId });
    throw new HttpsError('internal', 'PII 복호화에 실패했습니다.');
  }
}
