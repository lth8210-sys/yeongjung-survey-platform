import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';
import {
  doc,
  setDoc,
  deleteDoc,
  addDoc,
  collection,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

// firestore.rules(924줄)는 이 앱의 실질적인 최종 권한 방어선이지만 자동 테스트가
// 전혀 없었다. 과거 KI-001/003/004/008/010이 전부 권한 규칙 관련 장애였던 이력을
// 감안해, 가장 위험도가 높은 경로(공개 응답 제출, 응답 삭제 차단, 사용자 권한
// 자가상승 방지, 결과보고서 테넌트 격리)를 우선 커버한다. 전체 규칙의 exhaustive
// 커버리지가 아니라, 회귀 시 실제 장애로 이어졌던 지점 위주의 안전망이다.
//
// 실행: npm run test:rules (내부적으로 firebase emulators:exec로 Firestore 에뮬레이터를
// 띄우고 종료한다 — 별도로 에뮬레이터를 켜둘 필요 없음)

let testEnv;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'yeongjung-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

async function seedPublishedSurvey(surveyId, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'surveys', surveyId), {
      title: '테스트 설문',
      status: 'published',
      responseCount: 0,
      ...overrides,
    });
  });
}

async function seedUserDoc(uid, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users', uid), data);
  });
}

function minimalResponsePayload(surveyId, overrides = {}) {
  return {
    surveyId,
    surveyTitle: '테스트 설문',
    answers: [],
    respondent: { submittedFrom: 'web' },
    status: 'submitted',
    surveyDeleted: false,
    surveyPermanentlyDeleted: false,
    hiddenFromDefaultList: false,
    adminNote: '',
    // validPublicResponseCreate()는 submittedAt == request.time(서버 타임스탬프)을
    // 요구한다 — 클라이언트가 만든 Date()는 절대 이 값과 정확히 일치할 수 없다.
    submittedAt: serverTimestamp(),
    ...overrides,
  };
}

// 실제 앱(submitSurveyResponse, src/firebase/surveys.js)은 responses 문서 생성과
// surveys.responseCount 증가를 runTransaction()으로 원자적으로 묶어 제출한다.
// 규칙의 getAfter()는 같은 배치/트랜잭션 안에서의 "이후 상태"만 보장하므로, 두 개의
// 독립적인 개별 쓰기(addDoc + updateDoc을 Promise.all로 병렬 실행)로는 규칙이 기대하는
// 원자적 반영을 재현할 수 없다 — writeBatch로 실제 제출과 동일하게 원자적으로 묶는다.
function submitResponseBatch(firestore, surveyId, nextResponseCount, payloadOverrides = {}) {
  const batch = writeBatch(firestore);
  const responseRef = doc(collection(firestore, 'responses'));
  batch.set(responseRef, minimalResponsePayload(surveyId, payloadOverrides));
  batch.update(doc(firestore, 'surveys', surveyId), { responseCount: nextResponseCount });
  return batch.commit();
}

