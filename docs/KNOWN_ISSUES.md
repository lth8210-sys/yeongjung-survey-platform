# Known Issues

현재 알려진 이슈와 운영 중 해결한 장애를 관리한다. 완료된 이슈도 삭제하지 않고 원인과 재발방지를 남긴다.

## 관리 기준

| 항목 | 설명 |
| --- | --- |
| 번호 | 추적용 ID |
| 제목 | 이슈 이름 |
| 상태 | 예정, 진행중, 완료, 보류 |
| 영향도 | 낮음, 중간, 높음, 치명 |
| 발생일 | 처음 확인된 날짜 |
| 수정일 | 수정 또는 보류 결정 날짜 |
| 관련 파일 | 주요 영향 파일 |
| 원인 | 확인된 원인 |
| 해결 | 적용한 해결책 |
| 재발방지 | 앞으로 확인할 기준 |
| 운영 영향 | 운영 중 사용자 영향 |
| 재발 가능성 | 낮음, 중간, 높음 |
| 우선순위 | P1, P2, P3 |

## 이슈 목록

| 번호 | 제목 | 상태 | 영향도 | 재발 가능성 | 우선순위 | 발생일 | 수정일 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| KI-001 | Creator Permission | 완료 | 높음 | 중간 | P1 | 2026-07 | 2026-07 |
| KI-002 | Quota Region Mapping | 완료 | 높음 | 중간 | P1 | 2026-07 | 2026-07 |
| KI-003 | Permission-denied Recent Responses | 완료 | 높음 | 높음 | P1 | 2026-07 | 2026-07 |
| KI-004 | Survey Reports Permission | 완료 | 중간 | 중간 | P2 | 2026-07 | 2026-07 |
| KI-005 | Draft Publish | 예정 | 높음 | 높음 | P1 | 2026-07 | - |
| KI-006 | Functions Notification | 보류 | 중간 | 낮음 | P3 | 2026-07 | - |
| KI-007 | 설문 수정 저장 시 공개 문항 미반영 | 완료 | 치명 | 중간 | P1 | 2026-07 | 2026-07 |
| KI-008 | 공개 응답 제출 필드 화이트리스트 부재 | 완료 | 높음 | 낮음 | P1 | 2026-07 | 2026-07 |
| KI-009 | CSV/Excel 수식 인젝션 | 완료 | 높음 | 낮음 | P1 | 2026-07 | 2026-07 |
| KI-010 | 공개 설문 목록(list) 비로그인 조회 불가 | 완료 | 치명 | 낮음 | P1 | 2026-07 | 2026-07 |
| KI-011 | 다중선택 "N개까지 선택" 제한 미강제 | 완료 | 중간 | 중간 | P2 | 2026-07 | 2026-07 |
| KI-012 | 응답 삭제 시 중복신청 lock 미해제 | 완료 | 중간 | 중간 | P2 | 2026-07 | 2026-07 |
| KI-013 | 욕구조사 설문 개편 시 라이브 Firestore 문서 미자동반영 | 완료 | 높음 | 높음 | P1 | 2026-07 | 2026-07 |
| KI-014 | 결과보고서 분석 계산 실패 시 페이지 전체 크래시 | 완료 | 중간 | 중간 | P2 | 2026-07 | 2026-07 |
| KI-015 | Q4 출생연도 정상 입력해도 quota 검증 실패로 다음 페이지 진행 차단 | 완료 | 치명 | 중간 | P1 | 2026-07 | 2026-07 |
| KI-016 | 템플릿 적용/섹션 복제 시 문항 ID 재발급 후 visibilityConditions·conditionalConsentField remap 누락 | 완료 | 치명 | 높음 | P1 | 2026-07 | 2026-07 |

## KI-001 Creator Permission

- 상태: 완료
- 영향도: 높음
- 재발 가능성: 중간
- 우선순위: P1
- 관련 파일: `firestore.rules`, `src/firebase/surveys.js`, `src/firebase/users.js`
- 원인: creator 권한은 본인 설문 중심이어야 하지만 query와 rules가 항상 같은 조건으로 증명되지 않으면 permission-denied가 발생한다.
- 해결: creator 조회는 owner UID/email과 surveyId 기반 query를 우선한다.
- 재발방지: creator QA에는 본인 설문 수정, 본인 응답 조회, 타인 private 차단을 반드시 포함한다.
- 운영 영향: creator가 본인 설문을 못 보거나 수정하지 못할 수 있다.

## KI-002 Quota Region Mapping

- 상태: 완료
- 영향도: 높음
- 재발 가능성: 중간
- 우선순위: P1
- 관련 파일: `src/firebase/surveys.js`, `src/pages/SurveyResponsePage.jsx`, `src/pages/SurveyResponsesAdminPage.jsx`
- 원인: 권역, 연령대, matrix, 응답 값 mapping이 어긋나면 quotaCounts가 잘못 증가하거나 차단 조건이 틀어진다.
- 해결: quotaConfig와 quotaCounts를 분리하고 응답 제출 트랜잭션에서 count를 갱신한다.
- 재발방지: quota 변경 시 제출, 삭제, dashboard, 부족 현황을 함께 QA한다.
- 운영 영향: 목표 응답 수 관리가 틀어질 수 있다.

