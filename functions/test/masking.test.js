import { describe, it, expect } from 'vitest';
import { maskName, maskPhone, maskBirthDate } from '../src/masking.js';

describe('functions/src/masking.js', () => {
  it('masks a 3+ char name keeping first/last char', () => {
    expect(maskName('홍길동')).toBe('홍*동');
  });

  it('masks a 2 char name', () => {
    expect(maskName('홍길')).toBe('홍*');
  });

  it('passes through empty/placeholder values unchanged', () => {
    expect(maskName('')).toBe('');
    expect(maskName('[익명처리됨]')).toBe('[익명처리됨]');
  });

  it('masks a hyphenated phone number', () => {
    expect(maskPhone('010-1234-5678')).toBe('010-****-5678');
  });

  it('masks a digits-only phone number', () => {
    expect(maskPhone('01012345678')).toBe('010-****-5678');
  });

  it('masks birth date to year only', () => {
    expect(maskBirthDate('1990-05-01')).toBe('1990-**-**');
  });

  it('returns **** for unparseable birth date', () => {
    expect(maskBirthDate('모름')).toBe('****');
  });

  it('passes through empty birth date unchanged', () => {
    expect(maskBirthDate('')).toBe('');
  });
});
