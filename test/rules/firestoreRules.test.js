import { readFileSync } from 'fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
  orderBy,
  limit,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { decrementCancellationCounter } from '../../src/firebase/surveys.js';

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

function feedbackPayload(uid, displayName = '테스트 직원', overrides = {}) {
  return {
    type: 'bug',
    content: '테스트 의견',
    status: 'received',
    createdByUid: uid,
    createdByName: displayName,
    surveyId: null,
    route: '/admin',
    pageName: '관리자',
    appVersion: '0.1.0',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    reviewedByUid: null,
    reviewedAt: null,
    completedAt: null,
    ...overrides,
  };
}

async function seedFeedback(feedbackId, overrides = {}) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'feedback', feedbackId), {
      type: 'bug',
      content: '저장된 테스트 의견',
      status: 'received',
      createdByUid: 'feedback-creator',
      createdByName: '작성자',
      surveyId: null,
      route: '/admin',
      pageName: '관리자',
      appVersion: '0.1.0',
      createdAt: new Date('2026-08-27T00:00:00Z'),
      updatedAt: new Date('2026-08-27T00:00:00Z'),
      reviewedByUid: null,
      reviewedAt: null,
      completedAt: null,
      ...overrides,
    });
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

describe('application cancellation — counter 정합성 fail-safe', () => {
  it('정상 값은 정확히 한 건만 반환하고 0·누락·비정상 값은 transaction 전에 중단한다', () => {
    expect(decrementCancellationCounter(1, '현재 신청 수')).toBe(0);
    expect(decrementCancellationCounter(7, '선택지 정원')).toBe(6);

    [0, -1, undefined, null, 'not-a-number'].forEach((value) => {
      expect(() => decrementCancellationCounter(value, '현재 신청 수')).toThrow(/취소를 중단/);
    });
  });
});

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

