/**
 * Cloud KMS 기반 필드 암호화/복호화.
 * 공식 문서 기준: https://cloud.google.com/kms/docs/encrypt-decrypt
 * (대칭키로 64KiB 이하 데이터를 직접 암호화/복호화하는 표준 패턴 — 이름/전화/생년월일처럼
 *  작은 필드에 적합하다. 봉투 암호화(DEK/KEK)를 별도로 구현하지 않는 이유: 이 규모의 필드
 *  암호화에는 KMS Encrypt/Decrypt API 직접 호출이 공식 문서가 권장하는 최소 구성이다.)
 *
 * 키는 코드에 하드코딩하지 않는다 — PII_KMS_KEY_NAME 파라미터(운영자가 배포 시 설정)로만 전달받는다.
 * 이 모듈은 클라이언트(브라우저) 코드에서 import되지 않는다 — functions/ 안에서만 사용된다.
 */

import { KeyManagementServiceClient } from '@google-cloud/kms';

let cachedClient = null;

function getClient() {
  if (!cachedClient) {
    cachedClient = new KeyManagementServiceClient();
  }
  return cachedClient;
}

// 테스트에서 실제 KMS 클라이언트를 모킹된 구현으로 교체할 수 있도록 주입 지점을 둔다.
export function __setClientForTest(mockClient) {
  cachedClient = mockClient;
}

export function resetClientForTest() {
  cachedClient = null;
}

/**
 * @param {string} plaintext
 * @param {string} keyName - projects/{p}/locations/{l}/keyRings/{r}/cryptoKeys/{k}
 * @returns {Promise<string>} base64 ciphertext
 */
export async function encryptField(plaintext, keyName) {
  if (!keyName) {
    throw new Error('PII_KMS_KEY_NAME이 설정되지 않았습니다.');
  }
  const client = getClient();
  const [result] = await client.encrypt({
    name: keyName,
    plaintext: Buffer.from(String(plaintext), 'utf8'),
  });
  if (!result?.ciphertext) {
    throw new Error('KMS encrypt 응답에 ciphertext가 없습니다.');
  }
  return Buffer.from(result.ciphertext).toString('base64');
}

/**
 * @param {string} ciphertextBase64
 * @param {string} keyName
 * @returns {Promise<string>} plaintext
 */
export async function decryptField(ciphertextBase64, keyName) {
  if (!keyName) {
    throw new Error('PII_KMS_KEY_NAME이 설정되지 않았습니다.');
  }
  const client = getClient();
  const [result] = await client.decrypt({
    name: keyName,
    ciphertext: Buffer.from(ciphertextBase64, 'base64'),
  });
  if (!result?.plaintext) {
    throw new Error('KMS decrypt 응답에 plaintext가 없습니다.');
  }
  return Buffer.from(result.plaintext).toString('utf8');
}
