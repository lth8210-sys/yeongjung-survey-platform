# 관리자 응답 다운로드 개인정보 원본 복구 결함 (2026-07-14)

## 1. 문제 발생 시점

2026-07-12 14:20 KST 커밋 `9327826` (`feat(security): prepare protected survey
response architecture`)이 배포된 직후부터. 사용자 보고 기준 "7월 11일까지는
정상, 7월 13일 응답부터 마스킹"이라는 관찰과 이 커밋 시각이 정확히 들어맞는다.

이 커밋은 익명 설문 응답을 Cloud KMS로 암호화해 관리자만 복호화("실명 보기")할
수 있게 하는 새 아키텍처(문서: `docs/pii-encryption-architecture.md`)를
준비하는 대형 작업(38개 파일, +9446줄)이었다. 서버 인프라(Cloud Functions,
Cloud KMS)와 Firestore Rules 강화까지 포함되어 있었지만, **정해진 배포
순서(`docs/pii-encryption-architecture.md` §12) 중 프론트(Hosting) 코드만
실제로 배포되고 나머지는 배포되지 않았다** — 아래 §2에서 실제 상태를 확인한다.

## 2. GitHub 저장소·계정, Firebase 계정·프로젝트 확인

작업 전 확인 결과(0단계):

- `pwd`: `/Users/itaehui/Projects/yeongjung-survey-platform` — 일치
- `git remote -v`: `github.com/lth8210-sys/yeongjung-survey-platform.git` — 일치
- `gh auth status`: `lth8210-sys` 계정으로 로그인, 활성 계정 — 일치
- `firebase login:list`: `lth8210@yeongjung.or.kr` — 일치
- `firebase projects:list` / `firebase use`: 활성 프로젝트 `yeongjung-survey-platform` — 일치
- `git status --short`: 무관 캐시 외 클린, `origin/main`과 완전 동기화(0 ahead/0 behind)

모두 일치해 작업을 진행했다.

**Cloud Functions 배포 상태**: `firebase functions:list` 실행 결과
"Failed to list functions" 오류 — Spark(무료) 플랜에서는 Functions API 자체가
쓰이지 않는 상태였다. `firebase apps:list`에도 웹 앱 1개만 등록되어 있고
Functions 관련 항목은 없다. **Cloud Functions는 실제로 배포되어 있지
않다**(사용자가 알고 있던 대로 확인됨).

