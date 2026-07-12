import { httpsCallable } from 'firebase/functions';
import { functionsClient, isFirebaseConfigured } from './config';
import { logger } from '../utils/logger';

/**
 * 권한 있는 사용자가 특정 응답의 실명/연락처/생년월일을 서버에서 복호화해 가져온다.
 * - 서버(revealResponsePii)가 역할을 재검증하고 감사로그를 남긴다 — 클라이언트는 결과만 받는다.
 * - 반환값은 호출자가 화면에 표시하는 용도로만 쓰고, 어디에도 영구 저장하지 않는다(호출부 책임).
 *
 * @param {string} responseId
 * @returns {Promise<{ name: string, phone: string, birthDate: string, piiProtected: boolean }>}
 */
export async function revealResponsePii(responseId) {
  if (!responseId) {
    throw new Error('responseId가 필요합니다.');
  }
  if (!isFirebaseConfigured || !functionsClient) {
    throw new Error('Firebase Functions가 설정되지 않았습니다.');
  }

  try {
    const reveal = httpsCallable(functionsClient, 'revealResponsePii');
    const result = await reveal({ responseId });
    return result?.data ?? { name: '', phone: '', birthDate: '', piiProtected: false };
  } catch (error) {
    logger.error('[piiReveal] revealResponsePii failed', { code: error?.code ?? 'unknown', responseId });
    throw error;
  }
}