// 2026-07 Structure A 전환: 응답 생성 전체가 submitProtectedSurveyResponse 서버 콜러블(Admin SDK,
// Rules 영향 밖)로 이전됨에 따라 클라이언트 SDK의 직접 create는 형태·내용과 무관하게 전면 차단된다
// (firestore.rules의 /responses/{responseId} allow create: if false — §4/§6 최종 보고 참조).
// 예전에는 "필드 화이트리스트를 만족하는 제출은 성공해야 한다"를 검증했지만, 이제는 정반대로
// "클라이언트가 아무리 올바른 모양으로 써도 반드시 막혀야 한다"를 검증한다 — 유일한 정상 경로는
// Admin SDK를 쓰는 서버 콜러블이며, 그 경로는 Rules 에뮬레이터가 아니라
// functions/test/submitResponse.test.js(인메모리 페이크 Firestore)가 별도로 검증한다.
describe('responses — 클라이언트 직접 create는 전면 차단된다 (Structure A)', () => {
  it('게시된 설문이라도 클라이언트가 직접 responses를 생성할 수 없다(정상적인 형태의 페이로드조차)', async () => {
    await seedPublishedSurvey('survey-a', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(submitResponseBatch(unauth.firestore(), 'survey-a', 1));
  });

  it('로그인한 일반 사용자도 직접 create할 수 없다', async () => {
    await seedPublishedSurvey('survey-a2', { responseCount: 0 });
    const viewer = testEnv.authenticatedContext('viewer-uid', { email: 'viewer@yeongjung.or.kr' });

    await assertFails(submitResponseBatch(viewer.firestore(), 'survey-a2', 1));
  });

  it('레거시 평문 스키마(applicantName 등)로 위장해도 여전히 차단된다', async () => {
    await seedPublishedSurvey('survey-bypass', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(
      submitResponseBatch(unauth.firestore(), 'survey-bypass', 1, {
        respondent: { submittedFrom: 'web', applicantName: '홍길동', applicantPhone: '010-1234-5678' },
      }),
    );
  });

  it('마스킹+KMS 암호문 스키마로 "올바르게" 흉내 내도 클라이언트 직접 쓰기는 차단된다', async () => {
    await seedPublishedSurvey('survey-protected', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(
      submitResponseBatch(unauth.firestore(), 'survey-protected', 1, {
        respondent: {
          submittedFrom: 'web',
          applicantNameMasked: '홍*동',
          applicantPii: { name: 'ciphertext', phone: null, birthDate: null, keyVersion: 'v1', encryptedAt: 'now' },
          piiProtected: true,
        },
        respondentName: '홍*동',
      }),
    );
  });

  it('surveys.responseCount/optionQuotaCounts를 응답 문서 없이 직접 올리는 것도 차단된다', async () => {
    await seedPublishedSurvey('survey-counter', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(
      updateDoc(doc(unauth.firestore(), 'surveys', 'survey-counter'), { responseCount: 1 }),
    );
  });

  it('clientSubmitLocks/applicationApplicantLocks를 클라이언트가 직접 생성할 수 없다', async () => {
    await seedPublishedSurvey('survey-locks', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(
      setDoc(doc(unauth.firestore(), 'surveys', 'survey-locks', 'clientSubmitLocks', 'lock-1'), {
        surveyId: 'survey-locks',
        clientSubmitIdHash: 'abc',
      }),
    );
    await assertFails(
      setDoc(doc(unauth.firestore(), 'surveys', 'survey-locks', 'applicationApplicantLocks', 'lock-2'), {
        surveyId: 'survey-locks',
        applicantHash: 'abc',
        responseId: 'r1',
        lockType: 'form_duplicate',
      }),
    );
  });
});

describe('responses — delete는 항상 차단된다 (soft delete만 허용)', () => {
  it('super_admin이라도 응답 문서를 직접 delete()할 수 없다', async () => {
    await seedPublishedSurvey('survey-d', { responseCount: 1 });
    await seedUserDoc('super-uid', {
      uid: 'super-uid',
      email: 'lth8210@yeongjung.or.kr',
      role: 'super_admin',
      status: 'active',
    });
    let responseId;
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const ref = await addDoc(
        collection(ctx.firestore(), 'responses'),
        minimalResponsePayload('survey-d'),
      );
      responseId = ref.id;
    });

    const superAdmin = testEnv.authenticatedContext('super-uid', {
      email: 'lth8210@yeongjung.or.kr',
    });

    await assertFails(deleteDoc(doc(superAdmin.firestore(), 'responses', responseId)));
  });
});

describe('responses — 비로그인 사용자는 응답 목록을 조회할 수 없다', () => {
  it('unauthenticated list 쿼리는 빈 결과가 아니라 규칙 위반으로 차단된다', async () => {
    await seedPublishedSurvey('survey-e', { responseCount: 1 });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await addDoc(collection(ctx.firestore(), 'responses'), minimalResponsePayload('survey-e'));
    });

    const unauth = testEnv.unauthenticatedContext();
    await assertFails(getDocs(collection(unauth.firestore(), 'responses')));
  });
});

describe('users — 본인 role 자가상승(self-escalation) 방지', () => {
  it('일반 viewer가 본인 문서의 role을 super_admin으로 직접 바꿀 수 없다', async () => {
    await seedUserDoc('viewer-uid', {
      uid: 'viewer-uid',
      email: 'staff@yeongjung.or.kr',
      role: 'viewer',
      status: 'active',
    });

    const viewer = testEnv.authenticatedContext('viewer-uid', { email: 'staff@yeongjung.or.kr' });

    await assertFails(
      updateDoc(doc(viewer.firestore(), 'users', 'viewer-uid'), { role: 'super_admin' }),
    );
  });

  it('super_admin으로 등록되지 않은 이메일이 create 시 role: super_admin을 자칭할 수 없다', async () => {
    const impostor = testEnv.authenticatedContext('impostor-uid', {
      email: 'impostor@yeongjung.or.kr',
    });

    await assertFails(
      setDoc(doc(impostor.firestore(), 'users', 'impostor-uid'), {
        uid: 'impostor-uid',
        email: 'impostor@yeongjung.or.kr',
        role: 'super_admin',
        status: 'active',
      }),
    );
  });
});

describe('survey_reports — creator 테넌트 격리 (KI-004 회귀 방지)', () => {
  it('creator는 본인 소유 설문의 보고서만 읽을 수 있고, 타인 소유 설문의 보고서는 읽을 수 없다', async () => {
    await seedUserDoc('creator-a', {
      uid: 'creator-a',
      email: 'creator-a@yeongjung.or.kr',
      role: 'creator',
      status: 'active',
    });
    await seedUserDoc('creator-b', {
      uid: 'creator-b',
      email: 'creator-b@yeongjung.or.kr',
      role: 'creator',
      status: 'active',
    });
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'surveys', 'survey-owned-by-a'), {
        title: 'A의 설문',
        status: 'published',
        ownerUid: 'creator-a',
        responseCount: 0,
      });
      await setDoc(doc(ctx.firestore(), 'survey_reports', 'report-1'), {
        surveyId: 'survey-owned-by-a',
        title: '보고서',
      });
    });

    const creatorA = testEnv.authenticatedContext('creator-a', { email: 'creator-a@yeongjung.or.kr' });
    const creatorB = testEnv.authenticatedContext('creator-b', { email: 'creator-b@yeongjung.or.kr' });

    await assertSucceeds(getDoc(doc(creatorA.firestore(), 'survey_reports', 'report-1')));
    await assertFails(getDoc(doc(creatorB.firestore(), 'survey_reports', 'report-1')));
  });
});
