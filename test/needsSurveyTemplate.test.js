import { describe, it, expect } from 'vitest';
import { FORM_TEMPLATES } from '../src/data/formTemplates.js';
import { buildVisibleQuestionFlow } from '../src/utils/responseFlow.js';
import { QUESTION_TYPES } from '../src/firebase/surveyConstants.js';
import {
  getQuotaField,
  isConsentRequiredButMissing,
  filterDraftAnswers,
} from '../src/pages/SurveyResponsePage.jsx';

// "2026 영중 지역주민 욕구조사" 템플릿(src/data/formTemplates.js)이 최신 설문지(DOCX)와
// 실제로 일치하는지, Q45→Q46 조건부 표시가 실제 문항 id/보기 문자열로도 정상 동작하는지
// 검증하는 통합 테스트. 합성 픽스처가 아닌 실제 템플릿 데이터를 그대로 사용한다.
const template = FORM_TEMPLATES.find((t) => t.id === 'yeongjung_community_needs_2026_v1');
const surveyFixture = { questions: template.questions, sections: template.sections };

function findQuestion(id) {
  return template.questions.find((q) => q.id === id);
}

describe('2026 영중 지역주민 욕구조사 템플릿 — 최신 설문지 반영 검증', () => {
  it('Q1은 주소 자유 입력 문항이며 지역 선택형이 아니다', () => {
    const q1 = findQuestion('needs-q01');
    expect(q1.type).toBe(QUESTION_TYPES.SHORT_TEXT);
    expect(q1.meta?.addressField).toBe(true);
    expect(q1.options ?? []).toEqual([]);
  });

  it('Q45는 세대원 다중선택이며 6개 세대 보기를 모두 포함한다', () => {
    const q45 = findQuestion('needs-q45');
    expect(q45.type).toBe(QUESTION_TYPES.MULTIPLE_CHOICE);
    expect(q45.options).toEqual(['영유아(0~만 5세)', '아동(만 6세~만 11세)', '청소년', '청년', '중장년', '노년']);
  });

  it('Q46-1~6과 노년 출생연도 문항은 모두 Q45 기반 visibilityConditions을 갖는다', () => {
    ['needs-q46-1', 'needs-q46-2', 'needs-q46-3', 'needs-q46-4', 'needs-q46-5', 'needs-q46-6', 'needs-q46-6-birthyear'].forEach(
      (id) => {
        const question = findQuestion(id);
        expect(question, `${id} 문항이 존재해야 한다`).toBeTruthy();
        expect(question.visibilityConditions?.[0]?.questionId).toBe('needs-q45');
      },
    );
  });

  it('중장년(46-5)과 노년(46-6) 보기에는 "경제적 지원"이 포함된다', () => {
    expect(findQuestion('needs-q46-5').options).toContain('경제적 지원');
    expect(findQuestion('needs-q46-6').options).toContain('경제적 지원');
  });

  it('구 Q47(지원 필요 이유)은 삭제되었고, Q47은 선호 요일/시간대 문항이다', () => {
    expect(findQuestion('needs-q47').title).toContain('선호하는 요일과 시간대');
  });

  it('Q48(동네 불편)은 "재개발·상권변화" 보기를 포함하지 않는다', () => {
    expect(findQuestion('needs-q48').options).not.toContain('재개발·상권변화로 인한 불편');
  });

  it('마지막 개방형 문항은 Q49~Q52 4개이며 Q53은 존재하지 않는다', () => {
    ['needs-q49', 'needs-q50', 'needs-q51', 'needs-q52'].forEach((id) => {
      expect(findQuestion(id).type).toBe(QUESTION_TYPES.LONG_TEXT);
    });
    expect(findQuestion('needs-q53')).toBeUndefined();
  });

  it('영유아만 선택 시 실제 흐름에서 needs-q46-1만 노출되고 나머지 세대 문항은 숨겨진다', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '예', 'needs-q34': '예', 'needs-q45': ['영유아(0~만 5세)'] },
    });

    expect(flow.visibleQuestionIds).toContain('needs-q46-1');
    ['needs-q46-2', 'needs-q46-3', 'needs-q46-4', 'needs-q46-5', 'needs-q46-6', 'needs-q46-6-birthyear'].forEach((id) => {
      expect(flow.visibleQuestionIds).not.toContain(id);
    });
  });

  it('노년 선택 시 출생연도와 노년 욕구 문항이 함께 노출된다', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '예', 'needs-q34': '예', 'needs-q45': ['노년'] },
    });

    expect(flow.visibleQuestionIds).toContain('needs-q46-6-birthyear');
    expect(flow.visibleQuestionIds).toContain('needs-q46-6');
  });

  it('세대원을 아무것도 선택하지 않으면 Q46 계열 문항이 하나도 노출되지 않는다', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '예', 'needs-q34': '예', 'needs-q45': [] },
    });

    const q46Ids = template.questions
      .map((q) => q.id)
      .filter((id) => id.startsWith('needs-q46'));
    q46Ids.forEach((id) => {
      expect(flow.visibleQuestionIds).not.toContain(id);
    });
  });

  it('quotaConfig는 age-only 구조이며 region 필드를 갖지 않는다', () => {
    expect(template.quotaConfig.regions).toBeUndefined();
    expect(template.quotaConfig.matrix).toBeUndefined();
    expect(template.quotaConfig.targets).toBeTruthy();
    expect(template.quotaConfig.ageGroups.length).toBe(4);
  });

  it('설문 마지막에 경품 연락처와 개인정보 수집·이용 동의 문항이 있으며 둘 다 선택(optional)이다', () => {
    const contact = findQuestion('needs-consent-contact');
    const consent = findQuestion('needs-consent-checkbox');

    expect(contact.type).toBe(QUESTION_TYPES.PHONE);
    expect(contact.required).toBe(false);
    expect(consent.type).toBe(QUESTION_TYPES.CONSENT_CHECKBOX);
    expect(consent.required).toBe(false);
    expect(consent.settings.collectionItems).toBe('연락처');
  });

  it('동의 거부가 설문 흐름을 막지 않는다 (동의 미체크 상태로도 다음 문항까지 도달)', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: {
        'needs-q28': '예',
        'needs-q34': '예',
        'needs-consent-contact': '',
        'needs-consent-checkbox': false,
      },
    });

    expect(flow.visibleQuestionIds).toContain('needs-consent-checkbox');
    expect(flow.termination).toBeFalsy();
  });
});

