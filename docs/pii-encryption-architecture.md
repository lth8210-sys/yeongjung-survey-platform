# PII 암호화 아키텍처 (2026-07)

> 이 문서는 `docs/review/06_SECURITY_RULES_REVIEW.md` §6.6이 지적한 "PII 평문 저장(High)" 위험에 대한
> 대응 구현을 설명한다. **그 리뷰 문서는 수정하지 않았다** — 감사 시점의 기록으로 그대로 남겨두고,
> 이 문서가 "그 이후 무엇을 어떻게 구현했는가"를 별도로 기록한다.
> 관련 백로그: `ecosystem-review/46_RISK_PRIORITY_BACKLOG.md` P0-1.

---

## 0. 최상위 원칙 (2026-07-14 추가)

2026-07-12 커밋(Structure A 준비 작업) 배포 이후, 클라이언트 레거시 경로(Structure B,
`submitSurveyResponseLegacyClient`)가 Cloud Functions/KMS 없이도 "암호화 성공을 전제로 한"
마스킹-only 저장을 그대로 적용해 **원본이 영구 유실되는 사고**가 실제로 발생했다(경위·판정·
복구 가능성 조사는 `docs/admin-original-pii-export-fix.md` 참고). 재발 방지를 위해 다음을
이 프로젝트의 최상위 원칙으로 명시한다 — 이후 어떤 PII 관련 변경도 이 원칙을 어길 수 없다.

1. 응답자가 입력한 원본은 항상 보존한다.
2. 웹 화면에서는 개인정보를 마스킹하여 표시할 수 있다.
3. 권한 있는 관리자와 설문 제작자는 원본을 다운로드할 수 있어야 한다.
4. 마스킹은 표시용 파생 데이터일 뿐, 원본을 대체해서는 안 된다.
5. "마스킹값만 저장하고 제출 성공"은 절대 허용하지 않는다.

**경로별 적용 방식이 다르다** — 둘 다 원칙 5를 지키지만, 방법이 다르다:

- **현재 운영(Hosting, Structure B)**: Functions/KMS를 쓰지 않는다. 원본을 그대로 저장하고
  화면·다운로드 시점에만 마스킹한다(§0.1). 암호화 시도 자체가 없으므로 "암호화 실패로 제출이
  막히는 일"이 있어서는 안 된다.
- **향후(Functions/Blaze, Structure A, §11)**: 암호화 성공 시 암호문 저장(+원본 보존 정책), 실패
  시 자동 재시도(1~2회) 후에도 실패하면 **저장 자체를 진행하지 않는다**(§0.2) — 평문 저장도,
  마스킹만 저장도 하지 않는다. 둘 다 발생하면 안 되는 것은 "제출은 성공했는데 원본이 없는 상태"다.

### 0.1 현재 운영 경로(Hosting)의 저장 직전 최종 검증

`submitSurveyResponseLegacyClient()`(`src/firebase/surveys.js`)는 Firestore 쓰기(`runTransaction`)
전에 `verifyOriginalPreservedBeforeSave()`를 호출한다. 이름/연락처/생년월일/`answers[]` PII
문항(주소 포함, `identifyAnswerPiiQuestionIds()`가 판정)에 원본이 있었는데 저장 객체에 평문도
암호문 백업도 없으면(2026-07-12 사고와 동일한 상태) 예외를 던져 **저장을 아예 진행하지 않는다**.
사용자에게는 "일시적인 오류가 발생했습니다. 입력 내용은 유지되어 있습니다. 잠시 후 다시 제출해
주세요."를 보여주고(`SurveyResponsePage.jsx`의 기존 에러 처리가 그대로 재사용됨 — 성공 시에만
입력을 초기화하므로 실패 시 입력은 화면에 자동으로 유지된다), 입력값은 클리어하지 않는다.

### 0.2 향후 Functions/Blaze 경로(Structure A)의 암호화 실패 처리