## KI-003 Permission-denied Recent Responses

- 상태: 완료
- 영향도: 높음
- 재발 가능성: 높음
- 우선순위: P1
- 관련 파일: `firestore.rules`, `src/firebase/surveys.js`, `src/pages/RecentResponsesPage.jsx`
- 원인: `responses` 전체 collection list는 rules에서 role별 접근을 증명하기 어렵다.
- 해결: admin/super_admin은 전체 조회를 허용하고, creator/staff/viewer는 접근 가능한 surveyId별 responses 조회로 분해한다.
- 재발방지: 최근응답 변경 시 `responses?orderBy=submittedAt.desc&limit=...`와 `responses?surveyId==...` path를 확인한다.
- 운영 영향: 최근응답이 0건으로 보이거나 permission-denied가 발생할 수 있다.

## KI-004 Survey Reports Permission

- 상태: 완료
- 영향도: 중간
- 재발 가능성: 중간
- 우선순위: P2
- 관련 파일: `firestore.rules`, `src/firebase/surveys.js`, `src/pages/SurveyReportsAdminPage.jsx`
- 원인: `survey_reports` 전체 list는 creator/staff/viewer 권한을 rules에서 증명하기 어렵다.
- 해결: 접근 가능한 surveyId 목록을 먼저 만든 뒤 surveyId별 report query를 수행한다.
- 재발방지: 보고서 목록 변경 시 admin 전체 조회와 creator 본인 보고서 조회를 분리해서 QA한다.
- 운영 영향: 결과보고서 관리 화면 진입 실패 또는 빈 목록이 발생할 수 있다.

## KI-005 Draft Publish

- 상태: 예정
- 영향도: 높음
- 재발 가능성: 높음
- 우선순위: P1
- 관련 파일: `src/firebase/surveys.js`, `src/pages/SurveyBuilderPage.jsx`, `src/pages/SurveyPreviewPage.jsx`
- 원인: 운영 중인 `questions`와 편집 중인 문항이 분리되지 않으면 저장 즉시 공개 설문이 바뀔 수 있다.
- 해결: Draft-Publish 구조는 별도 단계에서 충분한 QA 후 적용한다.
- 재발방지: 공개 응답은 운영 문항만 보고, 편집 화면은 draft 문항을 보도록 명확히 분리한다.
- 운영 영향: 기존 공개 설문 응답 흐름이 깨질 수 있다.

## KI-006 Functions Notification

- 상태: 보류
- 영향도: 중간
- 재발 가능성: 낮음
- 우선순위: P3
- 관련 파일: 미정
- 원인: 운영 알림은 Firebase Functions, 이메일, Slack 등 외부 연동 정책이 필요하다.
- 해결: 핵심 설문/응답 안정화 이후 별도 설계한다.
- 재발방지: 알림 실패가 응답 제출을 막지 않도록 비동기 처리한다.
- 운영 영향: 관리자 실시간 알림이 제한될 수 있다.

## KI-007 설문 수정 저장 시 공개 문항 미반영

- 상태: 완료
- 영향도: 치명
- 재발 가능성: 중간
- 우선순위: P1
- 관련 파일: `src/firebase/surveys.js`, `src/pages/SurveyBuilderPage.jsx`
- 원인: b5c175e(2026-07-01)에서 `questions`(공개본)/`draftQuestions`(초안) 분리 및
  `publishDraft` 옵션이 `updateSurvey`에 도입됐으나, `SurveyBuilderPage.jsx`의 저장
  호출이 `publishDraft`를 전달하지 않아 기본값 `false`로 처리됐다. 기존 설문은
  거의 항상 `questions`가 이미 채워져 있으므로, 저장할 때마다 `draftQuestions`만
  갱신되고 응답자가 실제로 보는 `questions`는 그대로 남아 편집 내용이 반영되지
  않았다(재오픈 시에도 `questions`를 다시 불러오므로 방금 수정한 내용이 사라진
  것처럼 보임).
- 해결: 빌더의 저장 호출에 `publishDraft: true`를 명시해 항상 공개 문항을 즉시
  갱신하도록 복구했다. `updateSurvey` 내부의 분기 로직은 `resolveQuestionPayload`
  순수 함수로 분리해 `test/surveyUpdatePayload.test.js`로 고정했다.
- 재발방지: `draftQuestions`/`publishDraft`를 실제 초안-게시 UX로 확장할 때는
  빌더가 어떤 경우에 `publishDraft: true`를 보내는지 명확히 설계하고,
  `resolveQuestionPayload` 테스트를 함께 갱신한다.
- 운영 영향: 2026-07-01 이후 배포된 환경에서 기존 설문을 2회 이상 수정 저장한
  경우 공개 문항이 최신 상태가 아니었을 수 있다. 배포 후 실제 설문 재확인 필요.

## KI-008 공개 응답 제출 필드 화이트리스트 부재

- 상태: 완료
- 영향도: 높음
- 재발 가능성: 낮음
- 우선순위: P1
- 관련 파일: `firestore.rules`
- 원인: `responses` create 규칙이 `hasOnly()` 화이트리스트 없이 최소 필드 존재만
  검증해, 응답자가 `surveyOwnerEmail`, `status`, `surveyDeleted` 등 임의 필드를
  위조해 써넣을 수 있는 여지가 있었다.