// 배포 전 발견된 회귀 버그: Q4(본인 출생연도)를 정상 입력해도 "Q4 출생연도를 확인해주세요."
// 안내와 함께 다음 페이지로 넘어가지 않던 문제. 원인은 SurveyResponsePage.jsx의
// getQuotaField()가 quotaField를 문항 제목의 "출생연도"/"출생년도" 텍스트로도 추정하는데,
// Q46-6-birthyear("[노년] 함께 살고 있는 노년 가족의 출생연도...")도 같은 텍스트를 포함해
// 같은 필드로 잘못 분류되었고, quotaInput 계산 시 문항 순서상 나중에 오는 이 값(설문
// 1페이지 시점엔 항상 빈 값)이 Q4의 값을 덮어써 quota 검증이 항상 실패했다.
describe('getQuotaField — Q4 출생연도 quota 매칭 회귀 방지', () => {
  it('Q4(본인 출생연도)는 quotaField가 birthYear로 분류된다', () => {
    const q4 = template.questions.find((q) => q.id === 'needs-q04');
    expect(getQuotaField(q4)).toBe('birthYear');
  });

  it('Q46-6-birthyear(동거 노년 가족 출생연도)는 제목에 "출생연도"가 포함되어도 quotaField로 분류되지 않는다', () => {
    const seniorBirthYear = template.questions.find((q) => q.id === 'needs-q46-6-birthyear');
    expect(seniorBirthYear.meta?.quotaField).toBe('none');
    expect(getQuotaField(seniorBirthYear)).toBe('');
  });

  it('설문 전체 문항을 순서대로 훑어도 Q4에 입력한 값이 다른 문항에 덮어써지지 않는다 (실제 quotaInput 계산 재현)', () => {
    const nextInput = { birthYear: '' };
    template.questions.forEach((question) => {
      if (getQuotaField(question) !== 'birthYear') return;
      // Q4에만 값이 입력된 상태(1페이지 응답 직후)를 재현 — Q46-6-birthyear는 아직 미응답(빈 값).
      const answerByQuestionId = { 'needs-q04': '1974', 'needs-q46-6-birthyear': '' };
      nextInput.birthYear = answerByQuestionId[question.id] ?? '';
    });

    expect(nextInput.birthYear).toBe('1974');
  });

  it('1974처럼 정상적인 4자리 출생연도는 연령대 매칭에 성공한다', () => {
    const config = template.quotaConfig;
    // resolveAgeQuota와 동일한 baseYear 기준 나이 계산: 2026 - 1974 = 52세 → 40~64세 구간
    const age = config.baseYear - 1974;
    const matchedGroup = config.ageGroups.find(
      (group) => age >= group.minAge && (group.maxAge === null || age <= group.maxAge),
    );
    expect(matchedGroup?.id).toBe('age_40_64');
  });
});