`functions/src/submitResponse.js`의 `encryptFieldWithRetry()`가 KMS 호출을 자동 재시도(최초
1회 + 재시도 최대 2회, 총 3회)한다. 모두 실패하면 트랜잭션을 시작하지 않고(§11.2의 "평문
fallback 금지" 정책 그대로 유지) 클라이언트에는 §0.1과 동일한 안내 문구를 반환한다. 추가로
`verifyPiiPreservedBeforeSave()`가 저장 직전 한 번 더 "원본이 있었다면 반드시 암호문으로
보존됐는가"를 확인한다 — 위 재시도 로직이 이미 이 상태를 막고 있지만, 향후 이 파일이
리팩토링되더라도 같은 사고가 재발하지 않도록 하는 별도 안전망이다. **이 경로는 아직 운영에
배포되지 않았다** — 코드·테스트만 갖춰 두었다(§11.8 배포 순서 참조, 이번 세션은 배포하지 않았다).

---

## 1. 이 구현이 보호하는 범위 (그리고 보호하지 않는 범위)

**보호함(Phase 1)**: 응답 제출 시 파생되는 이름/전화/생년월일 요약 필드 —
`responses/{id}.respondentName`, `.respondentPhone`, `.respondent.applicantName/Phone/BirthDate`.
이 필드들은 관리자 목록·CSV·"신청자 요약"에서 가장 널리 쓰이는 대표값이다.

**보호함(Phase 2, 2026-07 추가)**: 설문 문항 자체가 "이름"/"연락처"/"생년월일"/"이메일"/"주소" 등
**자유서술형**으로 묻는 경우, 그 답변도 이제 저장 시점에 마스킹 미리보기로 대체되고 원문은 Cloud KMS
암호문(`respondent.answersPii`)으로만 보관된다. 대상 판정은 `identifyAnswerPiiQuestionIds()`
(`src/firebase/surveys.js`)가 한다 — `detectPrivacyQuestions()`보다 **의도적으로 좁다**:
`SHORT_TEXT`/`LONG_TEXT`/`EMAIL`/`PHONE`/`DATE` 타입만 대상이며, `SINGLE_CHOICE`/`MULTIPLE_CHOICE`/
`DROPDOWN` 같은 **선택형 문항은 제목에 PII 키워드가 있어도 대상에서 제외**한다. 이는 사용자 확인을
거친 결정이다 — "연령대"/"거주 지역" 같은 선택형 인구통계 문항은 `surveyAnalytics.js`/
`statisticsExcel.js`가 `answers[]`를 원문 그대로 읽어 분포 통계를 계산하므로, 저장 시점에 마스킹하면
통계가 조용히 깨진다. 신원 식별 위험이 실질적으로 큰 자유서술형만 좁혀서 그 회귀를 피했다.

**여전히 보호하지 않음(잔여 위험 — §9 참조)**:
- 선택형 인구통계 문항(연령대/거주 지역 등)은 제목에 PII 키워드가 있어도 원문 그대로 저장된다(위
  트레이드오프에 따른 의도적 제외).
- 자유서술 문항 중 `PRIVACY_PII_KEYWORDS` 목록에 없는 문구로 이름/전화 등을 묻는 경우(예: "성명"이
  아니라 "작성자"로만 물으면) 탐지되지 않는다 — 키워드 기반 탐지의 한계.
- CSV 대량 다운로드는 개별 "실명 보기"를 하지 않은 보호된 응답에 대해 자동으로 원문을 복원하지
  않는다(§6, §9 참조 — 의도된 축소이지 회귀는 아니다).

---

## 2. 저장 구조

`responses/{id}` 문서(변경분만 표시):

```
respondentName        : string   // masked preview("홍*동") — 더 이상 평문 아님(신규 응답)
respondentPhone        : string   // masked preview("010-****-5678")
respondent: {
  applicantNameMasked      : string        // 마스킹 미리보기
  applicantPhoneMasked      : string
  applicantBirthDateMasked  : string        // "1990-**-**"
  applicantPii: {
    name       : string | null   // Cloud KMS 암호문(base64)
    phone      : string | null
    birthDate  : string | null
    keyVersion : string          // KMS 키 리소스 이름
    encryptedAt: string          // ISO timestamp
  } | null
  piiProtected : boolean          // true = 이 스키마 적용된 신규 응답
  // Phase 2(2026-07): answers[] 내 자유서술형 PII 문항 암호문. 대상 문항이 없거나 전부 빈 값이면 null.
  answersPii: {
    values      : Record<questionId, string>  // Cloud KMS 암호문(base64), questionId별
    keyVersion  : string
    encryptedAt : string
    schemaVersion: number         // 1
  } | null
  applicantKey / applicantKeyLabel : string  // 기존과 동일(중복신청 판정용 해시, 변경 없음)
}
```

`answers[]` 배열 자체도 변경된다: `identifyAnswerPiiQuestionIds()`가 고른 문항의 답변은
`{ questionId, answer: "홍*동" /* 마스킹 미리보기 */, piiProtected: true /* 암호문 존재 시에만 */ }`
형태로 저장되고, 그 외 문항(선택형 인구통계 포함)은 기존과 동일하게 원문이 저장된다.

레거시(마이그레이션 전) 문서는 `respondent.piiProtected`가 없거나 `false`이며, 기존처럼
`respondent.applicantName` 등에 평문이 남아 있다 — 이 문서 전체의 "레거시 vs 신규" 분기는
`respondent.piiProtected` 하나로 판정한다. `answersPii`가 없는 문서는 `answers[]`에 자유서술형
PII 답변이 원문 그대로 남아 있다(Phase 2 적용 이전 응답 또는 대상 문항이 없던 응답).

---

## 3. 암호화·복호화 경계

```
[클라이언트]                              [Cloud Functions]              [Firestore]
설문 제출 화면
  │ 이름/전화/생년월일 입력
  ▼
protectRespondentPii()  ──(마스킹은 로컬)
  │                      ──(암호문만 네트워크 호출)──▶ encryptRespondentPii
  │                                                     │ KMS Encrypt API
  │                      ◀────────── 암호문 ───────────┘
  ▼
submitSurveyResponse()  ── 기존 트랜잭션(변경 없음) ──────────────────▶ responses/{id}
                                                                       (마스킹+암호문만 저장)

[관리자 화면]
"실명 보기" 클릭
  │ responseId만 전송 ──▶ revealResponsePii
  │                        │ 1) 호출자 role 서버 재검증(Firestore users/{uid})
  │                        │ 2) responses/{id} 소유권 검증
  │                        │ 3) KMS Decrypt API
  │                        │ 4) audit_logs에 'pii_reveal' 1건 기록(원문 미포함)
  │ ◀── 원문(name/phone/birthDate) ──┘
  ▼
화면에 임시 표시(브라우저 state에만, 새로고침하면 사라짐 — 저장하지 않음)
```

**클라이언트는 암호화 키를 어떤 형태로도 보유하지 않는다.** `functions/src/kms.js`만 `@google-cloud/kms`를
import하며, 이 파일은 `functions/`(서버) 안에서만 존재한다. 브라우저 번들에 이 코드가 포함될 수 없다
(별도 Node 패키지, 별도 `package.json`, Vite 빌드 대상 밖).

---

## 4. 키 관리

- **키 종류**: Cloud KMS 대칭키(1개), 이름은 `PII_KMS_KEY_NAME` 파라미터(Firebase Functions 2세대
  `defineString`)로 주입 — 코드에 하드코딩하지 않는다.
- **암호화 방식**: KMS Encrypt/Decrypt API를 필드값에 직접 호출(공식 문서가 64KiB 이하 데이터에
  권장하는 최소 구성 — https://cloud.google.com/kms/docs/encrypt-decrypt). 봉투 암호화(DEK/KEK)를
  별도로 구현하지 않았다 — 이름/전화/생년월일처럼 작은 필드에는 과설계다.
- **IAM**: Cloud Functions의 실행 서비스 계정에만 해당 키의 `roles/cloudkms.cryptoKeyEncrypterDecrypter`를
  부여해야 한다(운영자가 배포 시 직접 설정 — §8).
- **키 교체(rotation)**: 이번 구현 범위 밖. `applicantPii.keyVersion`에 암호화 시점의 키 리소스
  이름을 저장해두므로, 향후 키를 교체하더라도 "이 레코드가 어떤 키로 암호화됐는지" 추적할 수 있는
  최소한의 준비만 해두었다.

---

## 5. 역할별 열람 범위

| 역할 | 목록(기본) | CSV(마스킹 모드) | 실명 보기(단건) | CSV(원문 모드) |
|---|---|---|---|---|
| viewer | 마스킹 | 마스킹 | 불가 | 마스킹(다운로드 권한 자체 없음, 기존과 동일) |
| creator(자신의 설문 아님) | 마스킹 | 마스킹 | 불가 | 마스킹(`canDownloadResponses` 기존 로직 그대로) |
| creator(자신의 설문) | 마스킹 | 마스킹 | **가능** | 마스킹(§7 참조 — 미구현) |
| admin / super_admin | 마스킹 | 마스킹 | **가능** | 마스킹(§7 참조 — 미구현) |

권한 판정은 `functions/src/roles.js`의 `canRevealResponsePii()`가 서버에서 다시 계산한다 — 클라이언트가
보낸 role을 신뢰하지 않는다. 이 로직은 `firestore.rules`의 `canReadManagedResponse()`와 동일한 규칙
(super_admin/admin 전체, creator는 자신이 소유한 설문 응답만)을 따르도록 의도적으로 맞췄다 —
"실명 보기"가 "이 응답을 읽을 수 있는 사람"보다 넓거나 좁아지지 않게 하기 위함이다.

---

## 6. CSV 다운로드 정책

- **목록 화면은 항상 마스킹**이다(역할 무관) — 이번 구현으로 바뀌지 않았다.
- CSV의 "마스킹 모드"(`shouldMaskDownload === true`)는 종전과 동일하게 동작한다.
- CSV의 "원문 모드"(`shouldMaskDownload === false`, 즉 admin/super_admin/설문 소유 creator)는
  **이번 구현에서 동작이 바뀐다**: 레거시 응답은 종전처럼 원문이 그대로 내려가지만, 신규(보호된)
  응답은 개별적으로 "실명 보기"를 실행하지 않은 이상 **마스킹 값이 대신 내려간다**. 이는 평문이 더
  많이 노출되는 방향이 아니라 더 적게 노출되는 방향의 변경이므로 보안 회귀가 아니다 — 다만 이전에
  가능했던 "한 번에 전체 원문 CSV"가 신규 응답에는 더 이상 자동으로 되지 않는다는 **기능 축소**다.
  대량 원문 CSV가 필요하면 §9의 후속 과제(일괄 reveal)가 완료될 때까지는 응답을 개별적으로
  "실명 보기"한 뒤 다운로드해야 한다.

---

## 7. 마이그레이션 절차

스크립트: `functions/scripts/migratePiiEncryption.mjs` (Stage A만, 비파괴).

```bash
cd functions
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
PII_KMS_KEY_NAME=projects/P/locations/L/keyRings/R/cryptoKeys/K \
  node scripts/migratePiiEncryption.mjs                 # 1) dry-run(기본값, 안전) — 대상 건수만 집계
  node scripts/migratePiiEncryption.mjs --execute --limit=50   # 2) 소규모 시범 실행 권장
  node scripts/migratePiiEncryption.mjs --execute        # 3) 전체 실행
```

- **Stage A(이 스크립트)**: 레거시 평문 필드는 그대로 둔 채, 마스킹 미리보기 + KMS 암호문 필드만
  "추가"한다. 기존 평문 필드(`respondent.applicantName` 등)는 건드리지 않는다 — 실패해도 잃을
  데이터가 없다.
- **Stage B(이번 구현 범위 밖)**: Stage A 검증이 끝난 뒤, 레거시 평문 필드를 실제로 지우는 별도
  작업. 이 스크립트는 Stage B를 수행하지 않는다 — 별도 검토·승인이 필요하다.
- **중복 실행 안전성**: `respondent.piiProtected === true`인 문서는 건너뛴다.
- **이번 세션에서 실행한 것**: 없음. 코드 작성과 단위 테스트(모킹된 KMS/Firestore)까지만 진행했다.
  실제 운영 Firestore에는 이 세션에서 실행 권한(GCP 자격증명)이 없었고, 있었더라도 사용자 승인 없이
  실행하지 않는다는 원칙에 따라 실행하지 않았다.

---

## 8. 운영자가 직접 해야 하는 설정 (이 세션이 하지 않은 것)

1. **Cloud KMS 키링·키 생성**: `gcloud kms keyrings create survey-pii --location=asia-northeast3` 및
   `gcloud kms keys create respondent-pii --keyring=survey-pii --location=asia-northeast3 --purpose=encryption`.
   (이 세션 환경에는 `gcloud` CLI가 설치되어 있지 않아 직접 실행할 수 없었다 — 직접 확인함.)
2. **IAM 권한 부여**: Cloud Functions 서비스 계정에 `roles/cloudkms.cryptoKeyEncrypterDecrypter`를
   위 키에 대해 부여.
3. **`PII_KMS_KEY_NAME` 파라미터 설정**: 배포 시 `functions/.env.<project-id>` 또는 배포 파라미터로
   위 키의 전체 리소스 이름 지정(`functions/.env.example` 참조).
4. **Cloud Functions 배포**: `firebase deploy --only functions`. (이 세션은 `firebase` CLI가
   설치되어 있으나 로그인 자격 증명이 만료된 상태였다 — `firebase projects:list` 실행 결과로 직접
   확인함. 배포는 실행하지 않았다.)
5. **App Check(권장, 필수 아님)**: `encryptRespondentPii`는 비로그인 방문자도 호출 가능해야 하므로
   role 기반 인증 대신 App Check로 "정상적인 우리 웹앱에서 온 요청"만 허용하는 것을 권장한다.
   이번 구현은 App Check 강제(enforce)를 코드에 넣지 않았다 — Firebase 콘솔에서 reCAPTCHA/앱 무결성
   공급자를 설정하는 것 자체가 운영자의 콘솔 작업이기 때문이다.
6. **Stage A 마이그레이션 실행**: §7의 dry-run 결과를 검토한 뒤, 운영자가 명시적으로 `--execute`를
   실행한다.
7. **(§7 Stage B 검토 시점에) 레거시 평문 필드 제거 여부 결정**: 별도 세션에서 다룬다.

---

## 9. 남은 위험 (Phase 2 후보, 이번에 해결하지 않음)

| 위험 | 현재 상태 |
|---|---|
| 선택형 인구통계 문항(연령대·거주 지역 등)은 제목에 PII 키워드가 있어도 여전히 평문 저장 | 통계 집계 회귀를 피하기 위한 의도적 제외(§1) — 사용자 확인 완료 |
| 자유서술 PII 문항이라도 `PRIVACY_PII_KEYWORDS`에 없는 표현이면 탐지되지 않음 | 키워드 기반 탐지의 근본 한계 — 완전한 해결은 문항 작성 시 명시적 "PII 여부" 플래그 추가(향후 과제) |
| CSV "원문 모드" 대량 다운로드가 신규 응답에는 자동으로 되지 않음(식별 요약 + 문항 답변 모두 해당) | 개별 "실명 보기" 반복 필요 — 일괄 reveal 기능 미구현 |
| `firestore.rules`의 `responses` `create` 규칙이 여전히 `respondent`/`answers`의 하위 필드 형태를 강제하지 않음 | §4(익명 응답 제출 서버 경계) 검증 결과 참조 — 클라이언트가 KMS 암호화를 우회하고 직접 평문을 쓸 수 있는지는 별도 절에서 확인 중 |
| Cloud KMS 키가 아직 실제로 생성되지 않음 | §8 운영자 작업, 이 세션에서 착수 불가(gcloud 미설치) |
| Cloud Functions가 아직 배포되지 않음 | §8 운영자 작업, 이 세션에서 착수 불가(firebase 인증 만료) |
| App Check 미설정 시 `encryptRespondentPii`가 남용(스팸 호출)될 가능성 | 비로그인 호출 허용이 불가피한 설계라 App Check가 유일한 방어선 — 콘솔 설정 필요 |
| `firestore.rules`의 `test:rules`(에뮬레이터) 스위트를 이 세션에서 실행하지 못함 | 이 샌드박스에 Java가 없음(`java -version` 실패로 직접 확인) — firestore.rules 자체는 변경하지 않았으므로 회귀 위험은 낮다고 판단하나, 운영자가 로컬에서 재확인 권장 |
| 키 교체(rotation) 절차 미구현 | `keyVersion` 필드만 기록, 실제 재암호화 파이프라인 없음 |

---

## 10. 변경 파일 목록

**신규(Phase 1)**
- `functions/package.json`, `functions/index.js`, `functions/vitest.config.js`, `functions/eslint.config.js`, `functions/.env.example`
- `functions/src/{kms,masking,roles,handlers}.js`
- `functions/test/{kms,roles,masking,handlers,migratePiiEncryption}.test.js`
- `functions/scripts/migratePiiEncryption.mjs`
- `src/firebase/piiProtection.js`, `src/firebase/piiReveal.js`
- `test/piiProtection.test.js`, `test/piiSummary.test.js`
- `docs/pii-encryption-architecture.md`(이 문서)

**수정(Phase 1)**
- `src/firebase/surveys.js` — `submitSurveyResponse()`(respondent 필드만 교체), `extractApplicationResponseSummary()`(revealedPii/masked-preview 우선순위 추가), `anonymizeResponsePii()`(신규 필드도 함께 익명화)
- `src/firebase/config.js` — `functionsClient` export 추가
- `src/utils/privacy.js` — `maskBirthDate()` 추가
- `src/pages/SurveyResponsesAdminPage.jsx` — "실명 보기" 버튼, revealedPii state, CSV 이중마스킹 방지
- `firebase.json` — `functions` 섹션 추가
- `eslint.config.js` — `functions/**` 제외(별도 Node 패키지)

**신규(Phase 2, 2026-07 answers[] 보호)**
- `test/answerPii.test.js` — `identifyAnswerPiiQuestionIds()` 회귀 테스트

**수정(Phase 2)**
- `src/firebase/surveys.js` — `identifyAnswerPiiQuestionIds()`, `buildAnswerPiiTargets()`(신규 함수) 추가; `submitSurveyResponse()`가 answers[]도 마스킹+암호화; `anonymizeResponsePii()`가 `respondent.answersPii`도 함께 지움
- `functions/src/handlers.js` — `handleEncryptAnswerFields()`(신규); `handleRevealResponsePii()`가 `respondent.answersPii`도 복호화해 `answers` 필드로 반환
- `functions/index.js` — `encryptAnswerFields` callable 추가
- `functions/test/handlers.test.js` — 위 변경에 대한 테스트 추가/갱신
- `src/firebase/piiProtection.js` — `protectAnswerFields()`(신규 함수)
- `test/piiProtection.test.js` — `protectAnswerFields()` 테스트 추가
- `src/pages/SurveyResponsesAdminPage.jsx` — "실명 보기" 결과에 answers[] 개별 항목 복호화 반영(재마스킹 방지)

**Phase 2 시점에는 변경하지 않았음(Phase 3/Structure A에서 변경됨 — §11 참조)**
- `firestore.rules` — 당시엔 `respondent` 필드가 `is map`으로만 검증되고 하위 키를 제한하지 않아
  신규 필드 추가 자체에는 규칙 변경이 필요 없었다. 다만 "클라이언트가 KMS 콜러블을 우회해 직접
  평문을 쓸 수 있는가"라는 별도 질문에는 그 답이 "가능하다"였다 — §11이 그 문제를 다룬다.
- `firestore.indexes.json` — 계속 변경 없음.

---

## 11. Structure A — 응답 생성 전체를 서버 콜러블로 이전 (2026-07, 최신)

### 11.1 Structure B의 근본 한계

Phase 1/2(§1~§10)는 "PII를 어떻게 암호화·마스킹할까"만 다뤘다. 그런데 그 구조(Structure B) 자체가
구조적 결함이었다:

```
클라이언트 → encryptRespondentPii/encryptAnswerFields(암호화만) → 클라이언트가 직접 Firestore에 write
```

`firestore.rules`의 `responses` `create` 규칙은 `respondent`/`answers`의 하위 필드 **형태**만 검증할
뿐 **내용**(문자열이 실제로 마스킹/암호화됐는지)은 검증할 수 없다. 즉 공격자는 두 콜러블을 아예
호출하지 않고 Firestore Web SDK로 `responses` 문서를 직접 만들어 다음을 할 수 있었다:

- `applicantNameMasked` 같은 "마스킹값" 필드에 평문을 그대로 채워 넣기
- `applicantPii`/`answersPii`에 아무 문자열이나 채워 "암호화된 것처럼" 위장하기
- `piiProtected: true`를 자칭해 관리자 화면의 신뢰 표시를 속이기
- `respondent`/`answers` 구조 자체를 임의로 조작하기

Phase 2 종료 시점에 `firestore.rules`에 추가했던 "레거시 평문 필드명(`applicantName` 등) 차단"은
이 중 가장 naive한 우회(레거시 스키마 재활용)만 막았을 뿐, 위 나머지는 전혀 막지 못했다.

### 11.2 Structure A 설계

```
익명 클라이언트 → submitProtectedSurveyResponse(콜러블) → 서버가 입력 검증·PII 식별·KMS 암호화·
  마스킹·Firestore Transaction(quota/중복신청 락/슬롯 락/idempotency)까지 전부 수행 → responseId만 반환
```

서버는 클라이언트가 보낸 어떤 값도 보안 판단에 쓰지 않는다:

- **역할(role)**: 입력 스키마에 아예 없다. `auth`가 있으면 `resolveCallerRole(db, auth)`로 서버가
  `users/{uid}`를 직접 조회해 재계산한다(`functions/src/roles.js`, 기존 `revealResponsePii`와 동일
  패턴). 익명 제출은 관리자 정원 초과 허용 권한이 항상 없다.
- **마스킹값·암호문**: 입력 스키마에 아예 없다. 서버가 `answers[]` 원본 답변으로 직접
  `identifyAnswerPiiQuestionIds()`(자유서술형만, Phase 2와 동일 판정) → KMS 암호화 → 마스킹까지
  전부 수행한다.
- **surveyTitle 등 설문 메타데이터**: 서버가 방금 읽은 `surveys/{surveyId}` 문서 값을 쓴다.

암호화 실패 시 정책이 Structure B와 다르다(의도적 차이): Structure B는 KMS 실패 시에도 마스킹만
하고 제출을 계속 진행했다(`piiProtected:false`로 표시). Structure A는 **암호화 실패 시 트랜잭션을
아예 시작하지 않는다** — 응답 자체가 저장되지 않는다("평문 fallback 금지"를 문자 그대로 지키기
위한 더 엄격한 정책).

### 11.3 트랜잭션 불변조건 (기존과 100% 동일하게 유지)

1. 응답 1건 생성 시 `surveys.responseCount` 정확히 +1
2. 동일 `clientSubmitId` 재호출은 새 문서를 만들지 않고 기존 `responseId`를 반환(idempotency)
3. 중복신청 락(`applicationApplicantLocks`)과 응답 생성이 같은 트랜잭션에서 함께 성공/실패
4. 슬롯 락(`applicationSlotLocks`)과 응답 생성이 같은 트랜잭션에서 함께 성공/실패
5. 연령 quota 카운트 증가와 응답 생성이 같은 트랜잭션에서 함께 성공/실패
6. 선택형 문항 정원(`optionQuotaCounts`) 증가와 응답 생성이 같은 트랜잭션에서 함께 성공/실패
7. `published` 상태가 아니거나 마감된 설문은 거부
8. PII 암호화 실패 시 트랜잭션을 아예 시작하지 않음(§11.2)

### 11.4 서버 로직 포팅 방식 — 왜 새 파일을 또 만들었나

`functions/`는 별도 Node 패키지라 `src/`를 import할 수 없다(`functions/src/masking.js`·`roles.js`가
이미 같은 이유로 클라이언트 로직을 복제해온 기존 관례 — SUPER_ADMIN_EMAILS를 firestore.rules·
src/firebase/users.js 두 곳에서 중복 관리해온 것과 동일). `submitSurveyResponse()`가 의존하는
quota·중복신청·슬롯·PII식별 로직 전체를 그대로 복제하면 순수 로직만 400~600줄 규모라, 대신
"제출 트랜잭션이 실제로 읽는 필드만" 의도적으로 좁힌 사본을 만들었다:

- `functions/src/survey/constants.js` — `src/firebase/surveyConstants.js`의 1:1 복사본(전체 상수,
  값 변경 없음 — 부분 발췌보다 통째 복사가 오타·누락 위험이 낮다고 판단).
- `functions/src/survey/normalize.js` — `src/firebase/surveyNormalize.js`의 **좁힌** 사본.
  `normalizeQuestion()`의 branching/visibilityConditions/scale settings 정규화는 옮기지 않았다 —
  제출 트랜잭션 어디에서도 그 필드들을 읽지 않기 때문이다(분기 평가는 클라이언트가 이미 계산해
  보낸 `visibleQuestionIds` 등을 그대로 신뢰하는 정보성 필드일 뿐, 서버 재계산 대상이 아니다).
- `functions/src/survey/submission.js` — `src/firebase/surveys.js`에서 제출에 필요한 부분만
  뽑은 사본: quota(연령대·선택형 정원) 판정, `extractApplicantIdentity`/`extractSlotSelections`/
  `identifyAnswerPiiQuestionIds`/`buildAnswerPiiTargets`, lock 문서 ID 생성(`hashString` 포함 —
  **알고리즘이 클라이언트와 정확히 같아야 한다**, 다르면 같은 신청자의 lock 문서 ID가 갈라져
  중복신청 방지가 무력화된다), `mapSurveyDoc`/`getPublicSurveyState`의 좁힌 버전(sections 정렬
  등 표시 전용 로직은 제외).
- `functions/src/masking.js`에 `maskAddress`/`maskAnswerByQuestion`을 추가(Phase 1엔 없었다 —
  Structure A가 서버에서 직접 answers[] 마스킹을 계산해야 하므로 필요해졌다).

**모든 파일 상단에 SYNC REQUIRED 주석이 있다.** `src/firebase/surveys.js`/`surveyNormalize.js`의
quota·중복신청·PII식별 로직을 바꾸면 이 사본들도 반드시 함께 바꿔야 한다 — 다르면 클라이언트와
서버의 정원 판정이 갈라지는 조용한 회귀가 생긴다. 이 동기화 부담은 실제 운영 리스크이며, Phase 2
이하 규모(수십 줄)의 기존 SYNC REQUIRED 사례보다 훨씬 크다(수백 줄) — 향후 `functions/`가
`src/`의 순수 로직을 빌드 타임에 공유할 수 있는 별도 패키지 구조로 리팩토링하는 것을 권장하지만,
이번 세션 범위(응답 생성 서버 이전) 밖이라 착수하지 않았다.

### 11.5 App Check / 남용 방지 정책

`submitProtectedSurveyResponse`는 익명 호출을 허용해야 하므로 Firebase Auth만으로는 보호할 수
없다. `APP_CHECK_MODE` 파라미터(`functions/index.js`)로 3단계를 둔다 — `onCall`의
`enforceAppCheck` 옵션은 배포 시 고정되므로, 재배포 없이 콘솔에서 파라미터만 바꿔 모드를
전환할 수 있게 직접 구현했다:

| 모드 | 동작 | 언제 |
|---|---|---|
| `off`(기본값) | App Check 토큰 유무와 무관하게 항상 통과 | App Check가 콘솔에서 아직 설정되지 않은 지금 |
| `log` | 토큰이 없어도 통과시키되 서버 로그에 경고 기록 | App Check를 콘솔에 설정한 직후, 정상 트래픽이 토큰을 잘 보내는지 모니터링할 때 |
| `enforce` | 토큰이 없으면 `failed-precondition`으로 거부 | 위 모니터링에서 누락이 없음을 확인한 뒤 |

**레이트리밋은 이번 세션에서 구현하지 않았다** — 실제 남용 방지 효과가 있는 분산 레이트리밋(예:
Firestore 카운터 기반 또는 API Gateway/Cloud Armor)은 그 자체로 별도 설계·테스트가 필요한 기능이라
"관련 없는 기능 추가"에 해당한다고 판단했다. App Check가 이 익명 쓰기 표면의 1차 방어선이다.

### 11.6 클라이언트 전환 (feature flag)

`VITE_USE_SERVER_RESPONSE_SUBMISSION` (기본값 `false`/미설정 = 레거시 유지). `src/firebase/surveys.js`의
`submitSurveyResponse()`는 이제 얇은 dispatcher다:

```
true  → submitSurveyResponseViaServer()(src/firebase/submitResponseServer.js) → submitProtectedSurveyResponse 콜러블
false → submitSurveyResponseLegacyClient()(기존 runTransaction 코드, 이름만 바뀌고 내용은 그대로)
```

두 경로 모두 `responseId` 문자열을 반환해 호출부(`SurveyResponsePage.jsx`)는 분기를 알 필요가 없다.
콜러블 에러의 `error.code`는 Firebase JS SDK가 `functions/` 접두사를 붙이므로,
`submitResponseServer.js`가 접두사를 벗겨 기존 `getSubmitErrorMessage()`(코드 문자열을 그대로
매칭)와 호환되게 정규화한다.

### 11.7 Firestore Rules 변경 — 클라이언트 직접 create 차단

`firestore.rules`에서 다음을 전부 `allow create: if false`(또는 `update`도 함께)로 바꿨다:

- `/responses/{responseId}` — `create`
- `/surveys/{surveyId}` — `update` 중 `validPublicSurveyCounterUpdate()` 분기 제거(응답 문서 없이
  `responseCount`/`optionQuotaCounts`만 직접 조작하는 별도 우회 경로였다)
- `/surveys/{surveyId}/quotaCounts/{countsId}` — `create, update` 중 `validPublicQuotaCountsWrite()` 분기 제거
- `/surveys/{surveyId}/applicationApplicantLocks/{lockId}` — `create`, `update`
- `/surveys/{surveyId}/applicationSlotLocks/{lockId}` — `create`, `update`
- `/surveys/{surveyId}/clientSubmitLocks/{lockId}` — `create`, `update`, `delete`

**`read`/관리자 `update`·`delete` 권한은 손대지 않았다** — `canReadManagedResponse`/
`canEditManagedResponse`/`canEditManagedSurvey`/`canEditSurveySubdoc` 등 기존 관리자 권한 판정
함수는 전부 그대로다. 응답 삭제(`deleteSurveyResponse`) 시 quota 롤백·락 해제는 관리자 권한
경로(`canEditManagedSurvey`/`canEditSurveySubdoc`)를 쓰므로 이번 변경의 영향을 받지 않는다.

**롤백을 위해 `validPublicResponseCreate()`/`validPublicSurveyCounterUpdate()`/
`validPublicQuotaCountsWrite()` 함수 자체는 삭제하지 않았다** — `allow create: if false`를
이 함수들을 쓰는 원래 조건으로 되돌리면 즉시 Structure B로 복귀한다.

**Admin SDK(Cloud Functions)는 이 규칙들의 영향을 받지 않는다** — Security Rules는 클라이언트
SDK 요청에만 적용되므로, `submitProtectedSurveyResponse`의 Firestore 쓰기는 이 규칙과 무관하게
계속 동작한다.

### 11.8 배포 순서 (반드시 이 순서를 지킬 것 — 순서를 바꾸면 서비스 중단)

```
1. Cloud KMS 키 생성 + IAM 권한 부여 + PII_KMS_KEY_NAME 설정 (§8)
2. functions 배포: firebase deploy --only functions
   (encryptRespondentPii/encryptAnswerFields/revealResponsePii/submitProtectedSurveyResponse 전부 포함)
3. submitProtectedSurveyResponse 콜러블 smoke test
   (테스트 설문으로 익명 제출 1건 실제 실행 — 응답 생성 + quota/락 문서 확인)
4. 클라이언트 배포: VITE_USE_SERVER_RESPONSE_SUBMISSION=true
5. 정상 제출 확인 (실제 신청형 설문 1건 이상, quota/중복신청 시나리오 포함)
6. 이 시점에만 firestore.rules 배포: firebase deploy --only firestore:rules
   (여기서 클라이언트 직접 create가 비로소 막힌다 — 4/5번을 건너뛰고 6번을 먼저 하면
    아직 서버 경로로 전환되지 않은 트래픽의 응답 제출이 전부 막힌다)
7. 우회 차단 테스트: npm run test:rules (레거시 스키마·정상 스키마 모두 클라이언트 직접
   create가 실패하는지 확인)
8. 안정화 기간(권장 최소 1~2주) 후 레거시 코드 제거 여부 별도 세션에서 결정
   (submitSurveyResponseLegacyClient, encryptRespondentPii/encryptAnswerFields의 "클라이언트가
    직접 쓰기" 전제 자체는 유지 — 신원 요약/answers PII 암호화 로직 자체는 계속 필요하다)
```

> 이 문서 초안(§1~§10) 작성 지시에는 "Rules부터 먼저 배포해 운영 설문 제출이 중단되는 일이 없게
> 합니다"라는 문구가 있었으나, 위 순서와 정반대다(Rules를 먼저 배포하면 오히려 중단된다). 이
> 문서는 8단계의 상세 순서를 따랐고, 그 모순을 최종 보고에 그대로 밝혔다 — 실제 배포 담당자는
> 반드시 위 8단계 순서를 따를 것.

### 11.9 롤백 순서

```
1. firestore.rules를 이전 커밋으로 되돌려 재배포(클라이언트 직접 create 재허용, Structure B 복귀)
   — 가장 빠른 긴급 롤백. validPublicResponseCreate() 등이 삭제되지 않았으므로 git revert 1건으로 충분.
2. 클라이언트 VITE_USE_SERVER_RESPONSE_SUBMISSION=false로 재배포(레거시 경로로 복귀)
3. 필요시 submitProtectedSurveyResponse 콜러블만 비활성화(다른 콜러블은 유지)
4. 근본 원인 파악 후 재시도
```

1번만으로도 서비스는 즉시 복구된다(레거시 클라이언트 코드가 삭제되지 않았으므로) — 2번은
"신규 콜러블에 버그가 있다"는 확신이 있을 때만, 굳이 급하지 않다면 생략 가능.

### 11.10 이번 세션에서 검증한 것 / 못한 것

**검증함(코드 리뷰 + 유닛 테스트)**:
- `functions/test/submitResponse.test.js` — 인메모리 페이크 Firestore로 트랜잭션 로직 자체를
  검증(quota 마감 차단, 중복신청 차단, 슬롯 정원 차단, idempotency 재호출, PII 마스킹+암호화,
  KMS 실패 시 응답 미저장, 클라이언트 role 주장 무시). **주의**: 이 페이크는 실제 Firestore
  트랜잭션의 동시성/재시도/낙관적 잠금 충돌을 재현하지 않는다 — 로직의 "무엇을 쓰는가"만
  검증하고 "동시 요청 두 개가 경합할 때 실제로 원자적인가"는 검증하지 못한다.
- `test/submitResponseDispatch.test.js` — feature flag 분기(서버/레거시 경로 선택)만 검증.
- `test/rules/firestoreRules.test.js` — 클라이언트 직접 create가 형태와 무관하게 전부 차단됨을
  검증하는 테스트를 새로 작성했다.

**검증 못함(Java 부재로 이 세션에서 test:rules 실행 불가, §9 표 참조)**:
- 위 Rules 테스트가 실제 Firestore Rules 엔진에서 통과하는지
- Functions 에뮬레이터를 통한 실제 콜러블 통합 테스트(요청 8-C에서 언급된 통합 테스트)
- 실제 동시 요청 환경에서 quota/락 트랜잭션의 원자성

**따라서 최종 판정은 여전히 PARTIAL이다** — 코드는 작성·리뷰·유닛테스트까지 완료했지만, 배포
직전 마지막 관문인 Rules 에뮬레이터 검증과 실제 Functions 통합 테스트를 이 세션이 실행하지
못했다.

### 11.11 변경 파일 목록 (Structure A)

**신규**
- `functions/src/survey/{constants,normalize,submission}.js`
- `functions/src/submitResponse.js`
- `functions/test/submitResponse.test.js`
- `src/firebase/submitResponseServer.js`
- `test/submitResponseDispatch.test.js`

**수정**
- `functions/index.js` — `submitProtectedSurveyResponse` 콜러블, `APP_CHECK_MODE` 파라미터
- `functions/src/masking.js` — `maskAddress`, `maskAnswerByQuestion` 추가
- `src/firebase/surveys.js` — `submitSurveyResponse()`가 dispatcher로 변경, 기존 구현은
  `submitSurveyResponseLegacyClient()`로 이름만 변경(내용 무변경)
- `firestore.rules` — §11.7 참조
- `test/rules/firestoreRules.test.js` — "공개 제출 성공" 테스트를 "직접 제출은 전부 차단" 테스트로 전면 교체
- `.env.example` — `VITE_USE_SERVER_RESPONSE_SUBMISSION` 추가

### 11.12 암호화 실패 재시도 정책 + 저장 직전 최종 검증 (2026-07-14 추가)

2026-07-12 사고(§0, `docs/admin-original-pii-export-fix.md`) 재발 방지 작업. **코드·테스트만
변경했고 배포하지 않았다** — 이 파일은 아직 운영에 쓰이지 않는 Structure A 소속이라 지금
바꿔도 운영에 영향이 없다.

- `encryptFieldWithRetry()`(신규) — KMS 암호화가 즉시 실패해도 바로 포기하지 않고 최대
  2회 자동 재시도(총 3회 시도, 시도 간 300ms 대기)한다. 모두 실패하면 기존과 동일하게
  트랜잭션을 시작하지 않는다(§0.2, 8/9번 불변조건 유지 — 재시도 여부만 바뀌었을 뿐 "실패하면
  저장 안 함" 정책 자체는 그대로다).
- `verifyPiiPreservedBeforeSave()`(신규, export됨) — 저장 직전 "원본이 있었다면 반드시
  암호문으로 보존됐는가"를 한 번 더 확인하는 순수 함수. 위 재시도 로직이 이미 이 상태를
  막고 있어 정상 경로에서는 항상 통과하지만, 향후 리팩토링 시 안전망 역할을 한다.
- 실패 메시지를 `'PII 암호화에 실패해 응답을 저장하지 못했습니다.'`에서
  `'일시적인 오류가 발생했습니다. 입력 내용은 유지되어 있습니다. 잠시 후 다시 제출해
  주세요.'`로 변경(§0 원칙에 맞춘 사용자 안내 문구 통일).
- 클라이언트 레거시 경로(`src/firebase/surveys.js`)에도 동일한 개념의
  `verifyOriginalPreservedBeforeSave()`를 별도로 추가했다(§0.1) — 두 함수는 데이터 형태가
  달라 로직을 공유하지 않지만(레거시는 "평문 OR 암호문", Structure A는 "반드시 암호문") 검증
  대상 필드(이름/연락처/생년월일/answers[] PII 문항)는 동일하다.

**변경 파일**: `functions/src/submitResponse.js`(재시도 헬퍼 + 검증 함수 추가),
`functions/test/submitResponse.test.js`(재시도 성공/최종 실패 테스트 2건 교체·추가,
`verifyPiiPreservedBeforeSave` 테스트 3건 추가), `src/firebase/surveys.js`
(`verifyOriginalPreservedBeforeSave` 추가 + `submitSurveyResponseLegacyClient()`에 저장 직전
검증 게이트 삽입), `test/adminOriginalPiiExport.test.js`(`verifyOriginalPreservedBeforeSave`
테스트 6건 추가), 본 문서(§0, §11.12).

**테스트 결과**: 최상위 `npm test` 199/199, `functions/` `npm test` 65/65, 양쪽 `npm run lint`
0 errors(경고는 전부 이번 변경과 무관한 기존 항목), 최상위 `npm run build` 성공.

### 11.13 콘솔 CORS 오류(`encryptRespondentPii failed`) 근본 원인 규명 + 호출 자체 생략 (2026-07-14)

**증상**: 운영 환경에서 응답 제출은 정상 완료되고 Firestore에도 저장되지만, 브라우저 콘솔에
매 제출마다 `encryptRespondentPii failed / TypeError: Failed to fetch / CORS error`가 찍힌다.

**추적한 실제 호출 경로**: `SurveyResponsePage.jsx` → `submitSurveyResponse()`(dispatcher,
`VITE_USE_SERVER_RESPONSE_SUBMISSION` 미설정이라 항상 `submitSurveyResponseLegacyClient()`로
감) → `protectRespondentPii()`(`src/firebase/piiProtection.js`) → `httpsCallable(functionsClient,
'encryptRespondentPii')` → `getFunctions(firebaseApp, 'asia-northeast3')`가 계산한 URL로 fetch.

**근본 원인(추측이 아니라 실제 네트워크 응답으로 확인)**: 계산되는 콜러블 URL
(`https://asia-northeast3-yeongjung-survey-platform.cloudfunctions.net/encryptRespondentPii`)에
OPTIONS/POST를 직접 curl로 보내본 결과, 둘 다 **`Access-Control-Allow-Origin` 헤더가 전혀 없는
HTTP 404**("Page not found", Google Frontend가 반환하는 원시 404 페이지)를 반환했다. 이는
Cloud Function이 아예 배포되어 있지 않다는 뜻이다(§8, `firebase functions:list` 실행 결과도
"Failed to list functions" — Spark 플랜에서 Cloud Functions API 자체가 쓰이지 않음, 기존
세션들에서 이미 확인된 사실과 일치). 배포되지 않은 Cloud Functions URL은 CORS 헤더 없는 404를
반환하므로, 브라우저는 preflight 단계에서 이를 "CORS 정책 위반"으로 보고한다 — **코드의 CORS
설정 문제가 아니라 "함수가 존재하지 않음"이 진짜 원인**이다. region(`asia-northeast3`)은
`functions/index.js`의 `REGION` 상수와 클라이언트 `src/firebase/config.js`의
`FUNCTIONS_REGION`이 이미 일치하며, v1/v2 여부(`firebase-functions/v2/https`)·`firebase.json`
Hosting rewrite(SPA fallback만 존재, 함수 프록시 없음)·App Check(`APP_CHECK_MODE` 기본값
`off`)·Authorization 헤더 모두 이 오류와 무관함을 코드로 확인했다 — 문제는 오직 "배포 안 됨"
하나다.

**배포 상태 재확인**: 현재 Hosting에 배포된 번들(`index-UYwo46Lw.js`)이 로컬에서
`npm run build`한 산출물과 해시까지 동일함을 확인했다 — 즉 2026-07-14 앞선 세션의 원본 보존
수정(§0, §11.12)은 **이미 운영에 배포되어 있다**. 그래서 암호화가 실패해도 데이터 유실은
이미 발생하지 않는다(`protectRespondentPii`가 실패를 잡아 `piiProtected:false`로 반환하고,
`buildRespondentPiiFields`가 이 경우 원문을 그대로 저장한다 — 사용자가 보고한 "제출은 정상
완료되고 Firestore에도 저장된다"는 관찰과 정확히 일치). 문제는 데이터가 아니라 **매 제출마다
존재하지 않는 엔드포인트를 호출해 콘솔에 오해를 부르는 오류를 남기는 것** 자체였다.

**수정**: `src/firebase/piiProtection.js`에 `isPiiEncryptionEnabled()`(신규, `import.meta.env
.VITE_ENABLE_PII_ENCRYPTION === 'true'`)를 추가하고, `protectRespondentPii()`/
`protectAnswerFields()`가 이 값이 켜져 있을 때만 `httpsCallable`을 시도하도록 했다. 기본값(off)
에서는 네트워크 호출 자체를 시도하지 않고 곧바로 마스킹 전용 결과(`piiProtected:false`)를
반환한다 — §0.1/§11.12의 원본 보존 동작은 100% 그대로 유지된다(애초에 `piiProtected:false`
분기라 결과가 동일). Cloud Functions + Cloud KMS를 실제로 배포한 뒤(§11.8 순서를 따라)에만
`VITE_ENABLE_PII_ENCRYPTION=true`로 켜면 된다.

**"안전한 retry" 대신 "호출 생략"을 선택한 이유**: curl로 직접 확인한 404는 일시적 네트워크
장애가 아니라 "이 프로젝트에 이 이름의 Cloud Function이 아예 존재하지 않는다"는 구조적
사실이다. 존재하지 않는 것이 확실한 엔드포인트를 자동 재시도하면 실패만 반복되고 제출 지연과
콘솔 소음만 늘어난다 — 여기서 필요한 "안전한 구조"는 재시도가 아니라 "배포되지 않은 기능은
호출하지 않고, 배포된 뒤에만 명시적으로 켠다"는 게이트다(`submitProtectedSurveyResponse`
경로의 실제 암호화 재시도는 §11.12에서 이미 다뤘다 — 그 함수는 Structure A가 실제로 켜졌을
때만 의미가 있는 별개의 경로다).

**다른 `httpsCallable` 호출 경로 점검**: `revealResponsePii`(관리자 "실명 보기")와
`submitProtectedSurveyResponse`(Structure A 제출)도 같은 방식으로 콜러블을 호출하지만, 둘 다
현재 운영에서 **자동으로 호출되지 않는다** — `revealResponsePii`는 `summary.isPiiProtected`가
항상 `false`라 버튼 자체가 렌더링되지 않고, `submitProtectedSurveyResponse`는
`VITE_USE_SERVER_RESPONSE_SUBMISSION`이 꺼져 있어 dispatcher가 아예 타지 않는다. 따라서 이번
콘솔 오류의 원인은 `encryptRespondentPii`/`encryptAnswerFields` 두 곳뿐이었다.

**보안 영향(2026-07-14 재작성 — "영향 없음"이라는 표현을 쓰지 않는다)**: 이번 변경으로 새
취약점이 추가되지는 않았다. 그러나 **이름/전화/생년월일과 자유서술형 개인정보 문항이
Firestore에 평문으로 저장되는 기존 위험은 그대로 남아 있다** — 이 변경은 그 위험을 해결한
것이 아니라, 암호화 호출을 꺼서 실패 신호(콘솔 CORS 오류)와 불필요한 네트워크 요청을
제거했을 뿐이다. Firestore Rules(`canReadManagedResponse`, §5)는 **접근 통제 수단이며 DB
암호화를 대체하지 않는다** — super_admin/admin/설문 소유 creator로 읽기를 제한하지만, 그
경로들(관리자·설문 소유자 계정 탈취, Rules 오설정, Admin SDK/서비스 계정을 통한 우회, 백업·
로그·운영자의 직접 콘솔 접근 등)로는 평문 데이터가 그대로 노출될 수 있다. "DB에는 암호화된
상태로 저장되고 관리자 다운로드 시에만 복호화되는 구조"는 **현재 존재하지 않는다** — §11.14에
남은 작업으로 정리한다.

**운영 영향**: 제출 시 실패가 확정된 네트워크 왕복 1~2회가 사라져 제출이 약간 더 빨라지고,
콘솔의 오해를 부르는 CORS 오류가 사라진다. 저장되는 데이터·다운로드·통계는 전혀 바뀌지 않는다
(변경 전에도 이미 `piiProtected:false` 분기로 원문이 저장되고 있었다) — **즉 개인정보 저장
방식 자체는 이번 변경 전후로 동일하게 평문이다.**

**변경 파일**: `src/firebase/piiProtection.js`, `.env.example`(`VITE_ENABLE_PII_ENCRYPTION`
추가), `test/piiProtection.test.js`(플래그 on/off 양쪽 경로 테스트, 10개), 본 문서(§11.13).

**테스트 결과**: 최상위 `npm test` 202/202(199+3), `npm run lint` 0 errors, `npm run build`
성공. Hosting/Functions 배포는 하지 않았다.

**이 변경 자체의 상태 정의(2026-07-14, 후속 감사)**:
- 최종 보안 수정: 아님
- 임시 장애(콘솔 오류) 차단: 맞음
- 개인정보 DB 암호화 구현: 미완료
- 운영 위험(평문 저장) 제거: 미완료

### 11.14 남은 작업 — 서버 측 암호화 구조 재설계 (계획만, 미착수)

§11.13은 "암호화가 실패해도 제출이 막히지 않게" 했을 뿐 "암호화가 실제로 되게" 하지는
못했다. 아래는 그 후속 작업 계획이며, **이번 세션에서는 코드를 작성하지 않았다** — 사용자
승인 없이는 Blaze 전환·유료 리소스 생성·운영 Functions 배포·운영 Firestore 데이터 수정을
진행하지 않는다.

**현재 활성 수집 현황(2026-07-14, 읽기 전용 확인 — 설문 제목·문항 유형만 확인, 응답 데이터는
읽지 않음)**: 전체 설문 68건 중 `status='published'`(공개 접수 중) 5건, 그중 개인정보
자유서술형 문항이 있는 설문 3건이 **지금도 응답을 계속 받고 있다**(연락처 문항 포함 1건,
누적 응답 24건 포함). 즉 이 문서가 기술하는 평문 저장 위험은 가설이 아니라 현재 진행형이다.

**최종 목표 구조(요약, 상세 설계는 후속 세션)**:
1. 클라이언트는 Firestore에 개인정보 원문을 직접 쓰지 않는다.
2. 제출은 서버 신뢰 경계(Cloud Functions) 안에서: 인증/App Check/입력 검증 → 일반 응답과
   개인정보 필드 분리 → KMS로 개인정보 암호화 → 암호문만 별도 저장소(`responses_private`
   또는 동등한 구조)에 저장 → 일반 응답에는 마스킹값/참조 ID만 저장 → 모든 저장 성공 시에만
   제출 성공 반환, 일부 실패 시 평문을 남기지 않고 안전하게 롤백/재처리.
3. 관리자 다운로드는 서버 함수에서만 복호화하고, 복호화 값을 클라이언트나 Firestore에
   재저장하지 않으며, 다운로드 행위를 감사 로그에 남긴다.
4. 기존 평문 응답 전환은 dry-run → 암호화 성공 검증 → **검증 성공 후에만** 평문 필드 제거
   (암호문 저장 전 평문 삭제 금지), 실패 건은 원문 유지 + 재처리 목록, 재실행 멱등성 보장.

**의존 관계**: Blaze 요금제 전환 → Cloud KMS 키 생성/IAM → Functions 실제 배포·smoke test →
(§11.8 순서 엄수, 순서를 바꾸면 서비스 중단) → 기존 데이터 dry-run → 승인 후 전환. 이 중
어느 것도 이번 세션에서 실행하지 않았다.

### 11.15 firestore.rules — organization visibility가 응답 원문 열람 권한으로 오용되던 결함 수정 (2026-07-14)

§11.14에서 발견을 보고했던 항목의 후속 조치 — **암호화 재설계보다 먼저 처리한 접근권한
결함**이다. 이 절은 "①원본 유실 방지(§0.1, §11.12) ②콘솔 CORS 오류 제거(§11.13)"와
독립된 세 번째 조치이며, 셋 다 합쳐도 "개인정보 암호화 완료"를 뜻하지 않는다 —
`responses` 문서는 여전히 Firestore에 평문으로 저장된다.

**결함**: `canReadManagedResponse()`가 응답 읽기 권한 판정에 `canReadSurveyByIdWithAccess()`
(설문 **양식** 조회 함수, `isOrganizationVisibleSurvey()` 분기 포함)를 그대로 재사용하고
있었다. 그 결과 `visibility: "organization"`으로 설정된 설문은, `resolvedRole()`이
`users/{uid}` 문서가 없는 모든 `@yeongjung.or.kr` 로그인 계정에 자동 부여하는 기본
`'creator'` 역할만으로도 — 그 설문과 아무 관계가 없는 내부 직원이라도 — **응답 원문
(이름·연락처 등)을 Firestore SDK로 직접 get/list할 수 있는 상태**였다.

**실제 노출 가능 사용자 유형 (Rules 로직을 직접 추적해 판정, 추측 아님)**:

| 사용자 유형 | private 설문 응답 | organization 설문 응답(수정 전) | organization 설문 응답(수정 후) |
|---|---|---|---|
| 1) 비로그인 | 차단 | 차단 | 차단 |
| 2) 외부(비기관) 로그인 | 차단 | 차단 | 차단 |
| 3) users 문서 없는 기관 도메인 계정(기본 creator) | 차단 | **허용(결함)** | 차단 |
| 4) creator(해당 설문과 무관) | 차단 | **허용(결함)** | 차단 |
| 5) 해당 설문 소유자(creator, isSurveyOwner) | 허용 | 허용 | 허용 |
| 6) admin | 허용 | 허용 | 허용 |
| 7) super_admin | 허용 | 허용 | 허용 |

