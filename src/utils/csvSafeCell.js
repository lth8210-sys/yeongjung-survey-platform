// CSV/Excel 수식 인젝션 방지 유틸.
// 응답자가 자유응답/이름 등에 `=`, `+`, `-`, `@`로 시작하는 값(예: =HYPERLINK(...))을
// 입력하면, 관리자가 CSV/Excel을 스프레드시트 프로그램(엑셀 등)으로 열 때 수식으로
// 해석되어 실행될 수 있다(CSV Injection / Formula Injection). OWASP 권고에 따라
// 위험 문자로 시작하는 셀 값 앞에 작은따옴표를 붙여 텍스트로 강제 처리한다.
const DANGEROUS_LEADING_CHARS = new Set(['=', '+', '-', '@', '\t', '\r']);

export function sanitizeCellValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  const stringValue = String(value);

  if (stringValue.length === 0) {
    return stringValue;
  }

  return DANGEROUS_LEADING_CHARS.has(stringValue[0]) ? `'${stringValue}` : stringValue;
}

export function sanitizeRow(row = []) {
  return row.map((value) => sanitizeCellValue(value));
}