// 배포 전 보완: "연락처를 입력한 경우에만 개인정보 동의가 필요하다"는 조건부 동의 정책.
// 설문 제출 자체는 항상 가능해야 하며, 연락처 미입력 시에는 동의 여부와 무관하게 통과해야 한다.
describe('isConsentRequiredButMissing — 조건부 개인정보 동의 정책', () => {
  it('연락처 미입력 + 동의 미체크: 통과(제출 가능)', () => {
    expect(isConsentRequiredButMissing({ triggerAnswer: '', consentAnswer: false })).toBe(false);
  });

  it('연락처 미입력 + 동의 체크: 통과(제출 가능)', () => {
    expect(isConsentRequiredButMissing({ triggerAnswer: '', consentAnswer: true })).toBe(false);
  });

  it('연락처 입력 + 동의 체크: 통과(제출 가능)', () => {
    expect(isConsentRequiredButMissing({ triggerAnswer: '010-1234-5678', consentAnswer: true })).toBe(false);
  });

  it('연락처 입력 + 동의 미체크: 검증 실패(제출 차단 대상)', () => {
    expect(isConsentRequiredButMissing({ triggerAnswer: '010-1234-5678', consentAnswer: false })).toBe(true);
  });

  it('연락처가 공백만 있는 경우는 미입력으로 취급한다', () => {
    expect(isConsentRequiredButMissing({ triggerAnswer: '   ', consentAnswer: false })).toBe(false);
  });

  it('실제 템플릿의 동의 문항에 conditionalConsentField가 연락처 문항 id로 연결되어 있다', () => {
    const consent = template.questions.find((q) => q.id === 'needs-consent-checkbox');
    expect(consent.meta.conditionalConsentField).toBe('needs-consent-contact');
  });

  it('다른 템플릿(예: 프로그램 신청)의 필수 개인정보 동의는 이 조건부 마커가 없어 기존 방식(항상 필수)을 그대로 따른다', () => {
    const programApplication = FORM_TEMPLATES.find((t) => t.id === 'program-application');
    const consentQuestion = programApplication.questions.find(
      (q) => q.type === QUESTION_TYPES.CONSENT_CHECKBOX,
    );
    expect(consentQuestion.meta?.conditionalConsentField).toBeUndefined();
  });
});