// 2026-07-14 긴급 롤백 회귀 테스트(운영 장애 대응). 2026-07-12 Structure A 준비 커밋(9327826)이
// 서버 콜러블(submitProtectedSurveyResponse, Cloud Functions) 미배포 상태에서 firestore.rules에
// "클라이언트 직접 create 전면 차단"을 배포해, 기존 클라이언트 트랜잭션 경로
// (VITE_USE_SERVER_RESPONSE_SUBMISSION=false)를 쓰는 운영 트래픽의 응답 제출이 전부
// permission-denied로 실패했다(§4/§6 최종 보고 참조). 원인은 두 가지였다:
//   (A) /responses, /clientSubmitLocks, /applicationApplicantLocks, /applicationSlotLocks의
//       allow create: if false, /surveys·/quotaCounts 업데이트를 내부 전용으로 좁힌 것
//   (B) validPublicResponseCreate()가 respondent.applicantName/applicantPhone/applicantBirthDate
//       키의 "존재 여부"를 무조건 차단한 것 — buildRespondentPiiFields()가 이 세 키를 값과
//       무관하게(암호화 성공 시 null) 모든 응답에 항상 포함시키므로, 이 조건은 주소·PII 문항
//       여부와 무관하게 100% 모든 제출을 막고 있었다.
// firestore.rules를 (A)는 원래 조건으로, (B)는 piiProtected==false일 때만 허용하도록(암호화가
// 실제로 성공(piiProtected:true)했을 때는 여전히 평문 키를 차단 — 향후 Blaze/Functions 전환 후
// 보호 유지) 되돌렸다. 이 블록은 그 복원된 계약을 검증한다.
describe('responses — 정상 제출 복원 (2026-07-14 긴급 롤백, Structure B)', () => {
  it('게시된 설문에 비로그인 사용자가 주소 문항을 포함해 정상 제출할 수 있다', async () => {
    await seedPublishedSurvey('survey-a', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertSucceeds(
      submitResponseBatch(unauth.firestore(), 'survey-a', 1, {
        answers: [
          {
            questionId: 'q-address',
            questionTitle: 'Q1. 현재 거주하는 곳의 주소는 무엇입니까?',
            questionType: 'short_text',
            answer: '서울특별시 종로구 세종대로 1',
            piiProtected: false,
          },
        ],
      }),
    );
  });

  it('로그인한 일반 사용자도 동일하게 정상 제출할 수 있다(공개 설문 제출은 인증 여부와 무관)', async () => {
    await seedPublishedSurvey('survey-a2', { responseCount: 0 });
    const viewer = testEnv.authenticatedContext('viewer-uid', { email: 'viewer@yeongjung.or.kr' });

    await assertSucceeds(submitResponseBatch(viewer.firestore(), 'survey-a2', 1));
  });

  it('조건부 문항이 숨겨져 visibleQuestionIds/skippedQuestionIds가 채워진 제출도 성공한다', async () => {
    await seedPublishedSurvey('survey-conditional', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertSucceeds(
      submitResponseBatch(unauth.firestore(), 'survey-conditional', 1, {
        visibleQuestionIds: ['q1', 'q2'],
        skippedQuestionIds: ['q3'],
      }),
    );
  });

  it('암호화가 꺼져(piiProtected:false) 이름/연락처/생년월일이 원문으로 남아도 제출은 허용된다(현재 운영 상태)', async () => {
    await seedPublishedSurvey('survey-plain', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertSucceeds(
      submitResponseBatch(unauth.firestore(), 'survey-plain', 1, {
        respondent: {
          submittedFrom: 'web',
          applicantName: '홍길동',
          applicantPhone: '010-1234-5678',
          applicantBirthDate: '1990-01-01',
          piiProtected: false,
        },
      }),
    );
  });

  it('레거시 평문 스키마(applicantName 등)인데 piiProtected를 명시하지 않으면 여전히 차단된다(위장 시도)', async () => {
    await seedPublishedSurvey('survey-bypass', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(
      submitResponseBatch(unauth.firestore(), 'survey-bypass', 1, {
        respondent: { submittedFrom: 'web', applicantName: '홍길동', applicantPhone: '010-1234-5678' },
      }),
    );
  });

  it('piiProtected:true라고 거짓 주장하면서 평문 필드를 같이 보내면 차단된다(암호화 활성화 후를 대비한 방어)', async () => {
    await seedPublishedSurvey('survey-lie', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(
      submitResponseBatch(unauth.firestore(), 'survey-lie', 1, {
        respondent: { submittedFrom: 'web', applicantName: '홍길동', piiProtected: true },
      }),
    );
  });

  it('마스킹+KMS 암호문 스키마(piiProtected:true, 평문 레거시 키 없음)는 정상 허용된다(암호화 활성화 후 목표 형태)', async () => {
    await seedPublishedSurvey('survey-protected', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertSucceeds(
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

  it('허용되지 않은 임의 필드를 최상위에 추가하면 거부된다', async () => {
    await seedPublishedSurvey('survey-extra', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(
      submitResponseBatch(unauth.firestore(), 'survey-extra', 1, {
        unexpectedField: 'hacked',
      }),
    );
  });

  it('마감(closed)된 설문에는 새 응답을 생성할 수 없다', async () => {
    await seedPublishedSurvey('survey-closed', { status: 'closed', responseCount: 3 });
    const unauth = testEnv.unauthenticatedContext();

    await assertFails(submitResponseBatch(unauth.firestore(), 'survey-closed', 4));
  });

  // 알려진 기존 한계(신규 취약점 아님, Structure A 준비 커밋의 주석이 이미 인지하고 있던 상태 —
  // §4/§6 최종 보고 참조): validPublicSurveyCounterUpdate()는 survey 문서 단독 업데이트만 보고
  // 같은 커밋에 실제 응답 문서가 만들어졌는지는 검증하지 않는다. 서버 콜러블 전환 전까지는
  // Rules만으로 닫기는 어렵다 — 별도 승인 후 해결할 후속 과제로 최종 보고에 남긴다.
  it('[알려진 한계] responses 문서 없이 surveys.responseCount만 직접 올리는 것도 가능하다', async () => {
    await seedPublishedSurvey('survey-counter', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertSucceeds(
      updateDoc(doc(unauth.firestore(), 'surveys', 'survey-counter'), {
        responseCount: 1,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it('clientSubmitLocks/applicationApplicantLocks를 정상 형태로는 클라이언트가 직접 생성할 수 있다(제출 트랜잭션의 일부)', async () => {
    await seedPublishedSurvey('survey-locks', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertSucceeds(
      setDoc(doc(unauth.firestore(), 'surveys', 'survey-locks', 'clientSubmitLocks', 'lock-1'), {
        surveyId: 'survey-locks',
        clientSubmitIdHash: 'abc',
      }),
    );
    await assertSucceeds(
      setDoc(doc(unauth.firestore(), 'surveys', 'survey-locks', 'applicationApplicantLocks', 'lock-2'), {
        surveyId: 'survey-locks',
        applicantHash: 'abc',
        responseId: 'r1',
        lockType: 'form_duplicate',
      }),
    );
  });
});

describe('quotaCounts — 연령 정원 설문의 카운트 증가 (2026-07-14 긴급 롤백)', () => {
  it('정원(quota) 사용 설문 제출 시 quotaCounts가 정확히 1회 증가한다', async () => {
    await seedPublishedSurvey('survey-quota', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();
    const batch = writeBatch(unauth.firestore());
    const responseRef = doc(collection(unauth.firestore(), 'responses'));
    batch.set(responseRef, minimalResponsePayload('survey-quota'));
    batch.update(doc(unauth.firestore(), 'surveys', 'survey-quota'), { responseCount: 1 });
    batch.set(doc(unauth.firestore(), 'surveys', 'survey-quota', 'quotaCounts', 'main'), {
      total: 1,
      cells: { '20s': 1 },
      updatedAt: serverTimestamp(),
    });

    await assertSucceeds(batch.commit());
  });

  it('정원(quota)을 쓰지 않는 설문은 quotaCounts 쓰기 없이도 정상 제출된다', async () => {
    await seedPublishedSurvey('survey-noquota', { responseCount: 0 });
    const unauth = testEnv.unauthenticatedContext();

    await assertSucceeds(submitResponseBatch(unauth.firestore(), 'survey-noquota', 1));
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

describe('responses — soft delete 권한은 설문 관리 범위와 일치한다', () => {
  const SURVEY_ID = 'response-delete-survey';
  const RESPONSE_ID = 'response-delete-response';
  const OWNER_UID = 'response-delete-owner';
  const OWNER_EMAIL = 'response-delete-owner@yeongjung.or.kr';

  async function seedDeleteTarget(ownerFields = { ownerUid: OWNER_UID, ownerEmail: OWNER_EMAIL }) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'surveys', SURVEY_ID), {
        title: '응답 삭제 권한 설문',
        status: 'published',
        responseCount: 1,
        ...ownerFields,
      });
      await setDoc(
        doc(ctx.firestore(), 'responses', RESPONSE_ID),
        minimalResponsePayload(SURVEY_ID, {
          surveyOwnerUid: OWNER_UID,
          surveyOwnerEmail: OWNER_EMAIL,
        }),
      );
    });
  }

  async function seedActiveUser(uid, email, role) {
    await seedUserDoc(uid, { uid, email, role, status: 'active' });
  }

  function softDeleteResponseBatch(firestore, actor) {
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'responses', RESPONSE_ID), {
      deleted: true,
      hiddenFromDefaultList: true,
      deletedAt: serverTimestamp(),
      deletedBy: actor,
    });
    batch.set(doc(collection(firestore, 'audit_logs')), {
      action: 'response_delete',
      surveyId: SURVEY_ID,
      responseId: RESPONSE_ID,
      actor,
      deletedBy: actor,
      deletedAt: serverTimestamp(),
      metadata: {},
      createdAt: serverTimestamp(),
    });
    return batch.commit();
  }

  it('owner와 legacy owner, admin, super_admin은 soft delete와 audit 기록을 수행할 수 있다', async () => {
    await seedDeleteTarget();
    await seedActiveUser(OWNER_UID, OWNER_EMAIL, 'creator');
    const owner = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL });
    const ownerActor = { uid: OWNER_UID, email: OWNER_EMAIL, displayName: '' };
    await assertSucceeds(softDeleteResponseBatch(owner.firestore(), ownerActor));

    await testEnv.clearFirestore();
    await seedDeleteTarget({ ownerId: OWNER_UID });
    await seedActiveUser(OWNER_UID, OWNER_EMAIL, 'creator');
    const legacyOwner = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL });
    await assertSucceeds(softDeleteResponseBatch(legacyOwner.firestore(), ownerActor));

    await testEnv.clearFirestore();
    await seedDeleteTarget();
    await seedActiveUser('response-delete-admin', 'response-delete-admin@yeongjung.or.kr', 'admin');
    const admin = testEnv.authenticatedContext('response-delete-admin', {
      email: 'response-delete-admin@yeongjung.or.kr',
    });
    await assertSucceeds(softDeleteResponseBatch(admin.firestore(), {
      uid: 'response-delete-admin', email: 'response-delete-admin@yeongjung.or.kr', displayName: '',
    }));

    await testEnv.clearFirestore();
    await seedDeleteTarget();
    const superAdmin = testEnv.authenticatedContext('response-delete-super-admin', {
      email: 'lth8210@yeongjung.or.kr',
    });
    await assertSucceeds(softDeleteResponseBatch(superAdmin.firestore(), {
      uid: 'response-delete-super-admin', email: 'lth8210@yeongjung.or.kr', displayName: '',
    }));
  });

  it('unrelated creator, organization-only creator, viewer, anonymous는 soft delete할 수 없다', async () => {
    const cases = [
      ['other-creator', 'other-creator@yeongjung.or.kr', 'creator', { ownerUid: OWNER_UID, ownerEmail: OWNER_EMAIL }],
      ['organization-only', 'organization-only@yeongjung.or.kr', 'creator', {
        ownerUid: OWNER_UID, ownerEmail: OWNER_EMAIL, visibility: 'organization',
      }],
      ['viewer', 'viewer@yeongjung.or.kr', 'viewer', { ownerUid: OWNER_UID, ownerEmail: OWNER_EMAIL }],
    ];

    for (const [uid, email, role, ownerFields] of cases) {
      await seedDeleteTarget(ownerFields);
      await seedActiveUser(uid, email, role);
      const context = testEnv.authenticatedContext(uid, { email });
      await assertFails(softDeleteResponseBatch(context.firestore(), { uid, email, displayName: '' }));
      await testEnv.clearFirestore();
    }

    await seedDeleteTarget();
    const anonymous = testEnv.unauthenticatedContext();
    await assertFails(softDeleteResponseBatch(anonymous.firestore(), { uid: '', email: '', displayName: '' }));
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

describe('legacy survey ownership — 제작자 관리·응답 열람 호환성', () => {
  const LEGACY_OWNER_UID = 'legacy-owner-uid';
  const LEGACY_OWNER_EMAIL = 'legacy-owner@yeongjung.or.kr';

  async function seedLegacyOwnedSurvey(ownerFields) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'surveys', 'legacy-owner-survey'), {
        title: '레거시 소유자 설문',
        status: 'published',
        responseCount: 1,
        ...ownerFields,
      });
      await setDoc(
        doc(ctx.firestore(), 'responses', 'legacy-owner-response'),
        minimalResponsePayload('legacy-owner-survey'),
      );
      await setDoc(doc(ctx.firestore(), 'users', LEGACY_OWNER_UID), {
        uid: LEGACY_OWNER_UID,
        email: LEGACY_OWNER_EMAIL,
        role: 'creator',
        status: 'active',
      });
    });
  }

  it.each([
    ['createdByUid', { createdByUid: LEGACY_OWNER_UID }],
    ['ownerId', { ownerId: LEGACY_OWNER_UID }],
    ['userId', { userId: LEGACY_OWNER_UID }],
    ['createdBy.email', { createdBy: { email: LEGACY_OWNER_EMAIL } }],
  ])('legacy %s 제작자는 설문과 응답을 조회하고 설문을 수정할 수 있다', async (_label, ownerFields) => {
    await seedLegacyOwnedSurvey(ownerFields);
    const owner = testEnv.authenticatedContext(LEGACY_OWNER_UID, { email: LEGACY_OWNER_EMAIL });

    await assertSucceeds(getDoc(doc(owner.firestore(), 'surveys', 'legacy-owner-survey')));
    await assertSucceeds(getDoc(doc(owner.firestore(), 'responses', 'legacy-owner-response')));
    await assertSucceeds(
      updateDoc(doc(owner.firestore(), 'surveys', 'legacy-owner-survey'), {
        title: '레거시 소유자 설문 수정',
      }),
    );
  });
});

describe('application cancellation — owner/admin 권한과 원자적 정원 반환 계약', () => {
  const SURVEY_ID = 'cancellable-survey';
  const RESPONSE_ID = 'cancellable-response';
  const OWNER_UID = 'cancellation-owner';
  const OWNER_EMAIL = 'cancellation-owner@yeongjung.or.kr';
  const ADMIN_UID = 'cancellation-admin';
  const ADMIN_EMAIL = 'cancellation-admin@yeongjung.or.kr';
  const OTHER_UID = 'cancellation-other';
  const OTHER_EMAIL = 'cancellation-other@yeongjung.or.kr';
  const APPLICANT_LOCK_ID = 'applicant-lock';
  const SLOT_LOCK_ID = 'slot-lock';

  async function seedCancellableApplication() {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'surveys', SURVEY_ID), {
        title: '취소 가능 신청',
        status: 'closed',
        responseCount: 10,
        ownerUid: OWNER_UID,
        ownerEmail: OWNER_EMAIL,
        optionQuotaCounts: { 'slot-q::10:00': 6 },
      });
      await setDoc(doc(ctx.firestore(), 'surveys', SURVEY_ID, 'quotaCounts', 'main'), {
        total: 4,
        cells: { age_20_39: 4 },
      });
      await setDoc(doc(ctx.firestore(), 'responses', RESPONSE_ID), minimalResponsePayload(SURVEY_ID, {
        status: 'submitted',
        answers: [{ questionId: 'slot-q', answer: '10:00' }],
        quota: { ageGroupId: 'age_20_39' },
        respondent: {
          submittedFrom: 'web',
          applicantKey: '01012345678',
          slotSelections: [{ questionId: 'slot-q', slotValue: '10:00' }],
        },
      }));
      await setDoc(
        doc(ctx.firestore(), 'surveys', SURVEY_ID, 'applicationApplicantLocks', APPLICANT_LOCK_ID),
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, applicantHash: 'hash', lockType: 'form_duplicate' },
      );
      await setDoc(
        doc(ctx.firestore(), 'surveys', SURVEY_ID, 'applicationSlotLocks', SLOT_LOCK_ID),
        { surveyId: SURVEY_ID, responseId: RESPONSE_ID, applicantHash: 'hash', questionId: 'slot-q', slotValue: '10:00' },
      );
      await setDoc(doc(ctx.firestore(), 'users', OWNER_UID), {
        uid: OWNER_UID, email: OWNER_EMAIL, role: 'creator', status: 'active',
      });
      await setDoc(doc(ctx.firestore(), 'users', ADMIN_UID), {
        uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', status: 'active',
      });
      await setDoc(doc(ctx.firestore(), 'users', OTHER_UID), {
        uid: OTHER_UID, email: OTHER_EMAIL, role: 'creator', status: 'active',
      });
    });
  }

  function cancelResponseBatch(firestore, actor) {
    const batch = writeBatch(firestore);
    batch.update(doc(firestore, 'responses', RESPONSE_ID), { status: 'cancelled' });
    batch.update(doc(firestore, 'surveys', SURVEY_ID), {
      responseCount: 9,
      optionQuotaCounts: { 'slot-q::10:00': 5 },
      // 취소는 정원만 반환하며 수동/자동 마감 구분이 없는 status는 그대로 둔다.
      status: 'closed',
    });
    batch.update(doc(firestore, 'surveys', SURVEY_ID, 'quotaCounts', 'main'), {
      total: 3,
      cells: { age_20_39: 3 },
    });
    batch.delete(doc(firestore, 'surveys', SURVEY_ID, 'applicationApplicantLocks', APPLICANT_LOCK_ID));
    batch.delete(doc(firestore, 'surveys', SURVEY_ID, 'applicationSlotLocks', SLOT_LOCK_ID));
    batch.set(doc(collection(firestore, 'audit_logs')), {
      action: 'response_cancelled',
      surveyId: SURVEY_ID,
      responseId: RESPONSE_ID,
      actor,
      metadata: {},
      createdAt: serverTimestamp(),
    });
    return batch.commit();
  }

  // 취소 후 설문을 수동으로 다시 열었을 때에는 이전 응답의 lock이 남아 재신청을
  // 막지 않아야 한다. 실제 공개 제출처럼 response/counter/두 lock을 한 배치에 담는다.
  function resubmitApplicationBatch(firestore) {
    const batch = writeBatch(firestore);
    const nextResponseRef = doc(collection(firestore, 'responses'));
    batch.set(nextResponseRef, minimalResponsePayload(SURVEY_ID, {
      respondent: { submittedFrom: 'web' },
    }));
    batch.update(doc(firestore, 'surveys', SURVEY_ID), { responseCount: 10 });
    batch.set(doc(firestore, 'surveys', SURVEY_ID, 'applicationApplicantLocks', 'new-applicant-lock'), {
      surveyId: SURVEY_ID,
      responseId: nextResponseRef.id,
      applicantHash: 'new-hash',
      lockType: 'form_duplicate',
    });
    batch.set(doc(firestore, 'surveys', SURVEY_ID, 'applicationSlotLocks', 'new-slot-lock'), {
      surveyId: SURVEY_ID,
      responseId: nextResponseRef.id,
      applicantHash: 'new-hash',
      questionId: 'slot-q',
      slotValue: '10:00',
    });
    return batch.commit();
  }

  it('owner 취소는 응답을 보존하고 counter/quota/lock을 함께 조정하며 closed 상태를 유지한다', async () => {
    await seedCancellableApplication();
    const owner = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL });
    const actor = { uid: OWNER_UID, email: OWNER_EMAIL, displayName: '' };

    await assertSucceeds(cancelResponseBatch(owner.firestore(), actor));

    const survey = await getDoc(doc(owner.firestore(), 'surveys', SURVEY_ID));
    const response = await getDoc(doc(owner.firestore(), 'responses', RESPONSE_ID));
    const quotaCounts = await getDoc(doc(owner.firestore(), 'surveys', SURVEY_ID, 'quotaCounts', 'main'));
    let applicantLockExists;
    let slotLockExists;
    // closed 설문에서는 production Rules가 공개 lock read를 막는다. 삭제 여부 검증은
    // 권한 테스트와 분리해 rules-disabled 관리 컨텍스트로 확인한다.
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      applicantLockExists = (await getDoc(
        doc(ctx.firestore(), 'surveys', SURVEY_ID, 'applicationApplicantLocks', APPLICANT_LOCK_ID),
      )).exists();
      slotLockExists = (await getDoc(
        doc(ctx.firestore(), 'surveys', SURVEY_ID, 'applicationSlotLocks', SLOT_LOCK_ID),
      )).exists();
    });

    expect(survey.data().status).toBe('closed');
    expect(survey.data().responseCount).toBe(9);
    expect(survey.data().optionQuotaCounts['slot-q::10:00']).toBe(5);
    expect(response.data().status).toBe('cancelled');
    expect(response.data().deleted).not.toBe(true);
    expect(quotaCounts.data()).toEqual({ total: 3, cells: { age_20_39: 3 } });
    expect(applicantLockExists).toBe(false);
    expect(slotLockExists).toBe(false);
  });

  it('admin은 취소 transaction을 수행할 수 있다', async () => {
    await seedCancellableApplication();
    const admin = testEnv.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL });

    await assertSucceeds(cancelResponseBatch(admin.firestore(), {
      uid: ADMIN_UID, email: ADMIN_EMAIL, displayName: '',
    }));
  });

  it('무관한 creator와 익명 사용자는 취소 transaction을 수행할 수 없다', async () => {
    await seedCancellableApplication();
    const otherCreator = testEnv.authenticatedContext(OTHER_UID, { email: OTHER_EMAIL });
    const unauthenticated = testEnv.unauthenticatedContext();

    await assertFails(cancelResponseBatch(otherCreator.firestore(), {
      uid: OTHER_UID, email: OTHER_EMAIL, displayName: '',
    }));
    await assertFails(cancelResponseBatch(unauthenticated.firestore(), {
      uid: '', email: '', displayName: '',
    }));
  });

  it('취소 뒤 관리자가 수동 재공개하면 익명 신청자가 새 response/counter/lock을 원자적으로 생성할 수 있다', async () => {
    await seedCancellableApplication();
    const owner = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL });
    const anonymous = testEnv.unauthenticatedContext();

    await assertSucceeds(cancelResponseBatch(owner.firestore(), {
      uid: OWNER_UID, email: OWNER_EMAIL, displayName: '',
    }));
    await assertSucceeds(updateDoc(doc(owner.firestore(), 'surveys', SURVEY_ID), { status: 'published' }));
    await assertSucceeds(resubmitApplicationBatch(anonymous.firestore()));

    const survey = await getDoc(doc(owner.firestore(), 'surveys', SURVEY_ID));
    expect(survey.data().responseCount).toBe(10);
  });
});

