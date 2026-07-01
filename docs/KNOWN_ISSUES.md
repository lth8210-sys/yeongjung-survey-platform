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