- 해결: `validPublicResponseCreate()`를 추가해 `submitSurveyResponse()`가 실제로
  쓰는 25개 top-level 필드만 허용하고, 항상 고정값인 필드(`status`,
  `surveyDeleted`, `surveyPermanentlyDeleted`, `hiddenFromDefaultList`,
  `adminNote`)는 값까지 강제했다. 소유자 스냅샷 필드(`surveyOwnerUid` 등)는
  legacy 설문의 소유자 필드가 6종으로 혼재되어 서버측 파생 없이 안전하게 대조할
  수 없어 이번 범위에서는 타입 검증까지만 적용했다(후속 과제로 남김).
- 재발방지: `submitSurveyResponse()`에 새 필드를 추가하면 반드시
  `validPublicResponseCreate()`의 `hasOnly()` 목록도 함께 갱신한다. 이 규칙은
  로컬 에뮬레이터(Java 런타임 필요)로 사전 검증하지 못했으므로, 배포 직후
  실제 공개 설문 제출 스모크 테스트가 필수다.
- 운영 영향: 화이트리스트 목록이 실제 코드와 어긋나면 정상 제출도
  permission-denied로 막힐 수 있다 — 배포 직후 반드시 실제 제출 확인.

## KI-009 CSV/Excel 수식 인젝션

- 상태: 완료
- 영향도: 높음
- 재발 가능성: 낮음
- 우선순위: P1
- 관련 파일: `src/utils/csvSafeCell.js`, `src/pages/SurveyResponsesAdminPage.jsx`, `src/utils/statisticsExcel.js`
- 원인: 응답자가 자유응답/이름 등에 `=`, `+`, `-`, `@`로 시작하는 값(예:
  `=HYPERLINK(...)`)을 입력하면, 관리자가 CSV/Excel을 엑셀로 열 때 수식으로
  해석되어 실행될 수 있었다(CSV/Formula Injection). 기존 `escapeCsvValue`는
  큰따옴표만 이스케이프했다.
- 해결: `src/utils/csvSafeCell.js`의 `sanitizeCellValue`/`sanitizeRow`를 CSV
  다운로드(`downloadCsv`)와 통계 Excel의 응답 원본/자유의견 시트에 적용해
  위험 접두문자로 시작하는 값 앞에 작은따옴표를 붙이도록 했다.
- 재발방지: 응답 데이터를 CSV/Excel 셀에 새로 쓰는 코드를 추가할 때는
  `sanitizeCellValue`/`sanitizeRow`를 거치도록 한다.
- 운영 영향: 없음(방어적 강화, 기존 정상 데이터 표시에는 영향 없음).

## KI-010 공개 설문 목록(list) 비로그인 조회 불가

- 상태: 완료
- 영향도: 치명
- 재발 가능성: 낮음
- 우선순위: P1
- 관련 파일: `firestore.rules`
- 원인: `surveys` 컬렉션의 `get`(단일 문서)과 `list`(쿼리) 규칙이 과거 한
  규칙(`allow read`)에서 분리될 때(29e1d43) `get`에는
  `surveyStatusForRead(resource.data)`로 게시/마감 설문의 비로그인 공개 조회를
  허용했지만, `list`는 `canListManagedSurveys(resource.data)`만 남아
  로그인·역할이 있어야만 통과했다. 그 결과 `/surveys`(공개 설문 목록) 페이지가
  비로그인 방문자에게는 항상 `permission-denied`로 실패했다 — 직접 링크
  (`/surveys/:id`, get)는 정상 동작해 QR/직접 링크로만 접근하면 드러나지
  않았다. 2026-07-05 KI-008 배포 후 스모크 테스트 중 우연히 발견.
- 해결: `allow list`에도 `get`과 동일하게
  `surveyStatusForRead(resource.data) ||`를 추가해 게시/마감 상태 설문은
  비로그인 사용자도 목록 조회가 가능하도록 맞췄다.
- 재발방지: `get`/`list`를 분리해 정의하는 컬렉션은 두 규칙이 같은 공개
  범위를 갖는지 항상 함께 확인한다. 이번처럼 `list`만 조용히 뒤처지기 쉽다.
- 운영 영향: 이 규칙이 도입된 시점부터 배포 시점까지, 비로그인 방문자가
  "설문 목록" 화면으로 게시 중인 설문을 둘러볼 수 없었다(직접 링크는 영향 없음).

## KI-011 다중선택 "N개까지 선택" 제한 미강제

- 상태: 완료
- 영향도: 중간
- 재발 가능성: 중간
- 우선순위: P2
- 관련 파일: `src/firebase/surveyNormalize.js`, `src/pages/SurveyResponsePage.jsx`,
  `src/components/QuestionEditor.jsx`, `src/data/formTemplates.js`
- 원인: 다중선택 문항의 선택 개수 제한을 판정하는 `getMaxSelections`가 문항
  제목/설명 텍스트에서 정규식 `/최대\s*(\d+)\s*개/`("최대 N개")만 인식했다.
  그러나 "2026 영중 지역주민 욕구조사" 템플릿을 포함해 실제로 자주 쓰이는
  문구는 "N개까지 선택"("최대"가 없음)이었고, 이 값은 어떤 문항 데이터
  필드에도 명시적으로 저장돼 있지 않았다. 그 결과 문항 제목은 "2개까지
  선택"이라고 안내하면서도 실제로는 3개, 4개, ... 선택지 전체를 선택해도
  제출까지 막히지 않았다. 빌더 화면에도 이 값을 직접 설정할 UI가 없었다.
