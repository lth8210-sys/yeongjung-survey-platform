export function getPublicSurveyUrl(surveyId, origin = typeof window === 'undefined' ? '' : window.location.origin) {
  const path = `/surveys/${String(surveyId ?? '').trim()}`;
  return origin ? `${String(origin).replace(/\/$/, '')}${path}` : path;
}