(설문 **양식** 자체의 organization 조회는 이번에 건드리지 않았다 — 3)/4)도 설문 문서는
여전히 읽을 수 있다. 응답 문서만 막았다.)

**수정(최소 범위)**: 새 함수 `canReadSurveyResponsesWithAccess()`/
`canReadSurveyResponsesById()`를 추가했다 — `canEditManagedSurveyWithAccess()`와 동일하게
`role in ['super_admin','admin']` 또는 `(role=='creator' && isSurveyOwner(data))`만 허용하고
**organization 분기를 포함하지 않는다**. `canReadManagedResponse()`가 이 새 함수를 쓰도록
한 줄만 바꿨다. `canReadSurveyByIdWithAccess()`/`canReadManagedSurveyWithAccess()`(설문 양식
조회, `survey_reports`/`quotaConfig` 등 서브도큐먼트 조회에도 쓰임)는 전혀 건드리지 않아
organization 설문 양식 공유 기능·보고서 기능은 그대로 유지된다. `canEditManagedResponse()`
(응답 상태·비고 수정, 익명화)는 애초에 organization 분기가 없었으므로 수정하지 않았다.

**변경 파일**: `firestore.rules`(함수 2개 추가, `canReadManagedResponse()` 1줄 교체),
`test/rules/firestoreRules.test.js`(신규 describe 블록, 사용자 유형 1~10 + get/list 양쪽
검증하는 10개 테스트).