- 해결:
  1. `getMaxSelections`를 `SurveyResponsePage.jsx`에서
     `src/firebase/surveyNormalize.js`로 추출해 export하고(단일 소스,
     테스트 가능하도록), 텍스트 정규식을 `"N개까지 선택/고르/체크/선정"`
     형태까지 인식하도록 확장했다.
  2. `QuestionEditor.jsx`의 다중선택 문항 편집 화면에 "최대 선택 개수"
     숫자 입력을 추가했다 — `question.validation.maxSelections`에 저장되며,
     `normalizeQuestion()`이 `validation` 객체 전체를 보존하므로 저장 후에도
     유지된다(주의: top-level `question.maxSelections`로 저장하면
     `normalizeQuestion()`의 필드 화이트리스트에 의해 저장 시 사라진다 —
     반드시 `validation.maxSelections` 또는 `settings.maxSelections` 사용).
  3. `formTemplates.js`의 욕구조사 템플릿 "N개까지 선택" 문항 8개(Q41,
     Q46-1~6, Q49)에 `validation: { maxSelections: 2 }`를 명시적으로 설정했다.
  4. 실제 운영 중인 "2026 영중 지역주민 욕구조사" 설문(이미 생성된 문서,
     템플릿 데이터 변경과 무관)에서 정규식 fallback만으로 `getMaxSelections`가
     8개 문항 모두 정확히 2를 반환하는지 라이브 데이터로 직접 확인했다 —
     이 프론트엔드 배포만으로 기존 설문도 즉시 보호된다(데이터 마이그레이션
     불필요).
- 재발방지: `test/getMaxSelections.test.js`에 실제 욕구조사 문구를 포함한
  회귀 테스트 11개 고정. 새 문항 유형/문구 패턴을 추가할 때 이 테스트를
  함께 갱신한다.
- 운영 영향: 없음(강화만 이루어짐). 다만 클라이언트 UI 레벨 강제일 뿐 서버
  (Firestore rules)에서 `answers` 내용을 검증하지는 않으므로, 조작된
  요청으로 우회 제출하는 것까지 막지는 못한다 — v2 Cloud Functions 단계의
  서버측 응답 검증 과제로 남긴다(docs/review/11_V2_MASTER_BLUEPRINT.md 참조).

## KI-012 응답 삭제 시 중복신청 lock 미해제

- 상태: 완료
- 영향도: 중간
- 재발 가능성: 중간
- 우선순위: P2
- 관련 파일: `src/firebase/surveys.js`(`deleteSurveyResponse`), `firestore.rules`
- 원인: 중복신청 방지(`duplicateCheckEnabled`/`oneSlotPerPersonEnabled`) 또는
  슬롯 중복방지(`slotDuplicateCheckEnabled`)가 켜진 신청형 폼에서, 제출 시
  `applicationApplicantLocks`/`applicationSlotLocks` 서브컬렉션에 신청자
  식별키(전화번호 또는 이름+생년월일) 기준 lock 문서가 생성된다. 그런데
  관리자가 해당 응답을 삭제(`deleteSurveyResponse`, soft delete)해도 이
  lock 문서는 전혀 정리되지 않았다 — Firestore rules도 두 컬렉션 모두
  `allow update, delete: if false`로 영구 불변이었다. 결과적으로 응답을
  삭제해도 그 신청자는 같은 정보로 **영구히 재신청이 불가능**했다(중복 오신청
  삭제 후 재도움, 테스트 응답 삭제 후 재테스트 등 흔한 운영 시나리오에서 발생).
- 해결:
  1. `deleteSurveyResponse`가 응답의 `respondent.applicantKey`/`slotSelections`로
     원래 lock 문서 ID를 재계산해 조회하고, `shouldReleaseLock()`(lock의
     `responseId`가 삭제 대상 응답과 정확히 일치하는지 확인 — 32비트
     비암호화 해시 충돌로 다른 신청자의 lock을 잘못 지우는 사고 방지)을
     통과한 lock만 같은 트랜잭션에서 함께 삭제한다.
  2. 개인정보 익명화(`anonymizeResponsePii`)로 `applicantKey`가
     `[익명처리됨]`으로 마스킹된 응답은 안전하게 재계산할 수 없으므로
     lock 정리를 건너뛴다(여러 익명 응답이 같은 문자열을 공유해 서로 다른
     신청자의 lock을 지울 위험이 있음).
  3. `firestore.rules`의 두 lock 컬렉션에 `allow delete:
     if canEditSurveySubdoc(surveyId)`를 추가했다(update는 여전히 금지) —
     응답을 삭제할 수 있는 것과 같은 수준(설문 관리 권한)으로 제한.
- 재발방지: `test/shouldReleaseLock.test.js`로 안전장치 로직 고정. lock
  컬렉션에 새 종류를 추가하면 삭제 시 정리 로직도 함께 갱신한다.
