/**
 * 운영 로그 보안 유틸리티
 * - DEV: 기존 console 그대로 출력
 * - PROD: uid, email, Firestore path, payload, stack 등 민감정보를 [MASKED]로 출력
 */

const IS_DEV = import.meta.env.DEV;
const IS_LOCALHOST =
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
const SHOULD_MASK = !IS_DEV && !IS_LOCALHOST && import.meta.env.PROD;
const MASKED = '[MASKED]';

const SENSITIVE_KEYS = new Set([
  'uid',
  'email',
  'path',
  'payload',
  'stack',
  'surveyPath',
  'responsePath',
  'clientSubmitLockPath',
  'quotaConfigPath',
  'quotaCountsPath',
  'applicationApplicantLockPath',
  'applicationSlotLockPath',
]);

function maskData(data) {
  if (data === null || data === undefined) return data;
  if (data instanceof Error) {
    return SHOULD_MASK ? { message: MASKED, code: data.code ?? '' } : data;
  }
  if (typeof data !== 'object' || Array.isArray(data)) return data;

  const result = {};
  for (const [key, value] of Object.entries(data)) {
    result[key] = SENSITIVE_KEYS.has(key) ? MASKED : value;
  }
  return result;
}

export const logger = {
  debug(message, data) {
    if (SHOULD_MASK) return;
    if (data !== undefined) {
      console.debug(message, data);
    } else {
      console.debug(message);
    }
  },

  warn(message, data) {
    if (SHOULD_MASK) {
      if (data !== undefined) {
        console.warn(message, maskData(data));
      } else {
        console.warn(message);
      }
    } else if (data !== undefined) {
      console.warn(message, data);
    } else {
      console.warn(message);
    }
  },

  error(message, data) {
    if (SHOULD_MASK) {
      if (data !== undefined) {
        console.error(message, maskData(data));
      } else {
        console.error(message);
      }
    } else if (data !== undefined) {
      console.error(message, data);
    } else {
      console.error(message);
    }
  },
};