**Rules 테스트 결과**: `npm run test:rules`(Firebase Firestore 에뮬레이터, Java 사용 가능
확인 후 실제 실행) — **21/21 통과**(기존 11개 + 신규 10개, 전부 실제 에뮬레이터 기준
검증, 코드 추론이 아님).

**운영 설문 영향(읽기 전용 확인, 개인정보 값 미노출)**:

| 설문 | visibility | owner/담당자 구조 | 개인정보 문항 | 수정 전 접근 가능 역할 | 수정 후 접근 가능 역할 |
|---|---|---|---|---|---|
| 2026 영중 지역주민 욕구조사 | **organization** | ownerUid/ownerEmail/createdByUid/createdByEmail 전부 설정됨 | 2개(shortText, phone) | super_admin/admin/설문 소유자 **+ 무관한 모든 내부 직원 계정** | super_admin/admin/설문 소유자만 |
| 아동 희망 프로그램 설문조사 | (미설정→private) | 전부 설정됨 | 1개(longText) | super_admin/admin/설문 소유자만(변화 없음) | super_admin/admin/설문 소유자만(변화 없음) |
| 영중종합사회복지관 이용자 고충접수 | (미설정→private) | 전부 설정됨 | 1개(shortText) | super_admin/admin/설문 소유자만(변화 없음) | super_admin/admin/설문 소유자만(변화 없음) |

