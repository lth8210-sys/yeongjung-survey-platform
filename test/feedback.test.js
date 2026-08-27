import { describe, expect, it } from 'vitest';
import { ADMIN_REPLY_MAX_LENGTH, FEEDBACK_MAX_LENGTH, FEEDBACK_NEXT_STATUSES, canCompleteFeedback, getFeedbackContext, getFeedbackReplyMessage, normalizeAdminReply, normalizeFeedbackContent } from '../src/firebase/feedback.js';
describe('feedback helpers', () => {
  it('derives survey context without response identifiers', () => expect(getFeedbackContext('/admin/surveys/abc/responses')).toEqual({ surveyId: 'abc', pageName: '응답 관리' }));
  it('uses deterministic general page names', () => expect(getFeedbackContext('/surveys')).toEqual({ surveyId: null, pageName: '설문 목록' }));
  it('trims content and enforces the documented maximum', () => { expect(normalizeFeedbackContent('  의견  ')).toBe('의견'); expect(FEEDBACK_MAX_LENGTH).toBe(2000); });
  it('allows only forward status transitions in the UI helper contract', () => {
    expect(FEEDBACK_NEXT_STATUSES).toEqual({ received: 'reviewing', reviewing: 'completed' });
    expect(FEEDBACK_NEXT_STATUSES.completed).toBeUndefined();
  });
  it('validates administrator replies and completed-state eligibility', () => { expect(normalizeAdminReply('  처리 완료  ')).toBe('처리 완료'); expect(ADMIN_REPLY_MAX_LENGTH).toBe(2000); expect(canCompleteFeedback({ status: 'reviewing', adminReply: '답변' })).toBe(true); expect(canCompleteFeedback({ status: 'reviewing', adminReply: ' ' })).toBe(false); });
  it('uses distinct employee messages for received, reviewing, and legacy completed feedback', () => { expect(getFeedbackReplyMessage('received', '')).toContain('기다리고'); expect(getFeedbackReplyMessage('reviewing', '')).toContain('확인'); expect(getFeedbackReplyMessage('completed', '')).toContain('기존 방식'); });
});