**Firestore Rules 배포 상태**: `firestore.rules`(저장소 파일) 778번째 줄,
`/responses/{responseId}` 컬렉션에 `allow create: if false;`가 이미 커밋되어
있다(주석: "이 규칙을 먼저 배포하면 아직 서버 콜러블로 전환되지 않은 운영
트래픽의 응답 제출이 전부 막힌다"는 명시적 경고). **만약 이 규칙이 실제로
배포되어 있었다면 7/12 이후 모든 응답 제출 자체가 완전히 실패했어야
하는데**, 사용자 보고는 "제출은 계속 되고 있고 PII만 마스킹된다"는
것이므로, **이 Firestore Rules 변경은 커밋만 되고 실제로는 `firebase deploy
--only firestore:rules`로 배포되지 않았다**고 결론지었다(git 커밋 이력만으로는
배포 시각을 알 수 없어 직접 실행 명령으로 배포 여부를 재확인할 수는 없었지만,
"규칙이 배포됐다면 관찰된 증상 자체가 불가능하다"는 논리로 판정했다). 이
저장소의 CI(`​.github/workflows/ci.yml`)는 lint/test/build만 수행하고
자동 배포 단계가 없어 — Hosting이든 Rules든 배포는 항상 로컬에서 수동으로
`firebase deploy`를 실행해야 한다.

**결론**: 현재 운영은 클라이언트 직접 Firestore 트랜잭션 경로(Structure B,
`submitSurveyResponseLegacyClient` in `src/firebase/surveys.js`)로만
돌아간다. `.env.local`에 `VITE_USE_SERVER_RESPONSE_SUBMISSION`이 설정되어
있지 않아(미설정 시 `false`) 서버 콜러블 경로(Structure A)는 활성화되지
않았다.

## 3. 기존 개인정보 저장 구조

2026-07-12 커밋 이전(레거시):

```js
respondent: {
  applicantName: applicantIdentity.name,       // 원문
  applicantPhone: applicantIdentity.phone,     // 원문
  applicantBirthDate: applicantIdentity.birthDate, // 원문
  applicantKey, applicantKeyLabel, slotSelections,
},
respondentName: applicantIdentity.name,   // 원문
respondentPhone: applicantIdentity.phone, // 원문
answers: answers,  // PII 문항도 원문 그대로
```

화면·다운로드 시점에만 `maskName`/`maskPhone`/`maskAnswerByQuestion`으로
role 기반 마스킹을 적용했다(관리자는 원문, readonly는 마스킹) — 이것이
2026-07-11까지 정상 동작하던 방식이다.

## 4. 7월 12일 커밋이 바꾼 것과 실제로 발생한 결함

같은 커밋이 저장 시점 자체를 다음과 같이 바꿨다:

```js
const respondentPii = await protectRespondentPii(applicantIdentity); // KMS 암호화 시도
...
respondent: {
  applicantNameMasked: respondentPii.nameMasked,   // 마스킹 미리보기
  applicantPii: respondentPii.encrypted,           // KMS 암호문(성공 시)
  piiProtected: respondentPii.piiProtected,        // 암호화 성공 여부
  // applicantName/applicantPhone/applicantBirthDate 필드 자체가 사라짐
},
respondentName: respondentPii.nameMasked,   // 항상 마스킹값
respondentPhone: respondentPii.phoneMasked, // 항상 마스킹값
answers: protectedAnswers, // PII 문항 답변도 무조건 마스킹값으로 치환
```

`protectRespondentPii()`/`protectAnswerFields()`(`src/firebase/piiProtection.js`)는
`httpsCallable(functionsClient, 'encryptRespondentPii'/'encryptAnswerFields')`로
Cloud Functions를 호출한다. **Cloud Functions가 배포되어 있지 않으므로 이
호출은 항상 실패**하고, 두 함수 모두 정상적으로 `catch` 블록으로 빠져
`encrypted: null, piiProtected: false`를 반환하도록 설계되어 있다(설계
의도: "암호화 실패 시 평문 저장 금지" — `test/piiProtection.test.js`에
이 자체는 정확히 회귀 테스트로 고정되어 있었다).

**문제는 그 다음이다.** `piiProtected: false`(암호화 실패)인데도 저장
코드는 무조건 `nameMasked`/`phoneMasked`/masked-answer를 최종 저장값으로
써버렸다 — "암호화가 실패하면 평문 대신 무엇을 저장할지"에 대한 폴백이
없었다. 그 결과 2026-07-12 커밋 배포 이후 제출된 모든 응답에서:

- `respondent.applicantName`/`applicantPhone`/`applicantBirthDate` 키
  자체가 존재하지 않음
- `respondent.applicantPii`는 `null`(암호문 없음)
- `respondentName`/`respondentPhone`(top-level)은 마스킹값
- `answers[]`의 이름/연락처/생년월일 등 자유서술형 PII 문항 답변도
  마스킹값으로 영구 대체됨(`respondent.answersPii`도 `null`)

**즉 원문이 Firestore 어디에도 남지 않았다.** 관리자 다운로드가 마스킹되어
보인 것은 "다운로드 코드가 마스킹을 잘못 적용해서"가 아니라 **저장된 원본
자체가 없어서**였다. `resolveCsvNameAndPhone()`(`SurveyResponsesAdminPage.jsx`)의
"실명 보기" 버튼도 `summary.isPiiProtected`(=`piiProtected===true`)일
때만 노출되도록 만들어져 있었는데, `piiProtected`가 항상 `false`이므로 이
버튼 자체가 뜨지 않았다 — 설령 떴어도 눌렀을 때 호출할 `revealResponsePii`
Cloud Function이 배포되어 있지 않아 실패했을 것이다.

## 5. 원본 보존/암호화/유실 판정

| 구간 | 유형 | 판정 근거 |
|---|---|---|
| ~2026-07-12 이전 | **A. 원본 보존형** | `respondent.applicantName`/`applicantPhone`/`applicantBirthDate`와 `answers[]`에 원문이 그대로 있음. 사용자 보고("7/11까지 정상")와 일치 |
| 2026-07-12 배포 ~ 이 수정 배포 전 | **C. 원본 유실형** | `applicantName` 등 원문 필드 자체가 없고, `applicantPii`(암호문)도 없음. `answers[]`도 저장 시점에 마스킹값으로 영구 대체됨. **코드 수정만으로 복구 불가능** — 애초에 어디에도 저장된 적이 없기 때문 |
| 이 수정 배포 이후(향후) | **A. 원본 보존형(복귀)** | 아래 §6 수정으로 암호화가 안 되면(Cloud Functions 미배포 포함) 원문을 그대로 저장하도록 되돌림 — 2026-07-11 이전과 동일한 안전한 상태로 복귀 |
| (참고, 현재 비활성) B. 암호화 보존형 | 아직 발생 안 함 | Cloud Functions/KMS가 실제 배포되고 암호화가 성공하면 이 유형이 된다 — `applicantPii`에 암호문 존재, `revealResponsePii`로 복호화 가능. 현재는 Functions 미배포로 이 경로를 탄 응답이 하나도 없다 |

거짓으로 "복호화 가능"이라고 보고하지 않는다 — 유실 구간 응답은 코드로 복구
불가능하며, 사람이 재확인하거나 수기로 보완해야 한다(§11).

## 6. 웹 표시 정책

변경 없음(이미 올바르게 동작 중이었다). 관리자 목록 테이블은 role과
무관하게 항상 `maskName`/`maskPhone`으로 마스킹해 표시한다
(`SurveyResponsesAdminPage.jsx` 테이블 렌더링, 2026-07-12 커밋 이전부터의
동작 그대로 유지). 응답 상세의 PII 문항 답변도 `maskAnswerByQuestion`으로
항상 마스킹 표시한다.

## 7. 다운로드 정책

변경 없음(기존 `shouldMaskDownload = !['super_admin', 'admin'].includes(role)
&& !isSurveyOwner(survey)` role 판정 로직을 그대로 재사용). 이번 수정은
**"다운로드 시 무엇을 마스킹할지 판단하는 로직"이 아니라 "저장 시점에
원본이 실제로 남아 있는지"**를 고쳤다 — 판단 로직 자체는 원래부터 올바르게
설계되어 있었다.

- 관리자(`super_admin`/`admin`) 또는 설문 소유자: CSV/응답원본.csv 다운로드에
  원본(복구된 이후) 사용
- readonly/그 외: 다운로드도 마스킹 적용(기존과 동일)
- 원본 유실 응답(§5의 C유형)은 role과 무관하게 항상 `[원본 확인 불가]`로
  표시 — "마스킹된 정상 값"과 "복구 불가능한 값"을 명확히 구분(§9)

## 8. 권한 정책

기존 `users`/`role` 기반 체계(`super_admin`, `admin`, `manager` 등,
`isSurveyOwner()`)를 그대로 재사용했다. 새 역할을 만들지 않았다.
`shouldMaskDownload` 계산식, `isAtLeastAdmin()` 류의 판정 함수 모두 무변경.

## 9. 변경 파일

### `src/firebase/surveys.js`

- **`resolveProtectedAnswerItem(answerItem, answerPiiQuestionIds, answerFieldsPii)`**(신규,
  순수 함수) — answers[] PII 문항 하나를 저장용으로 변환. **KMS 암호문이
  실제로 있을 때만** 마스킹값으로 치환하고, 없으면(Cloud Functions 미배포
  포함) 원문을 그대로 통과시킨다.
- **`buildRespondentPiiFields(applicantIdentity, respondentPii)`**(신규,
  순수 함수) — `respondent`에 저장할 PII 필드 묶음 생성. `piiProtected`가
  true일 때만 마스킹 미리보기를 최종값으로 쓰고, false면 원문을 저장한다
  (2026-07-11 이전과 동일한 동작으로 복귀).
- **`isOriginalPiiLost(respondent)`**(신규, 순수 함수) — `piiProtected:false`
  + `applicantPii` 없음 + `applicantNameMasked` 있음(2026-07-12 이후 코드가
  실행됨) + `applicantName` 없음(이번 수정 이전 코드가 실행됨) 조합으로
  "원본 유실 구간에 저장된 응답"만 정확히 식별한다.
- `submitSurveyResponseLegacyClient()` 내부에서 위 3개 함수를 사용하도록
  기존 인라인 로직을 교체.
- `extractApplicationResponseSummary()` — `isOriginalLost`일 때
  `name`/`phone`을 `answers[]`(이미 손상된 값)에서 다시 뽑는 대신
  `'[원본 확인 불가]'`로 명시. 반환값에 `isOriginalLost` 필드 추가.

### `src/pages/SurveyResponsesAdminPage.jsx`

- `isOriginalPiiLost` import 추가.
- `handleRawCsvDownload()`(응답원본.csv)에서 원본 유실 응답의 PII 문항
  셀은 role과 무관하게 `'[원본 확인 불가]'`로 대체(기존에는 이미 손상된
  텍스트를 정상 마스킹처럼 그대로 내려보냈음).

### `src/utils/privacy.js`

- `maskName`/`maskPhone`/`maskAddress`/`maskBirthDate`가 `'[원본 확인
  불가]'` 문자열을 `'[익명처리됨]'`과 동일하게 그대로 통과시키도록 추가 —
  readonly 다운로드에서 이 마커가 마스킹 함수를 한 번 더 거치며 깨진
  문자열로 뭉개지는 것을 방지.

### `test/adminOriginalPiiExport.test.js`(신규)

`resolveProtectedAnswerItem`, `buildRespondentPiiFields`,
`isOriginalPiiLost`, `extractApplicationResponseSummary`의 원본 유실
분기, `maskName`/`maskPhone` 패스스루를 직접 커버하는 단위 테스트 18개.

DB 마이그레이션·Firestore Rules·Cloud Functions·Cloud KMS 코드는 전혀
건드리지 않았다.

## 10. 테스트 결과

- `npm test`: 16개 파일(기존 15개 + 신규 `adminOriginalPiiExport.test.js`
  1개), **193/193 통과**(기존 15개 파일 180개 + 신규 파일 13개 테스트).
  기존 파일은 하나도 수정하지 않았다 — 모든 신규 검증은 새 테스트 파일에만
  추가했다.
- `npm run lint`: 0 errors, 70 warnings(모두 이번 변경 이전부터 있던
  기존 경고 — `git diff`로 내가 수정한 라인과 무관함을 확인).
- `npm run build`: 성공(청크 크기 경고는 기존부터 있던 것).
- Firestore Rules를 건드리지 않아 `npm run test:rules`(에뮬레이터 필요)는
  재실행하지 않았다.
- 실제 개인정보 대신 가상 데이터(`홍길동`/`010-1234-5678`/`1990-01-01`)만
  fixture로 사용했다.

## 11. 복구 가능한 응답

- **2026-07-12 이전 응답**: 원래부터 원문 보존 — 이번 수정과 무관하게
  계속 정상 다운로드된다.
- **이 수정을 Hosting에 배포한 이후 제출되는 신규 응답**: `piiProtected`가
  여전히 `false`(Cloud Functions 미배포 상태 유지 시)이므로
  `buildRespondentPiiFields`가 원문을 그대로 저장 — 2026-07-11 이전과
  동일하게 관리자 다운로드에서 원본이 정상적으로 내려온다.

## 12. 복구 불가능한 응답

- **2026-07-12 커밋 배포 시점 ~ 이 수정을 실제로 Hosting에 배포하는
  시점 사이에 제출된 응답**(사용자 보고 기준 대략 7/13~) — `§5 C유형`.
  원문이 Firestore 어디에도 저장된 적이 없어 코드로 복구할 수 없다.
  - **대상 건수 확인 방법**(운영 데이터는 이번 세션에서 직접 조회·수정하지
    않았다 — 아래는 방법 제시만): Firestore 콘솔 또는 관리자 화면에서
    `respondent.piiProtected == false && respondent.applicantPii ==
    null && respondent.applicantNameMasked != null &&
    respondent.applicantName == null`인 문서를 찾으면 된다(=
    `isOriginalPiiLost()`와 동일한 조건). 이 수정 배포 이후에는 관리자
    화면에서 `[원본 확인 불가]`로 표시되는 응답이 바로 그 대상이므로,
    화면에서 직접 눈으로도 확인 가능하다.
  - **수기 보완 방법**: 해당 응답의 담당자가 신청자에게 개별 연락해
    이름·연락처·생년월일을 다시 확인하고 `adminNote`(관리자 비고)나 별도
    스프레드시트에 기록 — Firestore 응답 문서 자체를 고치는 것은 운영
    데이터 수정에 해당하므로 이번 세션에서 실행하지 않았고, 실행하더라도
    사용자 승인을 먼저 받아야 한다.
  - **향후 신규 응답 보호 방법**: 이번 수정을 Hosting에 배포하면 이
    문제는 더 이상 발생하지 않는다(§9). Cloud KMS 암호화를 실제로 쓰고
    싶다면 `docs/pii-encryption-architecture.md` §12의 배포 순서(①
    Functions 배포 ② smoke test ③ `VITE_USE_SERVER_RESPONSE_SUBMISSION=true`
    배포 ④ 그 다음에만 firestore.rules 배포)를 반드시 지켜야 한다 —
    순서를 어기면 이번과 같은 유실이 다시 발생하거나(Functions 없이
    "protected" 분기만 켜지는 경우) 전체 응답 제출이 막힌다(rules를
    먼저 배포하는 경우, §2 참고).

## 13. 운영 데이터 미수정 확인

이번 세션에서 Firestore 문서를 직접 조회하거나 수정하는 코드는 실행하지
않았다. 모든 판정은 코드 읽기(git 커밋 diff, 현재 소스)와 CLI 상태 확인
(`firebase functions:list`, `firebase projects:list` 등, 읽기 전용
명령)으로만 이루어졌다. `git status --short` 최종 확인 결과 이번
세션에서 수정한 파일은 `src/firebase/surveys.js`,
`src/pages/SurveyResponsesAdminPage.jsx`, `src/utils/privacy.js`,
`test/adminOriginalPiiExport.test.js`(신규), 본 문서뿐이다.

## 14. 배포 범위

이번 해결은 **프론트 코드 3개 파일 + 신규 테스트뿐**이라 **Hosting만
재배포하면 적용된다** — Functions 배포, Firestore Rules 배포, Cloud KMS
생성, Blaze 전환 전부 불필요하다(목표 그대로 달성). 이번 세션에서는
Hosting 배포도 실행하지 않았다(중단점 준수) — `npm run build`로 빌드
성공까지만 확인했다.

## 15. 남은 위험

- **`functions/src/submitResponse.js`(Structure A 서버 경로)에 동일한
  버그 패턴이 그대로 남아 있다.** 168~199번째 줄 부근에서
  `piiProtected`/`hasCiphertext` 여부와 무관하게 `answer: masked`,
  `respondentName: piiResult.nameMasked`를 무조건 저장한다 — 지금은
  `VITE_USE_SERVER_RESPONSE_SUBMISSION=false`라 이 경로 자체가 실행되지
  않아 안전하지만, **향후 Blaze 전환 후 이 플래그를 켜기 전에 반드시
  이번과 동일한 방식(암호화 성공 시에만 마스킹값 저장)으로 먼저
  고쳐야 한다.** 이번 세션은 Functions 배포뿐 아니라 Functions 소스
  수정도 이번 인시던트 해결에 필수가 아니었고("이번 해결이 Hosting
  변경만으로 가능"한 경우에 해당), 손대면 관련 없는 변경 범위 확대가
  되어 고치지 않았다 — 별도 세션에서 다룰 것.
- 원본 유실 구간(§12) 응답은 여전히 복구 불가능한 상태로 남아 있다 —
  코드 배포와 별개로 담당자의 수기 확인이 필요하다.
- `firestore.rules`의 `/responses/{responseId} allow create: if false`가
  커밋되어 있다는 사실 자체가 위험 요소다 — 실수로 이 파일만 배포하면
  Structure A 준비가 끝나기 전에 전체 응답 제출이 막힌다. 배포 순서를
  literally 지킬 것(§12 참고).
- "실명 보기"(`revealResponsePii`) UI는 `isPiiProtected===true`일 때만
  노출되도록 되어 있어, Cloud Functions가 실제로 배포되고 암호화가
  성공하는 응답이 생기기 전까지는 계속 나타나지 않는다 — 설계대로이며
  버그는 아니다(현재는 원문이 직접 저장되므로 이 버튼 자체가 필요 없다).
- Hosting 배포 시점과 이 수정 배포 시점 사이에도 짧은 유실 구간이 생길
  수 있다(배포는 즉시 전체 트래픽에 적용되지 않을 수 있음) — 배포 직후
  제출된 응답 몇 건은 배포 확인 차원에서 관리자가 직접 다운로드해
  원문이 보이는지 스팟체크할 것을 권장한다.
