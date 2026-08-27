import { describe, expect, it } from 'vitest';
import { FEEDBACK_MAX_LENGTH, FEEDBACK_NEXT_STATUSES, getFeedbackContext, normalizeFeedbackContent } from '../src/firebase/feedback.js';
describe('feedback helpers', () => {
  it('derives survey context without response identifiers', () => expect(getFeedbackContext('/admin/surveys/abc/responses')).toEqual({ surveyId: 'abc', pageName: '응답 관리' }));
  it('uses deterministic general page names', () => expect(getFeedbackContext('/surveys')).toEqual({ surveyId: null, pageName: '설문 목록' }));
  it('trims content and enforces the documented maximum', () => { expect(normalizeFeedbackContent('  의견  ')).toBe('의견'); expect(FEEDBACK_MAX_LENGTH).toBe(2000); });
  it('allows only forward status transitions in the UI helper contract', () => {
    expect(FEEDBACK_NEXT_STATUSES).toEqual({ received: 'reviewing', reviewing: 'completed' });
    expect(FEEDBACK_NEXT_STATUSES.completed).toBeUndefined();
  });
});
