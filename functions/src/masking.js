/**
 * 개인정보 마스킹 유틸리티 — 서버(Cloud Functions) 사본.
 * SYNC REQUIRED: ../../src/utils/privacy.js 의 maskName/maskPhone/maskBirthDate와 로직을 동일하게 유지해야 한다.
 * Cloud Functions 배포는 functions/ 디렉터리만 패키징하므로 상위 src/를 import할 수 없어 부득이하게 복제한다
 * (이 프로젝트가 이미 firestore.rules / src/firebase/users.js 사이에서 SUPER_ADMIN_EMAILS를 같은 방식으로
 * 중복 관리하고 있는 기존 관례를 따른 것— 신규 패턴 도입 아님).
 */

export function maskName(name) {
  const str = String(name ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]') return str;
  if (str.length === 1) return str;
  if (str.length === 2) return str[0] + '*';
  return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
}

export function maskPhone(phone) {
  const str = String(phone ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]') return str;

  const parts = str.split('-');
  if (parts.length === 3) {
    return `${parts[0]}-****-${parts[2]}`;
  }

  const digits = str.replace(/\D/g, '');
  if (digits.length >= 10) {
    const area = digits.slice(0, 3);
    const end = digits.slice(-4);
    return `${area}-****-${end}`;
  }

  if (str.length <= 4) return str;
  const visible = Math.max(1, Math.floor(str.length / 4));
  return str.slice(0, visible) + '*'.repeat(str.length - visible * 2) + str.slice(-visible);
}

// src/utils/privacy.js에는 없는 신규 함수 — 생년월일은 연도만 노출한다(기존 maskAddress와 동일한
// "앞부분만 노출" 패턴). 클라이언트(src/utils/privacy.js)에도 동일 함수를 추가했다.
export function maskBirthDate(birthDate) {
  const str = String(birthDate ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]') return str;
  const match = str.match(/^(\d{4})/);
  if (!match) return '****';
  return `${match[1]}-**-**`;
}

// SYNC REQUIRED: src/utils/privacy.js의 maskAddress와 동일하게 유지한다.
export function maskAddress(address) {
  const str = String(address ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]') return str;
  const parts = str.split(/\s+/);
  if (parts.length <= 2) return str;
  return parts.slice(0, 2).join(' ') + ' ********';
}

const NAME_KEYWORDS = ['이름', '성명', '성함'];
const PHONE_KEYWORDS = ['연락처', '전화', '휴대폰', '핸드폰', '전화번호', '휴대전화'];
const ADDRESS_KEYWORDS = ['주소', '거주지'];

// SYNC REQUIRED: src/utils/privacy.js의 maskAnswerByQuestion과 동일하게 유지한다.
// 제출 서버 콜러블(submitProtectedSurveyResponse)이 answers[] PII 문항의 저장용 마스킹 미리보기를
// 만들 때 쓴다 — 클라이언트가 보낸 마스킹값을 신뢰하지 않고 서버가 원본 답변으로 직접 계산한다.
export function maskAnswerByQuestion(displayValue, questionTitle = '', questionType = '') {
  const str = String(displayValue ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]') return str;

  const titleLower = String(questionTitle).toLowerCase();
  const typeLower = String(questionType).toLowerCase();

  if (typeLower === 'phone' || PHONE_KEYWORDS.some((kw) => titleLower.includes(kw))) {
    return maskPhone(str);
  }

  if (NAME_KEYWORDS.some((kw) => titleLower.includes(kw))) {
    return maskName(str);
  }

  if (ADDRESS_KEYWORDS.some((kw) => titleLower.includes(kw))) {
    return maskAddress(str);
  }

  if (str.length <= 2) return '*'.repeat(str.length);
  return str[0] + '*'.repeat(Math.max(1, str.length - 2)) + str[str.length - 1];
}