- 운영 영향: 이 배포 전까지 삭제된 신청형 응답의 신청자는 재신청이 막혀
  있었을 수 있다. 배포 후에도 과거에 이미 삭제된 응답의 lock은 자동으로
  정리되지 않으므로(이 로직은 삭제 "시점"에만 작동), 필요 시 해당 신청자의
  lock 문서를 수동으로 확인해야 한다.

## KI-013 욕구조사 설문 개편 시 라이브 Firestore 문서 미자동반영

- 상태: 완료
- 영향도: 높음
- 재발 가능성: 높음
- 우선순위: P1
- 관련 파일: `src/data/formTemplates.js`, `src/firebase/surveys.js`,
  `scripts/repairSurvey.mjs`(라이브 문서 수정 스크립트 선례)
- 원인: 2026-07 "2026 영중 지역주민 욕구조사" 설문 전면 개편(Q1 주소 자유입력화,
  Q45→Q46 세대별 조건부 표시, Q46-6 노년 출생연도 분리, 지역 quota 폐지 및
  연령 quota-only 전환, Q47 삭제 및 Q48~Q53 재번호화 등)을 `src/data/formTemplates.js`에
  반영했다. 그러나 KI-011에서도 확인된 것처럼 **`formTemplates.js`는 새 설문을 만들 때만
  쓰이는 시드 데이터이며, 이미 생성되어 운영 중인 Firestore `surveys/{surveyId}` 문서와
  그 하위 `quotaConfig/main`·`quotaCounts/main`은 이후 템플릿 변경과 자동 동기화되지
  않는다.** 이번 개편은 KI-011과 달리 코드 배포만으로 라이브 문서가 보호되는 성격이
  아니다 — 문항 구조 자체(Q1 타입, Q46 조건부, quota 매트릭스 shape)가 바뀌므로 라이브
  문서를 별도로 갱신하지 않으면 응답자는 여전히 구설문(구주소 방식 없이 행정동 선택형
  Q1, 조건부 미적용 Q46, 권역 quota)을 보게 된다.
- 해결: 코드 저장소 반영은 완료했다. 라이브 문서 반영도 2026-07-10~11 완료했다 —
  방법 2(Firestore REST API 기반 일회성 마이그레이션 스크립트, `scripts/repairSurvey.mjs`와
  동일한 방식)를 사용해 실제 운영 설문(`surveys/BUUry9Qt5sYZgDaZ8dSL`, 응답 13건
  보유)의 `questions`를 새 템플릿 구조로 교체했다. 진행 전 전체 문서(`surveys` 본문 +
  `quotaConfig/main` + `quotaCounts/main` + 응답 13건)를 백업했고, 기존 58개 문항 중
  57개는 위치·내용 기준으로 최신 템플릿과 매핑해 **Question ID를 그대로 유지**했다
  (신규 문항 3개만 새 ID 발급). 구 Q47(응답 13건 전원 응답)은 운영자 확인 후 템플릿
  기준으로 제거했다 — 원본 응답 데이터는 Firestore에 그대로 남고 향후 통계·CSV·
  보고서에서만 제외된다. quotaConfig/quotaCounts는 운영자 확인 후 "0 재시작"이
  아니라 **실제 응답자 13건의 출생연도를 재계산해 이관**했다(기존 권역×연령
  누적을 연령별로 합산한 값과 정확히 일치함을 사전 검증). 마이그레이션 후 응답
  13건의 원본 답변값이 전혀 손상되지 않았음을 재대조로 확인했고, 실제 운영
  공개 응답 화면에서 Q1/Q28/Q34/Q35/Q45→Q46/연락처·동의 블록이 모두 정상
  동작함을 확인했다(실 연구 데이터 오염을 피하기 위해 실제 제출까지는 하지 않음).
- 재발방지: 설문 문항 구조를 바꾸는 템플릿 수정 시, "템플릿 코드 수정"과
  "라이브 Firestore 문서 반영"을 항상 별도 배포 체크리스트 항목으로 분리해 관리한다.
- 운영 영향: 2026-07-11 라이브 문서 반영 완료 이후 실제 응답자 화면과 관리자 화면
  (quota 대시보드, CSV, 통계)이 새 문항 구조(주소 자유입력, Q45→Q46 조건부, 연령대
  전용 quota)로 정상 동작한다. 동명의 다른 published 설문 문서(`DDNMRm97DGGRIRBEU4a8`,
  응답 0건)가 운영 DB에 남아 있어 공개 목록에 중복 노출되는 문제는 별도 후속 정리가
  필요하다 — 아래 "남은 Known Issues" 참고.
- Commit 판단(2026-07-10, 운영자 확인): 라이브 Firestore 반영은 코드 커밋의
  전제조건이 아니라 별도 운영 단계(Push/Deploy 이후, 운영 승인 필요)로 처리하기로
  확정했다. 코드 저장소 변경은 이 이슈와 무관하게 커밋 가능하며, 이 항목은
  "코드 완료, 라이브 반영 대기 중"으로 계속 추적한다.
