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
