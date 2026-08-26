import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const multilineDescription = [
  '⭐ 확인문자를 받으신 분은 반드시 참석 여부를 회신해 주세요.',
  '',
  '⭐ 신청 후 별도의 연락 없이 당일 불참할 경우,',
  '추후 복지관 프로그램 이용에 제한이 있을 수 있습니다.',
].join('\n');

describe('page description display contract', () => {
  it('한국어 줄바꿈과 빈 줄 fixture를 변경하지 않는다', () => {
    expect(multilineDescription.split('\n')).toEqual([
      '⭐ 확인문자를 받으신 분은 반드시 참석 여부를 회신해 주세요.',
      '',
      '⭐ 신청 후 별도의 연락 없이 당일 불참할 경우,',
      '추후 복지관 프로그램 이용에 제한이 있을 수 있습니다.',
    ]);
  });

  it('Preview와 실제 응답 화면이 동일한 multiline class를 사용한다', () => {
    const preview = readFileSync('src/components/SurveyPreviewContent.jsx', 'utf8');
    const respondent = readFileSync('src/pages/SurveyResponsePage.jsx', 'utf8');
    const styles = readFileSync('src/styles.css', 'utf8');

    expect(preview).toContain('className="section-description"');
    expect(respondent).toContain('className="section-description"');
    expect(styles).toMatch(/\.section-description\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;/s);
  });
});
