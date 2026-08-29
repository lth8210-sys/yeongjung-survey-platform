import { describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from '../src/utils/clipboard.js';
import { getPublicSurveyUrl } from '../src/utils/publicSurveyUrl.js';

describe('public survey links and clipboard copy', () => {
  it('uses one canonical public survey URL for browser and non-browser callers', () => {
    expect(getPublicSurveyUrl('survey-1', 'https://yeongjung-survey-platform.web.app/'))
      .toBe('https://yeongjung-survey-platform.web.app/surveys/survey-1');
    expect(getPublicSurveyUrl('survey-1', '')).toBe('/surveys/survey-1');
  });

  it('uses the legacy textarea fallback when Clipboard API is unavailable or rejects', async () => {
    const textarea = { style: {}, setAttribute: vi.fn(), select: vi.fn() };
    const documentRef = {
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true),
    };
    await copyTextToClipboard('https://example.test/surveys/1', { documentRef });
    expect(textarea.value).toBe('https://example.test/surveys/1');
    expect(documentRef.execCommand).toHaveBeenCalledWith('copy');

    await copyTextToClipboard('fallback', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, documentRef });
    expect(documentRef.execCommand).toHaveBeenCalledTimes(2);
  });
});
