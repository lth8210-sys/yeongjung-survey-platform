/**
 * 개인정보 화면 마스킹 유틸리티
 * - Firestore 데이터 및 응답 저장 구조를 변경하지 않습니다.
 * - UI 목록/카드 표시 및 다운로드 파일에만 적용합니다.
 */

export function maskName(name) {
  const str = String(name ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]' || str === '[원본 확인 불가]') return str;
  if (str.length === 1) return str;
  if (str.length === 2) return str[0] + '*';
  return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
}

export function maskPhone(phone) {
  const str = String(phone ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]' || str === '[원본 확인 불가]') return str;

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

export function maskAddress(address) {
  const str = String(address ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]' || str === '[원본 확인 불가]') return str;
  const parts = str.split(/\s+/);
  if (parts.length <= 2) return str;
  return parts.slice(0, 2).join(' ') + ' ********';
}

// SYNC REQUIRED: functions/src/masking.js의 maskBirthDate와 동일하게 유지한다.
export function maskBirthDate(birthDate) {
  const str = String(birthDate ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]' || str === '[원본 확인 불가]') return str;
  const match = str.match(/^(\d{4})/);
  if (!match) return '****';
  return `${match[1]}-**-**`;
}

const NAME_KEYWORDS = ['이름', '성명', '성함'];
const PHONE_KEYWORDS = ['연락처', '전화', '휴대폰', '핸드폰', '전화번호', '휴대전화'];
const ADDRESS_KEYWORDS = ['주소', '거주지'];

export function maskAnswerByQuestion(displayValue, questionTitle = '', questionType = '') {
  const str = String(displayValue ?? '').trim();
  if (!str || str === '-' || str === '[익명처리됨]' || str === '[원본 확인 불가]') return str;

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

export function maskResponsesForDownload(responses, piiQuestionIds) {
  if (!piiQuestionIds || piiQuestionIds.size === 0) return responses;

  return responses.map((response) => ({
    ...response,
    answers: Array.isArray(response.answers)
      ? response.answers.map((item) =>
          piiQuestionIds.has(item?.questionId)
            ? { ...item, answer: '[마스킹됨]' }
            : item,
        )
      : response.answers,
    respondentName: response.respondentName ? '[마스킹됨]' : response.respondentName,
    respondentPhone: response.respondentPhone ? '[마스킹됨]' : response.respondentPhone,
    respondent: response.respondent
      ? {
          ...response.respondent,
          applicantName: response.respondent.applicantName
            ? '[마스킹됨]'
            : response.respondent.applicantName,
          applicantPhone: response.respondent.applicantPhone
            ? '[마스킹됨]'
            : response.respondent.applicantPhone,
        }
      : response.respondent,
  }));
}
