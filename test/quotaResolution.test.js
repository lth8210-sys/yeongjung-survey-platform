import { describe, it, expect } from 'vitest';
import {
  resolveRegionAgeQuota,
  distributeRegionAgeQuotaMatrix,
  createDefaultRegionAgeQuotaConfig,
  DEFAULT_REGION_AGE_QUOTA_CONFIG,
} from '../src/firebase/surveys.js';

// 권역×연령대 quota 매핑(KI-002 재발 이력)의 회귀 방지 테스트.
// 기본 설정(DEFAULT_REGION_AGE_QUOTA_CONFIG)은 실제 욕구조사 템플릿이 사용하는
// 권역/연령대 정의와 동일하다.
describe('resolveRegionAgeQuota — 권역/연령대 매핑', () => {
  const config = createDefaultRegionAgeQuotaConfig();

  it('단일 행정동은 해당 권역으로 정확히 매핑된다', () => {
    const result = resolveRegionAgeQuota({ area: '영등포본동', birthYear: 1990 }, config);
    expect(result.valid).toBe(true);
    expect(result.region.id).toBe('region_3');
  });

  it('실제 응답자 화면 드롭다운 표기("영등포동 2·5·7가" 형태의 결합 표기)도 정확히 매핑된다', () => {
    const result = resolveRegionAgeQuota({ area: '영등포동 2·5·7가', birthYear: 1990 }, config);
    expect(result.valid).toBe(true);
    expect(result.region.id).toBe('region_1');
  });

  it('공백/구분자가 달라도(가운뎃점 대신 쉼표 등) 동일 권역으로 매핑된다', () => {
    const withComma = resolveRegionAgeQuota({ area: '영등포동1,3,4,6,8가', birthYear: 1990 }, config);
    expect(withComma.valid).toBe(true);
    expect(withComma.region.id).toBe('region_2');
  });

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
    const result = resolveRegionAgeQuota({ area: '영등포본동', birthYear }, config);
    expect(result.valid).toBe(true);
    expect(result.ageGroup.id).toBe(expectedAgeGroupId);
  });

  it('매핑되지 않는 지역명은 invalid를 반환한다 (quotaConfig 오타/누락 방지)', () => {
    const result = resolveRegionAgeQuota({ area: '존재하지않는동', birthYear: 1990 }, config);
    expect(result.valid).toBe(false);
    expect(result.region).toBe(null);
  });

  it('출생연도가 숫자가 아니면 invalid를 반환한다', () => {
    const result = resolveRegionAgeQuota({ area: '영등포본동', birthYear: 'abc' }, config);
    expect(result.valid).toBe(false);
  });

  it('출생연도가 기준연도 이후(미래, 나이가 음수)면 invalid를 반환한다', () => {
    const result = resolveRegionAgeQuota({ area: '영등포본동', birthYear: 2030 }, config);
    expect(result.valid).toBe(false);
  });

  it('지역을 입력하지 않으면 invalid를 반환한다', () => {
    const result = resolveRegionAgeQuota({ area: '', birthYear: 1990 }, config);
    expect(result.valid).toBe(false);
  });
});

describe('distributeRegionAgeQuotaMatrix — 목표 응답수 자동 배분', () => {
  it('배분된 셀 합계가 totalTarget과 정확히 일치한다 (나머지 유실 없음)', () => {
    const config = createDefaultRegionAgeQuotaConfig({ totalTarget: 520 });
    const { matrix, regions, ageGroups } = distributeRegionAgeQuotaMatrix(config);

    const sum = regions.reduce(
      (regionTotal, region) =>
        regionTotal + ageGroups.reduce((ageTotal, ageGroup) => ageTotal + (matrix[region.id]?.[ageGroup.id] ?? 0), 0),
      0,
    );

    expect(sum).toBe(520);
  });

  it('나누어떨어지지 않는 총량(521 = 5권역×4연령대=20칸)도 합계가 정확히 보존된다', () => {
    const config = createDefaultRegionAgeQuotaConfig({ totalTarget: 521 });
    const { matrix, regions, ageGroups } = distributeRegionAgeQuotaMatrix(config);

    const sum = regions.reduce(
      (regionTotal, region) =>
        regionTotal + ageGroups.reduce((ageTotal, ageGroup) => ageTotal + (matrix[region.id]?.[ageGroup.id] ?? 0), 0),
      0,
    );

    expect(sum).toBe(521);
  });

  it('총량이 0이어도 음수 셀이 발생하지 않는다', () => {
    const config = createDefaultRegionAgeQuotaConfig({ totalTarget: 0 });
    const { matrix, regions, ageGroups } = distributeRegionAgeQuotaMatrix(config);

    regions.forEach((region) => {
      ageGroups.forEach((ageGroup) => {
        expect(matrix[region.id][ageGroup.id]).toBeGreaterThanOrEqual(0);
      });
    });
  });
});

describe('DEFAULT_REGION_AGE_QUOTA_CONFIG — 기본 정의 무결성', () => {
  it('모든 권역 id가 고유하다', () => {
    const ids = DEFAULT_REGION_AGE_QUOTA_CONFIG.regions.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('연령대가 빈틈이나 겹침 없이 이어진다 (0세부터 65+까지)', () => {
    const groups = [...DEFAULT_REGION_AGE_QUOTA_CONFIG.ageGroups].sort((a, b) => a.minAge - b.minAge);
    expect(groups[0].minAge).toBe(0);
    for (let i = 1; i < groups.length; i += 1) {
      expect(groups[i].minAge).toBe(groups[i - 1].maxAge + 1);
    }
    expect(groups[groups.length - 1].maxAge).toBe(null);
  });
});