describe('closed application locks — 취소 관리자 ownership 확인 read 권한', () => {
  const SURVEY_ID = 'closed-lock-survey';
  const OWNER_UID = 'closed-lock-owner';
  const OWNER_EMAIL = 'closed-lock-owner@yeongjung.or.kr';
  const LEGACY_OWNER_UID = 'closed-lock-legacy-owner';
  const LEGACY_OWNER_EMAIL = 'closed-lock-legacy-owner@yeongjung.or.kr';
  const ADMIN_UID = 'closed-lock-admin';
  const ADMIN_EMAIL = 'closed-lock-admin@yeongjung.or.kr';
  const OTHER_UID = 'closed-lock-other';
  const OTHER_EMAIL = 'closed-lock-other@yeongjung.or.kr';
  const VIEWER_UID = 'closed-lock-viewer';
  const VIEWER_EMAIL = 'closed-lock-viewer@yeongjung.or.kr';

  async function seedClosedLocks({ legacyOwner = false } = {}) {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'surveys', SURVEY_ID), {
        title: '마감 신청',
        status: 'closed',
        responseCount: 1,
        visibility: 'organization',
        ...(legacyOwner
          ? { ownerId: LEGACY_OWNER_UID, ownerEmail: LEGACY_OWNER_EMAIL }
          : { ownerUid: OWNER_UID, ownerEmail: OWNER_EMAIL }),
      });
      await setDoc(doc(ctx.firestore(), 'surveys', SURVEY_ID, 'applicationApplicantLocks', 'applicant'), {
        surveyId: SURVEY_ID, responseId: 'response-1', applicantHash: 'hash', lockType: 'form_duplicate',
      });
      await setDoc(doc(ctx.firestore(), 'surveys', SURVEY_ID, 'applicationSlotLocks', 'slot'), {
        surveyId: SURVEY_ID, responseId: 'response-1', applicantHash: 'hash', questionId: 'q1', slotValue: '10:00',
      });
      await setDoc(doc(ctx.firestore(), 'users', OWNER_UID), {
        uid: OWNER_UID, email: OWNER_EMAIL, role: 'creator', status: 'active',
      });
      await setDoc(doc(ctx.firestore(), 'users', LEGACY_OWNER_UID), {
        uid: LEGACY_OWNER_UID, email: LEGACY_OWNER_EMAIL, role: 'creator', status: 'active',
      });
      await setDoc(doc(ctx.firestore(), 'users', ADMIN_UID), {
        uid: ADMIN_UID, email: ADMIN_EMAIL, role: 'admin', status: 'active',
      });
      await setDoc(doc(ctx.firestore(), 'users', OTHER_UID), {
        uid: OTHER_UID, email: OTHER_EMAIL, role: 'creator', status: 'active',
      });
      await setDoc(doc(ctx.firestore(), 'users', VIEWER_UID), {
        uid: VIEWER_UID, email: VIEWER_EMAIL, role: 'viewer', status: 'active',
      });
    });
  }

  function readBothLocks(firestore) {
    return Promise.all([
      getDoc(doc(firestore, 'surveys', SURVEY_ID, 'applicationApplicantLocks', 'applicant')),
      getDoc(doc(firestore, 'surveys', SURVEY_ID, 'applicationSlotLocks', 'slot')),
    ]);
  }

  it('closed 설문 owner, legacy owner, admin, super_admin은 두 lock을 읽을 수 있다', async () => {
    await seedClosedLocks();
    const owner = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL });
    const admin = testEnv.authenticatedContext(ADMIN_UID, { email: ADMIN_EMAIL });
    const superAdmin = testEnv.authenticatedContext('closed-lock-super', { email: 'lth8210@yeongjung.or.kr' });

    await assertSucceeds(readBothLocks(owner.firestore()));
    await assertSucceeds(readBothLocks(admin.firestore()));
    await assertSucceeds(readBothLocks(superAdmin.firestore()));

    await testEnv.clearFirestore();
    await seedClosedLocks({ legacyOwner: true });
    const legacyOwner = testEnv.authenticatedContext(LEGACY_OWNER_UID, { email: LEGACY_OWNER_EMAIL });
    await assertSucceeds(readBothLocks(legacyOwner.firestore()));
  });

  it('closed 설문의 lock은 anonymous, organization-only viewer, unrelated creator에게 계속 차단된다', async () => {
    await seedClosedLocks();
    const anonymous = testEnv.unauthenticatedContext();
    const viewer = testEnv.authenticatedContext(VIEWER_UID, { email: VIEWER_EMAIL });
    const otherCreator = testEnv.authenticatedContext(OTHER_UID, { email: OTHER_EMAIL });

    await assertFails(readBothLocks(anonymous.firestore()));
    await assertFails(readBothLocks(viewer.firestore()));
    await assertFails(readBothLocks(otherCreator.firestore()));
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

  it('9) 응답 create는 이 조직-가시성 읽기 권한 수정과 무관하게 정상 동작한다(2026-07-14 긴급 롤백 이후 — 제출 자체는 read 권한과 분리된 별개 규칙)', async () => {
    await seedOrgVisibleSurveyWithResponse('org-survey-9', 'org-response-9-existing');
    const owner = testEnv.authenticatedContext(OWNER_UID, { email: OWNER_EMAIL });

    await assertSucceeds(submitResponseBatch(owner.firestore(), 'org-survey-9', 2));
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

describe('feedback — 내부 직원 의견 권한과 상태 전이', () => {
  const CREATOR_UID = 'feedback-creator';
  const OTHER_UID = 'feedback-other';
  const VIEWER_UID = 'feedback-viewer';
  const ADMIN_UID = 'feedback-admin';
  const LEGACY_UID = 'feedback-legacy-owner';
  const CREATOR_EMAIL = 'feedback-creator@yeongjung.or.kr';
  const OTHER_EMAIL = 'feedback-other@yeongjung.or.kr';
  const VIEWER_EMAIL = 'feedback-viewer@yeongjung.or.kr';
  const ADMIN_EMAIL = 'feedback-admin@yeongjung.or.kr';

  async function seedFeedbackUsers() {
    await Promise.all([
      seedUserDoc(CREATOR_UID, { uid: CREATOR_UID, email: CREATOR_EMAIL, displayName: '작성자', role: 'creator', status: 'active' }),
      seedUserDoc(OTHER_UID, { uid: OTHER_UID, email: OTHER_EMAIL, displayName: '다른 직원', role: 'creator', status: 'active' }),
      seedUserDoc(VIEWER_UID, { uid: VIEWER_UID, email: VIEWER_EMAIL, displayName: '조회 직원', role: 'viewer', status: 'active' }),
      seedUserDoc(ADMIN_UID, { uid: ADMIN_UID, email: ADMIN_EMAIL, displayName: '관리자', role: 'admin', status: 'active' }),
      seedUserDoc(LEGACY_UID, { uid: LEGACY_UID, email: 'feedback-legacy@yeongjung.or.kr', displayName: '기존 제작자', role: 'owner', status: 'active' }),
    ]);
  }

  function context(uid, email) { return testEnv.authenticatedContext(uid, { email }); }

  it('active creator·viewer는 자신의 의견을 생성할 수 있다', async () => {
    await seedFeedbackUsers();
    await assertSucceeds(setDoc(doc(context(CREATOR_UID, CREATOR_EMAIL).firestore(), 'feedback', 'creator-create'), feedbackPayload(CREATOR_UID, '작성자')));
    await assertSucceeds(setDoc(doc(context(VIEWER_UID, VIEWER_EMAIL).firestore(), 'feedback', 'viewer-create'), feedbackPayload(VIEWER_UID, '조회 직원')));
  });

  it('admin과 protected super_admin도 자신의 의견을 생성할 수 있다', async () => {
    await seedFeedbackUsers();
    await seedUserDoc('feedback-super', { uid: 'feedback-super', email: 'lth8210@yeongjung.or.kr', displayName: '슈퍼관리자', role: 'super_admin', status: 'active' });
    await assertSucceeds(setDoc(doc(context(ADMIN_UID, ADMIN_EMAIL).firestore(), 'feedback', 'admin-create'), feedbackPayload(ADMIN_UID, '관리자')));
    await assertSucceeds(setDoc(doc(context('feedback-super', 'lth8210@yeongjung.or.kr').firestore(), 'feedback', 'super-create'), feedbackPayload('feedback-super', '슈퍼관리자')));
  });

  it('anonymous, users 문서 없음, pending/inactive/blocked 계정은 생성할 수 없다', async () => {
    await seedFeedbackUsers();
    await Promise.all([
      seedUserDoc('feedback-pending', { uid: 'feedback-pending', email: 'feedback-pending@yeongjung.or.kr', displayName: '대기', role: 'viewer', status: 'pending' }),
      seedUserDoc('feedback-inactive', { uid: 'feedback-inactive', email: 'feedback-inactive@yeongjung.or.kr', displayName: '비활성', role: 'viewer', status: 'inactive' }),
      seedUserDoc('feedback-blocked', { uid: 'feedback-blocked', email: 'feedback-blocked@yeongjung.or.kr', displayName: '차단', role: 'viewer', status: 'blocked' }),
    ]);
    await assertFails(setDoc(doc(testEnv.unauthenticatedContext().firestore(), 'feedback', 'anonymous-create'), feedbackPayload('x')));
    await assertFails(setDoc(doc(context('feedback-no-doc', 'feedback-no-doc@yeongjung.or.kr').firestore(), 'feedback', 'nodoc-create'), feedbackPayload('feedback-no-doc')));
    await assertFails(setDoc(doc(context('feedback-pending', 'feedback-pending@yeongjung.or.kr').firestore(), 'feedback', 'pending-create'), feedbackPayload('feedback-pending', '대기')));
    await assertFails(setDoc(doc(context('feedback-inactive', 'feedback-inactive@yeongjung.or.kr').firestore(), 'feedback', 'inactive-create'), feedbackPayload('feedback-inactive', '비활성')));
    await assertFails(setDoc(doc(context('feedback-blocked', 'feedback-blocked@yeongjung.or.kr').firestore(), 'feedback', 'blocked-create'), feedbackPayload('feedback-blocked', '차단')));
  });

  it('작성자 UID·이름, received 초기 상태, 허용 type, 1~2,000자, field allowlist를 강제한다', async () => {
    await seedFeedbackUsers();
    const db = context(CREATOR_UID, CREATOR_EMAIL).firestore();
    await assertFails(setDoc(doc(db, 'feedback', 'wrong-uid'), feedbackPayload(OTHER_UID, '작성자')));
    await assertFails(setDoc(doc(db, 'feedback', 'wrong-name'), feedbackPayload(CREATOR_UID, '위조 이름')));
    await assertFails(setDoc(doc(db, 'feedback', 'wrong-status'), feedbackPayload(CREATOR_UID, '작성자', { status: 'completed' })));
    await assertFails(setDoc(doc(db, 'feedback', 'wrong-type'), feedbackPayload(CREATOR_UID, '작성자', { type: 'unknown' })));
    await assertFails(setDoc(doc(db, 'feedback', 'empty'), feedbackPayload(CREATOR_UID, '작성자', { content: '' })));
    await assertFails(setDoc(doc(db, 'feedback', 'long'), feedbackPayload(CREATOR_UID, '작성자', { content: 'a'.repeat(2001) })));
    await assertFails(setDoc(doc(db, 'feedback', 'extra-field'), feedbackPayload(CREATOR_UID, '작성자', { extra: 'nope' })));
    await assertFails(setDoc(doc(db, 'feedback', 'client-time'), feedbackPayload(CREATOR_UID, '작성자', { createdAt: new Date(), updatedAt: new Date() })));
  });

  it('작성자는 자기 의견 단건 조회와 createdByUid 조건의 목록 조회만 할 수 있다', async () => {
    await seedFeedbackUsers(); await seedFeedback('mine'); await seedFeedback('other', { createdByUid: OTHER_UID, createdByName: '다른 직원' });
    const db = context(CREATOR_UID, CREATOR_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, 'feedback', 'mine')));
    await assertSucceeds(getDocs(query(collection(db, 'feedback'), where('createdByUid', '==', CREATOR_UID), orderBy('createdAt', 'desc'), limit(25))));
    await assertFails(getDoc(doc(db, 'feedback', 'other')));
    await assertFails(getDocs(query(collection(db, 'feedback'), orderBy('createdAt', 'desc'), limit(25))));
  });

  it('다른 직원, viewer, legacy owner는 타인 의견을 조회할 수 없고 자기 의견만 조회한다', async () => {
    await seedFeedbackUsers(); await seedFeedback('creator-item'); await seedFeedback('viewer-item', { createdByUid: VIEWER_UID, createdByName: '조회 직원' });
    await assertFails(getDoc(doc(context(OTHER_UID, OTHER_EMAIL).firestore(), 'feedback', 'creator-item')));
    await assertSucceeds(getDoc(doc(context(VIEWER_UID, VIEWER_EMAIL).firestore(), 'feedback', 'viewer-item')));
    await assertFails(getDoc(doc(context(LEGACY_UID, 'feedback-legacy@yeongjung.or.kr').firestore(), 'feedback', 'creator-item')));
  });

  it('pending/inactive/blocked 계정은 기존 자기 의견도 조회할 수 없다', async () => {
    for (const [uid, status] of [['feedback-pending', 'pending'], ['feedback-inactive', 'inactive'], ['feedback-blocked', 'blocked']]) {
      await seedFeedback('status-item-' + status, { createdByUid: uid, createdByName: '직원' });
      await seedUserDoc(uid, { uid, email: `${uid}@yeongjung.or.kr`, displayName: '직원', role: 'viewer', status });
      await assertFails(getDoc(doc(context(uid, `${uid}@yeongjung.or.kr`).firestore(), 'feedback', 'status-item-' + status)));
    }
  });

  it('admin과 super_admin은 전체 목록, status 필터 목록, 단건 조회를 할 수 있다', async () => {
    await seedFeedbackUsers(); await seedFeedback('received-item'); await seedFeedback('reviewing-item', { status: 'reviewing', reviewedByUid: ADMIN_UID, reviewedAt: new Date(), updatedAt: new Date() });
    await seedUserDoc('feedback-super-list', { uid: 'feedback-super-list', email: 'lth8210@yeongjung.or.kr', displayName: '슈퍼관리자', role: 'super_admin', status: 'active' });
    const adminDb = context(ADMIN_UID, ADMIN_EMAIL).firestore();
    await assertSucceeds(getDocs(query(collection(adminDb, 'feedback'), orderBy('createdAt', 'desc'), limit(25))));
    await assertSucceeds(getDocs(query(collection(adminDb, 'feedback'), where('status', '==', 'reviewing'), orderBy('createdAt', 'desc'), limit(25))));
    await assertSucceeds(getDoc(doc(context('feedback-super-list', 'lth8210@yeongjung.or.kr').firestore(), 'feedback', 'received-item')));
  });

  it('일반 직원은 의견 본문·작성자·진단정보·상태를 수정하거나 삭제할 수 없다', async () => {
    await seedFeedbackUsers(); await seedFeedback('immutable');
    const creatorDb = context(CREATOR_UID, CREATOR_EMAIL).firestore();
    await assertFails(updateDoc(doc(creatorDb, 'feedback', 'immutable'), { content: '변조' }));
    await assertFails(updateDoc(doc(creatorDb, 'feedback', 'immutable'), { status: 'reviewing', updatedAt: serverTimestamp(), reviewedByUid: CREATOR_UID, reviewedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(creatorDb, 'feedback', 'immutable')));
  });

  it('admin은 received → reviewing 전이를 정확한 reviewer/timestamp와 함께 수행할 수 있다', async () => {
    await seedFeedbackUsers(); await seedFeedback('to-review');
    const adminDb = context(ADMIN_UID, ADMIN_EMAIL).firestore();
    await assertSucceeds(updateDoc(doc(adminDb, 'feedback', 'to-review'), { status: 'reviewing', updatedAt: serverTimestamp(), reviewedByUid: ADMIN_UID, reviewedAt: serverTimestamp() }));
  });

  it('admin은 reviewing → completed 전이를 reviewer 보존과 completedAt 설정으로 수행할 수 있다', async () => {
    await seedFeedbackUsers(); await seedFeedback('to-complete', { status: 'reviewing', reviewedByUid: ADMIN_UID, reviewedAt: new Date(), updatedAt: new Date() });
    const adminDb = context(ADMIN_UID, ADMIN_EMAIL).firestore();
    await assertSucceeds(updateDoc(doc(adminDb, 'feedback', 'to-complete'), { status: 'completed', updatedAt: serverTimestamp(), completedAt: serverTimestamp() }));
  });

  it('admin도 received → completed 직접 전이, 되돌리기, reviewer 위조, timestamp 누락은 할 수 없다', async () => {
    await seedFeedbackUsers();
    const adminDb = context(ADMIN_UID, ADMIN_EMAIL).firestore();
    await seedFeedback('direct-complete');
    await seedFeedback('completed-item', { status: 'completed', reviewedByUid: ADMIN_UID, reviewedAt: new Date(), completedAt: new Date(), updatedAt: new Date() });
    await seedFeedback('reviewer-spoof');
    await assertFails(updateDoc(doc(adminDb, 'feedback', 'direct-complete'), { status: 'completed', updatedAt: serverTimestamp(), completedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(adminDb, 'feedback', 'completed-item'), { status: 'reviewing', updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(adminDb, 'feedback', 'reviewer-spoof'), { status: 'reviewing', updatedAt: serverTimestamp(), reviewedByUid: OTHER_UID, reviewedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(adminDb, 'feedback', 'reviewer-spoof'), { status: 'reviewing', reviewedByUid: ADMIN_UID, reviewedAt: serverTimestamp() }));
  });

  it('admin은 상태 외 모든 필드와 삭제를 변경할 수 없고 super_admin도 같은 불변 계약을 따른다', async () => {
    await seedFeedbackUsers(); await seedFeedback('admin-immutable');
    await seedUserDoc('feedback-super-update', { uid: 'feedback-super-update', email: 'lth8210@yeongjung.or.kr', displayName: '슈퍼관리자', role: 'super_admin', status: 'active' });
    const adminDb = context(ADMIN_UID, ADMIN_EMAIL).firestore();
    const superDb = context('feedback-super-update', 'lth8210@yeongjung.or.kr').firestore();
    await assertFails(updateDoc(doc(adminDb, 'feedback', 'admin-immutable'), { content: '수정 금지' }));
    await assertFails(updateDoc(doc(adminDb, 'feedback', 'admin-immutable'), { createdByName: '수정 금지' }));
    await assertFails(deleteDoc(doc(adminDb, 'feedback', 'admin-immutable')));
    await assertFails(updateDoc(doc(superDb, 'feedback', 'admin-immutable'), { route: '/changed' }));
    await assertFails(deleteDoc(doc(superDb, 'feedback', 'admin-immutable')));
  });
});
