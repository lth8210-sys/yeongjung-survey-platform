#!/usr/bin/env node
/**
 * 기존(레거시) responses 문서의 평문 이름/전화/생년월일을 암호화 필드로 보강한다.
 *
 * 이 스크립트는 Stage A(비파괴)만 수행한다:
 *   - respondent.applicantNameMasked / applicantPhoneMasked / applicantBirthDateMasked (마스킹 미리보기)
 *   - respondent.applicantPii (KMS 암호문)
 *   - respondent.piiProtected = true
 *   - respondentName / respondentPhone (top-level 단축 필드)를 마스킹 값으로 갱신
 * 를 "추가"할 뿐, 기존 평문 필드(respondent.applicantName 등)는 절대 지우거나 덮어쓰지 않는다.
 * 평문 필드 제거(Stage B)는 이 스크립트의 범위가 아니다 — Stage A 검증 완료 후 별도로 결정한다
 * (46번 문서 "실패 시 롤백" 요구사항: Stage A만으로는 기존 데이터 손실이 있을 수 없다).
 *
 * 사용법(운영자가 직접 실행 — 이 세션은 실행하지 않는다):
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   PII_KMS_KEY_NAME=projects/P/locations/L/keyRings/R/cryptoKeys/K \
 *     node functions/scripts/migratePiiEncryption.mjs                  # dry-run(기본값)
 *   ... node functions/scripts/migratePiiEncryption.mjs --execute      # 실제 반영
 *   ... node functions/scripts/migratePiiEncryption.mjs --execute --limit=50   # 부분 실행(점진 적용)
 *
 * 중복 실행 안전성: respondent.piiProtected === true인 문서는 건너뛴다 — 몇 번을 다시 실행해도
 * 이미 처리된 문서를 다시 암호화하지 않는다.
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { encryptField } from '../src/kms.js';
import { maskName, maskPhone, maskBirthDate } from '../src/masking.js';

const args = process.argv.slice(2);
const EXECUTE = args.includes('--execute');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const LIMIT = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const BATCH_SIZE = 200;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} 환경변수가 필요합니다.`);
  }
  return value;
}

export function needsMigration(data) {
  const respondent = data?.respondent;
  if (respondent?.piiProtected === true) return false;
  const hasLegacyPii =
    Boolean(data?.respondentName) ||
    Boolean(data?.respondentPhone) ||
    Boolean(respondent?.applicantName) ||
    Boolean(respondent?.applicantPhone) ||
    Boolean(respondent?.applicantBirthDate);
  return hasLegacyPii;
}

export async function buildProtectedFields(respondent, respondentName, respondentPhone, keyName) {
  const name = respondent?.applicantName || respondentName || '';
  const phone = respondent?.applicantPhone || respondentPhone || '';
  const birthDate = respondent?.applicantBirthDate || '';

  const nameMasked = name ? maskName(name) : '';
  const phoneMasked = phone ? maskPhone(phone) : '';
  const birthDateMasked = birthDate ? maskBirthDate(birthDate) : '';

  const [nameCt, phoneCt, birthDateCt] = await Promise.all([
    name ? encryptField(name, keyName) : null,
    phone ? encryptField(phone, keyName) : null,
    birthDate ? encryptField(birthDate, keyName) : null,
  ]);

  return {
    applicantNameMasked: nameMasked,
    applicantPhoneMasked: phoneMasked,
    applicantBirthDateMasked: birthDateMasked,
    applicantPii: {
      name: nameCt,
      phone: phoneCt,
      birthDate: birthDateCt,
      keyVersion: keyName,
      encryptedAt: new Date().toISOString(),
    },
    piiProtected: true,
    respondentNameMasked: nameMasked,
    respondentPhoneMasked: phoneMasked,
  };
}

async function main() {
  const keyName = requireEnv('PII_KMS_KEY_NAME');

  initializeApp({ credential: applicationDefault() });
  const db = getFirestore();

  console.log(`[migratePiiEncryption] mode=${EXECUTE ? 'EXECUTE' : 'DRY-RUN'} limit=${LIMIT === Infinity ? 'none' : LIMIT}`);

  const summary = {
    scanned: 0,
    alreadyProtected: 0,
    noLegacyPii: 0,
    targeted: 0,
    succeeded: 0,
    failed: 0,
    failedIds: [],
  };

  let lastDoc = null;
  let processedForLimit = 0;
  let hasMore = true;

  while (hasMore) {
    let query = db.collection('responses').orderBy('__name__').limit(BATCH_SIZE);
    if (lastDoc) query = query.startAfter(lastDoc);
    const snapshot = await query.get();
    if (snapshot.empty) break;

    let writeBatch = EXECUTE ? db.batch() : null;
    let writesInBatch = 0;

    for (const docSnap of snapshot.docs) {
      summary.scanned += 1;
      const data = docSnap.data();

      if (data?.respondent?.piiProtected === true) {
        summary.alreadyProtected += 1;
        continue;
      }
      if (!needsMigration(data)) {
        summary.noLegacyPii += 1;
        continue;
      }

      summary.targeted += 1;
      if (processedForLimit >= LIMIT) {
        continue;
      }
      processedForLimit += 1;

      if (!EXECUTE) {
        // dry-run: 대상 여부만 집계하고 KMS를 호출하지 않는다(비용·부작용 없음).
        continue;
      }

      try {
        const protectedFields = await buildProtectedFields(
          data.respondent,
          data.respondentName,
          data.respondentPhone,
          keyName,
        );

        writeBatch.update(docSnap.ref, {
          respondentName: protectedFields.respondentNameMasked || data.respondentName || '',
          respondentPhone: protectedFields.respondentPhoneMasked || data.respondentPhone || '',
          respondent: {
            ...(data.respondent ?? {}),
            applicantNameMasked: protectedFields.applicantNameMasked,
            applicantPhoneMasked: protectedFields.applicantPhoneMasked,
            applicantBirthDateMasked: protectedFields.applicantBirthDateMasked,
            applicantPii: protectedFields.applicantPii,
            piiProtected: true,
          },
        });
        writesInBatch += 1;
        summary.succeeded += 1;

        if (writesInBatch >= 400) {
          await writeBatch.commit();
          writeBatch = db.batch();
          writesInBatch = 0;
        }
      } catch (error) {
        summary.failed += 1;
        summary.failedIds.push(docSnap.id);
        // 원문은 로그에 남기지 않는다 — 문서 ID와 오류 메시지만 기록한다.
        console.error(`[migratePiiEncryption] failed responseId=${docSnap.id}: ${error.message}`);
      }
    }

    if (EXECUTE && writesInBatch > 0) {
      await writeBatch.commit();
    }

    lastDoc = snapshot.docs[snapshot.docs.length - 1];
    if (snapshot.docs.length < BATCH_SIZE) break;
    if (processedForLimit >= LIMIT) break;
  }

  console.log('[migratePiiEncryption] summary:', JSON.stringify(summary, null, 2));
  if (!EXECUTE) {
    console.log(
      `[migratePiiEncryption] DRY-RUN 완료 — 실제 반영하지 않았습니다. ` +
        `대상 ${summary.targeted}건을 확인했습니다. 실행하려면 --execute를 추가하세요.`,
    );
  }
}

// 테스트에서 import할 때는 실행되지 않고, CLI로 직접 실행할 때만 동작한다.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('[migratePiiEncryption] fatal error:', error.message);
    process.exitCode = 1;
  });
}
