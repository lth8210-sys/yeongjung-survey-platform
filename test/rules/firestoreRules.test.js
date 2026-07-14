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
  query,
  where,
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

// 2026-07-14: organization visibility(설문 "양식" 공유 범위)가 응답 "원문" 열람 권한으로
// 잘못 재사용되던 결함(docs/pii-encryption-architecture.md 참고)에 대한 회귀 테스트.
// canReadManagedResponse()가 canReadSurveyByIdWithAccess()(양식 조회, organization 포함)
// 대신 canReadSurveyResponsesById()(응답 조회, organization 미포함)를 쓰도록 고쳤다 —
// 아래는 그 수정이 실제로 유효한지, 그리고 기존 정상 경로(admin/super_admin/설문 소유자,
// 설문 양식 조회, 응답 create 차단)를 깨지 않았는지를 함께 검증한다. get과 list(query) 양쪽을
// 전부 검증한다 — 단일 문서 get만 막고 컬렉션 조회는 새는 실수를 잡기 위함이다.
describe('responses — organization visibility가 응답 원문 열람 권한으로 오용되지 않는다 (2026-07-14)', () => {
  const OWNER_UID = 'org-owner-uid';
  const OWNER_EMAIL = 'org-owner@yeongjung.or.kr';
  const OTHER_CREATOR_UID = 'org-other-creator-uid';
  const OTHER_CREATOR_EMAIL = 'org-other-creator@yeongjung.or.kr';
  const ADMIN_UID = 'org-admin-uid';
  const ADMIN_EMAIL = 'org-admin@yeongjung.or.kr';
  // 보호된 super_admin 이메일 — firestore.rules의 isProtectedSuperAdminEmailValue()와 동일한
  // 하드코딩 목록 중 하나를 그대로 사용한다(테스트 전용 실제 값이 아님, users 문서 없이도
  // 즉시 super_admin으로 해석되는지까지 함께 검증하기 위함).
  const SUPER_ADMIN_EMAIL = 'lth8210@yeongjung.or.kr';
  const NO_DOC_INTERNAL_EMAIL = 'org-nodoc-internal@yeongjung.or.kr';
  const EXTERNAL_EMAIL = 'org-external@gmail.com';

  async function seedOrgVisibleSurveyWithResponse(surveyId, responseId) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'surveys', surveyId), {
        title: '조직 공유 설문(개인정보 문항 포함 가정)',
        status: 'published',
        visibility: 'organization',
        ownerUid: OWNER_UID,
        ownerEmail: OWNER_EMAIL,
        responseCount: 1,
      });
      await setDoc(
        doc(ctx.firestore(), 'responses', responseId),
        minimalResponsePayload(surveyId, {
          surveyOwnerUid: OWNER_UID,
          surveyOwnerEmail: OWNER_EMAIL,
        }),
      );
      await setDoc(doc(ctx.firestore(), 'users', OWNER_UID), {
        uid: OWNER_UID,
        email: OWNER_EMAIL,
        role: 'creator',
        status: 'active',
      });
      await setDoc(doc(ctx.firestore(), 'users', OTHER_CREATOR_UID), {
        uid: OTHER_CREATOR_UID,
        email: OTHER_CREATOR_EMAIL,
        role: 'creator',
        status: 'active',
      });
      await setDoc(doc(ctx.firestore(), 'users', ADMIN_UID), {
        uid: ADMIN_UID,
        email: ADMIN_EMAIL,
        role: 'admin',
        status: 'active',
      });
    });
  }

  function listBySurveyId(firestore, surveyId) {
    return getDocs(query(collection(firestore, 'responses'), where('surveyId', '==', surveyId)));
  }

  it('1) 비로그인 사용자는 organization 설문 응답을 get/list할 수 없다', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-1', 'org-response-1');
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(getDoc(doc(unauth.firestore(), 'responses', 'org-response-1')));
    await assertFails(listBySurveyId(unauth.firestore(), 'org-survey-1'));
  });

  it('2) 외부(비기관 도메인) 로그인 사용자는 읽을 수 없다', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-2', 'org-response-2');
    const external = testEnv.authenticatedContext('org-external-uid', { email: EXTERNAL_EMAIL });

    await assertFails(getDoc(doc(external.firestore(), 'responses', 'org-response-2')));
    await assertFails(listBySurveyId(external.firestore(), 'org-survey-2'));
  });

  it('3) users 문서가 없는 기관 도메인 계정(기본 creator 자동 부여)은 읽을 수 없다 — 발견된 결함의 핵심 케이스', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-3', 'org-response-3');
    const noDocInternal = testEnv.authenticatedContext('org-nodoc-uid', { email: NO_DOC_INTERNAL_EMAIL });

    await assertFails(getDoc(doc(noDocInternal.firestore(), 'responses', 'org-response-3')));
    await assertFails(listBySurveyId(noDocInternal.firestore(), 'org-survey-3'));
  });

  it('4) 다른 설문의 creator는 organization 설문의 응답을 읽을 수 없다 — 발견된 결함의 핵심 케이스', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-4', 'org-response-4');
    const otherCreator = testEnv.authenticatedContext(OTHER_CREATOR_UID, { email: OTHER_CREATOR_EMAIL });

    await assertFails(getDoc(doc(otherCreator.firestore(), 'responses', 'org-response-4')));
    await assertFails(listBySurveyId(otherCreator.firestore(), 'org-survey-4'));
  });

  it('5) 해당 설문의 owner(creator)는 응답을 읽을 수 있다', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-5', 'org-response-5');
    const owner = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL });

    await assertSucceeds(getDoc(doc(owner.firestore(), 'responses', 'org-response-5')));
    await assertSucceeds(listBySurveyId(owner.firestore(), 'org-survey-5'));
  });

  it('6) admin은 읽을 수 있다(다운로드 화면이 사용하는 것과 동일한 role)', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-6', 'org-response-6');
    const admin = testEnv.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL });

    await assertSucceeds(getDoc(doc(admin.firestore(), 'responses', 'org-response-6')));
    await assertSucceeds(listBySurveyId(admin.firestore(), 'org-survey-6'));
  });

  it('7) super_admin은 읽을 수 있다', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-7', 'org-response-7');
    const superAdmin = testEnv.authenticatedContext('org-super-uid', { email: SUPER_ADMIN_EMAIL });

    await assertSucceeds(getDoc(doc(superAdmin.firestore(), 'responses', 'org-response-7')));
    await assertSucceeds(listBySurveyId(superAdmin.firestore(), 'org-survey-7'));
  });

  it('8) organization 설문 "양식" 자체는 기존 정책대로 무관한 creator도 조회 가능하다(응답 조회와는 분리된 정책)', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-8', 'org-response-8');
    const otherCreator = testEnv.authenticatedContext(OTHER_CREATOR_UID, { email: OTHER_CREATOR_EMAIL });

    await assertSucceeds(getDoc(doc(otherCreator.firestore(), 'surveys', 'org-survey-8')));
  });

  it('9) 응답 create는 이번 변경과 무관하게 여전히 전면 차단된다(Structure A 회귀 확인 — 정상 제출 경로는 서버 콜러블뿐)', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-9', 'org-response-9-existing');
    const owner = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL });

    await assertFails(submitResponseBatch(owner.firestore(), 'org-survey-9', 2));
  });

  it('10) private(organization 아닌) 설문에서도 소유자가 아닌 creator는 여전히 응답을 읽을 수 없다(기존 동작 회귀 확인)', async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'surveys', 'private-survey-10'), {
        title: '비공개 설문',
        status: 'published',
        ownerUid: OWNER_UID,
        ownerEmail: OWNER_EMAIL,
        responseCount: 1,
      });
      await setDoc(
        doc(ctx.firestore(), 'responses', 'private-response-10'),
        minimalResponsePayload('private-survey-10'),
      );
      await setDoc(doc(ctx.firestore(), 'users', OTHER_CREATOR_UID), {
        uid: OTHER_CREATOR_UID,
        email: OTHER_CREATOR_EMAIL,
        role: 'creator',
        status: 'active',
      });
    });
    const otherCreator = testEnv.authenticatedContext(OTHER_CREATOR_UID, { email: OTHER_CREATOR_EMAIL });

    await assertFails(getDoc(doc(otherCreator.firestore(), 'responses', 'private-response-10')));
  });
});