// 배포 전 최종 회귀테스트: 실제 템플릿 데이터로 주요 분기·문항 형식을 다시 확인한다.
describe('배포 전 최종 회귀테스트 — 실제 응답 흐름 기준', () => {
  it('Q28=예 선택 시 Q29로 이동하고 Q30은 건너뛴다', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '예', 'needs-q34': '예' },
    });
    expect(flow.visibleQuestionIds).toContain('needs-q29');
    expect(flow.visibleQuestionIds).not.toContain('needs-q30');
  });

  it('Q28=아니오 선택 시 Q30으로 이동하고 Q29는 건너뛴다', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '아니오', 'needs-q34': '예' },
    });
    expect(flow.visibleQuestionIds).toContain('needs-q30');
    expect(flow.visibleQuestionIds).not.toContain('needs-q29');
  });

  it('Q34=예 선택 시 Q36으로 이동하고 Q35는 건너뛴다', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '예', 'needs-q34': '예' },
    });
    expect(flow.visibleQuestionIds).toContain('needs-q36');
    expect(flow.visibleQuestionIds).not.toContain('needs-q35');
  });

  it('Q34=아니오 선택 시 Q35로 이동하고, Q35 응답 후 Q41로 이동한다(Q36~Q40 건너뜀)', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: { 'needs-q28': '예', 'needs-q34': '아니오', 'needs-q35': ['시간 없음'] },
    });
    expect(flow.visibleQuestionIds).toContain('needs-q35');
    expect(flow.visibleQuestionIds).toContain('needs-q41');
    ['needs-q36', 'needs-q37', 'needs-q38', 'needs-q39', 'needs-q40'].forEach((id) => {
      expect(flow.visibleQuestionIds).not.toContain(id);
    });
  });

  it('Q35 문항은 복수선택(MULTIPLE_CHOICE) 형식이며 제목에 "해당 모두 선택"이 포함된다', () => {
    const q35 = findQuestion('needs-q35');
    expect(q35.type).toBe(QUESTION_TYPES.MULTIPLE_CHOICE);
    expect(q35.title).toContain('해당 모두 선택');
  });

  it('Q42, Q43은 0~10점 척도(LINEAR_SCALE)이다', () => {
    const q42 = findQuestion('needs-q42');
    const q43 = findQuestion('needs-q43');
    [q42, q43].forEach((q) => {
      expect(q.type).toBe(QUESTION_TYPES.LINEAR_SCALE);
      expect(q.settings.min).toBe(0);
      expect(q.settings.max).toBe(10);
    });
  });

  it('Q1은 도로명/지번 예시가 안내문과 placeholder에 모두 포함된다', () => {
    const q1 = findQuestion('needs-q01');
    expect(q1.description).toContain('양산로 232');
    expect(q1.description).toContain('영등포동2가 466');
    expect(q1.placeholder).toContain('양산로 232');
    expect(q1.placeholder).toContain('영등포동2가 466');
  });

  it('Q45 선택에 따라 Q46-1~Q46-6 조건부 표시가 정상 동작한다(영유아+청년 복수선택)', () => {
    const flow = buildVisibleQuestionFlow({
      survey: surveyFixture,
      answers: {
        'needs-q28': '예',
        'needs-q34': '예',
        'needs-q45': ['영유아(0~만 5세)', '청년'],
      },
    });
    expect(flow.visibleQuestionIds).toContain('needs-q46-1');
    expect(flow.visibleQuestionIds).toContain('needs-q46-4');
    ['needs-q46-2', 'needs-q46-3', 'needs-q46-5', 'needs-q46-6', 'needs-q46-6-birthyear'].forEach((id) => {
      expect(flow.visibleQuestionIds).not.toContain(id);
    });
  });
});

// 회귀 배경: 로컬 임시저장(localStorage draft)에 phone 타입 답변(연락처)이 평문으로
// 저장되고 있었다. 공용 PC에서 작성 중 이탈하면 최대 7일(cleanupOldDrafts 주기)간
// 개인정보가 남을 수 있어, 임시저장 payload를 만들 때 phone 답변을 제외하도록
// 수정했다. 실제 설문에 존재하는 연락처 문항(needs-consent-contact, phone 타입)으로
// 검증한다.
describe('filterDraftAnswers — 로컬 임시저장에서 연락처(phone) 답변 제외', () => {
  it('phone 타입 문항 답변은 임시저장 대상에서 제외된다', () => {
    const answers = {
      'needs-q01': '영등포구 양산로 232',
      'needs-consent-contact': '010-1234-5678',
    };
    const visibleQuestionIds = ['needs-q01', 'needs-consent-contact'];

    const result = filterDraftAnswers(answers, template.questions, visibleQuestionIds);

    expect(result).toEqual({ 'needs-q01': '영등포구 양산로 232' });
    expect(result['needs-consent-contact']).toBeUndefined();
  });

  it('보이지 않는(visible 아닌) 문항의 답변도 기존과 동일하게 제외된다(회귀 없음)', () => {
    const answers = { 'needs-q01': '주소', 'needs-q02': '5년' };
    const visibleQuestionIds = ['needs-q01'];

    const result = filterDraftAnswers(answers, template.questions, visibleQuestionIds);

    expect(result).toEqual({ 'needs-q01': '주소' });
  });

  it('phone 문항이 없는 설문에서는 기존 동작과 동일하다', () => {
    const answers = { q1: 'a', q2: 'b' };
    const questions = [
      { id: 'q1', type: QUESTION_TYPES.SHORT_TEXT },
      { id: 'q2', type: QUESTION_TYPES.SHORT_TEXT },
    ];

    const result = filterDraftAnswers(answers, questions, ['q1', 'q2']);

    expect(result).toEqual({ q1: 'a', q2: 'b' });
  });
});