- Release Audit 추가 발견(2026-07-10): 해결 방법 1번(Survey Builder에서 직접
  재구성)은 `SurveyBuilderPage.jsx:1458~1465`의 `validatePrivacyConsent()` 검증에
  막힐 뻔했다 — 게시(`published`) 상태 설문을 저장할 때 PII 문항(Q1 주소 등)이
  있는데 개인정보 동의(`CONSENT_CHECKBOX`) 문항이 하나도 없으면 저장 자체가
  차단된다. 개편 직후의 `formTemplates.js`에는 DOCX 마지막 페이지의 "설문 경품
  제공 안내·개인정보 수집·이용 동의" 블록(연락처 수집 + 동의 체크박스)이
  누락되어 있었다 — 이번 Release Audit에서 발견해 `needs-consent-contact`/
  `needs-consent-checkbox` 두 문항을 추가해 해결했다(DOCX 원문의 "동의하지
  않아도 설문 제출에는 영향이 없다" 문구에 따라 둘 다 `required: false`).
  이 수정으로 해결 방법 1번이 더 이상 막히지 않는다.
- Release Audit 추가 발견(2026-07-10, 2차): 해결 방법 1번(Survey Builder에서 직접
  재구성)을 실제로 실행하면 `applyTemplate()`의 문항 ID 재발급 remap 누락 때문에
  Q45→Q46 조건부 표시와 조건부 개인정보 동의가 깨진 채로 배포될 뻔했다 — KI-016
  참고. KI-016 수정 이후에는 해결 방법 1번을 그대로 수행해도 안전하다.

## KI-014 결과보고서 분석 계산 실패 시 페이지 전체 크래시

- 상태: 완료
- 영향도: 중간
- 재발 가능성: 중간
- 우선순위: P2
- 관련 파일: `src/pages/SurveyReportPage.jsx`, `src/utils/surveyAnalytics.js`
- 원인: `SurveyReportPage.jsx`는 데이터 로딩(`fetchSurveyById`,
  `fetchAllResponsesForSurveyExport`, `fetchSurveyReport`)만 `try/catch`로 감싸고
  실패 시 `error` 상태로 안내 메시지를 보여준다. 그런데 `buildSurveyAnalytics()`와
  `buildDefaultReportSections()`는 이 보호 밖의 `useMemo`에서 호출됐다 — 두 함수
  중 하나라도 예외를 던지면 React 렌더 도중 예외가 발생해 컴포넌트 전체가
  크래시하고(흰 화면), 콘솔 외에는 원인을 알 수 있는 정보가 사용자에게 전혀
  보이지 않는다. 정적 분석과 `test/surveyAnalytics.test.js`에 추가한 경계값
  테스트(조건부로 숨겨진 문항으로 인한 결측 답변, 개편으로 바뀐 문항 id 불일치,
  구버전/신버전 quota 필드 혼재, malformed 응답 등)로는 `buildSurveyAnalytics`
  자체가 실제로 던지는 구체적인 트리거를 재현하지는 못했지만, 이 함수가
  응답/문항 데이터 형태에 강하게 의존하는 순수 계산 함수이고 향후 어떤 새로운
  데이터 형태(특히 이번 릴리즈처럼 문항 구조가 크게 바뀌는 경우)에서도 예외
  없이 동작한다는 보장이 없는 구조적 위험(에러 경계 부재)이었다.
- 해결: `analytics`, `defaultReportSections` 계산을 각각 `{ data, error }` 형태로
  감싸 `try/catch`로 예외를 잡고, 실패 시 기존 `error` 상태와 동일한 패턴(안내
  문구 + "돌아가기" 버튼)으로 사용자에게 보여주도록 렌더 가드를 추가했다. 정상
  경로는 기존과 동일하게 동작한다(예외가 없으면 `data`만 그대로 사용).
- 재발방지: `test/surveyAnalytics.test.js`에 조건부 숨김 문항, 문항 id 불일치,
  malformed/구버전 응답, quota 필드 신구 혼재 상황에서 `buildSurveyAnalytics`가
  예외를 던지지 않는지 확인하는 회귀 테스트 6건을 추가했다. 결과보고 관련 함수를
  새로 추가하거나 수정할 때는 반드시 `useMemo`/렌더 경로에서 예외가 발생해도
  페이지가 크래시하지 않고 `error` 계열 상태로 흡수되는지 확인한다.
- 운영 영향: 이 수정 전에는 특정 설문의 응답 데이터가 분석 계산에서 예외를
  유발하는 경우 해당 설문의 결과보고서 화면이 원인 불명의 흰 화면으로 보였을
  것이다(재현 가능한 구체적 트리거는 확인하지 못함). 수정 후에는 최소한 원인
  파악이 가능한 안내 화면으로 대체된다. 실제 운영 데이터로 재현되는 구체적인
  예외 트리거가 발견되면 이 항목에 추가로 기록한다.
- Commit 판단(2026-07-10, 운영자 확인): 실제 트리거를 재현하지 못한 상태에서도
  이 안전망(부작용 없는 방어 코드, 정상 경로 동작 불변)만으로 충분하다고 확인했다.
  추가 조사 없이 이 상태로 커밋한다.
- 추가 검증(2026-07-10): `src/utils/reportDocx.js`, `src/pages/SurveyReportsAdminPage.jsx`의
  Word 다운로드(`handleWordDownload`), `src/pages/SurveyReportPage.jsx`의 Word
  다운로드(`handleDocxDownload`)를 모두 확인한 결과, `buildSurveyAnalytics()`를
  호출하는 다른 모든 경로는 버튼 클릭 핸들러 안에서 `try/catch`로 감싸여 있어
  실패해도 "다운로드에 실패했습니다" 안내만 뜨고 페이지는 죽지 않는다. 이번에
  고친 `SurveyReportPage.jsx`의 렌더 단계 `useMemo` 호출이 보고서 관련 코드
  전체에서 유일하게 보호되지 않은 지점이었다 — "보고서 화면을 열자마자 나는
  오류(생성 오류)"라는 증상과 정확히 일치해 근본 원인일 가능성이 높다는 근거를
  추가로 확보했다.

## KI-015 Q4 출생연도 정상 입력해도 quota 검증 실패로 다음 페이지 진행 차단

- 상태: 완료
- 영향도: 치명(응답자 전원이 1페이지 이후로 진행 불가능한 제출 차단 버그)
- 재발 가능성: 중간
- 우선순위: P1
- 관련 파일: `src/pages/SurveyResponsePage.jsx`(`getQuotaField`), `src/data/formTemplates.js`
- 원인: `getQuotaField()`는 문항에 명시적 `meta.quotaField`가 없으면 제목/설명
  텍스트에 "출생연도"/"출생년도"가 포함되는지로 quotaField를 **추정**한다(레거시
  데이터 호환용 폴백). `quotaInput` 계산은 `survey.questions`를 순서대로 훑으며
  `quotaField === 'birthYear'`로 판정된 **모든** 문항의 답을 계속 덮어쓰는 구조라,
  가장 나중에 순회되는 문항의 값(설문 앞부분에서는 대부분 미응답=빈 값)이 최종
  값이 된다. 이번 개편에서 추가한 Q46-6 직전 문항("[노년] 함께 살고 있는 노년
  가족의 출생연도를 작성해주세요")도 제목에 "출생연도"가 포함되어 있어 동일하게
  `birthYear`로 오판정되었고, Q4(응답자 본인 출생연도, `needs-q04`)보다 배열
  뒤쪽에 위치해 **Q4에 정상적으로 1974를 입력해도 quotaInput.birthYear가 빈
  문자열로 덮어써져** `resolveAgeQuota`가 항상 invalid를 반환, "Q4 출생연도를
  확인해주세요." 메시지와 함께 다음 페이지 진행이 영구적으로 차단되었다. 이
  버그는 Q46 문항이 아직 화면에 나타나지 않은 1페이지 시점에도 발생한다 —
  `quotaInput`이 `survey.questions` 전체(현재 보이는 문항이 아니라)를 순회하기
  때문이다.
- 해결:
  1. `getQuotaField()`를 수정해 문항에 **어떤 값이든** 명시적 `meta.quotaField`가
     있으면(빈 문자열이 아닌 한) 텍스트 폴백을 건너뛰고 그 값을 그대로 신뢰하도록
     했다 — `'birthYear'`가 아닌 다른 명시값은 quotaField 없음(`''`)으로 처리된다.
     `meta.quotaField`가 아예 없는 문항만 기존처럼 텍스트 폴백을 사용한다(레거시
     호환 유지).
  2. `src/data/formTemplates.js`의 `needs-q46-6-birthyear` 문항에
     `meta: { quotaField: 'none' }`을 추가해 텍스트 폴백에 걸리지 않도록
     명시적으로 제외했다.
- 재발방지: `test/needsSurveyTemplate.test.js`에 (a) Q4가 `birthYear`로 정확히
  분류되는지, (b) Q46-6-birthyear가 분류되지 않는지, (c) 실제 `survey.questions`
  순서로 quotaInput 계산을 재현했을 때 Q4 값이 보존되는지, (d) 1974가 실제로
  연령대 매칭에 성공하는지 4건의 회귀 테스트를 추가했다. 향후 제목에 "출생연도"가
  들어가는 문항을 추가할 때는(예: 동거 가족, 자녀 등 본인이 아닌 대상의 출생연도)
  반드시 `meta.quotaField: 'none'`으로 명시적으로 제외해야 한다.
- 운영 영향: 이 버그는 새로 추가된 Q46-6-birthyear 문항이 실제 라이브 설문에
  반영된 이후에만(KI-013 참고) 응답자에게 나타난다 — 현재 라이브 Firestore 문서는
  아직 구설문 상태라 이 문항이 없으므로 지금 당장 운영 중인 공개 응답에는 영향이
  없다. 그러나 KI-013의 라이브 반영을 이 수정 없이 진행했다면 반영 직후 모든
  응답자의 제출이 100% 차단되는 치명적 장애로 이어졌을 것이다.

## KI-016 템플릿 적용/섹션 복제 시 문항 ID 재발급 후 visibilityConditions·conditionalConsentField remap 누락

- 상태: 완료
- 영향도: 치명(개인정보 컴플라이언스 — 동의 없이 PII가 저장될 수 있었음)
- 재발 가능성: 높음(문항 ID를 참조하는 새 필드가 추가될 때마다 반복될 수 있는 구조적 문제였음)
- 우선순위: P1
- 관련 파일: `src/pages/SurveyBuilderPage.jsx`(`applyTemplate()`, `duplicateSection()`),
  `src/firebase/surveyTemplates.js`(`remapStructureIds()`, `instantiateSurveyTemplate()`)
- 원인: 템플릿을 새 설문으로 저장하거나(`applyTemplate()`) 섹션을 복제할 때
  (`duplicateSection()`) 문항 ID가 전부 새로 발급되는데, 두 함수 모두
  `branching.rules[].targetQuestionId`/`fallbackTargetQuestionId`만 새 ID로
  remap하고 그 외 문항 ID를 참조하는 필드(`visibilityConditions[].questionId`,
  `meta.conditionalConsentField`, `templateMetadata.quotaBirthYearQuestionId`,
  섹션의 `pageEndTargetSectionId`/`terminationConditions[].questionId`)는 remap하지
  않았다. 그 결과 "2026 영중 지역주민 욕구조사" 템플릿을 실제 Survey Builder에서
  적용·게시하면(KI-013 해결 방법 1번) 다음 두 가지가 실제 응답 화면에서 항상
  깨진다는 것을 로컬 Firebase 에뮬레이터로 전체 플로우(템플릿 적용→저장→게시→
  실제 응답 제출→관리자 확인)를 재현해 확인했다.
  1. Q45→Q46 조건부 표시가 전혀 동작하지 않는다 — `visibilityConditions[].questionId`가
     구식 리터럴 ID(`needs-q45`)를 그대로 가리키는데 실제 저장된 문항 ID는
     `question-<uuid>` 형태로 바뀌어 있어 조건이 항상 거짓으로 평가된다.
  2. "연락처를 입력하면 개인정보 동의가 필수"라는 이번 릴리즈의 조건부 동의 정책이
     항상 무력화된다 — `meta.conditionalConsentField`가 구식 리터럴 ID
     (`needs-consent-contact`)를 가리켜 `SurveyResponsePage.jsx`의
     `validateAnswers()`가 연락처 문항을 찾지 못하고(`triggerQuestion === null`)
     항상 `triggerAnswer=''`로 처리해, 연락처를 입력하고 동의를 체크하지 않아도
     제출이 그대로 성공한다. 에뮬레이터에서 실제로 `{contactAnswer: "010-1234-5678",
     consentAnswer: false}`가 저장되는 것을 확인했다.
  한편 `src/firebase/surveyTemplates.js`의 `instantiateSurveyTemplate()`(저장된
  DB 템플릿 적용 경로)는 필드 이름을 하드코딩하지 않고 데이터 구조 전체를 재귀
  순회하며 idMap에 매칭되는 문자열 값을 전부 치환하는 `remapStructureIds()`를
  이미 쓰고 있어 이 문제가 없었다 — 즉 같은 저장소 안에 올바른 구현과 잘못된
  구현이 공존했다.
- 해결: `remapStructureIds()`를 `surveyTemplates.js`에서 export해
  `applyTemplate()`과 `duplicateSection()` 양쪽에서 재사용하도록 교체했다.
  필드 이름을 나열해 개별 remap하는 대신, 문항(및 섹션) old-id→new-id 맵을 만든
  뒤 해당 데이터 구조 전체(질문 배열, 섹션 객체, `templateMetadata`)를
  `remapStructureIds()`로 한 번에 치환한다 — 새로운 ID 참조 필드가 앞으로
  추가되더라도(필드명이 무엇이든) 별도 코드 수정 없이 자동으로 안전하게 remap된다.
  기존 branching remap 동작은 그대로 유지되며 회귀는 없다.
- 재발방지: `test/applyTemplateIdRemap.test.js`에 (a) applyTemplate() 재현 시
  visibilityConditions.questionId가 새 Q45 ID를 정확히 가리키는지, (b) 그 결과로
  `buildVisibleQuestionFlow()`가 실제로 Q46-1을 노출하는지, (c)
  `meta.conditionalConsentField`가 새 연락처 문항 ID를 가리키고 그 ID로 실제 문항을
  찾을 수 있는지, (d) branching remap이 회귀 없이 계속 동작하는지, (e)
  `templateMetadata.quotaBirthYearQuestionId`가 remap되는지, (f) `remapStructureIds()`
  자체가 섹션 복제 시나리오(`pageEndTargetSectionId`, `terminationConditions` 포함)에서
  범용적으로 동작하는지 검증하는 회귀 테스트를 추가했다. 앞으로 문항 ID를 참조하는
  새 필드를 추가할 때는 이 파일에 해당 필드의 remap 검증 케이스를 함께 추가한다.
- 운영 영향: 이 버그는 라이브 Firestore 설문 문서가 아직 구설문 상태라(KI-013 참고)
  지금 당장 운영 중인 공개 응답에는 영향이 없다. 그러나 KI-013의 해결 방법 1번
  (Survey Builder에서 직접 재구성)을 이 수정 없이 그대로 수행했다면, 반영 직후
  Q45→Q46 조건부 표시와 조건부 개인정보 동의가 실제 운영 설문에서 항상 깨진
  상태로 배포됐을 것이다 — 특히 후자는 사용자가 동의하지 않았는데도 연락처(PII)가
  저장되는 컴플라이언스 문제로 이어졌을 것이다.
