import { describe, it, expect } from 'vitest';
import {
  resolveAgeQuota,
  distributeAgeQuotaTargets,
  createDefaultAgeQuotaConfig,
  DEFAULT_AGE_QUOTA_CONFIG,
} from '../src/firebase/surveys.js';

// 연령대 quota 매핑(KI-002 재발 이력)의 회귀 방지 테스트.
// 기본 설정(DEFAULT_AGE_QUOTA_CONFIG)은 실제 욕구조사 템플릿이 사용하는
// 연령대 정의와 동일하다. 2026-07 사이클부터 quota는 연령대만 사용하며
// 지역(권역) quota는 폐지되었다(주소가 자유 입력 텍스트로 바뀌며 매핑 불가).
describe('resolveAgeQuota — 연령대 매핑', () => {
  const config = createDefaultAgeQuotaConfig();

  it.each([
    [2026, 0, 'age_0_19'],
    [2007, 19, 'age_0_19'],
    [2006, 20, 'age_20_39'],
    [1987, 39, 'age_20_39'],
    [1986, 40, 'age_40_64'],
    [1962, 64, 'age_40_64'],
    [1961, 65, 'age_65_plus'],
    [1900, 126, 'age_65_plus'],
  ])('출생연도 %i(만 %i세)는 연령대 "%s"로 매핑된다 (baseYear=2026 경계값)', (birthYear, _age, expectedAgeGroupId) => {
    const result = resolveAgeQuota({ birthYear }, config);
    expect(result.valid).toBe(true);
    expect(result.ageGroup.id).toBe(expectedAgeGroupId);
  });

  it('출생연도가 숫자가 아니면 invalid를 반환한다', () => {
    const result = resolveAgeQuota({ birthYear: 'abc' }, config);
    expect(result.valid).toBe(false);
  });

  it('출생연도가 기준연도 이후(미래, 나이가 음수)면 invalid를 반환한다', () => {
    const result = resolveAgeQuota({ birthYear: 2030 }, config);
    expect(result.valid).toBe(false);
  });

  it('출생연도를 입력하지 않으면 invalid를 반환한다', () => {
    const result = resolveAgeQuota({ birthYear: '' }, config);
    expect(result.valid).toBe(false);
  });
});

describe('distributeAgeQuotaTargets — 목표 응답수 자동 배분', () => {
  it('배분된 연령대 합계가 totalTarget과 정확히 일치한다 (나머지 유실 없음)', () => {
    const config = createDefaultAgeQuotaConfig({ totalTarget: 520 });
    const { targets, ageGroups } = distributeAgeQuotaTargets(config);

    const sum = ageGroups.reduce((total, ageGroup) => total + (targets[ageGroup.id] ?? 0), 0);

    expect(sum).toBe(520);
  });

  it('나누어떨어지지 않는 총량(521 = 4연령대)도 합계가 정확히 보존된다', () => {
    const config = createDefaultAgeQuotaConfig({ totalTarget: 521 });
    const { targets, ageGroups } = distributeAgeQuotaTargets(config);

    const sum = ageGroups.reduce((total, ageGroup) => total + (targets[ageGroup.id] ?? 0), 0);

    expect(sum).toBe(521);
  });

  it('총량이 0이어도 음수 값이 발생하지 않는다', () => {
    const config = createDefaultAgeQuotaConfig({ totalTarget: 0 });
    const { targets, ageGroups } = distributeAgeQuotaTargets(config);

    ageGroups.forEach((ageGroup) => {
      expect(targets[ageGroup.id]).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('DEFAULT_AGE_QUOTA_CONFIG — 기본 정의 무결성', () => {
  it('모든 연령대 id가 고유하다', () => {
    const ids = DEFAULT_AGE_QUOTA_CONFIG.ageGroups.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('연령대가 빈틈이나 겹침 없이 이어진다 (0세부터 65+까지)', () => {
    const groups = [...DEFAULT_AGE_QUOTA_CONFIG.ageGroups].sort((a, b) => a.minAge - b.minAge);
    expect(groups[0].minAge).toBe(0);
    for (let i = 1; i < groups.length; i += 1) {
      expect(groups[i].minAge).toBe(groups[i - 1].maxAge + 1);
    }
    expect(groups[groups.length - 1].maxAge).toBe(null);
  });
});