실제로 영향을 받는 설문은 1건("2026 영중 지역주민 욕구조사", 연락처 문항 포함, 누적
응답 24건)뿐이다 — 나머지 2건은 애초에 `visibility`가 설정되지 않아(기본값 private)
이번 결함의 영향을 받지 않았다.

**설문 작성·응답 제출·관리자 다운로드 영향**: 없음. 응답 `create`는 이번 변경 전부터
전면 차단(Structure A, §11.7) 상태였고 이번에도 그대로다(회귀 테스트로 확인). 설문
양식 읽기·통계·보고서는 건드리지 않은 함수를 그대로 쓴다. 관리자(super_admin/admin)의
응답 조회·다운로드 경로는 `canReadManagedResponse()`의 첫 번째 분기(역할 기반, 항상
무조건 허용)로 처리되며 이번 변경으로 전혀 달라지지 않았다.

**남아 있는 평문 저장 위험**: 이번 조치는 접근 통제(누가 읽을 수 있는가) 문제만
해결했다. Firestore의 `responses` 문서 자체는 여전히 이름·전화·생년월일을 평문으로
저장한다(§11.13/§11.14) — super_admin·admin 계정 탈취, Rules의 또 다른 미발견 오설정,
Admin SDK/서비스 계정 경로, 백업·로그 접근 등에는 여전히 평문이 노출될 수 있다. 서버
측 암호화(§11.14)는 별도 단계로 남아 있다.
