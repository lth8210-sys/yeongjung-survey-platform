import { describe, it, expect } from 'vitest';
import { sanitizeCellValue, sanitizeRow } from '../src/utils/csvSafeCell.js';

// RA-03 (CSV/Excel 수식 인젝션) 회귀 방지 테스트.
// 응답자가 자유응답에 =, +, -, @로 시작하는 값을 넣어도 스프레드시트에서
// 수식으로 해석되지 않도록 앞에 작은따옴표가 붙어야 한다.
describe('sanitizeCellValue — CSV/Excel 수식 인젝션 방지', () => {
  it.each([
    ['=HYPERLINK("http://evil.example","click")', "'=HYPERLINK(\"http://evil.example\",\"click\")"],
    ['+1+1', "'+1+1"],
    ['-1+1', "'-1+1"],
    ['@SUM(1,1)', "'@SUM(1,1)"],
    ['\t=cmd', "'\t=cmd"],
  ])('위험 접두문자 "%s" 는 작은따옴표로 무력화된다', (input, expected) => {
    expect(sanitizeCellValue(input)).toBe(expected);
  });

  it('일반 텍스트/한글 응답은 변경되지 않는다', () => {
    expect(sanitizeCellValue('홍길동')).toBe('홍길동');
    expect(sanitizeCellValue('만족합니다')).toBe('만족합니다');
    expect(sanitizeCellValue('010-1234-5678')).toBe('010-1234-5678');
  });

  it('숫자/불리언은 그대로 유지된다 (통계 집계 값 등)', () => {
    expect(sanitizeCellValue(42)).toBe(42);
    expect(sanitizeCellValue(0)).toBe(0);
    expect(sanitizeCellValue(true)).toBe(true);
  });

  it('null/undefined/빈문자열은 그대로 유지된다', () => {
    expect(sanitizeCellValue(null)).toBe(null);
    expect(sanitizeCellValue(undefined)).toBe(undefined);
    expect(sanitizeCellValue('')).toBe('');
  });

  it('sanitizeRow는 배열의 각 값에 동일하게 적용된다', () => {
    expect(sanitizeRow(['정상값', '=위험값', 42, null])).toEqual(['정상값', "'=위험값", 42, null]);
  });
});
